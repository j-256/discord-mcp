import {
  chmod,
  mkdir,
  open,
  stat,
} from "node:fs/promises"
import { dirname } from "node:path"

import {
  CHANNEL_CREATION_KINDS,
  CONNECTOR_LIMITS,
  CONTENT_FREE_ERROR_PATTERN,
  CONTENT_FREE_IDENTIFIER_PATTERN,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  FORUM_TAG_ACTIONS,
  GUILD_TEMPLATE_REFERENCE_PATTERN,
  INVITE_REFERENCE_PATTERN,
  MEMBER_ROLE_ACTIONS,
  MEMBER_VOICE_ACTIONS,
  MEMBER_MODERATION_ACTIONS,
  SCHEMA_VERSION,
  SOUNDBOARD_ACTIONS,
  STAGE_INSTANCE_ACTIONS,
  THREAD_CHANGE_ACTIONS,
  THREAD_CREATION_MODES,
  type ChannelCreationKind,
  type ForumTagAction,
  type MemberModerationAction,
  type MemberRoleAction,
  type MemberVoiceAction,
  type SoundboardAction,
  type StageInstanceAction,
  type ThreadChangeAction,
  type ThreadCreationMode,
} from "./constants.js"
import { AuditLogError, errorMessage } from "./errors.js"
import { OPERATION_KEY_HASH_PATTERN } from "./operation-store.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"

const MAX_ACTIVITY_READ_BYTES = 1_048_576
const CHANNEL_METADATA_ACTIVITY_FIELDS: ReadonlySet<string> = new Set([
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "name",
  "nsfw",
  "rateLimitPerUser",
  "topic",
])
const ROLE_CONFIGURATION_ACTIVITY_FIELDS: ReadonlySet<string> = new Set([
  "grantPermissions",
  "hoist",
  "mentionable",
  "name",
  "primaryColor",
  "revokePermissions",
  "secondaryColor",
  "tertiaryColor",
])

export type DeletionActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "partial"
  | "pending"
  | "uncertain"

export interface DeletionActivity {
  channelId: string
  deletedMessageIds: string[]
  error: string | null
  failedMessageId: string | null
  guildId: string
  id: string
  kind: "message-deletion"
  messageIds: string[]
  observedAbsentMessageIds?: string[]
  observedPresentMessageIds?: string[]
  operationKeyHash?: string
  planDigest: string
  schemaVersion: number
  status: DeletionActivityStatus
  strategies: string[]
  timestamp: string
  verification?: "drift" | "match" | null
}

export type InteractionActivityKind =
  | "message-edit"
  | "message-send"
  | "reaction-add"
  | "reaction-remove-own"
export type InteractionActivityStatus = "completed" | "failed" | "noop" | "pending" | "uncertain"

export interface InteractionActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: InteractionActivityKind
  messageId: string | null
  nonce: string | null
  replyToMessageId: string | null
  schemaVersion: number
  status: InteractionActivityStatus
  timestamp: string
}

export type MemberModerationActivityAction = MemberModerationAction
export type MemberModerationActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface MemberModerationActivity {
  action: MemberModerationActivityAction
  deleteMessageSeconds: number | null
  durationMinutes: number | null
  error: string | null
  guildId: string
  id: string
  kind: "member-moderation"
  planDigest: string
  schemaVersion: number
  status: MemberModerationActivityStatus
  timeoutUntil: string | null
  timestamp: string
  userId: string
}

export type ChannelCreationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelCreationActivity {
  channelId: string | null
  channelKind: ChannelCreationKind
  error: string | null
  guildId: string
  id: string
  kind: "channel-create"
  operationKeyHash: string
  parentId: string | null
  planDigest: string
  schemaVersion: number
  status: ChannelCreationActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type RoleCreationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface RoleCreationActivity {
  error: string | null
  guildId: string
  id: string
  kind: "role-create"
  operationKeyHash: string
  planDigest: string
  roleId: string | null
  schemaVersion: number
  status: RoleCreationActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type RoleConfigurationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface RoleConfigurationActivity {
  error: string | null
  guildId: string
  id: string
  kind: "role-configuration"
  operationKeyHash: string
  planDigest: string
  requestedFields: string[]
  roleId: string
  schemaVersion: number
  status: RoleConfigurationActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type RoleOrderingActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface RoleOrderingActivity {
  anchorRoleId: string
  error: string | null
  guildId: string
  id: string
  kind: "role-ordering"
  operationKeyHash: string
  placement: "above" | "below"
  planDigest: string
  roleId: string
  schemaVersion: number
  status: RoleOrderingActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type PollActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface PollActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "poll-create" | "poll-end"
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: PollActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type MemberRoleActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface MemberRoleActivity {
  action: MemberRoleAction
  error: string | null
  guildId: string
  id: string
  kind: "member-role-change"
  operationKeyHash: string
  planDigest: string
  roleId: string
  schemaVersion: number
  status: MemberRoleActivityStatus
  timestamp: string
  userId: string
  verification: "drift" | "match" | null
}

export type MemberVoiceActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface MemberVoiceActivity {
  action: MemberVoiceAction
  error: string | null
  guildId: string
  id: string
  kind: "member-voice-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: MemberVoiceActivityStatus
  timestamp: string
  userId: string
  verification: "drift" | "match" | null
}

export type ThreadGovernanceActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ThreadGovernanceActivity {
  action: ThreadChangeAction
  error: string | null
  guildId: string
  id: string
  kind: "thread-governance-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ThreadGovernanceActivityStatus
  targetUserId: string | null
  threadId: string
  timestamp: string
  verification: "drift" | "match" | null
}

export type AttachmentMessageActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface AttachmentMessageActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "attachment-message-send"
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  replyToMessageId: string | null
  schemaVersion: number
  status: AttachmentMessageActivityStatus
  timestamp: string
  verification: "match" | null
}

export type ComponentMessageActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ComponentMessageActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "component-message-create" | "component-message-edit"
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  replyToMessageId: string | null
  schemaVersion: number
  status: ComponentMessageActivityStatus
  timestamp: string
  verification: "match" | null
}

export type AutoModerationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface AutoModerationActivity {
  action: "create" | "delete" | "set-enabled" | "update"
  error: string | null
  guildId: string
  id: string
  kind: "automod-change"
  operationKeyHash: string
  planDigest: string
  ruleId: string | null
  schemaVersion: number
  status: AutoModerationActivityStatus
  targetEnabled: boolean | null
  timestamp: string
  triggerType: "keyword" | "keyword-preset" | "member-profile" | "mention-spam" | "spam"
  verification: "drift" | "match" | null
}

export type ForumPostActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ForumPostActivity {
  error: string | null
  guildId: string
  id: string
  kind: "forum-post-create"
  messageId: string | null
  operationKeyHash: string
  parentChannelId: string
  planDigest: string
  schemaVersion: number
  status: ForumPostActivityStatus
  threadId: string | null
  timestamp: string
  verification: "drift" | "match" | null
}

export type ThreadCreationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ThreadCreationActivity {
  error: string | null
  guildId: string
  id: string
  kind: "thread-create"
  mode: ThreadCreationMode
  operationKeyHash: string
  parentChannelId: string
  planDigest: string
  schemaVersion: number
  sourceMessageId: string | null
  status: ThreadCreationActivityStatus
  threadId: string | null
  timestamp: string
  verification: "drift" | "match" | null
}

export type StageInstanceActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface StageInstanceActivity {
  action: StageInstanceAction
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "stage-instance-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  stageInstanceId: string | null
  status: StageInstanceActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type MessagePinActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface MessagePinActivity {
  channelId: string
  desiredState: "pinned" | "unpinned"
  error: string | null
  guildId: string
  id: string
  kind: "message-pin"
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: MessagePinActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type AnnouncementCrosspostActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface AnnouncementCrosspostActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "announcement-crosspost"
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: AnnouncementCrosspostActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type NativeInteractionCommandActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface NativeInteractionCommandActivity {
  action: "install" | "remove"
  commandId: string | null
  error: string | null
  guildId: string
  id: string
  kind: "native-interaction-command-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: NativeInteractionCommandActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type GuildTemplateActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildTemplateActivity {
  action: "create" | "delete" | "synchronize" | "update-metadata"
  error: string | null
  guildId: string
  id: string
  kind: "guild-template-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: GuildTemplateActivityStatus
  templateRef: string | null
  timestamp: string
  verification: "drift" | "match" | null
}

export type NativeInteractionActivityStatus =
  | "accepted"
  | "expired"
  | "rejected"
  | "response-completed"
  | "response-failed"
  | "response-pending"
  | "response-uncertain"

export interface NativeInteractionActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  interactionId: string
  kind: "native-interaction"
  referenceHash: string
  schemaVersion: number
  status: NativeInteractionActivityStatus
  timestamp: string
  userId: string
}

export type WebhookDeletionActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface WebhookDeletionActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "webhook-deletion"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: WebhookDeletionActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
  webhookId: string
}

export type WebhookCreationActivityStatus = WebhookDeletionActivityStatus

export interface WebhookCreationActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "webhook-creation"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: WebhookCreationActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
  webhookId: string | null
}

export type WebhookChangeActivityStatus = WebhookDeletionActivityStatus

export interface WebhookChangeActivity {
  channelId: string
  destinationChannelId: string | null
  error: string | null
  guildId: string
  id: string
  kind: "webhook-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: WebhookChangeActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
  webhookId: string
}

export type AnnouncementSubscriptionActivityStatus = WebhookDeletionActivityStatus

export interface AnnouncementSubscriptionActivity {
  action: "subscribe" | "unsubscribe"
  error: string | null
  guildId: string
  id: string
  kind: "announcement-subscription"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  sourceChannelId: string | null
  sourceGuildId: string | null
  status: AnnouncementSubscriptionActivityStatus
  targetChannelId: string
  timestamp: string
  verification: "drift" | "match" | null
  webhookId: string | null
}

export type IntegrationDeletionActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface IntegrationDeletionActivity {
  associatedBotUserId: string | null
  error: string | null
  guildId: string
  id: string
  integrationId: string
  kind: "integration-deletion"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: IntegrationDeletionActivityStatus
  targetApplicationId: string | null
  timestamp: string
  verification: "match" | null
}

export type InviteDeletionActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface InviteDeletionActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  inviteRef: string
  kind: "invite-deletion"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: InviteDeletionActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type OnboardingActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface OnboardingActivity {
  enabled: boolean
  error: string | null
  guildId: string
  id: string
  kind: "onboarding-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: OnboardingActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type GuildExpressionActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildExpressionActivity {
  action: "create" | "delete" | "update"
  error: string | null
  expressionId: string | null
  expressionKind: "emoji" | "sticker"
  guildId: string
  id: string
  kind: "guild-expression-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: GuildExpressionActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type SoundboardActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface SoundboardActivity {
  action: SoundboardAction
  error: string | null
  guildId: string
  id: string
  kind: "guild-soundboard-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  soundId: string | null
  status: SoundboardActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type WelcomeScreenActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface WelcomeScreenActivity {
  error: string | null
  guildId: string
  id: string
  kind: "welcome-screen-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: WelcomeScreenActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type WidgetSettingsActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface WidgetSettingsActivity {
  error: string | null
  guildId: string
  id: string
  kind: "widget-settings-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: WidgetSettingsActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type ScheduledEventActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ScheduledEventActivity {
  action: "create" | "delete" | "transition" | "update"
  entityType: "external" | "stage" | "voice"
  error: string | null
  eventId: string | null
  guildId: string
  id: string
  kind: "scheduled-event-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ScheduledEventActivityStatus
  targetStatus: "active" | "canceled" | "completed" | null
  timestamp: string
  verification: "drift" | "match" | null
}

export type ChannelPermissionOverwriteActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelPermissionOverwriteActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "channel-permission-overwrite"
  mode: "delete" | "update"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ChannelPermissionOverwriteActivityStatus
  targetId: string
  targetType: "member" | "role"
  timestamp: string
  verification: "drift" | "match" | null
}

export type ChannelMetadataActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelMetadataActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "channel-metadata-change"
  operationKeyHash: string
  planDigest: string
  requestedFields: string[]
  schemaVersion: number
  status: ChannelMetadataActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type ChannelOrderingActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelOrderingActivity {
  anchorChannelId: string
  baselineRevision: number
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "channel-ordering"
  observedRevision: number | null
  operationKeyHash: string
  parentChannelId: string | null
  placement: "above" | "below"
  planDigest: string
  schemaVersion: number
  status: ChannelOrderingActivityStatus
  timestamp: string
  verification: "match" | null
}

export type ForumTagActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ForumTagActivity {
  action: ForumTagAction
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "forum-tag-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ForumTagActivityStatus
  tagId: string | null
  timestamp: string
  verification: "match" | null
}

export type ReactionModerationActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

const REACTION_EMOJI_FINGERPRINT_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/

export interface ReactionModerationActivity {
  channelId: string
  customEmojiId: string | null
  emojiFingerprint: string | null
  error: string | null
  guildId: string
  id: string
  kind: "reaction-moderation"
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  scope: "all" | "emoji" | "user"
  status: ReactionModerationActivityStatus
  timestamp: string
  userId: string | null
  verification: "drift" | "match" | null
}

export type ActivityEntry =
  | AnnouncementCrosspostActivity
  | AnnouncementSubscriptionActivity
  | AttachmentMessageActivity
  | AutoModerationActivity
  | ChannelCreationActivity
  | ChannelMetadataActivity
  | ChannelOrderingActivity
  | ChannelPermissionOverwriteActivity
  | ComponentMessageActivity
  | DeletionActivity
  | ForumPostActivity
  | ForumTagActivity
  | GuildExpressionActivity
  | GuildTemplateActivity
  | InteractionActivity
  | IntegrationDeletionActivity
  | InviteDeletionActivity
  | MemberModerationActivity
  | MemberRoleActivity
  | MemberVoiceActivity
  | MessagePinActivity
  | NativeInteractionCommandActivity
  | NativeInteractionActivity
  | OnboardingActivity
  | PollActivity
  | ReactionModerationActivity
  | RoleCreationActivity
  | RoleConfigurationActivity
  | RoleOrderingActivity
  | ScheduledEventActivity
  | SoundboardActivity
  | StageInstanceActivity
  | ThreadCreationActivity
  | ThreadGovernanceActivity
  | WelcomeScreenActivity
  | WebhookChangeActivity
  | WebhookCreationActivity
  | WebhookDeletionActivity
  | WidgetSettingsActivity

export interface ActivityList {
  entries: ActivityEntry[]
  file: string
  skippedLines: number
}

export interface ActivityStore {
  append(entry: ActivityEntry): Promise<void>
  list(limit?: number): Promise<ActivityList>
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > CONNECTOR_LIMITS.activityEntries) {
    throw new AuditLogError(
      `Activity limit must be between 1 and ${CONNECTOR_LIMITS.activityEntries}`,
    )
  }
  return limit
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function positiveActivitySnowflake(value: string): boolean {
  return DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function parseDeletionActivity(value: unknown): DeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const modern = [
    "observedAbsentMessageIds",
    "observedPresentMessageIds",
    "operationKeyHash",
    "verification",
  ].some((field) => Object.hasOwn(record, field))
    || ["completed-with-drift", "uncertain"].includes(String(record.status))
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || ![undefined, "message-deletion"].includes(record.kind as string | undefined)
    || typeof record.id !== "string"
    || typeof record.timestamp !== "string"
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "partial",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.channelId !== "string"
    || typeof record.guildId !== "string"
    || typeof record.planDigest !== "string"
    || !stringArray(record.messageIds)
    || !stringArray(record.deletedMessageIds)
    || !stringArray(record.strategies)
    || !(record.error === null || typeof record.error === "string")
    || !(record.failedMessageId === null || typeof record.failedMessageId === "string")
    || (modern && (
      typeof record.operationKeyHash !== "string"
      || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
      || !stringArray(record.observedAbsentMessageIds)
      || !stringArray(record.observedPresentMessageIds)
      || ![null, "drift", "match"].includes(record.verification as string | null)
      || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
      || Number.isNaN(Date.parse(record.timestamp))
      || !positiveActivitySnowflake(record.channelId as string)
      || !positiveActivitySnowflake(record.guildId as string)
      || !(record.error === null || (
        typeof record.error === "string"
        && CONTENT_FREE_ERROR_PATTERN.test(record.error)
      ))
      || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest as string)
      || ![
        ...(record.messageIds as string[]),
        ...(record.deletedMessageIds as string[]),
        ...(record.observedAbsentMessageIds as string[]),
        ...(record.observedPresentMessageIds as string[]),
      ].every(positiveActivitySnowflake)
      || (record.status === "pending" && (
        record.error !== null
        || (record.deletedMessageIds as string[]).length !== 0
        || (record.observedAbsentMessageIds as string[]).length !== 0
        || (record.observedPresentMessageIds as string[]).length !== 0
        || record.verification !== null
      ))
      || (record.status === "completed" && record.verification !== "match")
      || (
        record.status === "completed-with-drift"
        && record.verification !== "drift"
      )
      || (["completed", "completed-with-drift"].includes(String(record.status)) && (
        (record.observedAbsentMessageIds as string[]).length
          !== (record.messageIds as string[]).length
        || (record.observedPresentMessageIds as string[]).length !== 0
      ))
      || (["failed", "partial", "uncertain"].includes(String(record.status)) && (
        record.error === null
        || record.verification !== null
      ))
    ))
  ) {
    return undefined
  }
  if (modern) {
    const messageIds = record.messageIds as string[]
    const deletedMessageIds = record.deletedMessageIds as string[]
    const observedAbsentMessageIds = record.observedAbsentMessageIds as string[]
    const observedPresentMessageIds = record.observedPresentMessageIds as string[]
    const targetIds = new Set(messageIds)
    const allEvidenceIds = [
      ...deletedMessageIds,
      ...observedAbsentMessageIds,
      ...observedPresentMessageIds,
    ]
    const observationsComplete = observedAbsentMessageIds.length
      + observedPresentMessageIds.length === messageIds.length
    const strategyCounts = (record.strategies as string[]).map((strategy) => {
      const match = /^(bulk|individual):([1-9][0-9]{0,2})$/.exec(strategy)
      if (!match) return null
      return {
        count: Number(match[2]),
        kind: match[1] as "bulk" | "individual",
      }
    })
    if (
      messageIds.length < 1
      || messageIds.length > DISCORD_LIMITS.deletionMessages
      || new Set(messageIds).size !== messageIds.length
      || new Set(deletedMessageIds).size !== deletedMessageIds.length
      || new Set(observedAbsentMessageIds).size !== observedAbsentMessageIds.length
      || new Set(observedPresentMessageIds).size !== observedPresentMessageIds.length
      || allEvidenceIds.some((messageId) => !targetIds.has(messageId))
      || observedAbsentMessageIds.some((messageId) => (
        observedPresentMessageIds.includes(messageId)
      ))
      || !(record.strategies as string[]).length
      || (record.strategies as string[]).length > 2
      || strategyCounts.some((strategy) => strategy === null)
      || new Set(strategyCounts.map((strategy) => strategy?.kind)).size
        !== strategyCounts.length
      || strategyCounts.some((strategy) => (
        strategy?.kind === "bulk" && strategy.count < 2
      ))
      || strategyCounts.reduce((total, strategy) => (
        total + (strategy?.count || 0)
      ), 0) !== messageIds.length
      || (
        record.failedMessageId !== null
        && !targetIds.has(record.failedMessageId as string)
      )
      || (record.status === "pending" && record.failedMessageId !== null)
      || (["completed", "completed-with-drift"].includes(String(record.status)) && (
        record.failedMessageId !== null
        || !observationsComplete
      ))
      || (record.status === "failed" && (
        !observationsComplete
        || observedAbsentMessageIds.length !== 0
        || observedPresentMessageIds.length !== messageIds.length
      ))
      || (record.status === "partial" && (
        !observationsComplete
        || observedAbsentMessageIds.length === 0
        || observedPresentMessageIds.length === 0
      ))
      || (record.status === "uncertain" && !(
        (
          observedAbsentMessageIds.length === 0
          && observedPresentMessageIds.length === 0
        )
        || (observationsComplete && observedPresentMessageIds.length > 0)
      ))
    ) {
      return undefined
    }
  }
  return {
    channelId: record.channelId,
    deletedMessageIds: [...record.deletedMessageIds],
    error: record.error,
    failedMessageId: record.failedMessageId,
    guildId: record.guildId,
    id: record.id,
    kind: "message-deletion",
    messageIds: [...record.messageIds],
    ...(modern
      ? {
          observedAbsentMessageIds: [...record.observedAbsentMessageIds as string[]],
          observedPresentMessageIds: [...record.observedPresentMessageIds as string[]],
          operationKeyHash: record.operationKeyHash as string,
        }
      : {}),
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as DeletionActivityStatus,
    strategies: [...record.strategies],
    timestamp: record.timestamp,
    ...(modern
      ? { verification: record.verification as "drift" | "match" | null }
      : {}),
  }
}

function parseInteractionActivity(value: unknown): InteractionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || typeof record.id !== "string"
    || typeof record.timestamp !== "string"
    || ![
      "message-edit",
      "message-send",
      "reaction-add",
      "reaction-remove-own",
    ].includes(String(record.kind))
    || !["completed", "failed", "noop", "pending", "uncertain"].includes(String(record.status))
    || typeof record.channelId !== "string"
    || typeof record.guildId !== "string"
    || !(record.messageId === null || typeof record.messageId === "string")
    || !(record.nonce === null || typeof record.nonce === "string")
    || !(record.replyToMessageId === null || typeof record.replyToMessageId === "string")
    || !(record.error === null || typeof record.error === "string")
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: record.kind as InteractionActivityKind,
    messageId: record.messageId,
    nonce: record.nonce,
    replyToMessageId: record.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as InteractionActivityStatus,
    timestamp: record.timestamp,
  }
}

function parseMemberModerationActivity(
  value: unknown,
): MemberModerationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-moderation"
    || typeof record.id !== "string"
    || typeof record.timestamp !== "string"
    || !MEMBER_MODERATION_ACTIONS.includes(record.action as MemberModerationAction)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || typeof record.userId !== "string"
    || typeof record.planDigest !== "string"
    || !(record.deleteMessageSeconds === null || typeof record.deleteMessageSeconds === "number")
    || !(record.durationMinutes === null || typeof record.durationMinutes === "number")
    || !(record.timeoutUntil === null || typeof record.timeoutUntil === "string")
    || !(record.error === null || typeof record.error === "string")
  ) {
    return undefined
  }
  return {
    action: record.action as MemberModerationActivityAction,
    deleteMessageSeconds: record.deleteMessageSeconds,
    durationMinutes: record.durationMinutes,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-moderation",
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberModerationActivityStatus,
    timeoutUntil: record.timeoutUntil,
    timestamp: record.timestamp,
    userId: record.userId,
  }
}

function parseChannelCreationActivity(
  value: unknown,
): ChannelCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-create"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !CHANNEL_CREATION_KINDS.includes(record.channelKind as ChannelCreationKind)
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.channelId === null || (
      typeof record.channelId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    ))
    || !(record.parentId === null || (
      typeof record.parentId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.parentId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.channelId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.channelId === null
      || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.channelId === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    channelKind: record.channelKind as ChannelCreationKind,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-create",
    operationKeyHash: record.operationKeyHash,
    parentId: record.parentId,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ChannelCreationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseRoleCreationActivity(
  value: unknown,
): RoleCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "role-create"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.roleId === null || (
      typeof record.roleId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.roleId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.roleId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.roleId === null
      || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.roleId === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "role-create",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    roleId: record.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as RoleCreationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseRoleConfigurationActivity(
  value: unknown,
): RoleConfigurationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "role-configuration"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.roleId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.roleId)
    || !stringArray(record.requestedFields)
    || record.requestedFields.length < 1
    || record.requestedFields.some((field) => !ROLE_CONFIGURATION_ACTIVITY_FIELDS.has(field))
    || new Set(record.requestedFields).size !== record.requestedFields.length
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "role-configuration",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    requestedFields: [...record.requestedFields].sort(),
    roleId: record.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as RoleConfigurationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseRoleOrderingActivity(
  value: unknown,
): RoleOrderingActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "role-ordering"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.roleId !== "string"
    || !positiveActivitySnowflake(record.roleId)
    || typeof record.anchorRoleId !== "string"
    || !positiveActivitySnowflake(record.anchorRoleId)
    || record.roleId === record.anchorRoleId
    || record.roleId === record.guildId
    || record.anchorRoleId === record.guildId
    || !["above", "below"].includes(String(record.placement))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    anchorRoleId: record.anchorRoleId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "role-ordering",
    operationKeyHash: record.operationKeyHash,
    placement: record.placement as "above" | "below",
    planDigest: record.planDigest,
    roleId: record.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as RoleOrderingActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parsePollActivity(value: unknown): PollActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || !["poll-create", "poll-end"].includes(String(record.kind))
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.messageId === null || (
      typeof record.messageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
      || (record.kind === "poll-create" && record.messageId !== null)
      || (record.kind === "poll-end" && record.messageId === null)
    ))
    || (record.status === "completed" && (
      record.messageId === null
      || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.messageId === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: record.kind as "poll-create" | "poll-end",
    messageId: record.messageId as string | null,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as PollActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseMemberRoleActivity(
  value: unknown,
): MemberRoleActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-role-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !MEMBER_ROLE_ACTIONS.includes(record.action as MemberRoleAction)
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.userId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.userId)
    || typeof record.roleId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.roleId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as MemberRoleAction,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-role-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    roleId: record.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberRoleActivityStatus,
    timestamp: record.timestamp,
    userId: record.userId,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseMemberVoiceActivity(
  value: unknown,
): MemberVoiceActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-voice-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !MEMBER_VOICE_ACTIONS.includes(record.action as MemberVoiceAction)
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.userId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.userId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as MemberVoiceAction,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-voice-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberVoiceActivityStatus,
    timestamp: record.timestamp,
    userId: record.userId,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseThreadGovernanceActivity(
  value: unknown,
): ThreadGovernanceActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "thread-governance-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !THREAD_CHANGE_ACTIONS.includes(record.action as ThreadChangeAction)
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.threadId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.threadId)
    || !(record.targetUserId === null || (
      typeof record.targetUserId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.targetUserId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  const membershipAction = record.action === "add-member" || record.action === "remove-member"
  if (membershipAction !== (record.targetUserId !== null)) return undefined
  return {
    action: record.action as ThreadChangeAction,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "thread-governance-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ThreadGovernanceActivityStatus,
    targetUserId: record.targetUserId as string | null,
    threadId: record.threadId,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseMessagePinActivity(
  value: unknown,
): MessagePinActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "message-pin"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["pinned", "unpinned"].includes(String(record.desiredState))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.messageId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    desiredState: record.desiredState as "pinned" | "unpinned",
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "message-pin",
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MessagePinActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseAnnouncementCrosspostActivity(
  value: unknown,
): AnnouncementCrosspostActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "announcement-crosspost"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.messageId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "announcement-crosspost",
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as AnnouncementCrosspostActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseNativeInteractionCommandActivity(
  value: unknown,
): NativeInteractionCommandActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "native-interaction-command-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["install", "remove"].includes(String(record.action))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.commandId === null || (
      typeof record.commandId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.commandId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as "install" | "remove",
    commandId: record.commandId as string | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "native-interaction-command-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as NativeInteractionCommandActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseGuildTemplateActivity(
  value: unknown,
): GuildTemplateActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-template-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "create",
      "delete",
      "synchronize",
      "update-metadata",
    ].includes(String(record.action))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.templateRef === null || (
      typeof record.templateRef === "string"
      && GUILD_TEMPLATE_REFERENCE_PATTERN.test(record.templateRef)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || record.verification !== "match"
      || record.templateRef === null
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as GuildTemplateActivity["action"],
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-template-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildTemplateActivityStatus,
    templateRef: record.templateRef as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseNativeInteractionActivity(
  value: unknown,
): NativeInteractionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = String(record.status)
  const errorStatus = ["rejected", "response-failed", "response-uncertain"].includes(status)
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "native-interaction"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "accepted",
      "expired",
      "rejected",
      "response-completed",
      "response-failed",
      "response-pending",
      "response-uncertain",
    ].includes(status)
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.userId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.userId)
    || typeof record.interactionId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.interactionId)
    || typeof record.referenceHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.referenceHash)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || (errorStatus ? record.error === null : record.error !== null)
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    interactionId: record.interactionId,
    kind: "native-interaction",
    referenceHash: record.referenceHash,
    schemaVersion: SCHEMA_VERSION,
    status: status as NativeInteractionActivityStatus,
    timestamp: record.timestamp,
    userId: record.userId,
  }
}

function parseChannelPermissionOverwriteActivity(
  value: unknown,
): ChannelPermissionOverwriteActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-permission-overwrite"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["delete", "update"].includes(String(record.mode))
    || !["member", "role"].includes(String(record.targetType))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.targetId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.targetId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-permission-overwrite",
    mode: record.mode as "delete" | "update",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ChannelPermissionOverwriteActivityStatus,
    targetId: record.targetId,
    targetType: record.targetType as "member" | "role",
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseChannelMetadataActivity(
  value: unknown,
): ChannelMetadataActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-metadata-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !stringArray(record.requestedFields)
    || record.requestedFields.length < 1
    || record.requestedFields.some((field) => !CHANNEL_METADATA_ACTIVITY_FIELDS.has(field))
    || new Set(record.requestedFields).size !== record.requestedFields.length
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-metadata-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    requestedFields: [...record.requestedFields].sort(),
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ChannelMetadataActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseChannelOrderingActivity(
  value: unknown,
): ChannelOrderingActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-ordering"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.channelId !== "string"
    || !positiveActivitySnowflake(record.channelId)
    || typeof record.anchorChannelId !== "string"
    || !positiveActivitySnowflake(record.anchorChannelId)
    || record.channelId === record.anchorChannelId
    || !(record.parentChannelId === null || (
      typeof record.parentChannelId === "string"
      && positiveActivitySnowflake(record.parentChannelId)
      && record.parentChannelId !== record.channelId
      && record.parentChannelId !== record.anchorChannelId
    ))
    || (record.placement !== "above" && record.placement !== "below")
    || !Number.isSafeInteger(record.baselineRevision)
    || (record.baselineRevision as number) < 1
    || !(record.observedRevision === null || (
      Number.isSafeInteger(record.observedRevision)
      && (record.observedRevision as number) > (record.baselineRevision as number)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.observedRevision !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || record.observedRevision === null
      || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    anchorChannelId: record.anchorChannelId,
    baselineRevision: record.baselineRevision as number,
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-ordering",
    observedRevision: record.observedRevision as number | null,
    operationKeyHash: record.operationKeyHash,
    parentChannelId: record.parentChannelId as string | null,
    placement: record.placement as "above" | "below",
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ChannelOrderingActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseForumTagActivity(
  value: unknown,
): ForumTagActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const action = record.action as ForumTagAction
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "forum-tag-change"
    || !FORUM_TAG_ACTIONS.includes(action)
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.tagId === null || (
      typeof record.tagId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.tagId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (action === "create" && (
      record.status === "completed" ? record.tagId === null : record.tagId !== null
    ))
    || (action !== "create" && record.tagId === null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action,
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "forum-tag-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ForumTagActivityStatus,
    tagId: record.tagId as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseWebhookDeletionActivity(
  value: unknown,
): WebhookDeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "webhook-deletion"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.webhookId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.webhookId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "webhook-deletion",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as WebhookDeletionActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
    webhookId: record.webhookId,
  }
}

function parseWebhookCreationActivity(
  value: unknown,
): WebhookCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "webhook-creation"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.webhookId === null || (
      typeof record.webhookId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.webhookId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
      || record.webhookId !== null
    ))
    || (record.status === "completed" && (
      record.verification !== "match"
      || typeof record.webhookId !== "string"
    ))
    || (record.status === "completed-with-drift" && (
      record.verification !== "drift"
      || typeof record.webhookId !== "string"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "webhook-creation",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as WebhookCreationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
    webhookId: record.webhookId as string | null,
  }
}

function parseWebhookChangeActivity(
  value: unknown,
): WebhookChangeActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "webhook-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.destinationChannelId === null || (
      typeof record.destinationChannelId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.destinationChannelId)
    ))
    || typeof record.webhookId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.webhookId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    channelId: record.channelId,
    destinationChannelId: record.destinationChannelId as string | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "webhook-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as WebhookChangeActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
    webhookId: record.webhookId,
  }
}

function parseAnnouncementSubscriptionActivity(
  value: unknown,
): AnnouncementSubscriptionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const action = record.action
  const sourceIdentityValid = (
    record.sourceChannelId === null && record.sourceGuildId === null
  ) || (
    typeof record.sourceChannelId === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(record.sourceChannelId)
    && typeof record.sourceGuildId === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(record.sourceGuildId)
  )
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "announcement-subscription"
    || !["subscribe", "unsubscribe"].includes(String(action))
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.targetChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.targetChannelId)
    || !sourceIdentityValid
    || (action === "subscribe" && record.sourceChannelId === null)
    || !(record.webhookId === null || (
      typeof record.webhookId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.webhookId)
    ))
    || (action === "unsubscribe" && record.webhookId === null)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
      || (action === "subscribe" && record.webhookId !== null)
    ))
    || (record.status === "completed" && (
      record.verification !== "match"
      || typeof record.webhookId !== "string"
    ))
    || (record.status === "completed-with-drift" && (
      record.verification !== "drift"
      || typeof record.webhookId !== "string"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    action: action as AnnouncementSubscriptionActivity["action"],
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "announcement-subscription",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    sourceChannelId: record.sourceChannelId as string | null,
    sourceGuildId: record.sourceGuildId as string | null,
    status: record.status as AnnouncementSubscriptionActivityStatus,
    targetChannelId: record.targetChannelId,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
    webhookId: record.webhookId as string | null,
  }
}

function parseIntegrationDeletionActivity(
  value: unknown,
): IntegrationDeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "integration-deletion"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.integrationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.integrationId)
    || !(record.targetApplicationId === null || (
      typeof record.targetApplicationId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.targetApplicationId)
    ))
    || !(record.associatedBotUserId === null || (
      typeof record.associatedBotUserId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.associatedBotUserId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    associatedBotUserId: record.associatedBotUserId as string | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    integrationId: record.integrationId,
    kind: "integration-deletion",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as IntegrationDeletionActivityStatus,
    targetApplicationId: record.targetApplicationId as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseReactionModerationActivity(
  value: unknown,
): ReactionModerationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "reaction-moderation"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || !["all", "emoji", "user"].includes(String(record.scope))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.messageId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    || !(record.customEmojiId === null || (
      typeof record.customEmojiId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.customEmojiId)
    ))
    || !(record.userId === null || (
      typeof record.userId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.userId)
    ))
    || !(record.emojiFingerprint === null || (
      typeof record.emojiFingerprint === "string"
      && REACTION_EMOJI_FINGERPRINT_PATTERN.test(record.emojiFingerprint)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.scope === "all" && (
      record.customEmojiId !== null
      || record.emojiFingerprint !== null
      || record.userId !== null
    ))
    || (record.scope === "emoji" && (
      record.emojiFingerprint === null
      || record.userId !== null
    ))
    || (record.scope === "user" && (
      record.emojiFingerprint === null
      || record.userId === null
    ))
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || !["drift", "match"].includes(String(record.verification))
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    customEmojiId: record.customEmojiId as string | null,
    emojiFingerprint: record.emojiFingerprint as string | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "reaction-moderation",
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    scope: record.scope as ReactionModerationActivity["scope"],
    status: record.status as ReactionModerationActivityStatus,
    timestamp: record.timestamp,
    userId: record.userId as string | null,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseInviteDeletionActivity(
  value: unknown,
): InviteDeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "invite-deletion"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.inviteRef !== "string"
    || !INVITE_REFERENCE_PATTERN.test(record.inviteRef)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    inviteRef: record.inviteRef,
    kind: "invite-deletion",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as InviteDeletionActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseOnboardingActivity(
  value: unknown,
): OnboardingActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "onboarding-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.enabled !== "boolean"
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    enabled: record.enabled,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "onboarding-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as OnboardingActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseGuildExpressionActivity(
  value: unknown,
): GuildExpressionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-expression-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["create", "delete", "update"].includes(String(record.action))
    || !["emoji", "sticker"].includes(String(record.expressionKind))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.expressionId === null || (
      typeof record.expressionId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.expressionId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.action === "create" ? record.expressionId !== null : record.expressionId === null
    ))
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (["completed", "completed-with-drift"].includes(String(record.status)) && (
      record.expressionId === null
      || record.verification !== (record.status === "completed" ? "match" : "drift")
    ))
    || (record.status === "failed" && (
      record.error === null
      || record.verification !== null
      || (record.action === "create" ? record.expressionId !== null : record.expressionId === null)
    ))
    || (record.status === "uncertain" && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as GuildExpressionActivity["action"],
    error: record.error,
    expressionId: record.expressionId,
    expressionKind: record.expressionKind as GuildExpressionActivity["expressionKind"],
    guildId: record.guildId,
    id: record.id,
    kind: "guild-expression-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildExpressionActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseScheduledEventActivity(
  value: unknown,
): ScheduledEventActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "scheduled-event-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["create", "delete", "transition", "update"].includes(String(record.action))
    || !["external", "stage", "voice"].includes(String(record.entityType))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.eventId === null || (
      typeof record.eventId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.eventId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "active", "canceled", "completed"].includes(
      record.targetStatus as string | null,
    )
    || (
      record.action === "transition"
        ? record.targetStatus === null
        : record.targetStatus !== null
    )
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.action === "create" ? record.eventId !== null : record.eventId === null
    ))
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (["completed", "completed-with-drift"].includes(String(record.status)) && (
      record.eventId === null
      || record.error !== null
      || record.verification !== (record.status === "completed" ? "match" : "drift")
    ))
    || (record.status === "failed" && (
      record.error === null
      || record.verification !== null
      || (record.action === "create" ? record.eventId !== null : record.eventId === null)
    ))
    || (record.status === "uncertain" && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as ScheduledEventActivity["action"],
    entityType: record.entityType as ScheduledEventActivity["entityType"],
    error: record.error,
    eventId: record.eventId,
    guildId: record.guildId,
    id: record.id,
    kind: "scheduled-event-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ScheduledEventActivityStatus,
    targetStatus: record.targetStatus as ScheduledEventActivity["targetStatus"],
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseSoundboardActivity(
  value: unknown,
): SoundboardActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const action = record.action as SoundboardAction
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-soundboard-change"
    || !SOUNDBOARD_ACTIONS.includes(action)
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.soundId === null || (
      typeof record.soundId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.soundId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      action === "create" ? record.soundId !== null : record.soundId === null
    ))
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (["completed", "completed-with-drift"].includes(String(record.status)) && (
      record.soundId === null
      || record.error !== null
      || record.verification !== (record.status === "completed" ? "match" : "drift")
    ))
    || (record.status === "failed" && (
      record.error === null
      || record.verification !== null
      || (action === "create" ? record.soundId !== null : record.soundId === null)
    ))
    || (record.status === "uncertain" && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-soundboard-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    soundId: record.soundId as string | null,
    status: record.status as SoundboardActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseWelcomeScreenActivity(
  value: unknown,
): WelcomeScreenActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "welcome-screen-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.error !== null || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "welcome-screen-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as WelcomeScreenActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseWidgetSettingsActivity(
  value: unknown,
): WidgetSettingsActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "widget-settings-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.error !== null || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "widget-settings-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as WidgetSettingsActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseAutoModerationActivity(
  value: unknown,
): AutoModerationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "automod-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["create", "delete", "set-enabled", "update"].includes(String(record.action))
    || ![
      "keyword",
      "keyword-preset",
      "member-profile",
      "mention-spam",
      "spam",
    ].includes(String(record.triggerType))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.ruleId === null || (
      typeof record.ruleId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.ruleId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || !(record.targetEnabled === null || typeof record.targetEnabled === "boolean")
    || (
      record.action === "set-enabled"
        ? typeof record.targetEnabled !== "boolean"
        : record.targetEnabled !== null
    )
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.action === "create" ? record.ruleId !== null : record.ruleId === null
    ))
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (["completed", "completed-with-drift"].includes(String(record.status)) && (
      record.ruleId === null
      || record.verification !== (record.status === "completed" ? "match" : "drift")
    ))
    || (record.status === "failed" && (
      record.error === null
      || record.verification !== null
      || (record.action === "create" ? record.ruleId !== null : record.ruleId === null)
    ))
    || (record.status === "uncertain" && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as AutoModerationActivity["action"],
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "automod-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    ruleId: record.ruleId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as AutoModerationActivityStatus,
    targetEnabled: record.targetEnabled as boolean | null,
    timestamp: record.timestamp,
    triggerType: record.triggerType as AutoModerationActivity["triggerType"],
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseAttachmentMessageActivity(
  value: unknown,
): AttachmentMessageActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "attachment-message-send"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.messageId === null || (
      typeof record.messageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    ))
    || !(record.replyToMessageId === null || (
      typeof record.replyToMessageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.replyToMessageId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.messageId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.messageId === null
      || record.verification !== "match"
    ))
    || (record.status === "failed" && (
      record.messageId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "attachment-message-send",
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    replyToMessageId: record.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as AttachmentMessageActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseComponentMessageActivity(
  value: unknown,
): ComponentMessageActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || !["component-message-create", "component-message-edit"].includes(String(record.kind))
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.messageId === null || (
      typeof record.messageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    ))
    || !(record.replyToMessageId === null || (
      typeof record.replyToMessageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.replyToMessageId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (record.kind === "component-message-edit" && record.replyToMessageId !== null)
    || (record.status === "pending" && (
      record.messageId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.messageId === null
      || record.error !== null
      || record.verification !== "match"
    ))
    || (record.status === "failed" && (
      record.messageId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: record.kind as ComponentMessageActivity["kind"],
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    replyToMessageId: record.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ComponentMessageActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseForumPostActivity(value: unknown): ForumPostActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const terminalIdsValid = record.threadId === null
    ? record.messageId === null
    : (
        typeof record.threadId === "string"
        && DISCORD_SNOWFLAKE_PATTERN.test(record.threadId)
        && record.messageId === record.threadId
      )
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "forum-post-create"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.parentChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.parentChannelId)
    || !terminalIdsValid
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.threadId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.threadId === null
      || record.verification !== "match"
      || record.error !== null
    ))
    || (record.status === "completed-with-drift" && (
      record.threadId === null
      || record.verification !== "drift"
      || record.error !== null
    ))
    || (record.status === "failed" && (
      record.threadId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "forum-post-create",
    messageId: record.messageId as string | null,
    operationKeyHash: record.operationKeyHash,
    parentChannelId: record.parentChannelId,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ForumPostActivityStatus,
    threadId: record.threadId as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseThreadCreationActivity(
  value: unknown,
): ThreadCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const mode = record.mode as ThreadCreationMode
  const sourceMessageIdValid = mode === "from-message"
    ? typeof record.sourceMessageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.sourceMessageId)
    : record.sourceMessageId === null
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "thread-create"
    || !THREAD_CREATION_MODES.includes(mode)
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.parentChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.parentChannelId)
    || !sourceMessageIdValid
    || !(record.threadId === null || (
      typeof record.threadId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.threadId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.threadId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.threadId === null
      || record.verification !== "match"
      || record.error !== null
    ))
    || (record.status === "completed-with-drift" && (
      record.threadId === null
      || record.verification !== "drift"
      || record.error !== null
    ))
    || (record.status === "failed" && (
      record.threadId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "thread-create",
    mode,
    operationKeyHash: record.operationKeyHash,
    parentChannelId: record.parentChannelId,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    sourceMessageId: record.sourceMessageId as string | null,
    status: record.status as ThreadCreationActivityStatus,
    threadId: record.threadId as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseStageInstanceActivity(
  value: unknown,
): StageInstanceActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const action = record.action as StageInstanceAction
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "stage-instance-change"
    || !STAGE_INSTANCE_ACTIONS.includes(action)
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.stageInstanceId === null || (
      typeof record.stageInstanceId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.stageInstanceId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.stageInstanceId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.stageInstanceId === null
      || record.verification !== "match"
      || record.error !== null
    ))
    || (record.status === "completed-with-drift" && (
      record.stageInstanceId === null
      || record.verification !== "drift"
      || record.error !== null
    ))
    || (record.status === "failed" && (
      record.stageInstanceId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action,
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "stage-instance-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    stageInstanceId: record.stageInstanceId as string | null,
    status: record.status as StageInstanceActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseActivityEntry(value: unknown): ActivityEntry | undefined {
  return parseAnnouncementCrosspostActivity(value)
    || parseAnnouncementSubscriptionActivity(value)
    || parseNativeInteractionCommandActivity(value)
    || parseGuildTemplateActivity(value)
    || parseNativeInteractionActivity(value)
    || parseAttachmentMessageActivity(value)
    || parseComponentMessageActivity(value)
    || parseAutoModerationActivity(value)
    || parseForumPostActivity(value)
    || parseThreadCreationActivity(value)
    || parseStageInstanceActivity(value)
    || parseChannelCreationActivity(value)
    || parseChannelMetadataActivity(value)
    || parseChannelOrderingActivity(value)
    || parseForumTagActivity(value)
    || parseChannelPermissionOverwriteActivity(value)
    || parseMessagePinActivity(value)
    || parseGuildExpressionActivity(value)
    || parseScheduledEventActivity(value)
    || parseSoundboardActivity(value)
    || parseWelcomeScreenActivity(value)
    || parseWidgetSettingsActivity(value)
    || parseWebhookCreationActivity(value)
    || parseWebhookChangeActivity(value)
    || parseWebhookDeletionActivity(value)
    || parseIntegrationDeletionActivity(value)
    || parseReactionModerationActivity(value)
    || parseInviteDeletionActivity(value)
    || parseOnboardingActivity(value)
    || parseMemberRoleActivity(value)
    || parseMemberVoiceActivity(value)
    || parseThreadGovernanceActivity(value)
    || parseRoleCreationActivity(value)
    || parseRoleConfigurationActivity(value)
    || parseRoleOrderingActivity(value)
    || parsePollActivity(value)
    || parseDeletionActivity(value)
    || parseInteractionActivity(value)
    || parseMemberModerationActivity(value)
}

export class JsonlActivityLog implements ActivityStore {
  readonly #file: string

  constructor(file: string) {
    this.#file = file
  }

  async append(entry: ActivityEntry): Promise<void> {
    const normalized = parseActivityEntry(entry)
    if (!normalized) {
      throw new AuditLogError("Discord activity has an invalid content-free shape")
    }
    try {
      await mkdir(dirname(this.#file), { mode: 0o700, recursive: true })
      const handle = await open(this.#file, "a", 0o600)
      try {
        await handle.appendFile(`${JSON.stringify(normalized)}\n`, "utf8")
      } finally {
        await handle.close()
      }
      await chmod(this.#file, 0o600)
    } catch (error) {
      throw new AuditLogError(
        `Unable to append Discord activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  async list(limit = 25): Promise<ActivityList> {
    const normalizedLimit = boundedLimit(limit)
    let fileSize: number
    try {
      fileSize = (await stat(this.#file)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { entries: [], file: this.#file, skippedLines: 0 }
      }
      throw new AuditLogError(
        `Unable to inspect Discord activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }

    const readBytes = Math.min(fileSize, MAX_ACTIVITY_READ_BYTES)
    const offset = Math.max(0, fileSize - readBytes)
    try {
      const handle = await open(this.#file, "r")
      let text: string
      try {
        const buffer = Buffer.alloc(readBytes)
        const { bytesRead } = await handle.read(buffer, 0, readBytes, offset)
        text = buffer.subarray(0, bytesRead).toString("utf8")
      } finally {
        await handle.close()
      }

      const lines = text.split("\n")
      if (offset > 0) lines.shift()
      const entries: ActivityEntry[] = []
      let skippedLines = 0
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const value: unknown = JSON.parse(line)
          const entry = parseActivityEntry(value)
          if (entry) entries.push(entry)
          else skippedLines += 1
        } catch {
          skippedLines += 1
        }
      }
      return {
        entries: entries.slice(-normalizedLimit).reverse(),
        file: this.#file,
        skippedLines,
      }
    } catch (error) {
      if (error instanceof AuditLogError) throw error
      throw new AuditLogError(
        `Unable to read Discord activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }
}
