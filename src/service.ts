import type {
  ActivityList,
  ActivityStore,
} from "./activity-log.js"
import { JsonlActivityLog } from "./activity-log.js"
import {
  ApplicationCommandAuditService,
  type ApplicationCommandAuditResult,
} from "./application-command-audit-service.js"
import {
  BotInstallationAuditService,
  type BotInstallationAuditResult,
} from "./bot-installation-audit-service.js"
import {
  ApplicationActivityInstanceService,
  type ApplicationActivityInstanceInspectionResult,
  type ApplicationActivityInstanceRequest,
} from "./application-activity-instance-service.js"
import {
  ApplicationRoleConnectionMetadataAuditService,
  type ApplicationRoleConnectionMetadataAuditResult,
} from "./application-role-connection-metadata-audit-service.js"
import type {
  ApplicationRoleConnectionMetadataChangeRequest,
  ApplicationRoleConnectionMetadataPlan,
  ApplicationRoleConnectionMetadataResult,
  ApplicationRoleConnectionMetadataServiceOptions,
} from "./application-role-connection-metadata-service.js"
import {
  ApplicationRoleConnectionMetadataService,
  normalizeApplicationRoleConnectionMetadataChangeRequest,
} from "./application-role-connection-metadata-service.js"
import {
  ApplicationSkuAuditService,
  type ApplicationSkuAuditResult,
} from "./application-sku-audit-service.js"
import {
  ApplicationMonetizationAuditService,
  type ApplicationEntitlementAuditResult,
  type ApplicationEntitlementInspectionResult,
  type ApplicationSubscriptionAuditResult,
} from "./application-monetization-audit-service.js"
import type {
  ApplicationEntitlementChangeResult,
  ApplicationEntitlementConsumptionPlan,
  ApplicationEntitlementConsumptionRequest,
  ApplicationEntitlementServiceOptions,
  ApplicationTestEntitlementChangeRequest,
  ApplicationTestEntitlementPlan,
} from "./application-entitlement-service.js"
import {
  ApplicationEntitlementService,
  normalizeApplicationEntitlementConsumptionRequest,
  normalizeApplicationTestEntitlementChangeRequest,
} from "./application-entitlement-service.js"
import type {
  ApplicationEmojiChangeRequest,
  ApplicationEmojiInventoryResult,
  ApplicationEmojiLookupResult,
  ApplicationEmojiPlan,
  ApplicationEmojiResult,
  ApplicationEmojiServiceOptions,
} from "./application-emoji-service.js"
import {
  ApplicationEmojiService,
  normalizeApplicationEmojiChangeRequest,
} from "./application-emoji-service.js"
import type {
  ApplicationIntentEnablementPlan,
  ApplicationIntentEnablementRequest,
  ApplicationIntentEnablementResult,
  ApplicationIntentServiceOptions,
} from "./application-intent-service.js"
import {
  applicationIntentPolicyRequirement,
  ApplicationIntentService,
  normalizeApplicationIntentEnablementRequest,
} from "./application-intent-service.js"
import type {
  BotProfileAuditResult,
  BotProfileChangePlan,
  BotProfileChangeRequest,
  BotProfileChangeResult,
  BotProfileServiceOptions,
} from "./bot-profile-service.js"
import {
  BotProfileService,
  normalizeBotProfileChangeRequest,
} from "./bot-profile-service.js"
import {
  projectApplicationPosture,
  projectApplicationPrivilegedIntents,
  type ApplicationMessageContentRequirement,
  type ApplicationPostureRequirements,
  type ApplicationPostureResult,
} from "./application-posture.js"
import type {
  AnnouncementCrosspostPlan,
  AnnouncementCrosspostRequest,
  AnnouncementCrosspostResult,
  AnnouncementCrosspostServiceOptions,
} from "./announcement-crosspost-service.js"
import { AnnouncementCrosspostService } from "./announcement-crosspost-service.js"
import type {
  MessageForwardPlan,
  MessageForwardRequest,
  MessageForwardResult,
  MessageForwardServiceOptions,
} from "./message-forwarding-service.js"
import {
  MessageForwardingService,
  normalizeMessageForwardRequest,
} from "./message-forwarding-service.js"
import type {
  AnnouncementSubscriptionInventoryResult,
  AnnouncementSubscriptionPlan,
  AnnouncementSubscriptionRequest,
  AnnouncementSubscriptionResult,
  AnnouncementSubscriptionServiceOptions,
} from "./announcement-subscription-service.js"
import {
  AnnouncementSubscriptionService,
  normalizeAnnouncementSubscriptionRequest,
} from "./announcement-subscription-service.js"
import {
  GuildAuditLogService,
  type GetGuildAuditEntryOptions,
  type ListGuildAuditEntriesOptions,
} from "./audit-log-service.js"
import type {
  AttachmentMessagePlan,
  AttachmentMessageRequest,
  AttachmentMessageResult,
  AttachmentMessageServiceOptions,
} from "./attachment-message-service.js"
import { AttachmentMessageService } from "./attachment-message-service.js"
import {
  assertMessageAttachmentReadInput,
  MessageAttachmentReadService,
  type MessageAttachmentReadOptions,
  type MessageAttachmentReadResult,
  type MessageAttachmentReadServiceOptions,
} from "./message-attachment-read-service.js"
import {
  reviewComponentLayout,
  type ComponentLayoutInput,
  type ComponentLayoutReview,
} from "./component-layout.js"
import {
  reviewEmbedPresentation,
  type EmbedLayoutInput,
  type EmbedPresentationReview,
} from "./embed-layout.js"
import type {
  ComponentMessagePlan,
  ComponentMessageRequest,
  ComponentMessageResult,
  ComponentMessageServiceOptions,
  ComponentMessageVerificationResult,
} from "./component-message-service.js"
import {
  componentMessageVerificationKey,
  ComponentMessageService,
} from "./component-message-service.js"
import {
  CommunityActivityService,
  type CommunityActivityRequest,
} from "./community-activity-service.js"
import type {
  EmbedMessagePlan,
  EmbedMessageRequest,
  EmbedMessageResult,
  EmbedMessageServiceOptions,
  EmbedMessageVerificationResult,
} from "./embed-message-service.js"
import {
  embedMessageVerificationKey,
  EmbedMessageService,
} from "./embed-message-service.js"
import type {
  AutoModerationChangeRequest,
  AutoModerationInventoryResult,
  AutoModerationLookupResult,
  AutoModerationPlan,
  AutoModerationResult,
  AutoModerationServiceOptions,
  AutoModerationVerificationResult,
} from "./automod-service.js"
import {
  autoModerationVerificationKey,
  AutoModerationService,
} from "./automod-service.js"
import type {
  BanAuditGetOptions,
  BanAuditListOptions,
} from "./ban-audit-service.js"
import {
  assertBanAuditGetInput,
  assertBanAuditListInput,
  BanAuditService,
} from "./ban-audit-service.js"
import type {
  AdministrationServiceOptions,
  MemberModerationPlan,
  MemberModerationRequest,
  MemberModerationResult,
} from "./administration-service.js"
import {
  AdministrationService,
  normalizeMemberModerationRequest,
} from "./administration-service.js"
import type {
  BulkGuildBanPlan,
  BulkGuildBanRequest,
  BulkGuildBanResult,
  BulkGuildBanServiceOptions,
} from "./bulk-guild-ban-service.js"
import {
  BulkGuildBanService,
  normalizeBulkGuildBanRequest,
} from "./bulk-guild-ban-service.js"
import type {
  BulkMemberRolePlan,
  BulkMemberRoleRequest,
  BulkMemberRoleResult,
  BulkMemberRoleServiceOptions,
} from "./bulk-member-role-service.js"
import {
  BulkMemberRoleService,
  normalizeBulkMemberRoleRequest,
} from "./bulk-member-role-service.js"
import type {
  GuildPrunePlan,
  GuildPruneRequest,
  GuildPruneResult,
  GuildPruneServiceOptions,
} from "./guild-prune-service.js"
import {
  GuildPruneService,
  normalizeGuildPruneRequest,
} from "./guild-prune-service.js"
import {
  GuildWebhookAuditService,
  type GuildWebhookAuditResult,
} from "./guild-webhook-audit-service.js"
import type {
  ChannelAdministrationServiceOptions,
  ChannelCreationPlan,
  ChannelCreationRequest,
  ChannelCreationResult,
} from "./channel-administration-service.js"
import { ChannelAdministrationService } from "./channel-administration-service.js"
import type {
  ChannelClonePlan,
  ChannelCloneRequest,
  ChannelCloneResult,
  ChannelCloneServiceOptions,
} from "./channel-clone-service.js"
import {
  ChannelCloneService,
  normalizeChannelCloneRequest,
} from "./channel-clone-service.js"
import type {
  ChannelDeletionPlan,
  ChannelDeletionReadiness,
  ChannelDeletionRequest,
  ChannelDeletionResult,
  ChannelDeletionServiceOptions,
} from "./channel-deletion-service.js"
import {
  ChannelDeletionService,
  normalizeChannelDeletionRequest,
} from "./channel-deletion-service.js"
import type {
  ChannelMetadataChangePlan,
  ChannelMetadataChangeRequest,
  ChannelMetadataChangeResult,
  ChannelMetadataReadResult,
  ChannelMetadataServiceOptions,
} from "./channel-metadata-service.js"
import {
  assertChannelMetadataChannelId,
  ChannelMetadataService,
  normalizeChannelMetadataChangeRequest,
} from "./channel-metadata-service.js"
import type {
  ChannelOrderAuditResult,
  ChannelOrderingPlan,
  ChannelOrderingRequest,
  ChannelOrderingResult,
  ChannelOrderingServiceOptions,
} from "./channel-ordering-service.js"
import {
  ChannelOrderingService,
  normalizeChannelOrderingRequest,
} from "./channel-ordering-service.js"
import type {
  ChannelPermissionOverwriteListOptions,
  ChannelPermissionOverwriteListResult,
  ChannelPermissionOverwritePlan,
  ChannelPermissionOverwriteRequest,
  ChannelPermissionOverwriteResult,
  ChannelPermissionOverwriteServiceOptions,
  ChannelPermissionSyncPlan,
  ChannelPermissionSyncRequest,
  ChannelPermissionSyncResult,
} from "./channel-permission-overwrite-service.js"
import {
  ChannelPermissionOverwriteService,
  normalizeChannelPermissionSyncRequest,
} from "./channel-permission-overwrite-service.js"
import type { ConnectorConfig } from "./config.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DeletionPlan,
  DeletionRequest,
  DeletionResult,
  DeletionServiceOptions,
} from "./deletion-service.js"
import {
  DeletionService,
  normalizeDeletionRequest,
} from "./deletion-service.js"
import type {
  DirectMessageChangeRequest,
  DirectMessageChangeResult,
  DirectMessagePage,
  DirectMessagePlan,
  DirectMessageServiceClient,
  DirectMessageServiceOptions,
  DirectMessageVerificationResult,
  DirectMessageView,
} from "./direct-message-service.js"
import {
  directMessageVerificationKey,
  DirectMessageService,
} from "./direct-message-service.js"
import type {
  ApplicationEntitlementBeneficiary,
  ApplicationEntitlementPageOptions,
  ApplicationSubscriptionPageOptions,
  DiscordClientOptions,
  GuildPageOptions,
  GuildMessageSearchOptions,
  MessagePinPageOptions,
  MessagePageOptions,
  PollVoterPageOptions,
  ReactionUserPageOptions,
  ScheduledEventUserPageOptions,
} from "./discord-client.js"
import { DiscordClient } from "./discord-client.js"
import {
  AnnouncementSubscriptionPlanChangedError,
  BulkMemberRolePlanChangedError,
  ChannelClonePlanChangedError,
  ChannelDeletionPlanChangedError,
  ChannelOrderingPlanChangedError,
  ChannelPermissionSyncPlanChangedError,
  ConfigurationError,
  ComponentMessagePlanChangedError,
  EmbedMessagePlanChangedError,
  DeletionPlanChangedError,
  GlobalApplicationCommandPlanChangedError,
  GuildApplicationCommandPlanChangedError,
  GuildDeparturePlanChangedError,
  GuildPrunePlanChangedError,
  GuildScaffoldPlanChangedError,
  IntegrationDeletionPlanChangedError,
  ReactionModerationPlanChangedError,
  RoleDeletionPlanChangedError,
  RoleOrderingPlanChangedError,
  WebhookChangePlanChangedError,
  WebhookCreationPlanChangedError,
  WebhookDeletionPlanChangedError,
  VoiceChannelStatusPlanChangedError,
} from "./errors.js"
import {
  GatewayChannelLayoutStore,
  type GatewayChannelLayoutSource,
} from "./gateway-channel-layout.js"
import {
  DisabledGatewayVoiceChannelStatusSource,
  type GatewayVoiceChannelStatusSource,
} from "./gateway-voice-channel-status.js"
import {
  DisabledGatewaySoundboardEffectSource,
  type GatewaySoundboardEffectSource,
} from "./gateway-soundboard-effect.js"
import type {
  ForumPostPlan,
  ForumPostRequest,
  ForumPostResult,
  ForumPostServiceOptions,
} from "./forum-post-service.js"
import { ForumPostService } from "./forum-post-service.js"
import type {
  ForumTagAuditResult,
  ForumTagChangePlan,
  ForumTagChangeRequest,
  ForumTagChangeResult,
  ForumTagServiceOptions,
} from "./forum-tag-service.js"
import {
  assertForumTagChannelId,
  ForumTagService,
  normalizeForumTagChangeRequest,
} from "./forum-tag-service.js"
import type {
  GuildExpressionChangeRequest,
  GuildExpressionInventoryResult,
  GuildExpressionKind,
  GuildExpressionLookupResult,
  GuildExpressionPlan,
  GuildExpressionResult,
  GuildExpressionServiceOptions,
} from "./guild-expression-service.js"
import { GuildExpressionService } from "./guild-expression-service.js"
import type {
  GuildBlueprintCaptureRequest,
  GuildBlueprintCaptureResult,
  GuildBlueprintCaptureServiceOptions,
} from "./guild-blueprint-capture-service.js"
import { GuildBlueprintCaptureService } from "./guild-blueprint-capture-service.js"
import { createGuildRecoveryAttestationKey } from "./guild-recovery-attestation.js"
import type {
  GuildBlueprintPlan,
  GuildBlueprintRequest,
  GuildBlueprintResult,
  GuildBlueprintServiceOptions,
  GuildBlueprintVerification,
} from "./guild-blueprint-service.js"
import { GuildBlueprintService } from "./guild-blueprint-service.js"
import type {
  GuildScaffoldPlan,
  GuildScaffoldRequest,
  GuildScaffoldResult,
  GuildScaffoldServiceOptions,
  GuildScaffoldVerification,
} from "./guild-scaffold-service.js"
import {
  GuildScaffoldService,
  normalizeGuildScaffoldRequest,
} from "./guild-scaffold-service.js"
import type {
  GuildDeparturePlan,
  GuildDepartureRequest,
  GuildDepartureResult,
  GuildDepartureServiceOptions,
} from "./guild-departure-service.js"
import {
  GuildDepartureService,
  normalizeGuildDepartureRequest,
} from "./guild-departure-service.js"
import type {
  GuildTemplateChangePlan,
  GuildTemplateChangeRequest,
  GuildTemplateChangeResult,
  GuildTemplateInventoryResult,
  GuildTemplateServiceOptions,
} from "./guild-template-service.js"
import {
  assertGuildTemplateListInput,
  GuildTemplateService,
  normalizeGuildTemplateChangeRequest,
} from "./guild-template-service.js"
import type {
  IntegrationDeletionPlan,
  IntegrationDeletionRequest,
  IntegrationDeletionResult,
  IntegrationInventoryResult,
  IntegrationServiceOptions,
} from "./integration-service.js"
import {
  IntegrationService,
  normalizeIntegrationDeletionRequest,
} from "./integration-service.js"
import type {
  AddReactionRequest,
  EditOwnMessageRequest,
  InteractionServiceOptions,
  RemoveOwnReactionRequest,
  RemoveOwnReactionResult,
  SendMessageRequest,
  SignalCommandProcessingRequest,
  SignalCommandProcessingResult,
} from "./interaction-service.js"
import { InteractionService } from "./interaction-service.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import type {
  MessageReactionInventoryResult,
  ReactionModerationPlan,
  ReactionModerationRequest,
  ReactionModerationResult,
  ReactionServiceOptions,
  ReactionUserPageResult,
} from "./reaction-service.js"
import {
  normalizeReactionModerationRequest,
  ReactionService,
} from "./reaction-service.js"
import type {
  InviteCreationPlan,
  InviteCreationRequest,
  InviteCreationResult,
  InviteDeletionPlan,
  InviteDeletionRequest,
  InviteDeletionResult,
  GuildVanityUrlAuditResult,
  GuildVanityUrlOptions,
  InviteInventoryResult,
  InviteListOptions,
  InviteLookupResult,
  InviteServiceOptions,
} from "./invite-service.js"
import {
  assertGuildVanityUrlInput,
  assertInviteGetInput,
  assertInviteListInput,
  InviteService,
  normalizeInviteCreationRequest,
  normalizeInviteDeletionRequest,
} from "./invite-service.js"
import type {
  OnboardingAuditResult,
  OnboardingChangePlan,
  OnboardingChangeRequest,
  OnboardingChangeResult,
  OnboardingServiceOptions,
} from "./onboarding-service.js"
import {
  assertOnboardingGetInput,
  normalizeOnboardingChangeRequest,
  OnboardingService,
} from "./onboarding-service.js"
import type {
  MessagePinListResult,
  MessagePinPlan,
  MessagePinRequest,
  MessagePinResult,
  MessagePinServiceOptions,
} from "./message-pin-service.js"
import { MessagePinService } from "./message-pin-service.js"
import type {
  NativeInteractionCommandPlan,
  NativeInteractionCommandRequest,
  NativeInteractionCommandResult,
  NativeInteractionCommandServiceOptions,
} from "./native-interaction-command-service.js"
import { NativeInteractionCommandService } from "./native-interaction-command-service.js"
import type {
  GuildApplicationCommandChangeRequest,
  GuildApplicationCommandPlan,
  GuildApplicationCommandResult,
  GuildApplicationCommandServiceOptions,
} from "./guild-application-command-service.js"
import {
  GuildApplicationCommandService,
  normalizeGuildApplicationCommandChangeRequest,
} from "./guild-application-command-service.js"
import type {
  GlobalApplicationCommandChangeRequest,
  GlobalApplicationCommandPlan,
  GlobalApplicationCommandResult,
  GlobalApplicationCommandServiceOptions,
} from "./global-application-command-service.js"
import {
  GlobalApplicationCommandService,
  normalizeGlobalApplicationCommandChangeRequest,
} from "./global-application-command-service.js"
import type {
  MemberDirectoryListOptions,
  MemberDirectorySearchOptions,
} from "./member-directory-service.js"
import { MemberDirectoryService } from "./member-directory-service.js"
import type {
  MemberNicknameChangePlan,
  MemberNicknameChangeRequest,
  MemberNicknameChangeResult,
  MemberNicknameServiceOptions,
} from "./member-nickname-service.js"
import {
  MemberNicknameService,
  normalizeMemberNicknameChangeRequest,
} from "./member-nickname-service.js"
import type {
  MemberRoleChangePlan,
  MemberRoleChangeRequest,
  MemberRoleChangeResult,
  MemberRoleServiceOptions,
} from "./member-role-service.js"
import { MemberRoleService } from "./member-role-service.js"
import type {
  MemberVerificationChangePlan,
  MemberVerificationChangeRequest,
  MemberVerificationChangeResult,
  MemberVerificationServiceOptions,
} from "./member-verification-service.js"
import {
  MemberVerificationService,
  normalizeMemberVerificationChangeRequest,
} from "./member-verification-service.js"
import type {
  MemberVoiceAuditResult,
  MemberVoiceChangePlan,
  MemberVoiceChangeRequest,
  MemberVoiceChangeResult,
  MemberVoiceServiceOptions,
} from "./member-voice-service.js"
import {
  assertMemberVoiceGetInput,
  MemberVoiceService,
  normalizeMemberVoiceChangeRequest,
} from "./member-voice-service.js"
import {
  normalizeChannel,
  normalizeGuild,
  normalizeMessage,
} from "./normalize.js"
import type { ConversationRecallRequest } from "./message-search-service.js"
import { MessageSearchService } from "./message-search-service.js"
import { evaluateBotChannelPermissions } from "./permissions.js"
import type {
  AuditChannelRoleAccessRequest,
  ExplainPrincipalPermissionsRequest,
  PermissionServiceOptions,
} from "./permission-service.js"
import { PermissionService } from "./permission-service.js"
import { ScopePolicy } from "./policy.js"
import type {
  PollCreationPlan,
  PollCreationRequest,
  PollCreationResult,
  PollEndPlan,
  PollEndRequest,
  PollEndResult,
  PollServiceOptions,
  PollVoterListResult,
} from "./poll-service.js"
import {
  normalizePollCreationRequest,
  normalizePollEndRequest,
  PollService,
} from "./poll-service.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"
import type {
  RoleAdministrationServiceOptions,
  RoleCreationPlan,
  RoleCreationRequest,
  RoleCreationResult,
} from "./role-administration-service.js"
import {
  normalizeDiscordRole,
  normalizeDiscordRoleInventory,
  RoleAdministrationService,
} from "./role-administration-service.js"
import type {
  RoleConfigurationPlan,
  RoleConfigurationRequest,
  RoleConfigurationResult,
  RoleConfigurationServiceOptions,
} from "./role-configuration-service.js"
import {
  normalizeRoleConfigurationRequest,
  RoleConfigurationService,
} from "./role-configuration-service.js"
import type {
  RoleDeletionPlan,
  RoleDeletionReadiness,
  RoleDeletionRequest,
  RoleDeletionResult,
  RoleDeletionServiceOptions,
} from "./role-deletion-service.js"
import {
  normalizeRoleDeletionRequest,
  RoleDeletionService,
} from "./role-deletion-service.js"
import type {
  RoleOrderAuditResult,
  RoleOrderingPlan,
  RoleOrderingRequest,
  RoleOrderingResult,
  RoleOrderingServiceOptions,
} from "./role-ordering-service.js"
import {
  normalizeRoleOrderingRequest,
  RoleOrderingService,
} from "./role-ordering-service.js"
import type {
  ScheduledEventChangeRequest,
  ScheduledEventInventoryResult,
  ScheduledEventLookupResult,
  ScheduledEventPlan,
  ScheduledEventResult,
  ScheduledEventServiceOptions,
  ScheduledEventUserPageResult,
} from "./scheduled-event-service.js"
import { ScheduledEventService } from "./scheduled-event-service.js"
import type {
  DefaultSoundboardInventoryResult,
  GuildSoundboardInventoryResult,
  GuildSoundboardLookupResult,
  SoundboardChangeRequest,
  SoundboardPlan,
  SoundboardResult,
  SoundboardServiceOptions,
} from "./soundboard-service.js"
import {
  normalizeSoundboardChangeRequest,
  SoundboardService,
} from "./soundboard-service.js"
import type {
  SoundboardPlaybackCheckRequest,
  SoundboardPlaybackReadiness,
  SoundboardPlaybackRequest,
  SoundboardPlaybackResult,
  SoundboardPlaybackServiceOptions,
} from "./soundboard-playback-service.js"
import {
  SoundboardPlaybackService,
  soundboardPlaybackIntentKey,
} from "./soundboard-playback-service.js"
import type {
  StageInstanceChangeRequest,
  StageInstanceInventoryResult,
  StageInstanceLookupResult,
  StageInstancePlan,
  StageInstanceResult,
  StageInstanceServiceOptions,
} from "./stage-instance-service.js"
import {
  normalizeStageInstanceChangeRequest,
  StageInstanceService,
} from "./stage-instance-service.js"
import type {
  VoiceChannelStatusChangeRequest,
  VoiceChannelStatusPlan,
  VoiceChannelStatusReadResult,
  VoiceChannelStatusResult,
  VoiceChannelStatusServiceOptions,
} from "./voice-channel-status-service.js"
import {
  normalizeVoiceChannelStatusChangeRequest,
  VoiceChannelStatusService,
} from "./voice-channel-status-service.js"
import type {
  WelcomeScreenAuditResult,
  WelcomeScreenChangePlan,
  WelcomeScreenChangeRequest,
  WelcomeScreenChangeResult,
  WelcomeScreenServiceOptions,
} from "./welcome-screen-service.js"
import {
  assertWelcomeScreenGetInput,
  normalizeWelcomeScreenChangeRequest,
  WelcomeScreenService,
} from "./welcome-screen-service.js"
import type {
  WidgetSettingsAuditResult,
  WidgetSettingsChangePlan,
  WidgetSettingsChangeRequest,
  WidgetSettingsChangeResult,
  WidgetSettingsServiceOptions,
} from "./widget-settings-service.js"
import {
  assertWidgetSettingsGetInput,
  normalizeWidgetSettingsChangeRequest,
  WidgetSettingsService,
} from "./widget-settings-service.js"
import type {
  GuildSettingsAuditResult,
  GuildSettingsChangePlan,
  GuildSettingsChangeRequest,
  GuildSettingsChangeResult,
  GuildSettingsServiceOptions,
} from "./guild-settings-service.js"
import {
  assertGuildSettingsGetInput,
  GuildSettingsService,
  normalizeGuildSettingsChangeRequest,
} from "./guild-settings-service.js"
import type {
  GuildCommunityAuditResult,
  GuildCommunityChangePlan,
  GuildCommunityChangeRequest,
  GuildCommunityChangeResult,
  GuildCommunityServiceOptions,
} from "./guild-community-service.js"
import {
  assertGuildCommunityAuditInput,
  GuildCommunityService,
  normalizeGuildCommunityChangeRequest,
} from "./guild-community-service.js"
import type {
  GuildProfileAuditResult,
  GuildProfileChangePlan,
  GuildProfileChangeRequest,
  GuildProfileChangeResult,
  GuildProfileServiceOptions,
} from "./guild-profile-service.js"
import {
  assertGuildProfileGetInput,
  GuildProfileService,
  normalizeGuildProfileChangeRequest,
} from "./guild-profile-service.js"
import type {
  GuildIncidentActionChangePlan,
  GuildIncidentActionChangeRequest,
  GuildIncidentActionChangeResult,
  GuildIncidentAuditResult,
  GuildIncidentServiceOptions,
} from "./guild-incident-service.js"
import {
  assertGuildIncidentGetInput,
  GuildIncidentService,
  normalizeGuildIncidentActionChangeRequest,
} from "./guild-incident-service.js"
import type {
  ThreadCreationPlan,
  ThreadCreationRequest,
  ThreadCreationResult,
  ThreadCreationServiceOptions,
} from "./thread-creation-service.js"
import {
  normalizeThreadCreationRequest,
  ThreadCreationService,
} from "./thread-creation-service.js"
import type {
  ThreadChangePlan,
  ThreadChangeRequest,
  ThreadChangeResult,
  ThreadGovernanceServiceOptions,
  ThreadMembershipAuditResult,
  ThreadStateAuditResult,
} from "./thread-governance-service.js"
import {
  assertThreadAuditInput,
  assertThreadMembershipInput,
  normalizeThreadChangeRequest,
  ThreadGovernanceService,
} from "./thread-governance-service.js"
import type {
  WebhookChangePlan,
  WebhookChangeRequest,
  WebhookChangeResult,
  WebhookCreationPlan,
  WebhookCreationRequest,
  WebhookCreationResult,
  WebhookDeletionPlan,
  WebhookDeletionRequest,
  WebhookDeletionResult,
  WebhookInventoryResult,
  WebhookLookupResult,
  WebhookServiceOptions,
} from "./webhook-service.js"
import {
  normalizeWebhookChangeRequest,
  normalizeWebhookCreationRequest,
  normalizeWebhookDeletionRequest,
  WebhookService,
} from "./webhook-service.js"
import { WebhookCredentialStore } from "./webhook-credential-store.js"
import type {
  WebhookMessageDeletionPlan,
  WebhookMessageDeletionRequest,
  WebhookMessageDeletionResult,
  WebhookMessageEditRequest,
  WebhookMessageLookupRequest,
  WebhookMessageLookupResult,
  WebhookMessageSendRequest,
  WebhookMessageServiceOptions,
  WebhookMessageWriteResult,
} from "./webhook-message-service.js"
import {
  webhookMessageIntentKey,
  WebhookMessageService,
} from "./webhook-message-service.js"
import {
  FileOperationStore,
  operationKeyHash,
  operationReceiptDirectory,
  type OperationKind,
  type OperationStore,
} from "./operation-store.js"
import {
  FileWriteCoordinator,
  writeApplicationCollectionTarget,
  writeCoordinationDirectory,
  writeGuildDepartureTargets,
  writeGuildCollectionTarget,
  writeResourceTarget,
  type WriteCoordinationRunOptions,
  type WriteCoordinationTarget,
  type WriteCoordinator,
} from "./write-coordination.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordMessage,
  DiscordThreadList,
  DiscordUser,
  RequestOptions,
} from "./types.js"
import {
  VoiceRegionService,
  type VoiceRegionInventoryResult,
} from "./voice-region-service.js"

export interface DiscordServiceClient {
  addThreadMember: DiscordClient["addThreadMember"]
  addGuildMemberRole: DiscordClient["addGuildMemberRole"]
  addOwnReaction: DiscordClient["addOwnReaction"]
  bulkDeleteMessages: DiscordClient["bulkDeleteMessages"]
  bulkGuildBan: DiscordClient["bulkGuildBan"]
  beginGuildPrune: DiscordClient["beginGuildPrune"]
  consumeApplicationEntitlement: DiscordClient["consumeApplicationEntitlement"]
  createApplicationEmoji: DiscordClient["createApplicationEmoji"]
  createApplicationTestEntitlement: DiscordClient["createApplicationTestEntitlement"]
  crosspostMessage: DiscordClient["crosspostMessage"]
  createGuildBan: DiscordClient["createGuildBan"]
  createGuildAutoModerationRule: DiscordClient["createGuildAutoModerationRule"]
  createGuildChannel: DiscordClient["createGuildChannel"]
  createChannelInvite: DiscordClient["createChannelInvite"]
  createGuildApplicationCommand: DiscordClient["createGuildApplicationCommand"]
  editGuildApplicationCommand: DiscordClient["editGuildApplicationCommand"]
  deleteGuildApplicationCommand: DiscordClient["deleteGuildApplicationCommand"]
  createGlobalApplicationCommand: DiscordClient["createGlobalApplicationCommand"]
  editGlobalApplicationCommand: DiscordClient["editGlobalApplicationCommand"]
  deleteGlobalApplicationCommand: DiscordClient["deleteGlobalApplicationCommand"]
  deleteApplicationEmoji: DiscordClient["deleteApplicationEmoji"]
  deleteApplicationTestEntitlement: DiscordClient["deleteApplicationTestEntitlement"]
  createGuildEmoji: DiscordClient["createGuildEmoji"]
  createGuildRole: DiscordClient["createGuildRole"]
  createGuildScheduledEvent: DiscordClient["createGuildScheduledEvent"]
  createGuildSoundboardSound: DiscordClient["createGuildSoundboardSound"]
  sendSoundboardSound: DiscordClient["sendSoundboardSound"]
  createGuildSticker: DiscordClient["createGuildSticker"]
  createGuildTemplate: DiscordClient["createGuildTemplate"]
  createStageInstance: DiscordClient["createStageInstance"]
  createForumPost: DiscordClient["createForumPost"]
  createAttachmentMessage: DiscordClient["createAttachmentMessage"]
  createComponentMessage: DiscordClient["createComponentMessage"]
  createEmbedMessage: DiscordClient["createEmbedMessage"]
  createMessage: DiscordClient["createMessage"]
  createMessageForward: DiscordClient["createMessageForward"]
  createDirectAttachmentMessage?: DiscordClient["createDirectAttachmentMessage"]
  createDirectComponentMessage?: DiscordClient["createDirectComponentMessage"]
  createDirectMessage?: DiscordClient["createDirectMessage"]
  createDirectMessageChannel?: DiscordClient["createDirectMessageChannel"]
  createPoll: DiscordClient["createPoll"]
  createThreadFromMessage: DiscordClient["createThreadFromMessage"]
  createThreadWithoutMessage: DiscordClient["createThreadWithoutMessage"]
  createWebhook: DiscordClient["createWebhook"]
  followAnnouncementChannel: DiscordClient["followAnnouncementChannel"]
  triggerTypingIndicator: DiscordClient["triggerTypingIndicator"]
  deleteAllMessageReactions: DiscordClient["deleteAllMessageReactions"]
  deleteAllMessageReactionsForEmoji: DiscordClient["deleteAllMessageReactionsForEmoji"]
  deleteChannelPermissionOverwrite: DiscordClient["deleteChannelPermissionOverwrite"]
  deleteGuildChannel: DiscordClient["deleteGuildChannel"]
  deleteGuildRole: DiscordClient["deleteGuildRole"]
  deleteGuildAutoModerationRule: DiscordClient["deleteGuildAutoModerationRule"]
  deleteMessage: DiscordClient["deleteMessage"]
  deleteDirectMessage?: DiscordClient["deleteDirectMessage"]
  deleteGuildEmoji: DiscordClient["deleteGuildEmoji"]
  deleteGuildScheduledEvent: DiscordClient["deleteGuildScheduledEvent"]
  deleteGuildSoundboardSound: DiscordClient["deleteGuildSoundboardSound"]
  deleteGuildSticker: DiscordClient["deleteGuildSticker"]
  deleteGuildTemplate: DiscordClient["deleteGuildTemplate"]
  deleteGuildIntegration: DiscordClient["deleteGuildIntegration"]
  deleteStageInstance: DiscordClient["deleteStageInstance"]
  deleteInvite: DiscordClient["deleteInvite"]
  deleteOwnReaction: DiscordClient["deleteOwnReaction"]
  deleteUserReaction: DiscordClient["deleteUserReaction"]
  deleteWebhook: DiscordClient["deleteWebhook"]
  deleteWebhookMessage: DiscordClient["deleteWebhookMessage"]
  endPoll: DiscordClient["endPoll"]
  editChannelPermissionOverwrite: DiscordClient["editChannelPermissionOverwrite"]
  replaceChannelPermissionOverwrites?: DiscordClient["replaceChannelPermissionOverwrites"]
  editComponentMessage: DiscordClient["editComponentMessage"]
  editEmbedMessage: DiscordClient["editEmbedMessage"]
  editMessage: DiscordClient["editMessage"]
  editDirectComponentMessage?: DiscordClient["editDirectComponentMessage"]
  editDirectMessage?: DiscordClient["editDirectMessage"]
  executeWebhookMessage: DiscordClient["executeWebhookMessage"]
  getChannel: DiscordClient["getChannel"]
  getApplicationEmoji: DiscordClient["getApplicationEmoji"]
  getApplicationActivityInstance?: DiscordClient["getApplicationActivityInstance"]
  getApplicationEntitlement: DiscordClient["getApplicationEntitlement"]
  getGuildForumTags: DiscordClient["getGuildForumTags"]
  getGuildChannelMetadata: DiscordClient["getGuildChannelMetadata"]
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  getCurrentBotProfile: DiscordClient["getCurrentBotProfile"]
  getCurrentUserVoiceState: DiscordClient["getCurrentUserVoiceState"]
  getCurrentUser: DiscordClient["getCurrentUser"]
  getGuild: DiscordClient["getGuild"]
  getGuildVanityUrl: DiscordClient["getGuildVanityUrl"]
  getGuildIncidentActions: DiscordClient["getGuildIncidentActions"]
  getGuildProfile: DiscordClient["getGuildProfile"]
  getGuildPruneCount: DiscordClient["getGuildPruneCount"]
  getGuildAutoModerationRule: DiscordClient["getGuildAutoModerationRule"]
  getGuildAuditLog: DiscordClient["getGuildAuditLog"]
  getGuildBan: DiscordClient["getGuildBan"]
  getGuildChannels: DiscordClient["getGuildChannels"]
  getGuildMember: DiscordClient["getGuildMember"]
  getGuildVoiceState: DiscordClient["getGuildVoiceState"]
  getGuildOnboarding: DiscordClient["getGuildOnboarding"]
  getGuildWelcomeScreen: DiscordClient["getGuildWelcomeScreen"]
  getGuildWidgetSettings: DiscordClient["getGuildWidgetSettings"]
  getInvite: DiscordClient["getInvite"]
  getInviteTargetUserIds: DiscordClient["getInviteTargetUserIds"]
  getInviteTargetUsersJobStatus: DiscordClient["getInviteTargetUsersJobStatus"]
  getGuildEmoji: DiscordClient["getGuildEmoji"]
  getGuildRole: DiscordClient["getGuildRole"]
  getGuildRoleMemberCounts: DiscordClient["getGuildRoleMemberCounts"]
  getGuildRoles: DiscordClient["getGuildRoles"]
  getGuildScheduledEvent: DiscordClient["getGuildScheduledEvent"]
  getGuildSoundboardSound: DiscordClient["getGuildSoundboardSound"]
  getGuildSticker: DiscordClient["getGuildSticker"]
  getStageInstance: DiscordClient["getStageInstance"]
  getMessage: DiscordClient["getMessage"]
  getDirectMessage?: DiscordClient["getDirectMessage"]
  getDirectMessageChannel?: DiscordClient["getDirectMessageChannel"]
  getDirectMessageUser?: DiscordClient["getDirectMessageUser"]
  getWebhookMessage: DiscordClient["getWebhookMessage"]
  getWebhookWithToken: DiscordClient["getWebhookWithToken"]
  getThreadMember: DiscordClient["getThreadMember"]
  getThreadState: DiscordClient["getThreadState"]
  getUser: DiscordClient["getUser"]
  joinThread: DiscordClient["joinThread"]
  listActiveGuildThreads: DiscordClient["listActiveGuildThreads"]
  listApplicationEmojis: DiscordClient["listApplicationEmojis"]
  listApplicationRoleConnectionMetadata: DiscordClient["listApplicationRoleConnectionMetadata"]
  replaceApplicationRoleConnectionMetadata: DiscordClient["replaceApplicationRoleConnectionMetadata"]
  listApplicationSkus: DiscordClient["listApplicationSkus"]
  listApplicationEntitlements: DiscordClient["listApplicationEntitlements"]
  listApplicationSubscriptions: DiscordClient["listApplicationSubscriptions"]
  listCurrentUserGuilds: DiscordClient["listCurrentUserGuilds"]
  listCurrentUserGuildMemberships: DiscordClient["listCurrentUserGuildMemberships"]
  listGuildAutoModerationRules: DiscordClient["listGuildAutoModerationRules"]
  listGuildApplicationCommands: DiscordClient["listGuildApplicationCommands"]
  listGuildApplicationCommandsWithLocalizations: DiscordClient["listGuildApplicationCommandsWithLocalizations"]
  listGuildApplicationCommandPermissions: DiscordClient["listGuildApplicationCommandPermissions"]
  listGlobalApplicationCommands: DiscordClient["listGlobalApplicationCommands"]
  listGlobalApplicationCommandsWithLocalizations: DiscordClient["listGlobalApplicationCommandsWithLocalizations"]
  listGuildBans: DiscordClient["listGuildBans"]
  listGuildInvites: DiscordClient["listGuildInvites"]
  listGuildIntegrations: DiscordClient["listGuildIntegrations"]
  listGuildWebhooks: DiscordClient["listGuildWebhooks"]
  listJoinedPrivateArchivedThreads: DiscordClient["listJoinedPrivateArchivedThreads"]
  listGuildMembers: DiscordClient["listGuildMembers"]
  listGuildScheduledEvents: DiscordClient["listGuildScheduledEvents"]
  listGuildScheduledEventUsers: DiscordClient["listGuildScheduledEventUsers"]
  listGuildVoiceRegions: DiscordClient["listGuildVoiceRegions"]
  listGuildSoundboardSounds: DiscordClient["listGuildSoundboardSounds"]
  listGuildEmojis: DiscordClient["listGuildEmojis"]
  listGuildStickers: DiscordClient["listGuildStickers"]
  listGuildTemplates: DiscordClient["listGuildTemplates"]
  listMessagePins: DiscordClient["listMessagePins"]
  listPollAnswerVoters: DiscordClient["listPollAnswerVoters"]
  listReactionUsers: DiscordClient["listReactionUsers"]
  listChannelWebhooks: DiscordClient["listChannelWebhooks"]
  listMessages: DiscordClient["listMessages"]
  listDirectMessages?: DiscordClient["listDirectMessages"]
  listDefaultSoundboardSounds: DiscordClient["listDefaultSoundboardSounds"]
  listPrivateArchivedThreads: DiscordClient["listPrivateArchivedThreads"]
  listPublicArchivedThreads: DiscordClient["listPublicArchivedThreads"]
  listVoiceRegions: DiscordClient["listVoiceRegions"]
  leaveGuild: DiscordClient["leaveGuild"]
  leaveThread: DiscordClient["leaveThread"]
  modifyGuildMemberTimeout: DiscordClient["modifyGuildMemberTimeout"]
  modifyApplicationEmoji: DiscordClient["modifyApplicationEmoji"]
  modifyCurrentApplicationFlags: DiscordClient["modifyCurrentApplicationFlags"]
  modifyCurrentBotProfile: DiscordClient["modifyCurrentBotProfile"]
  modifyCurrentMemberNickname: DiscordClient["modifyCurrentMemberNickname"]
  modifyGuildMemberNickname: DiscordClient["modifyGuildMemberNickname"]
  modifyGuildMemberVerificationBypass: DiscordClient["modifyGuildMemberVerificationBypass"]
  modifyGuildMemberVoice: DiscordClient["modifyGuildMemberVoice"]
  modifyThreadState: DiscordClient["modifyThreadState"]
  modifyWebhook: DiscordClient["modifyWebhook"]
  modifyWebhookMessage: DiscordClient["modifyWebhookMessage"]
  modifyGuildForumTags: DiscordClient["modifyGuildForumTags"]
  modifyGuildChannelMetadata: DiscordClient["modifyGuildChannelMetadata"]
  modifyGuildOnboarding: DiscordClient["modifyGuildOnboarding"]
  modifyGuildWelcomeScreen: DiscordClient["modifyGuildWelcomeScreen"]
  modifyGuildWidgetSettings: DiscordClient["modifyGuildWidgetSettings"]
  modifyGuildCommunity: DiscordClient["modifyGuildCommunity"]
  modifyGuildSettings: DiscordClient["modifyGuildSettings"]
  modifyGuildIncidentActions: DiscordClient["modifyGuildIncidentActions"]
  modifyGuildProfile: DiscordClient["modifyGuildProfile"]
  modifyGuildAutoModerationRule: DiscordClient["modifyGuildAutoModerationRule"]
  modifyGuildEmoji: DiscordClient["modifyGuildEmoji"]
  modifyGuildScheduledEvent: DiscordClient["modifyGuildScheduledEvent"]
  modifyGuildSoundboardSound: DiscordClient["modifyGuildSoundboardSound"]
  modifyGuildRole: DiscordClient["modifyGuildRole"]
  modifyGuildChannelPositions: DiscordClient["modifyGuildChannelPositions"]
  modifyGuildRolePositions: DiscordClient["modifyGuildRolePositions"]
  modifyGuildTemplate: DiscordClient["modifyGuildTemplate"]
  modifyGuildSticker: DiscordClient["modifyGuildSticker"]
  modifyStageInstance: DiscordClient["modifyStageInstance"]
  pinMessage: DiscordClient["pinMessage"]
  removeGuildBan: DiscordClient["removeGuildBan"]
  removeGuildMember: DiscordClient["removeGuildMember"]
  removeGuildMemberRole: DiscordClient["removeGuildMemberRole"]
  removeThreadMember: DiscordClient["removeThreadMember"]
  syncGuildTemplate: DiscordClient["syncGuildTemplate"]
  searchGuildMessages: DiscordClient["searchGuildMessages"]
  searchGuildMembers: DiscordClient["searchGuildMembers"]
  setVoiceChannelStatus: DiscordClient["setVoiceChannelStatus"]
  unpinMessage: DiscordClient["unpinMessage"]
}

export interface ActiveThreadListOptions extends RequestOptions {
  limit?: number
  parentChannelId?: string
}

export type ArchivedThreadVisibility = "joined-private" | "private" | "public"

export interface ArchivedThreadListOptions extends RequestOptions {
  beforeThreadId?: string
  beforeTimestamp?: string
  limit?: number
  visibility?: ArchivedThreadVisibility
}

export interface DirectMessageListOptions extends RequestOptions {
  beforeMessageId?: string
  limit?: number
}

export interface ConnectorServiceOptions {
  administrationOptions?: Pick<
    AdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  activityStore?: ActivityStore
  applicationEmojiOptions?: Pick<
    ApplicationEmojiServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  applicationEntitlementOptions?: Pick<
    ApplicationEntitlementServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  applicationIntentOptions?: Pick<
    ApplicationIntentServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  botProfileOptions?: Pick<
    BotProfileServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  applicationRoleConnectionMetadataOptions?: Pick<
    ApplicationRoleConnectionMetadataServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildApplicationCommandOptions?: Pick<
    GuildApplicationCommandServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  globalApplicationCommandOptions?: Pick<
    GlobalApplicationCommandServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  announcementCrosspostOptions?: Pick<
    AnnouncementCrosspostServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  announcementSubscriptionOptions?: Pick<
    AnnouncementSubscriptionServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  attachmentMessageOptions?: Pick<
    AttachmentMessageServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  attachmentReadOptions?: Pick<
    MessageAttachmentReadServiceOptions,
    "fetchImplementation"
  >
  componentMessageOptions?: Pick<
    ComponentMessageServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  embedMessageOptions?: Pick<
    EmbedMessageServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  automodOptions?: Pick<
    AutoModerationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  bulkGuildBanOptions?: Pick<
    BulkGuildBanServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  bulkMemberRoleOptions?: Pick<
    BulkMemberRoleServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildPruneOptions?: Pick<
    GuildPruneServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  channelAdministrationOptions?: Pick<
    ChannelAdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  channelCloneOptions?: Pick<
    ChannelCloneServiceOptions,
    "clock" | "planKey" | "randomId" | "verificationTimeoutMs"
  >
  channelDeletionOptions?: Pick<
    ChannelDeletionServiceOptions,
    "clock" | "planKey" | "randomId" | "verificationTimeoutMs"
  >
  channelMetadataOptions?: Pick<
    ChannelMetadataServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  channelOrderingOptions?: Pick<
    ChannelOrderingServiceOptions,
    "clock" | "planKey" | "randomId" | "verificationTimeoutMs"
  >
  client?: DiscordServiceClient
  clientOptions?: Omit<DiscordClientOptions, "token">
  config: ConnectorConfig
  deletionOptions?: Pick<DeletionServiceOptions, "clock" | "planKey" | "randomId">
  directMessageOptions?: Pick<
    DirectMessageServiceOptions,
    "clock" | "limiter" | "planKey" | "randomId"
  >
  forumPostOptions?: Pick<
    ForumPostServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  forumTagOptions?: Pick<
    ForumTagServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  gateway?: GatewayChannelLayoutSource
    & Partial<GatewaySoundboardEffectSource>
    & Partial<GatewayVoiceChannelStatusSource>
  guildScaffoldOptions?: Pick<
    GuildScaffoldServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildBlueprintOptions?: Pick<
    GuildBlueprintServiceOptions,
    "clock" | "planKey"
  >
  guildBlueprintCaptureOptions?: Pick<
    GuildBlueprintCaptureServiceOptions,
    "clock"
  >
  guildRecoveryAttestationKey?: Uint8Array
  guildExpressionOptions?: Pick<
    GuildExpressionServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildIncidentOptions?: Pick<
    GuildIncidentServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildCommunityOptions?: Pick<
    GuildCommunityServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildSettingsOptions?: Pick<
    GuildSettingsServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildProfileOptions?: Pick<
    GuildProfileServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  interactionOptions?: Pick<
    InteractionServiceOptions,
    "clock" | "ledgerTtlMs" | "limiter" | "randomId"
  >
  nativeInteractionCommandOptions?: Pick<
    NativeInteractionCommandServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildTemplateOptions?: Pick<
    GuildTemplateServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  integrationOptions?: Pick<
    IntegrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildDepartureOptions?: Pick<
    GuildDepartureServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  inviteOptions?: Pick<
    InviteServiceOptions,
    "clock" | "planKey" | "privateFileSystem" | "randomId"
  >
  onboardingOptions?: Pick<OnboardingServiceOptions, "clock" | "planKey" | "randomId">
  messagePinOptions?: Pick<
    MessagePinServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  messageForwardOptions?: Pick<
    MessageForwardServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  memberRoleOptions?: Pick<
    MemberRoleServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  memberNicknameOptions?: Pick<
    MemberNicknameServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  memberVerificationOptions?: Pick<
    MemberVerificationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  memberVoiceOptions?: Pick<
    MemberVoiceServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  permissionOverwriteOptions?: Pick<
    ChannelPermissionOverwriteServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  operationStore?: OperationStore
  permissionOptions?: Pick<PermissionServiceOptions, "clock">
  pollOptions?: Pick<PollServiceOptions, "clock" | "planKey" | "randomId">
  policy?: ScopePolicy
  reactionOptions?: Pick<ReactionServiceOptions, "clock" | "planKey" | "randomId">
  roleAdministrationOptions?: Pick<
    RoleAdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  roleConfigurationOptions?: Pick<
    RoleConfigurationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  roleDeletionOptions?: Pick<
    RoleDeletionServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  roleOrderingOptions?: Pick<
    RoleOrderingServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  scheduledEventOptions?: Pick<
    ScheduledEventServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  soundboardOptions?: Pick<
    SoundboardServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  soundboardPlaybackOptions?: Pick<
    SoundboardPlaybackServiceOptions,
    "clock" | "randomId"
  >
  stageInstanceOptions?: Pick<
    StageInstanceServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  voiceChannelStatusOptions?: Pick<
    VoiceChannelStatusServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  threadCreationOptions?: Pick<
    ThreadCreationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  threadGovernanceOptions?: Pick<
    ThreadGovernanceServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  webhookOptions?: Pick<WebhookServiceOptions, "clock" | "planKey" | "randomId">
  webhookMessageOptions?: Pick<
    WebhookMessageServiceOptions,
    "clock" | "intentKey" | "planKey" | "randomId"
  >
  welcomeScreenOptions?: Pick<
    WelcomeScreenServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  writeCoordinator?: WriteCoordinator
  widgetSettingsOptions?: Pick<
    WidgetSettingsServiceOptions,
    "clock" | "planKey" | "randomId"
  >
}

interface VerifiedIdentity {
  application: DiscordApplication
  bot: DiscordUser
}

function applicationMessageContentIntent(application: DiscordApplication) {
  return projectApplicationPrivilegedIntents(application).messageContent
}

function assertConnectorLimit(
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

function isThreadType(type: number): boolean {
  const threadTypes: readonly number[] = [
    DISCORD_CHANNEL_TYPES.announcementThread,
    DISCORD_CHANNEL_TYPES.privateThread,
    DISCORD_CHANNEL_TYPES.publicThread,
  ]
  return threadTypes.includes(type)
}

const ARCHIVED_THREAD_VISIBILITIES: ReadonlySet<string> = new Set([
  "joined-private",
  "private",
  "public",
])
const THREAD_PARENT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])

function normalizedGuildChannel(channel: DiscordChannel, guildId: string) {
  return normalizeChannel({
    ...channel,
    guild_id: channel.guild_id || guildId,
  })
}

function voiceChannelStatusSource(
  gateway: GatewayChannelLayoutSource,
): GatewayVoiceChannelStatusSource {
  const candidate = gateway as GatewayChannelLayoutSource
    & Partial<GatewayVoiceChannelStatusSource>
  if (
    typeof candidate.voiceChannelStatusEnabled === "boolean"
    && typeof candidate.getVoiceChannelStatus === "function"
    && typeof candidate.waitForVoiceChannelStatusUpdate === "function"
  ) return candidate as GatewayChannelLayoutSource & GatewayVoiceChannelStatusSource
  return new DisabledGatewayVoiceChannelStatusSource()
}

function soundboardPlaybackSource(
  gateway: GatewayChannelLayoutSource,
): GatewaySoundboardEffectSource {
  const candidate = gateway as GatewayChannelLayoutSource
    & Partial<GatewaySoundboardEffectSource>
  if (
    typeof candidate.soundboardPlaybackEventsEnabled === "boolean"
    && typeof candidate.waitForSoundboardPlaybackEvent === "function"
  ) return candidate as GatewayChannelLayoutSource & GatewaySoundboardEffectSource
  return new DisabledGatewaySoundboardEffectSource()
}

const DIRECT_MESSAGE_CLIENT_METHODS = [
  "createDirectComponentMessage",
  "createDirectMessage",
  "createDirectMessageChannel",
  "deleteDirectMessage",
  "editDirectComponentMessage",
  "editDirectMessage",
  "getDirectMessage",
  "getDirectMessageChannel",
  "getDirectMessageUser",
  "listDirectMessages",
] as const

function configuredDirectMessageServiceClient(
  client: DiscordServiceClient,
  config: ConnectorConfig,
): DirectMessageServiceClient | undefined {
  const candidate = client as DiscordServiceClient
    & Partial<DirectMessageServiceClient>
  if (
    DIRECT_MESSAGE_CLIENT_METHODS.every((name) => (
      typeof candidate[name] === "function"
    ))
    && (
      !config.allowDirectMessageAttachments
      || typeof candidate.createDirectAttachmentMessage === "function"
    )
  ) {
    return candidate as DirectMessageServiceClient
  }
  return undefined
}

function directMessagesConfigured(config: ConnectorConfig): boolean {
  return config.allowDirectMessageAudit
    || config.allowDirectMessageAttachments
    || config.allowDirectMessageDeletion
    || config.allowDirectMessageDelivery
    || config.allowDirectMessageEditing
}

export function applicationPostureRequirementsForConfig(
  config: ConnectorConfig,
): ApplicationPostureRequirements {
  const contentDependentWrites = (
    config.allowAnnouncementCrossposts
    && config.announcementCrosspostChannelIds.size > 0
  ) || (
    config.allowInteractions
    && config.interactionChannelIds.size > 0
  ) || (
    config.allowMessageForwarding
    && config.messageForwardSourceChannelIds.size > 0
    && config.messageForwardTargetChannelIds.size > 0
  )
  const messageContentIntent: ApplicationMessageContentRequirement =
    contentDependentWrites
      ? "required"
      : config.mcpToolsets.has("messages")
        ? "recommended"
        : "not-required"
  return {
    guildMembersIntentRequired: config.allowMemberDirectory
      && config.memberDirectoryGuildIds.size > 0,
    messageContentIntent,
    nativeInteractionIngressRequired: config.allowNativeInteractions,
  }
}

export const CONNECTOR_STATUS_SCHEMA_VERSION = 3

export const CONNECTOR_STATUS_PRIVACY = Object.freeze({
  applicationProfileText: "omitted" as const,
  botProfileText: "omitted" as const,
  guildMetadata: "id-only" as const,
  localPaths: "omitted" as const,
  persistence: "none" as const,
  rawPayloads: "omitted" as const,
  text: "fixed-derived-only" as const,
})

export class ConnectorService {
  readonly #administrationService: AdministrationService
  readonly #activityStore: ActivityStore
  readonly #announcementCrosspostService: AnnouncementCrosspostService
  readonly #announcementSubscriptionService: AnnouncementSubscriptionService
  readonly #attachmentMessageService: AttachmentMessageService
  readonly #messageAttachmentReadService: MessageAttachmentReadService
  readonly #applicationEmojiService: ApplicationEmojiService
  readonly #applicationActivityInstanceService: ApplicationActivityInstanceService
  readonly #applicationEntitlementService: ApplicationEntitlementService
  readonly #applicationCommandAuditService: ApplicationCommandAuditService
  readonly #guildApplicationCommandService: GuildApplicationCommandService
  readonly #globalApplicationCommandService: GlobalApplicationCommandService
  readonly #applicationRoleConnectionMetadataAuditService: ApplicationRoleConnectionMetadataAuditService
  readonly #applicationRoleConnectionMetadataService: ApplicationRoleConnectionMetadataService
  readonly #applicationSkuAuditService: ApplicationSkuAuditService
  readonly #applicationMonetizationAuditService: ApplicationMonetizationAuditService
  readonly #applicationIntentService: ApplicationIntentService
  readonly #botProfileService: BotProfileService
  readonly #botInstallationAuditService: BotInstallationAuditService
  readonly #componentMessageService: ComponentMessageService
  readonly #communityActivityService: CommunityActivityService
  readonly #embedMessageService: EmbedMessageService
  readonly #automodService: AutoModerationService
  readonly #banAuditService: BanAuditService
  readonly #bulkGuildBanService: BulkGuildBanService
  readonly #bulkMemberRoleService: BulkMemberRoleService
  readonly #guildPruneService: GuildPruneService
  readonly #channelAdministrationService: ChannelAdministrationService
  readonly #channelCloneService: ChannelCloneService
  readonly #channelDeletionService: ChannelDeletionService
  readonly #channelMetadataService: ChannelMetadataService
  readonly #channelOrderingService: ChannelOrderingService
  readonly #client: DiscordServiceClient
  readonly #config: ConnectorConfig
  readonly #deletionService: DeletionService
  readonly #directMessageService: DirectMessageService | undefined
  #identityPromise: Promise<VerifiedIdentity> | undefined
  readonly #interactionService: InteractionService
  readonly #inviteService: InviteService
  readonly #onboardingService: OnboardingService
  readonly #messagePinService: MessagePinService
  readonly #messageForwardingService: MessageForwardingService
  readonly #messageSearchService: MessageSearchService
  readonly #memberDirectoryService: MemberDirectoryService
  readonly #memberNicknameService: MemberNicknameService
  readonly #memberRoleService: MemberRoleService
  readonly #memberVerificationService: MemberVerificationService
  readonly #memberVoiceService: MemberVoiceService
  readonly #nativeInteractionCommandService: NativeInteractionCommandService
  readonly #permissionOverwriteService: ChannelPermissionOverwriteService
  readonly #guildAuditLogService: GuildAuditLogService
  readonly #guildBlueprintCaptureService: GuildBlueprintCaptureService
  readonly #guildBlueprintService: GuildBlueprintService
  readonly #forumPostService: ForumPostService
  readonly #forumTagService: ForumTagService
  readonly #guildDepartureService: GuildDepartureService
  readonly #guildScaffoldService: GuildScaffoldService
  readonly #guildExpressionService: GuildExpressionService
  readonly #guildCommunityService: GuildCommunityService
  readonly #guildIncidentService: GuildIncidentService
  readonly #guildProfileService: GuildProfileService
  readonly #guildSettingsService: GuildSettingsService
  readonly #guildTemplateService: GuildTemplateService
  readonly #guildWebhookAuditService: GuildWebhookAuditService
  readonly #integrationService: IntegrationService
  readonly #permissionService: PermissionService
  readonly #policy: ScopePolicy
  readonly #pollService: PollService
  readonly #reactionService: ReactionService
  readonly #roleAdministrationService: RoleAdministrationService
  readonly #roleConfigurationService: RoleConfigurationService
  readonly #roleDeletionService: RoleDeletionService
  readonly #roleOrderingService: RoleOrderingService
  readonly #scheduledEventService: ScheduledEventService
  readonly #soundboardService: SoundboardService
  readonly #soundboardPlaybackService: SoundboardPlaybackService
  readonly #stageInstanceService: StageInstanceService
  readonly #threadCreationService: ThreadCreationService
  readonly #threadGovernanceService: ThreadGovernanceService
  readonly #voiceRegionService: VoiceRegionService
  readonly #voiceChannelStatusService: VoiceChannelStatusService
  readonly #webhookService: WebhookService
  readonly #webhookCredentialStore: WebhookCredentialStore | undefined
  readonly #webhookMessageService: WebhookMessageService | undefined
  readonly #welcomeScreenService: WelcomeScreenService
  readonly #writeCoordinator: WriteCoordinator
  readonly #widgetSettingsService: WidgetSettingsService

  constructor(options: ConnectorServiceOptions) {
    this.#config = options.config
    this.#client = options.client || new DiscordClient({
      ...options.clientOptions,
      token: options.config.token,
    })
    this.#policy = options.policy || new ScopePolicy(options.config)
    this.#botInstallationAuditService = new BotInstallationAuditService({
      client: this.#client,
      configuredGuildIds: options.config.allowedGuildIds,
    })
    this.#activityStore = options.activityStore || new JsonlActivityLog(options.config.auditFile)
    const gateway = options.gateway ?? new GatewayChannelLayoutStore({
      enabled: false,
      guildIds: new Set(),
    })
    const voiceChannelStatusGateway = voiceChannelStatusSource(gateway)
    const soundboardPlaybackGateway = soundboardPlaybackSource(gateway)
    const operationStore = options.operationStore || new FileOperationStore(
      operationReceiptDirectory(options.config.auditFile),
    )
    const guildRecoveryAttestationKey = new Uint8Array(
      options.guildRecoveryAttestationKey ?? createGuildRecoveryAttestationKey(),
    )
    this.#writeCoordinator = options.writeCoordinator || new FileWriteCoordinator(
      writeCoordinationDirectory(options.config.auditFile),
      operationStore,
    )
    const directMessageClient = configuredDirectMessageServiceClient(
      this.#client,
      options.config,
    )
    if (!directMessageClient && directMessagesConfigured(options.config)) {
      throw new ConfigurationError(
        "Configured direct-message capabilities require complete direct-message client support",
      )
    }
    this.#directMessageService = directMessageClient
      ? new DirectMessageService({
          activityStore: this.#activityStore,
          attachmentMaxBytes: options.config.attachmentMaxBytes,
          attachmentRoots: options.config.attachmentRoots,
          client: directMessageClient,
          operationStore,
          policy: this.#policy,
          ...options.directMessageOptions,
          verificationKey: directMessageVerificationKey(options.config.token),
          writeCoordinator: this.#writeCoordinator,
        })
      : undefined
    this.#webhookCredentialStore = options.config.webhookCredentialRoot
      ? new WebhookCredentialStore(options.config.webhookCredentialRoot)
      : undefined
    const interactionClock = options.interactionOptions?.clock || (() => new Date())
    const interactionLimiter = options.interactionOptions?.limiter || new InteractionLimiter({
      clock: () => interactionClock().getTime(),
      maxWritesPerMinute: options.config.interactionMaxWritesPerMinute,
      minWriteIntervalMs: options.config.interactionMinWriteIntervalMs,
    })
    this.#announcementCrosspostService = new AnnouncementCrosspostService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.announcementCrosspostOptions,
    })
    this.#applicationEmojiService = new ApplicationEmojiService({
      activityStore: this.#activityStore,
      client: this.#client,
      fileRoots: options.config.applicationEmojiRoots,
      operationStore,
      policy: this.#policy,
      ...options.applicationEmojiOptions,
    })
    this.#applicationActivityInstanceService = new ApplicationActivityInstanceService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#applicationCommandAuditService = new ApplicationCommandAuditService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#communityActivityService = new CommunityActivityService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#messageSearchService = new MessageSearchService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#guildApplicationCommandService = new GuildApplicationCommandService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.guildApplicationCommandOptions,
    })
    this.#globalApplicationCommandService = new GlobalApplicationCommandService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.globalApplicationCommandOptions,
    })
    this.#applicationRoleConnectionMetadataAuditService = new ApplicationRoleConnectionMetadataAuditService({
      client: this.#client,
    })
    this.#applicationRoleConnectionMetadataService = new ApplicationRoleConnectionMetadataService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.applicationRoleConnectionMetadataOptions,
    })
    this.#applicationSkuAuditService = new ApplicationSkuAuditService({
      client: this.#client,
    })
    this.#applicationMonetizationAuditService = new ApplicationMonetizationAuditService({
      client: this.#client,
    })
    this.#applicationEntitlementService = new ApplicationEntitlementService({
      activityStore: this.#activityStore,
      client: this.#client,
      monetizationAuditService: this.#applicationMonetizationAuditService,
      operationStore,
      policy: this.#policy,
      ...options.applicationEntitlementOptions,
    })
    this.#guildWebhookAuditService = new GuildWebhookAuditService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#applicationIntentService = new ApplicationIntentService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.applicationIntentOptions,
    })
    this.#botProfileService = new BotProfileService({
      activityStore: this.#activityStore,
      client: this.#client,
      fileRoots: options.config.botProfileRoots,
      operationStore,
      policy: this.#policy,
      ...options.botProfileOptions,
    })
    this.#announcementSubscriptionService = new AnnouncementSubscriptionService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.announcementSubscriptionOptions,
    })
    this.#nativeInteractionCommandService = new NativeInteractionCommandService({
      activityStore: this.#activityStore,
      client: this.#client,
      commandName: options.config.nativeCommandName,
      operationStore,
      policy: this.#policy,
      ...options.nativeInteractionCommandOptions,
    })
    this.#administrationService = new AdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.administrationOptions,
    })
    this.#bulkGuildBanService = new BulkGuildBanService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.bulkGuildBanOptions,
    })
    this.#guildPruneService = new GuildPruneService({
      activityStore: this.#activityStore,
      client: this.#client,
      maximumMemberCount: options.config.guildPruneMaxMembers,
      operationStore,
      policy: this.#policy,
      protectedUserIds: options.config.protectedUserIds,
      ...options.guildPruneOptions,
    })
    this.#channelAdministrationService = new ChannelAdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.channelAdministrationOptions,
    })
    this.#channelCloneService = new ChannelCloneService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.channelCloneOptions,
    })
    this.#channelDeletionService = new ChannelDeletionService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.channelDeletionOptions,
      recoveryAttestationKey: guildRecoveryAttestationKey,
    })
    this.#channelMetadataService = new ChannelMetadataService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.channelMetadataOptions,
    })
    this.#voiceChannelStatusService = new VoiceChannelStatusService({
      activityStore: this.#activityStore,
      client: this.#client,
      gateway: voiceChannelStatusGateway,
      operationStore,
      policy: this.#policy,
      ...options.voiceChannelStatusOptions,
    })
    this.#voiceRegionService = new VoiceRegionService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#channelOrderingService = new ChannelOrderingService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.channelOrderingOptions,
    })
    this.#forumTagService = new ForumTagService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.forumTagOptions,
    })
    this.#deletionService = new DeletionService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.deletionOptions,
    })
    this.#attachmentMessageService = new AttachmentMessageService({
      activityStore: this.#activityStore,
      attachmentMaxBytes: options.config.attachmentMaxBytes,
      attachmentRoots: options.config.attachmentRoots,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.attachmentMessageOptions,
    })
    this.#messageAttachmentReadService = new MessageAttachmentReadService({
      client: this.#client,
      policy: this.#policy,
      ...options.attachmentReadOptions,
    })
    this.#componentMessageService = new ComponentMessageService({
      activityStore: this.#activityStore,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.componentMessageOptions,
      verificationKey: componentMessageVerificationKey(options.config.token),
    })
    this.#embedMessageService = new EmbedMessageService({
      activityStore: this.#activityStore,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.embedMessageOptions,
      verificationKey: embedMessageVerificationKey(options.config.token),
    })
    this.#automodService = new AutoModerationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.automodOptions,
      verificationKey: autoModerationVerificationKey(options.config.token),
    })
    this.#banAuditService = new BanAuditService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#interactionService = new InteractionService({
      activityStore: this.#activityStore,
      client: this.#client,
      maxWritesPerMinute: options.config.interactionMaxWritesPerMinute,
      minWriteIntervalMs: options.config.interactionMinWriteIntervalMs,
      policy: this.#policy,
      ...options.interactionOptions,
      limiter: interactionLimiter,
    })
    this.#inviteService = new InviteService({
      activityStore: this.#activityStore,
      capabilityRoots: options.config.inviteCapabilityRoots,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.inviteOptions,
    })
    this.#guildTemplateService = new GuildTemplateService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.guildTemplateOptions,
    })
    this.#guildCommunityService = new GuildCommunityService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.guildCommunityOptions,
    })
    this.#guildSettingsService = new GuildSettingsService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.guildSettingsOptions,
    })
    this.#guildIncidentService = new GuildIncidentService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.guildIncidentOptions,
    })
    this.#guildProfileService = new GuildProfileService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.guildProfileOptions,
    })
    this.#integrationService = new IntegrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.integrationOptions,
    })
    this.#guildDepartureService = new GuildDepartureService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.guildDepartureOptions,
    })
    this.#onboardingService = new OnboardingService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.onboardingOptions,
    })
    this.#welcomeScreenService = new WelcomeScreenService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.welcomeScreenOptions,
    })
    this.#widgetSettingsService = new WidgetSettingsService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.widgetSettingsOptions,
    })
    this.#messagePinService = new MessagePinService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.messagePinOptions,
    })
    this.#messageForwardingService = new MessageForwardingService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.messageForwardOptions,
    })
    this.#webhookService = new WebhookService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...(this.#webhookCredentialStore
        ? { credentialStore: this.#webhookCredentialStore }
        : {}),
      ...options.webhookOptions,
    })
    this.#webhookMessageService = this.#webhookCredentialStore
      ? new WebhookMessageService({
          activityStore: this.#activityStore,
          client: this.#client,
          credentialStore: this.#webhookCredentialStore,
          intentKey: webhookMessageIntentKey(options.config.token),
          limiter: interactionLimiter,
          operationStore,
          policy: this.#policy,
          ...options.webhookMessageOptions,
        })
      : undefined
    this.#guildExpressionService = new GuildExpressionService({
      activityStore: this.#activityStore,
      client: this.#client,
      fileRoots: options.config.guildExpressionRoots,
      operationStore,
      policy: this.#policy,
      ...options.guildExpressionOptions,
    })
    this.#scheduledEventService = new ScheduledEventService({
      activityStore: this.#activityStore,
      client: this.#client,
      fileRoots: options.config.scheduledEventRoots,
      operationStore,
      policy: this.#policy,
      ...options.scheduledEventOptions,
    })
    this.#soundboardService = new SoundboardService({
      activityStore: this.#activityStore,
      client: this.#client,
      fileRoots: options.config.soundboardRoots,
      operationStore,
      policy: this.#policy,
      ...options.soundboardOptions,
    })
    this.#soundboardPlaybackService = new SoundboardPlaybackService({
      activityStore: this.#activityStore,
      client: this.#client,
      gateway: soundboardPlaybackGateway,
      intentKey: soundboardPlaybackIntentKey(options.config.token),
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.soundboardPlaybackOptions,
    })
    this.#stageInstanceService = new StageInstanceService({
      activityStore: this.#activityStore,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.stageInstanceOptions,
    })
    this.#memberDirectoryService = new MemberDirectoryService({
      client: this.#client,
      policy: this.#policy,
    })
    this.#memberNicknameService = new MemberNicknameService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.memberNicknameOptions,
    })
    this.#memberVerificationService = new MemberVerificationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.memberVerificationOptions,
    })
    this.#memberRoleService = new MemberRoleService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.memberRoleOptions,
    })
    this.#bulkMemberRoleService = new BulkMemberRoleService({
      memberRoleService: this.#memberRoleService,
      operationStore,
      policy: this.#policy,
      ...options.bulkMemberRoleOptions,
    })
    this.#memberVoiceService = new MemberVoiceService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.memberVoiceOptions,
    })
    this.#permissionOverwriteService = new ChannelPermissionOverwriteService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.permissionOverwriteOptions,
    })
    this.#forumPostService = new ForumPostService({
      activityStore: this.#activityStore,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.forumPostOptions,
    })
    this.#pollService = new PollService({
      activityStore: this.#activityStore,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.pollOptions,
    })
    this.#reactionService = new ReactionService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.reactionOptions,
    })
    this.#threadCreationService = new ThreadCreationService({
      activityStore: this.#activityStore,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.threadCreationOptions,
    })
    this.#threadGovernanceService = new ThreadGovernanceService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.threadGovernanceOptions,
    })
    this.#guildAuditLogService = new GuildAuditLogService({
      client: this.#client,
    })
    this.#permissionService = new PermissionService({
      client: this.#client,
      policy: this.#policy,
      ...options.permissionOptions,
    })
    this.#roleAdministrationService = new RoleAdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.roleAdministrationOptions,
    })
    this.#roleConfigurationService = new RoleConfigurationService({
      activityStore: this.#activityStore,
      client: this.#client,
      fileRoots: options.config.guildExpressionRoots,
      operationStore,
      policy: this.#policy,
      ...options.roleConfigurationOptions,
    })
    this.#roleDeletionService = new RoleDeletionService({
      activityStore: this.#activityStore,
      client: this.#client,
      layoutSource: gateway,
      operationStore,
      policy: this.#policy,
      ...options.roleDeletionOptions,
      recoveryAttestationKey: guildRecoveryAttestationKey,
    })
    this.#roleOrderingService = new RoleOrderingService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.roleOrderingOptions,
    })
    this.#guildScaffoldService = new GuildScaffoldService({
      channelService: this.#channelAdministrationService,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      roleService: this.#roleAdministrationService,
      ...options.guildScaffoldOptions,
    })
    this.#guildBlueprintService = new GuildBlueprintService({
      domains: {
        automod: this.#automodService,
        component: this.#componentMessageService,
        community: this.#guildCommunityService,
        onboarding: this.#onboardingService,
        profile: this.#guildProfileService,
        scaffold: this.#guildScaffoldService,
        settings: this.#guildSettingsService,
        welcomeScreen: this.#welcomeScreenService,
      },
      ...options.guildBlueprintOptions,
    })
    this.#guildBlueprintCaptureService = new GuildBlueprintCaptureService({
      client: this.#client,
      community: this.#guildCommunityService,
      policy: this.#policy,
      ...options.guildBlueprintCaptureOptions,
      recoveryAttestationKey: guildRecoveryAttestationKey,
    })
  }

  describePolicy() {
    return this.#policy.describe()
  }

  #webhookMessages(): WebhookMessageService {
    if (!this.#webhookMessageService) {
      throw new ConfigurationError(
        "Discord webhook message capabilities require a private credential store",
      )
    }
    return this.#webhookMessageService
  }

  #directMessages(): DirectMessageService {
    if (!this.#directMessageService) {
      throw new ConfigurationError(
        "Discord direct-message capabilities require complete client support",
      )
    }
    return this.#directMessageService
  }

  async #verifyIdentity(options: RequestOptions = {}): Promise<VerifiedIdentity> {
    if (!this.#identityPromise) {
      this.#identityPromise = Promise.all([
        this.#client.getCurrentApplication(options),
        this.#client.getCurrentUser(options),
      ]).then(([application, bot]) => {
        const expectedApplicationId = this.#config.expectedApplicationId
        if (expectedApplicationId && application.id !== expectedApplicationId) {
          throw new ConfigurationError(
            `Discord token belongs to application ${application.id}, expected ${expectedApplicationId}`,
          )
        }
        if (!bot.bot) {
          throw new ConfigurationError("Discord credential did not identify a bot user")
        }
        const expectedBotId = this.#config.expectedBotId
        if (expectedBotId && bot.id !== expectedBotId) {
          throw new ConfigurationError(
            `Discord token belongs to bot ${bot.id}, expected ${expectedBotId}`,
          )
        }
        if (application.bot?.id && application.bot.id !== bot.id) {
          throw new ConfigurationError("Discord application and bot user identities do not match")
        }
        return { application, bot }
      }).catch((error: unknown) => {
        this.#identityPromise = undefined
        throw error
      })
    }
    return this.#identityPromise
  }

  #applicationPostureRequirements(): ApplicationPostureRequirements {
    return applicationPostureRequirementsForConfig(this.#config)
  }

  #applicationPosture(identity: VerifiedIdentity): ApplicationPostureResult {
    return projectApplicationPosture(
      identity.application,
      identity.bot.id,
      this.#applicationPostureRequirements(),
    )
  }

  #coordinateWrite<T>(
    kind: OperationKind,
    operationKey: string,
    planDigest: string,
    targets: readonly WriteCoordinationTarget[],
    operation: () => Promise<T>,
    coordinationOptions?: WriteCoordinationRunOptions,
  ): Promise<T> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord reviewed-write plan digest is invalid")
    }
    return this.#writeCoordinator.run({
      kind,
      operationKeyHash: operationKeyHash(operationKey),
      planDigest,
      targets,
    }, operation, coordinationOptions)
  }

  async getStatus(options: RequestOptions = {}) {
    const identity = await this.#verifyIdentity(options)
    const applicationPosture = this.#applicationPosture(identity)
    const installationAudit = await this.#botInstallationAuditService.audit(
      identity.application.id,
      identity.bot.id,
      options,
    )
    return {
      application: {
        guildMembersIntent: applicationPosture.privilegedIntents.guildMembers,
        id: identity.application.id,
        messageContentIntent: applicationPosture.privilegedIntents.messageContent,
      },
      applicationPosture,
      bot: {
        id: identity.bot.id,
      },
      installationAudit,
      policy: this.describePolicy(),
      privacy: CONNECTOR_STATUS_PRIVACY,
      schemaVersion: CONNECTOR_STATUS_SCHEMA_VERSION,
      status: "ok",
      writeCoordination: {
        coverage: "receipt-backed-reviewed-writes",
        excludedWorkflows: [
          "ordinary-message-interactions",
        ],
        localFilesystemRequired: true,
        mode: "durable-exact-target",
        resumableWorkflows: ["guild-scaffold"],
        sharedStateRootRequired: true,
      },
    }
  }

  async auditBotInstallations(
    options: RequestOptions = {},
  ): Promise<BotInstallationAuditResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#botInstallationAuditService.audit(
      identity.application.id,
      identity.bot.id,
      options,
    )
  }

  async getApplicationPosture(
    options: RequestOptions = {},
  ): Promise<ApplicationPostureResult> {
    return this.#applicationPosture(await this.#verifyIdentity(options))
  }

  async getCurrentBotProfile(
    options: RequestOptions = {},
  ): Promise<BotProfileAuditResult> {
    this.#policy.assertBotProfileAuditable()
    const identity = await this.#verifyIdentity(options)
    return this.#botProfileService.get(
      identity.application.id,
      identity.bot.id,
      options,
    )
  }

  async auditApplicationCommands(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationCommandAuditResult> {
    this.#policy.assertGuildAllowed(guildId)
    const identity = await this.#verifyIdentity(options)
    const posture = this.#applicationPosture(identity)
    const installationTypes:
      ApplicationCommandAuditResult["application"]["installationTypes"]["values"] = []
    if (posture.installation.guild.supported === true) {
      installationTypes.push("guild-install")
    }
    if (posture.installation.user.supported === true) {
      installationTypes.push("user-install")
    }
    return this.#applicationCommandAuditService.audit(
      {
        botId: identity.bot.id,
        id: identity.application.id,
        installationTypes: {
          reported: posture.installation.contextsReported,
          unknownValues: posture.installation.unknownContextCount,
          values: installationTypes,
        },
      },
      guildId,
      options,
    )
  }

  async inspectApplicationActivityInstance(
    request: ApplicationActivityInstanceRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationActivityInstanceInspectionResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#applicationActivityInstanceService.inspect(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async auditApplicationRoleConnectionMetadata(
    options: RequestOptions = {},
  ): Promise<ApplicationRoleConnectionMetadataAuditResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#applicationRoleConnectionMetadataAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
  }

  async auditApplicationSkus(
    options: RequestOptions = {},
  ): Promise<ApplicationSkuAuditResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#applicationSkuAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
  }

  async auditApplicationEntitlements(
    beneficiary: ApplicationEntitlementBeneficiary,
    skuIds: readonly string[],
    options: ApplicationEntitlementPageOptions = {},
  ): Promise<ApplicationEntitlementAuditResult> {
    const beneficiaryId = beneficiary.type === "guild"
      ? beneficiary.guildId
      : beneficiary.userId
    this.#policy.assertApplicationEntitlementsAuditable(
      { id: beneficiaryId, type: beneficiary.type },
      skuIds,
    )
    const identity = await this.#verifyIdentity(options)
    const skuAudit = await this.#applicationSkuAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
    return this.#applicationMonetizationAuditService.auditEntitlements(
      identity.application,
      identity.bot.id,
      beneficiary,
      skuIds,
      skuAudit.records,
      options,
    )
  }

  async getApplicationEntitlement(
    beneficiary: ApplicationEntitlementBeneficiary,
    entitlementId: string,
    skuId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementInspectionResult> {
    const beneficiaryId = beneficiary.type === "guild"
      ? beneficiary.guildId
      : beneficiary.userId
    this.#policy.assertApplicationEntitlementsAuditable(
      { id: beneficiaryId, type: beneficiary.type },
      [skuId],
    )
    const identity = await this.#verifyIdentity(options)
    const skuAudit = await this.#applicationSkuAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
    return this.#applicationMonetizationAuditService.inspectEntitlement(
      identity.application,
      identity.bot.id,
      beneficiary,
      entitlementId,
      skuId,
      skuAudit.records,
      options,
    )
  }

  async auditApplicationSubscriptions(
    userId: string,
    skuId: string,
    options: ApplicationSubscriptionPageOptions = {},
  ): Promise<ApplicationSubscriptionAuditResult> {
    this.#policy.assertApplicationSubscriptionsAuditable(userId, skuId)
    const configuredSkuScope = this.#policy.applicationMonetizationSkuScope()
    const identity = await this.#verifyIdentity(options)
    const skuAudit = await this.#applicationSkuAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
    return this.#applicationMonetizationAuditService.auditSubscriptions(
      identity.application,
      identity.bot.id,
      userId,
      skuId,
      configuredSkuScope,
      skuAudit.records,
      options,
    )
  }

  async listGuilds(options: GuildPageOptions = {}) {
    await this.#verifyIdentity(options)
    const guilds: DiscordGuild[] = await this.#client.listCurrentUserGuilds(options)
    const scopedGuilds = this.#policy.filterGuilds(guilds)
    return {
      guilds: scopedGuilds.map(normalizeGuild),
      page: {
        after: options.after ?? null,
        before: options.before ?? null,
        requestedLimit: options.limit ?? null,
        returned: scopedGuilds.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async listChannels(guildId: string, options: RequestOptions = {}) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    const channels: DiscordChannel[] = await this.#client.getGuildChannels(guildId, options)
    const scopedChannels = this.#policy.filterChannels(
      channels.filter((channel) => !channel.guild_id || channel.guild_id === guildId),
    )
    const projectedChannels = scopedChannels
      .map((channel) => normalizedGuildChannel(channel, guildId))
      .sort((left, right) => (
        (left.position ?? Number.MAX_SAFE_INTEGER)
        - (right.position ?? Number.MAX_SAFE_INTEGER)
      ))
    return {
      channels: projectedChannels,
      guildId,
      inventory: {
        completeness: "visibility-bounded" as const,
        returned: projectedChannels.length,
        scope: "configured-policy-and-discord-visibility" as const,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async getChannel(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<ChannelMetadataReadResult> {
    assertChannelMetadataChannelId(channelId)
    await this.#verifyIdentity(options)
    return this.#channelMetadataService.get(channelId, options)
  }

  async getVoiceChannelStatus(
    guildId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<VoiceChannelStatusReadResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#voiceChannelStatusService.get(
      identity.bot.id,
      guildId,
      channelId,
      options,
    )
  }

  async listVoiceRegions(
    options: RequestOptions = {},
  ): Promise<VoiceRegionInventoryResult> {
    await this.#verifyIdentity(options)
    return this.#voiceRegionService.listGlobal(options)
  }

  async listGuildVoiceRegions(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<VoiceRegionInventoryResult> {
    await this.#verifyIdentity(options)
    return this.#voiceRegionService.listGuild(guildId, options)
  }

  async auditForumTags(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<ForumTagAuditResult> {
    assertForumTagChannelId(channelId)
    this.#policy.assertForumTagAuditConfigured(channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#forumTagService.audit(
      identity.application.id,
      identity.bot.id,
      channelId,
      options,
    )
  }

  async listRoles(guildId: string, options: RequestOptions = {}) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    const roles = normalizeDiscordRoleInventory(
      await this.#client.getGuildRoles(guildId, options),
      guildId,
    )
    return {
      guildId,
      page: {
        documentedLimit: DISCORD_LIMITS.guildRoles,
        returned: roles.length,
      },
      roles,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async auditRoleOrder(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<RoleOrderAuditResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#roleOrderingService.audit(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async auditChannelOrder(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<ChannelOrderAuditResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#channelOrderingService.audit(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async auditChannelDeletion(
    guildId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<ChannelDeletionReadiness> {
    const identity = await this.#verifyIdentity(options)
    return this.#channelDeletionService.audit(
      identity.application.id,
      identity.bot.id,
      guildId,
      channelId,
      options,
    )
  }

  async auditRoleDeletion(
    guildId: string,
    roleId: string,
    options: RequestOptions = {},
  ): Promise<RoleDeletionReadiness> {
    const identity = await this.#verifyIdentity(options)
    return this.#roleDeletionService.audit(
      identity.application.id,
      identity.bot.id,
      guildId,
      roleId,
      options,
    )
  }

  async getGuildMember(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#memberDirectoryService.get(guildId, userId, options)
  }

  async getMemberVoiceState(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<MemberVoiceAuditResult> {
    assertMemberVoiceGetInput(guildId, userId)
    const identity = await this.#verifyIdentity(options)
    return this.#memberVoiceService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      userId,
      options,
    )
  }

  async getThreadState(
    guildId: string,
    threadId: string,
    options: RequestOptions = {},
  ): Promise<ThreadStateAuditResult> {
    assertThreadAuditInput(guildId, threadId)
    const identity = await this.#verifyIdentity(options)
    return this.#threadGovernanceService.getState(
      identity.application.id,
      identity.bot.id,
      guildId,
      threadId,
      options,
    )
  }

  async getThreadMembership(
    guildId: string,
    threadId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<ThreadMembershipAuditResult> {
    assertThreadMembershipInput(guildId, threadId, userId)
    const identity = await this.#verifyIdentity(options)
    return this.#threadGovernanceService.getMembership(
      identity.application.id,
      identity.bot.id,
      guildId,
      threadId,
      userId,
      options,
    )
  }

  async listGuildBans(
    guildId: string,
    options: BanAuditListOptions = {},
  ) {
    assertBanAuditListInput(guildId, options)
    const identity = await this.#verifyIdentity(options)
    return this.#banAuditService.list(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildBan(
    guildId: string,
    userId: string,
    options: BanAuditGetOptions = {},
  ) {
    assertBanAuditGetInput(guildId, userId, options)
    const identity = await this.#verifyIdentity(options)
    return this.#banAuditService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      userId,
      options,
    )
  }

  async listGuildInvites(
    guildId: string,
    options: InviteListOptions = {},
  ): Promise<InviteInventoryResult> {
    assertInviteListInput(guildId, options)
    const identity = await this.#verifyIdentity(options)
    return this.#inviteService.list(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async listGuildTemplates(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildTemplateInventoryResult> {
    assertGuildTemplateListInput(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildTemplateService.list(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildInvite(
    guildId: string,
    inviteRef: string,
    options: RequestOptions = {},
  ): Promise<InviteLookupResult> {
    assertInviteGetInput(guildId, inviteRef)
    const identity = await this.#verifyIdentity(options)
    return this.#inviteService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      inviteRef,
      options,
    )
  }

  async getGuildVanityUrl(
    guildId: string,
    options: GuildVanityUrlOptions = {},
  ): Promise<GuildVanityUrlAuditResult> {
    assertGuildVanityUrlInput(guildId, options.includeCode ?? false)
    const identity = await this.#verifyIdentity(options)
    return this.#inviteService.getVanityUrl(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildOnboarding(
    guildId: string,
    includeText = false,
    options: RequestOptions = {},
  ): Promise<OnboardingAuditResult> {
    assertOnboardingGetInput(guildId, includeText)
    const identity = await this.#verifyIdentity(options)
    return this.#onboardingService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      includeText,
      options,
    )
  }

  async getGuildWelcomeScreen(
    guildId: string,
    includeText = false,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenAuditResult> {
    assertWelcomeScreenGetInput(guildId, includeText)
    const identity = await this.#verifyIdentity(options)
    return this.#welcomeScreenService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      includeText,
      options,
    )
  }

  async getGuildWidgetSettings(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<WidgetSettingsAuditResult> {
    assertWidgetSettingsGetInput(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#widgetSettingsService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildSettings(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildSettingsAuditResult> {
    assertGuildSettingsGetInput(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildSettingsService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildCommunity(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildCommunityAuditResult> {
    assertGuildCommunityAuditInput(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildCommunityService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildIncidentActions(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildIncidentAuditResult> {
    assertGuildIncidentGetInput(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildIncidentService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async getGuildProfile(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildProfileAuditResult> {
    assertGuildProfileGetInput(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildProfileService.get(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async listGuildMembers(
    guildId: string,
    options: MemberDirectoryListOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#memberDirectoryService.list(guildId, options)
  }

  async searchGuildMembers(
    guildId: string,
    options: MemberDirectorySearchOptions,
  ) {
    await this.#verifyIdentity(options)
    return this.#memberDirectoryService.search(guildId, options)
  }

  async getRole(
    guildId: string,
    roleId: string,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    const role = normalizeDiscordRole(
      await this.#client.getGuildRole(guildId, roleId, options),
      guildId,
      roleId,
    )
    return {
      guildId,
      role,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async listGuildAuditEntries(
    guildId: string,
    options: ListGuildAuditEntriesOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    return this.#guildAuditLogService.list(guildId, options)
  }

  async getGuildAuditEntry(
    guildId: string,
    entryId: string,
    options: GetGuildAuditEntryOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    return this.#guildAuditLogService.get(guildId, entryId, options)
  }

  async readMessages(channelId: string, options: MessagePageOptions = {}) {
    await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    if (channel.id !== channelId) {
      throw new ConfigurationError("Discord returned a different channel for message history")
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    const messages: DiscordMessage[] = await this.#client.listMessages(channelId, options)
    if (messages.some((message) => (
      message.channel_id !== channelId
      || Boolean(message.guild_id && message.guild_id !== guildId)
    ))) {
      throw new ConfigurationError("Discord returned message history outside the requested channel")
    }
    return {
      channel: normalizedGuildChannel(channel, guildId),
      guildId,
      messages: messages.map((message) => normalizeMessage(message, guildId)),
      page: {
        after: options.after ?? null,
        around: options.around ?? null,
        before: options.before ?? null,
        requestedLimit: options.limit ?? null,
        returned: messages.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async analyzeCommunityActivity(
    request: CommunityActivityRequest,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#communityActivityService.analyze(request, options)
  }

  async getMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    if (channel.id !== channelId) {
      throw new ConfigurationError("Discord returned a different channel for message lookup")
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    const message: DiscordMessage = await this.#client.getMessage(
      channelId,
      messageId,
      options,
    )
    if (
      message.id !== messageId
      || message.channel_id !== channelId
      || Boolean(message.guild_id && message.guild_id !== guildId)
    ) {
      throw new ConfigurationError("Discord returned a different message than requested")
    }
    return {
      channel: normalizedGuildChannel(channel, guildId),
      guildId,
      message: normalizeMessage(message, guildId),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async getMessageAttachment(
    channelId: string,
    messageId: string,
    attachmentId: string,
    options: MessageAttachmentReadOptions,
  ): Promise<MessageAttachmentReadResult> {
    assertMessageAttachmentReadInput(
      channelId,
      messageId,
      attachmentId,
      options.maxBytes,
    )
    const identity = await this.#verifyIdentity(options)
    return this.#messageAttachmentReadService.read(
      identity.application.id,
      identity.bot.id,
      channelId,
      messageId,
      attachmentId,
      options,
    )
  }

  async searchMessages(
    guildId: string,
    options: GuildMessageSearchOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#messageSearchService.search(guildId, options)
  }

  async recallConversation(
    request: ConversationRecallRequest,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#messageSearchService.recall(request, options)
  }

  async listActiveThreads(
    guildId: string,
    options: ActiveThreadListOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    assertConnectorLimit(
      options.limit,
      1,
      CONNECTOR_LIMITS.activeThreads,
      "Active thread result limit",
    )
    if (options.parentChannelId) {
      const parent = await this.#client.getChannel(options.parentChannelId, options)
      if (parent.id !== options.parentChannelId) {
        throw new ConfigurationError("Discord returned a different thread parent channel")
      }
      const parentGuildId = this.#policy.assertChannelReadable(parent)
      if (parentGuildId !== guildId) {
        throw new ConfigurationError("Discord thread parent does not belong to the requested guild")
      }
      if (!THREAD_PARENT_TYPES.has(parent.type)) {
        throw new ConfigurationError("Discord channel type does not support threads")
      }
    }
    const response = await this.#client.listActiveGuildThreads(guildId, options)
    const visible = response.threads
      .filter((thread) => !thread.guild_id || thread.guild_id === guildId)
      .filter((thread) => this.#policy.channelIdReadable(thread.id, thread.parent_id))
      .filter((thread) => (
        !options.parentChannelId || thread.parent_id === options.parentChannelId
      ))
    const limit = options.limit ?? CONNECTOR_LIMITS.threadPageDefault
    return {
      guildId,
      page: {
        requestedLimit: limit,
        returned: Math.min(visible.length, limit),
        totalVisible: visible.length,
        truncated: visible.length > limit,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      threads: visible
        .slice(0, limit)
        .map((thread) => normalizedGuildChannel(thread, guildId)),
    }
  }

  async listArchivedThreads(
    channelId: string,
    options: ArchivedThreadListOptions = {},
  ) {
    await this.#verifyIdentity(options)
    assertConnectorLimit(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Archived thread result limit",
    )
    const visibility = options.visibility ?? "public"
    if (!ARCHIVED_THREAD_VISIBILITIES.has(visibility)) {
      throw new ConfigurationError("Archived thread visibility is not supported")
    }
    if (visibility === "joined-private" && options.beforeTimestamp) {
      throw new ConfigurationError("Joined-private archived threads use beforeThreadId")
    }
    if (visibility !== "joined-private" && options.beforeThreadId) {
      throw new ConfigurationError("Public and private archived threads use beforeTimestamp")
    }
    const parent = await this.#client.getChannel(channelId, options)
    if (parent.id !== channelId) {
      throw new ConfigurationError("Discord returned a different archived-thread parent channel")
    }
    const guildId = this.#policy.assertChannelReadable(parent)
    if (visibility === "public" && !THREAD_PARENT_TYPES.has(parent.type)) {
      throw new ConfigurationError("Discord channel type does not support public archived threads")
    }
    if (
      visibility !== "public"
      && parent.type !== DISCORD_CHANNEL_TYPES.text
    ) {
      throw new ConfigurationError("Discord private archived threads require a guild text channel")
    }
    const before = visibility === "joined-private"
      ? options.beforeThreadId
      : options.beforeTimestamp
    const pageOptions = {
      ...(before ? { before } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }
    let response: DiscordThreadList
    if (visibility === "joined-private") {
      response = await this.#client.listJoinedPrivateArchivedThreads(channelId, pageOptions)
    } else if (visibility === "private") {
      response = await this.#client.listPrivateArchivedThreads(channelId, pageOptions)
    } else {
      response = await this.#client.listPublicArchivedThreads(channelId, pageOptions)
    }
    const threads = response.threads
      .filter((thread) => thread.parent_id === channelId)
      .filter((thread) => !thread.guild_id || thread.guild_id === guildId)
      .filter((thread) => this.#policy.channelIdReadable(thread.id, thread.parent_id))
      .map((thread) => normalizedGuildChannel(thread, guildId))
    const lastRaw = response.threads.at(-1)
    const cursorValue = visibility === "joined-private"
      ? lastRaw?.id
      : lastRaw?.thread_metadata?.archive_timestamp
    return {
      channel: normalizedGuildChannel(parent, guildId),
      guildId,
      page: {
        hasMore: response.has_more || false,
        nextCursor: response.has_more && cursorValue
          ? { value: cursorValue, visibility }
          : null,
        requestedLimit: options.limit ?? null,
        returned: threads.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      threads,
      visibility,
    }
  }

  async explainChannelAccess(
    channelId: string,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    if (channel.id !== channelId) {
      throw new ConfigurationError("Discord returned a different channel for permission evaluation")
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    let permissionChannel = channel
    if (isThreadType(channel.type)) {
      if (!channel.parent_id) {
        throw new ConfigurationError("Discord thread omitted its parent channel ID")
      }
      permissionChannel = await this.#client.getChannel(channel.parent_id, options)
      if (permissionChannel.id !== channel.parent_id) {
        throw new ConfigurationError("Discord returned a different thread permission source")
      }
      const parentGuildId = this.#policy.assertChannelReadable(permissionChannel)
      if (parentGuildId !== guildId) {
        throw new ConfigurationError("Discord thread parent belongs to another guild")
      }
    }
    const [member, roles] = await Promise.all([
      this.#client.getGuildMember(guildId, identity.bot.id, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    if (member.user && member.user.id !== identity.bot.id) {
      throw new ConfigurationError("Discord returned a different guild member for permission evaluation")
    }
    return {
      botId: identity.bot.id,
      channel: normalizedGuildChannel(channel, guildId),
      guildId,
      permissions: evaluateBotChannelPermissions({
        botId: identity.bot.id,
        channel,
        guildId,
        member,
        permissionChannel,
        roles,
      }),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async explainPrincipalPermissions(
    request: ExplainPrincipalPermissionsRequest,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    return this.#permissionService.explain(identity.bot.id, request, options)
  }

  async auditChannelRoleAccess(
    request: AuditChannelRoleAccessRequest,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#permissionService.auditChannelRoles(request, options)
  }

  async planMessageDeletion(
    request: DeletionRequest,
    options: RequestOptions = {},
  ): Promise<DeletionPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#deletionService.plan(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async listMessagePins(
    channelId: string,
    options: MessagePinPageOptions = {},
  ): Promise<MessagePinListResult> {
    await this.#verifyIdentity(options)
    return this.#messagePinService.list(channelId, options)
  }

  async listMessageReactions(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<MessageReactionInventoryResult> {
    await this.#verifyIdentity(options)
    return this.#reactionService.listMessageReactions(channelId, messageId, options)
  }

  async listReactionUsers(
    channelId: string,
    messageId: string,
    emoji: string,
    options: ReactionUserPageOptions = {},
  ): Promise<ReactionUserPageResult> {
    this.#policy.assertChannelReactionIdAuditable(channelId)
    await this.#verifyIdentity(options)
    return this.#reactionService.listReactionUsers(
      channelId,
      messageId,
      emoji,
      options,
    )
  }

  async planMessagePin(
    request: MessagePinRequest,
    options: RequestOptions = {},
  ): Promise<MessagePinPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#messagePinService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planMessageForward(
    request: MessageForwardRequest,
    options: RequestOptions = {},
  ): Promise<MessageForwardPlan> {
    const normalized = normalizeMessageForwardRequest(request)
    this.#policy.assertMessageForwardSourceConfigured(normalized.sourceChannelId)
    this.#policy.assertMessageForwardTargetConfigured(normalized.targetChannelId)
    const identity = await this.#verifyIdentity(options)
    return this.#messageForwardingService.plan(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async planReactionModeration(
    request: ReactionModerationRequest,
    options: RequestOptions = {},
  ): Promise<ReactionModerationPlan> {
    const normalized = normalizeReactionModerationRequest(request)
    this.#policy.assertChannelReactionIdModeratable(request.channelId)
    if (normalized.userId !== null) {
      this.#policy.assertUserNotProtected(normalized.userId)
    }
    const identity = await this.#verifyIdentity(options)
    return this.#reactionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planAnnouncementCrosspost(
    request: AnnouncementCrosspostRequest,
    options: RequestOptions = {},
  ): Promise<AnnouncementCrosspostPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#announcementCrosspostService.plan(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async listAnnouncementSubscriptions(
    targetChannelId: string,
    options: RequestOptions = {},
  ): Promise<AnnouncementSubscriptionInventoryResult> {
    this.#policy.assertAnnouncementSubscriptionTargetIdAuditable(targetChannelId)
    const identity = await this.#verifyIdentity(options)
    return this.#announcementSubscriptionService.list(
      identity.bot.id,
      targetChannelId,
      options,
    )
  }

  async planAnnouncementSubscription(
    request: AnnouncementSubscriptionRequest,
    options: RequestOptions = {},
  ): Promise<AnnouncementSubscriptionPlan> {
    const normalized = normalizeAnnouncementSubscriptionRequest(request)
    this.#policy.assertAnnouncementSubscriptionTargetIdChangeable(
      normalized.targetChannelId,
    )
    if (normalized.action === "subscribe") {
      this.#policy.assertAnnouncementSubscriptionSourceIdChangeable(
        normalized.sourceChannelId,
      )
    }
    const identity = await this.#verifyIdentity(options)
    return this.#announcementSubscriptionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planNativeInteractionCommand(
    request: NativeInteractionCommandRequest,
    options: RequestOptions = {},
  ): Promise<NativeInteractionCommandPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#nativeInteractionCommandService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildApplicationCommandChange(
    request: GuildApplicationCommandChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildApplicationCommandPlan> {
    normalizeGuildApplicationCommandChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildApplicationCommandService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGlobalApplicationCommandChange(
    request: GlobalApplicationCommandChangeRequest,
    options: RequestOptions = {},
  ): Promise<GlobalApplicationCommandPlan> {
    normalizeGlobalApplicationCommandChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#globalApplicationCommandService.plan(
      identity.application,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildTemplateChange(
    request: GuildTemplateChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildTemplateChangePlan> {
    normalizeGuildTemplateChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildTemplateService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async listChannelWebhooks(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<WebhookInventoryResult> {
    this.#policy.assertChannelWebhookIdAuditable(channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.list(identity.bot.id, channelId, options)
  }

  async auditGuildWebhooks(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildWebhookAuditResult> {
    this.#policy.assertGuildWebhookAuditable(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildWebhookAuditService.audit(
      identity.application,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async listGuildIntegrations(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<IntegrationInventoryResult> {
    this.#policy.assertGuildIntegrationAuditable(guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#integrationService.list(
      identity.application.id,
      identity.bot.id,
      guildId,
      options,
    )
  }

  async listGuildExpressions(
    guildId: string,
    kind: GuildExpressionKind,
    options: RequestOptions = {},
  ): Promise<GuildExpressionInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildExpressionService.list(identity.bot.id, guildId, kind, options)
  }

  async listApplicationEmojis(
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#applicationEmojiService.list(
      identity.application.id,
      identity.bot.id,
      options,
    )
  }

  async getApplicationEmoji(
    emojiId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiLookupResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#applicationEmojiService.get(
      identity.application.id,
      identity.bot.id,
      emojiId,
      options,
    )
  }

  async listDirectMessages(
    recipientId: string,
    channelId: string,
    options: DirectMessageListOptions = {},
  ): Promise<DirectMessagePage> {
    const identity = await this.#verifyIdentity(options)
    return this.#directMessages().list(
      identity.application.id,
      identity.bot.id,
      recipientId,
      channelId,
      {
        ...(options.beforeMessageId === undefined
          ? {}
          : { beforeMessageId: options.beforeMessageId }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        request: options.signal === undefined ? {} : { signal: options.signal },
      },
    )
  }

  async getDirectMessage(
    recipientId: string,
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DirectMessageView> {
    const identity = await this.#verifyIdentity(options)
    return this.#directMessages().get(
      identity.application.id,
      identity.bot.id,
      recipientId,
      channelId,
      messageId,
      options,
    )
  }

  async verifyDirectMessageChange(
    request: DirectMessageChangeRequest,
    options: RequestOptions = {},
  ): Promise<DirectMessageVerificationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#directMessages().verify(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async listAutoModerationRules(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<AutoModerationInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#automodService.list(identity.bot.id, guildId, options)
  }

  async getAutoModerationRule(
    guildId: string,
    ruleId: string,
    options: RequestOptions = {},
  ): Promise<AutoModerationLookupResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#automodService.get(identity.bot.id, guildId, ruleId, options)
  }

  async verifyAutoModerationChange(
    request: AutoModerationChangeRequest,
    options: RequestOptions = {},
  ): Promise<AutoModerationVerificationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#automodService.verify(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async getGuildExpression(
    guildId: string,
    kind: GuildExpressionKind,
    expressionId: string,
    options: RequestOptions = {},
  ): Promise<GuildExpressionLookupResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildExpressionService.get(
      identity.bot.id,
      guildId,
      kind,
      expressionId,
      options,
    )
  }

  async listDefaultSoundboardSounds(
    options: RequestOptions = {},
  ): Promise<DefaultSoundboardInventoryResult> {
    await this.#verifyIdentity(options)
    return this.#soundboardService.listDefaults(options)
  }

  async listGuildSoundboardSounds(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildSoundboardInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#soundboardService.listGuild(identity.bot.id, guildId, options)
  }

  async getGuildSoundboardSound(
    guildId: string,
    soundId: string,
    options: RequestOptions = {},
  ): Promise<GuildSoundboardLookupResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#soundboardService.getGuild(
      identity.bot.id,
      guildId,
      soundId,
      options,
    )
  }

  async checkSoundboardPlayback(
    request: SoundboardPlaybackCheckRequest,
    options: RequestOptions = {},
  ): Promise<SoundboardPlaybackReadiness> {
    const identity = await this.#verifyIdentity(options)
    return this.#soundboardPlaybackService.check(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async listScheduledEvents(
    guildId: string,
    includeSubscriberCount = false,
    options: RequestOptions = {},
  ): Promise<ScheduledEventInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#scheduledEventService.list(identity.bot.id, guildId, {
      ...options,
      includeSubscriberCount,
    })
  }

  async getScheduledEvent(
    guildId: string,
    eventId: string,
    includeSubscriberCount = false,
    options: RequestOptions = {},
  ): Promise<ScheduledEventLookupResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#scheduledEventService.get(identity.bot.id, guildId, eventId, {
      ...options,
      includeSubscriberCount,
    })
  }

  async listScheduledEventUsers(
    guildId: string,
    eventId: string,
    options: ScheduledEventUserPageOptions = {},
  ): Promise<ScheduledEventUserPageResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#scheduledEventService.listUsers(
      identity.bot.id,
      guildId,
      eventId,
      options,
    )
  }

  async listStageInstances(
    options: RequestOptions = {},
  ): Promise<StageInstanceInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#stageInstanceService.list(identity.bot.id, options)
  }

  async getStageInstance(
    guildId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<StageInstanceLookupResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#stageInstanceService.get(
      identity.bot.id,
      guildId,
      channelId,
      options,
    )
  }

  async getChannelWebhook(
    channelId: string,
    webhookId: string,
    options: RequestOptions = {},
  ): Promise<WebhookLookupResult> {
    this.#policy.assertChannelWebhookIdAuditable(channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.get(
      identity.bot.id,
      channelId,
      webhookId,
      options,
    )
  }

  async getWebhookMessage(
    request: WebhookMessageLookupRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageLookupResult> {
    this.#policy.assertWebhookMessageAuditEnabled()
    await this.#verifyIdentity(options)
    return this.#webhookMessages().get(request, options)
  }

  async sendWebhookMessage(
    request: WebhookMessageSendRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageWriteResult> {
    this.#policy.assertWebhookMessageDeliveryEnabled()
    await this.#verifyIdentity(options)
    const service = this.#webhookMessages()
    return this.#coordinateWrite(
      "webhook-message-send",
      request.operationKey,
      service.sendDigest(request),
      [writeResourceTarget("webhook", request.webhookId)],
      () => service.send(request, options),
    )
  }

  async editWebhookMessage(
    request: WebhookMessageEditRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageWriteResult> {
    this.#policy.assertWebhookMessageChangesEnabled()
    await this.#verifyIdentity(options)
    const service = this.#webhookMessages()
    return this.#coordinateWrite(
      "webhook-message-edit",
      request.operationKey,
      service.editDigest(request),
      [
        writeResourceTarget("message", request.messageId),
        writeResourceTarget("webhook", request.webhookId),
      ],
      () => service.edit(request, options),
    )
  }

  async planWebhookMessageDeletion(
    request: WebhookMessageDeletionRequest,
    options: RequestOptions = {},
  ): Promise<WebhookMessageDeletionPlan> {
    this.#policy.assertWebhookMessageDeletionsEnabled()
    const identity = await this.#verifyIdentity(options)
    return this.#webhookMessages().planDeletion(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async executeWebhookMessageDeletion(
    request: WebhookMessageDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookMessageDeletionResult> {
    this.#policy.assertWebhookMessageDeletionsEnabled()
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord webhook message deletion plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const service = this.#webhookMessages()
    return this.#coordinateWrite(
      "webhook-message-deletion",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("message", request.messageId),
        writeResourceTarget("webhook", request.webhookId),
      ],
      () => service.executeDeletion(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async planWebhookDeletion(
    request: WebhookDeletionRequest,
    options: RequestOptions = {},
  ): Promise<WebhookDeletionPlan> {
    normalizeWebhookDeletionRequest(request)
    this.#policy.assertChannelWebhookIdDeletable(request.channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planWebhookCreation(
    request: WebhookCreationRequest,
    options: RequestOptions = {},
  ): Promise<WebhookCreationPlan> {
    normalizeWebhookCreationRequest(request)
    this.#policy.assertChannelWebhookIdCreatable(request.channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.planCreation(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planWebhookChange(
    request: WebhookChangeRequest,
    options: RequestOptions = {},
  ): Promise<WebhookChangePlan> {
    normalizeWebhookChangeRequest(request)
    this.#policy.assertChannelWebhookIdChangeable(request.channelId)
    if (request.destinationChannelId !== undefined) {
      this.#policy.assertChannelWebhookIdChangeable(request.destinationChannelId)
    }
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.planChange(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildIntegrationDeletion(
    request: IntegrationDeletionRequest,
    options: RequestOptions = {},
  ): Promise<IntegrationDeletionPlan> {
    normalizeIntegrationDeletionRequest(request)
    this.#policy.assertGuildIntegrationDeletable(
      request.guildId,
      request.integrationId,
    )
    const identity = await this.#verifyIdentity(options)
    return this.#integrationService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildDeparture(
    request: GuildDepartureRequest,
    options: RequestOptions = {},
  ): Promise<GuildDeparturePlan> {
    const normalized = normalizeGuildDepartureRequest(request)
    this.#policy.assertGuildDepartureAllowed(normalized.guildId)
    const identity = await this.#verifyIdentity(options)
    return this.#guildDepartureService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planInviteDeletion(
    request: InviteDeletionRequest,
    options: RequestOptions = {},
  ): Promise<InviteDeletionPlan> {
    normalizeInviteDeletionRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#inviteService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planInviteCreation(
    request: InviteCreationRequest,
    options: RequestOptions = {},
  ): Promise<InviteCreationPlan> {
    normalizeInviteCreationRequest(request)
    this.#policy.assertGuildInviteCreatable(request.guildId, request.channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#inviteService.planCreation(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planOnboardingChange(
    request: OnboardingChangeRequest,
    options: RequestOptions = {},
  ): Promise<OnboardingChangePlan> {
    normalizeOnboardingChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#onboardingService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planWelcomeScreenChange(
    request: WelcomeScreenChangeRequest,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenChangePlan> {
    normalizeWelcomeScreenChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#welcomeScreenService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planWidgetSettingsChange(
    request: WidgetSettingsChangeRequest,
    options: RequestOptions = {},
  ): Promise<WidgetSettingsChangePlan> {
    normalizeWidgetSettingsChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#widgetSettingsService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildSettingsChange(
    request: GuildSettingsChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildSettingsChangePlan> {
    normalizeGuildSettingsChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildSettingsService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildCommunityChange(
    request: GuildCommunityChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildCommunityChangePlan> {
    normalizeGuildCommunityChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildCommunityService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildIncidentActionChange(
    request: GuildIncidentActionChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildIncidentActionChangePlan> {
    normalizeGuildIncidentActionChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildIncidentService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildProfileChange(
    request: GuildProfileChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildProfileChangePlan> {
    normalizeGuildProfileChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildProfileService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildExpressionChange(
    request: GuildExpressionChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildExpressionPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildExpressionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planApplicationEmojiChange(
    request: ApplicationEmojiChangeRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiPlan> {
    normalizeApplicationEmojiChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#applicationEmojiService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planApplicationTestEntitlementChange(
    request: ApplicationTestEntitlementChangeRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationTestEntitlementPlan> {
    const normalized = normalizeApplicationTestEntitlementChangeRequest(request)
    const beneficiary = normalized.beneficiary.type === "guild"
      ? { id: normalized.beneficiary.guildId, type: "guild" as const }
      : { id: normalized.beneficiary.userId, type: "user" as const }
    this.#policy.assertApplicationTestEntitlementChangeAllowed(
      beneficiary,
      normalized.skuId,
    )
    const identity = await this.#verifyIdentity(options)
    const skuAudit = await this.#applicationSkuAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
    return this.#applicationEntitlementService.planTestEntitlementChange(
      identity.application,
      identity.bot.id,
      skuAudit,
      request,
      options,
    )
  }

  async planApplicationEntitlementConsumption(
    request: ApplicationEntitlementConsumptionRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementConsumptionPlan> {
    const normalized = normalizeApplicationEntitlementConsumptionRequest(request)
    this.#policy.assertApplicationEntitlementConsumptionAllowed(
      normalized.userId,
      normalized.skuId,
    )
    const identity = await this.#verifyIdentity(options)
    const skuAudit = await this.#applicationSkuAuditService.audit(
      identity.application,
      identity.bot.id,
      options,
    )
    return this.#applicationEntitlementService.planEntitlementConsumption(
      identity.application,
      identity.bot.id,
      skuAudit,
      request,
      options,
    )
  }

  async planApplicationRoleConnectionMetadataChange(
    request: ApplicationRoleConnectionMetadataChangeRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationRoleConnectionMetadataPlan> {
    normalizeApplicationRoleConnectionMetadataChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#applicationRoleConnectionMetadataService.plan(
      identity.application,
      identity.bot.id,
      request,
      options,
    )
  }

  async planApplicationIntentEnablement(
    request: ApplicationIntentEnablementRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationIntentEnablementPlan> {
    const normalized = normalizeApplicationIntentEnablementRequest(request)
    this.#policy.assertApplicationIntentChangeAllowed()
    const requirements = this.#applicationPostureRequirements()
    applicationIntentPolicyRequirement(normalized.intent, requirements)
    const identity = await this.#verifyIdentity(options)
    return this.#applicationIntentService.plan(
      identity.application.id,
      identity.bot.id,
      requirements,
      request,
      options,
    )
  }

  async planBotProfileChange(
    request: BotProfileChangeRequest,
    options: RequestOptions = {},
  ): Promise<BotProfileChangePlan> {
    normalizeBotProfileChangeRequest(request)
    this.#policy.assertBotProfileChangeAllowed()
    const identity = await this.#verifyIdentity(options)
    return this.#botProfileService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planScheduledEventChange(
    request: ScheduledEventChangeRequest,
    options: RequestOptions = {},
  ): Promise<ScheduledEventPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#scheduledEventService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planSoundboardChange(
    request: SoundboardChangeRequest,
    options: RequestOptions = {},
  ): Promise<SoundboardPlan> {
    normalizeSoundboardChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#soundboardService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planStageInstanceChange(
    request: StageInstanceChangeRequest,
    options: RequestOptions = {},
  ): Promise<StageInstancePlan> {
    normalizeStageInstanceChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#stageInstanceService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planAutoModerationChange(
    request: AutoModerationChangeRequest,
    options: RequestOptions = {},
  ): Promise<AutoModerationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#automodService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planDirectMessageChange(
    request: DirectMessageChangeRequest,
    options: RequestOptions = {},
  ): Promise<DirectMessagePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#directMessages().plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async listChannelPermissionOverwrites(
    channelId: string,
    options: ChannelPermissionOverwriteListOptions = {},
  ): Promise<ChannelPermissionOverwriteListResult> {
    await this.#verifyIdentity(options)
    return this.#permissionOverwriteService.list(channelId, options)
  }

  async planChannelPermissionOverwrite(
    request: ChannelPermissionOverwriteRequest,
    options: RequestOptions = {},
  ): Promise<ChannelPermissionOverwritePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#permissionOverwriteService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planChannelPermissionSync(
    request: ChannelPermissionSyncRequest,
    options: RequestOptions = {},
  ): Promise<ChannelPermissionSyncPlan> {
    normalizeChannelPermissionSyncRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#permissionOverwriteService.planSync(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planChannelMetadataChange(
    request: ChannelMetadataChangeRequest,
    options: RequestOptions = {},
  ): Promise<ChannelMetadataChangePlan> {
    normalizeChannelMetadataChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#channelMetadataService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planVoiceChannelStatusChange(
    request: VoiceChannelStatusChangeRequest,
    options: RequestOptions = {},
  ): Promise<VoiceChannelStatusPlan> {
    normalizeVoiceChannelStatusChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#voiceChannelStatusService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planForumTagChange(
    request: ForumTagChangeRequest,
    options: RequestOptions = {},
  ): Promise<ForumTagChangePlan> {
    normalizeForumTagChangeRequest(request)
    this.#policy.assertForumTagChangeConfigured(request.channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#forumTagService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planMemberModeration(
    request: MemberModerationRequest,
    options: RequestOptions = {},
  ): Promise<MemberModerationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#administrationService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planBulkGuildBan(
    request: BulkGuildBanRequest,
    options: RequestOptions = {},
  ): Promise<BulkGuildBanPlan> {
    normalizeBulkGuildBanRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#bulkGuildBanService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildPrune(
    request: GuildPruneRequest,
    options: RequestOptions = {},
  ): Promise<GuildPrunePlan> {
    normalizeGuildPruneRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildPruneService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planMemberRoleChange(
    request: MemberRoleChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberRoleChangePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#memberRoleService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planBulkMemberRoleChange(
    request: BulkMemberRoleRequest,
    options: RequestOptions = {},
  ): Promise<BulkMemberRolePlan> {
    normalizeBulkMemberRoleRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#bulkMemberRoleService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planMemberNicknameChange(
    request: MemberNicknameChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberNicknameChangePlan> {
    normalizeMemberNicknameChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#memberNicknameService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planMemberVerificationChange(
    request: MemberVerificationChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberVerificationChangePlan> {
    normalizeMemberVerificationChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#memberVerificationService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planMemberVoiceChange(
    request: MemberVoiceChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberVoiceChangePlan> {
    normalizeMemberVoiceChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#memberVoiceService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planThreadChange(
    request: ThreadChangeRequest,
    options: RequestOptions = {},
  ): Promise<ThreadChangePlan> {
    normalizeThreadChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#threadGovernanceService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planChannelCreation(
    request: ChannelCreationRequest,
    options: RequestOptions = {},
  ): Promise<ChannelCreationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#channelAdministrationService.plan(identity.bot.id, request, options)
  }

  async planRoleCreation(
    request: RoleCreationRequest,
    options: RequestOptions = {},
  ): Promise<RoleCreationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#roleAdministrationService.plan(identity.bot.id, request, options)
  }

  async planRoleConfiguration(
    request: RoleConfigurationRequest,
    options: RequestOptions = {},
  ): Promise<RoleConfigurationPlan> {
    normalizeRoleConfigurationRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#roleConfigurationService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planRoleDeletion(
    request: RoleDeletionRequest,
    options: RequestOptions = {},
  ): Promise<RoleDeletionPlan> {
    normalizeRoleDeletionRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#roleDeletionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planRoleOrder(
    request: RoleOrderingRequest,
    options: RequestOptions = {},
  ): Promise<RoleOrderingPlan> {
    normalizeRoleOrderingRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#roleOrderingService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planChannelOrder(
    request: ChannelOrderingRequest,
    options: RequestOptions = {},
  ): Promise<ChannelOrderingPlan> {
    normalizeChannelOrderingRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#channelOrderingService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planChannelDeletion(
    request: ChannelDeletionRequest,
    options: RequestOptions = {},
  ): Promise<ChannelDeletionPlan> {
    normalizeChannelDeletionRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#channelDeletionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planChannelClone(
    request: ChannelCloneRequest,
    options: RequestOptions = {},
  ): Promise<ChannelClonePlan> {
    normalizeChannelCloneRequest(request)
    this.#policy.assertChannelCloneAuditable(request.guildId, request.sourceChannelId)
    const identity = await this.#verifyIdentity(options)
    return this.#channelCloneService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildScaffold(
    request: GuildScaffoldRequest,
    options: RequestOptions = {},
  ): Promise<GuildScaffoldPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildScaffoldService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planGuildBlueprint(
    request: GuildBlueprintRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildBlueprintService.plan(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async captureGuildBlueprint(
    request: GuildBlueprintCaptureRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintCaptureResult> {
    this.#guildBlueprintCaptureService.assertCaptureAllowed(request)
    const identity = await this.#verifyIdentity(options)
    return this.#guildBlueprintCaptureService.capture(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async verifyGuildBlueprint(
    request: GuildBlueprintRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintVerification> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildBlueprintService.verify(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async verifyGuildScaffold(
    request: GuildScaffoldRequest,
    options: RequestOptions = {},
  ): Promise<GuildScaffoldVerification> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildScaffoldService.verify(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planForumPost(
    request: ForumPostRequest,
    options: RequestOptions = {},
  ): Promise<ForumPostPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#forumPostService.plan(identity.bot.id, request, options)
  }

  async planThreadCreation(
    request: ThreadCreationRequest,
    options: RequestOptions = {},
  ): Promise<ThreadCreationPlan> {
    normalizeThreadCreationRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#threadCreationService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async getPoll(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#pollService.get(channelId, messageId, options)
  }

  async listPollAnswerVoters(
    channelId: string,
    messageId: string,
    answerId: number,
    options: PollVoterPageOptions = {},
  ): Promise<PollVoterListResult> {
    await this.#verifyIdentity(options)
    return this.#pollService.listAnswerVoters(
      channelId,
      messageId,
      answerId,
      options,
    )
  }

  async planPollCreation(
    request: PollCreationRequest,
    options: RequestOptions = {},
  ): Promise<PollCreationPlan> {
    normalizePollCreationRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#pollService.planCreation(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planPollEnd(
    request: PollEndRequest,
    options: RequestOptions = {},
  ): Promise<PollEndPlan> {
    normalizePollEndRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#pollService.planEnd(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
  }

  async planAttachmentMessage(
    request: AttachmentMessageRequest,
    options: RequestOptions = {},
  ): Promise<AttachmentMessagePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#attachmentMessageService.plan(identity.bot.id, request, options)
  }

  previewComponentLayout(
    components: readonly ComponentLayoutInput[],
    notifyUserIds?: readonly string[],
  ): ComponentLayoutReview {
    return reviewComponentLayout(components, notifyUserIds)
  }

  async planComponentMessage(
    request: ComponentMessageRequest,
    options: RequestOptions = {},
  ): Promise<ComponentMessagePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#componentMessageService.plan(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async verifyComponentMessage(
    request: ComponentMessageRequest,
    options: RequestOptions = {},
  ): Promise<ComponentMessageVerificationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#componentMessageService.verify(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  previewEmbedMessage(
    presentation: {
      content?: string
      embeds: readonly EmbedLayoutInput[]
    },
    notifyUserIds?: readonly string[],
  ): EmbedPresentationReview {
    return reviewEmbedPresentation(presentation, notifyUserIds)
  }

  async planEmbedMessage(
    request: EmbedMessageRequest,
    options: RequestOptions = {},
  ): Promise<EmbedMessagePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#embedMessageService.plan(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async verifyEmbedMessage(
    request: EmbedMessageRequest,
    options: RequestOptions = {},
  ): Promise<EmbedMessageVerificationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#embedMessageService.verify(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      options,
    )
  }

  async executeChannelCreation(
    request: ChannelCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelCreationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "channel-creation",
      request.operationKey,
      planDigest,
      [
        writeGuildCollectionTarget("channels", request.guildId),
        ...(request.parentId
          ? [writeResourceTarget("channel", request.parentId)]
          : []),
      ],
      () => this.#channelAdministrationService.execute(
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeChannelMetadataChange(
    request: ChannelMetadataChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelMetadataChangeResult> {
    normalizeChannelMetadataChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord channel metadata plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "channel-metadata-change",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeGuildCollectionTarget("channels", request.guildId),
      ],
      () => this.#channelMetadataService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeVoiceChannelStatusChange(
    request: VoiceChannelStatusChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<VoiceChannelStatusResult> {
    normalizeVoiceChannelStatusChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord voice channel status plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#voiceChannelStatusService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new VoiceChannelStatusPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    const execute = () => this.#voiceChannelStatusService.execute(
      identity.application.id,
      identity.bot.id,
      request,
      planDigest,
      options,
    )
    if (!coordinationPlan.writeRequired) return execute()
    return this.#coordinateWrite(
      "voice-channel-status-change",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeGuildCollectionTarget("channels", request.guildId),
      ],
      execute,
    )
  }

  async executeForumTagChange(
    request: ForumTagChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ForumTagChangeResult> {
    normalizeForumTagChangeRequest(request)
    this.#policy.assertForumTagChangeConfigured(request.channelId)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord forum-tag plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "forum-tag-change",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeGuildCollectionTarget("channels", request.guildId),
      ],
      () => this.#forumTagService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeRoleCreation(
    request: RoleCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleCreationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "role-creation",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("roles", request.guildId)],
      () => this.#roleAdministrationService.execute(
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeRoleConfiguration(
    request: RoleConfigurationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleConfigurationResult> {
    normalizeRoleConfigurationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord role-configuration plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "role-configuration",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("role", request.roleId),
        writeGuildCollectionTarget("roles", request.guildId),
      ],
      () => this.#roleConfigurationService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeRoleDeletion(
    request: RoleDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleDeletionResult> {
    normalizeRoleDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord role-deletion plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#roleDeletionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new RoleDeletionPlanChangedError(planDigest, coordinationPlan.digest)
    }
    if (!coordinationPlan.writeRequired) {
      return this.#roleDeletionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "role-deletion",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("role", request.roleId),
        writeGuildCollectionTarget("roles", request.guildId),
        writeGuildCollectionTarget("channels", request.guildId),
        writeGuildCollectionTarget("invites", request.guildId),
        writeGuildCollectionTarget("emojis", request.guildId),
        writeGuildCollectionTarget("onboarding", request.guildId),
        writeGuildCollectionTarget("automod", request.guildId),
        writeGuildCollectionTarget("integrations", request.guildId),
        writeGuildCollectionTarget("application-commands", request.guildId),
        writeGuildCollectionTarget("members", request.guildId),
      ],
      () => this.#roleDeletionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeRoleOrder(
    request: RoleOrderingRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleOrderingResult> {
    normalizeRoleOrderingRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord role-ordering plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#roleOrderingService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new RoleOrderingPlanChangedError(planDigest, coordinationPlan.digest)
    }
    if (!coordinationPlan.writeRequired) {
      return this.#roleOrderingService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "role-ordering",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("role", request.roleId),
        writeResourceTarget("role", request.anchorRoleId),
        writeGuildCollectionTarget("roles", request.guildId),
      ],
      () => this.#roleOrderingService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeChannelOrder(
    request: ChannelOrderingRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelOrderingResult> {
    normalizeChannelOrderingRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord channel-ordering plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#channelOrderingService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new ChannelOrderingPlanChangedError(planDigest, coordinationPlan.digest)
    }
    if (!coordinationPlan.writeRequired) {
      return this.#channelOrderingService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "channel-ordering",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("channel", request.anchorChannelId),
        ...(coordinationPlan.sourceParentChannelId
          ? [writeResourceTarget("channel", coordinationPlan.sourceParentChannelId)]
          : []),
        ...(coordinationPlan.destinationParentChannelId
          && coordinationPlan.destinationParentChannelId
            !== coordinationPlan.sourceParentChannelId
          ? [writeResourceTarget("channel", coordinationPlan.destinationParentChannelId)]
          : []),
        writeGuildCollectionTarget("channels", request.guildId),
      ],
      () => this.#channelOrderingService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeChannelDeletion(
    request: ChannelDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelDeletionResult> {
    normalizeChannelDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord channel-deletion plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#channelDeletionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new ChannelDeletionPlanChangedError(planDigest, coordinationPlan.digest)
    }
    if (!coordinationPlan.writeRequired) {
      return this.#channelDeletionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "channel-deletion",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        ...(coordinationPlan.target.parentChannelId
          ? [writeResourceTarget("channel", coordinationPlan.target.parentChannelId)]
          : []),
        writeGuildCollectionTarget("channels", request.guildId),
      ],
      () => this.#channelDeletionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeChannelClone(
    request: ChannelCloneRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelCloneResult> {
    normalizeChannelCloneRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord channel-clone plan digest is invalid")
    }
    this.#policy.assertChannelCloneable(request.guildId, request.sourceChannelId)
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#channelCloneService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new ChannelClonePlanChangedError(planDigest, coordinationPlan.digest)
    }
    return this.#coordinateWrite(
      "channel-clone",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.sourceChannelId),
        writeGuildCollectionTarget("channels", request.guildId),
      ],
      () => this.#channelCloneService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeMemberRoleChange(
    request: MemberRoleChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberRoleChangeResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "member-role-change",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("member", request.userId),
        writeResourceTarget("role", request.roleId),
        writeGuildCollectionTarget("members", request.guildId),
      ],
      () => this.#memberRoleService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeBulkMemberRoleChange(
    request: BulkMemberRoleRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<BulkMemberRoleResult> {
    const normalized = normalizeBulkMemberRoleRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord bulk member-role plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#bulkMemberRoleService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new BulkMemberRolePlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    const execute = () => this.#bulkMemberRoleService.execute(
      identity.application.id,
      identity.bot.id,
      request,
      planDigest,
      options,
    )
    if (
      coordinationPlan.status === "completed"
      || (
        coordinationPlan.status === "already-current"
        && coordinationPlan.operation.status === "unreserved"
      )
    ) return execute()
    return this.#coordinateWrite(
      "bulk-member-role-change",
      normalized.operationKey,
      coordinationPlan.operation.requestDigest,
      [
        writeGuildCollectionTarget("members", normalized.guildId),
        writeResourceTarget("role", normalized.roleId),
        ...normalized.userIds.map((userId) => writeResourceTarget("member", userId)),
      ],
      execute,
      { releasePendingOnVerifiedPause: true },
    )
  }

  async executeMemberNicknameChange(
    request: MemberNicknameChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberNicknameChangeResult> {
    const normalized = normalizeMemberNicknameChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    const userId = normalized.target.kind === "current-bot"
      ? identity.bot.id
      : normalized.target.userId
    return this.#coordinateWrite(
      "member-nickname-change",
      normalized.operationKey,
      planDigest,
      [
        writeResourceTarget("member", userId),
        writeGuildCollectionTarget("members", normalized.guildId),
      ],
      () => this.#memberNicknameService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeMemberVerificationChange(
    request: MemberVerificationChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberVerificationChangeResult> {
    const normalized = normalizeMemberVerificationChangeRequest(request)
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "member-verification-change",
      normalized.operationKey,
      planDigest,
      [
        writeResourceTarget("member", normalized.userId),
        writeGuildCollectionTarget("members", normalized.guildId),
      ],
      () => this.#memberVerificationService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeMemberVoiceChange(
    request: MemberVoiceChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberVoiceChangeResult> {
    normalizeMemberVoiceChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord member voice plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "member-voice-change",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("member", request.userId),
        writeGuildCollectionTarget("members", request.guildId),
      ],
      () => this.#memberVoiceService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeThreadChange(
    request: ThreadChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ThreadChangeResult> {
    normalizeThreadChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord thread-governance plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "thread-governance-change",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.threadId),
        ...(["add-member", "remove-member"].includes(request.action)
          ? [
              writeResourceTarget(
                "member",
                (request as Extract<ThreadChangeRequest, {
                  action: "add-member" | "remove-member"
                }>).userId,
              ),
              writeGuildCollectionTarget("members", request.guildId),
            ]
          : []),
      ],
      () => this.#threadGovernanceService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildScaffold(
    request: GuildScaffoldRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildScaffoldResult> {
    const normalized = normalizeGuildScaffoldRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild scaffold plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#guildScaffoldService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new GuildScaffoldPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    const execute = () => this.#guildScaffoldService.execute(
      identity.application.id,
      identity.bot.id,
      request,
      planDigest,
      options,
    )
    if (
      coordinationPlan.status === "completed"
      || (
        coordinationPlan.status === "already-current"
        && coordinationPlan.operation.status === "unreserved"
      )
    ) {
      return execute()
    }
    return this.#coordinateWrite(
      "guild-scaffold",
      request.operationKey,
      coordinationPlan.operation.requestDigest,
      [
        writeGuildCollectionTarget("channels", normalized.guildId),
        writeGuildCollectionTarget("roles", normalized.guildId),
      ],
      execute,
      { releasePendingOnVerifiedPause: true },
    )
  }

  async executeGuildBlueprint(
    request: GuildBlueprintRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildBlueprintService.execute(
      identity.application.id,
      identity.bot.id,
      applicationMessageContentIntent(identity.application),
      request,
      planDigest,
      {
        executeAutoModeration: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeAutoModerationChange(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeComponent: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeComponentMessage(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeCommunity: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeGuildCommunityChange(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeOnboarding: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeOnboardingChange(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeProfile: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeGuildProfileChange(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeScaffold: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeGuildScaffold(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeSettings: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeGuildSettingsChange(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
        executeWelcomeScreen: (nestedRequest, nestedDigest, nestedOptions) => (
          this.executeWelcomeScreenChange(
            nestedRequest,
            nestedDigest,
            nestedOptions,
          )
        ),
      },
      options,
    )
  }

  async executeForumPost(
    request: ForumPostRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ForumPostResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "forum-post",
      request.operationKey,
      planDigest,
      [writeResourceTarget("channel", request.channelId)],
      () => this.#forumPostService.execute(
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeThreadCreation(
    request: ThreadCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ThreadCreationResult> {
    normalizeThreadCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord thread-creation plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "thread-create",
      request.operationKey,
      planDigest,
      [writeResourceTarget("channel", request.parentChannelId)],
      () => this.#threadCreationService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executePollCreation(
    request: PollCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<PollCreationResult> {
    normalizePollCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord poll-creation plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "poll-create",
      request.operationKey,
      planDigest,
      [writeResourceTarget("channel", request.channelId)],
      () => this.#pollService.executeCreation(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executePollEnd(
    request: PollEndRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<PollEndResult> {
    normalizePollEndRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord poll-end plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "poll-end",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("message", request.messageId),
      ],
      () => this.#pollService.executeEnd(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeAttachmentMessage(
    request: AttachmentMessageRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<AttachmentMessageResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "attachment-message",
      request.operationKey,
      planDigest,
      [writeResourceTarget("channel", request.channelId)],
      () => this.#attachmentMessageService.execute(
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeComponentMessage(
    request: ComponentMessageRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ComponentMessageResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord component-message plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const intent = applicationMessageContentIntent(identity.application)
    const coordinationPlan = await this.#componentMessageService.plan(
      identity.application.id,
      identity.bot.id,
      intent,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new ComponentMessagePlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    const execute = () => this.#componentMessageService.execute(
      identity.application.id,
      identity.bot.id,
      intent,
      request,
      planDigest,
      options,
    )
    if (!coordinationPlan.writeRequired) return execute()
    const target = request.action === "create"
      ? writeResourceTarget("channel", request.channelId)
      : writeResourceTarget("message", request.messageId as string)
    return this.#coordinateWrite(
      "component-message",
      request.operationKey,
      planDigest,
      [target],
      execute,
    )
  }

  async executeEmbedMessage(
    request: EmbedMessageRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<EmbedMessageResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord embed-message plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const intent = applicationMessageContentIntent(identity.application)
    const coordinationPlan = await this.#embedMessageService.plan(
      identity.application.id,
      identity.bot.id,
      intent,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new EmbedMessagePlanChangedError(planDigest, coordinationPlan.digest)
    }
    const execute = () => this.#embedMessageService.execute(
      identity.application.id,
      identity.bot.id,
      intent,
      request,
      planDigest,
      options,
    )
    if (!coordinationPlan.writeRequired) return execute()
    const target = request.action === "create"
      ? writeResourceTarget("channel", request.channelId)
      : writeResourceTarget("message", request.messageId as string)
    return this.#coordinateWrite(
      "embed-message",
      request.operationKey,
      planDigest,
      [target],
      execute,
    )
  }

  async executeMemberModeration(
    request: MemberModerationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberModerationResult> {
    const normalized = normalizeMemberModerationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord administration plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "member-moderation",
      normalized.operationKey,
      planDigest,
      [
        writeResourceTarget("member", normalized.userId),
        writeGuildCollectionTarget("members", normalized.guildId),
      ],
      () => this.#administrationService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeBulkGuildBan(
    request: BulkGuildBanRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<BulkGuildBanResult> {
    const normalized = normalizeBulkGuildBanRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord bulk guild ban plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "bulk-guild-ban",
      normalized.operationKey,
      planDigest,
      [
        writeGuildCollectionTarget("members", normalized.guildId),
        ...normalized.userIds.map((userId) => writeResourceTarget("member", userId)),
      ],
      () => this.#bulkGuildBanService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildPrune(
    request: GuildPruneRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildPruneResult> {
    const normalized = normalizeGuildPruneRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild prune plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const execute = () => this.#guildPruneService.execute(
      identity.application.id,
      identity.bot.id,
      request,
      planDigest,
      options,
    )
    const coordinationPlan = await this.#guildPruneService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new GuildPrunePlanChangedError(planDigest, coordinationPlan.digest)
    }
    if (!coordinationPlan.writeRequired) return execute()
    return this.#coordinateWrite(
      "guild-prune",
      normalized.operationKey,
      planDigest,
      [
        writeGuildCollectionTarget("members", normalized.guildId),
        writeResourceTarget("role", normalized.guildId),
        ...normalized.includeRoleIds.map((roleId) => writeResourceTarget("role", roleId)),
      ],
      execute,
    )
  }

  async deleteMessages(
    request: DeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<DeletionResult> {
    const normalized = normalizeDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord message deletion plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const messageContentIntent = applicationMessageContentIntent(identity.application)
    const coordinationPlan = await this.#deletionService.plan(
      identity.application.id,
      identity.bot.id,
      messageContentIntent,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new DeletionPlanChangedError(planDigest, coordinationPlan.digest)
    }
    return this.#coordinateWrite(
      "message-deletion",
      request.operationKey,
      planDigest,
      normalized.messageIds.map((messageId) => (
        writeResourceTarget("message", messageId)
      )),
      () => this.#deletionService.execute(
        identity.application.id,
        identity.bot.id,
        messageContentIntent,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeMessagePin(
    request: MessagePinRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MessagePinResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "message-pin",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("message", request.messageId),
      ],
      () => this.#messagePinService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeReactionModeration(
    request: ReactionModerationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ReactionModerationResult> {
    const normalized = normalizeReactionModerationRequest(request)
    this.#policy.assertChannelReactionIdModeratable(request.channelId)
    if (normalized.userId !== null) {
      this.#policy.assertUserNotProtected(normalized.userId)
    }
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord reaction-moderation plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#reactionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new ReactionModerationPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    if (!coordinationPlan.writeRequired) {
      return this.#reactionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "reaction-moderation",
      request.operationKey,
      planDigest,
      [writeResourceTarget("message", request.messageId)],
      () => this.#reactionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeAnnouncementCrosspost(
    request: AnnouncementCrosspostRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<AnnouncementCrosspostResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "announcement-crosspost",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("message", request.messageId),
      ],
      () => this.#announcementCrosspostService.execute(
        identity.application.id,
        identity.bot.id,
        applicationMessageContentIntent(identity.application),
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeMessageForward(
    request: MessageForwardRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MessageForwardResult> {
    const normalized = normalizeMessageForwardRequest(request)
    this.#policy.assertMessageForwardSourceConfigured(normalized.sourceChannelId)
    this.#policy.assertMessageForwardTargetConfigured(normalized.targetChannelId)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord message-forward plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "message-forward",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("message", request.sourceMessageId),
        writeResourceTarget("channel", request.targetChannelId),
      ],
      () => this.#messageForwardingService.execute(
        identity.application.id,
        identity.bot.id,
        applicationMessageContentIntent(identity.application),
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeAnnouncementSubscription(
    request: AnnouncementSubscriptionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<AnnouncementSubscriptionResult> {
    const normalized = normalizeAnnouncementSubscriptionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord announcement subscription plan digest is invalid")
    }
    this.#policy.assertAnnouncementSubscriptionTargetIdChangeable(
      normalized.targetChannelId,
    )
    if (normalized.action === "subscribe") {
      this.#policy.assertAnnouncementSubscriptionSourceIdChangeable(
        normalized.sourceChannelId,
      )
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#announcementSubscriptionService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new AnnouncementSubscriptionPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    if (!coordinationPlan.writeRequired) {
      return this.#announcementSubscriptionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    const targets = [
      writeResourceTarget("channel", normalized.targetChannelId),
      writeGuildCollectionTarget("webhooks", coordinationPlan.target.guild.id),
    ]
    if (normalized.action === "subscribe") {
      targets.push(writeResourceTarget("channel", normalized.sourceChannelId))
    } else {
      targets.push(writeResourceTarget("webhook", normalized.webhookId))
    }
    return this.#coordinateWrite(
      "announcement-subscription",
      normalized.operationKey,
      planDigest,
      targets,
      () => this.#announcementSubscriptionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildApplicationCommandChange(
    request: GuildApplicationCommandChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildApplicationCommandResult> {
    const normalized = normalizeGuildApplicationCommandChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild application-command plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#guildApplicationCommandService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new GuildApplicationCommandPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    if (!coordinationPlan.writeRequired) {
      return this.#guildApplicationCommandService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "guild-application-command-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("application-commands", normalized.guildId)],
      () => this.#guildApplicationCommandService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGlobalApplicationCommandChange(
    request: GlobalApplicationCommandChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GlobalApplicationCommandResult> {
    normalizeGlobalApplicationCommandChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord global application-command plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#globalApplicationCommandService.plan(
      identity.application,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new GlobalApplicationCommandPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    if (!coordinationPlan.writeRequired) {
      return this.#globalApplicationCommandService.execute(
        identity.application,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    return this.#coordinateWrite(
      "global-application-command-change",
      request.operationKey,
      planDigest,
      [writeApplicationCollectionTarget(
        "global-application-commands",
        identity.application.id,
      )],
      () => this.#globalApplicationCommandService.execute(
        identity.application,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeNativeInteractionCommand(
    request: NativeInteractionCommandRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<NativeInteractionCommandResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "native-interaction-command-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("application-commands", request.guildId)],
      () => this.#nativeInteractionCommandService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildTemplateChange(
    request: GuildTemplateChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildTemplateChangeResult> {
    normalizeGuildTemplateChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild-template plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-template-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("templates", request.guildId)],
      () => this.#guildTemplateService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeWebhookDeletion(
    request: WebhookDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookDeletionResult> {
    normalizeWebhookDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord webhook deletion plan digest is invalid")
    }
    this.#policy.assertChannelWebhookIdDeletable(request.channelId)
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#webhookService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new WebhookDeletionPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    return this.#coordinateWrite(
      "webhook-deletion",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("webhook", request.webhookId),
        writeGuildCollectionTarget("webhooks", coordinationPlan.guild.id),
      ],
      () => this.#webhookService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeWebhookCreation(
    request: WebhookCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookCreationResult> {
    normalizeWebhookCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord webhook creation plan digest is invalid")
    }
    this.#policy.assertChannelWebhookIdCreatable(request.channelId)
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#webhookService.planCreation(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new WebhookCreationPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    return this.#coordinateWrite(
      "webhook-creation",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeGuildCollectionTarget("webhooks", coordinationPlan.guild.id),
      ],
      () => this.#webhookService.executeCreation(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeWebhookChange(
    request: WebhookChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookChangeResult> {
    normalizeWebhookChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord webhook change plan digest is invalid")
    }
    this.#policy.assertChannelWebhookIdChangeable(request.channelId)
    if (request.destinationChannelId !== undefined) {
      this.#policy.assertChannelWebhookIdChangeable(request.destinationChannelId)
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#webhookService.planChange(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new WebhookChangePlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    if (!coordinationPlan.writeRequired) {
      return this.#webhookService.executeChange(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      )
    }
    const targets = [
      writeResourceTarget("channel", request.channelId),
      writeResourceTarget("webhook", request.webhookId),
      writeGuildCollectionTarget("webhooks", coordinationPlan.guild.id),
    ]
    if (coordinationPlan.desired.channelId !== request.channelId) {
      targets.push(writeResourceTarget(
        "channel",
        coordinationPlan.desired.channelId,
      ))
    }
    return this.#coordinateWrite(
      "webhook-change",
      request.operationKey,
      planDigest,
      targets,
      () => this.#webhookService.executeChange(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildIntegrationDeletion(
    request: IntegrationDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<IntegrationDeletionResult> {
    normalizeIntegrationDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord integration deletion plan digest is invalid")
    }
    this.#policy.assertGuildIntegrationDeletable(
      request.guildId,
      request.integrationId,
    )
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#integrationService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new IntegrationDeletionPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    const targets: WriteCoordinationTarget[] = [
      writeResourceTarget("integration", request.integrationId),
      writeGuildCollectionTarget("integrations", request.guildId),
      writeGuildCollectionTarget("members", request.guildId),
      writeGuildCollectionTarget("webhooks", request.guildId),
    ]
    if (coordinationPlan.target.associatedBotUserId !== null) {
      targets.push(writeResourceTarget(
        "member",
        coordinationPlan.target.associatedBotUserId,
      ))
    }
    return this.#coordinateWrite(
      "integration-deletion",
      request.operationKey,
      planDigest,
      targets,
      () => this.#integrationService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildDeparture(
    request: GuildDepartureRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildDepartureResult> {
    const normalized = normalizeGuildDepartureRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild departure plan digest is invalid")
    }
    this.#policy.assertGuildDepartureAllowed(normalized.guildId)
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#guildDepartureService.plan(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new GuildDeparturePlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    return this.#coordinateWrite(
      "guild-departure",
      request.operationKey,
      planDigest,
      writeGuildDepartureTargets(normalized.guildId),
      () => this.#guildDepartureService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeInviteDeletion(
    request: InviteDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<InviteDeletionResult> {
    normalizeInviteDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord invite deletion plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "invite-deletion",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("invites", request.guildId)],
      () => this.#inviteService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeInviteCreation(
    request: InviteCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<InviteCreationResult> {
    const normalized = normalizeInviteCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord invite-creation plan digest is invalid")
    }
    this.#policy.assertGuildInviteCreatable(request.guildId, request.channelId)
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "invite-creation",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeGuildCollectionTarget("invites", request.guildId),
        ...(normalized.roleAssignment.kind === "grant"
          ? normalized.roleAssignment.roleIds.map((roleId) => (
              writeResourceTarget("role", roleId)
            ))
          : []),
      ],
      () => this.#inviteService.executeCreation(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeOnboardingChange(
    request: OnboardingChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<OnboardingChangeResult> {
    normalizeOnboardingChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord onboarding plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "onboarding-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("onboarding", request.guildId)],
      () => this.#onboardingService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeWelcomeScreenChange(
    request: WelcomeScreenChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenChangeResult> {
    normalizeWelcomeScreenChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord Welcome Screen plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "welcome-screen-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("welcome-screen", request.guildId)],
      () => this.#welcomeScreenService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeWidgetSettingsChange(
    request: WidgetSettingsChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WidgetSettingsChangeResult> {
    normalizeWidgetSettingsChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord widget-settings plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "widget-settings-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("widget-settings", request.guildId)],
      () => this.#widgetSettingsService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildSettingsChange(
    request: GuildSettingsChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildSettingsChangeResult> {
    normalizeGuildSettingsChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild-settings plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-settings-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("guild-settings", request.guildId)],
      () => this.#guildSettingsService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildCommunityChange(
    request: GuildCommunityChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildCommunityChangeResult> {
    normalizeGuildCommunityChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild Community plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-community-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("community", request.guildId)],
      () => this.#guildCommunityService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildIncidentActionChange(
    request: GuildIncidentActionChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildIncidentActionChangeResult> {
    normalizeGuildIncidentActionChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild incident-action plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-incident-action-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("incident-actions", request.guildId)],
      () => this.#guildIncidentService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildProfileChange(
    request: GuildProfileChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildProfileChangeResult> {
    normalizeGuildProfileChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild profile plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-profile-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("guild-settings", request.guildId)],
      () => this.#guildProfileService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeGuildExpressionChange(
    request: GuildExpressionChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildExpressionResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-expression-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget(
        request.kind === "emoji" ? "emojis" : "stickers",
        request.guildId,
      )],
      () => this.#guildExpressionService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeApplicationEmojiChange(
    request: ApplicationEmojiChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiResult> {
    normalizeApplicationEmojiChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord application emoji plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "application-emoji-change",
      request.operationKey,
      planDigest,
      [writeApplicationCollectionTarget("emojis", identity.application.id)],
      () => this.#applicationEmojiService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeApplicationTestEntitlementChange(
    request: ApplicationTestEntitlementChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementChangeResult> {
    const normalized = normalizeApplicationTestEntitlementChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord application test entitlement plan digest is invalid")
    }
    const beneficiary = normalized.beneficiary.type === "guild"
      ? { id: normalized.beneficiary.guildId, type: "guild" as const }
      : { id: normalized.beneficiary.userId, type: "user" as const }
    this.#policy.assertApplicationTestEntitlementChangeAllowed(
      beneficiary,
      normalized.skuId,
    )
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "application-entitlement-change",
      request.operationKey,
      planDigest,
      [writeApplicationCollectionTarget("entitlements", identity.application.id)],
      async () => {
        const skuAudit = await this.#applicationSkuAuditService.audit(
          identity.application,
          identity.bot.id,
          options,
        )
        return this.#applicationEntitlementService.executeTestEntitlementChange(
          identity.application,
          identity.bot.id,
          skuAudit,
          request,
          planDigest,
          options,
        )
      },
    )
  }

  async executeApplicationEntitlementConsumption(
    request: ApplicationEntitlementConsumptionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementChangeResult> {
    const normalized = normalizeApplicationEntitlementConsumptionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord application entitlement consumption plan digest is invalid")
    }
    this.#policy.assertApplicationEntitlementConsumptionAllowed(
      normalized.userId,
      normalized.skuId,
    )
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "application-entitlement-change",
      request.operationKey,
      planDigest,
      [writeApplicationCollectionTarget("entitlements", identity.application.id)],
      async () => {
        const skuAudit = await this.#applicationSkuAuditService.audit(
          identity.application,
          identity.bot.id,
          options,
        )
        return this.#applicationEntitlementService.executeEntitlementConsumption(
          identity.application,
          identity.bot.id,
          skuAudit,
          request,
          planDigest,
          options,
        )
      },
    )
  }

  async executeApplicationRoleConnectionMetadataChange(
    request: ApplicationRoleConnectionMetadataChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationRoleConnectionMetadataResult> {
    normalizeApplicationRoleConnectionMetadataChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord linked-role metadata plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "application-role-connection-metadata-change",
      request.operationKey,
      planDigest,
      [writeApplicationCollectionTarget(
        "role-connection-metadata",
        identity.application.id,
      )],
      () => this.#applicationRoleConnectionMetadataService.execute(
        identity.application,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeApplicationIntentEnablement(
    request: ApplicationIntentEnablementRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationIntentEnablementResult> {
    const normalized = normalizeApplicationIntentEnablementRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord application intent plan digest is invalid")
    }
    this.#policy.assertApplicationIntentChangeAllowed()
    const requirements = this.#applicationPostureRequirements()
    applicationIntentPolicyRequirement(normalized.intent, requirements)
    const identity = await this.#verifyIdentity(options)
    try {
      return await this.#coordinateWrite(
        "application-intent-enablement",
        request.operationKey,
        planDigest,
        [writeApplicationCollectionTarget(
          "privileged-intents",
          identity.application.id,
        )],
        () => this.#applicationIntentService.execute(
          identity.application.id,
          identity.bot.id,
          requirements,
          request,
          planDigest,
          options,
        ),
      )
    } finally {
      this.#identityPromise = undefined
    }
  }

  async executeBotProfileChange(
    request: BotProfileChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<BotProfileChangeResult> {
    normalizeBotProfileChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord bot-profile plan digest is invalid")
    }
    this.#policy.assertBotProfileChangeAllowed()
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "bot-profile-change",
      request.operationKey,
      planDigest,
      [writeApplicationCollectionTarget(
        "bot-profile",
        identity.application.id,
      )],
      () => this.#botProfileService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeScheduledEventChange(
    request: ScheduledEventChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ScheduledEventResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "scheduled-event-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("scheduled-events", request.guildId)],
      () => this.#scheduledEventService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeSoundboardChange(
    request: SoundboardChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<SoundboardResult> {
    normalizeSoundboardChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord soundboard plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "guild-soundboard-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("soundboard", request.guildId)],
      () => this.#soundboardService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async playSoundboardSound(
    request: SoundboardPlaybackRequest,
    options: RequestOptions = {},
  ): Promise<SoundboardPlaybackResult> {
    const expectedApplicationId = this.#config.expectedApplicationId
    const expectedBotId = this.#config.expectedBotId
    if (expectedApplicationId && expectedBotId) {
      const replay = await this.#soundboardPlaybackService.replay(
        expectedApplicationId,
        expectedBotId,
        request,
      )
      if (replay) return replay
    }
    const identity = await this.#verifyIdentity(options)
    const requestDigest = this.#soundboardPlaybackService.requestDigest(
      identity.application.id,
      identity.bot.id,
      request,
    )
    return this.#coordinateWrite(
      "soundboard-playback",
      request.operationKey,
      requestDigest,
      [writeResourceTarget("channel", request.channelId)],
      () => this.#soundboardPlaybackService.play(
        identity.application.id,
        identity.bot.id,
        request,
        options,
      ),
    )
  }

  async executeStageInstanceChange(
    request: StageInstanceChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<StageInstanceResult> {
    normalizeStageInstanceChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord Stage-instance plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "stage-instance-change",
      request.operationKey,
      planDigest,
      [writeResourceTarget("channel", request.channelId)],
      () => this.#stageInstanceService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeAutoModerationChange(
    request: AutoModerationChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<AutoModerationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "automod-change",
      request.operationKey,
      planDigest,
      [writeGuildCollectionTarget("automod", request.guildId)],
      () => this.#automodService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeDirectMessageChange(
    request: DirectMessageChangeRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<DirectMessageChangeResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#directMessages().execute(
      identity.application.id,
      identity.bot.id,
      request,
      planDigest,
      options,
    )
  }

  async executeChannelPermissionOverwrite(
    request: ChannelPermissionOverwriteRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelPermissionOverwriteResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "channel-permission-overwrite",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget(
          request.targetType === "role" ? "role" : "member",
          request.targetId,
        ),
      ],
      () => this.#permissionOverwriteService.execute(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async executeChannelPermissionSync(
    request: ChannelPermissionSyncRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelPermissionSyncResult> {
    normalizeChannelPermissionSyncRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord parent-category permission-sync plan digest is invalid")
    }
    const identity = await this.#verifyIdentity(options)
    const coordinationPlan = await this.#permissionOverwriteService.planSync(
      identity.application.id,
      identity.bot.id,
      request,
      options,
    )
    if (coordinationPlan.digest !== planDigest) {
      throw new ChannelPermissionSyncPlanChangedError(
        planDigest,
        coordinationPlan.digest,
      )
    }
    return this.#coordinateWrite(
      "channel-permission-sync",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("channel", coordinationPlan.parent.id),
      ],
      () => this.#permissionOverwriteService.executeSync(
        identity.application.id,
        identity.bot.id,
        request,
        planDigest,
        options,
      ),
    )
  }

  async sendMessage(
    request: SendMessageRequest,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    return this.#interactionService.sendMessage(identity.bot.id, request, options)
  }

  async signalCommandProcessing(
    request: SignalCommandProcessingRequest,
    options: RequestOptions = {},
  ): Promise<SignalCommandProcessingResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#interactionService.signalCommandProcessing(
      identity.bot.id,
      request,
      options,
    )
  }

  async editOwnMessage(
    request: EditOwnMessageRequest,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    return this.#interactionService.editOwnMessage(identity.bot.id, request, options)
  }

  async addReaction(
    request: AddReactionRequest,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#interactionService.addReaction(request, options)
  }

  async removeOwnReaction(
    request: RemoveOwnReactionRequest,
    options: RequestOptions = {},
  ): Promise<RemoveOwnReactionResult> {
    await this.#verifyIdentity(options)
    return this.#interactionService.removeOwnReaction(request, options)
  }

  listActivity(limit?: number): Promise<ActivityList> {
    return this.#activityStore.list(limit)
  }
}
