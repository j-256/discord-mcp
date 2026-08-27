import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_TYPES,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { MessagePageOptions } from "./discord-client.js"
import { CommunityActivityEvidenceError } from "./errors.js"
import { canonicalExplicitOffsetIso8601Timestamp } from "./iso-timestamp.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"

export interface CommunityActivityChannelSelection {
  beforeMessageId?: string
  channelId: string
}

export interface CommunityActivityRequest {
  channels: readonly CommunityActivityChannelSelection[]
  guildId: string
  maxMessagesPerChannel?: number
}

export interface NormalizedCommunityActivityRequest {
  channels: CommunityActivityChannelSelection[]
  guildId: string
  maxMessagesPerChannel: number
}

export interface CommunityActivityServiceClient {
  getChannel(
    channelId: string,
    options?: RequestOptions,
  ): Promise<DiscordChannel>
  listMessages(
    channelId: string,
    options?: MessagePageOptions,
  ): Promise<DiscordMessage[]>
}

export interface CommunityActivityServiceOptions {
  client: CommunityActivityServiceClient
  policy: Pick<ScopePolicy, "assertChannelReadable" | "assertGuildAllowed">
}

type AuthorKind = "bot" | "human" | "system" | "webhook"

interface ActivityAuthor {
  id: string
  kind: AuthorKind
}

interface ActivityReplyTarget {
  author: ActivityAuthor
  id: string
  timestamp: string
  timestampMs: number
  type: number
}

interface ActivityReply {
  resolvedTarget: ActivityReplyTarget | null
  targetId: string
}

interface ActivityMessage {
  author: ActivityAuthor
  channelId: string
  id: string
  reply: ActivityReply | null
  timestamp: string
  timestampMs: number
  type: number
}

type PaginationStop = "empty-page" | "request-limit" | "short-page"

interface ChannelSample {
  beforeMessageId: string | null
  channelId: string
  messages: ActivityMessage[]
  nextBeforeMessageId: string | null
  pagesRequested: number
  paginationStop: PaginationStop
}

const WEEKDAYS = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const)

const COMMUNITY_ACTIVITY_PRIVACY = Object.freeze({
  content: "not-used" as const,
  identities: "transient-aggregate-only" as const,
  names: "omitted" as const,
  persistence: "none" as const,
  profiles: "omitted" as const,
  rawPayloads: "omitted" as const,
})

const COMMUNITY_ACTIVITY_LIMITATIONS = Object.freeze([
  "A bounded message sample does not establish whole-community behavior or causality.",
  "Explicit replies undercount conversational responses that do not use Discord's Reply action.",
  "Reply latency covers only targets present in the sample or resolved by Discord.",
  "A short or empty page does not prove complete history because Discord can return no messages when Read Message History is unavailable.",
  "UTC activity distributions may not match participants' local time zones.",
  "Message content is not used, so themes, topics, sentiment, and intent are outside this analysis.",
] as const)

const COMMUNITY_ACTIVITY_DEFINITIONS = Object.freeze({
  explicitHumanReply: "A Discord Reply authored by a human participant with a different resolved human target.",
  humanParticipant: "An ordinary Discord message author that is not a bot, system user, or webhook.",
  multiDayParticipant: "A human participant with sampled messages on at least two UTC dates.",
  participantMessageShare: "The selected participants' human-message count divided by all sampled human messages.",
  reciprocalPair: "An unordered human-participant pair with observed explicit replies in both directions.",
  replyLatency: "Elapsed seconds from a resolved target message to a later explicit human reply, summarized with nearest-rank percentiles.",
})

function evidenceError(message: string): CommunityActivityEvidenceError {
  return new CommunityActivityEvidenceError(message)
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(
  value: unknown,
  description: string,
): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${description} must be an exact positive Discord snowflake`)
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  description: string,
): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new RangeError(`${description} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

export function normalizeCommunityActivityRequest(
  request: CommunityActivityRequest,
): NormalizedCommunityActivityRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord community activity request must be an object")
  }
  assertPositiveSnowflake(request.guildId, "Discord community activity guild ID")
  if (
    !Array.isArray(request.channels)
    || request.channels.length < 1
    || request.channels.length > CONNECTOR_LIMITS.communityActivityChannels
  ) {
    throw new RangeError(
      `Discord community activity requires between 1 and ${CONNECTOR_LIMITS.communityActivityChannels} channel selections`,
    )
  }
  const seen = new Set<string>()
  const channels = request.channels.map((selection, index) => {
    if (!selection || typeof selection !== "object") {
      throw new RangeError(`Discord community activity channel selection ${index + 1} must be an object`)
    }
    assertPositiveSnowflake(
      selection.channelId,
      `Discord community activity channel selection ${index + 1} ID`,
    )
    if (seen.has(selection.channelId)) {
      throw new RangeError("Discord community activity channel selections must be unique")
    }
    seen.add(selection.channelId)
    if (selection.beforeMessageId !== undefined) {
      assertPositiveSnowflake(
        selection.beforeMessageId,
        `Discord community activity channel selection ${index + 1} cursor`,
      )
    }
    return {
      ...(selection.beforeMessageId
        ? { beforeMessageId: selection.beforeMessageId }
        : {}),
      channelId: selection.channelId,
    }
  })
  const maxMessagesPerChannel = request.maxMessagesPerChannel === undefined
    ? CONNECTOR_LIMITS.communityActivityMessagesDefault
    : boundedInteger(
        request.maxMessagesPerChannel,
        1,
        CONNECTOR_LIMITS.communityActivityMessagesPerChannel,
        "Discord community activity messages per channel",
      )
  if (
    channels.length * maxMessagesPerChannel
    > CONNECTOR_LIMITS.communityActivityMessagesTotal
  ) {
    throw new RangeError(
      `Discord community activity requests may inspect at most ${CONNECTOR_LIMITS.communityActivityMessagesTotal} messages`,
    )
  }
  return {
    channels,
    guildId: request.guildId,
    maxMessagesPerChannel,
  }
}

function projectAuthor(
  value: unknown,
  webhookId: unknown,
  description: string,
): ActivityAuthor {
  if (!value || typeof value !== "object") {
    throw evidenceError(`${description} author evidence is malformed`)
  }
  const author = value as Record<string, unknown>
  if (!positiveSnowflake(author.id)) {
    throw evidenceError(`${description} author ID is malformed`)
  }
  if (author.bot !== undefined && typeof author.bot !== "boolean") {
    throw evidenceError(`${description} bot evidence is malformed`)
  }
  if (author.system !== undefined && typeof author.system !== "boolean") {
    throw evidenceError(`${description} system-user evidence is malformed`)
  }
  if (webhookId !== undefined && !positiveSnowflake(webhookId)) {
    throw evidenceError(`${description} webhook ID is malformed`)
  }
  const kind: AuthorKind = webhookId !== undefined
    ? "webhook"
    : author.bot === true
      ? "bot"
      : author.system === true
        ? "system"
        : "human"
  return { id: author.id, kind }
}

function projectTimestamp(value: unknown, description: string) {
  try {
    const timestamp = canonicalExplicitOffsetIso8601Timestamp(value, description)
    return { timestamp, timestampMs: Date.parse(timestamp) }
  } catch {
    throw evidenceError(`${description} is malformed`)
  }
}

function projectResolvedReplyTarget(
  value: unknown,
  targetId: string,
  channelId: string,
  guildId: string,
): ActivityReplyTarget | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "object") {
    throw evidenceError("Discord resolved reply target is malformed")
  }
  const target = value as Record<string, unknown>
  if (target.id !== targetId) {
    throw evidenceError("Discord resolved a different reply target")
  }
  if (target.channel_id !== channelId) {
    throw evidenceError("Discord resolved a reply target in a different channel")
  }
  if (target.guild_id !== undefined && target.guild_id !== guildId) {
    throw evidenceError("Discord resolved a reply target in a different guild")
  }
  if (!Number.isSafeInteger(target.type) || Number(target.type) < 0) {
    throw evidenceError("Discord resolved reply target type is malformed")
  }
  const author = projectAuthor(
    target.author,
    target.webhook_id,
    "Discord resolved reply target",
  )
  const { timestamp, timestampMs } = projectTimestamp(
    target.timestamp,
    "Discord resolved reply target timestamp",
  )
  return {
    author,
    id: targetId,
    timestamp,
    timestampMs,
    type: Number(target.type),
  }
}

function projectReply(
  message: Record<string, unknown>,
  channelId: string,
  guildId: string,
): ActivityReply {
  if (!message.message_reference || typeof message.message_reference !== "object") {
    throw evidenceError("Discord reply reference is missing or malformed")
  }
  const reference = message.message_reference as Record<string, unknown>
  if (reference.type !== undefined && reference.type !== 0) {
    throw evidenceError("Discord reply reference type is unsupported")
  }
  if (!positiveSnowflake(reference.message_id)) {
    throw evidenceError("Discord reply target ID is malformed")
  }
  if (reference.channel_id !== channelId) {
    throw evidenceError("Discord reply reference identifies a different channel")
  }
  if (reference.guild_id !== guildId) {
    throw evidenceError("Discord reply reference identifies a different guild")
  }
  return {
    resolvedTarget: projectResolvedReplyTarget(
      message.referenced_message,
      reference.message_id,
      channelId,
      guildId,
    ),
    targetId: reference.message_id,
  }
}

function projectMessage(
  value: unknown,
  channelId: string,
  guildId: string,
): ActivityMessage {
  if (!value || typeof value !== "object") {
    throw evidenceError("Discord community activity message evidence is malformed")
  }
  const message = value as Record<string, unknown>
  if (!positiveSnowflake(message.id)) {
    throw evidenceError("Discord community activity message ID is malformed")
  }
  if (message.channel_id !== channelId) {
    throw evidenceError("Discord returned community activity outside the requested channel")
  }
  if (message.guild_id !== undefined && message.guild_id !== guildId) {
    throw evidenceError("Discord returned community activity outside the requested guild")
  }
  if (!Number.isSafeInteger(message.type) || Number(message.type) < 0) {
    throw evidenceError("Discord community activity message type is malformed")
  }
  const author = projectAuthor(
    message.author,
    message.webhook_id,
    "Discord community activity message",
  )
  const { timestamp, timestampMs } = projectTimestamp(
    message.timestamp,
    "Discord community activity message timestamp",
  )
  const type = Number(message.type)
  return {
    author,
    channelId,
    id: message.id,
    reply: type === DISCORD_MESSAGE_TYPES.reply
      ? projectReply(message, channelId, guildId)
      : null,
    timestamp,
    timestampMs,
    type,
  }
}

function isConversationMessage(message: ActivityMessage): boolean {
  return message.type === DISCORD_MESSAGE_TYPES.default
    || message.type === DISCORD_MESSAGE_TYPES.reply
}

function isHumanConversationMessage(message: ActivityMessage): boolean {
  return isConversationMessage(message) && message.author.kind === "human"
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return Number((numerator / denominator).toFixed(4))
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1)
  return Number(((sorted[index] ?? 0) / 1_000).toFixed(3))
}

function oldestMessage(messages: readonly ActivityMessage[]): ActivityMessage | undefined {
  return messages.reduce<ActivityMessage | undefined>((oldest, message) => (
    !oldest || message.timestampMs < oldest.timestampMs ? message : oldest
  ), undefined)
}

function newestMessage(messages: readonly ActivityMessage[]): ActivityMessage | undefined {
  return messages.reduce<ActivityMessage | undefined>((newest, message) => (
    !newest || message.timestampMs > newest.timestampMs ? message : newest
  ), undefined)
}

function activityCounts(messages: readonly ActivityMessage[]) {
  let botMessages = 0
  let humanMessages = 0
  let nonConversationMessages = 0
  let otherConversationMessages = 0
  let webhookMessages = 0
  const humanParticipants = new Set<string>()
  for (const message of messages) {
    if (!isConversationMessage(message)) {
      nonConversationMessages += 1
    } else if (message.author.kind === "human") {
      humanMessages += 1
      humanParticipants.add(message.author.id)
    } else if (message.author.kind === "bot") {
      botMessages += 1
    } else if (message.author.kind === "webhook") {
      webhookMessages += 1
    } else {
      otherConversationMessages += 1
    }
  }
  return {
    botMessages,
    conversationMessages: messages.length - nonConversationMessages,
    humanMessages,
    humanParticipants: humanParticipants.size,
    nonConversationMessages,
    otherConversationMessages,
    webhookMessages,
  }
}

function resolvedReplyTarget(
  message: ActivityMessage,
  messagesById: ReadonlyMap<string, ActivityMessage>,
): ActivityReplyTarget | null {
  if (!message.reply) return null
  const sampledTarget = messagesById.get(message.reply.targetId)
  const embeddedTarget = message.reply.resolvedTarget
  if (sampledTarget && embeddedTarget && (
    sampledTarget.author.id !== embeddedTarget.author.id
    || sampledTarget.author.kind !== embeddedTarget.author.kind
    || sampledTarget.timestampMs !== embeddedTarget.timestampMs
    || sampledTarget.type !== embeddedTarget.type
  )) {
    throw evidenceError("Discord sampled and resolved reply target evidence conflicts")
  }
  if (sampledTarget) {
    return {
      author: sampledTarget.author,
      id: sampledTarget.id,
      timestamp: sampledTarget.timestamp,
      timestampMs: sampledTarget.timestampMs,
      type: sampledTarget.type,
    }
  }
  return embeddedTarget
}

function summarizeActivity(samples: readonly ChannelSample[]) {
  const messages = samples.flatMap((sample) => sample.messages)
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const counts = activityCounts(messages)
  const authorMessageCounts = new Map<string, number>()
  const authorDates = new Map<string, Set<string>>()
  const activeDates = new Set<string>()
  const weekdayMessages = Array.from({ length: WEEKDAYS.length }, () => 0)
  const hourMessages = Array.from({ length: 24 }, () => 0)
  for (const message of messages) {
    if (!isHumanConversationMessage(message)) continue
    const date = message.timestamp.slice(0, 10)
    const timestamp = new Date(message.timestampMs)
    activeDates.add(date)
    authorMessageCounts.set(
      message.author.id,
      (authorMessageCounts.get(message.author.id) ?? 0) + 1,
    )
    const dates = authorDates.get(message.author.id) ?? new Set<string>()
    dates.add(date)
    authorDates.set(message.author.id, dates)
    const weekday = timestamp.getUTCDay()
    const hour = timestamp.getUTCHours()
    weekdayMessages[weekday] = (weekdayMessages[weekday] ?? 0) + 1
    hourMessages[hour] = (hourMessages[hour] ?? 0) + 1
  }

  const rankedAuthorCounts = [...authorMessageCounts.values()]
    .sort((left, right) => right - left)
  const multiDayParticipants = [...authorDates.values()]
    .filter((dates) => dates.size >= 2).length
  const responseLatencies: number[] = []
  const directedRelationships = new Set<string>()
  const sampledTargetsReceivingReply = new Set<string>()
  let humanAuthoredExplicitReplies = 0
  let humanToDifferentHumanReplies = 0
  let nonHumanTargetReplies = 0
  let selfReplies = 0
  let unresolvedTargetReplies = 0
  for (const message of messages) {
    if (!isHumanConversationMessage(message) || !message.reply) continue
    humanAuthoredExplicitReplies += 1
    const target = resolvedReplyTarget(message, messagesById)
    if (!target) {
      unresolvedTargetReplies += 1
      continue
    }
    if (
      target.author.kind !== "human"
      || !(target.type === DISCORD_MESSAGE_TYPES.default
        || target.type === DISCORD_MESSAGE_TYPES.reply)
    ) {
      nonHumanTargetReplies += 1
      continue
    }
    if (target.author.id === message.author.id) {
      selfReplies += 1
      continue
    }
    const latency = message.timestampMs - target.timestampMs
    if (latency < 0) {
      throw evidenceError("Discord reply timestamp precedes its resolved target")
    }
    humanToDifferentHumanReplies += 1
    responseLatencies.push(latency)
    directedRelationships.add(`${message.author.id}:${target.author.id}`)
    if (messagesById.has(target.id)) sampledTargetsReceivingReply.add(target.id)
  }

  const participantPairs = new Map<string, Set<string>>()
  for (const relationship of directedRelationships) {
    const [source, target] = relationship.split(":") as [string, string]
    const pair = BigInt(source) < BigInt(target)
      ? `${source}:${target}`
      : `${target}:${source}`
    const directions = participantPairs.get(pair) ?? new Set<string>()
    directions.add(relationship)
    participantPairs.set(pair, directions)
  }
  const reciprocalPairs = [...participantPairs.values()]
    .filter((directions) => directions.size === 2).length

  return {
    activity: {
      ...counts,
      activeUtcDays: activeDates.size,
      messagesFetched: messages.length,
    },
    participation: {
      multiDayParticipantRate: ratio(
        multiDayParticipants,
        counts.humanParticipants,
      ),
      multiDayParticipants,
      topFiveParticipantMessageShare: ratio(
        rankedAuthorCounts.slice(0, 5).reduce((sum, count) => sum + count, 0),
        counts.humanMessages,
      ),
      topParticipantMessageShare: ratio(
        rankedAuthorCounts[0] ?? 0,
        counts.humanMessages,
      ),
    },
    reciprocity: {
      directedRelationships: directedRelationships.size,
      participantPairs: participantPairs.size,
      reciprocalPairRate: ratio(reciprocalPairs, participantPairs.size),
      reciprocalPairs,
    },
    responsiveness: {
      humanAuthoredExplicitReplies,
      humanToDifferentHumanReplies,
      latencyPairs: responseLatencies.length,
      medianSeconds: nearestRank(responseLatencies, 0.5),
      nonHumanTargetReplies,
      p75Seconds: nearestRank(responseLatencies, 0.75),
      p90Seconds: nearestRank(responseLatencies, 0.9),
      sampledHumanMessagesReceivingReply: sampledTargetsReceivingReply.size,
      sampledHumanMessagesWithoutObservedReply: Math.max(
        0,
        counts.humanMessages - sampledTargetsReceivingReply.size,
      ),
      selfReplies,
      unresolvedTargetReplies,
    },
    timing: {
      hoursUtc: hourMessages.map((messageCount, hour) => ({
        hour,
        messageCount,
      })),
      weekdaysUtc: WEEKDAYS.map((weekday, index) => ({
        messageCount: weekdayMessages[index] ?? 0,
        weekday,
      })),
    },
  }
}

export class CommunityActivityService {
  readonly #client: CommunityActivityServiceClient
  readonly #policy: CommunityActivityServiceOptions["policy"]

  constructor(options: CommunityActivityServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async analyze(
    request: CommunityActivityRequest,
    options: RequestOptions = {},
  ) {
    const normalized = normalizeCommunityActivityRequest(request)
    this.#policy.assertGuildAllowed(normalized.guildId)
    const channels = new Map<string, DiscordChannel>()
    for (const selection of normalized.channels) {
      options.signal?.throwIfAborted()
      const channel = await this.#client.getChannel(selection.channelId, options)
      if (
        !channel
        || typeof channel !== "object"
        || channel.id !== selection.channelId
        || channel.guild_id !== normalized.guildId
      ) {
        throw evidenceError("Discord returned a different community activity channel")
      }
      const scopedGuildId = this.#policy.assertChannelReadable(channel)
      if (scopedGuildId !== normalized.guildId) {
        throw evidenceError("Discord community activity channel belongs to a different guild")
      }
      channels.set(selection.channelId, channel)
    }

    const observedMessageIds = new Set<string>()
    const samples: ChannelSample[] = []
    for (const selection of normalized.channels) {
      options.signal?.throwIfAborted()
      if (!channels.has(selection.channelId)) {
        throw evidenceError("Discord community activity channel evidence is missing")
      }
      const messages: ActivityMessage[] = []
      let before = selection.beforeMessageId
      let pagesRequested = 0
      let paginationStop: PaginationStop = "request-limit"
      let previousTimestampMs = Number.POSITIVE_INFINITY
      while (messages.length < normalized.maxMessagesPerChannel) {
        options.signal?.throwIfAborted()
        const remaining = normalized.maxMessagesPerChannel - messages.length
        const limit = Math.min(DISCORD_LIMITS.channelMessages, remaining)
        const rawPage: unknown = await this.#client.listMessages(
          selection.channelId,
          {
            ...(before ? { before } : {}),
            limit,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        )
        pagesRequested += 1
        if (!Array.isArray(rawPage) || rawPage.length > limit) {
          throw evidenceError("Discord community activity page has an invalid size")
        }
        if (rawPage.length === 0) {
          paginationStop = "empty-page"
          break
        }
        const projectedPage = rawPage.map((message) => projectMessage(
          message,
          selection.channelId,
          normalized.guildId,
        ))
        for (const message of projectedPage) {
          if (message.timestampMs > previousTimestampMs) {
            throw evidenceError("Discord community activity page is not newest to oldest")
          }
          previousTimestampMs = message.timestampMs
          if (observedMessageIds.has(message.id)) {
            throw evidenceError("Discord community activity pages contain duplicate messages")
          }
          observedMessageIds.add(message.id)
          messages.push(message)
        }
        const lastMessage = projectedPage.at(-1)
        if (!lastMessage) {
          throw evidenceError("Discord community activity page cursor is missing")
        }
        if (rawPage.length < limit) {
          paginationStop = "short-page"
          break
        }
        before = lastMessage.id
      }
      samples.push({
        beforeMessageId: selection.beforeMessageId ?? null,
        channelId: selection.channelId,
        messages,
        nextBeforeMessageId: paginationStop === "request-limit"
          ? before ?? null
          : null,
        pagesRequested,
        paginationStop,
      })
    }

    const allMessages = samples.flatMap((sample) => sample.messages)
    const oldest = oldestMessage(allMessages)
    const newest = newestMessage(allMessages)
    const summary = summarizeActivity(samples)
    return {
      ...summary,
      coverage: {
        channels: samples.map((sample) => {
          const channelCounts = activityCounts(sample.messages)
          const channelOldest = oldestMessage(sample.messages)
          const channelNewest = newestMessage(sample.messages)
          return {
            ...channelCounts,
            beforeMessageId: sample.beforeMessageId,
            channelId: sample.channelId,
            messagesFetched: sample.messages.length,
            newestObservedAt: channelNewest?.timestamp ?? null,
            nextBeforeMessageId: sample.nextBeforeMessageId,
            oldestObservedAt: channelOldest?.timestamp ?? null,
            pagesRequested: sample.pagesRequested,
            paginationStop: sample.paginationStop,
          }
        }),
        channelsRequested: samples.length,
        maximumMessages: samples.length * normalized.maxMessagesPerChannel,
        maxMessagesPerChannel: normalized.maxMessagesPerChannel,
        messagesFetched: allMessages.length,
        newestObservedAt: newest?.timestamp ?? null,
        oldestObservedAt: oldest?.timestamp ?? null,
      },
      definitions: COMMUNITY_ACTIVITY_DEFINITIONS,
      guildId: normalized.guildId,
      limitations: COMMUNITY_ACTIVITY_LIMITATIONS,
      privacy: COMMUNITY_ACTIVITY_PRIVACY,
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }
}
