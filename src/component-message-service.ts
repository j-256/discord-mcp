import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"

import type {
  ActivityStore,
  ComponentMessageActivity,
  ComponentMessageActivityStatus,
} from "./activity-log.js"
import {
  compileComponentLayout,
  componentLayoutHasRequestButtons,
  componentLayoutText,
  componentLayoutsEqual,
  parseDiscordManagedComponentLayout,
  reviewComponentLayout,
  type ComponentLayoutCounts,
  type ComponentLayoutInput,
  type ComponentLayoutRequestButtonBinding,
  type ComponentLayoutRequestButtonVerification,
  type ComponentLayoutReview,
  type NormalizedComponentLayout,
  type ParsedManagedComponentLayout,
} from "./component-layout.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_MESSAGE_TYPES,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  CreateComponentMessageInput,
  DiscordClient,
  EditComponentMessageInput,
} from "./discord-client.js"
import {
  ComponentMessageEvidenceError,
  ComponentMessageExecutionError,
  ComponentMessageOperationConflictError,
  ComponentMessagePlanChangedError,
  DiscordApiError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  discordAllowedMentions,
  discordMentionedUserIds,
  discordReviewedNotificationAuthorization,
  type DiscordNotificationAuthorization,
} from "./message-safety.js"
import { discordMessageUrl } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import type { NativeInteractionRequestButtonReadiness } from "./native-interaction-broker.js"
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
import { requestButtonRouteHash } from "./request-button.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

export const COMPONENT_MESSAGE_ACTIONS = [
  "create",
  "edit",
] as const

export type ComponentMessageAction = typeof COMPONENT_MESSAGE_ACTIONS[number]
export type ComponentMessageContentIntentStatus = "disabled" | "enabled" | "unknown"

const STATE_UNAVAILABLE = "component-message-state-unavailable"
const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const COMPONENT_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.text,
])
const THREAD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
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
const REPLY_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19])
const PRIVACY_OMITTED_FIELDS = [
  "attachmentUrls",
  "componentLayouts",
  "componentText",
  "embeds",
  "generatedComponentIds",
  "mentionProfiles",
  "nonce",
  "notificationUserIds",
  "parsedUserMentionIds",
  "rawOperationKey",
  "rawPayloads",
  "requestButtonCustomIds",
  "requestButtonRoutes",
  "replyAuthorId",
] as const
const CREATE_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "action",
  "channelId",
  "components",
  "notifyReplyAuthor",
  "notifyUserIds",
  "operationKey",
  "replyToMessageId",
])
const EDIT_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "action",
  "channelId",
  "components",
  "messageId",
  "notifyUserIds",
  "operationKey",
])

export interface ComponentMessageRequest {
  action: ComponentMessageAction
  channelId: string
  components: readonly ComponentLayoutInput[]
  messageId?: string
  notifyReplyAuthor?: boolean
  notifyUserIds?: readonly string[]
  operationKey: string
  replyToMessageId?: string
}

export interface NormalizedComponentMessageRequest {
  action: ComponentMessageAction
  channelId: string
  components: NormalizedComponentLayout
  messageId: string | null
  notifyReplyAuthor: boolean
  notifyUserIds: string[]
  operationKey: string
  operationKeyHash: string
  replyToMessageId: string | null
  review: ComponentLayoutReview
}

export interface ComponentMessagePrivacyProjection {
  durableRecords: "content-free"
  omittedFields: typeof PRIVACY_OMITTED_FIELDS
  planPersistence: "none"
  rawPayloads: "omitted"
}

export interface ComponentMessagePermissionEvidence {
  administrator: boolean
  appliedRoleIds: string[]
  canReadMessages: true
  confidence: "complete"
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  permissionSourceChannelId: string
  privateThreadAccess: "lookup-succeeded" | "not-applicable"
  requiredPermissionNames: DiscordPermissionName[]
}

export interface ComponentMessageRequestButtonIngress {
  authorizedUserIds: string[]
  commandId: string
  commandVersion: string
  gatewayDelivery: "verified"
  guildId: string
  phase: "ready"
  ready: true
  schemaVersion: number
}

export interface ComponentMessagePlan {
  action: ComponentMessageAction
  applicationId: string
  botId: string
  channel: {
    guildId: string
    id: string
    parentId: string | null
    type: number
  }
  createdAt: string
  current: {
    flags: number
    layout: NormalizedComponentLayout
    messageId: string
    parsedUserMentionIds: string[]
    pinned: boolean
    preview: string
    requestButtonCount: number
    requestButtonRouteHash: string | null
    timestamp: string
  } | null
  digest: string
  guild: {
    id: string
    name: string
  }
  messageContentIntent: "enabled"
  notificationAuthorization: DiscordNotificationAuthorization
  notificationUserIds: string[]
  notifyReplyAuthor: boolean
  operationKeyHash: string
  permission: ComponentMessagePermissionEvidence
  privacy: ComponentMessagePrivacyProjection
  reply: {
    authorId: string
    messageId: string
    type: number
  } | null
  requestButtons: {
    count: number
    ingress: ComponentMessageRequestButtonIngress | null
  }
  schemaVersion: number
  status: "already-current" | "planned"
  target: {
    counts: ComponentLayoutCounts
    layout: NormalizedComponentLayout
    linkOrigins: string[]
    linkUrls: string[]
    messageId: string | null
    preview: string
    suppressedUserMentionIds: string[]
    textCharacters: number
  }
  warnings: string[]
  writeRequired: boolean
}

export interface ComponentMessageResult {
  action: ComponentMessageAction
  activityId: string | null
  channelId: string
  guildId: string
  messageId: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: true
  responseMatched: true
  schemaVersion: number
  status: "already-current" | "completed"
  url: string
}

export type ComponentMessageVerificationReason =
  | "message-missing"
  | "message-state-mismatch"
  | "operation-failed"
  | "operation-not-found"
  | "operation-pending"
  | "operation-uncertain"
  | "receipt-target-mismatch"
  | "request-mismatch"

export interface ComponentMessageVerificationResult {
  action: ComponentMessageAction
  activityId: string | null
  channelId: string
  guildId: string | null
  messageId: string | null
  operationKeyHash: string
  planDigest: string | null
  readbackMatched: boolean
  reason: ComponentMessageVerificationReason | null
  receiptStatus: OperationReceipt["status"] | null
  requestMatched: boolean
  schemaVersion: number
  status: "blocked" | "drifted" | "not-found" | "verified"
  timestamp: string | null
  url: string | null
}

export interface ComponentMessageServiceClient extends Pick<
  DiscordClient,
  | "createComponentMessage"
  | "editComponentMessage"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
  | "getThreadMember"
> {}

export interface ComponentMessageServiceOptions {
  activityStore: ActivityStore
  client: ComponentMessageServiceClient
  clock?: () => Date
  limiter: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
  requestButtonKey?: Uint8Array
  requestButtonReadiness?: (
    guildId: string,
  ) => NativeInteractionRequestButtonReadiness | Promise<NativeInteractionRequestButtonReadiness>
  verificationKey?: Uint8Array
}

interface ExistingComponentMessage {
  editedTimestamp: string | null
  flags: number
  layout: NormalizedComponentLayout
  message: DiscordMessage
  parsedUserMentionIds: string[]
  pinned: boolean
  requestButtonCount: number
  requestButtonRouteHash: string | null
  timestamp: string
}

interface ComponentMessageState {
  botMember: DiscordGuildMember
  channel: DiscordChannel
  current: ExistingComponentMessage | null
  guild: DiscordGuild
  guildId: string
  notificationAuthorization: DiscordNotificationAuthorization
  parent: DiscordChannel | null
  permission: BotChannelPermissionResult & { confidence: "complete" }
  reply: DiscordMessage | null
  roles: DiscordRole[]
}

interface BuiltComponentMessagePlan {
  plan: ComponentMessagePlan
  state: ComponentMessageState
}

interface ComponentMessageStateOptions {
  allowOperationReceipt?: boolean
  includeCurrent?: boolean
  permissionMode?: ComponentMessagePermissionMode
}

type ComponentMessagePermissionMode = "read" | "write"

function evidenceError(message: string, cause?: unknown): ComponentMessageEvidenceError {
  return new ComponentMessageEvidenceError(
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

function assertPositiveSnowflake(value: unknown, name: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${name} must be an exact Discord snowflake`)
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
    || TEXT_CONTROL_PATTERN.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function onlyKnownKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => keys.has(key))
}

export function normalizeComponentMessageRequest(
  request: ComponentMessageRequest,
): NormalizedComponentMessageRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord component-message request must be an object")
  }
  if (!COMPONENT_MESSAGE_ACTIONS.includes(request.action)) {
    throw new RangeError("Discord component-message action must be create or edit")
  }
  const allowedKeys = request.action === "create" ? CREATE_REQUEST_KEYS : EDIT_REQUEST_KEYS
  if (!onlyKnownKeys(request as unknown as Record<string, unknown>, allowedKeys)) {
    throw new RangeError("Discord component-message request contains unsupported action fields")
  }
  assertPositiveSnowflake(request.channelId, "Discord component-message channel ID")
  const messageId = request.messageId ?? null
  const replyToMessageId = request.replyToMessageId ?? null
  if (request.action === "edit") {
    assertPositiveSnowflake(messageId, "Discord component-message edit target ID")
  } else if (messageId !== null) {
    throw new RangeError("Discord component-message create request cannot include a message ID")
  }
  if (replyToMessageId !== null) {
    assertPositiveSnowflake(replyToMessageId, "Discord component-message reply target ID")
  }
  if (
    request.notifyReplyAuthor !== undefined
    && typeof request.notifyReplyAuthor !== "boolean"
  ) {
    throw new RangeError("Discord component-message reply notification must be a boolean")
  }
  if (request.notifyReplyAuthor && replyToMessageId === null) {
    throw new RangeError("Discord component-message reply notification requires a reply target")
  }
  const review = reviewComponentLayout(request.components, request.notifyUserIds)
  return {
    action: request.action,
    channelId: request.channelId,
    components: review.layout,
    messageId,
    notifyReplyAuthor: request.notifyReplyAuthor ?? false,
    notifyUserIds: review.notificationUserIds,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    replyToMessageId,
    review,
  }
}

export function componentMessageNonce(
  channelId: string,
  operationKey: string,
): string {
  return createHash("sha256")
    .update("guildcontrol-component-message.v1\0")
    .update(channelId)
    .update("\0")
    .update(operationKey)
    .digest("base64url")
    .slice(0, DISCORD_LIMITS.messageNonceCharacters)
}

export function componentMessageVerificationKey(token: string): Uint8Array {
  if (typeof token !== "string" || !token.trim()) {
    throw new RangeError("Discord component-message verification requires a non-empty secret")
  }
  return createHmac("sha256", token)
    .update("guildcontrol-component-message-verification-key.v1\0")
    .digest()
}

export function componentMessageRequestDigest(
  key: Uint8Array,
  applicationId: string,
  botId: string,
  request: NormalizedComponentMessageRequest,
): string {
  assertPositiveSnowflake(applicationId, "Discord connector application ID")
  assertPositiveSnowflake(botId, "Discord connector bot ID")
  return reviewedPlanDigest(key, {
    applicationId,
    botId,
    domain: "guildcontrol-component-message-request.v1",
    request: {
      action: request.action,
      channelId: request.channelId,
      components: request.components,
      messageId: request.messageId,
      notifyReplyAuthor: request.notifyReplyAuthor,
      notifyUserIds: request.notifyUserIds,
      operationKeyHash: request.operationKeyHash,
      replyToMessageId: request.replyToMessageId,
    },
  })
}

function matchingDigest(left: string, right: string): boolean {
  if (
    !REVIEWED_PLAN_DIGEST_PATTERN.test(left)
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(right)
  ) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

function channelSnapshot(channel: DiscordChannel) {
  return {
    guildId: channel.guild_id ?? null,
    id: channel.id,
    parentId: channel.parent_id ?? null,
    permissionOverwrites: channel.permission_overwrites ?? null,
    threadMetadata: channel.thread_metadata ?? null,
    type: channel.type,
  }
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    name: role.name,
    permissions: role.permissions,
    position: role.position,
  }))
}

function referenceSnapshot(message: DiscordMessage) {
  const reference = message.message_reference
  return reference === undefined
    ? null
    : {
        channelId: reference.channel_id ?? null,
        guildId: reference.guild_id ?? null,
        messageId: reference.message_id ?? null,
        type: reference.type ?? DISCORD_MESSAGE_REFERENCE_TYPES.default,
      }
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
    || !positiveSnowflake(channel.id)
    || !positiveSnowflake(channel.guild_id)
    || !Number.isSafeInteger(channel.type)
    || !COMPONENT_CHANNEL_TYPES.has(channel.type)
    || (channel.parent_id !== undefined
      && channel.parent_id !== null
      && !positiveSnowflake(channel.parent_id))
    || (channel.permission_overwrites !== undefined
      && !Array.isArray(channel.permission_overwrites))
  ) {
    throw evidenceError(`Discord returned invalid ${description} channel evidence`)
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type)) {
    const metadata = channel.thread_metadata
    if (
      !positiveSnowflake(channel.parent_id)
      || !metadata
      || metadata.archived !== false
      || metadata.locked !== false
      || !validTimestamp(metadata.archive_timestamp)
      || !Number.isInteger(metadata.auto_archive_duration)
    ) {
      throw evidenceError("Discord component-message thread must be active and unlocked")
    }
  }
  return channel
}

function expectedParentTypes(threadType: number): ReadonlySet<number> {
  if (threadType === DISCORD_CHANNEL_TYPES.announcementThread) {
    return new Set([DISCORD_CHANNEL_TYPES.announcement])
  }
  if (threadType === DISCORD_CHANNEL_TYPES.privateThread) {
    return new Set([DISCORD_CHANNEL_TYPES.text])
  }
  return new Set([
    DISCORD_CHANNEL_TYPES.forum,
    DISCORD_CHANNEL_TYPES.media,
    DISCORD_CHANNEL_TYPES.text,
  ])
}

function exactParent(
  parent: DiscordChannel,
  thread: DiscordChannel,
  guildId: string,
): DiscordChannel {
  if (
    !parent
    || typeof parent !== "object"
    || Array.isArray(parent)
    || parent.id !== thread.parent_id
    || !positiveSnowflake(parent.id)
    || parent.guild_id !== guildId
    || !Number.isSafeInteger(parent.type)
    || !THREAD_PARENT_TYPES.has(parent.type)
    || !expectedParentTypes(thread.type).has(parent.type)
    || !Array.isArray(parent.permission_overwrites)
  ) {
    throw evidenceError("Discord returned invalid component-message thread parent evidence")
  }
  return parent
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
    throw evidenceError("Discord returned invalid component-message guild evidence")
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
    || member.roles.some((roleId) => !positiveSnowflake(roleId))
    || !member.user
    || member.user.id !== botId
    || member.user.bot !== true
  ) {
    throw evidenceError("Discord returned invalid component-message bot member evidence")
  }
  return member
}

function exactRoles(value: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded component-message role inventory")
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
      throw evidenceError("Discord returned invalid or duplicate component-message role evidence")
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
    throw evidenceError("Discord returned invalid component-message @everyone role evidence")
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
    throw evidenceError("Discord returned mismatched private-thread component-message membership")
  }
}

function requiredPermissions(
  channel: DiscordChannel,
  mode: ComponentMessagePermissionMode = "write",
): DiscordPermissionName[] {
  const readPermissions: DiscordPermissionName[] = [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
  ]
  return mode === "read"
    ? readPermissions
    : [
        ...readPermissions,
        THREAD_CHANNEL_TYPES.has(channel.type)
          ? "SEND_MESSAGES_IN_THREADS"
          : "SEND_MESSAGES",
      ]
}

function exactPermissions(
  permission: BotChannelPermissionResult,
  channel: DiscordChannel,
  mode: ComponentMessagePermissionMode = "write",
): BotChannelPermissionResult & { confidence: "complete" } {
  if (permission.confidence !== "complete" || permission.canReadMessages !== true) {
    throw evidenceError(
      `Discord returned incomplete component-message permission evidence: ${permission.warnings.join("; ")}`,
    )
  }
  const required = requiredPermissions(channel, mode)
  const effective = BigInt(permission.effectivePermissions)
  const missing = permission.administrator
    ? []
    : required.filter((name) => (
      (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
    ))
  if (missing.length > 0) {
    throw evidenceError(
      `Discord connector bot lacks component-message permissions: ${missing.join(", ")}`,
    )
  }
  return permission as BotChannelPermissionResult & { confidence: "complete" }
}

function exactReply(
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
    || !positiveSnowflake(message.id)
    || !positiveSnowflake(message.author?.id)
    || !validTimestamp(message.timestamp)
    || !REPLY_MESSAGE_TYPES.has(message.type)
  ) {
    throw evidenceError("Discord returned invalid component-message reply evidence")
  }
  return message
}

function emptyArray(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.length === 0
}

function exactParsedUserMentionIds(message: DiscordMessage): string[] {
  if (
    message.mention_everyone !== false
    || !Array.isArray(message.mention_roles)
    || message.mention_roles.length !== 0
    || !Array.isArray(message.mentions)
    || message.mentions.length > DISCORD_LIMITS.allowedMentionUsers
  ) {
    throw evidenceError("Discord component message has unsafe parsed mention state")
  }
  const ids = message.mentions.map((mention) => {
    if (
      !mention
      || typeof mention !== "object"
      || Array.isArray(mention)
      || !positiveSnowflake(mention.id)
    ) {
      throw evidenceError("Discord component message has invalid parsed user mentions")
    }
    return mention.id
  })
  if (new Set(ids).size !== ids.length) {
    throw evidenceError("Discord component message has duplicate parsed user mentions")
  }
  return ids.sort()
}

function exactMessageBase(
  message: DiscordMessage,
  botId: string,
  channelId: string,
  guildId: string,
  messageId: string,
): void {
  if (
    !message
    || typeof message !== "object"
    || Array.isArray(message)
    || message.id !== messageId
    || message.channel_id !== channelId
    || (message.guild_id !== undefined && message.guild_id !== guildId)
    || !positiveSnowflake(message.id)
    || !validTimestamp(message.timestamp)
    || message.author?.id !== botId
    || message.author.bot !== true
    || message.webhook_id !== undefined
    || message.content !== ""
    || !Array.isArray(message.attachments)
    || message.attachments.length !== 0
    || !Array.isArray(message.embeds)
    || message.embeds.length !== 0
    || !emptyArray(message.sticker_items)
    || !emptyArray(message.stickers)
    || message.poll !== undefined
    || message.tts !== false
  ) {
    throw evidenceError("Discord returned mismatched or legacy component-message evidence")
  }
}

function exactFlags(flags: unknown): number {
  if (
    !Number.isSafeInteger(flags)
    || (flags as number) < 0
    || (flags as number) > 0xFF_FF_FF_FF
    || ((flags as number) & DISCORD_MESSAGE_FLAGS.isComponentsV2) === 0
  ) {
    throw evidenceError("Discord component message lacks a valid irreversible V2 flag")
  }
  return flags as number
}

function exactManagedLayout(
  components: unknown,
  verification: ComponentLayoutRequestButtonVerification,
  message: string,
): ParsedManagedComponentLayout {
  try {
    return parseDiscordManagedComponentLayout(components, verification)
  } catch (error) {
    throw evidenceError(message, error)
  }
}

function exactExistingMessage(
  message: DiscordMessage,
  botId: string,
  channelId: string,
  guildId: string,
  messageId: string,
  requestButtonVerification: ComponentLayoutRequestButtonVerification,
): ExistingComponentMessage {
  exactMessageBase(message, botId, channelId, guildId, messageId)
  if (
    message.type !== DISCORD_MESSAGE_TYPES.default
    || message.message_reference !== undefined
    || typeof message.pinned !== "boolean"
    || !(message.edited_timestamp === undefined
      || message.edited_timestamp === null
      || validTimestamp(message.edited_timestamp))
  ) {
    throw evidenceError("Discord edit target is not an exact default component message")
  }
  const parsedLayout = exactManagedLayout(
    message.components,
    requestButtonVerification,
    "Discord edit target has an unsupported component layout",
  )
  const layout = parsedLayout.layout
  const parsedUserMentionIds = exactParsedUserMentionIds(message)
  const visibleUserMentionIds = new Set(
    discordMentionedUserIds(componentLayoutText(layout)),
  )
  if (parsedUserMentionIds.some((userId) => !visibleUserMentionIds.has(userId))) {
    throw evidenceError("Discord edit target contains a parsed user mention absent from its layout")
  }
  return {
    editedTimestamp: message.edited_timestamp ?? null,
    flags: exactFlags(message.flags),
    layout,
    message,
    parsedUserMentionIds,
    pinned: message.pinned,
    requestButtonCount: parsedLayout.requestButtons.length,
    requestButtonRouteHash: parsedLayout.route === null
      ? null
      : requestButtonRouteHash(parsedLayout.route),
    timestamp: message.timestamp,
  }
}

function exactReplyReference(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  replyToMessageId: string | null,
): void {
  const reference = message.message_reference
  if (replyToMessageId === null) {
    if (reference !== undefined) {
      throw evidenceError("Discord created an unexpected component-message reply reference")
    }
    return
  }
  if (
    !reference
    || reference.message_id !== replyToMessageId
    || (reference.channel_id !== undefined && reference.channel_id !== channelId)
    || (reference.guild_id !== undefined && reference.guild_id !== guildId)
    || (reference.type !== undefined
      && reference.type !== DISCORD_MESSAGE_REFERENCE_TYPES.default)
  ) {
    throw evidenceError("Discord component-message reply reference does not match the plan")
  }
}

function exactCreatedMessage(
  message: DiscordMessage,
  botId: string,
  request: NormalizedComponentMessageRequest,
  guildId: string,
  expectedMessageId: string,
  expectedParsedUserMentionIds: readonly string[],
  requireNonce: boolean,
  requestButtonVerification: ComponentLayoutRequestButtonVerification,
): ExistingComponentMessage {
  exactMessageBase(message, botId, request.channelId, guildId, expectedMessageId)
  const expectedType = request.replyToMessageId === null ? 0 : 19
  if (
    message.type !== expectedType
    || exactFlags(message.flags) !== DISCORD_MESSAGE_FLAGS.isComponentsV2
    || typeof message.pinned !== "boolean"
    || message.pinned
    || !(message.edited_timestamp === undefined || message.edited_timestamp === null)
  ) {
    throw evidenceError("Discord created component-message state that does not match the plan")
  }
  const nonce = componentMessageNonce(request.channelId, request.operationKey)
  if (message.nonce !== nonce && (requireNonce || message.nonce !== undefined)) {
    throw evidenceError("Discord component-message nonce does not match the operation key")
  }
  exactReplyReference(
    message,
    request.channelId,
    guildId,
    request.replyToMessageId,
  )
  const parsedLayout = exactManagedLayout(
    message.components,
    requestButtonVerification,
    "Discord created an unsupported component layout",
  )
  const layout = parsedLayout.layout
  if (!componentLayoutsEqual(layout, request.components)) {
    throw evidenceError("Discord created a component layout that differs from the plan")
  }
  const parsedUserMentionIds = exactParsedUserMentionIds(message)
  if (
    JSON.stringify(parsedUserMentionIds)
    !== JSON.stringify([...new Set(expectedParsedUserMentionIds)].sort())
  ) {
    throw evidenceError("Discord created parsed user mentions that differ from the plan")
  }
  return {
    editedTimestamp: null,
    flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
    layout,
    message,
    parsedUserMentionIds,
    pinned: false,
    requestButtonCount: parsedLayout.requestButtons.length,
    requestButtonRouteHash: parsedLayout.route === null
      ? null
      : requestButtonRouteHash(parsedLayout.route),
    timestamp: message.timestamp,
  }
}

function exactEditedMessage(
  message: DiscordMessage,
  botId: string,
  request: NormalizedComponentMessageRequest,
  guildId: string,
  current: ExistingComponentMessage,
  requestButtonVerification: ComponentLayoutRequestButtonVerification,
): ExistingComponentMessage {
  const messageId = request.messageId as string
  exactMessageBase(message, botId, request.channelId, guildId, messageId)
  if (
    message.type !== DISCORD_MESSAGE_TYPES.default
    || exactFlags(message.flags) !== current.flags
    || message.pinned !== current.pinned
    || message.timestamp !== current.timestamp
    || JSON.stringify(referenceSnapshot(message))
      !== JSON.stringify(referenceSnapshot(current.message))
    || !(message.edited_timestamp === null || validTimestamp(message.edited_timestamp))
  ) {
    throw evidenceError("Discord edited component-message state differs from the reviewed identity")
  }
  const parsedLayout = exactManagedLayout(
    message.components,
    requestButtonVerification,
    "Discord edited an unsupported component layout",
  )
  const layout = parsedLayout.layout
  if (!componentLayoutsEqual(layout, request.components)) {
    throw evidenceError("Discord edited component layout differs from the plan")
  }
  const parsedUserMentionIds = exactParsedUserMentionIds(message)
  if (
    JSON.stringify(parsedUserMentionIds)
    !== JSON.stringify(request.notifyUserIds)
  ) {
    throw evidenceError("Discord edited parsed user mentions that differ from the plan")
  }
  return {
    editedTimestamp: message.edited_timestamp,
    flags: current.flags,
    layout,
    message,
    parsedUserMentionIds,
    pinned: current.pinned,
    requestButtonCount: parsedLayout.requestButtons.length,
    requestButtonRouteHash: parsedLayout.route === null
      ? null
      : requestButtonRouteHash(parsedLayout.route),
    timestamp: current.timestamp,
  }
}

function exactReadbackMatch(
  response: ExistingComponentMessage,
  readback: ExistingComponentMessage,
): void {
  if (
    response.flags !== readback.flags
    || response.pinned !== readback.pinned
    || response.timestamp !== readback.timestamp
    || response.editedTimestamp !== readback.editedTimestamp
    || response.requestButtonCount !== readback.requestButtonCount
    || response.requestButtonRouteHash !== readback.requestButtonRouteHash
    || JSON.stringify(response.parsedUserMentionIds)
      !== JSON.stringify(readback.parsedUserMentionIds)
    || !componentLayoutsEqual(response.layout, readback.layout)
  ) {
    throw evidenceError("Discord component-message readback differs from the mutation response")
  }
}

function privacyProjection(): ComponentMessagePrivacyProjection {
  return {
    durableRecords: "content-free",
    omittedFields: PRIVACY_OMITTED_FIELDS,
    planPersistence: "none",
    rawPayloads: "omitted",
  }
}

function permissionEvidence(
  permission: BotChannelPermissionResult & { confidence: "complete" },
  channel: DiscordChannel,
): ComponentMessagePermissionEvidence {
  return {
    administrator: permission.administrator,
    appliedRoleIds: permission.appliedRoleIds,
    canReadMessages: true,
    confidence: "complete",
    effectivePermissionNames: permission.effectivePermissionNames,
    effectivePermissions: permission.effectivePermissions,
    permissionSourceChannelId: permission.permissionSourceChannelId,
    privateThreadAccess: permission.privateThreadAccess,
    requiredPermissionNames: requiredPermissions(channel),
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
  messageId?: string | null
  plan: ComponentMessagePlan
  request: NormalizedComponentMessageRequest
  status: ComponentMessageActivityStatus
  timestamp: string
  verification?: "match" | null
}): ComponentMessageActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.plan.channel.guildId,
    id: options.activityId,
    kind: options.request.action === "create"
      ? "component-message-create"
      : "component-message-edit",
    messageId: options.messageId ?? null,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    replyToMessageId: options.request.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  messageId?: string | null
  plan: ComponentMessagePlan
  requestDigest: string
  request: NormalizedComponentMessageRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.channel.guildId,
    kind: "component-message",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    requestDigest: options.requestDigest,
    resourceId: options.messageId ?? null,
    schemaVersion: 2,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function requestButtonBinding(
  key: Uint8Array,
  applicationId: string,
  botId: string,
  request: NormalizedComponentMessageRequest,
  guildId: string,
): ComponentLayoutRequestButtonBinding | undefined {
  return componentLayoutHasRequestButtons(request.components)
    ? {
        binding: {
          applicationId,
          botId,
          channelId: request.channelId,
          guildId,
          operationKeyHash: request.operationKeyHash,
        },
        key,
      }
    : undefined
}

function requestButtonVerification(
  key: Uint8Array,
  applicationId: string,
  botId: string,
  channelId: string,
  guildId: string,
  operationKeyHash?: string,
): ComponentLayoutRequestButtonVerification {
  return {
    key,
    ...(operationKeyHash === undefined ? {} : { operationKeyHash }),
    scope: {
      applicationId,
      botId,
      channelId,
      guildId,
    },
  }
}

function exactRequestButtonIngress(
  readiness: NativeInteractionRequestButtonReadiness,
  guildId: string,
  authorizedUserIds: readonly string[],
): ComponentMessageRequestButtonIngress {
  const exactAuthorizedUserIds = [...authorizedUserIds]
  if (
    !readiness
    || typeof readiness !== "object"
    || Array.isArray(readiness)
    || readiness.guildId !== guildId
    || readiness.phase !== "ready"
    || readiness.ready !== true
    || !positiveSnowflake(readiness.commandId)
    || !positiveSnowflake(readiness.commandVersion)
    || readiness.gatewayDelivery !== "verified"
    || readiness.schemaVersion !== SCHEMA_VERSION
    || exactAuthorizedUserIds.length < 1
    || exactAuthorizedUserIds.some((userId) => !positiveSnowflake(userId))
    || new Set(exactAuthorizedUserIds).size !== exactAuthorizedUserIds.length
    || JSON.stringify(exactAuthorizedUserIds)
      !== JSON.stringify([...exactAuthorizedUserIds].sort())
  ) {
    throw evidenceError(
      "Discord request-button publication requires a ready, verified native Interaction ingress for the exact guild",
    )
  }
  return {
    authorizedUserIds: exactAuthorizedUserIds,
    commandId: readiness.commandId,
    commandVersion: readiness.commandVersion,
    gatewayDelivery: "verified",
    guildId,
    phase: "ready",
    ready: true,
    schemaVersion: SCHEMA_VERSION,
  }
}

function createInput(
  applicationId: string,
  botId: string,
  requestButtonKey: Uint8Array,
  request: NormalizedComponentMessageRequest,
  guildId: string,
): CreateComponentMessageInput {
  return {
    allowedMentions: discordAllowedMentions(
      request.notifyUserIds,
      request.notifyReplyAuthor,
    ),
    components: compileComponentLayout(
      request.components,
      requestButtonBinding(
        requestButtonKey,
        applicationId,
        botId,
        request,
        guildId,
      ),
    ),
    nonce: componentMessageNonce(request.channelId, request.operationKey),
    ...(request.replyToMessageId === null
      ? {}
      : {
          reply: {
            guildId,
            messageId: request.replyToMessageId,
          },
        }),
  }
}

function editInput(
  applicationId: string,
  botId: string,
  requestButtonKey: Uint8Array,
  request: NormalizedComponentMessageRequest,
  current: ExistingComponentMessage,
  guildId: string,
): EditComponentMessageInput {
  return {
    allowedMentions: discordAllowedMentions(request.notifyUserIds, false),
    components: compileComponentLayout(
      request.components,
      requestButtonBinding(
        requestButtonKey,
        applicationId,
        botId,
        request,
        guildId,
      ),
    ),
    flags: current.flags,
  }
}

function expectedCreateParsedUserMentionIds(
  request: NormalizedComponentMessageRequest,
  reply: DiscordMessage | null,
): string[] {
  return [...new Set([
    ...request.notifyUserIds,
    ...(request.notifyReplyAuthor && reply ? [reply.author.id] : []),
  ])].sort()
}

export class ComponentMessageService {
  readonly #activityStore: ActivityStore
  readonly #client: ComponentMessageServiceClient
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string
  readonly #requestButtonKey: Uint8Array
  readonly #requestButtonReadiness: ((
    guildId: string,
  ) => NativeInteractionRequestButtonReadiness | Promise<NativeInteractionRequestButtonReadiness>) | undefined
  readonly #verificationKey: Uint8Array

  constructor(options: ComponentMessageServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#limiter = options.limiter
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
    this.#requestButtonKey = options.requestButtonKey || this.#planKey
    this.#requestButtonReadiness = options.requestButtonReadiness
    this.#verificationKey = options.verificationKey || this.#planKey
  }

  async #state(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: NormalizedComponentMessageRequest,
    options: RequestOptions,
    stateOptions: ComponentMessageStateOptions = {},
  ): Promise<ComponentMessageState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    if (intent !== "enabled") {
      throw evidenceError(
        "Discord component-message planning requires confirmed Message Content intent",
      )
    }
    if (!stateOptions.allowOperationReceipt) {
      const receipt = await this.#operationStore.get(
        "component-message",
        request.operationKeyHash,
      )
      if (receipt) {
        throw new ComponentMessageOperationConflictError(receiptView(receipt))
      }
    }
    const channel = exactChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
      "component-message target",
    )
    const guildId = this.#policy.assertChannelInteractable(channel)
    let parent: DiscordChannel | null = null
    if (THREAD_CHANNEL_TYPES.has(channel.type)) {
      parent = exactParent(
        await this.#client.getChannel(channel.parent_id as string, options),
        channel,
        guildId,
      )
      if (this.#policy.assertChannelReadable(parent) !== guildId) {
        throw evidenceError("Discord component-message parent belongs to another guild")
      }
      if (channel.type === DISCORD_CHANNEL_TYPES.privateThread) {
        exactPrivateThreadMember(
          await this.#client.getThreadMember(channel.id, botId, options),
          channel.id,
          botId,
        )
      }
    }

    const [rawGuild, rawMember, rawRoles, rawReply, rawCurrent] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      request.replyToMessageId === null
        ? Promise.resolve(null)
        : this.#client.getMessage(request.channelId, request.replyToMessageId, options),
      request.messageId === null || stateOptions.includeCurrent === false
        ? Promise.resolve(null)
        : this.#client.getMessage(request.channelId, request.messageId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    let rawPermission: BotChannelPermissionResult
    try {
      rawPermission = evaluateBotChannelPermissions({
        botId,
        channel,
        guildId,
        member: botMember,
        permissionChannel: parent ?? channel,
        roles,
      })
    } catch (error) {
      throw evidenceError("Discord returned invalid component-message permission evidence", error)
    }
    const permission = exactPermissions(
      rawPermission,
      channel,
      stateOptions.permissionMode,
    )
    const reply = rawReply === null
      ? null
      : exactReply(
          rawReply,
          request.channelId,
          guildId,
          request.replyToMessageId as string,
        )
    const notificationAuthorization = discordReviewedNotificationAuthorization(
      request.notifyUserIds,
      this.#policy,
      reply && request.notifyReplyAuthor ? reply.author.id : undefined,
    )
    const current = rawCurrent === null
      ? null
      : exactExistingMessage(
          rawCurrent,
          botId,
          request.channelId,
          guildId,
          request.messageId as string,
          requestButtonVerification(
            this.#requestButtonKey,
            applicationId,
            botId,
            request.channelId,
            guildId,
          ),
        )
    return {
      botMember,
      channel,
      current,
      guild,
      guildId,
      notificationAuthorization,
      parent,
      permission,
      reply,
      roles,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: NormalizedComponentMessageRequest,
    options: RequestOptions,
  ): Promise<BuiltComponentMessagePlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    this.#policy.assertComponentLinkOrigins(request.review.linkOrigins)
    const state = await this.#state(applicationId, botId, intent, request, options)
    let requestButtonIngress: ComponentMessageRequestButtonIngress | null = null
    if (componentLayoutHasRequestButtons(request.components)) {
      const authorizedUserIds = this.#policy.assertNativeInteractionTargetAllowed(
        state.guildId,
        request.channelId,
      )
      if (!this.#requestButtonReadiness) {
        throw evidenceError(
          "Discord request-button publication requires a paired native Interaction broker",
        )
      }
      requestButtonIngress = exactRequestButtonIngress(
        await this.#requestButtonReadiness(state.guildId),
        state.guildId,
        authorizedUserIds,
      )
    }
    const writeRequired = request.action === "create"
      || state.current === null
      || !componentLayoutsEqual(state.current.layout, request.components)
      || state.current.parsedUserMentionIds.length > 0
      || request.notifyUserIds.length > 0
    const status = writeRequired ? "planned" : "already-current"
    const privacy = privacyProjection()
    const permission = permissionEvidence(state.permission, state.channel)
    const warnings = [
      ...request.review.warnings,
      ...(state.permission.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with the exact channel permissions listed in this plan"]
        : []),
      ...(request.action === "edit"
        ? ["Editing preserves the target message's irreversible V2 flag and observed non-layout identity"]
        : ["Create uses a deterministic Discord nonce, but its reviewed operation key remains one-shot"]),
      ...(writeRequired
        ? [
            "Execution sends one non-retried Discord mutation and performs an exact fresh readback",
            "The operation key cannot be reused after reservation, including after an uncertain outcome",
          ]
        : ["The exact notification-free edit is a record-free no-op that does not reserve the operation key"]),
      ...(requestButtonIngress === null
        ? []
        : [
            "Each request Button creates only a private bounded broker request after fresh authenticated source-message validation",
            "Request Buttons grant no write or administration authority and accept clicks only from the exact configured user scope",
          ]),
      "Durable records omit component text, component trees, link destinations, request-button IDs and routes, notification IDs, raw payloads, and the raw operation key",
    ]
    const currentSnapshot = state.current === null
      ? null
      : {
          editedTimestamp: state.current.editedTimestamp,
          flags: state.current.flags,
          layout: state.current.layout,
          messageId: state.current.message.id,
          parsedUserMentionIds: state.current.parsedUserMentionIds,
          pinned: state.current.pinned,
          requestButtonCount: state.current.requestButtonCount,
          requestButtonRouteHash: state.current.requestButtonRouteHash,
          reference: referenceSnapshot(state.current.message),
          timestamp: state.current.timestamp,
          type: state.current.message.type,
        }
    const digest = reviewedPlanDigest(this.#planKey, {
      action: request.action,
      applicationId,
      botId,
      botMemberRoleIds: [...state.botMember.roles].sort(),
      channel: channelSnapshot(state.channel),
      current: currentSnapshot,
      domain: "guildcontrol-component-message-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      messageContentIntent: "enabled",
      notificationAuthorization: state.notificationAuthorization,
      parent: state.parent === null ? null : channelSnapshot(state.parent),
      permission,
      privacy,
      reply: state.reply === null
        ? null
        : {
            authorId: state.reply.author.id,
            channelId: state.reply.channel_id,
            guildId: state.reply.guild_id ?? null,
            id: state.reply.id,
            timestamp: state.reply.timestamp,
            type: state.reply.type,
          },
      requestButtons: {
        count: request.review.counts.requestButtons,
        ingress: requestButtonIngress,
      },
      request: {
        action: request.action,
        channelId: request.channelId,
        components: request.components,
        messageId: request.messageId,
        notifyReplyAuthor: request.notifyReplyAuthor,
        notifyUserIds: request.notifyUserIds,
        operationKeyHash: request.operationKeyHash,
        replyToMessageId: request.replyToMessageId,
      },
      roles: roleSnapshot(state.roles),
      warnings,
      writeRequired,
    })
    const plan: ComponentMessagePlan = {
      action: request.action,
      applicationId,
      botId,
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      createdAt: this.#clock().toISOString(),
      current: state.current === null
        ? null
        : {
            flags: state.current.flags,
            layout: state.current.layout,
            messageId: state.current.message.id,
            parsedUserMentionIds: state.current.parsedUserMentionIds,
            pinned: state.current.pinned,
            preview: reviewComponentLayout(state.current.layout, []).preview,
            requestButtonCount: state.current.requestButtonCount,
            requestButtonRouteHash: state.current.requestButtonRouteHash,
            timestamp: state.current.timestamp,
          },
      digest,
      guild: { id: state.guild.id, name: state.guild.name },
      messageContentIntent: "enabled",
      notificationAuthorization: state.notificationAuthorization,
      notificationUserIds: request.notifyUserIds,
      notifyReplyAuthor: request.notifyReplyAuthor,
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      reply: state.reply === null
        ? null
        : {
            authorId: state.reply.author.id,
            messageId: state.reply.id,
            type: state.reply.type,
          },
      requestButtons: {
        count: request.review.counts.requestButtons,
        ingress: requestButtonIngress,
      },
      schemaVersion: SCHEMA_VERSION,
      status,
      target: {
        counts: request.review.counts,
        layout: request.components,
        linkOrigins: request.review.linkOrigins,
        linkUrls: request.review.linkUrls,
        messageId: request.messageId,
        preview: request.review.preview,
        suppressedUserMentionIds: request.review.suppressedUserMentionIds,
        textCharacters: request.review.textCharacters,
      },
      warnings,
      writeRequired,
    }
    return { plan, state }
  }

  plan(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: ComponentMessageRequest,
    options: RequestOptions = {},
  ): Promise<ComponentMessagePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      intent,
      normalizeComponentMessageRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  async verify(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: ComponentMessageRequest,
    options: RequestOptions = {},
  ): Promise<ComponentMessageVerificationResult> {
    const normalized = normalizeComponentMessageRequest(request)
    this.#policy.assertComponentLinkOrigins(normalized.review.linkOrigins)
    if (intent !== "enabled") {
      throw evidenceError(
        "Discord component-message verification requires confirmed Message Content intent",
      )
    }
    const requestDigest = componentMessageRequestDigest(
      this.#verificationKey,
      applicationId,
      botId,
      normalized,
    )
    const base = {
      action: normalized.action,
      channelId: normalized.channelId,
      operationKeyHash: normalized.operationKeyHash,
      schemaVersion: SCHEMA_VERSION,
    }
    const receipt = await this.#operationStore.get(
      "component-message",
      normalized.operationKeyHash,
    )
    if (!receipt) {
      return {
        ...base,
        activityId: null,
        guildId: null,
        messageId: null,
        planDigest: null,
        readbackMatched: false,
        reason: "operation-not-found",
        receiptStatus: null,
        requestMatched: false,
        status: "not-found",
        timestamp: null,
        url: null,
      }
    }
    if (receipt.kind !== "component-message") {
      throw evidenceError("Discord returned a mismatched component-message operation receipt")
    }
    if (!matchingDigest(receipt.requestDigest, requestDigest)) {
      return {
        ...base,
        activityId: null,
        guildId: null,
        messageId: null,
        planDigest: null,
        readbackMatched: false,
        reason: "request-mismatch",
        receiptStatus: receipt.status,
        requestMatched: false,
        status: "blocked",
        timestamp: null,
        url: null,
      }
    }
    if (receipt.status !== "completed") {
      const reason: ComponentMessageVerificationReason = receipt.status === "pending"
        ? "operation-pending"
        : receipt.status === "failed"
          ? "operation-failed"
          : "operation-uncertain"
      return {
        ...base,
        activityId: receipt.activityId,
        guildId: receipt.guildId,
        messageId: receipt.resourceId,
        planDigest: receipt.planDigest,
        readbackMatched: false,
        reason,
        receiptStatus: receipt.status,
        requestMatched: true,
        status: "blocked",
        timestamp: receipt.timestamp,
        url: null,
      }
    }
    const messageId = receipt.resourceId
    if (
      !positiveSnowflake(messageId)
      || normalized.action === "edit" && normalized.messageId !== messageId
    ) {
      return {
        ...base,
        activityId: receipt.activityId,
        guildId: receipt.guildId,
        messageId,
        planDigest: receipt.planDigest,
        readbackMatched: false,
        reason: "receipt-target-mismatch",
        receiptStatus: receipt.status,
        requestMatched: true,
        status: "blocked",
        timestamp: receipt.timestamp,
        url: null,
      }
    }

    const state = await this.#state(
      applicationId,
      botId,
      intent,
      normalized,
      options,
      {
        allowOperationReceipt: true,
        includeCurrent: false,
        permissionMode: "read",
      },
    )
    if (receipt.guildId !== state.guildId) {
      return {
        ...base,
        activityId: receipt.activityId,
        guildId: receipt.guildId,
        messageId,
        planDigest: receipt.planDigest,
        readbackMatched: false,
        reason: "receipt-target-mismatch",
        receiptStatus: receipt.status,
        requestMatched: true,
        status: "blocked",
        timestamp: receipt.timestamp,
        url: null,
      }
    }

    const completedRequestButtonVerification = requestButtonVerification(
      this.#requestButtonKey,
      applicationId,
      botId,
      normalized.channelId,
      state.guildId,
      normalized.operationKeyHash,
    )

    try {
      const rawMessage = await this.#client.getMessage(
        normalized.channelId,
        messageId,
        options,
      )
      if (normalized.action === "create") {
        exactCreatedMessage(
          rawMessage,
          botId,
          normalized,
          state.guildId,
          messageId,
          expectedCreateParsedUserMentionIds(normalized, state.reply),
          false,
          completedRequestButtonVerification,
        )
      } else {
        const current = exactExistingMessage(
          rawMessage,
          botId,
          normalized.channelId,
          state.guildId,
          messageId,
          completedRequestButtonVerification,
        )
        if (
          !componentLayoutsEqual(current.layout, normalized.components)
          || JSON.stringify(current.parsedUserMentionIds)
            !== JSON.stringify(normalized.notifyUserIds)
        ) {
          throw evidenceError(
            "Discord component-message verification found changed layout or mention state",
          )
        }
      }
    } catch (error) {
      if (
        error instanceof ComponentMessageEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        return {
          ...base,
          activityId: receipt.activityId,
          guildId: state.guildId,
          messageId,
          planDigest: receipt.planDigest,
          readbackMatched: false,
          reason: error instanceof DiscordApiError
            ? "message-missing"
            : "message-state-mismatch",
          receiptStatus: receipt.status,
          requestMatched: true,
          status: "drifted",
          timestamp: receipt.timestamp,
          url: null,
        }
      }
      throw error
    }

    return {
      ...base,
      activityId: receipt.activityId,
      guildId: state.guildId,
      messageId,
      planDigest: receipt.planDigest,
      readbackMatched: true,
      reason: null,
      receiptStatus: receipt.status,
      requestMatched: true,
      status: "verified",
      timestamp: receipt.timestamp,
      url: discordMessageUrl(state.guildId, normalized.channelId, messageId),
    }
  }

  async execute(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: ComponentMessageRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ComponentMessageResult> {
    const normalized = normalizeComponentMessageRequest(request)
    const requestDigest = componentMessageRequestDigest(
      this.#verificationKey,
      applicationId,
      botId,
      normalized,
    )
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord component-message plan digest is invalid")
    }
    let built: BuiltComponentMessagePlan
    try {
      built = await this.#buildPlan(
        applicationId,
        botId,
        intent,
        normalized,
        options,
      )
    } catch (error) {
      if (
        error instanceof ComponentMessageEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ComponentMessagePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new ComponentMessagePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: normalized.action,
      channelId: normalized.channelId,
      guildId: state.guildId,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        messageId: normalized.messageId as string,
        readbackMatched: true,
        responseMatched: true,
        status: "already-current",
        url: discordMessageUrl(
          state.guildId,
          normalized.channelId,
          normalized.messageId as string,
        ),
      }
    }

    this.#limiter.reserve(normalized.channelId)
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      requestDigest,
      request: normalized,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ComponentMessageOperationConflictError(receiptView(reservation.receipt))
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
          requestDigest,
          request: normalized,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ComponentMessageExecutionError(
        "Discord component message was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          messageId: null,
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationResolved = false
    let messageId: string | null = normalized.action === "edit"
      ? normalized.messageId
      : null
    let responseMatched: true | null = null
    let readbackMatched: true | null = null
    const expectedParsedUserMentionIds = normalized.action === "create"
      ? expectedCreateParsedUserMentionIds(normalized, state.reply)
      : normalized.notifyUserIds
    const completedRequestButtonVerification = requestButtonVerification(
      this.#requestButtonKey,
      applicationId,
      botId,
      normalized.channelId,
      state.guildId,
      normalized.operationKeyHash,
    )
    try {
      let response: ExistingComponentMessage
      if (normalized.action === "create") {
        const created = await this.#client.createComponentMessage(
          normalized.channelId,
          createInput(
            applicationId,
            botId,
            this.#requestButtonKey,
            normalized,
            state.guildId,
          ),
          options,
        )
        mutationResolved = true
        if (positiveSnowflake(created?.id)) messageId = created.id
        response = exactCreatedMessage(
          created,
          botId,
          normalized,
          state.guildId,
          created.id,
          expectedParsedUserMentionIds,
          true,
          completedRequestButtonVerification,
        )
      } else {
        if (!state.current || !normalized.messageId) {
          throw evidenceError("Discord component-message edit state is unavailable")
        }
        const edited = await this.#client.editComponentMessage(
          normalized.channelId,
          normalized.messageId,
          editInput(
            applicationId,
            botId,
            this.#requestButtonKey,
            normalized,
            state.current,
            state.guildId,
          ),
          options,
        )
        mutationResolved = true
        response = exactEditedMessage(
          edited,
          botId,
          normalized,
          state.guildId,
          state.current,
          completedRequestButtonVerification,
        )
      }
      responseMatched = true
      if (!messageId) {
        throw evidenceError("Discord component-message response omitted its exact message ID")
      }
      const rawReadback = await this.#client.getMessage(
        normalized.channelId,
        messageId,
        options,
      )
      const readback = normalized.action === "create"
        ? exactCreatedMessage(
            rawReadback,
            botId,
            normalized,
            state.guildId,
            messageId,
            expectedParsedUserMentionIds,
            false,
            completedRequestButtonVerification,
          )
        : exactEditedMessage(
            rawReadback,
            botId,
            normalized,
            state.guildId,
            state.current as ExistingComponentMessage,
            completedRequestButtonVerification,
          )
      exactReadbackMatch(response, readback)
      readbackMatched = true
    } catch (error) {
      const deterministicClientFailure = !mutationResolved
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429
      const status = deterministicClientFailure ? "failed" : "uncertain"
      if (status === "failed") messageId = null
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          messageId,
          plan,
          requestDigest,
          request: normalized,
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
          messageId,
          plan,
          request: normalized,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ComponentMessageExecutionError(
        "Discord component message did not complete with exact response and readback state",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          messageId,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    if (!messageId) {
      throw new ComponentMessageExecutionError(
        "Discord component message completed without an exact message ID",
        {
          ...baseResult,
          activityId,
          messageId: null,
          readbackMatched,
          responseMatched,
          status: "uncertain",
        },
      )
    }
    const result: ComponentMessageResult = {
      ...baseResult,
      activityId,
      messageId,
      readbackMatched: true,
      responseMatched: true,
      status: "completed",
      url: discordMessageUrl(state.guildId, normalized.channelId, messageId),
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        messageId,
        plan,
        requestDigest,
        request: normalized,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          messageId,
          plan,
          request: normalized,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ComponentMessageExecutionError(
        "Discord component message completed but the operation receipt failed",
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
        messageId,
        plan,
        request: normalized,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new ComponentMessageExecutionError(
        "Discord component message completed but the final activity record failed",
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
