import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildProfileActivity,
  GuildProfileActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_PROFILE_FIELDS,
  SCHEMA_VERSION,
  type GuildProfileField,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type ModifyGuildProfileInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildProfileEvidenceError,
  GuildProfileExecutionError,
  GuildProfileOperationConflictError,
  GuildProfilePlanChangedError,
} from "./errors.js"
import {
  normalizeDesiredGuildProfileDescription,
  normalizeDesiredGuildProfileName,
  validateGuildProfileProjection,
  type DiscordGuildProfile,
  type DiscordGuildProfileMediaPresence,
} from "./guild-profile.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "guild-profile-state-unavailable"
const REQUEST_KEYS = [
  "auditReason",
  "description",
  "guildId",
  "name",
  "operationKey",
] as const
const LOCAL_CONSTRAINTS = Object.freeze({
  descriptionCharacters: DISCORD_LIMITS.guildDescriptionCharacters,
  guildAllowlist: CONNECTOR_LIMITS.guildProfileGuildAllowlist,
  nameCharacters: DISCORD_LIMITS.guildNameCharacters,
  nameMinimumCharacters: DISCORD_LIMITS.guildNameMinimumCharacters,
  supportedFields: [...GUILD_PROFILE_FIELDS],
})

type GuildProfileTargetOutcome = "settled" | "uncertain"

interface GuildProfileLockState {
  tails: Map<string, Promise<GuildProfileTargetOutcome>>
  uncertainGuilds: Set<string>
}

const GUILD_PROFILE_LOCKS = new WeakMap<OperationStore, GuildProfileLockState>()

function guildProfileLocks(operationStore: OperationStore): GuildProfileLockState {
  let state = GUILD_PROFILE_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainGuilds: new Set() }
    GUILD_PROFILE_LOCKS.set(operationStore, state)
  }
  return state
}

export interface GuildProfileChangeRequest {
  auditReason: string
  description?: string | null
  guildId: string
  name?: string
  operationKey: string
}

export interface NormalizedGuildProfileChangeRequest {
  auditReason: string
  description?: string | null
  guildId: string
  name?: string
  operationKeyHash: string
  requestedFields: GuildProfileField[]
}

export interface GuildProfileAccessEvidence {
  appliedRoleIds: string[]
  authorizedForChange: boolean
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageGuild: boolean
  requiredPermission: "MANAGE_GUILD"
  unknownPermissionBits: string
  warnings: string[]
}

export type GuildProfileMediaPresence = DiscordGuildProfileMediaPresence

export interface GuildProfileView {
  description: string | null
  mediaPresence: GuildProfileMediaPresence
  name: string
}

export interface GuildProfilePrivacyProjection {
  mediaHashes: "presence-only"
  persistence: "content-free-records-only"
  profileText: "transient-untrusted"
  rawPayloads: "omitted"
  roleNames: "omitted"
}

export interface GuildProfileVerificationBoundary {
  automaticRetry: false
  freshApiReadback: true
  mutationResponse: true
  rollback: "not-automatic"
}

export interface GuildProfileAuditResult {
  access: GuildProfileAccessEvidence
  applicationId: string
  botId: string
  guildId: string
  localConstraints: typeof LOCAL_CONSTRAINTS
  privacy: GuildProfilePrivacyProjection
  profile: GuildProfileView
  schemaVersion: number
  status: "ok"
  verificationBoundary: GuildProfileVerificationBoundary
}

export interface GuildProfileChangePlan {
  access: GuildProfileAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  changedFields: GuildProfileField[]
  createdAt: string
  current: GuildProfileView
  desired: GuildProfileView
  digest: string
  guildId: string
  localConstraints: typeof LOCAL_CONSTRAINTS
  operationKeyHash: string
  privacy: GuildProfilePrivacyProjection
  requestedFields: GuildProfileField[]
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: GuildProfileVerificationBoundary
  warnings: string[]
  writeRequired: boolean
}

export interface GuildProfileChangeResult {
  activityId: string | null
  driftFields: GuildProfileField[]
  guildId: string
  operationKeyHash: string
  planDigest: string
  requestedFields: GuildProfileField[]
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
  warnings: string[]
}

export interface GuildProfileServiceClient extends Pick<
  DiscordClient,
  | "getGuildMember"
  | "getGuildProfile"
  | "getGuildRoles"
  | "modifyGuildProfile"
> {}

export interface GuildProfileServiceOptions {
  activityStore: ActivityStore
  client: GuildProfileServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertGuildProfileAuditable"
    | "assertGuildProfileChangeable"
  >
  randomId?: () => string
}

interface ValidatedGuildProfile {
  id: string
  ownerId: string
  profile: GuildProfileView
}

interface ValidatedBotMember {
  roles: string[]
}

interface ValidatedRole {
  id: string
  managed: boolean
  permissions: string
  position: number
}

interface GuildProfileState {
  access: GuildProfileAccessEvidence
  botMember: ValidatedBotMember
  guild: ValidatedGuildProfile
  priorReceipt: OperationReceipt | null
  roles: ValidatedRole[]
}

interface BuiltGuildProfilePlan {
  desiredRequest: NormalizedGuildProfileChangeRequest
  desiredView: GuildProfileView
  plan: GuildProfileChangePlan
  state: GuildProfileState
}

function evidenceError(
  message: string,
  options?: ErrorOptions,
): GuildProfileEvidenceError {
  return new GuildProfileEvidenceError(message, options)
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, name: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function requestedFields(record: Record<string, unknown>): GuildProfileField[] {
  return GUILD_PROFILE_FIELDS
    .filter((field) => Object.hasOwn(record, field))
    .sort()
}

export function assertGuildProfileGetInput(guildId: string): void {
  assertPositiveSnowflake(guildId, "Discord guild profile guild ID")
}

export function normalizeGuildProfileChangeRequest(
  request: GuildProfileChangeRequest,
): NormalizedGuildProfileChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild profile change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord guild profile change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord guild profile guild ID")
  const fields = requestedFields(record)
  if (fields.length < 1) {
    throw new RangeError("Discord guild profile change request must select at least one field")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    ...(Object.hasOwn(record, "description")
      ? { description: normalizeDesiredGuildProfileDescription(request.description) }
      : {}),
    guildId: request.guildId,
    ...(Object.hasOwn(record, "name")
      ? { name: normalizeDesiredGuildProfileName(request.name) }
      : {}),
    operationKeyHash: operationKeyHash(request.operationKey),
    requestedFields: fields,
  }
}

function exactGuildProfile(
  value: DiscordGuildProfile,
  guildId: string,
): ValidatedGuildProfile {
  const projected = validateGuildProfileProjection(value, guildId)
  return {
    id: guildId,
    ownerId: projected.ownerId,
    profile: {
      description: projected.description,
      mediaPresence: { ...projected.mediaPresence },
      name: projected.name,
    },
  }
}

function exactBotMember(
  value: DiscordGuildMember,
  guildId: string,
  botId: string,
): ValidatedBotMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw evidenceError("Discord returned incomplete or mismatched guild profile bot evidence")
  }
  return { roles: [...value.roles].sort(compareSnowflakes) }
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded guild profile role inventory")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate guild profile role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid guild profile role permissions", {
        cause: error,
      })
    }
    ids.add(role.id)
    return {
      id: role.id,
      managed: role.managed,
      permissions: permissions.toString(),
      position: role.position,
    }
  })
  const everyone = roles.find((role) => role.id === guildId)
  if (!everyone || everyone.managed || everyone.position !== 0) {
    throw evidenceError("Discord returned invalid guild profile @everyone role evidence")
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function completePermissions(
  member: ValidatedBotMember,
  guildId: string,
  roles: readonly ValidatedRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError("Discord returned invalid guild profile permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete guild profile permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): GuildProfileAccessEvidence {
  const manageGuild = hasGuildPermission(permissions, "MANAGE_GUILD")
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    authorizedForChange: botIsGuildOwner || manageGuild,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    manageGuild,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
    warnings: permissions.warnings,
  }
}

function privacyProjection(): GuildProfilePrivacyProjection {
  return {
    mediaHashes: "presence-only",
    persistence: "content-free-records-only",
    profileText: "transient-untrusted",
    rawPayloads: "omitted",
    roleNames: "omitted",
  }
}

function verificationBoundary(): GuildProfileVerificationBoundary {
  return {
    automaticRetry: false,
    freshApiReadback: true,
    mutationResponse: true,
    rollback: "not-automatic",
  }
}

function desiredProfile(
  current: GuildProfileView,
  desired: NormalizedGuildProfileChangeRequest,
): GuildProfileView {
  return {
    description: Object.hasOwn(desired, "description")
      ? desired.description as string | null
      : current.description,
    mediaPresence: { ...current.mediaPresence },
    name: Object.hasOwn(desired, "name")
      ? desired.name as string
      : current.name,
  }
}

function fieldMatches(
  left: GuildProfileView,
  right: GuildProfileView,
  field: GuildProfileField,
): boolean {
  return left[field] === right[field]
}

function changedFields(
  current: GuildProfileView,
  desired: GuildProfileView,
  requested: readonly GuildProfileField[],
): GuildProfileField[] {
  return requested.filter((field) => !fieldMatches(current, desired, field)).sort()
}

function planRisks(
  desired: GuildProfileView,
  fields: readonly GuildProfileField[],
): string[] {
  const risks: string[] = []
  if (fields.includes("name")) {
    risks.push("The guild's member-facing and potentially public display name will change")
  }
  if (fields.includes("description")) {
    risks.push(desired.description === null
      ? "The guild's member-facing and potentially public description will be cleared"
      : "The guild's member-facing and potentially public description will change")
  }
  return risks.sort()
}

function planWarnings(changed: readonly GuildProfileField[]): string[] {
  if (changed.length === 0) {
    return ["The requested guild profile fields already match Discord"]
  }
  return ["Guild profile text is untrusted external content and is not persisted locally"]
}

function transportInput(
  desired: GuildProfileView,
  fields: readonly GuildProfileField[],
): ModifyGuildProfileInput {
  const selected = new Set(fields)
  return {
    ...(selected.has("description") ? { description: desired.description } : {}),
    ...(selected.has("name") ? { name: desired.name } : {}),
  }
}

function driftFields(
  response: GuildProfileView,
  readback: GuildProfileView,
  desired: GuildProfileView,
  fields: readonly GuildProfileField[],
): GuildProfileField[] {
  return fields.filter((field) => (
    !fieldMatches(response, desired, field)
    || !fieldMatches(readback, desired, field)
  )).sort()
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: GuildProfileChangePlan
  request: NormalizedGuildProfileChangeRequest
  status: GuildProfileActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): GuildProfileActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-profile-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    requestedFields: [...options.request.requestedFields],
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: GuildProfileChangePlan
  request: NormalizedGuildProfileChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-profile-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.guildId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function executionBlocksGuild(error: unknown): boolean {
  if (
    !(error instanceof GuildProfileExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withGuildLock<T>(
  state: GuildProfileLockState,
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => GuildProfileExecutionError,
): Promise<T> {
  const prior = state.tails.get(guildId) ?? Promise.resolve("settled" as const)
  let release: (outcome: GuildProfileTargetOutcome) => void = () => undefined
  const tail = new Promise<GuildProfileTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(guildId, tail)
  let outcome: GuildProfileTargetOutcome = "settled"
  try {
    if (state.uncertainGuilds.has(guildId) || await prior === "uncertain") {
      outcome = "uncertain"
      state.uncertainGuilds.add(guildId)
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksGuild(error)) {
      outcome = "uncertain"
      state.uncertainGuilds.add(guildId)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(guildId) === tail) state.tails.delete(guildId)
  }
}

export class GuildProfileService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildProfileServiceClient
  readonly #clock: () => Date
  readonly #locks: GuildProfileLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: GuildProfileServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: GuildProfileServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = guildProfileLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    applicationId: string,
    botId: string,
    guildId: string,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
    allowCompletedReceipt = false,
  ): Promise<GuildProfileState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord guild profile guild ID")
    if (mode === "change") this.#policy.assertGuildProfileChangeable(guildId)
    else this.#policy.assertGuildProfileAuditable(guildId)
    let priorReceipt: OperationReceipt | null = null
    if (operationKeyHashValue) {
      priorReceipt = await this.#operationStore.get(
        "guild-profile-change",
        operationKeyHashValue,
      ) ?? null
      if (
        priorReceipt
        && !(
          allowCompletedReceipt
          && priorReceipt.status === "completed"
          && priorReceipt.verification === "match"
          && priorReceipt.guildId === guildId
          && priorReceipt.resourceId === guildId
        )
      ) {
        throw new GuildProfileOperationConflictError(receiptView(priorReceipt))
      }
    }
    const [rawGuild, rawMember, rawRoles] = await Promise.all([
      this.#client.getGuildProfile(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuildProfile(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guild.ownerId === botId)
    if (mode === "change" && !access.authorizedForChange) {
      throw evidenceError(
        "Discord connector bot requires guild ownership or complete MANAGE_GUILD authority for guild profile changes",
      )
    }
    return { access, botMember, guild, priorReceipt, roles }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildProfileAuditResult> {
    assertGuildProfileGetInput(guildId)
    const state = await this.#state(applicationId, botId, guildId, "audit", options)
    return {
      access: state.access,
      applicationId,
      botId,
      guildId,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy: privacyProjection(),
      profile: state.guild.profile,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      verificationBoundary: verificationBoundary(),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desiredRequest: NormalizedGuildProfileChangeRequest,
    options: RequestOptions,
    allowCompletedReceipt = false,
  ): Promise<BuiltGuildProfilePlan> {
    const state = await this.#state(
      applicationId,
      botId,
      desiredRequest.guildId,
      "change",
      options,
      desiredRequest.operationKeyHash,
      allowCompletedReceipt,
    )
    const desiredView = desiredProfile(state.guild.profile, desiredRequest)
    const changed = changedFields(
      state.guild.profile,
      desiredView,
      desiredRequest.requestedFields,
    )
    const privacy = privacyProjection()
    const boundary = verificationBoundary()
    const risks = planRisks(desiredView, changed)
    const warnings = planWarnings(changed)
    const evidence = {
      access: state.access,
      botMemberRoleIds: [...state.botMember.roles],
      current: state.guild.profile,
      desired: desiredView,
      guild: {
        id: state.guild.id,
        ownerId: state.guild.ownerId,
      },
      roles: state.roles.map((role) => ({
        id: role.id,
        managed: role.managed,
        permissions: role.permissions,
        position: role.position,
      })),
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      changedFields: changed,
      desiredRequest,
      domain: "discord-mcp-guild-profile-change-plan.v1",
      evidence,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy,
      risks,
      verificationBoundary: boundary,
      warnings,
    })
    const plan: GuildProfileChangePlan = {
      access: state.access,
      applicationId,
      auditReason: desiredRequest.auditReason,
      botId,
      changedFields: changed,
      createdAt: this.#clock().toISOString(),
      current: state.guild.profile,
      desired: desiredView,
      digest,
      guildId: desiredRequest.guildId,
      localConstraints: LOCAL_CONSTRAINTS,
      operationKeyHash: desiredRequest.operationKeyHash,
      privacy,
      requestedFields: [...desiredRequest.requestedFields],
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: changed.length === 0 ? "already-current" : "planned",
      verificationBoundary: boundary,
      warnings,
      writeRequired: changed.length > 0,
    }
    if (state.priorReceipt && plan.writeRequired) {
      throw new GuildProfileOperationConflictError(
        receiptView(state.priorReceipt),
      )
    }
    return { desiredRequest, desiredView, plan, state }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildProfileChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildProfileChangePlan> {
    const desired = normalizeGuildProfileChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  async reconcilePlan(
    applicationId: string,
    botId: string,
    request: GuildProfileChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildProfileChangePlan> {
    const desired = normalizeGuildProfileChangeRequest(request)
    return (
      await this.#buildPlan(applicationId, botId, desired, options, true)
    ).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildProfileChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildProfileChangeResult> {
    const desired = normalizeGuildProfileChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild profile plan digest is invalid")
    }
    return withGuildLock(
      this.#locks,
      desired.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        desired,
        expectedDigest,
        options,
      ),
      () => new GuildProfileExecutionError(
        "Discord guild profile change was blocked because a prior same-guild operation ended without a durable outcome",
        {
          guildId: desired.guildId,
          operationKeyHash: desired.operationKeyHash,
          planDigest: expectedDigest,
          requestedFields: desired.requestedFields,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    desired: NormalizedGuildProfileChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildProfileChangeResult> {
    let built: BuiltGuildProfilePlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof GuildProfileEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildProfilePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildProfilePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: desired.guildId,
      operationKeyHash: desired.operationKeyHash,
      planDigest: plan.digest,
      requestedFields: [...desired.requestedFields],
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        driftFields: [],
        status: "already-current",
        verification: "not-required",
        warnings: plan.warnings,
      }
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request: desired,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new GuildProfileOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: desired,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          plan,
          request: desired,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new GuildProfileExecutionError(
        "Discord guild profile change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
      )
    }

    let mutationStarted = false
    let mutationReturned = false
    let responseProfile: GuildProfileView | null = null
    let readbackProfile: GuildProfileView | null = null
    try {
      mutationStarted = true
      responseProfile = exactGuildProfile(
        await this.#client.modifyGuildProfile(
          desired.guildId,
          transportInput(built.desiredView, plan.changedFields),
          desired.auditReason,
          options,
        ),
        desired.guildId,
      ).profile
      mutationReturned = true
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "audit",
        options,
      )
      readbackProfile = readback.guild.profile
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      const status = mutationStarted && !definiteMutationRefusal
        ? "uncertain"
        : "failed"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request: desired,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: errorCode,
          plan,
          request: desired,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildProfileExecutionError(
        "Discord guild profile change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          responseReturned: mutationReturned,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const observedDrift = driftFields(
      responseProfile,
      readbackProfile,
      built.desiredView,
      plan.changedFields,
    )
    const verification = observedDrift.length === 0 ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const warnings = verification === "match"
      ? plan.warnings
      : [
          ...plan.warnings,
          "Discord returned or read back a different value for at least one requested field",
        ]
    const result: GuildProfileChangeResult = {
      ...baseResult,
      activityId,
      driftFields: observedDrift,
      status,
      verification,
      warnings,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request: desired,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          plan,
          request: desired,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildProfileExecutionError(
        "Discord guild profile change completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: desired,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new GuildProfileExecutionError(
        "Discord guild profile change completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
      )
    }
    return result
  }
}
