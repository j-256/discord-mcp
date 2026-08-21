import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ChannelPermissionOverwriteActivity,
  ChannelPermissionOverwriteActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  PERMISSION_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
} from "./discord-client.js"
import {
  ChannelPermissionOverwriteExecutionError,
  ChannelPermissionOverwriteOperationConflictError,
  ChannelPermissionOverwritePlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_CHANNEL_PERMISSION_NAMES,
  DISCORD_PERMISSIONS,
  discordPermissionBitfield,
  discordPermissionNames,
  evaluateBotChannelPermissions,
  evaluatePrincipalPermissions,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type BotChannelPermissionResult,
  type DiscordChannelPermissionName,
  type DiscordPermissionName,
  type PrincipalPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import {
  normalizeChannel,
  stableString,
} from "./normalize.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const CHANNEL_PERMISSION_OVERWRITE_MODES = ["delete", "update"] as const
export const CHANNEL_PERMISSION_OVERWRITE_STATES = ["allow", "deny", "inherit"] as const
export const CHANNEL_PERMISSION_OVERWRITE_TARGET_TYPES = ["member", "role"] as const

export type ChannelPermissionOverwriteMode =
  typeof CHANNEL_PERMISSION_OVERWRITE_MODES[number]
export type ChannelPermissionOverwriteState =
  typeof CHANNEL_PERMISSION_OVERWRITE_STATES[number]
export type ChannelPermissionOverwriteTargetType =
  typeof CHANNEL_PERMISSION_OVERWRITE_TARGET_TYPES[number]

const STATE_UNAVAILABLE = "channel-permission-overwrite-state-unavailable"
const DIRECT_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.directory,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const THREAD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const TARGET_TYPE_CODES = Object.freeze({
  member: 1,
  role: 0,
} as const)
const PERMISSION_ORDER = new Map(
  DISCORD_CHANNEL_PERMISSION_NAMES.map((name, index) => [name, index]),
)
const CHANNEL_PERMISSION_NAME_SET: ReadonlySet<DiscordPermissionName> = new Set(
  DISCORD_CHANNEL_PERMISSION_NAMES,
)
const CHANNEL_PERMISSION_MASK = discordPermissionBitfield(
  DISCORD_CHANNEL_PERMISSION_NAMES,
)
type ChannelPermissionOverwriteOutcome = "settled" | "uncertain"
const CHANNEL_PERMISSION_OVERWRITE_LOCKS = new Map<
  string,
  Promise<ChannelPermissionOverwriteOutcome>
>()

export interface ChannelPermissionOverwriteChange {
  permission: DiscordChannelPermissionName
  state: ChannelPermissionOverwriteState
}

interface ChannelPermissionOverwriteRequestBase {
  auditReason: string
  channelId: string
  operationKey: string
  targetId: string
  targetType: ChannelPermissionOverwriteTargetType
}

export type ChannelPermissionOverwriteRequest =
  | ChannelPermissionOverwriteRequestBase & {
    changes?: undefined
    mode: "delete"
  }
  | ChannelPermissionOverwriteRequestBase & {
    changes: readonly ChannelPermissionOverwriteChange[]
    mode: "update"
  }

export interface NormalizedChannelPermissionOverwriteRequest
  extends ChannelPermissionOverwriteRequestBase {
  changes: ChannelPermissionOverwriteChange[]
  mode: ChannelPermissionOverwriteMode
  operationKeyHash: string
  targetTypeCode: 0 | 1
}

export interface ChannelPermissionOverwriteView {
  allow: string
  allowPermissions: DiscordPermissionName[]
  deny: string
  denyPermissions: DiscordPermissionName[]
  targetId: string
  targetType: ChannelPermissionOverwriteTargetType
  unknownAllow: string
  unknownDeny: string
}

export interface ChannelPermissionOverwriteListResult {
  inherited: boolean
  page: {
    hasMore: boolean
    nextAfterTargetId: string | null
    requestedLimit: number
    returned: number
    total: number
  }
  requestedChannel: ReturnType<typeof normalizeChannel>
  schemaVersion: number
  sourceChannel: ReturnType<typeof normalizeChannel>
  status: "ok"
  overwrites: ChannelPermissionOverwriteView[]
}

export type ChannelPermissionDecision = "allowed" | "denied" | "ineffective" | "unknown"

export interface ChannelPermissionImpact {
  after: ChannelPermissionDecision
  before: ChannelPermissionDecision
  permission: DiscordChannelPermissionName
}

export interface ChannelPermissionOverwritePlan {
  action: "delete" | "none" | "put"
  applicationId: string
  auditReason: string
  botId: string
  botPermission: {
    afterEffectivePermissions: string
    beforeEffectivePermissions: string
    confidence: "complete"
    manageRolesAfter: true
    manageRolesBefore: true
    viewChannelAfter: true
    viewChannelBefore: true
  }
  changes: ChannelPermissionOverwriteChange[]
  channel: ReturnType<typeof normalizeChannel>
  createdAt: string
  currentOverwrite: ChannelPermissionOverwriteView | null
  desiredOverwrite: ChannelPermissionOverwriteView | null
  digest: string
  evaluatedPermissions: DiscordChannelPermissionName[]
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  parentSync: {
    after: boolean | null
    before: boolean | null
    parentChannelId: string | null
  }
  requestedMode: ChannelPermissionOverwriteMode
  schemaVersion: number
  status: "already-current" | "planned"
  target: {
    id: string
    name: string
    type: ChannelPermissionOverwriteTargetType
  }
  targetAccess: {
    basis: "member-effective" | "standalone-role-baseline"
    impacts: ChannelPermissionImpact[]
  }
  warnings: string[]
}

export interface ChannelPermissionOverwriteResult {
  activityId: string | null
  channelId: string
  guildId: string
  observedOverwrite: ChannelPermissionOverwriteView | null
  operationKeyHash: string
  overwriteSetMatched: boolean
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  targetId: string
  targetMatched: boolean
  targetType: ChannelPermissionOverwriteTargetType
}

export interface ChannelPermissionOverwriteListOptions extends RequestOptions {
  afterTargetId?: string
  limit?: number
}

export interface ChannelPermissionOverwriteServiceClient extends Pick<
  DiscordClient,
  | "deleteChannelPermissionOverwrite"
  | "editChannelPermissionOverwrite"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
> {}

export interface ChannelPermissionOverwriteServiceOptions {
  activityStore: ActivityStore
  client: ChannelPermissionOverwriteServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface CanonicalOverwrite {
  allow: bigint
  deny: bigint
  id: string
  type: 0 | 1
}

interface ChannelPermissionOverwriteStateEvidence {
  botMember: DiscordGuildMember
  botPermissionAfter: BotChannelPermissionResult & { confidence: "complete" }
  botPermissionBefore: BotChannelPermissionResult & { confidence: "complete" }
  channel: DiscordChannel
  currentOverwrite: CanonicalOverwrite | undefined
  desiredOverwrite: CanonicalOverwrite | undefined
  desiredOverwrites: CanonicalOverwrite[]
  guild: DiscordGuild & { owner_id: string }
  guildId: string
  overwrites: CanonicalOverwrite[]
  parent: DiscordChannel | undefined
  roles: DiscordRole[]
  targetAccessAfter: PrincipalPermissionResult & { confidence: "complete" }
  targetAccessBefore: PrincipalPermissionResult & { confidence: "complete" }
  targetMember: DiscordGuildMember | undefined
  targetRole: DiscordRole | undefined
}

interface BuiltChannelPermissionOverwritePlan {
  plan: ChannelPermissionOverwritePlan
  state: ChannelPermissionOverwriteStateEvidence
}

class ChannelPermissionOverwriteStateError extends Error {
  override name = "ChannelPermissionOverwriteStateError"
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function canonicalChanges(
  changes: readonly ChannelPermissionOverwriteChange[],
): ChannelPermissionOverwriteChange[] {
  if (
    !Array.isArray(changes)
    || changes.length < 1
    || changes.length > DISCORD_CHANNEL_PERMISSION_NAMES.length
  ) {
    throw new RangeError(
      `Discord permission-overwrite update must contain between 1 and ${DISCORD_CHANNEL_PERMISSION_NAMES.length} changes`,
    )
  }
  const seen = new Set<DiscordChannelPermissionName>()
  const normalized = changes.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RangeError("Discord permission-overwrite changes must be objects")
    }
    if (!DISCORD_CHANNEL_PERMISSION_NAMES.includes(value.permission)) {
      throw new RangeError(
        `Discord channel permission ${String(value.permission)} is not supported`,
      )
    }
    if (!CHANNEL_PERMISSION_OVERWRITE_STATES.includes(value.state)) {
      throw new RangeError(
        `Discord permission-overwrite state ${String(value.state)} is not supported`,
      )
    }
    if (seen.has(value.permission)) {
      throw new RangeError(`Discord channel permission ${value.permission} is duplicated`)
    }
    seen.add(value.permission)
    return {
      permission: value.permission,
      state: value.state,
    }
  })
  return normalized.sort((left, right) => (
    (PERMISSION_ORDER.get(left.permission) as number)
      - (PERMISSION_ORDER.get(right.permission) as number)
  ))
}

export function normalizeChannelPermissionOverwriteRequest(
  request: ChannelPermissionOverwriteRequest,
): NormalizedChannelPermissionOverwriteRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord channel permission-overwrite request must be an object")
  }
  assertSnowflake(request.channelId, "Discord permission-overwrite channel ID")
  assertSnowflake(request.targetId, "Discord permission-overwrite target ID")
  if (!CHANNEL_PERMISSION_OVERWRITE_TARGET_TYPES.includes(request.targetType)) {
    throw new RangeError("Discord permission-overwrite target type is not supported")
  }
  if (!CHANNEL_PERMISSION_OVERWRITE_MODES.includes(request.mode)) {
    throw new RangeError("Discord permission-overwrite mode is not supported")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord permission-overwrite audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (request.mode === "delete" && request.changes !== undefined) {
    throw new RangeError("Discord permission-overwrite deletion does not accept changes")
  }
  const changes = request.mode === "update"
    ? canonicalChanges(request.changes)
    : []
  return {
    auditReason: request.auditReason,
    changes,
    channelId: request.channelId,
    mode: request.mode,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    targetId: request.targetId,
    targetType: request.targetType,
    targetTypeCode: TARGET_TYPE_CODES[request.targetType],
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function canonicalOverwrites(
  channel: DiscordChannel,
  description: string,
): CanonicalOverwrite[] {
  const values = channel.permission_overwrites
  if (
    !Array.isArray(values)
    || values.length > DISCORD_LIMITS.channelPermissionOverwrites
  ) {
    throw new ChannelPermissionOverwriteStateError(
      `Discord returned incomplete or invalid ${description} permission overwrites`,
    )
  }
  const seen = new Set<string>()
  const result = values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord returned an invalid ${description} permission overwrite`,
      )
    }
    assertSnowflake(value.id, `Discord ${description} permission-overwrite target ID`)
    if (value.type !== 0 && value.type !== 1) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord returned unsupported ${description} permission-overwrite type`,
      )
    }
    if (seen.has(value.id)) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord returned duplicate ${description} permission-overwrite target ${value.id}`,
      )
    }
    seen.add(value.id)
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(
        value.allow ?? "0",
        `${description} overwrite ${value.id} allow`,
      )
      deny = parseDiscordPermissionBits(
        value.deny ?? "0",
        `${description} overwrite ${value.id} deny`,
      )
    } catch (error) {
      throw new ChannelPermissionOverwriteStateError(errorMessage(error), { cause: error })
    }
    if ((allow & deny) !== 0n) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord returned overlapping ${description} permission bits for ${value.id}`,
      )
    }
    return {
      allow,
      deny,
      id: value.id,
      type: value.type as 0 | 1,
    }
  })
  return result.sort((left, right) => (
    compareSnowflakes(left.id, right.id) || left.type - right.type
  ))
}

function overwriteSnapshot(overwrites: readonly CanonicalOverwrite[]) {
  return overwrites.map((overwrite) => ({
    allow: overwrite.allow.toString(),
    deny: overwrite.deny.toString(),
    id: overwrite.id,
    type: overwrite.type,
  }))
}

function overwriteView(
  overwrite: CanonicalOverwrite,
): ChannelPermissionOverwriteView {
  return {
    allow: overwrite.allow.toString(),
    allowPermissions: discordPermissionNames(overwrite.allow),
    deny: overwrite.deny.toString(),
    denyPermissions: discordPermissionNames(overwrite.deny),
    targetId: overwrite.id,
    targetType: overwrite.type === 0 ? "role" : "member",
    unknownAllow: unknownDiscordPermissionBits(overwrite.allow).toString(),
    unknownDeny: unknownDiscordPermissionBits(overwrite.deny).toString(),
  }
}

function discordOverwrites(
  overwrites: readonly CanonicalOverwrite[],
): DiscordPermissionOverwrite[] {
  return overwrites.map((overwrite) => ({
    allow: overwrite.allow.toString(),
    deny: overwrite.deny.toString(),
    id: overwrite.id,
    type: overwrite.type,
  }))
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
  description: string,
): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || Array.isArray(channel)
    || channel.id !== channelId
    || !Number.isSafeInteger(channel.type)
    || (
      channel.guild_id !== undefined
      && !DISCORD_SNOWFLAKE_PATTERN.test(channel.guild_id)
    )
    || (
      channel.parent_id !== undefined
      && channel.parent_id !== null
      && !DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
    )
  ) {
    throw new ChannelPermissionOverwriteStateError(
      `Discord returned invalid ${description} channel evidence`,
    )
  }
  return channel
}

function exactDirectChannel(
  channel: DiscordChannel,
  channelId: string,
): DiscordChannel & { guild_id: string; permission_overwrites: DiscordPermissionOverwrite[] } {
  const exact = exactChannel(channel, channelId, "permission-overwrite target")
  if (
    !DIRECT_CHANNEL_TYPES.has(exact.type)
    || !exact.guild_id
    || !Array.isArray(exact.permission_overwrites)
  ) {
    throw new ChannelPermissionOverwriteStateError(
      "Discord permission-overwrite changes require a direct guild channel with complete overwrite evidence",
    )
  }
  return exact as DiscordChannel & {
    guild_id: string
    permission_overwrites: DiscordPermissionOverwrite[]
  }
}

function exactParentChannel(
  channel: DiscordChannel,
  parentId: string,
  guildId: string,
): DiscordChannel & { guild_id: string; permission_overwrites: DiscordPermissionOverwrite[] } {
  const exact = exactChannel(channel, parentId, "permission-overwrite parent")
  if (
    exact.type !== DISCORD_CHANNEL_TYPES.category
    || exact.guild_id !== guildId
    || !Array.isArray(exact.permission_overwrites)
  ) {
    throw new ChannelPermissionOverwriteStateError(
      "Discord returned invalid permission-overwrite parent category evidence",
    )
  }
  return exact as DiscordChannel & {
    guild_id: string
    permission_overwrites: DiscordPermissionOverwrite[]
  }
}

function exactGuild(
  guild: DiscordGuild,
  guildId: string,
): DiscordGuild & { owner_id: string } {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || typeof guild.owner_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(guild.owner_id)
  ) {
    throw new ChannelPermissionOverwriteStateError(
      "Discord returned incomplete or mismatched permission-overwrite guild evidence",
    )
  }
  return guild as DiscordGuild & { owner_id: string }
}

function exactMember(
  member: DiscordGuildMember,
  userId: string,
  description: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !member.user
    || member.user.id !== userId
    || typeof member.user.username !== "string"
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || member.roles.some((roleId) => !DISCORD_SNOWFLAKE_PATTERN.test(roleId))
    || new Set(member.roles).size !== member.roles.length
  ) {
    throw new ChannelPermissionOverwriteStateError(
      `Discord returned incomplete or mismatched ${description} member evidence`,
    )
  }
  return member
}

function exactRoles(
  roles: DiscordRole[],
  guildId: string,
  requiredRoleIds: readonly string[],
): DiscordRole[] {
  if (
    !Array.isArray(roles)
    || roles.length < 1
    || roles.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new ChannelPermissionOverwriteStateError(
      "Discord returned an invalid permission-overwrite role inventory",
    )
  }
  const seen = new Set<string>()
  for (const role of roles as readonly unknown[]) {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
    ) {
      throw new ChannelPermissionOverwriteStateError(
        "Discord returned an invalid role in the permission-overwrite inventory",
      )
    }
    const value = role as DiscordRole
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(value.id)
      || typeof value.name !== "string"
      || typeof value.managed !== "boolean"
      || !Number.isInteger(value.position)
      || value.position < 0
    ) {
      throw new ChannelPermissionOverwriteStateError(
        "Discord returned incomplete permission-overwrite role evidence",
      )
    }
    try {
      parseDiscordPermissionBits(value.permissions, `role ${value.id}`)
    } catch (error) {
      throw new ChannelPermissionOverwriteStateError(errorMessage(error), { cause: error })
    }
    if (seen.has(value.id)) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord returned duplicate permission-overwrite role ${value.id}`,
      )
    }
    seen.add(value.id)
  }
  for (const roleId of [guildId, ...requiredRoleIds]) {
    if (!seen.has(roleId)) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord permission-overwrite role inventory omitted role ${roleId}`,
      )
    }
  }
  return roles
}

function hasPermission(
  result: BotChannelPermissionResult,
  permission: DiscordPermissionName,
): boolean {
  return result.effectivePermissionNames.includes(permission)
}

function completeBotPermissions(
  result: BotChannelPermissionResult,
  stage: string,
): BotChannelPermissionResult & { confidence: "complete" } {
  if (result.confidence !== "complete") {
    throw new ChannelPermissionOverwriteStateError(
      `Discord connector bot ${stage} permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  if (!hasPermission(result, "VIEW_CHANNEL")) {
    throw new ChannelPermissionOverwriteStateError(
      `Discord connector bot lacks ${stage} channel-level VIEW_CHANNEL`,
    )
  }
  if (!hasPermission(result, "MANAGE_ROLES")) {
    throw new ChannelPermissionOverwriteStateError(
      `Discord connector bot lacks ${stage} channel-level MANAGE_ROLES`,
    )
  }
  return result as BotChannelPermissionResult & { confidence: "complete" }
}

function completeTargetPermissions(
  result: PrincipalPermissionResult,
  stage: string,
): PrincipalPermissionResult & { confidence: "complete" } {
  if (result.confidence !== "complete") {
    throw new ChannelPermissionOverwriteStateError(
      `Discord target ${stage} permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result as PrincipalPermissionResult & { confidence: "complete" }
}

function permissionDecision(
  result: PrincipalPermissionResult,
  permission: DiscordChannelPermissionName,
): ChannelPermissionDecision {
  if (result.confidence !== "complete") return "unknown"
  if (result.missingPermissions.includes(permission)) return "denied"
  if (result.ineffectivePermissions.includes(permission)) return "ineffective"
  return "allowed"
}

function updatedOverwrite(
  current: CanonicalOverwrite | undefined,
  request: NormalizedChannelPermissionOverwriteRequest,
): CanonicalOverwrite {
  let allow = current?.allow ?? 0n
  let deny = current?.deny ?? 0n
  for (const change of request.changes) {
    const bit = DISCORD_PERMISSIONS[change.permission]
    allow &= ~bit
    deny &= ~bit
    if (change.state === "allow") allow |= bit
    if (change.state === "deny") deny |= bit
  }
  return {
    allow,
    deny,
    id: request.targetId,
    type: request.targetTypeCode,
  }
}

function replaceTarget(
  current: readonly CanonicalOverwrite[],
  targetId: string,
  desired: CanonicalOverwrite | undefined,
): CanonicalOverwrite[] {
  const withoutTarget = current.filter((overwrite) => overwrite.id !== targetId)
  return desired
    ? [...withoutTarget, desired].sort((left, right) => (
        compareSnowflakes(left.id, right.id) || left.type - right.type
      ))
    : withoutTarget
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      name: role.name,
      permissions: role.permissions,
      position: role.position,
    }))
    .sort((left, right) => compareSnowflakes(left.id, right.id))
}

function memberSnapshot(member: DiscordGuildMember | undefined) {
  if (!member) return null
  return {
    communicationDisabledUntil: member.communication_disabled_until ?? null,
    roles: [...member.roles].sort(compareSnowflakes),
    user: {
      bot: member.user?.bot ?? false,
      globalName: member.user?.global_name ?? null,
      id: member.user?.id ?? null,
      username: member.user?.username ?? null,
    },
  }
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
    targetId: receipt.resourceId,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: ChannelPermissionOverwritePlan
  request: NormalizedChannelPermissionOverwriteRequest
  status: ChannelPermissionOverwriteActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ChannelPermissionOverwriteActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "channel-permission-overwrite",
    mode: options.request.mode,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetId: options.request.targetId,
    targetType: options.request.targetType,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: ChannelPermissionOverwritePlan
  request: NormalizedChannelPermissionOverwriteRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "channel-permission-overwrite",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.targetId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ChannelPermissionOverwriteExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withChannelLock<T>(
  channelId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ChannelPermissionOverwriteExecutionError,
): Promise<T> {
  const prior = CHANNEL_PERMISSION_OVERWRITE_LOCKS.get(channelId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ChannelPermissionOverwriteOutcome) => void = () => undefined
  const tail = new Promise<ChannelPermissionOverwriteOutcome>((resolve) => {
    release = resolve
  })
  CHANNEL_PERMISSION_OVERWRITE_LOCKS.set(channelId, tail)
  let outcome: ChannelPermissionOverwriteOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (uncertainExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    release(outcome)
    if (CHANNEL_PERMISSION_OVERWRITE_LOCKS.get(channelId) === tail) {
      CHANNEL_PERMISSION_OVERWRITE_LOCKS.delete(channelId)
    }
  }
}

export class ChannelPermissionOverwriteService {
  readonly #activityStore: ActivityStore
  readonly #client: ChannelPermissionOverwriteServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ChannelPermissionOverwriteServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async list(
    channelId: string,
    options: ChannelPermissionOverwriteListOptions = {},
  ): Promise<ChannelPermissionOverwriteListResult> {
    assertSnowflake(channelId, "Discord permission-overwrite channel ID")
    if (options.afterTargetId !== undefined) {
      assertSnowflake(
        options.afterTargetId,
        "Discord permission-overwrite target cursor",
      )
    }
    const limit = options.limit ?? PERMISSION_LIMITS.overwritePageDefault
    if (
      !Number.isInteger(limit)
      || limit < 1
      || limit > PERMISSION_LIMITS.overwritePage
    ) {
      throw new RangeError(
        `Discord permission-overwrite page limit must be an integer between 1 and ${PERMISSION_LIMITS.overwritePage}`,
      )
    }
    const requestedChannel = exactChannel(
      await this.#client.getChannel(channelId, options),
      channelId,
      "permission-overwrite request",
    )
    const guildId = this.#policy.assertChannelReadable(requestedChannel)
    let sourceChannel = requestedChannel
    let inherited = false
    if (THREAD_CHANNEL_TYPES.has(requestedChannel.type)) {
      if (!requestedChannel.parent_id) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord permission-overwrite thread omitted its parent channel ID",
        )
      }
      sourceChannel = exactChannel(
        await this.#client.getChannel(requestedChannel.parent_id, options),
        requestedChannel.parent_id,
        "permission-overwrite source",
      )
      if (
        sourceChannel.guild_id !== guildId
        || THREAD_CHANNEL_TYPES.has(sourceChannel.type)
      ) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord returned an invalid inherited permission-overwrite source",
        )
      }
      inherited = true
    }
    if (sourceChannel.guild_id !== guildId) {
      throw new ChannelPermissionOverwriteStateError(
        "Discord permission-overwrite source belongs to a different guild",
      )
    }
    const overwrites = canonicalOverwrites(sourceChannel, "channel")
    let start = 0
    if (options.afterTargetId !== undefined) {
      const index = overwrites.findIndex((overwrite) => (
        overwrite.id === options.afterTargetId
      ))
      if (index < 0) {
        throw new RangeError(
          "Discord permission-overwrite cursor must identify an overwrite in the current snapshot",
        )
      }
      start = index + 1
    }
    const page = overwrites.slice(start, start + limit)
    const hasMore = start + page.length < overwrites.length
    return {
      inherited,
      overwrites: page.map(overwriteView),
      page: {
        hasMore,
        nextAfterTargetId: hasMore ? page.at(-1)?.id ?? null : null,
        requestedLimit: limit,
        returned: page.length,
        total: overwrites.length,
      },
      requestedChannel: normalizeChannel(requestedChannel),
      schemaVersion: SCHEMA_VERSION,
      sourceChannel: normalizeChannel(sourceChannel),
      status: "ok",
    }
  }

  async #state(
    botId: string,
    request: NormalizedChannelPermissionOverwriteRequest,
    options: RequestOptions,
  ): Promise<ChannelPermissionOverwriteStateEvidence & {
    action: ChannelPermissionOverwritePlan["action"]
    evaluatedPermissions: DiscordChannelPermissionName[]
    parentSyncAfter: boolean | null
    parentSyncBefore: boolean | null
  }> {
    const channel = exactDirectChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
    )
    const guildId = this.#policy.assertChannelPermissionOverwriteAllowed(channel)
    const existingReceipt = await this.#operationStore.get(
      "channel-permission-overwrite",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new ChannelPermissionOverwriteOperationConflictError(
        receiptView(existingReceipt),
      )
    }

    let parent: DiscordChannel | undefined
    let parentOverwrites: CanonicalOverwrite[] | undefined
    if (channel.parent_id) {
      parent = exactParentChannel(
        await this.#client.getChannel(channel.parent_id, options),
        channel.parent_id,
        guildId,
      )
      parentOverwrites = canonicalOverwrites(parent, "parent category")
    }

    const [guildValue, botMemberValue, rolesValue, targetMemberValue] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      request.targetType === "member"
        ? this.#client.getGuildMember(guildId, request.targetId, options)
        : Promise.resolve(undefined),
    ])
    const guild = exactGuild(guildValue, guildId)
    const botMember = exactMember(botMemberValue, botId, "connector bot")
    const targetMember = targetMemberValue
      ? exactMember(targetMemberValue, request.targetId, "target")
      : undefined
    if (request.targetType === "member") {
      this.#policy.assertUserNotProtected(request.targetId)
      if (request.targetId === botId) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord connector bot cannot be a member permission-overwrite target",
        )
      }
      if (request.targetId === guild.owner_id) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord guild owner cannot be a member permission-overwrite target because ownership bypasses overwrites",
        )
      }
    }
    const requiredRoleIds = [
      ...botMember.roles,
      ...(targetMember?.roles ?? []),
      ...(request.targetType === "role" ? [request.targetId] : []),
    ]
    const roles = exactRoles(rolesValue, guildId, requiredRoleIds)
    const targetRole = request.targetType === "role"
      ? roles.find((role) => role.id === request.targetId)
      : undefined
    if (request.targetType === "role" && !targetRole) {
      throw new ChannelPermissionOverwriteStateError(
        "Discord permission-overwrite target role is absent from the complete role inventory",
      )
    }

    const overwrites = canonicalOverwrites(channel, "channel")
    const mismatchedTarget = overwrites.find((overwrite) => (
      overwrite.id === request.targetId
      && overwrite.type !== request.targetTypeCode
    ))
    if (mismatchedTarget) {
      throw new ChannelPermissionOverwriteStateError(
        "Discord permission-overwrite target type conflicts with current channel evidence",
      )
    }
    const currentOverwrite = overwrites.find((overwrite) => (
      overwrite.id === request.targetId
      && overwrite.type === request.targetTypeCode
    ))

    let botPermissionBefore: BotChannelPermissionResult
    try {
      botPermissionBefore = evaluateBotChannelPermissions({
        botId,
        channel,
        guildId,
        member: botMember,
        permissionChannel: channel,
        roles,
      })
    } catch (error) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord connector bot permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    const completeBefore = completeBotPermissions(botPermissionBefore, "current")

    let desiredOverwrite: CanonicalOverwrite | undefined
    let action: ChannelPermissionOverwritePlan["action"]
    if (request.mode === "delete") {
      desiredOverwrite = undefined
      action = currentOverwrite ? "delete" : "none"
    } else {
      const currentBits = (currentOverwrite?.allow ?? 0n)
        | (currentOverwrite?.deny ?? 0n)
      if (unknownDiscordPermissionBits(currentBits) !== 0n) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord target overwrite contains permission bits unknown to this build; use an explicit reviewed delete or update the connector",
        )
      }
      if ((currentBits & ~CHANNEL_PERMISSION_MASK & ALL_KNOWN_PERMISSION_BITS) !== 0n) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord target overwrite contains known permissions that are not channel-scoped",
        )
      }
      const updated = updatedOverwrite(currentOverwrite, request)
      const outgoingBits = updated.allow | updated.deny
      const botBits = BigInt(completeBefore.effectivePermissions)
      const unavailable = outgoingBits & ~botBits
      if (unavailable !== 0n) {
        throw new ChannelPermissionOverwriteStateError(
          `Discord connector bot cannot send overwrite permissions it does not currently hold: ${discordPermissionNames(unavailable).join(",") || unavailable.toString()}`,
        )
      }
      desiredOverwrite = updated.allow === 0n && updated.deny === 0n
        ? undefined
        : updated
      if (
        stableString(currentOverwrite ? overwriteSnapshot([currentOverwrite])[0] : null)
        === stableString(desiredOverwrite ? overwriteSnapshot([desiredOverwrite])[0] : null)
      ) {
        action = "none"
      } else {
        action = desiredOverwrite ? "put" : "delete"
      }
    }

    if (
      action === "put"
      && !currentOverwrite
      && overwrites.length >= DISCORD_LIMITS.channelPermissionOverwrites
    ) {
      throw new ChannelPermissionOverwriteStateError(
        "Discord channel has reached its permission-overwrite capacity",
      )
    }
    const desiredOverwrites = replaceTarget(
      overwrites,
      request.targetId,
      desiredOverwrite,
    )
    const prospectiveChannel: DiscordChannel = {
      ...channel,
      permission_overwrites: discordOverwrites(desiredOverwrites),
    }
    let botPermissionAfter: BotChannelPermissionResult
    try {
      botPermissionAfter = evaluateBotChannelPermissions({
        botId,
        channel: prospectiveChannel,
        guildId,
        member: botMember,
        permissionChannel: prospectiveChannel,
        roles,
      })
    } catch (error) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord prospective connector bot permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    const completeAfter = completeBotPermissions(botPermissionAfter, "prospective")

    const currentKnownTargetPermissions: DiscordChannelPermissionName[] = currentOverwrite
      ? discordPermissionNames(currentOverwrite.allow | currentOverwrite.deny)
        .filter((name): name is DiscordChannelPermissionName => (
          CHANNEL_PERMISSION_NAME_SET.has(name)
        ))
      : []
    const evaluatedPermissions: DiscordChannelPermissionName[] = request.mode === "update"
      ? request.changes.map(({ permission }) => permission)
      : currentKnownTargetPermissions.length > 0
        ? currentKnownTargetPermissions
        : ["VIEW_CHANNEL"]
    const subject = request.targetType === "role"
      ? { id: request.targetId, kind: "role" as const }
      : {
          id: request.targetId,
          kind: "member" as const,
          member: targetMember as DiscordGuildMember,
        }
    const evaluationTime = this.#clock()
    let targetAccessBefore: PrincipalPermissionResult
    let targetAccessAfter: PrincipalPermissionResult
    try {
      targetAccessBefore = evaluatePrincipalPermissions({
        channel,
        guildId,
        guildOwnerId: guild.owner_id,
        now: evaluationTime,
        permissionChannel: channel,
        requestedPermissions: evaluatedPermissions,
        roles,
        subject,
      })
      targetAccessAfter = evaluatePrincipalPermissions({
        channel: prospectiveChannel,
        guildId,
        guildOwnerId: guild.owner_id,
        now: evaluationTime,
        permissionChannel: prospectiveChannel,
        requestedPermissions: evaluatedPermissions,
        roles,
        subject,
      })
    } catch (error) {
      throw new ChannelPermissionOverwriteStateError(
        `Discord target permission impact evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    const completeTargetBefore = completeTargetPermissions(targetAccessBefore, "current")
    const completeTargetAfter = completeTargetPermissions(targetAccessAfter, "prospective")
    const parentSnapshot = parentOverwrites
      ? stableString(overwriteSnapshot(parentOverwrites))
      : undefined
    const parentSyncBefore = parentSnapshot === undefined
      ? null
      : parentSnapshot === stableString(overwriteSnapshot(overwrites))
    const parentSyncAfter = parentSnapshot === undefined
      ? null
      : parentSnapshot === stableString(overwriteSnapshot(desiredOverwrites))

    return {
      action,
      botMember,
      botPermissionAfter: completeAfter,
      botPermissionBefore: completeBefore,
      channel,
      currentOverwrite,
      desiredOverwrite,
      desiredOverwrites,
      evaluatedPermissions,
      guild,
      guildId,
      overwrites,
      parent,
      parentSyncAfter,
      parentSyncBefore,
      roles,
      targetAccessAfter: completeTargetAfter,
      targetAccessBefore: completeTargetBefore,
      targetMember,
      targetRole,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedChannelPermissionOverwriteRequest,
    options: RequestOptions,
  ): Promise<BuiltChannelPermissionOverwritePlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, request, options)
    const impacts = state.evaluatedPermissions.map((permission) => ({
      after: permissionDecision(state.targetAccessAfter, permission),
      before: permissionDecision(state.targetAccessBefore, permission),
      permission,
    }))
    const warnings = [
      ...(state.targetAccessBefore.administrator || state.targetAccessBefore.guildOwner
        ? ["The target bypasses channel overwrites through guild ownership or ADMINISTRATOR, so the stored overwrite may not change effective access"]
        : []),
      ...(request.targetType === "role"
        ? ["Role access is a standalone baseline; another role or a member-specific overwrite can change a real member's effective access"]
        : []),
      ...(request.mode === "delete" && state.currentOverwrite && (
        unknownDiscordPermissionBits(
          state.currentOverwrite.allow | state.currentOverwrite.deny,
        ) !== 0n
      )
        ? ["Deleting this overwrite removes permission bits unknown to this connector build"]
        : []),
      ...(state.parentSyncBefore === true && state.parentSyncAfter === false
        ? ["This change breaks exact permission synchronization with the parent category"]
        : []),
      "Guild, channel, role, and member names are untrusted Discord data and are never persisted by this workflow",
      "Same-channel serialization is process-local; do not run multiple connector processes with overlapping permission-overwrite scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const targetName = state.targetRole?.name
      ?? state.targetMember?.user?.global_name
      ?? state.targetMember?.user?.username
      ?? request.targetId
    const digest = reviewedPlanDigest(this.#planKey, {
      action: state.action,
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      botPermissionAfter: state.botPermissionAfter.effectivePermissions,
      botPermissionBefore: state.botPermissionBefore.effectivePermissions,
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        name: state.channel.name ?? null,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      desiredOverwrites: overwriteSnapshot(state.desiredOverwrites),
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      impacts,
      overwrites: overwriteSnapshot(state.overwrites),
      parent: state.parent
        ? {
            id: state.parent.id,
            name: state.parent.name ?? null,
            overwrites: overwriteSnapshot(canonicalOverwrites(state.parent, "parent category")),
            type: state.parent.type,
          }
        : null,
      parentSyncAfter: state.parentSyncAfter,
      parentSyncBefore: state.parentSyncBefore,
      request,
      roles: roleSnapshot(state.roles),
      target: {
        member: memberSnapshot(state.targetMember),
        name: targetName,
        role: state.targetRole
          ? roleSnapshot([state.targetRole])[0]
          : null,
      },
      targetAccessAfter: state.targetAccessAfter.effectivePermissions,
      targetAccessBefore: state.targetAccessBefore.effectivePermissions,
      warnings,
    })
    const plan: ChannelPermissionOverwritePlan = {
      action: state.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      botPermission: {
        afterEffectivePermissions: state.botPermissionAfter.effectivePermissions,
        beforeEffectivePermissions: state.botPermissionBefore.effectivePermissions,
        confidence: "complete",
        manageRolesAfter: true,
        manageRolesBefore: true,
        viewChannelAfter: true,
        viewChannelBefore: true,
      },
      changes: request.changes,
      channel: normalizeChannel(state.channel),
      createdAt: this.#clock().toISOString(),
      currentOverwrite: state.currentOverwrite
        ? overwriteView(state.currentOverwrite)
        : null,
      desiredOverwrite: state.desiredOverwrite
        ? overwriteView(state.desiredOverwrite)
        : null,
      digest,
      evaluatedPermissions: state.evaluatedPermissions,
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      operationKeyHash: request.operationKeyHash,
      parentSync: {
        after: state.parentSyncAfter,
        before: state.parentSyncBefore,
        parentChannelId: state.parent?.id ?? null,
      },
      requestedMode: request.mode,
      schemaVersion: SCHEMA_VERSION,
      status: state.action === "none" ? "already-current" : "planned",
      target: {
        id: request.targetId,
        name: targetName,
        type: request.targetType,
      },
      targetAccess: {
        basis: request.targetType === "role"
          ? "standalone-role-baseline"
          : "member-effective",
        impacts,
      },
      warnings,
    }
    return { plan, state }
  }

  async #planNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedChannelPermissionOverwriteRequest,
    options: RequestOptions,
  ): Promise<ChannelPermissionOverwritePlan> {
    return (await this.#buildPlan(applicationId, botId, request, options)).plan
  }

  plan(
    applicationId: string,
    botId: string,
    request: ChannelPermissionOverwriteRequest,
    options: RequestOptions = {},
  ): Promise<ChannelPermissionOverwritePlan> {
    return this.#planNormalized(
      applicationId,
      botId,
      normalizeChannelPermissionOverwriteRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: ChannelPermissionOverwriteRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelPermissionOverwriteResult> {
    const normalized = normalizeChannelPermissionOverwriteRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord channel permission-overwrite plan digest is invalid")
    }
    return withChannelLock(
      normalized.channelId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ChannelPermissionOverwriteExecutionError(
        "Discord channel permission change was blocked because a prior same-channel operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          targetId: normalized.targetId,
          targetType: normalized.targetType,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedChannelPermissionOverwriteRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ChannelPermissionOverwriteResult> {
    let built: BuiltChannelPermissionOverwritePlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ChannelPermissionOverwriteStateError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ChannelPermissionOverwritePlanChangedError(
          expectedDigest,
          STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new ChannelPermissionOverwritePlanChangedError(
        expectedDigest,
        plan.digest,
      )
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: plan.guild.id,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      targetId: request.targetId,
      targetType: request.targetType,
    }
    if (plan.action === "none") {
      return {
        ...baseResult,
        activityId: null,
        observedOverwrite: plan.currentOverwrite,
        overwriteSetMatched: true,
        status: "already-current",
        targetMatched: true,
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: plan.guild.id,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ChannelPermissionOverwriteOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        guildId: plan.guild.id,
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
          guildId: plan.guild.id,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ChannelPermissionOverwriteExecutionError(
        "Discord channel permission change was blocked because pending activity could not be recorded",
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

    let mutationCompleted = false
    let observedOverwrite: ChannelPermissionOverwriteView | null = null
    let overwriteSetMatched: boolean | null = null
    let targetMatched: boolean | null = null
    try {
      if (plan.action === "put") {
        const desired = state.desiredOverwrite as CanonicalOverwrite
        await this.#client.editChannelPermissionOverwrite(
          request.channelId,
          request.targetId,
          {
            allow: desired.allow.toString(),
            deny: desired.deny.toString(),
            type: desired.type,
          },
          request.auditReason,
          options,
        )
      } else {
        await this.#client.deleteChannelPermissionOverwrite(
          request.channelId,
          request.targetId,
          request.auditReason,
          options,
        )
      }
      mutationCompleted = true
      const observedChannel = exactDirectChannel(
        await this.#client.getChannel(request.channelId, options),
        request.channelId,
      )
      if (observedChannel.guild_id !== plan.guild.id) {
        throw new ChannelPermissionOverwriteStateError(
          "Discord permission-overwrite readback changed guild identity",
        )
      }
      const observed = canonicalOverwrites(observedChannel, "readback channel")
      const observedTarget = observed.find((overwrite) => (
        overwrite.id === request.targetId
        && overwrite.type === request.targetTypeCode
      ))
      observedOverwrite = observedTarget ? overwriteView(observedTarget) : null
      targetMatched = stableString(
        observedTarget ? overwriteSnapshot([observedTarget])[0] : null,
      ) === stableString(
        state.desiredOverwrite ? overwriteSnapshot([state.desiredOverwrite])[0] : null,
      )
      overwriteSetMatched = stableString(overwriteSnapshot(observed))
        === stableString(overwriteSnapshot(state.desiredOverwrites))
    } catch (error) {
      const status = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: plan.guild.id,
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
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelPermissionOverwriteExecutionError(
        "Discord channel permission change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          observedOverwrite,
          operationRecordError,
          overwriteSetMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          targetMatched,
        },
        { cause: error },
      )
    }

    const verification = targetMatched && overwriteSetMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: ChannelPermissionOverwriteResult = {
      ...baseResult,
      activityId,
      observedOverwrite,
      overwriteSetMatched,
      status,
      targetMatched,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: plan.guild.id,
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
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelPermissionOverwriteExecutionError(
        "Discord channel permission change completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
        { cause: error },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ChannelPermissionOverwriteExecutionError(
        "Discord channel permission change completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return result
  }
}
