import {
  createHash,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  PollActivity,
  PollActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  POLL_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  CreatePollInput,
  DiscordClient,
  PollVoterPageOptions,
} from "./discord-client.js"
import {
  DiscordApiError,
  PollEvidenceError,
  PollExecutionError,
  PollOperationConflictError,
  PollPlanChangedError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  assertDiscordBotMessage,
  assertDiscordMessageIdentity,
} from "./message-safety.js"
import {
  discordMessageUrl,
  stableString,
} from "./normalize.js"
import {
  type OperationKind,
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
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
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordPoll,
  DiscordRole,
  DiscordUser,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "poll-state-unavailable"
const POLL_LAYOUT_DEFAULT = 1
const POLL_DURATION_MILLISECONDS = 60 * 60 * 1_000
const POLL_EXPIRY_TOLERANCE_MILLISECONDS = 60_000
const POLL_END_TOLERANCE_MILLISECONDS = 5_000
const POLL_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const POLL_EMOJI_CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/u
const POLL_EMOJI_CODE_POINT_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u
const POLL_CREATE_REQUEST_KEYS = [
  "allowMultiselect",
  "answers",
  "channelId",
  "durationHours",
  "operationKey",
  "question",
] as const
const POLL_END_REQUEST_KEYS = [
  "channelId",
  "messageId",
  "operationKey",
] as const
const SUPPORTED_POLL_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const THREAD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const CREATE_TARGET_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()
const END_TARGET_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()
const CREATE_UNCERTAIN_TARGETS = new Set<string>()
const END_UNCERTAIN_TARGETS = new Set<string>()

export interface PollAnswerInput {
  emoji?: string
  text: string
}

export interface PollCreationRequest {
  allowMultiselect?: boolean
  answers: readonly PollAnswerInput[]
  channelId: string
  durationHours?: number
  operationKey: string
  question: string
}

export interface NormalizedPollCreationRequest {
  allowMultiselect: boolean
  answers: Array<{
    emoji: string | null
    text: string
  }>
  channelId: string
  durationHours: number
  operationKey: string
  operationKeyHash: string
  question: string
}

export interface PollEndRequest {
  channelId: string
  messageId: string
  operationKey: string
}

export interface NormalizedPollEndRequest extends PollEndRequest {
  operationKeyHash: string
}

export interface NormalizedPollEmoji {
  animated: boolean | null
  id: string | null
  name: string
  type: "custom" | "unicode"
}

export interface NormalizedPollAnswer {
  answerId: number
  count: number | null
  emoji: NormalizedPollEmoji | null
  meVoted: boolean | null
  text: string
}

export type PollResultState = "approximate" | "final" | "unknown"
export type PollLifecycleState = "active" | "ended" | "unknown"

export interface NormalizedPoll {
  allowMultiselect: boolean
  answers: NormalizedPollAnswer[]
  expiry: string | null
  layoutType: 1
  lifecycleState: PollLifecycleState
  question: string
  resultState: PollResultState
  resultsFinalized: boolean | null
  totalVotes: number | null
  unknownFieldCount: number
}

export interface PollReadResult {
  author: {
    bot: boolean
    id: string
    webhook: boolean
  }
  channelId: string
  createdAt: string
  editedAt: string | null
  guildId: string
  messageId: string
  poll: NormalizedPoll
  privacy: {
    persistence: "none"
    rawPayloads: "omitted"
    voterIdentities: "not-fetched"
  }
  schemaVersion: number
  status: "ok"
  url: string
}

export interface PollVoterListResult {
  answerId: number
  channelId: string
  guildId: string
  messageId: string
  page: {
    after: string | null
    nextAfter: string | null
    requestedLimit: number
    returned: number
  }
  privacy: {
    persistence: "none"
    profileFields: "omitted"
  }
  schemaVersion: number
  status: "ok"
  voterUserIds: string[]
}

export interface PollPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  permissionSourceChannelId: string
  requiredPermissionNames: DiscordPermissionName[]
}

export interface PollCreationPlan {
  applicationId: string
  botId: string
  channel: {
    guildId: string
    id: string
    parentId: string | null
    type: number
  }
  createdAt: string
  digest: string
  operationKeyHash: string
  permission: PollPermissionEvidence
  privacy: {
    persistence: "content-free-only"
    rawPayloads: "omitted"
    text: "transient"
    voterIdentities: "not-fetched"
  }
  risks: string[]
  schemaVersion: number
  status: "planned"
  target: {
    allowMultiselect: boolean
    answers: Array<{
      emoji: string | null
      text: string
    }>
    durationHours: number
    question: string
  }
  warnings: string[]
  writeRequired: true
}

export interface PollEndPlan {
  applicationId: string
  botId: string
  channel: {
    guildId: string
    id: string
    parentId: string | null
    type: number
  }
  createdAt: string
  digest: string
  messageId: string
  operationKeyHash: string
  permission: PollPermissionEvidence
  poll: NormalizedPoll
  privacy: {
    persistence: "content-free-only"
    rawPayloads: "omitted"
    text: "transient"
    voterIdentities: "not-fetched"
  }
  risks: string[]
  schemaVersion: number
  status: "already-ended" | "planned"
  warnings: string[]
  writeRequired: boolean
}

export interface PollCreationResult {
  activityId: string
  channelId: string
  expiryMatched: boolean
  guildId: string
  messageId: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  url: string
  verification: "drift" | "match"
}

export interface PollEndResult {
  activityId: string | null
  channelId: string
  finalization: "final" | "pending" | "not-required"
  guildId: string
  messageId: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  schemaVersion: number
  status: "already-ended" | "completed" | "completed-with-drift"
  url: string
  verification: "drift" | "match" | "not-required"
}

export interface PollServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "createPoll"
    | "endPoll"
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getMessage"
    | "listPollAnswerVoters"
  >
  clock?: () => Date
  limiter: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertChannelReadable"
    | "assertPollAuditable"
    | "assertPollCreatable"
    | "assertPollEndable"
    | "assertPollVotersAuditable"
  >
  randomId?: () => string
}

interface PollChannelEvidence {
  channel: DiscordChannel
  guild: DiscordGuild
  guildId: string
  member: DiscordGuildMember
  parent: DiscordChannel | null
  permission: BotChannelPermissionResult
  roles: DiscordRole[]
}

interface PollEndState extends PollChannelEvidence {
  message: DiscordMessage
  read: PollReadResult
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (!validSnowflake(value)) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function assertPollText(value: unknown, maximum: number, name: string): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || POLL_TEXT_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError(`${name} must contain 1-${maximum} trimmed characters without controls`)
  }
}

function logicalAnswerKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
}

function assertUnicodeEmoji(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || POLL_EMOJI_CONTROL_OR_SPACE_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError("Discord poll answer emoji is invalid")
  }
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
  if (segments.length !== 1 || !POLL_EMOJI_CODE_POINT_PATTERN.test(value)) {
    throw new RangeError("Discord poll answer emoji must be one Unicode emoji")
  }
}

function canonicalCreationAnswers(value: unknown): NormalizedPollCreationRequest["answers"] {
  if (
    !Array.isArray(value)
    || value.length < POLL_LIMITS.answersMinimum
    || value.length > POLL_LIMITS.answers
  ) {
    throw new RangeError(
      `Discord poll answers must contain ${POLL_LIMITS.answersMinimum}-${POLL_LIMITS.answers} entries`,
    )
  }
  const logical = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RangeError("Discord poll answers must be exact objects")
    }
    const record = entry as Record<string, unknown>
    if (!onlyKeys(record, ["emoji", "text"]) || record.text === undefined) {
      throw new RangeError("Discord poll answers contain unsupported or missing fields")
    }
    assertPollText(record.text, POLL_LIMITS.answerCharacters, "Discord poll answer")
    const key = logicalAnswerKey(record.text)
    if (logical.has(key)) {
      throw new RangeError("Discord poll answers must be logically unique")
    }
    logical.add(key)
    if (record.emoji !== undefined) assertUnicodeEmoji(record.emoji)
    return {
      emoji: record.emoji ?? null,
      text: record.text,
    }
  })
}

export function normalizePollCreationRequest(
  request: PollCreationRequest,
): NormalizedPollCreationRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord poll-creation request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, POLL_CREATE_REQUEST_KEYS)
    || record.answers === undefined
    || record.channelId === undefined
    || record.operationKey === undefined
    || record.question === undefined
    || Object.values(record).some((value) => value === undefined)
  ) {
    throw new RangeError("Discord poll-creation request contains unsupported or missing fields")
  }
  assertSnowflake(request.channelId, "Discord poll channel ID")
  assertPollText(request.question, POLL_LIMITS.questionCharacters, "Discord poll question")
  const answers = canonicalCreationAnswers(request.answers)
  const durationHours = request.durationHours ?? 24
  if (
    !Number.isInteger(durationHours)
    || durationHours < 1
    || durationHours > POLL_LIMITS.durationHours
  ) {
    throw new RangeError(
      `Discord poll duration must be an integer between 1 and ${POLL_LIMITS.durationHours} hours`,
    )
  }
  const allowMultiselect = request.allowMultiselect ?? false
  if (typeof allowMultiselect !== "boolean") {
    throw new RangeError("Discord poll multiselect setting must be a boolean")
  }
  return {
    allowMultiselect,
    answers,
    channelId: request.channelId,
    durationHours,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    question: request.question,
  }
}

export function normalizePollEndRequest(request: PollEndRequest): NormalizedPollEndRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord poll-end request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, POLL_END_REQUEST_KEYS)
    || Object.keys(record).length !== POLL_END_REQUEST_KEYS.length
    || Object.values(record).some((value) => value === undefined)
  ) {
    throw new RangeError("Discord poll-end request contains unsupported or missing fields")
  }
  assertSnowflake(request.channelId, "Discord poll channel ID")
  assertSnowflake(request.messageId, "Discord poll message ID")
  return {
    ...request,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function unknownKeyCount(value: unknown, keys: readonly string[]): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => !keys.includes(key)).length
}

function normalizeResponseEmoji(value: unknown): {
  emoji: NormalizedPollEmoji | null
  unknownFieldCount: number
} {
  if (value === undefined || value === null) {
    return { emoji: null, unknownFieldCount: 0 }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PollEvidenceError("Discord returned invalid poll answer emoji evidence")
  }
  const record = value as Record<string, unknown>
  const id = record.id ?? null
  const name = record.name ?? null
  const animated = record.animated ?? null
  if (
    !(id === null || validSnowflake(id))
    || typeof name !== "string"
    || name.length < 1
    || name.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || !validUnicode(name)
    || !(animated === null || typeof animated === "boolean")
  ) {
    throw new PollEvidenceError("Discord returned invalid poll answer emoji evidence")
  }
  if (id === null) {
    try {
      assertUnicodeEmoji(name)
    } catch (error) {
      throw new PollEvidenceError("Discord returned invalid Unicode poll emoji evidence", {
        cause: error,
      })
    }
  } else if (!/^[A-Za-z0-9_]{2,32}$/u.test(name)) {
    throw new PollEvidenceError("Discord returned invalid custom poll emoji evidence")
  }
  return {
    emoji: {
      animated,
      id,
      name,
      type: id === null ? "unicode" : "custom",
    },
    unknownFieldCount: unknownKeyCount(record, ["animated", "id", "name"]),
  }
}

function normalizeResponseMedia(
  value: unknown,
  maximum: number,
  name: string,
  allowEmoji: boolean,
): { emoji: NormalizedPollEmoji | null; text: string; unknownFieldCount: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PollEvidenceError(`Discord returned invalid ${name} media evidence`)
  }
  const record = value as Record<string, unknown>
  try {
    assertPollText(record.text, maximum, name)
  } catch (error) {
    throw new PollEvidenceError(`Discord returned invalid ${name} text evidence`, {
      cause: error,
    })
  }
  if (!allowEmoji && record.emoji !== undefined && record.emoji !== null) {
    throw new PollEvidenceError("Discord returned an unsupported poll question emoji")
  }
  const normalizedEmoji = allowEmoji
    ? normalizeResponseEmoji(record.emoji)
    : { emoji: null, unknownFieldCount: 0 }
  return {
    emoji: normalizedEmoji.emoji,
    text: record.text,
    unknownFieldCount: unknownKeyCount(record, allowEmoji ? ["emoji", "text"] : ["text"])
      + normalizedEmoji.unknownFieldCount,
  }
}

function parseTimestamp(value: unknown, name: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (
    typeof value !== "string"
    || !value.length
    || Number.isNaN(Date.parse(value))
  ) {
    throw new PollEvidenceError(`Discord returned invalid ${name} timestamp evidence`)
  }
  return value
}

function normalizePoll(value: DiscordPoll, clock: Date): NormalizedPoll {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PollEvidenceError("Discord message does not contain a valid poll")
  }
  const record = value as unknown as Record<string, unknown>
  const question = normalizeResponseMedia(
    record.question,
    POLL_LIMITS.questionCharacters,
    "poll question",
    false,
  )
  if (
    !Array.isArray(record.answers)
    || record.answers.length < POLL_LIMITS.answersMinimum
    || record.answers.length > POLL_LIMITS.answers
  ) {
    throw new PollEvidenceError("Discord returned an invalid bounded poll answer collection")
  }
  let unknownFieldCount = unknownKeyCount(record, [
    "allow_multiselect",
    "answers",
    "expiry",
    "layout_type",
    "question",
    "results",
  ]) + question.unknownFieldCount
  const answerIds = new Set<number>()
  const logicalAnswers = new Set<string>()
  const answers = record.answers.map((entry): NormalizedPollAnswer => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PollEvidenceError("Discord returned invalid poll answer evidence")
    }
    const answer = entry as Record<string, unknown>
    if (!Number.isSafeInteger(answer.answer_id) || (answer.answer_id as number) < 1) {
      throw new PollEvidenceError("Discord returned an invalid poll answer ID")
    }
    const answerId = answer.answer_id as number
    if (answerIds.has(answerId)) {
      throw new PollEvidenceError("Discord returned duplicate poll answer IDs")
    }
    answerIds.add(answerId)
    const media = normalizeResponseMedia(
      answer.poll_media,
      POLL_LIMITS.answerCharacters,
      "poll answer",
      true,
    )
    const logical = logicalAnswerKey(media.text)
    if (logicalAnswers.has(logical)) {
      throw new PollEvidenceError("Discord returned duplicate logical poll answers")
    }
    logicalAnswers.add(logical)
    unknownFieldCount += unknownKeyCount(answer, ["answer_id", "poll_media"])
      + media.unknownFieldCount
    return {
      answerId,
      count: null,
      emoji: media.emoji,
      meVoted: null,
      text: media.text,
    }
  })
  if (typeof record.allow_multiselect !== "boolean") {
    throw new PollEvidenceError("Discord returned invalid poll multiselect evidence")
  }
  if (record.layout_type !== POLL_LAYOUT_DEFAULT) {
    throw new PollEvidenceError("Discord returned an unsupported poll layout")
  }
  const expiry = parseTimestamp(record.expiry, "poll expiry", true)
  let resultState: PollResultState = "unknown"
  let resultsFinalized: boolean | null = null
  let totalVotes: number | null = null
  if (record.results !== undefined) {
    if (!record.results || typeof record.results !== "object" || Array.isArray(record.results)) {
      throw new PollEvidenceError("Discord returned invalid poll results evidence")
    }
    const results = record.results as Record<string, unknown>
    if (
      typeof results.is_finalized !== "boolean"
      || !Array.isArray(results.answer_counts)
      || results.answer_counts.length > answers.length
    ) {
      throw new PollEvidenceError("Discord returned invalid poll result counts")
    }
    unknownFieldCount += unknownKeyCount(results, ["answer_counts", "is_finalized"])
    const counts = new Map<number, { count: number; meVoted: boolean }>()
    for (const entry of results.answer_counts) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new PollEvidenceError("Discord returned invalid poll answer-count evidence")
      }
      const count = entry as Record<string, unknown>
      if (
        !Number.isSafeInteger(count.id)
        || (count.id as number) < 1
        || !answerIds.has(count.id as number)
        || counts.has(count.id as number)
        || !Number.isSafeInteger(count.count)
        || (count.count as number) < 0
        || typeof count.me_voted !== "boolean"
      ) {
        throw new PollEvidenceError("Discord returned invalid poll answer-count evidence")
      }
      unknownFieldCount += unknownKeyCount(count, ["count", "id", "me_voted"])
      counts.set(count.id as number, {
        count: count.count as number,
        meVoted: count.me_voted,
      })
    }
    totalVotes = 0
    for (const answer of answers) {
      const count = counts.get(answer.answerId) ?? { count: 0, meVoted: false }
      answer.count = count.count
      answer.meVoted = count.meVoted
      totalVotes += count.count
      if (!Number.isSafeInteger(totalVotes)) {
        throw new PollEvidenceError("Discord returned excessive poll vote counts")
      }
    }
    resultsFinalized = results.is_finalized
    resultState = results.is_finalized ? "final" : "approximate"
  }
  const lifecycleState = resultsFinalized === true
    || (expiry !== null && Date.parse(expiry) <= clock.getTime())
    ? "ended"
    : expiry === null
      ? "unknown"
      : "active"
  return {
    allowMultiselect: record.allow_multiselect,
    answers,
    expiry,
    layoutType: POLL_LAYOUT_DEFAULT,
    lifecycleState,
    question: question.text,
    resultState,
    resultsFinalized,
    totalVotes,
    unknownFieldCount,
  }
}

export function normalizeDiscordPollMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
  clock: Date,
): PollReadResult {
  assertDiscordMessageIdentity(message, channelId, guildId, messageId)
  if (
    !message.author
    || !validSnowflake(message.author.id)
    || !(message.author.bot === undefined || typeof message.author.bot === "boolean")
  ) {
    throw new PollEvidenceError("Discord returned invalid poll author evidence")
  }
  const createdAt = parseTimestamp(message.timestamp, "poll message creation") as string
  const editedAt = message.edited_timestamp === undefined || message.edited_timestamp === null
    ? null
    : parseTimestamp(message.edited_timestamp, "poll message edit") as string
  const poll = normalizePoll(message.poll as DiscordPoll, clock)
  return {
    author: {
      bot: message.author.bot === true,
      id: message.author.id,
      webhook: message.webhook_id !== undefined,
    },
    channelId,
    createdAt,
    editedAt,
    guildId,
    messageId,
    poll,
    privacy: {
      persistence: "none",
      rawPayloads: "omitted",
      voterIdentities: "not-fetched",
    },
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    url: discordMessageUrl(guildId, channelId, messageId),
  }
}

function exactChannel(value: DiscordChannel, channelId: string): DiscordChannel {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== channelId
    || !validSnowflake(value.guild_id)
    || !SUPPORTED_POLL_CHANNEL_TYPES.has(value.type)
    || !(value.parent_id === undefined || value.parent_id === null || validSnowflake(value.parent_id))
  ) {
    throw new PollEvidenceError("Discord returned invalid or unsupported poll channel evidence")
  }
  if (THREAD_CHANNEL_TYPES.has(value.type)) {
    if (
      !validSnowflake(value.parent_id)
      || !value.thread_metadata
      || typeof value.thread_metadata.archived !== "boolean"
      || typeof value.thread_metadata.locked !== "boolean"
    ) {
      throw new PollEvidenceError("Discord returned incomplete poll thread evidence")
    }
  } else if (!Array.isArray(value.permission_overwrites)) {
    throw new PollEvidenceError("Discord poll channel omitted permission-overwrite evidence")
  }
  return value
}

function exactParent(value: DiscordChannel, parentId: string, guildId: string): DiscordChannel {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== parentId
    || value.guild_id !== guildId
    || THREAD_CHANNEL_TYPES.has(value.type)
    || !Array.isArray(value.permission_overwrites)
  ) {
    throw new PollEvidenceError("Discord returned invalid poll thread-parent evidence")
  }
  return value
}

function exactGuild(value: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || typeof value.name !== "string"
    || value.name.length < 1
    || value.name.length > DISCORD_LIMITS.channelNameCharacters
    || !validSnowflake(value.owner_id)
  ) {
    throw new PollEvidenceError("Discord returned invalid poll guild evidence")
  }
  return value
}

function exactMember(value: DiscordGuildMember, botId: string): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
    || !Array.isArray(value.roles)
    || value.roles.some((roleId) => !validSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw new PollEvidenceError("Discord returned invalid connector membership for poll access")
  }
  return value
}

function exactRoles(
  value: DiscordRole[],
  guildId: string,
  member: DiscordGuildMember,
): DiscordRole[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.guildRoles
    || !value.some((role) => role?.id === guildId)
    || value.some((role) => (
      !role
      || typeof role !== "object"
      || !validSnowflake(role.id)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(role.permissions)
    ))
    || new Set(value.map((role) => role.id)).size !== value.length
  ) {
    throw new PollEvidenceError("Discord returned invalid bounded role evidence for poll access")
  }
  const roleIds = new Set(value.map((role) => role.id))
  if (member.roles.some((roleId) => !roleIds.has(roleId))) {
    throw new PollEvidenceError("Discord poll member evidence references an absent role")
  }
  return value
}

function requiredPermissions(channel: DiscordChannel, forCreation: boolean): DiscordPermissionName[] {
  const result: DiscordPermissionName[] = ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"]
  if (
    channel.type === DISCORD_CHANNEL_TYPES.voice
    || channel.type === DISCORD_CHANNEL_TYPES.stageVoice
  ) {
    result.push("CONNECT")
  }
  if (forCreation) {
    result.push(THREAD_CHANNEL_TYPES.has(channel.type)
      ? "SEND_MESSAGES_IN_THREADS"
      : "SEND_MESSAGES")
    result.push("SEND_POLLS")
  }
  return result
}

function assertPermission(
  permission: BotChannelPermissionResult,
  channel: DiscordChannel,
  forCreation: boolean,
): PollPermissionEvidence {
  const requiredPermissionNames = requiredPermissions(channel, forCreation)
  const effective = BigInt(permission.effectivePermissions)
  const missing = requiredPermissionNames.filter((name) => (
    (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
  ))
  if (permission.confidence !== "complete" || missing.length > 0) {
    throw new PollEvidenceError(
      `Discord connector poll permission evidence is incomplete or missing: ${missing.join(", ") || "unknown evidence"}`,
    )
  }
  if (forCreation && THREAD_CHANNEL_TYPES.has(channel.type) && (
    channel.thread_metadata?.archived !== false
    || channel.thread_metadata.locked !== false
  )) {
    throw new PollEvidenceError("Discord poll creation requires an active unlocked thread")
  }
  return {
    administrator: permission.administrator,
    confidence: "complete",
    effectivePermissionNames: permission.effectivePermissionNames,
    effectivePermissions: permission.effectivePermissions,
    permissionSourceChannelId: permission.permissionSourceChannelId,
    requiredPermissionNames,
  }
}

function permissionOverwriteSnapshot(channel: DiscordChannel) {
  return [...(channel.permission_overwrites ?? [])]
    .map((overwrite) => ({
      allow: overwrite.allow ?? "0",
      deny: overwrite.deny ?? "0",
      id: overwrite.id,
      type: overwrite.type,
    }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.type - right.type)
}

function channelSnapshot(channel: DiscordChannel) {
  return {
    guildId: channel.guild_id ?? null,
    id: channel.id,
    parentId: channel.parent_id ?? null,
    permissionOverwrites: permissionOverwriteSnapshot(channel),
    threadMetadata: channel.thread_metadata
      ? {
          archived: channel.thread_metadata.archived ?? null,
          locked: channel.thread_metadata.locked ?? null,
        }
      : null,
    type: channel.type,
  }
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function pollStructureSnapshot(poll: NormalizedPoll) {
  return {
    allowMultiselect: poll.allowMultiselect,
    answers: poll.answers.map((answer) => ({
      answerId: answer.answerId,
      emoji: answer.emoji,
      text: answer.text,
    })),
    layoutType: poll.layoutType,
    question: poll.question,
    unknownFieldCount: poll.unknownFieldCount,
  }
}

function pollCreationTarget(request: NormalizedPollCreationRequest) {
  return {
    allowMultiselect: request.allowMultiselect,
    answers: request.answers,
    durationHours: request.durationHours,
    question: request.question,
  }
}

function createInput(request: NormalizedPollCreationRequest): CreatePollInput {
  return {
    allowMultiselect: request.allowMultiselect,
    answers: request.answers.map((answer) => ({
      ...(answer.emoji !== null ? { emoji: answer.emoji } : {}),
      text: answer.text,
    })),
    durationHours: request.durationHours,
    nonce: pollNonce(request.channelId, request.operationKey),
    question: request.question,
  }
}

export function pollNonce(channelId: string, operationKey: string): string {
  return createHash("sha256")
    .update("discord-mcp-poll.v1\0")
    .update(channelId)
    .update("\0")
    .update(operationKey)
    .digest("base64url")
    .slice(0, DISCORD_LIMITS.messageNonceCharacters)
}

function pollCreationMatches(
  read: PollReadResult,
  request: NormalizedPollCreationRequest,
): { expiryMatched: boolean; matched: boolean } {
  const expectedAnswers = request.answers.map((answer) => ({
    emoji: answer.emoji,
    text: answer.text,
  }))
  const actualAnswers = read.poll.answers.map((answer) => ({
    emoji: answer.emoji?.type === "unicode" ? answer.emoji.name : null,
    text: answer.text,
  }))
  const expiryMatched = read.poll.expiry !== null
    && Math.abs(
      Date.parse(read.poll.expiry)
      - Date.parse(read.createdAt)
      - request.durationHours * POLL_DURATION_MILLISECONDS,
    ) <= POLL_EXPIRY_TOLERANCE_MILLISECONDS
  return {
    expiryMatched,
    matched: read.poll.question === request.question
      && read.poll.allowMultiselect === request.allowMultiselect
      && read.poll.layoutType === POLL_LAYOUT_DEFAULT
      && read.poll.unknownFieldCount === 0
      && stableString(actualAnswers) === stableString(expectedAnswers)
      && expiryMatched,
  }
}

function assertExactCreatedPoll(
  message: DiscordMessage,
  botId: string,
  request: NormalizedPollCreationRequest,
  guildId: string,
  messageId: string,
  clock: Date,
  requireNonce: boolean,
): PollReadResult {
  const read = normalizeDiscordPollMessage(
    message,
    request.channelId,
    guildId,
    messageId,
    clock,
  )
  assertDiscordBotMessage(message, botId)
  const expectedNonce = pollNonce(request.channelId, request.operationKey)
  if (
    message.content !== ""
    || message.type !== 0
    || (
      message.nonce !== expectedNonce
      && (requireNonce || message.nonce !== undefined)
    )
  ) {
    throw new PollEvidenceError("Discord returned poll message identity outside the reviewed send")
  }
  return read
}

function pollEnded(poll: NormalizedPoll, clock: Date): boolean {
  return poll.resultsFinalized === true
    || (
      poll.expiry !== null
      && Date.parse(poll.expiry) <= clock.getTime() + POLL_END_TOLERANCE_MILLISECONDS
    )
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

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  kind: Extract<OperationKind, "poll-create" | "poll-end">
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

function activityEntry(options: {
  activityId: string
  channelId: string
  error?: string | null
  guildId: string
  kind: "poll-create" | "poll-end"
  messageId?: string | null
  operationKeyHash: string
  planDigest: string
  status: PollActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): PollActivity {
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
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof PollExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(options: {
  key: string
  locks: Map<string, Promise<"settled" | "uncertain">>
  operation: () => Promise<T>
  priorUncertainError: () => PollExecutionError
  uncertainTargets: Set<string>
}): Promise<T> {
  const prior = options.locks.get(options.key)
    ?? Promise.resolve(
      options.uncertainTargets.has(options.key)
        ? "uncertain" as const
        : "settled" as const,
    )
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  options.locks.set(options.key, tail)
  let outcome: "settled" | "uncertain" = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw options.priorUncertainError()
    }
    return await options.operation()
  } catch (error) {
    if (uncertainExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    if (outcome === "uncertain") options.uncertainTargets.add(options.key)
    release(outcome)
    if (options.locks.get(options.key) === tail) options.locks.delete(options.key)
  }
}

export class PollService {
  readonly #activityStore: ActivityStore
  readonly #client: PollServiceOptions["client"]
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: PollServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: PollServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#limiter = options.limiter
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #read(
    channelId: string,
    messageId: string,
    voterAudit: boolean,
    options: RequestOptions,
  ): Promise<{ channel: DiscordChannel; guildId: string; message: DiscordMessage; read: PollReadResult }> {
    assertSnowflake(channelId, "Discord poll channel ID")
    assertSnowflake(messageId, "Discord poll message ID")
    const channel = exactChannel(await this.#client.getChannel(channelId, options), channelId)
    const guildId = voterAudit
      ? this.#policy.assertPollVotersAuditable(channel)
      : this.#policy.assertPollAuditable(channel)
    const message = await this.#client.getMessage(channelId, messageId, options)
    const read = normalizeDiscordPollMessage(
      message,
      channelId,
      guildId,
      messageId,
      this.#clock(),
    )
    return { channel, guildId, message, read }
  }

  async get(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<PollReadResult> {
    return (await this.#read(channelId, messageId, false, options)).read
  }

  async listAnswerVoters(
    channelId: string,
    messageId: string,
    answerId: number,
    options: PollVoterPageOptions = {},
  ): Promise<PollVoterListResult> {
    if (!Number.isSafeInteger(answerId) || answerId < 1) {
      throw new RangeError("Discord poll answer ID must be a positive safe integer")
    }
    const limit = options.limit ?? POLL_LIMITS.voterPageDefault
    if (!Number.isInteger(limit) || limit < 1 || limit > POLL_LIMITS.voterPage) {
      throw new RangeError(
        `Discord poll voter limit must be between 1 and ${POLL_LIMITS.voterPage}`,
      )
    }
    if (options.after !== undefined) {
      assertSnowflake(options.after, "Discord poll voter cursor")
    }
    const state = await this.#read(channelId, messageId, true, options)
    if (!state.read.poll.answers.some((answer) => answer.answerId === answerId)) {
      throw new PollEvidenceError(`Discord poll does not contain answer ID ${answerId}`)
    }
    const response = await this.#client.listPollAnswerVoters(
      channelId,
      messageId,
      answerId,
      { ...options, limit },
    )
    if (
      !response
      || typeof response !== "object"
      || Array.isArray(response)
      || !onlyKeys(response as unknown as Record<string, unknown>, ["users"])
      || !Array.isArray(response.users)
      || response.users.length > limit
    ) {
      throw new PollEvidenceError("Discord returned an invalid bounded poll voter page")
    }
    const voterUserIds: string[] = []
    let previous = options.after ? BigInt(options.after) : 0n
    for (const user of response.users as DiscordUser[]) {
      if (!user || typeof user !== "object" || Array.isArray(user) || !validSnowflake(user.id)) {
        throw new PollEvidenceError("Discord returned invalid poll voter identity evidence")
      }
      const current = BigInt(user.id)
      if (current <= previous) {
        throw new PollEvidenceError("Discord returned unordered or duplicate poll voter identities")
      }
      voterUserIds.push(user.id)
      previous = current
    }
    return {
      answerId,
      channelId,
      guildId: state.guildId,
      messageId,
      page: {
        after: options.after ?? null,
        nextAfter: voterUserIds.length === limit
          ? voterUserIds.at(-1) ?? null
          : null,
        requestedLimit: limit,
        returned: voterUserIds.length,
      },
      privacy: {
        persistence: "none",
        profileFields: "omitted",
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      voterUserIds,
    }
  }

  async #channelEvidence(
    botId: string,
    channelId: string,
    action: "create" | "end",
    options: RequestOptions,
  ): Promise<PollChannelEvidence> {
    assertSnowflake(botId, "Discord connector bot ID")
    const channel = exactChannel(await this.#client.getChannel(channelId, options), channelId)
    const guildId = action === "create"
      ? this.#policy.assertPollCreatable(channel)
      : this.#policy.assertPollEndable(channel)
    let parent: DiscordChannel | null = null
    if (THREAD_CHANNEL_TYPES.has(channel.type)) {
      parent = exactParent(
        await this.#client.getChannel(channel.parent_id as string, options),
        channel.parent_id as string,
        guildId,
      )
      if (this.#policy.assertChannelReadable(parent) !== guildId) {
        throw new PollEvidenceError("Discord poll thread parent belongs to another guild")
      }
    }
    const [guildValue, memberValue, rolesValue] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(guildValue, guildId)
    const member = exactMember(memberValue, botId)
    const roles = exactRoles(rolesValue, guildId, member)
    const permission = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId,
      member,
      permissionChannel: parent || channel,
      roles,
    })
    assertPermission(permission, channel, action === "create")
    return {
      channel,
      guild,
      guildId,
      member,
      parent,
      permission,
      roles,
    }
  }

  async #buildCreationPlan(
    applicationId: string,
    botId: string,
    request: NormalizedPollCreationRequest,
    options: RequestOptions,
  ): Promise<PollCreationPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const existingReceipt = await this.#operationStore.get(
      "poll-create",
      request.operationKeyHash,
    )
    if (existingReceipt) throw new PollOperationConflictError(receiptView(existingReceipt))
    const state = await this.#channelEvidence(botId, request.channelId, "create", options)
    const permission = assertPermission(state.permission, state.channel, true)
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      channel: channelSnapshot(state.channel),
      guild: {
        id: state.guild.id,
        ownerId: state.guild.owner_id,
      },
      member: {
        roles: [...state.member.roles].sort(),
        userId: state.member.user?.id ?? null,
      },
      parent: state.parent ? channelSnapshot(state.parent) : null,
      permission: {
        administrator: permission.administrator,
        confidence: permission.confidence,
        effectivePermissions: permission.effectivePermissions,
        permissionSourceChannelId: permission.permissionSourceChannelId,
        requiredPermissionNames: permission.requiredPermissionNames,
      },
      request: {
        ...pollCreationTarget(request),
        channelId: request.channelId,
        operationKeyHash: request.operationKeyHash,
      },
      roles: roleSnapshot(state.roles),
    })
    return {
      applicationId,
      botId,
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      createdAt: this.#clock().toISOString(),
      digest,
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy: {
        persistence: "content-free-only",
        rawPayloads: "omitted",
        text: "transient",
        voterIdentities: "not-fetched",
      },
      risks: [
        "Discord poll messages cannot be edited after creation",
        "The POST is not automatically retried, so an ambiguous transport outcome remains uncertain",
        "The returned poll and exact message readback are checked against the reviewed question, answers, settings, and duration",
      ],
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      target: pollCreationTarget(request),
      warnings: [
        "Question text, answer text, and emoji are untrusted transient data and are never persisted by this workflow",
        "Only Unicode answer emoji are supported; custom emoji and external-emoji permission ambiguity are excluded",
        "Same-channel serialization is process-local; do not run overlapping connector processes with poll-creation scope",
        "The operation key is one-shot and cannot be reused after reservation, including after an uncertain outcome",
      ],
      writeRequired: true,
    }
  }

  planCreation(
    applicationId: string,
    botId: string,
    request: PollCreationRequest,
    options: RequestOptions = {},
  ): Promise<PollCreationPlan> {
    return this.#buildCreationPlan(
      applicationId,
      botId,
      normalizePollCreationRequest(request),
      options,
    )
  }

  executeCreation(
    applicationId: string,
    botId: string,
    request: PollCreationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<PollCreationResult> {
    const normalized = normalizePollCreationRequest(request)
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord poll-creation plan digest is invalid")
    }
    return withTargetLock({
      key: normalized.channelId,
      locks: CREATE_TARGET_LOCKS,
      operation: () => this.#executeCreationNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      priorUncertainError: () => new PollExecutionError(
        "Discord poll creation was blocked because a prior same-channel operation ended uncertainly",
        {
          channelId: normalized.channelId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
      uncertainTargets: CREATE_UNCERTAIN_TARGETS,
    })
  }

  async #executeCreationNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedPollCreationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<PollCreationResult> {
    let plan: PollCreationPlan
    try {
      plan = await this.#buildCreationPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof PollEvidenceError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new PollPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new PollPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: plan.channel.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: plan.channel.guildId,
      kind: "poll-create",
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) throw new PollOperationConflictError(receiptView(reservation.receipt))
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        channelId: request.channelId,
        guildId: plan.channel.guildId,
        kind: "poll-create",
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: plan.channel.guildId,
          kind: "poll-create",
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new PollExecutionError(
        "Discord poll creation was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationAttempted = false
    let mutationCompleted = false
    let messageId: string | null = null
    let responseMatched: boolean | null = null
    let readbackMatched: boolean | null = null
    let expiryMatched: boolean | null = null
    try {
      this.#limiter.reserve(request.channelId)
      mutationAttempted = true
      const response = await this.#client.createPoll(
        request.channelId,
        createInput(request),
        options,
      )
      mutationCompleted = true
      if (validSnowflake(response.id)) messageId = response.id
      if (messageId === null) {
        throw new PollEvidenceError("Discord poll creation response omitted a valid message ID")
      }
      const responseRead = assertExactCreatedPoll(
        response,
        botId,
        request,
        plan.channel.guildId,
        messageId,
        this.#clock(),
        true,
      )
      const responseComparison = pollCreationMatches(responseRead, request)
      responseMatched = responseComparison.matched
      expiryMatched = responseComparison.expiryMatched
      const readbackValue = await this.#client.getMessage(
        request.channelId,
        messageId,
        options,
      )
      const readback = assertExactCreatedPoll(
        readbackValue,
        botId,
        request,
        plan.channel.guildId,
        messageId,
        this.#clock(),
        false,
      )
      const readbackComparison = pollCreationMatches(readback, request)
      readbackMatched = readbackComparison.matched
      expiryMatched = expiryMatched && readbackComparison.expiryMatched
    } catch (error) {
      const status = !mutationAttempted
        || !mutationCompleted
          && error instanceof DiscordApiError
          && error.status >= 400
          && error.status < 500
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: plan.channel.guildId,
          kind: "poll-create",
          messageId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
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
          channelId: request.channelId,
          error: errorCode,
          guildId: plan.channel.guildId,
          kind: "poll-create",
          messageId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new PollExecutionError(
        "Discord poll creation did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          expiryMatched,
          messageId,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError ? error.retryAfterMs ?? null : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = responseMatched && readbackMatched && expiryMatched
      ? "match"
      : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: PollCreationResult = {
      ...baseResult,
      activityId,
      expiryMatched: expiryMatched as boolean,
      messageId: messageId as string,
      readbackMatched: readbackMatched as boolean,
      responseMatched: responseMatched as boolean,
      status,
      url: discordMessageUrl(
        plan.channel.guildId,
        request.channelId,
        messageId as string,
      ),
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: plan.channel.guildId,
        kind: "poll-create",
        messageId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          channelId: request.channelId,
          error: safeErrorCode(error),
          guildId: plan.channel.guildId,
          kind: "poll-create",
          messageId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new PollExecutionError(
        "Discord poll creation completed but the operation receipt failed",
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
        channelId: request.channelId,
        guildId: plan.channel.guildId,
        kind: "poll-create",
        messageId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new PollExecutionError(
        "Discord poll creation completed but the final activity record failed",
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

  async #endState(
    botId: string,
    request: NormalizedPollEndRequest,
    options: RequestOptions,
  ): Promise<PollEndState> {
    const state = await this.#channelEvidence(botId, request.channelId, "end", options)
    const message = await this.#client.getMessage(
      request.channelId,
      request.messageId,
      options,
    )
    const read = normalizeDiscordPollMessage(
      message,
      request.channelId,
      state.guildId,
      request.messageId,
      this.#clock(),
    )
    assertDiscordBotMessage(message, botId)
    if (read.poll.unknownFieldCount !== 0) {
      throw new PollEvidenceError("Discord poll ending is blocked by unknown poll fields")
    }
    if (read.poll.lifecycleState === "unknown") {
      throw new PollEvidenceError("Discord poll ending requires a known expiry state")
    }
    return { ...state, message, read }
  }

  async #buildEndPlan(
    applicationId: string,
    botId: string,
    request: NormalizedPollEndRequest,
    options: RequestOptions,
  ): Promise<PollEndPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const existingReceipt = await this.#operationStore.get("poll-end", request.operationKeyHash)
    if (existingReceipt) throw new PollOperationConflictError(receiptView(existingReceipt))
    const state = await this.#endState(botId, request, options)
    const permission = assertPermission(state.permission, state.channel, false)
    const writeRequired = state.read.poll.lifecycleState === "active"
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      channel: channelSnapshot(state.channel),
      guild: {
        id: state.guild.id,
        ownerId: state.guild.owner_id,
      },
      member: {
        roles: [...state.member.roles].sort(),
        userId: state.member.user?.id ?? null,
      },
      message: {
        authorId: state.read.author.id,
        createdAt: state.read.createdAt,
        editedAt: state.read.editedAt,
        id: state.read.messageId,
        poll: state.read.poll,
      },
      parent: state.parent ? channelSnapshot(state.parent) : null,
      permission: {
        administrator: permission.administrator,
        confidence: permission.confidence,
        effectivePermissions: permission.effectivePermissions,
        permissionSourceChannelId: permission.permissionSourceChannelId,
        requiredPermissionNames: permission.requiredPermissionNames,
      },
      request: {
        channelId: request.channelId,
        messageId: request.messageId,
        operationKeyHash: request.operationKeyHash,
      },
      roles: roleSnapshot(state.roles),
      writeRequired,
    })
    return {
      applicationId,
      botId,
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      createdAt: this.#clock().toISOString(),
      digest,
      messageId: request.messageId,
      operationKeyHash: request.operationKeyHash,
      permission,
      poll: state.read.poll,
      privacy: {
        persistence: "content-free-only",
        rawPayloads: "omitted",
        text: "transient",
        voterIdentities: "not-fetched",
      },
      risks: [
        "Ending a poll is irreversible; Discord does not provide a reopen operation",
        "Live counts can be approximate and final tallying continues asynchronously after the poll ends",
        "The expire POST is not automatically retried, so an ambiguous transport outcome remains uncertain",
      ],
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-ended",
      warnings: [
        "Question text, answer text, emoji, and counts are transient review data and are never persisted by this workflow",
        "Any vote-count change before confirmation changes the plan digest and requires renewed review",
        "Same-message serialization is process-local; do not run overlapping connector processes with poll-ending scope",
        "The operation key is one-shot and cannot be reused after reservation, including after an uncertain outcome",
      ],
      writeRequired,
    }
  }

  planEnd(
    applicationId: string,
    botId: string,
    request: PollEndRequest,
    options: RequestOptions = {},
  ): Promise<PollEndPlan> {
    return this.#buildEndPlan(
      applicationId,
      botId,
      normalizePollEndRequest(request),
      options,
    )
  }

  executeEnd(
    applicationId: string,
    botId: string,
    request: PollEndRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<PollEndResult> {
    const normalized = normalizePollEndRequest(request)
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord poll-end plan digest is invalid")
    }
    return withTargetLock({
      key: `${normalized.channelId}\0${normalized.messageId}`,
      locks: END_TARGET_LOCKS,
      operation: () => this.#executeEndNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      priorUncertainError: () => new PollExecutionError(
        "Discord poll ending was blocked because a prior same-message operation ended uncertainly",
        {
          channelId: normalized.channelId,
          messageId: normalized.messageId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
      uncertainTargets: END_UNCERTAIN_TARGETS,
    })
  }

  async #executeEndNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedPollEndRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<PollEndResult> {
    let plan: PollEndPlan
    try {
      plan = await this.#buildEndPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof PollEvidenceError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new PollPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new PollPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: plan.channel.guildId,
      messageId: request.messageId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      url: discordMessageUrl(plan.channel.guildId, request.channelId, request.messageId),
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        finalization: "not-required",
        readbackMatched: true,
        responseMatched: true,
        status: "already-ended",
        verification: "not-required",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: plan.channel.guildId,
      kind: "poll-end",
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) throw new PollOperationConflictError(receiptView(reservation.receipt))
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        channelId: request.channelId,
        guildId: plan.channel.guildId,
        kind: "poll-end",
        messageId: request.messageId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: plan.channel.guildId,
          kind: "poll-end",
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new PollExecutionError(
        "Discord poll ending was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationAttempted = false
    let mutationCompleted = false
    let responseMatched: boolean | null = null
    let readbackMatched: boolean | null = null
    let finalization: PollEndResult["finalization"] = "pending"
    try {
      this.#limiter.reserve(request.channelId)
      mutationAttempted = true
      const response = await this.#client.endPoll(
        request.channelId,
        request.messageId,
        options,
      )
      mutationCompleted = true
      const responseRead = normalizeDiscordPollMessage(
        response,
        request.channelId,
        plan.channel.guildId,
        request.messageId,
        this.#clock(),
      )
      assertDiscordBotMessage(response, botId)
      responseMatched = pollEnded(responseRead.poll, this.#clock())
        && stableString(pollStructureSnapshot(responseRead.poll))
          === stableString(pollStructureSnapshot(plan.poll))
      const readbackValue = await this.#client.getMessage(
        request.channelId,
        request.messageId,
        options,
      )
      const readback = normalizeDiscordPollMessage(
        readbackValue,
        request.channelId,
        plan.channel.guildId,
        request.messageId,
        this.#clock(),
      )
      assertDiscordBotMessage(readbackValue, botId)
      if (!pollEnded(readback.poll, this.#clock())) {
        throw new PollEvidenceError("Discord poll readback did not prove the poll ended")
      }
      if (readback.poll.resultState === "unknown") {
        throw new PollEvidenceError("Discord ended poll readback omitted result evidence")
      }
      readbackMatched = stableString(pollStructureSnapshot(readback.poll))
        === stableString(pollStructureSnapshot(plan.poll))
      finalization = readback.poll.resultState === "final" ? "final" : "pending"
    } catch (error) {
      const status = !mutationAttempted
        || !mutationCompleted
          && error instanceof DiscordApiError
          && error.status >= 400
          && error.status < 500
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: plan.channel.guildId,
          kind: "poll-end",
          messageId: status === "uncertain" ? request.messageId : null,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
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
          channelId: request.channelId,
          error: errorCode,
          guildId: plan.channel.guildId,
          kind: "poll-end",
          messageId: request.messageId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new PollExecutionError(
        "Discord poll ending did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          finalization,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError ? error.retryAfterMs ?? null : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = responseMatched && readbackMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: PollEndResult = {
      ...baseResult,
      activityId,
      finalization,
      readbackMatched: readbackMatched as boolean,
      responseMatched: responseMatched as boolean,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: plan.channel.guildId,
        kind: "poll-end",
        messageId: request.messageId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          channelId: request.channelId,
          error: safeErrorCode(error),
          guildId: plan.channel.guildId,
          kind: "poll-end",
          messageId: request.messageId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new PollExecutionError(
        "Discord poll ending completed but the operation receipt failed",
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
        channelId: request.channelId,
        guildId: plan.channel.guildId,
        kind: "poll-end",
        messageId: request.messageId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new PollExecutionError(
        "Discord poll ending completed but the final activity record failed",
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
