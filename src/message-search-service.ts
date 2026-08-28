import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  GuildMessageSearchOptions,
  MessagePageOptions,
} from "./discord-client.js"
import {
  ConfigurationError,
  ConversationRecallEvidenceError,
} from "./errors.js"
import {
  canonicalExplicitOffsetIso8601Timestamp,
  isExplicitOffsetIso8601Timestamp,
} from "./iso-timestamp.js"
import {
  discordMessageUrl,
  normalizeChannel,
  normalizeSearchMessage,
} from "./normalize.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
  DiscordMessageSearchIndexing,
  DiscordMessageSearchResponse,
  RequestOptions,
} from "./types.js"

const DISCORD_EPOCH_MS = 1_420_070_400_000n
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n
const RECIPROCAL_RANK_CONSTANT = 60
const RECIPROCAL_RANK_SCALE = 1_000_000
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u

type NormalizedSearchMessage = ReturnType<typeof normalizeSearchMessage>
type NormalizedSearchThread = ReturnType<typeof normalizeChannel>

export interface MessageSearchIndexingResult {
  documentsIndexed: number | null
  guildId: string
  retryAfterMs: number
  schemaVersion: number
  status: "indexing"
}

export interface MessageSearchOkResult {
  documentsIndexed: number | null
  doingDeepHistoricalIndex: boolean
  guildId: string
  messages: NormalizedSearchMessage[]
  page: {
    nextOffset: number | null
    offset: number
    requestedLimit: number
    returned: number
    totalResultsEstimate: number
  }
  schemaVersion: number
  status: "ok"
  threads: NormalizedSearchThread[]
}

export type MessageSearchResult = MessageSearchIndexingResult | MessageSearchOkResult

export interface ConversationRecallRequest {
  after?: string
  authorIds?: readonly string[]
  before?: string
  channelIds?: readonly string[]
  contextRadius?: number
  guildId: string
  limit?: number
  searchPhrases: readonly string[]
  slop?: number
}

export interface NormalizedConversationRecallRequest {
  after?: string
  authorIds?: string[]
  before?: string
  channelIds?: string[]
  contextRadius: number
  guildId: string
  limit: number
  maxId?: string
  minId?: string
  searchPhrases: string[]
  slop: number
}

export interface ConversationRecallPrivacy {
  contextProfiles: "omitted"
  persistence: "none"
  phraseText: "input-only"
  rawPayloads: "omitted"
}

export interface ConversationRecallContextMessage {
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
  replyToMessageId: string | null
  timestamp: string
  type: number
}

export interface ConversationRecallContext {
  messages: ConversationRecallContextMessage[]
  newestMessageId: string
  oldestMessageId: string
  targetOrdinal: number
}

export interface ConversationRecallMatch {
  channelId: string
  context: ConversationRecallContext
  matchedPhraseIndexes: number[]
  messageId: string
  rank: number
}

export interface ConversationRecallSearchEvidence {
  documentsIndexed: number | null
  phraseIndex: number
  returned: number
  totalResultsEstimate: number
}

export interface ConversationRecallIndexingResult {
  attemptedPhraseCount: number
  documentsIndexed: number | null
  guildId: string
  privacy: ConversationRecallPrivacy
  retryAfterMs: number
  schemaVersion: number
  searchedPhraseCount: number
  status: "indexing"
}

export interface ConversationRecallOkResult {
  attemptedPhraseCount: number
  contextRadius: number
  doingDeepHistoricalIndex: boolean
  guildId: string
  limitations: readonly string[]
  matches: ConversationRecallMatch[]
  privacy: ConversationRecallPrivacy
  requestedLimit: number
  schemaVersion: number
  searchedPhraseCount: number
  searches: ConversationRecallSearchEvidence[]
  status: "ok"
}

export type ConversationRecallResult =
  | ConversationRecallIndexingResult
  | ConversationRecallOkResult

export interface MessageSearchServiceClient {
  getChannel(
    channelId: string,
    options?: RequestOptions,
  ): Promise<DiscordChannel>
  listMessages(
    channelId: string,
    options?: MessagePageOptions,
  ): Promise<DiscordMessage[]>
  searchGuildMessages(
    guildId: string,
    options?: GuildMessageSearchOptions,
  ): Promise<DiscordMessageSearchIndexing | DiscordMessageSearchResponse>
}

export interface MessageSearchServiceOptions {
  client: MessageSearchServiceClient
  policy: Pick<
    ScopePolicy,
    | "assertChannelReadable"
    | "assertGuildAllowed"
    | "channelIdReadable"
    | "constrainSearchChannelIds"
  >
}

interface RecallCandidate {
  message: NormalizedSearchMessage
  phraseIndexes: Set<number>
  reciprocalRankScore: number
}

const CONVERSATION_RECALL_PRIVACY: ConversationRecallPrivacy = Object.freeze({
  contextProfiles: "omitted" as const,
  persistence: "none" as const,
  phraseText: "input-only" as const,
  rawPayloads: "omitted" as const,
})

const CONVERSATION_RECALL_LIMITATIONS = Object.freeze([
  "Recall depends on the caller-supplied literal phrase variants and is not semantic or embedding search.",
  "Discord search result totals are estimates and indexed history can be incomplete or still building.",
  "Each returned context is a bounded current point-in-time page, not complete conversation history.",
  "A missing or changed ranked target fails the whole result instead of presenting stale context.",
] as const)

function hasSearchFilter(options: GuildMessageSearchOptions): boolean {
  return Boolean(
    options.content?.trim()
    || options.channelIds?.length
    || options.authorIds?.length
    || options.authorTypes?.length
    || options.mentionUserIds?.length
    || options.mentionRoleIds?.length
    || options.repliedToUserIds?.length
    || options.repliedToMessageIds?.length
    || options.has?.length
    || options.embedTypes?.length
    || options.embedProviders?.length
    || options.linkHostnames?.length
    || options.attachmentFilenames?.length
    || options.attachmentExtensions?.length
    || options.minId
    || options.maxId
    || options.pinned !== undefined
    || options.mentionEveryone !== undefined
  )
}

function searchIndexing(
  value: DiscordMessageSearchIndexing | unknown,
): value is DiscordMessageSearchIndexing {
  return Boolean(
    value
    && typeof value === "object"
    && "code" in value
    && value.code === 110000,
  )
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
    && BigInt(value).toString() === value
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

function normalizeSnowflakeList(
  value: unknown,
  description: string,
): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.searchFilterIds
  ) {
    throw new RangeError(
      `${description} must contain between 1 and ${CONNECTOR_LIMITS.searchFilterIds} exact IDs`,
    )
  }
  const seen = new Set<string>()
  return value.map((entry, index) => {
    assertPositiveSnowflake(entry, `${description} entry ${index + 1}`)
    if (seen.has(entry)) throw new RangeError(`${description} must be unique`)
    seen.add(entry)
    return entry
  })
}

export function conversationRecallTimestampSnowflake(
  value: unknown,
  description: string,
): { snowflake: string; timestamp: string } {
  const timestamp = canonicalExplicitOffsetIso8601Timestamp(value, description)
  const milliseconds = BigInt(Date.parse(timestamp))
  if (milliseconds <= DISCORD_EPOCH_MS) {
    throw new RangeError(`${description} must be after the Discord epoch`)
  }
  const snowflake = (milliseconds - DISCORD_EPOCH_MS) << SNOWFLAKE_TIMESTAMP_SHIFT
  if (snowflake > DISCORD_SNOWFLAKE_MAX) {
    throw new RangeError(`${description} exceeds the Discord snowflake range`)
  }
  return { snowflake: snowflake.toString(), timestamp }
}

export function normalizeConversationRecallRequest(
  request: ConversationRecallRequest,
): NormalizedConversationRecallRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord conversation recall request must be an object")
  }
  assertPositiveSnowflake(request.guildId, "Discord conversation recall guild ID")
  if (
    !Array.isArray(request.searchPhrases)
    || request.searchPhrases.length < 1
    || request.searchPhrases.length > CONNECTOR_LIMITS.conversationRecallPhrases
  ) {
    throw new RangeError(
      `Discord conversation recall requires between 1 and ${CONNECTOR_LIMITS.conversationRecallPhrases} search phrases`,
    )
  }
  const seenPhrases = new Set<string>()
  const searchPhrases = request.searchPhrases.map((phrase, index) => {
    if (
      typeof phrase !== "string"
      || phrase.length < 1
      || phrase.length > DISCORD_LIMITS.searchContentCharacters
      || phrase.trim() !== phrase
      || CONTROL_CHARACTERS.test(phrase)
    ) {
      throw new RangeError(
        `Discord conversation recall phrase ${index + 1} must be nonblank trimmed text without controls and at most ${DISCORD_LIMITS.searchContentCharacters} characters`,
      )
    }
    if (seenPhrases.has(phrase)) {
      throw new RangeError("Discord conversation recall search phrases must be unique")
    }
    seenPhrases.add(phrase)
    return phrase
  })
  if (
    searchPhrases.reduce((total, phrase) => total + phrase.length, 0)
    > CONNECTOR_LIMITS.conversationRecallPhraseCharactersTotal
  ) {
    throw new RangeError(
      `Discord conversation recall phrases may contain at most ${CONNECTOR_LIMITS.conversationRecallPhraseCharactersTotal} total characters`,
    )
  }
  const after = request.after === undefined
    ? undefined
    : conversationRecallTimestampSnowflake(
        request.after,
        "Discord conversation recall after timestamp",
      )
  const before = request.before === undefined
    ? undefined
    : conversationRecallTimestampSnowflake(
        request.before,
        "Discord conversation recall before timestamp",
      )
  if (after && before && Date.parse(after.timestamp) >= Date.parse(before.timestamp)) {
    throw new RangeError("Discord conversation recall after timestamp must precede before timestamp")
  }
  const authorIds = normalizeSnowflakeList(
    request.authorIds,
    "Discord conversation recall author IDs",
  )
  const channelIds = normalizeSnowflakeList(
    request.channelIds,
    "Discord conversation recall channel IDs",
  )
  return {
    ...(after ? { after: after.timestamp, minId: after.snowflake } : {}),
    ...(authorIds ? { authorIds } : {}),
    ...(before ? { before: before.timestamp, maxId: before.snowflake } : {}),
    ...(channelIds ? { channelIds } : {}),
    contextRadius: request.contextRadius === undefined
      ? CONNECTOR_LIMITS.conversationRecallContextRadiusDefault
      : boundedInteger(
          request.contextRadius,
          1,
          CONNECTOR_LIMITS.conversationRecallContextRadius,
          "Discord conversation recall context radius",
        ),
    guildId: request.guildId,
    limit: request.limit === undefined
      ? CONNECTOR_LIMITS.conversationRecallMatches
      : boundedInteger(
          request.limit,
          1,
          CONNECTOR_LIMITS.conversationRecallMatches,
          "Discord conversation recall match limit",
        ),
    searchPhrases,
    slop: request.slop === undefined
      ? CONNECTOR_LIMITS.conversationRecallSlopDefault
      : boundedInteger(
          request.slop,
          0,
          DISCORD_LIMITS.searchSlop,
          "Discord conversation recall slop",
        ),
  }
}

function compareCandidate(a: RecallCandidate, b: RecallCandidate): number {
  return b.phraseIndexes.size - a.phraseIndexes.size
    || b.reciprocalRankScore - a.reciprocalRankScore
    || Date.parse(b.message.timestamp) - Date.parse(a.message.timestamp)
    || (BigInt(b.message.id) > BigInt(a.message.id)
      ? 1
      : BigInt(b.message.id) < BigInt(a.message.id) ? -1 : 0)
}

function projectContextMessage(
  message: DiscordMessage,
  guildId: string,
): ConversationRecallContextMessage {
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
    replyToMessageId: message.message_reference?.message_id ?? null,
    timestamp: message.timestamp,
    type: message.type,
  }
}

function targetMatchesSearch(
  target: DiscordMessage,
  search: NormalizedSearchMessage,
): boolean {
  return target.id === search.id
    && target.channel_id === search.channelId
    && target.author.id === search.author.id
    && (target.author.bot === true) === search.author.bot
    && target.content === search.content
    && target.timestamp === search.timestamp
    && (target.edited_timestamp ?? null) === search.editedTimestamp
    && target.type === search.type
    && (target.attachments?.length ?? 0) === search.attachmentCount
    && (target.embeds?.length ?? 0) === search.embedCount
    && (target.components?.length ?? 0) === search.componentCount
}

function searchSnapshotsMatch(
  first: NormalizedSearchMessage,
  second: NormalizedSearchMessage,
): boolean {
  return first.id === second.id
    && first.channelId === second.channelId
    && first.guildId === second.guildId
    && first.author.id === second.author.id
    && first.author.bot === second.author.bot
    && first.content === second.content
    && first.timestamp === second.timestamp
    && first.editedTimestamp === second.editedTimestamp
    && first.type === second.type
    && first.attachmentCount === second.attachmentCount
    && first.embedCount === second.embedCount
    && first.componentCount === second.componentCount
}

function validSearchMessageEvidence(
  message: NormalizedSearchMessage,
  guildId: string,
): boolean {
  return Boolean(
    message
    && typeof message === "object"
    && positiveSnowflake(message.id)
    && positiveSnowflake(message.channelId)
    && message.guildId === guildId
    && message.author
    && positiveSnowflake(message.author.id)
    && typeof message.author.bot === "boolean"
    && typeof message.content === "string"
    && isExplicitOffsetIso8601Timestamp(message.timestamp)
    && (
      message.editedTimestamp === null
      || isExplicitOffsetIso8601Timestamp(message.editedTimestamp)
    )
    && Number.isSafeInteger(message.type)
    && message.type >= 0
    && Number.isSafeInteger(message.attachmentCount)
    && message.attachmentCount >= 0
    && Number.isSafeInteger(message.embedCount)
    && message.embedCount >= 0
    && Number.isSafeInteger(message.componentCount)
    && message.componentCount >= 0
  )
}

function validContextMessageEvidence(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
): boolean {
  return Boolean(
    message
    && typeof message === "object"
    && !Array.isArray(message)
    && positiveSnowflake(message.id)
    && message.channel_id === channelId
    && (message.guild_id === undefined || message.guild_id === guildId)
    && message.author
    && typeof message.author === "object"
    && !Array.isArray(message.author)
    && positiveSnowflake(message.author.id)
    && (message.author.bot === undefined || typeof message.author.bot === "boolean")
    && (message.author.system === undefined || typeof message.author.system === "boolean")
    && typeof message.content === "string"
    && (message.attachments === undefined || Array.isArray(message.attachments))
    && (message.embeds === undefined || Array.isArray(message.embeds))
    && (message.components === undefined || Array.isArray(message.components))
    && isExplicitOffsetIso8601Timestamp(message.timestamp)
    && (
      message.edited_timestamp === undefined
      || message.edited_timestamp === null
      || isExplicitOffsetIso8601Timestamp(message.edited_timestamp)
    )
    && Number.isSafeInteger(message.type)
    && message.type >= 0
    && (
      message.message_reference === undefined
      || (
        message.message_reference
        && typeof message.message_reference === "object"
        && !Array.isArray(message.message_reference)
        && (
          message.message_reference.message_id === undefined
          || message.message_reference.message_id === null
          || positiveSnowflake(message.message_reference.message_id)
        )
      )
    )
  )
}

export class MessageSearchService {
  readonly #client: MessageSearchServiceClient
  readonly #policy: MessageSearchServiceOptions["policy"]

  constructor(options: MessageSearchServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async search(
    guildId: string,
    options: GuildMessageSearchOptions = {},
  ): Promise<MessageSearchResult> {
    this.#policy.assertGuildAllowed(guildId)
    if (!hasSearchFilter(options)) {
      throw new ConfigurationError("Discord message search requires at least one substantive filter")
    }
    const channelIds = this.#policy.constrainSearchChannelIds(
      options.channelIds,
      DISCORD_LIMITS.searchChannelIds,
    )
    const response = await this.#client.searchGuildMessages(guildId, {
      ...options,
      ...(channelIds ? { channelIds } : {}),
    })
    if (searchIndexing(response)) {
      return {
        documentsIndexed: response.documents_indexed ?? null,
        guildId,
        retryAfterMs: Math.max(0, Math.ceil(response.retry_after * 1_000)),
        schemaVersion: SCHEMA_VERSION,
        status: "indexing",
      }
    }

    const responseThreads = (response.threads || []).filter((thread) => (
      !thread.guild_id || thread.guild_id === guildId
    ))
    const threadParents = new Map(
      responseThreads.map((thread) => [thread.id, thread.parent_id ?? null]),
    )
    const outboundChannelIds = channelIds ? new Set(channelIds) : undefined
    const messagesById = new Map<string, DiscordMessage>()
    for (const message of response.messages.flat()) {
      if (message.guild_id && message.guild_id !== guildId) continue
      const parentId = threadParents.get(message.channel_id)
      if (
        outboundChannelIds
        && !outboundChannelIds.has(message.channel_id)
        && !(parentId && outboundChannelIds.has(parentId))
      ) continue
      if (!this.#policy.channelIdReadable(message.channel_id, parentId)) continue
      if (!messagesById.has(message.id)) messagesById.set(message.id, message)
    }
    const requestedLimit = options.limit ?? DISCORD_LIMITS.guildMessageSearch
    const messages = [...messagesById.values()]
      .slice(0, requestedLimit)
      .map((message) => normalizeSearchMessage(message, guildId))
    const returnedChannelIds = new Set(messages.map((message) => message.channelId))
    const threads = responseThreads
      .filter((thread) => returnedChannelIds.has(thread.id))
      .filter((thread) => this.#policy.channelIdReadable(thread.id, thread.parent_id))
      .map((thread) => normalizeChannel({
        ...thread,
        guild_id: thread.guild_id || guildId,
      }))
    const offset = options.offset ?? 0
    const candidateNextOffset = offset + requestedLimit
    const nextOffset = candidateNextOffset <= DISCORD_LIMITS.searchOffset
      && candidateNextOffset < response.total_results
      ? candidateNextOffset
      : null
    return {
      documentsIndexed: response.documents_indexed ?? null,
      doingDeepHistoricalIndex: response.doing_deep_historical_index,
      guildId,
      messages,
      page: {
        nextOffset,
        offset,
        requestedLimit,
        returned: messages.length,
        totalResultsEstimate: response.total_results,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      threads,
    }
  }

  async #context(
    candidate: RecallCandidate,
    guildId: string,
    contextRadius: number,
    options: RequestOptions,
  ): Promise<ConversationRecallContext> {
    const channelId = candidate.message.channelId
    const channel = await this.#client.getChannel(channelId, options)
    if (
      channel.id !== channelId
      || (channel.nsfw !== undefined && typeof channel.nsfw !== "boolean")
      || channel.nsfw === true
    ) {
      throw new ConversationRecallEvidenceError(
        "Discord conversation recall target channel changed or became age-restricted",
      )
    }
    if (this.#policy.assertChannelReadable(channel) !== guildId) {
      throw new ConversationRecallEvidenceError(
        "Discord conversation recall target channel belongs to another guild",
      )
    }
    const requestedLimit = contextRadius * 2 + 1
    const messages = await this.#client.listMessages(channelId, {
      around: candidate.message.id,
      limit: requestedLimit,
      ...options,
    })
    if (messages.length > requestedLimit) {
      throw new ConversationRecallEvidenceError(
        "Discord returned invalid conversation recall context evidence",
      )
    }
    const seen = new Set<string>()
    for (const message of messages) {
      if (
        !validContextMessageEvidence(message, channelId, guildId)
        || seen.has(message.id)
      ) {
        throw new ConversationRecallEvidenceError(
          "Discord returned invalid conversation recall context evidence",
        )
      }
      seen.add(message.id)
    }
    const targets = messages.filter((message) => message.id === candidate.message.id)
    if (targets.length !== 1 || !targetMatchesSearch(targets[0]!, candidate.message)) {
      throw new ConversationRecallEvidenceError(
        "Discord conversation recall target changed after indexed search",
      )
    }
    const ordered = [...messages].sort((a, b) => (
      BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0
    ))
    const targetIndex = ordered.findIndex((message) => message.id === candidate.message.id)
    return {
      messages: ordered.map((message) => projectContextMessage(message, guildId)),
      newestMessageId: ordered.at(-1)?.id ?? candidate.message.id,
      oldestMessageId: ordered[0]?.id ?? candidate.message.id,
      targetOrdinal: targetIndex + 1,
    }
  }

  async recall(
    request: ConversationRecallRequest,
    options: RequestOptions = {},
  ): Promise<ConversationRecallResult> {
    const normalized = normalizeConversationRecallRequest(request)
    const candidates = new Map<string, RecallCandidate>()
    const searches: ConversationRecallSearchEvidence[] = []
    let doingDeepHistoricalIndex = false

    for (const [index, phrase] of normalized.searchPhrases.entries()) {
      const result = await this.search(normalized.guildId, {
        ...(normalized.authorIds ? { authorIds: normalized.authorIds } : {}),
        ...(normalized.channelIds ? { channelIds: normalized.channelIds } : {}),
        content: phrase,
        includeNsfw: false,
        limit: CONNECTOR_LIMITS.conversationRecallPerPhraseCandidates,
        ...(normalized.maxId ? { maxId: normalized.maxId } : {}),
        ...(normalized.minId ? { minId: normalized.minId } : {}),
        offset: 0,
        ...(options.signal ? { signal: options.signal } : {}),
        slop: normalized.slop,
        sortBy: "relevance",
      })
      if (result.status === "indexing") {
        return {
          attemptedPhraseCount: index + 1,
          documentsIndexed: result.documentsIndexed,
          guildId: normalized.guildId,
          privacy: CONVERSATION_RECALL_PRIVACY,
          retryAfterMs: result.retryAfterMs,
          schemaVersion: SCHEMA_VERSION,
          searchedPhraseCount: normalized.searchPhrases.length,
          status: "indexing" as const,
        }
      }
      doingDeepHistoricalIndex ||= result.doingDeepHistoricalIndex
      searches.push({
        documentsIndexed: result.documentsIndexed,
        phraseIndex: index + 1,
        returned: result.messages.length,
        totalResultsEstimate: result.page.totalResultsEstimate,
      })
      for (const [rank, message] of result.messages.entries()) {
        if (!validSearchMessageEvidence(message, normalized.guildId)) {
          throw new ConversationRecallEvidenceError(
            "Discord returned invalid conversation recall search evidence",
          )
        }
        const key = message.id
        const score = Math.round(
          RECIPROCAL_RANK_SCALE / (RECIPROCAL_RANK_CONSTANT + rank + 1),
        )
        const existing = candidates.get(key)
        if (existing) {
          if (!searchSnapshotsMatch(existing.message, message)) {
            throw new ConversationRecallEvidenceError(
              "Discord returned inconsistent conversation recall search evidence",
            )
          }
          existing.phraseIndexes.add(index + 1)
          existing.reciprocalRankScore += score
        } else {
          candidates.set(key, {
            message,
            phraseIndexes: new Set([index + 1]),
            reciprocalRankScore: score,
          })
        }
      }
    }

    const ranked = [...candidates.values()]
      .sort(compareCandidate)
      .slice(0, normalized.limit)
    const matches: ConversationRecallMatch[] = []
    for (const [index, candidate] of ranked.entries()) {
      matches.push({
        channelId: candidate.message.channelId,
        context: await this.#context(
          candidate,
          normalized.guildId,
          normalized.contextRadius,
          options,
        ),
        matchedPhraseIndexes: [...candidate.phraseIndexes].sort((a, b) => a - b),
        messageId: candidate.message.id,
        rank: index + 1,
      })
    }

    return {
      attemptedPhraseCount: normalized.searchPhrases.length,
      contextRadius: normalized.contextRadius,
      doingDeepHistoricalIndex,
      guildId: normalized.guildId,
      limitations: CONVERSATION_RECALL_LIMITATIONS,
      matches,
      privacy: CONVERSATION_RECALL_PRIVACY,
      requestedLimit: normalized.limit,
      schemaVersion: SCHEMA_VERSION,
      searchedPhraseCount: normalized.searchPhrases.length,
      searches,
      status: "ok" as const,
    }
  }
}
