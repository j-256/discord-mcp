import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { MessagePageOptions } from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import { isExplicitOffsetIso8601Timestamp } from "./iso-timestamp.js"
import { discordMessageUrl } from "./normalize.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"

const REPLY_MESSAGE_TYPE = 19
const DEFAULT_MESSAGE_REFERENCE_TYPE = 0

export interface MessageReplyPageOptions extends RequestOptions {
  afterMessageId?: string
  scanLimit?: number
}

export interface MessageReplyServiceClient {
  getChannel(
    channelId: string,
    options?: RequestOptions,
  ): Promise<DiscordChannel>
  getMessage(
    channelId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<DiscordMessage>
  listMessages(
    channelId: string,
    options?: MessagePageOptions,
  ): Promise<DiscordMessage[]>
}

export interface MessageReplyServiceOptions {
  client: MessageReplyServiceClient
  policy: Pick<ScopePolicy, "assertChannelReadable">
}

export interface MessageReplyView {
  attachmentCount: number
  authorBot: boolean
  authorId: string
  authorSystem: boolean
  channelId: string
  componentCount: number
  content: string
  editedTimestamp: string | null
  embedCount: number
  guildId: string
  id: string
  jumpUrl: string
  mentionEveryone: boolean
  mentionedRoleCount: number
  mentionedUserCount: number
  pinned: boolean
  reactionKindCount: number
  replyToMessageId: string | null
  stickerCount: number
  timestamp: string
  tts: boolean
  type: number
}

export interface MessageReplyResult {
  guildId: string
  page: {
    afterMessageId: string
    nextAfterMessageId: string
    replyCount: number
    requestedScanLimit: number
    scanLimitReached: boolean
    scannedMessageCount: number
  }
  privacy: {
    persistence: "none"
    profileExpansion: "omitted"
    rawPayloads: "omitted"
  }
  replies: MessageReplyView[]
  schemaVersion: number
  source: MessageReplyView
  status: "ok"
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
    && BigInt(value).toString() === value
}

function assertPositiveSnowflake(value: unknown, label: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${label} must be an exact positive Discord snowflake`)
  }
}

function assertScanLimit(value: unknown): asserts value is number {
  if (
    !Number.isInteger(value)
    || Number(value) < 1
    || Number(value) > DISCORD_LIMITS.channelMessages
  ) {
    throw new RangeError(
      `Discord message reply scan limit must be between 1 and ${DISCORD_LIMITS.channelMessages}`,
    )
  }
}

export function assertMessageReplyRequest(
  channelId: unknown,
  sourceMessageId: unknown,
  options: MessageReplyPageOptions = {},
): asserts channelId is string {
  assertPositiveSnowflake(channelId, "Discord message reply channel ID")
  assertPositiveSnowflake(sourceMessageId, "Discord message reply source message ID")
  const afterMessageId = options.afterMessageId ?? sourceMessageId
  assertPositiveSnowflake(afterMessageId, "Discord message reply cursor")
  if (BigInt(afterMessageId) < BigInt(sourceMessageId)) {
    throw new RangeError(
      "Discord message reply cursor must not precede the source message",
    )
  }
  assertScanLimit(options.scanLimit ?? CONNECTOR_LIMITS.messagePageDefault)
}

function validOptionalArray(value: unknown): boolean {
  return value === undefined || Array.isArray(value)
}

function validMessageReference(value: unknown): boolean {
  if (value === undefined) return true
  if (!record(value)) return false
  return (
    (value.type === undefined
      || Number.isSafeInteger(value.type) && Number(value.type) >= 0)
    && (value.message_id === undefined || positiveSnowflake(value.message_id))
    && (value.channel_id === undefined || positiveSnowflake(value.channel_id))
    && (value.guild_id === undefined || positiveSnowflake(value.guild_id))
  )
}

function validMessageEvidence(
  value: unknown,
  channelId: string,
  guildId: string,
): value is DiscordMessage {
  if (!record(value)) return false
  const author = value.author
  return positiveSnowflake(value.id)
    && value.channel_id === channelId
    && (value.guild_id === undefined || value.guild_id === guildId)
    && record(author)
    && positiveSnowflake(author.id)
    && typeof author.username === "string"
    && (author.bot === undefined || typeof author.bot === "boolean")
    && (author.system === undefined || typeof author.system === "boolean")
    && typeof value.content === "string"
    && isExplicitOffsetIso8601Timestamp(value.timestamp)
    && (
      value.edited_timestamp === undefined
      || value.edited_timestamp === null
      || isExplicitOffsetIso8601Timestamp(value.edited_timestamp)
    )
    && Number.isSafeInteger(value.type)
    && Number(value.type) >= 0
    && validOptionalArray(value.attachments)
    && validOptionalArray(value.components)
    && validOptionalArray(value.embeds)
    && validOptionalArray(value.mention_roles)
    && validOptionalArray(value.mentions)
    && validOptionalArray(value.reactions)
    && validOptionalArray(value.sticker_items)
    && validOptionalArray(value.stickers)
    && (value.mention_everyone === undefined || typeof value.mention_everyone === "boolean")
    && (value.pinned === undefined || typeof value.pinned === "boolean")
    && (value.tts === undefined || typeof value.tts === "boolean")
    && validMessageReference(value.message_reference)
}

function projectMessage(
  message: DiscordMessage,
  guildId: string,
  replyToMessageId: string | null,
): MessageReplyView {
  return {
    attachmentCount: message.attachments?.length ?? 0,
    authorBot: message.author.bot === true,
    authorId: message.author.id,
    authorSystem: message.author.system === true,
    channelId: message.channel_id,
    componentCount: message.components?.length ?? 0,
    content: message.content,
    editedTimestamp: message.edited_timestamp ?? null,
    embedCount: message.embeds?.length ?? 0,
    guildId,
    id: message.id,
    jumpUrl: discordMessageUrl(guildId, message.channel_id, message.id),
    mentionEveryone: message.mention_everyone === true,
    mentionedRoleCount: message.mention_roles?.length ?? 0,
    mentionedUserCount: message.mentions?.length ?? 0,
    pinned: message.pinned === true,
    reactionKindCount: message.reactions?.length ?? 0,
    replyToMessageId,
    stickerCount: Math.max(
      message.sticker_items?.length ?? 0,
      message.stickers?.length ?? 0,
    ),
    timestamp: message.timestamp,
    tts: message.tts === true,
    type: message.type,
  }
}

function isDirectReply(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  sourceMessageId: string,
): boolean {
  if (message.type !== REPLY_MESSAGE_TYPE) return false
  const reference = message.message_reference
  if (
    !reference
    || (reference.type !== undefined
      && reference.type !== DEFAULT_MESSAGE_REFERENCE_TYPE)
    || reference.message_id === undefined
    || reference.channel_id === undefined
    || reference.guild_id === undefined
  ) {
    throw new ConfigurationError(
      "Discord returned malformed message-reply reference evidence",
    )
  }
  if (
    !positiveSnowflake(reference.message_id)
    || reference.channel_id !== channelId
    || reference.guild_id !== guildId
  ) {
    throw new ConfigurationError(
      "Discord returned message-reply evidence outside the requested channel or guild",
    )
  }
  return reference.message_id === sourceMessageId
}

export class MessageReplyService {
  readonly #client: MessageReplyServiceClient
  readonly #policy: MessageReplyServiceOptions["policy"]

  constructor(options: MessageReplyServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async list(
    channelId: string,
    sourceMessageId: string,
    options: MessageReplyPageOptions = {},
  ): Promise<MessageReplyResult> {
    assertMessageReplyRequest(channelId, sourceMessageId, options)
    const afterMessageId = options.afterMessageId ?? sourceMessageId
    const scanLimit = options.scanLimit ?? CONNECTOR_LIMITS.messagePageDefault

    const requestOptions = options.signal ? { signal: options.signal } : {}
    const channel = await this.#client.getChannel(channelId, requestOptions)
    if (channel.id !== channelId) {
      throw new ConfigurationError(
        "Discord returned a different channel for message reply inspection",
      )
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    const source = await this.#client.getMessage(
      channelId,
      sourceMessageId,
      requestOptions,
    )
    if (
      !validMessageEvidence(source, channelId, guildId)
      || source.id !== sourceMessageId
    ) {
      throw new ConfigurationError(
        "Discord returned invalid source-message evidence for reply inspection",
      )
    }

    const scanned = await this.#client.listMessages(channelId, {
      after: afterMessageId,
      limit: scanLimit,
      ...requestOptions,
    })
    if (!Array.isArray(scanned) || scanned.length > scanLimit) {
      throw new ConfigurationError(
        "Discord returned an invalid message reply scan page",
      )
    }
    const seen = new Set<string>()
    for (const message of scanned) {
      if (
        !validMessageEvidence(message, channelId, guildId)
        || BigInt(message.id) <= BigInt(afterMessageId)
        || seen.has(message.id)
      ) {
        throw new ConfigurationError(
          "Discord returned invalid or duplicate message reply scan evidence",
        )
      }
      seen.add(message.id)
    }
    const ordered = [...scanned].sort((a, b) => (
      BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0
    ))
    const replies = ordered.filter((message) => (
      isDirectReply(message, channelId, guildId, sourceMessageId)
    ))

    return {
      guildId,
      page: {
        afterMessageId,
        nextAfterMessageId: ordered.at(-1)?.id ?? afterMessageId,
        replyCount: replies.length,
        requestedScanLimit: scanLimit,
        scanLimitReached: scanned.length === scanLimit,
        scannedMessageCount: scanned.length,
      },
      privacy: {
        persistence: "none" as const,
        profileExpansion: "omitted" as const,
        rawPayloads: "omitted" as const,
      },
      replies: replies.map((message) => projectMessage(
        message,
        guildId,
        sourceMessageId,
      )),
      schemaVersion: SCHEMA_VERSION,
      source: projectMessage(source, guildId, null),
      status: "ok" as const,
    }
  }
}
