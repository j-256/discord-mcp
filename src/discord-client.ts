import { setTimeout as wait } from "node:timers/promises"

import {
  AUDIT_LOG_LIMITS,
  BAN_AUDIT_LIMITS,
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  CONNECTOR_LIMITS,
  DISCORD_API_BASE_URL,
  DISCORD_APPLICATION_FLAGS,
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_FORUM_LAYOUTS,
  DISCORD_FORUM_SORT_ORDERS,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  GUILD_TEMPLATE_LIMITS,
  INVITE_LIMITS,
  MEMBER_DIRECTORY_LIMITS,
  ONBOARDING_LIMITS,
  POLL_LIMITS,
  REACTION_LIMITS,
  WELCOME_SCREEN_LIMITS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_USER_AGENT,
  DISCORD_VIDEO_QUALITY_MODES,
  GUILD_AFK_TIMEOUT_SECONDS,
  GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK,
} from "./constants.js"
import {
  assertCompiledComponentLayout,
  type DiscordStaticComponent,
} from "./component-layout.js"
import {
  ApplicationEmojiEvidenceError,
  AutoModerationEvidenceError,
  ChannelMetadataEvidenceError,
  DiscordApiError,
  errorMessage,
  ForumTagEvidenceError,
  GuildExpressionEvidenceError,
  IntegrationEvidenceError,
  GuildTemplateEvidenceError,
  InviteEvidenceError,
  MemberNicknameEvidenceError,
  MemberVoiceEvidenceError,
  OnboardingEvidenceError,
  redactText,
  RoleConfigurationEvidenceError,
  ScheduledEventEvidenceError,
  SoundboardEvidenceError,
  StageInstanceEvidenceError,
  ThreadGovernanceEvidenceError,
  WelcomeScreenEvidenceError,
  WebhookEvidenceError,
  WidgetSettingsEvidenceError,
  VoiceRegionEvidenceError,
} from "./errors.js"
import type {
  EmojiFileFormat,
  StickerFileFormat,
} from "./guild-expression-file.js"
import {
  inspectRoleIconBytes,
  type RoleIconFileFormat,
} from "./role-icon-file.js"
import { assertRoleIconUnicodeEmoji } from "./role-icon.js"
import type { ScheduledEventCoverFormat } from "./scheduled-event-file.js"
import type { SoundboardFileFormat } from "./soundboard-file.js"
import {
  normalizeDesiredGuildProfileDescription,
  normalizeDesiredGuildProfileName,
  projectGuildProfile,
  type DiscordGuildProfile,
} from "./guild-profile.js"
import {
  guildIncidentActionsBody,
  projectGuildIncidentMutationResponse,
  projectGuildIncidentState,
  type DiscordGuildIncidentActions,
  type DiscordGuildIncidentState,
  type ModifyGuildIncidentActionsInput,
} from "./guild-incident.js"
import {
  normalizeDesiredMemberNickname,
  projectMemberNickname,
} from "./member-nickname.js"
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
  DiscordApplicationCommand,
  DiscordApplicationCommandOption,
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
  DiscordReactionType,
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

export interface CreateGuildApplicationCommandInput {
  defaultMemberPermissions: string
  description: string
  name: string
  nsfw: boolean
  options: readonly DiscordApplicationCommandOption[]
  type: number
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

export interface ReactionUserPageOptions extends RequestOptions {
  after?: string
  limit?: number
  type?: DiscordReactionType
}

export interface DiscordChannelMetadata {
  bitrate: number | null
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
  rtcRegion: string | null
  topic: string | null
  type: number
  unknownFieldCount: number
  userLimit: number | null
  videoQualityMode: number | null
}

export interface DiscordVoiceRegion {
  custom: boolean
  deprecated: boolean
  id: string
  name: string
  optimal: boolean
  unknownFieldCount: number
}

export interface DiscordForumTagSummary {
  emojiId: string | null
  emojiName: string | null
  id: string
  moderated: boolean
  name: string
  unknownFieldCount: number
}

export interface DiscordForumTagState {
  flags: number
  guildId: string
  id: string
  permissionOverwriteUnknownFieldCount: number
  permissionOverwrites: DiscordPermissionOverwrite[]
  tags: DiscordForumTagSummary[]
  type: number
  unknownFieldCount: number
}

export interface ModifyForumTagInput {
  emojiId: string | null
  emojiName: string | null
  id?: string
  moderated: boolean
  name: string
}

export interface DiscordThreadStateSummary {
  archived: boolean
  autoArchiveDuration: number
  guildId: string
  id: string
  invitable: boolean | null
  locked: boolean
  name: string
  ownerId: string
  parentId: string
  rateLimitPerUser: number
  type: number
  unknownFieldCount: number
  unknownMetadataFieldCount: number
}

export type ModifyThreadStateInput =
  | { archived: boolean }
  | { autoArchiveDuration: number }
  | { invitable: boolean }
  | { locked: boolean }
  | { name: string }
  | { rateLimitPerUser: number }

export interface DiscordStageInstanceSummary {
  channelId: string
  discoverableDisabled: boolean
  guildId: string
  id: string
  privacyLevel: 1 | 2
  scheduledEventId: string | null
  topic: string
  unknownFieldCount: number
}

export const DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS = Object.freeze({
  guildOnly: 2,
  public: 1,
} as const)

export interface CreateStageInstanceInput {
  channelId: string
  sendStartNotification: boolean
  topic: string
}

export interface ModifyStageInstanceInput {
  topic: string
}

export interface ModifyChannelMetadataInput {
  bitrate?: number
  defaultAutoArchiveDuration?: number
  defaultThreadRateLimitPerUser?: number
  name?: string
  nsfw?: boolean
  rateLimitPerUser?: number
  rtcRegion?: string | null
  topic?: string | null
  userLimit?: number
  videoQualityMode?: number
}

export interface DiscordWebhookSummary {
  applicationId: string | null
  channelId: string | null
  creatorUserId: string | null
  guildId: string | null
  id: string
  name: string | null
  sourceChannelId: string | null
  sourceGuildId: string | null
  type: number
}

export interface DiscordFollowedChannel {
  sourceChannelId: string
  webhookId: string
}

export interface CreateWebhookInput {
  name: string
}

export interface ExecuteWebhookMessageInput {
  allowedMentions: DiscordAllowedMentions
  content: string
}

export interface ModifyWebhookMessageInput extends ExecuteWebhookMessageInput {}

export type WebhookCredentialSink = (
  webhook: DiscordWebhookSummary,
  token: string,
) => Promise<void>

export interface ModifyWebhookInput {
  channelId?: string
  name?: string
}

export type DiscordGuildIntegrationType =
  | "discord"
  | "guild_subscription"
  | "twitch"
  | "unknown"
  | "youtube"

export interface DiscordGuildIntegrationSummary {
  accountPresent: true
  applicationId: string | null
  associatedBotUserId: string | null
  enableEmoticons: boolean | null
  enabled: boolean
  expireBehavior: 0 | 1 | null
  expireGracePeriod: number | null
  id: string
  knownScopes: string[]
  linkedUserPresent: boolean
  revoked: boolean | null
  roleId: string | null
  subscriberCount: number | null
  syncedAt: string | null
  syncing: boolean | null
  type: DiscordGuildIntegrationType
  unknownFieldCounts: {
    account: number
    application: number
    bot: number
    integration: number
    user: number
  }
  unknownScopeCount: number
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
  unknownFieldCount?: number
  uses: number
}

export interface DiscordApplicationCommandPermission {
  allowed: boolean
  id: string
  type: 1 | 2 | 3
  unknownFieldCount: number
}

export interface DiscordGuildApplicationCommandPermissions {
  applicationId: string
  commandId: string
  guildId: string
  permissions: DiscordApplicationCommandPermission[]
  unknownFieldCount: number
}

export interface DiscordInviteIdentitySummary {
  channelId: string | null
  code: string
  guildId: string | null
  type: number
}

export type DiscordDeletedInviteSummary = DiscordInviteIdentitySummary

export interface CreateChannelInviteInput {
  maxAgeSeconds: number
  maxUses: number
  targetUserIds: readonly string[] | null
  temporaryMembership: boolean
}

export interface DiscordInviteTargetUsersJobStatus {
  completedAt: string | null
  createdAt: string
  errorPresent: boolean
  processedUsers: number
  status: 0 | 1 | 2 | 3
  totalUsers: number
  unknownFieldCount: number
}

export interface DiscordGuildTemplateSummary {
  code: string
  createdAt: string
  creatorId: string
  description: string | null
  isDirty: boolean | null
  name: string
  serializedSourceGuild: Record<string, unknown>
  sourceGuildId: string
  unknownFieldCount: number
  updatedAt: string
  usageCount: number
}

export interface CreateGuildTemplateInput {
  description: string | null
  name: string
}

export interface ModifyGuildTemplateInput {
  description?: string | null
  name?: string
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

export interface DiscordGuildWelcomeScreenChannel {
  channelId: string
  description: string
  emojiId: string | null
  emojiName: string | null
  unknownFieldCount: number
}

export interface DiscordGuildWelcomeScreen {
  description: string | null
  unknownFieldCount: number
  welcomeChannels: DiscordGuildWelcomeScreenChannel[]
}

export interface ModifyGuildWelcomeScreenChannelInput {
  channelId: string
  description: string
  emojiId: string | null
  emojiName: string | null
}

export interface ModifyGuildWelcomeScreenInput {
  description: string | null
  enabled: boolean
  welcomeChannels: readonly ModifyGuildWelcomeScreenChannelInput[]
}

export interface DiscordGuildWidgetSettings {
  channelId: string | null
  enabled: boolean
  unknownFieldCount: number
}

export interface ModifyGuildWidgetSettingsInput {
  channelId: string | null
  enabled: boolean
}

export interface ModifyGuildSettingsInput {
  afkChannelId?: string | null
  afkTimeoutSeconds?: 60 | 300 | 900 | 1_800 | 3_600
  defaultMessageNotifications?: 0 | 1
  explicitContentFilter?: 0 | 1 | 2
  premiumProgressBarEnabled?: boolean
  suppressedSystemNotifications?: number
  systemChannelId?: string | null
  verificationLevel?: 0 | 1 | 2 | 3 | 4
}

export interface ModifyGuildProfileInput {
  description?: string | null
  name?: string
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
  unknownFieldCount?: number
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
  unknownFieldCount?: number
}

export interface DiscordApplicationEmojiSummary {
  animated: boolean
  available: boolean
  id: string
  managed: boolean
  name: string
  requiresColons: boolean
  unknownFieldCount: number
  uploaderProjectedOut: true
}

export interface DiscordApplicationEmojiInventory {
  items: DiscordApplicationEmojiSummary[]
  unknownFieldCount: number
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

export interface DiscordSoundboardSoundSummary {
  available: boolean
  creatorUserId: string | null
  emojiId: string | null
  emojiName: string | null
  guildId: string | null
  id: string
  name: string
  unknownFieldCount: number
  volume: number
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

export interface ScheduledEventUserPageOptions extends RequestOptions {
  after?: string
  limit?: number
}

export interface DiscordScheduledEventUserSummary {
  bot: boolean
  eventId: string
  userId: string
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
const WEBHOOK_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const WEBHOOK_FORBIDDEN_NAME_PATTERN = /(?:clyde|discord)/iu
const WEBHOOK_REPEATED_WHITESPACE_PATTERN = /\s{2,}/u
const CREATE_WEBHOOK_INPUT_KEYS = ["name"] as const
const MODIFY_WEBHOOK_INPUT_KEYS = ["channelId", "name"] as const
const POLL_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const VOICE_CHANNEL_STATUS_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
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
const SOUNDBOARD_FORMAT_MEDIA_TYPES: Readonly<Record<
  SoundboardFileFormat,
  "audio/mpeg" | "audio/ogg"
>> = Object.freeze({
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
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

export interface CreateMessageForwardInput {
  nonce: string
  sourceChannelId: string
  sourceGuildId: string
  sourceMessageId: string
}

export interface CreateComponentMessageInput {
  allowedMentions: DiscordAllowedMentions
  components: readonly DiscordStaticComponent[]
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
  availableTags?: readonly CreateGuildChannelForumTagInput[]
  bitrate?: number
  defaultAutoArchiveDuration?: number
  defaultForumLayout?: number
  defaultReactionEmoji?: {
    emojiId: string | null
    emojiName: string | null
  } | null
  defaultSortOrder?: number | null
  defaultThreadRateLimitPerUser?: number
  flags?: number
  name: string
  nsfw?: boolean
  parentId?: string
  permissionOverwrites?: readonly CreateGuildChannelPermissionOverwriteInput[]
  rateLimitPerUser?: number
  rtcRegion?: string | null
  topic?: string | null
  type: number
  userLimit?: number
  videoQualityMode?: number
}

export interface CreateGuildChannelForumTagInput {
  emojiId: string | null
  emojiName: string | null
  moderated: boolean
  name: string
}

export interface CreateGuildChannelPermissionOverwriteInput {
  allow: string
  deny: string
  id: string
  type: 0 | 1
}

export interface ModifyGuildChannelPositionInput {
  id: string
  position: number
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
  roleIcon?:
    | { kind: "clear" }
    | { kind: "image"; bytes: Uint8Array; format: RoleIconFileFormat }
    | { kind: "unicode"; value: string }
}

export interface ModifyGuildRolePositionInput {
  id: string
  position: number
}

export type DiscordGuildRoleMemberCounts = Readonly<Record<string, number>>

export interface CreateGuildEmojiInput {
  bytes: Uint8Array
  format: EmojiFileFormat
  name: string
  roleIds: readonly string[]
}

export interface CreateApplicationEmojiInput {
  bytes: Uint8Array
  format: EmojiFileFormat
  name: string
}

export interface ModifyApplicationEmojiInput {
  name: string
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

export interface CreateGuildSoundboardSoundInput {
  bytes: Uint8Array
  emojiId: string | null
  emojiName: string | null
  format: SoundboardFileFormat
  name: string
  volume: number
}

export interface ModifyGuildSoundboardSoundInput {
  emojiId?: string | null
  emojiName?: string | null
  name?: string
  volume?: number | null
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

export interface CreateThreadFromMessageInput {
  autoArchiveDuration: number
  name: string
  rateLimitPerUser: number
}

export interface CreateThreadWithoutMessageInput extends CreateThreadFromMessageInput {
  invitable?: boolean
  type: number
}

export interface EditMessageInput {
  allowedMentions: DiscordAllowedMentions
  content: string
}

export interface EditComponentMessageInput {
  allowedMentions: DiscordAllowedMentions
  components: readonly DiscordStaticComponent[]
  flags: number
}

export interface ModifyGuildMemberTimeoutInput {
  communicationDisabledUntil: string | null
}

export interface DiscordBulkGuildBanResponse {
  bannedUserIds: string[]
  failedUserIds: string[]
}

export interface DiscordGuildPruneResponse {
  pruned: number
}

export interface ModifyCurrentApplicationFlagsInput {
  flags: number
}

const CURRENT_APPLICATION_LIMITED_INTENT_FLAG_MASK =
  DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited
  | DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited
  | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited

export interface DiscordVoiceStateSummary {
  channelId: string | null
  deaf: boolean
  guildId: string | null
  mute: boolean
  unknownFieldCount: number
  userId: string
}

export interface DiscordGuildMemberVoiceUpdate {
  deaf: boolean
  mute: boolean
  unknownFieldCount: number
  userId: string
}

export interface DiscordGuildMemberNicknameUpdate {
  nickname: string | null
  userId: string
}

export type ModifyGuildMemberVoiceInput =
  | { channelId: string | null }
  | { deaf: boolean }
  | { mute: boolean }

interface RequestParameters extends RequestOptions {
  accept?: string
  authentication?: "bot" | "none"
  auditReason?: string
  automaticRateLimitRetry?: boolean
  body?: unknown
  diagnosticRoute?: string
  expectedSuccessStatus?: number
  maxResponseBytes?: number
  multipartBody?: FormData
  responseFormat?: "json" | "text"
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
  "add_own_reaction",
  "add_thread_member",
  "bulk_guild_ban",
  "begin_guild_prune",
  "crosspost_message",
  "create_application_emoji",
  "create_component_message",
  "create_guild_auto_moderation_rule",
  "create_guild_ban",
  "create_interaction_response",
  "create_immediate_interaction_response",
  "create_guild_emoji",
  "create_guild_soundboard_sound",
  "create_guild_sticker",
  "create_guild_template",
  "create_channel_invite",
  "create_stage_instance",
  "create_webhook",
  "execute_webhook",
  "delete_application_emoji",
  "delete_guild_channel",
  "delete_guild_auto_moderation_rule",
  "delete_guild_emoji",
  "delete_guild_soundboard_sound",
  "delete_guild_sticker",
  "delete_guild_template",
  "delete_guild_integration",
  "delete_webhook",
  "delete_webhook_message",
  "delete_stage_instance",
  "delete_all_message_reactions",
  "delete_all_message_reactions_for_emoji",
  "delete_own_reaction",
  "delete_user_reaction",
  "edit_component_message",
  "edit_original_interaction_response",
  "follow_announcement_channel",
  "get_application_emoji",
  "get_current_user_voice_state",
  "get_guild_auto_moderation_rule",
  "get_guild_emoji",
  "get_guild_incident_actions",
  "get_guild_profile",
  "get_forum_tags",
  "get_guild_soundboard_sound",
  "get_guild_sticker",
  "get_guild_voice_state",
  "get_thread_member",
  "get_thread_state",
  "get_stage_instance",
  "get_channel_metadata",
  "get_guild_onboarding",
  "get_guild_welcome_screen",
  "get_invite",
  "get_invite_target_users",
  "get_invite_target_users_job_status",
  "get_webhook",
  "get_webhook_message",
  "list_guild_invites",
  "list_guild_integrations",
  "list_application_emojis",
  "list_channel_webhooks",
  "list_guild_auto_moderation_rules",
  "list_guild_emojis",
  "list_default_soundboard_sounds",
  "list_guild_soundboard_sounds",
  "list_guild_stickers",
  "list_guild_templates",
  "list_guild_scheduled_event_users",
  "list_reaction_users",
  "modify_application_emoji",
  "modify_guild_emoji",
  "modify_forum_tags",
  "modify_guild_soundboard_sound",
  "modify_guild_auto_moderation_rule",
  "modify_guild_sticker",
  "modify_guild_template",
  "modify_current_member_nickname",
  "modify_guild_member_nickname",
  "modify_guild_member_timeout",
  "modify_guild_member_voice",
  "modify_thread_state",
  "modify_webhook",
  "modify_webhook_message",
  "modify_stage_instance",
  "modify_guild_onboarding",
  "modify_guild_incident_actions",
  "modify_guild_profile",
  "modify_guild_channel_positions",
  "modify_guild_role_positions",
  "modify_guild_welcome_screen",
  "modify_channel_metadata",
  "delete_invite",
  "search_guild_members",
  "search_guild_messages",
  "set_voice_channel_status",
  "sync_guild_template",
  "remove_thread_member",
  "remove_guild_ban",
  "remove_guild_member",
])

const THREAD_METADATA_RESPONSE_KEYS = [
  "archive_timestamp",
  "archived",
  "auto_archive_duration",
  "create_timestamp",
  "invitable",
  "locked",
] as const

const STAGE_INSTANCE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "channel_id",
  "discoverable_disabled",
  "guild_id",
  "guild_scheduled_event_id",
  "id",
  "privacy_level",
  "topic",
])

const SOUNDBOARD_SOUND_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "available",
  "emoji_id",
  "emoji_name",
  "guild_id",
  "name",
  "sound_id",
  "user",
  "volume",
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
const CHANNEL_METADATA_VOICE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
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
const THREAD_STATE_RESPONSE_KEYS: readonly string[] = [...CHANNEL_METADATA_RESPONSE_KEYS]
const CHANNEL_METADATA_OVERWRITE_KEYS: ReadonlySet<string> = new Set([
  "allow",
  "deny",
  "id",
  "type",
])
const MODIFY_CHANNEL_METADATA_KEYS: ReadonlySet<string> = new Set([
  "bitrate",
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "name",
  "nsfw",
  "rateLimitPerUser",
  "rtcRegion",
  "topic",
  "userLimit",
  "videoQualityMode",
])
const FORUM_TAG_RESPONSE_KEYS = [
  "emoji_id",
  "emoji_name",
  "id",
  "moderated",
  "name",
] as const
const MODIFY_FORUM_TAG_KEYS = [
  "emojiId",
  "emojiName",
  "id",
  "moderated",
  "name",
] as const

function inviteEvidenceError(): InviteEvidenceError {
  return new InviteEvidenceError("Discord returned an invalid guild invite inventory")
}

const INVITE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "approximate_member_count",
  "approximate_presence_count",
  "channel",
  "code",
  "created_at",
  "expires_at",
  "flags",
  "guild",
  "guild_scheduled_event",
  "inviter",
  "max_age",
  "max_uses",
  "roles",
  "stage_instance",
  "target_application",
  "target_type",
  "target_user",
  "temporary",
  "type",
  "uses",
])
const INVITE_ROLE_KEYS: ReadonlySet<string> = new Set([
  "color",
  "colors",
  "icon",
  "id",
  "name",
  "position",
  "unicode_emoji",
])

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

function projectInviteIdentity(value: unknown): DiscordInviteIdentitySummary {
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

const INVITE_TARGET_USERS_JOB_KEYS: ReadonlySet<string> = new Set([
  "completed_at",
  "created_at",
  "error_message",
  "processed_users",
  "status",
  "total_users",
])

function projectInviteTargetUsersJobStatus(
  value: unknown,
): DiscordInviteTargetUsersJobStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inviteEvidenceError()
  }
  const record = value as Record<string, unknown>
  const status = inviteInteger(record.status, 3)
  const totalUsers = inviteInteger(record.total_users, INVITE_LIMITS.targetUserIds)
  const processedUsers = inviteInteger(
    record.processed_users,
    INVITE_LIMITS.targetUserIds,
  )
  const errorMessage = record.error_message
  if (
    processedUsers > totalUsers
    || !(errorMessage === null || (
      typeof errorMessage === "string"
      && errorMessage.length <= INVITE_LIMITS.capabilityFileBytes
    ))
  ) {
    throw inviteEvidenceError()
  }
  return {
    completedAt: inviteTimestamp(record.completed_at, true),
    createdAt: inviteTimestamp(record.created_at, false) as string,
    errorPresent: errorMessage !== null,
    processedUsers,
    status: status as DiscordInviteTargetUsersJobStatus["status"],
    totalUsers,
    unknownFieldCount: countUnknownFields(
      record,
      [...INVITE_TARGET_USERS_JOB_KEYS],
    ),
  }
}

function projectInviteTargetUserIds(value: string): string[] {
  const lines = value.split(/\r?\n/u)
  if (lines.at(-1) === "") lines.pop()
  if (
    lines[0] !== "user_id"
    || lines.length < 2
    || lines.length > INVITE_LIMITS.targetUserIds + 1
  ) {
    throw inviteEvidenceError()
  }
  const ids = lines.slice(1)
  try {
    for (const id of ids) {
      assertPositiveSnowflake(id, "Discord invite target user ID")
      if (BigInt(id).toString() !== id) throw inviteEvidenceError()
    }
  } catch {
    throw inviteEvidenceError()
  }
  if (new Set(ids).size !== ids.length) throw inviteEvidenceError()
  return ids.sort(compareDiscordSnowflakes)
}

const CREATE_CHANNEL_INVITE_INPUT_KEYS: ReadonlySet<string> = new Set([
  "maxAgeSeconds",
  "maxUses",
  "targetUserIds",
  "temporaryMembership",
])

function canonicalInviteTargetUserIds(value: unknown): boolean {
  if (value === null) return true
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > INVITE_LIMITS.targetUserIds
  ) return false
  try {
    for (const id of value) {
      assertPositiveSnowflake(id, "Discord invite target user ID")
      if (BigInt(id).toString() !== id) return false
    }
  } catch {
    return false
  }
  if (new Set(value).size !== value.length) return false
  return value.every((id, index) => (
    index === 0 || compareDiscordSnowflakes(value[index - 1] as string, id) < 0
  ))
}

function assertCreateChannelInviteInput(input: CreateChannelInviteInput): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || !hasOnlyKeys(
      input as unknown as Record<string, unknown>,
      [...CREATE_CHANNEL_INVITE_INPUT_KEYS],
    )
    || !Number.isInteger(input.maxAgeSeconds)
    || input.maxAgeSeconds < INVITE_LIMITS.minAgeSeconds
    || input.maxAgeSeconds > INVITE_LIMITS.maxAgeSeconds
    || !Number.isInteger(input.maxUses)
    || input.maxUses < 1
    || input.maxUses > INVITE_LIMITS.maxUses
    || !canonicalInviteTargetUserIds(input.targetUserIds)
    || typeof input.temporaryMembership !== "boolean"
  ) {
    throw new RangeError(
      "Discord invite creation requires finite age, finite uses, canonical acceptance, and explicit temporary membership",
    )
  }
}

function encodedInviteCode(code: string, description: string): string {
  if (
    typeof code !== "string"
    || code.length < 1
    || code.length > INVITE_LIMITS.codeCharacters
    || URL_DOT_PATH_SEGMENTS.has(code)
    || /[\u0000-\u001F\u007F]/u.test(code)
  ) {
    throw new RangeError(`${description} code is invalid`)
  }
  try {
    return encodeURIComponent(code)
  } catch {
    throw new RangeError(`${description} code is invalid`)
  }
}

function inviteTargetUsersCsv(ids: readonly string[]): string {
  return `user_id\n${ids.join("\n")}\n`
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
  const unknownFieldCount = countUnknownFields(record, [...INVITE_RESPONSE_KEYS])
    + roles.reduce((total, role) => {
        if (!role || typeof role !== "object" || Array.isArray(role)) {
          throw inviteEvidenceError()
        }
        return total + countUnknownFields(
          role as Record<string, unknown>,
          [...INVITE_ROLE_KEYS],
        )
      }, 0)
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
    ...(unknownFieldCount > 0 ? { unknownFieldCount } : {}),
    uses: inviteInteger(record.uses),
  }
}

const GUILD_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "code",
  "created_at",
  "creator",
  "creator_id",
  "description",
  "is_dirty",
  "name",
  "serialized_source_guild",
  "source_guild_id",
  "updated_at",
  "usage_count",
])

function guildTemplateEvidenceError(): GuildTemplateEvidenceError {
  return new GuildTemplateEvidenceError("Discord returned invalid guild-template evidence")
}

function guildTemplateText(
  value: unknown,
  maximum: number,
  nullable: boolean,
  minimum = 1,
): string | null {
  if (nullable && value === null) return null
  if (
    typeof value !== "string"
    || [...value].length < minimum
    || [...value].length > maximum
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw guildTemplateEvidenceError()
  }
  try {
    encodeURIComponent(value)
  } catch {
    throw guildTemplateEvidenceError()
  }
  return value
}

function guildTemplateCode(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > GUILD_TEMPLATE_LIMITS.codeCharacters
    || URL_DOT_PATH_SEGMENTS.has(value)
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw guildTemplateEvidenceError()
  }
  try {
    encodeURIComponent(value)
  } catch {
    throw guildTemplateEvidenceError()
  }
  return value
}

function guildTemplateTimestamp(value: unknown): string {
  if (
    typeof value !== "string"
    || !ISO_8601_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw guildTemplateEvidenceError()
  }
  return new Date(value).toISOString()
}

function projectGuildTemplate(value: unknown): DiscordGuildTemplateSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw guildTemplateEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.creator_id !== "string"
    || typeof record.source_guild_id !== "string"
    || !record.creator
    || typeof record.creator !== "object"
    || Array.isArray(record.creator)
    || (record.creator as Record<string, unknown>).id !== record.creator_id
  ) {
    throw guildTemplateEvidenceError()
  }
  try {
    assertPositiveSnowflake(record.creator_id, "Discord guild-template creator ID")
    assertPositiveSnowflake(record.source_guild_id, "Discord guild-template source guild ID")
  } catch {
    throw guildTemplateEvidenceError()
  }
  if (
    !Number.isSafeInteger(record.usage_count)
    || (record.usage_count as number) < 0
    || !record.serialized_source_guild
    || typeof record.serialized_source_guild !== "object"
    || Array.isArray(record.serialized_source_guild)
    || !(record.is_dirty === null || typeof record.is_dirty === "boolean")
  ) {
    throw guildTemplateEvidenceError()
  }
  return {
    code: guildTemplateCode(record.code),
    createdAt: guildTemplateTimestamp(record.created_at),
    creatorId: record.creator_id,
    description: guildTemplateText(
      record.description,
      GUILD_TEMPLATE_LIMITS.descriptionCharacters,
      true,
      0,
    ),
    isDirty: record.is_dirty,
    name: guildTemplateText(
      record.name,
      GUILD_TEMPLATE_LIMITS.nameCharacters,
      false,
    ) as string,
    serializedSourceGuild: record.serialized_source_guild as Record<string, unknown>,
    sourceGuildId: record.source_guild_id,
    unknownFieldCount: Object.keys(record)
      .filter((key) => !GUILD_TEMPLATE_KEYS.has(key)).length,
    updatedAt: guildTemplateTimestamp(record.updated_at),
    usageCount: record.usage_count as number,
  }
}

function assertGuildTemplateInput(
  value: CreateGuildTemplateInput | ModifyGuildTemplateInput,
  requireName: boolean,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord guild-template metadata must be an object")
  }
  const keys = Object.keys(value)
  if (
    keys.some((key) => key !== "description" && key !== "name")
    || requireName && !keys.includes("name")
    || !requireName && keys.length < 1
  ) {
    throw new RangeError("Discord guild-template metadata fields are invalid")
  }
  if (value.name !== undefined) {
    guildTemplateText(value.name, GUILD_TEMPLATE_LIMITS.nameCharacters, false)
  }
  if (value.description !== undefined) {
    guildTemplateText(
      value.description,
      GUILD_TEMPLATE_LIMITS.descriptionCharacters,
      true,
      0,
    )
  }
}

function encodedGuildTemplateCode(code: string): string {
  return encodeURIComponent(guildTemplateCode(code))
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
const APPLICATION_EMOJI_KEYS = [
  "animated",
  "available",
  "id",
  "managed",
  "name",
  "require_colons",
  "roles",
  "user",
] as const
const APPLICATION_EMOJI_INVENTORY_KEYS = ["items"] as const
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

function countUnknownFields(
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
    unknownFieldCount: countUnknownFields(record, ONBOARDING_EMOJI_KEYS),
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
      countUnknownFields(record, ONBOARDING_OPTION_KEYS)
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
      countUnknownFields(record, ONBOARDING_PROMPT_KEYS)
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
      countUnknownFields(record, ONBOARDING_KEYS)
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

const WELCOME_SCREEN_KEYS = ["description", "welcome_channels"] as const
const WELCOME_SCREEN_CHANNEL_KEYS = [
  "channel_id",
  "description",
  "emoji_id",
  "emoji_name",
] as const
const WELCOME_SCREEN_INPUT_KEYS = [
  "description",
  "enabled",
  "welcomeChannels",
] as const
const WELCOME_SCREEN_CHANNEL_INPUT_KEYS = [
  "channelId",
  "description",
  "emojiId",
  "emojiName",
] as const
const WELCOME_SCREEN_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u

const WIDGET_SETTINGS_KEYS = ["channel_id", "enabled"] as const
const WIDGET_SETTINGS_INPUT_KEYS = ["channelId", "enabled"] as const
const GUILD_SETTINGS_INPUT_KEYS = [
  "afkChannelId",
  "afkTimeoutSeconds",
  "defaultMessageNotifications",
  "explicitContentFilter",
  "premiumProgressBarEnabled",
  "suppressedSystemNotifications",
  "systemChannelId",
  "verificationLevel",
] as const
const GUILD_PROFILE_INPUT_KEYS = [
  "description",
  "name",
] as const

const VOICE_STATE_KEYS = [
  "channel_id",
  "deaf",
  "discoverable_disabled",
  "guild_id",
  "member",
  "mute",
  "request_to_speak_timestamp",
  "self_deaf",
  "self_mute",
  "self_stream",
  "self_video",
  "session_id",
  "suppress",
  "user_id",
] as const
const GUILD_MEMBER_KEYS = [
  "avatar",
  "avatar_decoration_data",
  "banner",
  "collectibles",
  "communication_disabled_until",
  "deaf",
  "flags",
  "joined_at",
  "mute",
  "nick",
  "pending",
  "permissions",
  "premium_since",
  "roles",
  "user",
] as const

function memberVoiceEvidenceError(options?: ErrorOptions): MemberVoiceEvidenceError {
  return new MemberVoiceEvidenceError(
    "Discord returned invalid member voice evidence",
    options,
  )
}

function projectVoiceState(
  value: unknown,
  guildId: string,
  userId: string,
): DiscordVoiceStateSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw memberVoiceEvidenceError()
  }
  const record = value as Record<string, unknown>
  try {
    assertPositiveSnowflake(record.user_id as string, "Discord voice-state user ID")
    if (record.user_id !== userId) {
      throw new RangeError("Discord voice-state user ID does not match the request")
    }
    if (typeof record.guild_id === "string") {
      assertPositiveSnowflake(record.guild_id, "Discord voice-state guild ID")
      if (record.guild_id !== guildId) {
        throw new RangeError("Discord voice-state guild ID does not match the request")
      }
    } else if (record.guild_id !== undefined) {
      throw new RangeError("Discord voice-state guild ID is invalid")
    }
    if (typeof record.channel_id === "string") {
      assertPositiveSnowflake(record.channel_id, "Discord voice-state channel ID")
    } else if (record.channel_id !== null) {
      throw new RangeError("Discord voice-state channel ID is invalid")
    }
    if (typeof record.mute !== "boolean" || typeof record.deaf !== "boolean") {
      throw new RangeError("Discord voice-state moderation fields are invalid")
    }
  } catch (error) {
    throw memberVoiceEvidenceError({ cause: error })
  }
  return {
    channelId: record.channel_id as string | null,
    deaf: record.deaf as boolean,
    guildId: typeof record.guild_id === "string" ? record.guild_id : null,
    mute: record.mute as boolean,
    unknownFieldCount: countUnknownFields(record, VOICE_STATE_KEYS),
    userId: record.user_id as string,
  }
}

function projectGuildMemberVoiceUpdate(
  value: unknown,
  userId: string,
): DiscordGuildMemberVoiceUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw memberVoiceEvidenceError()
  }
  const record = value as Record<string, unknown>
  const user = record.user
  try {
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      throw new RangeError("Discord guild-member update omitted its user")
    }
    assertPositiveSnowflake(
      (user as Record<string, unknown>).id as string,
      "Discord guild-member update user ID",
    )
    if ((user as Record<string, unknown>).id !== userId) {
      throw new RangeError("Discord guild-member update user ID does not match the request")
    }
    if (typeof record.mute !== "boolean" || typeof record.deaf !== "boolean") {
      throw new RangeError("Discord guild-member update voice fields are invalid")
    }
  } catch (error) {
    throw memberVoiceEvidenceError({ cause: error })
  }
  return {
    deaf: record.deaf as boolean,
    mute: record.mute as boolean,
    unknownFieldCount: countUnknownFields(record, GUILD_MEMBER_KEYS),
    userId: (user as Record<string, unknown>).id as string,
  }
}

function projectGuildMemberNicknameUpdate(
  value: unknown,
  userId: string,
): DiscordGuildMemberNicknameUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemberNicknameEvidenceError(
      "Discord returned invalid member nickname evidence",
    )
  }
  const record = value as Record<string, unknown>
  const user = record.user
  try {
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      throw new RangeError("Discord guild-member update omitted its user")
    }
    assertPositiveSnowflake(
      (user as Record<string, unknown>).id as string,
      "Discord guild-member update user ID",
    )
    if ((user as Record<string, unknown>).id !== userId) {
      throw new RangeError("Discord guild-member update user ID does not match the request")
    }
    return {
      nickname: projectMemberNickname(record.nick),
      userId,
    }
  } catch (error) {
    throw new MemberNicknameEvidenceError(
      "Discord returned invalid member nickname evidence",
      { cause: error },
    )
  }
}

function memberVoiceBody(input: ModifyGuildMemberVoiceInput): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord member voice input must be an exact object")
  }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1) {
    throw new RangeError("Discord member voice input must control exactly one field")
  }
  if (keys[0] === "channelId") {
    if (!(record.channelId === null || typeof record.channelId === "string")) {
      throw new RangeError("Discord member voice channel ID is invalid")
    }
    if (typeof record.channelId === "string") {
      assertPositiveSnowflake(record.channelId, "Discord member voice channel ID")
    }
    return { channel_id: record.channelId }
  }
  if (keys[0] === "mute" && typeof record.mute === "boolean") {
    return { mute: record.mute }
  }
  if (keys[0] === "deaf" && typeof record.deaf === "boolean") {
    return { deaf: record.deaf }
  }
  throw new RangeError("Discord member voice input contains an unsupported field")
}

function widgetSettingsEvidenceError(options?: ErrorOptions): WidgetSettingsEvidenceError {
  return new WidgetSettingsEvidenceError(
    "Discord returned invalid widget-settings evidence",
    options,
  )
}

function projectGuildWidgetSettings(value: unknown): DiscordGuildWidgetSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw widgetSettingsEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.enabled !== "boolean"
    || !(record.channel_id === null || typeof record.channel_id === "string")
  ) {
    throw widgetSettingsEvidenceError()
  }
  if (typeof record.channel_id === "string") {
    try {
      assertPositiveSnowflake(record.channel_id, "Discord widget channel ID")
    } catch (error) {
      throw widgetSettingsEvidenceError({ cause: error })
    }
  }
  return {
    channelId: record.channel_id,
    enabled: record.enabled,
    unknownFieldCount: countUnknownFields(record, WIDGET_SETTINGS_KEYS),
  }
}

function assertModifyGuildWidgetSettingsInput(
  value: unknown,
): asserts value is ModifyGuildWidgetSettingsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord widget-settings input must be an exact object")
  }
  const input = value as Record<string, unknown>
  if (
    !hasOnlyKeys(input, WIDGET_SETTINGS_INPUT_KEYS)
    || typeof input.enabled !== "boolean"
    || !(input.channelId === null || typeof input.channelId === "string")
  ) {
    throw new RangeError("Discord widget-settings input is invalid")
  }
  if (typeof input.channelId === "string") {
    assertPositiveSnowflake(input.channelId, "Discord widget channel ID")
  }
}

function assertModifyGuildSettingsInput(
  value: unknown,
): asserts value is ModifyGuildSettingsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord guild-settings input must be an exact object")
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length < 1 || !hasOnlyKeys(input, GUILD_SETTINGS_INPUT_KEYS)) {
    throw new RangeError("Discord guild-settings input must contain supported fields only")
  }
  for (const key of ["afkChannelId", "systemChannelId"] as const) {
    if (!Object.hasOwn(input, key)) continue
    if (!(input[key] === null || typeof input[key] === "string")) {
      throw new RangeError(`Discord guild-settings ${key} is invalid`)
    }
    if (typeof input[key] === "string") {
      assertPositiveSnowflake(input[key], `Discord guild-settings ${key}`)
    }
  }
  if (
    Object.hasOwn(input, "afkTimeoutSeconds")
    && !GUILD_AFK_TIMEOUT_SECONDS.includes(input.afkTimeoutSeconds as never)
  ) {
    throw new RangeError("Discord guild-settings AFK timeout is invalid")
  }
  if (
    Object.hasOwn(input, "defaultMessageNotifications")
    && ![0, 1].includes(input.defaultMessageNotifications as number)
  ) {
    throw new RangeError("Discord guild-settings notification default is invalid")
  }
  if (
    Object.hasOwn(input, "explicitContentFilter")
    && ![0, 1, 2].includes(input.explicitContentFilter as number)
  ) {
    throw new RangeError("Discord guild-settings content filter is invalid")
  }
  if (
    Object.hasOwn(input, "premiumProgressBarEnabled")
    && typeof input.premiumProgressBarEnabled !== "boolean"
  ) {
    throw new RangeError("Discord guild-settings premium progress bar value is invalid")
  }
  if (
    Object.hasOwn(input, "suppressedSystemNotifications")
    && (
      !Number.isSafeInteger(input.suppressedSystemNotifications)
      || (input.suppressedSystemNotifications as number) < 0
      || (input.suppressedSystemNotifications as number)
        > GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK
    )
  ) {
    throw new RangeError("Discord guild-settings system notification mask is invalid")
  }
  if (
    Object.hasOwn(input, "verificationLevel")
    && ![0, 1, 2, 3, 4].includes(input.verificationLevel as number)
  ) {
    throw new RangeError("Discord guild-settings verification level is invalid")
  }
}

function guildSettingsBody(input: ModifyGuildSettingsInput): Record<string, unknown> {
  return {
    ...(Object.hasOwn(input, "afkChannelId")
      ? { afk_channel_id: input.afkChannelId }
      : {}),
    ...(Object.hasOwn(input, "afkTimeoutSeconds")
      ? { afk_timeout: input.afkTimeoutSeconds }
      : {}),
    ...(Object.hasOwn(input, "defaultMessageNotifications")
      ? { default_message_notifications: input.defaultMessageNotifications }
      : {}),
    ...(Object.hasOwn(input, "explicitContentFilter")
      ? { explicit_content_filter: input.explicitContentFilter }
      : {}),
    ...(Object.hasOwn(input, "premiumProgressBarEnabled")
      ? { premium_progress_bar_enabled: input.premiumProgressBarEnabled }
      : {}),
    ...(Object.hasOwn(input, "suppressedSystemNotifications")
      ? { system_channel_flags: input.suppressedSystemNotifications }
      : {}),
    ...(Object.hasOwn(input, "systemChannelId")
      ? { system_channel_id: input.systemChannelId }
      : {}),
    ...(Object.hasOwn(input, "verificationLevel")
      ? { verification_level: input.verificationLevel }
      : {}),
  }
}

function assertModifyGuildProfileInput(
  value: unknown,
): asserts value is ModifyGuildProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord guild profile input must be an exact object")
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length < 1 || !hasOnlyKeys(input, GUILD_PROFILE_INPUT_KEYS)) {
    throw new RangeError("Discord guild profile input must contain supported fields only")
  }
  if (Object.hasOwn(input, "name")) {
    normalizeDesiredGuildProfileName(input.name)
  }
  if (Object.hasOwn(input, "description")) {
    normalizeDesiredGuildProfileDescription(input.description)
  }
}

function guildProfileBody(input: ModifyGuildProfileInput): Record<string, unknown> {
  return {
    ...(Object.hasOwn(input, "description")
      ? { description: input.description }
      : {}),
    ...(Object.hasOwn(input, "name") ? { name: input.name } : {}),
  }
}

function welcomeScreenEvidenceError(options?: ErrorOptions): WelcomeScreenEvidenceError {
  return new WelcomeScreenEvidenceError(
    "Discord returned invalid Welcome Screen evidence",
    options,
  )
}

function welcomeScreenReturnedText(
  value: unknown,
  maximum: number,
  nullable: boolean,
  allowEmpty: boolean,
): string | null {
  if (value === null && nullable) return null
  if (
    typeof value !== "string"
    || (!allowEmpty && [...value].length < 1)
    || [...value].length > maximum
    || WELCOME_SCREEN_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw welcomeScreenEvidenceError()
  }
  try {
    assertValidUnicode(value, "Discord Welcome Screen text")
  } catch (error) {
    throw welcomeScreenEvidenceError({ cause: error })
  }
  return value
}

function projectGuildWelcomeScreen(value: unknown): DiscordGuildWelcomeScreen {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw welcomeScreenEvidenceError()
  }
  const record = value as Record<string, unknown>
  if (
    !(record.description === null || typeof record.description === "string")
    || !Array.isArray(record.welcome_channels)
    || record.welcome_channels.length > WELCOME_SCREEN_LIMITS.channels
  ) {
    throw welcomeScreenEvidenceError()
  }
  const channelIds = new Set<string>()
  const welcomeChannels = record.welcome_channels.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw welcomeScreenEvidenceError()
    }
    const channel = value as Record<string, unknown>
    if (
      typeof channel.channel_id !== "string"
      || typeof channel.description !== "string"
      || !(channel.emoji_id === null || typeof channel.emoji_id === "string")
      || !(channel.emoji_name === null || typeof channel.emoji_name === "string")
      || (channel.emoji_id !== null && channel.emoji_name === null)
    ) {
      throw welcomeScreenEvidenceError()
    }
    try {
      assertPositiveSnowflake(channel.channel_id, "Discord Welcome Screen channel ID")
      if (channelIds.has(channel.channel_id)) {
        throw new RangeError("Discord Welcome Screen channel IDs must be unique")
      }
      channelIds.add(channel.channel_id)
      if (typeof channel.emoji_id === "string") {
        assertPositiveSnowflake(channel.emoji_id, "Discord Welcome Screen emoji ID")
      }
      if (typeof channel.emoji_name === "string") {
        welcomeScreenReturnedText(
          channel.emoji_name,
          CONNECTOR_LIMITS.interactionEmojiCharacters,
          false,
          false,
        )
      }
    } catch (error) {
      if (error instanceof WelcomeScreenEvidenceError) throw error
      throw welcomeScreenEvidenceError({ cause: error })
    }
    return {
      channelId: channel.channel_id,
      description: welcomeScreenReturnedText(
        channel.description,
        WELCOME_SCREEN_LIMITS.channelDescriptionCharacters,
        false,
        false,
      ) as string,
      emojiId: channel.emoji_id,
      emojiName: channel.emoji_name,
      unknownFieldCount: countUnknownFields(
        channel,
        WELCOME_SCREEN_CHANNEL_KEYS,
      ),
    }
  })
  return {
    description: welcomeScreenReturnedText(
      record.description,
      WELCOME_SCREEN_LIMITS.descriptionCharacters,
      true,
      true,
    ),
    unknownFieldCount: countUnknownFields(record, WELCOME_SCREEN_KEYS),
    welcomeChannels,
  }
}

function assertWelcomeScreenInputText(
  value: unknown,
  maximum: number,
  name: string,
  nullable: boolean,
): asserts value is string | null {
  if (value === null && nullable) return
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > maximum
    || value.trim() !== value
    || value.normalize("NFC") !== value
    || WELCOME_SCREEN_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(`${name} is invalid`)
  }
  assertValidUnicode(value, name)
}

function assertModifyGuildWelcomeScreenInput(
  value: unknown,
): asserts value is ModifyGuildWelcomeScreenInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord Welcome Screen input must be an exact object")
  }
  const input = value as Record<string, unknown>
  if (
    !hasOnlyKeys(input, WELCOME_SCREEN_INPUT_KEYS)
    || typeof input.enabled !== "boolean"
    || !Array.isArray(input.welcomeChannels)
    || input.welcomeChannels.length > WELCOME_SCREEN_LIMITS.channels
  ) {
    throw new RangeError("Discord Welcome Screen input is invalid")
  }
  assertWelcomeScreenInputText(
    input.description,
    WELCOME_SCREEN_LIMITS.descriptionCharacters,
    "Discord Welcome Screen description",
    true,
  )
  const channelIds = new Set<string>()
  for (const value of input.welcomeChannels) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RangeError("Discord Welcome Screen channel input must be an exact object")
    }
    const channel = value as Record<string, unknown>
    if (
      !hasOnlyKeys(channel, WELCOME_SCREEN_CHANNEL_INPUT_KEYS)
      || typeof channel.channelId !== "string"
      || !(channel.emojiId === null || typeof channel.emojiId === "string")
      || !(channel.emojiName === null || typeof channel.emojiName === "string")
      || (channel.emojiId !== null && channel.emojiName === null)
    ) {
      throw new RangeError("Discord Welcome Screen channel input is invalid")
    }
    assertPositiveSnowflake(channel.channelId, "Discord Welcome Screen channel ID")
    if (channelIds.has(channel.channelId)) {
      throw new RangeError("Discord Welcome Screen channel IDs must be unique")
    }
    channelIds.add(channel.channelId)
    assertWelcomeScreenInputText(
      channel.description,
      WELCOME_SCREEN_LIMITS.channelDescriptionCharacters,
      "Discord Welcome Screen channel description",
      false,
    )
    if (typeof channel.emojiId === "string") {
      assertPositiveSnowflake(channel.emojiId, "Discord Welcome Screen emoji ID")
    }
    if (typeof channel.emojiName === "string") {
      assertWelcomeScreenInputText(
        channel.emojiName,
        CONNECTOR_LIMITS.interactionEmojiCharacters,
        "Discord Welcome Screen emoji name",
        false,
      )
    }
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
  let sourceChannelId: string | null = null
  let sourceGuildId: string | null = null
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
    if (record.type === 2) {
      const sourceChannel = record.source_channel
      const sourceGuild = record.source_guild
      const sourceUnavailable = sourceChannel === undefined && sourceGuild === undefined
      if (!sourceUnavailable) {
        if (
          !sourceChannel
          || typeof sourceChannel !== "object"
          || Array.isArray(sourceChannel)
          || typeof (sourceChannel as Record<string, unknown>).id !== "string"
          || !sourceGuild
          || typeof sourceGuild !== "object"
          || Array.isArray(sourceGuild)
          || typeof (sourceGuild as Record<string, unknown>).id !== "string"
        ) {
          throw new RangeError("Discord Channel Follower source identity is invalid")
        }
        sourceChannelId = (sourceChannel as Record<string, unknown>).id as string
        sourceGuildId = (sourceGuild as Record<string, unknown>).id as string
        assertPositiveSnowflake(
          sourceChannelId,
          "Discord Channel Follower source channel ID",
        )
        assertPositiveSnowflake(
          sourceGuildId,
          "Discord Channel Follower source guild ID",
        )
      }
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
    sourceChannelId,
    sourceGuildId,
    type: record.type as number,
  }
}

function projectFollowedChannel(
  value: unknown,
  sourceChannelId: string,
): DiscordFollowedChannel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebhookEvidenceError("Discord returned an invalid followed-channel object")
  }
  const record = value as Record<string, unknown>
  if (
    !hasOnlyKeys(record, ["channel_id", "webhook_id"])
    || typeof record.channel_id !== "string"
    || typeof record.webhook_id !== "string"
  ) {
    throw new WebhookEvidenceError("Discord returned an invalid followed-channel object")
  }
  try {
    assertPositiveSnowflake(record.channel_id, "Discord followed source channel ID")
    assertPositiveSnowflake(record.webhook_id, "Discord followed target webhook ID")
  } catch (error) {
    throw new WebhookEvidenceError("Discord returned an invalid followed-channel object", {
      cause: error,
    })
  }
  if (record.channel_id !== sourceChannelId) {
    throw new WebhookEvidenceError(
      "Discord returned a followed-channel object for another source channel",
    )
  }
  return {
    sourceChannelId: record.channel_id,
    webhookId: record.webhook_id,
  }
}

function assertWebhookNameInput(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > DISCORD_LIMITS.webhookNameCharacters
    || value !== value.trim()
    || WEBHOOK_REPEATED_WHITESPACE_PATTERN.test(value)
    || WEBHOOK_NAME_CONTROL_PATTERN.test(value)
    || WEBHOOK_FORBIDDEN_NAME_PATTERN.test(value)
  ) {
    throw new RangeError("Discord webhook name is invalid")
  }
  assertValidUnicode(value, "Discord webhook name")
}

function projectCreatedWebhook(
  value: unknown,
  channelId: string,
): { token: string; webhook: DiscordWebhookSummary } {
  const projected = projectWebhook(value)
  const record = value as Record<string, unknown>
  if (
    projected.type !== 1
    || projected.channelId !== channelId
    || projected.guildId === null
    || typeof record.token !== "string"
    || record.token.length < 1
    || record.token.length > DISCORD_LIMITS.webhookTokenCharacters
    || /\s|[\u0000-\u001F\u007F]/u.test(record.token)
  ) {
    throw new WebhookEvidenceError(
      "Discord returned an invalid Incoming webhook creation result",
    )
  }
  return {
    token: record.token as string,
    webhook: projected,
  }
}

function webhookTokenRoute(webhookId: string, token: string): string {
  assertPositiveSnowflake(webhookId, "Discord webhook ID")
  if (
    typeof token !== "string"
    || token.length < 1
    || token.length > DISCORD_LIMITS.webhookTokenCharacters
    || /\s|[\u0000-\u001F\u007F]/u.test(token)
  ) {
    throw new RangeError("Discord webhook credential is invalid")
  }
  try {
    return `/webhooks/${webhookId}/${encodeURIComponent(token)}`
  } catch (error) {
    throw new RangeError("Discord webhook credential is invalid", { cause: error })
  }
}

const GUILD_INTEGRATION_KEYS = [
  "account",
  "application",
  "enable_emoticons",
  "enabled",
  "expire_behavior",
  "expire_grace_period",
  "id",
  "name",
  "revoked",
  "role_id",
  "scopes",
  "subscriber_count",
  "synced_at",
  "syncing",
  "type",
  "user",
] as const
const GUILD_INTEGRATION_ACCOUNT_KEYS = ["id", "name"] as const
const GUILD_INTEGRATION_APPLICATION_KEYS = [
  "bot",
  "description",
  "icon",
  "id",
  "name",
] as const
const GUILD_INTEGRATION_USER_KEYS = [
  "accent_color",
  "avatar",
  "avatar_decoration_data",
  "banner",
  "bot",
  "collectibles",
  "discriminator",
  "email",
  "flags",
  "global_name",
  "id",
  "locale",
  "mfa_enabled",
  "premium_type",
  "primary_guild",
  "public_flags",
  "system",
  "username",
  "verified",
] as const
const GUILD_INTEGRATION_TYPES: ReadonlySet<string> = new Set([
  "discord",
  "guild_subscription",
  "twitch",
  "youtube",
])
const KNOWN_DISCORD_OAUTH_SCOPES: ReadonlySet<string> = new Set([
  "activities.read",
  "activities.write",
  "applications.builds.read",
  "applications.builds.upload",
  "applications.commands",
  "applications.commands.permissions.update",
  "applications.commands.update",
  "applications.entitlements",
  "applications.store.update",
  "bot",
  "connections",
  "dm_channels.read",
  "email",
  "gdm.join",
  "guilds",
  "guilds.join",
  "guilds.members.read",
  "identify",
  "identify.premium",
  "messages.read",
  "openid",
  "relationships.read",
  "role_connections.write",
  "rpc",
  "rpc.activities.write",
  "rpc.notifications.read",
  "rpc.voice.read",
  "rpc.voice.write",
  "sdk.social_layer",
  "sdk.social_layer_presence",
  "voice",
  "webhook.incoming",
])
const INTEGRATION_TEXT_MAX_CHARACTERS = 4_096
const INTEGRATION_SCOPE_MAX_CHARACTERS = 128
const INTEGRATION_TYPE_MAX_CHARACTERS = 128
const INTEGRATION_SCOPE_PATTERN = /^[a-z0-9._:-]+$/

function integrationEvidenceError(cause?: unknown): IntegrationEvidenceError {
  return new IntegrationEvidenceError(
    "Discord returned invalid guild integration evidence",
    cause === undefined ? undefined : { cause },
  )
}

function integrationRecord(value: unknown): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length > CONNECTOR_LIMITS.integrationObjectFields
  ) {
    throw integrationEvidenceError()
  }
  return value as Record<string, unknown>
}

function integrationProfileContainerFieldCount(value: unknown): number {
  if (value === undefined || value === null) return 0
  return Object.keys(integrationRecord(value)).length
}

function validateIntegrationText(
  value: unknown,
  nullable = false,
  maximum = INTEGRATION_TEXT_MAX_CHARACTERS,
): void {
  if (value === null && nullable) return
  if (
    typeof value !== "string"
    || [...value].length > maximum
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw integrationEvidenceError()
  }
  try {
    assertValidUnicode(value, "Discord integration text")
  } catch (error) {
    throw integrationEvidenceError(error)
  }
}

function integrationIdentity(
  value: unknown,
  requireBot = false,
): { id: string; unknownFieldCount: number } {
  const record = integrationRecord(value)
  if (typeof record.id !== "string") throw integrationEvidenceError()
  try {
    assertPositiveSnowflake(record.id, "Discord integration user ID")
  } catch (error) {
    throw integrationEvidenceError(error)
  }
  for (const key of [
    "avatar",
    "banner",
    "discriminator",
    "email",
    "global_name",
    "locale",
    "username",
  ]) {
    if (record[key] !== undefined) validateIntegrationText(record[key], true)
  }
  for (const key of ["bot", "mfa_enabled", "system", "verified"]) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") {
      throw integrationEvidenceError()
    }
  }
  if (requireBot && record.bot !== true) throw integrationEvidenceError()
  for (const key of ["accent_color", "flags", "premium_type", "public_flags"]) {
    if (
      record[key] !== undefined
      && !(key === "accent_color" && record[key] === null)
      && (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0)
    ) {
      throw integrationEvidenceError()
    }
  }
  const nestedProfileFieldCount = [
    "avatar_decoration_data",
    "collectibles",
    "primary_guild",
  ].reduce(
    (total, key) => total + integrationProfileContainerFieldCount(record[key]),
    0,
  )
  return {
    id: record.id,
    unknownFieldCount:
      countUnknownFields(record, GUILD_INTEGRATION_USER_KEYS)
      + nestedProfileFieldCount,
  }
}

function optionalIntegrationBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "boolean") throw integrationEvidenceError()
  return value
}

function optionalIntegrationCount(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw integrationEvidenceError()
  }
  return value as number
}

function optionalIntegrationTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "string"
    || value.length > 64
    || !ISO_8601_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw integrationEvidenceError()
  }
  return new Date(value).toISOString()
}

function projectGuildIntegration(value: unknown): DiscordGuildIntegrationSummary {
  const record = integrationRecord(value)
  const account = integrationRecord(record.account)
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || typeof record.type !== "string"
    || typeof record.enabled !== "boolean"
    || typeof account.id !== "string"
    || typeof account.name !== "string"
  ) {
    throw integrationEvidenceError()
  }
  try {
    assertPositiveSnowflake(record.id, "Discord integration ID")
    validateIntegrationText(record.name)
    if (record.type.length < 1) throw integrationEvidenceError()
    validateIntegrationText(record.type, false, INTEGRATION_TYPE_MAX_CHARACTERS)
    validateIntegrationText(account.id)
    validateIntegrationText(account.name)
  } catch (error) {
    if (error instanceof IntegrationEvidenceError) throw error
    throw integrationEvidenceError(error)
  }
  let roleId: string | null = null
  if (record.role_id !== undefined && record.role_id !== null) {
    if (typeof record.role_id !== "string") throw integrationEvidenceError()
    try {
      assertPositiveSnowflake(record.role_id, "Discord integration role ID")
    } catch (error) {
      throw integrationEvidenceError(error)
    }
    roleId = record.role_id
  }
  let linkedUserPresent = false
  let userUnknownFieldCount = 0
  if (record.user !== undefined && record.user !== null) {
    const user = integrationIdentity(record.user)
    linkedUserPresent = true
    userUnknownFieldCount = user.unknownFieldCount
  }
  let applicationId: string | null = null
  let associatedBotUserId: string | null = null
  let applicationUnknownFieldCount = 0
  let botUnknownFieldCount = 0
  if (record.application !== undefined && record.application !== null) {
    const application = integrationRecord(record.application)
    if (
      typeof application.id !== "string"
      || typeof application.name !== "string"
      || typeof application.description !== "string"
      || !(application.icon === null || typeof application.icon === "string")
    ) {
      throw integrationEvidenceError()
    }
    try {
      assertPositiveSnowflake(application.id, "Discord integration application ID")
      validateIntegrationText(application.name)
      validateIntegrationText(application.description)
      validateIntegrationText(application.icon, true)
    } catch (error) {
      throw integrationEvidenceError(error)
    }
    if (application.bot !== undefined && application.bot !== null) {
      const bot = integrationIdentity(application.bot, true)
      associatedBotUserId = bot.id
      botUnknownFieldCount = bot.unknownFieldCount
    }
    applicationId = application.id
    applicationUnknownFieldCount = countUnknownFields(
      application,
      GUILD_INTEGRATION_APPLICATION_KEYS,
    )
  }
  const rawScopes = record.scopes ?? []
  if (
    !Array.isArray(rawScopes)
    || rawScopes.length > CONNECTOR_LIMITS.integrationOauthScopes
  ) {
    throw integrationEvidenceError()
  }
  const scopes = new Set<string>()
  for (const value of rawScopes) {
    if (
      typeof value !== "string"
      || value.length < 1
      || value.length > INTEGRATION_SCOPE_MAX_CHARACTERS
      || !INTEGRATION_SCOPE_PATTERN.test(value)
      || scopes.has(value)
    ) {
      throw integrationEvidenceError()
    }
    scopes.add(value)
  }
  let expireBehavior: 0 | 1 | null = null
  if (record.expire_behavior !== undefined && record.expire_behavior !== null) {
    if (record.expire_behavior !== 0 && record.expire_behavior !== 1) {
      throw integrationEvidenceError()
    }
    expireBehavior = record.expire_behavior
  }
  const knownScopes = [...scopes]
    .filter((scope) => KNOWN_DISCORD_OAUTH_SCOPES.has(scope))
    .sort()
  const type = GUILD_INTEGRATION_TYPES.has(record.type)
    ? record.type as DiscordGuildIntegrationType
    : "unknown"
  return {
    accountPresent: true,
    applicationId,
    associatedBotUserId,
    enableEmoticons: optionalIntegrationBoolean(record.enable_emoticons),
    enabled: record.enabled,
    expireBehavior,
    expireGracePeriod: optionalIntegrationCount(record.expire_grace_period),
    id: record.id,
    knownScopes,
    linkedUserPresent,
    revoked: optionalIntegrationBoolean(record.revoked),
    roleId,
    subscriberCount: optionalIntegrationCount(record.subscriber_count),
    syncedAt: optionalIntegrationTimestamp(record.synced_at),
    syncing: optionalIntegrationBoolean(record.syncing),
    type,
    unknownFieldCounts: {
      account: countUnknownFields(account, GUILD_INTEGRATION_ACCOUNT_KEYS),
      application: applicationUnknownFieldCount,
      bot: botUnknownFieldCount,
      integration: countUnknownFields(record, GUILD_INTEGRATION_KEYS),
      user: userUnknownFieldCount,
    },
    unknownScopeCount: scopes.size - knownScopes.length,
  }
}

const GUILD_EMOJI_KEYS: ReadonlySet<string> = new Set([
  "animated",
  "available",
  "id",
  "managed",
  "name",
  "require_colons",
  "roles",
  "user",
])

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
    const unknownFieldCount = countUnknownFields(record, [...GUILD_EMOJI_KEYS])
    return {
      animated: record.animated === true,
      available: record.available !== false,
      creatorUserId,
      id: record.id,
      managed: record.managed === true,
      name: record.name,
      requiresColons: record.require_colons !== false,
      roleIds: [...roles as string[]],
      ...(unknownFieldCount > 0 ? { unknownFieldCount } : {}),
    }
  } catch (error) {
    if (error instanceof GuildExpressionEvidenceError) throw error
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji object", {
      cause: error,
    })
  }
}

function applicationEmojiEvidenceError(
  options?: ErrorOptions,
): ApplicationEmojiEvidenceError {
  return new ApplicationEmojiEvidenceError(
    "Discord returned invalid application emoji evidence",
    options,
  )
}

function projectApplicationEmoji(value: unknown): DiscordApplicationEmojiSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw applicationEmojiEvidenceError()
  }
  const record = value as Record<string, unknown>
  const roles = record.roles
  const user = record.user
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || !Array.isArray(roles)
    || roles.length !== 0
    || !user
    || typeof user !== "object"
    || Array.isArray(user)
    || typeof (user as Record<string, unknown>).id !== "string"
    || !(record.animated === undefined || typeof record.animated === "boolean")
    || !(record.available === undefined || typeof record.available === "boolean")
    || !(record.managed === undefined || typeof record.managed === "boolean")
    || !(record.require_colons === undefined || typeof record.require_colons === "boolean")
  ) {
    throw applicationEmojiEvidenceError()
  }
  try {
    assertPositiveSnowflake(record.id, "Discord application emoji ID")
    assertPositiveSnowflake(
      (user as Record<string, unknown>).id as string,
      "Discord application emoji uploader ID",
    )
    assertGuildExpressionName(record.name, "emoji")
  } catch (error) {
    if (error instanceof ApplicationEmojiEvidenceError) throw error
    throw applicationEmojiEvidenceError({ cause: error })
  }
  return {
    animated: record.animated === true,
    available: record.available !== false,
    id: record.id,
    managed: record.managed === true,
    name: record.name,
    requiresColons: record.require_colons !== false,
    unknownFieldCount: countUnknownFields(record, APPLICATION_EMOJI_KEYS),
    uploaderProjectedOut: true,
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

function soundboardEvidenceError(
  message = "Discord returned an invalid soundboard sound",
  cause?: unknown,
): SoundboardEvidenceError {
  return new SoundboardEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function assertSoundboardName(
  value: unknown,
  description: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || [...value].length < DISCORD_LIMITS.soundboardNameMinimumCharacters
    || [...value].length > DISCORD_LIMITS.soundboardNameCharacters
    || value.trim() !== value
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${description} must contain ${DISCORD_LIMITS.soundboardNameMinimumCharacters}-${DISCORD_LIMITS.soundboardNameCharacters} trimmed characters without unsupported controls`,
    )
  }
  assertValidUnicode(value, description)
}

function assertSoundboardEmojiName(
  value: unknown,
  description: string,
): asserts value is string | null {
  if (value === null) return
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(`${description} is invalid`)
  }
  assertValidUnicode(value, description)
}

function projectSoundboardSound(
  value: unknown,
  expectedGuildId: string | null,
): DiscordSoundboardSoundSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw soundboardEvidenceError()
  }
  const record = value as Record<string, unknown>
  const user = record.user
  try {
    assertPositiveSnowflake(record.sound_id as string, "Discord soundboard sound ID")
    assertSoundboardName(record.name, "Discord soundboard sound name")
    if (
      typeof record.volume !== "number"
      || !Number.isFinite(record.volume)
      || record.volume < 0
      || record.volume > 1
      || typeof record.available !== "boolean"
      || !(record.emoji_id === null || typeof record.emoji_id === "string")
      || !(record.guild_id === undefined || typeof record.guild_id === "string")
      || !(user === undefined || (
        user !== null
        && typeof user === "object"
        && !Array.isArray(user)
        && typeof (user as Record<string, unknown>).id === "string"
      ))
    ) {
      throw new RangeError("Discord soundboard sound fields are invalid")
    }
    assertSoundboardEmojiName(record.emoji_name, "Discord soundboard Unicode emoji")
    if (typeof record.emoji_id === "string") {
      assertPositiveSnowflake(record.emoji_id, "Discord soundboard custom emoji ID")
    }
    if (record.emoji_id !== null && record.emoji_name !== null) {
      throw new RangeError("Discord soundboard sound has conflicting emoji fields")
    }
    if (expectedGuildId === null) {
      if (record.guild_id !== undefined) {
        throw new RangeError("Discord default sound unexpectedly names a guild")
      }
    } else {
      assertPositiveSnowflake(expectedGuildId, "Discord soundboard guild ID")
      if (typeof record.guild_id === "string") {
        assertPositiveSnowflake(record.guild_id, "Discord soundboard response guild ID")
        if (record.guild_id !== expectedGuildId) {
          throw new RangeError("Discord returned a soundboard sound for another guild")
        }
      }
    }
    const creatorUserId = expectedGuildId !== null && user !== undefined
      ? (user as Record<string, unknown>).id as string
      : null
    if (creatorUserId !== null) {
      assertPositiveSnowflake(creatorUserId, "Discord soundboard sound creator ID")
    }
    return {
      available: record.available,
      creatorUserId,
      emojiId: record.emoji_id,
      emojiName: record.emoji_name,
      guildId: expectedGuildId,
      id: record.sound_id as string,
      name: record.name,
      unknownFieldCount: Object.keys(record)
        .filter((key) => !SOUNDBOARD_SOUND_RESPONSE_KEYS.has(key)).length,
      volume: record.volume,
    }
  } catch (error) {
    if (error instanceof SoundboardEvidenceError) throw error
    throw soundboardEvidenceError(undefined, error)
  }
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key))
}

function stageInstanceEvidenceError(
  message = "Discord returned an invalid Stage instance",
  cause?: unknown,
): StageInstanceEvidenceError {
  return new StageInstanceEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function assertStageTopic(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > DISCORD_LIMITS.stageTopicCharacters
    || !value.trim()
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${description} must contain 1-${DISCORD_LIMITS.stageTopicCharacters} nonblank characters without unsupported controls`,
    )
  }
  assertValidUnicode(value, description)
}

function projectStageInstance(value: unknown): DiscordStageInstanceSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw stageInstanceEvidenceError()
  }
  const record = value as Record<string, unknown>
  try {
    assertPositiveSnowflake(record.id as string, "Discord Stage-instance ID")
    assertPositiveSnowflake(record.guild_id as string, "Discord Stage-instance guild ID")
    assertPositiveSnowflake(record.channel_id as string, "Discord Stage-instance channel ID")
    assertStageTopic(record.topic, "Discord Stage-instance topic")
    if (
      record.privacy_level !== DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.public
      && record.privacy_level !== DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.guildOnly
    ) {
      throw new RangeError("Discord Stage-instance privacy level is unsupported")
    }
    if (typeof record.discoverable_disabled !== "boolean") {
      throw new RangeError("Discord Stage-instance discoverability field is invalid")
    }
    if (
      record.guild_scheduled_event_id !== undefined
      && record.guild_scheduled_event_id !== null
    ) {
      assertPositiveSnowflake(
        record.guild_scheduled_event_id as string,
        "Discord Stage-instance scheduled event ID",
      )
    }
  } catch (error) {
    if (error instanceof StageInstanceEvidenceError) throw error
    throw stageInstanceEvidenceError(undefined, error)
  }
  return {
    channelId: record.channel_id as string,
    discoverableDisabled: record.discoverable_disabled as boolean,
    guildId: record.guild_id as string,
    id: record.id as string,
    privacyLevel: record.privacy_level as 1 | 2,
    scheduledEventId: typeof record.guild_scheduled_event_id === "string"
      ? record.guild_scheduled_event_id
      : null,
    topic: record.topic as string,
    unknownFieldCount: Object.keys(record)
      .filter((key) => !STAGE_INSTANCE_RESPONSE_KEYS.has(key)).length,
  }
}

function assertCreateStageInstanceInput(
  input: CreateStageInstanceInput,
): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || !hasOnlyKeys(input as unknown as Record<string, unknown>, [
      "channelId",
      "sendStartNotification",
      "topic",
    ])
  ) {
    throw new RangeError("Discord Stage-instance creation input is invalid")
  }
  assertPositiveSnowflake(input.channelId, "Discord Stage-instance channel ID")
  assertStageTopic(input.topic, "Discord Stage-instance topic")
  if (typeof input.sendStartNotification !== "boolean") {
    throw new RangeError("Discord Stage start notification setting must be a boolean")
  }
}

function assertModifyStageInstanceInput(
  input: ModifyStageInstanceInput,
): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || Object.keys(input).join("\0") !== "topic"
  ) {
    throw new RangeError("Discord Stage-instance update input is invalid")
  }
  assertStageTopic(input.topic, "Discord Stage-instance topic")
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

const AUTO_MODERATION_RULE_KEYS: ReadonlySet<string> = new Set([
  "actions",
  "creator_id",
  "enabled",
  "event_type",
  "exempt_channels",
  "exempt_roles",
  "guild_id",
  "id",
  "name",
  "trigger_metadata",
  "trigger_type",
])

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
    const unknownFieldCount = countUnknownFields(record, [...AUTO_MODERATION_RULE_KEYS])
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
      ...(unknownFieldCount > 0 ? { unknownFieldCount } : {}),
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

function projectGuildScheduledEventUser(
  value: unknown,
  eventId: string,
): DiscordScheduledEventUserSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event user object",
    )
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== "guild_scheduled_event_id\0user"
    || record.guild_scheduled_event_id !== eventId
    || !record.user
    || typeof record.user !== "object"
    || Array.isArray(record.user)
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned invalid or expanded scheduled event user evidence",
    )
  }
  const user = record.user as Record<string, unknown>
  try {
    assertPositiveSnowflake(user.id as string, "Discord scheduled event user ID")
  } catch (error) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event user identity",
      { cause: error },
    )
  }
  if (user.bot !== undefined && typeof user.bot !== "boolean") {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event user bot flag",
    )
  }
  return {
    bot: user.bot ?? false,
    eventId,
    userId: user.id as string,
  }
}

function channelMetadataEvidenceError(options?: ErrorOptions): ChannelMetadataEvidenceError {
  return new ChannelMetadataEvidenceError(
    "Discord returned invalid guild channel metadata evidence",
    options,
  )
}

const VOICE_REGION_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "custom",
  "deprecated",
  "id",
  "name",
  "optimal",
])

function voiceRegionEvidenceError(options?: ErrorOptions): VoiceRegionEvidenceError {
  return new VoiceRegionEvidenceError(
    "Discord returned invalid voice-region evidence",
    options,
  )
}

function projectVoiceRegions(value: unknown): DiscordVoiceRegion[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.voiceRegions) {
    throw voiceRegionEvidenceError()
  }
  const seen = new Set<string>()
  const regions = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw voiceRegionEvidenceError()
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== "string"
      || record.id.length < 1
      || record.id.length > DISCORD_LIMITS.voiceRegionIdCharacters
      || record.id.trim() !== record.id
      || CHANNEL_NAME_CONTROL_PATTERN.test(record.id)
      || typeof record.name !== "string"
      || record.name.length < 1
      || record.name.length > DISCORD_LIMITS.voiceRegionNameCharacters
      || record.name.trim() !== record.name
      || CHANNEL_NAME_CONTROL_PATTERN.test(record.name)
      || typeof record.optimal !== "boolean"
      || typeof record.deprecated !== "boolean"
      || typeof record.custom !== "boolean"
      || seen.has(record.id)
    ) throw voiceRegionEvidenceError()
    try {
      assertValidUnicode(record.id, "Discord voice region ID")
      assertValidUnicode(record.name, "Discord voice region name")
    } catch (error) {
      throw voiceRegionEvidenceError({ cause: error })
    }
    seen.add(record.id)
    return {
      custom: record.custom,
      deprecated: record.deprecated,
      id: record.id,
      name: record.name,
      optimal: record.optimal,
      unknownFieldCount: Object.keys(record)
        .filter((key) => !VOICE_REGION_RESPONSE_KEYS.has(key)).length,
    }
  })
  return regions.sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))
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
  const voiceLike = CHANNEL_METADATA_VOICE_TYPES.has(type)
  const rawBitrate = voiceLike
    ? returnedChannelMetadataInteger(
        record.bitrate,
        -1,
        DISCORD_LIMITS.channelBitrateMinimum,
        type === DISCORD_CHANNEL_TYPES.stageVoice
          ? DISCORD_LIMITS.stageChannelBitrateMaximum
          : DISCORD_LIMITS.voiceChannelBitrateMaximum,
      )
    : null
  const rawUserLimit = voiceLike
    ? returnedChannelMetadataInteger(
        record.user_limit,
        0,
        0,
        type === DISCORD_CHANNEL_TYPES.stageVoice
          ? DISCORD_LIMITS.stageChannelUserLimit
          : DISCORD_LIMITS.voiceChannelUserLimit,
      )
    : null
  const rawRtcRegion = voiceLike
    ? returnedChannelMetadataText(
        record.rtc_region,
        DISCORD_LIMITS.voiceRegionIdCharacters,
        "voice region",
        true,
      )
    : null
  const rawVideoQualityMode = voiceLike
    ? returnedChannelMetadataInteger(
        record.video_quality_mode,
        DISCORD_VIDEO_QUALITY_MODES.auto,
        DISCORD_VIDEO_QUALITY_MODES.auto,
        DISCORD_VIDEO_QUALITY_MODES.full,
      )
    : null
  if (
    typeof rawRtcRegion === "string"
    && (
      rawRtcRegion.length < 1
      || rawRtcRegion.trim() !== rawRtcRegion
      || CHANNEL_NAME_CONTROL_PATTERN.test(rawRtcRegion)
    )
  ) throw channelMetadataEvidenceError()
  if (
    (!CHANNEL_METADATA_TOPIC_TYPES.has(type) && rawTopic !== null)
    || (!CHANNEL_METADATA_NSFW_TYPES.has(type) && rawNsfw !== false)
    || (!CHANNEL_METADATA_RATE_LIMIT_TYPES.has(type) && rawRateLimit !== 0)
    || (!CHANNEL_METADATA_AUTO_ARCHIVE_TYPES.has(type) && rawAutoArchive !== null)
    || (!CHANNEL_METADATA_THREAD_RATE_TYPES.has(type) && rawThreadRateLimit !== 0)
    || (!voiceLike && record.bitrate !== undefined && record.bitrate !== null)
    || (!voiceLike && record.user_limit !== undefined && record.user_limit !== null
      && record.user_limit !== 0)
    || (!voiceLike && record.rtc_region !== undefined && record.rtc_region !== null)
    || (!voiceLike && record.video_quality_mode !== undefined
      && record.video_quality_mode !== null && record.video_quality_mode !== 0)
  ) {
    throw channelMetadataEvidenceError()
  }
  const projectedOverwrites = projectChannelMetadataOverwrites(record.permission_overwrites)
  return {
    bitrate: rawBitrate,
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
    rtcRegion: rawRtcRegion,
    topic: CHANNEL_METADATA_TOPIC_TYPES.has(type) ? rawTopic : null,
    type,
    unknownFieldCount: Object.keys(record)
      .filter((key) => !CHANNEL_METADATA_RESPONSE_KEYS.has(key)).length
      + projectedOverwrites.unknownFieldCount,
    userLimit: rawUserLimit,
    videoQualityMode: rawVideoQualityMode,
  }
}

function forumTagEvidenceError(options?: ErrorOptions): ForumTagEvidenceError {
  return new ForumTagEvidenceError(
    "Discord returned invalid forum-tag evidence",
    options,
  )
}

function assertForumTagName(
  value: unknown,
  description: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || [...value].length > DISCORD_LIMITS.forumTagNameCharacters
    || CHANNEL_NAME_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${description} must contain 0-${DISCORD_LIMITS.forumTagNameCharacters} characters without controls`,
    )
  }
  assertValidUnicode(value, description)
}

function assertForumTagEmojiName(
  value: unknown,
  description: string,
): asserts value is string | null {
  if (value === null) return
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || POLL_EMOJI_CONTROL_OR_SPACE_PATTERN.test(value)
  ) {
    throw new RangeError(`${description} is invalid`)
  }
  assertValidUnicode(value, description)
  const graphemes = [
    ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value),
  ]
  if (graphemes.length !== 1 || !POLL_EMOJI_CODE_POINT_PATTERN.test(value)) {
    throw new RangeError(`${description} must be one Unicode emoji grapheme`)
  }
}

function projectForumTag(value: unknown): DiscordForumTagSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw forumTagEvidenceError()
  }
  const record = value as Record<string, unknown>
  const emojiId = record.emoji_id ?? null
  const emojiName = record.emoji_name ?? null
  try {
    assertPositiveSnowflake(record.id as string, "Discord forum tag ID")
    assertForumTagName(record.name, "Discord forum tag name")
    if (typeof record.moderated !== "boolean") {
      throw new RangeError("Discord forum tag moderation state is invalid")
    }
    if (!(emojiId === null || typeof emojiId === "string")) {
      throw new RangeError("Discord forum tag custom emoji ID is invalid")
    }
    if (typeof emojiId === "string") {
      assertPositiveSnowflake(emojiId, "Discord forum tag custom emoji ID")
    }
    assertForumTagEmojiName(emojiName, "Discord forum tag Unicode emoji")
    if (emojiId !== null && emojiName !== null) {
      throw new RangeError("Discord forum tag emoji fields conflict")
    }
  } catch (error) {
    throw forumTagEvidenceError({ cause: error })
  }
  return {
    emojiId,
    emojiName,
    id: record.id as string,
    moderated: record.moderated as boolean,
    name: record.name as string,
    unknownFieldCount: countUnknownFields(record, FORUM_TAG_RESPONSE_KEYS),
  }
}

function projectGuildForumTagState(
  value: unknown,
  expectedChannelId: string,
): DiscordForumTagState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw forumTagEvidenceError()
  }
  const record = value as Record<string, unknown>
  try {
    assertPositiveSnowflake(record.id as string, "Discord forum channel ID")
    assertPositiveSnowflake(record.guild_id as string, "Discord forum guild ID")
    if (
      record.id !== expectedChannelId
      || record.type !== DISCORD_CHANNEL_TYPES.forum
      || !Array.isArray(record.available_tags)
      || record.available_tags.length > DISCORD_LIMITS.forumAvailableTags
    ) {
      throw new RangeError("Discord forum channel identity or tag inventory is invalid")
    }
    const flags = record.flags ?? 0
    if (!Number.isSafeInteger(flags) || (flags as number) < 0) {
      throw new RangeError("Discord forum channel flags are invalid")
    }
    const tags = record.available_tags.map(projectForumTag)
    if (new Set(tags.map((tag) => tag.id)).size !== tags.length) {
      throw new RangeError("Discord forum tag IDs must be unique")
    }
    const projectedOverwrites = projectChannelMetadataOverwrites(
      record.permission_overwrites,
    )
    return {
      flags: flags as number,
      guildId: record.guild_id as string,
      id: expectedChannelId,
      permissionOverwriteUnknownFieldCount: projectedOverwrites.unknownFieldCount,
      permissionOverwrites: projectedOverwrites.overwrites,
      tags,
      type: DISCORD_CHANNEL_TYPES.forum,
      unknownFieldCount: countUnknownFields(
        record,
        [...CHANNEL_METADATA_RESPONSE_KEYS],
      ),
    }
  } catch (error) {
    if (error instanceof ForumTagEvidenceError) throw error
    throw forumTagEvidenceError({ cause: error })
  }
}

function forumTagBody(tags: readonly ModifyForumTagInput[]): Record<string, unknown> {
  if (
    !Array.isArray(tags)
    || tags.length > DISCORD_LIMITS.forumAvailableTags
  ) {
    throw new RangeError("Discord forum tags must be a bounded array")
  }
  const ids = new Set<string>()
  let tagsWithoutIds = 0
  const availableTags = tags.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RangeError("Discord forum tag input must be an exact object")
    }
    const record = value as unknown as Record<string, unknown>
    if (
      !hasOnlyKeys(record, MODIFY_FORUM_TAG_KEYS)
      || !Object.hasOwn(record, "emojiId")
      || !Object.hasOwn(record, "emojiName")
      || !Object.hasOwn(record, "moderated")
      || !Object.hasOwn(record, "name")
      || typeof value.moderated !== "boolean"
      || !(value.emojiId === null || typeof value.emojiId === "string")
    ) {
      throw new RangeError("Discord forum tag input is invalid")
    }
    assertForumTagName(value.name, "Discord forum tag name")
    assertForumTagEmojiName(value.emojiName, "Discord forum tag Unicode emoji")
    if (value.id === undefined) {
      tagsWithoutIds += 1
    } else {
      assertPositiveSnowflake(value.id, "Discord forum tag ID")
      if (ids.has(value.id)) {
        throw new RangeError("Discord forum tag IDs must be unique")
      }
      ids.add(value.id)
    }
    if (typeof value.emojiId === "string") {
      assertPositiveSnowflake(value.emojiId, "Discord forum tag custom emoji ID")
    }
    if (value.emojiId !== null && value.emojiName !== null) {
      throw new RangeError("Discord forum tag emoji fields conflict")
    }
    return {
      ...(value.id === undefined ? {} : { id: value.id }),
      emoji_id: value.emojiId,
      emoji_name: value.emojiName,
      moderated: value.moderated,
      name: value.name,
    }
  })
  if (tagsWithoutIds > 1) {
    throw new RangeError("Discord forum tag input may create at most one tag")
  }
  return { available_tags: availableTags }
}

function threadGovernanceEvidenceError(options?: ErrorOptions): ThreadGovernanceEvidenceError {
  return new ThreadGovernanceEvidenceError(
    "Discord returned invalid thread-governance evidence",
    options,
  )
}

function projectThreadState(
  value: unknown,
  expectedThreadId: string,
): DiscordThreadStateSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw threadGovernanceEvidenceError()
  }
  const record = value as Record<string, unknown>
  const metadata = record.thread_metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw threadGovernanceEvidenceError()
  }
  const threadMetadata = metadata as Record<string, unknown>
  try {
    assertPositiveSnowflake(record.id as string, "Discord thread ID")
    assertPositiveSnowflake(record.guild_id as string, "Discord thread guild ID")
    assertPositiveSnowflake(record.parent_id as string, "Discord thread parent ID")
    assertPositiveSnowflake(record.owner_id as string, "Discord thread owner ID")
    if (record.id !== expectedThreadId) {
      throw new RangeError("Discord thread ID does not match the request")
    }
    if (
      record.type !== DISCORD_CHANNEL_TYPES.announcementThread
      && record.type !== DISCORD_CHANNEL_TYPES.publicThread
      && record.type !== DISCORD_CHANNEL_TYPES.privateThread
    ) {
      throw new RangeError("Discord channel is not a supported guild thread")
    }
    if (
      typeof record.name !== "string"
      || record.name.length < 1
      || record.name.length > DISCORD_LIMITS.channelNameCharacters
      || CHANNEL_NAME_CONTROL_PATTERN.test(record.name)
    ) {
      throw new RangeError("Discord thread name is invalid")
    }
    assertValidUnicode(record.name, "Discord thread name")
    if (
      typeof threadMetadata.archived !== "boolean"
      || typeof threadMetadata.locked !== "boolean"
      || !Number.isSafeInteger(threadMetadata.auto_archive_duration)
      || !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
        .includes(threadMetadata.auto_archive_duration as number)
    ) {
      throw new RangeError("Discord thread lifecycle state is invalid")
    }
    if (typeof threadMetadata.archive_timestamp !== "string") {
      throw new RangeError("Discord thread archive timestamp is missing")
    }
    assertIsoTimestamp(
      threadMetadata.archive_timestamp,
      "Discord thread archive timestamp",
    )
    if (threadMetadata.create_timestamp !== undefined && threadMetadata.create_timestamp !== null) {
      assertIsoTimestamp(
        threadMetadata.create_timestamp as string,
        "Discord thread creation timestamp",
      )
    }
    const privateThread = record.type === DISCORD_CHANNEL_TYPES.privateThread
    if (
      (privateThread && typeof threadMetadata.invitable !== "boolean")
      || (!privateThread && threadMetadata.invitable !== undefined)
    ) {
      throw new RangeError("Discord thread invitation state is invalid")
    }
  } catch (error) {
    throw threadGovernanceEvidenceError({ cause: error })
  }
  const rateLimitPerUser = record.rate_limit_per_user ?? 0
  if (
    typeof rateLimitPerUser !== "number"
    || !Number.isSafeInteger(rateLimitPerUser)
    || rateLimitPerUser < 0
    || rateLimitPerUser > DISCORD_LIMITS.channelRateLimitSeconds
  ) {
    throw threadGovernanceEvidenceError()
  }
  return {
    archived: threadMetadata.archived as boolean,
    autoArchiveDuration: threadMetadata.auto_archive_duration as number,
    guildId: record.guild_id as string,
    id: expectedThreadId,
    invitable: record.type === DISCORD_CHANNEL_TYPES.privateThread
      ? threadMetadata.invitable as boolean
      : null,
    locked: threadMetadata.locked as boolean,
    name: record.name as string,
    ownerId: record.owner_id as string,
    parentId: record.parent_id as string,
    rateLimitPerUser,
    type: record.type as number,
    unknownFieldCount: countUnknownFields(record, THREAD_STATE_RESPONSE_KEYS),
    unknownMetadataFieldCount: countUnknownFields(
      threadMetadata,
      THREAD_METADATA_RESPONSE_KEYS,
    ),
  }
}

function projectExactThreadMember(
  value: unknown,
  threadId: string,
  userId: string,
): DiscordThreadMember {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw threadGovernanceEvidenceError()
  }
  const record = value as Record<string, unknown>
  try {
    assertPositiveSnowflake(record.id as string, "Discord thread-member thread ID")
    assertPositiveSnowflake(record.user_id as string, "Discord thread-member user ID")
    if (record.id !== threadId || record.user_id !== userId) {
      throw new RangeError("Discord thread-member identity does not match the request")
    }
    if (typeof record.join_timestamp !== "string") {
      throw new RangeError("Discord thread-member join timestamp is missing")
    }
    assertIsoTimestamp(
      record.join_timestamp,
      "Discord thread-member join timestamp",
    )
    if (
      typeof record.flags !== "number"
      || !Number.isSafeInteger(record.flags)
      || record.flags < 0
      || record.member !== undefined
    ) {
      throw new RangeError("Discord thread-member state is invalid")
    }
  } catch (error) {
    throw threadGovernanceEvidenceError({ cause: error })
  }
  return {
    flags: record.flags as number,
    id: threadId,
    join_timestamp: record.join_timestamp as string,
    unknown_field_count: countUnknownFields(
      record,
      ["flags", "id", "join_timestamp", "member", "user_id"],
    ),
    user_id: userId,
  }
}

function threadStateBody(input: ModifyThreadStateInput): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord thread-state input must be an exact object")
  }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || record[keys[0] as string] === undefined) {
    throw new RangeError("Discord thread-state input must contain exactly one field")
  }
  if ("name" in input) {
    if (
      typeof input.name !== "string"
      || input.name.length < 1
      || input.name.length > DISCORD_LIMITS.channelNameCharacters
      || input.name.trim() !== input.name
      || CHANNEL_NAME_CONTROL_PATTERN.test(input.name)
    ) {
      throw new RangeError("Discord thread name is invalid")
    }
    assertValidUnicode(input.name, "Discord thread name")
    return { name: input.name }
  }
  if ("autoArchiveDuration" in input) {
    if (!(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(
      input.autoArchiveDuration,
    )) {
      throw new RangeError("Discord thread auto-archive duration is unsupported")
    }
    return { auto_archive_duration: input.autoArchiveDuration }
  }
  if ("rateLimitPerUser" in input) {
    assertIntegerRange(
      input.rateLimitPerUser,
      0,
      DISCORD_LIMITS.channelRateLimitSeconds,
      "Discord thread slowmode seconds",
    )
    return { rate_limit_per_user: input.rateLimitPerUser }
  }
  for (const key of ["archived", "invitable", "locked"] as const) {
    if (key in input) {
      const value = record[key]
      if (typeof value !== "boolean") {
        throw new RangeError(`Discord thread ${key} state must be a boolean`)
      }
      return { [key]: value }
    }
  }
  throw new RangeError("Discord thread-state input field is unsupported")
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
  assertIntegerRange(
    input.bitrate,
    DISCORD_LIMITS.channelBitrateMinimum,
    DISCORD_LIMITS.voiceChannelBitrateMaximum,
    "Discord channel metadata bitrate",
  )
  assertIntegerRange(
    input.userLimit,
    0,
    DISCORD_LIMITS.stageChannelUserLimit,
    "Discord channel metadata user limit",
  )
  if (
    input.rtcRegion !== undefined
    && input.rtcRegion !== null
    && (
      typeof input.rtcRegion !== "string"
      || input.rtcRegion.length < 1
      || input.rtcRegion.length > DISCORD_LIMITS.voiceRegionIdCharacters
      || input.rtcRegion.trim() !== input.rtcRegion
      || CHANNEL_NAME_CONTROL_PATTERN.test(input.rtcRegion)
    )
  ) throw new RangeError("Discord channel metadata voice region is invalid")
  if (typeof input.rtcRegion === "string") {
    assertValidUnicode(input.rtcRegion, "Discord channel metadata voice region")
  }
  if (
    input.videoQualityMode !== undefined
    && !([
      DISCORD_VIDEO_QUALITY_MODES.auto,
      DISCORD_VIDEO_QUALITY_MODES.full,
    ] as readonly number[]).includes(input.videoQualityMode)
  ) throw new RangeError("Discord channel metadata video quality mode is unsupported")
  if (
    input.defaultAutoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.defaultAutoArchiveDuration)
  ) {
    throw new RangeError("Discord channel metadata default auto-archive duration is unsupported")
  }
  return {
    ...(input.bitrate !== undefined ? { bitrate: input.bitrate } : {}),
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
    ...(input.rtcRegion !== undefined ? { rtc_region: input.rtcRegion } : {}),
    ...(input.topic !== undefined ? { topic: input.topic } : {}),
    ...(input.userLimit !== undefined ? { user_limit: input.userLimit } : {}),
    ...(input.videoQualityMode !== undefined
      ? { video_quality_mode: input.videoQualityMode }
      : {}),
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

function encodedReactionEmoji(emoji: string): string {
  if (
    typeof emoji !== "string"
    || emoji.length < 1
    || emoji.length > CONNECTOR_LIMITS.interactionEmojiCharacters
  ) {
    throw new RangeError(
      `Discord reaction emoji must contain between 1 and ${CONNECTOR_LIMITS.interactionEmojiCharacters} characters`,
    )
  }
  try {
    return encodeURIComponent(emoji)
  } catch (error) {
    throw new RangeError("Discord reaction emoji contains invalid Unicode", { cause: error })
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

const CREATE_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const CREATE_CHANNEL_TOPIC_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const CREATE_CHANNEL_VOICE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
const CREATE_CHANNEL_SLOWMODE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const CREATE_CHANNEL_NSFW_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const CREATE_CHANNEL_THREAD_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const CREATE_CHANNEL_TAG_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
])
const CREATE_CHANNEL_FORUM_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
])
const CREATE_CHANNEL_FLAG_MASKS: ReadonlyMap<number, number> = new Map([
  [DISCORD_CHANNEL_TYPES.text, DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.voice, DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.announcement, DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.forum,
    DISCORD_CHANNEL_FLAGS.requireTag | DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.media,
    DISCORD_CHANNEL_FLAGS.requireTag
      | DISCORD_CHANNEL_FLAGS.hideMediaDownloadOptions
      | DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
])
const CREATE_GUILD_CHANNEL_INPUT_KEYS = [
  "availableTags",
  "bitrate",
  "defaultAutoArchiveDuration",
  "defaultForumLayout",
  "defaultReactionEmoji",
  "defaultSortOrder",
  "defaultThreadRateLimitPerUser",
  "flags",
  "name",
  "nsfw",
  "parentId",
  "permissionOverwrites",
  "rateLimitPerUser",
  "rtcRegion",
  "topic",
  "type",
  "userLimit",
  "videoQualityMode",
] as const
const CREATE_GUILD_CHANNEL_OVERWRITE_KEYS = [
  "allow",
  "deny",
  "id",
  "type",
] as const
const CREATE_GUILD_CHANNEL_REACTION_KEYS = [
  "emojiId",
  "emojiName",
] as const
const CREATE_GUILD_CHANNEL_TAG_KEYS = [
  "emojiId",
  "emojiName",
  "moderated",
  "name",
] as const

function createField(
  value: unknown,
  types: ReadonlySet<number>,
  type: number,
  name: string,
): void {
  if (value !== undefined && !types.has(type)) {
    throw new RangeError(`Discord channel type does not accept ${name}`)
  }
}

function assertCreateGuildChannelTags(
  tags: readonly CreateGuildChannelForumTagInput[],
): void {
  if (!Array.isArray(tags) || tags.length > DISCORD_LIMITS.forumAvailableTags) {
    throw new RangeError("Discord channel available tags must be a bounded array")
  }
  for (const tag of tags) {
    if (
      !tag
      || typeof tag !== "object"
      || Array.isArray(tag)
      || !hasOnlyKeys(
        tag as unknown as Record<string, unknown>,
        CREATE_GUILD_CHANNEL_TAG_KEYS,
      )
      || typeof tag.moderated !== "boolean"
      || !(tag.emojiId === null || typeof tag.emojiId === "string")
    ) {
      throw new RangeError("Discord channel available tag is invalid")
    }
    assertForumTagName(tag.name, "Discord channel available tag name")
    assertForumTagEmojiName(tag.emojiName, "Discord channel available tag Unicode emoji")
    if (typeof tag.emojiId === "string") {
      assertPositiveSnowflake(tag.emojiId, "Discord channel available tag custom emoji ID")
    }
    if (tag.emojiId !== null && tag.emojiName !== null) {
      throw new RangeError("Discord channel available tag emoji fields conflict")
    }
  }
}

function assertCreateGuildChannelInput(input: CreateGuildChannelInput): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || !hasOnlyKeys(
      input as unknown as Record<string, unknown>,
      CREATE_GUILD_CHANNEL_INPUT_KEYS,
    )
  ) {
    throw new RangeError("Discord channel creation input must be an object")
  }
  if (!CREATE_CHANNEL_TYPES.has(input.type)) {
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
  if (input.parentId !== undefined) {
    assertPositiveSnowflake(input.parentId, "Discord channel parent ID")
  }
  if (input.topic !== undefined && input.topic !== null) {
    if (
      typeof input.topic !== "string"
      || input.topic.length > DISCORD_LIMITS.channelTopicCharacters
      || CHANNEL_TOPIC_CONTROL_PATTERN.test(input.topic)
    ) {
      throw new RangeError(
        `Discord channel topic must contain at most ${DISCORD_LIMITS.channelTopicCharacters} characters without unsupported controls`,
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
  assertIntegerRange(
    input.defaultThreadRateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord default thread slowmode seconds",
  )
  assertIntegerRange(
    input.bitrate,
    DISCORD_LIMITS.channelBitrateMinimum,
    DISCORD_LIMITS.voiceChannelBitrateMaximum,
    "Discord channel bitrate",
  )
  assertIntegerRange(
    input.userLimit,
    0,
    DISCORD_LIMITS.stageChannelUserLimit,
    "Discord channel user limit",
  )
  if (
    input.defaultAutoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.defaultAutoArchiveDuration)
  ) {
    throw new RangeError("Discord channel default auto-archive duration is not supported")
  }
  if (input.videoQualityMode !== undefined && !(
    [
      DISCORD_VIDEO_QUALITY_MODES.auto,
      DISCORD_VIDEO_QUALITY_MODES.full,
    ] as readonly number[]
  ).includes(input.videoQualityMode)) {
    throw new RangeError("Discord channel video quality mode is not supported")
  }
  if (
    input.rtcRegion !== undefined
    && input.rtcRegion !== null
    && (
      typeof input.rtcRegion !== "string"
      || input.rtcRegion.length < 1
      || input.rtcRegion.length > DISCORD_LIMITS.voiceRegionIdCharacters
      || CHANNEL_NAME_CONTROL_PATTERN.test(input.rtcRegion)
    )
  ) {
    throw new RangeError("Discord channel voice region is invalid")
  }
  if (typeof input.rtcRegion === "string") {
    assertValidUnicode(input.rtcRegion, "Discord channel voice region")
  }
  if (
    input.defaultSortOrder !== undefined
    && input.defaultSortOrder !== null
    && !(
      [
        DISCORD_FORUM_SORT_ORDERS.latestActivity,
        DISCORD_FORUM_SORT_ORDERS.creationDate,
      ] as readonly number[]
    ).includes(input.defaultSortOrder)
  ) {
    throw new RangeError("Discord channel default sort order is not supported")
  }
  if (
    input.defaultForumLayout !== undefined
    && !(
      [
        DISCORD_FORUM_LAYOUTS.notSet,
        DISCORD_FORUM_LAYOUTS.list,
        DISCORD_FORUM_LAYOUTS.gallery,
      ] as readonly number[]
    ).includes(input.defaultForumLayout)
  ) {
    throw new RangeError("Discord channel default forum layout is not supported")
  }
  if (input.defaultReactionEmoji !== undefined && input.defaultReactionEmoji !== null) {
    const reaction = input.defaultReactionEmoji
    if (
      !reaction
      || typeof reaction !== "object"
      || Array.isArray(reaction)
      || !hasOnlyKeys(
        reaction as unknown as Record<string, unknown>,
        CREATE_GUILD_CHANNEL_REACTION_KEYS,
      )
    ) {
      throw new RangeError("Discord channel default reaction is invalid")
    }
    if (
      !(reaction.emojiId === null || typeof reaction.emojiId === "string")
      || !(reaction.emojiName === null || typeof reaction.emojiName === "string")
      || (reaction.emojiId === null) === (reaction.emojiName === null)
    ) {
      throw new RangeError("Discord channel default reaction requires exactly one emoji")
    }
    if (typeof reaction.emojiId === "string") {
      assertPositiveSnowflake(reaction.emojiId, "Discord channel default reaction emoji ID")
    }
    assertForumTagEmojiName(
      reaction.emojiName,
      "Discord channel default reaction Unicode emoji",
    )
  }
  if (input.availableTags !== undefined) {
    assertCreateGuildChannelTags(input.availableTags)
  }
  if (input.permissionOverwrites !== undefined) {
    if (
      !Array.isArray(input.permissionOverwrites)
      || input.permissionOverwrites.length > DISCORD_LIMITS.channelPermissionOverwrites
    ) {
      throw new RangeError("Discord channel permission overwrites must be a bounded array")
    }
    const targetIds = new Set<string>()
    for (const overwrite of input.permissionOverwrites) {
      if (!overwrite || typeof overwrite !== "object" || Array.isArray(overwrite)) {
        throw new RangeError("Discord channel permission overwrite is invalid")
      }
      if (!hasOnlyKeys(
        overwrite as unknown as Record<string, unknown>,
        CREATE_GUILD_CHANNEL_OVERWRITE_KEYS,
      )) throw new RangeError("Discord channel permission overwrite is invalid")
      assertPositiveSnowflake(overwrite.id, "Discord channel permission overwrite target ID")
      if (overwrite.type !== 0 && overwrite.type !== 1) {
        throw new RangeError("Discord channel permission overwrite type is invalid")
      }
      if (targetIds.has(overwrite.id)) {
        throw new RangeError("Discord channel permission overwrite targets must be unique")
      }
      targetIds.add(overwrite.id)
      if (
        typeof overwrite.allow !== "string"
        || typeof overwrite.deny !== "string"
        || !/^(0|[1-9][0-9]*)$/u.test(overwrite.allow)
        || !/^(0|[1-9][0-9]*)$/u.test(overwrite.deny)
        || (BigInt(overwrite.allow) & BigInt(overwrite.deny)) !== 0n
      ) {
        throw new RangeError("Discord channel permission overwrite bitfields are invalid")
      }
    }
  }
  if (
    input.flags !== undefined
    && (
      !Number.isSafeInteger(input.flags)
      || input.flags < 0
      || (BigInt(input.flags) & ~BigInt(
        CREATE_CHANNEL_FLAG_MASKS.get(input.type) ?? 0,
      )) !== 0n
    )
  ) {
    throw new RangeError("Discord channel creation flags are not supported for this type")
  }
  if (
    input.flags !== undefined
    && (input.flags & DISCORD_CHANNEL_FLAGS.isSpoilerChannel) !== 0
    && input.nsfw === true
  ) {
    throw new RangeError("Discord spoiler-channel flag requires NSFW to be false")
  }
  createField(input.topic, CREATE_CHANNEL_TOPIC_TYPES, input.type, "topic")
  createField(input.bitrate, CREATE_CHANNEL_VOICE_TYPES, input.type, "bitrate")
  createField(input.userLimit, CREATE_CHANNEL_VOICE_TYPES, input.type, "userLimit")
  createField(input.rtcRegion, CREATE_CHANNEL_VOICE_TYPES, input.type, "rtcRegion")
  createField(input.videoQualityMode, CREATE_CHANNEL_VOICE_TYPES, input.type, "videoQualityMode")
  createField(input.rateLimitPerUser, CREATE_CHANNEL_SLOWMODE_TYPES, input.type, "rateLimitPerUser")
  createField(input.nsfw, CREATE_CHANNEL_NSFW_TYPES, input.type, "nsfw")
  createField(
    input.defaultAutoArchiveDuration,
    CREATE_CHANNEL_THREAD_TYPES,
    input.type,
    "defaultAutoArchiveDuration",
  )
  createField(
    input.defaultThreadRateLimitPerUser,
    CREATE_CHANNEL_THREAD_TYPES,
    input.type,
    "defaultThreadRateLimitPerUser",
  )
  createField(input.availableTags, CREATE_CHANNEL_TAG_TYPES, input.type, "availableTags")
  createField(
    input.defaultReactionEmoji,
    CREATE_CHANNEL_TAG_TYPES,
    input.type,
    "defaultReactionEmoji",
  )
  createField(input.defaultSortOrder, CREATE_CHANNEL_TAG_TYPES, input.type, "defaultSortOrder")
  createField(
    input.defaultForumLayout,
    CREATE_CHANNEL_FORUM_TYPES,
    input.type,
    "defaultForumLayout",
  )
  if (
    input.type === DISCORD_CHANNEL_TYPES.voice
    && input.userLimit !== undefined
    && input.userLimit > DISCORD_LIMITS.voiceChannelUserLimit
  ) {
    throw new RangeError("Discord voice channel user limit is too large")
  }
  if (
    input.type === DISCORD_CHANNEL_TYPES.stageVoice
    && input.bitrate !== undefined
    && input.bitrate > DISCORD_LIMITS.stageChannelBitrateMaximum
  ) {
    throw new RangeError("Discord Stage channel bitrate is too large")
  }
  if (input.type === DISCORD_CHANNEL_TYPES.category && input.parentId !== undefined) {
    throw new RangeError("Discord category creation does not accept a parent")
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

function assertCreateThreadFromMessageInput(
  input: CreateThreadFromMessageInput,
): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord anchored thread input must be an object")
  }
  if (
    typeof input.name !== "string"
    || input.name.length < 1
    || input.name.length > DISCORD_LIMITS.channelNameCharacters
    || input.name.trim() !== input.name
    || CHANNEL_NAME_CONTROL_PATTERN.test(input.name)
  ) {
    throw new RangeError(
      `Discord thread name must contain 1-${DISCORD_LIMITS.channelNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(input.name, "Discord thread name")
  if (
    !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.autoArchiveDuration)
  ) {
    throw new RangeError("Discord thread auto-archive duration is not supported")
  }
  assertIntegerRange(
    input.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord thread slowmode seconds",
  )
}

function assertCreateThreadWithoutMessageInput(
  input: CreateThreadWithoutMessageInput,
): void {
  assertCreateThreadFromMessageInput(input)
  if (
    input.type !== DISCORD_CHANNEL_TYPES.publicThread
    && input.type !== DISCORD_CHANNEL_TYPES.privateThread
  ) {
    throw new RangeError("Discord standalone thread type is not supported")
  }
  if (input.type === DISCORD_CHANNEL_TYPES.publicThread) {
    if (input.invitable !== undefined) {
      throw new RangeError("Discord public thread creation does not accept invitable")
    }
    return
  }
  if (typeof input.invitable !== "boolean") {
    throw new RangeError("Discord private thread creation requires explicit invitable state")
  }
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
  "roleIcon",
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
  let roleIcon: { icon: string | null; unicode_emoji: string | null } | undefined
  if (input.roleIcon !== undefined) {
    if (
      !input.roleIcon
      || typeof input.roleIcon !== "object"
      || Array.isArray(input.roleIcon)
      || !["clear", "image", "unicode"].includes(input.roleIcon.kind)
    ) {
      throw new RangeError("Discord role icon input must be one exact tagged intent")
    }
    if (input.roleIcon.kind === "clear") {
      if (Object.keys(input.roleIcon).length !== 1) {
        throw new RangeError("Discord role icon clear input must be exact")
      }
      roleIcon = { icon: null, unicode_emoji: null }
    } else if (input.roleIcon.kind === "unicode") {
      if (Object.keys(input.roleIcon).sort().join("\0") !== "kind\0value") {
        throw new RangeError("Discord role icon Unicode input must be exact")
      }
      assertRoleIconUnicodeEmoji(input.roleIcon.value)
      roleIcon = { icon: null, unicode_emoji: input.roleIcon.value }
    } else {
      if (
        Object.keys(input.roleIcon).sort().join("\0") !== "bytes\0format\0kind"
        || !(input.roleIcon.bytes instanceof Uint8Array)
        || !["jpeg", "png"].includes(input.roleIcon.format)
      ) {
        throw new RangeError("Discord role icon image input must be exact")
      }
      const details = inspectRoleIconBytes(input.roleIcon.bytes)
      if (details.format !== input.roleIcon.format) {
        throw new RangeError("Discord role icon image format does not match its bytes")
      }
      roleIcon = {
        icon: `data:${details.mediaType};base64,${Buffer.from(input.roleIcon.bytes).toString("base64")}`,
        unicode_emoji: null,
      }
    }
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
    ...roleIcon,
  }
}

function modifyGuildRolePositionsBody(
  positions: readonly ModifyGuildRolePositionInput[],
): Array<{ id: string; position: number }> {
  if (
    !Array.isArray(positions)
    || positions.length < 1
    || positions.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new RangeError(
      `Discord role-position input must contain 1-${DISCORD_LIMITS.guildRoles} entries`,
    )
  }
  const ids = new Set<string>()
  return positions.map((position) => {
    if (
      !position
      || typeof position !== "object"
      || Array.isArray(position)
      || Object.keys(position).sort().join("\0") !== "id\0position"
      || typeof position.id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(position.id)
      || BigInt(position.id) < 1n
      || BigInt(position.id) > DISCORD_SNOWFLAKE_MAX
      || ids.has(position.id)
      || !Number.isSafeInteger(position.position)
      || position.position < 0
      || position.position >= DISCORD_LIMITS.guildRoles
    ) {
      throw new RangeError("Discord role-position input contains an invalid entry")
    }
    ids.add(position.id)
    return {
      id: position.id,
      position: position.position,
    }
  })
}

function modifyGuildChannelPositionsBody(
  positions: readonly ModifyGuildChannelPositionInput[],
): Array<{ id: string; position: number }> {
  if (
    !Array.isArray(positions)
    || positions.length < 1
    || positions.length > DISCORD_LIMITS.guildChannels
  ) {
    throw new RangeError(
      `Discord channel-position input must contain 1-${DISCORD_LIMITS.guildChannels} entries`,
    )
  }
  const ids = new Set<string>()
  return positions.map((position) => {
    if (
      !position
      || typeof position !== "object"
      || Array.isArray(position)
      || Object.keys(position).sort().join("\0") !== "id\0position"
      || typeof position.id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(position.id)
      || BigInt(position.id) < 1n
      || BigInt(position.id) > DISCORD_SNOWFLAKE_MAX
      || ids.has(position.id)
      || !Number.isSafeInteger(position.position)
      || position.position < 0
      || position.position >= DISCORD_LIMITS.guildChannels
    ) {
      throw new RangeError("Discord channel-position input contains an invalid entry")
    }
    ids.add(position.id)
    return {
      id: position.id,
      position: position.position,
    }
  })
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
  kind: "emoji" | "soundboard" | "sticker",
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

function assertCreateApplicationEmojiInput(input: CreateApplicationEmojiInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord application emoji creation input must be an object")
  }
  assertGuildExpressionName(input.name, "emoji")
  assertGuildExpressionBytes(
    input.bytes,
    DISCORD_LIMITS.emojiBytes,
    "emoji",
  )
  if (!Object.hasOwn(EMOJI_FORMAT_MEDIA_TYPES, input.format)) {
    throw new RangeError("Discord application emoji format is unsupported")
  }
}

function assertModifyApplicationEmojiInput(input: ModifyApplicationEmojiInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord application emoji update input must be an object")
  }
  assertGuildExpressionName(input.name, "emoji")
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

function assertSoundboardEmojiPair(
  emojiId: string | null | undefined,
  emojiName: string | null | undefined,
  required: boolean,
): void {
  if (
    (required && (emojiId === undefined || emojiName === undefined))
    || ((emojiId === undefined) !== (emojiName === undefined))
    || !(emojiId === undefined || emojiId === null || typeof emojiId === "string")
  ) {
    throw new RangeError("Discord soundboard emoji fields must be one complete nullable pair")
  }
  if (emojiId === undefined || emojiName === undefined) return
  assertSoundboardEmojiName(emojiName, "Discord soundboard Unicode emoji")
  if (emojiId !== null) assertPositiveSnowflake(emojiId, "Discord soundboard custom emoji ID")
  if (emojiId !== null && emojiName !== null) {
    throw new RangeError("Discord soundboard custom and Unicode emoji are mutually exclusive")
  }
  if (emojiName !== null) {
    const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(emojiName)]
    if (
      graphemes.length !== 1
      || POLL_EMOJI_CONTROL_OR_SPACE_PATTERN.test(emojiName)
      || !POLL_EMOJI_CODE_POINT_PATTERN.test(emojiName)
    ) {
      throw new RangeError("Discord soundboard Unicode emoji must be one emoji grapheme")
    }
  }
}

function assertSoundboardVolume(
  volume: unknown,
  nullable: boolean,
): asserts volume is number | null {
  if (nullable && volume === null) return
  if (
    typeof volume !== "number"
    || !Number.isFinite(volume)
    || volume < 0
    || volume > 1
  ) {
    throw new RangeError("Discord soundboard volume must be a finite number from 0 through 1")
  }
}

function assertCreateGuildSoundboardSoundInput(
  input: CreateGuildSoundboardSoundInput,
): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord soundboard creation input must be an object")
  }
  assertSoundboardName(input.name, "Discord soundboard sound name")
  if (input.name.normalize("NFC") !== input.name) {
    throw new RangeError("Discord soundboard sound name must use NFC normalization")
  }
  assertGuildExpressionBytes(input.bytes, DISCORD_LIMITS.soundboardBytes, "soundboard")
  if (!Object.hasOwn(SOUNDBOARD_FORMAT_MEDIA_TYPES, input.format)) {
    throw new RangeError("Discord soundboard audio format is unsupported")
  }
  assertSoundboardVolume(input.volume, false)
  assertSoundboardEmojiPair(input.emojiId, input.emojiName, true)
}

function assertModifyGuildSoundboardSoundInput(
  input: ModifyGuildSoundboardSoundInput,
): void {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || (
      input.name === undefined
      && input.volume === undefined
      && input.emojiId === undefined
      && input.emojiName === undefined
    )
  ) {
    throw new RangeError(
      "Discord soundboard update must contain a name, volume, or complete emoji pair",
    )
  }
  if (input.name !== undefined) {
    assertSoundboardName(input.name, "Discord soundboard sound name")
    if (input.name.normalize("NFC") !== input.name) {
      throw new RangeError("Discord soundboard sound name must use NFC normalization")
    }
  }
  if (input.volume !== undefined) assertSoundboardVolume(input.volume, true)
  assertSoundboardEmojiPair(input.emojiId, input.emojiName, false)
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

const GUILD_COMMAND_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "application_id",
  "guild_id",
  "id",
  "permissions",
])
const COMMAND_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "id",
  "permission",
  "type",
])

function compareDiscordSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function projectBulkGuildBanResponse(
  value: unknown,
  requestedUserIds: readonly string[],
): DiscordBulkGuildBanResponse {
  const invalid = (): DiscordTransportError => new DiscordTransportError(
    "Discord returned invalid bulk guild ban evidence",
    "discord-client-error",
  )
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== "banned_users\0failed_users") {
    throw invalid()
  }
  if (!Array.isArray(record.banned_users) || !Array.isArray(record.failed_users)) {
    throw invalid()
  }
  const bannedUserIds = record.banned_users
  const failedUserIds = record.failed_users
  if (
    bannedUserIds.length > requestedUserIds.length
    || failedUserIds.length > requestedUserIds.length
    || bannedUserIds.some((userId) => typeof userId !== "string")
    || failedUserIds.some((userId) => typeof userId !== "string")
  ) {
    throw invalid()
  }
  try {
    for (const userId of [...bannedUserIds, ...failedUserIds]) {
      assertPositiveSnowflake(userId, "Discord bulk guild ban response user ID")
    }
  } catch {
    throw invalid()
  }
  const responseUserIds = [...bannedUserIds, ...failedUserIds] as string[]
  const responseSet = new Set(responseUserIds)
  const requestedSet = new Set(requestedUserIds)
  if (
    responseSet.size !== responseUserIds.length
    || responseSet.size !== requestedSet.size
    || [...responseSet].some((userId) => !requestedSet.has(userId))
  ) {
    throw invalid()
  }
  return {
    bannedUserIds: [...bannedUserIds].sort(compareDiscordSnowflakes) as string[],
    failedUserIds: [...failedUserIds].sort(compareDiscordSnowflakes) as string[],
  }
}

function projectGuildPruneResponse(value: unknown): DiscordGuildPruneResponse {
  const invalid = (): DiscordTransportError => new DiscordTransportError(
    "Discord returned invalid guild prune evidence",
    "discord-client-error",
  )
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).join("\0") !== "pruned") throw invalid()
  if (!Number.isSafeInteger(record.pruned) || (record.pruned as number) < 0) throw invalid()
  return { pruned: record.pruned as number }
}

function assertGuildPruneParameters(
  guildId: string,
  days: number,
  includeRoleIds: readonly string[],
): void {
  assertPositiveSnowflake(guildId, "Discord guild prune guild ID")
  assertIntegerRange(
    days,
    DISCORD_LIMITS.guildPruneDaysMinimum,
    DISCORD_LIMITS.guildPruneDaysMaximum,
    "Discord guild prune inactivity days",
  )
  if (
    !Array.isArray(includeRoleIds)
    || includeRoleIds.length > DISCORD_LIMITS.guildPruneIncludeRoles
    || new Set(includeRoleIds).size !== includeRoleIds.length
  ) {
    throw new RangeError(
      `Discord guild prune include roles must contain at most ${DISCORD_LIMITS.guildPruneIncludeRoles} unique IDs`,
    )
  }
  for (const roleId of includeRoleIds) {
    assertPositiveSnowflake(roleId, "Discord guild prune include-role ID")
  }
}

function projectGuildApplicationCommandPermissions(
  value: unknown,
  applicationId: string,
  guildId: string,
): DiscordGuildApplicationCommandPermissions[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.guildApplicationCommandPermissions
  ) {
    throw new DiscordTransportError(
      "Discord returned invalid application-command permission evidence",
      "discord-client-error",
    )
  }
  const commandIds = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new DiscordTransportError(
        "Discord returned invalid application-command permission evidence",
        "discord-client-error",
      )
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== "string"
      || record.application_id !== applicationId
      || record.guild_id !== guildId
      || commandIds.has(record.id)
      || !Array.isArray(record.permissions)
      || record.permissions.length > DISCORD_LIMITS.applicationCommandPermissionOverwrites
    ) {
      throw new DiscordTransportError(
        "Discord returned invalid application-command permission evidence",
        "discord-client-error",
      )
    }
    try {
      assertPositiveSnowflake(record.id, "Discord application-command permission ID")
    } catch (error) {
      throw new DiscordTransportError(
        "Discord returned invalid application-command permission evidence",
        "discord-client-error",
        { cause: error },
      )
    }
    commandIds.add(record.id)
    const permissionKeys = new Set<string>()
    const permissions: DiscordApplicationCommandPermission[] = record.permissions.map((permission) => {
      if (!permission || typeof permission !== "object" || Array.isArray(permission)) {
        throw new DiscordTransportError(
          "Discord returned invalid application-command permission evidence",
          "discord-client-error",
        )
      }
      const item = permission as Record<string, unknown>
      if (
        typeof item.id !== "string"
        || (item.type !== 1 && item.type !== 2 && item.type !== 3)
        || typeof item.permission !== "boolean"
      ) {
        throw new DiscordTransportError(
          "Discord returned invalid application-command permission evidence",
          "discord-client-error",
        )
      }
      try {
        assertPositiveSnowflake(item.id, "Discord application-command overwrite ID")
      } catch (error) {
        throw new DiscordTransportError(
          "Discord returned invalid application-command permission evidence",
          "discord-client-error",
          { cause: error },
        )
      }
      const key = `${item.type}:${item.id}`
      if (permissionKeys.has(key)) {
        throw new DiscordTransportError(
          "Discord returned duplicate application-command permission evidence",
          "discord-client-error",
        )
      }
      permissionKeys.add(key)
      return {
        allowed: item.permission,
        id: item.id,
        type: item.type as 1 | 2 | 3,
        unknownFieldCount: countUnknownFields(item, [...COMMAND_PERMISSION_KEYS]),
      }
    }).sort((left, right) => (
      left.type - right.type || compareDiscordSnowflakes(left.id, right.id)
    ))
    return {
      applicationId,
      commandId: record.id,
      guildId,
      permissions,
      unknownFieldCount: countUnknownFields(
        record,
        [...GUILD_COMMAND_PERMISSION_KEYS],
      ),
    }
  }).sort((left, right) => compareDiscordSnowflakes(left.commandId, right.commandId))
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
      Accept: parameters.accept ?? "application/json",
      "User-Agent": DISCORD_USER_AGENT,
    })
    if (parameters.authentication !== "none") {
      headers.set("Authorization", `Bot ${this.#token}`)
    }
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
        if (
          parameters.maxResponseBytes !== undefined
          && new TextEncoder().encode(responseText).byteLength
            > parameters.maxResponseBytes
        ) {
          throw new DiscordTransportError(
            `Discord API ${method} ${diagnosticRoute} exceeded its local response bound`,
            "discord-client-error",
          )
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

        if (
          parameters.expectedSuccessStatus !== undefined
          && response.status !== parameters.expectedSuccessStatus
        ) {
          throw new DiscordTransportError(
            `Discord API ${method} ${diagnosticRoute} returned an unexpected success status`,
            "discord-client-error",
          )
        }

        return (parameters.responseFormat === "text"
          ? responseText
          : parsedBody) as T
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
    return this.#request("get_current_application", "/applications/@me", options)
  }

  modifyCurrentApplicationFlags(
    input: ModifyCurrentApplicationFlagsInput,
    options: RequestOptions = {},
  ): Promise<DiscordApplication> {
    if (
      !input
      || typeof input !== "object"
      || Array.isArray(input)
      || Object.keys(input).join("\0") !== "flags"
      || !Number.isSafeInteger(input.flags)
      || input.flags <= 0
      || (
        BigInt(input.flags)
        & ~CURRENT_APPLICATION_LIMITED_INTENT_FLAG_MASK
      ) !== 0n
    ) {
      throw new RangeError("Discord current-application flags input is invalid")
    }
    return this.#request(
      "modify_current_application_flags",
      "/applications/@me",
      {
        ...options,
        automaticRateLimitRetry: false,
        body: { flags: input.flags },
        expectedSuccessStatus: 200,
      },
    )
  }

  getCurrentUser(options: RequestOptions = {}): Promise<DiscordUser> {
    return this.#request("get_current_user", "/users/@me", options)
  }

  listGuildApplicationCommands(
    applicationId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationCommand[]> {
    assertSearchSnowflake(applicationId, "Discord application-command application ID")
    assertSearchSnowflake(guildId, "Discord application-command guild ID")
    return this.#request(
      "list_guild_application_commands",
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        ...options,
        diagnosticRoute: "/applications/{application.id}/guilds/{guild.id}/commands",
      },
    )
  }

  async listGuildApplicationCommandPermissions(
    applicationId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildApplicationCommandPermissions[]> {
    assertSearchSnowflake(applicationId, "Discord application-command application ID")
    assertSearchSnowflake(guildId, "Discord application-command guild ID")
    const response = await this.#request<unknown>(
      "list_guild_application_command_permissions",
      `/applications/${applicationId}/guilds/${guildId}/commands/permissions`,
      {
        ...options,
        diagnosticRoute: "/applications/{application.id}/guilds/{guild.id}/commands/permissions",
        suppressFailureCause: true,
      },
    )
    return projectGuildApplicationCommandPermissions(response, applicationId, guildId)
  }

  createGuildApplicationCommand(
    applicationId: string,
    guildId: string,
    input: CreateGuildApplicationCommandInput,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationCommand> {
    assertSearchSnowflake(applicationId, "Discord application-command application ID")
    assertSearchSnowflake(guildId, "Discord application-command guild ID")
    return this.#request(
      "create_guild_application_command",
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: {
          default_member_permissions: input.defaultMemberPermissions,
          description: input.description,
          name: input.name,
          nsfw: input.nsfw,
          options: input.options,
          type: input.type,
        },
        diagnosticRoute: "/applications/{application.id}/guilds/{guild.id}/commands",
        suppressFailureCause: true,
      },
    )
  }

  async deleteGuildApplicationCommand(
    applicationId: string,
    guildId: string,
    commandId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(applicationId, "Discord application-command application ID")
    assertSearchSnowflake(guildId, "Discord application-command guild ID")
    assertSearchSnowflake(commandId, "Discord application-command ID")
    await this.#request<void>(
      "delete_guild_application_command",
      `/applications/${applicationId}/guilds/${guildId}/commands/${commandId}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/applications/{application.id}/guilds/{guild.id}/commands/{command.id}",
        suppressFailureCause: true,
      },
    )
  }

  async createDeferredInteractionResponse(
    interactionId: string,
    interactionToken: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(interactionId, "Discord Interaction ID")
    if (!/^[A-Za-z0-9._~-]{1,512}$/.test(interactionToken)) {
      throw new RangeError("Discord Interaction token is invalid")
    }
    await this.#request<void>(
      "create_interaction_response",
      `/interactions/${interactionId}/${encodeURIComponent(interactionToken)}/callback`,
      {
        ...options,
        authentication: "none",
        automaticRateLimitRetry: false,
        body: {
          data: { flags: 64 },
          type: 5,
        },
        diagnosticRoute: "/interactions/{interaction.id}/{interaction.token}/callback",
        suppressFailureCause: true,
      },
    )
  }

  async createImmediateInteractionResponse(
    interactionId: string,
    interactionToken: string,
    content: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertSearchSnowflake(interactionId, "Discord Interaction ID")
    if (!/^[A-Za-z0-9._~-]{1,512}$/.test(interactionToken)) {
      throw new RangeError("Discord Interaction token is invalid")
    }
    if (
      typeof content !== "string"
      || content.length < 1
      || content.length > 2_000
      || !content.trim()
      || content.includes("\0")
    ) {
      throw new RangeError("Discord Interaction response must be 1-2000 nonempty characters")
    }
    await this.#request<void>(
      "create_immediate_interaction_response",
      `/interactions/${interactionId}/${encodeURIComponent(interactionToken)}/callback`,
      {
        ...options,
        authentication: "none",
        automaticRateLimitRetry: false,
        body: {
          data: {
            allowed_mentions: {
              parse: [],
              replied_user: false,
              roles: [],
              users: [],
            },
            content,
            flags: 64,
          },
          type: 4,
        },
        diagnosticRoute: "/interactions/{interaction.id}/{interaction.token}/callback",
        suppressFailureCause: true,
      },
    )
  }

  editOriginalInteractionResponse(
    applicationId: string,
    interactionToken: string,
    content: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(applicationId, "Discord Interaction application ID")
    if (!/^[A-Za-z0-9._~-]{1,512}$/.test(interactionToken)) {
      throw new RangeError("Discord Interaction token is invalid")
    }
    if (
      typeof content !== "string"
      || content.length < 1
      || content.length > 2_000
      || !content.trim()
      || content.includes("\0")
    ) {
      throw new RangeError("Discord Interaction response must be 1-2000 nonempty characters")
    }
    return this.#request(
      "edit_original_interaction_response",
      `/webhooks/${applicationId}/${encodeURIComponent(interactionToken)}/messages/@original`,
      {
        ...options,
        authentication: "none",
        automaticRateLimitRetry: false,
        body: {
          allowed_mentions: {
            parse: [],
            replied_user: false,
            roles: [],
            users: [],
          },
          attachments: [],
          components: [],
          content,
          embeds: [],
        },
        diagnosticRoute: "/webhooks/{application.id}/{interaction.token}/messages/@original",
        suppressFailureCause: true,
      },
    )
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

  async listVoiceRegions(
    options: RequestOptions = {},
  ): Promise<DiscordVoiceRegion[]> {
    const response = await this.#request<unknown>(
      "list_voice_regions",
      "/voice/regions",
      { ...options, suppressFailureCause: true },
    )
    return projectVoiceRegions(response)
  }

  async listGuildVoiceRegions(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordVoiceRegion[]> {
    assertPositiveSnowflake(guildId, "Discord voice-region guild ID")
    const response = await this.#request<unknown>(
      "list_guild_voice_regions",
      `/guilds/${guildId}/regions`,
      { ...options, suppressFailureCause: true },
    )
    return projectVoiceRegions(response)
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
    assertPositiveSnowflake(guildId, "Discord channel creation guild ID")
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
        ...(input.availableTags !== undefined
          ? {
              available_tags: input.availableTags.map((tag) => ({
                emoji_id: tag.emojiId,
                emoji_name: tag.emojiName,
                moderated: tag.moderated,
                name: tag.name,
              })),
            }
          : {}),
        ...(input.bitrate !== undefined ? { bitrate: input.bitrate } : {}),
        ...(input.defaultAutoArchiveDuration !== undefined
          ? { default_auto_archive_duration: input.defaultAutoArchiveDuration }
          : {}),
        ...(input.defaultForumLayout !== undefined
          ? { default_forum_layout: input.defaultForumLayout }
          : {}),
        ...(input.defaultReactionEmoji !== undefined
          ? {
              default_reaction_emoji: input.defaultReactionEmoji === null
                ? null
                : {
                    emoji_id: input.defaultReactionEmoji.emojiId,
                    emoji_name: input.defaultReactionEmoji.emojiName,
                  },
            }
          : {}),
        ...(input.defaultSortOrder !== undefined
          ? { default_sort_order: input.defaultSortOrder }
          : {}),
        ...(input.defaultThreadRateLimitPerUser !== undefined
          ? {
              default_thread_rate_limit_per_user:
                input.defaultThreadRateLimitPerUser,
            }
          : {}),
        ...(input.flags !== undefined ? { flags: input.flags } : {}),
        name: input.name,
        ...(input.nsfw !== undefined ? { nsfw: input.nsfw } : {}),
        ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
        ...(input.permissionOverwrites !== undefined
          ? {
              permission_overwrites: input.permissionOverwrites.map((overwrite) => ({
                allow: overwrite.allow,
                deny: overwrite.deny,
                id: overwrite.id,
                type: overwrite.type,
              })),
            }
          : {}),
        ...(input.rateLimitPerUser !== undefined
          ? { rate_limit_per_user: input.rateLimitPerUser }
          : {}),
        ...(input.rtcRegion !== undefined ? { rtc_region: input.rtcRegion } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        type: input.type,
        ...(input.userLimit !== undefined ? { user_limit: input.userLimit } : {}),
        ...(input.videoQualityMode !== undefined
          ? { video_quality_mode: input.videoQualityMode }
          : {}),
      },
    })
  }

  modifyGuildChannelPositions(
    guildId: string,
    positions: readonly ModifyGuildChannelPositionInput[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord channel-ordering guild ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord channel-ordering audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request<void>(
      "modify_guild_channel_positions",
      `/guilds/${guildId}/channels`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: modifyGuildChannelPositionsBody(positions),
        diagnosticRoute: "/guilds/{guild.id}/channels",
        expectedSuccessStatus: 204,
        suppressFailureCause: true,
      },
    )
  }

  deleteGuildChannel(
    channelId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    assertPositiveSnowflake(channelId, "Discord channel-deletion channel ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord channel-deletion audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("delete_guild_channel", `/channels/${channelId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      diagnosticRoute: "/channels/{channel.id}",
      suppressFailureCause: true,
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

  createThreadFromMessage(
    channelId: string,
    messageId: string,
    input: CreateThreadFromMessageInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    assertPositiveSnowflake(channelId, "Discord anchored thread parent channel ID")
    assertPositiveSnowflake(messageId, "Discord anchored thread source message ID")
    assertCreateThreadFromMessageInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord thread creation audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request(
      "create_thread_from_message",
      `/channels/${channelId}/messages/${messageId}/threads`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          auto_archive_duration: input.autoArchiveDuration,
          name: input.name,
          rate_limit_per_user: input.rateLimitPerUser,
        },
      },
    )
  }

  createThreadWithoutMessage(
    channelId: string,
    input: CreateThreadWithoutMessageInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    assertPositiveSnowflake(channelId, "Discord standalone thread parent channel ID")
    assertCreateThreadWithoutMessageInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord thread creation audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("create_thread_without_message", `/channels/${channelId}/threads`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        auto_archive_duration: input.autoArchiveDuration,
        ...(input.invitable !== undefined ? { invitable: input.invitable } : {}),
        name: input.name,
        rate_limit_per_user: input.rateLimitPerUser,
        type: input.type,
      },
    })
  }

  getGuild(guildId: string, options: RequestOptions = {}): Promise<DiscordGuild> {
    assertPositiveSnowflake(guildId, "Discord guild ID")
    return this.#request("get_guild", `/guilds/${guildId}`, options)
  }

  async getGuildProfile(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildProfile> {
    assertPositiveSnowflake(guildId, "Discord guild profile guild ID")
    const response = await this.#request<unknown>(
      "get_guild_profile",
      `/guilds/${guildId}`,
      {
        ...options,
        suppressFailureCause: true,
      },
    )
    return projectGuildProfile(response, guildId)
  }

  async getGuildIncidentActions(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildIncidentState> {
    assertPositiveSnowflake(guildId, "Discord guild incident-action guild ID")
    const response = await this.#request<unknown>(
      "get_guild_incident_actions",
      `/guilds/${guildId}`,
      {
        ...options,
        suppressFailureCause: true,
      },
    )
    return projectGuildIncidentState(response, guildId)
  }

  async modifyGuildIncidentActions(
    guildId: string,
    input: ModifyGuildIncidentActionsInput,
    options: RequestOptions = {},
  ): Promise<DiscordGuildIncidentActions> {
    assertPositiveSnowflake(guildId, "Discord guild incident-action guild ID")
    const response = await this.#request<unknown>(
      "modify_guild_incident_actions",
      `/guilds/${guildId}/incident-actions`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: guildIncidentActionsBody(input),
        suppressFailureCause: true,
      },
    )
    return projectGuildIncidentMutationResponse(response)
  }

  async modifyGuildProfile(
    guildId: string,
    input: ModifyGuildProfileInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildProfile> {
    assertPositiveSnowflake(guildId, "Discord guild profile guild ID")
    assertModifyGuildProfileInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord guild profile audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_profile",
      `/guilds/${guildId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: guildProfileBody(input),
        suppressFailureCause: true,
      },
    )
    return projectGuildProfile(response, guildId)
  }

  async modifyGuildSettings(
    guildId: string,
    input: ModifyGuildSettingsInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuild> {
    assertPositiveSnowflake(guildId, "Discord guild-settings guild ID")
    assertModifyGuildSettingsInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord guild-settings audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("modify_guild_settings", `/guilds/${guildId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: guildSettingsBody(input),
      suppressFailureCause: true,
    })
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

  async getGuildWelcomeScreen(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildWelcomeScreen | null> {
    assertPositiveSnowflake(guildId, "Discord Welcome Screen guild ID")
    try {
      const response = await this.#request<unknown>(
        "get_guild_welcome_screen",
        `/guilds/${guildId}/welcome-screen`,
        {
          ...options,
          suppressFailureCause: true,
        },
      )
      return projectGuildWelcomeScreen(response)
    } catch (error) {
      if (
        error instanceof DiscordApiError
        && error.status === 404
        && error.code === 10_069
      ) {
        return null
      }
      throw error
    }
  }

  async getGuildWidgetSettings(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildWidgetSettings> {
    assertPositiveSnowflake(guildId, "Discord widget-settings guild ID")
    const response = await this.#request<unknown>(
      "get_guild_widget_settings",
      `/guilds/${guildId}/widget`,
      {
        ...options,
        suppressFailureCause: true,
      },
    )
    return projectGuildWidgetSettings(response)
  }

  async modifyGuildWidgetSettings(
    guildId: string,
    input: ModifyGuildWidgetSettingsInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildWidgetSettings> {
    assertPositiveSnowflake(guildId, "Discord widget-settings guild ID")
    assertModifyGuildWidgetSettingsInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord widget-settings audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_widget_settings",
      `/guilds/${guildId}/widget`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          channel_id: input.channelId,
          enabled: input.enabled,
        },
        suppressFailureCause: true,
      },
    )
    return projectGuildWidgetSettings(response)
  }

  async modifyGuildWelcomeScreen(
    guildId: string,
    input: ModifyGuildWelcomeScreenInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildWelcomeScreen> {
    assertPositiveSnowflake(guildId, "Discord Welcome Screen guild ID")
    assertModifyGuildWelcomeScreenInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord Welcome Screen audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_welcome_screen",
      `/guilds/${guildId}/welcome-screen`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          description: input.description,
          enabled: input.enabled,
          welcome_channels: input.welcomeChannels.map((channel) => ({
            channel_id: channel.channelId,
            description: channel.description,
            emoji_id: channel.emojiId,
            emoji_name: channel.emojiName,
          })),
        },
        suppressFailureCause: true,
      },
    )
    return projectGuildWelcomeScreen(response)
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

  async getGuildVoiceState(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordVoiceStateSummary> {
    assertPositiveSnowflake(guildId, "Discord member voice guild ID")
    assertPositiveSnowflake(userId, "Discord member voice user ID")
    const response = await this.#request<unknown>(
      "get_guild_voice_state",
      `/guilds/${guildId}/voice-states/${userId}`,
      {
        ...options,
        diagnosticRoute: "/guilds/{guild.id}/voice-states/{user.id}",
        suppressFailureCause: true,
      },
    )
    return projectVoiceState(response, guildId, userId)
  }

  async getCurrentUserVoiceState(
    guildId: string,
    botId: string,
    options: RequestOptions = {},
  ): Promise<DiscordVoiceStateSummary> {
    assertPositiveSnowflake(guildId, "Discord current-user voice guild ID")
    assertPositiveSnowflake(botId, "Discord current-user voice bot ID")
    const response = await this.#request<unknown>(
      "get_current_user_voice_state",
      `/guilds/${guildId}/voice-states/@me`,
      {
        ...options,
        diagnosticRoute: "/guilds/{guild.id}/voice-states/@me",
        suppressFailureCause: true,
      },
    )
    return projectVoiceState(response, guildId, botId)
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

  async deleteGuildRole(
    guildId: string,
    roleId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord role-deletion guild ID")
    assertPositiveSnowflake(roleId, "Discord role-deletion role ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_role",
      `/guilds/${guildId}/roles/${roleId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/guilds/{guild.id}/roles/{role.id}",
        expectedSuccessStatus: 204,
        suppressFailureCause: true,
      },
    )
  }

  async listApplicationEmojis(
    applicationId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationEmojiInventory> {
    assertPositiveSnowflake(applicationId, "Discord application emoji application ID")
    const response = await this.#request<unknown>(
      "list_application_emojis",
      `/applications/${applicationId}/emojis`,
      options,
    )
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw applicationEmojiEvidenceError()
    }
    const record = response as Record<string, unknown>
    if (
      !Array.isArray(record.items)
      || record.items.length > DISCORD_LIMITS.applicationEmojis
    ) {
      throw applicationEmojiEvidenceError()
    }
    return {
      items: record.items.map(projectApplicationEmoji),
      unknownFieldCount: countUnknownFields(
        record,
        APPLICATION_EMOJI_INVENTORY_KEYS,
      ),
    }
  }

  async getApplicationEmoji(
    applicationId: string,
    emojiId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationEmojiSummary> {
    assertPositiveSnowflake(applicationId, "Discord application emoji application ID")
    assertPositiveSnowflake(emojiId, "Discord application emoji ID")
    const response = await this.#request<unknown>(
      "get_application_emoji",
      `/applications/${applicationId}/emojis/${emojiId}`,
      options,
    )
    return projectApplicationEmoji(response)
  }

  async createApplicationEmoji(
    applicationId: string,
    input: CreateApplicationEmojiInput,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationEmojiSummary> {
    assertPositiveSnowflake(applicationId, "Discord application emoji application ID")
    assertCreateApplicationEmojiInput(input)
    const mediaType = EMOJI_FORMAT_MEDIA_TYPES[input.format]
    const image = `data:${mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`
    const response = await this.#request<unknown>(
      "create_application_emoji",
      `/applications/${applicationId}/emojis`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: { image, name: input.name },
      },
    )
    return projectApplicationEmoji(response)
  }

  async modifyApplicationEmoji(
    applicationId: string,
    emojiId: string,
    input: ModifyApplicationEmojiInput,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationEmojiSummary> {
    assertPositiveSnowflake(applicationId, "Discord application emoji application ID")
    assertPositiveSnowflake(emojiId, "Discord application emoji ID")
    assertModifyApplicationEmojiInput(input)
    const response = await this.#request<unknown>(
      "modify_application_emoji",
      `/applications/${applicationId}/emojis/${emojiId}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: { name: input.name },
      },
    )
    return projectApplicationEmoji(response)
  }

  async deleteApplicationEmoji(
    applicationId: string,
    emojiId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(applicationId, "Discord application emoji application ID")
    assertPositiveSnowflake(emojiId, "Discord application emoji ID")
    await this.#request<void>(
      "delete_application_emoji",
      `/applications/${applicationId}/emojis/${emojiId}`,
      { ...options, automaticRateLimitRetry: false },
    )
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

  async listDefaultSoundboardSounds(
    options: RequestOptions = {},
  ): Promise<DiscordSoundboardSoundSummary[]> {
    const response = await this.#request<unknown>(
      "list_default_soundboard_sounds",
      "/soundboard-default-sounds",
      options,
    )
    if (!Array.isArray(response) || response.length > DISCORD_LIMITS.soundboardSounds) {
      throw new SoundboardEvidenceError(
        "Discord returned an invalid default soundboard inventory",
      )
    }
    const sounds = response.map((sound) => projectSoundboardSound(sound, null))
    if (new Set(sounds.map((sound) => sound.id)).size !== sounds.length) {
      throw new SoundboardEvidenceError(
        "Discord returned duplicate default soundboard sound IDs",
      )
    }
    return sounds.sort((left, right) => {
      const leftId = BigInt(left.id)
      const rightId = BigInt(right.id)
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
    })
  }

  async listGuildSoundboardSounds(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordSoundboardSoundSummary[]> {
    assertPositiveSnowflake(guildId, "Discord soundboard guild ID")
    const response = await this.#request<unknown>(
      "list_guild_soundboard_sounds",
      `/guilds/${guildId}/soundboard-sounds`,
      options,
    )
    if (
      !response
      || typeof response !== "object"
      || Array.isArray(response)
      || !Array.isArray((response as Record<string, unknown>).items)
      || ((response as Record<string, unknown>).items as unknown[]).length
        > DISCORD_LIMITS.soundboardSounds
      || Object.keys(response).some((key) => key !== "items")
    ) {
      throw new SoundboardEvidenceError(
        "Discord returned an invalid guild soundboard inventory",
      )
    }
    const sounds = ((response as Record<string, unknown>).items as unknown[])
      .map((sound) => projectSoundboardSound(sound, guildId))
    if (new Set(sounds.map((sound) => sound.id)).size !== sounds.length) {
      throw new SoundboardEvidenceError(
        "Discord returned duplicate guild soundboard sound IDs",
      )
    }
    return sounds.sort((left, right) => {
      const leftId = BigInt(left.id)
      const rightId = BigInt(right.id)
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
    })
  }

  async getGuildSoundboardSound(
    guildId: string,
    soundId: string,
    options: RequestOptions = {},
  ): Promise<DiscordSoundboardSoundSummary> {
    assertPositiveSnowflake(guildId, "Discord soundboard guild ID")
    assertPositiveSnowflake(soundId, "Discord soundboard sound ID")
    const response = await this.#request<unknown>(
      "get_guild_soundboard_sound",
      `/guilds/${guildId}/soundboard-sounds/${soundId}`,
      options,
    )
    const sound = projectSoundboardSound(response, guildId)
    if (sound.id !== soundId) {
      throw new SoundboardEvidenceError(
        "Discord returned another soundboard sound for an exact lookup",
      )
    }
    return sound
  }

  async createGuildSoundboardSound(
    guildId: string,
    input: CreateGuildSoundboardSoundInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordSoundboardSoundSummary> {
    assertPositiveSnowflake(guildId, "Discord soundboard guild ID")
    assertCreateGuildSoundboardSoundInput(input)
    encodeDiscordAuditReason(auditReason)
    const mediaType = SOUNDBOARD_FORMAT_MEDIA_TYPES[input.format]
    const sound = `data:${mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`
    const response = await this.#request<unknown>(
      "create_guild_soundboard_sound",
      `/guilds/${guildId}/soundboard-sounds`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          emoji_id: input.emojiId,
          emoji_name: input.emojiName,
          name: input.name,
          sound,
          volume: input.volume,
        },
      },
    )
    return projectSoundboardSound(response, guildId)
  }

  async modifyGuildSoundboardSound(
    guildId: string,
    soundId: string,
    input: ModifyGuildSoundboardSoundInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordSoundboardSoundSummary> {
    assertPositiveSnowflake(guildId, "Discord soundboard guild ID")
    assertPositiveSnowflake(soundId, "Discord soundboard sound ID")
    assertModifyGuildSoundboardSoundInput(input)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_soundboard_sound",
      `/guilds/${guildId}/soundboard-sounds/${soundId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          ...(input.emojiId !== undefined ? { emoji_id: input.emojiId } : {}),
          ...(input.emojiName !== undefined ? { emoji_name: input.emojiName } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.volume !== undefined ? { volume: input.volume } : {}),
        },
      },
    )
    const sound = projectSoundboardSound(response, guildId)
    if (sound.id !== soundId) {
      throw new SoundboardEvidenceError(
        "Discord returned another soundboard sound after an exact update",
      )
    }
    return sound
  }

  async deleteGuildSoundboardSound(
    guildId: string,
    soundId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord soundboard guild ID")
    assertPositiveSnowflake(soundId, "Discord soundboard sound ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_soundboard_sound",
      `/guilds/${guildId}/soundboard-sounds/${soundId}`,
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

  async listGuildScheduledEventUsers(
    guildId: string,
    eventId: string,
    options: ScheduledEventUserPageOptions = {},
  ): Promise<DiscordScheduledEventUserSummary[]> {
    assertPositiveSnowflake(guildId, "Discord scheduled event guild ID")
    assertPositiveSnowflake(eventId, "Discord scheduled event ID")
    if (options.after !== undefined) {
      assertPositiveSnowflake(options.after, "Discord scheduled event user cursor")
    }
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.scheduledEventUsers,
      "Discord scheduled event user page limit",
    )
    const limit = options.limit ?? CONNECTOR_LIMITS.scheduledEventUserPageDefault
    const response = await this.#request<unknown>(
      "list_guild_scheduled_event_users",
      `/guilds/${guildId}/scheduled-events/${eventId}/users${queryString({
        after: options.after,
        limit,
        with_member: false,
      })}`,
      options.signal ? { signal: options.signal } : {},
    )
    if (!Array.isArray(response) || response.length > limit) {
      throw new ScheduledEventEvidenceError(
        "Discord returned an invalid bounded scheduled event user page",
      )
    }
    const users = response.map((value) => projectGuildScheduledEventUser(value, eventId))
    let previousId = options.after === undefined ? 0n : BigInt(options.after)
    for (const user of users) {
      const userId = BigInt(user.userId)
      if (userId <= previousId) {
        throw new ScheduledEventEvidenceError(
          "Discord returned unordered or duplicate scheduled event user identities",
        )
      }
      previousId = userId
    }
    return users
  }

  async getStageInstance(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordStageInstanceSummary> {
    assertPositiveSnowflake(channelId, "Discord Stage-instance channel ID")
    const response = await this.#request<unknown>(
      "get_stage_instance",
      `/stage-instances/${channelId}`,
      options,
    )
    const stageInstance = projectStageInstance(response)
    if (stageInstance.channelId !== channelId) {
      throw stageInstanceEvidenceError(
        "Discord returned another Stage instance for an exact channel lookup",
      )
    }
    return stageInstance
  }

  async createStageInstance(
    input: CreateStageInstanceInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordStageInstanceSummary> {
    assertCreateStageInstanceInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord Stage-instance audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "create_stage_instance",
      "/stage-instances",
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          channel_id: input.channelId,
          privacy_level: DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.guildOnly,
          send_start_notification: input.sendStartNotification,
          topic: input.topic,
        },
      },
    )
    const stageInstance = projectStageInstance(response)
    if (stageInstance.channelId !== input.channelId) {
      throw stageInstanceEvidenceError(
        "Discord returned another Stage instance after exact creation",
      )
    }
    return stageInstance
  }

  async modifyStageInstance(
    channelId: string,
    input: ModifyStageInstanceInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordStageInstanceSummary> {
    assertPositiveSnowflake(channelId, "Discord Stage-instance channel ID")
    assertModifyStageInstanceInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord Stage-instance audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_stage_instance",
      `/stage-instances/${channelId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: { topic: input.topic },
      },
    )
    const stageInstance = projectStageInstance(response)
    if (stageInstance.channelId !== channelId) {
      throw stageInstanceEvidenceError(
        "Discord returned another Stage instance after an exact update",
      )
    }
    return stageInstance
  }

  async deleteStageInstance(
    channelId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord Stage-instance channel ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord Stage-instance audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_stage_instance",
      `/stage-instances/${channelId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
      },
    )
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

  modifyGuildRolePositions(
    guildId: string,
    positions: readonly ModifyGuildRolePositionInput[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordRole[]> {
    assertPositiveSnowflake(guildId, "Discord role-ordering guild ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord role-ordering audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request(
      "modify_guild_role_positions",
      `/guilds/${guildId}/roles`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: modifyGuildRolePositionsBody(positions),
        diagnosticRoute: "/guilds/{guild.id}/roles",
        expectedSuccessStatus: 200,
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

  async createChannelInvite(
    channelId: string,
    input: CreateChannelInviteInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordInviteSummary> {
    assertPositiveSnowflake(channelId, "Discord invite-creation channel ID")
    assertCreateChannelInviteInput(input)
    encodeDiscordAuditReason(auditReason)
    const payload = {
      max_age: input.maxAgeSeconds,
      max_uses: input.maxUses,
      temporary: input.temporaryMembership,
      unique: true,
    }
    let multipartBody: FormData | undefined
    if (input.targetUserIds !== null) {
      multipartBody = new FormData()
      multipartBody.append("payload_json", JSON.stringify(payload))
      multipartBody.append(
        "target_users_file",
        new Blob([inviteTargetUsersCsv(input.targetUserIds)], { type: "text/csv" }),
        "target-users.csv",
      )
    }
    const response = await this.#request<unknown>(
      "create_channel_invite",
      `/channels/${channelId}/invites`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        ...(multipartBody === undefined
          ? { body: payload }
          : { multipartBody }),
        diagnosticRoute: "/channels/{channel.id}/invites",
        suppressFailureCause: true,
      },
    )
    return projectInvite(response)
  }

  async getInvite(
    code: string,
    options: RequestOptions = {},
  ): Promise<DiscordInviteIdentitySummary> {
    const encodedCode = encodedInviteCode(code, "Discord exact invite lookup")
    const response = await this.#request<unknown>(
      "get_invite",
      `/invites/${encodedCode}`,
      {
        ...options,
        authentication: "none",
        diagnosticRoute: "/invites/{invite.code}",
        suppressFailureCause: true,
      },
    )
    return projectInviteIdentity(response)
  }

  async getInviteTargetUsersJobStatus(
    code: string,
    options: RequestOptions = {},
  ): Promise<DiscordInviteTargetUsersJobStatus> {
    const encodedCode = encodedInviteCode(
      code,
      "Discord invite target-user job lookup",
    )
    const response = await this.#request<unknown>(
      "get_invite_target_users_job_status",
      `/invites/${encodedCode}/target-users/job-status`,
      {
        ...options,
        diagnosticRoute: "/invites/{invite.code}/target-users/job-status",
        maxResponseBytes: INVITE_LIMITS.targetUsersCsvBytes,
        suppressFailureCause: true,
      },
    )
    return projectInviteTargetUsersJobStatus(response)
  }

  async getInviteTargetUserIds(
    code: string,
    options: RequestOptions = {},
  ): Promise<string[]> {
    const encodedCode = encodedInviteCode(code, "Discord invite target-user lookup")
    const response = await this.#request<string>(
      "get_invite_target_users",
      `/invites/${encodedCode}/target-users`,
      {
        ...options,
        accept: "text/csv",
        diagnosticRoute: "/invites/{invite.code}/target-users",
        maxResponseBytes: INVITE_LIMITS.targetUsersCsvBytes,
        responseFormat: "text",
        suppressFailureCause: true,
      },
    )
    return projectInviteTargetUserIds(response)
  }

  async listGuildTemplates(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildTemplateSummary[]> {
    assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
    const response = await this.#request<unknown>(
      "list_guild_templates",
      `/guilds/${guildId}/templates`,
      { ...options, suppressFailureCause: true },
    )
    if (
      !Array.isArray(response)
      || response.length > GUILD_TEMPLATE_LIMITS.inventory
    ) {
      throw guildTemplateEvidenceError()
    }
    const templates = response.map(projectGuildTemplate)
    if (new Set(templates.map(({ code }) => code)).size !== templates.length) {
      throw guildTemplateEvidenceError()
    }
    return templates
  }

  async createGuildTemplate(
    guildId: string,
    input: CreateGuildTemplateInput,
    options: RequestOptions = {},
  ): Promise<DiscordGuildTemplateSummary> {
    assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
    assertGuildTemplateInput(input, true)
    const response = await this.#request<unknown>(
      "create_guild_template",
      `/guilds/${guildId}/templates`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: {
          description: input.description,
          name: input.name,
        },
        suppressFailureCause: true,
      },
    )
    return projectGuildTemplate(response)
  }

  async syncGuildTemplate(
    guildId: string,
    code: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildTemplateSummary> {
    assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
    const response = await this.#request<unknown>(
      "sync_guild_template",
      `/guilds/${guildId}/templates/${encodedGuildTemplateCode(code)}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/guilds/{guild.id}/templates/{template.code}",
        suppressFailureCause: true,
      },
    )
    return projectGuildTemplate(response)
  }

  async modifyGuildTemplate(
    guildId: string,
    code: string,
    input: ModifyGuildTemplateInput,
    options: RequestOptions = {},
  ): Promise<DiscordGuildTemplateSummary> {
    assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
    assertGuildTemplateInput(input, false)
    const response = await this.#request<unknown>(
      "modify_guild_template",
      `/guilds/${guildId}/templates/${encodedGuildTemplateCode(code)}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: {
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
        },
        diagnosticRoute: "/guilds/{guild.id}/templates/{template.code}",
        suppressFailureCause: true,
      },
    )
    return projectGuildTemplate(response)
  }

  async deleteGuildTemplate(
    guildId: string,
    code: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildTemplateSummary> {
    assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
    const response = await this.#request<unknown>(
      "delete_guild_template",
      `/guilds/${guildId}/templates/${encodedGuildTemplateCode(code)}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/guilds/{guild.id}/templates/{template.code}",
        suppressFailureCause: true,
      },
    )
    return projectGuildTemplate(response)
  }

  async deleteInvite(
    code: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordDeletedInviteSummary> {
    const encodedCode = encodedInviteCode(code, "Discord invite deletion")
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
    return projectInviteIdentity(response)
  }

  modifyGuildMemberTimeout(
    guildId: string,
    userId: string,
    input: ModifyGuildMemberTimeoutInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMember> {
    assertPositiveSnowflake(guildId, "Discord member-moderation guild ID")
    assertPositiveSnowflake(userId, "Discord member-moderation user ID")
    if (input.communicationDisabledUntil !== null) {
      assertIsoTimestamp(
        input.communicationDisabledUntil,
        "Discord member timeout expiration",
      )
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("modify_guild_member_timeout", `/guilds/${guildId}/members/${userId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        communication_disabled_until: input.communicationDisabledUntil,
      },
      diagnosticRoute: "/guilds/{guild.id}/members/{user.id}",
      suppressFailureCause: true,
    })
  }

  async modifyCurrentMemberNickname(
    guildId: string,
    expectedBotId: string,
    nickname: string | null,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMemberNicknameUpdate> {
    assertPositiveSnowflake(guildId, "Discord member nickname guild ID")
    assertPositiveSnowflake(expectedBotId, "Discord member nickname bot ID")
    normalizeDesiredMemberNickname(nickname)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_current_member_nickname",
      `/guilds/${guildId}/members/@me`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: { nick: nickname },
        diagnosticRoute: "/guilds/{guild.id}/members/@me",
        suppressFailureCause: true,
      },
    )
    return projectGuildMemberNicknameUpdate(response, expectedBotId)
  }

  async modifyGuildMemberNickname(
    guildId: string,
    userId: string,
    nickname: string | null,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMemberNicknameUpdate> {
    assertPositiveSnowflake(guildId, "Discord member nickname guild ID")
    assertPositiveSnowflake(userId, "Discord member nickname user ID")
    normalizeDesiredMemberNickname(nickname)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_member_nickname",
      `/guilds/${guildId}/members/${userId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: { nick: nickname },
        diagnosticRoute: "/guilds/{guild.id}/members/{user.id}",
        suppressFailureCause: true,
      },
    )
    return projectGuildMemberNicknameUpdate(response, userId)
  }

  async modifyGuildMemberVoice(
    guildId: string,
    userId: string,
    input: ModifyGuildMemberVoiceInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMemberVoiceUpdate> {
    assertPositiveSnowflake(guildId, "Discord member voice guild ID")
    assertPositiveSnowflake(userId, "Discord member voice user ID")
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_guild_member_voice",
      `/guilds/${guildId}/members/${userId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: memberVoiceBody(input),
        diagnosticRoute: "/guilds/{guild.id}/members/{user.id}",
        suppressFailureCause: true,
      },
    )
    return projectGuildMemberVoiceUpdate(response, userId)
  }

  async removeGuildMember(
    guildId: string,
    userId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord member-moderation guild ID")
    assertPositiveSnowflake(userId, "Discord member-moderation user ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>("remove_guild_member", `/guilds/${guildId}/members/${userId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      diagnosticRoute: "/guilds/{guild.id}/members/{user.id}",
      suppressFailureCause: true,
    })
  }

  async createGuildBan(
    guildId: string,
    userId: string,
    deleteMessageSeconds: number,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord member-moderation guild ID")
    assertPositiveSnowflake(userId, "Discord member-moderation user ID")
    assertIntegerRange(
      deleteMessageSeconds,
      0,
      DISCORD_LIMITS.banDeleteMessageSeconds,
      "Discord ban message-history deletion seconds",
    )
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>("create_guild_ban", `/guilds/${guildId}/bans/${userId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: { delete_message_seconds: deleteMessageSeconds },
      diagnosticRoute: "/guilds/{guild.id}/bans/{user.id}",
      suppressFailureCause: true,
    })
  }

  async getGuildPruneCount(
    guildId: string,
    days: number,
    includeRoleIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<DiscordGuildPruneResponse> {
    assertGuildPruneParameters(guildId, days, includeRoleIds)
    const route = `/guilds/${guildId}/prune${queryString({
      days,
      include_roles: includeRoleIds.length > 0 ? includeRoleIds.join(",") : undefined,
    })}`
    const response = await this.#request<unknown>("get_guild_prune_count", route, {
      ...options,
      diagnosticRoute: "/guilds/{guild.id}/prune",
      expectedSuccessStatus: 200,
      maxResponseBytes: DISCORD_LIMITS.guildPruneResponseBytes,
      suppressFailureCause: true,
    })
    return projectGuildPruneResponse(response)
  }

  async beginGuildPrune(
    guildId: string,
    days: number,
    includeRoleIds: readonly string[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildPruneResponse> {
    assertGuildPruneParameters(guildId, days, includeRoleIds)
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "begin_guild_prune",
      `/guilds/${guildId}/prune`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          compute_prune_count: true,
          days,
          ...(includeRoleIds.length > 0 ? { include_roles: includeRoleIds } : {}),
        },
        diagnosticRoute: "/guilds/{guild.id}/prune",
        expectedSuccessStatus: 200,
        maxResponseBytes: DISCORD_LIMITS.guildPruneResponseBytes,
        suppressFailureCause: true,
      },
    )
    return projectGuildPruneResponse(response)
  }

  async bulkGuildBan(
    guildId: string,
    userIds: readonly string[],
    deleteMessageSeconds: number,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordBulkGuildBanResponse> {
    assertPositiveSnowflake(guildId, "Discord bulk guild ban guild ID")
    if (
      !Array.isArray(userIds)
      || userIds.length < 2
      || userIds.length > DISCORD_LIMITS.bulkGuildBanUsers
    ) {
      throw new RangeError(
        `Discord bulk guild ban user IDs must contain between 2 and ${DISCORD_LIMITS.bulkGuildBanUsers} values`,
      )
    }
    if (new Set(userIds).size !== userIds.length) {
      throw new RangeError("Discord bulk guild ban user IDs must not contain duplicates")
    }
    for (const userId of userIds) {
      assertPositiveSnowflake(userId, "Discord bulk guild ban user ID")
    }
    assertIntegerRange(
      deleteMessageSeconds,
      0,
      DISCORD_LIMITS.banDeleteMessageSeconds,
      "Discord bulk guild ban message-history deletion seconds",
    )
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "bulk_guild_ban",
      `/guilds/${guildId}/bulk-ban`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: {
          delete_message_seconds: deleteMessageSeconds,
          user_ids: userIds,
        },
        diagnosticRoute: "/guilds/{guild.id}/bulk-ban",
        expectedSuccessStatus: 200,
        maxResponseBytes: DISCORD_LIMITS.bulkGuildBanResponseBytes,
        suppressFailureCause: true,
      },
    )
    return projectBulkGuildBanResponse(response, userIds)
  }

  async removeGuildBan(
    guildId: string,
    userId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord member-moderation guild ID")
    assertPositiveSnowflake(userId, "Discord member-moderation user ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>("remove_guild_ban", `/guilds/${guildId}/bans/${userId}`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      diagnosticRoute: "/guilds/{guild.id}/bans/{user.id}",
      suppressFailureCause: true,
    })
  }

  getChannel(channelId: string, options: RequestOptions = {}): Promise<DiscordChannel> {
    return this.#request("get_channel", `/channels/${channelId}`, options)
  }

  async getThreadState(
    threadId: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadStateSummary> {
    assertPositiveSnowflake(threadId, "Discord thread-governance thread ID")
    const response = await this.#request<unknown>(
      "get_thread_state",
      `/channels/${threadId}`,
      {
        ...options,
        diagnosticRoute: "/channels/{thread.id}",
        suppressFailureCause: true,
      },
    )
    return projectThreadState(response, threadId)
  }

  async modifyThreadState(
    threadId: string,
    input: ModifyThreadStateInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadStateSummary> {
    assertPositiveSnowflake(threadId, "Discord thread-governance thread ID")
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_thread_state",
      `/channels/${threadId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: threadStateBody(input),
        diagnosticRoute: "/channels/{thread.id}",
        suppressFailureCause: true,
      },
    )
    return projectThreadState(response, threadId)
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

  async setVoiceChannelStatus(
    channelId: string,
    status: string | null,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord voice channel status ID")
    if (
      status !== null
      && (
        typeof status !== "string"
        || status.length < 1
        || [...status].length > DISCORD_LIMITS.voiceChannelStatusCharacters
        || status.trim() !== status
        || VOICE_CHANNEL_STATUS_CONTROL_PATTERN.test(status)
      )
    ) {
      throw new RangeError(
        `Discord voice channel status must be null or contain 1-${DISCORD_LIMITS.voiceChannelStatusCharacters} trimmed characters without controls`,
      )
    }
    if (status !== null) assertValidUnicode(status, "Discord voice channel status")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "set_voice_channel_status",
      `/channels/${channelId}/voice-status`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: { status },
        diagnosticRoute: "/channels/{channel.id}/voice-status",
        expectedSuccessStatus: 204,
        suppressFailureCause: true,
      },
    )
  }

  async getGuildForumTags(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordForumTagState> {
    assertPositiveSnowflake(channelId, "Discord forum channel ID")
    const response = await this.#request<unknown>(
      "get_forum_tags",
      `/channels/${channelId}`,
      {
        ...options,
        diagnosticRoute: "/channels/{channel.id}",
        suppressFailureCause: true,
      },
    )
    return projectGuildForumTagState(response, channelId)
  }

  async modifyGuildForumTags(
    channelId: string,
    tags: readonly ModifyForumTagInput[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordForumTagState> {
    assertPositiveSnowflake(channelId, "Discord forum channel ID")
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord forum-tag audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_forum_tags",
      `/channels/${channelId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: forumTagBody(tags),
        diagnosticRoute: "/channels/{channel.id}",
        suppressFailureCause: true,
      },
    )
    return projectGuildForumTagState(response, channelId)
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

  async createWebhook(
    channelId: string,
    input: CreateWebhookInput,
    credentialSink: WebhookCredentialSink,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordWebhookSummary> {
    assertPositiveSnowflake(channelId, "Discord webhook channel ID")
    if (
      !input
      || typeof input !== "object"
      || Array.isArray(input)
      || !hasOnlyKeys(input as unknown as Record<string, unknown>, CREATE_WEBHOOK_INPUT_KEYS)
    ) {
      throw new RangeError("Discord webhook creation must be an exact object")
    }
    assertWebhookNameInput(input.name)
    if (typeof credentialSink !== "function") {
      throw new RangeError("Discord webhook creation requires private credential custody")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "create_webhook",
      `/channels/${channelId}/webhooks`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: { name: input.name },
        diagnosticRoute: "/channels/{channel.id}/webhooks",
        suppressFailureCause: true,
      },
    )
    const created = projectCreatedWebhook(response, channelId)
    await credentialSink(created.webhook, created.token)
    return created.webhook
  }

  async getWebhookWithToken(
    webhookId: string,
    token: string,
    options: RequestOptions = {},
  ): Promise<DiscordWebhookSummary> {
    const route = webhookTokenRoute(webhookId, token)
    const response = await this.#request<unknown>("get_webhook", route, {
      ...options,
      authentication: "none",
      diagnosticRoute: "/webhooks/{webhook.id}/{webhook.token}",
      suppressFailureCause: true,
    })
    const webhook = projectWebhook(response)
    if (webhook.id !== webhookId) {
      throw new WebhookEvidenceError(
        "Discord returned a different webhook than the credential target",
      )
    }
    return webhook
  }

  async executeWebhookMessage(
    webhookId: string,
    token: string,
    input: ExecuteWebhookMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertMessageContent(input.content)
    assertAllowedMentions(input.allowedMentions)
    const route = webhookTokenRoute(webhookId, token)
    return this.#request<DiscordMessage>(
      "execute_webhook",
      `${route}?wait=true`,
      {
        ...options,
        authentication: "none",
        automaticRateLimitRetry: false,
        body: {
          allowed_mentions: input.allowedMentions,
          content: input.content,
          flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
        },
        diagnosticRoute: "/webhooks/{webhook.id}/{webhook.token}",
        expectedSuccessStatus: 200,
        suppressFailureCause: true,
      },
    )
  }

  async getWebhookMessage(
    webhookId: string,
    token: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertPositiveSnowflake(messageId, "Discord webhook message ID")
    const route = webhookTokenRoute(webhookId, token)
    return this.#request<DiscordMessage>(
      "get_webhook_message",
      `${route}/messages/${messageId}`,
      {
        ...options,
        authentication: "none",
        diagnosticRoute: "/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}",
        suppressFailureCause: true,
      },
    )
  }

  async modifyWebhookMessage(
    webhookId: string,
    token: string,
    messageId: string,
    input: ModifyWebhookMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertPositiveSnowflake(messageId, "Discord webhook message ID")
    assertMessageContent(input.content)
    assertAllowedMentions(input.allowedMentions)
    const route = webhookTokenRoute(webhookId, token)
    return this.#request<DiscordMessage>(
      "modify_webhook_message",
      `${route}/messages/${messageId}`,
      {
        ...options,
        authentication: "none",
        automaticRateLimitRetry: false,
        body: {
          allowed_mentions: input.allowedMentions,
          content: input.content,
          flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
        },
        diagnosticRoute: "/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}",
        suppressFailureCause: true,
      },
    )
  }

  async deleteWebhookMessage(
    webhookId: string,
    token: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(messageId, "Discord webhook message ID")
    const route = webhookTokenRoute(webhookId, token)
    await this.#request<void>(
      "delete_webhook_message",
      `${route}/messages/${messageId}`,
      {
        ...options,
        authentication: "none",
        automaticRateLimitRetry: false,
        diagnosticRoute: "/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}",
        expectedSuccessStatus: 204,
        suppressFailureCause: true,
      },
    )
  }

  async followAnnouncementChannel(
    sourceChannelId: string,
    targetChannelId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordFollowedChannel> {
    assertPositiveSnowflake(
      sourceChannelId,
      "Discord announcement source channel ID",
    )
    assertPositiveSnowflake(
      targetChannelId,
      "Discord announcement target channel ID",
    )
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "follow_announcement_channel",
      `/channels/${sourceChannelId}/followers`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body: { webhook_channel_id: targetChannelId },
        diagnosticRoute: "/channels/{channel.id}/followers",
        expectedSuccessStatus: 200,
        suppressFailureCause: true,
      },
    )
    return projectFollowedChannel(response, sourceChannelId)
  }

  async modifyWebhook(
    webhookId: string,
    input: ModifyWebhookInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordWebhookSummary> {
    assertPositiveSnowflake(webhookId, "Discord webhook ID")
    if (
      !input
      || typeof input !== "object"
      || Array.isArray(input)
      || !hasOnlyKeys(input as unknown as Record<string, unknown>, MODIFY_WEBHOOK_INPUT_KEYS)
    ) {
      throw new RangeError("Discord webhook modification must be an exact object")
    }
    const body: Record<string, unknown> = {}
    if (input.name !== undefined) {
      assertWebhookNameInput(input.name)
      body.name = input.name
    }
    if (input.channelId !== undefined) {
      assertPositiveSnowflake(input.channelId, "Discord webhook destination channel ID")
      body.channel_id = input.channelId
    }
    if (Object.keys(body).length === 0) {
      throw new RangeError("Discord webhook modification requires a name or destination channel")
    }
    encodeDiscordAuditReason(auditReason)
    const response = await this.#request<unknown>(
      "modify_webhook",
      `/webhooks/${webhookId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        body,
        diagnosticRoute: "/webhooks/{webhook.id}",
        suppressFailureCause: true,
      },
    )
    const projected = projectWebhook(response)
    if (projected.id !== webhookId) {
      throw new WebhookEvidenceError(
        "Discord returned a different webhook than the modified target",
      )
    }
    return projected
  }

  async listGuildIntegrations(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildIntegrationSummary[]> {
    assertPositiveSnowflake(guildId, "Discord integration guild ID")
    const response = await this.#request<unknown>(
      "list_guild_integrations",
      `/guilds/${guildId}/integrations`,
      {
        ...options,
        diagnosticRoute: "/guilds/{guild.id}/integrations",
        expectedSuccessStatus: 200,
        suppressFailureCause: true,
      },
    )
    if (!Array.isArray(response) || response.length > DISCORD_LIMITS.guildIntegrations) {
      throw integrationEvidenceError()
    }
    const integrations = response.map(projectGuildIntegration)
    const ids = new Set(integrations.map(({ id }) => id))
    if (ids.size !== integrations.length) throw integrationEvidenceError()
    return integrations.sort((left, right) => left.id.localeCompare(right.id))
  }

  async deleteGuildIntegration(
    guildId: string,
    integrationId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(guildId, "Discord integration guild ID")
    assertPositiveSnowflake(integrationId, "Discord integration ID")
    encodeDiscordAuditReason(auditReason)
    await this.#request<void>(
      "delete_guild_integration",
      `/guilds/${guildId}/integrations/${integrationId}`,
      {
        ...options,
        auditReason,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/guilds/{guild.id}/integrations/{integration.id}",
        expectedSuccessStatus: 204,
        suppressFailureCause: true,
      },
    )
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
      diagnosticRoute: "/webhooks/{webhook.id}",
      expectedSuccessStatus: 204,
      suppressFailureCause: true,
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
    return this.#request<unknown>(
      "get_thread_member",
      `/channels/${threadId}/thread-members/${userId}?with_member=false`,
      {
        ...options,
        diagnosticRoute: "/channels/{thread.id}/thread-members/{user.id}",
        suppressFailureCause: true,
      },
    ).then((response) => projectExactThreadMember(response, threadId, userId))
  }

  async addThreadMember(
    threadId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(threadId, "Discord thread-governance thread ID")
    assertPositiveSnowflake(userId, "Discord thread-governance user ID")
    await this.#request<void>(
      "add_thread_member",
      `/channels/${threadId}/thread-members/${userId}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/channels/{thread.id}/thread-members/{user.id}",
        suppressFailureCause: true,
      },
    )
  }

  async removeThreadMember(
    threadId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(threadId, "Discord thread-governance thread ID")
    assertPositiveSnowflake(userId, "Discord thread-governance user ID")
    await this.#request<void>(
      "remove_thread_member",
      `/channels/${threadId}/thread-members/${userId}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/channels/{thread.id}/thread-members/{user.id}",
        suppressFailureCause: true,
      },
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

  crosspostMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord announcement-crosspost channel ID")
    assertSearchSnowflake(messageId, "Discord announcement-crosspost message ID")
    return this.#request(
      "crosspost_message",
      `/channels/${channelId}/messages/${messageId}/crosspost`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/crosspost",
        suppressFailureCause: true,
      },
    )
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

  createMessageForward(
    targetChannelId: string,
    input: CreateMessageForwardInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(targetChannelId, "Discord message-forward target channel ID")
    assertSearchSnowflake(input.sourceChannelId, "Discord message-forward source channel ID")
    assertSearchSnowflake(input.sourceGuildId, "Discord message-forward source guild ID")
    assertSearchSnowflake(input.sourceMessageId, "Discord message-forward source message ID")
    if (input.sourceChannelId === targetChannelId) {
      throw new RangeError("Discord message-forward source and target channels must differ")
    }
    if (!input.nonce || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters) {
      throw new RangeError(
        `Discord message-forward nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
      )
    }
    return this.#request(
      "create_message_forward",
      `/channels/${targetChannelId}/messages`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: {
          allowed_mentions: { parse: [], replied_user: false },
          enforce_nonce: true,
          flags: DISCORD_MESSAGE_FLAGS.suppressNotifications,
          message_reference: {
            channel_id: input.sourceChannelId,
            fail_if_not_exists: true,
            guild_id: input.sourceGuildId,
            message_id: input.sourceMessageId,
            type: DISCORD_MESSAGE_REFERENCE_TYPES.forward,
          },
          nonce: input.nonce,
        },
      },
    )
  }

  createComponentMessage(
    channelId: string,
    input: CreateComponentMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord component-message channel ID")
    assertCompiledComponentLayout(input.components)
    if (!input.nonce || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters) {
      throw new RangeError(
        `Discord message nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
      )
    }
    assertAllowedMentions(input.allowedMentions)
    if (input.reply) {
      assertSearchSnowflake(input.reply.guildId, "Discord component-message reply guild ID")
      assertSearchSnowflake(input.reply.messageId, "Discord component-message reply message ID")
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
    return this.#request(
      "create_component_message",
      `/channels/${channelId}/messages`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: {
          allowed_mentions: input.allowedMentions,
          components: input.components,
          enforce_nonce: true,
          flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
          ...(messageReference ? { message_reference: messageReference } : {}),
          nonce: input.nonce,
        },
      },
    )
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

  editComponentMessage(
    channelId: string,
    messageId: string,
    input: EditComponentMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord component-message channel ID")
    assertSearchSnowflake(messageId, "Discord component-message message ID")
    assertCompiledComponentLayout(input.components)
    if (
      !Number.isSafeInteger(input.flags)
      || input.flags < 0
      || input.flags > 0xFF_FF_FF_FF
      || (input.flags & DISCORD_MESSAGE_FLAGS.isComponentsV2) === 0
    ) {
      throw new RangeError(
        "Discord component-message edit flags must preserve IS_COMPONENTS_V2",
      )
    }
    assertAllowedMentions(input.allowedMentions)
    return this.#request(
      "edit_component_message",
      `/channels/${channelId}/messages/${messageId}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        body: {
          allowed_mentions: input.allowedMentions,
          components: input.components,
          flags: input.flags,
        },
      },
    )
  }

  async addOwnReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    const encodedEmoji = encodedReactionEmoji(emoji)
    await this.#request<void>(
      "add_own_reaction",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      {
        ...options,
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me",
        expectedSuccessStatus: 204,
      },
    )
  }

  async deleteOwnReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    const encodedEmoji = encodedReactionEmoji(emoji)
    await this.#request<void>(
      "delete_own_reaction",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      {
        ...options,
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me",
        expectedSuccessStatus: 204,
      },
    )
  }

  async listReactionUsers(
    channelId: string,
    messageId: string,
    emoji: string,
    options: ReactionUserPageOptions = {},
  ): Promise<DiscordUser[]> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    assertSearchSnowflake(options.after, "Discord reaction user cursor")
    assertBoundedLimit(
      options.limit,
      REACTION_LIMITS.userPage,
      "Discord reaction user page limit",
    )
    if (options.type !== undefined && options.type !== 0 && options.type !== 1) {
      throw new RangeError("Discord reaction type must be normal or burst")
    }
    const encodedEmoji = encodedReactionEmoji(emoji)
    const query = queryString({
      after: options.after,
      limit: options.limit,
      type: options.type,
    })
    return this.#request<DiscordUser[]>(
      "list_reaction_users",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}${query}`,
      {
        ...(options.signal ? { signal: options.signal } : {}),
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}",
        expectedSuccessStatus: 200,
      },
    )
  }

  async deleteUserReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    assertPositiveSnowflake(userId, "Discord reaction user ID")
    const encodedEmoji = encodedReactionEmoji(emoji)
    await this.#request<void>(
      "delete_user_reaction",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/${userId}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}",
        expectedSuccessStatus: 204,
      },
    )
  }

  async deleteAllMessageReactionsForEmoji(
    channelId: string,
    messageId: string,
    emoji: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    const encodedEmoji = encodedReactionEmoji(emoji)
    await this.#request<void>(
      "delete_all_message_reactions_for_emoji",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}",
        expectedSuccessStatus: 204,
      },
    )
  }

  async deleteAllMessageReactions(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertPositiveSnowflake(channelId, "Discord reaction channel ID")
    assertPositiveSnowflake(messageId, "Discord reaction message ID")
    await this.#request<void>(
      "delete_all_message_reactions",
      `/channels/${channelId}/messages/${messageId}/reactions`,
      {
        ...options,
        automaticRateLimitRetry: false,
        diagnosticRoute: "/channels/{channel.id}/messages/{message.id}/reactions",
        expectedSuccessStatus: 204,
      },
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
