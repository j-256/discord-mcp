import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  VoiceChannelStatusActivity,
  VoiceChannelStatusActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordChannelMetadata,
  type DiscordClient,
  type DiscordVoiceStateSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  GatewayVoiceChannelStatusError,
  VoiceChannelStatusEvidenceError,
  VoiceChannelStatusExecutionError,
  VoiceChannelStatusOperationConflictError,
  VoiceChannelStatusPlanChangedError,
} from "./errors.js"
import type {
  GatewayVoiceChannelStatusSnapshot,
  GatewayVoiceChannelStatusSource,
  GatewayVoiceChannelStatusUpdate,
} from "./gateway-voice-channel-status.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_PERMISSION_NAMES,
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
  parseDiscordPermissionBits,
  type DiscordPermissionName,
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
const STATE_UNAVAILABLE = "voice-channel-status-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const REQUEST_KEYS = [
  "auditReason",
  "channelId",
  "guildId",
  "operationKey",
  "status",
] as const
const BASE_CHANGE_PERMISSIONS = [
  "VIEW_CHANNEL",
  "SET_VOICE_CHANNEL_STATUS",
] as const satisfies readonly DiscordPermissionName[]

type VoiceChannelStatusTargetOutcome = "settled" | "uncertain"

interface VoiceChannelStatusLockState {
  tails: Map<string, Promise<VoiceChannelStatusTargetOutcome>>
  uncertainChannels: Set<string>
}

const VOICE_CHANNEL_STATUS_LOCKS = new WeakMap<OperationStore, VoiceChannelStatusLockState>()

function voiceChannelStatusLocks(operationStore: OperationStore): VoiceChannelStatusLockState {
  let state = VOICE_CHANNEL_STATUS_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainChannels: new Set() }
    VOICE_CHANNEL_STATUS_LOCKS.set(operationStore, state)
  }
  return state
}

export interface VoiceChannelStatusChangeRequest {
  auditReason: string
  channelId: string
  guildId: string
  operationKey: string
  status: string | null
}

export interface NormalizedVoiceChannelStatusChangeRequest {
  auditReason: string
  channelId: string
  guildId: string
  operationKeyHash: string
  status: string | null
}

export type VoiceChannelStatusBotConnection = "disconnected" | "other" | "target"

export interface VoiceChannelStatusPermissionEvidence {
  appliedRoleIds: string[]
  authorizedForChange: true
  botAdministrator: boolean
  botGuildOwner: boolean
  botConnection: VoiceChannelStatusBotConnection
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageChannelsRequired: boolean
  missingPermissions: []
  requiredPermissions: DiscordPermissionName[]
  unknownPermissionBits: string
  warnings: string[]
}

export interface VoiceChannelStatusPrivacyProjection {
  auditReasonPersisted: false
  enumeration: "none"
  nonTargetChannelIdsExposed: false
  nonTargetStatusText: "discarded-before-projection"
  persistence: "content-free-outcomes-only"
  rawPayloads: "omitted"
  statusTextPersisted: false
}

export interface VoiceChannelStatusReadResult {
  botConnection: VoiceChannelStatusBotConnection
  channel: {
    guildId: string
    id: string
    name: string
    type: "voice"
  }
  current: GatewayVoiceChannelStatusSnapshot
  guild: {
    id: string
    name: string
  }
  permission: VoiceChannelStatusPermissionEvidence
  privacy: VoiceChannelStatusPrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface VoiceChannelStatusPlan {
  applicationId: string
  auditReason: string
  botConnection: VoiceChannelStatusBotConnection
  botId: string
  channel: VoiceChannelStatusReadResult["channel"]
  createdAt: string
  current: GatewayVoiceChannelStatusSnapshot
  desiredStatus: string | null
  digest: string
  guild: VoiceChannelStatusReadResult["guild"]
  localLimits: {
    statusCharacters: number
  }
  operationKeyHash: string
  permission: VoiceChannelStatusPermissionEvidence
  privacy: VoiceChannelStatusPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
  writeRequired: boolean
}

export interface VoiceChannelStatusResult {
  activityId: string | null
  channelId: string
  guildId: string
  observed: GatewayVoiceChannelStatusSnapshot
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  settlementEvent: "different" | "matched" | "not-observed"
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
}

export interface VoiceChannelStatusServiceClient extends Pick<
  DiscordClient,
  | "getCurrentUserVoiceState"
  | "getGuild"
  | "getGuildChannelMetadata"
  | "getGuildMember"
  | "getGuildRoles"
  | "setVoiceChannelStatus"
> {}

export interface VoiceChannelStatusServiceOptions {
  activityStore: ActivityStore
  client: VoiceChannelStatusServiceClient
  clock?: () => Date
  gateway: GatewayVoiceChannelStatusSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertChannelMetadataChangeAllowed">
  randomId?: () => string
}

interface VoiceChannelStatusState {
  botConnection: VoiceChannelStatusBotConnection
  botMember: DiscordGuildMember
  current: GatewayVoiceChannelStatusSnapshot
  guild: DiscordGuild & { name: string; owner_id: string }
  metadata: DiscordChannelMetadata
  permission: VoiceChannelStatusPermissionEvidence
  roles: DiscordRole[]
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

export function normalizeVoiceChannelStatusChangeRequest(
  request: VoiceChannelStatusChangeRequest,
): NormalizedVoiceChannelStatusChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord voice channel status request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, REQUEST_KEYS)
    || !REQUEST_KEYS.every((key) => Object.hasOwn(record, key))
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord voice channel status request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord voice channel status guild ID")
  assertPositiveSnowflake(request.channelId, "Discord voice channel status channel ID")
  if (
    request.status !== null
    && (
      typeof request.status !== "string"
      || request.status.length < 1
      || [...request.status].length > DISCORD_LIMITS.voiceChannelStatusCharacters
      || request.status.trim() !== request.status
      || TEXT_CONTROL_PATTERN.test(request.status)
      || !validUnicode(request.status)
    )
  ) {
    throw new RangeError(
      `Discord voice channel status must be null or contain 1-${DISCORD_LIMITS.voiceChannelStatusCharacters} trimmed characters without controls`,
    )
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
    status: request.status,
  }
}

function evidenceError(message: string, cause?: unknown): VoiceChannelStatusEvidenceError {
  return new VoiceChannelStatusEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function metadataChannel(metadata: DiscordChannelMetadata): DiscordChannel {
  return {
    guild_id: metadata.guildId,
    id: metadata.id,
    name: metadata.name,
    parent_id: metadata.parentId,
    permission_overwrites: metadata.permissionOverwrites,
    position: metadata.position,
    type: metadata.type,
  }
}

function exactOverwrites(
  value: unknown,
  roleIds?: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord voice channel omitted complete permission-overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw evidenceError("Discord returned invalid voice-channel permission evidence")
    }
    const overwrite = entry as Partial<DiscordPermissionOverwrite>
    const key = `${overwrite.type}:${overwrite.id}`
    if (
      !positiveSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || typeof overwrite.deny !== "string"
      || seen.has(key)
      || (overwrite.type === 0 && roleIds !== undefined && !roleIds.has(overwrite.id))
    ) {
      throw evidenceError("Discord returned invalid or unresolved voice-channel permission evidence")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(overwrite.allow, "voice-channel overwrite allow")
      deny = parseDiscordPermissionBits(overwrite.deny, "voice-channel overwrite deny")
    } catch (error) {
      throw evidenceError("Discord returned invalid voice-channel permission bits", error)
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned contradictory voice-channel permission evidence")
    }
    seen.add(key)
    return {
      allow: overwrite.allow,
      deny: overwrite.deny,
      id: overwrite.id,
      type: overwrite.type,
    }
  })
}

function exactMetadata(
  value: DiscordChannelMetadata,
  guildId: string,
  channelId: string,
): DiscordChannelMetadata {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== channelId
    || value.guildId !== guildId
    || value.type !== DISCORD_CHANNEL_TYPES.voice
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || !Number.isSafeInteger(value.position)
    || value.position < 0
    || !(value.parentId === null || positiveSnowflake(value.parentId))
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) {
    throw evidenceError("Discord returned mismatched, malformed, or non-voice channel metadata")
  }
  return {
    ...value,
    permissionOverwrites: exactOverwrites(value.permissionOverwrites),
  }
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
    || !positiveSnowflake(value.owner_id)
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.guildNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
  ) throw evidenceError("Discord returned invalid voice-channel guild evidence")
  return value as DiscordGuild & { name: string; owner_id: string }
}

function exactBotMember(
  value: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.user?.id !== botId
    || value.user.bot !== true
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) throw evidenceError("Discord returned invalid connector membership evidence")
  return value
}

function exactRoles(
  value: DiscordRole[],
  guildId: string,
  member: DiscordGuildMember,
): DiscordRole[] {
  try {
    normalizeDiscordRoleInventory(value, guildId)
  } catch (error) {
    throw evidenceError("Discord voice-channel role evidence is invalid", error)
  }
  const ids = new Set(value.map((role) => role.id))
  if (member.roles.some((roleId) => !ids.has(roleId))) {
    throw evidenceError("Discord connector membership references an unknown role")
  }
  return [...value]
}

function exactVoiceState(
  value: DiscordVoiceStateSummary,
  guildId: string,
  botId: string,
): DiscordVoiceStateSummary {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.userId !== botId
    || !(value.guildId === null || value.guildId === guildId)
    || !(value.channelId === null || positiveSnowflake(value.channelId))
    || typeof value.mute !== "boolean"
    || typeof value.deaf !== "boolean"
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) throw evidenceError("Discord returned invalid current-user voice-state evidence")
  return value
}

async function currentBotConnection(
  client: VoiceChannelStatusServiceClient,
  guildId: string,
  channelId: string,
  botId: string,
  options: RequestOptions,
): Promise<VoiceChannelStatusBotConnection> {
  let state: DiscordVoiceStateSummary
  try {
    state = exactVoiceState(
      await client.getCurrentUserVoiceState(guildId, botId, options),
      guildId,
      botId,
    )
  } catch (error) {
    if (error instanceof DiscordApiError && error.code === UNKNOWN_VOICE_STATE_CODE) {
      return "disconnected"
    }
    throw error
  }
  if (state.channelId === null) return "disconnected"
  return state.channelId === channelId ? "target" : "other"
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value
}

function exactGatewaySnapshot(
  value: GatewayVoiceChannelStatusSnapshot,
  guildId: string,
  channelId: string,
): GatewayVoiceChannelStatusSnapshot {
  const representation = value?.evidence?.statusRepresentation
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || value.guildId !== guildId
    || value.channelId !== channelId
    || !(value.status === null || (
      typeof value.status === "string"
      && [...value.status].length <= DISCORD_LIMITS.voiceChannelStatusCharacters
      && !value.status.includes("\0")
      && validUnicode(value.status)
    ))
    || !["null", "omitted", "value"].includes(String(representation))
    || (representation === "value") !== (typeof value.status === "string")
    || !Number.isSafeInteger(value.evidence.discardedChannelEntries)
    || value.evidence.discardedChannelEntries < 0
    || !Number.isSafeInteger(value.evidence.returnedChannelEntries)
    || value.evidence.returnedChannelEntries < 1
    || value.evidence.discardedChannelEntries !== value.evidence.returnedChannelEntries - 1
    || !Number.isSafeInteger(value.evidence.responseUnknownFieldCount)
    || value.evidence.responseUnknownFieldCount < 0
    || !Number.isSafeInteger(value.evidence.targetUnknownFieldCount)
    || value.evidence.targetUnknownFieldCount < 0
    || !Number.isSafeInteger(value.freshness.gatewaySequence)
    || value.freshness.gatewaySequence < 0
    || !validTimestamp(value.freshness.observedAt)
    || !validTimestamp(value.freshness.requestedAt)
    || Date.parse(value.freshness.observedAt) < Date.parse(value.freshness.requestedAt)
    || value.freshness.source !== "gateway-request-channel-info"
    || value.privacy.nonTargetStatusText !== "discarded-before-projection"
    || value.privacy.persistence !== "none"
    || value.privacy.rawPayloads !== "omitted"
    || value.privacy.text !== "transient-untrusted"
  ) throw evidenceError("Discord Gateway returned invalid exact-channel status evidence")
  return value
}

function botConnectionClass(
  connection: VoiceChannelStatusBotConnection,
): VoiceChannelStatusBotConnection {
  return connection
}

function permissionEvidence(options: {
  botConnection: VoiceChannelStatusBotConnection
  botId: string
  guildOwnerId: string
  member: DiscordGuildMember
  metadata: DiscordChannelMetadata
  roles: readonly DiscordRole[]
}): VoiceChannelStatusPermissionEvidence {
  let evaluated
  try {
    const channel = metadataChannel(options.metadata)
    evaluated = evaluateBotChannelPermissions({
      botId: options.botId,
      channel,
      guildId: options.metadata.guildId,
      member: options.member,
      permissionChannel: channel,
      roles: options.roles,
    })
  } catch (error) {
    throw evidenceError("Discord voice-channel permission evidence is invalid", error)
  }
  if (evaluated.confidence !== "complete") {
    throw evidenceError("Discord voice-channel permission evidence is incomplete")
  }
  const botGuildOwner = options.guildOwnerId === options.botId
  const effectivePermissions = botGuildOwner
    ? (ALL_KNOWN_PERMISSION_BITS | BigInt(evaluated.effectivePermissions)).toString()
    : evaluated.effectivePermissions
  const effectivePermissionNames = botGuildOwner
    ? [...DISCORD_PERMISSION_NAMES]
    : [...evaluated.effectivePermissionNames]
  const requiredPermissions: DiscordPermissionName[] = [
    ...BASE_CHANGE_PERMISSIONS,
    ...(options.botConnection === "target" ? [] : ["MANAGE_CHANNELS" as const]),
  ]
  const bits = BigInt(effectivePermissions)
  const missingPermissions = evaluated.administrator || botGuildOwner
    ? []
    : requiredPermissions.filter((name) => (
        (bits & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
      ))
  if (missingPermissions.length > 0) {
    throw evidenceError(
      `Discord connector bot lacks voice-channel status permissions: ${missingPermissions.join(", ")}`,
    )
  }
  return {
    appliedRoleIds: [...evaluated.appliedRoleIds],
    authorizedForChange: true,
    botAdministrator: evaluated.administrator,
    botConnection: botConnectionClass(options.botConnection),
    botGuildOwner,
    effectivePermissionNames,
    effectivePermissions,
    manageChannelsRequired: options.botConnection !== "target",
    missingPermissions: [],
    requiredPermissions,
    unknownPermissionBits: evaluated.unknownPermissionBits,
    warnings: [...evaluated.warnings],
  }
}

function privacyProjection(): VoiceChannelStatusPrivacyProjection {
  return {
    auditReasonPersisted: false,
    enumeration: "none",
    nonTargetChannelIdsExposed: false,
    nonTargetStatusText: "discarded-before-projection",
    persistence: "content-free-outcomes-only",
    rawPayloads: "omitted",
    statusTextPersisted: false,
  }
}

function channelView(metadata: DiscordChannelMetadata): VoiceChannelStatusReadResult["channel"] {
  return {
    guildId: metadata.guildId,
    id: metadata.id,
    name: metadata.name,
    type: "voice",
  }
}

function guildView(
  guild: VoiceChannelStatusState["guild"],
): VoiceChannelStatusReadResult["guild"] {
  return { id: guild.id, name: guild.name }
}

function currentDigestSnapshot(current: GatewayVoiceChannelStatusSnapshot) {
  return {
    channelId: current.channelId,
    evidence: current.evidence,
    guildId: current.guildId,
    privacy: current.privacy,
    schemaVersion: current.schemaVersion,
    status: current.status,
  }
}

function metadataDigestSnapshot(metadata: DiscordChannelMetadata) {
  return {
    guildId: metadata.guildId,
    id: metadata.id,
    name: metadata.name,
    parentId: metadata.parentId,
    permissionOverwrites: metadata.permissionOverwrites,
    position: metadata.position,
    type: metadata.type,
    unknownFieldCount: metadata.unknownFieldCount,
  }
}

function rolesDigestSnapshot(roles: readonly DiscordRole[]) {
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
  if (error instanceof GatewayVoiceChannelStatusError) {
    return "GatewayVoiceChannelStatusError"
  }
  if (error instanceof VoiceChannelStatusEvidenceError) {
    return "VoiceChannelStatusEvidenceError"
  }
  if (error instanceof RangeError) return "RangeError"
  if (error instanceof TypeError) return "TypeError"
  return "UnknownError"
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    resourceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: VoiceChannelStatusPlan
  request: NormalizedVoiceChannelStatusChangeRequest
  status: VoiceChannelStatusActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): VoiceChannelStatusActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "voice-channel-status-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: VoiceChannelStatusPlan
  request: NormalizedVoiceChannelStatusChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "voice-channel-status-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.request.channelId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function executionBlocksChannel(error: unknown): boolean {
  if (
    !(error instanceof VoiceChannelStatusExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-operation-record-failed", "uncertain"]
    .includes(String(error.result.status))
}

async function withChannelLock<T>(
  locks: VoiceChannelStatusLockState,
  channelId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => VoiceChannelStatusExecutionError,
): Promise<T> {
  const prior = locks.tails.get(channelId)
    ?? Promise.resolve(
      locks.uncertainChannels.has(channelId) ? "uncertain" as const : "settled" as const,
    )
  let release: (outcome: VoiceChannelStatusTargetOutcome) => void = () => undefined
  const tail = new Promise<VoiceChannelStatusTargetOutcome>((resolve) => {
    release = resolve
  })
  locks.tails.set(channelId, tail)
  let outcome: VoiceChannelStatusTargetOutcome = "settled"
  try {
    if (await prior === "uncertain" || locks.uncertainChannels.has(channelId)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksChannel(error)) {
      outcome = "uncertain"
      locks.uncertainChannels.add(channelId)
    }
    throw error
  } finally {
    release(outcome)
    if (locks.tails.get(channelId) === tail) locks.tails.delete(channelId)
  }
}

function settlementEvent(
  outcome:
    | { error: unknown }
    | { update: GatewayVoiceChannelStatusUpdate },
  request: NormalizedVoiceChannelStatusChangeRequest,
): VoiceChannelStatusResult["settlementEvent"] {
  if (!("update" in outcome)) return "not-observed"
  const update = outcome.update
  if (
    !update
    || update.guildId !== request.guildId
    || update.channelId !== request.channelId
    || !(update.status === null || (
      typeof update.status === "string"
      && [...update.status].length <= DISCORD_LIMITS.voiceChannelStatusCharacters
      && !update.status.includes("\0")
      && validUnicode(update.status)
    ))
  ) return "not-observed"
  return update.status === request.status ? "matched" : "different"
}

export class VoiceChannelStatusService {
  readonly #activityStore: ActivityStore
  readonly #client: VoiceChannelStatusServiceClient
  readonly #clock: () => Date
  readonly #gateway: GatewayVoiceChannelStatusSource
  readonly #locks: VoiceChannelStatusLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: VoiceChannelStatusServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: VoiceChannelStatusServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#gateway = options.gateway
    this.#locks = voiceChannelStatusLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  #now(): string {
    const value = this.#clock()
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw evidenceError("Discord voice-channel status clock is invalid")
    }
    return value.toISOString()
  }

  async #state(
    botId: string,
    guildId: string,
    channelId: string,
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<VoiceChannelStatusState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord voice channel status guild ID")
    assertPositiveSnowflake(channelId, "Discord voice channel status channel ID")
    const metadata = exactMetadata(
      await this.#client.getGuildChannelMetadata(channelId, options),
      guildId,
      channelId,
    )
    const policyGuildId = this.#policy.assertChannelMetadataChangeAllowed(
      metadataChannel(metadata),
    )
    if (policyGuildId !== guildId) {
      throw evidenceError("Discord voice channel belongs to another guild")
    }
    if (operationKeyHashValue !== undefined) {
      const receipt = await this.#operationStore.get(
        "voice-channel-status-change",
        operationKeyHashValue,
      )
      if (receipt) throw new VoiceChannelStatusOperationConflictError(receiptView(receipt))
    }
    if (!this.#gateway.voiceChannelStatusEnabled) {
      throw evidenceError("Discord Gateway voice-channel status evidence is disabled")
    }
    let values: [
      DiscordGuild,
      DiscordGuildMember,
      DiscordRole[],
      VoiceChannelStatusBotConnection,
      GatewayVoiceChannelStatusSnapshot,
    ]
    try {
      values = await Promise.all([
        this.#client.getGuild(guildId, options),
        this.#client.getGuildMember(guildId, botId, options),
        this.#client.getGuildRoles(guildId, options),
        currentBotConnection(this.#client, guildId, channelId, botId, options),
        this.#gateway.getVoiceChannelStatus(guildId, channelId, options),
      ])
    } catch (error) {
      if (error instanceof VoiceChannelStatusEvidenceError) throw error
      throw evidenceError("Discord voice-channel status evidence could not be collected", error)
    }
    const [guildValue, memberValue, rolesValue, botConnection, currentValue] = values
    const guild = exactGuild(guildValue, guildId)
    const botMember = exactBotMember(memberValue, botId)
    const roles = exactRoles(rolesValue, guildId, botMember)
    const roleIds = new Set(roles.map((role) => role.id))
    metadata.permissionOverwrites = exactOverwrites(metadata.permissionOverwrites, roleIds)
    const current = exactGatewaySnapshot(currentValue, guildId, channelId)
    return {
      botConnection,
      botMember,
      current,
      guild,
      metadata,
      permission: permissionEvidence({
        botConnection,
        botId,
        guildOwnerId: guild.owner_id,
        member: botMember,
        metadata,
        roles,
      }),
      roles,
    }
  }

  async get(
    botId: string,
    guildId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<VoiceChannelStatusReadResult> {
    const state = await this.#state(botId, guildId, channelId, options)
    return {
      botConnection: state.botConnection,
      channel: channelView(state.metadata),
      current: state.current,
      guild: guildView(state.guild),
      permission: state.permission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedVoiceChannelStatusChangeRequest,
    options: RequestOptions,
  ): Promise<VoiceChannelStatusPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    const state = await this.#state(
      botId,
      request.guildId,
      request.channelId,
      options,
      request.operationKeyHash,
    )
    const writeRequired = state.current.status !== request.status
    const warnings = [
      ...(state.permission.botAdministrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped voice-channel status permissions"]
        : []),
      ...(state.permission.manageChannelsRequired
        ? ["The connector bot is not connected to the exact target, so Discord also requires MANAGE_CHANNELS"]
        : []),
      "Voice channel status is ephemeral and may be replaced by Discord or another authorized actor",
      "Status, channel, guild, and role text is untrusted Discord data and is never persisted by this workflow",
      "Direct service instances serialize the exact channel in process; the production facade also coordinates the exact channel and guild channel collection durably",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const risks = [
      "The status PUT is never automatically retried, so an ambiguous transport outcome remains uncertain",
      "A transient exact-channel Gateway update is settling evidence only; a fresh channel-info query is authoritative",
      "A successful Discord response followed by a different fresh value completes with drift rather than retrying",
      "Stage channels, bulk changes, member enumeration, rollback, and status history are outside this workflow",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botConnection: state.botConnection,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      channel: metadataDigestSnapshot(state.metadata),
      current: currentDigestSnapshot(state.current),
      desiredStatus: request.status,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      permission: state.permission,
      request,
      roles: rolesDigestSnapshot(state.roles),
      risks,
      warnings,
    })
    return {
      applicationId,
      auditReason: request.auditReason,
      botConnection: state.botConnection,
      botId,
      channel: channelView(state.metadata),
      createdAt: this.#now(),
      current: state.current,
      desiredStatus: request.status,
      digest,
      guild: guildView(state.guild),
      localLimits: {
        statusCharacters: DISCORD_LIMITS.voiceChannelStatusCharacters,
      },
      operationKeyHash: request.operationKeyHash,
      permission: state.permission,
      privacy: privacyProjection(),
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-current",
      warnings,
      writeRequired,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: VoiceChannelStatusChangeRequest,
    options: RequestOptions = {},
  ): Promise<VoiceChannelStatusPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeVoiceChannelStatusChangeRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: VoiceChannelStatusChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<VoiceChannelStatusResult> {
    const normalized = normalizeVoiceChannelStatusChangeRequest(request)
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord voice channel status plan digest is invalid")
    }
    return withChannelLock(
      this.#locks,
      normalized.channelId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new VoiceChannelStatusExecutionError(
        "Discord voice channel status change was blocked because a prior same-channel operation ended uncertainly",
        {
          channelId: normalized.channelId,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedVoiceChannelStatusChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<VoiceChannelStatusResult> {
    let plan: VoiceChannelStatusPlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof VoiceChannelStatusEvidenceError
        || error instanceof GatewayVoiceChannelStatusError
        || error instanceof DiscordApiError && error.status === 404
      ) throw new VoiceChannelStatusPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new VoiceChannelStatusPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        observed: plan.current,
        settlementEvent: "not-observed",
        status: "already-current",
        verification: "not-required",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#now(),
    }))
    if (!reservation.created) {
      throw new VoiceChannelStatusOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
        status: "pending",
        timestamp: this.#now(),
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
          timestamp: this.#now(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new VoiceChannelStatusExecutionError(
        "Discord voice channel status change was blocked because pending activity could not be recorded",
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

    let mutationAttempted = false
    const updateAbort = new AbortController()
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, updateAbort.signal])
      : updateAbort.signal
    let updatePromise: Promise<
      | { error: unknown }
      | { update: GatewayVoiceChannelStatusUpdate }
    > | undefined
    let observed: GatewayVoiceChannelStatusSnapshot
    let observedSettlement: VoiceChannelStatusResult["settlementEvent"] = "not-observed"
    try {
      updatePromise = this.#gateway.waitForVoiceChannelStatusUpdate(
        request.guildId,
        request.channelId,
        { signal: combinedSignal },
      ).then(
        (update) => ({ update }),
        (error: unknown) => ({ error }),
      )
      mutationAttempted = true
      await this.#client.setVoiceChannelStatus(
        request.channelId,
        request.status,
        request.auditReason,
        options,
      )
      observedSettlement = settlementEvent(await updatePromise, request)
      observed = exactGatewaySnapshot(
        await this.#gateway.getVoiceChannelStatus(
          request.guildId,
          request.channelId,
          options,
        ),
        request.guildId,
        request.channelId,
      )
    } catch (error) {
      updateAbort.abort()
      if (updatePromise) await updatePromise
      const confirmedRejected = mutationAttempted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
      const status = !mutationAttempted || confirmedRejected
        ? "failed" as const
        : "uncertain" as const
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
          status,
          timestamp: this.#now(),
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
          timestamp: this.#now(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new VoiceChannelStatusExecutionError(
        "Discord voice channel status change did not complete with a verified successful outcome",
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
    } finally {
      updateAbort.abort()
    }

    const verification = observed.status === request.status ? "match" as const : "drift" as const
    const status = verification === "match"
      ? "completed" as const
      : "completed-with-drift" as const
    const result: VoiceChannelStatusResult = {
      ...baseResult,
      activityId,
      observed,
      settlementEvent: observedSettlement,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#now(),
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
          timestamp: this.#now(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new VoiceChannelStatusExecutionError(
        "Discord voice channel status changed but the operation receipt failed",
        {
          ...baseResult,
          activityId,
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
        timestamp: this.#now(),
        verification,
      }))
    } catch (error) {
      throw new VoiceChannelStatusExecutionError(
        "Discord voice channel status changed but the final activity record failed",
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
