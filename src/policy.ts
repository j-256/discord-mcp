import type { ConnectorConfig } from "./config.js"
import {
  DISCORD_CHANNEL_TYPES,
  GATEWAY_DEFAULTS,
  MCP_READ_RESPONSE_DEFAULTS,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { PolicyError } from "./errors.js"
import type { DiscordChannel, DiscordGuild } from "./types.js"

export interface PolicyDescription {
  administrationEnabled: boolean
  administrationGuildIds: string[]
  applicationCommandChangesEnabled: boolean
  applicationCommandGuildIds: string[]
  globalApplicationCommandChangesEnabled: boolean
  applicationEmojiAuditEnabled: boolean
  applicationEmojiChangesEnabled: boolean
  applicationEmojiCreationEnabled: boolean
  applicationEmojiRootCount: number
  applicationEntitlementConsumptionEnabled: boolean
  applicationConsumableEntitlementSkuIds: string[]
  applicationConsumableEntitlementUserIds: string[]
  applicationIntentChangesEnabled: boolean
  botProfileAuditEnabled: boolean
  botProfileChangesEnabled: boolean
  botProfileImageReplacementEnabled: boolean
  botProfileRootCount: number
  applicationEntitlementGuildIds: string[]
  applicationEntitlementUserIds: string[]
  applicationMonetizationAuditEnabled: boolean
  applicationMonetizationSkuIds: string[]
  applicationSubscriptionUserIds: string[]
  applicationTestEntitlementChangesEnabled: boolean
  applicationTestEntitlementGuildIds: string[]
  applicationTestEntitlementSkuIds: string[]
  applicationTestEntitlementUserIds: string[]
  applicationRoleConnectionMetadataChangesEnabled: boolean
  announcementCrosspostChannelIds: string[]
  announcementCrosspostsEnabled: boolean
  announcementSubscriptionAuditEnabled: boolean
  announcementSubscriptionChangesEnabled: boolean
  announcementSubscriptionSourceChannelIds: string[]
  announcementSubscriptionTargetChannelIds: string[]
  allowedChannelIds: string[]
  allowedGuildIds: string[]
  attachmentChannelIds: string[]
  attachmentMaxBytes: number
  attachmentRootCount: number
  attachmentsEnabled: boolean
  automodAlertChannelIds: string[]
  automodAuditEnabled: boolean
  automodChangesEnabled: boolean
  automodGuildIds: string[]
  banAuditEnabled: boolean
  banAuditGuildIds: string[]
  bulkBanAuditEnabled: boolean
  bulkBanGuildIds: string[]
  bulkBansEnabled: boolean
  bulkMemberRoleChangesEnabled: boolean
  bulkMemberRoleGuildIds: string[]
  bulkMemberRoleCount: number
  channelCloneAuditEnabled: boolean
  channelCloneGuildIds: string[]
  channelCloneSourceIds: string[]
  channelCloningEnabled: boolean
  channelCreationEnabled: boolean
  channelCreationGuildIds: string[]
  channelDeletionAuditEnabled: boolean
  channelDeletionIds: string[]
  channelDeletionsEnabled: boolean
  channelMetadataChangesEnabled: boolean
  channelMetadataIds: string[]
  channelOrderingAuditEnabled: boolean
  channelOrderingChangesEnabled: boolean
  channelOrderingGuildIds: string[]
  componentLinkOrigins: string[]
  deleteChannelIds: string[]
  deletionsEnabled: boolean
  directMessageAuditEnabled: boolean
  directMessageAttachmentsEnabled: boolean
  directMessageDeletionEnabled: boolean
  directMessageDeliveryEnabled: boolean
  directMessageEditingEnabled: boolean
  directMessageUserIds: string[]
  embedMessageChannelIds: string[]
  embedMessagesEnabled: boolean
  forumPostChannelIds: string[]
  forumPostsEnabled: boolean
  forumTagAuditEnabled: boolean
  forumTagChangesEnabled: boolean
  forumTagChannelIds: string[]
  gatewayEnabled: boolean
  gatewayEventBufferSize: number
  guildScaffoldGuildIds: string[]
  guildScaffoldsEnabled: boolean
  guildExpressionAuditEnabled: boolean
  guildExpressionChangesEnabled: boolean
  guildExpressionCreationEnabled: boolean
  guildExpressionGuildIds: string[]
  guildExpressionRootCount: number
  guildCommunityAuditEnabled: boolean
  guildCommunityChangesEnabled: boolean
  guildCommunityGuildIds: string[]
  guildDepartureGuildIds: string[]
  guildDeparturesEnabled: boolean
  guildIncidentAuditEnabled: boolean
  guildIncidentChangesEnabled: boolean
  guildIncidentGuildIds: string[]
  guildProfileAuditEnabled: boolean
  guildProfileChangesEnabled: boolean
  guildProfileGuildIds: string[]
  guildPruneAuditEnabled: boolean
  guildPruneGuildIds: string[]
  guildPruneIncludeRoleIds: string[]
  guildPruneMaxMembers: number
  guildPrunesEnabled: boolean
  guildSettingsAuditEnabled: boolean
  guildSettingsChangesEnabled: boolean
  guildSettingsGuildIds: string[]
  guildTemplateAuditEnabled: boolean
  guildTemplateChangesEnabled: boolean
  guildTemplateGuildIds: string[]
  integrationAuditEnabled: boolean
  integrationDeletionsEnabled: boolean
  integrationGuildIds: string[]
  integrationIds: string[]
  interactionChannelIds: string[]
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  interactionsEnabled: boolean
  inviteAuditEnabled: boolean
  inviteCapabilityRootCount: number
  inviteCreationChannelIds: string[]
  inviteCreationEnabled: boolean
  inviteRoleAssignmentEnabled: boolean
  inviteRoleIds: string[]
  inviteDeletionsEnabled: boolean
  inviteGuildIds: string[]
  memberDirectoryEnabled: boolean
  memberDirectoryGuildIds: string[]
  nicknameChangesEnabled: boolean
  nicknameGuildIds: string[]
  otherMemberNicknameChangesEnabled: boolean
  memberRoleChangesEnabled: boolean
  memberRoleGuildIds: string[]
  memberRoleCount: number
  memberVerificationChangesEnabled: boolean
  memberVerificationGuildIds: string[]
  memberVoiceAuditEnabled: boolean
  memberVoiceChangesEnabled: boolean
  memberVoiceChannelIds: string[]
  memberVoiceGuildIds: string[]
  crossGuildMessageForwardingEnabled: boolean
  messageForwardingEnabled: boolean
  messageForwardSourceChannelIds: string[]
  messageForwardTargetChannelIds: string[]
  nativeCommandChangesEnabled: boolean
  nativeCommandName: string
  nativeInteractionChannelIds: string[]
  nativeInteractionGuildIds: string[]
  nativeInteractionMaxPending: number
  nativeInteractionsEnabled: boolean
  nativeInteractionTtlSeconds: number
  nativeInteractionUserIds: string[]
  mentionUserCount: number
  mcpToolsets: McpToolsetName[]
  mcpToolSurface: McpToolSurface
  mcpReadResponseMaxBytes: number
  onboardingAuditEnabled: boolean
  onboardingChangesEnabled: boolean
  onboardingGuildIds: string[]
  permissionOverwriteChannelIds: string[]
  permissionOverwritesEnabled: boolean
  permissionSyncChannelIds: string[]
  permissionSyncsEnabled: boolean
  protectedUserCount: number
  pinChannelIds: string[]
  pinManagementEnabled: boolean
  pollAuditEnabled: boolean
  pollChannelIds: string[]
  pollCreationEnabled: boolean
  pollEndingEnabled: boolean
  pollVoterAuditEnabled: boolean
  reactionChannelIds: string[]
  reactionModerationEnabled: boolean
  reactionUserAuditEnabled: boolean
  readChannelScope: "all-visible" | "allowlist"
  readGuildScope: "all-visible" | "allowlist"
  roleCreationEnabled: boolean
  roleCreationGuildIds: string[]
  roleConfigurationEnabled: boolean
  roleConfigurationIds: string[]
  roleDeletionAuditEnabled: boolean
  roleDeletionIds: string[]
  roleDeletionsEnabled: boolean
  roleOrderingAuditEnabled: boolean
  roleOrderingChangesEnabled: boolean
  roleOrderingGuildIds: string[]
  scheduledEventAuditEnabled: boolean
  scheduledEventChangesEnabled: boolean
  scheduledEventCoverChangesEnabled: boolean
  scheduledEventGuildIds: string[]
  scheduledEventRootCount: number
  scheduledEventUserAuditEnabled: boolean
  soundboardAuditEnabled: boolean
  soundboardChangesEnabled: boolean
  soundboardCreationEnabled: boolean
  soundboardGuildIds: string[]
  soundboardPlaybackChannelIds: string[]
  soundboardPlaybackEnabled: boolean
  soundboardPlaybackSourceGuildIds: string[]
  soundboardRootCount: number
  stageChannelIds: string[]
  stageInstanceAuditEnabled: boolean
  stageInstanceChangesEnabled: boolean
  stageStartNotificationsEnabled: boolean
  threadCreationEnabled: boolean
  threadAuditEnabled: boolean
  threadChangesEnabled: boolean
  threadGuildIds: string[]
  threadIds: string[]
  threadMemberUserIds: string[]
  threadMessageWriteMode: "exact" | "inherit"
  threadParentIds: string[]
  threadReadMode: "exact" | "inherit"
  welcomeScreenAuditEnabled: boolean
  welcomeScreenChangesEnabled: boolean
  welcomeScreenGuildIds: string[]
  webhookAuditEnabled: boolean
  webhookChannelIds: string[]
  webhookGuildIds: string[]
  webhookChangesEnabled: boolean
  webhookCreationEnabled: boolean
  webhookDeletionsEnabled: boolean
  webhookMessageAuditEnabled: boolean
  webhookMessageChannelIds: string[]
  webhookMessageChangesEnabled: boolean
  webhookMessageDeletionsEnabled: boolean
  webhookMessageDeliveryEnabled: boolean
  widgetPublicExposureEnabled: boolean
  widgetSettingsAuditEnabled: boolean
  widgetSettingsChangesEnabled: boolean
  widgetSettingsGuildIds: string[]
  userMentionMode: "disabled" | "allowlist" | "reviewed"
}

export interface NotificationAuthorizationDecision {
  authorization: "direct" | "reviewed"
  allowlistedUserIds: string[]
  reviewedUserIds: string[]
}

const WEBHOOK_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])

const WEBHOOK_MESSAGE_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.text,
])

const THREAD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])

export class ScopePolicy {
  readonly #adminGuildIds: ReadonlySet<string>
  readonly #allowedChannelIds: ReadonlySet<string>
  readonly #allowedGuildIds: ReadonlySet<string>
  readonly #readChannelMode: ConnectorConfig["readChannelMode"]
  readonly #readGuildMode: ConnectorConfig["readGuildMode"]
  readonly #allowAdministration: boolean
  readonly #allowApplicationCommandChanges: boolean
  readonly #allowGlobalApplicationCommandChanges: boolean
  readonly #allowApplicationEmojiAudit: boolean
  readonly #allowApplicationEmojiChanges: boolean
  readonly #allowApplicationEntitlementConsumption: boolean
  readonly #allowApplicationIntentChanges: boolean
  readonly #allowBotProfileAudit: boolean
  readonly #allowBotProfileChanges: boolean
  readonly #allowApplicationMonetizationAudit: boolean
  readonly #allowApplicationTestEntitlementChanges: boolean
  readonly #allowApplicationRoleConnectionMetadataChanges: boolean
  readonly #allowAnnouncementCrossposts: boolean
  readonly #allowAnnouncementSubscriptionAudit: boolean
  readonly #allowAnnouncementSubscriptionChanges: boolean
  readonly #allowAttachments: boolean
  readonly #allowAutomodAudit: boolean
  readonly #allowAutomodChanges: boolean
  readonly #allowBanAudit: boolean
  readonly #allowBulkBanAudit: boolean
  readonly #allowBulkBans: boolean
  readonly #allowChannelCloneAudit: boolean
  readonly #allowChannelCloning: boolean
  readonly #allowChannelCreation: boolean
  readonly #allowChannelDeletionAudit: boolean
  readonly #allowChannelDeletions: boolean
  readonly #allowChannelMetadataChanges: boolean
  readonly #allowChannelOrderingAudit: boolean
  readonly #allowChannelOrderingChanges: boolean
  readonly #allowDeletions: boolean
  readonly #allowDirectMessageAudit: boolean
  readonly #allowDirectMessageAttachments: boolean
  readonly #allowDirectMessageDeletion: boolean
  readonly #allowDirectMessageDelivery: boolean
  readonly #allowDirectMessageEditing: boolean
  readonly #allowEmbedMessages: boolean
  readonly #allowInteractions: boolean
  readonly #allowInviteAudit: boolean
  readonly #allowInviteCreation: boolean
  readonly #allowInviteRoleAssignment: boolean
  readonly #allowInviteDeletions: boolean
  readonly #allowMemberDirectory: boolean
  readonly #allowNicknameChanges: boolean
  readonly #allowOtherMemberNicknameChanges: boolean
  readonly #allowMemberRoleChanges: boolean
  readonly #allowMemberVerificationChanges: boolean
  readonly #allowBulkMemberRoleChanges: boolean
  readonly #allowMemberVoiceAudit: boolean
  readonly #allowMemberVoiceChanges: boolean
  readonly #allowCrossGuildMessageForwarding: boolean
  readonly #allowMessageForwarding: boolean
  readonly #allowNativeCommandChanges: boolean
  readonly #allowNativeInteractions: boolean
  readonly #allowOnboardingAudit: boolean
  readonly #allowOnboardingChanges: boolean
  readonly #allowPermissionOverwrites: boolean
  readonly #allowPermissionSyncs: boolean
  readonly #allowPinManagement: boolean
  readonly #allowPollAudit: boolean
  readonly #allowPollCreation: boolean
  readonly #allowPollEnding: boolean
  readonly #allowPollVoterAudit: boolean
  readonly #allowReactionModeration: boolean
  readonly #allowReactionUserAudit: boolean
  readonly #allowGateway: boolean
  readonly #allowGuildCommunityAudit: boolean
  readonly #allowGuildCommunityChanges: boolean
  readonly #allowGuildDepartures: boolean
  readonly #allowGuildExpressionAudit: boolean
  readonly #allowGuildExpressionChanges: boolean
  readonly #allowGuildIncidentAudit: boolean
  readonly #allowGuildIncidentChanges: boolean
  readonly #allowGuildProfileAudit: boolean
  readonly #allowGuildProfileChanges: boolean
  readonly #allowGuildPruneAudit: boolean
  readonly #allowGuildPrunes: boolean
  readonly #allowGuildScaffolds: boolean
  readonly #allowGuildSettingsAudit: boolean
  readonly #allowGuildSettingsChanges: boolean
  readonly #allowGuildTemplateAudit: boolean
  readonly #allowGuildTemplateChanges: boolean
  readonly #allowIntegrationAudit: boolean
  readonly #allowIntegrationDeletions: boolean
  readonly #allowForumPosts: boolean
  readonly #allowForumTagAudit: boolean
  readonly #allowForumTagChanges: boolean
  readonly #allowRoleCreation: boolean
  readonly #allowRoleConfiguration: boolean
  readonly #allowRoleDeletionAudit: boolean
  readonly #allowRoleDeletions: boolean
  readonly #allowRoleOrderingAudit: boolean
  readonly #allowRoleOrderingChanges: boolean
  readonly #allowScheduledEventAudit: boolean
  readonly #allowScheduledEventChanges: boolean
  readonly #allowScheduledEventUserAudit: boolean
  readonly #allowSoundboardAudit: boolean
  readonly #allowSoundboardChanges: boolean
  readonly #allowSoundboardPlayback: boolean
  readonly #allowStageInstanceAudit: boolean
  readonly #allowStageInstanceChanges: boolean
  readonly #allowStageStartNotifications: boolean
  readonly #allowThreadCreation: boolean
  readonly #allowThreadAudit: boolean
  readonly #allowThreadChanges: boolean
  readonly #allowWelcomeScreenAudit: boolean
  readonly #allowWelcomeScreenChanges: boolean
  readonly #allowWebhookAudit: boolean
  readonly #allowWebhookChanges: boolean
  readonly #allowWebhookCreation: boolean
  readonly #allowWebhookDeletions: boolean
  readonly #allowWebhookMessageAudit: boolean
  readonly #allowWebhookMessageChanges: boolean
  readonly #allowWebhookMessageDeletions: boolean
  readonly #allowWebhookMessageDelivery: boolean
  readonly #allowWidgetPublicExposure: boolean
  readonly #allowWidgetSettingsAudit: boolean
  readonly #allowWidgetSettingsChanges: boolean
  readonly #deleteChannelIds: ReadonlySet<string>
  readonly #directMessageUserIds: ReadonlySet<string>
  readonly #embedMessageChannelIds: ReadonlySet<string>
  readonly #announcementCrosspostChannelIds: ReadonlySet<string>
  readonly #announcementSubscriptionSourceChannelIds: ReadonlySet<string>
  readonly #announcementSubscriptionTargetChannelIds: ReadonlySet<string>
  readonly #attachmentChannelIds: ReadonlySet<string>
  readonly #attachmentMaxBytes: number
  readonly #attachmentRoots: readonly string[]
  readonly #applicationEmojiRoots: readonly string[]
  readonly #botProfileRoots: readonly string[]
  readonly #applicationCommandGuildIds: ReadonlySet<string>
  readonly #applicationConsumableEntitlementSkuIds: ReadonlySet<string>
  readonly #applicationConsumableEntitlementUserIds: ReadonlySet<string>
  readonly #applicationEntitlementGuildIds: ReadonlySet<string>
  readonly #applicationEntitlementUserIds: ReadonlySet<string>
  readonly #applicationMonetizationSkuIds: ReadonlySet<string>
  readonly #applicationSubscriptionUserIds: ReadonlySet<string>
  readonly #applicationTestEntitlementGuildIds: ReadonlySet<string>
  readonly #applicationTestEntitlementSkuIds: ReadonlySet<string>
  readonly #applicationTestEntitlementUserIds: ReadonlySet<string>
  readonly #automodAlertChannelIds: ReadonlySet<string>
  readonly #automodGuildIds: ReadonlySet<string>
  readonly #banAuditGuildIds: ReadonlySet<string>
  readonly #bulkBanGuildIds: ReadonlySet<string>
  readonly #bulkMemberRoleGuildIds: ReadonlySet<string>
  readonly #bulkMemberRoleIds: ReadonlySet<string>
  readonly #channelCloneGuildIds: ReadonlySet<string>
  readonly #channelCloneSourceIds: ReadonlySet<string>
  readonly #channelCreationGuildIds: ReadonlySet<string>
  readonly #channelDeletionIds: ReadonlySet<string>
  readonly #channelMetadataIds: ReadonlySet<string>
  readonly #channelOrderingGuildIds: ReadonlySet<string>
  readonly #componentLinkOrigins: ReadonlySet<string>
  readonly #interactionChannelIds: ReadonlySet<string>
  readonly #interactionMaxWritesPerMinute: number
  readonly #interactionMinWriteIntervalMs: number
  readonly #inviteCapabilityRoots: readonly string[]
  readonly #inviteCreationChannelIds: ReadonlySet<string>
  readonly #inviteRoleIds: ReadonlySet<string>
  readonly #inviteGuildIds: ReadonlySet<string>
  readonly #gatewayEventBufferSize: number
  readonly #guildScaffoldGuildIds: ReadonlySet<string>
  readonly #guildCommunityGuildIds: ReadonlySet<string>
  readonly #guildDepartureGuildIds: ReadonlySet<string>
  readonly #guildExpressionGuildIds: ReadonlySet<string>
  readonly #guildExpressionRoots: readonly string[]
  readonly #guildIncidentGuildIds: ReadonlySet<string>
  readonly #guildProfileGuildIds: ReadonlySet<string>
  readonly #guildPruneGuildIds: ReadonlySet<string>
  readonly #guildPruneIncludeRoleIds: ReadonlySet<string>
  readonly #guildPruneMaxMembers: number
  readonly #guildSettingsGuildIds: ReadonlySet<string>
  readonly #guildTemplateGuildIds: ReadonlySet<string>
  readonly #integrationGuildIds: ReadonlySet<string>
  readonly #integrationIds: ReadonlySet<string>
  readonly #forumPostChannelIds: ReadonlySet<string>
  readonly #forumTagChannelIds: ReadonlySet<string>
  readonly #mentionUserIds: ReadonlySet<string>
  readonly #userMentionMode: ConnectorConfig["userMentionMode"]
  readonly #memberDirectoryGuildIds: ReadonlySet<string>
  readonly #nicknameGuildIds: ReadonlySet<string>
  readonly #memberRoleGuildIds: ReadonlySet<string>
  readonly #memberRoleIds: ReadonlySet<string>
  readonly #memberVerificationGuildIds: ReadonlySet<string>
  readonly #memberVoiceChannelIds: ReadonlySet<string>
  readonly #memberVoiceGuildIds: ReadonlySet<string>
  readonly #messageForwardSourceChannelIds: ReadonlySet<string>
  readonly #messageForwardTargetChannelIds: ReadonlySet<string>
  readonly #nativeCommandName: string
  readonly #nativeInteractionChannelIds: ReadonlySet<string>
  readonly #nativeInteractionGuildIds: ReadonlySet<string>
  readonly #nativeInteractionMaxPending: number
  readonly #nativeInteractionTtlSeconds: number
  readonly #nativeInteractionUserIds: ReadonlySet<string>
  readonly #mcpToolsets: ReadonlySet<McpToolsetName>
  readonly #mcpToolSurface: McpToolSurface
  readonly #mcpReadResponseMaxBytes: number
  readonly #onboardingGuildIds: ReadonlySet<string>
  readonly #permissionOverwriteChannelIds: ReadonlySet<string>
  readonly #permissionSyncChannelIds: ReadonlySet<string>
  readonly #protectedUserIds: ReadonlySet<string>
  readonly #pinChannelIds: ReadonlySet<string>
  readonly #pollChannelIds: ReadonlySet<string>
  readonly #reactionChannelIds: ReadonlySet<string>
  readonly #roleCreationGuildIds: ReadonlySet<string>
  readonly #roleConfigurationIds: ReadonlySet<string>
  readonly #roleDeletionIds: ReadonlySet<string>
  readonly #roleOrderingGuildIds: ReadonlySet<string>
  readonly #scheduledEventGuildIds: ReadonlySet<string>
  readonly #scheduledEventRoots: readonly string[]
  readonly #soundboardGuildIds: ReadonlySet<string>
  readonly #soundboardPlaybackChannelIds: ReadonlySet<string>
  readonly #soundboardPlaybackSourceGuildIds: ReadonlySet<string>
  readonly #soundboardRoots: readonly string[]
  readonly #stageChannelIds: ReadonlySet<string>
  readonly #threadParentIds: ReadonlySet<string>
  readonly #threadMessageWriteMode: ConnectorConfig["threadMessageWriteMode"]
  readonly #threadReadMode: ConnectorConfig["threadReadMode"]
  readonly #threadGuildIds: ReadonlySet<string>
  readonly #threadIds: ReadonlySet<string>
  readonly #threadMemberUserIds: ReadonlySet<string>
  readonly #welcomeScreenGuildIds: ReadonlySet<string>
  readonly #webhookChannelIds: ReadonlySet<string>
  readonly #webhookGuildIds: ReadonlySet<string>
  readonly #webhookMessageChannelIds: ReadonlySet<string>
  readonly #widgetSettingsGuildIds: ReadonlySet<string>

  constructor(config: Pick<
    ConnectorConfig,
    | "adminGuildIds"
    | "allowedChannelIds"
    | "allowedGuildIds"
    | "allowAdministration"
    | "allowDeletions"
    | "allowInteractions"
    | "deleteChannelIds"
    | "interactionChannelIds"
    | "interactionMaxWritesPerMinute"
    | "interactionMinWriteIntervalMs"
    | "mentionUserIds"
    | "protectedUserIds"
  > & Partial<Pick<
    ConnectorConfig,
    | "allowAnnouncementCrossposts"
    | "allowApplicationCommandChanges"
    | "allowGlobalApplicationCommandChanges"
    | "allowDirectMessageAudit"
    | "allowDirectMessageAttachments"
    | "allowDirectMessageDeletion"
    | "allowDirectMessageDelivery"
    | "allowDirectMessageEditing"
    | "allowEmbedMessages"
    | "allowApplicationEmojiAudit"
    | "allowApplicationEmojiChanges"
    | "allowApplicationEntitlementConsumption"
    | "allowApplicationIntentChanges"
    | "allowBotProfileAudit"
    | "allowBotProfileChanges"
    | "allowApplicationMonetizationAudit"
    | "allowApplicationTestEntitlementChanges"
    | "allowApplicationRoleConnectionMetadataChanges"
    | "allowAnnouncementSubscriptionAudit"
    | "allowAnnouncementSubscriptionChanges"
    | "allowAttachments"
    | "allowAutomodAudit"
    | "allowAutomodChanges"
    | "allowBanAudit"
    | "allowBulkBanAudit"
    | "allowBulkBans"
    | "allowBulkMemberRoleChanges"
    | "allowChannelCloneAudit"
    | "allowChannelCloning"
    | "allowChannelDeletionAudit"
    | "allowChannelDeletions"
    | "allowChannelMetadataChanges"
    | "allowChannelOrderingAudit"
    | "allowChannelOrderingChanges"
    | "allowGateway"
    | "allowGuildCommunityAudit"
    | "allowGuildCommunityChanges"
    | "allowGuildDepartures"
    | "allowGuildExpressionAudit"
    | "allowGuildExpressionChanges"
    | "allowGuildIncidentAudit"
    | "allowGuildIncidentChanges"
    | "allowGuildTemplateAudit"
    | "allowGuildTemplateChanges"
    | "allowIntegrationAudit"
    | "allowIntegrationDeletions"
    | "allowForumTagAudit"
    | "allowForumTagChanges"
    | "allowInviteAudit"
    | "allowInviteCreation"
    | "allowInviteRoleAssignment"
    | "allowInviteDeletions"
    | "allowMemberDirectory"
    | "allowNicknameChanges"
    | "allowOtherMemberNicknameChanges"
    | "allowMemberRoleChanges"
    | "allowMemberVerificationChanges"
    | "allowMemberVoiceAudit"
    | "allowMemberVoiceChanges"
    | "allowCrossGuildMessageForwarding"
    | "allowMessageForwarding"
    | "allowNativeCommandChanges"
    | "allowNativeInteractions"
    | "allowOnboardingAudit"
    | "allowOnboardingChanges"
    | "allowGuildScaffolds"
    | "allowPermissionOverwrites"
    | "allowPermissionSyncs"
    | "allowPinManagement"
    | "allowPollAudit"
    | "allowPollCreation"
    | "allowPollEnding"
    | "allowPollVoterAudit"
    | "allowReactionModeration"
    | "allowReactionUserAudit"
    | "allowForumPosts"
    | "allowChannelCreation"
    | "allowRoleCreation"
    | "allowRoleConfiguration"
    | "allowRoleDeletionAudit"
    | "allowRoleDeletions"
    | "allowRoleOrderingAudit"
    | "allowRoleOrderingChanges"
    | "allowGuildProfileAudit"
    | "allowGuildProfileChanges"
    | "allowGuildPruneAudit"
    | "allowGuildPrunes"
    | "allowGuildSettingsAudit"
    | "allowGuildSettingsChanges"
    | "allowScheduledEventAudit"
    | "allowScheduledEventChanges"
    | "allowScheduledEventUserAudit"
    | "allowSoundboardAudit"
    | "allowSoundboardChanges"
    | "allowSoundboardPlayback"
    | "allowStageInstanceAudit"
    | "allowStageInstanceChanges"
    | "allowStageStartNotifications"
    | "allowThreadCreation"
    | "allowThreadAudit"
    | "allowThreadChanges"
    | "allowWelcomeScreenAudit"
    | "allowWelcomeScreenChanges"
    | "allowWebhookAudit"
    | "allowWebhookChanges"
    | "allowWebhookCreation"
    | "allowWebhookDeletions"
    | "allowWebhookMessageAudit"
    | "allowWebhookMessageChanges"
    | "allowWebhookMessageDeletions"
    | "allowWebhookMessageDelivery"
    | "allowWidgetPublicExposure"
    | "allowWidgetSettingsAudit"
    | "allowWidgetSettingsChanges"
    | "channelCreationGuildIds"
    | "directMessageUserIds"
    | "embedMessageChannelIds"
    | "channelDeletionIds"
    | "channelCloneGuildIds"
    | "channelCloneSourceIds"
    | "announcementCrosspostChannelIds"
    | "announcementSubscriptionSourceChannelIds"
    | "announcementSubscriptionTargetChannelIds"
    | "channelMetadataIds"
    | "channelOrderingGuildIds"
    | "componentLinkOrigins"
    | "attachmentChannelIds"
    | "attachmentMaxBytes"
    | "attachmentRoots"
    | "applicationEmojiRoots"
    | "botProfileRoots"
    | "applicationCommandGuildIds"
    | "applicationConsumableEntitlementSkuIds"
    | "applicationConsumableEntitlementUserIds"
    | "applicationEntitlementGuildIds"
    | "applicationEntitlementUserIds"
    | "applicationMonetizationSkuIds"
    | "applicationSubscriptionUserIds"
    | "applicationTestEntitlementGuildIds"
    | "applicationTestEntitlementSkuIds"
    | "applicationTestEntitlementUserIds"
    | "automodAlertChannelIds"
    | "automodGuildIds"
    | "banAuditGuildIds"
    | "bulkBanGuildIds"
    | "bulkMemberRoleGuildIds"
    | "bulkMemberRoleIds"
    | "gatewayEventBufferSize"
    | "guildScaffoldGuildIds"
    | "guildCommunityGuildIds"
    | "guildDepartureGuildIds"
    | "guildExpressionGuildIds"
    | "guildExpressionRoots"
    | "guildIncidentGuildIds"
    | "guildProfileGuildIds"
    | "guildPruneGuildIds"
    | "guildPruneIncludeRoleIds"
    | "guildPruneMaxMembers"
    | "guildSettingsGuildIds"
    | "guildTemplateGuildIds"
    | "integrationGuildIds"
    | "integrationIds"
    | "inviteCapabilityRoots"
    | "inviteCreationChannelIds"
    | "inviteRoleIds"
    | "inviteGuildIds"
    | "userMentionMode"
    | "memberDirectoryGuildIds"
    | "nicknameGuildIds"
    | "memberRoleGuildIds"
    | "memberRoleIds"
    | "memberVerificationGuildIds"
    | "memberVoiceChannelIds"
    | "memberVoiceGuildIds"
    | "messageForwardSourceChannelIds"
    | "messageForwardTargetChannelIds"
    | "nativeCommandName"
    | "nativeInteractionChannelIds"
    | "nativeInteractionGuildIds"
    | "nativeInteractionMaxPending"
    | "nativeInteractionTtlSeconds"
    | "nativeInteractionUserIds"
    | "forumPostChannelIds"
    | "forumTagChannelIds"
    | "mcpToolsets"
    | "mcpToolSurface"
    | "mcpReadResponseMaxBytes"
    | "readChannelMode"
    | "readGuildMode"
    | "onboardingGuildIds"
    | "permissionOverwriteChannelIds"
    | "permissionSyncChannelIds"
    | "pinChannelIds"
    | "pollChannelIds"
    | "reactionChannelIds"
    | "roleCreationGuildIds"
    | "roleConfigurationIds"
    | "roleDeletionIds"
    | "roleOrderingGuildIds"
    | "scheduledEventGuildIds"
    | "scheduledEventRoots"
    | "soundboardGuildIds"
    | "soundboardPlaybackChannelIds"
    | "soundboardPlaybackSourceGuildIds"
    | "soundboardRoots"
    | "stageChannelIds"
    | "threadParentIds"
    | "threadMessageWriteMode"
    | "threadReadMode"
    | "threadGuildIds"
    | "threadIds"
    | "threadMemberUserIds"
    | "welcomeScreenGuildIds"
    | "webhookChannelIds"
    | "webhookGuildIds"
    | "webhookMessageChannelIds"
    | "widgetSettingsGuildIds"
  >>) {
    this.#adminGuildIds = config.adminGuildIds
    this.#allowedChannelIds = config.allowedChannelIds
    this.#allowedGuildIds = config.allowedGuildIds
    this.#readChannelMode = config.readChannelMode
      ?? (config.allowedChannelIds.size > 0 ? "allowlist" : "all-visible")
    this.#readGuildMode = config.readGuildMode
      ?? (config.allowedGuildIds.size > 0 ? "allowlist" : "all-visible")
    this.#allowAdministration = config.allowAdministration
    this.#allowApplicationCommandChanges = config.allowApplicationCommandChanges ?? false
    this.#allowGlobalApplicationCommandChanges =
      config.allowGlobalApplicationCommandChanges ?? false
    this.#allowApplicationEmojiAudit = config.allowApplicationEmojiAudit ?? false
    this.#allowApplicationEmojiChanges = config.allowApplicationEmojiChanges ?? false
    this.#allowApplicationEntitlementConsumption =
      config.allowApplicationEntitlementConsumption ?? false
    this.#allowApplicationIntentChanges = config.allowApplicationIntentChanges ?? false
    this.#allowBotProfileAudit = config.allowBotProfileAudit ?? false
    this.#allowBotProfileChanges = config.allowBotProfileChanges ?? false
    this.#allowApplicationMonetizationAudit = config.allowApplicationMonetizationAudit ?? false
    this.#allowApplicationTestEntitlementChanges =
      config.allowApplicationTestEntitlementChanges ?? false
    this.#allowApplicationRoleConnectionMetadataChanges =
      config.allowApplicationRoleConnectionMetadataChanges ?? false
    this.#allowAnnouncementCrossposts = config.allowAnnouncementCrossposts ?? false
    this.#allowAnnouncementSubscriptionAudit = config.allowAnnouncementSubscriptionAudit
      ?? false
    this.#allowAnnouncementSubscriptionChanges = config.allowAnnouncementSubscriptionChanges
      ?? false
    this.#allowAttachments = config.allowAttachments ?? false
    this.#allowAutomodAudit = config.allowAutomodAudit ?? false
    this.#allowAutomodChanges = config.allowAutomodChanges ?? false
    this.#allowBanAudit = config.allowBanAudit ?? false
    this.#allowBulkBanAudit = config.allowBulkBanAudit ?? false
    this.#allowBulkBans = config.allowBulkBans ?? false
    this.#allowBulkMemberRoleChanges = config.allowBulkMemberRoleChanges ?? false
    this.#allowChannelCloneAudit = config.allowChannelCloneAudit ?? false
    this.#allowChannelCloning = config.allowChannelCloning ?? false
    this.#allowChannelCreation = config.allowChannelCreation ?? false
    this.#allowChannelDeletionAudit = config.allowChannelDeletionAudit ?? false
    this.#allowChannelDeletions = config.allowChannelDeletions ?? false
    this.#allowChannelOrderingAudit = config.allowChannelOrderingAudit ?? false
    this.#allowChannelOrderingChanges = config.allowChannelOrderingChanges ?? false
    this.#allowChannelMetadataChanges = config.allowChannelMetadataChanges ?? false
    this.#allowDeletions = config.allowDeletions
    this.#allowDirectMessageAudit = config.allowDirectMessageAudit ?? false
    this.#allowDirectMessageAttachments = config.allowDirectMessageAttachments ?? false
    this.#allowDirectMessageDeletion = config.allowDirectMessageDeletion ?? false
    this.#allowDirectMessageDelivery = config.allowDirectMessageDelivery ?? false
    this.#allowDirectMessageEditing = config.allowDirectMessageEditing ?? false
    this.#allowEmbedMessages = config.allowEmbedMessages ?? false
    this.#allowInteractions = config.allowInteractions
    this.#allowInviteAudit = config.allowInviteAudit ?? false
    this.#allowInviteCreation = config.allowInviteCreation ?? false
    this.#allowInviteRoleAssignment = config.allowInviteRoleAssignment ?? false
    this.#allowInviteDeletions = config.allowInviteDeletions ?? false
    this.#allowMemberDirectory = config.allowMemberDirectory ?? false
    this.#allowNicknameChanges = config.allowNicknameChanges ?? false
    this.#allowOtherMemberNicknameChanges = config.allowOtherMemberNicknameChanges
      ?? false
    this.#allowMemberRoleChanges = config.allowMemberRoleChanges ?? false
    this.#allowMemberVerificationChanges = config.allowMemberVerificationChanges ?? false
    this.#allowMemberVoiceAudit = config.allowMemberVoiceAudit ?? false
    this.#allowMemberVoiceChanges = config.allowMemberVoiceChanges ?? false
    this.#allowCrossGuildMessageForwarding = config.allowCrossGuildMessageForwarding ?? false
    this.#allowMessageForwarding = config.allowMessageForwarding ?? false
    this.#allowNativeCommandChanges = config.allowNativeCommandChanges ?? false
    this.#allowNativeInteractions = config.allowNativeInteractions ?? false
    this.#allowOnboardingAudit = config.allowOnboardingAudit ?? false
    this.#allowOnboardingChanges = config.allowOnboardingChanges ?? false
    this.#allowPermissionOverwrites = config.allowPermissionOverwrites ?? false
    this.#allowPermissionSyncs = config.allowPermissionSyncs ?? false
    this.#allowPinManagement = config.allowPinManagement ?? false
    this.#allowPollAudit = config.allowPollAudit ?? false
    this.#allowPollCreation = config.allowPollCreation ?? false
    this.#allowPollEnding = config.allowPollEnding ?? false
    this.#allowPollVoterAudit = config.allowPollVoterAudit ?? false
    this.#allowReactionModeration = config.allowReactionModeration ?? false
    this.#allowReactionUserAudit = config.allowReactionUserAudit ?? false
    this.#allowGateway = config.allowGateway ?? false
    this.#allowGuildCommunityAudit = config.allowGuildCommunityAudit ?? false
    this.#allowGuildCommunityChanges = config.allowGuildCommunityChanges ?? false
    this.#allowGuildDepartures = config.allowGuildDepartures ?? false
    this.#allowGuildExpressionAudit = config.allowGuildExpressionAudit ?? false
    this.#allowGuildExpressionChanges = config.allowGuildExpressionChanges ?? false
    this.#allowGuildIncidentAudit = config.allowGuildIncidentAudit ?? false
    this.#allowGuildIncidentChanges = config.allowGuildIncidentChanges ?? false
    this.#allowGuildProfileAudit = config.allowGuildProfileAudit ?? false
    this.#allowGuildProfileChanges = config.allowGuildProfileChanges ?? false
    this.#allowGuildPruneAudit = config.allowGuildPruneAudit ?? false
    this.#allowGuildPrunes = config.allowGuildPrunes ?? false
    this.#allowGuildScaffolds = config.allowGuildScaffolds ?? false
    this.#allowGuildSettingsAudit = config.allowGuildSettingsAudit ?? false
    this.#allowGuildSettingsChanges = config.allowGuildSettingsChanges ?? false
    this.#allowGuildTemplateAudit = config.allowGuildTemplateAudit ?? false
    this.#allowGuildTemplateChanges = config.allowGuildTemplateChanges ?? false
    this.#allowIntegrationAudit = config.allowIntegrationAudit ?? false
    this.#allowIntegrationDeletions = config.allowIntegrationDeletions ?? false
    this.#allowForumPosts = config.allowForumPosts ?? false
    this.#allowForumTagAudit = config.allowForumTagAudit ?? false
    this.#allowForumTagChanges = config.allowForumTagChanges ?? false
    this.#allowRoleCreation = config.allowRoleCreation ?? false
    this.#allowRoleConfiguration = config.allowRoleConfiguration ?? false
    this.#allowRoleDeletionAudit = config.allowRoleDeletionAudit ?? false
    this.#allowRoleDeletions = config.allowRoleDeletions ?? false
    this.#allowRoleOrderingAudit = config.allowRoleOrderingAudit ?? false
    this.#allowRoleOrderingChanges = config.allowRoleOrderingChanges ?? false
    this.#allowScheduledEventAudit = config.allowScheduledEventAudit ?? false
    this.#allowScheduledEventChanges = config.allowScheduledEventChanges ?? false
    this.#allowScheduledEventUserAudit = config.allowScheduledEventUserAudit ?? false
    this.#allowSoundboardAudit = config.allowSoundboardAudit ?? false
    this.#allowSoundboardChanges = config.allowSoundboardChanges ?? false
    this.#allowSoundboardPlayback = config.allowSoundboardPlayback ?? false
    this.#allowStageInstanceAudit = config.allowStageInstanceAudit ?? false
    this.#allowStageInstanceChanges = config.allowStageInstanceChanges ?? false
    this.#allowStageStartNotifications = config.allowStageStartNotifications ?? false
    this.#allowThreadCreation = config.allowThreadCreation ?? false
    this.#allowThreadAudit = config.allowThreadAudit ?? false
    this.#allowThreadChanges = config.allowThreadChanges ?? false
    this.#allowWelcomeScreenAudit = config.allowWelcomeScreenAudit ?? false
    this.#allowWelcomeScreenChanges = config.allowWelcomeScreenChanges ?? false
    this.#allowWebhookAudit = config.allowWebhookAudit ?? false
    this.#allowWebhookChanges = config.allowWebhookChanges ?? false
    this.#allowWebhookCreation = config.allowWebhookCreation ?? false
    this.#allowWebhookDeletions = config.allowWebhookDeletions ?? false
    this.#allowWebhookMessageAudit = config.allowWebhookMessageAudit ?? false
    this.#allowWebhookMessageChanges = config.allowWebhookMessageChanges ?? false
    this.#allowWebhookMessageDeletions = config.allowWebhookMessageDeletions ?? false
    this.#allowWebhookMessageDelivery = config.allowWebhookMessageDelivery ?? false
    this.#allowWidgetPublicExposure = config.allowWidgetPublicExposure ?? false
    this.#allowWidgetSettingsAudit = config.allowWidgetSettingsAudit ?? false
    this.#allowWidgetSettingsChanges = config.allowWidgetSettingsChanges ?? false
    this.#deleteChannelIds = config.deleteChannelIds
    this.#directMessageUserIds = config.directMessageUserIds ?? new Set()
    this.#embedMessageChannelIds = config.embedMessageChannelIds ?? new Set()
    this.#announcementCrosspostChannelIds = config.announcementCrosspostChannelIds ?? new Set()
    this.#announcementSubscriptionSourceChannelIds = config
      .announcementSubscriptionSourceChannelIds ?? new Set()
    this.#announcementSubscriptionTargetChannelIds = config
      .announcementSubscriptionTargetChannelIds ?? new Set()
    this.#attachmentChannelIds = config.attachmentChannelIds ?? new Set()
    this.#attachmentMaxBytes = config.attachmentMaxBytes ?? 0
    this.#attachmentRoots = config.attachmentRoots ?? []
    this.#applicationEmojiRoots = config.applicationEmojiRoots ?? []
    this.#botProfileRoots = config.botProfileRoots ?? []
    this.#applicationCommandGuildIds = config.applicationCommandGuildIds ?? new Set()
    this.#applicationConsumableEntitlementSkuIds =
      config.applicationConsumableEntitlementSkuIds ?? new Set()
    this.#applicationConsumableEntitlementUserIds =
      config.applicationConsumableEntitlementUserIds ?? new Set()
    this.#applicationEntitlementGuildIds = config.applicationEntitlementGuildIds ?? new Set()
    this.#applicationEntitlementUserIds = config.applicationEntitlementUserIds ?? new Set()
    this.#applicationMonetizationSkuIds = config.applicationMonetizationSkuIds ?? new Set()
    this.#applicationSubscriptionUserIds = config.applicationSubscriptionUserIds ?? new Set()
    this.#applicationTestEntitlementGuildIds =
      config.applicationTestEntitlementGuildIds ?? new Set()
    this.#applicationTestEntitlementSkuIds =
      config.applicationTestEntitlementSkuIds ?? new Set()
    this.#applicationTestEntitlementUserIds =
      config.applicationTestEntitlementUserIds ?? new Set()
    this.#automodAlertChannelIds = config.automodAlertChannelIds ?? new Set()
    this.#automodGuildIds = config.automodGuildIds ?? new Set()
    this.#banAuditGuildIds = config.banAuditGuildIds ?? new Set()
    this.#bulkBanGuildIds = config.bulkBanGuildIds ?? new Set()
    this.#bulkMemberRoleGuildIds = config.bulkMemberRoleGuildIds ?? new Set()
    this.#bulkMemberRoleIds = config.bulkMemberRoleIds ?? new Set()
    this.#channelCloneGuildIds = config.channelCloneGuildIds ?? new Set()
    this.#channelCloneSourceIds = config.channelCloneSourceIds ?? new Set()
    this.#channelCreationGuildIds = config.channelCreationGuildIds ?? new Set()
    this.#channelDeletionIds = config.channelDeletionIds ?? new Set()
    this.#channelMetadataIds = config.channelMetadataIds ?? new Set()
    this.#channelOrderingGuildIds = config.channelOrderingGuildIds ?? new Set()
    this.#componentLinkOrigins = config.componentLinkOrigins ?? new Set()
    this.#interactionChannelIds = config.interactionChannelIds
    this.#interactionMaxWritesPerMinute = config.interactionMaxWritesPerMinute
    this.#interactionMinWriteIntervalMs = config.interactionMinWriteIntervalMs
    this.#inviteCapabilityRoots = config.inviteCapabilityRoots ?? []
    this.#inviteCreationChannelIds = config.inviteCreationChannelIds ?? new Set()
    this.#inviteRoleIds = config.inviteRoleIds ?? new Set()
    this.#inviteGuildIds = config.inviteGuildIds ?? new Set()
    this.#gatewayEventBufferSize = config.gatewayEventBufferSize
      ?? GATEWAY_DEFAULTS.eventBufferSize
    this.#guildScaffoldGuildIds = config.guildScaffoldGuildIds ?? new Set()
    this.#guildCommunityGuildIds = config.guildCommunityGuildIds ?? new Set()
    this.#guildDepartureGuildIds = config.guildDepartureGuildIds ?? new Set()
    this.#guildExpressionGuildIds = config.guildExpressionGuildIds ?? new Set()
    this.#guildExpressionRoots = config.guildExpressionRoots ?? []
    this.#guildIncidentGuildIds = config.guildIncidentGuildIds ?? new Set()
    this.#guildProfileGuildIds = config.guildProfileGuildIds ?? new Set()
    this.#guildPruneGuildIds = config.guildPruneGuildIds ?? new Set()
    this.#guildPruneIncludeRoleIds = config.guildPruneIncludeRoleIds ?? new Set()
    this.#guildPruneMaxMembers = config.guildPruneMaxMembers ?? 0
    this.#guildSettingsGuildIds = config.guildSettingsGuildIds ?? new Set()
    this.#guildTemplateGuildIds = config.guildTemplateGuildIds ?? new Set()
    this.#integrationGuildIds = config.integrationGuildIds ?? new Set()
    this.#integrationIds = config.integrationIds ?? new Set()
    this.#forumPostChannelIds = config.forumPostChannelIds ?? new Set()
    this.#forumTagChannelIds = config.forumTagChannelIds ?? new Set()
    this.#mentionUserIds = config.mentionUserIds
    this.#userMentionMode = config.userMentionMode ?? "allowlist"
    this.#memberDirectoryGuildIds = config.memberDirectoryGuildIds ?? new Set()
    this.#nicknameGuildIds = config.nicknameGuildIds ?? new Set()
    this.#memberRoleGuildIds = config.memberRoleGuildIds ?? new Set()
    this.#memberRoleIds = config.memberRoleIds ?? new Set()
    this.#memberVerificationGuildIds = config.memberVerificationGuildIds ?? new Set()
    this.#memberVoiceChannelIds = config.memberVoiceChannelIds ?? new Set()
    this.#memberVoiceGuildIds = config.memberVoiceGuildIds ?? new Set()
    this.#messageForwardSourceChannelIds = config.messageForwardSourceChannelIds ?? new Set()
    this.#messageForwardTargetChannelIds = config.messageForwardTargetChannelIds ?? new Set()
    this.#nativeCommandName = config.nativeCommandName ?? "guildcontrol"
    this.#nativeInteractionChannelIds = config.nativeInteractionChannelIds ?? new Set()
    this.#nativeInteractionGuildIds = config.nativeInteractionGuildIds ?? new Set()
    this.#nativeInteractionMaxPending = config.nativeInteractionMaxPending ?? 25
    this.#nativeInteractionTtlSeconds = config.nativeInteractionTtlSeconds ?? 600
    this.#nativeInteractionUserIds = config.nativeInteractionUserIds ?? new Set()
    this.#mcpToolsets = config.mcpToolsets ?? new Set(MCP_TOOLSET_NAMES)
    this.#mcpToolSurface = config.mcpToolSurface ?? "full"
    this.#mcpReadResponseMaxBytes = config.mcpReadResponseMaxBytes
      ?? MCP_READ_RESPONSE_DEFAULTS.maxBytes
    this.#onboardingGuildIds = config.onboardingGuildIds ?? new Set()
    this.#permissionOverwriteChannelIds = config.permissionOverwriteChannelIds ?? new Set()
    this.#permissionSyncChannelIds = config.permissionSyncChannelIds ?? new Set()
    this.#protectedUserIds = config.protectedUserIds
    this.#pinChannelIds = config.pinChannelIds ?? new Set()
    this.#pollChannelIds = config.pollChannelIds ?? new Set()
    this.#reactionChannelIds = config.reactionChannelIds ?? new Set()
    this.#roleCreationGuildIds = config.roleCreationGuildIds ?? new Set()
    this.#roleConfigurationIds = config.roleConfigurationIds ?? new Set()
    this.#roleDeletionIds = config.roleDeletionIds ?? new Set()
    this.#roleOrderingGuildIds = config.roleOrderingGuildIds ?? new Set()
    this.#scheduledEventGuildIds = config.scheduledEventGuildIds ?? new Set()
    this.#scheduledEventRoots = config.scheduledEventRoots ?? []
    this.#soundboardGuildIds = config.soundboardGuildIds ?? new Set()
    this.#soundboardPlaybackChannelIds = config.soundboardPlaybackChannelIds ?? new Set()
    this.#soundboardPlaybackSourceGuildIds = config.soundboardPlaybackSourceGuildIds ?? new Set()
    this.#soundboardRoots = config.soundboardRoots ?? []
    this.#stageChannelIds = config.stageChannelIds ?? new Set()
    this.#threadParentIds = config.threadParentIds ?? new Set()
    this.#threadMessageWriteMode = config.threadMessageWriteMode ?? "exact"
    this.#threadReadMode = config.threadReadMode ?? "inherit"
    this.#threadGuildIds = config.threadGuildIds ?? new Set()
    this.#threadIds = config.threadIds ?? new Set()
    this.#threadMemberUserIds = config.threadMemberUserIds ?? new Set()
    this.#welcomeScreenGuildIds = config.welcomeScreenGuildIds ?? new Set()
    this.#webhookChannelIds = config.webhookChannelIds ?? new Set()
    this.#webhookGuildIds = config.webhookGuildIds ?? new Set()
    this.#webhookMessageChannelIds = config.webhookMessageChannelIds ?? new Set()
    this.#widgetSettingsGuildIds = config.widgetSettingsGuildIds ?? new Set()
  }

  describe(): PolicyDescription {
    return {
      administrationEnabled: this.#allowAdministration && this.#adminGuildIds.size > 0,
      administrationGuildIds: [...this.#adminGuildIds].sort(),
      applicationCommandChangesEnabled: this.#allowApplicationCommandChanges
        && this.#applicationCommandGuildIds.size > 0,
      applicationCommandGuildIds: [...this.#applicationCommandGuildIds].sort(),
      globalApplicationCommandChangesEnabled: this.#allowGlobalApplicationCommandChanges,
      applicationEmojiAuditEnabled: this.#allowApplicationEmojiAudit,
      applicationEmojiChangesEnabled: this.#allowApplicationEmojiAudit
        && this.#allowApplicationEmojiChanges,
      applicationEmojiCreationEnabled: this.#allowApplicationEmojiAudit
        && this.#allowApplicationEmojiChanges
        && this.#applicationEmojiRoots.length > 0,
      applicationEmojiRootCount: this.#applicationEmojiRoots.length,
      applicationConsumableEntitlementSkuIds: [
        ...this.#applicationConsumableEntitlementSkuIds,
      ].sort(),
      applicationConsumableEntitlementUserIds: [
        ...this.#applicationConsumableEntitlementUserIds,
      ].sort(),
      applicationEntitlementConsumptionEnabled:
        this.#allowApplicationEntitlementConsumption
        && this.#applicationConsumableEntitlementSkuIds.size > 0
        && this.#applicationConsumableEntitlementUserIds.size > 0,
      applicationIntentChangesEnabled: this.#allowApplicationIntentChanges,
      botProfileAuditEnabled: this.#allowBotProfileAudit,
      botProfileChangesEnabled: this.#allowBotProfileAudit
        && this.#allowBotProfileChanges,
      botProfileImageReplacementEnabled: this.#allowBotProfileAudit
        && this.#allowBotProfileChanges
        && this.#botProfileRoots.length > 0,
      botProfileRootCount: this.#botProfileRoots.length,
      applicationEntitlementGuildIds: [...this.#applicationEntitlementGuildIds].sort(),
      applicationEntitlementUserIds: [...this.#applicationEntitlementUserIds].sort(),
      applicationMonetizationAuditEnabled: this.#allowApplicationMonetizationAudit
        && this.#applicationMonetizationSkuIds.size > 0
        && (
          this.#applicationEntitlementGuildIds.size > 0
          || this.#applicationEntitlementUserIds.size > 0
          || this.#applicationSubscriptionUserIds.size > 0
        ),
      applicationMonetizationSkuIds: [...this.#applicationMonetizationSkuIds].sort(),
      applicationSubscriptionUserIds: [...this.#applicationSubscriptionUserIds].sort(),
      applicationTestEntitlementChangesEnabled:
        this.#allowApplicationTestEntitlementChanges
        && this.#applicationTestEntitlementSkuIds.size > 0
        && (
          this.#applicationTestEntitlementGuildIds.size > 0
          || this.#applicationTestEntitlementUserIds.size > 0
        ),
      applicationTestEntitlementGuildIds: [
        ...this.#applicationTestEntitlementGuildIds,
      ].sort(),
      applicationTestEntitlementSkuIds: [...this.#applicationTestEntitlementSkuIds].sort(),
      applicationTestEntitlementUserIds: [
        ...this.#applicationTestEntitlementUserIds,
      ].sort(),
      applicationRoleConnectionMetadataChangesEnabled:
        this.#allowApplicationRoleConnectionMetadataChanges,
      announcementCrosspostChannelIds: [...this.#announcementCrosspostChannelIds].sort(),
      announcementCrosspostsEnabled: this.#allowAnnouncementCrossposts
        && this.#announcementCrosspostChannelIds.size > 0,
      announcementSubscriptionAuditEnabled: this.#allowAnnouncementSubscriptionAudit
        && this.#announcementSubscriptionTargetChannelIds.size > 0,
      announcementSubscriptionChangesEnabled: this.#allowAnnouncementSubscriptionAudit
        && this.#allowAnnouncementSubscriptionChanges
        && this.#announcementSubscriptionTargetChannelIds.size > 0,
      announcementSubscriptionSourceChannelIds: [
        ...this.#announcementSubscriptionSourceChannelIds,
      ].sort(),
      announcementSubscriptionTargetChannelIds: [
        ...this.#announcementSubscriptionTargetChannelIds,
      ].sort(),
      allowedChannelIds: [...this.#allowedChannelIds].sort(),
      allowedGuildIds: [...this.#allowedGuildIds].sort(),
      attachmentChannelIds: [...this.#attachmentChannelIds].sort(),
      attachmentMaxBytes: this.#attachmentMaxBytes,
      attachmentRootCount: this.#attachmentRoots.length,
      attachmentsEnabled: this.#allowAttachments
        && this.#attachmentChannelIds.size > 0
        && this.#attachmentRoots.length > 0,
      automodAlertChannelIds: [...this.#automodAlertChannelIds].sort(),
      automodAuditEnabled: this.#allowAutomodAudit
        && this.#automodGuildIds.size > 0,
      automodChangesEnabled: this.#allowAutomodAudit
        && this.#allowAutomodChanges
        && this.#automodGuildIds.size > 0,
      automodGuildIds: [...this.#automodGuildIds].sort(),
      banAuditEnabled: this.#allowBanAudit && this.#banAuditGuildIds.size > 0,
      banAuditGuildIds: [...this.#banAuditGuildIds].sort(),
      bulkBanAuditEnabled: this.#allowBulkBanAudit && this.#bulkBanGuildIds.size > 0,
      bulkBanGuildIds: [...this.#bulkBanGuildIds].sort(),
      bulkBansEnabled: this.#allowBulkBanAudit
        && this.#allowBulkBans
        && this.#bulkBanGuildIds.size > 0,
      bulkMemberRoleChangesEnabled: this.#allowBulkMemberRoleChanges
        && this.#bulkMemberRoleGuildIds.size > 0
        && this.#bulkMemberRoleIds.size > 0,
      bulkMemberRoleGuildIds: [...this.#bulkMemberRoleGuildIds].sort(),
      bulkMemberRoleCount: this.#bulkMemberRoleIds.size,
      channelCloneAuditEnabled: this.#allowChannelCloneAudit
        && this.#channelCloneGuildIds.size > 0
        && this.#channelCloneSourceIds.size > 0,
      channelCloneGuildIds: [...this.#channelCloneGuildIds].sort(),
      channelCloneSourceIds: [...this.#channelCloneSourceIds].sort(),
      channelCloningEnabled: this.#allowChannelCloneAudit
        && this.#allowChannelCloning
        && this.#channelCloneGuildIds.size > 0
        && this.#channelCloneSourceIds.size > 0,
      channelCreationEnabled: this.#allowChannelCreation
        && this.#channelCreationGuildIds.size > 0,
      channelCreationGuildIds: [...this.#channelCreationGuildIds].sort(),
      channelDeletionAuditEnabled: this.#allowChannelDeletionAudit
        && this.#channelDeletionIds.size > 0,
      channelDeletionIds: [...this.#channelDeletionIds].sort(),
      channelDeletionsEnabled: this.#allowChannelDeletionAudit
        && this.#allowChannelDeletions
        && this.#channelDeletionIds.size > 0,
      channelMetadataChangesEnabled: this.#allowChannelMetadataChanges
        && this.#channelMetadataIds.size > 0,
      channelMetadataIds: [...this.#channelMetadataIds].sort(),
      channelOrderingAuditEnabled: this.#allowChannelOrderingAudit
        && this.#channelOrderingGuildIds.size > 0,
      channelOrderingChangesEnabled: this.#allowChannelOrderingAudit
        && this.#allowChannelOrderingChanges
        && this.#channelOrderingGuildIds.size > 0,
      channelOrderingGuildIds: [...this.#channelOrderingGuildIds].sort(),
      componentLinkOrigins: [...this.#componentLinkOrigins].sort(),
      deleteChannelIds: [...this.#deleteChannelIds].sort(),
      deletionsEnabled: this.#allowDeletions && this.#deleteChannelIds.size > 0,
      directMessageAuditEnabled: this.#allowDirectMessageAudit
        && this.#directMessageUserIds.size > 0,
      directMessageAttachmentsEnabled: this.#allowDirectMessageDelivery
        && this.#allowDirectMessageAttachments
        && this.#directMessageUserIds.size > 0
        && this.#attachmentRoots.length > 0,
      directMessageDeletionEnabled: this.#allowDirectMessageDeletion
        && this.#directMessageUserIds.size > 0,
      directMessageDeliveryEnabled: this.#allowDirectMessageDelivery
        && this.#directMessageUserIds.size > 0,
      directMessageEditingEnabled: this.#allowDirectMessageEditing
        && this.#directMessageUserIds.size > 0,
      directMessageUserIds: [...this.#directMessageUserIds].sort(),
      embedMessageChannelIds: [...this.#embedMessageChannelIds].sort(),
      embedMessagesEnabled: this.#allowEmbedMessages
        && this.#embedMessageChannelIds.size > 0,
      gatewayEnabled: this.#allowGateway,
      gatewayEventBufferSize: this.#gatewayEventBufferSize,
      guildScaffoldGuildIds: [...this.#guildScaffoldGuildIds].sort(),
      guildScaffoldsEnabled: this.#allowGuildScaffolds
        && this.#guildScaffoldGuildIds.size > 0,
      guildExpressionAuditEnabled: this.#allowGuildExpressionAudit
        && this.#guildExpressionGuildIds.size > 0,
      guildExpressionChangesEnabled: this.#allowGuildExpressionAudit
        && this.#allowGuildExpressionChanges
        && this.#guildExpressionGuildIds.size > 0,
      guildExpressionCreationEnabled: this.#allowGuildExpressionAudit
        && this.#allowGuildExpressionChanges
        && this.#guildExpressionGuildIds.size > 0
        && this.#guildExpressionRoots.length > 0,
      guildExpressionGuildIds: [...this.#guildExpressionGuildIds].sort(),
      guildExpressionRootCount: this.#guildExpressionRoots.length,
      guildCommunityAuditEnabled: this.#allowGuildCommunityAudit
        && this.#guildCommunityGuildIds.size > 0,
      guildCommunityChangesEnabled: this.#allowGuildCommunityAudit
        && this.#allowGuildCommunityChanges
        && this.#guildCommunityGuildIds.size > 0,
      guildCommunityGuildIds: [...this.#guildCommunityGuildIds].sort(),
      guildDepartureGuildIds: [...this.#guildDepartureGuildIds].sort(),
      guildDeparturesEnabled: this.#allowGuildDepartures
        && this.#guildDepartureGuildIds.size > 0,
      guildIncidentAuditEnabled: this.#allowGuildIncidentAudit
        && this.#guildIncidentGuildIds.size > 0,
      guildIncidentChangesEnabled: this.#allowGuildIncidentAudit
        && this.#allowGuildIncidentChanges
        && this.#guildIncidentGuildIds.size > 0,
      guildIncidentGuildIds: [...this.#guildIncidentGuildIds].sort(),
      guildProfileAuditEnabled: this.#allowGuildProfileAudit
        && this.#guildProfileGuildIds.size > 0,
      guildProfileChangesEnabled: this.#allowGuildProfileAudit
        && this.#allowGuildProfileChanges
        && this.#guildProfileGuildIds.size > 0,
      guildProfileGuildIds: [...this.#guildProfileGuildIds].sort(),
      guildPruneAuditEnabled: this.#allowGuildPruneAudit
        && this.#guildPruneGuildIds.size > 0,
      guildPruneGuildIds: [...this.#guildPruneGuildIds].sort(),
      guildPruneIncludeRoleIds: [...this.#guildPruneIncludeRoleIds].sort(),
      guildPruneMaxMembers: this.#guildPruneMaxMembers,
      guildPrunesEnabled: this.#allowGuildPruneAudit
        && this.#allowGuildPrunes
        && this.#guildPruneGuildIds.size > 0,
      guildSettingsAuditEnabled: this.#allowGuildSettingsAudit
        && this.#guildSettingsGuildIds.size > 0,
      guildSettingsChangesEnabled: this.#allowGuildSettingsAudit
        && this.#allowGuildSettingsChanges
        && this.#guildSettingsGuildIds.size > 0,
      guildSettingsGuildIds: [...this.#guildSettingsGuildIds].sort(),
      guildTemplateAuditEnabled: this.#allowGuildTemplateAudit
        && this.#guildTemplateGuildIds.size > 0,
      guildTemplateChangesEnabled: this.#allowGuildTemplateAudit
        && this.#allowGuildTemplateChanges
        && this.#guildTemplateGuildIds.size > 0,
      guildTemplateGuildIds: [...this.#guildTemplateGuildIds].sort(),
      integrationAuditEnabled: this.#allowIntegrationAudit
        && this.#integrationGuildIds.size > 0,
      integrationDeletionsEnabled: this.#allowIntegrationAudit
        && this.#allowIntegrationDeletions
        && this.#integrationGuildIds.size > 0
        && this.#integrationIds.size > 0,
      integrationGuildIds: [...this.#integrationGuildIds].sort(),
      integrationIds: [...this.#integrationIds].sort(),
      forumPostChannelIds: [...this.#forumPostChannelIds].sort(),
      forumPostsEnabled: this.#allowForumPosts && this.#forumPostChannelIds.size > 0,
      forumTagAuditEnabled: this.#allowForumTagAudit && this.#forumTagChannelIds.size > 0,
      forumTagChangesEnabled: this.#allowForumTagAudit
        && this.#allowForumTagChanges
        && this.#forumTagChannelIds.size > 0,
      forumTagChannelIds: [...this.#forumTagChannelIds].sort(),
      interactionChannelIds: [...this.#interactionChannelIds].sort(),
      interactionMaxWritesPerMinute: this.#interactionMaxWritesPerMinute,
      interactionMinWriteIntervalMs: this.#interactionMinWriteIntervalMs,
      interactionsEnabled: this.#allowInteractions && this.#interactionChannelIds.size > 0,
      inviteAuditEnabled: this.#allowInviteAudit && this.#inviteGuildIds.size > 0,
      inviteCapabilityRootCount: this.#inviteCapabilityRoots.length,
      inviteCreationChannelIds: [...this.#inviteCreationChannelIds].sort(),
      inviteCreationEnabled: this.#allowInviteCreation
        && this.#inviteCreationChannelIds.size > 0
        && this.#inviteCapabilityRoots.length > 0,
      inviteRoleAssignmentEnabled: this.#allowInviteCreation
        && this.#allowInviteRoleAssignment
        && this.#inviteCreationChannelIds.size > 0
        && this.#inviteRoleIds.size > 0
        && this.#inviteCapabilityRoots.length > 0,
      inviteRoleIds: [...this.#inviteRoleIds].sort(),
      inviteDeletionsEnabled: this.#allowInviteAudit
        && this.#allowInviteDeletions
        && this.#inviteGuildIds.size > 0,
      inviteGuildIds: [...this.#inviteGuildIds].sort(),
      memberDirectoryEnabled: this.#allowMemberDirectory
        && this.#memberDirectoryGuildIds.size > 0,
      memberDirectoryGuildIds: [...this.#memberDirectoryGuildIds].sort(),
      nicknameChangesEnabled: this.#allowNicknameChanges
        && this.#nicknameGuildIds.size > 0,
      nicknameGuildIds: [...this.#nicknameGuildIds].sort(),
      otherMemberNicknameChangesEnabled: this.#allowNicknameChanges
        && this.#allowOtherMemberNicknameChanges
        && this.#nicknameGuildIds.size > 0,
      memberRoleChangesEnabled: this.#allowMemberRoleChanges
        && this.#memberRoleGuildIds.size > 0
        && this.#memberRoleIds.size > 0,
      memberRoleGuildIds: [...this.#memberRoleGuildIds].sort(),
      memberRoleCount: this.#memberRoleIds.size,
      memberVerificationChangesEnabled: this.#allowMemberVerificationChanges
        && this.#memberVerificationGuildIds.size > 0,
      memberVerificationGuildIds: [...this.#memberVerificationGuildIds].sort(),
      memberVoiceAuditEnabled: this.#allowMemberVoiceAudit
        && this.#memberVoiceGuildIds.size > 0
        && this.#memberVoiceChannelIds.size > 0,
      memberVoiceChangesEnabled: this.#allowMemberVoiceAudit
        && this.#allowMemberVoiceChanges
        && this.#memberVoiceGuildIds.size > 0
        && this.#memberVoiceChannelIds.size > 0,
      memberVoiceChannelIds: [...this.#memberVoiceChannelIds].sort(),
      memberVoiceGuildIds: [...this.#memberVoiceGuildIds].sort(),
      crossGuildMessageForwardingEnabled: this.#allowMessageForwarding
        && this.#allowCrossGuildMessageForwarding
        && this.#messageForwardSourceChannelIds.size > 0
        && this.#messageForwardTargetChannelIds.size > 0,
      messageForwardingEnabled: this.#allowMessageForwarding
        && this.#messageForwardSourceChannelIds.size > 0
        && this.#messageForwardTargetChannelIds.size > 0,
      messageForwardSourceChannelIds: [...this.#messageForwardSourceChannelIds].sort(),
      messageForwardTargetChannelIds: [...this.#messageForwardTargetChannelIds].sort(),
      nativeCommandChangesEnabled: this.#allowNativeCommandChanges
        && this.#nativeInteractionGuildIds.size > 0,
      nativeCommandName: this.#nativeCommandName,
      nativeInteractionChannelIds: [...this.#nativeInteractionChannelIds].sort(),
      nativeInteractionGuildIds: [...this.#nativeInteractionGuildIds].sort(),
      nativeInteractionMaxPending: this.#nativeInteractionMaxPending,
      nativeInteractionsEnabled: this.#allowNativeInteractions
        && this.#nativeInteractionGuildIds.size > 0
        && this.#nativeInteractionChannelIds.size > 0
        && this.#nativeInteractionUserIds.size > 0,
      nativeInteractionTtlSeconds: this.#nativeInteractionTtlSeconds,
      nativeInteractionUserIds: [...this.#nativeInteractionUserIds].sort(),
      mentionUserCount: this.#mentionUserIds.size,
      userMentionMode: this.#userMentionMode,
      mcpToolsets: MCP_TOOLSET_NAMES.filter((name) => this.#mcpToolsets.has(name)),
      mcpToolSurface: this.#mcpToolSurface,
      mcpReadResponseMaxBytes: this.#mcpReadResponseMaxBytes,
      onboardingAuditEnabled: this.#allowOnboardingAudit
        && this.#onboardingGuildIds.size > 0,
      onboardingChangesEnabled: this.#allowOnboardingAudit
        && this.#allowOnboardingChanges
        && this.#onboardingGuildIds.size > 0,
      onboardingGuildIds: [...this.#onboardingGuildIds].sort(),
      permissionOverwriteChannelIds: [...this.#permissionOverwriteChannelIds].sort(),
      permissionOverwritesEnabled: this.#allowPermissionOverwrites
        && this.#permissionOverwriteChannelIds.size > 0,
      permissionSyncChannelIds: [...this.#permissionSyncChannelIds].sort(),
      permissionSyncsEnabled: this.#allowPermissionSyncs
        && this.#permissionSyncChannelIds.size > 0,
      protectedUserCount: this.#protectedUserIds.size,
      pinChannelIds: [...this.#pinChannelIds].sort(),
      pinManagementEnabled: this.#allowPinManagement && this.#pinChannelIds.size > 0,
      pollAuditEnabled: this.#allowPollAudit && this.#pollChannelIds.size > 0,
      pollChannelIds: [...this.#pollChannelIds].sort(),
      pollCreationEnabled: this.#allowPollAudit
        && this.#allowPollCreation
        && this.#pollChannelIds.size > 0,
      pollEndingEnabled: this.#allowPollAudit
        && this.#allowPollEnding
        && this.#pollChannelIds.size > 0,
      pollVoterAuditEnabled: this.#allowPollAudit
        && this.#allowPollVoterAudit
        && this.#pollChannelIds.size > 0,
      reactionChannelIds: [...this.#reactionChannelIds].sort(),
      reactionModerationEnabled: this.#allowReactionModeration
        && this.#reactionChannelIds.size > 0,
      reactionUserAuditEnabled: this.#allowReactionUserAudit
        && this.#reactionChannelIds.size > 0,
      readChannelScope: this.#readChannelMode,
      readGuildScope: this.#readGuildMode,
      roleCreationEnabled: this.#allowRoleCreation
        && this.#roleCreationGuildIds.size > 0,
      roleCreationGuildIds: [...this.#roleCreationGuildIds].sort(),
      roleConfigurationEnabled: this.#allowRoleConfiguration
        && this.#roleConfigurationIds.size > 0,
      roleConfigurationIds: [...this.#roleConfigurationIds].sort(),
      roleDeletionAuditEnabled: this.#allowRoleDeletionAudit
        && this.#roleDeletionIds.size > 0,
      roleDeletionIds: [...this.#roleDeletionIds].sort(),
      roleDeletionsEnabled: this.#allowRoleDeletionAudit
        && this.#allowRoleDeletions
        && this.#roleDeletionIds.size > 0,
      roleOrderingAuditEnabled: this.#allowRoleOrderingAudit
        && this.#roleOrderingGuildIds.size > 0,
      roleOrderingChangesEnabled: this.#allowRoleOrderingAudit
        && this.#allowRoleOrderingChanges
        && this.#roleOrderingGuildIds.size > 0,
      roleOrderingGuildIds: [...this.#roleOrderingGuildIds].sort(),
      scheduledEventAuditEnabled: this.#allowScheduledEventAudit
        && this.#scheduledEventGuildIds.size > 0,
      scheduledEventChangesEnabled: this.#allowScheduledEventAudit
        && this.#allowScheduledEventChanges
        && this.#scheduledEventGuildIds.size > 0,
      scheduledEventCoverChangesEnabled: this.#allowScheduledEventAudit
        && this.#allowScheduledEventChanges
        && this.#scheduledEventGuildIds.size > 0
        && this.#scheduledEventRoots.length > 0,
      scheduledEventGuildIds: [...this.#scheduledEventGuildIds].sort(),
      scheduledEventRootCount: this.#scheduledEventRoots.length,
      scheduledEventUserAuditEnabled: this.#allowScheduledEventAudit
        && this.#allowScheduledEventUserAudit
        && this.#scheduledEventGuildIds.size > 0,
      soundboardAuditEnabled: this.#allowSoundboardAudit
        && this.#soundboardGuildIds.size > 0,
      soundboardChangesEnabled: this.#allowSoundboardAudit
        && this.#allowSoundboardChanges
        && this.#soundboardGuildIds.size > 0,
      soundboardCreationEnabled: this.#allowSoundboardAudit
        && this.#allowSoundboardChanges
        && this.#soundboardGuildIds.size > 0
        && this.#soundboardRoots.length > 0,
      soundboardGuildIds: [...this.#soundboardGuildIds].sort(),
      soundboardPlaybackChannelIds: [...this.#soundboardPlaybackChannelIds].sort(),
      soundboardPlaybackEnabled: this.#allowSoundboardPlayback
        && this.#soundboardPlaybackChannelIds.size > 0,
      soundboardPlaybackSourceGuildIds: [
        ...this.#soundboardPlaybackSourceGuildIds,
      ].sort(),
      soundboardRootCount: this.#soundboardRoots.length,
      stageChannelIds: [...this.#stageChannelIds].sort(),
      stageInstanceAuditEnabled: this.#allowStageInstanceAudit
        && this.#stageChannelIds.size > 0,
      stageInstanceChangesEnabled: this.#allowStageInstanceAudit
        && this.#allowStageInstanceChanges
        && this.#stageChannelIds.size > 0,
      stageStartNotificationsEnabled: this.#allowStageInstanceAudit
        && this.#allowStageInstanceChanges
        && this.#allowStageStartNotifications
        && this.#stageChannelIds.size > 0,
      threadCreationEnabled: this.#allowThreadCreation
        && this.#threadParentIds.size > 0,
      threadAuditEnabled: this.#allowThreadAudit
        && this.#threadGuildIds.size > 0
        && this.#threadIds.size > 0,
      threadChangesEnabled: this.#allowThreadAudit
        && this.#allowThreadChanges
        && this.#threadGuildIds.size > 0
        && this.#threadIds.size > 0,
      threadGuildIds: [...this.#threadGuildIds].sort(),
      threadIds: [...this.#threadIds].sort(),
      threadMemberUserIds: [...this.#threadMemberUserIds].sort(),
      threadMessageWriteMode: this.#threadMessageWriteMode,
      threadParentIds: [...this.#threadParentIds].sort(),
      threadReadMode: this.#threadReadMode,
      welcomeScreenAuditEnabled: this.#allowWelcomeScreenAudit
        && this.#welcomeScreenGuildIds.size > 0,
      welcomeScreenChangesEnabled: this.#allowWelcomeScreenAudit
        && this.#allowWelcomeScreenChanges
        && this.#welcomeScreenGuildIds.size > 0,
      welcomeScreenGuildIds: [...this.#welcomeScreenGuildIds].sort(),
      webhookAuditEnabled: this.#allowWebhookAudit
        && (this.#webhookChannelIds.size > 0 || this.#webhookGuildIds.size > 0),
      webhookChannelIds: [...this.#webhookChannelIds].sort(),
      webhookGuildIds: [...this.#webhookGuildIds].sort(),
      webhookChangesEnabled: this.#allowWebhookAudit
        && this.#allowWebhookChanges
        && this.#webhookChannelIds.size > 0,
      webhookCreationEnabled: this.#allowWebhookAudit
        && this.#allowWebhookCreation
        && this.#webhookChannelIds.size > 0,
      webhookDeletionsEnabled: this.#allowWebhookAudit
        && this.#allowWebhookDeletions
        && this.#webhookChannelIds.size > 0,
      webhookMessageAuditEnabled: this.#allowWebhookMessageAudit
        && this.#webhookMessageChannelIds.size > 0,
      webhookMessageChannelIds: [...this.#webhookMessageChannelIds].sort(),
      webhookMessageChangesEnabled: this.#allowWebhookMessageAudit
        && this.#allowWebhookMessageChanges
        && this.#webhookMessageChannelIds.size > 0,
      webhookMessageDeletionsEnabled: this.#allowWebhookMessageAudit
        && this.#allowWebhookMessageDeletions
        && this.#webhookMessageChannelIds.size > 0,
      webhookMessageDeliveryEnabled: this.#allowWebhookMessageDelivery
        && this.#webhookMessageChannelIds.size > 0,
      widgetPublicExposureEnabled: this.#allowWidgetSettingsAudit
        && this.#allowWidgetSettingsChanges
        && this.#allowWidgetPublicExposure
        && this.#widgetSettingsGuildIds.size > 0,
      widgetSettingsAuditEnabled: this.#allowWidgetSettingsAudit
        && this.#widgetSettingsGuildIds.size > 0,
      widgetSettingsChangesEnabled: this.#allowWidgetSettingsAudit
        && this.#allowWidgetSettingsChanges
        && this.#widgetSettingsGuildIds.size > 0,
      widgetSettingsGuildIds: [...this.#widgetSettingsGuildIds].sort(),
    }
  }

  filterGuilds(guilds: readonly DiscordGuild[]): DiscordGuild[] {
    return guilds.filter((guild) => this.guildAllowed(guild.id))
  }

  filterChannels(channels: readonly DiscordChannel[]): DiscordChannel[] {
    return channels.filter((channel) => this.channelIdReadable(
      channel.id,
      THREAD_CHANNEL_TYPES.has(channel.type) ? channel.parent_id : undefined,
    ))
  }

  #assertDirectMessageUserAllowed(userId: string): void {
    if (this.#directMessageUserIds.size === 0) {
      throw new PolicyError(
        "Discord direct messages require an explicit user allowlist",
      )
    }
    if (!this.#directMessageUserIds.has(userId)) {
      throw new PolicyError(
        `Discord user ${userId} is outside the direct-message scope`,
      )
    }
  }

  assertDirectMessageAuditAllowed(userId: string): void {
    if (!this.#allowDirectMessageAudit) {
      throw new PolicyError(
        "Discord direct-message reads are disabled by connector configuration",
      )
    }
    this.#assertDirectMessageUserAllowed(userId)
  }

  assertDirectMessageAttachmentAllowed(userId: string): void {
    this.assertDirectMessageDeliveryAllowed(userId)
    if (!this.#allowDirectMessageAttachments) {
      throw new PolicyError(
        "Discord direct-message attachments are disabled by connector configuration",
      )
    }
    if (this.#attachmentRoots.length === 0) {
      throw new PolicyError(
        "Discord direct-message attachments require configured owned file roots",
      )
    }
  }

  assertDirectMessageDeletionAllowed(userId: string): void {
    if (!this.#allowDirectMessageDeletion) {
      throw new PolicyError(
        "Discord direct-message deletion is disabled by connector configuration",
      )
    }
    this.#assertDirectMessageUserAllowed(userId)
  }

  assertDirectMessageDeliveryAllowed(userId: string): void {
    if (!this.#allowDirectMessageDelivery) {
      throw new PolicyError(
        "Discord direct-message delivery is disabled by connector configuration",
      )
    }
    this.#assertDirectMessageUserAllowed(userId)
  }

  assertDirectMessageEditingAllowed(userId: string): void {
    if (!this.#allowDirectMessageEditing) {
      throw new PolicyError(
        "Discord direct-message editing is disabled by connector configuration",
      )
    }
    this.#assertDirectMessageUserAllowed(userId)
  }

  guildAllowed(guildId: string): boolean {
    return this.#readGuildMode === "all-visible" || this.#allowedGuildIds.has(guildId)
  }

  assertGuildAllowed(guildId: string): void {
    if (!this.guildAllowed(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the configured read scope`)
    }
  }

  assertGuildApplicationCommandChangeAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowApplicationCommandChanges) {
      throw new PolicyError(
        "Discord guild application-command changes are disabled by connector configuration",
      )
    }
    if (this.#applicationCommandGuildIds.size === 0) {
      throw new PolicyError(
        "Discord guild application-command changes require an exact guild allowlist",
      )
    }
    if (!this.#applicationCommandGuildIds.has(guildId)) {
      throw new PolicyError(
        `Discord guild ${guildId} is outside the application-command change scope`,
      )
    }
  }

  assertGlobalApplicationCommandChangeAllowed(): void {
    if (!this.#allowGlobalApplicationCommandChanges) {
      throw new PolicyError(
        "Discord global application-command changes are disabled by connector configuration",
      )
    }
  }

  assertNativeCommandChangeAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowNativeCommandChanges) {
      throw new PolicyError(
        "Discord native Interaction command changes are disabled by connector configuration",
      )
    }
    if (this.#nativeInteractionGuildIds.size === 0) {
      throw new PolicyError(
        "Discord native Interaction command changes require an exact guild allowlist",
      )
    }
    if (!this.#nativeInteractionGuildIds.has(guildId)) {
      throw new PolicyError(
        `Discord guild ${guildId} is outside the native Interaction command scope`,
      )
    }
  }

  assertNativeInteractionAllowed(
    guildId: string,
    channelId: string,
    userId: string,
  ): void {
    this.assertNativeInteractionTargetAllowed(guildId, channelId)
    if (!this.#nativeInteractionUserIds.has(userId)) {
      throw new PolicyError(
        `Discord user ${userId} is outside the native Interaction scope`,
      )
    }
  }

  assertNativeInteractionTargetAllowed(
    guildId: string,
    channelId: string,
  ): string[] {
    this.assertGuildAllowed(guildId)
    if (!this.#allowNativeInteractions) {
      throw new PolicyError(
        "Discord native Interactions are disabled by connector configuration",
      )
    }
    if (!this.#nativeInteractionGuildIds.has(guildId)) {
      throw new PolicyError(
        `Discord guild ${guildId} is outside the native Interaction scope`,
      )
    }
    if (!this.#nativeInteractionChannelIds.has(channelId)) {
      throw new PolicyError(
        `Discord channel ${channelId} is outside the native Interaction scope`,
      )
    }
    if (this.#nativeInteractionUserIds.size === 0) {
      throw new PolicyError(
        "Discord native Interactions require an exact user allowlist",
      )
    }
    return [...this.#nativeInteractionUserIds].sort()
  }

  assertMemberDirectoryAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowMemberDirectory) {
      throw new PolicyError("Discord member directory is disabled by connector configuration")
    }
    if (this.#memberDirectoryGuildIds.size === 0) {
      throw new PolicyError("Discord member directory requires an explicit guild allowlist")
    }
    if (!this.#memberDirectoryGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the member-directory scope`)
    }
  }

  assertBanAuditAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowBanAudit) {
      throw new PolicyError("Discord ban audit is disabled by connector configuration")
    }
    if (this.#banAuditGuildIds.size === 0) {
      throw new PolicyError("Discord ban audit requires an explicit guild allowlist")
    }
    if (!this.#banAuditGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the ban-audit scope`)
    }
  }

  assertBulkBanAuditAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowBulkBanAudit) {
      throw new PolicyError("Discord bulk-ban audit is disabled by connector configuration")
    }
    if (this.#bulkBanGuildIds.size === 0) {
      throw new PolicyError("Discord bulk-ban audit requires an explicit guild allowlist")
    }
    if (!this.#bulkBanGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the bulk-ban scope`)
    }
  }

  assertBulkBanExecutionAllowed(guildId: string): void {
    this.assertBulkBanAuditAllowed(guildId)
    if (!this.#allowBulkBans) {
      throw new PolicyError("Discord bulk bans are disabled by connector configuration")
    }
  }

  assertGuildPruneAuditAllowed(
    guildId: string,
    includeRoleIds: readonly string[],
  ): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildPruneAudit) {
      throw new PolicyError("Discord guild prune audit is disabled by connector configuration")
    }
    if (this.#guildPruneGuildIds.size === 0) {
      throw new PolicyError("Discord guild prune audit requires an explicit guild allowlist")
    }
    if (!this.#guildPruneGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild prune scope`)
    }
    for (const roleId of includeRoleIds) {
      if (!this.#guildPruneIncludeRoleIds.has(roleId)) {
        throw new PolicyError(
          `Discord role ${roleId} is outside the guild prune include-role scope`,
        )
      }
    }
  }

  assertGuildPruneExecutionAllowed(
    guildId: string,
    includeRoleIds: readonly string[],
  ): void {
    this.assertGuildPruneAuditAllowed(guildId, includeRoleIds)
    if (!this.#allowGuildPrunes) {
      throw new PolicyError("Discord guild prunes are disabled by connector configuration")
    }
  }

  assertGuildInviteAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowInviteAudit) {
      throw new PolicyError("Discord invite audit is disabled by connector configuration")
    }
    if (this.#inviteGuildIds.size === 0) {
      throw new PolicyError("Discord invite audit requires an explicit guild allowlist")
    }
    if (!this.#inviteGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the invite-audit scope`)
    }
  }

  assertGuildInviteDeletable(guildId: string): void {
    this.assertGuildInviteAuditable(guildId)
    if (!this.#allowInviteDeletions) {
      throw new PolicyError("Discord invite deletion is disabled by connector configuration")
    }
  }

  assertGuildInviteCreatable(guildId: string, channelId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowInviteCreation) {
      throw new PolicyError("Discord invite creation is disabled by connector configuration")
    }
    if (this.#inviteCreationChannelIds.size === 0) {
      throw new PolicyError("Discord invite creation requires an exact channel allowlist")
    }
    if (
      !this.#inviteCreationChannelIds.has(channelId)
      || !this.channelIdReadable(channelId)
    ) {
      throw new PolicyError(
        `Discord channel ${channelId} is outside the invite-creation scope`,
      )
    }
    if (this.#inviteCapabilityRoots.length === 0) {
      throw new PolicyError("Discord invite creation requires a private capability root")
    }
  }

  assertInviteRoleAssignmentAllowed(roleIds: readonly string[]): void {
    if (!this.#allowInviteRoleAssignment) {
      throw new PolicyError(
        "Discord invite role assignment is disabled by connector configuration",
      )
    }
    if (this.#inviteRoleIds.size === 0) {
      throw new PolicyError(
        "Discord invite role assignment requires an exact role allowlist",
      )
    }
    const rejected = roleIds.find((roleId) => !this.#inviteRoleIds.has(roleId))
    if (rejected) {
      throw new PolicyError(
        `Discord role ${rejected} is outside the invite role-assignment scope`,
      )
    }
  }

  assertGuildTemplateAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildTemplateAudit) {
      throw new PolicyError("Discord guild-template audit is disabled by connector configuration")
    }
    if (this.#guildTemplateGuildIds.size === 0) {
      throw new PolicyError("Discord guild-template audit requires an explicit guild allowlist")
    }
    if (!this.#guildTemplateGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild-template scope`)
    }
  }

  assertGuildCommunityAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildCommunityAudit) {
      throw new PolicyError("Discord guild Community audit is disabled by connector configuration")
    }
    if (this.#guildCommunityGuildIds.size === 0) {
      throw new PolicyError("Discord guild Community audit requires an explicit guild allowlist")
    }
    if (!this.#guildCommunityGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild Community scope`)
    }
  }

  assertGuildCommunityChangeable(guildId: string): void {
    this.assertGuildCommunityAuditable(guildId)
    if (!this.#allowGuildCommunityChanges) {
      throw new PolicyError("Discord guild Community changes are disabled by connector configuration")
    }
  }

  assertGuildDepartureAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildDepartures) {
      throw new PolicyError("Discord guild departure is disabled by connector configuration")
    }
    if (this.#guildDepartureGuildIds.size === 0) {
      throw new PolicyError("Discord guild departure requires an exact guild allowlist")
    }
    if (!this.#guildDepartureGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the departure scope`)
    }
  }

  assertGuildSettingsAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildSettingsAudit) {
      throw new PolicyError("Discord guild-settings audit is disabled by connector configuration")
    }
    if (this.#guildSettingsGuildIds.size === 0) {
      throw new PolicyError("Discord guild-settings audit requires an explicit guild allowlist")
    }
    if (!this.#guildSettingsGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild-settings scope`)
    }
  }

  assertGuildIncidentAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildIncidentAudit) {
      throw new PolicyError("Discord guild incident-action audit is disabled by connector configuration")
    }
    if (this.#guildIncidentGuildIds.size === 0) {
      throw new PolicyError("Discord guild incident-action audit requires an explicit guild allowlist")
    }
    if (!this.#guildIncidentGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild incident-action scope`)
    }
  }

  assertGuildIncidentChangeable(guildId: string): void {
    this.assertGuildIncidentAuditable(guildId)
    if (!this.#allowGuildIncidentChanges) {
      throw new PolicyError("Discord guild incident-action changes are disabled by connector configuration")
    }
  }

  assertGuildProfileAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildProfileAudit) {
      throw new PolicyError("Discord guild profile audit is disabled by connector configuration")
    }
    if (this.#guildProfileGuildIds.size === 0) {
      throw new PolicyError("Discord guild profile audit requires an explicit guild allowlist")
    }
    if (!this.#guildProfileGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild profile scope`)
    }
  }

  assertGuildProfileChangeable(guildId: string): void {
    this.assertGuildProfileAuditable(guildId)
    if (!this.#allowGuildProfileChanges) {
      throw new PolicyError("Discord guild profile changes are disabled by connector configuration")
    }
  }

  assertGuildSettingsChangeable(guildId: string): void {
    this.assertGuildSettingsAuditable(guildId)
    if (!this.#allowGuildSettingsChanges) {
      throw new PolicyError("Discord guild-settings changes are disabled by connector configuration")
    }
  }

  assertGuildTemplateChangeable(guildId: string): void {
    this.assertGuildTemplateAuditable(guildId)
    if (!this.#allowGuildTemplateChanges) {
      throw new PolicyError("Discord guild-template changes are disabled by connector configuration")
    }
  }

  assertGuildIntegrationAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowIntegrationAudit) {
      throw new PolicyError("Discord integration audit is disabled by connector configuration")
    }
    if (this.#integrationGuildIds.size === 0) {
      throw new PolicyError("Discord integration audit requires an explicit guild allowlist")
    }
    if (!this.#integrationGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the integration scope`)
    }
  }

  assertGuildIntegrationDeletable(guildId: string, integrationId: string): void {
    this.assertGuildIntegrationAuditable(guildId)
    if (!this.#allowIntegrationDeletions) {
      throw new PolicyError("Discord integration deletion is disabled by connector configuration")
    }
    if (this.#integrationIds.size === 0) {
      throw new PolicyError("Discord integration deletion requires an exact integration allowlist")
    }
    if (!this.#integrationIds.has(integrationId)) {
      throw new PolicyError(
        `Discord integration ${integrationId} is outside the integration deletion scope`,
      )
    }
  }

  assertGuildOnboardingAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowOnboardingAudit) {
      throw new PolicyError("Discord onboarding audit is disabled by connector configuration")
    }
    if (this.#onboardingGuildIds.size === 0) {
      throw new PolicyError("Discord onboarding audit requires an explicit guild allowlist")
    }
    if (!this.#onboardingGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the onboarding-audit scope`)
    }
  }

  assertGuildOnboardingChangeable(guildId: string): void {
    this.assertGuildOnboardingAuditable(guildId)
    if (!this.#allowOnboardingChanges) {
      throw new PolicyError("Discord onboarding changes are disabled by connector configuration")
    }
  }

  assertGuildWelcomeScreenAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowWelcomeScreenAudit) {
      throw new PolicyError("Discord Welcome Screen audit is disabled by connector configuration")
    }
    if (this.#welcomeScreenGuildIds.size === 0) {
      throw new PolicyError("Discord Welcome Screen audit requires an explicit guild allowlist")
    }
    if (!this.#welcomeScreenGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the Welcome Screen audit scope`)
    }
  }

  assertGuildWelcomeScreenChangeable(guildId: string): void {
    this.assertGuildWelcomeScreenAuditable(guildId)
    if (!this.#allowWelcomeScreenChanges) {
      throw new PolicyError("Discord Welcome Screen changes are disabled by connector configuration")
    }
  }

  assertGuildWidgetSettingsAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowWidgetSettingsAudit) {
      throw new PolicyError("Discord widget-settings audit is disabled by connector configuration")
    }
    if (this.#widgetSettingsGuildIds.size === 0) {
      throw new PolicyError("Discord widget-settings audit requires an explicit guild allowlist")
    }
    if (!this.#widgetSettingsGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the widget-settings audit scope`)
    }
  }

  assertGuildWidgetSettingsChangeable(guildId: string): void {
    this.assertGuildWidgetSettingsAuditable(guildId)
    if (!this.#allowWidgetSettingsChanges) {
      throw new PolicyError("Discord widget-settings changes are disabled by connector configuration")
    }
  }

  assertGuildWidgetPublicExposureChangeable(guildId: string): void {
    this.assertGuildWidgetSettingsChangeable(guildId)
    if (!this.#allowWidgetPublicExposure) {
      throw new PolicyError("Discord widget public exposure is disabled by connector configuration")
    }
  }

  assertMemberAdministrationAllowed(guildId: string, userId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowAdministration) {
      throw new PolicyError("Discord administration is disabled by connector configuration")
    }
    if (this.#adminGuildIds.size === 0) {
      throw new PolicyError("Discord administration requires an explicit guild allowlist")
    }
    if (!this.#adminGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the administration scope`)
    }
    this.assertUserNotProtected(userId)
  }

  assertMemberRoleChangeAllowed(
    guildId: string,
    userId: string,
    roleId: string,
  ): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowMemberRoleChanges) {
      throw new PolicyError("Discord member-role changes are disabled by connector configuration")
    }
    if (this.#memberRoleGuildIds.size === 0) {
      throw new PolicyError("Discord member-role changes require an explicit guild allowlist")
    }
    if (!this.#memberRoleGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the member-role scope`)
    }
    if (this.#memberRoleIds.size === 0) {
      throw new PolicyError("Discord member-role changes require an exact role allowlist")
    }
    if (!this.#memberRoleIds.has(roleId)) {
      throw new PolicyError(`Discord role ${roleId} is outside the member-role scope`)
    }
    this.assertUserNotProtected(userId)
  }

  assertBulkMemberRoleChangeAllowed(
    guildId: string,
    userId: string,
    roleId: string,
  ): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowBulkMemberRoleChanges) {
      throw new PolicyError(
        "Discord bulk member-role changes are disabled by connector configuration",
      )
    }
    if (this.#bulkMemberRoleGuildIds.size === 0) {
      throw new PolicyError(
        "Discord bulk member-role changes require an explicit guild allowlist",
      )
    }
    if (!this.#bulkMemberRoleGuildIds.has(guildId)) {
      throw new PolicyError(
        `Discord guild ${guildId} is outside the bulk member-role scope`,
      )
    }
    if (this.#bulkMemberRoleIds.size === 0) {
      throw new PolicyError(
        "Discord bulk member-role changes require an exact role allowlist",
      )
    }
    if (!this.#bulkMemberRoleIds.has(roleId)) {
      throw new PolicyError(
        `Discord role ${roleId} is outside the bulk member-role scope`,
      )
    }
    this.assertUserNotProtected(userId)
  }

  assertNicknameChangeAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowNicknameChanges) {
      throw new PolicyError("Discord nickname changes are disabled by connector configuration")
    }
    if (this.#nicknameGuildIds.size === 0) {
      throw new PolicyError("Discord nickname changes require an explicit guild allowlist")
    }
    if (!this.#nicknameGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the nickname-change scope`)
    }
  }

  assertMemberVerificationChangeAllowed(guildId: string, userId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowMemberVerificationChanges) {
      throw new PolicyError("Discord member verification changes are disabled by connector configuration")
    }
    if (this.#memberVerificationGuildIds.size === 0) {
      throw new PolicyError("Discord member verification changes require an explicit guild allowlist")
    }
    if (!this.#memberVerificationGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the member verification scope`)
    }
    this.assertUserNotProtected(userId)
  }

  assertOtherMemberNicknameChangeAllowed(guildId: string, userId: string): void {
    this.assertNicknameChangeAllowed(guildId)
    if (!this.#allowOtherMemberNicknameChanges) {
      throw new PolicyError("Discord other-member nickname changes are disabled by connector configuration")
    }
    this.assertUserNotProtected(userId)
  }

  assertMemberVoiceAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowMemberVoiceAudit) {
      throw new PolicyError("Discord member voice audit is disabled by connector configuration")
    }
    if (this.#memberVoiceGuildIds.size === 0) {
      throw new PolicyError("Discord member voice audit requires an explicit guild allowlist")
    }
    if (!this.#memberVoiceGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the member voice scope`)
    }
    if (this.#memberVoiceChannelIds.size === 0) {
      throw new PolicyError("Discord member voice audit requires an exact channel allowlist")
    }
  }

  assertMemberVoiceChannelAllowed(channelId: string): void {
    if (
      !this.channelIdReadable(channelId)
      || !this.#memberVoiceChannelIds.has(channelId)
    ) {
      throw new PolicyError("Discord member voice state is outside the configured channel scope")
    }
  }

  assertMemberVoiceChangeable(guildId: string, userId: string): void {
    this.assertMemberVoiceAuditable(guildId)
    if (!this.#allowMemberVoiceChanges) {
      throw new PolicyError("Discord member voice changes are disabled by connector configuration")
    }
    this.assertUserNotProtected(userId)
  }

  assertUserNotProtected(userId: string): void {
    if (this.#protectedUserIds.has(userId)) {
      throw new PolicyError(`Discord user ${userId} is protected from administration`)
    }
  }

  assertChannelCreationAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowChannelCreation) {
      throw new PolicyError("Discord channel creation is disabled by connector configuration")
    }
    if (this.#channelCreationGuildIds.size === 0) {
      throw new PolicyError("Discord channel creation requires an explicit guild allowlist")
    }
    if (!this.#channelCreationGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the channel creation scope`)
    }
  }

  assertRoleCreationAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowRoleCreation) {
      throw new PolicyError("Discord role creation is disabled by connector configuration")
    }
    if (this.#roleCreationGuildIds.size === 0) {
      throw new PolicyError("Discord role creation requires an explicit guild allowlist")
    }
    if (!this.#roleCreationGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the role creation scope`)
    }
  }

  assertRoleConfigurationAllowed(guildId: string, roleId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowRoleConfiguration) {
      throw new PolicyError("Discord role configuration is disabled by connector configuration")
    }
    if (this.#roleConfigurationIds.size === 0) {
      throw new PolicyError("Discord role configuration requires an explicit role allowlist")
    }
    if (!this.#roleConfigurationIds.has(roleId)) {
      throw new PolicyError(`Discord role ${roleId} is outside the role-configuration scope`)
    }
  }

  assertRoleDeletionAuditable(guildId: string, roleId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowRoleDeletionAudit) {
      throw new PolicyError("Discord role-deletion audit is disabled by connector configuration")
    }
    if (this.#roleDeletionIds.size === 0) {
      throw new PolicyError("Discord role-deletion audit requires an exact role allowlist")
    }
    if (!this.#roleDeletionIds.has(roleId)) {
      throw new PolicyError(`Discord role ${roleId} is outside the role-deletion scope`)
    }
  }

  assertRoleDeletionAllowed(guildId: string, roleId: string): void {
    this.assertRoleDeletionAuditable(guildId, roleId)
    if (!this.#allowRoleDeletions) {
      throw new PolicyError("Discord role deletion is disabled by connector configuration")
    }
  }

  assertRoleOrderingAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowRoleOrderingAudit) {
      throw new PolicyError("Discord role-ordering audit is disabled by connector configuration")
    }
    if (this.#roleOrderingGuildIds.size === 0) {
      throw new PolicyError("Discord role-ordering audit requires an explicit guild allowlist")
    }
    if (!this.#roleOrderingGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the role-ordering scope`)
    }
  }

  assertChannelOrderingAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowChannelOrderingAudit) {
      throw new PolicyError("Discord channel-ordering audit is disabled by connector configuration")
    }
    if (this.#channelOrderingGuildIds.size === 0) {
      throw new PolicyError("Discord channel-ordering audit requires an explicit guild allowlist")
    }
    if (!this.#channelOrderingGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the channel-ordering scope`)
    }
  }

  assertChannelDeletionAuditable(guildId: string, channelId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.channelIdReadable(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the configured read scope`)
    }
    if (!this.#allowChannelDeletionAudit) {
      throw new PolicyError("Discord channel-deletion audit is disabled by connector configuration")
    }
    if (this.#channelDeletionIds.size === 0) {
      throw new PolicyError("Discord channel-deletion audit requires an exact channel allowlist")
    }
    if (!this.#channelDeletionIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the channel-deletion scope`)
    }
  }

  assertChannelDeletionAllowed(guildId: string, channelId: string): void {
    this.assertChannelDeletionAuditable(guildId, channelId)
    if (!this.#allowChannelDeletions) {
      throw new PolicyError("Discord channel deletion is disabled by connector configuration")
    }
  }

  assertChannelCloneAuditable(guildId: string, sourceChannelId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowChannelCloneAudit) {
      throw new PolicyError("Discord channel-clone audit is disabled by connector configuration")
    }
    if (
      this.#channelCloneGuildIds.size === 0
      || this.#channelCloneSourceIds.size === 0
    ) {
      throw new PolicyError("Discord channel-clone audit requires exact guild and source allowlists")
    }
    if (!this.#channelCloneGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the channel-clone scope`)
    }
    if (!this.#channelCloneSourceIds.has(sourceChannelId)) {
      throw new PolicyError(`Discord channel ${sourceChannelId} is outside the channel-clone source scope`)
    }
  }

  assertChannelCloneable(guildId: string, sourceChannelId: string): void {
    this.assertChannelCloneAuditable(guildId, sourceChannelId)
    if (!this.#allowChannelCloning) {
      throw new PolicyError("Discord channel cloning is disabled by connector configuration")
    }
  }

  assertChannelOrderingChangeable(guildId: string): void {
    this.assertChannelOrderingAuditable(guildId)
    if (!this.#allowChannelOrderingChanges) {
      throw new PolicyError("Discord channel-ordering changes are disabled by connector configuration")
    }
  }

  assertRoleOrderingChangeable(guildId: string): void {
    this.assertRoleOrderingAuditable(guildId)
    if (!this.#allowRoleOrderingChanges) {
      throw new PolicyError("Discord role-ordering changes are disabled by connector configuration")
    }
  }

  assertGuildScaffoldAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildScaffolds) {
      throw new PolicyError("Discord guild scaffolds are disabled by connector configuration")
    }
    if (this.#guildScaffoldGuildIds.size === 0) {
      throw new PolicyError("Discord guild scaffolds require an explicit guild allowlist")
    }
    if (!this.#guildScaffoldGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild scaffold scope`)
    }
  }

  assertGuildExpressionAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildExpressionAudit) {
      throw new PolicyError("Discord guild expression audit is disabled by connector configuration")
    }
    if (this.#guildExpressionGuildIds.size === 0) {
      throw new PolicyError("Discord guild expression audit requires an explicit guild allowlist")
    }
    if (!this.#guildExpressionGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild expression scope`)
    }
  }

  assertGuildExpressionChangeAllowed(guildId: string): void {
    this.assertGuildExpressionAuditable(guildId)
    if (!this.#allowGuildExpressionChanges) {
      throw new PolicyError("Discord guild expression changes are disabled by connector configuration")
    }
  }

  assertApplicationEmojiAuditable(): void {
    if (!this.#allowApplicationEmojiAudit) {
      throw new PolicyError("Discord application emoji audit is disabled by connector configuration")
    }
  }

  applicationMonetizationSkuScope(): string[] {
    this.#assertApplicationMonetizationAuditEnabled()
    return [...this.#applicationMonetizationSkuIds].sort()
  }

  assertApplicationEntitlementsAuditable(
    beneficiary: Readonly<{ type: "guild" | "user"; id: string }>,
    skuIds: readonly string[],
  ): void {
    this.#assertApplicationMonetizationAuditEnabled()
    if (beneficiary.type === "guild") {
      this.assertGuildAllowed(beneficiary.id)
      if (!this.#applicationEntitlementGuildIds.has(beneficiary.id)) {
        throw new PolicyError(
          `Discord guild ${beneficiary.id} is outside the application entitlement scope`,
        )
      }
    } else if (!this.#applicationEntitlementUserIds.has(beneficiary.id)) {
      throw new PolicyError(
        `Discord user ${beneficiary.id} is outside the application entitlement scope`,
      )
    }
    this.#assertApplicationMonetizationSkuIdsAuditable(skuIds)
  }

  assertApplicationSubscriptionsAuditable(userId: string, skuId: string): void {
    this.#assertApplicationMonetizationAuditEnabled()
    if (!this.#applicationSubscriptionUserIds.has(userId)) {
      throw new PolicyError(
        `Discord user ${userId} is outside the application subscription scope`,
      )
    }
    this.#assertApplicationMonetizationSkuIdsAuditable([skuId])
  }

  assertApplicationTestEntitlementChangeAllowed(
    beneficiary: Readonly<{ id: string; type: "guild" | "user" }>,
    skuId: string,
  ): void {
    if (!this.#allowApplicationTestEntitlementChanges) {
      throw new PolicyError(
        "Discord application test entitlement changes are disabled by connector configuration",
      )
    }
    if (!this.#applicationTestEntitlementSkuIds.has(skuId)) {
      throw new PolicyError(
        `Discord SKU ${skuId} is outside the application test entitlement scope`,
      )
    }
    if (!this.#applicationMonetizationSkuIds.has(skuId)) {
      throw new PolicyError(
        `Discord SKU ${skuId} lacks the required application monetization evidence scope`,
      )
    }
    if (beneficiary.type === "guild") {
      this.assertGuildAllowed(beneficiary.id)
      if (!this.#applicationTestEntitlementGuildIds.has(beneficiary.id)) {
        throw new PolicyError(
          `Discord guild ${beneficiary.id} is outside the application test entitlement scope`,
        )
      }
    } else if (!this.#applicationTestEntitlementUserIds.has(beneficiary.id)) {
      throw new PolicyError(
        `Discord user ${beneficiary.id} is outside the application test entitlement scope`,
      )
    }
  }

  assertApplicationEntitlementConsumptionAllowed(
    userId: string,
    skuId: string,
  ): void {
    if (!this.#allowApplicationEntitlementConsumption) {
      throw new PolicyError(
        "Discord application entitlement consumption is disabled by connector configuration",
      )
    }
    if (!this.#applicationConsumableEntitlementUserIds.has(userId)) {
      throw new PolicyError(
        `Discord user ${userId} is outside the application entitlement consumption scope`,
      )
    }
    if (!this.#applicationConsumableEntitlementSkuIds.has(skuId)) {
      throw new PolicyError(
        `Discord SKU ${skuId} is outside the application entitlement consumption scope`,
      )
    }
    if (!this.#applicationMonetizationSkuIds.has(skuId)) {
      throw new PolicyError(
        `Discord SKU ${skuId} lacks the required application monetization evidence scope`,
      )
    }
  }

  #assertApplicationMonetizationAuditEnabled(): void {
    if (!this.#allowApplicationMonetizationAudit) {
      throw new PolicyError(
        "Discord application monetization audit is disabled by connector configuration",
      )
    }
    if (this.#applicationMonetizationSkuIds.size === 0) {
      throw new PolicyError(
        "Discord application monetization audit requires an exact SKU allowlist",
      )
    }
  }

  #assertApplicationMonetizationSkuIdsAuditable(skuIds: readonly string[]): void {
    if (skuIds.length === 0) {
      throw new PolicyError(
        "Discord application monetization audit requires at least one exact SKU ID",
      )
    }
    for (const skuId of new Set(skuIds)) {
      if (!this.#applicationMonetizationSkuIds.has(skuId)) {
        throw new PolicyError(`Discord SKU ${skuId} is outside the application monetization scope`)
      }
    }
  }

  assertApplicationEmojiChangeAllowed(): void {
    this.assertApplicationEmojiAuditable()
    if (!this.#allowApplicationEmojiChanges) {
      throw new PolicyError("Discord application emoji changes are disabled by connector configuration")
    }
  }

  assertApplicationIntentChangeAllowed(): void {
    if (!this.#allowApplicationIntentChanges) {
      throw new PolicyError(
        "Discord application privileged-intent changes are disabled by connector configuration",
      )
    }
  }

  assertBotProfileAuditable(): void {
    if (!this.#allowBotProfileAudit) {
      throw new PolicyError("Discord bot-profile audit is disabled by connector configuration")
    }
  }

  assertBotProfileChangeAllowed(): void {
    this.assertBotProfileAuditable()
    if (!this.#allowBotProfileChanges) {
      throw new PolicyError("Discord bot-profile changes are disabled by connector configuration")
    }
  }

  assertApplicationRoleConnectionMetadataChangeAllowed(): void {
    if (!this.#allowApplicationRoleConnectionMetadataChanges) {
      throw new PolicyError(
        "Discord linked-role metadata changes are disabled by connector configuration",
      )
    }
  }

  assertAutomodAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowAutomodAudit) {
      throw new PolicyError("Discord AutoMod audit is disabled by connector configuration")
    }
    if (this.#automodGuildIds.size === 0) {
      throw new PolicyError("Discord AutoMod audit requires an explicit guild allowlist")
    }
    if (!this.#automodGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the AutoMod scope`)
    }
  }

  assertAutomodChangeAllowed(guildId: string): void {
    this.assertAutomodAuditable(guildId)
    if (!this.#allowAutomodChanges) {
      throw new PolicyError("Discord AutoMod changes are disabled by connector configuration")
    }
  }

  automodAlertChannelAllowed(channelId: string): boolean {
    return this.channelIdReadable(channelId)
      && this.#automodAlertChannelIds.has(channelId)
  }

  assertAutomodAlertChannelAllowed(channelId: string): void {
    if (this.#automodAlertChannelIds.size === 0) {
      throw new PolicyError("Discord AutoMod alerts require an explicit channel allowlist")
    }
    if (!this.automodAlertChannelAllowed(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the AutoMod alert scope`)
    }
  }

  assertScheduledEventAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowScheduledEventAudit) {
      throw new PolicyError("Discord scheduled event audit is disabled by connector configuration")
    }
    if (this.#scheduledEventGuildIds.size === 0) {
      throw new PolicyError("Discord scheduled event audit requires an explicit guild allowlist")
    }
    if (!this.#scheduledEventGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the scheduled event scope`)
    }
  }

  assertScheduledEventChangeAllowed(guildId: string): void {
    this.assertScheduledEventAuditable(guildId)
    if (!this.#allowScheduledEventChanges) {
      throw new PolicyError("Discord scheduled event changes are disabled by connector configuration")
    }
  }

  assertScheduledEventUsersAuditable(guildId: string): void {
    this.assertScheduledEventAuditable(guildId)
    if (!this.#allowScheduledEventUserAudit) {
      throw new PolicyError(
        "Discord scheduled event user audit is disabled by connector configuration",
      )
    }
  }

  assertSoundboardAuditEnabled(): void {
    if (!this.#allowSoundboardAudit) {
      throw new PolicyError("Discord soundboard audit is disabled by connector configuration")
    }
    if (this.#soundboardGuildIds.size === 0) {
      throw new PolicyError("Discord soundboard audit requires an explicit guild allowlist")
    }
  }

  assertSoundboardAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    this.assertSoundboardAuditEnabled()
    if (!this.#soundboardGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the soundboard scope`)
    }
  }

  assertSoundboardChangeAllowed(guildId: string): void {
    this.assertSoundboardAuditable(guildId)
    if (!this.#allowSoundboardChanges) {
      throw new PolicyError("Discord soundboard changes are disabled by connector configuration")
    }
  }

  assertSoundboardPlaybackEnabled(): void {
    if (!this.#allowSoundboardPlayback) {
      throw new PolicyError("Discord soundboard playback is disabled by connector configuration")
    }
    if (this.#soundboardPlaybackChannelIds.size === 0) {
      throw new PolicyError(
        "Discord soundboard playback requires an explicit voice-channel allowlist",
      )
    }
  }

  assertSoundboardPlaybackChannelIdAllowed(channelId: string): void {
    this.assertSoundboardPlaybackEnabled()
    if (!this.#soundboardPlaybackChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the soundboard playback scope`)
    }
  }

  assertSoundboardPlaybackChannel(channel: DiscordChannel): string {
    this.assertSoundboardPlaybackChannelIdAllowed(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (channel.type !== DISCORD_CHANNEL_TYPES.voice) {
      throw new PolicyError(
        "Discord soundboard playback scope requires an exact ordinary voice channel",
      )
    }
    return guildId
  }

  assertSoundboardPlaybackSourceGuildAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    this.assertSoundboardPlaybackEnabled()
    if (!this.#soundboardPlaybackSourceGuildIds.has(guildId)) {
      throw new PolicyError(
        `Discord guild ${guildId} is outside the soundboard playback source scope`,
      )
    }
  }

  stageInstanceAuditChannelIds(): string[] {
    if (!this.#allowStageInstanceAudit) {
      throw new PolicyError("Discord Stage-instance audit is disabled by connector configuration")
    }
    if (this.#stageChannelIds.size === 0) {
      throw new PolicyError("Discord Stage-instance audit requires an explicit Stage-channel allowlist")
    }
    return [...this.#stageChannelIds].sort()
  }

  assertStageInstanceChannelIdAuditable(channelId: string): void {
    this.stageInstanceAuditChannelIds()
    if (!this.#stageChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the Stage-instance scope`)
    }
  }

  assertStageInstanceAuditable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    this.assertStageInstanceChannelIdAuditable(channel.id)
    if (channel.type !== DISCORD_CHANNEL_TYPES.stageVoice) {
      throw new PolicyError("Discord Stage-instance scope requires an exact Stage channel")
    }
    return guildId
  }

  assertStageInstanceChangeAllowed(
    channel: DiscordChannel,
    sendStartNotification = false,
  ): string {
    const guildId = this.assertStageInstanceAuditable(channel)
    this.assertStageInstanceChannelIdChangeAllowed(
      channel.id,
      sendStartNotification,
    )
    return guildId
  }

  assertStageInstanceChannelIdChangeAllowed(
    channelId: string,
    sendStartNotification = false,
  ): void {
    this.assertStageInstanceChannelIdAuditable(channelId)
    if (!this.#allowStageInstanceChanges) {
      throw new PolicyError("Discord Stage-instance changes are disabled by connector configuration")
    }
    if (sendStartNotification && !this.#allowStageStartNotifications) {
      throw new PolicyError("Discord Stage start notifications are disabled by connector configuration")
    }
  }

  channelIdReadable(channelId: string, parentId?: string | null): boolean {
    return this.#readChannelMode === "all-visible"
      || this.#allowedChannelIds.has(channelId)
      || Boolean(
        this.#threadReadMode === "inherit"
        && parentId
        && this.#allowedChannelIds.has(parentId),
      )
  }

  constrainSearchChannelIds(
    requestedChannelIds: readonly string[] | undefined,
    maximum: number,
  ): string[] | undefined {
    if (this.#readChannelMode === "all-visible") {
      return requestedChannelIds ? [...requestedChannelIds] : undefined
    }
    if (requestedChannelIds) {
      for (const channelId of requestedChannelIds) {
        if (!this.#allowedChannelIds.has(channelId)) {
          throw new PolicyError(
            `Discord channel ${channelId} is outside the exact configured search scope`,
          )
        }
      }
      return [...requestedChannelIds]
    }
    if (this.#allowedChannelIds.size > maximum) {
      throw new PolicyError(
        `Configured channel scope exceeds Discord's ${maximum}-channel search filter; provide an exact subset`,
      )
    }
    return [...this.#allowedChannelIds].sort()
  }

  assertChannelReadable(channel: DiscordChannel): string {
    const guildId = channel.guild_id
    if (!guildId) throw new PolicyError("Direct-message channels are outside connector scope")
    this.assertGuildAllowed(guildId)
    const parentId = THREAD_CHANNEL_TYPES.has(channel.type) ? channel.parent_id : undefined
    if (!this.channelIdReadable(channel.id, parentId)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the configured read scope`)
    }
    return guildId
  }

  assertChannelDeletable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowDeletions) {
      throw new PolicyError("Discord deletion is disabled by connector configuration")
    }
    if (this.#deleteChannelIds.size === 0) {
      throw new PolicyError("Discord deletion requires an explicit deletion-channel allowlist")
    }
    if (!this.#deleteChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the deletion scope`)
    }
    return guildId
  }

  assertChannelMetadataChangeAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowChannelMetadataChanges) {
      throw new PolicyError("Discord channel-metadata changes are disabled by connector configuration")
    }
    if (this.#channelMetadataIds.size === 0) {
      throw new PolicyError("Discord channel-metadata changes require an explicit channel allowlist")
    }
    if (!this.#channelMetadataIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the channel-metadata scope`)
    }
    return guildId
  }

  assertForumTagAuditConfigured(channelId: string): void {
    if (!this.#allowForumTagAudit) {
      throw new PolicyError("Discord forum-tag audit is disabled by connector configuration")
    }
    if (this.#forumTagChannelIds.size === 0) {
      throw new PolicyError("Discord forum-tag audit requires an explicit channel allowlist")
    }
    if (!this.#forumTagChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the forum-tag scope`)
    }
  }

  assertForumTagChangeConfigured(channelId: string): void {
    this.assertForumTagAuditConfigured(channelId)
    if (!this.#allowForumTagChanges) {
      throw new PolicyError("Discord forum-tag changes are disabled by connector configuration")
    }
  }

  assertForumTagAuditable(channel: DiscordChannel): string {
    this.assertForumTagAuditConfigured(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (channel.type !== DISCORD_CHANNEL_TYPES.forum) {
      throw new PolicyError("Discord forum-tag scope requires an exact forum channel")
    }
    return guildId
  }

  assertForumTagChangeable(channel: DiscordChannel): string {
    this.assertForumTagChangeConfigured(channel.id)
    const guildId = this.assertForumTagAuditable(channel)
    return guildId
  }

  assertChannelAttachmentAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowAttachments) {
      throw new PolicyError("Discord attachment messages are disabled by connector configuration")
    }
    if (this.#attachmentChannelIds.size === 0) {
      throw new PolicyError(
        "Discord attachment messages require an explicit attachment-channel allowlist",
      )
    }
    if (!this.#attachmentChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the attachment scope`)
    }
    return guildId
  }

  assertChannelInteractable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowInteractions) {
      throw new PolicyError("Discord interactions are disabled by connector configuration")
    }
    if (this.#interactionChannelIds.size === 0) {
      throw new PolicyError("Discord interactions require an explicit interaction-channel allowlist")
    }
    if (!this.#interactionChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the interaction scope`)
    }
    return guildId
  }

  assertChannelEmbedMessageAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowEmbedMessages) {
      throw new PolicyError("Discord embed messages are disabled by connector configuration")
    }
    if (this.#embedMessageChannelIds.size === 0) {
      throw new PolicyError(
        "Discord embed messages require an explicit embed-message channel allowlist",
      )
    }
    if (!this.#embedMessageChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the embed-message scope`)
    }
    return guildId
  }

  assertChannelAnnouncementCrosspostable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowAnnouncementCrossposts) {
      throw new PolicyError(
        "Discord announcement crossposts are disabled by connector configuration",
      )
    }
    if (this.#announcementCrosspostChannelIds.size === 0) {
      throw new PolicyError(
        "Discord announcement crossposts require an explicit channel allowlist",
      )
    }
    if (!this.#announcementCrosspostChannelIds.has(channel.id)) {
      throw new PolicyError(
        `Discord channel ${channel.id} is outside the announcement-crosspost scope`,
      )
    }
    return guildId
  }

  assertMessageForwardSource(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    this.assertMessageForwardSourceConfigured(channel.id)
    if (
      channel.type !== DISCORD_CHANNEL_TYPES.text
      && channel.type !== DISCORD_CHANNEL_TYPES.announcement
    ) {
      throw new PolicyError("Discord message forwarding supports direct text and announcement sources only")
    }
    return guildId
  }

  assertMessageForwardSourceConfigured(channelId: string): void {
    if (!this.#allowMessageForwarding) {
      throw new PolicyError("Discord message forwarding is disabled by connector configuration")
    }
    if (this.#messageForwardSourceChannelIds.size === 0) {
      throw new PolicyError("Discord message forwarding requires an exact source-channel allowlist")
    }
    if (!this.#messageForwardSourceChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the message-forward source scope`)
    }
  }

  assertMessageForwardTarget(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    this.assertMessageForwardTargetConfigured(channel.id)
    if (
      channel.type !== DISCORD_CHANNEL_TYPES.text
      && channel.type !== DISCORD_CHANNEL_TYPES.announcement
    ) {
      throw new PolicyError("Discord message forwarding supports direct text and announcement targets only")
    }
    return guildId
  }

  assertMessageForwardTargetConfigured(channelId: string): void {
    if (!this.#allowMessageForwarding) {
      throw new PolicyError("Discord message forwarding is disabled by connector configuration")
    }
    if (this.#messageForwardTargetChannelIds.size === 0) {
      throw new PolicyError("Discord message forwarding requires an exact target-channel allowlist")
    }
    if (!this.#messageForwardTargetChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the message-forward target scope`)
    }
  }

  assertMessageForwardGuildBoundary(sourceGuildId: string, targetGuildId: string): void {
    if (sourceGuildId !== targetGuildId && !this.#allowCrossGuildMessageForwarding) {
      throw new PolicyError(
        "Cross-guild Discord message forwarding is disabled by connector configuration",
      )
    }
  }

  assertAnnouncementSubscriptionTargetIdAuditable(channelId: string): void {
    if (!this.#allowAnnouncementSubscriptionAudit) {
      throw new PolicyError(
        "Discord announcement subscription audit is disabled by connector configuration",
      )
    }
    if (this.#announcementSubscriptionTargetChannelIds.size === 0) {
      throw new PolicyError(
        "Discord announcement subscription audit requires an explicit target-channel allowlist",
      )
    }
    if (!this.#announcementSubscriptionTargetChannelIds.has(channelId)) {
      throw new PolicyError(
        `Discord channel ${channelId} is outside the announcement-subscription target scope`,
      )
    }
  }

  assertAnnouncementSubscriptionTargetAuditable(channel: DiscordChannel): string {
    this.assertAnnouncementSubscriptionTargetIdAuditable(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (channel.type !== DISCORD_CHANNEL_TYPES.text) {
      throw new PolicyError(
        "Discord announcement subscription targets must be direct guild text channels",
      )
    }
    return guildId
  }

  assertAnnouncementSubscriptionTargetIdChangeable(channelId: string): void {
    this.assertAnnouncementSubscriptionTargetIdAuditable(channelId)
    if (!this.#allowAnnouncementSubscriptionChanges) {
      throw new PolicyError(
        "Discord announcement subscription changes are disabled by connector configuration",
      )
    }
  }

  assertAnnouncementSubscriptionTargetChangeable(channel: DiscordChannel): string {
    this.assertAnnouncementSubscriptionTargetIdChangeable(channel.id)
    return this.assertAnnouncementSubscriptionTargetAuditable(channel)
  }

  assertAnnouncementSubscriptionSourceIdChangeable(channelId: string): void {
    if (!this.#allowAnnouncementSubscriptionChanges) {
      throw new PolicyError(
        "Discord announcement subscription changes are disabled by connector configuration",
      )
    }
    if (this.#announcementSubscriptionSourceChannelIds.size === 0) {
      throw new PolicyError(
        "Discord announcement subscriptions require an explicit source-channel allowlist",
      )
    }
    if (!this.#announcementSubscriptionSourceChannelIds.has(channelId)) {
      throw new PolicyError(
        `Discord channel ${channelId} is outside the announcement-subscription source scope`,
      )
    }
  }

  assertAnnouncementSubscriptionSourceChangeable(channel: DiscordChannel): string {
    this.assertAnnouncementSubscriptionSourceIdChangeable(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (channel.type !== DISCORD_CHANNEL_TYPES.announcement) {
      throw new PolicyError(
        "Discord announcement subscription sources must be direct guild announcement channels",
      )
    }
    return guildId
  }

  assertChannelPinManageable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowPinManagement) {
      throw new PolicyError("Discord pin management is disabled by connector configuration")
    }
    if (this.#pinChannelIds.size === 0) {
      throw new PolicyError("Discord pin management requires an explicit pin-channel allowlist")
    }
    if (!this.#pinChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the pin-management scope`)
    }
    return guildId
  }

  assertPollAuditable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowPollAudit) {
      throw new PolicyError("Discord poll audit is disabled by connector configuration")
    }
    if (this.#pollChannelIds.size === 0) {
      throw new PolicyError("Discord poll audit requires an explicit channel allowlist")
    }
    if (!this.#pollChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the poll scope`)
    }
    return guildId
  }

  assertPollVotersAuditable(channel: DiscordChannel): string {
    const guildId = this.assertPollAuditable(channel)
    if (!this.#allowPollVoterAudit) {
      throw new PolicyError("Discord poll voter audit is disabled by connector configuration")
    }
    return guildId
  }

  assertPollCreatable(channel: DiscordChannel): string {
    const guildId = this.assertPollAuditable(channel)
    if (!this.#allowPollCreation) {
      throw new PolicyError("Discord poll creation is disabled by connector configuration")
    }
    return guildId
  }

  assertPollEndable(channel: DiscordChannel): string {
    const guildId = this.assertPollAuditable(channel)
    if (!this.#allowPollEnding) {
      throw new PolicyError("Discord poll ending is disabled by connector configuration")
    }
    return guildId
  }

  assertChannelReactionAuditable(channel: DiscordChannel): string {
    this.assertChannelReactionIdAuditable(channel.id)
    return this.assertChannelReadable(channel)
  }

  assertChannelReactionIdAuditable(channelId: string): void {
    if (!this.#allowReactionUserAudit) {
      throw new PolicyError("Discord reaction-user audit is disabled by connector configuration")
    }
    if (this.#reactionChannelIds.size === 0) {
      throw new PolicyError("Discord reaction-user audit requires an explicit channel allowlist")
    }
    if (!this.#reactionChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the reaction scope`)
    }
  }

  assertChannelReactionModeratable(channel: DiscordChannel): string {
    this.assertChannelReactionIdModeratable(channel.id)
    return this.assertChannelReadable(channel)
  }

  assertChannelReactionIdModeratable(channelId: string): void {
    if (!this.#allowReactionModeration) {
      throw new PolicyError("Discord reaction moderation is disabled by connector configuration")
    }
    if (this.#reactionChannelIds.size === 0) {
      throw new PolicyError("Discord reaction moderation requires an explicit channel allowlist")
    }
    if (!this.#reactionChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the reaction scope`)
    }
  }

  assertChannelWebhookAuditable(channel: DiscordChannel): string {
    this.assertChannelWebhookIdAuditable(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (!WEBHOOK_CHANNEL_TYPES.has(channel.type)) {
      throw new PolicyError("Discord channel type does not support webhook inventory")
    }
    return guildId
  }

  assertGuildWebhookAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowWebhookAudit) {
      throw new PolicyError("Discord webhook audit is disabled by connector configuration")
    }
    if (this.#webhookGuildIds.size === 0) {
      throw new PolicyError("Discord guild webhook audit requires an explicit guild allowlist")
    }
    if (!this.#webhookGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild webhook scope`)
    }
  }

  assertChannelWebhookIdAuditable(channelId: string): void {
    if (!this.#allowWebhookAudit) {
      throw new PolicyError("Discord webhook audit is disabled by connector configuration")
    }
    if (this.#webhookChannelIds.size === 0) {
      throw new PolicyError("Discord webhook audit requires an explicit channel allowlist")
    }
    if (!this.#webhookChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the webhook scope`)
    }
  }

  assertChannelWebhookDeletable(channel: DiscordChannel): string {
    this.assertChannelWebhookIdDeletable(channel.id)
    const guildId = this.assertChannelWebhookAuditable(channel)
    return guildId
  }

  assertChannelWebhookChangeable(channel: DiscordChannel): string {
    this.assertChannelWebhookIdChangeable(channel.id)
    return this.assertChannelWebhookAuditable(channel)
  }

  assertChannelWebhookIdChangeable(channelId: string): void {
    this.assertChannelWebhookIdAuditable(channelId)
    if (!this.#allowWebhookChanges) {
      throw new PolicyError("Discord webhook changes are disabled by connector configuration")
    }
  }

  assertChannelWebhookCreatable(channel: DiscordChannel): string {
    this.assertChannelWebhookIdCreatable(channel.id)
    return this.assertChannelWebhookAuditable(channel)
  }

  assertChannelWebhookIdCreatable(channelId: string): void {
    this.assertChannelWebhookIdAuditable(channelId)
    if (!this.#allowWebhookCreation) {
      throw new PolicyError("Discord webhook creation is disabled by connector configuration")
    }
  }

  assertChannelWebhookIdDeletable(channelId: string): void {
    this.assertChannelWebhookIdAuditable(channelId)
    if (!this.#allowWebhookDeletions) {
      throw new PolicyError("Discord webhook deletion is disabled by connector configuration")
    }
  }

  assertChannelWebhookMessageAuditable(channel: DiscordChannel): string {
    this.assertChannelWebhookMessageIdAuditable(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (!WEBHOOK_MESSAGE_CHANNEL_TYPES.has(channel.type)) {
      throw new PolicyError("Discord channel type does not support webhook message access")
    }
    return guildId
  }

  assertWebhookMessageAuditEnabled(): void {
    if (!this.#allowWebhookMessageAudit) {
      throw new PolicyError("Discord webhook message audit is disabled by connector configuration")
    }
    if (this.#webhookMessageChannelIds.size === 0) {
      throw new PolicyError("Discord webhook messages require an explicit channel allowlist")
    }
  }

  assertChannelWebhookMessageIdAuditable(channelId: string): void {
    this.assertWebhookMessageAuditEnabled()
    this.#assertWebhookMessageChannelId(channelId)
  }

  assertWebhookMessageChangesEnabled(): void {
    this.assertWebhookMessageAuditEnabled()
    if (!this.#allowWebhookMessageChanges) {
      throw new PolicyError("Discord webhook message changes are disabled by connector configuration")
    }
  }

  assertChannelWebhookMessageChangeable(channel: DiscordChannel): string {
    this.assertWebhookMessageChangesEnabled()
    return this.assertChannelWebhookMessageAuditable(channel)
  }

  assertWebhookMessageDeletionsEnabled(): void {
    this.assertWebhookMessageAuditEnabled()
    if (!this.#allowWebhookMessageDeletions) {
      throw new PolicyError("Discord webhook message deletion is disabled by connector configuration")
    }
  }

  assertChannelWebhookMessageDeletable(channel: DiscordChannel): string {
    this.assertWebhookMessageDeletionsEnabled()
    return this.assertChannelWebhookMessageAuditable(channel)
  }

  assertWebhookMessageDeliveryEnabled(): void {
    if (!this.#allowWebhookMessageDelivery) {
      throw new PolicyError("Discord webhook message delivery is disabled by connector configuration")
    }
    if (this.#webhookMessageChannelIds.size === 0) {
      throw new PolicyError("Discord webhook messages require an explicit channel allowlist")
    }
  }

  assertChannelWebhookMessageDeliverable(channel: DiscordChannel): string {
    this.assertWebhookMessageDeliveryEnabled()
    this.#assertWebhookMessageChannelId(channel.id)
    const guildId = this.assertChannelReadable(channel)
    if (!WEBHOOK_MESSAGE_CHANNEL_TYPES.has(channel.type)) {
      throw new PolicyError("Discord channel type does not support webhook message delivery")
    }
    return guildId
  }

  #assertWebhookMessageChannelId(channelId: string): void {
    if (this.#webhookMessageChannelIds.size === 0) {
      throw new PolicyError("Discord webhook messages require an explicit channel allowlist")
    }
    if (!this.#webhookMessageChannelIds.has(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the webhook message scope`)
    }
  }

  assertChannelPermissionOverwriteAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowPermissionOverwrites) {
      throw new PolicyError("Discord permission-overwrite changes are disabled by connector configuration")
    }
    if (this.#permissionOverwriteChannelIds.size === 0) {
      throw new PolicyError("Discord permission-overwrite changes require an explicit channel allowlist")
    }
    if (!this.#permissionOverwriteChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the permission-overwrite scope`)
    }
    return guildId
  }

  assertChannelPermissionSyncAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowPermissionSyncs) {
      throw new PolicyError("Discord parent-category permission synchronization is disabled by connector configuration")
    }
    if (this.#permissionSyncChannelIds.size === 0) {
      throw new PolicyError("Discord parent-category permission synchronization requires an explicit channel allowlist")
    }
    if (!this.#permissionSyncChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the parent-category permission-sync scope`)
    }
    return guildId
  }

  assertForumPostAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowForumPosts) {
      throw new PolicyError("Discord forum posts are disabled by connector configuration")
    }
    if (this.#forumPostChannelIds.size === 0) {
      throw new PolicyError("Discord forum posts require an explicit forum-channel allowlist")
    }
    if (!this.#forumPostChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the forum-post scope`)
    }
    return guildId
  }

  assertThreadCreatable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowThreadCreation) {
      throw new PolicyError("Discord thread creation is disabled by connector configuration")
    }
    if (this.#threadParentIds.size === 0) {
      throw new PolicyError("Discord thread creation requires an explicit parent-channel allowlist")
    }
    if (!this.#threadParentIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the thread-creation scope`)
    }
    return guildId
  }

  assertThreadAuditable(guildId: string, threadId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowThreadAudit) {
      throw new PolicyError("Discord thread audit is disabled by connector configuration")
    }
    if (this.#threadGuildIds.size === 0) {
      throw new PolicyError("Discord thread audit requires an explicit guild allowlist")
    }
    if (!this.#threadGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the thread-governance scope`)
    }
    if (this.#threadIds.size === 0) {
      throw new PolicyError("Discord thread audit requires an exact thread allowlist")
    }
    if (!this.#threadIds.has(threadId) || !this.channelIdReadable(threadId)) {
      throw new PolicyError(`Discord thread ${threadId} is outside the thread-governance scope`)
    }
  }

  assertThreadMemberUserAllowed(userId: string): void {
    if (this.#threadMemberUserIds.size === 0) {
      throw new PolicyError("Discord thread membership access requires an exact user allowlist")
    }
    if (!this.#threadMemberUserIds.has(userId)) {
      throw new PolicyError(`Discord user ${userId} is outside the thread-membership scope`)
    }
  }

  assertThreadChangeAllowed(guildId: string, threadId: string): void {
    this.assertThreadAuditable(guildId, threadId)
    if (!this.#allowThreadChanges) {
      throw new PolicyError("Discord thread changes are disabled by connector configuration")
    }
  }

  notificationAuthorization(
    userIds: readonly string[],
  ): NotificationAuthorizationDecision {
    if (userIds.length > 0 && this.#userMentionMode === "disabled") {
      throw new PolicyError("Discord user notifications are disabled by connector configuration")
    }
    const allowlistedUserIds: string[] = []
    const reviewedUserIds: string[] = []
    for (const userId of userIds) {
      if (this.#mentionUserIds.has(userId)) {
        allowlistedUserIds.push(userId)
      } else if (this.#userMentionMode === "reviewed") {
        reviewedUserIds.push(userId)
      } else {
        throw new PolicyError(`Discord user ${userId} is outside the notification scope`)
      }
    }
    return {
      authorization: reviewedUserIds.length > 0 ? "reviewed" : "direct",
      allowlistedUserIds,
      reviewedUserIds,
    }
  }

  assertNotificationUsers(
    userIds: readonly string[],
  ): NotificationAuthorizationDecision {
    const decision = this.notificationAuthorization(userIds)
    if (decision.authorization === "reviewed") {
      throw new PolicyError(
        `Discord user ${decision.reviewedUserIds[0]} requires signed interactive notification review`,
      )
    }
    return decision
  }

  assertComponentLinkOrigins(origins: readonly string[]): void {
    for (const origin of origins) {
      if (!this.#componentLinkOrigins.has(origin)) {
        throw new PolicyError(
          `Component link origin ${origin} is outside the exact configured origin scope`,
        )
      }
    }
  }
}
