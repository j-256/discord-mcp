import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ThreadCreationActivity,
  ThreadCreationActivityStatus,
} from "./activity-log.js"
import {
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
  THREAD_CREATION_MODES,
  type ThreadCreationMode,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type CreateThreadFromMessageInput,
  type CreateThreadWithoutMessageInput,
  type DiscordClient,
} from "./discord-client.js"
import {
  DiscordApiError,
  ThreadCreationEvidenceError,
  ThreadCreationExecutionError,
  ThreadCreationOperationConflictError,
  ThreadCreationPlanChangedError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  deletionPreview,
  deletionSnapshot,
  discordChannelUrl,
} from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
  type BotChannelPermissionResult,
  type DiscordPermissionName,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "thread-creation-state-unavailable"
const NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const REQUEST_KEYS = [
  "auditReason",
  "autoArchiveDuration",
  "invitable",
  "mode",
  "name",
  "operationKey",
  "parentChannelId",
  "rateLimitPerUser",
  "sourceMessageId",
] as const
const THREAD_TARGET_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()
const STANDALONE_UNCERTAIN_TARGETS = new Set<string>()

export interface ThreadCreationRequest {
  auditReason: string
  autoArchiveDuration?: number
  invitable?: boolean
  mode: ThreadCreationMode
  name: string
  operationKey: string
  parentChannelId: string
  rateLimitPerUser?: number
  sourceMessageId?: string
}

export interface NormalizedThreadCreationRequest {
  auditReason: string
  autoArchiveDuration: number | null
  invitable: boolean | null
  mode: ThreadCreationMode
  name: string
  operationKey: string
  operationKeyHash: string
  parentChannelId: string
  rateLimitPerUser: number | null
  sourceMessageId: string | null
}

export interface ThreadPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  requiredPermissionNames: DiscordPermissionName[]
}

export interface ThreadCreationPlan {
  applicationId: string
  botId: string
  createdAt: string
  digest: string
  existingThread: {
    archived: boolean
    autoArchiveDuration: number
    id: string
    invitable: boolean | null
    locked: boolean
    name: string
    ownerId: string
    rateLimitPerUser: number
    type: number
    url: string
  } | null
  guild: {
    id: string
    name: string
    ownerId: string
  }
  operationKeyHash: string
  parent: {
    defaultAutoArchiveDuration: number | null
    defaultThreadRateLimitPerUser: number | null
    guildId: string
    id: string
    name: string
    type: number
  }
  permission: ThreadPermissionEvidence
  privacy: {
    durableRecords: "content-free-only"
    sourceMessage: "transient-review-only" | "not-fetched"
  }
  risks: string[]
  schemaVersion: number
  sourceMessage: ReturnType<typeof deletionPreview> | null
  status: "planned" | "source-already-threaded"
  target: {
    auditReason: string
    autoArchiveDuration: number
    invitable: boolean | null
    mode: ThreadCreationMode
    name: string
    parentChannelId: string
    rateLimitPerUser: number
    sourceMessageId: string | null
    threadType: number
  }
  warnings: string[]
  writeRequired: boolean
}

export type ThreadCreationDriftField =
  | "active-state"
  | "auto-archive-duration"
  | "invitable"
  | "name"
  | "rate-limit-per-user"
  | "thread-type"

export interface ThreadCreationResult {
  activityId: string | null
  driftFields: ThreadCreationDriftField[]
  guildId: string
  mode: ThreadCreationMode
  operationKeyHash: string
  parentChannelId: string
  planDigest: string
  readbackMatched: boolean
  recoveredFromAmbiguousResponse: boolean
  responseMatched: boolean | null
  schemaVersion: number
  sourceMessageId: string | null
  status: "completed" | "completed-with-drift" | "source-already-threaded"
  threadId: string
  url: string
  verification: "drift" | "match" | "not-required"
  writeRequired: boolean
}

export interface ThreadCreationServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "createThreadFromMessage"
    | "createThreadWithoutMessage"
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getMessage"
  >
  clock?: () => Date
  limiter: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertThreadCreatable">
  randomId?: () => string
}

interface ThreadCreationState {
  existingThread: ObservedThread | null
  guild: DiscordGuild
  guildId: string
  member: DiscordGuildMember
  parent: DiscordChannel
  permission: BotChannelPermissionResult
  requiredPermissionNames: DiscordPermissionName[]
  roles: DiscordRole[]
  sourceMessage: DiscordMessage | null
}

interface ObservedThread {
  archived: boolean
  autoArchiveDuration: number
  id: string
  invitable: boolean | null
  locked: boolean
  name: string
  ownerId: string
  rateLimitPerUser: number
  type: number
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (!validSnowflake(value)) {
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

function assertThreadName(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.channelNameCharacters
    || value.trim() !== value
    || NAME_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError(
      `Discord thread name must contain 1-${DISCORD_LIMITS.channelNameCharacters} trimmed characters without controls`,
    )
  }
}

function assertOptionalIntegerRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

export function normalizeThreadCreationRequest(
  request: ThreadCreationRequest,
): NormalizedThreadCreationRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord thread-creation request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, REQUEST_KEYS)
    || record.auditReason === undefined
    || record.mode === undefined
    || record.name === undefined
    || record.operationKey === undefined
    || record.parentChannelId === undefined
  ) {
    throw new RangeError("Discord thread-creation request has unsupported or missing fields")
  }
  if (!THREAD_CREATION_MODES.includes(request.mode)) {
    throw new RangeError("Discord thread-creation mode is not supported")
  }
  assertSnowflake(request.parentChannelId, "Discord thread parent channel ID")
  assertThreadName(request.name)
  if (
    request.autoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(request.autoArchiveDuration)
  ) {
    throw new RangeError("Discord thread auto-archive duration is not supported")
  }
  assertOptionalIntegerRange(
    request.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord thread slowmode seconds",
  )
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord thread-creation audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (request.mode === "from-message") {
    assertSnowflake(request.sourceMessageId, "Discord thread source message ID")
    if (request.invitable !== undefined) {
      throw new RangeError("Discord anchored thread creation does not accept invitable")
    }
  } else {
    if (request.sourceMessageId !== undefined) {
      throw new RangeError("Discord standalone thread creation does not accept a source message ID")
    }
    if (request.mode === "standalone-public" && request.invitable !== undefined) {
      throw new RangeError("Discord public thread creation does not accept invitable")
    }
    if (
      request.mode === "standalone-private"
      && request.invitable !== undefined
      && typeof request.invitable !== "boolean"
    ) {
      throw new RangeError("Discord private thread invitable state must be boolean")
    }
  }
  return {
    auditReason: request.auditReason,
    autoArchiveDuration: request.autoArchiveDuration ?? null,
    invitable: request.mode === "standalone-private"
      ? request.invitable ?? false
      : null,
    mode: request.mode,
    name: request.name,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    parentChannelId: request.parentChannelId,
    rateLimitPerUser: request.rateLimitPerUser ?? null,
    sourceMessageId: request.sourceMessageId ?? null,
  }
}

function logicalNameKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, " ")
    .trim()
}

function targetLockKey(request: NormalizedThreadCreationRequest): string {
  const target = request.mode === "from-message"
    ? request.sourceMessageId as string
    : logicalNameKey(request.name)
  return [request.parentChannelId, request.mode, target].join("\0")
}

function isStandalone(request: NormalizedThreadCreationRequest): boolean {
  return request.mode !== "from-message"
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ThreadCreationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["uncertain", "completed-operation-record-failed"]
    .includes(String(error.result.status))
}

async function withTargetLock<T>(
  request: NormalizedThreadCreationRequest,
  operation: () => Promise<T>,
  priorUncertainError: () => ThreadCreationExecutionError,
): Promise<T> {
  const key = targetLockKey(request)
  const prior = THREAD_TARGET_LOCKS.get(key)
    ?? Promise.resolve(
      isStandalone(request) && STANDALONE_UNCERTAIN_TARGETS.has(key)
        ? "uncertain" as const
        : "settled" as const,
    )
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  THREAD_TARGET_LOCKS.set(key, tail)
  let outcome: "settled" | "uncertain" = "settled"
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
    if (outcome === "uncertain" && isStandalone(request)) {
      STANDALONE_UNCERTAIN_TARGETS.add(key)
    }
    release(outcome)
    if (THREAD_TARGET_LOCKS.get(key) === tail) THREAD_TARGET_LOCKS.delete(key)
  }
}

function expectedThreadType(
  mode: ThreadCreationMode,
  parentType: number,
): number {
  if (mode === "standalone-private") return DISCORD_CHANNEL_TYPES.privateThread
  if (mode === "standalone-public") return DISCORD_CHANNEL_TYPES.publicThread
  return parentType === DISCORD_CHANNEL_TYPES.announcement
    ? DISCORD_CHANNEL_TYPES.announcementThread
    : DISCORD_CHANNEL_TYPES.publicThread
}

function assertExactGuild(guild: DiscordGuild, guildId: string): void {
  if (
    guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || NAME_CONTROL_PATTERN.test(guild.name)
    || !validUnicode(guild.name)
    || !validSnowflake(guild.owner_id)
  ) {
    throw new ThreadCreationEvidenceError(
      "Discord returned incomplete or mismatched thread-creation guild evidence",
    )
  }
}

function assertExactMember(member: DiscordGuildMember, botId: string): void {
  if (
    !member.user
    || member.user.id !== botId
    || member.user.bot !== true
    || !Array.isArray(member.roles)
    || member.roles.some((roleId) => !validSnowflake(roleId))
    || new Set(member.roles).size !== member.roles.length
  ) {
    throw new ThreadCreationEvidenceError(
      "Discord returned incomplete or mismatched connector member evidence",
    )
  }
}

function assertRoles(
  roles: readonly DiscordRole[],
  guildId: string,
  member: DiscordGuildMember,
): void {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > DISCORD_LIMITS.guildRoles) {
    throw new ThreadCreationEvidenceError("Discord returned an invalid bounded role inventory")
  }
  const ids = new Set<string>()
  for (const role of roles as readonly unknown[]) {
    if (!role || typeof role !== "object" || Array.isArray(role)) {
      throw new ThreadCreationEvidenceError("Discord returned an invalid role object")
    }
    const value = role as DiscordRole
    if (
      !validSnowflake(value.id)
      || ids.has(value.id)
      || typeof value.name !== "string"
      || typeof value.managed !== "boolean"
      || typeof value.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(value.permissions)
      || !Number.isInteger(value.position)
      || value.position < 0
    ) {
      throw new ThreadCreationEvidenceError(
        "Discord returned malformed or duplicate role evidence",
      )
    }
    ids.add(value.id)
  }
  if (!ids.has(guildId)) {
    throw new ThreadCreationEvidenceError("Discord role evidence omitted the guild @everyone role")
  }
  for (const roleId of member.roles) {
    if (!ids.has(roleId)) {
      throw new ThreadCreationEvidenceError("Discord connector member references an unknown role")
    }
  }
}

function assertPermissionOverwrites(
  overwrites: unknown,
  roleIds: ReadonlySet<string>,
): asserts overwrites is DiscordPermissionOverwrite[] {
  if (!Array.isArray(overwrites) || overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw new ThreadCreationEvidenceError(
      "Discord thread parent omitted or exceeded the bounded permission overwrite inventory",
    )
  }
  const targets = new Set<string>()
  for (const entry of overwrites as readonly unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ThreadCreationEvidenceError("Discord returned an invalid permission overwrite")
    }
    const overwrite = entry as Partial<DiscordPermissionOverwrite>
    const key = `${overwrite.type}:${overwrite.id}`
    if (
      !validSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(overwrite.allow)
      || typeof overwrite.deny !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(overwrite.deny)
      || (BigInt(overwrite.allow) & BigInt(overwrite.deny)) !== 0n
      || targets.has(key)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
    ) {
      throw new ThreadCreationEvidenceError(
        "Discord returned malformed, contradictory, duplicate, or unknown overwrite evidence",
      )
    }
    targets.add(key)
  }
}

function optionalAutoArchiveDuration(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (
    !Number.isInteger(value)
    || !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(value as number)
  ) {
    throw new ThreadCreationEvidenceError(
      "Discord returned an invalid default thread auto-archive duration",
    )
  }
  return value as number
}

function optionalSlowmode(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (
    !Number.isInteger(value)
    || (value as number) < 0
    || (value as number) > DISCORD_LIMITS.channelRateLimitSeconds
  ) {
    throw new ThreadCreationEvidenceError("Discord returned an invalid default thread slowmode")
  }
  return value as number
}

function assertExactParent(
  channel: DiscordChannel,
  channelId: string,
  mode: ThreadCreationMode,
): DiscordChannel {
  const supported: readonly number[] = mode === "from-message"
    ? [DISCORD_CHANNEL_TYPES.announcement, DISCORD_CHANNEL_TYPES.text]
    : [DISCORD_CHANNEL_TYPES.text]
  if (
    channel.id !== channelId
    || !validSnowflake(channel.id)
    || !validSnowflake(channel.guild_id)
    || !supported.includes(channel.type)
    || typeof channel.name !== "string"
    || channel.name.length < 1
    || channel.name.length > DISCORD_LIMITS.channelNameCharacters
    || NAME_CONTROL_PATTERN.test(channel.name)
    || !validUnicode(channel.name)
  ) {
    throw new ThreadCreationEvidenceError(
      "Discord returned a mismatched, malformed, or unsupported thread parent",
    )
  }
  optionalAutoArchiveDuration(channel.default_auto_archive_duration)
  optionalSlowmode(channel.default_thread_rate_limit_per_user)
  return channel
}

function assertExactSourceMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
): void {
  if (
    !message
    || typeof message !== "object"
    || message.id !== messageId
    || message.channel_id !== channelId
    || message.guild_id !== guildId
    || !message.author
    || !validSnowflake(message.author.id)
    || typeof message.author.username !== "string"
    || (
      message.author.bot !== undefined
      && typeof message.author.bot !== "boolean"
    )
    || typeof message.content !== "string"
    || !validUnicode(message.content)
    || typeof message.timestamp !== "string"
    || Number.isNaN(Date.parse(message.timestamp))
    || !Number.isInteger(message.type)
    || !Array.isArray(message.attachments ?? [])
    || !Array.isArray(message.embeds ?? [])
    || !Array.isArray(message.components ?? [])
  ) {
    throw new ThreadCreationEvidenceError(
      "Discord returned a different or malformed thread source message",
    )
  }
}

function requiredPermissionNames(mode: ThreadCreationMode): DiscordPermissionName[] {
  return [
    "VIEW_CHANNEL",
    ...(mode === "from-message" ? ["READ_MESSAGE_HISTORY" as const] : []),
    mode === "standalone-private" ? "CREATE_PRIVATE_THREADS" : "CREATE_PUBLIC_THREADS",
  ]
}

function assertPermission(
  permission: BotChannelPermissionResult,
  mode: ThreadCreationMode,
): DiscordPermissionName[] {
  if (permission.confidence !== "complete") {
    throw new ThreadCreationEvidenceError(
      `Discord connector bot permission evidence is incomplete: ${permission.warnings.join("; ")}`,
    )
  }
  const required = requiredPermissionNames(mode)
  const effective = BigInt(permission.effectivePermissions)
  const missing = permission.administrator
    ? []
    : required.filter((name) => (
      (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
    ))
  if (missing.length > 0) {
    throw new ThreadCreationEvidenceError(
      `Discord connector bot lacks thread-creation permissions: ${missing.join(", ")}`,
    )
  }
  return required
}

function observedThread(
  channel: DiscordChannel,
  options: {
    botId?: string
    expectedId: string
    guildId: string
    parentChannelId: string
    threadType: number
  },
): ObservedThread {
  const metadata = channel.thread_metadata
  if (
    channel.id !== options.expectedId
    || !validSnowflake(channel.id)
    || channel.guild_id !== options.guildId
    || channel.parent_id !== options.parentChannelId
    || channel.type !== options.threadType
    || !validSnowflake(channel.owner_id)
    || (options.botId !== undefined && channel.owner_id !== options.botId)
    || typeof channel.name !== "string"
    || channel.name.length < 1
    || channel.name.length > DISCORD_LIMITS.channelNameCharacters
    || NAME_CONTROL_PATTERN.test(channel.name)
    || !validUnicode(channel.name)
    || !metadata
    || typeof metadata.archived !== "boolean"
    || typeof metadata.locked !== "boolean"
    || !Number.isInteger(metadata.auto_archive_duration)
    || !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(metadata.auto_archive_duration as number)
    || (options.threadType === DISCORD_CHANNEL_TYPES.privateThread
      && typeof metadata.invitable !== "boolean")
  ) {
    throw new ThreadCreationEvidenceError(
      "Discord returned a different or malformed thread",
    )
  }
  const rateLimitPerUser = optionalSlowmode(channel.rate_limit_per_user) ?? 0
  return {
    archived: metadata.archived,
    autoArchiveDuration: metadata.auto_archive_duration as number,
    id: channel.id,
    invitable: options.threadType === DISCORD_CHANNEL_TYPES.privateThread
      ? metadata.invitable as boolean
      : null,
    locked: metadata.locked,
    name: channel.name,
    ownerId: channel.owner_id,
    rateLimitPerUser,
    type: channel.type,
  }
}

async function getExistingAnchoredThread(
  client: ThreadCreationServiceOptions["client"],
  sourceMessageId: string,
  options: RequestOptions,
): Promise<DiscordChannel | null> {
  try {
    return await client.getChannel(sourceMessageId, options)
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null
    throw error
  }
}

function parentSnapshot(channel: DiscordChannel) {
  return {
    defaultAutoArchiveDuration: channel.default_auto_archive_duration ?? null,
    defaultThreadRateLimitPerUser: channel.default_thread_rate_limit_per_user ?? null,
    guildId: channel.guild_id,
    id: channel.id,
    name: channel.name,
    parentId: channel.parent_id ?? null,
    permissionOverwrites: channel.permission_overwrites,
    type: channel.type,
  }
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
    .sort((left, right) => left.id.localeCompare(right.id))
}

function observedSnapshot(thread: ObservedThread | null) {
  return thread && { ...thread }
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
    threadId: receipt.resourceId,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: ThreadCreationPlan
  request: NormalizedThreadCreationRequest
  status: ThreadCreationActivityStatus
  threadId?: string | null
  timestamp: string
  verification?: "drift" | "match" | null
}): ThreadCreationActivity {
  return {
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    id: options.activityId,
    kind: "thread-create",
    mode: options.request.mode,
    operationKeyHash: options.request.operationKeyHash,
    parentChannelId: options.request.parentChannelId,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    sourceMessageId: options.request.sourceMessageId,
    status: options.status,
    threadId: options.threadId ?? null,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: ThreadCreationPlan
  request: NormalizedThreadCreationRequest
  status: OperationReceipt["status"]
  threadId?: string | null
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    kind: "thread-create",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.threadId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function driftFields(
  observed: ObservedThread,
  target: ThreadCreationPlan["target"],
): ThreadCreationDriftField[] {
  const drift: ThreadCreationDriftField[] = []
  if (observed.name !== target.name) drift.push("name")
  if (observed.type !== target.threadType) drift.push("thread-type")
  if (observed.autoArchiveDuration !== target.autoArchiveDuration) {
    drift.push("auto-archive-duration")
  }
  if (observed.rateLimitPerUser !== target.rateLimitPerUser) {
    drift.push("rate-limit-per-user")
  }
  if (target.invitable !== null && observed.invitable !== target.invitable) {
    drift.push("invitable")
  }
  if (observed.archived || observed.locked) drift.push("active-state")
  return drift
}

function mergedDriftFields(
  ...groups: readonly ThreadCreationDriftField[][]
): ThreadCreationDriftField[] {
  return [...new Set(groups.flat())].sort()
}

function createFromMessageInput(
  target: ThreadCreationPlan["target"],
): CreateThreadFromMessageInput {
  return {
    autoArchiveDuration: target.autoArchiveDuration,
    name: target.name,
    rateLimitPerUser: target.rateLimitPerUser,
  }
}

function createWithoutMessageInput(
  target: ThreadCreationPlan["target"],
): CreateThreadWithoutMessageInput {
  return {
    autoArchiveDuration: target.autoArchiveDuration,
    ...(target.invitable !== null ? { invitable: target.invitable } : {}),
    name: target.name,
    rateLimitPerUser: target.rateLimitPerUser,
    type: target.threadType,
  }
}

export class ThreadCreationService {
  readonly #activityStore: ActivityStore
  readonly #client: ThreadCreationServiceOptions["client"]
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ThreadCreationServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: ThreadCreationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#limiter = options.limiter
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    request: NormalizedThreadCreationRequest,
    options: RequestOptions,
  ): Promise<ThreadCreationState> {
    const existingReceipt = await this.#operationStore.get(
      "thread-create",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new ThreadCreationOperationConflictError(receiptView(existingReceipt))
    }
    const parent = assertExactParent(
      await this.#client.getChannel(request.parentChannelId, options),
      request.parentChannelId,
      request.mode,
    )
    const guildId = this.#policy.assertThreadCreatable(parent)
    const [guild, member, roles, sourceMessage, existingChannel] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      request.sourceMessageId
        ? this.#client.getMessage(
          request.parentChannelId,
          request.sourceMessageId,
          options,
        )
        : Promise.resolve(null),
      request.sourceMessageId
        ? getExistingAnchoredThread(this.#client, request.sourceMessageId, options)
        : Promise.resolve(null),
    ])
    assertExactGuild(guild, guildId)
    assertExactMember(member, botId)
    assertRoles(roles, guildId, member)
    const roleIds = new Set(roles.map((role) => role.id))
    assertPermissionOverwrites(parent.permission_overwrites, roleIds)
    if (sourceMessage && request.sourceMessageId) {
      assertExactSourceMessage(
        sourceMessage,
        request.parentChannelId,
        guildId,
        request.sourceMessageId,
      )
    }
    const threadType = expectedThreadType(request.mode, parent.type)
    const existingThread = existingChannel && request.sourceMessageId
      ? observedThread(existingChannel, {
        expectedId: request.sourceMessageId,
        guildId,
        parentChannelId: request.parentChannelId,
        threadType,
      })
      : null
    const permission = evaluateBotChannelPermissions({
      botId,
      channel: parent,
      guildId,
      member,
      permissionChannel: parent,
      roles,
    })
    const requiredPermissionNames = assertPermission(permission, request.mode)
    return {
      existingThread,
      guild,
      guildId,
      member,
      parent,
      permission,
      requiredPermissionNames,
      roles,
      sourceMessage,
    }
  }

  #planFromState(
    applicationId: string,
    botId: string,
    request: NormalizedThreadCreationRequest,
    state: ThreadCreationState,
  ): ThreadCreationPlan {
    const autoArchiveDuration = request.autoArchiveDuration
      ?? optionalAutoArchiveDuration(state.parent.default_auto_archive_duration)
      ?? 1_440
    const rateLimitPerUser = request.rateLimitPerUser
      ?? optionalSlowmode(state.parent.default_thread_rate_limit_per_user)
      ?? 0
    const threadType = expectedThreadType(request.mode, state.parent.type)
    const target: ThreadCreationPlan["target"] = {
      auditReason: request.auditReason,
      autoArchiveDuration,
      invitable: request.invitable,
      mode: request.mode,
      name: request.name,
      parentChannelId: request.parentChannelId,
      rateLimitPerUser,
      sourceMessageId: request.sourceMessageId,
      threadType,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      existingThread: observedSnapshot(state.existingThread),
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      member: {
        roles: [...state.member.roles].sort(),
        userId: state.member.user?.id ?? null,
      },
      operationKeyHash: request.operationKeyHash,
      parent: parentSnapshot(state.parent),
      permission: {
        administrator: state.permission.administrator,
        confidence: state.permission.confidence,
        effectivePermissions: state.permission.effectivePermissions,
        requiredPermissionNames: state.requiredPermissionNames,
      },
      roles: roleSnapshot(state.roles),
      sourceMessage: state.sourceMessage ? deletionSnapshot(state.sourceMessage) : null,
      target,
    })
    const writeRequired = state.existingThread === null
    return {
      applicationId,
      botId,
      createdAt: this.#clock().toISOString(),
      digest,
      existingThread: state.existingThread && {
        ...state.existingThread,
        url: discordChannelUrl(state.guildId, state.existingThread.id),
      },
      guild: {
        id: state.guildId,
        name: state.guild.name,
        ownerId: state.guild.owner_id as string,
      },
      operationKeyHash: request.operationKeyHash,
      parent: {
        defaultAutoArchiveDuration: state.parent.default_auto_archive_duration ?? null,
        defaultThreadRateLimitPerUser:
          state.parent.default_thread_rate_limit_per_user ?? null,
        guildId: state.guildId,
        id: state.parent.id,
        name: state.parent.name as string,
        type: state.parent.type,
      },
      permission: {
        administrator: state.permission.administrator,
        confidence: "complete",
        effectivePermissionNames: state.permission.effectivePermissionNames,
        effectivePermissions: state.permission.effectivePermissions,
        requiredPermissionNames: state.requiredPermissionNames,
      },
      privacy: {
        durableRecords: "content-free-only",
        sourceMessage: state.sourceMessage ? "transient-review-only" : "not-fetched",
      },
      risks: writeRequired
        ? [
          "The creation POST is not automatically retried",
          request.mode === "from-message"
            ? "An ambiguous anchored response is accepted only when the deterministic thread ID has an exact matching bot-owned readback"
            : "An ambiguous standalone response cannot be rediscovered safely and permanently blocks the same logical target in this process",
          "Discord may normalize accepted thread fields, so the response and exact readback are checked for drift",
        ]
        : [
          "The source message already owns a thread, so execution will not create or modify anything",
        ],
      schemaVersion: SCHEMA_VERSION,
      sourceMessage: state.sourceMessage ? deletionPreview(state.sourceMessage) : null,
      status: writeRequired ? "planned" : "source-already-threaded",
      target,
      warnings: [
        ...(state.permission.administrator
          ? [`Discord connector bot has ADMINISTRATOR; replace it with exact ${state.requiredPermissionNames.join(", ")} permissions`]
          : []),
        ...(writeRequired
          ? [
            "Same-target serialization is process-local; do not run connector processes with overlapping thread-creation scope",
            "The operation key is one-shot and cannot be reused after reservation, including after an uncertain outcome",
            "The activity log and operation receipt never store the thread name, audit reason, source content, source profile, or raw operation key",
          ]
          : [
            "Requested name and settings are not applied when the source message already owns a thread",
            "The no-op path does not reserve the operation key or append an activity record",
          ]),
      ],
      writeRequired,
    }
  }

  async #prepare(
    applicationId: string,
    botId: string,
    request: NormalizedThreadCreationRequest,
    options: RequestOptions,
  ): Promise<{ plan: ThreadCreationPlan; state: ThreadCreationState }> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, request, options)
    return {
      plan: this.#planFromState(applicationId, botId, request, state),
      state,
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: ThreadCreationRequest,
    options: RequestOptions = {},
  ): Promise<ThreadCreationPlan> {
    return (await this.#prepare(
      applicationId,
      botId,
      normalizeThreadCreationRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: ThreadCreationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ThreadCreationResult> {
    const normalized = normalizeThreadCreationRequest(request)
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord thread-creation plan digest is invalid")
    }
    return withTargetLock(
      normalized,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ThreadCreationExecutionError(
        "Discord thread creation was blocked because a prior same-target operation ended uncertainly",
        {
          mode: normalized.mode,
          operationKeyHash: normalized.operationKeyHash,
          parentChannelId: normalized.parentChannelId,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          sourceMessageId: normalized.sourceMessageId,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedThreadCreationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ThreadCreationResult> {
    let prepared: { plan: ThreadCreationPlan; state: ThreadCreationState }
    try {
      prepared = await this.#prepare(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ThreadCreationEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ThreadCreationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = prepared
    if (plan.digest !== expectedDigest) {
      throw new ThreadCreationPlanChangedError(expectedDigest, plan.digest)
    }
    if (!plan.writeRequired && state.existingThread) {
      return {
        activityId: null,
        driftFields: [],
        guildId: plan.guild.id,
        mode: request.mode,
        operationKeyHash: request.operationKeyHash,
        parentChannelId: request.parentChannelId,
        planDigest: plan.digest,
        readbackMatched: true,
        recoveredFromAmbiguousResponse: false,
        responseMatched: null,
        schemaVersion: SCHEMA_VERSION,
        sourceMessageId: request.sourceMessageId,
        status: "source-already-threaded",
        threadId: state.existingThread.id,
        url: discordChannelUrl(plan.guild.id, state.existingThread.id),
        verification: "not-required",
        writeRequired: false,
      }
    }
    const baseResult = {
      guildId: plan.guild.id,
      mode: request.mode,
      operationKeyHash: request.operationKeyHash,
      parentChannelId: request.parentChannelId,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      sourceMessageId: request.sourceMessageId,
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
      throw new ThreadCreationOperationConflictError(receiptView(reservation.receipt))
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
      throw new ThreadCreationExecutionError(
        "Discord thread creation was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
          threadId: null,
        },
        { cause: error },
      )
    }

    let mutationAttempted = false
    let mutationCompleted = false
    let observed: ObservedThread | null = null
    let readbackDrift: ThreadCreationDriftField[] = []
    let recoveredFromAmbiguousResponse = false
    let responseDrift: ThreadCreationDriftField[] = []
    let responseMatched: boolean | null = null
    let threadId: string | null = null
    try {
      this.#limiter.reserve(request.parentChannelId)
      mutationAttempted = true
      const response = request.mode === "from-message"
        ? await this.#client.createThreadFromMessage(
          request.parentChannelId,
          request.sourceMessageId as string,
          createFromMessageInput(plan.target),
          request.auditReason,
          options,
        )
        : await this.#client.createThreadWithoutMessage(
          request.parentChannelId,
          createWithoutMessageInput(plan.target),
          request.auditReason,
          options,
        )
      mutationCompleted = true
      if (validSnowflake(response?.id)) threadId = response.id
      if (threadId === null) {
        throw new ThreadCreationEvidenceError(
          "Discord thread-creation response omitted a valid thread ID",
        )
      }
      const expectedId = request.sourceMessageId ?? threadId
      const responseThread = observedThread(response, {
        botId,
        expectedId,
        guildId: plan.guild.id,
        parentChannelId: request.parentChannelId,
        threadType: plan.target.threadType,
      })
      responseDrift = driftFields(responseThread, plan.target)
      responseMatched = responseDrift.length === 0
      const readback = await this.#client.getChannel(expectedId, options)
      observed = observedThread(readback, {
        botId,
        expectedId,
        guildId: plan.guild.id,
        parentChannelId: request.parentChannelId,
        threadType: plan.target.threadType,
      })
      threadId = observed.id
      readbackDrift = driftFields(observed, plan.target)
    } catch (error) {
      const confirmedRejected = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
      if (request.mode === "from-message" && mutationAttempted && !confirmedRejected) {
        try {
          const recovered = observedThread(
            await this.#client.getChannel(request.sourceMessageId as string, options),
            {
              botId,
              expectedId: request.sourceMessageId as string,
              guildId: plan.guild.id,
              parentChannelId: request.parentChannelId,
              threadType: plan.target.threadType,
            },
          )
          if (driftFields(recovered, plan.target).length === 0) {
            observed = recovered
            threadId = recovered.id
            readbackDrift = []
            recoveredFromAmbiguousResponse = true
          }
        } catch {
          observed = null
        }
      }
      if (observed === null) {
        const status = !mutationAttempted || confirmedRejected ? "failed" : "uncertain"
        const errorCode = safeErrorCode(error)
        let operationRecordError: string | null = null
        try {
          await this.#operationStore.finish(operationReceipt({
            activityId,
            error: errorCode,
            plan,
            request,
            status,
            threadId,
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
            threadId,
            timestamp: this.#clock().toISOString(),
          }))
        } catch (activityError) {
          activityRecordError = safeErrorCode(activityError)
        }
        throw new ThreadCreationExecutionError(
          "Discord thread creation did not complete with a verified successful outcome",
          {
            ...baseResult,
            activityId,
            activityRecordError,
            error: errorCode,
            operationRecordError,
            readbackMatched: false,
            recoveredFromAmbiguousResponse: false,
            responseMatched,
            retryAfterMs: error instanceof DiscordApiError
              ? error.retryAfterMs ?? null
              : null,
            status,
            threadId,
          },
          { cause: error },
        )
      }
    }

    const drift = recoveredFromAmbiguousResponse
      ? []
      : mergedDriftFields(responseDrift, readbackDrift)
    const verification = drift.length === 0 ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: ThreadCreationResult = {
      ...baseResult,
      activityId,
      driftFields: drift,
      readbackMatched: readbackDrift.length === 0,
      recoveredFromAmbiguousResponse,
      responseMatched,
      status,
      threadId: (observed as ObservedThread).id,
      url: discordChannelUrl(plan.guild.id, (observed as ObservedThread).id),
      verification,
      writeRequired: true,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        threadId: result.threadId,
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
          threadId: result.threadId,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ThreadCreationExecutionError(
        "Discord thread creation completed but the operation receipt failed",
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
        threadId: result.threadId,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ThreadCreationExecutionError(
        "Discord thread creation completed but the final activity record failed",
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
