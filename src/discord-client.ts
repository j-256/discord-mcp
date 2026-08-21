import { setTimeout as wait } from "node:timers/promises"

import {
  AUDIT_LOG_LIMITS,
  BAN_AUDIT_LIMITS,
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  CONNECTOR_LIMITS,
  DISCORD_API_BASE_URL,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  INVITE_LIMITS,
  MEMBER_DIRECTORY_LIMITS,
  ONBOARDING_LIMITS,
  POLL_LIMITS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_USER_AGENT,
} from "./constants.js"
import {
  AutoModerationEvidenceError,
  ChannelMetadataEvidenceError,
  DiscordApiError,
  errorMessage,
  GuildExpressionEvidenceError,
  InviteEvidenceError,
  OnboardingEvidenceError,
  redactText,
  RoleConfigurationEvidenceError,
  ScheduledEventEvidenceError,
  WebhookEvidenceError,
} from "./errors.js"
import type {
  EmojiFileFormat,
  StickerFileFormat,
} from "./guild-expression-file.js"
import type { ScheduledEventCoverFormat } from "./scheduled-event-file.js"
import {
  DISCORD_REST_OPERATIONS,
  type DiscordRestOperation,
} from "./observability-catalog.js"
import type {
  OperationObservation,
  OperationalErrorCategory,
  OperationalObserver,
} from "./observability.js"
import type {
  DiscordApplication,
  DiscordBan,
  DiscordChannel,
  DiscordCreatedForumPost,
  DiscordErrorBody,
  DiscordGuild,
  DiscordGuildAuditLog,
  DiscordGuildMember,
  DiscordMessage,
  DiscordMessagePinPage,
  DiscordMessageSearchIndexing,
  DiscordMessageSearchResponse,
  DiscordPermissionOverwrite,
  DiscordPollVoters,
  DiscordRole,
  DiscordThreadList,
  DiscordThreadMember,
  DiscordUser,
  MessageCursor,
  RequestOptions,
} from "./types.js"

export type FetchImplementation = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>

export type SleepImplementation = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>

export interface DiscordClientOptions {
  apiBaseUrl?: string
  fetchImplementation?: FetchImplementation
  maxAutomaticRetryWaitMs?: number
  maxRetries?: number
  observer?: Pick<OperationalObserver, "startDiscordRequest">
  requestTimeoutMs?: number
  sleep?: SleepImplementation
  token: string
}

export interface GuildPageOptions extends RequestOptions {
  after?: string
  before?: string
  limit?: number
}

export interface GuildAuditLogPageOptions extends RequestOptions {
  actionType?: number
  actorUserId?: string
  after?: string
  before?: string
  limit?: number
}

export interface GuildBanPageOptions extends RequestOptions {
  after?: string
  limit?: number
}

export interface GuildMemberPageOptions extends RequestOptions {
  after?: string
  limit?: number
}

export interface GuildMemberSearchOptions extends RequestOptions {
  limit?: number
  query: string
}

export interface MessagePageOptions extends MessageCursor, RequestOptions {
  limit?: number
}

export interface MessagePinPageOptions extends RequestOptions {
  before?: string
  limit?: number
}

export interface DiscordChannelMetadata {
  defaultAutoArchiveDuration: number | null
  defaultThreadRateLimitPerUser: number | null
  guildId: string
  id: string
  name: string
  nsfw: boolean | null
  parentId: string | null
  permissionOverwrites: DiscordPermissionOverwrite[]
  position: number
  rateLimitPerUser: number | null
  topic: string | null
  type: number
  unknownFieldCount: number
}

export interface ModifyChannelMetadataInput {
  defaultAutoArchiveDuration?: number
  defaultThreadRateLimitPerUser?: number
  name?: string
  nsfw?: boolean
  rateLimitPerUser?: number
  topic?: string | null
}

export interface DiscordWebhookSummary {
  applicationId: string | null
  channelId: string | null
  creatorUserId: string | null
  guildId: string | null
  id: string
  name: string | null
  type: number
}

export interface DiscordInviteSummary {
  channelId: string | null
  code: string
  createdAt: string
  expiresAt: string | null
  flags: number
  guildId: string | null
  inviterUserId: string | null
  maxAge: number
  maxUses: number
  roleIds: string[]
  targetApplicationId: string | null
  targetType: number | null
  targetUserId: string | null
  temporary: boolean
  type: number
  uses: number
}

export interface DiscordDeletedInviteSummary {
  channelId: string | null
  code: string
  guildId: string | null
  type: number
}

export const DISCORD_ONBOARDING_MODES = Object.freeze({
  advanced: 1,
  default: 0,
} as const)

export const DISCORD_ONBOARDING_PROMPT_TYPES = Object.freeze({
  dropdown: 1,
  multipleChoice: 0,
} as const)

export interface DiscordOnboardingEmoji {
  animated: boolean
  id: string | null
  name: string | null
}

export interface DiscordGuildOnboardingOption {
  channelIds: string[]
  description: string | null
  emoji: DiscordOnboardingEmoji | null
  id: string
  roleIds: string[]
  title: string
}

export interface DiscordGuildOnboardingPrompt {
  id: string
  inOnboarding: boolean
  options: DiscordGuildOnboardingOption[]
  required: boolean
  singleSelect: boolean
  title: string
  type: number
}

export interface DiscordGuildOnboarding {
  defaultChannelIds: string[]
  enabled: boolean
  guildId: string
  mode: number
  prompts: DiscordGuildOnboardingPrompt[]
  unknownEnumCount: number
  unknownFieldCount: number
}

export interface DiscordOnboardingEmojiInput {
  animated: boolean
  id: string | null
  name: string | null
}

export interface ModifyGuildOnboardingOptionInput {
  channelIds: readonly string[]
  description: string | null
  emoji: DiscordOnboardingEmojiInput | null
  id?: string
  roleIds: readonly string[]
  title: string
}

export interface ModifyGuildOnboardingPromptInput {
  id: string
  inOnboarding: boolean
  options: readonly ModifyGuildOnboardingOptionInput[]
  required: boolean
  singleSelect: boolean
  title: string
  type: 0 | 1
}

export interface ModifyGuildOnboardingInput {
  defaultChannelIds: readonly string[]
  enabled: boolean
  mode: 0 | 1
  prompts: readonly ModifyGuildOnboardingPromptInput[]
}

export const DISCORD_AUTO_MODERATION_EVENT_TYPES = Object.freeze({
  memberUpdate: 2,
  messageSend: 1,
} as const)

export const DISCORD_AUTO_MODERATION_TRIGGER_TYPES = Object.freeze({
  keyword: 1,
  keywordPreset: 4,
  memberProfile: 6,
  mentionSpam: 5,
  spam: 3,
} as const)

export const DISCORD_AUTO_MODERATION_ACTION_TYPES = Object.freeze({
  blockMemberInteraction: 4,
  blockMessage: 1,
  sendAlertMessage: 2,
  timeout: 3,
} as const)

export const DISCORD_AUTO_MODERATION_KEYWORD_PRESETS = Object.freeze({
  profanity: 1,
  sexualContent: 2,
  slurs: 3,
} as const)

export type DiscordAutoModerationEventType =
  typeof DISCORD_AUTO_MODERATION_EVENT_TYPES[
    keyof typeof DISCORD_AUTO_MODERATION_EVENT_TYPES
  ]
export type DiscordAutoModerationTriggerType =
  typeof DISCORD_AUTO_MODERATION_TRIGGER_TYPES[
    keyof typeof DISCORD_AUTO_MODERATION_TRIGGER_TYPES
  ]
export type DiscordAutoModerationKeywordPreset =
  typeof DISCORD_AUTO_MODERATION_KEYWORD_PRESETS[
    keyof typeof DISCORD_AUTO_MODERATION_KEYWORD_PRESETS
  ]

export type DiscordAutoModerationTrigger =
  | {
      allowList: string[]
      keywordFilter: string[]
      regexPatterns: string[]
      type: 1
    }
  | {
      allowList: string[]
      keywordFilter: string[]
      regexPatterns: string[]
      type: 6
    }
  | {
      type: 3
    }
  | {
      allowList: string[]
      presets: DiscordAutoModerationKeywordPreset[]
      type: 4
    }
  | {
      mentionRaidProtectionEnabled: boolean
      mentionTotalLimit: number
      type: 5
    }

export type DiscordAutoModerationAction =
  | {
      customMessage: string | null
      type: 1
    }
  | {
      channelId: string
      type: 2
    }
  | {
      durationSeconds: number
      type: 3
    }
  | {
      type: 4
    }

export interface DiscordAutoModerationRuleSummary {
  actions: DiscordAutoModerationAction[]
  creatorUserId: string
  enabled: boolean
  eventType: DiscordAutoModerationEventType
  exemptChannelIds: string[]
  exemptRoleIds: string[]
  guildId: string
  id: string
  name: string
  trigger: DiscordAutoModerationTrigger
}

export interface CreateGuildAutoModerationRuleInput {
  actions: DiscordAutoModerationAction[]
  exemptChannelIds: string[]
  exemptRoleIds: string[]
  name: string
  trigger: DiscordAutoModerationTrigger
}

export interface ModifyGuildAutoModerationRuleInput {
  actions?: DiscordAutoModerationAction[]
  enabled?: boolean
  exemptChannelIds?: string[]
  exemptRoleIds?: string[]
  name?: string
  trigger?: DiscordAutoModerationTrigger
}

export interface DiscordGuildEmojiSummary {
  animated: boolean
  available: boolean
  creatorUserId: string | null
  id: string
  managed: boolean
  name: string
  requiresColons: boolean
  roleIds: string[]
}

export interface DiscordGuildStickerSummary {
  available: boolean
  creatorUserId: string | null
  description: string | null
  formatType: number
  guildId: string
  id: string
  name: string
  tags: string
  type: number
}

export const DISCORD_SCHEDULED_EVENT_ENTITY_TYPES = Object.freeze({
  external: 3,
  stage: 1,
  voice: 2,
} as const)

export const DISCORD_SCHEDULED_EVENT_STATUSES = Object.freeze({
  active: 2,
  canceled: 4,
  completed: 3,
  scheduled: 1,
} as const)

export const DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES = Object.freeze({
  daily: 3,
  monthly: 1,
  weekly: 2,
  yearly: 0,
} as const)

export type DiscordScheduledEventEntityType =
  typeof DISCORD_SCHEDULED_EVENT_ENTITY_TYPES[keyof typeof DISCORD_SCHEDULED_EVENT_ENTITY_TYPES]
export type DiscordScheduledEventStatus =
  typeof DISCORD_SCHEDULED_EVENT_STATUSES[keyof typeof DISCORD_SCHEDULED_EVENT_STATUSES]
export type DiscordScheduledEventRecurrenceFrequency =
  typeof DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES[
    keyof typeof DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES
  ]

export interface DiscordScheduledEventRecurrenceNWeekday {
  day: number
  n: number
}

export interface DiscordScheduledEventRecurrenceRule {
  byMonth: number[] | null
  byMonthDay: number[] | null
  byNWeekday: DiscordScheduledEventRecurrenceNWeekday[] | null
  byWeekday: number[] | null
  byYearDay: number[] | null
  count: number | null
  endTime: string | null
  frequency: DiscordScheduledEventRecurrenceFrequency
  interval: number
  startTime: string
}

export interface DiscordScheduledEventRecurrenceInput {
  byMonth: number[] | null
  byMonthDay: number[] | null
  byNWeekday: DiscordScheduledEventRecurrenceNWeekday[] | null
  byWeekday: number[] | null
  frequency: DiscordScheduledEventRecurrenceFrequency
  interval: number
  startTime: string
}

export interface DiscordScheduledEventSummary {
  channelId: string | null
  creatorUserId: string | null
  description: string | null
  entityId: string | null
  entityType: DiscordScheduledEventEntityType
  guildId: string
  hasCoverImage: boolean
  id: string
  location: string | null
  name: string
  privacyLevel: 2
  recurrenceRule: DiscordScheduledEventRecurrenceRule | null
  scheduledEndTime: string | null
  scheduledStartTime: string
  status: DiscordScheduledEventStatus
  subscriberCount: number | null
}

export interface ScheduledEventReadOptions extends RequestOptions {
  includeSubscriberCount?: boolean
}

export interface ScheduledEventCoverInput {
  bytes: Uint8Array
  format: ScheduledEventCoverFormat
}

export interface CreateGuildScheduledEventInput {
  channelId: string | null
  cover?: ScheduledEventCoverInput
  description?: string
  entityType: DiscordScheduledEventEntityType
  location: string | null
  name: string
  recurrenceRule?: DiscordScheduledEventRecurrenceInput
  scheduledEndTime?: string
  scheduledStartTime: string
}

export interface ModifyGuildScheduledEventInput {
  channelId?: string | null
  cover?: ScheduledEventCoverInput | null
  description?: string | null
  entityType?: DiscordScheduledEventEntityType
  location?: string | null
  name?: string
  recurrenceRule?: DiscordScheduledEventRecurrenceInput | null
  scheduledEndTime?: string
  scheduledStartTime?: string
  status?: Exclude<DiscordScheduledEventStatus, 1>
}

export type SearchAuthorType =
  | "-bot"
  | "-user"
  | "-webhook"
  | "bot"
  | "user"
  | "webhook"

export type SearchHasType =
  | "-embed"
  | "-file"
  | "-image"
  | "-link"
  | "-poll"
  | "-snapshot"
  | "-sound"
  | "-sticker"
  | "-video"
  | "embed"
  | "file"
  | "image"
  | "link"
  | "poll"
  | "snapshot"
  | "sound"
  | "sticker"
  | "video"

export type SearchEmbedType = "article" | "gif" | "image" | "sound" | "video"
export type SearchSortBy = "relevance" | "timestamp"
export type SearchSortOrder = "asc" | "desc"

const SEARCH_AUTHOR_TYPES: ReadonlySet<string> = new Set([
  "-bot",
  "-user",
  "-webhook",
  "bot",
  "user",
  "webhook",
])
const SEARCH_EMBED_TYPES: ReadonlySet<string> = new Set([
  "article",
  "gif",
  "image",
  "sound",
  "video",
])
const SEARCH_HAS_TYPES: ReadonlySet<string> = new Set([
  "-embed",
  "-file",
  "-image",
  "-link",
  "-poll",
  "-snapshot",
  "-sound",
  "-sticker",
  "-video",
  "embed",
  "file",
  "image",
  "link",
  "poll",
  "snapshot",
  "sound",
  "sticker",
  "video",
])
const SEARCH_SORT_BY_VALUES: ReadonlySet<string> = new Set(["relevance", "timestamp"])
const SEARCH_SORT_ORDER_VALUES: ReadonlySet<string> = new Set(["asc", "desc"])
const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const CHANNEL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const CHANNEL_TOPIC_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const ROLE_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const EXPRESSION_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const POLL_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const POLL_EMOJI_CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/u
const POLL_EMOJI_CODE_POINT_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u
const ALLOWED_MENTION_PARSE_KEYS = ["parse", "replied_user"] as const
const ALLOWED_MENTION_USER_KEYS = ["replied_user", "users"] as const
const EMOJI_FORMAT_MEDIA_TYPES: Readonly<Record<EmojiFileFormat, string>> = Object.freeze({
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
})
const STICKER_FORMAT_UPLOADS: Readonly<Record<
  StickerFileFormat,
  { extension: string; mediaType: string }
>> = Object.freeze({
  apng: { extension: "png", mediaType: "image/png" },
  gif: { extension: "gif", mediaType: "image/gif" },
  lottie: { extension: "json", mediaType: "application/json" },
  png: { extension: "png", mediaType: "image/png" },
})
const AUTO_MODERATION_EVENT_TYPE_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_AUTO_MODERATION_EVENT_TYPES),
)
const AUTO_MODERATION_TRIGGER_TYPE_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_AUTO_MODERATION_TRIGGER_TYPES),
)
const AUTO_MODERATION_ACTION_TYPE_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_AUTO_MODERATION_ACTION_TYPES),
)
const AUTO_MODERATION_PRESET_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_AUTO_MODERATION_KEYWORD_PRESETS),
)
const SCHEDULED_EVENT_COVER_MEDIA_TYPES: Readonly<Record<
  ScheduledEventCoverFormat,
  "image/jpeg" | "image/png"
>> = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
})
const SCHEDULED_EVENT_ENTITY_TYPE_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_SCHEDULED_EVENT_ENTITY_TYPES),
)
const SCHEDULED_EVENT_STATUS_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_SCHEDULED_EVENT_STATUSES),
)
const SCHEDULED_EVENT_RECURRENCE_FREQUENCY_VALUES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES),
)
const SCHEDULED_EVENT_DAILY_WEEKDAY_SETS: ReadonlySet<string> = new Set([
  "0,1,2,3,4",
  "1,2,3,4,5",
  "4,5",
  "5,6",
  "6,0",
  "6,0,1,2,3",
])
const URL_DOT_PATH_SEGMENTS: ReadonlySet<string> = new Set([".", ".."])

export interface GuildMessageSearchOptions extends RequestOptions {
  attachmentExtensions?: readonly string[]
  attachmentFilenames?: readonly string[]
  authorIds?: readonly string[]
  authorTypes?: readonly SearchAuthorType[]
  channelIds?: readonly string[]
  content?: string
  embedProviders?: readonly string[]
  embedTypes?: readonly SearchEmbedType[]
  has?: readonly SearchHasType[]
  includeNsfw?: boolean
  limit?: number
  linkHostnames?: readonly string[]
  maxId?: string
  mentionEveryone?: boolean
  mentionRoleIds?: readonly string[]
  mentionUserIds?: readonly string[]
  minId?: string
  offset?: number
  pinned?: boolean
  repliedToMessageIds?: readonly string[]
  repliedToUserIds?: readonly string[]
  slop?: number
  sortBy?: SearchSortBy
  sortOrder?: SearchSortOrder
}

export interface ArchivedThreadPageOptions extends RequestOptions {
  before?: string
  limit?: number
}

export type DiscordAllowedMentions =
  | {
    parse: readonly []
    replied_user: boolean
  }
  | {
    replied_user: boolean
    users: readonly string[]
  }

export interface CreateMessageInput {
  allowedMentions: DiscordAllowedMentions
  content: string
  nonce: string
  reply?: {
    guildId: string
    messageId: string
  }
}

export interface CreatePollInput {
  allowMultiselect: boolean
  answers: ReadonlyArray<{
    emoji?: string
    text: string
  }>
  durationHours: number
  nonce: string
  question: string
}

export interface PollVoterPageOptions extends RequestOptions {
  after?: string
  limit?: number
}

export interface CreateAttachmentMessageInput {
  allowedMentions: DiscordAllowedMentions
  bytes: Uint8Array
  content?: string
  description?: string
  filename: string
  nonce: string
  reply?: {
    guildId: string
    messageId: string
  }
}

export interface CreateGuildChannelInput {
  defaultAutoArchiveDuration?: number
  name: string
  nsfw?: boolean
  parentId?: string
  rateLimitPerUser?: number
  topic?: string | null
  type: number
}

export interface CreateGuildRoleInput {
  hoist: boolean
  mentionable: boolean
  name: string
  permissions: string
  primaryColor: number
}

export interface ModifyGuildRoleInput {
  colors?: {
    primaryColor: number
    secondaryColor: number | null
    tertiaryColor: number | null
  }
  hoist?: boolean
  mentionable?: boolean
  name?: string
  permissions?: string
}

export type DiscordGuildRoleMemberCounts = Readonly<Record<string, number>>

export interface CreateGuildEmojiInput {
  bytes: Uint8Array
  format: EmojiFileFormat
  name: string
  roleIds: readonly string[]
}

export interface ModifyGuildEmojiInput {
  name?: string
  roleIds?: readonly string[]
}

export interface CreateGuildStickerInput {
  bytes: Uint8Array
  description: string
  format: StickerFileFormat
  name: string
  tags: string
}

export interface ModifyGuildStickerInput {
  description?: string | null
  name?: string
  tags?: string
}

export interface EditChannelPermissionOverwriteInput {
  allow: string
  deny: string
  type: 0 | 1
}

export interface CreateForumPostInput {
  allowedMentions: DiscordAllowedMentions
  appliedTagIds?: readonly string[]
  autoArchiveDuration?: number
  content: string
  name: string
  rateLimitPerUser?: number
}

export interface EditMessageInput {
  allowedMentions: DiscordAllowedMentions
  content: string
}

export interface ModifyGuildMemberTimeoutInput {
  communicationDisabledUntil: string | null
}

interface RequestParameters extends RequestOptions {
  auditReason?: string
  automaticRateLimitRetry?: boolean
  body?: unknown
  diagnosticRoute?: string
  multipartBody?: FormData
  suppressFailureCause?: boolean
}

class DiscordTransportError extends Error {
  readonly operationalCategory: OperationalErrorCategory

  constructor(
    message: string,
    operationalCategory: OperationalErrorCategory,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "DiscordTransportError"
    this.operationalCategory = operationalCategory
  }
}

function finishObservation(
  observation: OperationObservation | undefined,
  completion: Parameters<OperationObservation["end"]>[0],
): void {
  try {
    observation?.end(completion)
  } catch {}
}

function requestErrorCategory(error: unknown): OperationalErrorCategory {
  if (error instanceof DiscordTransportError) return error.operationalCategory
  if (error instanceof DiscordApiError) {
    if (error.status === 429) return "discord-rate-limited"
    if (error.status >= 500) return "discord-server-error"
    return "discord-client-error"
  }
  if (error instanceof Error && error.name === "AbortError") return "cancelled"
  return "network-error"
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return wait(milliseconds, undefined, signal ? { signal } : undefined)
}

function errorBody(value: unknown): DiscordErrorBody | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as DiscordErrorBody
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function retryAfterMilliseconds(
  body: DiscordErrorBody | undefined,
  headers: Headers,
): number | undefined {
  const bodySeconds = body?.retry_after
  if (typeof bodySeconds === "number" && Number.isFinite(bodySeconds)) {
    return Math.max(0, Math.ceil(bodySeconds * 1_000))
  }
  for (const name of ["retry-after", "x-ratelimit-reset-after"]) {
    const header = headers.get(name)
    if (!header) continue
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000))
    const date = Date.parse(header)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  }
  return undefined
}

type QueryScalar = boolean | number | string
type QueryValue = QueryScalar | readonly QueryScalar[] | undefined

const CONTENT_SENSITIVE_REST_OPERATIONS: ReadonlySet<DiscordRestOperation> = new Set([
  "create_guild_auto_moderation_rule",
  "create_guild_emoji",
  "create_guild_sticker",
  "delete_guild_auto_moderation_rule",
  "delete_guild_emoji",
  "delete_guild_sticker",
  "get_guild_auto_moderation_rule",
  "get_guild_emoji",
  "get_guild_sticker",
  "get_channel_metadata",
  "get_guild_onboarding",
  "list_guild_invites",
  "list_channel_webhooks",
  "list_guild_auto_moderation_rules",
  "list_guild_emojis",
  "list_guild_stickers",
  "modify_guild_emoji",
  "modify_guild_auto_moderation_rule",
  "modify_guild_sticker",
  "modify_guild_onboarding",
  "modify_channel_metadata",
  "delete_invite",
  "search_guild_members",
  "search_guild_messages",
])

const CHANNEL_METADATA_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const CHANNEL_METADATA_TOPIC_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const CHANNEL_METADATA_NSFW_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const CHANNEL_METADATA_RATE_LIMIT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const CHANNEL_METADATA_AUTO_ARCHIVE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const CHANNEL_METADATA_THREAD_RATE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const CHANNEL_METADATA_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "applied_tags",
  "application_id",
  "available_tags",
  "bitrate",
  "default_auto_archive_duration",
  "default_forum_layout",
  "default_reaction_emoji",
  "default_sort_order",
  "default_tag_setting",
  "default_thread_rate_limit_per_user",
  "flags",
  "guild_id",
  "icon",
  "id",
  "last_message_id",
  "last_pin_timestamp",
  "managed",
  "member",
  "member_count",
  "message_count",
  "name",
  "nsfw",
  "owner_id",
  "parent_id",
  "permission_overwrites",
  "permissions",
  "position",
  "rate_limit_per_user",
  "recipients",
  "rtc_region",
  "thread_metadata",
  "topic",
  "total_message_sent",
  "type",
  "user_limit",
  "video_quality_mode",
])
const CHANNEL_METADATA_OVERWRITE_KEYS: ReadonlySet<string> = new Set([
  "allow",
  "deny",
  "id",
  "type",
])
const MODIFY_CHANNEL_METADATA_KEYS: ReadonlySet<string> = new Set([
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "name",
  "nsfw",
  "rateLimitPerUser",
  "topic",
])

function inviteEvidenceError(): InviteEvidenceError {
  return new InviteEvidenceError("Discord returned an invalid guild invite inventory")
}

function projectedInviteId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const id = typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).id
    : undefined
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof id !== "string"
  ) {
    throw inviteEvidenceError()
  }
  try {
    assertPositiveSnowflake(id, "Discord invite projected ID")
  } catch {
    throw inviteEvidenceError()
  }
  return id
}

function inviteTimestamp(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null
  if (
    typeof value !== "string"
    || !ISO_8601_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw inviteEvidenceError()
  }
  return new Date(value).toISOString()
}

function inviteInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > maximum
  ) {
    throw inviteEvidenceError()
  }
  return value as number
}

function inviteCode(record: Record<string, unknown>): string {
  if (
    typeof record.code !== "string"
    || record.code.length < 1
    || record.code.length > INVITE_LIMITS.codeCharacters
    || URL_DOT_PATH_SEGMENTS.has(record.code)
    || /[\u0000-\u001F\u007F]/u.test(record.code)
  ) {
    throw inviteEvidenceError()
  }
  try {
    encodeURIComponent(record.code)
  } catch {
    throw inviteEvidenceError()
  }
  return record.code
}

function projectDeletedInvite(value: unknown): DiscordDeletedInviteSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inviteEvidenceError()
  }
  const record = value as Record<string, unknown>
  return {
    channelId: projectedInviteId(record.channel),
    code: inviteCode(record),
    guildId: projectedInviteId(record.guild),
    type: inviteInteger(record.type),
  }
}

function projectInvite(value: unknown): DiscordInviteSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inviteEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.temporary !== "boolean"
  ) {
    throw inviteEvidenceError()
  }
  const roles = record.roles ?? []
  if (!Array.isArray(roles) || roles.length > INVITE_LIMITS.roleIds) {
    throw inviteEvidenceError()
  }
  const roleIds = roles.map(projectedInviteId)
  if (roleIds.some((roleId) => roleId === null)) throw inviteEvidenceError()
  const exactRoleIds = roleIds as string[]
  if (new Set(exactRoleIds).size !== exactRoleIds.length) throw inviteEvidenceError()
  const targetType = record.target_type === undefined || record.target_type === null
    ? null
    : inviteInteger(record.target_type)
  return {
    channelId: projectedInviteId(record.channel),
    code: inviteCode(record),
    createdAt: inviteTimestamp(record.created_at, false) as string,
    expiresAt: inviteTimestamp(record.expires_at, true),
    flags: record.flags === undefined ? 0 : inviteInteger(record.flags),
    guildId: projectedInviteId(record.guild),
    inviterUserId: projectedInviteId(record.inviter),
    maxAge: inviteInteger(record.max_age, INVITE_LIMITS.maxAgeSeconds),
    maxUses: inviteInteger(record.max_uses, INVITE_LIMITS.maxUses),
    roleIds: exactRoleIds,
    targetApplicationId: projectedInviteId(record.target_application),
    targetType,
    targetUserId: projectedInviteId(record.target_user),
    temporary: record.temporary,
    type: inviteInteger(record.type),
    uses: inviteInteger(record.uses),
  }
}

const ONBOARDING_KEYS = [
  "default_channel_ids",
  "enabled",
  "guild_id",
  "mode",
  "prompts",
] as const
const ONBOARDING_PROMPT_KEYS = [
  "id",
  "in_onboarding",
  "options",
  "required",
  "single_select",
  "title",
  "type",
] as const
const ONBOARDING_OPTION_KEYS = [
  "channel_ids",
  "description",
  "emoji",
  "id",
  "role_ids",
  "title",
] as const
const ONBOARDING_EMOJI_KEYS = ["animated", "id", "name"] as const
const ONBOARDING_INPUT_KEYS = [
  "defaultChannelIds",
  "enabled",
  "mode",
  "prompts",
] as const
const ONBOARDING_PROMPT_INPUT_KEYS = [
  "id",
  "inOnboarding",
  "options",
  "required",
  "singleSelect",
  "title",
  "type",
] as const
const ONBOARDING_OPTION_INPUT_KEYS = [
  "channelIds",
  "description",
  "emoji",
  "id",
  "roleIds",
  "title",
] as const
const ONBOARDING_EMOJI_INPUT_KEYS = ["animated", "id", "name"] as const
const ONBOARDING_ENUM_VALUES: ReadonlySet<number> = new Set([0, 1])
const ONBOARDING_TEXT_CONTROL_PATTERN = /[\u0000\u007F]/u

interface ProjectedOnboardingOption {
  option: DiscordGuildOnboardingOption
  unknownFieldCount: number
}

interface ProjectedOnboardingPrompt {
  prompt: DiscordGuildOnboardingPrompt
  unknownEnumCount: number
  unknownFieldCount: number
}

function onboardingEvidenceError(options?: ErrorOptions): OnboardingEvidenceError {
  return new OnboardingEvidenceError(
    "Discord returned invalid guild onboarding evidence",
    options,
  )
}

function unknownOnboardingFieldCount(
  value: Record<string, unknown>,
  knownKeys: readonly string[],
): number {
  return Object.keys(value).filter((key) => !knownKeys.includes(key)).length
}

function onboardingReturnedText(
  value: unknown,
  nullable: boolean,
): string | null {
  if (value === null && nullable) return null
  if (
    typeof value !== "string"
    || [...value].length > ONBOARDING_LIMITS.auditTextCharacters
    || ONBOARDING_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw onboardingEvidenceError()
  }
  try {
    assertValidUnicode(value, "Discord onboarding text")
  } catch (error) {
    throw onboardingEvidenceError({ cause: error })
  }
  return value
}

function onboardingReturnedIds(
  value: unknown,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw onboardingEvidenceError()
  }
  const ids: string[] = []
  try {
    for (const entry of value) {
      assertPositiveSnowflake(entry as string, "Discord onboarding reference ID")
      ids.push(entry as string)
    }
  } catch (error) {
    throw onboardingEvidenceError({ cause: error })
  }
  return ids
}

function projectOnboardingEmoji(
  value: unknown,
): { emoji: DiscordOnboardingEmoji | null; unknownFieldCount: number } {
  if (value === undefined || value === null) {
    return { emoji: null, unknownFieldCount: 0 }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw onboardingEvidenceError()
  }
  const record = value as Record<string, unknown>
  const id = record.id
  const name = record.name
  if (
    !Object.hasOwn(record, "id")
    || !Object.hasOwn(record, "name")
    || !(id === null || typeof id === "string")
    || !(name === null || typeof name === "string")
    || !(record.animated === undefined || typeof record.animated === "boolean")
    || (id === null && name === null)
  ) {
    throw onboardingEvidenceError()
  }
  try {
    if (typeof id === "string") {
      assertPositiveSnowflake(id, "Discord onboarding emoji ID")
    }
    if (typeof name === "string") onboardingReturnedText(name, false)
  } catch (error) {
    if (error instanceof OnboardingEvidenceError) throw error
    throw onboardingEvidenceError({ cause: error })
  }
  return {
    emoji: {
      animated: record.animated === true,
      id,
      name,
    },
    unknownFieldCount: unknownOnboardingFieldCount(record, ONBOARDING_EMOJI_KEYS),
  }
}

function projectOnboardingOption(value: unknown): ProjectedOnboardingOption {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw onboardingEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== "string"
    || !Array.isArray(record.channel_ids)
    || !Array.isArray(record.role_ids)
    || !(record.description === null || typeof record.description === "string")
  ) {
    throw onboardingEvidenceError()
  }
  try {
    assertPositiveSnowflake(record.id, "Discord onboarding option ID")
  } catch (error) {
    throw onboardingEvidenceError({ cause: error })
  }
  const emoji = projectOnboardingEmoji(record.emoji)
  return {
    option: {
      channelIds: onboardingReturnedIds(
        record.channel_ids,
        ONBOARDING_LIMITS.auditReferencesPerOption,
      ),
      description: onboardingReturnedText(record.description, true),
      emoji: emoji.emoji,
      id: record.id,
      roleIds: onboardingReturnedIds(
        record.role_ids,
        ONBOARDING_LIMITS.auditReferencesPerOption,
      ),
      title: onboardingReturnedText(record.title, false) as string,
    },
    unknownFieldCount:
      unknownOnboardingFieldCount(record, ONBOARDING_OPTION_KEYS)
      + emoji.unknownFieldCount,
  }
}

function projectOnboardingPrompt(value: unknown): ProjectedOnboardingPrompt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw onboardingEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== "string"
    || !Number.isSafeInteger(record.type)
    || !Array.isArray(record.options)
    || record.options.length > ONBOARDING_LIMITS.auditOptionsPerPrompt
    || typeof record.single_select !== "boolean"
    || typeof record.required !== "boolean"
    || typeof record.in_onboarding !== "boolean"
  ) {
    throw onboardingEvidenceError()
  }
  try {
    assertPositiveSnowflake(record.id, "Discord onboarding prompt ID")
  } catch (error) {
    throw onboardingEvidenceError({ cause: error })
  }
  const options = record.options.map(projectOnboardingOption)
  return {
    prompt: {
      id: record.id,
      inOnboarding: record.in_onboarding,
      options: options.map((entry) => entry.option),
      required: record.required,
      singleSelect: record.single_select,
      title: onboardingReturnedText(record.title, false) as string,
      type: record.type as number,
    },
    unknownEnumCount: ONBOARDING_ENUM_VALUES.has(record.type as number) ? 0 : 1,
    unknownFieldCount:
      unknownOnboardingFieldCount(record, ONBOARDING_PROMPT_KEYS)
      + options.reduce((total, entry) => total + entry.unknownFieldCount, 0),
  }
}

function projectGuildOnboarding(
  value: unknown,
  guildId: string,
): DiscordGuildOnboarding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw onboardingEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    record.guild_id !== guildId
    || typeof record.enabled !== "boolean"
    || !Number.isSafeInteger(record.mode)
    || !Array.isArray(record.prompts)
    || record.prompts.length > ONBOARDING_LIMITS.auditPrompts
  ) {
    throw onboardingEvidenceError()
  }
  const prompts = record.prompts.map(projectOnboardingPrompt)
  const optionCount = prompts.reduce(
    (total, entry) => total + entry.prompt.options.length,
    0,
  )
  if (optionCount > ONBOARDING_LIMITS.auditTotalOptions) {
    throw onboardingEvidenceError()
  }
  return {
    defaultChannelIds: onboardingReturnedIds(
      record.default_channel_ids,
      DISCORD_LIMITS.guildChannels,
    ),
    enabled: record.enabled,
    guildId,
    mode: record.mode as number,
    prompts: prompts.map((entry) => entry.prompt),
    unknownEnumCount:
      (ONBOARDING_ENUM_VALUES.has(record.mode as number) ? 0 : 1)
      + prompts.reduce((total, entry) => total + entry.unknownEnumCount, 0),
    unknownFieldCount:
      unknownOnboardingFieldCount(record, ONBOARDING_KEYS)
      + prompts.reduce((total, entry) => total + entry.unknownFieldCount, 0),
  }
}

function assertOnboardingInputText(
  value: unknown,
  maximum: number,
  name: string,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || (!allowEmpty && value.length === 0)
    || [...value].length > maximum
    || ONBOARDING_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(`${name} is invalid`)
  }
  assertValidUnicode(value, name)
}

function assertOnboardingInputIds(
  value: unknown,
  maximum: number,
  name: string,
): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`${name} is invalid`)
  }
  for (const entry of value) {
    assertPositiveSnowflake(entry as string, name)
  }
  if (new Set(value).size !== value.length) {
    throw new RangeError(`${name} must be unique`)
  }
}

function assertOnboardingEmojiInput(
  value: unknown,
): asserts value is DiscordOnboardingEmojiInput | null {
  if (value === null) return
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord onboarding emoji must be an exact object or null")
  }
  const record = value as Record<string, unknown>
  if (
    !hasOnlyKeys(record, ONBOARDING_EMOJI_INPUT_KEYS)
    || typeof record.animated !== "boolean"
    || !(record.id === null || typeof record.id === "string")
    || !(record.name === null || typeof record.name === "string")
    || (record.id === null && record.name === null)
    || (record.id === null && record.animated)
  ) {
    throw new RangeError("Discord onboarding emoji is invalid")
  }
  if (typeof record.id === "string") {
    assertPositiveSnowflake(record.id, "Discord onboarding emoji ID")
  }
  if (typeof record.name === "string") {
    assertOnboardingInputText(
      record.name,
      ONBOARDING_LIMITS.optionTitleCharacters,
      "Discord onboarding emoji name",
    )
  }
}

function assertModifyGuildOnboardingInput(
  value: unknown,
): asserts value is ModifyGuildOnboardingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord onboarding input must be an exact object")
  }
  const input = value as Record<string, unknown>
  if (
    !hasOnlyKeys(input, ONBOARDING_INPUT_KEYS)
    || typeof input.enabled !== "boolean"
    || !ONBOARDING_ENUM_VALUES.has(input.mode as number)
    || !Array.isArray(input.prompts)
    || input.prompts.length > ONBOARDING_LIMITS.prompts
  ) {
    throw new RangeError("Discord onboarding input is invalid")
  }
  assertOnboardingInputIds(
    input.defaultChannelIds,
    ONBOARDING_LIMITS.defaultChannels,
    "Discord onboarding default channel IDs",
  )
  let optionCount = 0
  const promptIds: string[] = []
  const optionIds: string[] = []
  for (const promptValue of input.prompts) {
    if (!promptValue || typeof promptValue !== "object" || Array.isArray(promptValue)) {
      throw new RangeError("Discord onboarding prompt must be an exact object")
    }
    const prompt = promptValue as Record<string, unknown>
    if (
      !hasOnlyKeys(prompt, ONBOARDING_PROMPT_INPUT_KEYS)
      || typeof prompt.id !== "string"
      || !ONBOARDING_ENUM_VALUES.has(prompt.type as number)
      || typeof prompt.singleSelect !== "boolean"
      || typeof prompt.required !== "boolean"
      || typeof prompt.inOnboarding !== "boolean"
      || !Array.isArray(prompt.options)
      || prompt.options.length > ONBOARDING_LIMITS.optionsPerPrompt
    ) {
      throw new RangeError("Discord onboarding prompt is invalid")
    }
    assertPositiveSnowflake(prompt.id, "Discord onboarding prompt ID")
    promptIds.push(prompt.id)
    assertOnboardingInputText(
      prompt.title,
      ONBOARDING_LIMITS.promptTitleCharacters,
      "Discord onboarding prompt title",
    )
    optionCount += prompt.options.length
    for (const optionValue of prompt.options) {
      if (!optionValue || typeof optionValue !== "object" || Array.isArray(optionValue)) {
        throw new RangeError("Discord onboarding option must be an exact object")
      }
      const option = optionValue as Record<string, unknown>
      if (
        !hasOnlyKeys(option, ONBOARDING_OPTION_INPUT_KEYS)
        || !(option.id === undefined || typeof option.id === "string")
        || !(option.description === null || typeof option.description === "string")
      ) {
        throw new RangeError("Discord onboarding option is invalid")
      }
      if (typeof option.id === "string") {
        assertPositiveSnowflake(option.id, "Discord onboarding option ID")
        optionIds.push(option.id)
      }
      assertOnboardingInputText(
        option.title,
        ONBOARDING_LIMITS.optionTitleCharacters,
        "Discord onboarding option title",
      )
      if (typeof option.description === "string") {
        assertOnboardingInputText(
          option.description,
          ONBOARDING_LIMITS.optionDescriptionCharacters,
          "Discord onboarding option description",
          true,
        )
      }
      assertOnboardingInputIds(
        option.channelIds,
        ONBOARDING_LIMITS.optionReferences,
        "Discord onboarding option channel IDs",
      )
      assertOnboardingInputIds(
        option.roleIds,
        ONBOARDING_LIMITS.optionReferences,
        "Discord onboarding option role IDs",
      )
      assertOnboardingEmojiInput(option.emoji)
    }
  }
  if (optionCount > ONBOARDING_LIMITS.prompts * ONBOARDING_LIMITS.optionsPerPrompt) {
    throw new RangeError("Discord onboarding option count is invalid")
  }
  if (new Set(promptIds).size !== promptIds.length) {
    throw new RangeError("Discord onboarding prompt IDs must be unique")
  }
  if (new Set(optionIds).size !== optionIds.length) {
    throw new RangeError("Discord onboarding option IDs must be unique")
  }
}

function projectWebhook(value: unknown): DiscordWebhookSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebhookEvidenceError("Discord returned an invalid webhook object")
  }
  const record = value as Record<string, unknown>
  const user = record.user
  if (
    typeof record.id !== "string"
    || !Number.isSafeInteger(record.type)
    || !(record.name === null || typeof record.name === "string")
    || !(
      record.guild_id === null
      || record.guild_id === undefined
      || typeof record.guild_id === "string"
    )
    || !(record.channel_id === null || typeof record.channel_id === "string")
    || !(
      record.application_id === null
      || typeof record.application_id === "string"
    )
    || !(user === null || user === undefined || (
      user !== null
      && typeof user === "object"
      && !Array.isArray(user)
      && typeof (user as Record<string, unknown>).id === "string"
    ))
  ) {
    throw new WebhookEvidenceError("Discord returned an invalid webhook object")
  }
  try {
    assertPositiveSnowflake(record.id, "Discord webhook ID")
    if (typeof record.guild_id === "string") {
      assertPositiveSnowflake(record.guild_id, "Discord webhook guild ID")
    }
    if (typeof record.channel_id === "string") {
      assertPositiveSnowflake(record.channel_id, "Discord webhook channel ID")
    }
    if (typeof record.application_id === "string") {
      assertPositiveSnowflake(record.application_id, "Discord webhook application ID")
    }
    if (user && typeof user === "object") {
      assertPositiveSnowflake(
        (user as Record<string, unknown>).id as string,
        "Discord webhook creator ID",
      )
    }
    if (typeof record.name === "string") {
      if (
        [...record.name].length < 1
        || [...record.name].length > DISCORD_LIMITS.webhookNameCharacters
        || /[\u0000-\u001F\u007F]/u.test(record.name)
      ) {
        throw new RangeError("Discord webhook name is invalid")
      }
      assertValidUnicode(record.name, "Discord webhook name")
    }
  } catch (error) {
    throw new WebhookEvidenceError("Discord returned an invalid webhook object", {
      cause: error,
    })
  }
  return {
    applicationId: typeof record.application_id === "string"
      ? record.application_id
      : null,
    channelId: typeof record.channel_id === "string" ? record.channel_id : null,
    creatorUserId: user && typeof user === "object"
      ? (user as Record<string, unknown>).id as string
      : null,
    guildId: typeof record.guild_id === "string" ? record.guild_id : null,
    id: record.id,
    name: record.name,
    type: record.type as number,
  }
}

function projectGuildEmoji(value: unknown): DiscordGuildEmojiSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji object")
  }
  const record = value as Record<string, unknown>
  const roles = record.roles ?? []
  const user = record.user
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || !Array.isArray(roles)
    || roles.some((roleId) => typeof roleId !== "string")
    || !(record.animated === undefined || typeof record.animated === "boolean")
    || !(record.available === undefined || typeof record.available === "boolean")
    || !(record.managed === undefined || typeof record.managed === "boolean")
    || !(record.require_colons === undefined || typeof record.require_colons === "boolean")
    || !(user === undefined || (
      user !== null
      && typeof user === "object"
      && !Array.isArray(user)
      && typeof (user as Record<string, unknown>).id === "string"
    ))
  ) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji object")
  }
  try {
    assertPositiveSnowflake(record.id, "Discord guild emoji ID")
    for (const roleId of roles as string[]) {
      assertPositiveSnowflake(roleId, "Discord guild emoji role ID")
    }
    const creatorUserId = user === undefined
      ? null
      : (user as Record<string, unknown>).id as string
    if (creatorUserId !== null) {
      assertPositiveSnowflake(creatorUserId, "Discord guild emoji creator ID")
    }
    return {
      animated: record.animated === true,
      available: record.available !== false,
      creatorUserId,
      id: record.id,
      managed: record.managed === true,
      name: record.name,
      requiresColons: record.require_colons !== false,
      roleIds: [...roles as string[]],
    }
  } catch (error) {
    if (error instanceof GuildExpressionEvidenceError) throw error
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji object", {
      cause: error,
    })
  }
}

function projectGuildSticker(
  value: unknown,
  guildId: string,
): DiscordGuildStickerSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild sticker object")
  }
  const record = value as Record<string, unknown>
  const user = record.user
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || !(record.description === null || typeof record.description === "string")
    || typeof record.tags !== "string"
    || !Number.isSafeInteger(record.type)
    || !Number.isSafeInteger(record.format_type)
    || !(record.available === undefined || typeof record.available === "boolean")
    || !(record.guild_id === undefined || typeof record.guild_id === "string")
    || !(user === undefined || (
      user !== null
      && typeof user === "object"
      && !Array.isArray(user)
      && typeof (user as Record<string, unknown>).id === "string"
    ))
  ) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild sticker object")
  }
  try {
    assertPositiveSnowflake(record.id, "Discord guild sticker ID")
    assertPositiveSnowflake(guildId, "Discord guild sticker guild ID")
    if (typeof record.guild_id === "string") {
      assertPositiveSnowflake(record.guild_id, "Discord guild sticker response guild ID")
      if (record.guild_id !== guildId) {
        throw new GuildExpressionEvidenceError("Discord returned a guild sticker for another guild")
      }
    }
    const creatorUserId = user === undefined
      ? null
      : (user as Record<string, unknown>).id as string
    if (creatorUserId !== null) {
      assertPositiveSnowflake(creatorUserId, "Discord guild sticker creator ID")
    }
    return {
      available: record.available !== false,
      creatorUserId,
      description: record.description as string | null,
      formatType: record.format_type as number,
      guildId,
      id: record.id,
      name: record.name,
      tags: record.tags,
      type: record.type as number,
    }
  } catch (error) {
    if (error instanceof GuildExpressionEvidenceError) throw error
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild sticker object", {
      cause: error,
    })
  }
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key))
}

function autoModerationReturnedText(
  value: unknown,
  maximum: number,
  description: string,
): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > maximum
    || value.trim() !== value
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new AutoModerationEvidenceError(
      `Discord returned invalid AutoMod ${description}`,
    )
  }
  try {
    assertValidUnicode(value, `Discord AutoMod ${description}`)
  } catch (error) {
    throw new AutoModerationEvidenceError(
      `Discord returned invalid AutoMod ${description}`,
      { cause: error },
    )
  }
  return value
}

function autoModerationReturnedStrings(
  value: unknown,
  maximumEntries: number,
  maximumCharacters: number,
  description: string,
): string[] {
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw new AutoModerationEvidenceError(
      `Discord returned invalid AutoMod ${description}`,
    )
  }
  const result = value.map((entry) => autoModerationReturnedText(
    entry,
    maximumCharacters,
    description,
  )).sort()
  if (new Set(result).size !== result.length) {
    throw new AutoModerationEvidenceError(
      `Discord returned duplicate AutoMod ${description}`,
    )
  }
  return result
}

function autoModerationReturnedSnowflakes(
  value: unknown,
  maximum: number,
  description: string,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new AutoModerationEvidenceError(
      `Discord returned invalid AutoMod ${description}`,
    )
  }
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new AutoModerationEvidenceError(
        `Discord returned invalid AutoMod ${description}`,
      )
    }
    try {
      assertPositiveSnowflake(entry, `Discord AutoMod ${description}`)
    } catch (error) {
      throw new AutoModerationEvidenceError(
        `Discord returned invalid AutoMod ${description}`,
        { cause: error },
      )
    }
    result.push(entry)
  }
  if (new Set(result).size !== result.length) {
    throw new AutoModerationEvidenceError(
      `Discord returned duplicate AutoMod ${description}`,
    )
  }
  return result.sort((left, right) => {
    const leftId = BigInt(left)
    const rightId = BigInt(right)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function projectAutoModerationTrigger(
  triggerType: number,
  value: unknown,
): DiscordAutoModerationTrigger {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutoModerationEvidenceError(
      "Discord returned invalid AutoMod trigger metadata",
    )
  }
  const metadata = value as Record<string, unknown>
  if (
    triggerType === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword
    || triggerType === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
  ) {
    if (!hasOnlyKeys(metadata, ["allow_list", "keyword_filter", "regex_patterns"])) {
      throw new AutoModerationEvidenceError(
        "Discord returned unsupported AutoMod keyword metadata",
      )
    }
    const keywordFilter = autoModerationReturnedStrings(
      metadata.keyword_filter ?? [],
      DISCORD_LIMITS.autoModerationKeywordEntries,
      DISCORD_LIMITS.autoModerationKeywordCharacters,
      "keyword filter",
    )
    const regexPatterns = autoModerationReturnedStrings(
      metadata.regex_patterns ?? [],
      DISCORD_LIMITS.autoModerationRegexPatterns,
      DISCORD_LIMITS.autoModerationRegexCharacters,
      "regex patterns",
    )
    if (keywordFilter.length === 0 && regexPatterns.length === 0) {
      throw new AutoModerationEvidenceError(
        "Discord returned an empty AutoMod keyword trigger",
      )
    }
    return {
      allowList: autoModerationReturnedStrings(
        metadata.allow_list ?? [],
        DISCORD_LIMITS.autoModerationAllowListKeywords,
        DISCORD_LIMITS.autoModerationKeywordCharacters,
        "allow list",
      ),
      keywordFilter,
      regexPatterns,
      type: triggerType,
    }
  }
  if (triggerType === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam) {
    if (Object.keys(metadata).length !== 0) {
      throw new AutoModerationEvidenceError(
        "Discord returned unsupported AutoMod spam metadata",
      )
    }
    return { type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam }
  }
  if (triggerType === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset) {
    if (!hasOnlyKeys(metadata, ["allow_list", "presets"])) {
      throw new AutoModerationEvidenceError(
        "Discord returned unsupported AutoMod preset metadata",
      )
    }
    if (!Array.isArray(metadata.presets) || metadata.presets.length < 1) {
      throw new AutoModerationEvidenceError(
        "Discord returned invalid AutoMod keyword presets",
      )
    }
    const presets = metadata.presets.map((entry) => {
      if (!Number.isSafeInteger(entry) || !AUTO_MODERATION_PRESET_VALUES.has(entry as number)) {
        throw new AutoModerationEvidenceError(
          "Discord returned unsupported AutoMod keyword presets",
        )
      }
      return entry as DiscordAutoModerationKeywordPreset
    }).sort((left, right) => left - right)
    if (new Set(presets).size !== presets.length) {
      throw new AutoModerationEvidenceError(
        "Discord returned duplicate AutoMod keyword presets",
      )
    }
    return {
      allowList: autoModerationReturnedStrings(
        metadata.allow_list ?? [],
        DISCORD_LIMITS.autoModerationAllowListPresetKeywords,
        DISCORD_LIMITS.autoModerationKeywordCharacters,
        "preset allow list",
      ),
      presets,
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset,
    }
  }
  if (triggerType === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam) {
    if (!hasOnlyKeys(metadata, [
      "mention_raid_protection_enabled",
      "mention_total_limit",
    ])) {
      throw new AutoModerationEvidenceError(
        "Discord returned unsupported AutoMod mention metadata",
      )
    }
    if (
      !Number.isSafeInteger(metadata.mention_total_limit)
      || (metadata.mention_total_limit as number) < 1
      || (metadata.mention_total_limit as number) > DISCORD_LIMITS.autoModerationMentionLimit
      || !(
        metadata.mention_raid_protection_enabled === undefined
        || typeof metadata.mention_raid_protection_enabled === "boolean"
      )
    ) {
      throw new AutoModerationEvidenceError(
        "Discord returned invalid AutoMod mention metadata",
      )
    }
    return {
      mentionRaidProtectionEnabled: metadata.mention_raid_protection_enabled === true,
      mentionTotalLimit: metadata.mention_total_limit as number,
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam,
    }
  }
  throw new AutoModerationEvidenceError(
    "Discord returned an unsupported AutoMod trigger type",
  )
}

function projectAutoModerationActions(
  value: unknown,
): DiscordAutoModerationAction[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.autoModerationActions
  ) {
    throw new AutoModerationEvidenceError("Discord returned invalid AutoMod actions")
  }
  const actions = value.map((entry): DiscordAutoModerationAction => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AutoModerationEvidenceError("Discord returned invalid AutoMod action")
    }
    const action = entry as Record<string, unknown>
    if (
      !Number.isSafeInteger(action.type)
      || !AUTO_MODERATION_ACTION_TYPE_VALUES.has(action.type as number)
      || !hasOnlyKeys(action, ["metadata", "type"])
    ) {
      throw new AutoModerationEvidenceError("Discord returned invalid AutoMod action")
    }
    const metadata = action.metadata === undefined
      ? {}
      : action.metadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new AutoModerationEvidenceError(
        "Discord returned invalid AutoMod action metadata",
      )
    }
    const record = metadata as Record<string, unknown>
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage) {
      if (!hasOnlyKeys(record, ["custom_message"])) {
        throw new AutoModerationEvidenceError(
          "Discord returned unsupported AutoMod block-message metadata",
        )
      }
      return {
        customMessage: record.custom_message === undefined
          ? null
          : autoModerationReturnedText(
              record.custom_message,
              DISCORD_LIMITS.autoModerationCustomMessageCharacters,
              "custom block message",
            ),
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
      }
    }
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage) {
      if (
        !hasOnlyKeys(record, ["channel_id"])
        || typeof record.channel_id !== "string"
      ) {
        throw new AutoModerationEvidenceError(
          "Discord returned invalid AutoMod alert metadata",
        )
      }
      try {
        assertPositiveSnowflake(record.channel_id, "Discord AutoMod alert channel ID")
      } catch (error) {
        throw new AutoModerationEvidenceError(
          "Discord returned invalid AutoMod alert metadata",
          { cause: error },
        )
      }
      return {
        channelId: record.channel_id,
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
      }
    }
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout) {
      if (
        !hasOnlyKeys(record, ["duration_seconds"])
        || !Number.isSafeInteger(record.duration_seconds)
        || (record.duration_seconds as number) < 1
        || (record.duration_seconds as number) > DISCORD_LIMITS.autoModerationTimeoutSeconds
      ) {
        throw new AutoModerationEvidenceError(
          "Discord returned invalid AutoMod timeout metadata",
        )
      }
      return {
        durationSeconds: record.duration_seconds as number,
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout,
      }
    }
    if (Object.keys(record).length !== 0) {
      throw new AutoModerationEvidenceError(
        "Discord returned unsupported AutoMod interaction-block metadata",
      )
    }
    return { type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction }
  }).sort((left, right) => left.type - right.type)
  if (new Set(actions.map((action) => action.type)).size !== actions.length) {
    throw new AutoModerationEvidenceError("Discord returned duplicate AutoMod action types")
  }
  return actions
}

function assertAutoModerationCompatibility(
  eventType: number,
  trigger: DiscordAutoModerationTrigger,
  actions: readonly DiscordAutoModerationAction[],
): void {
  const profile = trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
  const expectedEventType = profile
    ? DISCORD_AUTO_MODERATION_EVENT_TYPES.memberUpdate
    : DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend
  if (eventType !== expectedEventType) {
    throw new AutoModerationEvidenceError(
      "Discord returned an incompatible AutoMod event and trigger",
    )
  }
  if (profile) {
    if (
      actions.length !== 1
      || actions[0]?.type !== DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction
    ) {
      throw new AutoModerationEvidenceError(
        "Discord returned incompatible member-profile AutoMod actions",
      )
    }
    return
  }
  if (actions.some((action) => (
    action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction
  ))) {
    throw new AutoModerationEvidenceError(
      "Discord returned a profile-only action for a message AutoMod rule",
    )
  }
  if (
    actions.some((action) => action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout)
    && trigger.type !== DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword
    && trigger.type !== DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam
  ) {
    throw new AutoModerationEvidenceError(
      "Discord returned a timeout action for an incompatible AutoMod trigger",
    )
  }
}

function projectGuildAutoModerationRule(
  value: unknown,
  guildId: string,
): DiscordAutoModerationRuleSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutoModerationEvidenceError("Discord returned an invalid AutoMod rule")
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== "string"
    || typeof record.guild_id !== "string"
    || typeof record.creator_id !== "string"
    || typeof record.name !== "string"
    || !Number.isSafeInteger(record.event_type)
    || !AUTO_MODERATION_EVENT_TYPE_VALUES.has(record.event_type as number)
    || !Number.isSafeInteger(record.trigger_type)
    || !AUTO_MODERATION_TRIGGER_TYPE_VALUES.has(record.trigger_type as number)
    || typeof record.enabled !== "boolean"
  ) {
    throw new AutoModerationEvidenceError("Discord returned an invalid AutoMod rule")
  }
  try {
    assertPositiveSnowflake(guildId, "Discord AutoMod guild ID")
    assertPositiveSnowflake(record.id, "Discord AutoMod rule ID")
    assertPositiveSnowflake(record.guild_id, "Discord AutoMod response guild ID")
    assertPositiveSnowflake(record.creator_id, "Discord AutoMod creator ID")
    if (record.guild_id !== guildId) {
      throw new AutoModerationEvidenceError(
        "Discord returned an AutoMod rule for another guild",
      )
    }
    const trigger = projectAutoModerationTrigger(
      record.trigger_type as number,
      record.trigger_metadata,
    )
    const actions = projectAutoModerationActions(record.actions)
    assertAutoModerationCompatibility(record.event_type as number, trigger, actions)
    const exemptChannelIds = autoModerationReturnedSnowflakes(
      record.exempt_channels,
      DISCORD_LIMITS.autoModerationExemptChannels,
      "exempt channel IDs",
    )
    if (
      trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
      && exemptChannelIds.length > 0
    ) {
      throw new AutoModerationEvidenceError(
        "Discord returned channel exemptions for a member-profile AutoMod rule",
      )
    }
    return {
      actions,
      creatorUserId: record.creator_id,
      enabled: record.enabled,
      eventType: record.event_type as DiscordAutoModerationEventType,
      exemptChannelIds,
      exemptRoleIds: autoModerationReturnedSnowflakes(
        record.exempt_roles,
        DISCORD_LIMITS.autoModerationExemptRoles,
        "exempt role IDs",
      ),
      guildId,
      id: record.id,
      name: autoModerationReturnedText(
        record.name,
        DISCORD_LIMITS.autoModerationRuleNameCharacters,
        "rule name",
      ),
      trigger,
    }
  } catch (error) {
    if (error instanceof AutoModerationEvidenceError) throw error
    throw new AutoModerationEvidenceError(
      "Discord returned an invalid AutoMod rule",
      { cause: error },
    )
  }
}

function canonicalScheduledEventTimestamp(
  value: unknown,
  description: string,
): string {
  if (
    typeof value !== "string"
    || !ISO_8601_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new ScheduledEventEvidenceError(
      `Discord returned an invalid scheduled event ${description}`,
    )
  }
  return new Date(Date.parse(value)).toISOString()
}

function scheduledEventIntegerArray(
  value: unknown,
  description: string,
  minimum: number,
  maximum: number,
): number[] | null {
  if (value === null) return null
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.some((entry) => (
      !Number.isSafeInteger(entry)
      || (entry as number) < minimum
      || (entry as number) > maximum
    ))
  ) {
    throw new ScheduledEventEvidenceError(
      `Discord returned invalid scheduled event recurrence ${description}`,
    )
  }
  const result = value as number[]
  if (new Set(result).size !== result.length) {
    throw new ScheduledEventEvidenceError(
      `Discord returned duplicate scheduled event recurrence ${description}`,
    )
  }
  return [...result]
}

function projectScheduledEventRecurrence(
  value: unknown,
): DiscordScheduledEventRecurrenceRule | null {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event recurrence rule",
    )
  }
  const record = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(record.frequency)
    || !SCHEDULED_EVENT_RECURRENCE_FREQUENCY_VALUES.has(record.frequency as number)
    || !Number.isSafeInteger(record.interval)
    || (record.interval as number) < 1
    || !(record.end === null || typeof record.end === "string")
    || !(record.count === null || (
      Number.isSafeInteger(record.count)
      && (record.count as number) >= 1
    ))
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned invalid scheduled event recurrence fields",
    )
  }
  const byWeekday = scheduledEventIntegerArray(
    record.by_weekday,
    "weekdays",
    0,
    6,
  )
  const byMonth = scheduledEventIntegerArray(
    record.by_month,
    "months",
    1,
    12,
  )
  const byMonthDay = scheduledEventIntegerArray(
    record.by_month_day,
    "month days",
    1,
    31,
  )
  const byYearDay = scheduledEventIntegerArray(
    record.by_year_day,
    "year days",
    1,
    364,
  )
  let byNWeekday: DiscordScheduledEventRecurrenceNWeekday[] | null = null
  if (record.by_n_weekday !== null) {
    if (
      !Array.isArray(record.by_n_weekday)
      || record.by_n_weekday.length < 1
      || record.by_n_weekday.some((entry) => (
        !entry
        || typeof entry !== "object"
        || Array.isArray(entry)
        || !Number.isSafeInteger((entry as Record<string, unknown>).n)
        || ((entry as Record<string, unknown>).n as number) < 1
        || ((entry as Record<string, unknown>).n as number) > 5
        || !Number.isSafeInteger((entry as Record<string, unknown>).day)
        || ((entry as Record<string, unknown>).day as number) < 0
        || ((entry as Record<string, unknown>).day as number) > 6
      ))
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned invalid scheduled event recurrence numbered weekdays",
      )
    }
    byNWeekday = record.by_n_weekday.map((entry) => ({
      day: (entry as Record<string, unknown>).day as number,
      n: (entry as Record<string, unknown>).n as number,
    }))
    if (
      new Set(byNWeekday.map((entry) => `${entry.n}:${entry.day}`)).size
      !== byNWeekday.length
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned duplicate scheduled event recurrence numbered weekdays",
      )
    }
  }
  const groups = [
    byWeekday !== null,
    byNWeekday !== null,
    byMonth !== null || byMonthDay !== null,
  ].filter(Boolean).length
  if (groups > 1 || (byMonth === null) !== (byMonthDay === null)) {
    throw new ScheduledEventEvidenceError(
      "Discord returned mutually incompatible scheduled event recurrence fields",
    )
  }
  const frequency = record.frequency as DiscordScheduledEventRecurrenceFrequency
  const interval = record.interval as number
  if (
    frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.daily
    && (
      interval !== 1
      || byNWeekday !== null
      || byMonth !== null
      || byMonthDay !== null
      || (byWeekday !== null && !SCHEDULED_EVENT_DAILY_WEEKDAY_SETS.has(byWeekday.join(",")))
    )
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an unsupported daily scheduled event recurrence",
    )
  }
  if (
    frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.weekly
    && (
      (interval !== 1 && interval !== 2)
      || byNWeekday !== null
      || byMonth !== null
      || byMonthDay !== null
      || (byWeekday !== null && byWeekday.length !== 1)
    )
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an unsupported weekly scheduled event recurrence",
    )
  }
  if (
    frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.monthly
    && (
      interval !== 1
      || byWeekday !== null
      || byMonth !== null
      || byMonthDay !== null
      || (byNWeekday !== null && byNWeekday.length !== 1)
    )
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an unsupported monthly scheduled event recurrence",
    )
  }
  if (
    frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.yearly
    && (
      interval !== 1
      || byWeekday !== null
      || byNWeekday !== null
      || (byMonth !== null && byMonth.length !== 1)
      || (byMonthDay !== null && byMonthDay.length !== 1)
    )
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an unsupported yearly scheduled event recurrence",
    )
  }
  return {
    byMonth,
    byMonthDay,
    byNWeekday,
    byWeekday,
    byYearDay,
    count: record.count as number | null,
    endTime: record.end === null
      ? null
      : canonicalScheduledEventTimestamp(record.end, "recurrence end time"),
    frequency,
    interval,
    startTime: canonicalScheduledEventTimestamp(
      record.start,
      "recurrence start time",
    ),
  }
}

function assertScheduledEventReturnedText(
  value: unknown,
  minimum: number,
  maximum: number,
  description: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new ScheduledEventEvidenceError(
      `Discord returned an invalid scheduled event ${description}`,
    )
  }
  try {
    assertValidUnicode(value, `Discord scheduled event ${description}`)
  } catch (error) {
    throw new ScheduledEventEvidenceError(
      `Discord returned an invalid scheduled event ${description}`,
      { cause: error },
    )
  }
}

function projectGuildScheduledEvent(
  value: unknown,
  guildId: string,
  includeSubscriberCount: boolean,
): DiscordScheduledEventSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event object",
    )
  }
  const record = value as Record<string, unknown>
  try {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    assertPositiveSnowflake(record.id as string, "Discord scheduled event ID")
    assertPositiveSnowflake(record.guild_id as string, "Discord scheduled event response guild ID")
    if (record.guild_id !== guildId) {
      throw new ScheduledEventEvidenceError(
        "Discord returned a scheduled event for another guild",
      )
    }
    if (record.channel_id !== null) {
      assertPositiveSnowflake(
        record.channel_id as string,
        "Discord scheduled event channel ID",
      )
    }
    if (record.creator_id !== undefined && record.creator_id !== null) {
      assertPositiveSnowflake(
        record.creator_id as string,
        "Discord scheduled event creator ID",
      )
    }
    if (record.entity_id !== null) {
      assertPositiveSnowflake(
        record.entity_id as string,
        "Discord scheduled event entity ID",
      )
    }
    assertScheduledEventReturnedText(
      record.name,
      1,
      DISCORD_LIMITS.scheduledEventNameCharacters,
      "name",
    )
    if (record.description !== undefined && record.description !== null) {
      assertScheduledEventReturnedText(
        record.description,
        1,
        DISCORD_LIMITS.scheduledEventDescriptionCharacters,
        "description",
      )
    }
    if (
      record.privacy_level !== 2
      || !Number.isSafeInteger(record.status)
      || !SCHEDULED_EVENT_STATUS_VALUES.has(record.status as number)
      || !Number.isSafeInteger(record.entity_type)
      || !SCHEDULED_EVENT_ENTITY_TYPE_VALUES.has(record.entity_type as number)
      || !(record.image === undefined || record.image === null || (
        typeof record.image === "string"
        && record.image.length >= 1
        && record.image.length <= 256
        && !EXPRESSION_TEXT_CONTROL_PATTERN.test(record.image)
      ))
      || !(record.user_count === undefined || (
        Number.isSafeInteger(record.user_count)
        && (record.user_count as number) >= 0
      ))
      || (includeSubscriberCount && record.user_count === undefined)
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned invalid scheduled event metadata",
      )
    }
    const entityType = record.entity_type as DiscordScheduledEventEntityType
    let location: string | null = null
    if (entityType === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external) {
      if (
        record.channel_id !== null
        || !record.entity_metadata
        || typeof record.entity_metadata !== "object"
        || Array.isArray(record.entity_metadata)
      ) {
        throw new ScheduledEventEvidenceError(
          "Discord returned invalid external scheduled event hosting",
        )
      }
      const rawLocation = (record.entity_metadata as Record<string, unknown>).location
      assertScheduledEventReturnedText(
        rawLocation,
        1,
        DISCORD_LIMITS.scheduledEventLocationCharacters,
        "location",
      )
      location = rawLocation
      if (record.scheduled_end_time === null) {
        throw new ScheduledEventEvidenceError(
          "Discord returned an external scheduled event without an end time",
        )
      }
    } else if (
      typeof record.channel_id !== "string"
      || record.entity_metadata !== null
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned invalid channel scheduled event hosting",
      )
    }
    const scheduledStartTime = canonicalScheduledEventTimestamp(
      record.scheduled_start_time,
      "start time",
    )
    const scheduledEndTime = record.scheduled_end_time === null
      ? null
      : canonicalScheduledEventTimestamp(record.scheduled_end_time, "end time")
    if (
      scheduledEndTime !== null
      && Date.parse(scheduledEndTime) <= Date.parse(scheduledStartTime)
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned a scheduled event whose end is not after its start",
      )
    }
    return {
      channelId: record.channel_id as string | null,
      creatorUserId: record.creator_id === undefined
        ? null
        : record.creator_id as string | null,
      description: record.description === undefined
        ? null
        : record.description as string | null,
      entityId: record.entity_id as string | null,
      entityType,
      guildId,
      hasCoverImage: typeof record.image === "string",
      id: record.id as string,
      location,
      name: record.name,
      privacyLevel: 2,
      recurrenceRule: projectScheduledEventRecurrence(record.recurrence_rule),
      scheduledEndTime,
      scheduledStartTime,
      status: record.status as DiscordScheduledEventStatus,
      subscriberCount: includeSubscriberCount
        ? record.user_count as number
        : null,
    }
  } catch (error) {
    if (error instanceof ScheduledEventEvidenceError) throw error
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event object",
      { cause: error },
    )
  }
}

function channelMetadataEvidenceError(options?: ErrorOptions): ChannelMetadataEvidenceError {
  return new ChannelMetadataEvidenceError(
    "Discord returned invalid guild channel metadata evidence",
    options,
  )
}

function returnedChannelMetadataText(
  value: unknown,
  maximum: number,
  name: string,
  allowNull: boolean,
): string | null {
  if (allowNull && (value === undefined || value === null)) return null
  if (
    typeof value !== "string"
    || (!allowNull && value.length < 1)
    || value.length > maximum
    || (name === "name"
      ? CHANNEL_NAME_CONTROL_PATTERN.test(value)
      : CHANNEL_TOPIC_CONTROL_PATTERN.test(value))
  ) {
    throw channelMetadataEvidenceError()
  }
  try {
    assertValidUnicode(value, `Discord channel ${name}`)
  } catch (error) {
    throw channelMetadataEvidenceError({ cause: error })
  }
  return value
}

function returnedChannelMetadataInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = value === undefined || value === null ? fallback : value
  if (
    typeof result !== "number"
    || !Number.isSafeInteger(result)
    || result < minimum
    || result > maximum
  ) {
    throw channelMetadataEvidenceError()
  }
  return result
}

function projectChannelMetadataOverwrites(value: unknown): {
  overwrites: DiscordPermissionOverwrite[]
  unknownFieldCount: number
} {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw channelMetadataEvidenceError()
  }
  const seen = new Set<string>()
  let unknownFieldCount = 0
  const overwrites = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw channelMetadataEvidenceError()
    }
    const record = entry as Record<string, unknown>
    try {
      assertPositiveSnowflake(record.id as string, "Discord channel overwrite ID")
      if (record.type !== 0 && record.type !== 1) throw new RangeError()
      const allow = assertPermissionBitfield(
        record.allow as string,
        "Discord channel overwrite allow field",
      )
      const deny = assertPermissionBitfield(
        record.deny as string,
        "Discord channel overwrite deny field",
      )
      if ((allow & deny) !== 0n) throw new RangeError()
    } catch (error) {
      throw channelMetadataEvidenceError({ cause: error })
    }
    const id = record.id as string
    if (seen.has(id)) throw channelMetadataEvidenceError()
    seen.add(id)
    unknownFieldCount += Object.keys(record)
      .filter((key) => !CHANNEL_METADATA_OVERWRITE_KEYS.has(key)).length
    return {
      allow: record.allow as string,
      deny: record.deny as string,
      id,
      type: record.type as 0 | 1,
    }
  }).sort((left, right) => {
    const leftId = BigInt(left.id)
    const rightId = BigInt(right.id)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : left.type - right.type
  })
  return { overwrites, unknownFieldCount }
}

function projectGuildChannelMetadata(
  value: unknown,
  expectedChannelId: string,
): DiscordChannelMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw channelMetadataEvidenceError()
  }
  const record = value as Record<string, unknown>
  try {
    assertPositiveSnowflake(record.id as string, "Discord channel metadata ID")
    assertPositiveSnowflake(record.guild_id as string, "Discord channel metadata guild ID")
  } catch (error) {
    throw channelMetadataEvidenceError({ cause: error })
  }
  if (
    record.id !== expectedChannelId
    || typeof record.type !== "number"
    || !Number.isSafeInteger(record.type)
    || !CHANNEL_METADATA_TYPES.has(record.type)
    || !Number.isSafeInteger(record.position)
    || (record.position as number) < 0
    || !Array.isArray(record.permission_overwrites)
    || !(
      record.parent_id === undefined
      || record.parent_id === null
      || typeof record.parent_id === "string"
        && DISCORD_SNOWFLAKE_PATTERN.test(record.parent_id)
        && BigInt(record.parent_id) >= 1n
        && BigInt(record.parent_id) <= DISCORD_SNOWFLAKE_MAX
    )
    || !(record.nsfw === undefined || typeof record.nsfw === "boolean")
  ) {
    throw channelMetadataEvidenceError()
  }
  const type = record.type
  const name = returnedChannelMetadataText(
    record.name,
    DISCORD_LIMITS.channelNameCharacters,
    "name",
    false,
  ) as string
  const topicMaximum = type === DISCORD_CHANNEL_TYPES.forum
      || type === DISCORD_CHANNEL_TYPES.media
    ? DISCORD_LIMITS.forumChannelTopicCharacters
    : DISCORD_LIMITS.channelTopicCharacters
  const rawTopic = returnedChannelMetadataText(
    record.topic,
    topicMaximum,
    "topic",
    true,
  )
  const rawNsfw = record.nsfw ?? false
  const rawRateLimit = returnedChannelMetadataInteger(
    record.rate_limit_per_user,
    0,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
  )
  const rawThreadRateLimit = returnedChannelMetadataInteger(
    record.default_thread_rate_limit_per_user,
    0,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
  )
  const rawAutoArchive = record.default_auto_archive_duration === undefined
      || record.default_auto_archive_duration === null
    ? null
    : returnedChannelMetadataInteger(
        record.default_auto_archive_duration,
        0,
        0,
        CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS.at(-1) as number,
      )
  if (
    rawAutoArchive !== null
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(rawAutoArchive)
  ) {
    throw channelMetadataEvidenceError()
  }
  if (
    (!CHANNEL_METADATA_TOPIC_TYPES.has(type) && rawTopic !== null)
    || (!CHANNEL_METADATA_NSFW_TYPES.has(type) && rawNsfw !== false)
    || (!CHANNEL_METADATA_RATE_LIMIT_TYPES.has(type) && rawRateLimit !== 0)
    || (!CHANNEL_METADATA_AUTO_ARCHIVE_TYPES.has(type) && rawAutoArchive !== null)
    || (!CHANNEL_METADATA_THREAD_RATE_TYPES.has(type) && rawThreadRateLimit !== 0)
  ) {
    throw channelMetadataEvidenceError()
  }
  const projectedOverwrites = projectChannelMetadataOverwrites(record.permission_overwrites)
  return {
    defaultAutoArchiveDuration: CHANNEL_METADATA_AUTO_ARCHIVE_TYPES.has(type)
      ? rawAutoArchive
      : null,
    defaultThreadRateLimitPerUser: CHANNEL_METADATA_THREAD_RATE_TYPES.has(type)
      ? rawThreadRateLimit
      : null,
    guildId: record.guild_id as string,
    id: expectedChannelId,
    name,
    nsfw: CHANNEL_METADATA_NSFW_TYPES.has(type) ? rawNsfw as boolean : null,
    parentId: (record.parent_id as string | null | undefined) ?? null,
    permissionOverwrites: projectedOverwrites.overwrites,
    position: record.position as number,
    rateLimitPerUser: CHANNEL_METADATA_RATE_LIMIT_TYPES.has(type)
      ? rawRateLimit
      : null,
    topic: CHANNEL_METADATA_TOPIC_TYPES.has(type) ? rawTopic : null,
    type,
    unknownFieldCount: Object.keys(record)
      .filter((key) => !CHANNEL_METADATA_RESPONSE_KEYS.has(key)).length
      + projectedOverwrites.unknownFieldCount,
  }
}

function channelMetadataBody(input: ModifyChannelMetadataInput): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord channel metadata input must be an exact object")
  }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length < 1
    || keys.some((key) => !MODIFY_CHANNEL_METADATA_KEYS.has(key))
    || keys.some((key) => record[key] === undefined)
  ) {
    throw new RangeError("Discord channel metadata input must contain supported explicit fields")
  }
  if (input.name !== undefined) {
    if (
      typeof input.name !== "string"
      || input.name.length < 1
      || input.name.length > DISCORD_LIMITS.channelNameCharacters
      || input.name.trim() !== input.name
      || CHANNEL_NAME_CONTROL_PATTERN.test(input.name)
    ) {
      throw new RangeError("Discord channel metadata name is invalid")
    }
    assertValidUnicode(input.name, "Discord channel metadata name")
  }
  if (input.topic !== undefined && input.topic !== null) {
    if (
      typeof input.topic !== "string"
      || input.topic.length > DISCORD_LIMITS.forumChannelTopicCharacters
      || (input.topic.length > 0 && input.topic.trim() !== input.topic)
      || CHANNEL_TOPIC_CONTROL_PATTERN.test(input.topic)
    ) {
      throw new RangeError("Discord channel metadata topic is invalid")
    }
    assertValidUnicode(input.topic, "Discord channel metadata topic")
  }
  if (input.nsfw !== undefined && typeof input.nsfw !== "boolean") {
    throw new RangeError("Discord channel metadata NSFW setting must be a boolean")
  }
  assertIntegerRange(
    input.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord channel metadata slowmode seconds",
  )
  assertIntegerRange(
    input.defaultThreadRateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord channel metadata default thread slowmode seconds",
  )
  if (
    input.defaultAutoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.defaultAutoArchiveDuration)
  ) {
    throw new RangeError("Discord channel metadata default auto-archive duration is unsupported")
  }
  return {
    ...(input.defaultAutoArchiveDuration !== undefined
      ? { default_auto_archive_duration: input.defaultAutoArchiveDuration }
      : {}),
    ...(input.defaultThreadRateLimitPerUser !== undefined
      ? { default_thread_rate_limit_per_user: input.defaultThreadRateLimitPerUser }
      : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.nsfw !== undefined ? { nsfw: input.nsfw } : {}),
    ...(input.rateLimitPerUser !== undefined
      ? { rate_limit_per_user: input.rateLimitPerUser }
      : {}),
    ...(input.topic !== undefined ? { topic: input.topic } : {}),
  }
}

function queryString(values: Record<string, QueryValue>): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) parameters.append(name, String(entry))
      continue
    }
    parameters.set(name, String(value))
  }
  const query = parameters.toString()
  return query ? `?${query}` : ""
}

function assertIntegerRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || value < minimum || value > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

function assertBoundedLimit(
  value: number | undefined,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || value < 1 || value > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`)
  }
}

function assertBoundedArray(
  values: readonly string[] | undefined,
  maximum: number,
  name: string,
): void {
  if (!values) return
  if (values.length < 1 || values.length > maximum) {
    throw new RangeError(`${name} must contain between 1 and ${maximum} values`)
  }
  if (new Set(values).size !== values.length) {
    throw new RangeError(`${name} must not contain duplicates`)
  }
}

function assertBoundedStrings(
  values: readonly string[] | undefined,
  maximumValues: number,
  maximumLength: number,
  name: string,
): void {
  assertBoundedArray(values, maximumValues, name)
  if (values?.some((value) => value.length < 1 || value.length > maximumLength)) {
    throw new RangeError(`${name} values must contain between 1 and ${maximumLength} characters`)
  }
}

function assertAllowedValue(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  if (value !== undefined && !allowed.has(value)) {
    throw new RangeError(`${name} is not supported by Discord`)
  }
}

function assertAllowedValues(
  values: readonly string[] | undefined,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  const invalid = values?.find((value) => !allowed.has(value))
  if (invalid !== undefined) {
    throw new RangeError(`${name} contains unsupported value ${JSON.stringify(invalid)}`)
  }
}

function assertSearchSnowflake(value: string | undefined, name: string): void {
  if (value !== undefined && !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a Discord snowflake`)
  }
}

function assertPositiveSnowflake(value: string, name: string): void {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

function assertSearchSnowflakes(
  values: readonly string[] | undefined,
  name: string,
): void {
  if (values?.some((value) => !DISCORD_SNOWFLAKE_PATTERN.test(value))) {
    throw new RangeError(`${name} values must be Discord snowflakes`)
  }
}

function assertPermissionBitfield(value: string, name: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RangeError(`${name} must be a canonical unsigned decimal bitfield`)
  }
  return BigInt(value)
}

function assertIsoTimestamp(value: string | undefined, name: string): void {
  if (
    value !== undefined
    && (
      !ISO_8601_TIMESTAMP_PATTERN.test(value)
      || Number.isNaN(Date.parse(value))
    )
  ) {
    throw new RangeError(`${name} must be an ISO 8601 timestamp`)
  }
}

function assertExclusiveCursors(
  values: Record<string, string | undefined>,
): void {
  const present = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
  if (present.length > 1) {
    throw new RangeError(`${present.join(", ")} are mutually exclusive`)
  }
}

function assertMessageContent(content: string): void {
  if (typeof content !== "string" || !content.trim()) {
    throw new RangeError("Discord message content must not be blank")
  }
  if (content.length > DISCORD_LIMITS.messageContentCharacters) {
    throw new RangeError(
      `Discord message content must not exceed ${DISCORD_LIMITS.messageContentCharacters} characters`,
    )
  }
}

function assertPollText(value: string, maximum: number, name: string): void {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || POLL_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(`${name} must contain 1-${maximum} trimmed characters without controls`)
  }
  assertValidUnicode(value, name)
}

function assertPollEmoji(value: string): void {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || POLL_EMOJI_CONTROL_OR_SPACE_PATTERN.test(value)
  ) {
    throw new RangeError("Discord poll answer emoji is invalid")
  }
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
  if (segments.length !== 1 || !POLL_EMOJI_CODE_POINT_PATTERN.test(value)) {
    throw new RangeError("Discord poll answer emoji must be one Unicode emoji")
  }
}

function assertCreatePollInput(input: CreatePollInput): void {
  assertPollText(input.question, POLL_LIMITS.questionCharacters, "Discord poll question")
  if (
    !Array.isArray(input.answers)
    || input.answers.length < POLL_LIMITS.answersMinimum
    || input.answers.length > POLL_LIMITS.answers
  ) {
    throw new RangeError(
      `Discord poll answers must contain ${POLL_LIMITS.answersMinimum}-${POLL_LIMITS.answers} entries`,
    )
  }
  const logicalAnswers = new Set<string>()
  for (const answer of input.answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw new RangeError("Discord poll answers must be objects")
    }
    assertPollText(answer.text, POLL_LIMITS.answerCharacters, "Discord poll answer")
    const logical = answer.text.normalize("NFKC").toLocaleLowerCase("en-US")
    if (logicalAnswers.has(logical)) {
      throw new RangeError("Discord poll answers must be logically unique")
    }
    logicalAnswers.add(logical)
    if (answer.emoji !== undefined) assertPollEmoji(answer.emoji)
  }
  if (
    !Number.isInteger(input.durationHours)
    || input.durationHours < 1
    || input.durationHours > POLL_LIMITS.durationHours
  ) {
    throw new RangeError(
      `Discord poll duration must be an integer between 1 and ${POLL_LIMITS.durationHours} hours`,
    )
  }
  if (typeof input.allowMultiselect !== "boolean") {
    throw new RangeError("Discord poll multiselect setting must be a boolean")
  }
  if (
    typeof input.nonce !== "string"
    || input.nonce.length < 1
    || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters
  ) {
    throw new RangeError(
      `Discord poll nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
    )
  }
}

function assertAttachmentFilename(filename: string): void {
  if (
    typeof filename !== "string"
    || filename.length < 1
    || filename.length > DISCORD_LIMITS.attachmentFilenameCharacters
    || filename.trim() !== filename
    || filename === "."
    || filename === ".."
    || /[\\/\u0000-\u001F\u007F]/u.test(filename)
  ) {
    throw new RangeError("Discord attachment filename is invalid")
  }
  assertValidUnicode(filename, "Discord attachment filename")
}

function assertValidUnicode(value: string, name: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${name} contains invalid Unicode`, { cause: error })
  }
}

function assertCreateGuildChannelInput(input: CreateGuildChannelInput): void {
  const supportedTypes: ReadonlySet<number> = new Set([
    DISCORD_CHANNEL_TYPES.category,
    DISCORD_CHANNEL_TYPES.forum,
    DISCORD_CHANNEL_TYPES.text,
  ])
  if (!supportedTypes.has(input.type)) {
    throw new RangeError("Discord channel creation type is not supported")
  }
  if (
    typeof input.name !== "string"
    || input.name.length < 1
    || input.name.length > DISCORD_LIMITS.channelNameCharacters
    || input.name.trim() !== input.name
    || CHANNEL_NAME_CONTROL_PATTERN.test(input.name)
  ) {
    throw new RangeError(
      `Discord channel name must contain 1-${DISCORD_LIMITS.channelNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(input.name, "Discord channel name")
  if (
    input.parentId !== undefined
    && (
      typeof input.parentId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(input.parentId)
    )
  ) {
    throw new RangeError("Discord channel parent ID must be a snowflake")
  }
  if (input.topic !== undefined && input.topic !== null) {
    if (
      typeof input.topic !== "string"
      || !input.topic.trim()
      || input.topic.length > DISCORD_LIMITS.channelTopicCharacters
      || CHANNEL_TOPIC_CONTROL_PATTERN.test(input.topic)
    ) {
      throw new RangeError(
        `Discord channel topic must be nonblank and at most ${DISCORD_LIMITS.channelTopicCharacters} characters without unsupported controls`,
      )
    }
    assertValidUnicode(input.topic, "Discord channel topic")
  }
  if (input.nsfw !== undefined && typeof input.nsfw !== "boolean") {
    throw new RangeError("Discord channel NSFW setting must be a boolean")
  }
  assertIntegerRange(
    input.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord channel slowmode seconds",
  )
  if (
    input.defaultAutoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.defaultAutoArchiveDuration)
  ) {
    throw new RangeError("Discord channel default auto-archive duration is not supported")
  }
  if (
    input.type === DISCORD_CHANNEL_TYPES.category
    && (
      input.defaultAutoArchiveDuration !== undefined
      || input.nsfw !== undefined
      || input.parentId !== undefined
      || input.rateLimitPerUser !== undefined
      || input.topic !== undefined
    )
  ) {
    throw new RangeError("Discord category creation does not accept channel-specific settings")
  }
}

function assertCreateForumPostInput(input: CreateForumPostInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord forum-post input must be an object")
  }
  if (
    typeof input.name !== "string"
    || input.name.length < 1
    || input.name.length > DISCORD_LIMITS.channelNameCharacters
    || input.name.trim() !== input.name
    || CHANNEL_NAME_CONTROL_PATTERN.test(input.name)
  ) {
    throw new RangeError(
      `Discord forum-post name must contain 1-${DISCORD_LIMITS.channelNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(input.name, "Discord forum-post name")
  assertMessageContent(input.content)
  if (CHANNEL_TOPIC_CONTROL_PATTERN.test(input.content)) {
    throw new RangeError("Discord forum-post content contains unsupported control characters")
  }
  assertValidUnicode(input.content, "Discord forum-post content")
  if (
    input.autoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.autoArchiveDuration)
  ) {
    throw new RangeError("Discord forum-post auto-archive duration is not supported")
  }
  assertIntegerRange(
    input.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord forum-post slowmode seconds",
  )
  if (input.appliedTagIds !== undefined) {
    if (
      !Array.isArray(input.appliedTagIds)
      || input.appliedTagIds.length < 1
      || input.appliedTagIds.length > DISCORD_LIMITS.forumAppliedTags
      || new Set(input.appliedTagIds).size !== input.appliedTagIds.length
      || input.appliedTagIds.some((value) => (
        typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)
      ))
    ) {
      throw new RangeError(
        `Discord forum-post tag IDs must contain 1-${DISCORD_LIMITS.forumAppliedTags} unique snowflakes`,
      )
    }
  }
  assertAllowedMentions(input.allowedMentions)
}

function assertCreateGuildRoleInput(input: CreateGuildRoleInput): void {
  if (
    typeof input.name !== "string"
    || input.name.length < 1
    || input.name.length > DISCORD_LIMITS.roleNameCharacters
    || input.name.trim() !== input.name
    || ROLE_NAME_CONTROL_PATTERN.test(input.name)
  ) {
    throw new RangeError(
      `Discord role name must contain 1-${DISCORD_LIMITS.roleNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(input.name, "Discord role name")
  if (
    typeof input.permissions !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(input.permissions)
  ) {
    throw new RangeError("Discord role permissions must be a canonical decimal bitfield")
  }
  if (typeof input.primaryColor !== "number") {
    throw new RangeError("Discord role primary color must be a number")
  }
  assertIntegerRange(
    input.primaryColor,
    0,
    DISCORD_LIMITS.roleColor,
    "Discord role primary color",
  )
  if (typeof input.hoist !== "boolean") {
    throw new RangeError("Discord role hoist setting must be a boolean")
  }
  if (typeof input.mentionable !== "boolean") {
    throw new RangeError("Discord role mentionable setting must be a boolean")
  }
}

const MODIFY_GUILD_ROLE_KEYS: ReadonlySet<string> = new Set([
  "colors",
  "hoist",
  "mentionable",
  "name",
  "permissions",
])
const MODIFY_GUILD_ROLE_COLOR_KEYS: ReadonlySet<string> = new Set([
  "primaryColor",
  "secondaryColor",
  "tertiaryColor",
])

function roleConfigurationEvidenceError(options?: ErrorOptions): RoleConfigurationEvidenceError {
  return new RoleConfigurationEvidenceError(
    "Discord returned invalid role-configuration evidence",
    options,
  )
}

function projectGuildRoleMemberCounts(value: unknown): DiscordGuildRoleMemberCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw roleConfigurationEvidenceError()
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > DISCORD_LIMITS.guildRoles - 1) {
    throw roleConfigurationEvidenceError()
  }
  const validated = entries.map(([roleId, count]) => {
    try {
      assertPositiveSnowflake(roleId, "Discord role member-count role ID")
    } catch (error) {
      throw roleConfigurationEvidenceError({ cause: error })
    }
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw roleConfigurationEvidenceError()
    }
    return [roleId, count] as const
  })
  const projected: Record<string, number> = {}
  for (const [roleId, count] of validated.sort(([left], [right]) => {
    const leftId = BigInt(left)
    const rightId = BigInt(right)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })) {
    projected[roleId] = count
  }
  return projected
}

function modifyGuildRoleBody(input: ModifyGuildRoleInput): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord role configuration input must be an exact object")
  }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length < 1
    || keys.some((key) => !MODIFY_GUILD_ROLE_KEYS.has(key))
    || keys.some((key) => record[key] === undefined)
  ) {
    throw new RangeError("Discord role configuration input requires supported explicit fields")
  }
  if (input.name !== undefined) {
    if (
      typeof input.name !== "string"
      || input.name.length < 1
      || input.name.length > DISCORD_LIMITS.roleNameCharacters
      || input.name.trim() !== input.name
      || ROLE_NAME_CONTROL_PATTERN.test(input.name)
    ) {
      throw new RangeError(
        `Discord role name must contain 1-${DISCORD_LIMITS.roleNameCharacters} characters without surrounding whitespace or controls`,
      )
    }
    assertValidUnicode(input.name, "Discord role name")
  }
  if (input.colors !== undefined) {
    if (
      !input.colors
      || typeof input.colors !== "object"
      || Array.isArray(input.colors)
      || Object.keys(input.colors).length !== MODIFY_GUILD_ROLE_COLOR_KEYS.size
      || Object.keys(input.colors).some((key) => !MODIFY_GUILD_ROLE_COLOR_KEYS.has(key))
    ) {
      throw new RangeError("Discord role colors must be a complete exact object")
    }
    assertIntegerRange(
      input.colors.primaryColor,
      0,
      DISCORD_LIMITS.roleColor,
      "Discord role primary color",
    )
    for (const [name, color] of [
      ["secondary", input.colors.secondaryColor],
      ["tertiary", input.colors.tertiaryColor],
    ] as const) {
      if (color !== null) {
        assertIntegerRange(
          color,
          0,
          DISCORD_LIMITS.roleColor,
          `Discord role ${name} color`,
        )
      }
    }
  }
  if (input.hoist !== undefined && typeof input.hoist !== "boolean") {
    throw new RangeError("Discord role hoist setting must be a boolean")
  }
  if (input.mentionable !== undefined && typeof input.mentionable !== "boolean") {
    throw new RangeError("Discord role mentionable setting must be a boolean")
  }
  if (
    input.permissions !== undefined
    && (typeof input.permissions !== "string" || !/^(0|[1-9][0-9]*)$/.test(input.permissions))
  ) {
    throw new RangeError("Discord role permissions must be a canonical decimal bitfield")
  }
  return {
    ...(input.colors !== undefined
      ? {
          colors: {
            primary_color: input.colors.primaryColor,
            secondary_color: input.colors.secondaryColor,
            tertiary_color: input.colors.tertiaryColor,
          },
        }
      : {}),
    ...(input.hoist !== undefined ? { hoist: input.hoist } : {}),
    ...(input.mentionable !== undefined ? { mentionable: input.mentionable } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
  }
}

function assertGuildExpressionName(name: string, kind: "emoji" | "sticker"): void {
  const maximum = kind === "emoji"
    ? DISCORD_LIMITS.emojiNameCharacters
    : DISCORD_LIMITS.stickerNameCharacters
  const valid = typeof name === "string"
    && name.length >= 2
    && name.length <= maximum
    && name.trim() === name
    && !EXPRESSION_TEXT_CONTROL_PATTERN.test(name)
    && (kind !== "emoji" || /^[A-Za-z0-9_]+$/u.test(name))
  if (!valid) {
    throw new RangeError(
      kind === "emoji"
        ? `Discord emoji name must contain 2-${maximum} ASCII letters, digits, or underscores`
        : `Discord sticker name must contain 2-${maximum} trimmed characters without controls`,
    )
  }
  assertValidUnicode(name, `Discord ${kind} name`)
}

function assertGuildEmojiRoleIds(roleIds: readonly string[]): void {
  if (
    !Array.isArray(roleIds)
    || roleIds.length > DISCORD_LIMITS.guildRoles
    || new Set(roleIds).size !== roleIds.length
  ) {
    throw new RangeError("Discord emoji role IDs must be a bounded unique array")
  }
  for (const roleId of roleIds) {
    assertPositiveSnowflake(roleId, "Discord emoji role ID")
  }
}

function assertGuildExpressionBytes(
  bytes: Uint8Array,
  maximum: number,
  kind: "emoji" | "sticker",
): void {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1
    || bytes.byteLength > maximum
  ) {
    throw new RangeError(
      `Discord ${kind} bytes must contain between 1 and ${maximum} bytes`,
    )
  }
}

function assertStickerDescription(description: string | null): void {
  if (description === null) return
  if (
    typeof description !== "string"
    || description.length === 1
    || description.length > DISCORD_LIMITS.stickerDescriptionCharacters
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(description)
  ) {
    throw new RangeError(
      `Discord sticker description must be empty or contain 2-${DISCORD_LIMITS.stickerDescriptionCharacters} characters without controls`,
    )
  }
  assertValidUnicode(description, "Discord sticker description")
}

function assertStickerTags(tags: string): void {
  if (
    typeof tags !== "string"
    || tags.length < 1
    || tags.length > DISCORD_LIMITS.stickerTagCharacters
    || !tags.trim()
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(tags)
  ) {
    throw new RangeError(
      `Discord sticker tags must contain 1-${DISCORD_LIMITS.stickerTagCharacters} characters without controls`,
    )
  }
  assertValidUnicode(tags, "Discord sticker tags")
}

function assertCreateGuildEmojiInput(input: CreateGuildEmojiInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord emoji creation input must be an object")
  }
  assertGuildExpressionName(input.name, "emoji")
  assertGuildExpressionBytes(input.bytes, DISCORD_LIMITS.emojiBytes, "emoji")
  if (!Object.hasOwn(EMOJI_FORMAT_MEDIA_TYPES, input.format)) {
    throw new RangeError("Discord emoji format is unsupported")
  }
  assertGuildEmojiRoleIds(input.roleIds)
}

function assertModifyGuildEmojiInput(input: ModifyGuildEmojiInput): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || (input.name === undefined && input.roleIds === undefined)
  ) {
    throw new RangeError("Discord emoji update must contain a name or role IDs")
  }
  if (input.name !== undefined) assertGuildExpressionName(input.name, "emoji")
  if (input.roleIds !== undefined) assertGuildEmojiRoleIds(input.roleIds)
}

function assertCreateGuildStickerInput(input: CreateGuildStickerInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord sticker creation input must be an object")
  }
  assertGuildExpressionName(input.name, "sticker")
  if (typeof input.description !== "string") {
    throw new RangeError("Discord sticker creation description must be a string")
  }
  assertStickerDescription(input.description)
  assertStickerTags(input.tags)
  assertGuildExpressionBytes(input.bytes, DISCORD_LIMITS.stickerBytes, "sticker")
  if (!Object.hasOwn(STICKER_FORMAT_UPLOADS, input.format)) {
    throw new RangeError("Discord sticker format is unsupported")
  }
}

function assertModifyGuildStickerInput(input: ModifyGuildStickerInput): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || (
      input.name === undefined
      && input.description === undefined
      && input.tags === undefined
    )
  ) {
    throw new RangeError("Discord sticker update must contain a name, description, or tags")
  }
  if (input.name !== undefined) assertGuildExpressionName(input.name, "sticker")
  if (input.description !== undefined) assertStickerDescription(input.description)
  if (input.tags !== undefined) assertStickerTags(input.tags)
}

function assertAutoModerationInputText(
  value: unknown,
  maximum: number,
  description: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > maximum
    || value.trim() !== value
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(`Discord AutoMod ${description} is invalid`)
  }
  assertValidUnicode(value, `Discord AutoMod ${description}`)
}

function assertAutoModerationInputStrings(
  value: unknown,
  maximumEntries: number,
  maximumCharacters: number,
  description: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw new RangeError(`Discord AutoMod ${description} are invalid`)
  }
  for (const entry of value) {
    assertAutoModerationInputText(entry, maximumCharacters, description)
  }
  if (new Set(value).size !== value.length) {
    throw new RangeError(`Discord AutoMod ${description} contain duplicates`)
  }
}

function assertAutoModerationInputSnowflakes(
  value: unknown,
  maximum: number,
  description: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`Discord AutoMod ${description} are invalid`)
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new RangeError(`Discord AutoMod ${description} are invalid`)
    }
    assertPositiveSnowflake(entry, `Discord AutoMod ${description}`)
  }
  if (new Set(value).size !== value.length) {
    throw new RangeError(`Discord AutoMod ${description} contain duplicates`)
  }
}

function assertAutoModerationTriggerInput(
  value: unknown,
): asserts value is DiscordAutoModerationTrigger {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord AutoMod trigger must be an object")
  }
  const trigger = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(trigger.type)
    || !AUTO_MODERATION_TRIGGER_TYPE_VALUES.has(trigger.type as number)
  ) {
    throw new RangeError("Discord AutoMod trigger type is unsupported")
  }
  if (
    trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword
    || trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
  ) {
    if (!hasOnlyKeys(trigger, ["allowList", "keywordFilter", "regexPatterns", "type"])) {
      throw new RangeError("Discord AutoMod keyword trigger fields are invalid")
    }
    assertAutoModerationInputStrings(
      trigger.keywordFilter,
      DISCORD_LIMITS.autoModerationKeywordEntries,
      DISCORD_LIMITS.autoModerationKeywordCharacters,
      "keyword filter",
    )
    assertAutoModerationInputStrings(
      trigger.regexPatterns,
      DISCORD_LIMITS.autoModerationRegexPatterns,
      DISCORD_LIMITS.autoModerationRegexCharacters,
      "regex patterns",
    )
    assertAutoModerationInputStrings(
      trigger.allowList,
      DISCORD_LIMITS.autoModerationAllowListKeywords,
      DISCORD_LIMITS.autoModerationKeywordCharacters,
      "allow list",
    )
    if (trigger.keywordFilter.length === 0 && trigger.regexPatterns.length === 0) {
      throw new RangeError("Discord AutoMod keyword trigger must contain a keyword or regex")
    }
    return
  }
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam) {
    if (!hasOnlyKeys(trigger, ["type"])) {
      throw new RangeError("Discord AutoMod spam trigger fields are invalid")
    }
    return
  }
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset) {
    if (!hasOnlyKeys(trigger, ["allowList", "presets", "type"])) {
      throw new RangeError("Discord AutoMod preset trigger fields are invalid")
    }
    if (
      !Array.isArray(trigger.presets)
      || trigger.presets.length < 1
      || trigger.presets.some((preset) => (
        !Number.isSafeInteger(preset)
        || !AUTO_MODERATION_PRESET_VALUES.has(preset as number)
      ))
      || new Set(trigger.presets).size !== trigger.presets.length
    ) {
      throw new RangeError("Discord AutoMod keyword presets are invalid")
    }
    assertAutoModerationInputStrings(
      trigger.allowList,
      DISCORD_LIMITS.autoModerationAllowListPresetKeywords,
      DISCORD_LIMITS.autoModerationKeywordCharacters,
      "preset allow list",
    )
    return
  }
  if (!hasOnlyKeys(trigger, [
    "mentionRaidProtectionEnabled",
    "mentionTotalLimit",
    "type",
  ])) {
    throw new RangeError("Discord AutoMod mention trigger fields are invalid")
  }
  if (
    !Number.isSafeInteger(trigger.mentionTotalLimit)
    || (trigger.mentionTotalLimit as number) < 1
    || (trigger.mentionTotalLimit as number) > DISCORD_LIMITS.autoModerationMentionLimit
    || typeof trigger.mentionRaidProtectionEnabled !== "boolean"
  ) {
    throw new RangeError("Discord AutoMod mention trigger metadata is invalid")
  }
}

function assertAutoModerationActionsInput(
  value: unknown,
): asserts value is DiscordAutoModerationAction[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.autoModerationActions
  ) {
    throw new RangeError("Discord AutoMod actions are invalid")
  }
  const types = new Set<number>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RangeError("Discord AutoMod action must be an object")
    }
    const action = entry as Record<string, unknown>
    if (
      !Number.isSafeInteger(action.type)
      || !AUTO_MODERATION_ACTION_TYPE_VALUES.has(action.type as number)
      || types.has(action.type as number)
    ) {
      throw new RangeError("Discord AutoMod action type is invalid or duplicated")
    }
    types.add(action.type as number)
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage) {
      if (
        !hasOnlyKeys(action, ["customMessage", "type"])
        || !(action.customMessage === null || typeof action.customMessage === "string")
      ) {
        throw new RangeError("Discord AutoMod block-message action is invalid")
      }
      if (typeof action.customMessage === "string") {
        assertAutoModerationInputText(
          action.customMessage,
          DISCORD_LIMITS.autoModerationCustomMessageCharacters,
          "custom block message",
        )
      }
    } else if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage) {
      if (
        !hasOnlyKeys(action, ["channelId", "type"])
        || typeof action.channelId !== "string"
      ) {
        throw new RangeError("Discord AutoMod alert action is invalid")
      }
      assertPositiveSnowflake(action.channelId, "Discord AutoMod alert channel ID")
    } else if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout) {
      if (
        !hasOnlyKeys(action, ["durationSeconds", "type"])
        || !Number.isSafeInteger(action.durationSeconds)
        || (action.durationSeconds as number) < 1
        || (action.durationSeconds as number) > DISCORD_LIMITS.autoModerationTimeoutSeconds
      ) {
        throw new RangeError("Discord AutoMod timeout action is invalid")
      }
    } else if (!hasOnlyKeys(action, ["type"])) {
      throw new RangeError("Discord AutoMod interaction-block action is invalid")
    }
  }
}

function assertAutoModerationInputCompatibility(
  trigger: DiscordAutoModerationTrigger,
  actions: readonly DiscordAutoModerationAction[],
  exemptChannelIds: readonly string[],
): void {
  const profile = trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
  if (profile) {
    if (
      actions.length !== 1
      || actions[0]?.type !== DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction
      || exemptChannelIds.length > 0
    ) {
      throw new RangeError(
        "Discord member-profile AutoMod rules require only interaction blocking and no channel exemptions",
      )
    }
    return
  }
  if (actions.some((action) => (
    action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction
  ))) {
    throw new RangeError("Discord interaction blocking is limited to member-profile AutoMod rules")
  }
  if (
    actions.some((action) => action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout)
    && trigger.type !== DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword
    && trigger.type !== DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam
  ) {
    throw new RangeError("Discord AutoMod timeout is incompatible with this trigger")
  }
}

function assertCreateGuildAutoModerationRuleInput(
  value: unknown,
): asserts value is CreateGuildAutoModerationRuleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord AutoMod creation input must be an object")
  }
  const input = value as Record<string, unknown>
  if (!hasOnlyKeys(input, [
    "actions",
    "exemptChannelIds",
    "exemptRoleIds",
    "name",
    "trigger",
  ])) {
    throw new RangeError("Discord AutoMod creation fields are invalid")
  }
  assertAutoModerationInputText(
    input.name,
    DISCORD_LIMITS.autoModerationRuleNameCharacters,
    "rule name",
  )
  assertAutoModerationTriggerInput(input.trigger)
  assertAutoModerationActionsInput(input.actions)
  assertAutoModerationInputSnowflakes(
    input.exemptRoleIds,
    DISCORD_LIMITS.autoModerationExemptRoles,
    "exempt role IDs",
  )
  assertAutoModerationInputSnowflakes(
    input.exemptChannelIds,
    DISCORD_LIMITS.autoModerationExemptChannels,
    "exempt channel IDs",
  )
  assertAutoModerationInputCompatibility(
    input.trigger,
    input.actions,
    input.exemptChannelIds,
  )
}

function assertModifyGuildAutoModerationRuleInput(
  value: unknown,
): asserts value is ModifyGuildAutoModerationRuleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord AutoMod update input must be an object")
  }
  const input = value as Record<string, unknown>
  if (
    !hasOnlyKeys(input, [
      "actions",
      "enabled",
      "exemptChannelIds",
      "exemptRoleIds",
      "name",
      "trigger",
    ])
    || Object.keys(input).length === 0
    || !(input.enabled === undefined || typeof input.enabled === "boolean")
  ) {
    throw new RangeError("Discord AutoMod update fields are invalid")
  }
  if (input.name !== undefined) {
    assertAutoModerationInputText(
      input.name,
      DISCORD_LIMITS.autoModerationRuleNameCharacters,
      "rule name",
    )
  }
  if (input.trigger !== undefined) assertAutoModerationTriggerInput(input.trigger)
  if (input.actions !== undefined) assertAutoModerationActionsInput(input.actions)
  if (input.exemptRoleIds !== undefined) {
    assertAutoModerationInputSnowflakes(
      input.exemptRoleIds,
      DISCORD_LIMITS.autoModerationExemptRoles,
      "exempt role IDs",
    )
  }
  if (input.exemptChannelIds !== undefined) {
    assertAutoModerationInputSnowflakes(
      input.exemptChannelIds,
      DISCORD_LIMITS.autoModerationExemptChannels,
      "exempt channel IDs",
    )
  }
  if (input.trigger !== undefined && input.actions !== undefined) {
    assertAutoModerationInputCompatibility(
      input.trigger,
      input.actions,
      input.exemptChannelIds ?? [],
    )
  }
}

function autoModerationTriggerMetadataBody(
  trigger: DiscordAutoModerationTrigger,
): Record<string, unknown> {
  if (
    trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword
    || trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
  ) {
    return {
      allow_list: trigger.allowList,
      keyword_filter: trigger.keywordFilter,
      regex_patterns: trigger.regexPatterns,
    }
  }
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam) return {}
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset) {
    return {
      allow_list: trigger.allowList,
      presets: trigger.presets,
    }
  }
  return {
    mention_raid_protection_enabled: trigger.mentionRaidProtectionEnabled,
    mention_total_limit: trigger.mentionTotalLimit,
  }
}

function autoModerationActionBody(
  action: DiscordAutoModerationAction,
): Record<string, unknown> {
  if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage) {
    return {
      type: action.type,
      ...(action.customMessage === null
        ? {}
        : { metadata: { custom_message: action.customMessage } }),
    }
  }
  if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage) {
    return { metadata: { channel_id: action.channelId }, type: action.type }
  }
  if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout) {
    return { metadata: { duration_seconds: action.durationSeconds }, type: action.type }
  }
  return { type: action.type }
}

function autoModerationEventType(
  trigger: DiscordAutoModerationTrigger,
): DiscordAutoModerationEventType {
  return trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
    ? DISCORD_AUTO_MODERATION_EVENT_TYPES.memberUpdate
    : DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend
}

function assertScheduledEventInputText(
  value: string,
  minimum: number,
  maximum: number,
  description: string,
): void {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || value.trim() !== value
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord scheduled event ${description} must contain ${minimum}-${maximum} trimmed characters without controls`,
    )
  }
  assertValidUnicode(value, `Discord scheduled event ${description}`)
}

function assertScheduledEventCoverInput(
  cover: ScheduledEventCoverInput,
): void {
  if (
    !cover
    || typeof cover !== "object"
    || Array.isArray(cover)
    || !(cover.bytes instanceof Uint8Array)
    || cover.bytes.byteLength < 1
    || cover.bytes.byteLength > DISCORD_LIMITS.scheduledEventCoverBytes
    || !Object.hasOwn(SCHEDULED_EVENT_COVER_MEDIA_TYPES, cover.format)
  ) {
    throw new RangeError("Discord scheduled event cover input is invalid")
  }
}

function assertScheduledEventRecurrenceInput(
  recurrence: DiscordScheduledEventRecurrenceInput,
): void {
  if (!recurrence || typeof recurrence !== "object" || Array.isArray(recurrence)) {
    throw new RangeError("Discord scheduled event recurrence must be an object")
  }
  assertIsoTimestamp(
    recurrence.startTime,
    "Discord scheduled event recurrence start time",
  )
  if (
    !SCHEDULED_EVENT_RECURRENCE_FREQUENCY_VALUES.has(recurrence.frequency)
    || !Number.isSafeInteger(recurrence.interval)
    || recurrence.interval < 1
  ) {
    throw new RangeError("Discord scheduled event recurrence frequency or interval is invalid")
  }
  const arrays = [
    [recurrence.byWeekday, 0, 6, "weekdays"],
    [recurrence.byMonth, 1, 12, "months"],
    [recurrence.byMonthDay, 1, 31, "month days"],
  ] as const
  for (const [values, minimum, maximum, description] of arrays) {
    if (values === null) continue
    if (
      !Array.isArray(values)
      || values.length < 1
      || new Set(values).size !== values.length
      || values.some((value) => (
        !Number.isSafeInteger(value)
        || value < minimum
        || value > maximum
      ))
    ) {
      throw new RangeError(
        `Discord scheduled event recurrence ${description} are invalid`,
      )
    }
  }
  if (recurrence.byNWeekday !== null && (
    !Array.isArray(recurrence.byNWeekday)
    || recurrence.byNWeekday.length < 1
    || new Set(
      recurrence.byNWeekday.map((entry) => `${entry?.n}:${entry?.day}`),
    ).size !== recurrence.byNWeekday.length
    || recurrence.byNWeekday.some((entry) => (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || !Number.isSafeInteger(entry.n)
      || entry.n < 1
      || entry.n > 5
      || !Number.isSafeInteger(entry.day)
      || entry.day < 0
      || entry.day > 6
    ))
  )) {
    throw new RangeError(
      "Discord scheduled event recurrence numbered weekdays are invalid",
    )
  }
  const groups = [
    recurrence.byWeekday !== null,
    recurrence.byNWeekday !== null,
    recurrence.byMonth !== null || recurrence.byMonthDay !== null,
  ].filter(Boolean).length
  if (groups > 1 || (recurrence.byMonth === null) !== (recurrence.byMonthDay === null)) {
    throw new RangeError(
      "Discord scheduled event recurrence fields are mutually incompatible",
    )
  }
  if (
    recurrence.frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.daily
    && (
      recurrence.interval !== 1
      || recurrence.byNWeekday !== null
      || recurrence.byMonth !== null
      || recurrence.byMonthDay !== null
      || (
        recurrence.byWeekday !== null
        && !SCHEDULED_EVENT_DAILY_WEEKDAY_SETS.has(recurrence.byWeekday.join(","))
      )
    )
  ) {
    throw new RangeError("Discord daily scheduled event recurrence is unsupported")
  }
  if (
    recurrence.frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.weekly
    && (
      (recurrence.interval !== 1 && recurrence.interval !== 2)
      || recurrence.byNWeekday !== null
      || recurrence.byMonth !== null
      || recurrence.byMonthDay !== null
      || recurrence.byWeekday?.length !== 1
    )
  ) {
    throw new RangeError("Discord weekly scheduled event recurrence is unsupported")
  }
  if (
    recurrence.frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.monthly
    && (
      recurrence.interval !== 1
      || recurrence.byWeekday !== null
      || recurrence.byMonth !== null
      || recurrence.byMonthDay !== null
      || recurrence.byNWeekday?.length !== 1
    )
  ) {
    throw new RangeError("Discord monthly scheduled event recurrence is unsupported")
  }
  if (
    recurrence.frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.yearly
    && (
      recurrence.interval !== 1
      || recurrence.byWeekday !== null
      || recurrence.byNWeekday !== null
      || recurrence.byMonth?.length !== 1
      || recurrence.byMonthDay?.length !== 1
    )
  ) {
    throw new RangeError("Discord yearly scheduled event recurrence is unsupported")
  }
  if (recurrence.frequency === DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.yearly) {
    const month = recurrence.byMonth![0] as number
    const day = recurrence.byMonthDay![0] as number
    const date = new Date(Date.UTC(2000, month - 1, day))
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new RangeError("Discord yearly scheduled event recurrence date is invalid")
    }
  }
}

function scheduledEventRecurrenceBody(
  recurrence: DiscordScheduledEventRecurrenceInput,
): Record<string, unknown> {
  assertScheduledEventRecurrenceInput(recurrence)
  return {
    by_month: recurrence.byMonth,
    by_month_day: recurrence.byMonthDay,
    by_n_weekday: recurrence.byNWeekday,
    by_weekday: recurrence.byWeekday,
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    start: recurrence.startTime,
  }
}

function assertCreateGuildScheduledEventInput(
  input: CreateGuildScheduledEventInput,
): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord scheduled event creation input must be an object")
  }
  assertScheduledEventInputText(
    input.name,
    1,
    DISCORD_LIMITS.scheduledEventNameCharacters,
    "name",
  )
  if (input.description !== undefined) {
    assertScheduledEventInputText(
      input.description,
      1,
      DISCORD_LIMITS.scheduledEventDescriptionCharacters,
      "description",
    )
  }
  assertIsoTimestamp(input.scheduledStartTime, "Discord scheduled event start time")
  assertIsoTimestamp(input.scheduledEndTime, "Discord scheduled event end time")
  if (
    input.scheduledEndTime !== undefined
    && Date.parse(input.scheduledEndTime) <= Date.parse(input.scheduledStartTime)
  ) {
    throw new RangeError("Discord scheduled event end time must be after its start time")
  }
  if (!SCHEDULED_EVENT_ENTITY_TYPE_VALUES.has(input.entityType)) {
    throw new RangeError("Discord scheduled event entity type is unsupported")
  }
  if (input.entityType === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external) {
    if (input.channelId !== null || input.scheduledEndTime === undefined) {
      throw new RangeError(
        "Discord external scheduled event requires a null channel and an end time",
      )
    }
    assertScheduledEventInputText(
      input.location as string,
      1,
      DISCORD_LIMITS.scheduledEventLocationCharacters,
      "location",
    )
  } else {
    assertPositiveSnowflake(
      input.channelId as string,
      "Discord scheduled event channel ID",
    )
    if (input.location !== null) {
      throw new RangeError(
        "Discord channel scheduled event location must be null",
      )
    }
  }
  if (input.cover !== undefined) assertScheduledEventCoverInput(input.cover)
  if (input.recurrenceRule !== undefined) {
    assertScheduledEventRecurrenceInput(input.recurrenceRule)
    if (
      Date.parse(input.recurrenceRule.startTime)
      !== Date.parse(input.scheduledStartTime)
    ) {
      throw new RangeError(
        "Discord scheduled event recurrence must start with the event",
      )
    }
  }
}

function assertModifyGuildScheduledEventInput(
  input: ModifyGuildScheduledEventInput,
): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord scheduled event update input must be an object")
  }
  const fields = [
    input.channelId,
    input.cover,
    input.description,
    input.entityType,
    input.location,
    input.name,
    input.recurrenceRule,
    input.scheduledEndTime,
    input.scheduledStartTime,
    input.status,
  ]
  if (fields.every((value) => value === undefined)) {
    throw new RangeError("Discord scheduled event update must contain a change")
  }
  if (input.name !== undefined) {
    assertScheduledEventInputText(
      input.name,
      1,
      DISCORD_LIMITS.scheduledEventNameCharacters,
      "name",
    )
  }
  if (input.description !== undefined && input.description !== null) {
    assertScheduledEventInputText(
      input.description,
      1,
      DISCORD_LIMITS.scheduledEventDescriptionCharacters,
      "description",
    )
  }
  assertIsoTimestamp(input.scheduledStartTime, "Discord scheduled event start time")
  assertIsoTimestamp(input.scheduledEndTime, "Discord scheduled event end time")
  if (
    input.scheduledStartTime !== undefined
    && input.scheduledEndTime !== undefined
    && Date.parse(input.scheduledEndTime) <= Date.parse(input.scheduledStartTime)
  ) {
    throw new RangeError("Discord scheduled event end time must be after its start time")
  }
  const hostingChanged = input.entityType !== undefined
    || input.channelId !== undefined
    || input.location !== undefined
  if (hostingChanged) {
    if (
      input.entityType === undefined
      || input.channelId === undefined
      || input.location === undefined
    ) {
      throw new RangeError(
        "Discord scheduled event hosting update must be complete",
      )
    }
    if (input.entityType === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external) {
      if (input.channelId !== null || input.scheduledEndTime === undefined) {
        throw new RangeError(
          "Discord external scheduled event update requires a null channel and an end time",
        )
      }
      assertScheduledEventInputText(
        input.location as string,
        1,
        DISCORD_LIMITS.scheduledEventLocationCharacters,
        "location",
      )
    } else if (
      input.entityType === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.stage
      || input.entityType === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice
    ) {
      assertPositiveSnowflake(
        input.channelId as string,
        "Discord scheduled event channel ID",
      )
      if (input.location !== null) {
        throw new RangeError(
          "Discord channel scheduled event location must be null",
        )
      }
    } else {
      throw new RangeError("Discord scheduled event entity type is unsupported")
    }
  }
  if (input.cover !== undefined && input.cover !== null) {
    assertScheduledEventCoverInput(input.cover)
  }
  if (input.recurrenceRule !== undefined && input.recurrenceRule !== null) {
    assertScheduledEventRecurrenceInput(input.recurrenceRule)
    if (
      input.scheduledStartTime !== undefined
      && Date.parse(input.recurrenceRule.startTime)
      !== Date.parse(input.scheduledStartTime)
    ) {
      throw new RangeError(
        "Discord scheduled event recurrence must start with the event",
      )
    }
  }
  if (input.status !== undefined) {
    if (
      input.status !== DISCORD_SCHEDULED_EVENT_STATUSES.active
      && input.status !== DISCORD_SCHEDULED_EVENT_STATUSES.completed
      && input.status !== DISCORD_SCHEDULED_EVENT_STATUSES.canceled
    ) {
      throw new RangeError("Discord scheduled event target status is unsupported")
    }
    if (fields.slice(0, -1).some((value) => value !== undefined)) {
      throw new RangeError(
        "Discord scheduled event status transition must not include metadata changes",
      )
    }
  }
}

export function encodeDiscordAuditReason(auditReason: string): string {
  if (!auditReason.trim()) {
    throw new RangeError("Discord audit reason must not be blank")
  }
  let encoded: string
  try {
    encoded = encodeURIComponent(auditReason)
  } catch (error) {
    throw new RangeError("Discord audit reason contains invalid Unicode", { cause: error })
  }
  if (encoded.length > DISCORD_LIMITS.auditReasonEncodedCharacters) {
    throw new RangeError(
      `Discord audit reason must not exceed ${DISCORD_LIMITS.auditReasonEncodedCharacters} URL-encoded characters`,
    )
  }
  return encoded
}

function assertAllowedMentions(allowedMentions: DiscordAllowedMentions): void {
  if (
    !allowedMentions
    || typeof allowedMentions !== "object"
    || Array.isArray(allowedMentions)
  ) {
    throw new RangeError("Discord allowed mentions must be an exact object")
  }
  const value = allowedMentions as Record<string, unknown>
  if (typeof value.replied_user !== "boolean") {
    throw new RangeError("Discord replied-user mention setting must be a boolean")
  }
  const keys = Object.keys(value).sort()
  if ("parse" in value) {
    if (
      keys.join("\0") !== ALLOWED_MENTION_PARSE_KEYS.join("\0")
      || !Array.isArray(value.parse)
      || value.parse.length !== 0
    ) {
      throw new RangeError("Discord allowed mention parsing must be empty")
    }
    return
  }
  if (
    keys.join("\0") !== ALLOWED_MENTION_USER_KEYS.join("\0")
    || !Array.isArray(value.users)
    || value.users.some((userId) => typeof userId !== "string")
  ) {
    throw new RangeError("Discord allowed mentions must contain exact user IDs")
  }
  const users = value.users as string[]
  assertBoundedArray(
    users,
    DISCORD_LIMITS.allowedMentionUsers,
    "Discord allowed mention user IDs",
  )
  assertSearchSnowflakes(
    users,
    "Discord allowed mention user IDs",
  )
  if (new Set(users).size !== users.length) {
    throw new RangeError("Discord allowed mention user IDs must be unique")
  }
}

export class DiscordClient {
  readonly #apiBaseUrl: string
  readonly #fetch: FetchImplementation
  readonly #maxAutomaticRetryWaitMs: number
  readonly #maxRetries: number
  readonly #observer: Pick<OperationalObserver, "startDiscordRequest"> | undefined
  readonly #requestTimeoutMs: number
  readonly #sleep: SleepImplementation
  readonly #token: string

  constructor(options: DiscordClientOptions) {
    this.#apiBaseUrl = (options.apiBaseUrl || DISCORD_API_BASE_URL).replace(/\/+$/, "")
    this.#fetch = options.fetchImplementation || globalThis.fetch
    this.#maxAutomaticRetryWaitMs = options.maxAutomaticRetryWaitMs
      ?? DISCORD_LIMITS.automaticRetryWaitMs
    this.#maxRetries = options.maxRetries ?? DISCORD_LIMITS.retries
    this.#observer = options.observer
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DISCORD_LIMITS.requestTimeoutMs
    this.#sleep = options.sleep || defaultSleep
    this.#token = options.token
  }

  async #request<T>(
    operation: DiscordRestOperation,
    route: string,
    parameters: RequestParameters = {},
  ): Promise<T> {
    const method = DISCORD_REST_OPERATIONS[operation]
    const url = new URL(`${this.#apiBaseUrl}${route}`)
    const diagnosticRoute = parameters.diagnosticRoute ?? route.replace(/\?.*$/u, "")
    const contentSensitive = CONTENT_SENSITIVE_REST_OPERATIONS.has(operation)
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bot ${this.#token}`,
      "User-Agent": DISCORD_USER_AGENT,
    })
    if (parameters.body !== undefined && parameters.multipartBody !== undefined) {
      throw new TypeError("Discord request cannot contain JSON and multipart bodies")
    }
    let body: RequestInit["body"]
    if (parameters.body !== undefined) {
      body = JSON.stringify(parameters.body)
      headers.set("Content-Type", "application/json")
    } else if (parameters.multipartBody !== undefined) {
      body = parameters.multipartBody
    }
    if (parameters.auditReason !== undefined) {
      headers.set("X-Audit-Log-Reason", encodeDiscordAuditReason(parameters.auditReason))
    }
    let observation: OperationObservation | undefined
    try {
      observation = this.#observer?.startDiscordRequest(operation)
    } catch {}

    const execute = async (): Promise<T> => {
      for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMs)
        const signal = parameters.signal
          ? AbortSignal.any([parameters.signal, timeoutSignal])
          : timeoutSignal
        const transportFailure = (error: unknown): DiscordTransportError => {
          const category = timeoutSignal.aborted && !parameters.signal?.aborted
            ? "timeout"
            : parameters.signal?.aborted
              ? "cancelled"
              : "network-error"
          const message = contentSensitive
            ? "request failed"
            : redactText(errorMessage(error), [this.#token])
          return new DiscordTransportError(
            `Discord API ${method} ${diagnosticRoute} failed: ${message}`,
            category,
            parameters.suppressFailureCause || contentSensitive
              ? undefined
              : { cause: error },
          )
        }
        let response: Response
        try {
          const requestInit: RequestInit = {
            headers,
            method,
            redirect: "error",
            signal,
          }
          if (body !== undefined) requestInit.body = body
          response = await this.#fetch(url, requestInit)
        } catch (error) {
          throw transportFailure(error)
        }

        let responseText: string
        try {
          responseText = await response.text()
        } catch (error) {
          throw transportFailure(error)
        }
        const parsedBody = parseJson(responseText)
        const discordError = errorBody(parsedBody)
        const retryAfterMs = response.status === 429
          ? retryAfterMilliseconds(discordError, response.headers)
          : undefined

        if (
          response.status === 429
          && parameters.automaticRateLimitRetry !== false
          && attempt < this.#maxRetries
          && retryAfterMs !== undefined
          && retryAfterMs <= this.#maxAutomaticRetryWaitMs
        ) {
          try {
            observation?.retry()
          } catch {}
          await this.#sleep(retryAfterMs, parameters.signal)
          continue
        }

        if (!response.ok) {
          const detail = contentSensitive
            ? "request failed"
            : discordError?.message || response.statusText || "request failed"
          throw new DiscordApiError({
            ...(discordError?.code !== undefined ? { code: discordError.code } : {}),
            message: redactText(
              `Discord API ${method} ${diagnosticRoute} returned ${response.status}: ${detail}`,
              [this.#token],
            ),
            method,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            route: diagnosticRoute,
            status: response.status,
          })
        }

        return parsedBody as T
      }
      throw new DiscordTransportError(
        `Discord API ${method} ${diagnosticRoute} exhausted retries`,
        "network-error",
      )
    }

    try {
      const result = observation ? await observation.run(execute) : await execute()
      finishObservation(observation, { outcome: "ok" })
      return result
    } catch (error) {
      finishObservation(observation, {
        errorCategory: requestErrorCategory(error),
        outcome: "error",
        ...(error instanceof DiscordApiError ? { statusCode: error.status } : {}),
      })
      throw error
    }
  }

  getCurrentApplication(options: RequestOptions = {}): Promise<DiscordApplication> {
    return this.#request("get_current_application", "/oauth2/applications/@me", options)
  }

  getCurrentUser(options: RequestOptions = {}): Promise<DiscordUser> {
    return this.#request("get_current_user", "/users/@me", options)
  }

  getUser(userId: string, options: RequestOptions = {}): Promise<DiscordUser> {
    return this.#request("get_user", `/users/${userId}`, options)
  }

  listCurrentUserGuilds(options: GuildPageOptions = {}): Promise<DiscordGuild[]> {
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.currentUserGuilds,
      "Discord guild page limit",
    )
    assertExclusiveCursors({ after: options.after, before: options.before })
    const route = `/users/@me/guilds${queryString({
      after: options.after,
      before: options.before,
      limit: options.limit,
      with_counts: false,
    })}`
    return this.#request("list_current_user_guilds", route, options)
  }

  getGuildChannels(guildId: string, options: RequestOptions = {}): Promise<DiscordChannel[]> {
    return this.#request("get_guild_channels", `/guilds/${guildId}/channels`, options)
  }

  createGuildChannel(
    guildId: string,
    input: CreateGuildChannelInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    if (
      typeof guildId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(guildId)
    ) {
      throw new RangeError("Discord channel creation guild ID must be a snowflake")
    }
    assertCreateGuildChannelInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord channel creation audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("create_guild_channel", `/guilds/${guildId}/channels`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        ...(input.defaultAutoArchiveDuration !== undefined
          ? { default_auto_archive_duration: input.defaultAutoArchiveDuration }
          : {}),
        name: input.name,
        ...(input.nsfw !== undefined ? { nsfw: input.nsfw } : {}),
        ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
        ...(input.rateLimitPerUser !== undefined
          ? { rate_limit_per_user: input.rateLimitPerUser }
          : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        type: input.type,
      },
    })
  }

  createForumPost(
    channelId: string,
    input: CreateForumPostInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordCreatedForumPost> {
    if (
      typeof channelId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(channelId)
    ) {
      throw new RangeError("Discord forum-post channel ID must be a snowflake")
    }
    assertCreateForumPostInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord forum-post audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("create_forum_post", `/channels/${channelId}/threads`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        ...(input.appliedTagIds !== undefined
          ? { applied_tags: input.appliedTagIds }
          : {}),
        ...(input.autoArchiveDuration !== undefined
          ? { auto_archive_duration: input.autoArchiveDuration }
          : {}),
        message: {
          allowed_mentions: input.allowedMentions,
          content: input.content,
        },
        name: input.name,
        ...(input.rateLimitPerUser !== undefined
          ? { rate_limit_per_user: input.rateLimitPerUser }
          : {}),
      },
    })
  }

  getGuild(guildId: string, options: RequestOptions = {}): Promise<DiscordGuild> {
    return this.#request("get_guild", `/guilds/${guildId}`, options)
  }

  async getGuildOnboarding(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildOnboarding> {
    assertPositiveSnowflake(guildId, "Discord onboarding guild ID")
    const response = await this.#request<unknown>(
      "get_guild_onboarding",
      `/guilds/${guildId}/onboarding`,
      {
        ...options,
        suppressFailureCause: true,
      },
    )
    return projectGuildOnboarding(response, guildId)
  }

  async modifyGuildOnboarding(
    guildId: string,
    input: ModifyGuildOnboardingInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildOnboarding> {
    assertPositiveSnowflake(guildId, "Discord onboarding guild ID")
    assertModifyGuildOnboardingInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord onboarding audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_onboarding",
      `/guilds/${guildId}/onboarding`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          default_channel_ids: input.defaultChannelIds,
          enabled: input.enabled,
          mode: input.mode,
          prompts: input.prompts.map((prompt) => ({
            id: prompt.id,
            in_onboarding: prompt.inOnboarding,
            options: prompt.options.map((option) => ({
              channel_ids: option.channelIds,
              description: option.description,
              emoji_animated: option.emoji?.animated ?? false,
              emoji_id: option.emoji?.id ?? null,
              emoji_name: option.emoji?.name ?? null,
              ...(option.id !== undefined ? { id: option.id } : {}),
              role_ids: option.roleIds,
              title: option.title,
            })),
            required: prompt.required,
            single_select: prompt.singleSelect,
            title: prompt.title,
            type: prompt.type,
          })),
        },
        suppressFailureCause: true,
      },
    )
    return projectGuildOnboarding(response, guildId)
  }

  getGuildAuditLog(
    guildId: string,
    options: GuildAuditLogPageOptions = {},
  ): Promise<DiscordGuildAuditLog> {
    if (
      typeof guildId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(guildId)
      || BigInt(guildId) < 1n
      || BigInt(guildId) > DISCORD_SNOWFLAKE_MAX
    ) {
      throw new RangeError("Discord guild audit-log guild ID must be a snowflake")
    }
    for (const [name, value, allowZero] of [
      ["actor user ID", options.actorUserId, false],
      ["after cursor", options.after, true],
      ["before cursor", options.before, false],
    ] as const) {
      if (
        value !== undefined
        && (
          typeof value !== "string"
          || !DISCORD_SNOWFLAKE_PATTERN.test(value)
          || BigInt(value) > DISCORD_SNOWFLAKE_MAX
          || (allowZero ? BigInt(value) < 0n : BigInt(value) < 1n)
        )
      ) {
        throw new RangeError(`Discord guild audit-log ${name} must be a snowflake`)
      }
    }
    assertExclusiveCursors({ after: options.after, before: options.before })
    assertBoundedLimit(
      options.limit,
      AUDIT_LOG_LIMITS.responseEntries,
      "Discord guild audit-log page limit",
    )
    if (
      options.actionType !== undefined
      && (
        !Number.isSafeInteger(options.actionType)
        || options.actionType < 1
      )
    ) {
      throw new RangeError("Discord guild audit-log action type must be a positive safe integer")
    }
    const route = `/guilds/${guildId}/audit-logs${queryString({
      action_type: options.actionType,
      after: options.after,
      before: options.before,
      limit: options.limit,
      user_id: options.actorUserId,
    })}`
    return this.#request("get_guild_audit_log", route, options)
  }

  getGuildMember(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMember> {
    assertPositiveSnowflake(guildId, "Discord guild member guild ID")
    assertPositiveSnowflake(userId, "Discord guild member user ID")
    return this.#request("get_guild_member", `/guilds/${guildId}/members/${userId}`, options)
  }

  listGuildMembers(
    guildId: string,
    options: GuildMemberPageOptions = {},
  ): Promise<DiscordGuildMember[]> {
    assertPositiveSnowflake(guildId, "Discord member-directory guild ID")
    if (options.after !== undefined) {
      assertPositiveSnowflake(options.after, "Discord member-directory after cursor")
    }
    assertBoundedLimit(
      options.limit,
      MEMBER_DIRECTORY_LIMITS.listPage,
      "Discord member-directory list limit",
    )
    const route = `/guilds/${guildId}/members${queryString({
      after: options.after,
      limit: options.limit,
    })}`
    return this.#request("list_guild_members", route, options)
  }

  searchGuildMembers(
    guildId: string,
    options: GuildMemberSearchOptions,
  ): Promise<DiscordGuildMember[]> {
    assertPositiveSnowflake(guildId, "Discord member-directory guild ID")
    if (
      typeof options.query !== "string"
      || options.query.trim() !== options.query
      || options.query.length < MEMBER_DIRECTORY_LIMITS.queryMinimumCharacters
      || options.query.length > MEMBER_DIRECTORY_LIMITS.queryCharacters
      || /[\u0000-\u001F\u007F]/u.test(options.query)
    ) {
      throw new RangeError(
        `Discord member-directory query must contain ${MEMBER_DIRECTORY_LIMITS.queryMinimumCharacters}-${MEMBER_DIRECTORY_LIMITS.queryCharacters} trimmed characters without controls`,
      )
    }
    try {
      encodeURIComponent(options.query)
    } catch {
      throw new RangeError("Discord member-directory query must contain valid Unicode")
    }
    assertBoundedLimit(
      options.limit,
      MEMBER_DIRECTORY_LIMITS.searchPage,
      "Discord member-directory search limit",
    )
    const route = `/guilds/${guildId}/members/search${queryString({
      limit: options.limit,
      query: options.query,
    })}`
    return this.#request("search_guild_members", route, options)
  }

  getGuildRoles(guildId: string, options: RequestOptions = {}): Promise<DiscordRole[]> {
    return this.#request("get_guild_roles", `/guilds/${guildId}/roles`, options)
  }

  getGuildRole(
    guildId: string,
    roleId: string,
    options: RequestOptions = {},
  ): Promise<DiscordRole> {
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(guildId)
      || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)
    ) {
      throw new RangeError("Discord exact role lookup requires snowflake IDs")
    }
    return this.#request(
      "get_guild_role",
      `/guilds/${guildId}/roles/${roleId}`,
      options,
    )
  }

  async getGuildRoleMemberCounts(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildRoleMemberCounts> {
    assertPositiveSnowflake(guildId, "Discord role member-count guild ID")
    const response = await this.#request<unknown>(
      "get_guild_role_member_counts",
      `/guilds/${guildId}/roles/member-counts`,
      { ...options, suppressFailureCause: true },
    )
    return projectGuildRoleMemberCounts(response)
  }

  async listGuildEmojis(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildEmojiSummary[]> {
    assertPositiveSnowflake(guildId, "Discord guild emoji guild ID")
    const response = await this.#request<unknown>(
      "list_guild_emojis",
      `/guilds/${guildId}/emojis`,
      options,
    )
    if (!Array.isArray(response) || response.length > DISCORD_LIMITS.guildEmojis) {
      throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji inventory")
    }
    return response.map(projectGuildEmoji)
  }

  async getGuildEmoji(
    guildId: string,
    emojiId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildEmojiSummary> {
    assertPositiveSnowflake(guildId, "Discord guild emoji guild ID")
    assertPositiveSnowflake(emojiId, "Discord guild emoji ID")
    const response = await this.#request<unknown>(
      "get_guild_emoji",
      `/guilds/${guildId}/emojis/${emojiId}`,
      options,
    )
    return projectGuildEmoji(response)
  }

  async createGuildEmoji(
    guildId: string,
    input: CreateGuildEmojiInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildEmojiSummary> {
    assertPositiveSnowflake(guildId, "Discord guild emoji guild ID")
    assertCreateGuildEmojiInput(input)
    encodeDiscordAuditReason(auditReason)
    const mediaType = EMOJI_FORMAT_MEDIA_TYPES[input.format]
    const image = `data:${mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`
    const response = await this.#request<unknown>(
      "create_guild_emoji",
      `/guilds/${guildId}/emojis`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          image,
          name: input.name,
          roles: input.roleIds,
        },
      },
    )
    return projectGuildEmoji(response)
  }

  async modifyGuildEmoji(
    guildId: string,
    emojiId: string,
    input: ModifyGuildEmojiInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildEmojiSummary> {
    assertPositiveSnowflake(guildId, "Discord guild emoji guild ID")
    assertPositiveSnowflake(emojiId, "Discord guild emoji ID")
    assertModifyGuildEmojiInput(input)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_emoji",
      `/guilds/${guildId}/emojis/${emojiId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.roleIds !== undefined ? { roles: input.roleIds } : {}),
        },
      },
    )
    return projectGuildEmoji(response)
  }

  async deleteGuildEmoji(
    guildId: string,
    emojiId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord guild emoji guild ID")
    assertPositiveSnowflake(emojiId, "Discord guild emoji ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_emoji",
      `/guilds/${guildId}/emojis/${emojiId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  async listGuildStickers(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildStickerSummary[]> {
    assertPositiveSnowflake(guildId, "Discord guild sticker guild ID")
    const response = await this.#request<unknown>(
      "list_guild_stickers",
      `/guilds/${guildId}/stickers`,
      options,
    )
    if (!Array.isArray(response) || response.length > DISCORD_LIMITS.guildStickers) {
      throw new GuildExpressionEvidenceError("Discord returned an invalid guild sticker inventory")
    }
    return response.map((sticker) => projectGuildSticker(sticker, guildId))
  }

  async getGuildSticker(
    guildId: string,
    stickerId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildStickerSummary> {
    assertPositiveSnowflake(guildId, "Discord guild sticker guild ID")
    assertPositiveSnowflake(stickerId, "Discord guild sticker ID")
    const response = await this.#request<unknown>(
      "get_guild_sticker",
      `/guilds/${guildId}/stickers/${stickerId}`,
      options,
    )
    return projectGuildSticker(response, guildId)
  }

  async createGuildSticker(
    guildId: string,
    input: CreateGuildStickerInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildStickerSummary> {
    assertPositiveSnowflake(guildId, "Discord guild sticker guild ID")
    assertCreateGuildStickerInput(input)
    encodeDiscordAuditReason(auditReason)
    const upload = STICKER_FORMAT_UPLOADS[input.format]
    const form = new FormData()
    form.set("name", input.name)
    form.set("description", input.description)
    form.set("tags", input.tags)
    form.set(
      "file",
      new Blob([Uint8Array.from(input.bytes)], { type: upload.mediaType }),
      `sticker.${upload.extension}`,
    )
    const response = await this.#request<unknown>(
      "create_guild_sticker",
      `/guilds/${guildId}/stickers`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        multipartBody: form,
      },
    )
    return projectGuildSticker(response, guildId)
  }

  async modifyGuildSticker(
    guildId: string,
    stickerId: string,
    input: ModifyGuildStickerInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildStickerSummary> {
    assertPositiveSnowflake(guildId, "Discord guild sticker guild ID")
    assertPositiveSnowflake(stickerId, "Discord guild sticker ID")
    assertModifyGuildStickerInput(input)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_sticker",
      `/guilds/${guildId}/stickers/${stickerId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        },
      },
    )
    return projectGuildSticker(response, guildId)
  }

  async deleteGuildSticker(
    guildId: string,
    stickerId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord guild sticker guild ID")
    assertPositiveSnowflake(stickerId, "Discord guild sticker ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_sticker",
      `/guilds/${guildId}/stickers/${stickerId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  async listGuildAutoModerationRules(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordAutoModerationRuleSummary[]> {
    assertPositiveSnowflake(guildId, "Discord AutoMod guild ID")
    const response = await this.#request<unknown>(
      "list_guild_auto_moderation_rules",
      `/guilds/${guildId}/auto-moderation/rules`,
      options,
    )
    if (
      !Array.isArray(response)
      || response.length > DISCORD_LIMITS.autoModerationRules
    ) {
      throw new AutoModerationEvidenceError(
        "Discord returned an invalid AutoMod rule inventory",
      )
    }
    const rules = response.map((rule) => projectGuildAutoModerationRule(rule, guildId))
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      throw new AutoModerationEvidenceError(
        "Discord returned duplicate AutoMod rule IDs",
      )
    }
    return rules.sort((left, right) => {
      const leftId = BigInt(left.id)
      const rightId = BigInt(right.id)
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
    })
  }

  async getGuildAutoModerationRule(
    guildId: string,
    ruleId: string,
    options: RequestOptions = {},
  ): Promise<DiscordAutoModerationRuleSummary> {
    assertPositiveSnowflake(guildId, "Discord AutoMod guild ID")
    assertPositiveSnowflake(ruleId, "Discord AutoMod rule ID")
    const response = await this.#request<unknown>(
      "get_guild_auto_moderation_rule",
      `/guilds/${guildId}/auto-moderation/rules/${ruleId}`,
      options,
    )
    const rule = projectGuildAutoModerationRule(response, guildId)
    if (rule.id !== ruleId) {
      throw new AutoModerationEvidenceError(
        "Discord returned another AutoMod rule for an exact lookup",
      )
    }
    return rule
  }

  async createGuildAutoModerationRule(
    guildId: string,
    input: CreateGuildAutoModerationRuleInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordAutoModerationRuleSummary> {
    assertPositiveSnowflake(guildId, "Discord AutoMod guild ID")
    assertCreateGuildAutoModerationRuleInput(input)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "create_guild_auto_moderation_rule",
      `/guilds/${guildId}/auto-moderation/rules`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          actions: input.actions.map(autoModerationActionBody),
          enabled: false,
          event_type: autoModerationEventType(input.trigger),
          exempt_channels: input.exemptChannelIds,
          exempt_roles: input.exemptRoleIds,
          name: input.name,
          trigger_metadata: autoModerationTriggerMetadataBody(input.trigger),
          trigger_type: input.trigger.type,
        },
      },
    )
    return projectGuildAutoModerationRule(response, guildId)
  }

  async modifyGuildAutoModerationRule(
    guildId: string,
    ruleId: string,
    input: ModifyGuildAutoModerationRuleInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordAutoModerationRuleSummary> {
    assertPositiveSnowflake(guildId, "Discord AutoMod guild ID")
    assertPositiveSnowflake(ruleId, "Discord AutoMod rule ID")
    assertModifyGuildAutoModerationRuleInput(input)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_auto_moderation_rule",
      `/guilds/${guildId}/auto-moderation/rules/${ruleId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          ...(input.actions !== undefined
            ? { actions: input.actions.map(autoModerationActionBody) }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.exemptChannelIds !== undefined
            ? { exempt_channels: input.exemptChannelIds }
            : {}),
          ...(input.exemptRoleIds !== undefined
            ? { exempt_roles: input.exemptRoleIds }
            : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.trigger !== undefined
            ? { trigger_metadata: autoModerationTriggerMetadataBody(input.trigger) }
            : {}),
        },
      },
    )
    const rule = projectGuildAutoModerationRule(response, guildId)
    if (rule.id !== ruleId) {
      throw new AutoModerationEvidenceError(
        "Discord returned another AutoMod rule after an exact update",
      )
    }
    return rule
  }

  async deleteGuildAutoModerationRule(
    guildId: string,
    ruleId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord AutoMod guild ID")
    assertPositiveSnowflake(ruleId, "Discord AutoMod rule ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_auto_moderation_rule",
      `/guilds/${guildId}/auto-moderation/rules/${ruleId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  async listGuildScheduledEvents(
    guildId: string,
    options: ScheduledEventReadOptions = {},
  ): Promise<DiscordScheduledEventSummary[]> {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    if (
      options.includeSubscriberCount !== undefined
      && typeof options.includeSubscriberCount !== "boolean"
    ) {
      throw new RangeError(
        "Discord scheduled event subscriber-count option must be a boolean",
      )
    }
    const includeSubscriberCount = options.includeSubscriberCount === true
    const response = await this.#request<unknown>(
      "list_guild_scheduled_events",
      `/guilds/${guildId}/scheduled-events${queryString({
        with_user_count: includeSubscriberCount ? true : undefined,
      })}`,
      options.signal ? { signal: options.signal } : {},
    )
    if (
      !Array.isArray(response)
      || response.length > DISCORD_LIMITS.scheduledEvents
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned an invalid scheduled event inventory",
      )
    }
    const events = response.map((event) => projectGuildScheduledEvent(
      event,
      guildId,
      includeSubscriberCount,
    ))
    if (new Set(events.map((event) => event.id)).size !== events.length) {
      throw new ScheduledEventEvidenceError(
        "Discord returned duplicate scheduled event IDs",
      )
    }
    return events
  }

  async getGuildScheduledEvent(
    guildId: string,
    eventId: string,
    options: ScheduledEventReadOptions = {},
  ): Promise<DiscordScheduledEventSummary> {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    assertPositiveSnowflake(eventId, "Discord scheduled event ID")
    if (
      options.includeSubscriberCount !== undefined
      && typeof options.includeSubscriberCount !== "boolean"
    ) {
      throw new RangeError(
        "Discord scheduled event subscriber-count option must be a boolean",
      )
    }
    const includeSubscriberCount = options.includeSubscriberCount === true
    const response = await this.#request<unknown>(
      "get_guild_scheduled_event",
      `/guilds/${guildId}/scheduled-events/${eventId}${queryString({
        with_user_count: includeSubscriberCount ? true : undefined,
      })}`,
      options.signal ? { signal: options.signal } : {},
    )
    const event = projectGuildScheduledEvent(
      response,
      guildId,
      includeSubscriberCount,
    )
    if (event.id !== eventId) {
      throw new ScheduledEventEvidenceError(
        "Discord returned another scheduled event for an exact lookup",
      )
    }
    return event
  }

  async createGuildScheduledEvent(
    guildId: string,
    input: CreateGuildScheduledEventInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordScheduledEventSummary> {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    assertCreateGuildScheduledEventInput(input)
    encodeDiscordAuditReason(auditReason)
    const image = input.cover === undefined
      ? undefined
      : `data:${SCHEDULED_EVENT_COVER_MEDIA_TYPES[input.cover.format]};base64,${Buffer.from(input.cover.bytes).toString("base64")}`
    const response = await this.#request<unknown>(
      "create_guild_scheduled_event",
      `/guilds/${guildId}/scheduled-events`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          channel_id: input.channelId,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          entity_metadata: input.entityType
            === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external
            ? { location: input.location }
            : null,
          entity_type: input.entityType,
          ...(image !== undefined ? { image } : {}),
          name: input.name,
          privacy_level: 2,
          ...(input.recurrenceRule !== undefined
            ? { recurrence_rule: scheduledEventRecurrenceBody(input.recurrenceRule) }
            : {}),
          ...(input.scheduledEndTime !== undefined
            ? { scheduled_end_time: input.scheduledEndTime }
            : {}),
          scheduled_start_time: input.scheduledStartTime,
        },
      },
    )
    return projectGuildScheduledEvent(response, guildId, false)
  }

  async modifyGuildScheduledEvent(
    guildId: string,
    eventId: string,
    input: ModifyGuildScheduledEventInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordScheduledEventSummary> {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    assertPositiveSnowflake(eventId, "Discord scheduled event ID")
    assertModifyGuildScheduledEventInput(input)
    encodeDiscordAuditReason(auditReason)
    const image = input.cover === undefined
      ? undefined
      : input.cover === null
        ? null
        : `data:${SCHEDULED_EVENT_COVER_MEDIA_TYPES[input.cover.format]};base64,${Buffer.from(input.cover.bytes).toString("base64")}`
    const response = await this.#request<unknown>(
      "modify_guild_scheduled_event",
      `/guilds/${guildId}/scheduled-events/${eventId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          ...(input.channelId !== undefined
            ? { channel_id: input.channelId }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.entityType !== undefined
            ? {
                entity_metadata: input.entityType
                  === DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external
                  ? { location: input.location }
                  : null,
                entity_type: input.entityType,
              }
            : {}),
          ...(image !== undefined ? { image } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.recurrenceRule !== undefined
            ? {
                recurrence_rule: input.recurrenceRule === null
                  ? null
                  : scheduledEventRecurrenceBody(input.recurrenceRule),
              }
            : {}),
          ...(input.scheduledEndTime !== undefined
            ? { scheduled_end_time: input.scheduledEndTime }
            : {}),
          ...(input.scheduledStartTime !== undefined
            ? { scheduled_start_time: input.scheduledStartTime }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      },
    )
    const event = projectGuildScheduledEvent(response, guildId, false)
    if (event.id !== eventId) {
      throw new ScheduledEventEvidenceError(
        "Discord returned another scheduled event after an exact update",
      )
    }
    return event
  }

  async deleteGuildScheduledEvent(
    guildId: string,
    eventId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    assertPositiveSnowflake(eventId, "Discord scheduled event ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_scheduled_event",
      `/guilds/${guildId}/scheduled-events/${eventId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  createGuildRole(
    guildId: string,
    input: CreateGuildRoleInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordRole> {
    if (!DISCORD_SNOWFLAKE_PATTERN.test(guildId)) {
      throw new RangeError("Discord role creation guild ID must be a snowflake")
    }
    assertCreateGuildRoleInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord role creation audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("create_guild_role", `/guilds/${guildId}/roles`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        colors: {
          primary_color: input.primaryColor,
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: input.hoist,
        mentionable: input.mentionable,
        name: input.name,
        permissions: input.permissions,
      },
    })
  }

  modifyGuildRole(
    guildId: string,
    roleId: string,
    input: ModifyGuildRoleInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordRole> {
    assertPositiveSnowflake(guildId, "Discord role-configuration guild ID")
    assertPositiveSnowflake(roleId, "Discord role-configuration role ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord role-configuration audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request(
      "modify_guild_role",
      `/guilds/${guildId}/roles/${roleId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: modifyGuildRoleBody(input),
        suppressFailureCause: true,
      },
    )
  }

  async addGuildMemberRole(
    guildId: string,
    userId: string,
    roleId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord member-role guild ID")
    assertPositiveSnowflake(userId, "Discord member-role user ID")
    assertPositiveSnowflake(roleId, "Discord member-role role ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "add_guild_member_role",
      `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  async removeGuildMemberRole(
    guildId: string,
    userId: string,
    roleId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord member-role guild ID")
    assertPositiveSnowflake(userId, "Discord member-role user ID")
    assertPositiveSnowflake(roleId, "Discord member-role role ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "remove_guild_member_role",
      `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  getGuildBan(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordBan> {
    assertPositiveSnowflake(guildId, "Discord ban-audit guild ID")
    assertPositiveSnowflake(userId, "Discord ban-audit user ID")
    return this.#request("get_guild_ban", `/guilds/${guildId}/bans/${userId}`, options)
  }

  listGuildBans(
    guildId: string,
    options: GuildBanPageOptions = {},
  ): Promise<DiscordBan[]> {
    assertPositiveSnowflake(guildId, "Discord ban-audit guild ID")
    if (options.after !== undefined) {
      assertPositiveSnowflake(options.after, "Discord ban-audit after cursor")
    }
    assertBoundedLimit(
      options.limit,
      BAN_AUDIT_LIMITS.responseEntries,
      "Discord ban-audit list limit",
    )
    const route = `/guilds/${guildId}/bans${queryString({
      after: options.after,
      limit: options.limit,
    })}`
    return this.#request("list_guild_bans", route, options)
  }

  async listGuildInvites(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordInviteSummary[]> {
    assertPositiveSnowflake(guildId, "Discord invite-audit guild ID")
    const response = await this.#request<unknown>(
      "list_guild_invites",
      `/guilds/${guildId}/invites`,
      { ...options, suppressFailureCause: true },
    )
    if (!Array.isArray(response) || response.length > INVITE_LIMITS.inventory) {
      throw inviteEvidenceError()
    }
    return response.map(projectInvite)
  }

  async deleteInvite(
    code: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordDeletedInviteSummary> {
    if (
      typeof code !== "string"
      || code.length < 1
      || code.length > INVITE_LIMITS.codeCharacters
      || URL_DOT_PATH_SEGMENTS.has(code)
      || /[\u0000-\u001F\u007F]/u.test(code)
    ) {
      throw new RangeError("Discord invite deletion code is invalid")
    }
    let encodedCode: string
    try {
      encodedCode = encodeURIComponent(code)
    } catch {
      throw new RangeError("Discord invite deletion code is invalid")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "delete_invite",
      `/invites/${encodedCode}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/invites/{invite.code}",
        suppressFailureCause: true,
      },
    )
    return projectDeletedInvite(response)
  }

  modifyGuildMemberTimeout(
    guildId: string,
    userId: string,
    input: ModifyGuildMemberTimeoutInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMember> {
    if (input.communicationDisabledUntil !== null) {
      assertIsoTimestamp(
        input.communicationDisabledUntil,
        "Discord member timeout expiration",
      )
    }
    return this.#request("modify_guild_member_timeout", `/guilds/${guildId}/members/${userId}`, {
      ...options,
      auditReason,
      body: {
        communication_disabled_until: input.communicationDisabledUntil,
      },
    })
  }

  async removeGuildMember(
    guildId: string,
    userId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("remove_guild_member", `/guilds/${guildId}/members/${userId}`, {
      ...options,
      auditReason,
    })
  }

  async createGuildBan(
    guildId: string,
    userId: string,
    deleteMessageSeconds: number,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertIntegerRange(
      deleteMessageSeconds,
      0,
      DISCORD_LIMITS.banDeleteMessageSeconds,
      "Discord ban message-history deletion seconds",
    )
    await this.#request<void>("create_guild_ban", `/guilds/${guildId}/bans/${userId}`, {
      ...options,
      auditReason,
      body: { delete_message_seconds: deleteMessageSeconds },
    })
  }

  async removeGuildBan(
    guildId: string,
    userId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("remove_guild_ban", `/guilds/${guildId}/bans/${userId}`, {
      ...options,
      auditReason,
    })
  }

  getChannel(channelId: string, options: RequestOptions = {}): Promise<DiscordChannel> {
    return this.#request("get_channel", `/channels/${channelId}`, options)
  }

  async getGuildChannelMetadata(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannelMetadata> {
    assertPositiveSnowflake(channelId, "Discord channel metadata ID")
    const response = await this.#request<unknown>(
      "get_channel_metadata",
      `/channels/${channelId}`,
      { ...options, suppressFailureCause: true },
    )
    return projectGuildChannelMetadata(response, channelId)
  }

  async modifyGuildChannelMetadata(
    channelId: string,
    input: ModifyChannelMetadataInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannelMetadata> {
    assertPositiveSnowflake(channelId, "Discord channel metadata ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord channel metadata audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_channel_metadata",
      `/channels/${channelId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: channelMetadataBody(input),
        suppressFailureCause: true,
      },
    )
    return projectGuildChannelMetadata(response, channelId)
  }

  async listChannelWebhooks(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordWebhookSummary[]> {
    assertPositiveSnowflake(channelId, "Discord webhook channel ID")
    const response = await this.#request<unknown>(
      "list_channel_webhooks",
      `/channels/${channelId}/webhooks`,
      options,
    )
    if (!Array.isArray(response)) {
      throw new WebhookEvidenceError("Discord returned an invalid channel webhook inventory")
    }
    if (response.length > DISCORD_LIMITS.webhooksPerChannel) {
      throw new WebhookEvidenceError("Discord returned an invalid channel webhook inventory")
    }
    return response.map(projectWebhook)
  }

  async deleteWebhook(
    webhookId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(webhookId, "Discord webhook ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>("delete_webhook", `/webhooks/${webhookId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
    })
  }

  async editChannelPermissionOverwrite(
    channelId: string,
    overwriteId: string,
    input: EditChannelPermissionOverwriteInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(channelId, "Discord permission-overwrite channel ID")
    assertSearchSnowflake(overwriteId, "Discord permission-overwrite target ID")
    if (input.type !== 0 && input.type !== 1) {
      throw new RangeError("Discord permission-overwrite target type must be 0 or 1")
    }
    const allow = assertPermissionBitfield(
      input.allow,
      "Discord permission-overwrite allow field",
    )
    const deny = assertPermissionBitfield(
      input.deny,
      "Discord permission-overwrite deny field",
    )
    if ((allow & deny) !== 0n) {
      throw new RangeError("Discord permission-overwrite allow and deny fields must not overlap")
    }
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "edit_channel_permission_overwrite",
      `/channels/${channelId}/permissions/${overwriteId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          allow: input.allow,
          deny: input.deny,
          type: input.type,
        },
      },
    )
  }

  async deleteChannelPermissionOverwrite(
    channelId: string,
    overwriteId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(channelId, "Discord permission-overwrite channel ID")
    assertSearchSnowflake(overwriteId, "Discord permission-overwrite target ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_channel_permission_overwrite",
      `/channels/${channelId}/permissions/${overwriteId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  getThreadMember(
    threadId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadMember> {
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(threadId)
      || !DISCORD_SNOWFLAKE_PATTERN.test(userId)
    ) {
      throw new RangeError("Discord exact thread-member lookup requires snowflake IDs")
    }
    return this.#request(
      "get_thread_member",
      `/channels/${threadId}/thread-members/${userId}?with_member=false`,
      options,
    )
  }

  listMessages(channelId: string, options: MessagePageOptions = {}): Promise<DiscordMessage[]> {
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.channelMessages,
      "Discord message page limit",
    )
    assertExclusiveCursors({
      after: options.after,
      around: options.around,
      before: options.before,
    })
    const route = `/channels/${channelId}/messages${queryString({
      after: options.after,
      around: options.around,
      before: options.before,
      limit: options.limit,
    })}`
    return this.#request("list_messages", route, options)
  }

  getMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    return this.#request("get_message", `/channels/${channelId}/messages/${messageId}`, options)
  }

  listPollAnswerVoters(
    channelId: string,
    messageId: string,
    answerId: number,
    options: PollVoterPageOptions = {},
  ): Promise<DiscordPollVoters> {
    assertSearchSnowflake(channelId, "Discord poll channel ID")
    assertSearchSnowflake(messageId, "Discord poll message ID")
    if (!Number.isSafeInteger(answerId) || answerId < 1) {
      throw new RangeError("Discord poll answer ID must be a positive safe integer")
    }
    assertSearchSnowflake(options.after, "Discord poll voter cursor")
    assertBoundedLimit(
      options.limit,
      POLL_LIMITS.voterPage,
      "Discord poll voter page limit",
    )
    return this.#request(
      "list_poll_answer_voters",
      `/channels/${channelId}/polls/${messageId}/answers/${answerId}${queryString({
        after: options.after,
        limit: options.limit,
      })}`,
      options,
    )
  }

  listMessagePins(
    channelId: string,
    options: MessagePinPageOptions = {},
  ): Promise<DiscordMessagePinPage> {
    assertSearchSnowflake(channelId, "Discord pin channel ID")
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.channelPins,
      "Discord message pin page limit",
    )
    assertIsoTimestamp(options.before, "Discord message pin cursor")
    return this.#request(
      "list_message_pins",
      `/channels/${channelId}/messages/pins${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  async pinMessage(
    channelId: string,
    messageId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(channelId, "Discord pin channel ID")
    assertSearchSnowflake(messageId, "Discord pinned message ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "pin_message",
      `/channels/${channelId}/messages/pins/${messageId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  async unpinMessage(
    channelId: string,
    messageId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(channelId, "Discord pin channel ID")
    assertSearchSnowflake(messageId, "Discord pinned message ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "unpin_message",
      `/channels/${channelId}/messages/pins/${messageId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
  }

  createMessage(
    channelId: string,
    input: CreateMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertMessageContent(input.content)
    if (!input.nonce || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters) {
      throw new RangeError(
        `Discord message nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
      )
    }
    assertAllowedMentions(input.allowedMentions)
    const messageReference = input.reply
      ? {
          channel_id: channelId,
          fail_if_not_exists: true,
          guild_id: input.reply.guildId,
          message_id: input.reply.messageId,
          type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
        }
      : undefined
    return this.#request("create_message", `/channels/${channelId}/messages`, {
      ...options,
      body: {
        allowed_mentions: input.allowedMentions,
        content: input.content,
        enforce_nonce: true,
        ...(messageReference ? { message_reference: messageReference } : {}),
        nonce: input.nonce,
      },
    })
  }

  createPoll(
    channelId: string,
    input: CreatePollInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord poll channel ID")
    assertCreatePollInput(input)
    return this.#request("create_poll", `/channels/${channelId}/messages`, {
      ...options,
      automaticRateLimitRetry: false,
      body: {
        enforce_nonce: true,
        nonce: input.nonce,
        poll: {
          allow_multiselect: input.allowMultiselect,
          answers: input.answers.map((answer) => ({
            poll_media: {
              ...(answer.emoji !== undefined ? { emoji: { name: answer.emoji } } : {}),
              text: answer.text,
            },
          })),
          duration: input.durationHours,
          layout_type: 1,
          question: { text: input.question },
        },
      },
    })
  }

  endPoll(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord poll channel ID")
    assertSearchSnowflake(messageId, "Discord poll message ID")
    return this.#request(
      "end_poll",
      `/channels/${channelId}/polls/${messageId}/expire`,
      {
        ...options,
        automaticRateLimitRetry: false,
      },
    )
  }

  createAttachmentMessage(
    channelId: string,
    input: CreateAttachmentMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord attachment channel ID")
    if (input.content !== undefined) assertMessageContent(input.content)
    if (
      !(input.bytes instanceof Uint8Array)
      || input.bytes.byteLength < 1
      || input.bytes.byteLength > DISCORD_LIMITS.attachmentBytes
    ) {
      throw new RangeError(
        `Discord attachment bytes must contain between 1 and ${DISCORD_LIMITS.attachmentBytes} bytes`,
      )
    }
    assertAttachmentFilename(input.filename)
    if (
      input.description !== undefined
      && (
        !input.description.trim()
        || input.description.length > DISCORD_LIMITS.attachmentDescriptionCharacters
      )
    ) {
      throw new RangeError(
        `Discord attachment description must contain 1-${DISCORD_LIMITS.attachmentDescriptionCharacters} characters`,
      )
    }
    if (input.description !== undefined) {
      assertValidUnicode(input.description, "Discord attachment description")
    }
    if (!input.nonce || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters) {
      throw new RangeError(
        `Discord message nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
      )
    }
    assertAllowedMentions(input.allowedMentions)
    if (input.reply) {
      assertSearchSnowflake(input.reply.guildId, "Discord attachment reply guild ID")
      assertSearchSnowflake(input.reply.messageId, "Discord attachment reply message ID")
    }
    const messageReference = input.reply
      ? {
          channel_id: channelId,
          fail_if_not_exists: true,
          guild_id: input.reply.guildId,
          message_id: input.reply.messageId,
          type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
        }
      : undefined
    const payload = {
      allowed_mentions: input.allowedMentions,
      attachments: [{
        ...(input.description !== undefined ? { description: input.description } : {}),
        filename: input.filename,
        id: "0",
      }],
      ...(input.content !== undefined ? { content: input.content } : {}),
      enforce_nonce: true,
      ...(messageReference ? { message_reference: messageReference } : {}),
      nonce: input.nonce,
    }
    const form = new FormData()
    form.set("payload_json", JSON.stringify(payload))
    form.set("files[0]", new Blob([Uint8Array.from(input.bytes)]), input.filename)
    return this.#request("create_attachment_message", `/channels/${channelId}/messages`, {
      ...options,
      automaticRateLimitRetry: false,
      multipartBody: form,
    })
  }

  editMessage(
    channelId: string,
    messageId: string,
    input: EditMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertMessageContent(input.content)
    assertAllowedMentions(input.allowedMentions)
    return this.#request("edit_message", `/channels/${channelId}/messages/${messageId}`, {
      ...options,
      body: {
        allowed_mentions: input.allowedMentions,
        content: input.content,
      },
    })
  }

  async addOwnReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    options: RequestOptions = {},
  ): Promise<void> {
    if (!emoji || emoji.length > CONNECTOR_LIMITS.interactionEmojiCharacters) {
      throw new RangeError(
        `Discord reaction emoji must contain between 1 and ${CONNECTOR_LIMITS.interactionEmojiCharacters} characters`,
      )
    }
    let encodedEmoji: string
    try {
      encodedEmoji = encodeURIComponent(emoji)
    } catch (error) {
      throw new RangeError("Discord reaction emoji contains invalid Unicode", { cause: error })
    }
    await this.#request<void>(
      "add_own_reaction",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      options,
    )
  }

  searchGuildMessages(
    guildId: string,
    options: GuildMessageSearchOptions = {},
  ): Promise<DiscordMessageSearchIndexing | DiscordMessageSearchResponse> {
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.guildMessageSearch,
      "Discord guild message search limit",
    )
    assertIntegerRange(
      options.offset,
      0,
      DISCORD_LIMITS.searchOffset,
      "Discord guild message search offset",
    )
    assertIntegerRange(
      options.slop,
      0,
      DISCORD_LIMITS.searchSlop,
      "Discord guild message search slop",
    )
    if (
      options.content !== undefined
      && options.content.length > DISCORD_LIMITS.searchContentCharacters
    ) {
      throw new RangeError(
        `Discord guild message search content must not exceed ${DISCORD_LIMITS.searchContentCharacters} characters`,
      )
    }
    assertBoundedArray(
      options.channelIds,
      DISCORD_LIMITS.searchChannelIds,
      "Discord guild message search channel IDs",
    )
    assertSearchSnowflakes(
      options.channelIds,
      "Discord guild message search channel IDs",
    )
    for (const [name, values] of [
      ["author IDs", options.authorIds],
      ["mentioned role IDs", options.mentionRoleIds],
      ["mentioned user IDs", options.mentionUserIds],
      ["replied-to message IDs", options.repliedToMessageIds],
      ["replied-to user IDs", options.repliedToUserIds],
    ] as const) {
      assertBoundedArray(
        values,
        DISCORD_LIMITS.searchFilterIds,
        `Discord guild message search ${name}`,
      )
      assertSearchSnowflakes(values, `Discord guild message search ${name}`)
    }
    assertBoundedArray(
      options.authorTypes,
      DISCORD_LIMITS.searchFilterStrings,
      "Discord guild message search author types",
    )
    assertBoundedArray(
      options.embedTypes,
      DISCORD_LIMITS.searchFilterStrings,
      "Discord guild message search embed types",
    )
    assertBoundedArray(
      options.has,
      DISCORD_LIMITS.searchFilterStrings,
      "Discord guild message search has filters",
    )
    assertAllowedValues(
      options.authorTypes,
      SEARCH_AUTHOR_TYPES,
      "Discord guild message search author types",
    )
    assertAllowedValues(
      options.embedTypes,
      SEARCH_EMBED_TYPES,
      "Discord guild message search embed types",
    )
    assertAllowedValues(
      options.has,
      SEARCH_HAS_TYPES,
      "Discord guild message search has filters",
    )
    assertBoundedStrings(
      options.attachmentFilenames,
      DISCORD_LIMITS.searchFilterStrings,
      DISCORD_LIMITS.searchFilenameCharacters,
      "Discord guild message search attachment filenames",
    )
    for (const [name, values] of [
      ["attachment extensions", options.attachmentExtensions],
      ["embed providers", options.embedProviders],
      ["link hostnames", options.linkHostnames],
    ] as const) {
      assertBoundedStrings(
        values,
        DISCORD_LIMITS.searchFilterStrings,
        DISCORD_LIMITS.searchFilterCharacters,
        `Discord guild message search ${name}`,
      )
    }
    assertAllowedValue(
      options.sortBy,
      SEARCH_SORT_BY_VALUES,
      "Discord guild message search sort field",
    )
    assertAllowedValue(
      options.sortOrder,
      SEARCH_SORT_ORDER_VALUES,
      "Discord guild message search sort order",
    )
    assertSearchSnowflake(options.minId, "Discord guild message search minimum ID")
    assertSearchSnowflake(options.maxId, "Discord guild message search maximum ID")
    if (options.minId && options.maxId && BigInt(options.minId) >= BigInt(options.maxId)) {
      throw new RangeError("Discord guild message search minimum ID must be less than maximum ID")
    }
    if (options.slop !== undefined && !options.content?.trim()) {
      throw new RangeError("Discord guild message search slop requires content")
    }
    if (options.sortBy === "relevance" && options.sortOrder !== undefined) {
      throw new RangeError("Discord guild message search sort order cannot accompany relevance")
    }
    const route = `/guilds/${guildId}/messages/search${queryString({
      attachment_extension: options.attachmentExtensions,
      attachment_filename: options.attachmentFilenames,
      author_id: options.authorIds,
      author_type: options.authorTypes,
      channel_id: options.channelIds,
      content: options.content,
      embed_provider: options.embedProviders,
      embed_type: options.embedTypes,
      has: options.has,
      include_nsfw: options.includeNsfw,
      limit: options.limit,
      link_hostname: options.linkHostnames,
      max_id: options.maxId,
      mention_everyone: options.mentionEveryone,
      mentions: options.mentionUserIds,
      mentions_role_id: options.mentionRoleIds,
      min_id: options.minId,
      offset: options.offset,
      pinned: options.pinned,
      replied_to_message_id: options.repliedToMessageIds,
      replied_to_user_id: options.repliedToUserIds,
      slop: options.slop,
      sort_by: options.sortBy,
      sort_order: options.sortOrder,
    })}`
    return this.#request("search_guild_messages", route, options)
  }

  listActiveGuildThreads(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadList> {
    return this.#request("list_active_guild_threads", `/guilds/${guildId}/threads/active`, options)
  }

  listPublicArchivedThreads(
    channelId: string,
    options: ArchivedThreadPageOptions = {},
  ): Promise<DiscordThreadList> {
    assertIntegerRange(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Discord archived thread limit",
    )
    assertIsoTimestamp(options.before, "Discord public archived thread cursor")
    return this.#request(
      "list_public_archived_threads",
      `/channels/${channelId}/threads/archived/public${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  listPrivateArchivedThreads(
    channelId: string,
    options: ArchivedThreadPageOptions = {},
  ): Promise<DiscordThreadList> {
    assertIntegerRange(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Discord archived thread limit",
    )
    assertIsoTimestamp(options.before, "Discord private archived thread cursor")
    return this.#request(
      "list_private_archived_threads",
      `/channels/${channelId}/threads/archived/private${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  listJoinedPrivateArchivedThreads(
    channelId: string,
    options: ArchivedThreadPageOptions = {},
  ): Promise<DiscordThreadList> {
    assertIntegerRange(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Discord archived thread limit",
    )
    assertSearchSnowflake(options.before, "Discord joined-private archived thread cursor")
    return this.#request(
      "list_joined_private_archived_threads",
      `/channels/${channelId}/users/@me/threads/archived/private${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  async deleteMessage(
    channelId: string,
    messageId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("delete_message", `/channels/${channelId}/messages/${messageId}`, {
      ...options,
      auditReason,
    })
  }

  async bulkDeleteMessages(
    channelId: string,
    messageIds: readonly string[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("bulk_delete_messages", `/channels/${channelId}/messages/bulk-delete`, {
      ...options,
      auditReason,
      body: { messages: messageIds },
    })
  }
}
