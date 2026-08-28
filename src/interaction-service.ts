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
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  IDEMPOTENCY_KEY_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  DiscordApiError,
  InteractionConflictError,
  InteractionExecutionError,
  InteractionIdentityError,
  InteractionRateLimitError,
  errorMessage,
} from "./errors.js"
import {
  InteractionLimiter,
  type InteractionLimiterLane,
} from "./interaction-limiter.js"
import {
  assertDiscordBotMessage,
  assertDiscordMessageContent,
  assertDiscordMessageIdentity,
  assertDiscordReplyReference,
  assertDiscordSnowflake,
  discordAllowedMentions,
  discordNotificationUserIds,
} from "./message-safety.js"
import {
  discordMessageUrl,
  stableString,
} from "./normalize.js"
import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
  type BotChannelPermissionResult,
  type DiscordPermissionName,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  normalizeReactionEmoji,
  parseReactionAggregates,
  type NormalizedReactionEmoji,
} from "./reaction-service.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordMessage,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

const DISCORD_EPOCH_MS = 1_420_070_400_000n
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n
const COMMAND_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19])
const COMMAND_PROCESSING_CHANNEL_TYPES: ReadonlySet<number> = new Set([
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

export type RemoveOwnReactionRequest = AddReactionRequest

export interface SignalCommandProcessingRequest {
  channelId: string
  sourceMessageId: string
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
  status: "completed" | "noop"
  url: string
}

export type RemoveOwnReactionResult = AddReactionResult

export interface SignalCommandProcessingResult {
  activityId: string
  channelId: string
  expiresAt: string
  guildId: string
  localReplay: boolean
  schemaVersion: number
  sourceMessageId: string
  status: "completed"
}

export interface InteractionServiceClient extends Pick<
  DiscordClient,
  | "addOwnReaction"
  | "createMessage"
  | "deleteOwnReaction"
  | "editMessage"
  | "getChannel"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
  | "getThreadMember"
  | "triggerTypingIndicator"
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

interface ProcessingSignalLedgerEntry {
  expiresAt: number
  promise: Promise<SignalCommandProcessingResult>
}

interface ProcessingSignalState {
  guildId: string
}

function ownsNormalReaction(
  message: DiscordMessage,
  emoji: NormalizedReactionEmoji,
): boolean {
  const aggregate = parseReactionAggregates(message.reactions).find((entry) => (
    emoji.kind === "custom"
      ? entry.emoji.kind === "custom" && entry.emoji.id === emoji.id
      : entry.emoji.kind === "unicode" && entry.emoji.name === emoji.name
  ))
  return aggregate?.me ?? false
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

function commandProcessingChannel(channel: DiscordChannel): DiscordChannel {
  if (!COMMAND_PROCESSING_CHANNEL_TYPES.has(channel.type)) {
    throw new InteractionIdentityError(
      "Discord command-processing signal requires a text, announcement, or active thread channel",
    )
  }
  if (
    THREAD_CHANNEL_TYPES.has(channel.type)
    && (
      !channel.thread_metadata
      || channel.thread_metadata.archived !== false
      || channel.thread_metadata.locked !== false
    )
  ) {
    throw new InteractionIdentityError(
      "Discord command-processing signal requires an active unlocked thread",
    )
  }
  return channel
}

function exactProcessingMember(
  member: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (!member.user || member.user.id !== botId || member.user.bot !== true) {
    throw new InteractionIdentityError(
      "Discord returned a different connector bot member for command processing",
    )
  }
  return member
}

function exactProcessingThreadMember(
  member: DiscordThreadMember,
  threadId: string,
  botId: string,
): void {
  if (
    !member
    || typeof member !== "object"
    || member.id !== threadId
    || member.user_id !== botId
    || !Number.isSafeInteger(member.flags)
    || member.flags < 0
    || typeof member.join_timestamp !== "string"
    || Number.isNaN(Date.parse(member.join_timestamp))
  ) {
    throw new InteractionIdentityError(
      "Discord returned mismatched command-processing private-thread membership evidence",
    )
  }
}

function processingPermissions(channel: DiscordChannel): DiscordPermissionName[] {
  return [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    THREAD_CHANNEL_TYPES.has(channel.type)
      ? "SEND_MESSAGES_IN_THREADS"
      : "SEND_MESSAGES",
  ]
}

function assertProcessingPermissions(
  permission: BotChannelPermissionResult,
  channel: DiscordChannel,
): void {
  if (permission.confidence !== "complete") {
    throw new InteractionIdentityError(
      `Discord connector bot permission evidence is incomplete: ${permission.warnings.join("; ")}`,
    )
  }
  const effective = BigInt(permission.effectivePermissions)
  const missing = permission.administrator
    ? []
    : processingPermissions(channel).filter((name) => (
      (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
    ))
  if (missing.length > 0) {
    throw new InteractionIdentityError(
      `Discord connector bot lacks command-processing signal permissions: ${missing.join(", ")}`,
    )
  }
}

function assertCommandSource(
  message: DiscordMessage,
  botId: string,
  now: number,
): void {
  if (
    !COMMAND_MESSAGE_TYPES.has(message.type)
    || message.webhook_id !== undefined
    || message.author.bot === true
    || message.author.system === true
    || message.author.id === botId
    || typeof message.content !== "string"
  ) {
    throw new InteractionIdentityError(
      "Discord command-processing source is not an ordinary user message",
    )
  }
  try {
    assertDiscordSnowflake(message.author.id, "Discord command-processing author ID")
  } catch {
    throw new InteractionIdentityError(
      "Discord command-processing source omitted valid author identity evidence",
    )
  }
  const mentionTokenPresent = message.content.includes(`<@${botId}>`)
    || message.content.includes(`<@!${botId}>`)
  const parsedMentionPresent = Array.isArray(message.mentions)
    && message.mentions.some((mention) => mention?.id === botId)
  if (!mentionTokenPresent || !parsedMentionPresent) {
    throw new InteractionIdentityError(
      "Discord command-processing source does not explicitly mention the verified bot",
    )
  }
  const timestamp = Date.parse(message.timestamp)
  const snowflakeTimestamp = Number(
    (BigInt(message.id) >> SNOWFLAKE_TIMESTAMP_SHIFT) + DISCORD_EPOCH_MS,
  )
  if (
    !Number.isFinite(timestamp)
    || !Number.isSafeInteger(snowflakeTimestamp)
    || Math.abs(timestamp - snowflakeTimestamp) > CONNECTOR_LIMITS.commandProcessingFutureSkewMs
    || Math.max(timestamp, snowflakeTimestamp)
      > now + CONNECTOR_LIMITS.commandProcessingFutureSkewMs
    || Math.min(timestamp, snowflakeTimestamp)
      < now - CONNECTOR_LIMITS.commandProcessingSourceAgeMs
  ) {
    throw new InteractionIdentityError(
      "Discord command-processing source is stale or has inconsistent creation evidence",
    )
  }
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
  readonly #processingSignalLedger = new Map<string, ProcessingSignalLedgerEntry>()
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
    assertDiscordSnowflake(channelId, "Discord interaction channel ID")
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
    assertDiscordSnowflake(messageId, "Discord interaction message ID")
    const message = await this.#client.getMessage(channelId, messageId, options)
    assertDiscordMessageIdentity(message, channelId, guildId, messageId)
    return message
  }

  async #processingSignalState(
    botId: string,
    request: SignalCommandProcessingRequest,
    options: RequestOptions,
  ): Promise<ProcessingSignalState> {
    assertDiscordSnowflake(botId, "Discord command-processing bot ID")
    assertDiscordSnowflake(
      request.sourceMessageId,
      "Discord command-processing source message ID",
    )
    const target = await this.#channel(request.channelId, options)
    const channel = commandProcessingChannel(target.channel)
    let parent: DiscordChannel | null = null
    if (THREAD_CHANNEL_TYPES.has(channel.type)) {
      if (!channel.parent_id) {
        throw new InteractionIdentityError(
          "Discord command-processing thread omitted its parent ID",
        )
      }
      parent = await this.#client.getChannel(channel.parent_id, options)
      if (
        parent.id !== channel.parent_id
        || parent.guild_id !== target.guildId
        || THREAD_CHANNEL_TYPES.has(parent.type)
      ) {
        throw new InteractionIdentityError(
          "Discord returned a mismatched command-processing thread parent",
        )
      }
      if (this.#policy.assertChannelReadable(parent) !== target.guildId) {
        throw new InteractionIdentityError(
          "Discord command-processing thread parent belongs to another guild",
        )
      }
    }
    const [source, member, roles, privateThreadMember] = await Promise.all([
      this.#message(
        request.channelId,
        target.guildId,
        request.sourceMessageId,
        options,
      ),
      this.#client.getGuildMember(target.guildId, botId, options),
      this.#client.getGuildRoles(target.guildId, options),
      channel.type === DISCORD_CHANNEL_TYPES.privateThread
        ? this.#client.getThreadMember(channel.id, botId, options)
        : Promise.resolve(null),
    ])
    exactProcessingMember(member, botId)
    if (privateThreadMember) {
      exactProcessingThreadMember(privateThreadMember, channel.id, botId)
    }
    if (!Array.isArray(roles) || roles.length < 1 || roles.length > DISCORD_LIMITS.guildRoles) {
      throw new InteractionIdentityError(
        "Discord returned an invalid bounded role inventory for command processing",
      )
    }
    const permission = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId: target.guildId,
      member,
      permissionChannel: parent || channel,
      roles,
    })
    assertProcessingPermissions(permission, channel)
    assertCommandSource(source, botId, this.#clock().getTime())
    return { guildId: target.guildId }
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
    limiterLane?: InteractionLimiterLane
    messageId?: string | null
    nonce?: string | null
    operation: () => Promise<T>
    replyToMessageId?: string | null
  }): Promise<T> {
    this.#limiter.reserve(options.channelId, options.limiterLane)
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

  async signalCommandProcessing(
    botId: string,
    request: SignalCommandProcessingRequest,
    options: RequestOptions = {},
  ): Promise<SignalCommandProcessingResult> {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new RangeError("Discord command-processing signal request must be an object")
    }
    assertDiscordSnowflake(request.channelId, "Discord command-processing channel ID")
    assertDiscordSnowflake(
      request.sourceMessageId,
      "Discord command-processing source message ID",
    )
    const now = this.#clock().getTime()
    for (const [key, entry] of this.#processingSignalLedger) {
      if (entry.expiresAt <= now) this.#processingSignalLedger.delete(key)
    }
    const ledgerKey = `${request.channelId}:${request.sourceMessageId}`
    const existing = this.#processingSignalLedger.get(ledgerKey)
    if (existing) {
      return {
        ...await existing.promise,
        localReplay: true,
      }
    }
    if (
      this.#processingSignalLedger.size
      >= CONNECTOR_LIMITS.commandProcessingSignalLedgerEntries
    ) {
      throw new InteractionRateLimitError(CONNECTOR_LIMITS.commandProcessingSourceAgeMs)
    }
    const promise = this.#signalCommandProcessingOnce(botId, request, options)
    const entry: ProcessingSignalLedgerEntry = {
      expiresAt: now + CONNECTOR_LIMITS.commandProcessingSourceAgeMs,
      promise,
    }
    this.#processingSignalLedger.set(ledgerKey, entry)
    void promise.catch(() => {
      if (this.#processingSignalLedger.get(ledgerKey) === entry) {
        this.#processingSignalLedger.delete(ledgerKey)
      }
    })
    return promise
  }

  async #signalCommandProcessingOnce(
    botId: string,
    request: SignalCommandProcessingRequest,
    options: RequestOptions,
  ): Promise<SignalCommandProcessingResult> {
    const state = await this.#processingSignalState(botId, request, options)
    const activityId = this.#randomId()
    await this.#write({
      activityId,
      channelId: request.channelId,
      guildId: state.guildId,
      kind: "command-processing-signal",
      limiterLane: "transient",
      messageId: request.sourceMessageId,
      operation: () => this.#client.triggerTypingIndicator(request.channelId, options),
    })
    return {
      activityId,
      channelId: request.channelId,
      expiresAt: new Date(
        this.#clock().getTime() + CONNECTOR_LIMITS.typingIndicatorTtlMs,
      ).toISOString(),
      guildId: state.guildId,
      localReplay: false,
      schemaVersion: SCHEMA_VERSION,
      sourceMessageId: request.sourceMessageId,
      status: "completed",
    }
  }

  async sendMessage(
    botId: string,
    request: SendMessageRequest,
    options: RequestOptions = {},
  ): Promise<SendMessageResult> {
    assertDiscordMessageContent(request.content)
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
    const notifyUserIds = discordNotificationUserIds(
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
        assertDiscordSnowflake(target.author.id, "Discord reply author ID")
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
          allowedMentions: discordAllowedMentions(
            notifyUserIds,
            request.notifyReplyAuthor || false,
          ),
          content: request.content,
          nonce,
          ...(request.replyToMessageId
            ? { reply: { guildId, messageId: request.replyToMessageId } }
            : {}),
        }, options)
        assertDiscordMessageIdentity(created, request.channelId, guildId)
        assertDiscordBotMessage(created, botId)
        assertDiscordReplyReference(
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
    assertDiscordMessageContent(request.content)
    const notifyUserIds = discordNotificationUserIds(
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
    assertDiscordBotMessage(existing, botId)
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
            allowedMentions: discordAllowedMentions(notifyUserIds, false),
            content: request.content,
          },
          options,
        )
        assertDiscordMessageIdentity(
          edited,
          request.channelId,
          guildId,
          request.messageId,
        )
        assertDiscordBotMessage(edited, botId)
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
    return this.#setOwnReaction(request, true, options)
  }

  async removeOwnReaction(
    request: RemoveOwnReactionRequest,
    options: RequestOptions = {},
  ): Promise<RemoveOwnReactionResult> {
    return this.#setOwnReaction(request, false, options)
  }

  async #setOwnReaction(
    request: AddReactionRequest,
    desired: boolean,
    options: RequestOptions,
  ): Promise<AddReactionResult> {
    const emoji = normalizeReactionEmoji(request.emoji)
    const { guildId } = await this.#channel(request.channelId, options)
    const existing = await this.#message(
      request.channelId,
      guildId,
      request.messageId,
      options,
    )
    const activityId = this.#randomId()
    const kind = desired ? "reaction-add" : "reaction-remove-own"
    if (ownsNormalReaction(existing, emoji) === desired) {
      await this.#activityStore.append(this.#activity({
        activityId,
        channelId: request.channelId,
        guildId,
        kind,
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
      kind,
      messageId: request.messageId,
      operation: async () => {
        if (desired) {
          await this.#client.addOwnReaction(
            request.channelId,
            request.messageId,
            emoji.routeToken,
            options,
          )
        } else {
          await this.#client.deleteOwnReaction(
            request.channelId,
            request.messageId,
            emoji.routeToken,
            options,
          )
        }
        const observed = await this.#message(
          request.channelId,
          guildId,
          request.messageId,
          options,
        )
        if (ownsNormalReaction(observed, emoji) !== desired) {
          throw new InteractionIdentityError(
            "Discord reaction state does not match the requested own-reaction change",
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
}
