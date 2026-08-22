import {
  createHmac,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  ReactionModerationActivity,
  ReactionModerationActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  REACTION_LIMITS,
  REACTION_TYPES,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type ReactionUserPageOptions,
} from "./discord-client.js"
import {
  DiscordApiError,
  ReactionEvidenceError,
  ReactionModerationExecutionError,
  ReactionModerationOperationConflictError,
  ReactionModerationPlanChangedError,
} from "./errors.js"
import {
  discordMessageUrl,
  stableString,
} from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateBotChannelPermissions,
  type BotChannelPermissionResult,
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
  DiscordPartialEmoji,
  DiscordReaction,
  DiscordReactionType,
  DiscordRole,
  DiscordThreadMember,
  DiscordUser,
  RequestOptions,
} from "./types.js"

export const REACTION_MODERATION_SCOPES = [
  "all",
  "emoji",
  "user",
] as const

export type ReactionModerationScope = typeof REACTION_MODERATION_SCOPES[number]

const CUSTOM_EMOJI_PATTERN = /^([A-Za-z0-9_]{2,32}):([0-9]{1,20})$/
const CUSTOM_EMOJI_NAME_PATTERN = /^[A-Za-z0-9_]{2,32}$/
const EMOJI_CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/u
const EMOJI_CODE_POINT_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u
const BURST_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/
const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const STATE_UNAVAILABLE = "reaction-state-unavailable"
const THREAD_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const THREAD_PARENT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const VOICE_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
const REACTION_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const PRIVACY_OMITTED_FIELDS = [
  "attachments",
  "author",
  "burstColors",
  "components",
  "content",
  "embeds",
  "memberProfiles",
  "rawPayloads",
  "userAvatars",
  "userGlobalNames",
  "userNames",
] as const
type ReactionTargetOutcome = "settled" | "uncertain"
const REACTION_MESSAGE_LOCKS = new Map<string, Promise<ReactionTargetOutcome>>()

export interface NormalizedReactionEmoji {
  id: string | null
  key: string
  kind: "custom" | "unicode"
  name: string
  routeToken: string
}

export interface ReactionEmojiSummary {
  animated: boolean
  id: string | null
  kind: "custom" | "unicode"
  name: string | null
  routeToken: string | null
}

export interface ReactionAggregate {
  burstCount: number
  count: number
  emoji: ReactionEmojiSummary
  me: boolean
  meBurst: boolean
  normalCount: number
}

export interface ReactionPrivacyProjection {
  omittedFields: typeof PRIVACY_OMITTED_FIELDS
  persistence: "none"
  profilesProjectedOut: true
  rawPayloads: "omitted"
}

export interface MessageReactionInventoryResult {
  channel: {
    id: string
    parentId: string | null
    type: number
  }
  guildId: string
  message: {
    id: string
    timestamp: string
    type: number
    url: string
  }
  privacy: ReactionPrivacyProjection
  reactions: ReactionAggregate[]
  schemaVersion: number
  status: "ok"
}

export interface ReactionUserPageResult {
  channelId: string
  emoji: ReactionEmojiSummary
  guildId: string
  messageId: string
  page: {
    nextAfter: string | null
    requestedAfter: string | null
    requestedLimit: number
    returned: number
  }
  privacy: ReactionPrivacyProjection
  reactionType: "burst" | "normal"
  schemaVersion: number
  status: "ok"
  users: Array<{
    bot: boolean
    id: string
  }>
}

export interface ReactionModerationRequest {
  auditReason: string
  channelId: string
  emoji?: string
  messageId: string
  operationKey: string
  scope: ReactionModerationScope
  userId?: string
}

export interface NormalizedReactionModerationRequest {
  auditReason: string
  channelId: string
  emoji: NormalizedReactionEmoji | null
  messageId: string
  operationKeyHash: string
  scope: ReactionModerationScope
  userId: string | null
}

export interface ReactionModerationAccessEvidence {
  administrator: boolean
  appliedRoleIds: string[]
  canReadMessages: true
  confidence: "complete"
  connect: boolean | null
  effectivePermissions: string
  manageMessages: true
  permissionSourceChannelId: string
  privateThreadAccess: "lookup-succeeded" | "not-applicable"
  readMessageHistory: true
  viewChannel: true
}

export interface ReactionModerationPlan {
  action: "none" | "remove"
  applicationId: string
  auditReason: string
  botId: string
  channel: {
    id: string
    parentId: string | null
    type: number
  }
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  message: {
    id: string
    timestamp: string
    type: number
    url: string
  }
  operationKeyHash: string
  permission: ReactionModerationAccessEvidence
  privacy: ReactionPrivacyProjection
  reactions: ReactionAggregate[]
  schemaVersion: number
  status: "already-absent" | "planned"
  target: {
    emoji: ReactionEmojiSummary | null
    scope: ReactionModerationScope
    userBot: boolean | null
    userId: string | null
  }
  warnings: string[]
  writeRequired: boolean
}

export interface ReactionModerationResult {
  activityId: string | null
  channelId: string
  exactSnapshotMatched: boolean
  guildId: string
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-absent" | "completed" | "completed-with-drift"
  targetAbsent: true
  url: string
}

export interface ReactionServiceClient extends Pick<
  DiscordClient,
  | "deleteAllMessageReactions"
  | "deleteAllMessageReactionsForEmoji"
  | "deleteUserReaction"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
  | "getThreadMember"
  | "listReactionUsers"
> {}

export interface ReactionServiceOptions {
  activityStore: ActivityStore
  client: ReactionServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface ReactionMessageEvidence {
  channel: DiscordChannel
  guildId: string
  message: DiscordMessage
  reactions: ReactionAggregate[]
}

interface ReactionModerationState extends ReactionMessageEvidence {
  botMember: DiscordGuildMember
  guild: DiscordGuild
  permissionChannel: DiscordChannel
  permissions: BotChannelPermissionResult & { confidence: "complete" }
  roles: DiscordRole[]
  target: ReactionAggregate | null
  targetUserBot: boolean | null
  targetUserPresent: boolean
}

interface BuiltReactionModerationPlan {
  plan: ReactionModerationPlan
  state: ReactionModerationState
}

function evidenceError(message: string, cause?: unknown): ReactionEvidenceError {
  return new ReactionEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, description: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && ISO_8601_TIMESTAMP_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value))
}

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > maximum
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function onlyKnownKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const known = new Set(keys)
  return Object.keys(record).every((key) => known.has(key))
}

export function normalizeReactionEmoji(value: string): NormalizedReactionEmoji {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || EMOJI_CONTROL_OR_SPACE_PATTERN.test(value)
  ) {
    throw new RangeError(
      "Discord reaction emoji is empty, too long, or contains whitespace or controls",
    )
  }
  const custom = CUSTOM_EMOJI_PATTERN.exec(value)
  if (custom) {
    const [, name, id] = custom
    if (!name || !id) {
      throw new RangeError("Discord custom reaction emoji is invalid")
    }
    assertPositiveSnowflake(id, "Discord custom reaction emoji ID")
    return {
      id,
      key: `custom:${id}`,
      kind: "custom",
      name,
      routeToken: `${name}:${id}`,
    }
  }
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
  if (segments.length !== 1 || !EMOJI_CODE_POINT_PATTERN.test(value)) {
    throw new RangeError("Discord reaction emoji must be one Unicode emoji or name:snowflake")
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError("Discord reaction emoji contains invalid Unicode", { cause: error })
  }
  return {
    id: null,
    key: `unicode:${value}`,
    kind: "unicode",
    name: value,
    routeToken: value,
  }
}

function reactionEmoji(value: DiscordPartialEmoji): ReactionEmojiSummary & { key: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned an invalid reaction emoji")
  }
  if (!onlyKnownKeys(value as Record<string, unknown>, ["animated", "id", "name"])) {
    throw evidenceError("Discord returned unknown reaction emoji fields")
  }
  const id = value.id ?? null
  const animated = value.animated ?? false
  if (typeof animated !== "boolean") {
    throw evidenceError("Discord returned invalid reaction emoji animation state")
  }
  if (id === null) {
    if (typeof value.name !== "string") {
      throw evidenceError("Discord returned a Unicode reaction without its emoji")
    }
    let normalized: NormalizedReactionEmoji
    try {
      normalized = normalizeReactionEmoji(value.name)
    } catch (error) {
      throw evidenceError("Discord returned an invalid Unicode reaction emoji", error)
    }
    if (normalized.kind !== "unicode" || animated) {
      throw evidenceError("Discord returned ambiguous Unicode reaction emoji evidence")
    }
    return {
      animated: false,
      id: null,
      key: normalized.key,
      kind: "unicode",
      name: normalized.name,
      routeToken: normalized.routeToken,
    }
  }
  if (!positiveSnowflake(id)) {
    throw evidenceError("Discord returned an invalid custom reaction emoji ID")
  }
  const name = value.name ?? null
  if (name !== null && !CUSTOM_EMOJI_NAME_PATTERN.test(name)) {
    throw evidenceError("Discord returned an invalid custom reaction emoji name")
  }
  return {
    animated,
    id,
    key: `custom:${id}`,
    kind: "custom",
    name,
    routeToken: name === null ? null : `${name}:${id}`,
  }
}

export function parseReactionAggregates(
  value: readonly DiscordReaction[] | undefined,
): ReactionAggregate[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > REACTION_LIMITS.aggregatesPerMessage) {
    throw evidenceError("Discord returned an invalid bounded message reaction inventory")
  }
  const keys = new Set<string>()
  const reactions = value.map((entry) => {
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || !exactKeys(entry as unknown as Record<string, unknown>, [
        "burst_colors",
        "count",
        "count_details",
        "emoji",
        "me",
        "me_burst",
      ])
      || !Number.isSafeInteger(entry.count)
      || entry.count < 1
      || !entry.count_details
      || typeof entry.count_details !== "object"
      || Array.isArray(entry.count_details)
      || !exactKeys(
        entry.count_details as unknown as Record<string, unknown>,
        ["burst", "normal"],
      )
      || !Number.isSafeInteger(entry.count_details.normal)
      || entry.count_details.normal < 0
      || !Number.isSafeInteger(entry.count_details.burst)
      || entry.count_details.burst < 0
      || entry.count !== entry.count_details.normal + entry.count_details.burst
      || typeof entry.me !== "boolean"
      || typeof entry.me_burst !== "boolean"
      || entry.me && entry.count_details.normal < 1
      || entry.me_burst && entry.count_details.burst < 1
      || !Array.isArray(entry.burst_colors)
      || entry.burst_colors.length > REACTION_LIMITS.burstColorsPerReaction
      || entry.burst_colors.some((color: unknown) => (
        typeof color !== "string" || !BURST_COLOR_PATTERN.test(color)
      ))
    ) {
      throw evidenceError("Discord returned invalid message reaction counts")
    }
    const emoji = reactionEmoji(entry.emoji)
    if (keys.has(emoji.key)) {
      throw evidenceError("Discord returned duplicate emoji in one message reaction inventory")
    }
    keys.add(emoji.key)
    const { key, ...summary } = emoji
    return {
      burstCount: entry.count_details.burst,
      count: entry.count,
      emoji: summary,
      me: entry.me,
      meBurst: entry.me_burst,
      normalCount: entry.count_details.normal,
    }
  })
  return reactions.sort((left, right) => (
    reactionKey(left.emoji).localeCompare(reactionKey(right.emoji))
  ))
}

function reactionKey(emoji: ReactionEmojiSummary): string {
  return emoji.kind === "custom"
    ? `custom:${emoji.id ?? "invalid"}`
    : `unicode:${emoji.name ?? "invalid"}`
}

function matchingReaction(
  reactions: readonly ReactionAggregate[],
  emoji: NormalizedReactionEmoji,
): ReactionAggregate | null {
  return reactions.find((entry) => reactionKey(entry.emoji) === emoji.key) ?? null
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
    || !REACTION_CHANNEL_TYPES.has(channel.type)
    || !positiveSnowflake(channel.guild_id)
    || (
      channel.parent_id !== undefined
      && channel.parent_id !== null
      && !positiveSnowflake(channel.parent_id)
    )
    || (
      channel.permission_overwrites !== undefined
      && !Array.isArray(channel.permission_overwrites)
    )
  ) {
    throw evidenceError(`Discord returned invalid ${description} channel evidence`)
  }
  return channel
}

function exactMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
): DiscordMessage {
  if (
    !message
    || typeof message !== "object"
    || Array.isArray(message)
    || message.id !== messageId
    || message.channel_id !== channelId
    || (message.guild_id !== undefined && message.guild_id !== guildId)
    || !validTimestamp(message.timestamp)
    || !Number.isSafeInteger(message.type)
    || message.type < 0
  ) {
    throw evidenceError("Discord returned incomplete or mismatched reaction message evidence")
  }
  return message
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || !validText(guild.name, DISCORD_LIMITS.channelNameCharacters)
    || !positiveSnowflake(guild.owner_id)
  ) {
    throw evidenceError("Discord returned invalid reaction guild evidence")
  }
  return guild
}

function exactBotMember(member: DiscordGuildMember, botId: string): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(member.roles).size !== member.roles.length
    || member.roles.some((roleId) => !positiveSnowflake(roleId))
    || !member.user
    || member.user.id !== botId
    || member.user.bot !== true
  ) {
    throw evidenceError("Discord returned invalid connector bot reaction member evidence")
  }
  return member
}

function exactRoles(value: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded reaction role inventory")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(role.permissions)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate reaction role evidence")
    }
    ids.add(role.id)
    return role
  })
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord returned invalid reaction @everyone role evidence")
  }
  return [...roles].sort((left, right) => left.id.localeCompare(right.id))
}

function exactPrivateThreadMember(
  member: DiscordThreadMember,
  threadId: string,
  botId: string,
): void {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || member.id !== threadId
    || member.user_id !== botId
    || !Number.isSafeInteger(member.flags)
    || member.flags < 0
    || !validTimestamp(member.join_timestamp)
  ) {
    throw evidenceError("Discord returned mismatched private-thread reaction membership evidence")
  }
}

function exactReactionUsers(
  value: readonly DiscordUser[],
  limit: number,
  after: string | undefined,
): Array<{ bot: boolean; id: string }> {
  if (!Array.isArray(value) || value.length > limit) {
    throw evidenceError("Discord returned an invalid bounded reaction user page")
  }
  const seen = new Set<string>()
  let previousId = after === undefined ? null : BigInt(after)
  const users = value.map((user) => {
    const userId = positiveSnowflake(user?.id) ? BigInt(user.id) : null
    if (
      !user
      || typeof user !== "object"
      || Array.isArray(user)
      || userId === null
      || (user.bot !== undefined && typeof user.bot !== "boolean")
      || seen.has(user.id)
      || (previousId !== null && userId <= previousId)
    ) {
      throw evidenceError("Discord returned invalid, duplicate, or unordered reaction user evidence")
    }
    seen.add(user.id)
    previousId = userId
    return { bot: user.bot ?? false, id: user.id }
  })
  return users
}

function privacyProjection(): ReactionPrivacyProjection {
  return {
    omittedFields: PRIVACY_OMITTED_FIELDS,
    persistence: "none",
    profilesProjectedOut: true,
    rawPayloads: "omitted",
  }
}

function reactionTypeName(type: DiscordReactionType): "burst" | "normal" {
  return type === REACTION_TYPES.burst ? "burst" : "normal"
}

function channelSummary(channel: DiscordChannel) {
  return {
    id: channel.id,
    parentId: channel.parent_id ?? null,
    type: channel.type,
  }
}

function messageSummary(message: DiscordMessage, guildId: string) {
  return {
    id: message.id,
    timestamp: message.timestamp,
    type: message.type,
    url: discordMessageUrl(guildId, message.channel_id, message.id),
  }
}

function userCursorBefore(userId: string): string {
  const value = BigInt(userId)
  return (value - 1n).toString()
}

function overwriteSnapshot(channel: DiscordChannel) {
  return (channel.permission_overwrites || [])
    .map((overwrite) => ({
      allow: overwrite.allow ?? "0",
      deny: overwrite.deny ?? "0",
      id: overwrite.id,
      type: overwrite.type,
    }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.type - right.type)
}

function relevantRoleSnapshot(
  roles: readonly DiscordRole[],
  roleIds: readonly string[],
) {
  const relevant = new Set(roleIds)
  return roles
    .filter((role) => relevant.has(role.id))
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function hasPermission(
  result: BotChannelPermissionResult,
  permission: "CONNECT" | "MANAGE_MESSAGES" | "READ_MESSAGE_HISTORY" | "VIEW_CHANNEL",
): boolean {
  return result.effectivePermissionNames.includes(permission)
}

function accessEvidence(
  permissions: BotChannelPermissionResult & { confidence: "complete" },
  voice: boolean,
): ReactionModerationAccessEvidence {
  return {
    administrator: permissions.administrator,
    appliedRoleIds: permissions.appliedRoleIds,
    canReadMessages: true,
    confidence: "complete",
    connect: voice ? true : null,
    effectivePermissions: permissions.effectivePermissions,
    manageMessages: true,
    permissionSourceChannelId: permissions.permissionSourceChannelId,
    privateThreadAccess: permissions.privateThreadAccess,
    readMessageHistory: true,
    viewChannel: true,
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

function emojiFingerprint(
  emoji: NormalizedReactionEmoji | null,
  key: Uint8Array,
): string | null {
  if (emoji === null) return null
  return `hmac-sha256:${createHmac("sha256", key)
    .update("discord-mcp-reaction-emoji-fingerprint.v1\0")
    .update(emoji.key)
    .digest("hex")}`
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    messageId: receipt.resourceId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  planKey: Uint8Array
  plan: ReactionModerationPlan
  request: NormalizedReactionModerationRequest
  status: ReactionModerationActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ReactionModerationActivity {
  return {
    channelId: options.request.channelId,
    customEmojiId: options.request.emoji?.id ?? null,
    emojiFingerprint: emojiFingerprint(options.request.emoji, options.planKey),
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "reaction-moderation",
    messageId: options.request.messageId,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    scope: options.request.scope,
    status: options.status,
    timestamp: options.timestamp,
    userId: options.request.userId,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: ReactionModerationPlan
  request: NormalizedReactionModerationRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "reaction-moderation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.messageId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ReactionModerationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withMessageLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ReactionModerationExecutionError,
): Promise<T> {
  const prior = REACTION_MESSAGE_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ReactionTargetOutcome) => void = () => undefined
  const tail = new Promise<ReactionTargetOutcome>((resolve) => {
    release = resolve
  })
  REACTION_MESSAGE_LOCKS.set(key, tail)
  let outcome: ReactionTargetOutcome = "settled"
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
    if (outcome === "settled" && REACTION_MESSAGE_LOCKS.get(key) === tail) {
      REACTION_MESSAGE_LOCKS.delete(key)
    }
  }
}

export function normalizeReactionModerationRequest(
  request: ReactionModerationRequest,
): NormalizedReactionModerationRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord reaction-moderation request must be an object")
  }
  if (!REACTION_MODERATION_SCOPES.includes(request.scope)) {
    throw new RangeError("Discord reaction-moderation scope is not supported")
  }
  const keys = request.scope === "all"
    ? ["auditReason", "channelId", "messageId", "operationKey", "scope"]
    : request.scope === "emoji"
      ? ["auditReason", "channelId", "emoji", "messageId", "operationKey", "scope"]
      : ["auditReason", "channelId", "emoji", "messageId", "operationKey", "scope", "userId"]
  if (!exactKeys(request as unknown as Record<string, unknown>, keys)) {
    throw new RangeError("Discord reaction-moderation request must contain exact scope fields")
  }
  assertPositiveSnowflake(request.channelId, "Discord reaction-moderation channel ID")
  assertPositiveSnowflake(request.messageId, "Discord reaction-moderation message ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord reaction-moderation local audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  const emoji = request.scope === "all"
    ? null
    : normalizeReactionEmoji(request.emoji as string)
  const userId = request.scope === "user" ? request.userId as string : null
  if (userId !== null) {
    assertPositiveSnowflake(userId, "Discord reaction-moderation user ID")
  }
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    emoji,
    messageId: request.messageId,
    operationKeyHash: operationKeyHash(request.operationKey),
    scope: request.scope,
    userId,
  }
}

function expectedAfterRemoval(
  reactions: readonly ReactionAggregate[],
  request: NormalizedReactionModerationRequest,
): ReactionAggregate[] {
  if (request.scope === "all") return []
  const key = request.emoji?.key
  if (!key) throw evidenceError("Discord reaction-moderation target emoji is unavailable")
  if (request.scope === "emoji") {
    return reactions.filter((entry) => reactionKey(entry.emoji) !== key)
  }
  return reactions.flatMap((entry) => {
    if (reactionKey(entry.emoji) !== key) return [entry]
    const normalCount = entry.normalCount - 1
    const count = entry.count - 1
    if (normalCount < 0 || count < 0) {
      throw evidenceError("Discord reaction-moderation expected state is invalid")
    }
    if (count === 0) return []
    return [{ ...entry, count, normalCount }]
  })
}

export class ReactionService {
  readonly #activityStore: ActivityStore
  readonly #client: ReactionServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ReactionServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #messageEvidence(
    channelId: string,
    messageId: string,
    scope: "audit" | "read",
    options: RequestOptions,
  ): Promise<ReactionMessageEvidence> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    if (scope === "audit") {
      this.#policy.assertChannelReactionIdAuditable(channelId)
    }
    const channel = exactChannel(
      await this.#client.getChannel(channelId, options),
      channelId,
      "reaction target",
    )
    const guildId = scope === "audit"
      ? this.#policy.assertChannelReactionAuditable(channel)
      : this.#policy.assertChannelReadable(channel)
    const message = exactMessage(
      await this.#client.getMessage(channelId, messageId, options),
      channelId,
      guildId,
      messageId,
    )
    return {
      channel,
      guildId,
      message,
      reactions: parseReactionAggregates(message.reactions),
    }
  }

  async listMessageReactions(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<MessageReactionInventoryResult> {
    const state = await this.#messageEvidence(channelId, messageId, "read", options)
    return {
      channel: channelSummary(state.channel),
      guildId: state.guildId,
      message: messageSummary(state.message, state.guildId),
      privacy: privacyProjection(),
      reactions: state.reactions,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #reactionUsers(
    state: ReactionMessageEvidence,
    emoji: NormalizedReactionEmoji,
    options: ReactionUserPageOptions,
  ): Promise<ReactionUserPageResult> {
    const limit = options.limit ?? REACTION_LIMITS.userPageDefault
    if (!Number.isInteger(limit) || limit < 1 || limit > REACTION_LIMITS.userPage) {
      throw new RangeError(
        `Discord reaction user page limit must be an integer between 1 and ${REACTION_LIMITS.userPage}`,
      )
    }
    if (options.after !== undefined) {
      assertPositiveSnowflake(options.after, "Discord reaction user cursor")
    }
    const type = options.type ?? REACTION_TYPES.normal
    if (type !== REACTION_TYPES.normal && type !== REACTION_TYPES.burst) {
      throw new RangeError("Discord reaction type must be normal or burst")
    }
    const aggregate = matchingReaction(state.reactions, emoji)
    const available = aggregate !== null && (
      type === REACTION_TYPES.normal
        ? aggregate.normalCount > 0
        : aggregate.burstCount > 0
    )
    let users: Array<{ bot: boolean; id: string }> = []
    if (available) {
      if (aggregate.emoji.routeToken === null) {
        throw evidenceError("Discord reaction cannot be addressed because its custom emoji name is absent")
      }
      const raw = await this.#client.listReactionUsers(
        state.channel.id,
        state.message.id,
        aggregate.emoji.routeToken,
        {
          ...(options.after ? { after: options.after } : {}),
          limit,
          ...(options.signal ? { signal: options.signal } : {}),
          type,
        },
      )
      users = exactReactionUsers(raw, limit, options.after)
    }
    return {
      channelId: state.channel.id,
      emoji: aggregate?.emoji ?? {
        animated: false,
        id: emoji.id,
        kind: emoji.kind,
        name: emoji.name,
        routeToken: emoji.routeToken,
      },
      guildId: state.guildId,
      messageId: state.message.id,
      page: {
        nextAfter: users.length === limit ? users.at(-1)?.id ?? null : null,
        requestedAfter: options.after ?? null,
        requestedLimit: limit,
        returned: users.length,
      },
      privacy: privacyProjection(),
      reactionType: reactionTypeName(type),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      users,
    }
  }

  async listReactionUsers(
    channelId: string,
    messageId: string,
    emoji: string,
    options: ReactionUserPageOptions = {},
  ): Promise<ReactionUserPageResult> {
    const normalized = normalizeReactionEmoji(emoji)
    const state = await this.#messageEvidence(channelId, messageId, "audit", options)
    return this.#reactionUsers(state, normalized, options)
  }

  async #targetUser(
    state: ReactionMessageEvidence,
    emoji: NormalizedReactionEmoji,
    userId: string,
    options: RequestOptions,
  ): Promise<{ bot: boolean | null; present: boolean }> {
    const aggregate = matchingReaction(state.reactions, emoji)
    if (!aggregate || aggregate.normalCount === 0) return { bot: null, present: false }
    if (aggregate.emoji.routeToken === null) {
      throw evidenceError("Discord reaction cannot be addressed because its custom emoji name is absent")
    }
    const after = userCursorBefore(userId)
    const raw = await this.#client.listReactionUsers(
      state.channel.id,
      state.message.id,
      aggregate.emoji.routeToken,
      {
        after,
        limit: 1,
        ...(options.signal ? { signal: options.signal } : {}),
        type: REACTION_TYPES.normal,
      },
    )
    const users = exactReactionUsers(raw, 1, after)
    const target = users.find((user) => user.id === userId)
    return target ? { bot: target.bot, present: true } : { bot: null, present: false }
  }

  async #moderationState(
    botId: string,
    request: NormalizedReactionModerationRequest,
    options: RequestOptions,
  ): Promise<ReactionModerationState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertChannelReactionIdModeratable(request.channelId)
    if (request.scope === "user") {
      if (!request.emoji || !request.userId) {
        throw evidenceError("Discord reaction user target is incomplete")
      }
      if (request.userId === botId) {
        throw evidenceError("Discord connector own reaction must use remove_own_reaction")
      }
      this.#policy.assertUserNotProtected(request.userId)
    }
    const channel = exactChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
      "reaction-moderation target",
    )
    const guildId = this.#policy.assertChannelReactionModeratable(channel)
    const receipt = await this.#operationStore.get(
      "reaction-moderation",
      request.operationKeyHash,
    )
    if (receipt) {
      throw new ReactionModerationOperationConflictError(receiptView(receipt))
    }

    let permissionChannel = channel
    if (THREAD_TYPES.has(channel.type)) {
      if (!channel.parent_id) {
        throw evidenceError("Discord reaction target thread omitted its parent channel ID")
      }
      permissionChannel = exactChannel(
        await this.#client.getChannel(channel.parent_id, options),
        channel.parent_id,
        "reaction permission source",
      )
      if (
        permissionChannel.guild_id !== guildId
        || THREAD_TYPES.has(permissionChannel.type)
        || !THREAD_PARENT_TYPES.has(permissionChannel.type)
      ) {
        throw evidenceError("Discord returned an invalid reaction permission source")
      }
      if (channel.type === DISCORD_CHANNEL_TYPES.privateThread) {
        exactPrivateThreadMember(
          await this.#client.getThreadMember(channel.id, botId, options),
          channel.id,
          botId,
        )
      }
    }

    const [rawGuild, rawMember, rawRoles, rawMessage] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getMessage(request.channelId, request.messageId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    const message = exactMessage(rawMessage, request.channelId, guildId, request.messageId)
    const reactions = parseReactionAggregates(message.reactions)
    let permissions: BotChannelPermissionResult
    try {
      permissions = evaluateBotChannelPermissions({
        botId,
        channel,
        guildId,
        member: botMember,
        permissionChannel,
        roles,
      })
    } catch (error) {
      throw evidenceError("Discord returned invalid reaction permission evidence", error)
    }
    if (permissions.confidence !== "complete") {
      throw evidenceError(
        `Discord returned incomplete reaction permission evidence: ${permissions.warnings.join("; ")}`,
      )
    }
    for (const permission of ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "MANAGE_MESSAGES"] as const) {
      if (!hasPermission(permissions, permission)) {
        throw evidenceError(`Discord connector bot lacks channel-level ${permission}`)
      }
    }
    if (VOICE_CHANNEL_TYPES.has(channel.type) && !hasPermission(permissions, "CONNECT")) {
      throw evidenceError("Discord connector bot lacks channel-level CONNECT")
    }
    if (permissions.canReadMessages !== true) {
      throw evidenceError("Discord connector bot lacks channel-level message-read prerequisites")
    }

    const target = request.emoji === null ? null : matchingReaction(reactions, request.emoji)
    if (target && request.scope !== "all" && target.emoji.routeToken === null) {
      throw evidenceError("Discord reaction target has no addressable custom emoji name")
    }
    let targetUserPresent = false
    let targetUserBot: boolean | null = null
    if (request.scope === "user") {
      if (!request.emoji || !request.userId) {
        throw evidenceError("Discord reaction user target is incomplete")
      }
      const user = await this.#targetUser(
        { channel, guildId, message, reactions },
        request.emoji,
        request.userId,
        options,
      )
      targetUserPresent = user.present
      targetUserBot = user.bot
      if (targetUserPresent && target?.me && target.normalCount < 2) {
        throw evidenceError(
          "Discord returned inconsistent connector and target-user reaction evidence",
        )
      }
    }
    return {
      botMember,
      channel,
      guild,
      guildId,
      message,
      permissionChannel,
      permissions: permissions as BotChannelPermissionResult & { confidence: "complete" },
      reactions,
      roles,
      target,
      targetUserBot,
      targetUserPresent,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedReactionModerationRequest,
    options: RequestOptions,
  ): Promise<BuiltReactionModerationPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#moderationState(botId, request, options)
    const targetPresent = request.scope === "all"
      ? state.reactions.length > 0
      : request.scope === "emoji"
        ? state.target !== null
        : state.targetUserPresent
    const action = targetPresent ? "remove" : "none"
    const privacy = privacyProjection()
    const voice = VOICE_CHANNEL_TYPES.has(state.channel.type)
    const permission = accessEvidence(state.permissions, voice)
    const targetEmoji = state.target?.emoji ?? (request.emoji === null ? null : {
      animated: false,
      id: request.emoji.id,
      kind: request.emoji.kind,
      name: request.emoji.name,
      routeToken: request.emoji.routeToken,
    })
    const warnings = [
      ...(state.permissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL, READ_MESSAGE_HISTORY, MANAGE_MESSAGES, and conditional CONNECT permissions"]
        : []),
      ...(request.scope === "user"
        ? ["The exact target passed the connector-owned and protected-user exclusions before target access"]
        : [`The ${request.scope} scope is identity-blind and can remove reactions from locally protected users; protected-user IDs guard only exact user scope`]),
      "The audit reason is transient local review context because Discord does not document audit-log reason support for reaction endpoints; it is neither sent to Discord nor persisted",
      "Message content, author data, usernames, profiles, burst colors, and raw payloads are projected out and never persisted by this workflow",
      "Reviewed same-message writes coordinate across cooperating connector processes; ordinary own-reaction and external changes can race and will be reported as drift or uncertainty",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      action,
      applicationId,
      botId,
      botMemberRoleIds: [...state.botMember.roles].sort(),
      channel: channelSummary(state.channel),
      domain: "discord-mcp-reaction-moderation-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      message: messageSummary(state.message, state.guildId),
      permissionChannel: {
        guildId: state.permissionChannel.guild_id,
        id: state.permissionChannel.id,
        overwrites: overwriteSnapshot(state.permissionChannel),
        type: state.permissionChannel.type,
      },
      permission,
      privacy,
      reactions: state.reactions,
      request,
      roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
      target: {
        emoji: targetEmoji,
        userBot: state.targetUserBot,
        userPresent: state.targetUserPresent,
      },
      warnings,
    })
    const plan: ReactionModerationPlan = {
      action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      channel: channelSummary(state.channel),
      createdAt: this.#clock().toISOString(),
      digest,
      guild: { id: state.guild.id, name: state.guild.name },
      message: messageSummary(state.message, state.guildId),
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      reactions: state.reactions,
      schemaVersion: SCHEMA_VERSION,
      status: targetPresent ? "planned" : "already-absent",
      target: {
        emoji: targetEmoji,
        scope: request.scope,
        userBot: state.targetUserBot,
        userId: request.userId,
      },
      warnings,
      writeRequired: targetPresent,
    }
    return { plan, state }
  }

  plan(
    applicationId: string,
    botId: string,
    request: ReactionModerationRequest,
    options: RequestOptions = {},
  ): Promise<ReactionModerationPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeReactionModerationRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: ReactionModerationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ReactionModerationResult> {
    const normalized = normalizeReactionModerationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord reaction-moderation plan digest is invalid")
    }
    return withMessageLock(
      `${normalized.channelId}\0${normalized.messageId}`,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ReactionModerationExecutionError(
        "Discord reaction moderation was blocked because a prior same-message operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
          messageId: normalized.messageId,
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
    request: NormalizedReactionModerationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ReactionModerationResult> {
    let built: BuiltReactionModerationPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ReactionEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ReactionModerationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new ReactionModerationPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: state.guildId,
      messageId: request.messageId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      url: plan.message.url,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        exactSnapshotMatched: true,
        status: "already-absent",
        targetAbsent: true,
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: state.guildId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ReactionModerationOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        guildId: state.guildId,
        planKey: this.#planKey,
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
          guildId: state.guildId,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ReactionModerationExecutionError(
        "Discord reaction moderation was blocked because pending activity could not be recorded",
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
    let exactSnapshotMatched: boolean | null = null
    let targetAbsent: boolean | null = null
    try {
      if (request.scope === "all") {
        await this.#client.deleteAllMessageReactions(
          request.channelId,
          request.messageId,
          options,
        )
      } else {
        const routeToken = plan.target.emoji?.routeToken
        if (!routeToken) throw evidenceError("Discord reaction target route is unavailable")
        if (request.scope === "emoji") {
          await this.#client.deleteAllMessageReactionsForEmoji(
            request.channelId,
            request.messageId,
            routeToken,
            options,
          )
        } else {
          await this.#client.deleteUserReaction(
            request.channelId,
            request.messageId,
            routeToken,
            request.userId as string,
            options,
          )
        }
      }
      mutationCompleted = true
      const observedMessage = exactMessage(
        await this.#client.getMessage(request.channelId, request.messageId, options),
        request.channelId,
        state.guildId,
        request.messageId,
      )
      const observedReactions = parseReactionAggregates(observedMessage.reactions)
      if (request.scope === "all") {
        targetAbsent = observedReactions.length === 0
      } else if (request.scope === "emoji") {
        targetAbsent = request.emoji !== null
          && matchingReaction(observedReactions, request.emoji) === null
      } else {
        const observed = await this.#targetUser(
          {
            channel: state.channel,
            guildId: state.guildId,
            message: observedMessage,
            reactions: observedReactions,
          },
          request.emoji as NormalizedReactionEmoji,
          request.userId as string,
          options,
        )
        targetAbsent = !observed.present
      }
      const expected = expectedAfterRemoval(state.reactions, request)
      exactSnapshotMatched = stableString(observedReactions) === stableString(expected)
      if (!targetAbsent) {
        throw evidenceError("Discord reaction-moderation target remains present after deletion")
      }
    } catch (error) {
      const settledClientFailure = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429
      const status = settledClientFailure ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: state.guildId,
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
          guildId: state.guildId,
          planKey: this.#planKey,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ReactionModerationExecutionError(
        "Discord reaction moderation did not complete with a verified target state",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          exactSnapshotMatched,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          targetAbsent,
        },
        { cause: error },
      )
    }

    const verification = exactSnapshotMatched ? "match" : "drift"
    const status = exactSnapshotMatched ? "completed" : "completed-with-drift"
    const result: ReactionModerationResult = {
      ...baseResult,
      activityId,
      exactSnapshotMatched,
      status,
      targetAbsent: true,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: state.guildId,
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
          guildId: state.guildId,
          planKey: this.#planKey,
          plan,
          request,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ReactionModerationExecutionError(
        "Discord reaction moderation completed but the operation receipt failed",
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
        guildId: state.guildId,
        planKey: this.#planKey,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ReactionModerationExecutionError(
        "Discord reaction moderation completed but the final activity record failed",
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
