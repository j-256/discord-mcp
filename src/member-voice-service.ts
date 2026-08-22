import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MemberVoiceActivity,
  MemberVoiceActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_DIRECTORY_LIMITS,
  MEMBER_VOICE_ACTIONS,
  SCHEMA_VERSION,
  type MemberVoiceAction,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildMemberVoiceUpdate,
  type DiscordVoiceStateSummary,
  type ModifyGuildMemberVoiceInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  MemberVoiceEvidenceError,
  MemberVoiceExecutionError,
  MemberVoiceOperationConflictError,
  MemberVoicePlanChangedError,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  evaluatePrincipalPermissions,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
  type PrincipalPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import { normalizeDiscordRoleInventory } from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const UNKNOWN_VOICE_STATE_CODE = 10065
const STATE_UNAVAILABLE = "member-voice-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const AUDIT_PERMISSIONS = [
  "VIEW_CHANNEL",
  "CONNECT",
] as const satisfies readonly DiscordPermissionName[]
const VOICE_STATE_OMITTED_FIELDS = Object.freeze([
  "embedded member",
  "request-to-speak timestamp",
  "self camera state",
  "self deaf state",
  "self mute state",
  "self stream state",
  "session ID",
  "Stage suppression state",
  "unknown field values",
])

type MemberVoiceTargetOutcome = "settled" | "uncertain"

interface MemberVoiceLockState {
  tails: Map<string, Promise<MemberVoiceTargetOutcome>>
  uncertainTargets: Set<string>
}

const MEMBER_VOICE_LOCKS = new WeakMap<OperationStore, MemberVoiceLockState>()

function memberVoiceLocks(operationStore: OperationStore): MemberVoiceLockState {
  let state = MEMBER_VOICE_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainTargets: new Set() }
    MEMBER_VOICE_LOCKS.set(operationStore, state)
  }
  return state
}

interface MemberVoiceRequestBase {
  action: MemberVoiceAction
  auditReason: string
  guildId: string
  operationKey: string
  userId: string
}

export type MemberVoiceChangeRequest = MemberVoiceRequestBase & (
  | { action: "disconnect" }
  | { action: "move"; destinationChannelId: string }
  | { action: "set-server-deafen"; enabled: boolean }
  | { action: "set-server-mute"; enabled: boolean }
)

interface NormalizedMemberVoiceRequestBase {
  action: MemberVoiceAction
  auditReason: string
  guildId: string
  operationKeyHash: string
  userId: string
}

export type NormalizedMemberVoiceChangeRequest = NormalizedMemberVoiceRequestBase & (
  | { action: "disconnect" }
  | { action: "move"; destinationChannelId: string }
  | { action: "set-server-deafen"; enabled: boolean }
  | { action: "set-server-mute"; enabled: boolean }
)

export interface MemberVoiceChannelView {
  guildId: string
  id: string
  name: string
  type: "stage" | "voice"
}

export interface MemberVoiceStateView {
  channel: MemberVoiceChannelView | null
  connected: boolean
  serverDeafened: boolean | null
  serverMuted: boolean | null
  unknownFieldCount: number
  userId: string
}

export interface MemberVoicePermissionEvidence {
  administrator: boolean
  allowed: true
  appliedRoleIds: string[]
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  guildOwner: boolean
  requiredPermissions: DiscordPermissionName[]
  unknownPermissionBits: "0"
  warnings: string[]
}

export interface MemberVoiceHierarchyEvidence {
  botHighestRoleIds: string[]
  botHighestRolePosition: number
  targetAdministrator: false
  targetBelowBot: true
  targetHighestRoleIds: string[]
  targetHighestRolePosition: number
}

export interface MemberVoicePrivacyProjection {
  enumeration: "none"
  omittedFields: readonly string[]
  persistence: "content-free-outcomes-only"
  rawPayloadExposed: false
}

export interface MemberVoiceAuditResult {
  applicationId: string
  botId: string
  guild: { id: string; name: string; ownerId: string }
  member: { id: string; username: string }
  permission: MemberVoicePermissionEvidence | null
  privacy: MemberVoicePrivacyProjection
  schemaVersion: number
  state: MemberVoiceStateView
  status: "ok"
  warnings: string[]
}

export interface MemberVoiceChangePlan extends Omit<MemberVoiceAuditResult, "status"> {
  action: MemberVoiceAction
  auditReason: string
  createdAt: string
  destination: MemberVoiceChannelView | null
  destinationBotPermission: MemberVoicePermissionEvidence | null
  destinationTargetPermission: MemberVoicePermissionEvidence | null
  digest: string
  hierarchy: MemberVoiceHierarchyEvidence
  operationKeyHash: string
  requestedEnabled: boolean | null
  risks: string[]
  status: "already-current" | "planned"
  writeRequired: boolean
}

export interface MemberVoiceChangeResult {
  action: MemberVoiceAction
  activityId: string | null
  guildId: string
  observed: MemberVoiceStateView
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  userId: string
  verification: "drift" | "match" | "not-required"
}

export interface MemberVoiceServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getGuildVoiceState"
    | "modifyGuildMemberVoice"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface VoiceChannelEvidence extends DiscordChannel {
  guild_id: string
  name: string
  permission_overwrites: DiscordPermissionOverwrite[]
  type: typeof DISCORD_CHANNEL_TYPES.voice | typeof DISCORD_CHANNEL_TYPES.stageVoice
}

interface MemberVoiceEvidenceState {
  botMember: DiscordGuildMember
  destination: VoiceChannelEvidence | null
  destinationBotPermission: MemberVoicePermissionEvidence | null
  destinationTargetPermission: MemberVoicePermissionEvidence | null
  guild: DiscordGuild & { name: string; owner_id: string }
  hierarchy: MemberVoiceHierarchyEvidence | null
  roles: DiscordRole[]
  source: VoiceChannelEvidence | null
  sourcePermission: MemberVoicePermissionEvidence | null
  targetMember: DiscordGuildMember & { user: NonNullable<DiscordGuildMember["user"]> }
  voice: DiscordVoiceStateSummary | null
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (!validSnowflake(value)) {
    throw new RangeError(`${description} must be a positive Discord snowflake`)
  }
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

const BASE_REQUEST_KEYS = [
  "action",
  "auditReason",
  "guildId",
  "operationKey",
  "userId",
] as const

export function normalizeMemberVoiceChangeRequest(
  request: MemberVoiceChangeRequest,
): NormalizedMemberVoiceChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord member voice change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (!MEMBER_VOICE_ACTIONS.includes(record.action as MemberVoiceAction)) {
    throw new RangeError("Discord member voice action is unsupported")
  }
  assertSnowflake(record.guildId, "Discord member voice guild ID")
  assertSnowflake(record.userId, "Discord member voice user ID")
  if (typeof record.auditReason !== "string") {
    throw new RangeError("Discord member voice audit reason must be a string")
  }
  encodeDiscordAuditReason(record.auditReason)
  const operationKeyHashValue = operationKeyHash(record.operationKey as string)
  const base = {
    auditReason: record.auditReason,
    guildId: record.guildId,
    operationKeyHash: operationKeyHashValue,
    userId: record.userId,
  }
  if (record.action === "disconnect") {
    if (!onlyKeys(record, BASE_REQUEST_KEYS)) {
      throw new RangeError("Discord member voice disconnect accepts no action-specific fields")
    }
    return { ...base, action: "disconnect" }
  }
  if (record.action === "move") {
    if (!onlyKeys(record, [...BASE_REQUEST_KEYS, "destinationChannelId"])) {
      throw new RangeError("Discord member voice move accepts one destination channel ID")
    }
    assertSnowflake(record.destinationChannelId, "Discord member voice destination channel ID")
    return {
      ...base,
      action: "move",
      destinationChannelId: record.destinationChannelId,
    }
  }
  if (!onlyKeys(record, [...BASE_REQUEST_KEYS, "enabled"])) {
    throw new RangeError("Discord member voice mute or deafen accepts one enabled field")
  }
  if (typeof record.enabled !== "boolean") {
    throw new RangeError("Discord member voice enabled state must be a boolean")
  }
  return record.action === "set-server-mute"
    ? { ...base, action: "set-server-mute", enabled: record.enabled }
    : { ...base, action: "set-server-deafen", enabled: record.enabled }
}

export function assertMemberVoiceGetInput(guildId: string, userId: string): void {
  assertSnowflake(guildId, "Discord member voice guild ID")
  assertSnowflake(userId, "Discord member voice user ID")
}

function evidenceError(message: string, cause?: unknown): MemberVoiceEvidenceError {
  return new MemberVoiceEvidenceError(
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
    throw evidenceError("Discord returned invalid member voice guild evidence")
  }
  return value as DiscordGuild & { name: string; owner_id: string }
}

function exactMember(
  value: DiscordGuildMember,
  userId: string,
  requireBot: boolean,
): DiscordGuildMember & { user: NonNullable<DiscordGuildMember["user"]> } {
  const username = value?.user?.username
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.user?.id !== userId
    || (requireBot && value.user.bot !== true)
    || typeof username !== "string"
    || username.length < 1
    || [...username].length > MEMBER_DIRECTORY_LIMITS.nameCharacters
    || TEXT_CONTROL_PATTERN.test(username)
    || !validUnicode(username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.some((roleId) => !validSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
    || (value.pending !== undefined && typeof value.pending !== "boolean")
  ) {
    throw evidenceError("Discord returned invalid or mismatched member voice membership evidence")
  }
  return value as DiscordGuildMember & {
    user: NonNullable<DiscordGuildMember["user"]>
  }
}

function exactRoles(
  values: readonly DiscordRole[],
  guildId: string,
  members: readonly DiscordGuildMember[],
): DiscordRole[] {
  try {
    normalizeDiscordRoleInventory(values, guildId)
  } catch (error) {
    throw evidenceError(
      `Discord member voice role evidence is invalid: ${errorMessage(error)}`,
      error,
    )
  }
  const ids = new Set(values.map((role) => role.id))
  for (const member of members) {
    if (member.roles.some((roleId) => !ids.has(roleId))) {
      throw evidenceError("Discord member voice evidence references an unknown role")
    }
  }
  return [...values]
}

function exactOverwrites(
  value: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.channelPermissionOverwrites
  ) {
    throw evidenceError("Discord member voice channel omitted complete overwrite evidence")
  }
  const seen = new Set<string>()
  const projected: DiscordPermissionOverwrite[] = []
  for (const item of value as readonly unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw evidenceError("Discord returned malformed member voice overwrite evidence")
    }
    const overwrite = item as Partial<DiscordPermissionOverwrite>
    const key = `${overwrite.type}:${overwrite.id}`
    if (
      !validSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(overwrite.allow)
      || typeof overwrite.deny !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(overwrite.deny)
      || (BigInt(overwrite.allow) & BigInt(overwrite.deny)) !== 0n
      || seen.has(key)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
    ) {
      throw evidenceError("Discord returned invalid, duplicate, or unresolved member voice overwrite evidence")
    }
    seen.add(key)
    projected.push({
      allow: overwrite.allow,
      deny: overwrite.deny,
      id: overwrite.id,
      type: overwrite.type,
    } as DiscordPermissionOverwrite)
  }
  return projected.sort((left, right) => {
    const leftId = BigInt(left.id)
    const rightId = BigInt(right.id)
    if (leftId < rightId) return -1
    if (leftId > rightId) return 1
    return left.type - right.type
  })
}

function exactChannel(
  value: DiscordChannel,
  guildId: string,
  channelId: string,
  roleIds: ReadonlySet<string>,
): VoiceChannelEvidence {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== channelId
    || value.guild_id !== guildId
    || (
      value.type !== DISCORD_CHANNEL_TYPES.voice
      && value.type !== DISCORD_CHANNEL_TYPES.stageVoice
    )
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
  ) {
    throw evidenceError("Discord returned a mismatched or unsupported member voice channel")
  }
  return {
    ...value,
    permission_overwrites: exactOverwrites(value.permission_overwrites, roleIds),
  } as VoiceChannelEvidence
}

function exactVoiceState(
  value: DiscordVoiceStateSummary,
  guildId: string,
  userId: string,
): DiscordVoiceStateSummary {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.userId !== userId
    || !(value.guildId === null || value.guildId === guildId)
    || !(value.channelId === null || validSnowflake(value.channelId))
    || typeof value.mute !== "boolean"
    || typeof value.deaf !== "boolean"
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) {
    throw evidenceError("Discord returned invalid or mismatched member voice state")
  }
  return value
}

async function optionalVoiceState(
  client: MemberVoiceServiceOptions["client"],
  guildId: string,
  userId: string,
  options: RequestOptions,
): Promise<DiscordVoiceStateSummary | null> {
  try {
    const state = exactVoiceState(
      await client.getGuildVoiceState(guildId, userId, options),
      guildId,
      userId,
    )
    return state.channelId === null ? null : state
  } catch (error) {
    if (error instanceof DiscordApiError && error.code === UNKNOWN_VOICE_STATE_CODE) {
      return null
    }
    throw error
  }
}

function guildPermissions(
  member: DiscordGuildMember,
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
  if (
    !result.complete
    || result.highestRoleIds.length !== 1
    || unknownDiscordPermissionBits(BigInt(result.effectivePermissions)) !== 0n
  ) {
    throw evidenceError(`Discord ${description} permission evidence is incomplete or unknown`)
  }
  return result
}

function channelPermission(
  options: {
    channel: VoiceChannelEvidence
    guildId: string
    guildOwnerId: string
    member: DiscordGuildMember
    roles: readonly DiscordRole[]
    subjectId: string
  },
  requiredPermissions: readonly DiscordPermissionName[],
  description: string,
): MemberVoicePermissionEvidence {
  let result: PrincipalPermissionResult
  try {
    result = evaluatePrincipalPermissions({
      channel: options.channel,
      guildId: options.guildId,
      guildOwnerId: options.guildOwnerId,
      permissionChannel: options.channel,
      requestedPermissions: requiredPermissions,
      roles: options.roles,
      subject: {
        id: options.subjectId,
        kind: "member",
        member: options.member,
      },
    })
  } catch (error) {
    throw evidenceError(`Discord ${description} channel permission evidence is invalid`, error)
  }
  if (
    result.confidence !== "complete"
    || result.allowed !== true
    || result.unknownPermissionBits !== "0"
    || result.missingPermissions.length > 0
    || result.ineffectivePermissions.length > 0
  ) {
    throw evidenceError(`Discord ${description} lacks complete required channel permissions`)
  }
  return {
    administrator: result.administrator,
    allowed: true,
    appliedRoleIds: [...result.appliedRoleIds],
    effectivePermissionNames: [...result.effectivePermissionNames],
    effectivePermissions: result.effectivePermissions,
    guildOwner: result.guildOwner,
    requiredPermissions: [...requiredPermissions],
    unknownPermissionBits: "0",
    warnings: [...result.warnings],
  }
}

function sourcePermissions(action: MemberVoiceAction): DiscordPermissionName[] {
  if (action === "set-server-mute") {
    return ["VIEW_CHANNEL", "CONNECT", "MUTE_MEMBERS"]
  }
  if (action === "set-server-deafen") {
    return ["VIEW_CHANNEL", "CONNECT", "DEAFEN_MEMBERS"]
  }
  return ["VIEW_CHANNEL", "CONNECT", "MOVE_MEMBERS"]
}

function channelView(channel: VoiceChannelEvidence): MemberVoiceChannelView {
  return {
    guildId: channel.guild_id,
    id: channel.id,
    name: channel.name,
    type: channel.type === DISCORD_CHANNEL_TYPES.voice ? "voice" : "stage",
  }
}

function voiceStateView(
  userId: string,
  voice: DiscordVoiceStateSummary | null,
  channel: VoiceChannelEvidence | null,
): MemberVoiceStateView {
  return {
    channel: channel ? channelView(channel) : null,
    connected: voice !== null,
    serverDeafened: voice?.deaf ?? null,
    serverMuted: voice?.mute ?? null,
    unknownFieldCount: voice?.unknownFieldCount ?? 0,
    userId,
  }
}

function privacyProjection(): MemberVoicePrivacyProjection {
  return {
    enumeration: "none",
    omittedFields: VOICE_STATE_OMITTED_FIELDS,
    persistence: "content-free-outcomes-only",
    rawPayloadExposed: false,
  }
}

function channelSnapshot(channel: VoiceChannelEvidence | null) {
  if (!channel) return null
  return {
    guildId: channel.guild_id,
    id: channel.id,
    name: channel.name,
    permissionOverwrites: channel.permission_overwrites,
    type: channel.type,
  }
}

function rolesSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    permissions: role.permissions,
    position: role.position,
  })).sort((left, right) => left.id.localeCompare(right.id))
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
  return normalized || "UnknownError"
}

function targetKey(guildId: string, userId: string): string {
  return `${guildId}\0${userId}`
}

function executionBlocksTarget(error: unknown): boolean {
  if (
    !(error instanceof MemberVoiceExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withTargetLock<T>(
  state: MemberVoiceLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => MemberVoiceExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: MemberVoiceTargetOutcome) => void = () => undefined
  const tail = new Promise<MemberVoiceTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: MemberVoiceTargetOutcome = "settled"
  try {
    await prior
    if (state.uncertainTargets.has(key)) {
      outcome = "uncertain"
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
  plan: MemberVoiceChangePlan
  request: NormalizedMemberVoiceChangeRequest
  status: MemberVoiceActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): MemberVoiceActivity {
  return {
    action: options.request.action,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "member-voice-change",
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
  plan: MemberVoiceChangePlan
  request: NormalizedMemberVoiceChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "member-voice-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.request.userId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function mutationInput(
  request: NormalizedMemberVoiceChangeRequest,
): ModifyGuildMemberVoiceInput {
  if (request.action === "move") return { channelId: request.destinationChannelId }
  if (request.action === "disconnect") return { channelId: null }
  if (request.action === "set-server-mute") return { mute: request.enabled }
  return { deaf: request.enabled }
}

function writeResponseHasControlledState(
  response: DiscordGuildMemberVoiceUpdate,
  request: NormalizedMemberVoiceChangeRequest,
): boolean {
  if (request.action === "set-server-mute") return response.mute === request.enabled
  if (request.action === "set-server-deafen") return response.deaf === request.enabled
  return true
}

function uncontrolledResponseMatches(
  response: DiscordGuildMemberVoiceUpdate,
  request: NormalizedMemberVoiceChangeRequest,
  before: DiscordVoiceStateSummary,
): boolean {
  if (request.action === "set-server-mute") return response.deaf === before.deaf
  if (request.action === "set-server-deafen") return response.mute === before.mute
  return response.mute === before.mute && response.deaf === before.deaf
}

function readbackControlledStateMatches(
  readback: DiscordVoiceStateSummary | null,
  request: NormalizedMemberVoiceChangeRequest,
  before: DiscordVoiceStateSummary,
): boolean {
  if (request.action === "disconnect") return readback === null
  if (request.action === "move") {
    return readback?.channelId === request.destinationChannelId
  }
  if (!readback || readback.channelId !== before.channelId) return false
  return request.action === "set-server-mute"
    ? readback.mute === request.enabled
    : readback.deaf === request.enabled
}

function uncontrolledReadbackMatches(
  readback: DiscordVoiceStateSummary | null,
  request: NormalizedMemberVoiceChangeRequest,
  before: DiscordVoiceStateSummary,
): boolean {
  if (request.action === "disconnect") return true
  if (!readback) return false
  if (request.action === "set-server-mute") return readback.deaf === before.deaf
  if (request.action === "set-server-deafen") return readback.mute === before.mute
  return readback.mute === before.mute && readback.deaf === before.deaf
}

export class MemberVoiceService {
  readonly #activityStore: ActivityStore
  readonly #client: MemberVoiceServiceOptions["client"]
  readonly #clock: () => Date
  readonly #locks: MemberVoiceLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: MemberVoiceServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = memberVoiceLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #evidence(
    applicationId: string,
    botId: string,
    guildId: string,
    userId: string,
    mode: "audit" | "change",
    options: RequestOptions,
    request?: NormalizedMemberVoiceChangeRequest,
  ): Promise<MemberVoiceEvidenceState> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    assertMemberVoiceGetInput(guildId, userId)
    if (mode === "change") {
      this.#policy.assertMemberVoiceChangeable(guildId, userId)
    } else {
      this.#policy.assertMemberVoiceAuditable(guildId)
    }
    if (userId === botId && mode === "change") {
      throw evidenceError("Discord member voice changes cannot target the connector bot")
    }
    if (request) {
      const receipt = await this.#operationStore.get(
        "member-voice-change",
        request.operationKeyHash,
      )
      if (receipt) throw new MemberVoiceOperationConflictError(receiptView(receipt))
    }
    const [rawGuild, rawBotMember, rawTargetMember, rawRoles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildMember(guildId, userId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactMember(rawBotMember, botId, true)
    const targetMember = exactMember(rawTargetMember, userId, false)
    const roles = exactRoles(rawRoles, guildId, [botMember, targetMember])
    let hierarchy: MemberVoiceHierarchyEvidence | null = null
    if (mode === "change") {
      const botGuildPermissions = guildPermissions(
        botMember,
        roles,
        guildId,
        "connector bot",
      )
      const targetGuildPermissions = guildPermissions(
        targetMember,
        roles,
        guildId,
        "target member",
      )
      if (userId === guild.owner_id) {
        throw evidenceError("Discord member voice changes cannot target the guild owner")
      }
      if (targetMember.pending) {
        throw evidenceError("Discord member voice changes cannot target a pending member")
      }
      if (targetGuildPermissions.administrator) {
        throw evidenceError("Discord member voice changes cannot target an administrator")
      }
      if (botGuildPermissions.highestRolePosition <= targetGuildPermissions.highestRolePosition) {
        throw evidenceError("Discord member voice target must be strictly below the connector bot's highest role")
      }
      hierarchy = {
        botHighestRoleIds: [...botGuildPermissions.highestRoleIds],
        botHighestRolePosition: botGuildPermissions.highestRolePosition,
        targetAdministrator: false,
        targetBelowBot: true,
        targetHighestRoleIds: [...targetGuildPermissions.highestRoleIds],
        targetHighestRolePosition: targetGuildPermissions.highestRolePosition,
      }
    }
    const voice = await optionalVoiceState(
      this.#client,
      guildId,
      userId,
      options,
    )
    const roleIds = new Set(roles.map((role) => role.id))
    let source: VoiceChannelEvidence | null = null
    let sourcePermission: MemberVoicePermissionEvidence | null = null
    if (voice) {
      this.#policy.assertMemberVoiceChannelAllowed(voice.channelId as string)
      source = exactChannel(
        await this.#client.getChannel(voice.channelId as string, options),
        guildId,
        voice.channelId as string,
        roleIds,
      )
      if (mode === "change" && source.type !== DISCORD_CHANNEL_TYPES.voice) {
        throw evidenceError("Discord Stage participants are read-only through member voice moderation")
      }
      sourcePermission = channelPermission({
        channel: source,
        guildId,
        guildOwnerId: guild.owner_id,
        member: botMember,
        roles,
        subjectId: botId,
      }, request ? sourcePermissions(request.action) : AUDIT_PERMISSIONS, "connector bot")
    }
    let destination: VoiceChannelEvidence | null = null
    let destinationBotPermission: MemberVoicePermissionEvidence | null = null
    let destinationTargetPermission: MemberVoicePermissionEvidence | null = null
    if (request?.action === "move") {
      this.#policy.assertMemberVoiceChannelAllowed(request.destinationChannelId)
      destination = request.destinationChannelId === source?.id
        ? source
        : exactChannel(
            await this.#client.getChannel(request.destinationChannelId, options),
            guildId,
            request.destinationChannelId,
            roleIds,
          )
      if (destination.type !== DISCORD_CHANNEL_TYPES.voice) {
        throw evidenceError("Discord member voice moves require an ordinary voice destination")
      }
      destinationBotPermission = channelPermission({
        channel: destination,
        guildId,
        guildOwnerId: guild.owner_id,
        member: botMember,
        roles,
        subjectId: botId,
      }, ["VIEW_CHANNEL", "CONNECT", "MOVE_MEMBERS"], "connector bot destination")
      destinationTargetPermission = channelPermission({
        channel: destination,
        guildId,
        guildOwnerId: guild.owner_id,
        member: targetMember,
        roles,
        subjectId: userId,
      }, ["VIEW_CHANNEL", "CONNECT"], "target member destination")
    }
    if (request && request.action !== "disconnect" && !voice) {
      throw evidenceError("Discord member voice action requires the target to be connected")
    }
    return {
      botMember,
      destination,
      destinationBotPermission,
      destinationTargetPermission,
      guild,
      hierarchy,
      roles,
      source,
      sourcePermission,
      targetMember,
      voice,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<MemberVoiceAuditResult> {
    const state = await this.#evidence(
      applicationId,
      botId,
      guildId,
      userId,
      "audit",
      options,
    )
    return {
      applicationId,
      botId,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      member: { id: userId, username: state.targetMember.user.username },
      permission: state.sourcePermission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      state: voiceStateView(userId, state.voice, state.source),
      status: "ok",
      warnings: [
        ...(state.sourcePermission?.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped voice permissions"]
          : []),
        ...(state.voice?.unknownFieldCount
          ? [`Discord voice state contains ${state.voice.unknownFieldCount} unknown top-level fields whose values were discarded`]
          : []),
        "This exact lookup never enumerates voice-channel occupants",
      ],
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedMemberVoiceChangeRequest,
    options: RequestOptions,
  ): Promise<MemberVoiceChangePlan> {
    const state = await this.#evidence(
      applicationId,
      botId,
      request.guildId,
      request.userId,
      "change",
      options,
      request,
    )
    if (!state.hierarchy) {
      throw evidenceError("Discord member voice change omitted hierarchy evidence")
    }
    const hierarchy = state.hierarchy
    const writeRequired = request.action === "disconnect"
      ? state.voice !== null
      : request.action === "move"
        ? state.voice?.channelId !== request.destinationChannelId
        : request.action === "set-server-mute"
          ? state.voice?.mute !== request.enabled
          : state.voice?.deaf !== request.enabled
    const warnings = [
      ...(state.sourcePermission?.administrator || state.destinationBotPermission?.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped voice permissions"]
        : []),
      ...(state.voice?.unknownFieldCount
        ? [`Discord voice state contains ${state.voice.unknownFieldCount} unknown top-level fields whose values were discarded`]
        : []),
      "Role hierarchy is enforced as a local safety boundary even where Discord voice permissions do not require it",
      "Same-member serialization and uncertainty quarantine are process-local",
      "The operation key is one-shot and cannot be retried after reservation",
      "This workflow performs one exact non-retried member PATCH and never rolls back",
    ]
    const risks = writeRequired
      ? [
          request.action === "move"
            ? "The exact member will immediately leave the source voice channel and join the reviewed destination"
            : request.action === "disconnect"
              ? "The exact member will immediately leave voice"
              : request.action === "set-server-mute"
                ? `The exact member will be server-${request.enabled ? "muted" : "unmuted"}`
                : `The exact member will be server-${request.enabled ? "deafened" : "undeafened"}`,
          "A transport or readback failure after dispatch creates an uncertain outcome that blocks later same-member changes in this process",
        ]
      : []
    const current = voiceStateView(request.userId, state.voice, state.source)
    const destination = state.destination ? channelView(state.destination) : null
    const privacy = privacyProjection()
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      current,
      destination: channelSnapshot(state.destination),
      destinationBotPermission: state.destinationBotPermission,
      destinationTargetPermission: state.destinationTargetPermission,
      domain: "discord-mcp-member-voice-change-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      hierarchy,
      privacy,
      request,
      risks,
      roles: rolesSnapshot(state.roles),
      source: channelSnapshot(state.source),
      sourcePermission: state.sourcePermission,
      targetMember: {
        pending: state.targetMember.pending ?? false,
        roles: [...state.targetMember.roles].sort(),
        userId: state.targetMember.user.id,
        username: state.targetMember.user.username,
      },
      warnings,
    })
    return {
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      destination,
      destinationBotPermission: state.destinationBotPermission,
      destinationTargetPermission: state.destinationTargetPermission,
      digest,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      hierarchy,
      member: { id: request.userId, username: state.targetMember.user.username },
      operationKeyHash: request.operationKeyHash,
      permission: state.sourcePermission,
      privacy,
      requestedEnabled: "enabled" in request ? request.enabled : null,
      risks,
      schemaVersion: SCHEMA_VERSION,
      state: current,
      status: writeRequired ? "planned" : "already-current",
      warnings,
      writeRequired,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: MemberVoiceChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberVoiceChangePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeMemberVoiceChangeRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: MemberVoiceChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberVoiceChangeResult> {
    const normalized = normalizeMemberVoiceChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord member voice plan digest is invalid")
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
      () => new MemberVoiceExecutionError(
        "Discord member voice change was blocked because a prior same-member operation ended without a durable outcome",
        {
          action: normalized.action,
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
    request: NormalizedMemberVoiceChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<MemberVoiceChangeResult> {
    let plan: MemberVoiceChangePlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof MemberVoiceEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new MemberVoicePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new MemberVoicePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
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
        observed: plan.state,
        status: "already-current",
        verification: "not-required",
      }
    }
    const before = plan.state
    if (!before.connected || !before.channel) {
      throw new MemberVoicePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
    }
    const beforeVoice: DiscordVoiceStateSummary = {
      channelId: before.channel.id,
      deaf: before.serverDeafened as boolean,
      guildId: request.guildId,
      mute: before.serverMuted as boolean,
      unknownFieldCount: before.unknownFieldCount,
      userId: request.userId,
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new MemberVoiceOperationConflictError(receiptView(reservation.receipt))
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
      throw new MemberVoiceExecutionError(
        "Discord member voice change was blocked because pending activity could not be recorded",
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
    let observedVoice: DiscordVoiceStateSummary | null = null
    let responseDrift = false
    let readbackDrift = false
    try {
      mutationStarted = true
      const response = await this.#client.modifyGuildMemberVoice(
        request.guildId,
        request.userId,
        mutationInput(request),
        request.auditReason,
        options,
      )
      mutationReturned = true
      if (response.userId !== request.userId) {
        throw evidenceError("Discord returned a member voice write response for another user")
      }
      if (!writeResponseHasControlledState(response, request)) {
        throw evidenceError("Discord member voice write response did not prove the controlled state")
      }
      responseDrift = !uncontrolledResponseMatches(response, request, beforeVoice)
      observedVoice = await optionalVoiceState(
        this.#client,
        request.guildId,
        request.userId,
        options,
      )
      if (observedVoice?.channelId) {
        this.#policy.assertMemberVoiceChannelAllowed(observedVoice.channelId)
      }
      if (!readbackControlledStateMatches(observedVoice, request, beforeVoice)) {
        throw evidenceError("Discord member voice readback did not match the controlled state")
      }
      readbackDrift = !uncontrolledReadbackMatches(observedVoice, request, beforeVoice)
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
      throw new MemberVoiceExecutionError(
        "Discord member voice change did not complete with a verified successful outcome",
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

    const verification = responseDrift || readbackDrift ? "drift" : "match"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const observed = observedVoice
      ? {
          channel: request.action === "move"
            ? plan.destination
            : plan.state.channel,
          connected: true,
          serverDeafened: observedVoice.deaf,
          serverMuted: observedVoice.mute,
          unknownFieldCount: observedVoice.unknownFieldCount,
          userId: request.userId,
        }
      : voiceStateView(request.userId, null, null)
    const result: MemberVoiceChangeResult = {
      ...baseResult,
      activityId,
      observed,
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
      throw new MemberVoiceExecutionError(
        "Discord member voice change completed but the operation receipt failed",
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
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new MemberVoiceExecutionError(
        "Discord member voice change completed but the final activity record failed",
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
