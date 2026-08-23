import type { ConnectorConfig } from "./config.js"
import {
  DISCORD_CHANNEL_TYPES,
  GATEWAY_DEFAULTS,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { PolicyError } from "./errors.js"
import type { DiscordChannel, DiscordGuild } from "./types.js"

export interface PolicyDescription {
  administrationEnabled: boolean
  administrationGuildIds: string[]
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
  channelCloneAuditEnabled: boolean
  channelCloneGuildIds: string[]
  channelCloneSourceIds: string[]
  channelCloningEnabled: boolean
  channelCreationEnabled: boolean
  channelCreationGuildIds: string[]
  channelMetadataChangesEnabled: boolean
  channelMetadataIds: string[]
  channelOrderingAuditEnabled: boolean
  channelOrderingChangesEnabled: boolean
  channelOrderingGuildIds: string[]
  deleteChannelIds: string[]
  deletionsEnabled: boolean
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
  guildProfileAuditEnabled: boolean
  guildProfileChangesEnabled: boolean
  guildProfileGuildIds: string[]
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
  onboardingAuditEnabled: boolean
  onboardingChangesEnabled: boolean
  onboardingGuildIds: string[]
  permissionOverwriteChannelIds: string[]
  permissionOverwritesEnabled: boolean
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
  threadParentIds: string[]
  welcomeScreenAuditEnabled: boolean
  welcomeScreenChangesEnabled: boolean
  welcomeScreenGuildIds: string[]
  webhookAuditEnabled: boolean
  webhookChannelIds: string[]
  webhookChangesEnabled: boolean
  webhookCreationEnabled: boolean
  webhookDeletionsEnabled: boolean
  widgetPublicExposureEnabled: boolean
  widgetSettingsAuditEnabled: boolean
  widgetSettingsChangesEnabled: boolean
  widgetSettingsGuildIds: string[]
}

const WEBHOOK_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])

export class ScopePolicy {
  readonly #adminGuildIds: ReadonlySet<string>
  readonly #allowedChannelIds: ReadonlySet<string>
  readonly #allowedGuildIds: ReadonlySet<string>
  readonly #allowAdministration: boolean
  readonly #allowAnnouncementCrossposts: boolean
  readonly #allowAnnouncementSubscriptionAudit: boolean
  readonly #allowAnnouncementSubscriptionChanges: boolean
  readonly #allowAttachments: boolean
  readonly #allowAutomodAudit: boolean
  readonly #allowAutomodChanges: boolean
  readonly #allowBanAudit: boolean
  readonly #allowChannelCloneAudit: boolean
  readonly #allowChannelCloning: boolean
  readonly #allowChannelCreation: boolean
  readonly #allowChannelMetadataChanges: boolean
  readonly #allowChannelOrderingAudit: boolean
  readonly #allowChannelOrderingChanges: boolean
  readonly #allowDeletions: boolean
  readonly #allowInteractions: boolean
  readonly #allowInviteAudit: boolean
  readonly #allowInviteDeletions: boolean
  readonly #allowMemberDirectory: boolean
  readonly #allowNicknameChanges: boolean
  readonly #allowOtherMemberNicknameChanges: boolean
  readonly #allowMemberRoleChanges: boolean
  readonly #allowMemberVoiceAudit: boolean
  readonly #allowMemberVoiceChanges: boolean
  readonly #allowCrossGuildMessageForwarding: boolean
  readonly #allowMessageForwarding: boolean
  readonly #allowNativeCommandChanges: boolean
  readonly #allowNativeInteractions: boolean
  readonly #allowOnboardingAudit: boolean
  readonly #allowOnboardingChanges: boolean
  readonly #allowPermissionOverwrites: boolean
  readonly #allowPinManagement: boolean
  readonly #allowPollAudit: boolean
  readonly #allowPollCreation: boolean
  readonly #allowPollEnding: boolean
  readonly #allowPollVoterAudit: boolean
  readonly #allowReactionModeration: boolean
  readonly #allowReactionUserAudit: boolean
  readonly #allowGateway: boolean
  readonly #allowGuildExpressionAudit: boolean
  readonly #allowGuildExpressionChanges: boolean
  readonly #allowGuildProfileAudit: boolean
  readonly #allowGuildProfileChanges: boolean
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
  readonly #allowRoleOrderingAudit: boolean
  readonly #allowRoleOrderingChanges: boolean
  readonly #allowScheduledEventAudit: boolean
  readonly #allowScheduledEventChanges: boolean
  readonly #allowScheduledEventUserAudit: boolean
  readonly #allowSoundboardAudit: boolean
  readonly #allowSoundboardChanges: boolean
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
  readonly #allowWidgetPublicExposure: boolean
  readonly #allowWidgetSettingsAudit: boolean
  readonly #allowWidgetSettingsChanges: boolean
  readonly #deleteChannelIds: ReadonlySet<string>
  readonly #announcementCrosspostChannelIds: ReadonlySet<string>
  readonly #announcementSubscriptionSourceChannelIds: ReadonlySet<string>
  readonly #announcementSubscriptionTargetChannelIds: ReadonlySet<string>
  readonly #attachmentChannelIds: ReadonlySet<string>
  readonly #attachmentMaxBytes: number
  readonly #attachmentRoots: readonly string[]
  readonly #automodAlertChannelIds: ReadonlySet<string>
  readonly #automodGuildIds: ReadonlySet<string>
  readonly #banAuditGuildIds: ReadonlySet<string>
  readonly #channelCloneGuildIds: ReadonlySet<string>
  readonly #channelCloneSourceIds: ReadonlySet<string>
  readonly #channelCreationGuildIds: ReadonlySet<string>
  readonly #channelMetadataIds: ReadonlySet<string>
  readonly #channelOrderingGuildIds: ReadonlySet<string>
  readonly #interactionChannelIds: ReadonlySet<string>
  readonly #interactionMaxWritesPerMinute: number
  readonly #interactionMinWriteIntervalMs: number
  readonly #inviteGuildIds: ReadonlySet<string>
  readonly #gatewayEventBufferSize: number
  readonly #guildScaffoldGuildIds: ReadonlySet<string>
  readonly #guildExpressionGuildIds: ReadonlySet<string>
  readonly #guildExpressionRoots: readonly string[]
  readonly #guildProfileGuildIds: ReadonlySet<string>
  readonly #guildSettingsGuildIds: ReadonlySet<string>
  readonly #guildTemplateGuildIds: ReadonlySet<string>
  readonly #integrationGuildIds: ReadonlySet<string>
  readonly #integrationIds: ReadonlySet<string>
  readonly #forumPostChannelIds: ReadonlySet<string>
  readonly #forumTagChannelIds: ReadonlySet<string>
  readonly #mentionUserIds: ReadonlySet<string>
  readonly #memberDirectoryGuildIds: ReadonlySet<string>
  readonly #nicknameGuildIds: ReadonlySet<string>
  readonly #memberRoleGuildIds: ReadonlySet<string>
  readonly #memberRoleIds: ReadonlySet<string>
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
  readonly #onboardingGuildIds: ReadonlySet<string>
  readonly #permissionOverwriteChannelIds: ReadonlySet<string>
  readonly #protectedUserIds: ReadonlySet<string>
  readonly #pinChannelIds: ReadonlySet<string>
  readonly #pollChannelIds: ReadonlySet<string>
  readonly #reactionChannelIds: ReadonlySet<string>
  readonly #roleCreationGuildIds: ReadonlySet<string>
  readonly #roleConfigurationIds: ReadonlySet<string>
  readonly #roleOrderingGuildIds: ReadonlySet<string>
  readonly #scheduledEventGuildIds: ReadonlySet<string>
  readonly #scheduledEventRoots: readonly string[]
  readonly #soundboardGuildIds: ReadonlySet<string>
  readonly #soundboardRoots: readonly string[]
  readonly #stageChannelIds: ReadonlySet<string>
  readonly #threadParentIds: ReadonlySet<string>
  readonly #threadGuildIds: ReadonlySet<string>
  readonly #threadIds: ReadonlySet<string>
  readonly #threadMemberUserIds: ReadonlySet<string>
  readonly #welcomeScreenGuildIds: ReadonlySet<string>
  readonly #webhookChannelIds: ReadonlySet<string>
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
    | "allowAnnouncementSubscriptionAudit"
    | "allowAnnouncementSubscriptionChanges"
    | "allowAttachments"
    | "allowAutomodAudit"
    | "allowAutomodChanges"
    | "allowBanAudit"
    | "allowChannelCloneAudit"
    | "allowChannelCloning"
    | "allowChannelMetadataChanges"
    | "allowChannelOrderingAudit"
    | "allowChannelOrderingChanges"
    | "allowGateway"
    | "allowGuildExpressionAudit"
    | "allowGuildExpressionChanges"
    | "allowGuildTemplateAudit"
    | "allowGuildTemplateChanges"
    | "allowIntegrationAudit"
    | "allowIntegrationDeletions"
    | "allowForumTagAudit"
    | "allowForumTagChanges"
    | "allowInviteAudit"
    | "allowInviteDeletions"
    | "allowMemberDirectory"
    | "allowNicknameChanges"
    | "allowOtherMemberNicknameChanges"
    | "allowMemberRoleChanges"
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
    | "allowRoleOrderingAudit"
    | "allowRoleOrderingChanges"
    | "allowGuildProfileAudit"
    | "allowGuildProfileChanges"
    | "allowGuildSettingsAudit"
    | "allowGuildSettingsChanges"
    | "allowScheduledEventAudit"
    | "allowScheduledEventChanges"
    | "allowScheduledEventUserAudit"
    | "allowSoundboardAudit"
    | "allowSoundboardChanges"
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
    | "allowWidgetPublicExposure"
    | "allowWidgetSettingsAudit"
    | "allowWidgetSettingsChanges"
    | "channelCreationGuildIds"
    | "channelCloneGuildIds"
    | "channelCloneSourceIds"
    | "announcementCrosspostChannelIds"
    | "announcementSubscriptionSourceChannelIds"
    | "announcementSubscriptionTargetChannelIds"
    | "channelMetadataIds"
    | "channelOrderingGuildIds"
    | "attachmentChannelIds"
    | "attachmentMaxBytes"
    | "attachmentRoots"
    | "automodAlertChannelIds"
    | "automodGuildIds"
    | "banAuditGuildIds"
    | "gatewayEventBufferSize"
    | "guildScaffoldGuildIds"
    | "guildExpressionGuildIds"
    | "guildExpressionRoots"
    | "guildProfileGuildIds"
    | "guildSettingsGuildIds"
    | "guildTemplateGuildIds"
    | "integrationGuildIds"
    | "integrationIds"
    | "inviteGuildIds"
    | "memberDirectoryGuildIds"
    | "nicknameGuildIds"
    | "memberRoleGuildIds"
    | "memberRoleIds"
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
    | "onboardingGuildIds"
    | "permissionOverwriteChannelIds"
    | "pinChannelIds"
    | "pollChannelIds"
    | "reactionChannelIds"
    | "roleCreationGuildIds"
    | "roleConfigurationIds"
    | "roleOrderingGuildIds"
    | "scheduledEventGuildIds"
    | "scheduledEventRoots"
    | "soundboardGuildIds"
    | "soundboardRoots"
    | "stageChannelIds"
    | "threadParentIds"
    | "threadGuildIds"
    | "threadIds"
    | "threadMemberUserIds"
    | "welcomeScreenGuildIds"
    | "webhookChannelIds"
    | "widgetSettingsGuildIds"
  >>) {
    this.#adminGuildIds = config.adminGuildIds
    this.#allowedChannelIds = config.allowedChannelIds
    this.#allowedGuildIds = config.allowedGuildIds
    this.#allowAdministration = config.allowAdministration
    this.#allowAnnouncementCrossposts = config.allowAnnouncementCrossposts ?? false
    this.#allowAnnouncementSubscriptionAudit = config.allowAnnouncementSubscriptionAudit
      ?? false
    this.#allowAnnouncementSubscriptionChanges = config.allowAnnouncementSubscriptionChanges
      ?? false
    this.#allowAttachments = config.allowAttachments ?? false
    this.#allowAutomodAudit = config.allowAutomodAudit ?? false
    this.#allowAutomodChanges = config.allowAutomodChanges ?? false
    this.#allowBanAudit = config.allowBanAudit ?? false
    this.#allowChannelCloneAudit = config.allowChannelCloneAudit ?? false
    this.#allowChannelCloning = config.allowChannelCloning ?? false
    this.#allowChannelCreation = config.allowChannelCreation ?? false
    this.#allowChannelOrderingAudit = config.allowChannelOrderingAudit ?? false
    this.#allowChannelOrderingChanges = config.allowChannelOrderingChanges ?? false
    this.#allowChannelMetadataChanges = config.allowChannelMetadataChanges ?? false
    this.#allowDeletions = config.allowDeletions
    this.#allowInteractions = config.allowInteractions
    this.#allowInviteAudit = config.allowInviteAudit ?? false
    this.#allowInviteDeletions = config.allowInviteDeletions ?? false
    this.#allowMemberDirectory = config.allowMemberDirectory ?? false
    this.#allowNicknameChanges = config.allowNicknameChanges ?? false
    this.#allowOtherMemberNicknameChanges = config.allowOtherMemberNicknameChanges
      ?? false
    this.#allowMemberRoleChanges = config.allowMemberRoleChanges ?? false
    this.#allowMemberVoiceAudit = config.allowMemberVoiceAudit ?? false
    this.#allowMemberVoiceChanges = config.allowMemberVoiceChanges ?? false
    this.#allowCrossGuildMessageForwarding = config.allowCrossGuildMessageForwarding ?? false
    this.#allowMessageForwarding = config.allowMessageForwarding ?? false
    this.#allowNativeCommandChanges = config.allowNativeCommandChanges ?? false
    this.#allowNativeInteractions = config.allowNativeInteractions ?? false
    this.#allowOnboardingAudit = config.allowOnboardingAudit ?? false
    this.#allowOnboardingChanges = config.allowOnboardingChanges ?? false
    this.#allowPermissionOverwrites = config.allowPermissionOverwrites ?? false
    this.#allowPinManagement = config.allowPinManagement ?? false
    this.#allowPollAudit = config.allowPollAudit ?? false
    this.#allowPollCreation = config.allowPollCreation ?? false
    this.#allowPollEnding = config.allowPollEnding ?? false
    this.#allowPollVoterAudit = config.allowPollVoterAudit ?? false
    this.#allowReactionModeration = config.allowReactionModeration ?? false
    this.#allowReactionUserAudit = config.allowReactionUserAudit ?? false
    this.#allowGateway = config.allowGateway ?? false
    this.#allowGuildExpressionAudit = config.allowGuildExpressionAudit ?? false
    this.#allowGuildExpressionChanges = config.allowGuildExpressionChanges ?? false
    this.#allowGuildProfileAudit = config.allowGuildProfileAudit ?? false
    this.#allowGuildProfileChanges = config.allowGuildProfileChanges ?? false
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
    this.#allowRoleOrderingAudit = config.allowRoleOrderingAudit ?? false
    this.#allowRoleOrderingChanges = config.allowRoleOrderingChanges ?? false
    this.#allowScheduledEventAudit = config.allowScheduledEventAudit ?? false
    this.#allowScheduledEventChanges = config.allowScheduledEventChanges ?? false
    this.#allowScheduledEventUserAudit = config.allowScheduledEventUserAudit ?? false
    this.#allowSoundboardAudit = config.allowSoundboardAudit ?? false
    this.#allowSoundboardChanges = config.allowSoundboardChanges ?? false
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
    this.#allowWidgetPublicExposure = config.allowWidgetPublicExposure ?? false
    this.#allowWidgetSettingsAudit = config.allowWidgetSettingsAudit ?? false
    this.#allowWidgetSettingsChanges = config.allowWidgetSettingsChanges ?? false
    this.#deleteChannelIds = config.deleteChannelIds
    this.#announcementCrosspostChannelIds = config.announcementCrosspostChannelIds ?? new Set()
    this.#announcementSubscriptionSourceChannelIds = config
      .announcementSubscriptionSourceChannelIds ?? new Set()
    this.#announcementSubscriptionTargetChannelIds = config
      .announcementSubscriptionTargetChannelIds ?? new Set()
    this.#attachmentChannelIds = config.attachmentChannelIds ?? new Set()
    this.#attachmentMaxBytes = config.attachmentMaxBytes ?? 0
    this.#attachmentRoots = config.attachmentRoots ?? []
    this.#automodAlertChannelIds = config.automodAlertChannelIds ?? new Set()
    this.#automodGuildIds = config.automodGuildIds ?? new Set()
    this.#banAuditGuildIds = config.banAuditGuildIds ?? new Set()
    this.#channelCloneGuildIds = config.channelCloneGuildIds ?? new Set()
    this.#channelCloneSourceIds = config.channelCloneSourceIds ?? new Set()
    this.#channelCreationGuildIds = config.channelCreationGuildIds ?? new Set()
    this.#channelMetadataIds = config.channelMetadataIds ?? new Set()
    this.#channelOrderingGuildIds = config.channelOrderingGuildIds ?? new Set()
    this.#interactionChannelIds = config.interactionChannelIds
    this.#interactionMaxWritesPerMinute = config.interactionMaxWritesPerMinute
    this.#interactionMinWriteIntervalMs = config.interactionMinWriteIntervalMs
    this.#inviteGuildIds = config.inviteGuildIds ?? new Set()
    this.#gatewayEventBufferSize = config.gatewayEventBufferSize
      ?? GATEWAY_DEFAULTS.eventBufferSize
    this.#guildScaffoldGuildIds = config.guildScaffoldGuildIds ?? new Set()
    this.#guildExpressionGuildIds = config.guildExpressionGuildIds ?? new Set()
    this.#guildExpressionRoots = config.guildExpressionRoots ?? []
    this.#guildProfileGuildIds = config.guildProfileGuildIds ?? new Set()
    this.#guildSettingsGuildIds = config.guildSettingsGuildIds ?? new Set()
    this.#guildTemplateGuildIds = config.guildTemplateGuildIds ?? new Set()
    this.#integrationGuildIds = config.integrationGuildIds ?? new Set()
    this.#integrationIds = config.integrationIds ?? new Set()
    this.#forumPostChannelIds = config.forumPostChannelIds ?? new Set()
    this.#forumTagChannelIds = config.forumTagChannelIds ?? new Set()
    this.#mentionUserIds = config.mentionUserIds
    this.#memberDirectoryGuildIds = config.memberDirectoryGuildIds ?? new Set()
    this.#nicknameGuildIds = config.nicknameGuildIds ?? new Set()
    this.#memberRoleGuildIds = config.memberRoleGuildIds ?? new Set()
    this.#memberRoleIds = config.memberRoleIds ?? new Set()
    this.#memberVoiceChannelIds = config.memberVoiceChannelIds ?? new Set()
    this.#memberVoiceGuildIds = config.memberVoiceGuildIds ?? new Set()
    this.#messageForwardSourceChannelIds = config.messageForwardSourceChannelIds ?? new Set()
    this.#messageForwardTargetChannelIds = config.messageForwardTargetChannelIds ?? new Set()
    this.#nativeCommandName = config.nativeCommandName ?? "discord-mcp"
    this.#nativeInteractionChannelIds = config.nativeInteractionChannelIds ?? new Set()
    this.#nativeInteractionGuildIds = config.nativeInteractionGuildIds ?? new Set()
    this.#nativeInteractionMaxPending = config.nativeInteractionMaxPending ?? 25
    this.#nativeInteractionTtlSeconds = config.nativeInteractionTtlSeconds ?? 600
    this.#nativeInteractionUserIds = config.nativeInteractionUserIds ?? new Set()
    this.#mcpToolsets = config.mcpToolsets ?? new Set(MCP_TOOLSET_NAMES)
    this.#mcpToolSurface = config.mcpToolSurface ?? "full"
    this.#onboardingGuildIds = config.onboardingGuildIds ?? new Set()
    this.#permissionOverwriteChannelIds = config.permissionOverwriteChannelIds ?? new Set()
    this.#protectedUserIds = config.protectedUserIds
    this.#pinChannelIds = config.pinChannelIds ?? new Set()
    this.#pollChannelIds = config.pollChannelIds ?? new Set()
    this.#reactionChannelIds = config.reactionChannelIds ?? new Set()
    this.#roleCreationGuildIds = config.roleCreationGuildIds ?? new Set()
    this.#roleConfigurationIds = config.roleConfigurationIds ?? new Set()
    this.#roleOrderingGuildIds = config.roleOrderingGuildIds ?? new Set()
    this.#scheduledEventGuildIds = config.scheduledEventGuildIds ?? new Set()
    this.#scheduledEventRoots = config.scheduledEventRoots ?? []
    this.#soundboardGuildIds = config.soundboardGuildIds ?? new Set()
    this.#soundboardRoots = config.soundboardRoots ?? []
    this.#stageChannelIds = config.stageChannelIds ?? new Set()
    this.#threadParentIds = config.threadParentIds ?? new Set()
    this.#threadGuildIds = config.threadGuildIds ?? new Set()
    this.#threadIds = config.threadIds ?? new Set()
    this.#threadMemberUserIds = config.threadMemberUserIds ?? new Set()
    this.#welcomeScreenGuildIds = config.welcomeScreenGuildIds ?? new Set()
    this.#webhookChannelIds = config.webhookChannelIds ?? new Set()
    this.#widgetSettingsGuildIds = config.widgetSettingsGuildIds ?? new Set()
  }

  describe(): PolicyDescription {
    return {
      administrationEnabled: this.#allowAdministration && this.#adminGuildIds.size > 0,
      administrationGuildIds: [...this.#adminGuildIds].sort(),
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
      channelMetadataChangesEnabled: this.#allowChannelMetadataChanges
        && this.#channelMetadataIds.size > 0,
      channelMetadataIds: [...this.#channelMetadataIds].sort(),
      channelOrderingAuditEnabled: this.#allowChannelOrderingAudit
        && this.#channelOrderingGuildIds.size > 0,
      channelOrderingChangesEnabled: this.#allowChannelOrderingAudit
        && this.#allowChannelOrderingChanges
        && this.#channelOrderingGuildIds.size > 0,
      channelOrderingGuildIds: [...this.#channelOrderingGuildIds].sort(),
      deleteChannelIds: [...this.#deleteChannelIds].sort(),
      deletionsEnabled: this.#allowDeletions && this.#deleteChannelIds.size > 0,
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
      guildProfileAuditEnabled: this.#allowGuildProfileAudit
        && this.#guildProfileGuildIds.size > 0,
      guildProfileChangesEnabled: this.#allowGuildProfileAudit
        && this.#allowGuildProfileChanges
        && this.#guildProfileGuildIds.size > 0,
      guildProfileGuildIds: [...this.#guildProfileGuildIds].sort(),
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
      mcpToolsets: MCP_TOOLSET_NAMES.filter((name) => this.#mcpToolsets.has(name)),
      mcpToolSurface: this.#mcpToolSurface,
      onboardingAuditEnabled: this.#allowOnboardingAudit
        && this.#onboardingGuildIds.size > 0,
      onboardingChangesEnabled: this.#allowOnboardingAudit
        && this.#allowOnboardingChanges
        && this.#onboardingGuildIds.size > 0,
      onboardingGuildIds: [...this.#onboardingGuildIds].sort(),
      permissionOverwriteChannelIds: [...this.#permissionOverwriteChannelIds].sort(),
      permissionOverwritesEnabled: this.#allowPermissionOverwrites
        && this.#permissionOverwriteChannelIds.size > 0,
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
      readChannelScope: this.#allowedChannelIds.size > 0 ? "allowlist" : "all-visible",
      readGuildScope: this.#allowedGuildIds.size > 0 ? "allowlist" : "all-visible",
      roleCreationEnabled: this.#allowRoleCreation
        && this.#roleCreationGuildIds.size > 0,
      roleCreationGuildIds: [...this.#roleCreationGuildIds].sort(),
      roleConfigurationEnabled: this.#allowRoleConfiguration
        && this.#roleConfigurationIds.size > 0,
      roleConfigurationIds: [...this.#roleConfigurationIds].sort(),
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
      threadParentIds: [...this.#threadParentIds].sort(),
      welcomeScreenAuditEnabled: this.#allowWelcomeScreenAudit
        && this.#welcomeScreenGuildIds.size > 0,
      welcomeScreenChangesEnabled: this.#allowWelcomeScreenAudit
        && this.#allowWelcomeScreenChanges
        && this.#welcomeScreenGuildIds.size > 0,
      welcomeScreenGuildIds: [...this.#welcomeScreenGuildIds].sort(),
      webhookAuditEnabled: this.#allowWebhookAudit
        && this.#webhookChannelIds.size > 0,
      webhookChannelIds: [...this.#webhookChannelIds].sort(),
      webhookChangesEnabled: this.#allowWebhookAudit
        && this.#allowWebhookChanges
        && this.#webhookChannelIds.size > 0,
      webhookCreationEnabled: this.#allowWebhookAudit
        && this.#allowWebhookCreation
        && this.#webhookChannelIds.size > 0,
      webhookDeletionsEnabled: this.#allowWebhookAudit
        && this.#allowWebhookDeletions
        && this.#webhookChannelIds.size > 0,
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
      channel.parent_id,
    ))
  }

  guildAllowed(guildId: string): boolean {
    return this.#allowedGuildIds.size === 0 || this.#allowedGuildIds.has(guildId)
  }

  assertGuildAllowed(guildId: string): void {
    if (!this.guildAllowed(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the configured read scope`)
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
    if (!this.#nativeInteractionUserIds.has(userId)) {
      throw new PolicyError(
        `Discord user ${userId} is outside the native Interaction scope`,
      )
    }
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
    return this.#allowedChannelIds.size === 0
      || this.#allowedChannelIds.has(channelId)
      || Boolean(parentId && this.#allowedChannelIds.has(parentId))
  }

  constrainSearchChannelIds(
    requestedChannelIds: readonly string[] | undefined,
    maximum: number,
  ): string[] | undefined {
    if (this.#allowedChannelIds.size === 0) {
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
    if (!this.channelIdReadable(channel.id, channel.parent_id)) {
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

  assertNotificationUsers(userIds: readonly string[]): void {
    for (const userId of userIds) {
      if (!this.#mentionUserIds.has(userId)) {
        throw new PolicyError(`Discord user ${userId} is outside the notification scope`)
      }
    }
  }
}
