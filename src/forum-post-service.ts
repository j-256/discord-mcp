import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ForumPostActivity,
  ForumPostActivityStatus,
} from "./activity-log.js"
import {
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type CreateForumPostInput,
  type DiscordClient,
} from "./discord-client.js"
import {
  DiscordApiError,
  ForumPostEvidenceError,
  ForumPostExecutionError,
  ForumPostOperationConflictError,
  ForumPostPlanChangedError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  assertDiscordMessageContent,
  canonicalDiscordNotificationUserIds,
  discordAllowedMentions,
} from "./message-safety.js"
import { discordMessageUrl } from "./normalize.js"
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
  DiscordCreatedForumPost,
  DiscordForumTag,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "forum-post-state-unavailable"
const NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const TAG_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const REQUIRED_PERMISSIONS = [
  "VIEW_CHANNEL",
  "READ_MESSAGE_HISTORY",
  "SEND_MESSAGES",
] as const satisfies readonly DiscordPermissionName[]
const FORUM_POST_TARGET_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()

export interface ForumPostRequest {
  appliedTagIds?: readonly string[]
  auditReason: string
  autoArchiveDuration?: number
  channelId: string
  content: string
  name: string
  notifyUserIds?: readonly string[]
  operationKey: string
  rateLimitPerUser?: number
}

export interface NormalizedForumPostRequest {
  appliedTagIds: string[]
  auditReason: string
  autoArchiveDuration: number | null
  channelId: string
  content: string
  name: string
  notifyUserIds: string[]
  operationKey: string
  operationKeyHash: string
  rateLimitPerUser: number | null
}

export interface ForumPostPlan {
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
    ownerId: string
  }
  operationKeyHash: string
  parent: {
    availableTagCount: number
    defaultAutoArchiveDuration: number | null
    defaultThreadRateLimitPerUser: number | null
    flags: number
    guildId: string
    id: string
    name: string
    requireTag: boolean
    type: number
  }
  permission: {
    administrator: boolean
    confidence: "complete"
    effectivePermissionNames: DiscordPermissionName[]
    effectivePermissions: string
    requiredPermissionNames: DiscordPermissionName[]
  }
  schemaVersion: number
  selectedTags: Array<{
    id: string
    moderated: boolean
    name: string
  }>
  status: "planned"
  target: {
    appliedTagIds: string[]
    auditReason: string
    autoArchiveDuration: number | null
    content: string
    name: string
    notificationUserIds: string[]
    rateLimitPerUser: number | null
  }
  warnings: string[]
}

export type ForumPostDriftField =
  | "applied-tags"
  | "auto-archive-duration"
  | "content"
  | "name"
  | "rate-limit-per-user"
  | "thread-state"

export interface ForumPostResult {
  activityId: string
  driftFields: ForumPostDriftField[]
  guildId: string
  messageId: string
  operationKeyHash: string
  parentChannelId: string
  planDigest: string
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  threadId: string
  url: string
  verification: "drift" | "match"
}

export interface ForumPostServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "createForumPost"
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
  policy: ScopePolicy
  randomId?: () => string
}

interface ForumPostState {
  guild: DiscordGuild
  guildId: string
  member: DiscordGuildMember
  parent: DiscordChannel
  permission: BotChannelPermissionResult
  roles: DiscordRole[]
  selectedTags: DiscordForumTag[]
}

interface ObservedForumPost {
  appliedTagIds: string[]
  archived: boolean
  autoArchiveDuration: number
  content: string
  locked: boolean
  messageId: string
  name: string
  rateLimitPerUser: number
  threadId: string
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) > 0n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertValidUnicode(value: string, name: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${name} contains invalid Unicode`, { cause: error })
  }
}

function assertOptionalIntegerRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || value < minimum || value > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

function canonicalTagIds(value: readonly string[] | undefined): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.forumAppliedTags
    || value.some((entry) => !validSnowflake(entry))
    || new Set(value).size !== value.length
  ) {
    throw new RangeError(
      `Discord forum-post tag IDs must contain at most ${DISCORD_LIMITS.forumAppliedTags} unique snowflakes`,
    )
  }
  return [...value].sort()
}

export function normalizeForumPostRequest(
  request: ForumPostRequest,
): NormalizedForumPostRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord forum-post request must be an object")
  }
  if (!validSnowflake(request.channelId)) {
    throw new RangeError("Discord forum-post channel ID must be a snowflake")
  }
  if (
    typeof request.name !== "string"
    || request.name.length < 1
    || request.name.length > DISCORD_LIMITS.channelNameCharacters
    || request.name.trim() !== request.name
    || NAME_CONTROL_PATTERN.test(request.name)
  ) {
    throw new RangeError(
      `Discord forum-post name must contain 1-${DISCORD_LIMITS.channelNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(request.name, "Discord forum-post name")
  assertDiscordMessageContent(request.content)
  const appliedTagIds = canonicalTagIds(request.appliedTagIds)
  if (
    request.autoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(request.autoArchiveDuration)
  ) {
    throw new RangeError("Discord forum-post auto-archive duration is not supported")
  }
  assertOptionalIntegerRange(
    request.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord forum-post slowmode seconds",
  )
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord forum-post audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    appliedTagIds,
    auditReason: request.auditReason,
    autoArchiveDuration: request.autoArchiveDuration ?? null,
    channelId: request.channelId,
    content: request.content,
    name: request.name,
    notifyUserIds: canonicalDiscordNotificationUserIds(
      request.content,
      request.notifyUserIds,
    ),
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    rateLimitPerUser: request.rateLimitPerUser ?? null,
  }
}

function logicalNameKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, " ")
    .trim()
}

function targetLockKey(request: NormalizedForumPostRequest): string {
  return [request.channelId, logicalNameKey(request.name)].join("\0")
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ForumPostExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ForumPostExecutionError,
): Promise<T> {
  const prior = FORUM_POST_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  FORUM_POST_TARGET_LOCKS.set(key, tail)
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
    release(outcome)
    if (FORUM_POST_TARGET_LOCKS.get(key) === tail) {
      FORUM_POST_TARGET_LOCKS.delete(key)
    }
  }
}

function assertExactGuild(guild: DiscordGuild, guildId: string): void {
  if (
    guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || NAME_CONTROL_PATTERN.test(guild.name)
    || !validSnowflake(guild.owner_id)
  ) {
    throw new ForumPostEvidenceError(
      "Discord returned incomplete or mismatched forum-post guild evidence",
    )
  }
  assertValidUnicode(guild.name, "Discord guild name")
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
    throw new ForumPostEvidenceError(
      "Discord returned incomplete or mismatched connector member evidence",
    )
  }
}

function assertRoles(
  roles: readonly DiscordRole[],
  guildId: string,
  member: DiscordGuildMember,
): void {
  if (
    !Array.isArray(roles)
    || roles.length < 1
    || roles.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new ForumPostEvidenceError("Discord returned an invalid bounded role inventory")
  }
  const ids = new Set<string>()
  for (const role of roles as readonly unknown[]) {
    if (!role || typeof role !== "object" || Array.isArray(role)) {
      throw new ForumPostEvidenceError("Discord returned an invalid role object")
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
      throw new ForumPostEvidenceError("Discord returned malformed or duplicate role evidence")
    }
    ids.add(value.id)
  }
  if (!ids.has(guildId)) {
    throw new ForumPostEvidenceError("Discord role evidence omitted the guild @everyone role")
  }
  for (const roleId of member.roles) {
    if (!ids.has(roleId)) {
      throw new ForumPostEvidenceError(
        "Discord connector member references an unknown role",
      )
    }
  }
}

function assertPermissionOverwrites(
  overwrites: unknown,
  roleIds: ReadonlySet<string>,
): asserts overwrites is DiscordPermissionOverwrite[] {
  if (
    !Array.isArray(overwrites)
    || overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites
  ) {
    throw new ForumPostEvidenceError(
      "Discord forum evidence omitted or exceeded the bounded permission overwrite inventory",
    )
  }
  const targets = new Set<string>()
  for (const entry of overwrites as readonly unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ForumPostEvidenceError("Discord returned an invalid permission overwrite")
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
      throw new ForumPostEvidenceError(
        "Discord returned malformed, contradictory, duplicate, or unknown overwrite evidence",
      )
    }
    targets.add(key)
  }
}

function assertForumTags(tags: unknown): asserts tags is DiscordForumTag[] {
  if (
    !Array.isArray(tags)
    || tags.length > DISCORD_LIMITS.forumAvailableTags
  ) {
    throw new ForumPostEvidenceError(
      "Discord forum evidence omitted or exceeded the bounded available-tag inventory",
    )
  }
  const ids = new Set<string>()
  for (const entry of tags as readonly unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ForumPostEvidenceError("Discord returned an invalid forum tag object")
    }
    const tag = entry as Partial<DiscordForumTag>
    const emojiId = tag.emoji_id ?? null
    const emojiName = tag.emoji_name ?? null
    if (
      !validSnowflake(tag.id)
      || ids.has(tag.id)
      || typeof tag.name !== "string"
      || tag.name.length > 20
      || TAG_NAME_CONTROL_PATTERN.test(tag.name)
      || typeof tag.moderated !== "boolean"
      || !(emojiId === null || validSnowflake(emojiId))
      || !(emojiName === null || (
        typeof emojiName === "string"
        && emojiName.length > 0
        && emojiName.length <= 100
      ))
      || (emojiId !== null && emojiName !== null)
    ) {
      throw new ForumPostEvidenceError(
        "Discord returned malformed or duplicate forum tag evidence",
      )
    }
    assertValidUnicode(tag.name, "Discord forum tag name")
    if (emojiName !== null) assertValidUnicode(emojiName, "Discord forum tag emoji")
    ids.add(tag.id)
  }
}

function optionalForumDefault(
  value: unknown,
  allowed: readonly number[],
  name: string,
): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || !allowed.includes(value as number)) {
    throw new ForumPostEvidenceError(`Discord returned an invalid forum ${name}`)
  }
  return value as number
}

function optionalForumSlowmode(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (
    !Number.isInteger(value)
    || (value as number) < 0
    || (value as number) > DISCORD_LIMITS.channelRateLimitSeconds
  ) {
    throw new ForumPostEvidenceError(
      "Discord returned an invalid forum default thread slowmode",
    )
  }
  return value as number
}

function assertExactForum(
  channel: DiscordChannel,
  channelId: string,
): DiscordChannel {
  if (
    channel.id !== channelId
    || !validSnowflake(channel.id)
    || !validSnowflake(channel.guild_id)
    || channel.type !== DISCORD_CHANNEL_TYPES.forum
    || typeof channel.name !== "string"
    || channel.name.length < 1
    || channel.name.length > DISCORD_LIMITS.channelNameCharacters
    || NAME_CONTROL_PATTERN.test(channel.name)
    || (channel.flags !== undefined && (
      !Number.isSafeInteger(channel.flags) || channel.flags < 0
    ))
    || (channel.rate_limit_per_user !== undefined
      && channel.rate_limit_per_user !== null
      && (
        !Number.isInteger(channel.rate_limit_per_user)
        || channel.rate_limit_per_user < 0
        || channel.rate_limit_per_user > DISCORD_LIMITS.channelRateLimitSeconds
      ))
  ) {
    throw new ForumPostEvidenceError(
      "Discord returned a mismatched or malformed forum channel",
    )
  }
  assertValidUnicode(channel.name, "Discord forum channel name")
  optionalForumDefault(
    channel.default_auto_archive_duration,
    CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
    "default auto-archive duration",
  )
  optionalForumSlowmode(channel.default_thread_rate_limit_per_user)
  assertForumTags(channel.available_tags)
  return channel
}

function assertPermission(
  permission: BotChannelPermissionResult,
  moderatedTagSelected: boolean,
): DiscordPermissionName[] {
  if (permission.confidence !== "complete") {
    throw new ForumPostEvidenceError(
      `Discord connector bot permission evidence is incomplete: ${permission.warnings.join("; ")}`,
    )
  }
  const required: DiscordPermissionName[] = [
    ...REQUIRED_PERMISSIONS,
    ...(moderatedTagSelected ? ["MANAGE_THREADS" as const] : []),
  ]
  const effective = BigInt(permission.effectivePermissions)
  const missing = permission.administrator
    ? []
    : required.filter((name) => (
      (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
    ))
  if (missing.length > 0) {
    throw new ForumPostEvidenceError(
      `Discord connector bot lacks forum-post permissions: ${missing.join(", ")}`,
    )
  }
  return required
}

function forumSnapshot(channel: DiscordChannel) {
  return {
    availableTags: [...(channel.available_tags as DiscordForumTag[])]
      .map((tag) => ({
        emojiId: tag.emoji_id ?? null,
        emojiName: tag.emoji_name ?? null,
        id: tag.id,
        moderated: tag.moderated,
        name: tag.name,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    defaultAutoArchiveDuration: channel.default_auto_archive_duration ?? null,
    defaultThreadRateLimitPerUser: channel.default_thread_rate_limit_per_user ?? null,
    flags: channel.flags ?? 0,
    guildId: channel.guild_id,
    id: channel.id,
    name: channel.name,
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
  plan: ForumPostPlan
  request: NormalizedForumPostRequest
  status: ForumPostActivityStatus
  threadId?: string | null
  timestamp: string
  verification?: "drift" | "match" | null
}): ForumPostActivity {
  const threadId = options.threadId ?? null
  return {
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    id: options.activityId,
    kind: "forum-post-create",
    messageId: threadId,
    operationKeyHash: options.request.operationKeyHash,
    parentChannelId: options.request.channelId,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    threadId,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: ForumPostPlan
  request: NormalizedForumPostRequest
  status: OperationReceipt["status"]
  threadId?: string | null
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    kind: "forum-post",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.threadId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function createInput(request: NormalizedForumPostRequest): CreateForumPostInput {
  return {
    allowedMentions: discordAllowedMentions(request.notifyUserIds, false),
    ...(request.appliedTagIds.length > 0
      ? { appliedTagIds: request.appliedTagIds }
      : {}),
    ...(request.autoArchiveDuration !== null
      ? { autoArchiveDuration: request.autoArchiveDuration }
      : {}),
    content: request.content,
    name: request.name,
    ...(request.rateLimitPerUser !== null
      ? { rateLimitPerUser: request.rateLimitPerUser }
      : {}),
  }
}

function normalizedAppliedTags(channel: DiscordChannel): string[] {
  const tags = channel.applied_tags ?? []
  if (
    !Array.isArray(tags)
    || tags.length > DISCORD_LIMITS.forumAppliedTags
    || tags.some((tag) => !validSnowflake(tag))
    || new Set(tags).size !== tags.length
  ) {
    throw new ForumPostEvidenceError("Discord returned malformed applied forum tags")
  }
  return [...tags].sort()
}

function observedThread(
  thread: DiscordChannel,
  botId: string,
  guildId: string,
  parentChannelId: string,
  expectedThreadId?: string,
): Omit<ObservedForumPost, "content" | "messageId"> {
  const metadata = thread.thread_metadata
  if (
    !validSnowflake(thread.id)
    || (expectedThreadId !== undefined && thread.id !== expectedThreadId)
    || thread.guild_id !== guildId
    || thread.parent_id !== parentChannelId
    || thread.type !== DISCORD_CHANNEL_TYPES.publicThread
    || thread.owner_id !== botId
    || typeof thread.name !== "string"
    || thread.name.length < 1
    || thread.name.length > DISCORD_LIMITS.channelNameCharacters
    || NAME_CONTROL_PATTERN.test(thread.name)
    || !metadata
    || typeof metadata.archived !== "boolean"
    || typeof metadata.locked !== "boolean"
    || !Number.isInteger(metadata.auto_archive_duration)
    || !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(metadata.auto_archive_duration as number)
    || (thread.rate_limit_per_user !== undefined
      && thread.rate_limit_per_user !== null
      && (
        !Number.isInteger(thread.rate_limit_per_user)
        || thread.rate_limit_per_user < 0
        || thread.rate_limit_per_user > DISCORD_LIMITS.channelRateLimitSeconds
      ))
  ) {
    throw new ForumPostEvidenceError(
      "Discord returned a different or malformed created forum thread",
    )
  }
  assertValidUnicode(thread.name, "Discord forum thread name")
  return {
    appliedTagIds: normalizedAppliedTags(thread),
    archived: metadata.archived,
    autoArchiveDuration: metadata.auto_archive_duration as number,
    locked: metadata.locked,
    name: thread.name,
    rateLimitPerUser: thread.rate_limit_per_user ?? 0,
    threadId: thread.id,
  }
}

function observedStarterMessage(
  message: DiscordMessage,
  botId: string,
  guildId: string,
  threadId: string,
): Pick<ObservedForumPost, "content" | "messageId"> {
  if (
    !message
    || typeof message !== "object"
    || message.id !== threadId
    || message.channel_id !== threadId
    || message.guild_id !== guildId
    || !message.author
    || message.author.id !== botId
    || message.author.bot !== true
    || message.webhook_id !== undefined
    || message.type !== 0
    || typeof message.content !== "string"
    || (message.attachments !== undefined && (
      !Array.isArray(message.attachments) || message.attachments.length !== 0
    ))
    || (message.components !== undefined && (
      !Array.isArray(message.components) || message.components.length !== 0
    ))
  ) {
    throw new ForumPostEvidenceError(
      "Discord returned a different or malformed forum starter message",
    )
  }
  assertValidUnicode(message.content, "Discord forum starter content")
  return { content: message.content, messageId: message.id }
}

function observedForumPost(
  thread: DiscordChannel,
  message: DiscordMessage,
  botId: string,
  guildId: string,
  parentChannelId: string,
  expectedThreadId?: string,
): ObservedForumPost {
  const observed = observedThread(
    thread,
    botId,
    guildId,
    parentChannelId,
    expectedThreadId,
  )
  return {
    ...observed,
    ...observedStarterMessage(message, botId, guildId, observed.threadId),
  }
}

function driftFields(
  observed: ObservedForumPost,
  request: NormalizedForumPostRequest,
): ForumPostDriftField[] {
  const drift: ForumPostDriftField[] = []
  if (observed.name !== request.name) drift.push("name")
  if (observed.content !== request.content) drift.push("content")
  if (observed.appliedTagIds.join("\0") !== request.appliedTagIds.join("\0")) {
    drift.push("applied-tags")
  }
  if (
    request.autoArchiveDuration !== null
    && observed.autoArchiveDuration !== request.autoArchiveDuration
  ) drift.push("auto-archive-duration")
  if (
    request.rateLimitPerUser !== null
    && observed.rateLimitPerUser !== request.rateLimitPerUser
  ) drift.push("rate-limit-per-user")
  if (observed.archived || observed.locked) drift.push("thread-state")
  return drift
}

export class ForumPostService {
  readonly #activityStore: ActivityStore
  readonly #client: ForumPostServiceOptions["client"]
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ForumPostServiceOptions) {
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
    request: NormalizedForumPostRequest,
    options: RequestOptions,
  ): Promise<ForumPostState> {
    const existingReceipt = await this.#operationStore.get(
      "forum-post",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new ForumPostOperationConflictError(receiptView(existingReceipt))
    }
    const parent = assertExactForum(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
    )
    const guildId = this.#policy.assertForumPostAllowed(parent)
    const [guild, member, roles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    assertExactGuild(guild, guildId)
    assertExactMember(member, botId)
    assertRoles(roles, guildId, member)
    const roleIds = new Set(roles.map((role) => role.id))
    assertPermissionOverwrites(parent.permission_overwrites, roleIds)
    const tagsById = new Map(
      (parent.available_tags as DiscordForumTag[]).map((tag) => [tag.id, tag]),
    )
    const selectedTags = request.appliedTagIds.map((tagId) => {
      const tag = tagsById.get(tagId)
      if (!tag) {
        throw new ForumPostEvidenceError(
          `Discord forum does not contain selected tag ${tagId}`,
        )
      }
      return tag
    })
    if (
      ((parent.flags ?? 0) & DISCORD_CHANNEL_FLAGS.requireTag) !== 0
      && selectedTags.length === 0
    ) {
      throw new ForumPostEvidenceError("Discord forum requires at least one available tag")
    }
    const permission = evaluateBotChannelPermissions({
      botId,
      channel: parent,
      guildId,
      member,
      permissionChannel: parent,
      roles,
    })
    assertPermission(permission, selectedTags.some((tag) => tag.moderated))
    this.#policy.assertNotificationUsers(request.notifyUserIds)
    return {
      guild,
      guildId,
      member,
      parent,
      permission,
      roles,
      selectedTags,
    }
  }

  #planFromState(
    botId: string,
    request: NormalizedForumPostRequest,
    state: ForumPostState,
  ): ForumPostPlan {
    const requiredPermissionNames = assertPermission(
      state.permission,
      state.selectedTags.some((tag) => tag.moderated),
    )
    const digest = reviewedPlanDigest(this.#planKey, {
      botId,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      member: {
        roles: [...state.member.roles].sort(),
        userId: state.member.user?.id ?? null,
      },
      parent: forumSnapshot(state.parent),
      permission: {
        administrator: state.permission.administrator,
        confidence: state.permission.confidence,
        effectivePermissions: state.permission.effectivePermissions,
      },
      request: {
        appliedTagIds: request.appliedTagIds,
        auditReason: request.auditReason,
        autoArchiveDuration: request.autoArchiveDuration,
        channelId: request.channelId,
        content: request.content,
        name: request.name,
        notifyUserIds: request.notifyUserIds,
        operationKeyHash: request.operationKeyHash,
        rateLimitPerUser: request.rateLimitPerUser,
      },
      requiredPermissionNames,
      roles: roleSnapshot(state.roles),
      selectedTags: state.selectedTags
        .map((tag) => ({ id: tag.id, moderated: tag.moderated, name: tag.name }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    })
    return {
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: state.guildId,
        name: state.guild.name,
        ownerId: state.guild.owner_id as string,
      },
      operationKeyHash: request.operationKeyHash,
      parent: {
        availableTagCount: (state.parent.available_tags as DiscordForumTag[]).length,
        defaultAutoArchiveDuration: state.parent.default_auto_archive_duration ?? null,
        defaultThreadRateLimitPerUser:
          state.parent.default_thread_rate_limit_per_user ?? null,
        flags: state.parent.flags ?? 0,
        guildId: state.guildId,
        id: state.parent.id,
        name: state.parent.name as string,
        requireTag: ((state.parent.flags ?? 0) & DISCORD_CHANNEL_FLAGS.requireTag) !== 0,
        type: state.parent.type,
      },
      permission: {
        administrator: state.permission.administrator,
        confidence: "complete",
        effectivePermissionNames: state.permission.effectivePermissionNames,
        effectivePermissions: state.permission.effectivePermissions,
        requiredPermissionNames,
      },
      schemaVersion: SCHEMA_VERSION,
      selectedTags: state.selectedTags
        .map((tag) => ({ id: tag.id, moderated: tag.moderated, name: tag.name }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      status: "planned",
      target: {
        appliedTagIds: request.appliedTagIds,
        auditReason: request.auditReason,
        autoArchiveDuration: request.autoArchiveDuration,
        content: request.content,
        name: request.name,
        notificationUserIds: request.notifyUserIds,
        rateLimitPerUser: request.rateLimitPerUser,
      },
      warnings: [
        ...(state.permission.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with exact VIEW_CHANNEL, READ_MESSAGE_HISTORY, SEND_MESSAGES, and any required MANAGE_THREADS permissions"]
          : []),
        "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
        "Same-target serialization is process-local; do not run multiple connector processes with overlapping forum-post scope",
        "Execution creates one public forum thread and starter message without automatic retry, edit, deletion, or rollback",
        "The activity log and operation receipt never store the title, content, tags, notification users, audit reason, or raw operation key",
      ],
    }
  }

  async #prepare(
    botId: string,
    request: NormalizedForumPostRequest,
    options: RequestOptions,
  ): Promise<{ plan: ForumPostPlan; state: ForumPostState }> {
    const state = await this.#state(botId, request, options)
    return { plan: this.#planFromState(botId, request, state), state }
  }

  async plan(
    botId: string,
    request: ForumPostRequest,
    options: RequestOptions = {},
  ): Promise<ForumPostPlan> {
    return (await this.#prepare(
      botId,
      normalizeForumPostRequest(request),
      options,
    )).plan
  }

  async execute(
    botId: string,
    request: ForumPostRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ForumPostResult> {
    const normalized = normalizeForumPostRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord forum-post plan digest is invalid")
    }
    return withTargetLock(
      targetLockKey(normalized),
      () => this.#executeNormalized(botId, normalized, expectedDigest, options),
      () => new ForumPostExecutionError(
        "Discord forum post was blocked because a concurrent creation at the same logical target ended with an uncertain outcome",
        {
          guildId: null,
          operationKeyHash: normalized.operationKeyHash,
          parentChannelId: normalized.channelId,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    botId: string,
    normalized: NormalizedForumPostRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ForumPostResult> {
    let prepared: { plan: ForumPostPlan; state: ForumPostState }
    try {
      prepared = await this.#prepare(botId, normalized, options)
    } catch (error) {
      if (
        error instanceof ForumPostEvidenceError
        || (error instanceof DiscordApiError && error.status === 404)
      ) {
        throw new ForumPostPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan } = prepared
    if (plan.digest !== expectedDigest) {
      throw new ForumPostPlanChangedError(expectedDigest, plan.digest)
    }

    this.#limiter.reserve(normalized.channelId)
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request: normalized,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ForumPostOperationConflictError(receiptView(reservation.receipt))
    }

    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: normalized,
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
          request: normalized,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ForumPostExecutionError(
        "Discord forum post was blocked because pending activity could not be recorded",
        {
          activityId,
          error: safeErrorCode(error),
          guildId: plan.guild.id,
          operationKeyHash: normalized.operationKeyHash,
          operationRecordError,
          parentChannelId: normalized.channelId,
          planDigest: plan.digest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
          threadId: null,
        },
        { cause: error },
      )
    }

    let threadId: string | null = null
    let observed: ObservedForumPost | null = null
    try {
      const created: DiscordCreatedForumPost = await this.#client.createForumPost(
        normalized.channelId,
        createInput(normalized),
        normalized.auditReason,
        options,
      )
      if (validSnowflake(created?.id)) threadId = created.id
      if (!created.message) {
        throw new ForumPostEvidenceError(
          "Discord forum-post response omitted the starter message",
        )
      }
      observedForumPost(
        created,
        created.message,
        botId,
        plan.guild.id,
        normalized.channelId,
      )
      const [thread, message] = await Promise.all([
        this.#client.getChannel(created.id, options),
        this.#client.getMessage(created.id, created.id, options),
      ])
      observed = observedForumPost(
        thread,
        message,
        botId,
        plan.guild.id,
        normalized.channelId,
        created.id,
      )
    } catch (error) {
      const status = threadId === null
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
          plan,
          request: normalized,
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
          request: normalized,
          status,
          threadId,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ForumPostExecutionError(
        "Discord forum post did not complete with a verified successful outcome",
        {
          activityId,
          activityRecordError,
          error: errorCode,
          guildId: plan.guild.id,
          operationKeyHash: normalized.operationKeyHash,
          operationRecordError,
          parentChannelId: normalized.channelId,
          planDigest: plan.digest,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          schemaVersion: SCHEMA_VERSION,
          status,
          threadId,
        },
        { cause: error },
      )
    }

    const drift = driftFields(observed, normalized)
    const verification = drift.length === 0 ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: ForumPostResult = {
      activityId,
      driftFields: drift,
      guildId: plan.guild.id,
      messageId: observed.messageId,
      operationKeyHash: normalized.operationKeyHash,
      parentChannelId: normalized.channelId,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      status,
      threadId: observed.threadId,
      url: discordMessageUrl(plan.guild.id, observed.threadId, observed.messageId),
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request: normalized,
        status: "completed",
        threadId: observed.threadId,
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
          request: normalized,
          status,
          threadId: observed.threadId,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ForumPostExecutionError(
        "Discord forum post completed but the operation receipt failed",
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
        request: normalized,
        status,
        threadId: observed.threadId,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ForumPostExecutionError(
        "Discord forum post completed but the final activity record failed",
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
