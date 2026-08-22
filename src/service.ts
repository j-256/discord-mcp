import type {
  ActivityList,
  ActivityStore,
} from "./activity-log.js"
import { JsonlActivityLog } from "./activity-log.js"
import type {
  AnnouncementCrosspostPlan,
  AnnouncementCrosspostRequest,
  AnnouncementCrosspostResult,
  AnnouncementCrosspostServiceOptions,
} from "./announcement-crosspost-service.js"
import { AnnouncementCrosspostService } from "./announcement-crosspost-service.js"
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
import type {
  AutoModerationChangeRequest,
  AutoModerationInventoryResult,
  AutoModerationLookupResult,
  AutoModerationPlan,
  AutoModerationResult,
  AutoModerationServiceOptions,
} from "./automod-service.js"
import { AutoModerationService } from "./automod-service.js"
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
import { AdministrationService } from "./administration-service.js"
import type {
  ChannelAdministrationServiceOptions,
  ChannelCreationPlan,
  ChannelCreationRequest,
  ChannelCreationResult,
} from "./channel-administration-service.js"
import { ChannelAdministrationService } from "./channel-administration-service.js"
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
  ChannelPermissionOverwriteListOptions,
  ChannelPermissionOverwriteListResult,
  ChannelPermissionOverwritePlan,
  ChannelPermissionOverwriteRequest,
  ChannelPermissionOverwriteResult,
  ChannelPermissionOverwriteServiceOptions,
} from "./channel-permission-overwrite-service.js"
import { ChannelPermissionOverwriteService } from "./channel-permission-overwrite-service.js"
import type { ConnectorConfig } from "./config.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_APPLICATION_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DeletionPlan,
  DeletionResult,
  DeletionServiceOptions,
} from "./deletion-service.js"
import { DeletionService } from "./deletion-service.js"
import type {
  DiscordClientOptions,
  GuildPageOptions,
  GuildMessageSearchOptions,
  MessagePinPageOptions,
  MessagePageOptions,
  PollVoterPageOptions,
} from "./discord-client.js"
import { DiscordClient } from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import type {
  ForumPostPlan,
  ForumPostRequest,
  ForumPostResult,
  ForumPostServiceOptions,
} from "./forum-post-service.js"
import { ForumPostService } from "./forum-post-service.js"
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
  GuildScaffoldPlan,
  GuildScaffoldRequest,
  GuildScaffoldResult,
  GuildScaffoldServiceOptions,
} from "./guild-scaffold-service.js"
import { GuildScaffoldService } from "./guild-scaffold-service.js"
import type {
  AddReactionRequest,
  EditOwnMessageRequest,
  InteractionServiceOptions,
  SendMessageRequest,
} from "./interaction-service.js"
import { InteractionService } from "./interaction-service.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import type {
  InviteDeletionPlan,
  InviteDeletionRequest,
  InviteDeletionResult,
  InviteInventoryResult,
  InviteListOptions,
  InviteLookupResult,
  InviteServiceOptions,
} from "./invite-service.js"
import {
  assertInviteGetInput,
  assertInviteListInput,
  InviteService,
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
  MemberDirectoryListOptions,
  MemberDirectorySearchOptions,
} from "./member-directory-service.js"
import { MemberDirectoryService } from "./member-directory-service.js"
import type {
  MemberRoleChangePlan,
  MemberRoleChangeRequest,
  MemberRoleChangeResult,
  MemberRoleServiceOptions,
} from "./member-role-service.js"
import { MemberRoleService } from "./member-role-service.js"
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
  normalizeSearchMessage,
} from "./normalize.js"
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
  ScheduledEventChangeRequest,
  ScheduledEventInventoryResult,
  ScheduledEventLookupResult,
  ScheduledEventPlan,
  ScheduledEventResult,
  ScheduledEventServiceOptions,
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
  WebhookDeletionPlan,
  WebhookDeletionRequest,
  WebhookDeletionResult,
  WebhookInventoryResult,
  WebhookLookupResult,
  WebhookServiceOptions,
} from "./webhook-service.js"
import { WebhookService } from "./webhook-service.js"
import {
  FileOperationStore,
  operationKeyHash,
  operationReceiptDirectory,
  type OperationKind,
  type OperationStore,
} from "./operation-store.js"
import {
  FileWriteCoordinator,
  writeCoordinationDirectory,
  writeGuildCollectionTarget,
  writeResourceTarget,
  type WriteCoordinationTarget,
  type WriteCoordinator,
} from "./write-coordination.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordMessageSearchIndexing,
  DiscordMessage,
  DiscordThreadList,
  DiscordUser,
  RequestOptions,
} from "./types.js"

export interface DiscordServiceClient {
  addThreadMember: DiscordClient["addThreadMember"]
  addGuildMemberRole: DiscordClient["addGuildMemberRole"]
  addOwnReaction: DiscordClient["addOwnReaction"]
  bulkDeleteMessages: DiscordClient["bulkDeleteMessages"]
  crosspostMessage: DiscordClient["crosspostMessage"]
  createGuildBan: DiscordClient["createGuildBan"]
  createGuildAutoModerationRule: DiscordClient["createGuildAutoModerationRule"]
  createGuildChannel: DiscordClient["createGuildChannel"]
  createGuildApplicationCommand: DiscordClient["createGuildApplicationCommand"]
  deleteGuildApplicationCommand: DiscordClient["deleteGuildApplicationCommand"]
  createGuildEmoji: DiscordClient["createGuildEmoji"]
  createGuildRole: DiscordClient["createGuildRole"]
  createGuildScheduledEvent: DiscordClient["createGuildScheduledEvent"]
  createGuildSoundboardSound: DiscordClient["createGuildSoundboardSound"]
  createGuildSticker: DiscordClient["createGuildSticker"]
  createStageInstance: DiscordClient["createStageInstance"]
  createForumPost: DiscordClient["createForumPost"]
  createAttachmentMessage: DiscordClient["createAttachmentMessage"]
  createMessage: DiscordClient["createMessage"]
  createPoll: DiscordClient["createPoll"]
  createThreadFromMessage: DiscordClient["createThreadFromMessage"]
  createThreadWithoutMessage: DiscordClient["createThreadWithoutMessage"]
  deleteChannelPermissionOverwrite: DiscordClient["deleteChannelPermissionOverwrite"]
  deleteGuildAutoModerationRule: DiscordClient["deleteGuildAutoModerationRule"]
  deleteMessage: DiscordClient["deleteMessage"]
  deleteGuildEmoji: DiscordClient["deleteGuildEmoji"]
  deleteGuildScheduledEvent: DiscordClient["deleteGuildScheduledEvent"]
  deleteGuildSoundboardSound: DiscordClient["deleteGuildSoundboardSound"]
  deleteGuildSticker: DiscordClient["deleteGuildSticker"]
  deleteStageInstance: DiscordClient["deleteStageInstance"]
  deleteInvite: DiscordClient["deleteInvite"]
  deleteWebhook: DiscordClient["deleteWebhook"]
  endPoll: DiscordClient["endPoll"]
  editChannelPermissionOverwrite: DiscordClient["editChannelPermissionOverwrite"]
  editMessage: DiscordClient["editMessage"]
  getChannel: DiscordClient["getChannel"]
  getGuildChannelMetadata: DiscordClient["getGuildChannelMetadata"]
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  getCurrentUser: DiscordClient["getCurrentUser"]
  getGuild: DiscordClient["getGuild"]
  getGuildAutoModerationRule: DiscordClient["getGuildAutoModerationRule"]
  getGuildAuditLog: DiscordClient["getGuildAuditLog"]
  getGuildBan: DiscordClient["getGuildBan"]
  getGuildChannels: DiscordClient["getGuildChannels"]
  getGuildMember: DiscordClient["getGuildMember"]
  getGuildVoiceState: DiscordClient["getGuildVoiceState"]
  getGuildOnboarding: DiscordClient["getGuildOnboarding"]
  getGuildWelcomeScreen: DiscordClient["getGuildWelcomeScreen"]
  getGuildWidgetSettings: DiscordClient["getGuildWidgetSettings"]
  getGuildEmoji: DiscordClient["getGuildEmoji"]
  getGuildRole: DiscordClient["getGuildRole"]
  getGuildRoleMemberCounts: DiscordClient["getGuildRoleMemberCounts"]
  getGuildRoles: DiscordClient["getGuildRoles"]
  getGuildScheduledEvent: DiscordClient["getGuildScheduledEvent"]
  getGuildSoundboardSound: DiscordClient["getGuildSoundboardSound"]
  getGuildSticker: DiscordClient["getGuildSticker"]
  getStageInstance: DiscordClient["getStageInstance"]
  getMessage: DiscordClient["getMessage"]
  getThreadMember: DiscordClient["getThreadMember"]
  getThreadState: DiscordClient["getThreadState"]
  getUser: DiscordClient["getUser"]
  listActiveGuildThreads: DiscordClient["listActiveGuildThreads"]
  listCurrentUserGuilds: DiscordClient["listCurrentUserGuilds"]
  listGuildAutoModerationRules: DiscordClient["listGuildAutoModerationRules"]
  listGuildApplicationCommands: DiscordClient["listGuildApplicationCommands"]
  listGuildBans: DiscordClient["listGuildBans"]
  listGuildInvites: DiscordClient["listGuildInvites"]
  listJoinedPrivateArchivedThreads: DiscordClient["listJoinedPrivateArchivedThreads"]
  listGuildMembers: DiscordClient["listGuildMembers"]
  listGuildScheduledEvents: DiscordClient["listGuildScheduledEvents"]
  listGuildSoundboardSounds: DiscordClient["listGuildSoundboardSounds"]
  listGuildEmojis: DiscordClient["listGuildEmojis"]
  listGuildStickers: DiscordClient["listGuildStickers"]
  listMessagePins: DiscordClient["listMessagePins"]
  listPollAnswerVoters: DiscordClient["listPollAnswerVoters"]
  listChannelWebhooks: DiscordClient["listChannelWebhooks"]
  listMessages: DiscordClient["listMessages"]
  listDefaultSoundboardSounds: DiscordClient["listDefaultSoundboardSounds"]
  listPrivateArchivedThreads: DiscordClient["listPrivateArchivedThreads"]
  listPublicArchivedThreads: DiscordClient["listPublicArchivedThreads"]
  modifyGuildMemberTimeout: DiscordClient["modifyGuildMemberTimeout"]
  modifyGuildMemberVoice: DiscordClient["modifyGuildMemberVoice"]
  modifyThreadState: DiscordClient["modifyThreadState"]
  modifyGuildChannelMetadata: DiscordClient["modifyGuildChannelMetadata"]
  modifyGuildOnboarding: DiscordClient["modifyGuildOnboarding"]
  modifyGuildWelcomeScreen: DiscordClient["modifyGuildWelcomeScreen"]
  modifyGuildWidgetSettings: DiscordClient["modifyGuildWidgetSettings"]
  modifyGuildAutoModerationRule: DiscordClient["modifyGuildAutoModerationRule"]
  modifyGuildEmoji: DiscordClient["modifyGuildEmoji"]
  modifyGuildScheduledEvent: DiscordClient["modifyGuildScheduledEvent"]
  modifyGuildSoundboardSound: DiscordClient["modifyGuildSoundboardSound"]
  modifyGuildRole: DiscordClient["modifyGuildRole"]
  modifyGuildSticker: DiscordClient["modifyGuildSticker"]
  modifyStageInstance: DiscordClient["modifyStageInstance"]
  pinMessage: DiscordClient["pinMessage"]
  removeGuildBan: DiscordClient["removeGuildBan"]
  removeGuildMember: DiscordClient["removeGuildMember"]
  removeGuildMemberRole: DiscordClient["removeGuildMemberRole"]
  removeThreadMember: DiscordClient["removeThreadMember"]
  searchGuildMessages: DiscordClient["searchGuildMessages"]
  searchGuildMembers: DiscordClient["searchGuildMembers"]
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

export interface ConnectorServiceOptions {
  administrationOptions?: Pick<
    AdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  activityStore?: ActivityStore
  announcementCrosspostOptions?: Pick<
    AnnouncementCrosspostServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  attachmentMessageOptions?: Pick<
    AttachmentMessageServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  automodOptions?: Pick<
    AutoModerationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  channelAdministrationOptions?: Pick<
    ChannelAdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  channelMetadataOptions?: Pick<
    ChannelMetadataServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  client?: DiscordServiceClient
  clientOptions?: Omit<DiscordClientOptions, "token">
  config: ConnectorConfig
  deletionOptions?: Pick<DeletionServiceOptions, "clock" | "planKey" | "randomId">
  forumPostOptions?: Pick<
    ForumPostServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildScaffoldOptions?: Pick<
    GuildScaffoldServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  guildExpressionOptions?: Pick<
    GuildExpressionServiceOptions,
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
  inviteOptions?: Pick<InviteServiceOptions, "clock" | "planKey" | "randomId">
  onboardingOptions?: Pick<OnboardingServiceOptions, "clock" | "planKey" | "randomId">
  messagePinOptions?: Pick<
    MessagePinServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  memberRoleOptions?: Pick<
    MemberRoleServiceOptions,
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
  roleAdministrationOptions?: Pick<
    RoleAdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  roleConfigurationOptions?: Pick<
    RoleConfigurationServiceOptions,
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
  stageInstanceOptions?: Pick<
    StageInstanceServiceOptions,
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

type PrivilegedIntentStatus = "disabled" | "enabled" | "unknown"

function applicationPrivilegedIntent(
  application: DiscordApplication,
  intentFlags: bigint,
): PrivilegedIntentStatus {
  let flags: bigint
  try {
    if (application.flags_new !== undefined) flags = BigInt(application.flags_new)
    else if (application.flags !== undefined) flags = BigInt(application.flags)
    else return "unknown"
  } catch {
    return "unknown"
  }
  if (flags < 0n) return "unknown"
  return (flags & intentFlags) !== 0n ? "enabled" : "disabled"
}

function applicationGuildMembersIntent(
  application: DiscordApplication,
): PrivilegedIntentStatus {
  return applicationPrivilegedIntent(
    application,
    DISCORD_APPLICATION_FLAGS.gatewayGuildMembers
      | DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited,
  )
}

function applicationMessageContentIntent(
  application: DiscordApplication,
): PrivilegedIntentStatus {
  return applicationPrivilegedIntent(
    application,
    DISCORD_APPLICATION_FLAGS.gatewayMessageContent
      | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited,
  )
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

export class ConnectorService {
  readonly #administrationService: AdministrationService
  readonly #activityStore: ActivityStore
  readonly #announcementCrosspostService: AnnouncementCrosspostService
  readonly #attachmentMessageService: AttachmentMessageService
  readonly #automodService: AutoModerationService
  readonly #banAuditService: BanAuditService
  readonly #channelAdministrationService: ChannelAdministrationService
  readonly #channelMetadataService: ChannelMetadataService
  readonly #client: DiscordServiceClient
  readonly #config: ConnectorConfig
  readonly #deletionService: DeletionService
  #identityPromise: Promise<VerifiedIdentity> | undefined
  readonly #interactionService: InteractionService
  readonly #inviteService: InviteService
  readonly #onboardingService: OnboardingService
  readonly #messagePinService: MessagePinService
  readonly #memberDirectoryService: MemberDirectoryService
  readonly #memberRoleService: MemberRoleService
  readonly #memberVoiceService: MemberVoiceService
  readonly #nativeInteractionCommandService: NativeInteractionCommandService
  readonly #permissionOverwriteService: ChannelPermissionOverwriteService
  readonly #guildAuditLogService: GuildAuditLogService
  readonly #forumPostService: ForumPostService
  readonly #guildScaffoldService: GuildScaffoldService
  readonly #guildExpressionService: GuildExpressionService
  readonly #permissionService: PermissionService
  readonly #policy: ScopePolicy
  readonly #pollService: PollService
  readonly #roleAdministrationService: RoleAdministrationService
  readonly #roleConfigurationService: RoleConfigurationService
  readonly #scheduledEventService: ScheduledEventService
  readonly #soundboardService: SoundboardService
  readonly #stageInstanceService: StageInstanceService
  readonly #threadCreationService: ThreadCreationService
  readonly #threadGovernanceService: ThreadGovernanceService
  readonly #webhookService: WebhookService
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
    this.#activityStore = options.activityStore || new JsonlActivityLog(options.config.auditFile)
    const operationStore = options.operationStore || new FileOperationStore(
      operationReceiptDirectory(options.config.auditFile),
    )
    this.#writeCoordinator = options.writeCoordinator || new FileWriteCoordinator(
      writeCoordinationDirectory(options.config.auditFile),
      operationStore,
    )
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
      policy: this.#policy,
      ...options.administrationOptions,
    })
    this.#channelAdministrationService = new ChannelAdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.channelAdministrationOptions,
    })
    this.#channelMetadataService = new ChannelMetadataService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.channelMetadataOptions,
    })
    this.#deletionService = new DeletionService({
      activityStore: this.#activityStore,
      client: this.#client,
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
    this.#automodService = new AutoModerationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.automodOptions,
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
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.inviteOptions,
    })
    this.#onboardingService = new OnboardingService({
      activityStore: this.#activityStore,
      client: this.#client,
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
    this.#webhookService = new WebhookService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.webhookOptions,
    })
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
    this.#memberRoleService = new MemberRoleService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.memberRoleOptions,
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
      operationStore,
      policy: this.#policy,
      ...options.roleConfigurationOptions,
    })
    this.#guildScaffoldService = new GuildScaffoldService({
      channelService: this.#channelAdministrationService,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      roleService: this.#roleAdministrationService,
      ...options.guildScaffoldOptions,
    })
  }

  describePolicy() {
    return this.#policy.describe()
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

  #coordinateWrite<T>(
    kind: OperationKind,
    operationKey: string,
    planDigest: string,
    targets: readonly WriteCoordinationTarget[],
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord reviewed-write plan digest is invalid")
    }
    return this.#writeCoordinator.run({
      kind,
      operationKeyHash: operationKeyHash(operationKey),
      planDigest,
      targets,
    }, operation)
  }

  async getStatus(options: RequestOptions = {}) {
    const identity = await this.#verifyIdentity(options)
    const guilds = await this.#client.listCurrentUserGuilds({
      limit: DISCORD_LIMITS.currentUserGuilds,
      ...options,
    })
    const scopedGuilds = this.#policy.filterGuilds(guilds)
    return {
      application: {
        guildMembersIntent: applicationGuildMembersIntent(identity.application),
        id: identity.application.id,
        messageContentIntent: applicationMessageContentIntent(identity.application),
        name: identity.application.name,
      },
      auditFile: this.#config.auditFile,
      bot: {
        id: identity.bot.id,
        username: identity.bot.username,
      },
      guildPage: {
        accessible: guilds.length,
        inScope: scopedGuilds.length,
      },
      policy: this.describePolicy(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      writeCoordination: {
        coverage: "receipt-backed-single-step-reviewed-writes",
        excludedWorkflows: [
          "guild-scaffold",
          "legacy-member-moderation",
          "legacy-message-deletion",
          "ordinary-message-interactions",
        ],
        localFilesystemRequired: true,
        mode: "durable-exact-target",
        sharedStateRootRequired: true,
      },
    }
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
    return {
      channels: scopedChannels
        .map((channel) => normalizedGuildChannel(channel, guildId))
        .sort((left, right) => (
          (left.position ?? Number.MAX_SAFE_INTEGER)
          - (right.position ?? Number.MAX_SAFE_INTEGER)
        )),
      guildId,
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

  async searchMessages(
    guildId: string,
    options: GuildMessageSearchOptions = {},
  ) {
    await this.#verifyIdentity(options)
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
        status: "indexing" as const,
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
      if (!this.#policy.channelIdReadable(
        message.channel_id,
        parentId,
      )) continue
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
      .map((thread) => normalizedGuildChannel(thread, guildId))
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
      status: "ok" as const,
      threads,
    }
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
    channelId: string,
    messageIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<DeletionPlan> {
    await this.#verifyIdentity(options)
    return this.#deletionService.plan(channelId, messageIds, options)
  }

  async listMessagePins(
    channelId: string,
    options: MessagePinPageOptions = {},
  ): Promise<MessagePinListResult> {
    await this.#verifyIdentity(options)
    return this.#messagePinService.list(channelId, options)
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

  async listChannelWebhooks(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<WebhookInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.list(identity.bot.id, channelId, options)
  }

  async listGuildExpressions(
    guildId: string,
    kind: GuildExpressionKind,
    options: RequestOptions = {},
  ): Promise<GuildExpressionInventoryResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#guildExpressionService.list(identity.bot.id, guildId, kind, options)
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
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.get(
      identity.bot.id,
      channelId,
      webhookId,
      options,
    )
  }

  async planWebhookDeletion(
    request: WebhookDeletionRequest,
    options: RequestOptions = {},
  ): Promise<WebhookDeletionPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#webhookService.plan(
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

  async planMemberModeration(
    request: MemberModerationRequest,
    options: RequestOptions = {},
  ): Promise<MemberModerationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#administrationService.plan(identity.bot.id, request, options)
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
      [writeResourceTarget("member", request.userId)],
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
          ? [writeResourceTarget(
            "member",
            (request as Extract<ThreadChangeRequest, {
              action: "add-member" | "remove-member"
            }>).userId,
          )]
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
    const identity = await this.#verifyIdentity(options)
    return this.#guildScaffoldService.execute(
      identity.application.id,
      identity.bot.id,
      request,
      planDigest,
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

  async executeMemberModeration(
    request: MemberModerationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberModerationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#administrationService.execute(
      identity.bot.id,
      request,
      planDigest,
      options,
    )
  }

  async deleteMessages(
    channelId: string,
    messageIds: readonly string[],
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<DeletionResult> {
    await this.#verifyIdentity(options)
    return this.#deletionService.execute(channelId, messageIds, planDigest, options)
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

  async executeWebhookDeletion(
    request: WebhookDeletionRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookDeletionResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#coordinateWrite(
      "webhook-deletion",
      request.operationKey,
      planDigest,
      [
        writeResourceTarget("channel", request.channelId),
        writeResourceTarget("webhook", request.webhookId),
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

  async sendMessage(
    request: SendMessageRequest,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    return this.#interactionService.sendMessage(identity.bot.id, request, options)
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

  listActivity(limit?: number): Promise<ActivityList> {
    return this.#activityStore.list(limit)
  }
}
