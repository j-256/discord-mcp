import {
  createHash,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  InteractionActivity,
  InteractionActivityKind,
  InteractionActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  CreateMessageInput,
  DiscordClient,
} from "./discord-client.js"
import {
  DiscordApiError,
  InteractionConflictError,
  InteractionExecutionError,
  InteractionIdentityError,
  InteractionRateLimitError,
  errorMessage,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  discordMessageUrl,
  stableString,
} from "./normalize.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"

const MESSAGE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const MESSAGE_USER_MENTION_PATTERN = /<@!?([0-9]{1,20})>/gu
const CUSTOM_EMOJI_PATTERN = /^[A-Za-z0-9_]{2,32}:[0-9]{1,20}$/
const EMOJI_CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/u
const EMOJI_CODE_POINT_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u

export interface SendMessageRequest {
  channelId: string
  content: string
  idempotencyKey: string
  notifyReplyAuthor?: boolean | undefined
  notifyUserIds?: readonly string[] | undefined
  replyToMessageId?: string | undefined
}

export interface EditOwnMessageRequest {
  channelId: string
  content: string
  messageId: string
  notifyUserIds?: readonly string[] | undefined
}

export interface AddReactionRequest {
  channelId: string
  emoji: string
  messageId: string
}

export interface SendMessageResult {
  activityId: string
  channelId: string
  guildId: string
  localReplay: boolean
  messageId: string
  nonce: string
  schemaVersion: number
  status: "completed"
  url: string
}

export interface EditOwnMessageResult {
  activityId: string
  channelId: string
  guildId: string
  messageId: string
  schemaVersion: number
  status: "completed" | "noop"
  url: string
}

export interface AddReactionResult {
  activityId: string
  channelId: string
  guildId: string
  messageId: string
  schemaVersion: number
  status: "completed"
  url: string
}

export interface InteractionServiceClient extends Pick<
  DiscordClient,
  "addOwnReaction" | "createMessage" | "editMessage" | "getChannel" | "getMessage"
> {}

export interface InteractionServiceOptions {
  activityStore: ActivityStore
  client: InteractionServiceClient
  clock?: () => Date
  ledgerTtlMs?: number
  limiter?: InteractionLimiter
  maxWritesPerMinute: number
  minWriteIntervalMs: number
  policy: ScopePolicy
  randomId?: () => string
}

interface SendLedgerEntry {
  expiresAt: number
  fingerprint: string
  promise: Promise<SendMessageResult>
}

function assertSnowflake(value: string, name: string): void {
  if (!DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a Discord snowflake`)
  }
}

function assertContent(content: string): void {
  if (!content.trim()) throw new RangeError("Discord message content must not be blank")
  if (content.length > DISCORD_LIMITS.messageContentCharacters) {
    throw new RangeError(
      `Discord message content must not exceed ${DISCORD_LIMITS.messageContentCharacters} characters`,
    )
  }
  if (MESSAGE_CONTROL_PATTERN.test(content)) {
    throw new RangeError("Discord message content contains unsupported control characters")
  }
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    if (code < 0xD800 || code > 0xDFFF) continue
    const next = content.charCodeAt(index + 1)
    if (code <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      index += 1
      continue
    }
    throw new RangeError("Discord message content contains invalid Unicode")
  }
}

function notificationUserIds(
  content: string,
  requested: readonly string[] | undefined,
  policy: ScopePolicy,
): string[] {
  const userIds = [...(requested || [])]
  if (userIds.length > CONNECTOR_LIMITS.interactionNotificationUsers) {
    throw new RangeError(
      `Discord message notifications must not exceed ${CONNECTOR_LIMITS.interactionNotificationUsers} users`,
    )
  }
  if (new Set(userIds).size !== userIds.length) {
    throw new RangeError("Discord message notification user IDs must be unique")
  }
  for (const userId of userIds) assertSnowflake(userId, "Discord notification user ID")
  policy.assertNotificationUsers(userIds)
  const visibleMentions = new Set(
    [...content.matchAll(MESSAGE_USER_MENTION_PATTERN)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  )
  for (const userId of userIds) {
    if (!visibleMentions.has(userId)) {
      throw new RangeError(
        `Discord notification user ${userId} must have a visible user mention in content`,
      )
    }
  }
  return userIds.sort()
}

function allowedMentions(
  userIds: readonly string[],
  repliedUser: boolean,
): CreateMessageInput["allowedMentions"] {
  return userIds.length > 0
    ? { replied_user: repliedUser, users: [...userIds] }
    : { parse: [], replied_user: repliedUser }
}

function assertMessageIdentity(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId?: string,
): void {
  if (
    (messageId !== undefined && message.id !== messageId)
    || !DISCORD_SNOWFLAKE_PATTERN.test(message.id)
    || message.channel_id !== channelId
    || Boolean(message.guild_id && message.guild_id !== guildId)
  ) {
    throw new InteractionIdentityError("Discord returned a different interaction message than requested")
  }
}

function assertBotMessage(message: DiscordMessage, botId: string): void {
  if (message.author.id !== botId || !message.author.bot || message.webhook_id !== undefined) {
    throw new InteractionIdentityError("Discord interaction message is not owned by the verified bot")
  }
}

function assertReplyReference(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  replyToMessageId: string | undefined,
): void {
  const reference = message.message_reference
  if (replyToMessageId === undefined) {
    if (reference !== undefined) {
      throw new InteractionIdentityError(
        "Discord returned a reply reference for a non-reply send",
      )
    }
    return
  }
  if (reference === undefined) {
    throw new InteractionIdentityError(
      "Discord returned no reply reference for the requested send",
    )
  }
  if (
    reference.message_id !== replyToMessageId
    || (reference.channel_id !== undefined && reference.channel_id !== channelId)
    || (reference.guild_id !== undefined && reference.guild_id !== guildId)
    || (reference.type !== undefined
      && reference.type !== DISCORD_MESSAGE_REFERENCE_TYPES.default)
  ) {
    throw new InteractionIdentityError(
      "Discord returned a reply reference that does not match the requested send",
    )
  }
}

function activityError(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError status=${error.status} code=${error.code ?? "unknown"}`
  }
  return error instanceof Error ? error.name : "UnknownError"
}

function failureStatus(error: unknown): Extract<InteractionActivityStatus, "failed" | "uncertain"> {
  return error instanceof DiscordApiError && error.status < 500 ? "failed" : "uncertain"
}

function validateEmoji(emoji: string): string {
  if (
    !emoji
    || emoji.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || EMOJI_CONTROL_OR_SPACE_PATTERN.test(emoji)
  ) {
    throw new RangeError("Discord reaction emoji is empty, too long, or contains whitespace or controls")
  }
  if (CUSTOM_EMOJI_PATTERN.test(emoji)) return emoji
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(emoji)]
  if (segments.length !== 1 || !EMOJI_CODE_POINT_PATTERN.test(emoji)) {
    throw new RangeError("Discord reaction emoji must be one Unicode emoji or name:snowflake")
  }
  return emoji
}

export function interactionNonce(channelId: string, idempotencyKey: string): string {
  return createHash("sha256")
    .update("discord-mcp-message\0")
    .update(channelId)
    .update("\0")
    .update(idempotencyKey)
    .digest("base64url")
    .slice(0, DISCORD_LIMITS.messageNonceCharacters)
}

export class InteractionService {
  readonly #activityStore: ActivityStore
  readonly #client: InteractionServiceClient
  readonly #clock: () => Date
  readonly #ledger = new Map<string, SendLedgerEntry>()
  readonly #ledgerTtlMs: number
  readonly #limiter: InteractionLimiter
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: InteractionServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#ledgerTtlMs = options.ledgerTtlMs ?? CONNECTOR_LIMITS.interactionLedgerTtlMs
    this.#limiter = options.limiter || new InteractionLimiter({
      clock: () => this.#clock().getTime(),
      maxWritesPerMinute: options.maxWritesPerMinute,
      minWriteIntervalMs: options.minWriteIntervalMs,
    })
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #channel(
    channelId: string,
    options: RequestOptions,
  ): Promise<{ channel: DiscordChannel; guildId: string }> {
    assertSnowflake(channelId, "Discord interaction channel ID")
    const channel = await this.#client.getChannel(channelId, options)
    if (channel.id !== channelId) {
      throw new InteractionIdentityError("Discord returned a different interaction channel than requested")
    }
    return { channel, guildId: this.#policy.assertChannelInteractable(channel) }
  }

  async #message(
    channelId: string,
    guildId: string,
    messageId: string,
    options: RequestOptions,
  ): Promise<DiscordMessage> {
    assertSnowflake(messageId, "Discord interaction message ID")
    const message = await this.#client.getMessage(channelId, messageId, options)
    assertMessageIdentity(message, channelId, guildId, messageId)
    return message
  }

  #activity(options: {
    activityId: string
    channelId: string
    error?: string | null
    guildId: string
    kind: InteractionActivityKind
    messageId?: string | null
    nonce?: string | null
    replyToMessageId?: string | null
    status: InteractionActivityStatus
  }): InteractionActivity {
    return {
      channelId: options.channelId,
      error: options.error ?? null,
      guildId: options.guildId,
      id: options.activityId,
      kind: options.kind,
      messageId: options.messageId ?? null,
      nonce: options.nonce ?? null,
      replyToMessageId: options.replyToMessageId ?? null,
      schemaVersion: SCHEMA_VERSION,
      status: options.status,
      timestamp: this.#clock().toISOString(),
    }
  }

  async #write<T>(options: {
    activityId: string
    channelId: string
    completedMessageId?: (value: T) => string
    guildId: string
    kind: InteractionActivityKind
    messageId?: string | null
    nonce?: string | null
    operation: () => Promise<T>
    replyToMessageId?: string | null
  }): Promise<T> {
    this.#limiter.reserve(options.channelId)
    await this.#activityStore.append(this.#activity({
      ...options,
      status: "pending",
    }))
    let value: T
    try {
      value = await options.operation()
    } catch (error) {
      const status = failureStatus(error)
      const result = {
        activityId: options.activityId,
        channelId: options.channelId,
        error: activityError(error),
        guildId: options.guildId,
        messageId: options.messageId ?? null,
        retryAfterMs: error instanceof DiscordApiError ? error.retryAfterMs ?? null : null,
        schemaVersion: SCHEMA_VERSION,
        status,
      }
      try {
        await this.#activityStore.append(this.#activity({
          ...options,
          error: result.error,
          status,
        }))
      } catch (auditError) {
        result.error = `${result.error}; final activity write failed: ${errorMessage(auditError)}`
      }
      throw new InteractionExecutionError(
        "Discord interaction did not complete with a verified outcome",
        result,
        { cause: error },
      )
    }
    const completedMessageId = options.completedMessageId?.(value) ?? options.messageId ?? null
    try {
      await this.#activityStore.append(this.#activity({
        ...options,
        messageId: completedMessageId,
        status: "completed",
      }))
    } catch (error) {
      throw new InteractionExecutionError(
        "Discord interaction completed but the final activity record failed",
        {
          activityId: options.activityId,
          channelId: options.channelId,
          guildId: options.guildId,
          messageId: completedMessageId,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return value
  }

  async sendMessage(
    botId: string,
    request: SendMessageRequest,
    options: RequestOptions = {},
  ): Promise<SendMessageResult> {
    assertContent(request.content)
    if (
      request.idempotencyKey.length < CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters
      || request.idempotencyKey.length > CONNECTOR_LIMITS.idempotencyKeyCharacters
      || !IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)
    ) {
      throw new RangeError(
        `Discord idempotency key must be ${CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters}-${CONNECTOR_LIMITS.idempotencyKeyCharacters} safe ASCII characters`,
      )
    }
    if (request.notifyReplyAuthor && !request.replyToMessageId) {
      throw new RangeError("Discord reply-author notification requires a reply target")
    }
    const notifyUserIds = notificationUserIds(
      request.content,
      request.notifyUserIds,
      this.#policy,
    )
    const nonce = interactionNonce(request.channelId, request.idempotencyKey)
    const fingerprint = createHash("sha256").update(stableString({
      channelId: request.channelId,
      content: request.content,
      notifyReplyAuthor: request.notifyReplyAuthor || false,
      notifyUserIds,
      replyToMessageId: request.replyToMessageId ?? null,
    })).digest("hex")
    const now = this.#clock().getTime()
    for (const [key, entry] of this.#ledger) {
      if (entry.expiresAt <= now) this.#ledger.delete(key)
    }
    const ledgerKey = `${request.channelId}:${nonce}`
    const existing = this.#ledger.get(ledgerKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new InteractionConflictError(
          "Discord send idempotency key was reused with different message parameters",
        )
      }
      const result = await existing.promise
      return { ...result, localReplay: true }
    }
    if (this.#ledger.size >= CONNECTOR_LIMITS.interactionLedgerEntries) {
      throw new InteractionRateLimitError(this.#ledgerTtlMs)
    }
    const promise = this.#sendOnce(botId, request, notifyUserIds, nonce, options)
    const entry: SendLedgerEntry = {
      expiresAt: now + this.#ledgerTtlMs,
      fingerprint,
      promise,
    }
    this.#ledger.set(ledgerKey, entry)
    void promise.catch(() => {
      if (this.#ledger.get(ledgerKey) === entry) this.#ledger.delete(ledgerKey)
    })
    return promise
  }

  async #sendOnce(
    botId: string,
    request: SendMessageRequest,
    notifyUserIds: readonly string[],
    nonce: string,
    options: RequestOptions,
  ): Promise<SendMessageResult> {
    const { guildId } = await this.#channel(request.channelId, options)
    if (request.replyToMessageId) {
      const target = await this.#message(
        request.channelId,
        guildId,
        request.replyToMessageId,
        options,
      )
      if (request.notifyReplyAuthor) {
        assertSnowflake(target.author.id, "Discord reply author ID")
        this.#policy.assertNotificationUsers([target.author.id])
      }
    }
    const activityId = this.#randomId()
    const message = await this.#write({
      activityId,
      channelId: request.channelId,
      completedMessageId: (created) => created.id,
      guildId,
      kind: "message-send",
      nonce,
      operation: async () => {
        const created = await this.#client.createMessage(request.channelId, {
          allowedMentions: allowedMentions(
            notifyUserIds,
            request.notifyReplyAuthor || false,
          ),
          content: request.content,
          nonce,
          ...(request.replyToMessageId
            ? { reply: { guildId, messageId: request.replyToMessageId } }
            : {}),
        }, options)
        assertMessageIdentity(created, request.channelId, guildId)
        assertBotMessage(created, botId)
        assertReplyReference(
          created,
          request.channelId,
          guildId,
          request.replyToMessageId,
        )
        if (
          created.content !== request.content
          || created.nonce !== nonce
        ) {
          throw new InteractionIdentityError(
            "Discord returned message state that does not match the requested send",
          )
        }
        return created
      },
      replyToMessageId: request.replyToMessageId ?? null,
    })
    return {
      activityId,
      channelId: request.channelId,
      guildId,
      localReplay: false,
      messageId: message.id,
      nonce,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: discordMessageUrl(guildId, request.channelId, message.id),
    }
  }

  async editOwnMessage(
    botId: string,
    request: EditOwnMessageRequest,
    options: RequestOptions = {},
  ): Promise<EditOwnMessageResult> {
    assertContent(request.content)
    const notifyUserIds = notificationUserIds(
      request.content,
      request.notifyUserIds,
      this.#policy,
    )
    const { guildId } = await this.#channel(request.channelId, options)
    const existing = await this.#message(
      request.channelId,
      guildId,
      request.messageId,
      options,
    )
    assertBotMessage(existing, botId)
    const activityId = this.#randomId()
    if (existing.content === request.content && notifyUserIds.length === 0) {
      await this.#activityStore.append(this.#activity({
        activityId,
        channelId: request.channelId,
        guildId,
        kind: "message-edit",
        messageId: request.messageId,
        status: "noop",
      }))
      return {
        activityId,
        channelId: request.channelId,
        guildId,
        messageId: request.messageId,
        schemaVersion: SCHEMA_VERSION,
        status: "noop",
        url: discordMessageUrl(guildId, request.channelId, request.messageId),
      }
    }
    await this.#write({
      activityId,
      channelId: request.channelId,
      guildId,
      kind: "message-edit",
      messageId: request.messageId,
      operation: async () => {
        const edited = await this.#client.editMessage(
          request.channelId,
          request.messageId,
          {
            allowedMentions: allowedMentions(notifyUserIds, false),
            content: request.content,
          },
          options,
        )
        assertMessageIdentity(
          edited,
          request.channelId,
          guildId,
          request.messageId,
        )
        assertBotMessage(edited, botId)
        if (edited.content !== request.content) {
          throw new InteractionIdentityError(
            "Discord returned message content that does not match the requested edit",
          )
        }
      },
    })
    return {
      activityId,
      channelId: request.channelId,
      guildId,
      messageId: request.messageId,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: discordMessageUrl(guildId, request.channelId, request.messageId),
    }
  }

  async addReaction(
    request: AddReactionRequest,
    options: RequestOptions = {},
  ): Promise<AddReactionResult> {
    const emoji = validateEmoji(request.emoji)
    const { guildId } = await this.#channel(request.channelId, options)
    await this.#message(request.channelId, guildId, request.messageId, options)
    const activityId = this.#randomId()
    await this.#write({
      activityId,
      channelId: request.channelId,
      guildId,
      kind: "reaction-add",
      messageId: request.messageId,
      operation: () => this.#client.addOwnReaction(
        request.channelId,
        request.messageId,
        emoji,
        options,
      ),
    })
    return {
      activityId,
      channelId: request.channelId,
      guildId,
      messageId: request.messageId,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: discordMessageUrl(guildId, request.channelId, request.messageId),
    }
  }
}
