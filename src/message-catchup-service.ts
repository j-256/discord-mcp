import {
  CHANNEL_TYPE_NAMES,
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  MessagePageOptions,
} from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import { isExplicitOffsetIso8601Timestamp } from "./iso-timestamp.js"
import { discordMessageUrl } from "./normalize.js"
import {
  evaluateBotChannelPermissions,
  type BotChannelPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import { normalizeDiscordRoleInventory } from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"
import type { ApplicationIntentStatus } from "./application-posture.js"

const MESSAGE_EVIDENCE_COLLECTION_LIMIT = 100
const MESSAGE_EVIDENCE_CONTENT_CHARACTERS = 16_384
const MESSAGE_EVIDENCE_USERNAME_CHARACTERS = 100
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u
const THREAD_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const MESSAGE_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const THREAD_PARENT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])

export interface MessageCatchupSelection {
  afterMessageId?: string
  channelId: string
}

export interface MessageCatchupRequest {
  channels: readonly MessageCatchupSelection[]
  guildId: string
  includeAutomatedMessages?: boolean
  maxMessagesPerChannel?: number
}

export interface NormalizedMessageCatchupRequest {
  channels: readonly MessageCatchupSelection[]
  guildId: string
  includeAutomatedMessages: boolean
  maxMessagesPerChannel: number
}

export interface MessageCatchupServiceClient {
  getChannel(
    channelId: string,
    options?: RequestOptions,
  ): Promise<DiscordChannel>
  getGuildMember(
    guildId: string,
    userId: string,
    options?: RequestOptions,
  ): Promise<DiscordGuildMember>
  getGuildRoles(
    guildId: string,
    options?: RequestOptions,
  ): Promise<DiscordRole[]>
  getThreadMember(
    threadId: string,
    userId: string,
    options?: RequestOptions,
  ): Promise<DiscordThreadMember>
  listMessages(
    channelId: string,
    options?: MessagePageOptions,
  ): Promise<DiscordMessage[]>
}

export interface MessageCatchupServiceOptions {
  client: MessageCatchupServiceClient
  policy: Pick<ScopePolicy, "assertChannelReadable" | "assertGuildAllowed">
}

export interface MessageCatchupMessageView {
  attachmentCount: number
  authorBot: boolean
  authorId: string
  authorIsConnector: boolean
  authorSystem: boolean
  authorWebhook: boolean
  channelId: string
  componentCount: number
  content: {
    characters: number
    preview: string
    truncated: boolean
  }
  editedTimestamp: string | null
  embedCount: number
  guildId: string
  id: string
  jumpUrl: string
  mentionEveryone: boolean
  mentionedConnector: boolean
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

export interface MessageCatchupChannelResult {
  channel: {
    guildId: string
    id: string
    name: string | null
    parentId: string | null
    type: number
    typeName: string
  }
  messages: MessageCatchupMessageView[]
  page: {
    afterMessageId: string | null
    boundaryVerification: "not-applicable" | "not-required" | "verified"
    messageCount: number
    mode: "catch-up" | "initialize"
    newerMessagesMayExist: boolean
    nextAfterMessageId: string | null
    olderMessagesMayExist: boolean
    omittedAutomatedMessageCount: number
    requestedLimit: number
    scanLimitReached: boolean
    scannedMessageCount: number
  }
  permissions: {
    canReadMessages: true
    confidence: "complete"
    permissionSourceChannelId: string
    requiredReadPermissions: BotChannelPermissionResult["requiredReadPermissions"]
    privateThreadAccess: "lookup-succeeded" | "not-applicable"
    unknownPermissionBits: string
    warningCount: number
  }
}

export interface MessageCatchupResult {
  channels: MessageCatchupChannelResult[]
  guildId: string
  privacy: {
    automaticPagination: "none"
    cursorCustody: "caller"
    messageContent: "preview-only"
    partialResults: "none"
    persistence: "none"
    profileExpansion: "omitted"
    rawPayloads: "omitted"
  }
  schemaVersion: number
  status: "ok"
}

interface PreparedChannel {
  channel: DiscordChannel
  guildId: string
  permissionChannel: DiscordChannel
  permissions: BotChannelPermissionResult
  selection: MessageCatchupSelection
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
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

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new RangeError(`${label} contains an unknown field`)
  }
}

export function normalizeMessageCatchupRequest(
  request: MessageCatchupRequest,
): NormalizedMessageCatchupRequest {
  if (!record(request)) {
    throw new RangeError("Discord message catch-up request must be an object")
  }
  exactKeys(
    request,
    ["channels", "guildId", "includeAutomatedMessages", "maxMessagesPerChannel"],
    "Discord message catch-up request",
  )
  assertPositiveSnowflake(request.guildId, "Discord message catch-up guild ID")
  if (
    !Array.isArray(request.channels)
    || request.channels.length < 1
    || request.channels.length > CONNECTOR_LIMITS.messageCatchupChannels
  ) {
    throw new RangeError(
      `Discord message catch-up requires 1-${CONNECTOR_LIMITS.messageCatchupChannels} channel selections`,
    )
  }
  const seen = new Set<string>()
  const channels = request.channels.map((selection, index) => {
    if (!record(selection)) {
      throw new RangeError(`Discord message catch-up channel ${index + 1} must be an object`)
    }
    exactKeys(
      selection,
      ["afterMessageId", "channelId"],
      `Discord message catch-up channel ${index + 1}`,
    )
    assertPositiveSnowflake(
      selection.channelId,
      `Discord message catch-up channel ${index + 1} ID`,
    )
    if (seen.has(selection.channelId)) {
      throw new RangeError("Discord message catch-up channel selections must be unique")
    }
    seen.add(selection.channelId)
    if (selection.afterMessageId !== undefined) {
      assertPositiveSnowflake(
        selection.afterMessageId,
        `Discord message catch-up channel ${index + 1} cursor`,
      )
    }
    return Object.freeze({
      ...(selection.afterMessageId
        ? { afterMessageId: selection.afterMessageId }
        : {}),
      channelId: selection.channelId,
    })
  })
  if (
    request.includeAutomatedMessages !== undefined
    && typeof request.includeAutomatedMessages !== "boolean"
  ) {
    throw new RangeError(
      "Discord message catch-up includeAutomatedMessages must be a boolean",
    )
  }
  const maxMessagesPerChannel = request.maxMessagesPerChannel
    ?? CONNECTOR_LIMITS.messageCatchupMessagesDefault
  if (
    !Number.isInteger(maxMessagesPerChannel)
    || maxMessagesPerChannel < 2
    || maxMessagesPerChannel > CONNECTOR_LIMITS.messageCatchupMessagesPerChannel
  ) {
    throw new RangeError(
      `Discord message catch-up per-channel limit must be 2-${CONNECTOR_LIMITS.messageCatchupMessagesPerChannel}`,
    )
  }
  if (
    channels.length * maxMessagesPerChannel
    > CONNECTOR_LIMITS.messageCatchupMessagesTotal
  ) {
    throw new RangeError(
      `Discord message catch-up may scan at most ${CONNECTOR_LIMITS.messageCatchupMessagesTotal} messages`,
    )
  }
  return Object.freeze({
    channels: Object.freeze(channels),
    guildId: request.guildId,
    includeAutomatedMessages: request.includeAutomatedMessages ?? false,
    maxMessagesPerChannel,
  })
}

function assertChannelEvidence(
  value: unknown,
  channelId: string,
  expectedGuildId: string,
  allowedTypes: ReadonlySet<number> = MESSAGE_CHANNEL_TYPES,
): asserts value is DiscordChannel {
  if (
    !record(value)
    || value.id !== channelId
    || value.guild_id !== expectedGuildId
    || !Number.isSafeInteger(value.type)
    || !allowedTypes.has(Number(value.type))
    || typeof value.name !== "string"
    || [...value.name].length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || !validUnicode(value.name)
    || CONTROL_PATTERN.test(value.name)
    || (value.parent_id !== undefined
      && value.parent_id !== null
      && !positiveSnowflake(value.parent_id))
  ) {
    throw new ConfigurationError(
      "Discord returned invalid message catch-up channel evidence",
    )
  }
}

function assertPermissionOverwriteEvidence(
  value: unknown,
  channelId: string,
  roleIds: ReadonlySet<string>,
): void {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.channelPermissionOverwrites
  ) {
    throw new ConfigurationError(
      `Discord message catch-up channel ${channelId} omitted bounded permission-overwrite evidence`,
    )
  }
  const seen = new Set<string>()
  for (const item of value) {
    if (!record(item)) {
      throw new ConfigurationError(
        `Discord returned malformed permission-overwrite evidence for message catch-up channel ${channelId}`,
      )
    }
    const key = `${String(item.type)}:${String(item.id)}`
    if (
      !positiveSnowflake(item.id)
      || (item.type !== 0 && item.type !== 1)
      || typeof item.allow !== "string"
      || !DECIMAL_PATTERN.test(item.allow)
      || typeof item.deny !== "string"
      || !DECIMAL_PATTERN.test(item.deny)
      || (BigInt(item.allow) & BigInt(item.deny)) !== 0n
      || (item.type === 0 && !roleIds.has(item.id))
      || seen.has(key)
    ) {
      throw new ConfigurationError(
        `Discord returned invalid, duplicate, or unresolved permission-overwrite evidence for message catch-up channel ${channelId}`,
      )
    }
    seen.add(key)
  }
}

function assertMemberEvidence(
  value: unknown,
  botId: string,
): asserts value is DiscordGuildMember {
  if (
    !record(value)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
    || !record(value.user)
    || value.user.id !== botId
    || value.user.bot !== true
  ) {
    throw new ConfigurationError(
      "Discord returned invalid connector member evidence for message catch-up",
    )
  }
}

function assertPrivateThreadMemberEvidence(
  value: unknown,
  threadId: string,
  botId: string,
): asserts value is DiscordThreadMember {
  if (
    !record(value)
    || value.id !== threadId
    || value.user_id !== botId
    || !Number.isSafeInteger(value.flags)
    || Number(value.flags) < 0
    || !isExplicitOffsetIso8601Timestamp(value.join_timestamp)
  ) {
    throw new ConfigurationError(
      "Discord returned invalid connector private-thread membership evidence for message catch-up",
    )
  }
}

function boundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MESSAGE_EVIDENCE_COLLECTION_LIMIT
}

function validOptionalBoundedArray(value: unknown): boolean {
  return value === undefined || boundedArray(value)
}

function validMessageReference(value: unknown): boolean {
  if (value === undefined) return true
  if (!record(value)) return false
  return (value.type === undefined || (
    Number.isSafeInteger(value.type) && Number(value.type) >= 0
  ))
    && (value.message_id === undefined || positiveSnowflake(value.message_id))
    && (value.channel_id === undefined || positiveSnowflake(value.channel_id))
    && (value.guild_id === undefined || positiveSnowflake(value.guild_id))
}

function validMessageEvidence(
  value: unknown,
  channelId: string,
  guildId: string,
): value is DiscordMessage {
  if (!record(value)) return false
  const author = value.author
  if (
    !positiveSnowflake(value.id)
    || value.channel_id !== channelId
    || (value.guild_id !== undefined && value.guild_id !== guildId)
    || !record(author)
    || !positiveSnowflake(author.id)
    || typeof author.username !== "string"
    || [...author.username].length < 1
    || [...author.username].length > MESSAGE_EVIDENCE_USERNAME_CHARACTERS
    || !validUnicode(author.username)
    || (author.bot !== undefined && typeof author.bot !== "boolean")
    || (author.system !== undefined && typeof author.system !== "boolean")
    || typeof value.content !== "string"
    || [...value.content].length > MESSAGE_EVIDENCE_CONTENT_CHARACTERS
    || !validUnicode(value.content)
    || !isExplicitOffsetIso8601Timestamp(value.timestamp)
    || (value.edited_timestamp !== undefined
      && value.edited_timestamp !== null
      && !isExplicitOffsetIso8601Timestamp(value.edited_timestamp))
    || !Number.isSafeInteger(value.type)
    || Number(value.type) < 0
    || (value.webhook_id !== undefined && !positiveSnowflake(value.webhook_id))
    || (value.flags !== undefined && (
      !Number.isSafeInteger(value.flags) || Number(value.flags) < 0
    ))
    || (value.mention_everyone !== undefined
      && typeof value.mention_everyone !== "boolean")
    || (value.pinned !== undefined && typeof value.pinned !== "boolean")
    || (value.tts !== undefined && typeof value.tts !== "boolean")
    || !validOptionalBoundedArray(value.attachments)
    || !validOptionalBoundedArray(value.components)
    || !validOptionalBoundedArray(value.embeds)
    || !validOptionalBoundedArray(value.mention_roles)
    || !validOptionalBoundedArray(value.mentions)
    || !validOptionalBoundedArray(value.reactions)
    || !validOptionalBoundedArray(value.sticker_items)
    || !validOptionalBoundedArray(value.stickers)
    || !validMessageReference(value.message_reference)
  ) return false
  const mentionRoles = value.mention_roles
  if (
    Array.isArray(mentionRoles)
    && (
      mentionRoles.some((roleId) => !positiveSnowflake(roleId))
      || new Set(mentionRoles).size !== mentionRoles.length
    )
  ) return false
  const mentions = value.mentions
  if (Array.isArray(mentions)) {
    if (mentions.some((mention) => (
      !record(mention) || !positiveSnowflake(mention.id)
    ))) return false
    const mentionIds = mentions.map((mention) => (
      (mention as Record<string, unknown>).id
    ))
    if (new Set(mentionIds).size !== mentions.length) return false
  }
  return true
}

function assertMessagePage(
  value: unknown,
  channelId: string,
  guildId: string,
  limit: number,
  afterMessageId: string | undefined,
): asserts value is DiscordMessage[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new ConfigurationError(
      "Discord returned an invalid bounded message catch-up page",
    )
  }
  const seen = new Set<string>()
  let priorId: string | undefined
  for (const message of value) {
    if (
      !validMessageEvidence(message, channelId, guildId)
      || (afterMessageId !== undefined
        && BigInt(message.id) <= BigInt(afterMessageId))
      || seen.has(message.id)
      || (priorId !== undefined && BigInt(priorId) <= BigInt(message.id))
    ) {
      throw new ConfigurationError(
        "Discord returned invalid, duplicate, or unordered message catch-up evidence",
      )
    }
    seen.add(message.id)
    priorId = message.id
  }
}

function normalizedPreview(content: string): {
  characters: number
  preview: string
  truncated: boolean
} {
  const characters = [...content].length
  const compact = content.replace(/\s+/gu, " ").trim()
  const previewCharacters = [...compact]
  const truncated = previewCharacters.length > CONNECTOR_LIMITS.messageCatchupPreviewCharacters
  return {
    characters,
    preview: previewCharacters
      .slice(0, CONNECTOR_LIMITS.messageCatchupPreviewCharacters)
      .join(""),
    truncated,
  }
}

function replyToMessageId(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
): string | null {
  if (message.type !== 19) return null
  const reference = message.message_reference
  if (
    !reference
    || (reference.type !== undefined && reference.type !== 0)
    || !positiveSnowflake(reference.message_id)
    || reference.channel_id !== channelId
    || reference.guild_id !== guildId
  ) {
    throw new ConfigurationError(
      "Discord returned malformed reply evidence in a message catch-up page",
    )
  }
  return reference.message_id
}

function projectMessage(
  message: DiscordMessage,
  botId: string,
  guildId: string,
): MessageCatchupMessageView {
  return {
    attachmentCount: message.attachments?.length ?? 0,
    authorBot: message.author.bot === true,
    authorId: message.author.id,
    authorIsConnector: message.author.id === botId,
    authorSystem: message.author.system === true,
    authorWebhook: message.webhook_id !== undefined,
    channelId: message.channel_id,
    componentCount: message.components?.length ?? 0,
    content: normalizedPreview(message.content),
    editedTimestamp: message.edited_timestamp ?? null,
    embedCount: message.embeds?.length ?? 0,
    guildId,
    id: message.id,
    jumpUrl: discordMessageUrl(guildId, message.channel_id, message.id),
    mentionEveryone: message.mention_everyone === true,
    mentionedConnector: message.mentions?.some(({ id }) => id === botId) ?? false,
    mentionedRoleCount: message.mention_roles?.length ?? 0,
    mentionedUserCount: message.mentions?.length ?? 0,
    pinned: message.pinned === true,
    reactionKindCount: message.reactions?.length ?? 0,
    replyToMessageId: replyToMessageId(message, message.channel_id, guildId),
    stickerCount: Math.max(
      message.sticker_items?.length ?? 0,
      message.stickers?.length ?? 0,
    ),
    timestamp: message.timestamp,
    tts: message.tts === true,
    type: message.type,
  }
}

function automatedMessage(message: DiscordMessage): boolean {
  return message.author.bot === true || message.webhook_id !== undefined
}

function channelProjection(channel: DiscordChannel, guildId: string) {
  const typeName = CHANNEL_TYPE_NAMES[channel.type as keyof typeof CHANNEL_TYPE_NAMES]
  return {
    guildId,
    id: channel.id,
    name: channel.name ?? null,
    parentId: channel.parent_id ?? null,
    type: channel.type,
    typeName: typeName ?? "unknown",
  }
}

function requestOptions(options: RequestOptions): RequestOptions {
  return options.signal ? { signal: options.signal } : {}
}

export class MessageCatchupService {
  readonly #client: MessageCatchupServiceClient
  readonly #policy: MessageCatchupServiceOptions["policy"]

  constructor(options: MessageCatchupServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async catchUp(
    botId: string,
    messageContentIntent: ApplicationIntentStatus,
    request: MessageCatchupRequest,
    options: RequestOptions = {},
  ): Promise<MessageCatchupResult> {
    assertPositiveSnowflake(botId, "Discord message catch-up bot ID")
    const normalized = normalizeMessageCatchupRequest(request)
    if (messageContentIntent !== "enabled") {
      throw new ConfigurationError(
        "Discord message catch-up requires authoritative enabled Message Content intent evidence",
      )
    }
    this.#policy.assertGuildAllowed(normalized.guildId)
    const readOptions = requestOptions(options)
    const channels = await Promise.all(normalized.channels.map(async (selection) => {
      const channel = await this.#client.getChannel(selection.channelId, readOptions)
      assertChannelEvidence(channel, selection.channelId, normalized.guildId)
      const guildId = this.#policy.assertChannelReadable(channel)
      if (guildId !== normalized.guildId) {
        throw new ConfigurationError(
          "Discord message catch-up channel belongs to another guild",
        )
      }
      return { channel, guildId, selection }
    }))

    const parentIds = [...new Set(channels.flatMap(({ channel }) => (
      THREAD_TYPES.has(channel.type)
        ? channel.parent_id ? [channel.parent_id] : []
        : []
    )))]
    if (channels.some(({ channel }) => (
      THREAD_TYPES.has(channel.type) && !channel.parent_id
    ))) {
      throw new ConfigurationError(
        "Discord message catch-up thread omitted its parent channel ID",
      )
    }
    const privateThreadIds = channels.flatMap(({ channel }) => (
      channel.type === DISCORD_CHANNEL_TYPES.privateThread ? [channel.id] : []
    ))
    const [rawMember, rawRoles, parents, privateThreadMembers] = await Promise.all([
      this.#client.getGuildMember(normalized.guildId, botId, readOptions),
      this.#client.getGuildRoles(normalized.guildId, readOptions),
      Promise.all(parentIds.map(async (parentId) => {
        const parent = await this.#client.getChannel(parentId, readOptions)
        assertChannelEvidence(
          parent,
          parentId,
          normalized.guildId,
          THREAD_PARENT_TYPES,
        )
        const guildId = this.#policy.assertChannelReadable(parent)
        if (
          guildId !== normalized.guildId
          || !THREAD_PARENT_TYPES.has(parent.type)
        ) {
          throw new ConfigurationError(
            "Discord message catch-up returned an invalid thread permission source",
          )
        }
        return parent
      })),
      Promise.all(privateThreadIds.map(async (threadId) => {
        const member = await this.#client.getThreadMember(
          threadId,
          botId,
          readOptions,
        )
        assertPrivateThreadMemberEvidence(member, threadId, botId)
        return member
      })),
    ])
    assertMemberEvidence(rawMember, botId)
    if (privateThreadMembers.length !== privateThreadIds.length) {
      throw new ConfigurationError(
        "Discord returned incomplete private-thread membership evidence for message catch-up",
      )
    }
    const roles = normalizeDiscordRoleInventory(rawRoles, normalized.guildId)
    const roleIds = new Set(roles.map(({ id }) => id))
    const parentById = new Map(parents.map((parent) => [parent.id, parent]))
    const prepared: PreparedChannel[] = channels.map(({ channel, guildId, selection }) => {
      const permissionChannel = THREAD_TYPES.has(channel.type)
        ? parentById.get(channel.parent_id as string)
        : channel
      if (!permissionChannel) {
        throw new ConfigurationError(
          "Discord message catch-up thread permission source is unavailable",
        )
      }
      assertPermissionOverwriteEvidence(
        permissionChannel.permission_overwrites,
        permissionChannel.id,
        roleIds,
      )
      const permissions = evaluateBotChannelPermissions({
        botId,
        channel,
        guildId,
        member: rawMember,
        permissionChannel,
        roles,
      })
      if (permissions.confidence !== "complete" || permissions.canReadMessages !== true) {
        throw new ConfigurationError(
          `Discord message catch-up requires complete read permissions in channel ${channel.id}`,
        )
      }
      return { channel, guildId, permissionChannel, permissions, selection }
    })

    const results = await Promise.all(prepared.map(async (entry) => {
      const afterMessageId = entry.selection.afterMessageId
      const scanned = await this.#client.listMessages(entry.channel.id, {
        ...(afterMessageId ? { after: afterMessageId } : {}),
        limit: normalized.maxMessagesPerChannel,
        ...readOptions,
      })
      assertMessagePage(
        scanned,
        entry.channel.id,
        entry.guildId,
        normalized.maxMessagesPerChannel,
        afterMessageId,
      )
      const scanLimitReached = scanned.length === normalized.maxMessagesPerChannel
      let boundaryVerification:
        MessageCatchupChannelResult["page"]["boundaryVerification"] = afterMessageId
          ? "not-required"
          : "not-applicable"
      if (afterMessageId && scanLimitReached) {
        const boundary = await this.#client.listMessages(entry.channel.id, {
          after: afterMessageId,
          limit: 1,
          ...readOptions,
        })
        assertMessagePage(
          boundary,
          entry.channel.id,
          entry.guildId,
          1,
          afterMessageId,
        )
        const oldestScanned = scanned.at(-1)
        if (boundary.length !== 1 || boundary[0]?.id !== oldestScanned?.id) {
          throw new ConfigurationError(
            "Discord message catch-up boundary evidence changed or contradicted page selection",
          )
        }
        boundaryVerification = "verified"
      }
      const chronological = [...scanned].reverse()
      const visible = normalized.includeAutomatedMessages
        ? chronological
        : chronological.filter((message) => !automatedMessage(message))
      const nextAfterMessageId = scanned.at(0)?.id ?? afterMessageId ?? null
      return {
        channel: channelProjection(entry.channel, entry.guildId),
        messages: visible.map((message) => projectMessage(
          message,
          botId,
          entry.guildId,
        )),
        page: {
          afterMessageId: afterMessageId ?? null,
          boundaryVerification,
          messageCount: visible.length,
          mode: afterMessageId ? "catch-up" as const : "initialize" as const,
          newerMessagesMayExist: Boolean(afterMessageId && scanLimitReached),
          nextAfterMessageId,
          olderMessagesMayExist: Boolean(!afterMessageId && scanLimitReached),
          omittedAutomatedMessageCount: scanned.length - visible.length,
          requestedLimit: normalized.maxMessagesPerChannel,
          scanLimitReached,
          scannedMessageCount: scanned.length,
        },
        permissions: {
          canReadMessages: true as const,
          confidence: "complete" as const,
          permissionSourceChannelId: entry.permissionChannel.id,
          privateThreadAccess: entry.permissions.privateThreadAccess,
          requiredReadPermissions: entry.permissions.requiredReadPermissions,
          unknownPermissionBits: entry.permissions.unknownPermissionBits,
          warningCount: entry.permissions.warnings.length,
        },
      }
    }))

    return {
      channels: results,
      guildId: normalized.guildId,
      privacy: {
        automaticPagination: "none",
        cursorCustody: "caller",
        messageContent: "preview-only",
        partialResults: "none",
        persistence: "none",
        profileExpansion: "omitted",
        rawPayloads: "omitted",
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }
}
