import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { basename, isAbsolute } from "node:path"

import type {
  ActivityStore,
  DirectMessageActivity,
  DirectMessageActivityStatus,
} from "./activity-log.js"
import {
  AttachmentFileError,
  readDirectAttachmentFileSnapshot,
  type AttachmentFileReview,
  type AttachmentFileSnapshot,
} from "./attachment-file.js"
import {
  compileComponentLayout,
  componentLayoutHasRequestButtons,
  componentLayoutsEqual,
  parseDiscordComponentLayout,
  reviewComponentLayout,
  type ComponentLayoutInput,
  type NormalizedComponentLayout,
} from "./component-layout.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_MESSAGE_TYPES,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  DiscordDirectMessageChannelEvidence,
  DiscordDirectMessageUserEvidence,
} from "./discord-client.js"
import {
  DirectMessageEvidenceError,
  DirectMessageExecutionError,
  DirectMessageOperationConflictError,
  DirectMessagePlanChangedError,
  DiscordApiError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import { assertDiscordMessageContent } from "./message-safety.js"
import {
  type DirectMessageAction,
  type DirectMessageFormat,
  type DirectMessageOperationReceipt,
  type DirectMessageOperationStore,
  type DirectMessageReceiptStage,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordApplication,
  DiscordMessage,
  DiscordUser,
  RequestOptions,
} from "./types.js"
import {
  writeResourceTarget,
  type WriteCoordinator,
} from "./write-coordination.js"

export type DirectMessageChangeRequest =
  | DirectMessageDeleteRequest
  | DirectMessageEditRequest
  | DirectMessageReplyRequest
  | DirectMessageSendRequest

interface DirectMessageRequestBase {
  action: DirectMessageAction
  operationKey: string
  recipientId: string
  reviewReason: string
}

export interface DirectMessageTextBody {
  content: string
  kind: "text"
}

export interface DirectMessageComponentBody {
  components: readonly ComponentLayoutInput[]
  kind: "components-v2"
}

export interface DirectMessageAttachmentBody {
  content?: string
  description?: string
  filePath: string
  filename?: string
  kind: "attachment"
}

export type DirectMessageBody =
  | DirectMessageAttachmentBody
  | DirectMessageComponentBody
  | DirectMessageTextBody

export type DirectMessageEditableBody =
  | DirectMessageComponentBody
  | DirectMessageTextBody

export interface DirectMessageSendRequest extends DirectMessageRequestBase {
  acknowledgeExpectedRecipientContact: true
  action: "send"
  message: DirectMessageBody
}

export interface DirectMessageReplyRequest extends DirectMessageRequestBase {
  acknowledgeExpectedRecipientContact: true
  action: "reply"
  channelId: string
  message: DirectMessageBody
  replyToMessageId: string
}

export interface DirectMessageEditRequest extends DirectMessageRequestBase {
  action: "edit"
  channelId: string
  message: DirectMessageEditableBody
  messageId: string
}

export interface DirectMessageDeleteRequest extends DirectMessageRequestBase {
  acknowledgeIrreversibleDeletion: true
  action: "delete"
  channelId: string
  messageId: string
}

export type NormalizedDirectMessageChangeRequest =
  | NormalizedDirectMessageDeleteRequest
  | NormalizedDirectMessageEditRequest
  | NormalizedDirectMessageReplyRequest
  | NormalizedDirectMessageSendRequest

interface NormalizedDirectMessageRequestBase {
  action: DirectMessageAction
  operationKeyHash: string
  recipientId: string
  reviewReason: string
}

export interface NormalizedDirectMessageTextBody {
  content: string
  kind: "text"
}

export interface NormalizedDirectMessageComponentBody {
  components: NormalizedComponentLayout
  kind: "components-v2"
}

export interface NormalizedDirectMessageAttachmentBody {
  content: string | null
  description: string | null
  filePath: string
  filename: string
  kind: "attachment"
}

export type NormalizedDirectMessageBody =
  | NormalizedDirectMessageAttachmentBody
  | NormalizedDirectMessageComponentBody
  | NormalizedDirectMessageTextBody

export type NormalizedDirectMessageEditableBody =
  | NormalizedDirectMessageComponentBody
  | NormalizedDirectMessageTextBody

export interface NormalizedDirectMessageSendRequest
  extends NormalizedDirectMessageRequestBase {
  acknowledgeExpectedRecipientContact: true
  action: "send"
  message: NormalizedDirectMessageBody
}

export interface NormalizedDirectMessageReplyRequest
  extends NormalizedDirectMessageRequestBase {
  acknowledgeExpectedRecipientContact: true
  action: "reply"
  channelId: string
  message: NormalizedDirectMessageBody
  replyToMessageId: string
}

export interface NormalizedDirectMessageEditRequest
  extends NormalizedDirectMessageRequestBase {
  action: "edit"
  channelId: string
  message: NormalizedDirectMessageEditableBody
  messageId: string
}

export interface NormalizedDirectMessageDeleteRequest
  extends NormalizedDirectMessageRequestBase {
  acknowledgeIrreversibleDeletion: true
  action: "delete"
  channelId: string
  messageId: string
}

export type DirectMessageType =
  | "chat-input-command"
  | "context-menu-command"
  | "default"
  | "reply"

export type DirectMessagePresentation =
  | "single-attachment"
  | "static-components-v2"
  | "text"
  | "unsupported-rich"

export interface DirectMessageView {
  attachment: {
    description: string | null
    filename: string
    id: string
    sizeBytes: number
  } | null
  attachmentCount: number
  author: "connector" | "recipient"
  authorId: string
  channelId: string
  componentCount: number
  componentLayout: NormalizedComponentLayout | null
  componentPreview: string | null
  content: string
  editedTimestamp: string | null
  embedCount: number
  flags: number
  id: string
  mentionEveryone: boolean
  mentionedRoleCount: number
  mentionedUserCount: number
  pinned: boolean
  presentation: DirectMessagePresentation
  reactionCount: number
  replyToMessageId: string | null
  stickerCount: number
  timestamp: string
  type: DirectMessageType
}

export interface DirectMessagePage {
  channelId: string
  messages: DirectMessageView[]
  nextBeforeMessageId: string | null
  recipientId: string
  schemaVersion: number
}

export interface DirectMessagePlan {
  action: DirectMessageAction
  applicationId: string
  botId: string
  channel: {
    exactOneToOne: true
    id: string
    unknownFieldCount: number
  } | null
  createdAt: string
  current: DirectMessageView | null
  desired: {
    linkOrigins: string[]
    linkUrls: string[]
    message: NormalizedDirectMessageBody | null
    preview: string | null
    replyToMessageId: string | null
  }
  digest: string
  effect: "change" | "none"
  file: (AttachmentFileReview & {
    description: string | null
    filename: string
    maxBytes: number
  }) | null
  mentionPolicy: {
    parse: readonly []
    repliedUser: false
    roles: readonly []
    users: readonly []
  }
  operationKeyHash: string
  privacy: {
    omittedFields: readonly [
      "attachment-bytes",
      "attachment-urls",
      "avatars",
      "generated-component-ids",
      "local-file-paths",
      "profile-names",
      "raw-discord-objects",
      "raw-operation-key",
    ]
    persistence: "content-free-records-only"
  }
  rateLimit: {
    globalWritesPerMinute: number
    minimumRecipientIntervalMs: number
  }
  recipient: {
    bot: false
    eligible: true
    id: string
    system: false
    unknownFieldCount: number
  }
  reviewReason: string
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
  writeRequired: boolean
}

export type DirectMessageVerificationReason =
  | "message-drifted"
  | "operation-failed"
  | "operation-not-found"
  | "operation-pending"
  | "operation-uncertain"
  | "receipt-target-mismatch"
  | "request-mismatch"
  | "verified"

export interface DirectMessageVerificationResult {
  action: DirectMessageAction
  activityId: string | null
  channelId: string | null
  messageId: string | null
  operationKeyHash: string
  planDigest: string | null
  readbackMatched: boolean
  reason: DirectMessageVerificationReason
  receiptStage: DirectMessageReceiptStage | null
  receiptStatus: DirectMessageOperationReceipt["status"] | null
  recipientId: string
  requestMatched: boolean
  schemaVersion: number
  status: "blocked" | "drifted" | "not-found" | "verified"
  timestamp: string | null
}

export interface DirectMessageChangeResult {
  action: DirectMessageAction
  activityId: string | null
  channelId: string | null
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  recipientId: string
  recovered: boolean
  schemaVersion: number
  status: "already-current" | "completed"
}

export interface DirectMessageServiceClient {
  createDirectAttachmentMessage: DiscordClient["createDirectAttachmentMessage"]
  createDirectMessage: DiscordClient["createDirectMessage"]
  createDirectComponentMessage: DiscordClient["createDirectComponentMessage"]
  createDirectMessageChannel: DiscordClient["createDirectMessageChannel"]
  deleteDirectMessage: DiscordClient["deleteDirectMessage"]
  editDirectMessage: DiscordClient["editDirectMessage"]
  editDirectComponentMessage: DiscordClient["editDirectComponentMessage"]
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  getCurrentUser: DiscordClient["getCurrentUser"]
  getDirectMessage: DiscordClient["getDirectMessage"]
  getDirectMessageChannel: DiscordClient["getDirectMessageChannel"]
  getDirectMessageUser: DiscordClient["getDirectMessageUser"]
  listDirectMessages: DiscordClient["listDirectMessages"]
}

export interface DirectMessageServiceOptions {
  activityStore: ActivityStore
  attachmentMaxBytes?: number
  attachmentRoots?: readonly string[]
  client: DirectMessageServiceClient
  clock?: () => Date
  limiter?: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
  verificationKey: Uint8Array
  writeCoordinator: WriteCoordinator
}

interface PlanEvidence {
  channel: DiscordDirectMessageChannelEvidence | null
  current: DirectMessageView | null
  file: AttachmentFileSnapshot | null
  recipient: DiscordDirectMessageUserEvidence
}

const REVIEW_REASON_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const MESSAGE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const ATTACHMENT_DESCRIPTION_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const ATTACHMENT_FILENAME_CONTROL_OR_SEPARATOR_PATTERN = /[\\/\u0000-\u001F\u007F]/u
const DISCORD_MESSAGE_FLAGS_MAX = 0xFFFF_FFFF
const SUPPORTED_MESSAGE_TYPES: Readonly<Record<number, DirectMessageType>> = Object.freeze({
  [DISCORD_MESSAGE_TYPES.chatInputCommand]: "chat-input-command",
  [DISCORD_MESSAGE_TYPES.contextMenuCommand]: "context-menu-command",
  [DISCORD_MESSAGE_TYPES.default]: "default",
  [DISCORD_MESSAGE_TYPES.reply]: "reply",
})
const PRIVACY = Object.freeze({
  omittedFields: Object.freeze([
    "attachment-bytes",
    "attachment-urls",
    "avatars",
    "generated-component-ids",
    "local-file-paths",
    "profile-names",
    "raw-discord-objects",
    "raw-operation-key",
  ] as const),
  persistence: "content-free-records-only" as const,
})
const MENTION_POLICY = Object.freeze({
  parse: Object.freeze([]) as readonly [],
  repliedUser: false as const,
  roles: Object.freeze([]) as readonly [],
  users: Object.freeze([]) as readonly [],
})
const UNAVAILABLE_PLAN_DIGEST =
  "hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000"

function exactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(record).sort()
  const normalized = [...expected].sort()
  return actual.length === normalized.length
    && actual.every((key, index) => key === normalized[index])
}

function exactOptionalKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => allowed.has(key))
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${name} must be a positive Discord snowflake ID`)
  }
}

function assertValidUnicode(value: string, name: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0xD800 || code > 0xDFFF) continue
    const next = value.charCodeAt(index + 1)
    if (code <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      index += 1
      continue
    }
    throw new RangeError(`${name} contains invalid Unicode`)
  }
}

function normalizeReviewReason(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.directMessageReviewReasonCharacters
    || value.trim() !== value
    || REVIEW_REASON_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord direct-message review reason must contain 1-${CONNECTOR_LIMITS.directMessageReviewReasonCharacters} trimmed characters without controls`,
    )
  }
  assertValidUnicode(value, "Discord direct-message review reason")
  return value
}

function normalizeBase(record: Record<string, unknown>) {
  assertSnowflake(record.recipientId, "Discord direct-message recipient ID")
  return {
    operationKeyHash: operationKeyHash(record.operationKey as string),
    recipientId: record.recipientId,
    reviewReason: normalizeReviewReason(record.reviewReason),
  }
}

function normalizedAttachmentFilename(
  filePath: string,
  value: unknown,
): string {
  const filename = value === undefined ? basename(filePath) : value
  if (
    typeof filename !== "string"
    || filename.length < 1
    || filename.length > DISCORD_LIMITS.attachmentFilenameCharacters
    || filename.trim() !== filename
    || filename === "."
    || filename === ".."
    || ATTACHMENT_FILENAME_CONTROL_OR_SEPARATOR_PATTERN.test(filename)
  ) {
    throw new RangeError("Discord direct-message attachment filename is invalid")
  }
  assertValidUnicode(filename, "Discord direct-message attachment filename")
  return filename
}

function normalizedAttachmentDescription(value: unknown): string | null {
  if (value === undefined) return null
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > DISCORD_LIMITS.attachmentDescriptionCharacters
    || ATTACHMENT_DESCRIPTION_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord direct-message attachment description must contain 1-${DISCORD_LIMITS.attachmentDescriptionCharacters} characters without unsupported controls`,
    )
  }
  assertValidUnicode(value, "Discord direct-message attachment description")
  return value
}

function normalizeDirectMessageAttachmentBody(
  record: Record<string, unknown>,
): NormalizedDirectMessageAttachmentBody {
  if (
    !exactOptionalKeys(
      record,
      ["filePath", "kind"],
      ["content", "description", "filename"],
    )
    || typeof record.filePath !== "string"
    || record.filePath.length < 1
    || record.filePath.length > CONNECTOR_LIMITS.attachmentPathCharacters
    || record.filePath.trim() !== record.filePath
    || record.filePath.includes("\0")
    || !isAbsolute(record.filePath)
  ) {
    throw new RangeError(
      "Discord direct-message attachment body requires one exact absolute file path and optional content metadata",
    )
  }
  assertValidUnicode(record.filePath, "Discord direct-message attachment path")
  const content = record.content ?? null
  if (content !== null) {
    if (typeof content !== "string") {
      throw new RangeError("Discord direct-message attachment content must be text")
    }
    assertDiscordMessageContent(content)
  }
  return {
    content,
    description: normalizedAttachmentDescription(record.description),
    filePath: record.filePath,
    filename: normalizedAttachmentFilename(record.filePath, record.filename),
    kind: "attachment",
  }
}

function normalizeDirectMessageBody(
  value: unknown,
): NormalizedDirectMessageBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord direct-message body must be an exact object")
  }
  const record = value as Record<string, unknown>
  if (record.kind === "attachment") {
    return normalizeDirectMessageAttachmentBody(record)
  }
  if (record.kind === "text") {
    if (
      !exactKeys(record, ["content", "kind"])
      || typeof record.content !== "string"
    ) {
      throw new RangeError(
        "Discord direct-message text body requires exact kind and content",
      )
    }
    assertDiscordMessageContent(record.content)
    return { content: record.content, kind: "text" }
  }
  if (record.kind === "components-v2") {
    if (!exactKeys(record, ["components", "kind"])) {
      throw new RangeError(
        "Discord direct-message Components V2 body requires exact kind and components",
      )
    }
    const layout = reviewComponentLayout(record.components, []).layout
    if (componentLayoutHasRequestButtons(layout)) {
      throw new RangeError(
        "Discord direct-message Components V2 cannot contain request buttons",
      )
    }
    return {
      components: layout,
      kind: "components-v2",
    }
  }
  throw new RangeError(
    "Discord direct-message body kind must be attachment, text, or components-v2",
  )
}

export function normalizeDirectMessageChangeRequest(
  request: DirectMessageChangeRequest,
): NormalizedDirectMessageChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord direct-message request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (record.action === "send") {
    if (
      !exactKeys(record, [
        "acknowledgeExpectedRecipientContact",
        "action",
        "message",
        "operationKey",
        "recipientId",
        "reviewReason",
      ])
      || record.acknowledgeExpectedRecipientContact !== true
    ) {
      throw new RangeError(
        "Discord direct-message send requires exact body, recipient, operation, review, and contact acknowledgement",
      )
    }
    return {
      ...normalizeBase(record),
      acknowledgeExpectedRecipientContact: true,
      action: "send",
      message: normalizeDirectMessageBody(record.message),
    }
  }
  if (record.action === "reply") {
    if (
      !exactKeys(record, [
        "acknowledgeExpectedRecipientContact",
        "action",
        "channelId",
        "message",
        "operationKey",
        "recipientId",
        "replyToMessageId",
        "reviewReason",
      ])
      || record.acknowledgeExpectedRecipientContact !== true
    ) {
      throw new RangeError(
        "Discord direct-message reply requires exact body, identities, operation, review, and contact acknowledgement",
      )
    }
    assertSnowflake(record.channelId, "Discord direct-message channel ID")
    assertSnowflake(record.replyToMessageId, "Discord direct-message reply target ID")
    return {
      ...normalizeBase(record),
      acknowledgeExpectedRecipientContact: true,
      action: "reply",
      channelId: record.channelId,
      message: normalizeDirectMessageBody(record.message),
      replyToMessageId: record.replyToMessageId,
    }
  }
  if (record.action === "edit") {
    if (
      !exactKeys(record, [
        "action",
        "channelId",
        "message",
        "messageId",
        "operationKey",
        "recipientId",
        "reviewReason",
      ])
    ) {
      throw new RangeError(
        "Discord direct-message edit requires exact body, identities, operation, and review",
      )
    }
    assertSnowflake(record.channelId, "Discord direct-message channel ID")
    assertSnowflake(record.messageId, "Discord direct-message message ID")
    const message = normalizeDirectMessageBody(record.message)
    if (message.kind === "attachment") {
      throw new RangeError(
        "Discord direct-message attachment bodies are valid only for send and reply",
      )
    }
    return {
      ...normalizeBase(record),
      action: "edit",
      channelId: record.channelId,
      message,
      messageId: record.messageId,
    }
  }
  if (record.action === "delete") {
    if (
      !exactKeys(record, [
        "acknowledgeIrreversibleDeletion",
        "action",
        "channelId",
        "messageId",
        "operationKey",
        "recipientId",
        "reviewReason",
      ])
      || record.acknowledgeIrreversibleDeletion !== true
    ) {
      throw new RangeError(
        "Discord direct-message deletion requires exact identities, operation, review, and irreversible acknowledgement",
      )
    }
    assertSnowflake(record.channelId, "Discord direct-message channel ID")
    assertSnowflake(record.messageId, "Discord direct-message message ID")
    return {
      ...normalizeBase(record),
      acknowledgeIrreversibleDeletion: true,
      action: "delete",
      channelId: record.channelId,
      messageId: record.messageId,
    }
  }
  throw new RangeError(
    "Discord direct-message action must be send, reply, edit, or delete",
  )
}

export function directMessageVerificationKey(token: string): Uint8Array {
  if (typeof token !== "string" || !token.trim()) {
    throw new RangeError(
      "Discord direct-message verification requires a non-empty secret",
    )
  }
  return createHmac("sha256", token)
    .update("discord-mcp-direct-message-verification-key.v1\0")
    .digest()
}

export function directMessageRequestDigest(
  key: Uint8Array,
  applicationId: string,
  botId: string,
  request: NormalizedDirectMessageChangeRequest,
): string {
  assertSnowflake(applicationId, "Discord connector application ID")
  assertSnowflake(botId, "Discord connector bot ID")
  return reviewedPlanDigest(key, {
    applicationId,
    botId,
    domain: "discord-mcp-direct-message-request.v3",
    request,
  })
}

function matchingDigest(left: string, right: string): boolean {
  if (
    !REVIEWED_PLAN_DIGEST_PATTERN.test(left)
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(right)
  ) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

function collectionCount(value: unknown, name: string): number {
  if (value === undefined) return 0
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelMessages) {
    throw new DirectMessageEvidenceError(
      `Discord direct-message ${name} evidence is invalid`,
    )
  }
  return value.length
}

function projectSingleAttachment(
  value: unknown,
): NonNullable<DirectMessageView["attachment"]> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message attachment evidence is not singular",
    )
  }
  const attachment = value[0]
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message attachment evidence is invalid",
    )
  }
  const record = attachment as Record<string, unknown>
  try {
    assertSnowflake(record.id, "Discord direct-message attachment ID")
  } catch {
    throw new DirectMessageEvidenceError(
      "Discord direct-message attachment identity is invalid",
    )
  }
  if (
    typeof record.filename !== "string"
    || record.filename.length < 1
    || record.filename.length > DISCORD_LIMITS.attachmentFilenameCharacters
    || record.filename.trim() !== record.filename
    || record.filename === "."
    || record.filename === ".."
    || ATTACHMENT_FILENAME_CONTROL_OR_SEPARATOR_PATTERN.test(record.filename)
    || !Number.isSafeInteger(record.size)
    || (record.size as number) < 1
    || (record.size as number) > DISCORD_LIMITS.attachmentBytes
    || !(
      record.description === undefined
      || record.description === null
      || typeof record.description === "string"
        && record.description.length > 0
        && record.description.length <= DISCORD_LIMITS.attachmentDescriptionCharacters
        && Boolean(record.description.trim())
        && !ATTACHMENT_DESCRIPTION_CONTROL_PATTERN.test(record.description)
    )
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message attachment metadata is invalid",
    )
  }
  try {
    assertValidUnicode(record.filename, "Discord direct-message attachment filename")
    if (typeof record.description === "string") {
      assertValidUnicode(record.description, "Discord direct-message attachment description")
    }
  } catch {
    throw new DirectMessageEvidenceError(
      "Discord direct-message attachment metadata is invalid",
    )
  }
  return {
    description: typeof record.description === "string" ? record.description : null,
    filename: record.filename,
    id: record.id as string,
    sizeBytes: record.size as number,
  }
}

function projectedMessageType(value: unknown): DirectMessageType {
  if (typeof value !== "number" || SUPPORTED_MESSAGE_TYPES[value] === undefined) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message type is unsupported",
    )
  }
  return SUPPORTED_MESSAGE_TYPES[value]
}

function projectedReplyTarget(
  message: DiscordMessage,
  channelId: string,
  type: DirectMessageType,
): string | null {
  const reference = message.message_reference
  if (type !== "reply") {
    if (reference !== undefined) {
      throw new DirectMessageEvidenceError(
        "Discord direct-message reference is unsupported for this message type",
      )
    }
    return null
  }
  if (
    !reference
    || reference.type !== undefined
      && reference.type !== DISCORD_MESSAGE_REFERENCE_TYPES.default
    || reference.channel_id !== undefined && reference.channel_id !== channelId
    || reference.guild_id !== undefined
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message reply reference is invalid",
    )
  }
  assertSnowflake(
    reference.message_id,
    "Discord direct-message reply target ID",
  )
  return reference.message_id
}

function validateReadContent(content: unknown): asserts content is string {
  if (
    typeof content !== "string"
    || content.length > DISCORD_LIMITS.messageContentCharacters
    || MESSAGE_CONTROL_PATTERN.test(content)
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message content evidence is invalid",
    )
  }
  try {
    assertValidUnicode(content, "Discord direct-message content")
  } catch {
    throw new DirectMessageEvidenceError(
      "Discord direct-message content evidence is invalid",
    )
  }
}

function projectDirectMessage(
  message: DiscordMessage,
  channelId: string,
  botId: string,
  recipientId: string,
  expectedMessageId?: string,
): DirectMessageView {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new DirectMessageEvidenceError(
      "Discord returned invalid direct-message evidence",
    )
  }
  assertSnowflake(message.id, "Discord direct-message message ID")
  if (
    message.channel_id !== channelId
    || expectedMessageId !== undefined && message.id !== expectedMessageId
    || message.guild_id !== undefined
    || message.webhook_id !== undefined
    || !message.author
    || typeof message.author !== "object"
  ) {
    throw new DirectMessageEvidenceError(
      "Discord returned a message outside the exact direct-message boundary",
    )
  }
  const authorId = message.author.id
  const author = authorId === botId && message.author.bot === true
    ? "connector"
    : authorId === recipientId
      && message.author.bot !== true
      && message.author.system !== true
      ? "recipient"
      : null
  if (author === null) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message author is outside the two verified participants",
    )
  }
  validateReadContent(message.content)
  if (
    typeof message.timestamp !== "string"
    || Number.isNaN(Date.parse(message.timestamp))
    || !(
      message.edited_timestamp === undefined
      || message.edited_timestamp === null
      || typeof message.edited_timestamp === "string"
        && !Number.isNaN(Date.parse(message.edited_timestamp))
    )
    || message.poll !== undefined
    || message.call !== undefined
    || message.activity !== undefined
    || !(message.pinned === undefined || typeof message.pinned === "boolean")
    || !(message.tts === undefined || typeof message.tts === "boolean")
    || collectionCount(message.message_snapshots, "snapshot") > 0
    || (
      message.flags !== undefined
      && (
        !Number.isSafeInteger(message.flags)
        || message.flags < 0
        || message.flags > DISCORD_MESSAGE_FLAGS_MAX
        || (message.flags & DISCORD_MESSAGE_FLAGS.hasSnapshot) !== 0
      )
    )
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message state is unsupported or malformed",
    )
  }
  const type = projectedMessageType(message.type)
  const attachmentCount = collectionCount(message.attachments, "attachment")
  const componentCount = collectionCount(message.components, "component")
  const embedCount = collectionCount(message.embeds, "embed")
  const flags = message.flags ?? 0
  const stickerCount = Math.max(
    collectionCount(message.sticker_items, "sticker item"),
    collectionCount(message.stickers, "legacy sticker"),
  )
  const mentionEveryone = message.mention_everyone === true
  const mentionedRoleCount = collectionCount(message.mention_roles, "role mention")
  const mentionedUserCount = collectionCount(message.mentions, "user mention")
  const pinned = message.pinned ?? false
  const reactionCount = collectionCount(message.reactions, "reaction")
  let componentLayout: NormalizedComponentLayout | null = null
  let componentPreview: string | null = null
  let attachment: DirectMessageView["attachment"] = null
  let presentation: DirectMessagePresentation = "unsupported-rich"
  if (
    flags === DISCORD_MESSAGE_FLAGS.isComponentsV2
    && message.content === ""
    && attachmentCount === 0
    && componentCount > 0
    && embedCount === 0
    && stickerCount === 0
    && message.tts !== true
  ) {
    try {
      componentLayout = parseDiscordComponentLayout(message.components)
      componentPreview = reviewComponentLayout(componentLayout, []).preview
      presentation = "static-components-v2"
    } catch {
      componentLayout = null
      componentPreview = null
    }
  } else if (
    flags === 0
    && attachmentCount === 1
    && componentCount === 0
    && embedCount === 0
    && !mentionEveryone
    && mentionedRoleCount === 0
    && mentionedUserCount === 0
    && !pinned
    && reactionCount === 0
    && stickerCount === 0
    && message.tts !== true
  ) {
    try {
      attachment = projectSingleAttachment(message.attachments)
      presentation = "single-attachment"
    } catch {
      attachment = null
    }
  } else if (
    (flags & DISCORD_MESSAGE_FLAGS.isComponentsV2) === 0
    && message.content.trim().length > 0
    && attachmentCount === 0
    && componentCount === 0
    && embedCount === 0
    && stickerCount === 0
    && message.tts !== true
  ) {
    presentation = "text"
  }
  return {
    attachment,
    attachmentCount,
    author,
    authorId,
    channelId,
    componentCount,
    componentLayout,
    componentPreview,
    content: message.content,
    editedTimestamp: message.edited_timestamp ?? null,
    embedCount,
    flags,
    id: message.id,
    mentionEveryone,
    mentionedRoleCount,
    mentionedUserCount,
    pinned,
    presentation,
    reactionCount,
    replyToMessageId: projectedReplyTarget(message, channelId, type),
    stickerCount,
    timestamp: message.timestamp,
    type,
  }
}

function messageMatchesBody(
  message: DirectMessageView,
  body: NormalizedDirectMessageBody,
  replyToMessageId: string | null,
  attachmentSizeBytes: number | null = null,
): boolean {
  const bodyMatches = body.kind === "text"
    ? message.presentation === "text"
      && message.flags === 0
      && message.content === body.content
      && message.componentLayout === null
    : body.kind === "components-v2"
      ? message.presentation === "static-components-v2"
        && message.flags === DISCORD_MESSAGE_FLAGS.isComponentsV2
        && message.content === ""
        && message.componentLayout !== null
        && componentLayoutsEqual(message.componentLayout, body.components)
      : message.presentation === "single-attachment"
        && message.flags === 0
        && message.content === (body.content ?? "")
        && message.componentLayout === null
        && message.attachment !== null
        && message.attachment.filename === body.filename
        && message.attachment.description === body.description
        && message.attachment.sizeBytes === attachmentSizeBytes
  return bodyMatches
    && message.author === "connector"
    && message.replyToMessageId === replyToMessageId
    && message.attachmentCount === (body.kind === "attachment" ? 1 : 0)
    && message.embedCount === 0
    && !message.mentionEveryone
    && message.mentionedRoleCount === 0
    && message.mentionedUserCount === 0
    && !message.pinned
    && message.reactionCount === 0
    && message.stickerCount === 0
    && message.type === (replyToMessageId === null ? "default" : "reply")
}

function presentationForBody(
  body: NormalizedDirectMessageBody,
): DirectMessagePresentation {
  return body.kind === "text"
    ? "text"
    : body.kind === "components-v2"
      ? "static-components-v2"
      : "single-attachment"
}

function assertEditableBotMessage(
  message: DirectMessageView,
  body: NormalizedDirectMessageEditableBody,
): void {
  if (
    message.author !== "connector"
    || !["default", "reply"].includes(message.type)
    || message.attachmentCount !== 0
    || message.embedCount !== 0
    || message.flags !== (body.kind === "text"
      ? 0
      : DISCORD_MESSAGE_FLAGS.isComponentsV2)
    || message.mentionEveryone
    || message.mentionedRoleCount !== 0
    || message.mentionedUserCount !== 0
    || message.pinned
    || message.presentation !== presentationForBody(body)
    || message.reactionCount !== 0
    || message.stickerCount !== 0
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message edit requires an exact same-format connector-authored message",
    )
  }
}

function assertDeletableBotMessage(message: DirectMessageView): void {
  const attachment = message.presentation === "single-attachment"
  if (
    message.author !== "connector"
    || !["default", "reply"].includes(message.type)
    || !["single-attachment", "static-components-v2", "text"].includes(
      message.presentation,
    )
    || message.attachmentCount !== (attachment ? 1 : 0)
    || attachment !== (message.attachment !== null)
    || message.embedCount !== 0
    || message.flags !== (message.presentation === "text"
      ? 0
      : message.presentation === "static-components-v2"
        ? DISCORD_MESSAGE_FLAGS.isComponentsV2
        : 0)
    || message.mentionEveryone
    || message.mentionedRoleCount !== 0
    || message.mentionedUserCount !== 0
    || message.pinned
    || message.reactionCount !== 0
    || message.stickerCount !== 0
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message deletion requires an exact supported connector-authored message",
    )
  }
}

function assertPinnedIdentity(
  application: DiscordApplication,
  user: DiscordUser,
  applicationId: string,
  botId: string,
): void {
  if (
    !application
    || typeof application !== "object"
    || application.id !== applicationId
    || application.bot?.id !== undefined && application.bot.id !== botId
    || !user
    || typeof user !== "object"
    || user.id !== botId
    || user.bot !== true
  ) {
    throw new DirectMessageEvidenceError(
      "Discord returned evidence for a different connector identity",
    )
  }
}

function assertEligibleRecipient(
  recipient: DiscordDirectMessageUserEvidence,
  recipientId: string,
): void {
  if (
    recipient.id !== recipientId
    || recipient.bot
    || recipient.system
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message recipient is not an eligible ordinary user",
    )
  }
}

function directMessageOperationStore(
  store: OperationStore,
): DirectMessageOperationStore {
  if (
    !store.checkpointDirectMessage
    || !store.finishDirectMessage
    || !store.getDirectMessage
    || !store.reserveDirectMessage
  ) {
    throw new DirectMessageExecutionError(
      "Discord direct messages require a direct-message operation store",
      { status: "blocked-operation-store-incompatible" },
    )
  }
  return store as DirectMessageOperationStore
}

function directMessageNonce(
  request: NormalizedDirectMessageChangeRequest,
  channelId: string,
): string {
  return createHash("sha256")
    .update("discord-mcp-direct-message-nonce.v3\0")
    .update(request.action)
    .update("\0")
    .update(request.recipientId)
    .update("\0")
    .update(channelId)
    .update("\0")
    .update(request.operationKeyHash)
    .digest("base64url")
    .slice(0, DISCORD_LIMITS.messageNonceCharacters)
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function receiptView(receipt: DirectMessageOperationReceipt) {
  return {
    action: receipt.action,
    activityId: receipt.activityId,
    attachmentSizeBytes: receipt.attachmentSizeBytes,
    channelId: receipt.channelId,
    error: receipt.error,
    messageFormat: receipt.messageFormat,
    messageId: receipt.messageId,
    operationKeyHash: receipt.operationKeyHash,
    planDigest: receipt.planDigest,
    recipientId: receipt.recipientId,
    replyToMessageId: receipt.replyToMessageId,
    stage: receipt.stage,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function requestMessageFormat(
  request: NormalizedDirectMessageChangeRequest,
): DirectMessageFormat | null {
  return request.action === "delete" ? null : request.message.kind
}

function directMessageBodyPreview(
  body: NormalizedDirectMessageBody,
): string | null {
  return body.kind !== "components-v2"
    ? null
    : reviewComponentLayout(body.components, []).preview
}

function requestChannelId(
  request: NormalizedDirectMessageChangeRequest,
): string | null {
  return request.action === "send" ? null : request.channelId
}

function requestMessageId(
  request: NormalizedDirectMessageChangeRequest,
): string | null {
  return request.action === "edit" || request.action === "delete"
    ? request.messageId
    : null
}

function operationReceipt(options: {
  activityId: string
  channelId?: string | null
  error?: string | null
  messageId?: string | null
  plan: DirectMessagePlan
  request: NormalizedDirectMessageChangeRequest
  requestDigest: string
  stage: DirectMessageReceiptStage
  status: DirectMessageOperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): DirectMessageOperationReceipt {
  const attachmentSizeBytes = options.request.action !== "delete"
    && options.request.message.kind === "attachment"
      ? options.plan.file?.sizeBytes ?? null
      : null
  if (
    options.request.action !== "delete"
    && options.request.message.kind === "attachment"
    && attachmentSizeBytes === null
  ) {
    throw new DirectMessageEvidenceError(
      "Discord direct-message receipt lacks reviewed attachment size evidence",
    )
  }
  return {
    action: options.request.action,
    activityId: options.activityId,
    attachmentSizeBytes,
    channelId: options.channelId === undefined
      ? requestChannelId(options.request)
      : options.channelId,
    error: options.error ?? null,
    kind: "direct-message-change",
    messageFormat: requestMessageFormat(options.request),
    messageId: options.messageId === undefined
      ? requestMessageId(options.request)
      : options.messageId,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    recipientId: options.request.recipientId,
    replyToMessageId: options.request.action === "reply"
      ? options.request.replyToMessageId
      : options.request.action === "edit"
        ? options.plan.current?.replyToMessageId ?? null
        : null,
    requestDigest: options.requestDigest,
    schemaVersion: 2,
    stage: options.stage,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function activityEntry(
  receipt: DirectMessageOperationReceipt,
): DirectMessageActivity {
  return {
    action: receipt.action,
    channelId: receipt.channelId,
    error: receipt.error,
    id: receipt.activityId,
    kind: "direct-message-change",
    messageFormat: receipt.messageFormat,
    messageId: receipt.messageId,
    operationKeyHash: receipt.operationKeyHash,
    planDigest: receipt.planDigest,
    recipientId: receipt.recipientId,
    replyToMessageId: receipt.replyToMessageId,
    requestDigest: receipt.requestDigest,
    schemaVersion: SCHEMA_VERSION,
    stage: receipt.stage,
    status: receipt.status as DirectMessageActivityStatus,
    timestamp: receipt.timestamp,
    verification: receipt.verification === "match" ? "match" : null,
  }
}

function knownFailure(error: unknown): boolean {
  return error instanceof DiscordApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 429
}

export class DirectMessageService {
  readonly #activityStore: ActivityStore
  readonly #attachmentMaxBytes: number
  readonly #attachmentRoots: readonly string[]
  readonly #client: DirectMessageServiceClient
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #operationStore: DirectMessageOperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string
  readonly #verificationKey: Uint8Array
  readonly #writeCoordinator: WriteCoordinator

  constructor(options: DirectMessageServiceOptions) {
    this.#activityStore = options.activityStore
    this.#attachmentMaxBytes = options.attachmentMaxBytes
      ?? DISCORD_LIMITS.attachmentBytes
    this.#attachmentRoots = options.attachmentRoots ?? []
    if (
      !Number.isSafeInteger(this.#attachmentMaxBytes)
      || this.#attachmentMaxBytes < 1
      || this.#attachmentMaxBytes > DISCORD_LIMITS.attachmentBytes
    ) {
      throw new RangeError(
        "Discord direct-message attachment byte limit is invalid",
      )
    }
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#limiter = options.limiter ?? new InteractionLimiter({
      maxWritesPerMinute: CONNECTOR_LIMITS.directMessageMaxWritesPerMinute,
      minWriteIntervalMs: CONNECTOR_LIMITS.directMessageMinWriteIntervalMs,
    })
    this.#operationStore = directMessageOperationStore(options.operationStore)
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
    this.#verificationKey = options.verificationKey
    this.#writeCoordinator = options.writeCoordinator
  }

  #assertActionPolicy(request: NormalizedDirectMessageChangeRequest): void {
    if (
      request.action !== "delete"
      && request.message.kind === "components-v2"
    ) {
      this.#policy.assertComponentLinkOrigins(
        reviewComponentLayout(request.message.components, []).linkOrigins,
      )
    }
    if (request.action === "send" || request.action === "reply") {
      if (request.message.kind === "attachment") {
        this.#policy.assertDirectMessageAttachmentAllowed(request.recipientId)
      } else {
        this.#policy.assertDirectMessageDeliveryAllowed(request.recipientId)
      }
    } else if (request.action === "edit") {
      this.#policy.assertDirectMessageEditingAllowed(request.recipientId)
    } else {
      this.#policy.assertDirectMessageDeletionAllowed(request.recipientId)
    }
  }

  #file(
    request: NormalizedDirectMessageChangeRequest,
  ): Promise<AttachmentFileSnapshot | null> {
    if (
      request.action === "delete"
      || request.message.kind !== "attachment"
    ) return Promise.resolve(null)
    return readDirectAttachmentFileSnapshot({
      filePath: request.message.filePath,
      maxBytes: this.#attachmentMaxBytes,
      planKey: this.#planKey,
      roots: this.#attachmentRoots,
    })
  }

  async #identity(
    applicationId: string,
    botId: string,
    options: RequestOptions,
  ): Promise<void> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const application = await this.#client.getCurrentApplication(options)
    const user = await this.#client.getCurrentUser(options)
    assertPinnedIdentity(application, user, applicationId, botId)
  }

  async #channel(
    recipientId: string,
    channelId: string,
    options: RequestOptions,
  ): Promise<DiscordDirectMessageChannelEvidence> {
    const channel = await this.#client.getDirectMessageChannel(
      channelId,
      recipientId,
      options,
    )
    assertEligibleRecipient(channel.recipient, recipientId)
    return channel
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedDirectMessageChangeRequest,
    options: RequestOptions,
  ): Promise<{ evidence: PlanEvidence; plan: DirectMessagePlan }> {
    this.#assertActionPolicy(request)
    await this.#identity(applicationId, botId, options)
    let channel: DiscordDirectMessageChannelEvidence | null = null
    let current: DirectMessageView | null = null
    let file: AttachmentFileSnapshot | null = null
    let recipient: DiscordDirectMessageUserEvidence
    if (request.action === "send") {
      const evidence = await Promise.all([
        this.#client.getDirectMessageUser(
          request.recipientId,
          options,
        ),
        this.#file(request),
      ])
      recipient = evidence[0]
      file = evidence[1]
      assertEligibleRecipient(recipient, request.recipientId)
    } else {
      channel = await this.#channel(
        request.recipientId,
        request.channelId,
        options,
      )
      recipient = channel.recipient
      const targetId = request.action === "reply"
        ? request.replyToMessageId
        : request.messageId
      const [message, fileSnapshot] = await Promise.all([
        this.#client.getDirectMessage(
          request.channelId,
          targetId,
          options,
        ),
        this.#file(request),
      ])
      file = fileSnapshot
      current = projectDirectMessage(
        message,
        request.channelId,
        botId,
        request.recipientId,
        targetId,
      )
      if (request.action === "edit") {
        assertEditableBotMessage(current, request.message)
      } else if (request.action === "delete") {
        assertDeletableBotMessage(current)
      }
    }
    const effect = request.action === "edit"
      && current !== null
      && messageMatchesBody(
        current,
        request.message,
        current.replyToMessageId,
      )
        ? "none"
        : "change"
    const desiredMessage = request.action === "delete" ? null : request.message
    const desiredComponentReview = desiredMessage?.kind === "components-v2"
      ? reviewComponentLayout(desiredMessage.components, [])
      : null
    const desiredPreview = desiredMessage === null
      ? null
      : directMessageBodyPreview(desiredMessage)
    const desiredReply = request.action === "reply"
      ? request.replyToMessageId
      : request.action === "edit"
        ? current?.replyToMessageId ?? null
        : null
    const risks = [
      "The operation affects a private conversation with one exact configured user",
      "Exact recipient scope verifies connector policy but does not prove consent or prior contact",
      "Discord direct-message mutations are never retried automatically",
    ]
    if (request.action === "delete") {
      risks.push("Deletion is irreversible and the connector performs no rollback")
    }
    const warnings = [
      "Message text, component layouts, link destinations, file paths, attachment metadata, previews, and review text are transient and never enter durable records",
      "All mentions are suppressed, including reply-author notifications",
      "A 429 or ambiguous transport outcome quarantines the exact operation for review",
    ]
    if (request.action === "send") {
      warnings.push(
        "Planning does not open a DM channel; approved execution may create one before sending",
      )
    }
    if (
      request.action !== "delete"
      && request.message.kind === "components-v2"
    ) {
      warnings.push(
        "Components V2 is irreversible for each created private message and same-format edits cannot remove it",
        ...(desiredComponentReview !== null && desiredComponentReview.linkUrls.length > 0
          ? [
              "Link buttons use exact configured HTTPS origins, open externally, and grant no callback authority",
              "The connector does not fetch links or verify redirects or final destinations",
              "The static layout registers no custom-ID button, select, modal, media, file, or callback authority",
            ]
          : ["The static layout registers no button, select, modal, media, file, or callback authority"]),
      )
    }
    if (
      request.action !== "delete"
      && request.message.kind === "attachment"
    ) {
      risks.push(
        "The operation discloses the exact reviewed local file bytes, filename, and optional description to Discord and one private recipient",
      )
      warnings.push(
        "Execution uploads one fresh in-memory file snapshot and never retries or rolls back the multipart request",
        "Discord exposes no remote attachment content digest, so restart verification compares receipt-bound metadata without downloading the file",
      )
    }
    let plannedFile: DirectMessagePlan["file"] = null
    if (file !== null) {
      if (
        request.action === "delete"
        || request.message.kind !== "attachment"
      ) {
        throw new DirectMessageEvidenceError(
          "Discord direct-message file evidence does not match the requested body",
        )
      }
      plannedFile = {
        ...file.review,
        description: request.message.description,
        filename: request.message.filename,
        maxBytes: this.#attachmentMaxBytes,
      }
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      channel,
      current,
      desired: {
        linkOrigins: desiredComponentReview?.linkOrigins ?? [],
        linkUrls: desiredComponentReview?.linkUrls ?? [],
        message: desiredMessage,
        preview: desiredPreview,
        replyToMessageId: desiredReply,
      },
      domain: "discord-mcp-direct-message-plan.v3",
      effect,
      file: file === null
        ? null
        : {
            binding: file.binding,
            contentDigest: file.contentDigest,
            review: file.review,
          },
      mentionPolicy: MENTION_POLICY,
      rateLimit: {
        globalWritesPerMinute: CONNECTOR_LIMITS.directMessageMaxWritesPerMinute,
        minimumRecipientIntervalMs: CONNECTOR_LIMITS.directMessageMinWriteIntervalMs,
      },
      recipient,
      request,
      risks,
      warnings,
    })
    const plan: DirectMessagePlan = {
      action: request.action,
      applicationId,
      botId,
      channel: channel === null
        ? null
        : {
            exactOneToOne: true,
            id: channel.id,
            unknownFieldCount: channel.unknownFieldCount,
          },
      createdAt: this.#clock().toISOString(),
      current,
      desired: {
        linkOrigins: desiredComponentReview?.linkOrigins ?? [],
        linkUrls: desiredComponentReview?.linkUrls ?? [],
        message: desiredMessage,
        preview: desiredPreview,
        replyToMessageId: desiredReply,
      },
      digest,
      effect,
      file: plannedFile,
      mentionPolicy: MENTION_POLICY,
      operationKeyHash: request.operationKeyHash,
      privacy: PRIVACY,
      rateLimit: {
        globalWritesPerMinute: CONNECTOR_LIMITS.directMessageMaxWritesPerMinute,
        minimumRecipientIntervalMs: CONNECTOR_LIMITS.directMessageMinWriteIntervalMs,
      },
      recipient: {
        bot: false,
        eligible: true,
        id: recipient.id,
        system: false,
        unknownFieldCount: recipient.unknownFieldCount,
      },
      reviewReason: request.reviewReason,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: effect === "none" ? "already-current" : "planned",
      warnings,
      writeRequired: effect === "change",
    }
    return { evidence: { channel, current, file, recipient }, plan }
  }

  async list(
    applicationId: string,
    botId: string,
    recipientId: string,
    channelId: string,
    options: {
      beforeMessageId?: string
      limit?: number
      request?: RequestOptions
    } = {},
  ): Promise<DirectMessagePage> {
    assertSnowflake(recipientId, "Discord direct-message recipient ID")
    assertSnowflake(channelId, "Discord direct-message channel ID")
    if (options.beforeMessageId !== undefined) {
      assertSnowflake(
        options.beforeMessageId,
        "Discord direct-message history cursor",
      )
    }
    const limit = options.limit ?? CONNECTOR_LIMITS.directMessagePageDefault
    if (
      !Number.isInteger(limit)
      || limit < 1
      || limit > CONNECTOR_LIMITS.directMessagePage
    ) {
      throw new RangeError(
        `Discord direct-message page limit must be 1-${CONNECTOR_LIMITS.directMessagePage}`,
      )
    }
    this.#policy.assertDirectMessageAuditAllowed(recipientId)
    await this.#identity(applicationId, botId, options.request ?? {})
    await this.#channel(recipientId, channelId, options.request ?? {})
    const messages = await this.#client.listDirectMessages(channelId, {
      ...options.request,
      ...(options.beforeMessageId === undefined
        ? {}
        : { before: options.beforeMessageId }),
      limit,
    })
    if (!Array.isArray(messages) || messages.length > limit) {
      throw new DirectMessageEvidenceError(
        "Discord returned an invalid direct-message history page",
      )
    }
    const projected = messages.map((message) => projectDirectMessage(
      message,
      channelId,
      botId,
      recipientId,
    ))
    return {
      channelId,
      messages: projected,
      nextBeforeMessageId: projected.length === limit
        ? projected.at(-1)?.id ?? null
        : null,
      recipientId,
      schemaVersion: SCHEMA_VERSION,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    recipientId: string,
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DirectMessageView> {
    assertSnowflake(recipientId, "Discord direct-message recipient ID")
    assertSnowflake(channelId, "Discord direct-message channel ID")
    assertSnowflake(messageId, "Discord direct-message message ID")
    this.#policy.assertDirectMessageAuditAllowed(recipientId)
    await this.#identity(applicationId, botId, options)
    await this.#channel(recipientId, channelId, options)
    return projectDirectMessage(
      await this.#client.getDirectMessage(channelId, messageId, options),
      channelId,
      botId,
      recipientId,
      messageId,
    )
  }

  async plan(
    applicationId: string,
    botId: string,
    request: DirectMessageChangeRequest,
    options: RequestOptions = {},
  ): Promise<DirectMessagePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeDirectMessageChangeRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  async #verifyReceipt(
    applicationId: string,
    botId: string,
    request: NormalizedDirectMessageChangeRequest,
    receipt: DirectMessageOperationReceipt,
    options: RequestOptions,
  ): Promise<DirectMessageVerificationResult> {
    const base = {
      action: request.action,
      activityId: receipt.activityId,
      channelId: receipt.channelId,
      messageId: receipt.messageId,
      operationKeyHash: request.operationKeyHash,
      planDigest: receipt.planDigest,
      receiptStage: receipt.stage,
      receiptStatus: receipt.status,
      recipientId: request.recipientId,
      requestMatched: true,
      schemaVersion: SCHEMA_VERSION,
      timestamp: receipt.timestamp,
    }
    if (
      receipt.action !== request.action
      || receipt.messageFormat !== requestMessageFormat(request)
      || receipt.recipientId !== request.recipientId
      || receipt.channelId !== null
        && requestChannelId(request) !== null
        && receipt.channelId !== requestChannelId(request)
      || (
        request.action === "edit" || request.action === "delete"
          ? receipt.messageId !== request.messageId
          : request.action === "reply"
            && receipt.replyToMessageId !== request.replyToMessageId
      )
    ) {
      return {
        ...base,
        readbackMatched: false,
        reason: "receipt-target-mismatch",
        status: "blocked",
      }
    }
    if (
      receipt.status === "pending"
      || receipt.status === "failed"
      || receipt.status === "uncertain"
        && (receipt.channelId === null || receipt.messageId === null)
    ) {
      return {
        ...base,
        readbackMatched: false,
        reason: receipt.status === "pending"
          ? "operation-pending"
          : receipt.status === "failed"
            ? "operation-failed"
            : "operation-uncertain",
        status: "blocked",
      }
    }
    await this.#identity(applicationId, botId, options)
    await this.#channel(
      request.recipientId,
      receipt.channelId as string,
      options,
    )
    let matched = false
    if (request.action === "delete") {
      try {
        await this.#client.getDirectMessage(
          receipt.channelId as string,
          receipt.messageId as string,
          options,
        )
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) matched = true
        else throw error
      }
    } else {
      try {
        const observed = projectDirectMessage(
          await this.#client.getDirectMessage(
            receipt.channelId as string,
            receipt.messageId as string,
            options,
          ),
          receipt.channelId as string,
          botId,
          request.recipientId,
          receipt.messageId as string,
        )
        matched = messageMatchesBody(
          observed,
          request.message,
          request.action === "reply"
            ? request.replyToMessageId
            : request.action === "edit"
              ? receipt.replyToMessageId
              : null,
          receipt.attachmentSizeBytes,
        )
      } catch (error) {
        if (!(error instanceof DiscordApiError && error.status === 404)) throw error
      }
    }
    return {
      ...base,
      readbackMatched: matched,
      reason: matched ? "verified" : "message-drifted",
      status: matched ? "verified" : "drifted",
    }
  }

  async verify(
    applicationId: string,
    botId: string,
    requestValue: DirectMessageChangeRequest,
    options: RequestOptions = {},
  ): Promise<DirectMessageVerificationResult> {
    const request = normalizeDirectMessageChangeRequest(requestValue)
    this.#assertActionPolicy(request)
    const requestDigest = directMessageRequestDigest(
      this.#verificationKey,
      applicationId,
      botId,
      request,
    )
    const receipt = await this.#operationStore.getDirectMessage(
      "direct-message-change",
      request.operationKeyHash,
    )
    const emptyBase = {
      action: request.action,
      activityId: null,
      channelId: null,
      messageId: null,
      operationKeyHash: request.operationKeyHash,
      planDigest: null,
      readbackMatched: false,
      receiptStage: null,
      receiptStatus: null,
      recipientId: request.recipientId,
      requestMatched: false,
      schemaVersion: SCHEMA_VERSION,
      timestamp: null,
    }
    if (!receipt) {
      return {
        ...emptyBase,
        reason: "operation-not-found",
        status: "not-found",
      }
    }
    if (!matchingDigest(receipt.requestDigest, requestDigest)) {
      return {
        ...emptyBase,
        receiptStage: receipt.stage,
        receiptStatus: receipt.status,
        reason: "request-mismatch",
        status: "blocked",
      }
    }
    return this.#verifyReceipt(
      applicationId,
      botId,
      request,
      receipt,
      options,
    )
  }

  async execute(
    applicationId: string,
    botId: string,
    requestValue: DirectMessageChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<DirectMessageChangeResult> {
    const request = normalizeDirectMessageChangeRequest(requestValue)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord direct-message plan digest is invalid")
    }
    this.#assertActionPolicy(request)
    const requestDigest = directMessageRequestDigest(
      this.#verificationKey,
      applicationId,
      botId,
      request,
    )
    const existing = await this.#operationStore.getDirectMessage(
      "direct-message-change",
      request.operationKeyHash,
    )
    if (existing) {
      if (!matchingDigest(existing.requestDigest, requestDigest)) {
        throw new DirectMessageOperationConflictError(receiptView(existing))
      }
      if (
        existing.status === "completed"
        && matchingDigest(existing.planDigest, expectedDigest)
      ) {
        const verification = await this.#verifyReceipt(
          applicationId,
          botId,
          request,
          existing,
          options,
        )
        if (verification.status === "verified") {
          return {
            action: request.action,
            activityId: existing.activityId,
            channelId: existing.channelId,
            messageId: existing.messageId,
            operationKeyHash: request.operationKeyHash,
            planDigest: existing.planDigest,
            recipientId: request.recipientId,
            recovered: true,
            schemaVersion: SCHEMA_VERSION,
            status: "completed",
          }
        }
      }
      throw new DirectMessageOperationConflictError(receiptView(existing))
    }
    let built: { evidence: PlanEvidence; plan: DirectMessagePlan }
    try {
      built = await this.#buildPlan(
        applicationId,
        botId,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof DirectMessageEvidenceError
        || error instanceof AttachmentFileError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new DirectMessagePlanChangedError(
          expectedDigest,
          UNAVAILABLE_PLAN_DIGEST,
        )
      }
      throw error
    }
    const { evidence, plan } = built
    if (plan.digest !== expectedDigest) {
      throw new DirectMessagePlanChangedError(expectedDigest, plan.digest)
    }
    if (plan.effect === "none") {
      return {
        action: request.action,
        activityId: null,
        channelId: requestChannelId(request),
        messageId: requestMessageId(request),
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        recipientId: request.recipientId,
        recovered: false,
        schemaVersion: SCHEMA_VERSION,
        status: "already-current",
      }
    }
    const targets = [writeResourceTarget("user", request.recipientId)]
    if (request.action !== "send") {
      targets.push(writeResourceTarget("channel", request.channelId))
      targets.push(writeResourceTarget(
        "message",
        request.action === "reply" ? request.replyToMessageId : request.messageId,
      ))
    }
    return this.#writeCoordinator.run(
      {
        kind: "direct-message-change",
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        targets,
      },
      () => this.#executeReserved(
        botId,
        request,
        requestDigest,
        plan,
        evidence.file,
        options,
      ),
    )
  }

  async #executeReserved(
    botId: string,
    request: NormalizedDirectMessageChangeRequest,
    requestDigest: string,
    plan: DirectMessagePlan,
    file: AttachmentFileSnapshot | null,
    options: RequestOptions,
  ): Promise<DirectMessageChangeResult> {
    const raced = await this.#operationStore.getDirectMessage(
      "direct-message-change",
      request.operationKeyHash,
    )
    if (raced) throw new DirectMessageOperationConflictError(receiptView(raced))
    this.#limiter.reserve(request.recipientId)
    const activityId = this.#randomId()
    const reserved = operationReceipt({
      activityId,
      plan,
      request,
      requestDigest,
      stage: "reserved",
      status: "pending",
      timestamp: this.#clock().toISOString(),
    })
    const reservation = await this.#operationStore.reserveDirectMessage(reserved)
    if (!reservation.created) {
      throw new DirectMessageOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry(reserved))
    } catch (error) {
      const failed = operationReceipt({
        activityId,
        error: safeErrorCode(error),
        plan,
        request,
        requestDigest,
        stage: "terminal",
        status: "failed",
        timestamp: this.#clock().toISOString(),
      })
      await this.#operationStore.finishDirectMessage(failed).catch(() => undefined)
      throw new DirectMessageExecutionError(
        "Discord direct-message change was blocked because pending activity could not be recorded",
        {
          action: request.action,
          activityId,
          error: safeErrorCode(error),
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          recipientId: request.recipientId,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
        },
      )
    }

    let channelId = requestChannelId(request)
    let messageId = requestMessageId(request)
    let dispatchStarted = false
    let mutationSucceeded = false
    try {
      if (request.action === "send") {
        dispatchStarted = true
        const channel = await this.#client.createDirectMessageChannel(
          request.recipientId,
          options,
        )
        assertEligibleRecipient(channel.recipient, request.recipientId)
        channelId = channel.id
        const checkpoint = operationReceipt({
          activityId,
          channelId,
          plan,
          request,
          requestDigest,
          stage: "channel-ready",
          status: "pending",
          timestamp: this.#clock().toISOString(),
        })
        await this.#operationStore.checkpointDirectMessage(checkpoint)
        await this.#activityStore.append(activityEntry(checkpoint))
      }
      if (channelId === null) {
        throw new DirectMessageEvidenceError(
          "Discord direct-message execution lacks an exact channel identity",
        )
      }
      if (request.action === "send" || request.action === "reply") {
        dispatchStarted = true
        const nonce = directMessageNonce(request, channelId)
        const replyToMessageId = request.action === "reply"
          ? request.replyToMessageId
          : undefined
        let response: DiscordMessage
        if (request.message.kind === "text") {
          response = await this.#client.createDirectMessage(
            channelId,
            {
              content: request.message.content,
              nonce,
              ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
            },
            options,
          )
        } else if (request.message.kind === "components-v2") {
          response = await this.#client.createDirectComponentMessage(
            channelId,
            {
              components: compileComponentLayout(request.message.components),
              nonce,
              ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
            },
            options,
          )
        } else {
          if (file === null) {
            throw new DirectMessageEvidenceError(
              "Discord direct-message execution lacks reviewed attachment bytes",
            )
          }
          response = await this.#client.createDirectAttachmentMessage(
            channelId,
            {
              bytes: file.bytes,
              ...(request.message.content === null
                ? {}
                : { content: request.message.content }),
              ...(request.message.description === null
                ? {}
                : { description: request.message.description }),
              filename: request.message.filename,
              nonce,
              ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
            },
            options,
          )
        }
        const projected = projectDirectMessage(
          response,
          channelId,
          botId,
          request.recipientId,
        )
        if (
          !messageMatchesBody(
            projected,
            request.message,
            request.action === "reply" ? request.replyToMessageId : null,
            file?.review.sizeBytes ?? null,
          )
          || response.nonce !== undefined
            && response.nonce !== null
            && String(response.nonce) !== nonce
        ) {
          throw new DirectMessageEvidenceError(
            "Discord direct-message creation response does not match the request",
          )
        }
        messageId = projected.id
        mutationSucceeded = true
      } else if (request.action === "edit") {
        dispatchStarted = true
        const response = request.message.kind === "text"
          ? await this.#client.editDirectMessage(
              channelId,
              request.messageId,
              request.message.content,
              options,
            )
          : await this.#client.editDirectComponentMessage(
              channelId,
              request.messageId,
              {
                components: compileComponentLayout(request.message.components),
                flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
              },
              options,
            )
        const projected = projectDirectMessage(
          response,
          channelId,
          botId,
          request.recipientId,
          request.messageId,
        )
        if (!messageMatchesBody(
          projected,
          request.message,
          plan.current?.replyToMessageId ?? null,
        )) {
          throw new DirectMessageEvidenceError(
            "Discord direct-message edit response does not match the request",
          )
        }
        messageId = request.messageId
        mutationSucceeded = true
      } else {
        dispatchStarted = true
        await this.#client.deleteDirectMessage(
          channelId,
          request.messageId,
          options,
        )
        messageId = request.messageId
        mutationSucceeded = true
      }
      if (messageId === null) {
        throw new DirectMessageEvidenceError(
          "Discord direct-message execution returned no exact message identity",
        )
      }
      const dispatched = operationReceipt({
        activityId,
        channelId,
        messageId,
        plan,
        request,
        requestDigest,
        stage: "message-dispatched",
        status: "pending",
        timestamp: this.#clock().toISOString(),
      })
      await this.#operationStore.checkpointDirectMessage(dispatched)
      await this.#activityStore.append(activityEntry(dispatched))

      if (request.action === "delete") {
        try {
          await this.#client.getDirectMessage(channelId, messageId, options)
          throw new DirectMessageEvidenceError(
            "Discord direct-message deletion readback still contains the message",
          )
        } catch (error) {
          if (!(error instanceof DiscordApiError && error.status === 404)) throw error
        }
      } else {
        const observed = projectDirectMessage(
          await this.#client.getDirectMessage(channelId, messageId, options),
          channelId,
          botId,
          request.recipientId,
          messageId,
        )
        const expectedReply = request.action === "reply"
          ? request.replyToMessageId
          : request.action === "edit"
            ? plan.current?.replyToMessageId ?? null
            : null
        if (!messageMatchesBody(
          observed,
          request.message,
          expectedReply,
          file?.review.sizeBytes ?? null,
        )) {
          throw new DirectMessageEvidenceError(
            "Discord direct-message readback does not match the requested state",
          )
        }
      }
    } catch (error) {
      const status = !mutationSucceeded && knownFailure(error)
        ? "failed"
        : "uncertain"
      const terminal = operationReceipt({
        activityId,
        channelId,
        error: safeErrorCode(error),
        messageId,
        plan,
        request,
        requestDigest,
        stage: "terminal",
        status,
        timestamp: this.#clock().toISOString(),
      })
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finishDirectMessage(terminal)
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry(terminal))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new DirectMessageExecutionError(
        "Discord direct-message change did not complete with a verified successful outcome",
        {
          action: request.action,
          activityId,
          activityRecordError,
          channelId,
          dispatchStarted,
          error: safeErrorCode(error),
          messageId,
          operationKeyHash: request.operationKeyHash,
          operationRecordError,
          planDigest: plan.digest,
          recipientId: request.recipientId,
          schemaVersion: SCHEMA_VERSION,
          status,
        },
      )
    }
    const completed = operationReceipt({
      activityId,
      channelId,
      messageId,
      plan,
      request,
      requestDigest,
      stage: "terminal",
      status: "completed",
      timestamp: this.#clock().toISOString(),
      verification: "match",
    })
    try {
      await this.#operationStore.finishDirectMessage(completed)
    } catch (error) {
      await this.#activityStore.append(activityEntry({
        ...completed,
        error: safeErrorCode(error),
        status: "uncertain",
        verification: null,
      })).catch(() => undefined)
      throw new DirectMessageExecutionError(
        "Discord direct-message change completed but its operation receipt failed",
        {
          action: request.action,
          activityId,
          channelId,
          messageId,
          operationKeyHash: request.operationKeyHash,
          operationRecordError: safeErrorCode(error),
          planDigest: plan.digest,
          recipientId: request.recipientId,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-operation-record-failed",
        },
      )
    }
    let activityRecordError: string | null = null
    try {
      await this.#activityStore.append(activityEntry(completed))
    } catch (error) {
      activityRecordError = safeErrorCode(error)
    }
    if (activityRecordError !== null) {
      throw new DirectMessageExecutionError(
        "Discord direct-message change completed but terminal activity could not be recorded",
        {
          action: request.action,
          activityId,
          activityRecordError,
          channelId,
          messageId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          recipientId: request.recipientId,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-activity-record-failed",
        },
      )
    }
    return {
      action: request.action,
      activityId,
      channelId,
      messageId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      recipientId: request.recipientId,
      recovered: false,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
    }
  }
}
