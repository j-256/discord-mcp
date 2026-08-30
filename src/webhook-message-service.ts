import {
  createHash,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  WebhookMessageActivity,
  WebhookMessageActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  DiscordWebhookSummary,
  ExecuteWebhookMessageInput,
  ModifyWebhookMessageInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  WebhookMessageEvidenceError,
  WebhookMessageExecutionError,
  WebhookMessageOperationConflictError,
  WebhookMessagePlanChangedError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  assertDiscordMessageContent,
  assertDiscordMessageIdentity,
  canonicalDiscordNotificationUserIds,
  discordAllowedMentions,
} from "./message-safety.js"
import { discordMessageUrl } from "./normalize.js"
import {
  operationKeyHash,
  type OperationReceipt,
  type OperationStore,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"
import type { WebhookCredentialStore } from "./webhook-credential-store.js"

const STATE_UNAVAILABLE = "webhook-message-state-unavailable"
const RETURNED_COLLECTION_LIMIT = 100
const REVIEW_REASON_CHARACTERS = 512
const REVIEW_REASON_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const DISCORD_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
const LOOKUP_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "messageId",
  "webhookId",
])
const SEND_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "content",
  "notifyUserIds",
  "operationKey",
  "webhookId",
])
const EDIT_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "content",
  "messageId",
  "notifyUserIds",
  "operationKey",
  "webhookId",
])
const DELETION_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "messageId",
  "operationKey",
  "reviewReason",
  "webhookId",
])

export interface WebhookMessageLookupRequest {
  messageId: string
  webhookId: string
}

export interface WebhookMessageSendRequest {
  content: string
  notifyUserIds?: readonly string[]
  operationKey: string
  webhookId: string
}

export interface WebhookMessageEditRequest extends WebhookMessageSendRequest {
  messageId: string
}

export interface WebhookMessageDeletionRequest {
  messageId: string
  operationKey: string
  reviewReason: string
  webhookId: string
}

export interface NormalizedWebhookMessageSendRequest {
  content: string
  notifyUserIds: string[]
  operationKey: string
  operationKeyHash: string
  webhookId: string
}

export interface NormalizedWebhookMessageEditRequest
  extends NormalizedWebhookMessageSendRequest {
  messageId: string
}

export interface NormalizedWebhookMessageDeletionRequest {
  messageId: string
  operationKey: string
  operationKeyHash: string
  reviewReason: string
  webhookId: string
}

export interface ProjectedWebhookMessage {
  attachmentCount: number
  channelId: string
  componentCount: number
  content: string
  editedAt: string | null
  embedCount: number
  flags: number
  guildId: string
  mentionEveryone: boolean
  mentionedRoleCount: number
  mentionedUserCount: number
  messageId: string
  pinned: boolean
  pollPresent: boolean
  stickerCount: number
  timestamp: string
  tts: boolean
  type: number
  url: string
  webhookId: string
}

export interface WebhookMessageLookupResult {
  message: ProjectedWebhookMessage
  privacy: WebhookMessagePrivacyProjection
  schemaVersion: number
  status: "found"
}

export interface WebhookMessageWriteResult {
  action: "edit" | "send"
  activityId: string | null
  channelId: string
  guildId: string
  localReplay: boolean
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed" | "noop"
  url: string
  webhookId: string
}

export interface WebhookMessagePrivacyProjection {
  credentialPaths: "omitted"
  credentials: "connector-private"
  durableRecords: "content-free"
  executionUrls: "omitted"
  messageContentPersistence: "none"
  rawPayloads: "omitted"
}

export interface WebhookMessageDeletionPlan {
  action: "delete"
  applicationId: string
  botId: string
  channel: {
    guildId: string
    id: string
    type: number
  }
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  privacy: WebhookMessagePrivacyProjection
  reviewReason: string
  schemaVersion: number
  status: "planned"
  target: ProjectedWebhookMessage
  warnings: string[]
  webhook: {
    applicationId: string | null
    id: string
    type: "incoming"
  }
}

export interface WebhookMessageDeletionResult {
  activityId: string
  channelId: string
  guildId: string
  messageId: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  url: string
  webhookId: string
}

export interface WebhookMessageServiceClient extends Pick<
  DiscordClient,
  | "deleteWebhookMessage"
  | "executeWebhookMessage"
  | "getChannel"
  | "getGuild"
  | "getWebhookMessage"
  | "getWebhookWithToken"
  | "modifyWebhookMessage"
> {}

export interface WebhookMessageServiceOptions {
  activityStore: ActivityStore
  client: WebhookMessageServiceClient
  clock?: () => Date
  credentialStore: Pick<WebhookCredentialStore, "read">
  intentKey?: Uint8Array
  limiter: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

type WebhookMessageOperationKind =
  | "webhook-message-deletion"
  | "webhook-message-edit"
  | "webhook-message-send"

type WebhookMessagePolicyMode = "audit" | "delete" | "deliver" | "edit"

interface WebhookMessageTarget {
  channel: DiscordChannel
  guildId: string
  token: string
  webhook: DiscordWebhookSummary
}

interface ProjectedWebhookMessageEvidence {
  mentionedUserIds: string[]
  projection: ProjectedWebhookMessage
}

interface RecordedMutationResult<T> {
  activityId: string
  value: T
}

function hasOnlyKeys(value: object, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key))
}

function assertRequestObject(
  value: unknown,
  keys: ReadonlySet<string>,
  name: string,
): asserts value is Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !hasOnlyKeys(value, keys)
  ) {
    throw new RangeError(`${name} must be an exact object`)
  }
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${name} must be an exact Discord snowflake`)
  }
}

function normalizedReviewReason(value: unknown): string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.trim() !== value
    || value.length > REVIEW_REASON_CHARACTERS
    || REVIEW_REASON_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord webhook message review reason must contain 1-${REVIEW_REASON_CHARACTERS} characters without controls`,
    )
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError("Discord webhook message review reason contains invalid Unicode", {
      cause: error,
    })
  }
  return value
}

export function normalizeWebhookMessageLookupRequest(
  request: WebhookMessageLookupRequest,
): WebhookMessageLookupRequest {
  assertRequestObject(request, LOOKUP_REQUEST_KEYS, "Discord webhook message lookup")
  assertSnowflake(request.webhookId, "Discord webhook ID")
  assertSnowflake(request.messageId, "Discord webhook message ID")
  return {
    messageId: request.messageId,
    webhookId: request.webhookId,
  }
}

export function normalizeWebhookMessageSendRequest(
  request: WebhookMessageSendRequest,
): NormalizedWebhookMessageSendRequest {
  assertRequestObject(request, SEND_REQUEST_KEYS, "Discord webhook message send request")
  assertSnowflake(request.webhookId, "Discord webhook ID")
  assertDiscordMessageContent(request.content)
  return {
    content: request.content,
    notifyUserIds: canonicalDiscordNotificationUserIds(
      request.content,
      request.notifyUserIds,
    ),
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    webhookId: request.webhookId,
  }
}

export function normalizeWebhookMessageEditRequest(
  request: WebhookMessageEditRequest,
): NormalizedWebhookMessageEditRequest {
  assertRequestObject(request, EDIT_REQUEST_KEYS, "Discord webhook message edit request")
  const normalized = normalizeWebhookMessageSendRequest({
    content: request.content,
    ...(request.notifyUserIds === undefined
      ? {}
      : { notifyUserIds: request.notifyUserIds }),
    operationKey: request.operationKey,
    webhookId: request.webhookId,
  })
  assertSnowflake(request.messageId, "Discord webhook message ID")
  return {
    ...normalized,
    messageId: request.messageId,
  }
}

export function normalizeWebhookMessageDeletionRequest(
  request: WebhookMessageDeletionRequest,
): NormalizedWebhookMessageDeletionRequest {
  assertRequestObject(
    request,
    DELETION_REQUEST_KEYS,
    "Discord webhook message deletion request",
  )
  assertSnowflake(request.webhookId, "Discord webhook ID")
  assertSnowflake(request.messageId, "Discord webhook message ID")
  return {
    messageId: request.messageId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    reviewReason: normalizedReviewReason(request.reviewReason),
    webhookId: request.webhookId,
  }
}

export function webhookMessageIntentKey(botToken: string): Uint8Array {
  if (typeof botToken !== "string" || !botToken) {
    throw new TypeError("Discord webhook message intent key requires a bot credential")
  }
  return createHash("sha256")
    .update("guildcontrol-webhook-message-digest.v1\0")
    .update(botToken)
    .digest()
}

function privacyProjection(): WebhookMessagePrivacyProjection {
  return {
    credentialPaths: "omitted",
    credentials: "connector-private",
    durableRecords: "content-free",
    executionUrls: "omitted",
    messageContentPersistence: "none",
    rawPayloads: "omitted",
  }
}

function exactWebhook(
  webhook: DiscordWebhookSummary,
  webhookId: string,
): DiscordWebhookSummary {
  if (
    webhook.id !== webhookId
    || webhook.type !== 1
    || webhook.guildId === null
    || webhook.channelId === null
  ) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid Incoming webhook credential evidence",
    )
  }
  return webhook
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
  guildId: string,
): DiscordChannel {
  if (channel.id !== channelId || channel.guild_id !== guildId) {
    throw new WebhookMessageEvidenceError(
      "Discord returned a different webhook message channel than requested",
    )
  }
  return channel
}

function boundedCount(value: unknown, name: string): number {
  if (value === undefined) return 0
  if (!Array.isArray(value) || value.length > RETURNED_COLLECTION_LIMIT) {
    throw new WebhookMessageEvidenceError(`Discord returned invalid ${name} evidence`)
  }
  return value.length
}

function returnedMentionRoleIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > RETURNED_COLLECTION_LIMIT) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message role-mention evidence",
    )
  }
  const roleIds = value.map((roleId) => {
    if (
      typeof roleId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)
      || BigInt(roleId) < 1n
      || BigInt(roleId) > DISCORD_SNOWFLAKE_MAX
    ) {
      throw new WebhookMessageEvidenceError(
        "Discord returned invalid webhook message role-mention evidence",
      )
    }
    return roleId
  })
  if (new Set(roleIds).size !== roleIds.length) {
    throw new WebhookMessageEvidenceError(
      "Discord returned duplicate webhook message role-mention evidence",
    )
  }
  return roleIds
}

function returnedMentionUserIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > RETURNED_COLLECTION_LIMIT) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message user-mention evidence",
    )
  }
  const userIds = value.map((entry) => {
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || !("id" in entry)
      || typeof entry.id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(entry.id)
      || BigInt(entry.id) < 1n
      || BigInt(entry.id) > DISCORD_SNOWFLAKE_MAX
    ) {
      throw new WebhookMessageEvidenceError(
        "Discord returned invalid webhook message user-mention evidence",
      )
    }
    return entry.id
  })
  if (new Set(userIds).size !== userIds.length) {
    throw new WebhookMessageEvidenceError(
      "Discord returned duplicate webhook message user-mention evidence",
    )
  }
  return userIds
}

function returnedContent(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length > DISCORD_LIMITS.messageContentCharacters
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message content evidence",
    )
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message Unicode evidence",
      { cause: error },
    )
  }
  return value
}

function returnedGuildName(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.channelNameCharacters
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message guild evidence",
    )
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message guild Unicode evidence",
      { cause: error },
    )
  }
  return value
}

function returnedTimestamp(value: unknown, name: string): string {
  if (
    typeof value !== "string"
    || !DISCORD_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new WebhookMessageEvidenceError(
      `Discord returned invalid webhook message ${name} evidence`,
    )
  }
  return value
}

function projectedMessage(
  message: DiscordMessage,
  target: WebhookMessageTarget,
  messageId: string,
): ProjectedWebhookMessageEvidence {
  try {
    assertDiscordMessageIdentity(
      message,
      target.channel.id,
      target.guildId,
      messageId,
    )
  } catch (error) {
    throw new WebhookMessageEvidenceError(
      "Discord returned a different webhook message than requested",
      { cause: error },
    )
  }
  if (
    message.webhook_id !== target.webhook.id
    || !message.author
    || typeof message.author !== "object"
    || message.author.id !== target.webhook.id
    || !Number.isSafeInteger(message.type)
    || message.type < 0
    || !Number.isSafeInteger(message.flags ?? 0)
    || (message.flags ?? 0) < 0
    || !(message.pinned === undefined || typeof message.pinned === "boolean")
    || !(message.tts === undefined || typeof message.tts === "boolean")
    || !(
      message.poll === undefined
      || (
        message.poll !== null
        && typeof message.poll === "object"
        && !Array.isArray(message.poll)
      )
    )
    || !(
      message.mention_everyone === undefined
      || typeof message.mention_everyone === "boolean"
    )
  ) {
    throw new WebhookMessageEvidenceError(
      "Discord returned invalid webhook message identity evidence",
    )
  }
  const timestamp = returnedTimestamp(message.timestamp, "timestamp")
  const editedAt = message.edited_timestamp === undefined
    || message.edited_timestamp === null
    ? null
    : returnedTimestamp(message.edited_timestamp, "edit timestamp")
  if (editedAt !== null && Date.parse(editedAt) < Date.parse(timestamp)) {
    throw new WebhookMessageEvidenceError(
      "Discord returned inconsistent webhook message timestamp evidence",
    )
  }
  const mentionedRoleIds = returnedMentionRoleIds(message.mention_roles)
  const mentionedUserIds = returnedMentionUserIds(message.mentions)
  return {
    mentionedUserIds,
    projection: {
      attachmentCount: boundedCount(message.attachments, "attachment"),
      channelId: target.channel.id,
      componentCount: boundedCount(message.components, "component"),
      content: returnedContent(message.content),
      editedAt,
      embedCount: boundedCount(message.embeds, "embed"),
      flags: message.flags ?? 0,
      guildId: target.guildId,
      mentionEveryone: message.mention_everyone ?? false,
      mentionedRoleCount: mentionedRoleIds.length,
      mentionedUserCount: mentionedUserIds.length,
      messageId,
      pinned: message.pinned ?? false,
      pollPresent: message.poll !== undefined,
      stickerCount: boundedCount(message.sticker_items, "sticker"),
      timestamp,
      tts: message.tts ?? false,
      type: message.type,
      url: discordMessageUrl(target.guildId, target.channel.id, messageId),
      webhookId: target.webhook.id,
    },
  }
}

function requestedContentMatches(
  evidence: ProjectedWebhookMessageEvidence,
  content: string,
  notifyUserIds: readonly string[],
): boolean {
  const allowedUsers = new Set(notifyUserIds)
  return evidence.projection.content === content
    && evidence.projection.attachmentCount === 0
    && evidence.projection.componentCount === 0
    && evidence.projection.embedCount === 0
    && evidence.projection.flags === DISCORD_MESSAGE_FLAGS.suppressEmbeds
    && !evidence.projection.mentionEveryone
    && evidence.projection.mentionedRoleCount === 0
    && evidence.mentionedUserIds.length === notifyUserIds.length
    && evidence.mentionedUserIds.every((userId) => allowedUsers.has(userId))
    && !evidence.projection.pollPresent
    && evidence.projection.stickerCount === 0
    && !evidence.projection.tts
    && evidence.projection.type === 0
}

function assertEditablePlainTextPayload(
  evidence: ProjectedWebhookMessageEvidence,
): void {
  const message = evidence.projection
  if (
    message.attachmentCount !== 0
    || message.componentCount !== 0
    || message.embedCount !== 0
    || ![0, DISCORD_MESSAGE_FLAGS.suppressEmbeds].includes(message.flags)
    || message.pollPresent
    || message.stickerCount !== 0
    || message.tts
    || message.type !== 0
  ) {
    throw new WebhookMessageEvidenceError(
      "Discord webhook message editing is limited to plain-text message payloads",
    )
  }
}

function exactRequestedContent(
  evidence: ProjectedWebhookMessageEvidence,
  content: string,
  notifyUserIds: readonly string[],
): void {
  if (!requestedContentMatches(evidence, content, notifyUserIds)) {
    throw new WebhookMessageEvidenceError(
      "Discord webhook message state does not match the requested plain-text content and mention boundary",
    )
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
    planDigest: receipt.planDigest,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  channelId: string
  error?: string | null
  guildId: string
  kind: WebhookMessageOperationKind
  messageId?: string | null
  operationKeyHash: string
  planDigest: string
  status: WebhookMessageActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
  webhookId: string
}): WebhookMessageActivity {
  return {
    channelId: options.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: options.kind,
    messageId: options.messageId ?? null,
    operationKeyHash: options.operationKeyHash,
    planDigest: options.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
    webhookId: options.webhookId,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  kind: WebhookMessageOperationKind
  messageId?: string | null
  operationKeyHash: string
  planDigest: string
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: options.kind,
    operationKeyHash: options.operationKeyHash,
    planDigest: options.planDigest,
    resourceId: options.messageId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

export class WebhookMessageService {
  readonly #activityStore: ActivityStore
  readonly #client: WebhookMessageServiceClient
  readonly #clock: () => Date
  readonly #credentialStore: Pick<WebhookCredentialStore, "read">
  readonly #intentKey: Uint8Array
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: WebhookMessageServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#credentialStore = options.credentialStore
    this.#intentKey = options.intentKey || createReviewedPlanKey()
    this.#limiter = options.limiter
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #target(
    webhookId: string,
    mode: WebhookMessagePolicyMode,
    options: RequestOptions,
  ): Promise<WebhookMessageTarget> {
    assertSnowflake(webhookId, "Discord webhook ID")
    if (mode === "deliver") {
      this.#policy.assertWebhookMessageDeliveryEnabled()
    } else if (mode === "edit") {
      this.#policy.assertWebhookMessageChangesEnabled()
    } else if (mode === "delete") {
      this.#policy.assertWebhookMessageDeletionsEnabled()
    } else {
      this.#policy.assertWebhookMessageAuditEnabled()
    }
    const token = await this.#credentialStore.read(webhookId)
    const webhook = exactWebhook(
      await this.#client.getWebhookWithToken(webhookId, token, options),
      webhookId,
    )
    const channel = exactChannel(
      await this.#client.getChannel(webhook.channelId as string, options),
      webhook.channelId as string,
      webhook.guildId as string,
    )
    let guildId: string
    if (mode === "deliver") {
      guildId = this.#policy.assertChannelWebhookMessageDeliverable(channel)
    } else if (mode === "edit") {
      guildId = this.#policy.assertChannelWebhookMessageChangeable(channel)
    } else if (mode === "delete") {
      guildId = this.#policy.assertChannelWebhookMessageDeletable(channel)
    } else {
      guildId = this.#policy.assertChannelWebhookMessageAuditable(channel)
    }
    if (guildId !== webhook.guildId) {
      throw new WebhookMessageEvidenceError(
        "Discord webhook guild does not match the scoped channel",
      )
    }
    return { channel, guildId, token, webhook }
  }

  async #message(
    target: WebhookMessageTarget,
    messageId: string,
    options: RequestOptions,
  ): Promise<ProjectedWebhookMessageEvidence> {
    assertSnowflake(messageId, "Discord webhook message ID")
    return projectedMessage(
      await this.#client.getWebhookMessage(
        target.webhook.id,
        target.token,
        messageId,
        options,
      ),
      target,
      messageId,
    )
  }

  #intentDigest(
    action: "edit" | "send",
    request: NormalizedWebhookMessageEditRequest | NormalizedWebhookMessageSendRequest,
  ): string {
    return reviewedPlanDigest(this.#intentKey, {
      action,
      content: request.content,
      messageId: "messageId" in request ? request.messageId : null,
      notifyUserIds: request.notifyUserIds,
      operationKeyHash: request.operationKeyHash,
      privacy: privacyProjection(),
      webhookId: request.webhookId,
    })
  }

  sendDigest(request: WebhookMessageSendRequest): string {
    return this.#intentDigest("send", normalizeWebhookMessageSendRequest(request))
  }

  editDigest(request: WebhookMessageEditRequest): string {
    return this.#intentDigest("edit", normalizeWebhookMessageEditRequest(request))
  }

  async get(
    request: WebhookMessageLookupRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageLookupResult> {
    const normalized = normalizeWebhookMessageLookupRequest(request)
    const target = await this.#target(normalized.webhookId, "audit", options)
    return {
      message: (await this.#message(target, normalized.messageId, options)).projection,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "found",
    }
  }

  async #completedReplay(
    action: "edit" | "send",
    kind: WebhookMessageOperationKind,
    request: NormalizedWebhookMessageEditRequest | NormalizedWebhookMessageSendRequest,
    digest: string,
    options: RequestOptions,
  ): Promise<WebhookMessageWriteResult | null> {
    const existing = await this.#operationStore.get(kind, request.operationKeyHash)
    if (!existing) return null
    if (
      existing.status !== "completed"
      || existing.planDigest !== digest
      || existing.verification !== "match"
      || existing.resourceId === null
    ) {
      throw new WebhookMessageOperationConflictError(receiptView(existing))
    }
    const target = await this.#target(
      request.webhookId,
      action === "send" ? "deliver" : "edit",
      options,
    )
    const message = await this.#message(target, existing.resourceId, options)
    exactRequestedContent(message, request.content, request.notifyUserIds)
    if (
      action === "edit"
      && "messageId" in request
      && message.projection.messageId !== request.messageId
    ) {
      throw new WebhookMessageOperationConflictError(receiptView(existing))
    }
    return {
      action,
      activityId: existing.activityId,
      channelId: target.channel.id,
      guildId: target.guildId,
      localReplay: true,
      messageId: message.projection.messageId,
      operationKeyHash: request.operationKeyHash,
      planDigest: digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: message.projection.url,
      webhookId: request.webhookId,
    }
  }

  async #recordedMutation<T>(options: {
    channelId: string
    guildId: string
    kind: WebhookMessageOperationKind
    messageId: string | null
    operation: (markResponse: (messageId: string) => void) => Promise<{
      messageId: string
      value: T
      verification: "drift" | "match"
    }>
    operationKeyHash: string
    planDigest: string
    webhookId: string
  }): Promise<RecordedMutationResult<T>> {
    this.#limiter.reserve(options.channelId)
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: options.guildId,
      kind: options.kind,
      operationKeyHash: options.operationKeyHash,
      planDigest: options.planDigest,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new WebhookMessageOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        channelId: options.channelId,
        guildId: options.guildId,
        kind: options.kind,
        messageId: options.messageId,
        operationKeyHash: options.operationKeyHash,
        planDigest: options.planDigest,
        status: "pending",
        timestamp: this.#clock().toISOString(),
        webhookId: options.webhookId,
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: options.guildId,
          kind: options.kind,
          operationKeyHash: options.operationKeyHash,
          planDigest: options.planDigest,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new WebhookMessageExecutionError(
        "Discord webhook message operation was blocked because pending activity could not be recorded",
        {
          activityId,
          channelId: options.channelId,
          error: safeErrorCode(error),
          guildId: options.guildId,
          messageId: options.messageId,
          operationKeyHash: options.operationKeyHash,
          operationRecordError,
          planDigest: options.planDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
          webhookId: options.webhookId,
        },
        { cause: error },
      )
    }

    let responseReceived = false
    let observedMessageId = options.messageId
    let completed: {
      messageId: string
      value: T
      verification: "drift" | "match"
    }
    try {
      completed = await options.operation((messageId) => {
        responseReceived = true
        observedMessageId = messageId
      })
    } catch (error) {
      const status = !responseReceived
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && ![408, 429].includes(error.status)
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: options.guildId,
          kind: options.kind,
          ...(status === "uncertain" && observedMessageId
            ? { messageId: observedMessageId }
            : {}),
          operationKeyHash: options.operationKeyHash,
          planDigest: options.planDigest,
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
          channelId: options.channelId,
          error: errorCode,
          guildId: options.guildId,
          kind: options.kind,
          messageId: observedMessageId,
          operationKeyHash: options.operationKeyHash,
          planDigest: options.planDigest,
          status,
          timestamp: this.#clock().toISOString(),
          webhookId: options.webhookId,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookMessageExecutionError(
        "Discord webhook message operation did not complete with a verified successful outcome",
        {
          activityId,
          activityRecordError,
          channelId: options.channelId,
          error: errorCode,
          guildId: options.guildId,
          messageId: observedMessageId,
          operationKeyHash: options.operationKeyHash,
          operationRecordError,
          planDigest: options.planDigest,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          schemaVersion: SCHEMA_VERSION,
          status,
          webhookId: options.webhookId,
        },
        { cause: error },
      )
    }

    const terminalStatus = completed.verification === "match"
      ? "completed"
      : "completed-with-drift"
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: options.guildId,
        kind: options.kind,
        messageId: completed.messageId,
        operationKeyHash: options.operationKeyHash,
        planDigest: options.planDigest,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: completed.verification,
      }))
    } catch (error) {
      throw new WebhookMessageExecutionError(
        "Discord webhook message operation completed but the operation receipt failed",
        {
          activityId,
          channelId: options.channelId,
          guildId: options.guildId,
          messageId: completed.messageId,
          operationKeyHash: options.operationKeyHash,
          operationRecordError: safeErrorCode(error),
          planDigest: options.planDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-operation-record-failed",
          webhookId: options.webhookId,
        },
        { cause: error },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        channelId: options.channelId,
        guildId: options.guildId,
        kind: options.kind,
        messageId: completed.messageId,
        operationKeyHash: options.operationKeyHash,
        planDigest: options.planDigest,
        status: terminalStatus,
        timestamp: this.#clock().toISOString(),
        verification: completed.verification,
        webhookId: options.webhookId,
      }))
    } catch (error) {
      throw new WebhookMessageExecutionError(
        "Discord webhook message operation completed but the final activity record failed",
        {
          activityId,
          activityRecordError: safeErrorCode(error),
          channelId: options.channelId,
          guildId: options.guildId,
          messageId: completed.messageId,
          operationKeyHash: options.operationKeyHash,
          planDigest: options.planDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-audit-failed",
          webhookId: options.webhookId,
        },
        { cause: error },
      )
    }
    return { activityId, value: completed.value }
  }

  async send(
    request: WebhookMessageSendRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageWriteResult> {
    const normalized = normalizeWebhookMessageSendRequest(request)
    this.#policy.assertNotificationUsers(normalized.notifyUserIds)
    const digest = this.#intentDigest("send", normalized)
    const replay = await this.#completedReplay(
      "send",
      "webhook-message-send",
      normalized,
      digest,
      options,
    )
    if (replay) return replay
    const target = await this.#target(normalized.webhookId, "deliver", options)
    const input: ExecuteWebhookMessageInput = {
      allowedMentions: discordAllowedMentions(normalized.notifyUserIds, false),
      content: normalized.content,
    }
    const recorded = await this.#recordedMutation({
      channelId: target.channel.id,
      guildId: target.guildId,
      kind: "webhook-message-send",
      messageId: null,
      operation: async (markResponse) => {
        const response = await this.#client.executeWebhookMessage(
          normalized.webhookId,
          target.token,
          input,
          options,
        )
        if (response && typeof response.id === "string") markResponse(response.id)
        const projected = projectedMessage(response, target, response.id)
        exactRequestedContent(
          projected,
          normalized.content,
          normalized.notifyUserIds,
        )
        const readback = await this.#message(
          target,
          projected.projection.messageId,
          options,
        )
        exactRequestedContent(
          readback,
          normalized.content,
          normalized.notifyUserIds,
        )
        return {
          messageId: projected.projection.messageId,
          value: readback,
          verification: "match" as const,
        }
      },
      operationKeyHash: normalized.operationKeyHash,
      planDigest: digest,
      webhookId: normalized.webhookId,
    })
    return {
      action: "send",
      activityId: recorded.activityId,
      channelId: target.channel.id,
      guildId: target.guildId,
      localReplay: false,
      messageId: recorded.value.projection.messageId,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: recorded.value.projection.url,
      webhookId: normalized.webhookId,
    }
  }

  async edit(
    request: WebhookMessageEditRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageWriteResult> {
    const normalized = normalizeWebhookMessageEditRequest(request)
    this.#policy.assertNotificationUsers(normalized.notifyUserIds)
    const digest = this.#intentDigest("edit", normalized)
    const replay = await this.#completedReplay(
      "edit",
      "webhook-message-edit",
      normalized,
      digest,
      options,
    )
    if (replay) return replay
    const target = await this.#target(normalized.webhookId, "edit", options)
    const current = await this.#message(target, normalized.messageId, options)
    assertEditablePlainTextPayload(current)
    if (
      normalized.notifyUserIds.length === 0
      && requestedContentMatches(current, normalized.content, [])
    ) {
      return {
        action: "edit",
        activityId: null,
        channelId: target.channel.id,
        guildId: target.guildId,
        localReplay: false,
        messageId: normalized.messageId,
        operationKeyHash: normalized.operationKeyHash,
        planDigest: digest,
        schemaVersion: SCHEMA_VERSION,
        status: "noop",
        url: current.projection.url,
        webhookId: normalized.webhookId,
      }
    }
    const input: ModifyWebhookMessageInput = {
      allowedMentions: discordAllowedMentions(normalized.notifyUserIds, false),
      content: normalized.content,
    }
    const recorded = await this.#recordedMutation({
      channelId: target.channel.id,
      guildId: target.guildId,
      kind: "webhook-message-edit",
      messageId: normalized.messageId,
      operation: async (markResponse) => {
        const response = await this.#client.modifyWebhookMessage(
          normalized.webhookId,
          target.token,
          normalized.messageId,
          input,
          options,
        )
        markResponse(normalized.messageId)
        const projected = projectedMessage(
          response,
          target,
          normalized.messageId,
        )
        exactRequestedContent(
          projected,
          normalized.content,
          normalized.notifyUserIds,
        )
        const readback = await this.#message(target, normalized.messageId, options)
        exactRequestedContent(
          readback,
          normalized.content,
          normalized.notifyUserIds,
        )
        return {
          messageId: normalized.messageId,
          value: readback,
          verification: "match" as const,
        }
      },
      operationKeyHash: normalized.operationKeyHash,
      planDigest: digest,
      webhookId: normalized.webhookId,
    })
    return {
      action: "edit",
      activityId: recorded.activityId,
      channelId: target.channel.id,
      guildId: target.guildId,
      localReplay: false,
      messageId: normalized.messageId,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: recorded.value.projection.url,
      webhookId: normalized.webhookId,
    }
  }

  async #buildDeletionPlan(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookMessageDeletionRequest,
    options: RequestOptions,
  ): Promise<WebhookMessageDeletionPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const existing = await this.#operationStore.get(
      "webhook-message-deletion",
      request.operationKeyHash,
    )
    if (existing) {
      throw new WebhookMessageOperationConflictError(receiptView(existing))
    }
    const target = await this.#target(request.webhookId, "delete", options)
    const [messageEvidence, guild] = await Promise.all([
      this.#message(target, request.messageId, options),
      this.#client.getGuild(target.guildId, options),
    ])
    if (guild.id !== target.guildId) {
      throw new WebhookMessageEvidenceError(
        "Discord returned invalid webhook message guild evidence",
      )
    }
    const guildName = returnedGuildName(guild.name)
    const message = messageEvidence.projection
    const warnings = [
      "Webhook message deletion is permanent and Discord does not accept a guild audit-log reason for this token-authenticated route",
      "The review reason is transient local context and is never sent to Discord or persisted",
      "Message content and guild names are untrusted Discord data and are never persisted by this workflow",
      "Rich-payload bodies are omitted from review; only their counts or presence are plan-bound, so same-count internal rich-payload changes are outside the reviewed evidence",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      "Another credential holder or webhook administrator can edit or delete the message or move the webhook during the final non-atomic read-to-delete window",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      action: "delete",
      applicationId,
      botId,
      channel: {
        guildId: target.guildId,
        id: target.channel.id,
        type: target.channel.type,
      },
      guild: {
        id: guild.id,
        name: guildName,
      },
      message,
      operationKeyHash: request.operationKeyHash,
      privacy: privacyProjection(),
      reviewReason: request.reviewReason,
      warnings,
      webhook: {
        applicationId: target.webhook.applicationId,
        id: target.webhook.id,
        type: "incoming",
      },
    })
    return {
      action: "delete",
      applicationId,
      botId,
      channel: {
        guildId: target.guildId,
        id: target.channel.id,
        type: target.channel.type,
      },
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: guild.id,
        name: guildName,
      },
      operationKeyHash: request.operationKeyHash,
      privacy: privacyProjection(),
      reviewReason: request.reviewReason,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      target: message,
      warnings,
      webhook: {
        applicationId: target.webhook.applicationId,
        id: target.webhook.id,
        type: "incoming",
      },
    }
  }

  planDeletion(
    applicationId: string,
    botId: string,
    request: WebhookMessageDeletionRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageDeletionPlan> {
    return this.#buildDeletionPlan(
      applicationId,
      botId,
      normalizeWebhookMessageDeletionRequest(request),
      options,
    )
  }

  async executeDeletion(
    applicationId: string,
    botId: string,
    request: WebhookMessageDeletionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookMessageDeletionResult> {
    const normalized = normalizeWebhookMessageDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord webhook message deletion plan digest is invalid")
    }
    let plan: WebhookMessageDeletionPlan
    try {
      plan = await this.#buildDeletionPlan(
        applicationId,
        botId,
        normalized,
        options,
      )
    } catch (error) {
      if (
        error instanceof WebhookMessageEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new WebhookMessagePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new WebhookMessagePlanChangedError(expectedDigest, plan.digest)
    }
    const target = await this.#target(normalized.webhookId, "delete", options)
    if (
      target.channel.id !== plan.channel.id
      || target.channel.type !== plan.channel.type
      || target.guildId !== plan.channel.guildId
      || target.webhook.applicationId !== plan.webhook.applicationId
      || target.webhook.id !== plan.webhook.id
    ) {
      throw new WebhookMessagePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
    }
    const recorded = await this.#recordedMutation({
      channelId: target.channel.id,
      guildId: target.guildId,
      kind: "webhook-message-deletion",
      messageId: normalized.messageId,
      operation: async (markResponse) => {
        await this.#client.deleteWebhookMessage(
          normalized.webhookId,
          target.token,
          normalized.messageId,
          options,
        )
        markResponse(normalized.messageId)
        let readbackMatched = false
        try {
          await this.#message(target, normalized.messageId, options)
        } catch (error) {
          if (!(error instanceof DiscordApiError) || error.status !== 404) throw error
          const survivingWebhook = exactWebhook(
            await this.#client.getWebhookWithToken(
              normalized.webhookId,
              target.token,
              options,
            ),
            normalized.webhookId,
          )
          if (
            survivingWebhook.channelId !== target.channel.id
            || survivingWebhook.guildId !== target.guildId
          ) {
            throw new WebhookMessageEvidenceError(
              "Discord webhook moved outside the reviewed message-deletion target",
            )
          }
          readbackMatched = true
        }
        return {
          messageId: normalized.messageId,
          value: { readbackMatched },
          verification: readbackMatched ? "match" as const : "drift" as const,
        }
      },
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      webhookId: normalized.webhookId,
    })
    return {
      activityId: recorded.activityId,
      channelId: target.channel.id,
      guildId: target.guildId,
      messageId: normalized.messageId,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      readbackMatched: recorded.value.readbackMatched,
      schemaVersion: SCHEMA_VERSION,
      status: recorded.value.readbackMatched
        ? "completed"
        : "completed-with-drift",
      url: discordMessageUrl(target.guildId, target.channel.id, normalized.messageId),
      webhookId: normalized.webhookId,
    }
  }
}
