import {
  chmod,
  mkdir,
  open,
  stat,
} from "node:fs/promises"
import { dirname } from "node:path"

import {
  ADMINISTRATION_LIMITS,
  CHANNEL_CREATION_KINDS,
  CONNECTOR_LIMITS,
  CONTENT_FREE_ERROR_PATTERN,
  CONTENT_FREE_IDENTIFIER_PATTERN,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  FORUM_TAG_ACTIONS,
  GUILD_INCIDENT_ACTION_FIELDS,
  GUILD_PROFILE_FIELDS,
  GUILD_SETTINGS_FIELDS,
  GUILD_COMMUNITY_CHANGE_FIELDS,
  type GuildCommunityChangeField,
  GUILD_TEMPLATE_REFERENCE_PATTERN,
  INVITE_REFERENCE_PATTERN,
  MEMBER_ROLE_ACTIONS,
  MEMBER_VOICE_ACTIONS,
  MEMBER_MODERATION_ACTIONS,
  NATIVE_INTERACTION_DEFAULTS,
  SCHEMA_VERSION,
  SOUNDBOARD_ACTIONS,
  STAGE_INSTANCE_ACTIONS,
  THREAD_CHANGE_ACTIONS,
  THREAD_CREATION_MODES,
  type ChannelCreationKind,
  type ForumTagAction,
  type GuildIncidentActionField,
  type GuildProfileField,
  type GuildSettingsField,
  type MemberModerationAction,
  type MemberRoleAction,
  type MemberVoiceAction,
  type SoundboardAction,
  type StageInstanceAction,
  type ThreadChangeAction,
  type ThreadCreationMode,
} from "./constants.js"
import { AuditLogError, errorMessage } from "./errors.js"
import {
  GUILD_APPLICATION_COMMAND_TYPES,
  type GuildApplicationCommandType,
} from "./guild-application-command-definition.js"
import {
  GLOBAL_APPLICATION_COMMAND_TYPES,
  type GlobalApplicationCommandType,
} from "./global-application-command-definition.js"
import {
  APPLICATION_ENTITLEMENT_OPERATION_ACTIONS,
  DIRECT_MESSAGE_ACTIONS,
  DIRECT_MESSAGE_FORMATS,
  ENTITLEMENT_FULFILLMENT_REFERENCE_HASH_PATTERN,
  OPERATION_KEY_HASH_PATTERN,
  type DirectMessageAction,
  type DirectMessageFormat,
  type DirectMessageReceiptStage,
} from "./operation-store.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"
import {
  REQUEST_BUTTON_LIMITS,
  REQUEST_BUTTON_STYLES,
  type RequestButtonStyle,
} from "./request-button.js"

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
  "roleIcon",
  "secondaryColor",
  "tertiaryColor",
])
const GUILD_SETTINGS_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "requestedFields",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
])
const GUILD_COMMUNITY_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "changedFields",
  "enablementRequired",
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "publicUpdatesChannelId",
  "rulesChannelId",
  "safetyAlertsChannelId",
  "schemaVersion",
  "stateDigest",
  "status",
  "timestamp",
  "verification",
])
const GUILD_PROFILE_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "requestedFields",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
])
const GUILD_DEPARTURE_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "applicationId",
  "botId",
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
])
const DIRECT_MESSAGE_ACTIVITY_KEYS = [
  "action",
  "channelId",
  "error",
  "id",
  "kind",
  "messageFormat",
  "messageId",
  "operationKeyHash",
  "planDigest",
  "recipientId",
  "replyToMessageId",
  "requestDigest",
  "schemaVersion",
  "stage",
  "status",
  "timestamp",
  "verification",
].sort()
const GUILD_APPLICATION_COMMAND_ACTIVITY_KEYS = [
  "action",
  "applicationId",
  "botId",
  "commandId",
  "commandType",
  "desiredDefinitionDigest",
  "error",
  "existingDefinitionDigest",
  "guildId",
  "id",
  "inventoryDigest",
  "kind",
  "operationKeyHash",
  "permissionDigest",
  "planDigest",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
].sort()
const GLOBAL_APPLICATION_COMMAND_ACTIVITY_KEYS = [
  "action",
  "applicationId",
  "botId",
  "commandId",
  "commandType",
  "desiredDefinitionDigest",
  "error",
  "existingDefinitionDigest",
  "id",
  "inventoryDigest",
  "kind",
  "operationKeyHash",
  "planDigest",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
].sort()
const GUILD_INCIDENT_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "requestedFields",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
])
const MEMBER_MODERATION_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "action",
  "deleteMessageSeconds",
  "durationMinutes",
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "schemaVersion",
  "status",
  "timeoutUntil",
  "timestamp",
  "userId",
  "verification",
])
const BULK_GUILD_BAN_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "deleteMessageSeconds",
  "error",
  "guildId",
  "id",
  "kind",
  "observedBannedUserIds",
  "observedNotBannedUserIds",
  "operationKeyHash",
  "planDigest",
  "requestedUserIds",
  "responseBannedUserIds",
  "responseFailedUserIds",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
])
const GUILD_PRUNE_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "actualPrunedCount",
  "days",
  "error",
  "guildId",
  "id",
  "includeRoleIds",
  "kind",
  "maximumEstimatedMemberCount",
  "operationKeyHash",
  "planDigest",
  "policyMaximumMemberCount",
  "reviewedEstimatedMemberCount",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
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
  | "command-processing-signal"
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
  | "completed-with-drift"
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
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: MemberModerationActivityStatus
  timeoutUntil: string | null
  timestamp: string
  userId: string
  verification: "drift" | "match" | null
}

export type BulkGuildBanActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "partial"
  | "partial-with-drift"
  | "pending"
  | "uncertain"

export interface BulkGuildBanActivity {
  deleteMessageSeconds: number
  error: string | null
  guildId: string
  id: string
  kind: "bulk-guild-ban"
  observedBannedUserIds: string[]
  observedNotBannedUserIds: string[]
  operationKeyHash: string
  planDigest: string
  requestedUserIds: string[]
  responseBannedUserIds: string[]
  responseFailedUserIds: string[]
  schemaVersion: number
  status: BulkGuildBanActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type GuildPruneActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildPruneActivity {
  actualPrunedCount: number | null
  days: number
  error: string | null
  guildId: string
  id: string
  includeRoleIds: string[]
  kind: "guild-prune"
  maximumEstimatedMemberCount: number
  operationKeyHash: string
  planDigest: string
  policyMaximumMemberCount: number
  reviewedEstimatedMemberCount: number
  schemaVersion: number
  status: GuildPruneActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
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

export type MemberNicknameActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface MemberNicknameActivity {
  error: string | null
  guildId: string
  id: string
  kind: "member-nickname-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: MemberNicknameActivityStatus
  targetKind: "current-bot" | "member"
  timestamp: string
  userId: string
  verification: "drift" | "match" | null
}

export type MemberVerificationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface MemberVerificationActivity {
  desiredBypassesVerification: boolean
  error: string | null
  guildId: string
  id: string
  kind: "member-verification-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: MemberVerificationActivityStatus
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

export type EmbedMessageActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface EmbedMessageActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "embed-message-create" | "embed-message-edit"
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  replyToMessageId: string | null
  schemaVersion: number
  status: EmbedMessageActivityStatus
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

export type DirectMessageActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface DirectMessageActivity {
  action: DirectMessageAction
  channelId: string | null
  error: string | null
  id: string
  kind: "direct-message-change"
  messageFormat: DirectMessageFormat | null
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  recipientId: string
  replyToMessageId: string | null
  requestDigest: string
  schemaVersion: number
  stage: DirectMessageReceiptStage
  status: DirectMessageActivityStatus
  timestamp: string
  verification: "match" | null
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

export type MessageForwardActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface MessageForwardActivity {
  error: string | null
  id: string
  kind: "message-forward"
  nonce: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  sourceChannelId: string
  sourceGuildId: string
  sourceMessageId: string
  status: MessageForwardActivityStatus
  targetChannelId: string
  targetGuildId: string
  targetMessageId: string | null
  timestamp: string
  verification: "match" | null
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

export type GuildApplicationCommandActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildApplicationCommandActivity {
  action: "create" | "delete" | "update"
  applicationId: string
  botId: string
  commandId: string | null
  commandType: GuildApplicationCommandType
  desiredDefinitionDigest: string | null
  error: string | null
  existingDefinitionDigest: string | null
  guildId: string
  id: string
  inventoryDigest: string
  kind: "guild-application-command-change"
  operationKeyHash: string
  permissionDigest: string
  planDigest: string
  schemaVersion: number
  status: GuildApplicationCommandActivityStatus
  timestamp: string
  verification: "match" | null
}

export type GlobalApplicationCommandActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface GlobalApplicationCommandActivity {
  action: "create" | "delete" | "update"
  applicationId: string
  botId: string
  commandId: string | null
  commandType: GlobalApplicationCommandType
  desiredDefinitionDigest: string | null
  error: string | null
  existingDefinitionDigest: string | null
  id: string
  inventoryDigest: string
  kind: "global-application-command-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: GlobalApplicationCommandActivityStatus
  timestamp: string
  verification: "match" | null
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
  | "continuation-expired"
  | "continuation-opened"
  | "expired"
  | "followup-completed"
  | "followup-failed"
  | "followup-pending"
  | "followup-uncertain"
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
  requestButtonIndex?: number | null
  requestButtonStyle?: RequestButtonStyle | null
  responseStage: "continuation" | "followup" | "initial"
  schemaVersion: number
  sequence: number
  status: NativeInteractionActivityStatus
  source?: "command" | "request-button"
  sourceMessageId?: string | null
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

export type WebhookMessageActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface WebhookMessageActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "webhook-message-deletion" | "webhook-message-edit" | "webhook-message-send"
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: WebhookMessageActivityStatus
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

export type GuildDepartureActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildDepartureActivity {
  applicationId: string
  botId: string
  error: string | null
  guildId: string
  id: string
  kind: "guild-departure"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: GuildDepartureActivityStatus
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

export type InviteCreationActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface InviteCreationActivity {
  capabilityFileWritten: boolean
  channelId: string
  error: string | null
  guildId: string
  id: string
  inviteRef: string | null
  kind: "invite-creation"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: InviteCreationActivityStatus
  timestamp: string
  verification: "match" | null
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

export type ApplicationEmojiActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ApplicationEmojiActivity {
  action: "create" | "delete" | "rename"
  applicationId: string
  emojiId: string | null
  error: string | null
  id: string
  kind: "application-emoji-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ApplicationEmojiActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type ApplicationEntitlementActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ApplicationEntitlementActivity {
  action: "consume" | "create-test" | "delete-test"
  applicationId: string
  beneficiaryId: string
  beneficiaryType: "guild" | "user"
  creationOperationKeyHash: string | null
  entitlementId: string | null
  error: string | null
  fulfillmentReferenceHash: string | null
  id: string
  kind: "application-entitlement-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  skuId: string
  stage: "reserved" | "target-known" | "terminal"
  status: ApplicationEntitlementActivityStatus
  timestamp: string
  verification: "match" | null
}

export type ApplicationIntentActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ApplicationIntentActivity {
  applicationId: string
  botId: string
  error: string | null
  id: string
  intent: "guild-members" | "message-content"
  kind: "application-intent-enablement"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ApplicationIntentActivityStatus
  timestamp: string
  verification: "match" | null
}

export type BotProfileActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface BotProfileActivity {
  applicationId: string
  avatarChanged: boolean
  bannerChanged: boolean
  botId: string
  error: string | null
  id: string
  kind: "bot-profile-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: BotProfileActivityStatus
  timestamp: string
  usernameChanged: boolean
  verification: "match" | null
}

export type ApplicationRoleConnectionMetadataActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ApplicationRoleConnectionMetadataActivity {
  action: "clear" | "replace"
  addedRecordCount: number
  applicationId: string
  botId: string
  changedRecordCount: number
  currentRecordCount: number
  desiredRecordCount: number
  error: string | null
  id: string
  kind: "application-role-connection-metadata-change"
  operationKeyHash: string
  planDigest: string
  removedRecordCount: number
  reordered: boolean
  schemaVersion: number
  status: ApplicationRoleConnectionMetadataActivityStatus
  timestamp: string
  verification: "match" | null
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

export type SoundboardPlaybackActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface SoundboardPlaybackActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "soundboard-playback"
  operationKeyHash: string
  requestDigest: string
  schemaVersion: number
  soundId: string
  sourceGuildId: string | null
  status: SoundboardPlaybackActivityStatus
  timestamp: string
  verification: "gateway-match" | "response-only" | null
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

export type GuildSettingsActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildSettingsActivity {
  error: string | null
  guildId: string
  id: string
  kind: "guild-settings-change"
  operationKeyHash: string
  planDigest: string
  requestedFields: GuildSettingsField[]
  schemaVersion: number
  status: GuildSettingsActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type GuildCommunityActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildCommunityActivity {
  changedFields: GuildCommunityChangeField[]
  enablementRequired: boolean
  error: string | null
  guildId: string
  id: string
  kind: "guild-community-change"
  operationKeyHash: string
  planDigest: string
  publicUpdatesChannelId: string
  rulesChannelId: string
  safetyAlertsChannelId: string | null
  schemaVersion: number
  stateDigest: string
  status: GuildCommunityActivityStatus
  timestamp: string
  verification: "match" | null
}

export type GuildProfileActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildProfileActivity {
  error: string | null
  guildId: string
  id: string
  kind: "guild-profile-change"
  operationKeyHash: string
  planDigest: string
  requestedFields: GuildProfileField[]
  schemaVersion: number
  status: GuildProfileActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type GuildIncidentActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface GuildIncidentActivity {
  error: string | null
  guildId: string
  id: string
  kind: "guild-incident-action-change"
  operationKeyHash: string
  planDigest: string
  requestedFields: GuildIncidentActionField[]
  schemaVersion: number
  status: GuildIncidentActivityStatus
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

export type ChannelPermissionSyncActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelPermissionSyncActivity {
  applicationId: string
  botId: string
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "channel-permission-sync"
  operationKeyHash: string
  parentChannelId: string
  planDigest: string
  schemaVersion: number
  status: ChannelPermissionSyncActivityStatus
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

export type VoiceChannelStatusActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface VoiceChannelStatusActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "voice-channel-status-change"
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: VoiceChannelStatusActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type ChannelCloneActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelCloneActivity {
  baselineRevision: number
  channelType: number
  createdChannelId: string | null
  error: string | null
  guildId: string
  id: string
  kind: "channel-clone"
  observedRevision: number | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  sourceChannelId: string
  status: ChannelCloneActivityStatus
  timestamp: string
  verification: "match" | null
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
  destinationParentChannelId: string | null
  error: string | null
  guildId: string
  id: string
  kind: "channel-ordering"
  observedRevision: number | null
  operationKeyHash: string
  placement: "above" | "below"
  planDigest: string
  schemaVersion: number
  sourceParentChannelId: string | null
  status: ChannelOrderingActivityStatus
  timestamp: string
  verification: "match" | null
}

export type ChannelDeletionActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelDeletionActivity {
  baselineChannelCount: number
  baselineRevision: number
  channelId: string
  dependencyCount: number
  error: string | null
  guildId: string
  id: string
  kind: "channel-deletion"
  observedRevision: number | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: ChannelDeletionActivityStatus
  targetKind: "category" | "forum" | "media" | "stage" | "text" | "voice"
  timestamp: string
  verification: "drift" | "match" | null
}

export type RoleDeletionActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface RoleDeletionActivity {
  baselineRoleCount: number
  blockerCount: number
  error: string | null
  guildId: string
  id: string
  kind: "role-deletion"
  memberCount: number
  observedRoleCount: number | null
  operationKeyHash: string
  planDigest: string
  roleId: string
  schemaVersion: number
  status: RoleDeletionActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
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
  | ApplicationEntitlementActivity
  | AnnouncementSubscriptionActivity
  | ApplicationEmojiActivity
  | ApplicationIntentActivity
  | ApplicationRoleConnectionMetadataActivity
  | AttachmentMessageActivity
  | AutoModerationActivity
  | BotProfileActivity
  | BulkGuildBanActivity
  | ChannelCloneActivity
  | ChannelCreationActivity
  | ChannelDeletionActivity
  | ChannelMetadataActivity
  | ChannelOrderingActivity
  | ChannelPermissionOverwriteActivity
  | ChannelPermissionSyncActivity
  | ComponentMessageActivity
  | EmbedMessageActivity
  | DeletionActivity
  | DirectMessageActivity
  | ForumPostActivity
  | ForumTagActivity
  | GlobalApplicationCommandActivity
  | GuildApplicationCommandActivity
  | GuildCommunityActivity
  | GuildDepartureActivity
  | GuildExpressionActivity
  | GuildIncidentActivity
  | GuildProfileActivity
  | GuildPruneActivity
  | GuildSettingsActivity
  | GuildTemplateActivity
  | InteractionActivity
  | IntegrationDeletionActivity
  | InviteCreationActivity
  | InviteDeletionActivity
  | MemberModerationActivity
  | MemberNicknameActivity
  | MemberRoleActivity
  | MemberVerificationActivity
  | MemberVoiceActivity
  | MessagePinActivity
  | MessageForwardActivity
  | NativeInteractionCommandActivity
  | NativeInteractionActivity
  | OnboardingActivity
  | PollActivity
  | ReactionModerationActivity
  | RoleCreationActivity
  | RoleConfigurationActivity
  | RoleDeletionActivity
  | RoleOrderingActivity
  | ScheduledEventActivity
  | SoundboardActivity
  | SoundboardPlaybackActivity
  | StageInstanceActivity
  | ThreadCreationActivity
  | ThreadGovernanceActivity
  | WelcomeScreenActivity
  | WebhookChangeActivity
  | WebhookCreationActivity
  | WebhookDeletionActivity
  | WebhookMessageActivity
  | WidgetSettingsActivity
  | VoiceChannelStatusActivity

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

function compareActivitySnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function canonicalActivitySnowflakeIds(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || value.some((entry) => typeof entry !== "string" || !positiveActivitySnowflake(entry))
    || new Set(value).size !== value.length
  ) {
    return false
  }
  return JSON.stringify(value) === JSON.stringify([...value].sort(compareActivitySnowflakes))
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
      "command-processing-signal",
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
  const status = String(record.status)
  const validActionParameters = record.action === "ban"
    ? Number.isInteger(record.deleteMessageSeconds)
      && (record.deleteMessageSeconds as number) >= 0
      && (record.deleteMessageSeconds as number) <= DISCORD_LIMITS.banDeleteMessageSeconds
      && record.durationMinutes === null
    : record.action === "timeout"
      ? record.deleteMessageSeconds === null
        && Number.isInteger(record.durationMinutes)
        && (record.durationMinutes as number) >= 1
        && (record.durationMinutes as number) <= ADMINISTRATION_LIMITS.timeoutMinutes
      : record.deleteMessageSeconds === null && record.durationMinutes === null
  const validTimeoutUntil = record.action === "timeout"
    ? status === "pending"
      ? record.timeoutUntil === null
      : typeof record.timeoutUntil === "string"
        && !Number.isNaN(Date.parse(record.timeoutUntil))
    : record.timeoutUntil === null
  if (
    Object.keys(record).length !== MEMBER_MODERATION_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !MEMBER_MODERATION_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-moderation"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !MEMBER_MODERATION_ACTIONS.includes(record.action as MemberModerationAction)
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.userId !== "string"
    || !positiveActivitySnowflake(record.userId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !validActionParameters
    || !validTimeoutUntil
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      record.error !== null || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as MemberModerationActivityAction,
    deleteMessageSeconds: record.deleteMessageSeconds as number | null,
    durationMinutes: record.durationMinutes as number | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-moderation",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberModerationActivityStatus,
    timeoutUntil: record.timeoutUntil as string | null,
    timestamp: record.timestamp,
    userId: record.userId,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseBulkGuildBanActivity(
  value: unknown,
): BulkGuildBanActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = String(record.status)
  if (
    Object.keys(record).length !== BULK_GUILD_BAN_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !BULK_GUILD_BAN_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "bulk-guild-ban"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "partial",
      "partial-with-drift",
      "pending",
      "uncertain",
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || !Number.isInteger(record.deleteMessageSeconds)
    || (record.deleteMessageSeconds as number) < 0
    || (record.deleteMessageSeconds as number) > DISCORD_LIMITS.banDeleteMessageSeconds
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !canonicalActivitySnowflakeIds(
      record.requestedUserIds,
      2,
      DISCORD_LIMITS.bulkGuildBanUsers,
    )
    || !canonicalActivitySnowflakeIds(
      record.responseBannedUserIds,
      0,
      DISCORD_LIMITS.bulkGuildBanUsers,
    )
    || !canonicalActivitySnowflakeIds(
      record.responseFailedUserIds,
      0,
      DISCORD_LIMITS.bulkGuildBanUsers,
    )
    || !canonicalActivitySnowflakeIds(
      record.observedBannedUserIds,
      0,
      DISCORD_LIMITS.bulkGuildBanUsers,
    )
    || !canonicalActivitySnowflakeIds(
      record.observedNotBannedUserIds,
      0,
      DISCORD_LIMITS.bulkGuildBanUsers,
    )
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
  ) {
    return undefined
  }
  const requestedUserIds = record.requestedUserIds as string[]
  const responseBannedUserIds = record.responseBannedUserIds as string[]
  const responseFailedUserIds = record.responseFailedUserIds as string[]
  const observedBannedUserIds = record.observedBannedUserIds as string[]
  const observedNotBannedUserIds = record.observedNotBannedUserIds as string[]
  const requestedSet = new Set(requestedUserIds)
  const responseIds = [...responseBannedUserIds, ...responseFailedUserIds]
  const observedIds = [...observedBannedUserIds, ...observedNotBannedUserIds]
  const responseEmpty = responseIds.length === 0
  const responseComplete = responseIds.length === requestedUserIds.length
    && new Set(responseIds).size === requestedUserIds.length
  const observationsComplete = observedIds.length === requestedUserIds.length
    && new Set(observedIds).size === requestedUserIds.length
  const responseMatchesObservation = responseComplete
    && JSON.stringify(responseBannedUserIds) === JSON.stringify(observedBannedUserIds)
    && JSON.stringify(responseFailedUserIds) === JSON.stringify(observedNotBannedUserIds)
  if (
    responseIds.some((userId) => !requestedSet.has(userId))
    || observedIds.some((userId) => !requestedSet.has(userId))
    || responseBannedUserIds.some((userId) => responseFailedUserIds.includes(userId))
    || observedBannedUserIds.some((userId) => observedNotBannedUserIds.includes(userId))
    || (!responseEmpty && !responseComplete)
    || (status === "pending" && (
      !responseEmpty
      || observedIds.length !== 0
      || record.error !== null
      || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null
      || record.verification !== "match"
      || !observationsComplete
      || observedBannedUserIds.length !== requestedUserIds.length
      || !responseMatchesObservation
    ))
    || (status === "completed-with-drift" && (
      record.error !== null
      || record.verification !== "drift"
      || !observationsComplete
      || observedBannedUserIds.length !== requestedUserIds.length
      || (responseComplete && responseMatchesObservation)
    ))
    || (status === "partial" && (
      record.error === null
      || record.verification !== "match"
      || !observationsComplete
      || observedBannedUserIds.length === 0
      || observedNotBannedUserIds.length === 0
      || !responseMatchesObservation
    ))
    || (status === "partial-with-drift" && (
      record.error === null
      || record.verification !== "drift"
      || !observationsComplete
      || observedBannedUserIds.length === 0
      || observedNotBannedUserIds.length === 0
      || (responseComplete && responseMatchesObservation)
    ))
    || (status === "failed" && (
      record.error === null
      || !["drift", "match"].includes(String(record.verification))
      || !observationsComplete
      || observedBannedUserIds.length !== 0
      || (
        record.verification === "drift"
        && (!responseComplete || responseMatchesObservation)
      )
      || (
        record.verification === "match"
        && responseComplete
        && !responseMatchesObservation
      )
    ))
    || (status === "uncertain" && (
      record.error === null
      || record.verification !== null
      || (
        observationsComplete
        && observedBannedUserIds.length === requestedUserIds.length
      )
    ))
  ) {
    return undefined
  }
  return {
    deleteMessageSeconds: record.deleteMessageSeconds as number,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "bulk-guild-ban",
    observedBannedUserIds,
    observedNotBannedUserIds,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    requestedUserIds,
    responseBannedUserIds,
    responseFailedUserIds,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as BulkGuildBanActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseGuildPruneActivity(value: unknown): GuildPruneActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = String(record.status)
  if (
    Object.keys(record).length !== GUILD_PRUNE_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !GUILD_PRUNE_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-prune"
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
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || !Number.isInteger(record.days)
    || (record.days as number) < DISCORD_LIMITS.guildPruneDaysMinimum
    || (record.days as number) > DISCORD_LIMITS.guildPruneDaysMaximum
    || !canonicalActivitySnowflakeIds(
      record.includeRoleIds,
      0,
      CONNECTOR_LIMITS.guildPruneIncludeRoles,
    )
    || !Number.isInteger(record.maximumEstimatedMemberCount)
    || (record.maximumEstimatedMemberCount as number) < 1
    || (record.maximumEstimatedMemberCount as number) > CONNECTOR_LIMITS.guildPruneMaximumMembers
    || !Number.isInteger(record.policyMaximumMemberCount)
    || (record.policyMaximumMemberCount as number) < 1
    || (record.policyMaximumMemberCount as number) > CONNECTOR_LIMITS.guildPruneMaximumMembers
    || !Number.isSafeInteger(record.reviewedEstimatedMemberCount)
    || (record.reviewedEstimatedMemberCount as number) < 0
    || (record.reviewedEstimatedMemberCount as number) > (record.maximumEstimatedMemberCount as number)
    || (record.reviewedEstimatedMemberCount as number) > (record.policyMaximumMemberCount as number)
    || !(record.actualPrunedCount === null || (
      Number.isSafeInteger(record.actualPrunedCount)
      && (record.actualPrunedCount as number) >= 0
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
  ) {
    return undefined
  }
  const actualPrunedCount = record.actualPrunedCount as number | null
  const reviewedEstimatedMemberCount = record.reviewedEstimatedMemberCount as number
  if (
    (status === "pending" && (
      actualPrunedCount !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (status === "completed" && (
      actualPrunedCount !== reviewedEstimatedMemberCount
      || record.error !== null
      || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      actualPrunedCount === null
      || actualPrunedCount === reviewedEstimatedMemberCount
      || record.error !== null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      actualPrunedCount !== null
      || record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    actualPrunedCount,
    days: record.days as number,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    includeRoleIds: record.includeRoleIds as string[],
    kind: "guild-prune",
    maximumEstimatedMemberCount: record.maximumEstimatedMemberCount as number,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    policyMaximumMemberCount: record.policyMaximumMemberCount as number,
    reviewedEstimatedMemberCount,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildPruneActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
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

function parseMemberNicknameActivity(
  value: unknown,
): MemberNicknameActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-nickname-change"
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
    || !["current-bot", "member"].includes(String(record.targetKind))
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
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-nickname-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberNicknameActivityStatus,
    targetKind: record.targetKind as "current-bot" | "member",
    timestamp: record.timestamp,
    userId: record.userId,
    verification: record.verification as "drift" | "match" | null,
  }
}

const MEMBER_VERIFICATION_ACTIVITY_KEYS = [
  "desiredBypassesVerification",
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "schemaVersion",
  "status",
  "timestamp",
  "userId",
  "verification",
] as const

function parseMemberVerificationActivity(
  value: unknown,
): MemberVerificationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== MEMBER_VERIFICATION_ACTIVITY_KEYS.length
    || keys.some((key, index) => key !== MEMBER_VERIFICATION_ACTIVITY_KEYS[index])
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-verification-change"
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
    || typeof record.desiredBypassesVerification !== "boolean"
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
    desiredBypassesVerification: record.desiredBypassesVerification,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-verification-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberVerificationActivityStatus,
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

function parseMessageForwardActivity(
  value: unknown,
): MessageForwardActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = [
    "error",
    "id",
    "kind",
    "nonce",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "sourceChannelId",
    "sourceGuildId",
    "sourceMessageId",
    "status",
    "targetChannelId",
    "targetGuildId",
    "targetMessageId",
    "timestamp",
    "verification",
  ].sort()
  if (
    Object.keys(record).sort().join("\0") !== keys.join("\0")
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "message-forward"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.sourceGuildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.sourceGuildId)
    || typeof record.sourceChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.sourceChannelId)
    || typeof record.sourceMessageId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.sourceMessageId)
    || typeof record.targetGuildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.targetGuildId)
    || typeof record.targetChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.targetChannelId)
    || !(record.targetMessageId === null || (
      typeof record.targetMessageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.targetMessageId)
    ))
    || typeof record.nonce !== "string"
    || !/^[A-Za-z0-9_-]{1,25}$/.test(record.nonce)
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
      || record.targetMessageId !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null
      || record.targetMessageId === null
      || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
    || (record.status === "failed" && record.targetMessageId !== null)
  ) {
    return undefined
  }
  return {
    error: record.error,
    id: record.id,
    kind: "message-forward",
    nonce: record.nonce,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    sourceChannelId: record.sourceChannelId,
    sourceGuildId: record.sourceGuildId,
    sourceMessageId: record.sourceMessageId,
    status: record.status as MessageForwardActivityStatus,
    targetChannelId: record.targetChannelId,
    targetGuildId: record.targetGuildId,
    targetMessageId: record.targetMessageId as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
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

function parseGuildApplicationCommandActivity(
  value: unknown,
): GuildApplicationCommandActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const action = record.action as "create" | "delete" | "update"
  if (
    keys.length !== GUILD_APPLICATION_COMMAND_ACTIVITY_KEYS.length
    || keys.some((key, index) => key !== GUILD_APPLICATION_COMMAND_ACTIVITY_KEYS[index])
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-application-command-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["create", "delete", "update"].includes(action)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.applicationId !== "string"
    || !positiveActivitySnowflake(record.applicationId)
    || typeof record.botId !== "string"
    || !positiveActivitySnowflake(record.botId)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || !(record.commandId === null || (
      typeof record.commandId === "string"
      && positiveActivitySnowflake(record.commandId)
    ))
    || !GUILD_APPLICATION_COMMAND_TYPES.includes(
      record.commandType as GuildApplicationCommandType,
    )
    || typeof record.inventoryDigest !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.inventoryDigest)
    || typeof record.permissionDigest !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.permissionDigest)
    || !(record.existingDefinitionDigest === null || (
      typeof record.existingDefinitionDigest === "string"
      && OPERATION_KEY_HASH_PATTERN.test(record.existingDefinitionDigest)
    ))
    || !(record.desiredDefinitionDigest === null || (
      typeof record.desiredDefinitionDigest === "string"
      && OPERATION_KEY_HASH_PATTERN.test(record.desiredDefinitionDigest)
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
      record.existingDefinitionDigest !== null
      || record.desiredDefinitionDigest === null
    ))
    || (action === "update" && (
      record.commandId === null
      || record.existingDefinitionDigest === null
      || record.desiredDefinitionDigest === null
    ))
    || (action === "delete" && (
      record.commandId === null
      || record.existingDefinitionDigest === null
      || record.desiredDefinitionDigest !== null
    ))
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.commandId === null
      || record.error !== null
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
    applicationId: record.applicationId,
    botId: record.botId,
    commandId: record.commandId as string | null,
    commandType: record.commandType as GuildApplicationCommandType,
    desiredDefinitionDigest: record.desiredDefinitionDigest as string | null,
    error: record.error,
    existingDefinitionDigest: record.existingDefinitionDigest as string | null,
    guildId: record.guildId,
    id: record.id,
    inventoryDigest: record.inventoryDigest,
    kind: "guild-application-command-change",
    operationKeyHash: record.operationKeyHash,
    permissionDigest: record.permissionDigest,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildApplicationCommandActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseGlobalApplicationCommandActivity(
  value: unknown,
): GlobalApplicationCommandActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const action = record.action as "create" | "delete" | "update"
  if (
    keys.length !== GLOBAL_APPLICATION_COMMAND_ACTIVITY_KEYS.length
    || keys.some((key, index) => key !== GLOBAL_APPLICATION_COMMAND_ACTIVITY_KEYS[index])
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "global-application-command-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["create", "delete", "update"].includes(action)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.applicationId !== "string"
    || !positiveActivitySnowflake(record.applicationId)
    || typeof record.botId !== "string"
    || !positiveActivitySnowflake(record.botId)
    || !(record.commandId === null || (
      typeof record.commandId === "string"
      && positiveActivitySnowflake(record.commandId)
    ))
    || !GLOBAL_APPLICATION_COMMAND_TYPES.includes(
      record.commandType as GlobalApplicationCommandType,
    )
    || typeof record.inventoryDigest !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.inventoryDigest)
    || !(record.existingDefinitionDigest === null || (
      typeof record.existingDefinitionDigest === "string"
      && OPERATION_KEY_HASH_PATTERN.test(record.existingDefinitionDigest)
    ))
    || !(record.desiredDefinitionDigest === null || (
      typeof record.desiredDefinitionDigest === "string"
      && OPERATION_KEY_HASH_PATTERN.test(record.desiredDefinitionDigest)
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
      record.existingDefinitionDigest !== null
      || record.desiredDefinitionDigest === null
    ))
    || (action === "update" && (
      record.commandId === null
      || record.existingDefinitionDigest === null
      || record.desiredDefinitionDigest === null
    ))
    || (action === "delete" && (
      record.commandId === null
      || record.existingDefinitionDigest === null
      || record.desiredDefinitionDigest !== null
    ))
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.commandId === null
      || record.error !== null
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
    applicationId: record.applicationId,
    botId: record.botId,
    commandId: record.commandId as string | null,
    commandType: record.commandType as GlobalApplicationCommandType,
    desiredDefinitionDigest: record.desiredDefinitionDigest as string | null,
    error: record.error,
    existingDefinitionDigest: record.existingDefinitionDigest as string | null,
    id: record.id,
    inventoryDigest: record.inventoryDigest,
    kind: "global-application-command-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GlobalApplicationCommandActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
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
  const responseStage = record.responseStage === undefined
    ? "initial"
    : String(record.responseStage)
  const sequence = record.sequence === undefined ? 0 : record.sequence
  const source = record.source === undefined ? "command" : String(record.source)
  const sourceMessageId = record.sourceMessageId === undefined
    ? null
    : record.sourceMessageId
  const requestButtonIndex = record.requestButtonIndex === undefined
    ? null
    : record.requestButtonIndex
  const requestButtonStyle = record.requestButtonStyle === undefined
    ? null
    : record.requestButtonStyle
  const errorStatus = [
    "followup-failed",
    "followup-uncertain",
    "rejected",
    "response-failed",
    "response-uncertain",
  ].includes(status)
  const initialStatus = [
    "accepted",
    "expired",
    "rejected",
    "response-completed",
    "response-failed",
    "response-pending",
    "response-uncertain",
  ].includes(status)
  const followupStatus = [
    "followup-completed",
    "followup-failed",
    "followup-pending",
    "followup-uncertain",
  ].includes(status)
  const authenticatedRequestButton = source === "request-button"
    && typeof sourceMessageId === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(sourceMessageId)
    && Number.isInteger(requestButtonIndex)
    && Number(requestButtonIndex) >= 0
    && Number(requestButtonIndex) < REQUEST_BUTTON_LIMITS.buttonsPerMessage
    && REQUEST_BUTTON_STYLES.includes(requestButtonStyle as RequestButtonStyle)
  const unauthenticatedRequestButtonRejection = source === "request-button"
    && sourceMessageId === null
    && requestButtonIndex === null
    && requestButtonStyle === null
    && responseStage === "initial"
    && ["rejected", "response-failed", "response-uncertain"].includes(status)
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "native-interaction"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "accepted",
      "continuation-expired",
      "continuation-opened",
      "expired",
      "followup-completed",
      "followup-failed",
      "followup-pending",
      "followup-uncertain",
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
    || !["command", "request-button"].includes(source)
    || (source === "command"
      ? sourceMessageId !== null
        || requestButtonIndex !== null
        || requestButtonStyle !== null
      : !authenticatedRequestButton && !unauthenticatedRequestButtonRejection)
    || !["continuation", "followup", "initial"].includes(responseStage)
    || !Number.isInteger(sequence)
    || Number(sequence) < 0
    || Number(sequence) > NATIVE_INTERACTION_DEFAULTS.maximumFollowups
    || (responseStage === "initial" && (!initialStatus || sequence !== 0))
    || (responseStage === "followup" && (!followupStatus || Number(sequence) < 1))
    || (responseStage === "continuation" && ![
      "continuation-expired",
      "continuation-opened",
    ].includes(status))
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
    requestButtonIndex: requestButtonIndex as number | null,
    requestButtonStyle: requestButtonStyle as RequestButtonStyle | null,
    responseStage: responseStage as NativeInteractionActivity["responseStage"],
    schemaVersion: SCHEMA_VERSION,
    sequence: Number(sequence),
    status: status as NativeInteractionActivityStatus,
    source: source as "command" | "request-button",
    sourceMessageId: sourceMessageId as string | null,
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

function parseChannelPermissionSyncActivity(
  value: unknown,
): ChannelPermissionSyncActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-permission-sync"
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
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.botId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.botId)
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.parentChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.parentChannelId)
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
    applicationId: record.applicationId,
    botId: record.botId,
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-permission-sync",
    operationKeyHash: record.operationKeyHash,
    parentChannelId: record.parentChannelId,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ChannelPermissionSyncActivityStatus,
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

function parseVoiceChannelStatusActivity(
  value: unknown,
): VoiceChannelStatusActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "voice-channel-status-change"
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
    || typeof record.channelId !== "string"
    || !positiveActivitySnowflake(record.channelId)
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
    || (record.status === "completed-with-drift" && (
      record.error !== null
      || record.verification !== "drift"
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
    kind: "voice-channel-status-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as VoiceChannelStatusActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseChannelOrderingActivity(
  value: unknown,
): ChannelOrderingActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const usesLegacyParent = record.destinationParentChannelId === undefined
    && record.sourceParentChannelId === undefined
  const destinationParentChannelId = usesLegacyParent
    ? record.parentChannelId
    : record.destinationParentChannelId
  const sourceParentChannelId = usesLegacyParent
    ? record.parentChannelId
    : record.sourceParentChannelId
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
    || ![destinationParentChannelId, sourceParentChannelId].every((parentId) => (
      parentId === null || (
        typeof parentId === "string"
        && positiveActivitySnowflake(parentId)
        && parentId !== record.channelId
        && parentId !== record.anchorChannelId
      )
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
    destinationParentChannelId: destinationParentChannelId as string | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-ordering",
    observedRevision: record.observedRevision as number | null,
    operationKeyHash: record.operationKeyHash,
    placement: record.placement as "above" | "below",
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    sourceParentChannelId: sourceParentChannelId as string | null,
    status: record.status as ChannelOrderingActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseChannelDeletionActivity(
  value: unknown,
): ChannelDeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = String(record.status)
  const observedRevision = record.observedRevision
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-deletion"
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
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.channelId !== "string"
    || !positiveActivitySnowflake(record.channelId)
    || !Number.isSafeInteger(record.baselineRevision)
    || (record.baselineRevision as number) < 1
    || !Number.isSafeInteger(record.baselineChannelCount)
    || (record.baselineChannelCount as number) < 1
    || !Number.isSafeInteger(record.dependencyCount)
    || (record.dependencyCount as number) < 0
    || !(observedRevision === null || (
      Number.isSafeInteger(observedRevision)
      && (observedRevision as number) > (record.baselineRevision as number)
    ))
    || !["category", "forum", "media", "stage", "text", "voice"]
      .includes(String(record.targetKind))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null
      || observedRevision !== null
      || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null
      || observedRevision === null
      || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      record.error !== null
      || observedRevision === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    baselineChannelCount: record.baselineChannelCount as number,
    baselineRevision: record.baselineRevision as number,
    channelId: record.channelId,
    dependencyCount: record.dependencyCount as number,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-deletion",
    observedRevision: observedRevision as number | null,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: status as ChannelDeletionActivityStatus,
    targetKind: record.targetKind as ChannelDeletionActivity["targetKind"],
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseRoleDeletionActivity(
  value: unknown,
): RoleDeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = String(record.status)
  const observedRoleCount = record.observedRoleCount
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "role-deletion"
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
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.roleId !== "string"
    || !positiveActivitySnowflake(record.roleId)
    || !Number.isSafeInteger(record.baselineRoleCount)
    || (record.baselineRoleCount as number) < 2
    || !Number.isSafeInteger(record.blockerCount)
    || (record.blockerCount as number) < 0
    || !Number.isSafeInteger(record.memberCount)
    || (record.memberCount as number) < 0
    || !(observedRoleCount === null || (
      Number.isSafeInteger(observedRoleCount)
      && (observedRoleCount as number) >= 1
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
    || (status === "pending" && (
      record.error !== null
      || observedRoleCount !== null
      || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null
      || observedRoleCount === null
      || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      record.error !== null
      || observedRoleCount === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    baselineRoleCount: record.baselineRoleCount as number,
    blockerCount: record.blockerCount as number,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "role-deletion",
    memberCount: record.memberCount as number,
    observedRoleCount: observedRoleCount as number | null,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    roleId: record.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: status as RoleDeletionActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseChannelCloneActivity(
  value: unknown,
): ChannelCloneActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const supportedTypes: readonly number[] = [
    DISCORD_CHANNEL_TYPES.announcement,
    DISCORD_CHANNEL_TYPES.category,
    DISCORD_CHANNEL_TYPES.forum,
    DISCORD_CHANNEL_TYPES.media,
    DISCORD_CHANNEL_TYPES.stageVoice,
    DISCORD_CHANNEL_TYPES.text,
    DISCORD_CHANNEL_TYPES.voice,
  ]
  const createdChannelId = record.createdChannelId
  const observedRevision = record.observedRevision
  const status = String(record.status)
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-clone"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.sourceChannelId !== "string"
    || !positiveActivitySnowflake(record.sourceChannelId)
    || !(createdChannelId === null || (
      typeof createdChannelId === "string"
      && positiveActivitySnowflake(createdChannelId)
      && createdChannelId !== record.sourceChannelId
    ))
    || !Number.isSafeInteger(record.channelType)
    || !supportedTypes.includes(record.channelType as number)
    || !Number.isSafeInteger(record.baselineRevision)
    || (record.baselineRevision as number) < 1
    || !(observedRevision === null || (
      Number.isSafeInteger(observedRevision)
      && (observedRevision as number) > (record.baselineRevision as number)
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
    || (status === "pending" && (
      createdChannelId !== null
      || record.error !== null
      || observedRevision !== null
      || record.verification !== null
    ))
    || (status === "completed" && (
      createdChannelId === null
      || record.error !== null
      || observedRevision === null
      || record.verification !== "match"
    ))
    || (status === "failed" && (
      createdChannelId !== null
      || record.error === null
      || observedRevision !== null
      || record.verification !== null
    ))
    || (status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    baselineRevision: record.baselineRevision as number,
    channelType: record.channelType as number,
    createdChannelId: createdChannelId as string | null,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-clone",
    observedRevision: observedRevision as number | null,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    sourceChannelId: record.sourceChannelId,
    status: record.status as ChannelCloneActivityStatus,
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

function parseWebhookMessageActivity(
  value: unknown,
): WebhookMessageActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind
  const status = record.status
  const send = kind === "webhook-message-send"
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || ![
      "webhook-message-deletion",
      "webhook-message-edit",
      "webhook-message-send",
    ].includes(String(kind))
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
    ].includes(String(status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.webhookId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.webhookId)
    || !(record.messageId === null || (
      typeof record.messageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    ))
    || (!send && typeof record.messageId !== "string")
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null
      || record.verification !== null
      || (send ? record.messageId !== null : typeof record.messageId !== "string")
    ))
    || (status === "completed" && (
      record.error !== null
      || record.verification !== "match"
      || typeof record.messageId !== "string"
    ))
    || (status === "completed-with-drift" && (
      kind !== "webhook-message-deletion"
      || record.error !== null
      || record.verification !== "drift"
      || typeof record.messageId !== "string"
    ))
    || (["failed", "uncertain"].includes(String(status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: kind as WebhookMessageActivity["kind"],
    messageId: record.messageId as string | null,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: status as WebhookMessageActivityStatus,
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

function parseGuildDepartureActivity(
  value: unknown,
): GuildDepartureActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== GUILD_DEPARTURE_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !GUILD_DEPARTURE_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-departure"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.botId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.botId)
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
    applicationId: record.applicationId,
    botId: record.botId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-departure",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildDepartureActivityStatus,
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

function parseInviteCreationActivity(
  value: unknown,
): InviteCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== [
      "capabilityFileWritten",
      "channelId",
      "error",
      "guildId",
      "id",
      "inviteRef",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ].sort().join("\0")
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "invite-creation"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.inviteRef === null || (
      typeof record.inviteRef === "string"
      && INVITE_REFERENCE_PATTERN.test(record.inviteRef)
    ))
    || typeof record.capabilityFileWritten !== "boolean"
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
      record.capabilityFileWritten
      || record.inviteRef !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      !record.capabilityFileWritten
      || record.inviteRef === null
      || record.verification !== "match"
    ))
    || (record.status === "failed" && (
      record.capabilityFileWritten
      || record.inviteRef !== null
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
    capabilityFileWritten: record.capabilityFileWritten,
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    inviteRef: record.inviteRef as string | null,
    kind: "invite-creation",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as InviteCreationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
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

function parseApplicationEmojiActivity(
  value: unknown,
): ApplicationEmojiActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "application-emoji-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["create", "delete", "rename"].includes(String(record.action))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || !(record.emojiId === null || (
      typeof record.emojiId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.emojiId)
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
      record.action === "create" ? record.emojiId !== null : record.emojiId === null
    ))
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (["completed", "completed-with-drift"].includes(String(record.status)) && (
      record.emojiId === null
      || record.verification !== (record.status === "completed" ? "match" : "drift")
    ))
    || (record.status === "failed" && (
      record.error === null
      || record.verification !== null
      || (record.action === "create" ? record.emojiId !== null : record.emojiId === null)
    ))
    || (record.status === "uncertain" && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    action: record.action as ApplicationEmojiActivity["action"],
    applicationId: record.applicationId,
    emojiId: record.emojiId,
    error: record.error,
    id: record.id,
    kind: "application-emoji-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ApplicationEmojiActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

const APPLICATION_ENTITLEMENT_ACTIVITY_KEYS = [
  "action",
  "applicationId",
  "beneficiaryId",
  "beneficiaryType",
  "creationOperationKeyHash",
  "entitlementId",
  "error",
  "fulfillmentReferenceHash",
  "id",
  "kind",
  "operationKeyHash",
  "planDigest",
  "schemaVersion",
  "skuId",
  "stage",
  "status",
  "timestamp",
  "verification",
] as const

function parseApplicationEntitlementActivity(
  value: unknown,
): ApplicationEntitlementActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [...APPLICATION_ENTITLEMENT_ACTIVITY_KEYS].sort()
  const action = record.action as ApplicationEntitlementActivity["action"]
  const stage = record.stage as ApplicationEntitlementActivity["stage"]
  const status = record.status as ApplicationEntitlementActivityStatus
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "application-entitlement-change"
    || !(APPLICATION_ENTITLEMENT_OPERATION_ACTIONS as readonly unknown[]).includes(action)
    || !["reserved", "target-known", "terminal"].includes(String(stage))
    || !["completed", "failed", "pending", "uncertain"].includes(String(status))
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.beneficiaryId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.beneficiaryId)
    || !["guild", "user"].includes(String(record.beneficiaryType))
    || typeof record.skuId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.skuId)
    || !(record.entitlementId === null || (
      typeof record.entitlementId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.entitlementId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || !(record.creationOperationKeyHash === null || (
      typeof record.creationOperationKeyHash === "string"
      && OPERATION_KEY_HASH_PATTERN.test(record.creationOperationKeyHash)
    ))
    || !(record.fulfillmentReferenceHash === null || (
      typeof record.fulfillmentReferenceHash === "string"
      && ENTITLEMENT_FULFILLMENT_REFERENCE_HASH_PATTERN.test(
        record.fulfillmentReferenceHash,
      )
    ))
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
  ) return undefined
  const entitlementId = record.entitlementId as string | null
  const beneficiaryType = record.beneficiaryType as "guild" | "user"
  const creationOperationKeyHash = record.creationOperationKeyHash as string | null
  const fulfillmentReferenceHash = record.fulfillmentReferenceHash as string | null
  if (
    (action === "create-test" && (
      creationOperationKeyHash !== null
      || fulfillmentReferenceHash !== null
    ))
    || (action === "delete-test" && (
      creationOperationKeyHash === null
      || creationOperationKeyHash === record.operationKeyHash
      || fulfillmentReferenceHash !== null
    ))
    || (action === "consume" && (
      beneficiaryType !== "user"
      || creationOperationKeyHash !== null
      || fulfillmentReferenceHash === null
    ))
    || (stage === "terminal") !== (status !== "pending")
    || (stage === "reserved" && action === "create-test" && entitlementId !== null)
    || (stage === "reserved" && action !== "create-test" && entitlementId === null)
    || (stage === "target-known" && (
      action !== "create-test"
      || status !== "pending"
      || entitlementId === null
    ))
    || (status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null
      || record.verification !== "match"
      || entitlementId === null
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null
      || record.verification !== null
    ))
  ) return undefined
  return {
    action,
    applicationId: record.applicationId,
    beneficiaryId: record.beneficiaryId,
    beneficiaryType,
    creationOperationKeyHash,
    entitlementId,
    error: record.error as string | null,
    fulfillmentReferenceHash,
    id: record.id,
    kind: "application-entitlement-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    skuId: record.skuId,
    stage,
    status,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseApplicationIntentActivity(
  value: unknown,
): ApplicationIntentActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "application-intent-enablement"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["guild-members", "message-content"].includes(String(record.intent))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.botId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.botId)
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
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (record.status === "failed" && (
      record.error === null || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    applicationId: record.applicationId,
    botId: record.botId,
    error: record.error,
    id: record.id,
    intent: record.intent as ApplicationIntentActivity["intent"],
    kind: "application-intent-enablement",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ApplicationIntentActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseBotProfileActivity(
  value: unknown,
): BotProfileActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const expectedKeys = [
    "applicationId",
    "avatarChanged",
    "bannerChanged",
    "botId",
    "error",
    "id",
    "kind",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "status",
    "timestamp",
    "usernameChanged",
    "verification",
  ].sort()
  const status = String(record.status)
  if (
    Object.keys(record).sort().join("\0") !== expectedKeys.join("\0")
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "bot-profile-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(status)
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.botId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.botId)
    || typeof record.avatarChanged !== "boolean"
    || typeof record.bannerChanged !== "boolean"
    || typeof record.usernameChanged !== "boolean"
    || !(
      record.avatarChanged
      || record.bannerChanged
      || record.usernameChanged
    )
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    applicationId: record.applicationId,
    avatarChanged: record.avatarChanged,
    bannerChanged: record.bannerChanged,
    botId: record.botId,
    error: record.error,
    id: record.id,
    kind: "bot-profile-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as BotProfileActivityStatus,
    timestamp: record.timestamp,
    usernameChanged: record.usernameChanged,
    verification: record.verification as "match" | null,
  }
}

function parseApplicationRoleConnectionMetadataActivity(
  value: unknown,
): ApplicationRoleConnectionMetadataActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const counts = [
    record.addedRecordCount,
    record.changedRecordCount,
    record.currentRecordCount,
    record.desiredRecordCount,
    record.removedRecordCount,
  ]
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "application-role-connection-metadata-change"
    || !["clear", "replace"].includes(String(record.action))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.botId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.botId)
    || counts.some((count) => (
      !Number.isInteger(count)
      || (count as number) < 0
      || (count as number) > DISCORD_LIMITS.applicationRoleConnectionMetadataRecords
    ))
    || (record.addedRecordCount as number) > (record.desiredRecordCount as number)
    || (record.changedRecordCount as number) > Math.min(
      record.currentRecordCount as number,
      record.desiredRecordCount as number,
    )
    || (record.removedRecordCount as number) > (record.currentRecordCount as number)
    || (record.changedRecordCount as number) > (
      (record.currentRecordCount as number) - (record.removedRecordCount as number)
    )
    || (record.changedRecordCount as number) > (
      (record.desiredRecordCount as number) - (record.addedRecordCount as number)
    )
    || (
      (record.currentRecordCount as number) - (record.removedRecordCount as number)
      !== (record.desiredRecordCount as number) - (record.addedRecordCount as number)
    )
    || typeof record.reordered !== "boolean"
    || (record.action === "clear" && (
      record.desiredRecordCount !== 0
      || record.addedRecordCount !== 0
      || record.changedRecordCount !== 0
      || record.removedRecordCount !== record.currentRecordCount
      || record.reordered
    ))
    || (record.action === "replace" && record.desiredRecordCount === 0)
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
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    action: record.action as ApplicationRoleConnectionMetadataActivity["action"],
    addedRecordCount: record.addedRecordCount as number,
    applicationId: record.applicationId,
    botId: record.botId,
    changedRecordCount: record.changedRecordCount as number,
    currentRecordCount: record.currentRecordCount as number,
    desiredRecordCount: record.desiredRecordCount as number,
    error: record.error,
    id: record.id,
    kind: "application-role-connection-metadata-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    removedRecordCount: record.removedRecordCount as number,
    reordered: record.reordered,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ApplicationRoleConnectionMetadataActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
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

const SOUNDBOARD_PLAYBACK_ACTIVITY_KEYS = [
  "channelId",
  "error",
  "guildId",
  "id",
  "kind",
  "operationKeyHash",
  "requestDigest",
  "schemaVersion",
  "soundId",
  "sourceGuildId",
  "status",
  "timestamp",
  "verification",
].sort()

function parseSoundboardPlaybackActivity(
  value: unknown,
): SoundboardPlaybackActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== SOUNDBOARD_PLAYBACK_ACTIVITY_KEYS.join("\0")
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "soundboard-playback"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.soundId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.soundId)
    || !(record.sourceGuildId === null || (
      typeof record.sourceGuildId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.sourceGuildId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.requestDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.requestDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "gateway-match", "response-only"].includes(
      record.verification as string | null,
    )
    || (record.status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.error !== null || record.verification === null
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "soundboard-playback",
    operationKeyHash: record.operationKeyHash,
    requestDigest: record.requestDigest,
    schemaVersion: SCHEMA_VERSION,
    soundId: record.soundId,
    sourceGuildId: record.sourceGuildId as string | null,
    status: record.status as SoundboardPlaybackActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "gateway-match" | "response-only" | null,
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

function parseGuildSettingsActivity(
  value: unknown,
): GuildSettingsActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = Array.isArray(record.requestedFields)
    ? record.requestedFields
    : []
  const status = String(record.status)
  if (
    Object.keys(record).length !== GUILD_SETTINGS_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !GUILD_SETTINGS_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-settings-change"
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
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || fields.length < 1
    || fields.length > GUILD_SETTINGS_FIELDS.length
    || fields.some((field) => (
      typeof field !== "string"
      || !(GUILD_SETTINGS_FIELDS as readonly string[]).includes(field)
    ))
    || new Set(fields).size !== fields.length
    || JSON.stringify(fields) !== JSON.stringify([...fields].sort())
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      record.error !== null || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-settings-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    requestedFields: fields as GuildSettingsField[],
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildSettingsActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseGuildCommunityActivity(
  value: unknown,
): GuildCommunityActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = Array.isArray(record.changedFields) ? record.changedFields : []
  const status = String(record.status)
  if (
    Object.keys(record).length !== GUILD_COMMUNITY_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !GUILD_COMMUNITY_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-community-change"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.rulesChannelId !== "string"
    || !positiveActivitySnowflake(record.rulesChannelId)
    || typeof record.publicUpdatesChannelId !== "string"
    || !positiveActivitySnowflake(record.publicUpdatesChannelId)
    || !(record.safetyAlertsChannelId === null || (
      typeof record.safetyAlertsChannelId === "string"
      && positiveActivitySnowflake(record.safetyAlertsChannelId)
    ))
    || typeof record.enablementRequired !== "boolean"
    || fields.length < 1
    || fields.length > GUILD_COMMUNITY_CHANGE_FIELDS.length
    || fields.some((field) => (
      typeof field !== "string"
      || !(GUILD_COMMUNITY_CHANGE_FIELDS as readonly string[]).includes(field)
    ))
    || new Set(fields).size !== fields.length
    || JSON.stringify(fields) !== JSON.stringify([...fields].sort())
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || typeof record.stateDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(record.stateDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    changedFields: fields as GuildCommunityChangeField[],
    enablementRequired: record.enablementRequired,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-community-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    publicUpdatesChannelId: record.publicUpdatesChannelId,
    rulesChannelId: record.rulesChannelId,
    safetyAlertsChannelId: record.safetyAlertsChannelId as string | null,
    schemaVersion: SCHEMA_VERSION,
    stateDigest: record.stateDigest,
    status: record.status as GuildCommunityActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseGuildProfileActivity(
  value: unknown,
): GuildProfileActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = Array.isArray(record.requestedFields)
    ? record.requestedFields
    : []
  const status = String(record.status)
  if (
    Object.keys(record).length !== GUILD_PROFILE_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !GUILD_PROFILE_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-profile-change"
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
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || fields.length < 1
    || fields.length > GUILD_PROFILE_FIELDS.length
    || fields.some((field) => (
      typeof field !== "string"
      || !(GUILD_PROFILE_FIELDS as readonly string[]).includes(field)
    ))
    || new Set(fields).size !== fields.length
    || JSON.stringify(fields) !== JSON.stringify([...fields].sort())
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      record.error !== null || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-profile-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    requestedFields: fields as GuildProfileField[],
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildProfileActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseGuildIncidentActivity(
  value: unknown,
): GuildIncidentActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = Array.isArray(record.requestedFields)
    ? record.requestedFields
    : []
  const status = String(record.status)
  if (
    Object.keys(record).length !== GUILD_INCIDENT_ACTIVITY_KEYS.size
    || Object.keys(record).some((key) => !GUILD_INCIDENT_ACTIVITY_KEYS.has(key))
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "guild-incident-action-change"
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
    ].includes(status)
    || typeof record.guildId !== "string"
    || !positiveActivitySnowflake(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || fields.length < 1
    || fields.length > GUILD_INCIDENT_ACTION_FIELDS.length
    || fields.some((field) => (
      typeof field !== "string"
      || !(GUILD_INCIDENT_ACTION_FIELDS as readonly string[]).includes(field)
    ))
    || new Set(fields).size !== fields.length
    || JSON.stringify(fields) !== JSON.stringify([...fields].sort())
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (status === "completed" && (
      record.error !== null || record.verification !== "match"
    ))
    || (status === "completed-with-drift" && (
      record.error !== null || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "guild-incident-action-change",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    requestedFields: fields as GuildIncidentActionField[],
    schemaVersion: SCHEMA_VERSION,
    status: record.status as GuildIncidentActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseDirectMessageActivity(
  value: unknown,
): DirectMessageActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const action = record.action as DirectMessageAction
  const stage = record.stage as DirectMessageReceiptStage
  const status = record.status as DirectMessageActivityStatus
  if (
    Object.keys(record).sort().join("\0")
      !== DIRECT_MESSAGE_ACTIVITY_KEYS.join("\0")
    || record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "direct-message-change"
    || !(DIRECT_MESSAGE_ACTIONS as readonly unknown[]).includes(record.action)
    || !["channel-ready", "message-dispatched", "reserved", "terminal"]
      .includes(String(record.stage))
    || !["completed", "failed", "pending", "uncertain"]
      .includes(String(record.status))
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || typeof record.recipientId !== "string"
    || !positiveActivitySnowflake(record.recipientId)
    || !(record.channelId === null || (
      typeof record.channelId === "string"
      && positiveActivitySnowflake(record.channelId)
    ))
    || !(record.messageId === null || (
      typeof record.messageId === "string"
      && positiveActivitySnowflake(record.messageId)
    ))
    || !(record.replyToMessageId === null || (
      typeof record.replyToMessageId === "string"
      && positiveActivitySnowflake(record.replyToMessageId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || typeof record.requestDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.requestDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (action === "reply" && record.replyToMessageId === null)
    || (["delete", "send"].includes(action) && record.replyToMessageId !== null)
    || (action !== "send" && record.channelId === null)
    || (["delete", "edit"].includes(action) && record.messageId === null)
    || (action === "delete"
      ? record.messageFormat !== null
      : !(DIRECT_MESSAGE_FORMATS as readonly unknown[]).includes(
          record.messageFormat,
        ))
    || ((stage === "terminal") !== (status !== "pending"))
    || (status === "pending" && (
      record.error !== null || record.verification !== null
    ))
    || (stage === "reserved" && (
      (action === "send" && (record.channelId !== null || record.messageId !== null))
      || (action === "reply" && record.messageId !== null)
    ))
    || (stage === "channel-ready" && (
      action !== "send"
      || record.channelId === null
      || record.messageId !== null
    ))
    || (stage === "message-dispatched" && (
      record.channelId === null || record.messageId === null
    ))
    || (status === "completed" && (
      record.error !== null
      || record.verification !== "match"
      || record.channelId === null
      || record.messageId === null
    ))
    || (["failed", "uncertain"].includes(status) && (
      record.error === null || record.verification !== null
    ))
  ) return undefined
  return {
    action,
    channelId: record.channelId as string | null,
    error: record.error as string | null,
    id: record.id,
    kind: "direct-message-change",
    messageFormat: record.messageFormat as DirectMessageFormat | null,
    messageId: record.messageId as string | null,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    recipientId: record.recipientId,
    replyToMessageId: record.replyToMessageId as string | null,
    requestDigest: record.requestDigest,
    schemaVersion: SCHEMA_VERSION,
    stage,
    status,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
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

function parseEmbedMessageActivity(
  value: unknown,
): EmbedMessageActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || !["embed-message-create", "embed-message-edit"].includes(String(record.kind))
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
    || (record.kind === "embed-message-edit" && record.replyToMessageId !== null)
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
    kind: record.kind as EmbedMessageActivity["kind"],
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    replyToMessageId: record.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as EmbedMessageActivityStatus,
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
    || parseBulkGuildBanActivity(value)
    || parseGuildPruneActivity(value)
    || parseMessageForwardActivity(value)
    || parseAnnouncementSubscriptionActivity(value)
    || parseGlobalApplicationCommandActivity(value)
    || parseGuildApplicationCommandActivity(value)
    || parseNativeInteractionCommandActivity(value)
    || parseGuildTemplateActivity(value)
    || parseNativeInteractionActivity(value)
    || parseAttachmentMessageActivity(value)
    || parseComponentMessageActivity(value)
    || parseEmbedMessageActivity(value)
    || parseDirectMessageActivity(value)
    || parseAutoModerationActivity(value)
    || parseForumPostActivity(value)
    || parseThreadCreationActivity(value)
    || parseStageInstanceActivity(value)
    || parseChannelCreationActivity(value)
    || parseChannelMetadataActivity(value)
    || parseVoiceChannelStatusActivity(value)
    || parseChannelCloneActivity(value)
    || parseChannelDeletionActivity(value)
    || parseRoleDeletionActivity(value)
    || parseChannelOrderingActivity(value)
    || parseForumTagActivity(value)
    || parseChannelPermissionOverwriteActivity(value)
    || parseChannelPermissionSyncActivity(value)
    || parseMessagePinActivity(value)
    || parseApplicationEntitlementActivity(value)
    || parseApplicationEmojiActivity(value)
    || parseApplicationIntentActivity(value)
    || parseBotProfileActivity(value)
    || parseApplicationRoleConnectionMetadataActivity(value)
    || parseGuildExpressionActivity(value)
    || parseScheduledEventActivity(value)
    || parseSoundboardActivity(value)
    || parseSoundboardPlaybackActivity(value)
    || parseWelcomeScreenActivity(value)
    || parseGuildIncidentActivity(value)
    || parseGuildProfileActivity(value)
    || parseGuildSettingsActivity(value)
    || parseGuildCommunityActivity(value)
    || parseWidgetSettingsActivity(value)
    || parseWebhookCreationActivity(value)
    || parseWebhookChangeActivity(value)
    || parseWebhookDeletionActivity(value)
    || parseWebhookMessageActivity(value)
    || parseIntegrationDeletionActivity(value)
    || parseGuildDepartureActivity(value)
    || parseReactionModerationActivity(value)
    || parseInviteCreationActivity(value)
    || parseInviteDeletionActivity(value)
    || parseOnboardingActivity(value)
    || parseMemberNicknameActivity(value)
    || parseMemberRoleActivity(value)
    || parseMemberVerificationActivity(value)
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
    const normalized = parseActivityEntry(entry) || (
      entry.kind === "member-verification-change"
        ? parseMemberVerificationActivity({
            desiredBypassesVerification: entry.desiredBypassesVerification,
            error: entry.error,
            guildId: entry.guildId,
            id: entry.id,
            kind: entry.kind,
            operationKeyHash: entry.operationKeyHash,
            planDigest: entry.planDigest,
            schemaVersion: entry.schemaVersion,
            status: entry.status,
            timestamp: entry.timestamp,
            userId: entry.userId,
            verification: entry.verification,
          })
        : undefined
    )
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
