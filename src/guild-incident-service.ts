import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildIncidentActivity,
  GuildIncidentActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_INCIDENT_ACTION_FIELDS,
  SCHEMA_VERSION,
  type GuildIncidentActionField,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildIncidentEvidenceError,
  GuildIncidentExecutionError,
  GuildIncidentOperationConflictError,
  GuildIncidentPlanChangedError,
} from "./errors.js"
import {
  canonicalGuildIncidentTimestamp,
  type DiscordGuildIncidentActions,
  type DiscordGuildIncidentState,
  type ModifyGuildIncidentActionsInput,
} from "./guild-incident.js"
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

const STATE_UNAVAILABLE = "guild-incident-action-state-unavailable"
const INCIDENT_ACTION_MAX_DURATION_MS = 24 * 60 * 60 * 1_000
const REQUEST_KEYS = [
  "auditReason",
  "directMessagesDisabledUntil",
  "guildId",
  "invitesDisabledUntil",
  "operationKey",
] as const
const LOCAL_CONSTRAINTS = Object.freeze({
  auditReasonDisposition: "local-review-only" as const,
  guildAllowlist: CONNECTOR_LIMITS.guildIncidentGuildAllowlist,
  maximumDisableDurationMs: INCIDENT_ACTION_MAX_DURATION_MS,
  supportedFields: [...GUILD_INCIDENT_ACTION_FIELDS],
})

type GuildIncidentTargetOutcome = "settled" | "uncertain"

interface GuildIncidentLockState {
  tails: Map<string, Promise<GuildIncidentTargetOutcome>>
  uncertainGuilds: Set<string>
}

const GUILD_INCIDENT_LOCKS = new WeakMap<OperationStore, GuildIncidentLockState>()

function guildIncidentLocks(operationStore: OperationStore): GuildIncidentLockState {
  let state = GUILD_INCIDENT_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainGuilds: new Set() }
    GUILD_INCIDENT_LOCKS.set(operationStore, state)
  }
  return state
}

export interface GuildIncidentActionChangeRequest {
  auditReason: string
  directMessagesDisabledUntil?: string | null
  guildId: string
  invitesDisabledUntil?: string | null
  operationKey: string
}

export interface NormalizedGuildIncidentActionChangeRequest {
  auditReason: string
  directMessagesDisabledUntil?: string | null
  guildId: string
  invitesDisabledUntil?: string | null
  operationKeyHash: string
  requestedFields: GuildIncidentActionField[]
}

export interface GuildIncidentAccessEvidence {
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

export interface GuildIncidentActionView {
  directMessagesDisabledUntil: string | null
  dmSpamDetected: boolean
  invitesDisabledUntil: string | null
  raidDetected: boolean
  sourceAvailable: boolean
  unknownFieldCount: number
}

export interface GuildIncidentPrivacyProjection {
  auditReason: "digest-bound-not-persisted"
  detectionTimestamps: "boolean-presence-only"
  guildPresentation: "omitted"
  incidentActionValues: "transient-untrusted"
  persistence: "content-free-records-only"
  rawPayloads: "omitted"
  roleNames: "omitted"
}

export interface GuildIncidentVerificationBoundary {
  auditLogReasonHeader: false
  automaticRetry: false
  freshApiReadback: true
  mutationResponse: true
  rollback: "not-automatic"
}

export type GuildIncidentActionEffect =
  | "clear"
  | "disable"
  | "extend"
  | "shorten"

export interface GuildIncidentFieldEffect {
  effect: GuildIncidentActionEffect
  field: GuildIncidentActionField
}

export interface GuildIncidentAuditResult {
  access: GuildIncidentAccessEvidence
  actions: GuildIncidentActionView
  applicationId: string
  botId: string
  guildId: string
  localConstraints: typeof LOCAL_CONSTRAINTS
  privacy: GuildIncidentPrivacyProjection
  schemaVersion: number
  status: "ok"
  verificationBoundary: GuildIncidentVerificationBoundary
}

export interface GuildIncidentActionChangePlan {
  access: GuildIncidentAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  changedFields: GuildIncidentActionField[]
  createdAt: string
  current: GuildIncidentActionView
  desired: GuildIncidentActionView
  digest: string
  effects: GuildIncidentFieldEffect[]
  guildId: string
  localConstraints: typeof LOCAL_CONSTRAINTS
  operationKeyHash: string
  privacy: GuildIncidentPrivacyProjection
  requestedFields: GuildIncidentActionField[]
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: GuildIncidentVerificationBoundary
  warnings: string[]
  writeRequired: boolean
}

export interface GuildIncidentActionChangeResult {
  activityId: string | null
  driftFields: GuildIncidentActionField[]
  guildId: string
  operationKeyHash: string
  planDigest: string
  requestedFields: GuildIncidentActionField[]
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
  warnings: string[]
}

export interface GuildIncidentServiceClient extends Pick<
  DiscordClient,
  | "getGuildIncidentActions"
  | "getGuildMember"
  | "getGuildRoles"
  | "modifyGuildIncidentActions"
> {}

export interface GuildIncidentServiceOptions {
  activityStore: ActivityStore
  client: GuildIncidentServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertGuildIncidentAuditable"
    | "assertGuildIncidentChangeable"
  >
  randomId?: () => string
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

interface GuildIncidentState {
  access: GuildIncidentAccessEvidence
  actions: GuildIncidentActionView
  botMember: ValidatedBotMember
  guild: {
    id: string
    ownerId: string
  }
  roles: ValidatedRole[]
}

interface BuiltGuildIncidentPlan {
  desiredRequest: NormalizedGuildIncidentActionChangeRequest
  desiredView: GuildIncidentActionView
  plan: GuildIncidentActionChangePlan
  state: GuildIncidentState
}

function evidenceError(
  message: string,
  options?: ErrorOptions,
): GuildIncidentEvidenceError {
  return new GuildIncidentEvidenceError(message, options)
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

function requestedFields(record: Record<string, unknown>): GuildIncidentActionField[] {
  const fields: GuildIncidentActionField[] = []
  if (Object.hasOwn(record, "directMessagesDisabledUntil")) fields.push("directMessages")
  if (Object.hasOwn(record, "invitesDisabledUntil")) fields.push("invites")
  return fields.sort()
}

export function assertGuildIncidentGetInput(guildId: string): void {
  assertPositiveSnowflake(guildId, "Discord guild incident-action guild ID")
}

export function normalizeGuildIncidentActionChangeRequest(
  request: GuildIncidentActionChangeRequest,
): NormalizedGuildIncidentActionChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild incident-action change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord guild incident-action change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord guild incident-action guild ID")
  const fields = requestedFields(record)
  if (fields.length < 1) {
    throw new RangeError("Discord guild incident-action change must select at least one field")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    ...(Object.hasOwn(record, "directMessagesDisabledUntil")
      ? {
          directMessagesDisabledUntil: request.directMessagesDisabledUntil === null
            ? null
            : canonicalGuildIncidentTimestamp(
                request.directMessagesDisabledUntil,
                "Discord direct-message disable-until value",
              ),
        }
      : {}),
    guildId: request.guildId,
    ...(Object.hasOwn(record, "invitesDisabledUntil")
      ? {
          invitesDisabledUntil: request.invitesDisabledUntil === null
            ? null
            : canonicalGuildIncidentTimestamp(
                request.invitesDisabledUntil,
                "Discord invite disable-until value",
              ),
        }
      : {}),
    operationKeyHash: operationKeyHash(request.operationKey),
    requestedFields: fields,
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
    throw evidenceError("Discord returned incomplete or mismatched guild incident-action bot evidence")
  }
  return { roles: [...value.roles].sort(compareSnowflakes) }
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded guild incident-action role inventory")
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
      throw evidenceError("Discord returned invalid or duplicate guild incident-action role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid guild incident-action role permissions", {
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
    throw evidenceError("Discord returned invalid guild incident-action @everyone role evidence")
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
    throw evidenceError("Discord returned invalid guild incident-action permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete guild incident-action permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): GuildIncidentAccessEvidence {
  const manageGuild = hasGuildPermission(permissions, "MANAGE_GUILD")
  const unknownPermissionBitsValue = unknownDiscordPermissionBits(
    BigInt(permissions.effectivePermissions),
  ).toString()
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    authorizedForChange: (botIsGuildOwner || manageGuild)
      && unknownPermissionBitsValue === "0",
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    manageGuild,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: unknownPermissionBitsValue,
    warnings: [
      ...permissions.warnings,
      ...(unknownPermissionBitsValue !== "0"
        ? ["Unknown Discord permission bits block incident-action changes"]
        : []),
    ],
  }
}

function exactActionView(value: DiscordGuildIncidentActions): GuildIncidentActionView {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !(value.directMessagesDisabledUntil === null
      || typeof value.directMessagesDisabledUntil === "string")
    || typeof value.dmSpamDetected !== "boolean"
    || !(value.invitesDisabledUntil === null
      || typeof value.invitesDisabledUntil === "string")
    || typeof value.raidDetected !== "boolean"
    || typeof value.sourceAvailable !== "boolean"
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) {
    throw evidenceError("Discord returned malformed projected guild incident-action evidence")
  }
  let directMessagesDisabledUntil: string | null
  let invitesDisabledUntil: string | null
  try {
    directMessagesDisabledUntil = value.directMessagesDisabledUntil === null
      ? null
      : canonicalGuildIncidentTimestamp(
          value.directMessagesDisabledUntil,
          "Discord projected direct-message disable-until value",
        )
    invitesDisabledUntil = value.invitesDisabledUntil === null
      ? null
      : canonicalGuildIncidentTimestamp(
          value.invitesDisabledUntil,
          "Discord projected invite disable-until value",
        )
  } catch (error) {
    throw evidenceError("Discord returned malformed projected guild incident-action deadlines", {
      cause: error,
    })
  }
  if (!value.sourceAvailable && (
    directMessagesDisabledUntil !== null
    || invitesDisabledUntil !== null
    || value.dmSpamDetected
    || value.raidDetected
    || value.unknownFieldCount !== 0
  )) {
    throw evidenceError("Discord returned contradictory unavailable guild incident-action evidence")
  }
  return {
    directMessagesDisabledUntil,
    dmSpamDetected: value.dmSpamDetected,
    invitesDisabledUntil,
    raidDetected: value.raidDetected,
    sourceAvailable: value.sourceAvailable,
    unknownFieldCount: value.unknownFieldCount,
  }
}

function privacyProjection(): GuildIncidentPrivacyProjection {
  return {
    auditReason: "digest-bound-not-persisted",
    detectionTimestamps: "boolean-presence-only",
    guildPresentation: "omitted",
    incidentActionValues: "transient-untrusted",
    persistence: "content-free-records-only",
    rawPayloads: "omitted",
    roleNames: "omitted",
  }
}

function verificationBoundary(): GuildIncidentVerificationBoundary {
  return {
    auditLogReasonHeader: false,
    automaticRetry: false,
    freshApiReadback: true,
    mutationResponse: true,
    rollback: "not-automatic",
  }
}

function assertChangeEvidence(state: GuildIncidentState): void {
  if (!state.actions.sourceAvailable) {
    throw evidenceError("Discord did not return incident-action state for this guild")
  }
  if (state.actions.unknownFieldCount !== 0) {
    throw evidenceError("Discord returned unknown guild incident-action fields")
  }
  if (!state.access.authorizedForChange) {
    throw evidenceError(
      "Discord connector bot requires guild ownership, or complete known MANAGE_GUILD authority, for incident-action changes",
    )
  }
}

function assertRequestedTimeWindow(
  desired: NormalizedGuildIncidentActionChangeRequest,
  now: Date,
): void {
  const earliest = now.getTime()
  const latest = earliest + INCIDENT_ACTION_MAX_DURATION_MS
  for (const field of [
    "directMessagesDisabledUntil",
    "invitesDisabledUntil",
  ] as const) {
    if (!Object.hasOwn(desired, field) || desired[field] === null) continue
    const timestamp = Date.parse(desired[field] as string)
    if (timestamp <= earliest || timestamp > latest) {
      throw new RangeError(
        `Discord guild incident-action ${field} must be in the future and no more than 24 hours ahead`,
      )
    }
  }
}

function desiredActions(
  current: GuildIncidentActionView,
  desired: NormalizedGuildIncidentActionChangeRequest,
): GuildIncidentActionView {
  return {
    ...current,
    directMessagesDisabledUntil: Object.hasOwn(desired, "directMessagesDisabledUntil")
      ? desired.directMessagesDisabledUntil as string | null
      : current.directMessagesDisabledUntil,
    invitesDisabledUntil: Object.hasOwn(desired, "invitesDisabledUntil")
      ? desired.invitesDisabledUntil as string | null
      : current.invitesDisabledUntil,
  }
}

function fieldValue(
  view: GuildIncidentActionView,
  field: GuildIncidentActionField,
): string | null {
  return field === "directMessages"
    ? view.directMessagesDisabledUntil
    : view.invitesDisabledUntil
}

function changedFields(
  current: GuildIncidentActionView,
  desired: GuildIncidentActionView,
  requested: readonly GuildIncidentActionField[],
): GuildIncidentActionField[] {
  return requested.filter((field) => fieldValue(current, field) !== fieldValue(desired, field))
    .sort()
}

function fieldEffects(
  current: GuildIncidentActionView,
  desired: GuildIncidentActionView,
  changed: readonly GuildIncidentActionField[],
): GuildIncidentFieldEffect[] {
  return changed.map((field) => {
    const before = fieldValue(current, field)
    const after = fieldValue(desired, field)
    let effect: GuildIncidentActionEffect
    if (after === null) effect = "clear"
    else if (before === null) effect = "disable"
    else effect = Date.parse(after) > Date.parse(before) ? "extend" : "shorten"
    return { effect, field }
  })
}

function planRisks(effects: readonly GuildIncidentFieldEffect[]): string[] {
  const risks: string[] = []
  for (const item of effects) {
    const subject = item.field === "invites" ? "guild invites" : "member direct messages"
    if (item.effect === "clear") {
      risks.push(`This change re-enables ${subject} before Discord's existing deadline`)
    } else if (item.effect === "shorten") {
      risks.push(`This change shortens the period during which ${subject} are disabled`)
    } else {
      risks.push(`This change disables ${subject} and can disrupt legitimate activity`)
    }
  }
  return risks.sort()
}

function planWarnings(
  state: GuildIncidentState,
  changed: readonly GuildIncidentActionField[],
): string[] {
  return [
    ...state.access.warnings,
    "The review reason is digest-bound locally because Discord does not document an audit-log reason header for this endpoint",
    ...(state.access.botAdministrator
      ? ["The bot's Administrator permission bypasses ordinary guild permission checks"]
      : []),
    ...(changed.length === 0
      ? ["The requested guild incident-action fields already match Discord"]
      : []),
  ].filter((value, index, values) => values.indexOf(value) === index).sort()
}

function transportInput(
  desired: GuildIncidentActionView,
  fields: readonly GuildIncidentActionField[],
): ModifyGuildIncidentActionsInput {
  const selected = new Set(fields)
  return {
    ...(selected.has("directMessages")
      ? { directMessagesDisabledUntil: desired.directMessagesDisabledUntil }
      : {}),
    ...(selected.has("invites")
      ? { invitesDisabledUntil: desired.invitesDisabledUntil }
      : {}),
  }
}

function exactMutationActions(value: DiscordGuildIncidentActions): GuildIncidentActionView {
  const view = exactActionView(value)
  if (!view.sourceAvailable || view.unknownFieldCount !== 0) {
    throw evidenceError("Discord returned non-exact guild incident-action mutation evidence")
  }
  return view
}

function driftFields(
  response: GuildIncidentActionView,
  readback: GuildIncidentActionView,
  desired: GuildIncidentActionView,
  fields: readonly GuildIncidentActionField[],
): GuildIncidentActionField[] {
  return fields.filter((field) => (
    fieldValue(response, field) !== fieldValue(desired, field)
    || fieldValue(readback, field) !== fieldValue(desired, field)
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
  plan: GuildIncidentActionChangePlan
  request: NormalizedGuildIncidentActionChangeRequest
  status: GuildIncidentActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): GuildIncidentActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-incident-action-change",
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
  plan: GuildIncidentActionChangePlan
  request: NormalizedGuildIncidentActionChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-incident-action-change",
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
    !(error instanceof GuildIncidentExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withGuildLock<T>(
  state: GuildIncidentLockState,
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => GuildIncidentExecutionError,
): Promise<T> {
  const prior = state.tails.get(guildId) ?? Promise.resolve("settled" as const)
  let release: (outcome: GuildIncidentTargetOutcome) => void = () => undefined
  const tail = new Promise<GuildIncidentTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(guildId, tail)
  let outcome: GuildIncidentTargetOutcome = "settled"
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

export class GuildIncidentService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildIncidentServiceClient
  readonly #clock: () => Date
  readonly #locks: GuildIncidentLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: GuildIncidentServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: GuildIncidentServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = guildIncidentLocks(options.operationStore)
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
  ): Promise<GuildIncidentState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord guild incident-action guild ID")
    if (mode === "change") this.#policy.assertGuildIncidentChangeable(guildId)
    else this.#policy.assertGuildIncidentAuditable(guildId)
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "guild-incident-action-change",
        operationKeyHashValue,
      )
      if (receipt) throw new GuildIncidentOperationConflictError(receiptView(receipt))
    }
    const [rawGuild, rawMember, rawRoles] = await Promise.all([
      this.#client.getGuildIncidentActions(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guildState = rawGuild as DiscordGuildIncidentState
    if (guildState.guildId !== guildId || !positiveSnowflake(guildState.ownerId)) {
      throw evidenceError("Discord returned mismatched guild incident-action identity evidence")
    }
    const botMember = exactBotMember(rawMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guildState.ownerId === botId)
    const state: GuildIncidentState = {
      access,
      actions: exactActionView(guildState),
      botMember,
      guild: { id: guildId, ownerId: guildState.ownerId },
      roles,
    }
    if (mode === "change") assertChangeEvidence(state)
    return state
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildIncidentAuditResult> {
    assertGuildIncidentGetInput(guildId)
    const state = await this.#state(applicationId, botId, guildId, "audit", options)
    return {
      access: state.access,
      actions: state.actions,
      applicationId,
      botId,
      guildId,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      verificationBoundary: verificationBoundary(),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desiredRequest: NormalizedGuildIncidentActionChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltGuildIncidentPlan> {
    const now = this.#clock()
    assertRequestedTimeWindow(desiredRequest, now)
    const state = await this.#state(
      applicationId,
      botId,
      desiredRequest.guildId,
      "change",
      options,
      desiredRequest.operationKeyHash,
    )
    const desiredView = desiredActions(state.actions, desiredRequest)
    const changed = changedFields(
      state.actions,
      desiredView,
      desiredRequest.requestedFields,
    )
    const effects = fieldEffects(state.actions, desiredView, changed)
    const privacy = privacyProjection()
    const boundary = verificationBoundary()
    const risks = planRisks(effects)
    const warnings = planWarnings(state, changed)
    const evidence = {
      access: state.access,
      botMemberRoleIds: [...state.botMember.roles],
      current: state.actions,
      desired: desiredView,
      guild: state.guild,
      roles: state.roles.map((role) => ({ ...role })),
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      changedFields: changed,
      desiredRequest,
      domain: "discord-mcp-guild-incident-action-change-plan.v1",
      effects,
      evidence,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy,
      risks,
      verificationBoundary: boundary,
      warnings,
    })
    const plan: GuildIncidentActionChangePlan = {
      access: state.access,
      applicationId,
      auditReason: desiredRequest.auditReason,
      botId,
      changedFields: changed,
      createdAt: now.toISOString(),
      current: state.actions,
      desired: desiredView,
      digest,
      effects,
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
    return { desiredRequest, desiredView, plan, state }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildIncidentActionChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildIncidentActionChangePlan> {
    const desired = normalizeGuildIncidentActionChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildIncidentActionChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildIncidentActionChangeResult> {
    const desired = normalizeGuildIncidentActionChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild incident-action plan digest is invalid")
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
      () => new GuildIncidentExecutionError(
        "Discord guild incident-action change was blocked because a prior same-guild operation ended without a durable outcome",
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
    desired: NormalizedGuildIncidentActionChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildIncidentActionChangeResult> {
    let built: BuiltGuildIncidentPlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof GuildIncidentEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildIncidentPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildIncidentPlanChangedError(expectedDigest, plan.digest)
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
      throw new GuildIncidentOperationConflictError(receiptView(reservation.receipt))
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
      throw new GuildIncidentExecutionError(
        "Discord guild incident-action change was blocked because pending activity could not be recorded",
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
    let responseActions: GuildIncidentActionView | null = null
    let readbackActions: GuildIncidentActionView | null = null
    try {
      mutationStarted = true
      responseActions = exactMutationActions(
        await this.#client.modifyGuildIncidentActions(
          desired.guildId,
          transportInput(built.desiredView, plan.changedFields),
          options,
        ),
      )
      mutationReturned = true
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "change",
        options,
      )
      readbackActions = readback.actions
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
      throw new GuildIncidentExecutionError(
        "Discord guild incident-action change did not complete with a verified successful outcome",
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
      responseActions,
      readbackActions,
      built.desiredView,
      GUILD_INCIDENT_ACTION_FIELDS,
    )
    const verification = observedDrift.length === 0 ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const warnings = verification === "match"
      ? plan.warnings
      : [
          ...plan.warnings,
          "Discord returned or read back a different incident-action deadline for at least one controlled field",
        ]
    const result: GuildIncidentActionChangeResult = {
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
      throw new GuildIncidentExecutionError(
        "Discord guild incident-action change completed but the operation receipt failed",
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
      throw new GuildIncidentExecutionError(
        "Discord guild incident-action change completed but the final activity record failed",
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
