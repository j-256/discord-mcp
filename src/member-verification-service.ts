import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MemberVerificationActivity,
  MemberVerificationActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_GUILD_MEMBER_FLAGS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_DIRECTORY_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildMemberVerificationUpdate,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  MemberVerificationEvidenceError,
  MemberVerificationExecutionError,
  MemberVerificationOperationConflictError,
  MemberVerificationPlanChangedError,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
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
import { normalizeDiscordRoleInventory } from "./role-administration-service.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "member-verification-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\p{Cc}\p{Cs}]/u
const MEMBER_VERIFICATION_REQUEST_KEYS = [
  "auditReason",
  "bypassesVerification",
  "guildId",
  "operationKey",
  "userId",
] as const
const COMBINED_MODERATION_PERMISSIONS = Object.freeze([
  "MODERATE_MEMBERS",
  "KICK_MEMBERS",
  "BAN_MEMBERS",
] as const satisfies readonly DiscordPermissionName[])
const BYPASSES_VERIFICATION_FLAG = BigInt(
  DISCORD_GUILD_MEMBER_FLAGS.bypassesVerification,
)

export interface MemberVerificationChangeRequest {
  auditReason: string
  bypassesVerification: boolean
  guildId: string
  operationKey: string
  userId: string
}

export interface NormalizedMemberVerificationChangeRequest {
  auditReason: string
  bypassesVerification: boolean
  guildId: string
  operationKey: string
  operationKeyHash: string
  userId: string
}

export type MemberVerificationAuthorizationPath =
  | "combined-moderation"
  | "guild-owner"
  | "manage-guild"
  | "manage-roles"

export interface MemberVerificationPermissionEvidence {
  administrator: boolean
  authorizationPath: MemberVerificationAuthorizationPath
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  requiredPermissions: DiscordPermissionName[]
  requiredPermissionsPresent: true
  unknownPermissionBits: string
}

export interface MemberVerificationHierarchyEvidence {
  botHighestRoleIds: string[]
  botHighestRolePosition: number
  targetAdministrator: false
  targetBelowBot: true
  targetHighestRoleIds: string[]
  targetHighestRolePosition: number
}

export interface MemberVerificationPrivacyProjection {
  persistence: "content-free-outcomes-only"
  rawFlagsExposed: false
  transientUntrustedFields: readonly ["guildName", "username"]
}

export interface MemberVerificationChangePlan {
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  desiredBypassesVerification: boolean
  digest: string
  guild: {
    id: string
    name: string
    ownerId: string
  }
  hierarchy: MemberVerificationHierarchyEvidence
  operationKeyHash: string
  permission: MemberVerificationPermissionEvidence
  privacy: MemberVerificationPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  target: {
    currentBypassesVerification: boolean
    id: string
    pending: boolean
    username: string
  }
  warnings: string[]
  writeRequired: boolean
}

export interface MemberVerificationChangeResult {
  activityId: string | null
  desiredBypassesVerification: boolean
  guildId: string
  observedBypassesVerification: boolean
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  userId: string
  verification: "drift" | "match" | "not-required"
}

export interface MemberVerificationServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "modifyGuildMemberVerificationBypass"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

type ExactMember = DiscordGuildMember & {
  flags: number
  user: NonNullable<DiscordGuildMember["user"]>
}

interface MemberVerificationState {
  botMember: ExactMember
  botPermissions: GuildMemberPermissionResult
  guild: DiscordGuild & { name: string; owner_id: string }
  hierarchy: MemberVerificationHierarchyEvidence
  permission: MemberVerificationPermissionEvidence
  roles: DiscordRole[]
  targetMember: ExactMember
  targetPermissions: GuildMemberPermissionResult
}

type MemberVerificationTargetOutcome = "settled" | "uncertain"

interface MemberVerificationLockState {
  tails: Map<string, Promise<MemberVerificationTargetOutcome>>
  uncertainTargets: Set<string>
}

const MEMBER_VERIFICATION_LOCKS = new WeakMap<OperationStore, MemberVerificationLockState>()

function memberVerificationLocks(
  operationStore: OperationStore,
): MemberVerificationLockState {
  let state = MEMBER_VERIFICATION_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainTargets: new Set() }
    MEMBER_VERIFICATION_LOCKS.set(operationStore, state)
  }
  return state
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  if (leftId === rightId) return 0
  return leftId < rightId ? -1 : 1
}

function validFlags(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function bypassesVerification(flags: number): boolean {
  return (BigInt(flags) & BYPASSES_VERIFICATION_FLAG) !== 0n
}

function desiredFlags(currentFlags: number, desired: boolean): number {
  const preserved = BigInt(currentFlags) & ~BYPASSES_VERIFICATION_FLAG
  return Number(preserved | (desired ? BYPASSES_VERIFICATION_FLAG : 0n))
}

function preservedFlags(flags: number): bigint {
  return BigInt(flags) & ~BYPASSES_VERIFICATION_FLAG
}

export function normalizeMemberVerificationChangeRequest(
  value: MemberVerificationChangeRequest,
): NormalizedMemberVerificationChangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord member verification change request must be an object")
  }
  const record = value as unknown as Record<string, unknown>
  if (!exactKeys(record, MEMBER_VERIFICATION_REQUEST_KEYS)) {
    throw new RangeError("Discord member verification change request has unsupported fields")
  }
  if (!validSnowflake(value.guildId)) {
    throw new RangeError("Discord member verification change requires an exact guild snowflake")
  }
  if (!validSnowflake(value.userId)) {
    throw new RangeError("Discord member verification change requires an exact user snowflake")
  }
  if (typeof value.bypassesVerification !== "boolean") {
    throw new RangeError("Discord member verification change requires an exact boolean state")
  }
  if (typeof value.auditReason !== "string") {
    throw new RangeError("Discord member verification audit reason must be a string")
  }
  encodeDiscordAuditReason(value.auditReason)
  return {
    auditReason: value.auditReason,
    bypassesVerification: value.bypassesVerification,
    guildId: value.guildId,
    operationKey: value.operationKey,
    operationKeyHash: operationKeyHash(value.operationKey),
    userId: value.userId,
  }
}

function evidenceError(
  message: string,
  cause?: unknown,
): MemberVerificationEvidenceError {
  return new MemberVerificationEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function exactGuild(
  value: DiscordGuild,
  guildId: string,
): DiscordGuild & { name: string; owner_id: string } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validSnowflake(value.owner_id)
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
  ) {
    throw evidenceError("Discord returned invalid member verification guild evidence")
  }
  return value as DiscordGuild & { name: string; owner_id: string }
}

function exactMember(
  value: DiscordGuildMember,
  guildId: string,
  userId: string,
  requireBot: boolean,
  description: string,
): ExactMember {
  const username = value?.user?.username
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.user?.id !== userId
    || (requireBot && value.user.bot !== true)
    || (value.user.bot !== undefined && typeof value.user.bot !== "boolean")
    || typeof username !== "string"
    || username.length < 1
    || [...username].length > MEMBER_DIRECTORY_LIMITS.nameCharacters
    || TEXT_CONTROL_PATTERN.test(username)
    || !validUnicode(username)
    || !validFlags(value.flags)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.some((roleId) => !validSnowflake(roleId))
    || value.roles.includes(guildId)
    || new Set(value.roles).size !== value.roles.length
    || (value.pending !== undefined && typeof value.pending !== "boolean")
  ) {
    throw evidenceError(
      `Discord returned invalid or mismatched ${description} member verification evidence`,
    )
  }
  return value as ExactMember
}

function exactRoles(
  values: readonly DiscordRole[],
  guildId: string,
  members: readonly ExactMember[],
): DiscordRole[] {
  try {
    normalizeDiscordRoleInventory(values, guildId)
  } catch (error) {
    throw evidenceError(
      `Discord member verification role evidence is invalid: ${errorMessage(error)}`,
      error,
    )
  }
  const ids = new Set(values.map((role) => role.id))
  for (const member of members) {
    if (member.roles.some((roleId) => !ids.has(roleId))) {
      throw evidenceError("Discord member verification evidence references an unknown role")
    }
  }
  return [...values]
}

function guildPermissions(
  member: ExactMember,
  roles: readonly DiscordRole[],
  guildId: string,
  description: string,
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError(`Discord ${description} permission evidence is invalid`, error)
  }
  if (!result.complete || result.highestRoleIds.length !== 1) {
    throw evidenceError(`Discord ${description} permission evidence is incomplete`)
  }
  return result
}

function authorizationPath(
  botId: string,
  ownerId: string,
  permissions: GuildMemberPermissionResult,
): {
  path: MemberVerificationAuthorizationPath
  requiredPermissions: DiscordPermissionName[]
} {
  if (botId === ownerId) {
    return { path: "guild-owner", requiredPermissions: [] }
  }
  if (hasGuildPermission(permissions, "MANAGE_GUILD")) {
    return { path: "manage-guild", requiredPermissions: ["MANAGE_GUILD"] }
  }
  if (hasGuildPermission(permissions, "MANAGE_ROLES")) {
    return { path: "manage-roles", requiredPermissions: ["MANAGE_ROLES"] }
  }
  if (COMBINED_MODERATION_PERMISSIONS.every((name) => hasGuildPermission(permissions, name))) {
    return {
      path: "combined-moderation",
      requiredPermissions: [...COMBINED_MODERATION_PERMISSIONS],
    }
  }
  throw evidenceError(
    "Discord connector bot lacks a documented permission path for member verification changes",
  )
}

function rolesSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    permissions: role.permissions,
    position: role.position,
  })).sort((left, right) => compareSnowflakes(left.id, right.id))
}

function memberSnapshot(member: ExactMember) {
  return {
    bot: member.user.bot === true,
    flags: member.flags,
    pending: member.pending ?? false,
    roles: [...member.roles].sort(compareSnowflakes),
    userId: member.user.id,
    username: member.user.username,
  }
}

function permissionSnapshot(result: GuildMemberPermissionResult) {
  return {
    administrator: result.administrator,
    effectivePermissions: result.effectivePermissions,
    highestRoleIds: [...result.highestRoleIds],
    highestRolePosition: result.highestRolePosition,
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(result.effectivePermissions),
    ).toString(),
  }
}

function privacyProjection(): MemberVerificationPrivacyProjection {
  return {
    persistence: "content-free-outcomes-only",
    rawFlagsExposed: false,
    transientUntrustedFields: ["guildName", "username"],
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
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
    userId: receipt.resourceId,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: MemberVerificationChangePlan
  request: NormalizedMemberVerificationChangeRequest
  status: MemberVerificationActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): MemberVerificationActivity {
  return {
    desiredBypassesVerification: options.request.bypassesVerification,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "member-verification-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    userId: options.request.userId,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: MemberVerificationChangePlan
  request: NormalizedMemberVerificationChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "member-verification-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.request.userId,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function targetKey(guildId: string, userId: string): string {
  return `${guildId}\0${userId}`
}

function executionBlocksTarget(error: unknown): boolean {
  if (
    !(error instanceof MemberVerificationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  const status = (error.result as { status: unknown }).status
  return status === "uncertain" || status === "completed-operation-record-failed"
}

async function withTargetLock<T>(
  state: MemberVerificationLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => MemberVerificationExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: MemberVerificationTargetOutcome) => void = () => undefined
  const tail = new Promise<MemberVerificationTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: MemberVerificationTargetOutcome = "settled"
  try {
    if (state.uncertainTargets.has(key) || await prior === "uncertain") {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksTarget(error)) {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(key) === tail) state.tails.delete(key)
  }
}

export class MemberVerificationService {
  readonly #activityStore: ActivityStore
  readonly #client: MemberVerificationServiceOptions["client"]
  readonly #clock: () => Date
  readonly #locks: MemberVerificationLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: MemberVerificationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = memberVerificationLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #evidence(
    applicationId: string,
    botId: string,
    request: NormalizedMemberVerificationChangeRequest,
    options: RequestOptions,
  ): Promise<MemberVerificationState> {
    if (!validSnowflake(applicationId) || !validSnowflake(botId)) {
      throw new RangeError(
        "Discord member verification planning requires exact application and bot snowflakes",
      )
    }
    if (request.userId === botId) {
      throw evidenceError("Discord member verification changes cannot target the connector bot")
    }
    this.#policy.assertMemberVerificationChangeAllowed(
      request.guildId,
      request.userId,
    )
    const receipt = await this.#operationStore.get(
      "member-verification-change",
      request.operationKeyHash,
    )
    if (receipt) {
      throw new MemberVerificationOperationConflictError(receiptView(receipt))
    }

    const [rawGuild, rawBotMember, rawTargetMember, rawRoles] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildMember(request.guildId, request.userId, options),
      this.#client.getGuildRoles(request.guildId, options),
    ])
    const guild = exactGuild(rawGuild, request.guildId)
    const botMember = exactMember(
      rawBotMember,
      request.guildId,
      botId,
      true,
      "connector-bot",
    )
    const targetMember = exactMember(
      rawTargetMember,
      request.guildId,
      request.userId,
      false,
      "target-member",
    )
    if (targetMember.user.bot === true) {
      throw evidenceError("Discord member verification changes cannot target a bot account")
    }
    if (request.userId === guild.owner_id) {
      throw evidenceError("Discord member verification changes cannot target the guild owner")
    }
    const roles = exactRoles(
      rawRoles,
      request.guildId,
      [botMember, targetMember],
    )
    const botPermissions = guildPermissions(
      botMember,
      roles,
      request.guildId,
      "connector bot",
    )
    const targetPermissions = guildPermissions(
      targetMember,
      roles,
      request.guildId,
      "target member",
    )
    if (targetPermissions.administrator) {
      throw evidenceError("Discord member verification changes cannot target an administrator")
    }
    if (botPermissions.highestRolePosition <= targetPermissions.highestRolePosition) {
      throw evidenceError(
        "Discord member verification target must be strictly below the connector bot's highest role",
      )
    }
    const authorization = authorizationPath(botId, guild.owner_id, botPermissions)
    const unknownPermissionBits = unknownDiscordPermissionBits(
      BigInt(botPermissions.effectivePermissions),
    ).toString()
    const permission: MemberVerificationPermissionEvidence = {
      administrator: botPermissions.administrator,
      authorizationPath: authorization.path,
      effectivePermissionNames: [...botPermissions.effectivePermissionNames],
      effectivePermissions: botPermissions.effectivePermissions,
      requiredPermissions: authorization.requiredPermissions,
      requiredPermissionsPresent: true,
      unknownPermissionBits,
    }
    return {
      botMember,
      botPermissions,
      guild,
      hierarchy: {
        botHighestRoleIds: [...botPermissions.highestRoleIds],
        botHighestRolePosition: botPermissions.highestRolePosition,
        targetAdministrator: false,
        targetBelowBot: true,
        targetHighestRoleIds: [...targetPermissions.highestRoleIds],
        targetHighestRolePosition: targetPermissions.highestRolePosition,
      },
      permission,
      roles,
      targetMember,
      targetPermissions,
    }
  }

  async #buildPlanEvidence(
    applicationId: string,
    botId: string,
    request: NormalizedMemberVerificationChangeRequest,
    options: RequestOptions,
  ): Promise<{
    nextFlags: number
    plan: MemberVerificationChangePlan
    reviewedFlags: number
  }> {
    const state = await this.#evidence(applicationId, botId, request, options)
    const currentBypassesVerification = bypassesVerification(state.targetMember.flags)
    const nextFlags = desiredFlags(
      state.targetMember.flags,
      request.bypassesVerification,
    )
    const writeRequired = nextFlags !== state.targetMember.flags
    const privacy = privacyProjection()
    const warnings = [
      ...(state.permission.authorizationPath === "guild-owner"
        ? ["The connector identity is the guild owner and therefore has authority beyond this workflow"]
        : []),
      ...(state.botPermissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with one documented narrow permission path"]
        : []),
      ...(state.permission.unknownPermissionBits !== "0"
        ? [`Connector-bot permission evidence contains bits unknown to this build: ${state.permission.unknownPermissionBits}`]
        : []),
      ...(state.targetMember.pending === true
        ? ["The target is pending Membership Screening, which is the intended use of this bypass"]
        : ["The target has already passed or is not subject to pending Membership Screening"]),
      "Guild and user labels in this plan are transient untrusted Discord content",
      "Every unrelated member flag bit is preserved exactly and never exposed",
      "Same-member serialization and uncertainty quarantine are process-local defense in depth",
      "The operation key is one-shot and cannot be retried after reservation",
      "This workflow performs one exact non-retried member PATCH, one exact readback, and never rolls back",
    ]
    const risks = writeRequired
      ? [
          request.bypassesVerification
            ? "The exact member will be allowed to participate despite guild verification requirements"
            : "The exact member will no longer bypass guild verification requirements",
          "A transport or readback failure after dispatch creates an uncertain outcome that blocks later same-member verification changes in this process",
        ]
      : []
    const requestSnapshot = {
      auditReason: request.auditReason,
      bypassesVerification: request.bypassesVerification,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      userId: request.userId,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      botPermissions: permissionSnapshot(state.botPermissions),
      desiredFlags: nextFlags,
      domain: "guildcontrol-member-verification-change-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      hierarchy: state.hierarchy,
      localPolicy: {
        featureEnabled: true,
        guildAllowed: request.guildId,
        targetProtected: false,
      },
      permission: state.permission,
      privacy,
      request: requestSnapshot,
      risks,
      roles: rolesSnapshot(state.roles),
      targetMember: memberSnapshot(state.targetMember),
      targetPermissions: permissionSnapshot(state.targetPermissions),
      warnings,
    })
    return {
      nextFlags,
      plan: {
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: this.#clock().toISOString(),
        desiredBypassesVerification: request.bypassesVerification,
        digest,
        guild: {
          id: state.guild.id,
          name: state.guild.name,
          ownerId: state.guild.owner_id,
        },
        hierarchy: state.hierarchy,
        operationKeyHash: request.operationKeyHash,
        permission: state.permission,
        privacy,
        risks,
        schemaVersion: SCHEMA_VERSION,
        status: writeRequired ? "planned" : "already-current",
        target: {
          currentBypassesVerification,
          id: request.userId,
          pending: state.targetMember.pending ?? false,
          username: state.targetMember.user.username,
        },
        warnings,
        writeRequired,
      },
      reviewedFlags: state.targetMember.flags,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedMemberVerificationChangeRequest,
    options: RequestOptions,
  ): Promise<MemberVerificationChangePlan> {
    return (await this.#buildPlanEvidence(
      applicationId,
      botId,
      request,
      options,
    )).plan
  }

  plan(
    applicationId: string,
    botId: string,
    request: MemberVerificationChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberVerificationChangePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeMemberVerificationChangeRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: MemberVerificationChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberVerificationChangeResult> {
    const normalized = normalizeMemberVerificationChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord member verification plan digest is invalid")
    }
    const key = targetKey(normalized.guildId, normalized.userId)
    return withTargetLock(
      this.#locks,
      key,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new MemberVerificationExecutionError(
        "Discord member verification change was blocked because a prior same-member operation ended without a durable outcome",
        {
          desiredBypassesVerification: normalized.bypassesVerification,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          userId: normalized.userId,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedMemberVerificationChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<MemberVerificationChangeResult> {
    let planning: {
      nextFlags: number
      plan: MemberVerificationChangePlan
      reviewedFlags: number
    }
    try {
      planning = await this.#buildPlanEvidence(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof MemberVerificationEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new MemberVerificationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const plan = planning.plan
    if (plan.digest !== expectedDigest) {
      throw new MemberVerificationPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      desiredBypassesVerification: request.bypassesVerification,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      userId: request.userId,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        observedBypassesVerification: plan.target.currentBypassesVerification,
        status: "already-current",
        verification: "not-required",
      }
    }

    const reviewedFlags = planning.reviewedFlags
    const nextFlags = planning.nextFlags

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new MemberVerificationOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
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
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new MemberVerificationExecutionError(
        "Discord member verification change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationStarted = false
    let mutationReturned = false
    let response: DiscordGuildMemberVerificationUpdate | null = null
    let observedBypassesVerification = bypassesVerification(reviewedFlags)
    let readbackFlags = reviewedFlags
    try {
      mutationStarted = true
      response = await this.#client.modifyGuildMemberVerificationBypass(
        request.guildId,
        request.userId,
        nextFlags,
        request.auditReason,
        options,
      )
      mutationReturned = true
      if (response.userId !== request.userId) {
        throw evidenceError("Discord returned a member verification response for another member")
      }
      const readback = exactMember(
        await this.#client.getGuildMember(
          request.guildId,
          request.userId,
          options,
        ),
        request.guildId,
        request.userId,
        false,
        "member-verification readback",
      )
      readbackFlags = readback.flags
      observedBypassesVerification = bypassesVerification(readback.flags)
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      const status = definiteMutationRefusal ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
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
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new MemberVerificationExecutionError(
        "Discord member verification change did not complete with a verified outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = response !== null
      && response.flags === nextFlags
      && response.bypassesVerification === request.bypassesVerification
      && preservedFlags(response.flags) === preservedFlags(reviewedFlags)
      && observedBypassesVerification === request.bypassesVerification
      && preservedFlags(readbackFlags) === preservedFlags(reviewedFlags)
      ? "match"
      : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: MemberVerificationChangeResult = {
      ...baseResult,
      activityId,
      observedBypassesVerification,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
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
          request,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new MemberVerificationExecutionError(
        "Discord member verification change completed but the operation receipt failed",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
          verification,
        },
        { cause: error },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new MemberVerificationExecutionError(
        "Discord member verification change completed but the final activity record failed",
        {
          ...baseResult,
          activityId,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
          verification,
        },
        { cause: error },
      )
    }
    return result
  }
}
