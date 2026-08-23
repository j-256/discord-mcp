import { createHash, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MessageForwardActivity,
  MessageForwardActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_MESSAGE_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  MessageForwardEvidenceError,
  MessageForwardExecutionError,
  MessageForwardOperationConflictError,
  MessageForwardPlanChangedError,
  PolicyError,
} from "./errors.js"
import {
  deletionPreview,
  discordChannelUrl,
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
  parseDiscordPermissionBits,
  type BotChannelPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordAttachment,
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordMessageSnapshot,
  DiscordRole,
  DiscordUser,
  RequestOptions,
} from "./types.js"

export type MessageForwardContentIntentStatus = "disabled" | "enabled" | "unknown"

const STATE_UNAVAILABLE = "message-forward-state-unavailable"
const SOURCE_REQUIRED_PERMISSIONS = [
  "READ_MESSAGE_HISTORY",
  "VIEW_CHANNEL",
] as const
const TARGET_REQUIRED_PERMISSIONS = [
  "READ_MESSAGE_HISTORY",
  "SEND_MESSAGES",
  "VIEW_CHANNEL",
] as const
const FORWARDABLE_MESSAGE_TYPES = new Set<number>([
  DISCORD_MESSAGE_TYPES.default,
  DISCORD_MESSAGE_TYPES.reply,
  DISCORD_MESSAGE_TYPES.chatInputCommand,
  DISCORD_MESSAGE_TYPES.contextMenuCommand,
])
const FORWARD_RESULT_FLAGS = DISCORD_MESSAGE_FLAGS.hasSnapshot
  | DISCORD_MESSAGE_FLAGS.suppressNotifications
const INDETERMINATE_CLIENT_ERROR_STATUSES = new Set([408, 429])
const FORWARD_SNAPSHOT_LIMITS = Object.freeze({
  attachments: 10,
  collectionItems: 1_000,
  depth: 32,
  filenameCharacters: 1_024,
  nodes: 20_000,
  serializedBytes: 1_048_576,
})
const FORWARD_SNAPSHOT_MESSAGE_KEYS = new Set([
  "attachments",
  "components",
  "content",
  "edited_timestamp",
  "embeds",
  "flags",
  "mention_roles",
  "mentions",
  "sticker_items",
  "stickers",
  "timestamp",
  "type",
])
type MessageForwardTargetOutcome = "settled" | "uncertain"
const MESSAGE_FORWARD_TARGET_LOCKS = new Map<
  string,
  Promise<MessageForwardTargetOutcome>
>()

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue
}

export interface MessageForwardRequest {
  operationKey: string
  sourceChannelId: string
  sourceMessageId: string
  targetChannelId: string
}

export interface NormalizedMessageForwardRequest extends MessageForwardRequest {
  nonce: string
  operationKeyHash: string
}

export interface MessageForwardPermissionPlan {
  administrator: boolean
  canReadMessages: true
  confidence: "complete"
  effectivePermissions: string
  permissionSourceChannelId: string
  readMessageHistory: true
  sendMessages: boolean
  unknownPermissionBits: string
  viewChannel: true
  warnings: string[]
}

export interface MessageForwardChannelPlan {
  guildId: string
  id: string
  name: string
  nsfw: boolean
  parentId: string | null
  permissionOverwriteCount: number
  type: number
  typeName: "guild-announcement" | "guild-text"
  url: string
}

export interface MessageForwardPlan {
  action: "forward"
  applicationId: string
  botId: string
  createdAt: string
  crossGuild: boolean
  delivery: {
    allowedMentions: "none"
    enforceNonce: true
    nonce: string
    notifications: "suppressed"
    snapshotCount: 1
  }
  digest: string
  messageContentIntent: "enabled"
  operationKeyHash: string
  schemaVersion: number
  source: {
    channel: MessageForwardChannelPlan
    guild: {
      id: string
      name: string
    }
    message: ReturnType<typeof deletionPreview> & {
      attachmentCount: number
      componentCount: number
      embedCount: number
      flags: number
      jumpUrl: string
      mentionCount: number
      mentionRoleCount: number
      stickerCount: number
      type: number
    }
    permission: MessageForwardPermissionPlan
  }
  status: "planned"
  target: {
    channel: MessageForwardChannelPlan
    guild: {
      id: string
      name: string
    }
    permission: MessageForwardPermissionPlan & {
      sendMessages: true
    }
  }
  warnings: string[]
}

export interface MessageForwardResult {
  activityId: string
  crossGuild: boolean
  nonce: string
  operationKeyHash: string
  planDigest: string
  readbackSnapshotMatched: true
  responseSnapshotMatched: true
  schemaVersion: number
  sourceChannelId: string
  sourceGuildId: string
  sourceMessageId: string
  status: "completed"
  targetChannelId: string
  targetGuildId: string
  targetMessageId: string
  targetUrl: string
}

export interface MessageForwardServiceClient extends Pick<
  DiscordClient,
  | "createMessageForward"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
> {}

export interface MessageForwardServiceOptions {
  activityStore: ActivityStore
  client: MessageForwardServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface GuildEvidence {
  botMember: DiscordGuildMember
  guild: DiscordGuild
  roles: DiscordRole[]
}

interface ForwardSnapshotProjection {
  attachments: JsonValue[]
  components: JsonValue[]
  content: string
  editedTimestamp: string | null
  embeds: JsonValue[]
  flags: number
  mentionRoles: string[]
  mentions: JsonValue[]
  stickerItems: JsonValue[]
  stickers: JsonValue[]
  timestamp: string
  type: number
}

interface ForwardSourceMessage extends DiscordMessage {
  attachments: DiscordAttachment[]
  components: unknown[]
  embeds: unknown[]
  flags: number
  mention_roles: string[]
  mentions: DiscordUser[]
  sticker_items: unknown[]
  stickers: unknown[]
}

interface MessageForwardEndpointState extends GuildEvidence {
  channel: DiscordChannel
  guildId: string
  permissions: BotChannelPermissionResult & { confidence: "complete" }
}

interface MessageForwardState {
  source: MessageForwardEndpointState & {
    author: JsonValue
    message: ForwardSourceMessage
    snapshot: ForwardSnapshotProjection
  }
  target: MessageForwardEndpointState
}

interface BuiltMessageForwardPlan {
  plan: MessageForwardPlan
  state: MessageForwardState
}

function evidenceError(message: string, options?: ErrorOptions): MessageForwardEvidenceError {
  return new MessageForwardEvidenceError(message, options)
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false
    }
  }
  return true
}

function deterministicNonce(request: Omit<NormalizedMessageForwardRequest, "nonce">): string {
  return createHash("sha256")
    .update("discord-mcp-message-forward-nonce.v1\0")
    .update(request.sourceChannelId)
    .update("\0")
    .update(request.sourceMessageId)
    .update("\0")
    .update(request.targetChannelId)
    .update("\0")
    .update(request.operationKeyHash)
    .digest("base64url")
    .slice(0, DISCORD_LIMITS.messageNonceCharacters)
}

export function normalizeMessageForwardRequest(
  request: MessageForwardRequest,
): NormalizedMessageForwardRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord message-forward request must be an object")
  }
  const keys = [
    "operationKey",
    "sourceChannelId",
    "sourceMessageId",
    "targetChannelId",
  ].sort()
  if (Object.keys(request).sort().join("\0") !== keys.join("\0")) {
    throw new RangeError("Discord message-forward request contains unexpected fields")
  }
  assertSnowflake(request.sourceChannelId, "Discord message-forward source channel ID")
  assertSnowflake(request.sourceMessageId, "Discord message-forward source message ID")
  assertSnowflake(request.targetChannelId, "Discord message-forward target channel ID")
  if (request.sourceChannelId === request.targetChannelId) {
    throw new RangeError("Discord message-forward source and target channels must differ")
  }
  const normalizedWithoutNonce = {
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    sourceChannelId: request.sourceChannelId,
    sourceMessageId: request.sourceMessageId,
    targetChannelId: request.targetChannelId,
  }
  return {
    ...normalizedWithoutNonce,
    nonce: deterministicNonce(normalizedWithoutNonce),
  }
}

function exactJsonValue(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): JsonValue {
  state.nodes += 1
  if (state.nodes > FORWARD_SNAPSHOT_LIMITS.nodes || depth > FORWARD_SNAPSHOT_LIMITS.depth) {
    throw evidenceError("Discord returned an excessively complex message-forward snapshot")
  }
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (!validUnicode(value)) {
      throw evidenceError("Discord returned invalid Unicode in message-forward evidence")
    }
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw evidenceError("Discord returned a non-finite number in message-forward evidence")
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > FORWARD_SNAPSHOT_LIMITS.collectionItems) {
      throw evidenceError("Discord returned an oversized message-forward collection")
    }
    return value.map((item) => exactJsonValue(item, state, depth + 1))
  }
  if (!value || typeof value !== "object") {
    throw evidenceError("Discord returned a non-JSON message-forward value")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw evidenceError("Discord returned a non-JSON message-forward object")
  }
  const output = Object.create(null) as Record<string, JsonValue>
  for (const [key, item] of Object.entries(value)) {
    if (!validUnicode(key)) {
      throw evidenceError("Discord returned invalid Unicode in a message-forward field name")
    }
    output[key] = exactJsonValue(item, state, depth + 1)
  }
  return output
}

function exactJsonArray(
  value: unknown,
  description: string,
  state: { nodes: number },
): JsonValue[] {
  if (!Array.isArray(value) || value.length > FORWARD_SNAPSHOT_LIMITS.collectionItems) {
    throw evidenceError(`Discord returned invalid ${description} message-forward evidence`)
  }
  return value.map((item) => exactJsonValue(item, state))
}

function exactAttachmentProjection(
  value: unknown,
  state: { nodes: number },
): JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned invalid message-forward attachment evidence")
  }
  const attachment = value as Record<string, unknown>
  if (
    typeof attachment.id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(attachment.id)
    || typeof attachment.filename !== "string"
    || attachment.filename.length < 1
    || [...attachment.filename].length > FORWARD_SNAPSHOT_LIMITS.filenameCharacters
    || !validUnicode(attachment.filename)
    || !Number.isSafeInteger(attachment.size)
    || (attachment.size as number) < 0
    || typeof attachment.url !== "string"
    || attachment.url.length < 1
    || !(attachment.proxy_url === undefined || (
      typeof attachment.proxy_url === "string" && attachment.proxy_url.length > 0
    ))
  ) {
    throw evidenceError("Discord returned incomplete message-forward attachment evidence")
  }
  const projected = exactJsonValue(attachment, state)
  if (!projected || typeof projected !== "object" || Array.isArray(projected)) {
    throw evidenceError("Discord returned invalid message-forward attachment evidence")
  }
  const stable = Object.create(null) as Record<string, JsonValue>
  for (const [key, item] of Object.entries(projected)) {
    if (key !== "proxy_url" && key !== "url") stable[key] = item
  }
  return stable
}

function exactUserProjection(
  value: unknown,
  state: { nodes: number },
): JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned invalid message-forward mention evidence")
  }
  const user = value as Record<string, unknown>
  if (
    typeof user.id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(user.id)
    || typeof user.username !== "string"
    || user.username.length < 1
    || !validUnicode(user.username)
    || !(user.global_name === undefined || user.global_name === null || (
      typeof user.global_name === "string" && validUnicode(user.global_name)
    ))
    || !(user.bot === undefined || typeof user.bot === "boolean")
    || !(user.avatar === undefined || user.avatar === null || typeof user.avatar === "string")
    || !(user.discriminator === undefined || typeof user.discriminator === "string")
  ) {
    throw evidenceError("Discord returned incomplete message-forward mention evidence")
  }
  return exactJsonValue(user, state)
}

function exactTimestamp(value: unknown, description: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw evidenceError(`Discord returned invalid ${description} timestamp evidence`)
  }
  return value
}

function exactForwardSnapshot(
  input: DiscordMessage | DiscordMessageSnapshot["message"],
  requireClosedShape = false,
  projectionState = { nodes: 0 },
): ForwardSnapshotProjection {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw evidenceError("Discord returned invalid message-forward snapshot evidence")
  }
  if (
    typeof input.content !== "string"
    || !validUnicode(input.content)
    || typeof input.type !== "number"
    || !Number.isSafeInteger(input.type)
    || !FORWARDABLE_MESSAGE_TYPES.has(input.type)
  ) {
    throw evidenceError("Discord returned an ineligible message-forward snapshot")
  }
  if (
    requireClosedShape
    && Object.keys(input).some((key) => !FORWARD_SNAPSHOT_MESSAGE_KEYS.has(key))
  ) {
    throw evidenceError("Discord returned unexpected immutable message-forward snapshot fields")
  }
  const timestamp = exactTimestamp(input.timestamp, "message-forward")
  const editedTimestamp = input.edited_timestamp === null
    || input.edited_timestamp === undefined
    ? null
    : exactTimestamp(input.edited_timestamp, "message-forward edit")
  const flags = input.flags ?? 0
  if (!Number.isSafeInteger(flags) || flags < 0) {
    throw evidenceError("Discord returned invalid message-forward flag evidence")
  }
  const rawAttachments = input.attachments ?? []
  if (!Array.isArray(rawAttachments) || rawAttachments.length > FORWARD_SNAPSHOT_LIMITS.attachments) {
    throw evidenceError("Discord returned an invalid bounded message-forward attachment collection")
  }
  const rawMentionRoles = input.mention_roles ?? []
  if (
    !Array.isArray(rawMentionRoles)
    || rawMentionRoles.length > FORWARD_SNAPSHOT_LIMITS.collectionItems
    || rawMentionRoles.some((roleId) => (
      typeof roleId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)
    ))
    || new Set(rawMentionRoles).size !== rawMentionRoles.length
  ) {
    throw evidenceError("Discord returned invalid message-forward role-mention evidence")
  }
  const rawMentions = input.mentions ?? []
  if (!Array.isArray(rawMentions) || rawMentions.length > FORWARD_SNAPSHOT_LIMITS.collectionItems) {
    throw evidenceError("Discord returned invalid message-forward user-mention evidence")
  }
  const projection: ForwardSnapshotProjection = {
    attachments: rawAttachments.map((attachment) => (
      exactAttachmentProjection(attachment, projectionState)
    )),
    components: exactJsonArray(input.components ?? [], "component", projectionState),
    content: input.content,
    editedTimestamp,
    embeds: exactJsonArray(input.embeds ?? [], "embed", projectionState),
    flags,
    mentionRoles: [...rawMentionRoles],
    mentions: rawMentions.map((mention) => (
      exactUserProjection(mention, projectionState)
    )),
    stickerItems: exactJsonArray(
      input.sticker_items ?? [],
      "sticker-item",
      projectionState,
    ),
    stickers: exactJsonArray(input.stickers ?? [], "sticker", projectionState),
    timestamp,
    type: input.type,
  }
  if (Buffer.byteLength(stableString(projection), "utf8") > FORWARD_SNAPSHOT_LIMITS.serializedBytes) {
    throw evidenceError("Discord returned an oversized message-forward snapshot")
  }
  return projection
}

function exactOverwrites(channel: DiscordChannel): void {
  const overwrites = channel.permission_overwrites
  if (!Array.isArray(overwrites) || overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord message-forward channel omitted complete permission-overwrite evidence")
  }
  const seen = new Set<string>()
  for (const overwrite of overwrites) {
    const key = `${overwrite.type}:${overwrite.id}`
    if (
      !overwrite
      || typeof overwrite !== "object"
      || !DISCORD_SNOWFLAKE_PATTERN.test(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || typeof overwrite.deny !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(overwrite.allow)
      || !/^(0|[1-9][0-9]*)$/.test(overwrite.deny)
      || seen.has(key)
    ) {
      throw evidenceError("Discord returned malformed or duplicate message-forward overwrite evidence")
    }
    seen.add(key)
  }
}

function exactChannel(channel: DiscordChannel, channelId: string): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || Array.isArray(channel)
    || channel.id !== channelId
    || (
      channel.type !== DISCORD_CHANNEL_TYPES.text
      && channel.type !== DISCORD_CHANNEL_TYPES.announcement
    )
    || typeof channel.guild_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(channel.guild_id)
    || typeof channel.name !== "string"
    || channel.name.length < 1
    || [...channel.name].length > DISCORD_LIMITS.channelNameCharacters
    || !validUnicode(channel.name)
    || /[\u0000-\u001F\u007F]/.test(channel.name)
    || !(channel.nsfw === undefined || typeof channel.nsfw === "boolean")
    || !(channel.parent_id === undefined || channel.parent_id === null || (
      typeof channel.parent_id === "string" && DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
    ))
  ) {
    throw evidenceError("Discord returned invalid direct message-forward channel evidence")
  }
  exactOverwrites(channel)
  return channel
}

function channelPlan(channel: DiscordChannel): MessageForwardChannelPlan {
  const guildId = channel.guild_id as string
  const typeName = channel.type === DISCORD_CHANNEL_TYPES.announcement
    ? "guild-announcement"
    : "guild-text"
  return {
    guildId,
    id: channel.id,
    name: channel.name as string,
    nsfw: channel.nsfw === true,
    parentId: channel.parent_id ?? null,
    permissionOverwriteCount: channel.permission_overwrites?.length ?? 0,
    type: channel.type,
    typeName,
    url: discordChannelUrl(guildId, channel.id),
  }
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || [...guild.name].length > DISCORD_LIMITS.channelNameCharacters
    || !validUnicode(guild.name)
    || /[\u0000-\u001F\u007F]/.test(guild.name)
  ) {
    throw evidenceError("Discord returned incomplete or mismatched message-forward guild evidence")
  }
  return guild
}

function exactBotMember(
  member: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(member.roles).size !== member.roles.length
    || member.roles.some((roleId) => (
      typeof roleId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)
    ))
    || !member.user
    || member.user.id !== botId
    || member.user.bot !== true
  ) {
    throw evidenceError("Discord returned mismatched message-forward connector bot member evidence")
  }
  return member
}

function exactRoles(roles: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded message-forward role inventory")
  }
  const seen = new Set<string>()
  for (const role of roles) {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !DISCORD_SNOWFLAKE_PATTERN.test(role.id)
      || seen.has(role.id)
      || typeof role.name !== "string"
      || role.name.length < 1
      || role.name.length > DISCORD_LIMITS.roleNameCharacters
      || !validUnicode(role.name)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
    ) {
      throw evidenceError("Discord returned malformed or duplicate message-forward role evidence")
    }
    try {
      parseDiscordPermissionBits(role.permissions, `message-forward role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid message-forward role permissions", {
        cause: error,
      })
    }
    seen.add(role.id)
  }
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord message-forward role inventory omitted valid @everyone evidence")
  }
  return [...roles].sort((left, right) => left.id.localeCompare(right.id))
}

function exactSourceReference(message: DiscordMessage) {
  const reference = message.message_reference
  if (reference === undefined) return null
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw evidenceError("Discord returned malformed message-forward source reference evidence")
  }
  const type = reference.type ?? DISCORD_MESSAGE_REFERENCE_TYPES.default
  if (type !== DISCORD_MESSAGE_REFERENCE_TYPES.default) {
    throw evidenceError("Discord cannot forward a message that is already a forward")
  }
  for (const value of [reference.channel_id, reference.guild_id, reference.message_id]) {
    if (value !== undefined && !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
      throw evidenceError("Discord returned malformed message-forward source reference identity")
    }
  }
  return {
    channelId: reference.channel_id ?? null,
    guildId: reference.guild_id ?? null,
    messageId: reference.message_id ?? null,
    type,
  }
}

function exactSourceMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
): {
  author: JsonValue
  message: ForwardSourceMessage
  snapshot: ForwardSnapshotProjection
} {
  if (
    !message
    || typeof message !== "object"
    || Array.isArray(message)
    || message.id !== messageId
    || message.channel_id !== channelId
    || message.guild_id !== guildId
    || !message.author
    || !DISCORD_SNOWFLAKE_PATTERN.test(message.author.id)
    || typeof message.author.username !== "string"
    || message.author.username.length < 1
    || [...message.author.username].length > DISCORD_LIMITS.channelNameCharacters
    || !validUnicode(message.author.username)
    || /[\u0000-\u001F\u007F]/.test(message.author.username)
    || !(message.author.global_name === undefined || message.author.global_name === null || (
      typeof message.author.global_name === "string"
      && [...message.author.global_name].length <= DISCORD_LIMITS.channelNameCharacters
      && validUnicode(message.author.global_name)
      && !/[\u0000-\u001F\u007F]/.test(message.author.global_name)
    ))
    || message.poll !== undefined
    || message.activity !== undefined
    || message.call !== undefined
    || (message.message_snapshots !== undefined && (
      !Array.isArray(message.message_snapshots) || message.message_snapshots.length > 0
    ))
    || ((message.flags ?? 0) & DISCORD_MESSAGE_FLAGS.hasSnapshot) !== 0
  ) {
    throw evidenceError("Discord returned an ineligible or incomplete message-forward source message")
  }
  const reference = exactSourceReference(message)
  if (message.type === DISCORD_MESSAGE_TYPES.reply && reference === null) {
    throw evidenceError("Discord returned a reply source without exact reference evidence")
  }
  const projectionState = { nodes: 0 }
  const author = exactUserProjection(message.author, projectionState)
  const snapshot = exactForwardSnapshot(message, false, projectionState)
  if (
    Buffer.byteLength(stableString({ author, snapshot }), "utf8")
    > FORWARD_SNAPSHOT_LIMITS.serializedBytes
  ) {
    throw evidenceError("Discord returned oversized message-forward source evidence")
  }
  const exact: ForwardSourceMessage = {
    ...message,
    attachments: message.attachments ?? [],
    components: message.components ?? [],
    embeds: message.embeds ?? [],
    flags: message.flags ?? 0,
    mention_roles: message.mention_roles ?? [],
    mentions: message.mentions ?? [],
    sticker_items: message.sticker_items ?? [],
    stickers: message.stickers ?? [],
  }
  return { author, message: exact, snapshot }
}

function hasPermission(
  result: BotChannelPermissionResult,
  permission: "READ_MESSAGE_HISTORY" | "SEND_MESSAGES" | "VIEW_CHANNEL",
): boolean {
  return result.effectivePermissionNames.includes(permission)
}

function evaluatePermissions(options: {
  botId: string
  channel: DiscordChannel
  guildId: string
  member: DiscordGuildMember
  required: readonly ("READ_MESSAGE_HISTORY" | "SEND_MESSAGES" | "VIEW_CHANNEL")[]
  roles: readonly DiscordRole[]
  side: "source" | "target"
}): BotChannelPermissionResult & { confidence: "complete" } {
  let permissions: BotChannelPermissionResult
  try {
    permissions = evaluateBotChannelPermissions({
      botId: options.botId,
      channel: options.channel,
      guildId: options.guildId,
      member: options.member,
      permissionChannel: options.channel,
      roles: options.roles,
    })
  } catch (error) {
    throw evidenceError(
      `Discord connector bot ${options.side} message-forward permission evidence is invalid: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  if (permissions.confidence !== "complete") {
    throw evidenceError(
      `Discord connector bot ${options.side} message-forward permission evidence is incomplete: ${permissions.warnings.join("; ")}`,
    )
  }
  if (permissions.canReadMessages !== true) {
    throw evidenceError(
      `Discord connector bot lacks ${options.side} channel message-read prerequisites`,
    )
  }
  for (const permission of options.required) {
    if (!hasPermission(permissions, permission)) {
      throw evidenceError(
        `Discord connector bot lacks ${options.side} channel ${permission}`,
      )
    }
  }
  return permissions as BotChannelPermissionResult & { confidence: "complete" }
}

function permissionPlan(
  permissions: BotChannelPermissionResult & { confidence: "complete" },
): MessageForwardPermissionPlan {
  return {
    administrator: permissions.administrator,
    canReadMessages: true,
    confidence: "complete",
    effectivePermissions: permissions.effectivePermissions,
    permissionSourceChannelId: permissions.permissionSourceChannelId,
    readMessageHistory: true,
    sendMessages: hasPermission(permissions, "SEND_MESSAGES"),
    unknownPermissionBits: permissions.unknownPermissionBits,
    viewChannel: true,
    warnings: [...permissions.warnings],
  }
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

function overwriteSnapshot(channel: DiscordChannel) {
  return (channel.permission_overwrites ?? [])
    .map((overwrite) => ({
      allow: overwrite.allow,
      deny: overwrite.deny,
      id: overwrite.id,
      type: overwrite.type,
    }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.type - right.type)
}

function endpointDigestState(state: MessageForwardEndpointState) {
  return {
    botMember: {
      roles: [...state.botMember.roles].sort(),
      userId: state.botMember.user?.id ?? null,
    },
    channel: {
      guildId: state.guildId,
      id: state.channel.id,
      name: state.channel.name,
      nsfw: state.channel.nsfw === true,
      overwrites: overwriteSnapshot(state.channel),
      parentId: state.channel.parent_id ?? null,
      type: state.channel.type,
    },
    guild: {
      id: state.guild.id,
      name: state.guild.name,
    },
    permissions: state.permissions.effectivePermissions,
    roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
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
    targetMessageId: receipt.resourceId,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: MessageForwardPlan
  request: NormalizedMessageForwardRequest
  status: MessageForwardActivityStatus
  targetMessageId?: string | null
  timestamp: string
  verification?: "match" | null
}): MessageForwardActivity {
  return {
    error: options.error ?? null,
    id: options.activityId,
    kind: "message-forward",
    nonce: options.request.nonce,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    sourceChannelId: options.request.sourceChannelId,
    sourceGuildId: options.plan.source.guild.id,
    sourceMessageId: options.request.sourceMessageId,
    status: options.status,
    targetChannelId: options.request.targetChannelId,
    targetGuildId: options.plan.target.guild.id,
    targetMessageId: options.targetMessageId ?? null,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: MessageForwardPlan
  request: NormalizedMessageForwardRequest
  status: OperationReceipt["status"]
  targetMessageId?: string | null
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.target.guild.id,
    kind: "message-forward",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" || options.status === "uncertain"
      ? options.targetMessageId ?? null
      : null,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function exactEmptyArray(
  value: unknown,
  description: string,
  required = false,
): void {
  if (
    (required && !Array.isArray(value))
    || (value !== undefined && (!Array.isArray(value) || value.length !== 0))
  ) {
    throw evidenceError(`Discord message-forward result contains unexpected ${description}`)
  }
}

function exactForwardResult(
  observed: DiscordMessage,
  options: {
    botId: string
    nonce: string
    sourceChannelId: string
    sourceGuildId: string
    sourceMessageId: string
    sourceSnapshot: ForwardSnapshotProjection
    targetChannelId: string
    targetGuildId: string
    targetMessageId?: string
  },
): DiscordMessage {
  if (
    !observed
    || typeof observed !== "object"
    || Array.isArray(observed)
    || !DISCORD_SNOWFLAKE_PATTERN.test(observed.id)
    || (options.targetMessageId !== undefined && observed.id !== options.targetMessageId)
    || observed.id === options.sourceMessageId
    || observed.channel_id !== options.targetChannelId
    || observed.guild_id !== options.targetGuildId
    || observed.type !== DISCORD_MESSAGE_TYPES.default
    || observed.content !== ""
    || !observed.author
    || observed.author.id !== options.botId
    || observed.author.bot !== true
    || observed.webhook_id !== undefined
    || observed.flags !== FORWARD_RESULT_FLAGS
    || observed.edited_timestamp !== null
    || observed.pinned !== false
    || observed.tts !== false
    || observed.mention_everyone !== false
    || observed.poll !== undefined
    || observed.activity !== undefined
    || observed.call !== undefined
    || !(observed.referenced_message === undefined || observed.referenced_message === null)
    || !(observed.nonce === undefined || observed.nonce === options.nonce)
  ) {
    throw evidenceError("Discord returned an invalid message-forward target message")
  }
  exactTimestamp(observed.timestamp, "message-forward result")
  exactEmptyArray(observed.attachments, "outer attachments", true)
  exactEmptyArray(observed.components, "outer components")
  exactEmptyArray(observed.embeds, "outer embeds", true)
  exactEmptyArray(observed.mentions, "outer mentions", true)
  exactEmptyArray(observed.mention_roles, "outer role mentions", true)
  exactEmptyArray(observed.sticker_items, "outer sticker items")
  exactEmptyArray(observed.stickers, "outer stickers")
  const reference = observed.message_reference
  if (
    !reference
    || typeof reference !== "object"
    || Array.isArray(reference)
    || reference.type !== DISCORD_MESSAGE_REFERENCE_TYPES.forward
    || reference.channel_id !== options.sourceChannelId
    || reference.guild_id !== options.sourceGuildId
    || reference.message_id !== options.sourceMessageId
  ) {
    throw evidenceError("Discord returned a mismatched message-forward reference")
  }
  if (!Array.isArray(observed.message_snapshots) || observed.message_snapshots.length !== 1) {
    throw evidenceError("Discord message-forward result lacks exactly one immutable snapshot")
  }
  const snapshot = observed.message_snapshots[0]
  if (
    !snapshot
    || typeof snapshot !== "object"
    || Array.isArray(snapshot)
    || Object.keys(snapshot).sort().join("\0") !== "message"
  ) {
    throw evidenceError("Discord returned malformed immutable message-forward snapshot evidence")
  }
  const projected = exactForwardSnapshot(snapshot.message, true)
  if (stableString(projected) !== stableString(options.sourceSnapshot)) {
    throw evidenceError("Discord immutable message-forward snapshot does not match the reviewed source")
  }
  return observed
}

function definitePreResponseRefusal(error: unknown): boolean {
  return error instanceof DiscordApiError
    && error.status >= 400
    && error.status < 500
    && !INDETERMINATE_CLIENT_ERROR_STATUSES.has(error.status)
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof MessageForwardExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => MessageForwardExecutionError,
): Promise<T> {
  const prior = MESSAGE_FORWARD_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: MessageForwardTargetOutcome) => void = () => undefined
  const tail = new Promise<MessageForwardTargetOutcome>((resolve) => {
    release = resolve
  })
  MESSAGE_FORWARD_TARGET_LOCKS.set(key, tail)
  let outcome: MessageForwardTargetOutcome = "settled"
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
    if (MESSAGE_FORWARD_TARGET_LOCKS.get(key) === tail) {
      MESSAGE_FORWARD_TARGET_LOCKS.delete(key)
    }
  }
}

export class MessageForwardingService {
  readonly #activityStore: ActivityStore
  readonly #client: MessageForwardServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: MessageForwardServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #guildEvidence(
    botId: string,
    guildId: string,
    options: RequestOptions,
  ): Promise<GuildEvidence> {
    const [rawGuild, rawMember, rawRoles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    const roleIds = new Set(roles.map((role) => role.id))
    if (botMember.roles.some((roleId) => !roleIds.has(roleId))) {
      throw evidenceError("Discord message-forward bot member references a missing role")
    }
    return { botMember, guild, roles }
  }

  async #state(
    botId: string,
    request: NormalizedMessageForwardRequest,
    options: RequestOptions,
  ): Promise<MessageForwardState> {
    this.#policy.assertMessageForwardSourceConfigured(request.sourceChannelId)
    this.#policy.assertMessageForwardTargetConfigured(request.targetChannelId)
    const existingReceipt = await this.#operationStore.get(
      "message-forward",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new MessageForwardOperationConflictError(receiptView(existingReceipt))
    }
    const [rawSourceChannel, rawTargetChannel] = await Promise.all([
      this.#client.getChannel(request.sourceChannelId, options),
      this.#client.getChannel(request.targetChannelId, options),
    ])
    const sourceChannel = exactChannel(rawSourceChannel, request.sourceChannelId)
    const targetChannel = exactChannel(rawTargetChannel, request.targetChannelId)
    const sourceGuildId = this.#policy.assertMessageForwardSource(sourceChannel)
    const targetGuildId = this.#policy.assertMessageForwardTarget(targetChannel)
    this.#policy.assertMessageForwardGuildBoundary(sourceGuildId, targetGuildId)
    if (sourceChannel.nsfw === true && targetChannel.nsfw !== true) {
      throw evidenceError(
        "Discord message forwarding cannot move age-restricted source content into a non-age-restricted target",
      )
    }

    const sourceMessagePromise = this.#client.getMessage(
      request.sourceChannelId,
      request.sourceMessageId,
      options,
    )
    let rawSourceMessage: DiscordMessage
    let sourceGuildEvidence: GuildEvidence
    let targetGuildEvidence: GuildEvidence
    if (sourceGuildId === targetGuildId) {
      let shared: GuildEvidence
      [rawSourceMessage, shared] = await Promise.all([
        sourceMessagePromise,
        this.#guildEvidence(botId, sourceGuildId, options),
      ])
      sourceGuildEvidence = shared
      targetGuildEvidence = shared
    } else {
      [rawSourceMessage, sourceGuildEvidence, targetGuildEvidence] = await Promise.all([
        sourceMessagePromise,
        this.#guildEvidence(botId, sourceGuildId, options),
        this.#guildEvidence(botId, targetGuildId, options),
      ])
    }
    const exactSource = exactSourceMessage(
      rawSourceMessage,
      request.sourceChannelId,
      sourceGuildId,
      request.sourceMessageId,
    )
    const sourcePermissions = evaluatePermissions({
      botId,
      channel: sourceChannel,
      guildId: sourceGuildId,
      member: sourceGuildEvidence.botMember,
      required: SOURCE_REQUIRED_PERMISSIONS,
      roles: sourceGuildEvidence.roles,
      side: "source",
    })
    const targetPermissions = evaluatePermissions({
      botId,
      channel: targetChannel,
      guildId: targetGuildId,
      member: targetGuildEvidence.botMember,
      required: TARGET_REQUIRED_PERMISSIONS,
      roles: targetGuildEvidence.roles,
      side: "target",
    })
    return {
      source: {
        ...sourceGuildEvidence,
        author: exactSource.author,
        channel: sourceChannel,
        guildId: sourceGuildId,
        message: exactSource.message,
        permissions: sourcePermissions,
        snapshot: exactSource.snapshot,
      },
      target: {
        ...targetGuildEvidence,
        channel: targetChannel,
        guildId: targetGuildId,
        permissions: targetPermissions,
      },
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageForwardContentIntentStatus,
    request: NormalizedMessageForwardRequest,
    options: RequestOptions,
  ): Promise<BuiltMessageForwardPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    if (messageContentIntent !== "enabled") {
      throw evidenceError("Discord message forwarding requires confirmed Message Content intent")
    }
    const state = await this.#state(botId, request, options)
    const crossGuild = state.source.guildId !== state.target.guildId
    const sourceReference = exactSourceReference(state.source.message)
    const digest = reviewedPlanDigest(this.#planKey, {
      action: "forward",
      applicationId,
      botId,
      crossGuild,
      delivery: {
        allowedMentions: "none",
        enforceNonce: true,
        flags: FORWARD_RESULT_FLAGS,
        nonce: request.nonce,
        snapshotCount: 1,
      },
      messageContentIntent,
      request,
      source: {
        ...endpointDigestState(state.source),
        message: {
          author: state.source.author,
          id: state.source.message.id,
          reference: sourceReference,
          snapshot: state.source.snapshot,
        },
      },
      target: endpointDigestState(state.target),
    })
    const sourcePermission = permissionPlan(state.source.permissions)
    const targetPermission = permissionPlan(state.target.permissions)
    if (!targetPermission.sendMessages) {
      throw evidenceError("Discord connector bot lacks target channel SEND_MESSAGES")
    }
    const plan: MessageForwardPlan = {
      action: "forward",
      applicationId,
      botId,
      createdAt: this.#clock().toISOString(),
      crossGuild,
      delivery: {
        allowedMentions: "none",
        enforceNonce: true,
        nonce: request.nonce,
        notifications: "suppressed",
        snapshotCount: 1,
      },
      digest,
      messageContentIntent: "enabled",
      operationKeyHash: request.operationKeyHash,
      schemaVersion: SCHEMA_VERSION,
      source: {
        channel: channelPlan(state.source.channel),
        guild: {
          id: state.source.guildId,
          name: state.source.guild.name,
        },
        message: {
          ...deletionPreview(state.source.message),
          attachmentCount: state.source.snapshot.attachments.length,
          componentCount: state.source.snapshot.components.length,
          embedCount: state.source.snapshot.embeds.length,
          flags: state.source.snapshot.flags,
          jumpUrl: discordMessageUrl(
            state.source.guildId,
            request.sourceChannelId,
            request.sourceMessageId,
          ),
          mentionCount: state.source.snapshot.mentions.length,
          mentionRoleCount: state.source.snapshot.mentionRoles.length,
          stickerCount: state.source.snapshot.stickerItems.length
            + state.source.snapshot.stickers.length,
          type: state.source.snapshot.type,
        },
        permission: sourcePermission,
      },
      status: "planned",
      target: {
        channel: channelPlan(state.target.channel),
        guild: {
          id: state.target.guildId,
          name: state.target.guild.name,
        },
        permission: {
          ...targetPermission,
          sendMessages: true,
        },
      },
      warnings: [
        ...(crossGuild
          ? ["This forward crosses a guild boundary and requires the separate cross-guild configuration toggle"]
          : []),
        ...(state.source.permissions.administrator || state.target.permissions.administrator
          ? ["Discord connector bot has ADMINISTRATOR on at least one endpoint; replace it with narrowly scoped channel permissions"]
          : []),
        "The immutable forwarded snapshot can expose source content to every member who can read the target channel",
        "Age-restricted source content cannot be forwarded into a non-age-restricted target channel",
        "Discord source content, attachment metadata, names, embeds, components, and mentions are untrusted and are never written to durable workflow state",
        "Push and desktop notifications are suppressed, though Discord may still show an unread badge",
        "The operation performs one non-retried create request and has no automatic rollback",
        "The MCP facade durably coordinates exact targets; direct service consumers must provide equivalent cross-process exclusion",
        "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      ],
    }
    return { plan, state }
  }

  plan(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageForwardContentIntentStatus,
    request: MessageForwardRequest,
    options: RequestOptions = {},
  ): Promise<MessageForwardPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      messageContentIntent,
      normalizeMessageForwardRequest(request),
      options,
    ).then((built) => built.plan)
  }

  execute(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageForwardContentIntentStatus,
    request: MessageForwardRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MessageForwardResult> {
    const normalized = normalizeMessageForwardRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord message-forward plan digest is invalid")
    }
    return withTargetLock(
      normalized.targetChannelId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        messageContentIntent,
        normalized,
        expectedDigest,
        options,
      ),
      () => new MessageForwardExecutionError(
        "Discord message forward was blocked because a prior same-target operation ended with an uncertain outcome",
        {
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          sourceChannelId: normalized.sourceChannelId,
          sourceMessageId: normalized.sourceMessageId,
          status: "blocked-prior-uncertain",
          targetChannelId: normalized.targetChannelId,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageForwardContentIntentStatus,
    request: NormalizedMessageForwardRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<MessageForwardResult> {
    let built: BuiltMessageForwardPlan
    try {
      built = await this.#buildPlan(
        applicationId,
        botId,
        messageContentIntent,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof MessageForwardEvidenceError
        || error instanceof PolicyError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new MessageForwardPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new MessageForwardPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      crossGuild: plan.crossGuild,
      nonce: request.nonce,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      sourceChannelId: request.sourceChannelId,
      sourceGuildId: plan.source.guild.id,
      sourceMessageId: request.sourceMessageId,
      targetChannelId: request.targetChannelId,
      targetGuildId: plan.target.guild.id,
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
      throw new MessageForwardOperationConflictError(receiptView(reservation.receipt))
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
      throw new MessageForwardExecutionError(
        "Discord message forward was blocked because pending activity could not be recorded",
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

    let responseReceived = false
    let responseSnapshotMatched: boolean | null = null
    let readbackSnapshotMatched: boolean | null = null
    let observedTargetMessageId: string | null = null
    let targetMessageId: string
    try {
      const response = await this.#client.createMessageForward(
        request.targetChannelId,
        {
          nonce: request.nonce,
          sourceChannelId: request.sourceChannelId,
          sourceGuildId: plan.source.guild.id,
          sourceMessageId: request.sourceMessageId,
        },
        options,
      )
      responseReceived = true
      if (response && DISCORD_SNOWFLAKE_PATTERN.test(response.id)) {
        observedTargetMessageId = response.id
      }
      const exactResponse = exactForwardResult(response, {
        botId,
        nonce: request.nonce,
        sourceChannelId: request.sourceChannelId,
        sourceGuildId: plan.source.guild.id,
        sourceMessageId: request.sourceMessageId,
        sourceSnapshot: state.source.snapshot,
        targetChannelId: request.targetChannelId,
        targetGuildId: plan.target.guild.id,
      })
      observedTargetMessageId = exactResponse.id
      responseSnapshotMatched = true
      exactForwardResult(
        await this.#client.getMessage(
          request.targetChannelId,
          observedTargetMessageId,
          options,
        ),
        {
          botId,
          nonce: request.nonce,
          sourceChannelId: request.sourceChannelId,
          sourceGuildId: plan.source.guild.id,
          sourceMessageId: request.sourceMessageId,
          sourceSnapshot: state.source.snapshot,
          targetChannelId: request.targetChannelId,
          targetGuildId: plan.target.guild.id,
          targetMessageId: observedTargetMessageId,
        },
      )
      readbackSnapshotMatched = true
      targetMessageId = observedTargetMessageId
    } catch (error) {
      const status = !responseReceived
        && definitePreResponseRefusal(error)
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
          status,
          targetMessageId: observedTargetMessageId,
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
          targetMessageId: observedTargetMessageId,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new MessageForwardExecutionError(
        "Discord message forward did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          readbackSnapshotMatched,
          responseSnapshotMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          targetMessageId: observedTargetMessageId,
        },
        { cause: error },
      )
    }

    const result: MessageForwardResult = {
      ...baseResult,
      activityId,
      readbackSnapshotMatched: true,
      responseSnapshotMatched: true,
      status: "completed",
      targetMessageId,
      targetUrl: discordMessageUrl(
        plan.target.guild.id,
        request.targetChannelId,
        targetMessageId,
      ),
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        targetMessageId,
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          plan,
          request,
          status: "completed",
          targetMessageId,
          timestamp: this.#clock().toISOString(),
          verification: "match",
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new MessageForwardExecutionError(
        "Discord message forward completed but the operation receipt failed",
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
        status: "completed",
        targetMessageId,
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new MessageForwardExecutionError(
        "Discord message forward completed but the final activity record failed",
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
