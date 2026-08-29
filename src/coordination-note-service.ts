import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  assertCoordinationAddress,
  assertCoordinationNoteTag,
  COORDINATION_NOTE_FORMAT,
  parseCoordinationNote,
  type CoordinationNoteEnvelope,
} from "./coordination-note.js"
import type { MessagePageOptions } from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import { isExplicitOffsetIso8601Timestamp } from "./iso-timestamp.js"
import { discordMessageUrl } from "./normalize.js"
import type { ScopePolicy } from "./policy.js"
import { parseReactionAggregates } from "./reaction-service.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"

const ORDINARY_MESSAGE_TYPE = 0
const REPLY_MESSAGE_TYPE = 19
const DEFAULT_MESSAGE_REFERENCE_TYPE = 0
const MAX_OPTIONAL_COLLECTION_ITEMS = 100
const STATUS_SIGNAL_EMOJI = Object.freeze({
  automatedReplyExpected: "\u{1F916}",
  blocked: "\u{1F6D1}",
  declined: "\u274C",
  doneOrApproved: "\u2705",
  seenOrClaimed: "\u{1F440}",
})

export interface CoordinationPageOptions extends RequestOptions {
  afterMessageId?: string
  scanLimit?: number
}

export interface CoordinationNoteListOptions extends CoordinationPageOptions {
  fromAddress?: string
  includeBroadcasts?: boolean
  tag?: string
  unresolvedOnly?: boolean
}

export interface CoordinationNoteServiceClient {
  getChannel(
    channelId: string,
    options?: RequestOptions,
  ): Promise<DiscordChannel>
  listMessages(
    channelId: string,
    options?: MessagePageOptions,
  ): Promise<DiscordMessage[]>
}

export interface CoordinationNoteServiceOptions {
  client: CoordinationNoteServiceClient
  policy: Pick<ScopePolicy, "assertChannelReadable">
}

export interface CoordinationStatusSignals {
  automatedReplyExpectedCount: number
  blockedCount: number
  declinedCount: number
  doneOrApprovedCount: number
  seenOrClaimedCount: number
  terminalConventionObserved: boolean
}

export interface CoordinationNoteView {
  body: string
  channelId: string
  editedTimestamp: string | null
  fromAddress: string
  guildId: string
  id: string
  jumpUrl: string
  notificationRequested: boolean
  plainMessage: {
    attachmentCount: 0
    componentCount: 0
    embedCount: 0
    stickerCount: 0
  }
  replyToMessageId: string | null
  statusSignals: CoordinationStatusSignals
  tags: readonly string[]
  timestamp: string
  to: CoordinationNoteEnvelope["to"]
}

export interface CoordinationAddressObservation {
  address: string
  firstObservedAtInPage: string
  lastMessageIdInPage: string
  lastObservedAtInPage: string
  noteCountInPage: number
}

interface CoordinationDiscardCounts {
  differentRecipient: number
  filteredSender: number
  filteredTag: number
  malformedEnvelope: number
  nonNote: number
  resolvedByConvention: number
  unsupportedAuthorOrWebhook: number
  unsupportedMessageShape: number
}

interface CoordinationPageEvidence {
  afterMessageId: string | null
  nextAfterMessageId: string | null
  requestedScanLimit: number
  scanLimitReached: boolean
  scannedMessageCount: number
}

interface CoordinationPrivacyProjection {
  attachmentUrls: "omitted"
  connectorPersistence: "none"
  differentlyAddressedBodies: "discarded"
  profiles: "omitted"
  rawPayloads: "omitted"
  reactionUsers: "not-read"
}

interface CoordinationRoutingBoundary {
  addressAuthority: "none"
  addressAuthentication: "none"
  addressLiveness: "not-proven"
  addressRegistration: "none"
  contentAuthority: "none"
  statusSignalAuthority: "none"
}

export interface CoordinationNoteListResult {
  applicationId: string
  botId: string
  channel: {
    id: string
    parentId: string | null
    type: number
  }
  discarded: CoordinationDiscardCounts
  format: typeof COORDINATION_NOTE_FORMAT
  guildId: string
  notes: CoordinationNoteView[]
  page: CoordinationPageEvidence & { noteCount: number }
  privacy: CoordinationPrivacyProjection
  routing: CoordinationRoutingBoundary
  schemaVersion: number
  status: "ok"
}

export interface CoordinationAddressListResult {
  addresses: CoordinationAddressObservation[]
  applicationId: string
  botId: string
  channel: {
    id: string
    parentId: string | null
    type: number
  }
  discarded: Omit<
    CoordinationDiscardCounts,
    "differentRecipient" | "filteredSender" | "filteredTag" | "resolvedByConvention"
  >
  format: typeof COORDINATION_NOTE_FORMAT
  guildId: string
  page: CoordinationPageEvidence & {
    addressCount: number
    coordinationNoteCount: number
  }
  privacy: CoordinationPrivacyProjection & {
    notificationTargets: "omitted"
    noteBodies: "omitted"
    recipients: "omitted"
    tags: "omitted"
  }
  routing: CoordinationRoutingBoundary
  schemaVersion: number
  status: "ok"
}

interface ScannedCoordinationPage {
  channel: DiscordChannel
  guildId: string
  ordered: DiscordMessage[]
  page: CoordinationPageEvidence
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

function assertPageOptions(options: CoordinationPageOptions): void {
  if (options.afterMessageId !== undefined) {
    assertPositiveSnowflake(
      options.afterMessageId,
      "Discord coordination message cursor",
    )
  }
  const scanLimit = options.scanLimit ?? CONNECTOR_LIMITS.messagePageDefault
  if (
    !Number.isInteger(scanLimit)
    || scanLimit < 1
    || scanLimit > DISCORD_LIMITS.channelMessages
  ) {
    throw new RangeError(
      `Discord coordination scan limit must be between 1 and ${DISCORD_LIMITS.channelMessages}`,
    )
  }
}

export function assertCoordinationNoteListRequest(
  channelId: unknown,
  recipientAddress: unknown,
  options: CoordinationNoteListOptions = {},
): asserts channelId is string {
  assertPositiveSnowflake(channelId, "Discord coordination channel ID")
  assertCoordinationAddress(
    recipientAddress,
    "Discord coordination recipient address",
  )
  if (options.fromAddress !== undefined) {
    assertCoordinationAddress(
      options.fromAddress,
      "Discord coordination sender filter address",
    )
  }
  if (options.tag !== undefined) {
    assertCoordinationNoteTag(options.tag, "Discord coordination tag filter")
  }
  if (
    options.includeBroadcasts !== undefined
    && typeof options.includeBroadcasts !== "boolean"
  ) {
    throw new RangeError("Discord coordination broadcast filter must be a boolean")
  }
  if (options.unresolvedOnly !== undefined && typeof options.unresolvedOnly !== "boolean") {
    throw new RangeError("Discord coordination resolution filter must be a boolean")
  }
  assertPageOptions(options)
}

export function assertCoordinationAddressListRequest(
  channelId: unknown,
  options: CoordinationPageOptions = {},
): asserts channelId is string {
  assertPositiveSnowflake(channelId, "Discord coordination channel ID")
  assertPageOptions(options)
}

function boundedOptionalArray(value: unknown): boolean {
  return value === undefined
    || Array.isArray(value) && value.length <= MAX_OPTIONAL_COLLECTION_ITEMS
}

function validMessageReference(value: unknown): boolean {
  if (value === undefined) return true
  if (!record(value)) return false
  return (value.type === undefined || value.type === DEFAULT_MESSAGE_REFERENCE_TYPE)
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
    && boundedOptionalArray(value.attachments)
    && boundedOptionalArray(value.components)
    && boundedOptionalArray(value.embeds)
    && boundedOptionalArray(value.mention_roles)
    && boundedOptionalArray(value.mentions)
    && boundedOptionalArray(value.reactions)
    && boundedOptionalArray(value.sticker_items)
    && boundedOptionalArray(value.stickers)
    && (value.mention_everyone === undefined || typeof value.mention_everyone === "boolean")
    && (value.pinned === undefined || typeof value.pinned === "boolean")
    && (value.tts === undefined || typeof value.tts === "boolean")
    && (value.webhook_id === undefined || positiveSnowflake(value.webhook_id))
    && validMessageReference(value.message_reference)
}

function replyTarget(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
): string | null | undefined {
  if (message.type === ORDINARY_MESSAGE_TYPE) {
    return message.message_reference === undefined ? null : undefined
  }
  if (message.type !== REPLY_MESSAGE_TYPE) return undefined
  const reference = message.message_reference
  if (
    !reference
    || (reference.type !== undefined
      && reference.type !== DEFAULT_MESSAGE_REFERENCE_TYPE)
    || !positiveSnowflake(reference.message_id)
    || reference.channel_id !== channelId
    || reference.guild_id !== guildId
  ) return undefined
  return reference.message_id
}

function notificationMatches(
  message: DiscordMessage,
  envelope: CoordinationNoteEnvelope,
): boolean {
  const mentions = message.mentions ?? []
  if (
    message.mention_everyone === true
    || (message.mention_roles?.length ?? 0) !== 0
  ) return false
  if (envelope.notifyUserId === null) return mentions.length === 0
  return mentions.length === 1
    && record(mentions[0])
    && mentions[0].id === envelope.notifyUserId
}

function isPlainCoordinationMessage(
  message: DiscordMessage,
  envelope: CoordinationNoteEnvelope,
  channelId: string,
  guildId: string,
): { replyToMessageId: string | null; statusSignals: CoordinationStatusSignals } | undefined {
  const target = replyTarget(message, channelId, guildId)
  if (
    target === undefined
    || (message.attachments?.length ?? 0) !== 0
    || (message.components?.length ?? 0) !== 0
    || (message.embeds?.length ?? 0) !== 0
    || (message.sticker_items?.length ?? 0) !== 0
    || (message.stickers?.length ?? 0) !== 0
    || message.message_snapshots !== undefined
    || message.poll !== undefined
    || message.tts === true
    || !notificationMatches(message, envelope)
  ) return undefined
  const reactions = parseReactionAggregates(message.reactions)
  const count = (emoji: string) => reactions.find((entry) => (
    entry.emoji.kind === "unicode" && entry.emoji.name === emoji
  ))?.count ?? 0
  const doneOrApprovedCount = count(STATUS_SIGNAL_EMOJI.doneOrApproved)
  const declinedCount = count(STATUS_SIGNAL_EMOJI.declined)
  return {
    replyToMessageId: target,
    statusSignals: {
      automatedReplyExpectedCount: count(STATUS_SIGNAL_EMOJI.automatedReplyExpected),
      blockedCount: count(STATUS_SIGNAL_EMOJI.blocked),
      declinedCount,
      doneOrApprovedCount,
      seenOrClaimedCount: count(STATUS_SIGNAL_EMOJI.seenOrClaimed),
      terminalConventionObserved: doneOrApprovedCount > 0 || declinedCount > 0,
    },
  }
}

function emptyDiscardCounts(): CoordinationDiscardCounts {
  return {
    differentRecipient: 0,
    filteredSender: 0,
    filteredTag: 0,
    malformedEnvelope: 0,
    nonNote: 0,
    resolvedByConvention: 0,
    unsupportedAuthorOrWebhook: 0,
    unsupportedMessageShape: 0,
  }
}

function routingBoundary(): CoordinationRoutingBoundary {
  return {
    addressAuthority: "none",
    addressAuthentication: "none",
    addressLiveness: "not-proven",
    addressRegistration: "none",
    contentAuthority: "none",
    statusSignalAuthority: "none",
  }
}

function privacyProjection(): CoordinationPrivacyProjection {
  return {
    attachmentUrls: "omitted",
    connectorPersistence: "none",
    differentlyAddressedBodies: "discarded",
    profiles: "omitted",
    rawPayloads: "omitted",
    reactionUsers: "not-read",
  }
}

function notePrefix(content: string): boolean {
  return content.startsWith(`[${COORDINATION_NOTE_FORMAT}]\n`)
}

export class CoordinationNoteService {
  readonly #client: CoordinationNoteServiceClient
  readonly #policy: CoordinationNoteServiceOptions["policy"]

  constructor(options: CoordinationNoteServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async #scan(
    applicationId: string,
    botId: string,
    channelId: string,
    options: CoordinationPageOptions,
  ): Promise<ScannedCoordinationPage> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const scanLimit = options.scanLimit ?? CONNECTOR_LIMITS.messagePageDefault
    const requestOptions = options.signal ? { signal: options.signal } : {}
    const channel = await this.#client.getChannel(channelId, requestOptions)
    if (channel.id !== channelId) {
      throw new ConfigurationError(
        "Discord returned a different channel for coordination note inspection",
      )
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    const messages = await this.#client.listMessages(channelId, {
      ...(options.afterMessageId ? { after: options.afterMessageId } : {}),
      limit: scanLimit,
      ...requestOptions,
    })
    if (!Array.isArray(messages) || messages.length > scanLimit) {
      throw new ConfigurationError(
        "Discord returned an invalid coordination note scan page",
      )
    }
    const seen = new Set<string>()
    for (const message of messages) {
      if (
        !validMessageEvidence(message, channelId, guildId)
        || (options.afterMessageId !== undefined
          && BigInt(message.id) <= BigInt(options.afterMessageId))
        || seen.has(message.id)
      ) {
        throw new ConfigurationError(
          "Discord returned invalid or duplicate coordination note scan evidence",
        )
      }
      seen.add(message.id)
    }
    const ordered = [...messages].sort((left, right) => (
      BigInt(left.id) < BigInt(right.id)
        ? -1
        : BigInt(left.id) > BigInt(right.id)
          ? 1
          : 0
    ))
    return {
      channel,
      guildId,
      ordered,
      page: {
        afterMessageId: options.afterMessageId ?? null,
        nextAfterMessageId: ordered.at(-1)?.id ?? options.afterMessageId ?? null,
        requestedScanLimit: scanLimit,
        scanLimitReached: messages.length === scanLimit,
        scannedMessageCount: messages.length,
      },
    }
  }

  async listNotes(
    applicationId: string,
    botId: string,
    channelId: string,
    recipientAddress: string,
    options: CoordinationNoteListOptions = {},
  ): Promise<CoordinationNoteListResult> {
    assertCoordinationNoteListRequest(channelId, recipientAddress, options)
    const scanned = await this.#scan(
      applicationId,
      botId,
      channelId,
      options,
    )
    const discarded = emptyDiscardCounts()
    const notes: CoordinationNoteView[] = []
    for (const message of scanned.ordered) {
      if (message.author.id !== botId || message.author.bot !== true || message.webhook_id) {
        discarded.unsupportedAuthorOrWebhook += 1
        continue
      }
      const envelope = parseCoordinationNote(message.content)
      if (!envelope) {
        discarded[notePrefix(message.content) ? "malformedEnvelope" : "nonNote"] += 1
        continue
      }
      const plain = isPlainCoordinationMessage(
        message,
        envelope,
        channelId,
        scanned.guildId,
      )
      if (!plain) {
        discarded.unsupportedMessageShape += 1
        continue
      }
      const direct = envelope.to.kind === "address"
        && envelope.to.address === recipientAddress
      const broadcast = envelope.to.kind === "broadcast"
        && options.includeBroadcasts !== false
      if (!direct && !broadcast) {
        discarded.differentRecipient += 1
        continue
      }
      if (options.fromAddress && envelope.fromAddress !== options.fromAddress) {
        discarded.filteredSender += 1
        continue
      }
      if (options.tag && !envelope.tags.includes(options.tag)) {
        discarded.filteredTag += 1
        continue
      }
      if (options.unresolvedOnly && plain.statusSignals.terminalConventionObserved) {
        discarded.resolvedByConvention += 1
        continue
      }
      notes.push({
        body: envelope.body,
        channelId,
        editedTimestamp: message.edited_timestamp ?? null,
        fromAddress: envelope.fromAddress,
        guildId: scanned.guildId,
        id: message.id,
        jumpUrl: discordMessageUrl(scanned.guildId, channelId, message.id),
        notificationRequested: envelope.notifyUserId !== null,
        plainMessage: {
          attachmentCount: 0,
          componentCount: 0,
          embedCount: 0,
          stickerCount: 0,
        },
        replyToMessageId: plain.replyToMessageId,
        statusSignals: plain.statusSignals,
        tags: envelope.tags,
        timestamp: message.timestamp,
        to: envelope.to,
      })
    }
    return {
      applicationId,
      botId,
      channel: {
        id: scanned.channel.id,
        parentId: scanned.channel.parent_id ?? null,
        type: scanned.channel.type,
      },
      discarded,
      format: COORDINATION_NOTE_FORMAT,
      guildId: scanned.guildId,
      notes,
      page: { ...scanned.page, noteCount: notes.length },
      privacy: privacyProjection(),
      routing: routingBoundary(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async listAddresses(
    applicationId: string,
    botId: string,
    channelId: string,
    options: CoordinationPageOptions = {},
  ): Promise<CoordinationAddressListResult> {
    assertCoordinationAddressListRequest(channelId, options)
    const scanned = await this.#scan(
      applicationId,
      botId,
      channelId,
      options,
    )
    const allDiscarded = emptyDiscardCounts()
    const observations = new Map<string, CoordinationAddressObservation>()
    let coordinationNoteCount = 0
    for (const message of scanned.ordered) {
      if (message.author.id !== botId || message.author.bot !== true || message.webhook_id) {
        allDiscarded.unsupportedAuthorOrWebhook += 1
        continue
      }
      const envelope = parseCoordinationNote(message.content)
      if (!envelope) {
        allDiscarded[notePrefix(message.content) ? "malformedEnvelope" : "nonNote"] += 1
        continue
      }
      if (!isPlainCoordinationMessage(
        message,
        envelope,
        channelId,
        scanned.guildId,
      )) {
        allDiscarded.unsupportedMessageShape += 1
        continue
      }
      coordinationNoteCount += 1
      const existing = observations.get(envelope.fromAddress)
      observations.set(envelope.fromAddress, existing
        ? {
            ...existing,
            lastMessageIdInPage: message.id,
            lastObservedAtInPage: message.timestamp,
            noteCountInPage: existing.noteCountInPage + 1,
          }
        : {
            address: envelope.fromAddress,
            firstObservedAtInPage: message.timestamp,
            lastMessageIdInPage: message.id,
            lastObservedAtInPage: message.timestamp,
            noteCountInPage: 1,
          })
    }
    const {
      differentRecipient: _differentRecipient,
      filteredSender: _filteredSender,
      filteredTag: _filteredTag,
      resolvedByConvention: _resolvedByConvention,
      ...discarded
    } = allDiscarded
    const addresses = [...observations.values()].sort((left, right) => (
      left.address.localeCompare(right.address)
    ))
    return {
      addresses,
      applicationId,
      botId,
      channel: {
        id: scanned.channel.id,
        parentId: scanned.channel.parent_id ?? null,
        type: scanned.channel.type,
      },
      discarded,
      format: COORDINATION_NOTE_FORMAT,
      guildId: scanned.guildId,
      page: {
        ...scanned.page,
        addressCount: addresses.length,
        coordinationNoteCount,
      },
      privacy: {
        ...privacyProjection(),
        notificationTargets: "omitted",
        noteBodies: "omitted",
        recipients: "omitted",
        tags: "omitted",
      },
      routing: routingBoundary(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }
}
