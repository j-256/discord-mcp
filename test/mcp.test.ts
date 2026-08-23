import assert from "node:assert/strict"
import process from "node:process"
import { PassThrough } from "node:stream"
import test, { type TestContext } from "node:test"

import {
  Client,
  InMemoryTransport,
  ReadBuffer,
  serializeMessage,
  specTypeSchemas,
  type ClientOptions,
  type JSONRPCMessage,
  type Tool,
  type Transport,
  withInputRequired,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

import {
  AUDIT_LOG_LIMITS,
  BAN_AUDIT_LIMITS,
  DISCORD_CHANNEL_TYPES,
  GUILD_SETTINGS_FIELDS,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  ONBOARDING_LIMITS,
  REACTION_LIMITS,
  WELCOME_SCREEN_LIMITS,
} from "../src/constants.js"
import type {
  AnnouncementCrosspostPlan,
  AnnouncementCrosspostRequest,
} from "../src/announcement-crosspost-service.js"
import type {
  AnnouncementSubscriptionPlan,
  AnnouncementSubscriptionRequest,
} from "../src/announcement-subscription-service.js"
import type {
  AttachmentMessagePlan,
  AttachmentMessageRequest,
} from "../src/attachment-message-service.js"
import {
  reviewComponentLayout,
  type ComponentLayoutInput,
} from "../src/component-layout.js"
import type {
  ComponentMessagePlan,
  ComponentMessageRequest,
} from "../src/component-message-service.js"
import {
  normalizeAutoModerationChangeRequest,
  type AutoModerationChangeRequest,
  type AutoModerationPlan,
  type AutoModerationPrivacyProjection,
  type AutoModerationReferenceEvidence,
  type ProjectedAutoModerationRule,
} from "../src/automod-service.js"
import type { ChannelCreationRequest } from "../src/channel-administration-service.js"
import type {
  ChannelClonePlan,
  ChannelCloneRequest,
} from "../src/channel-clone-service.js"
import type {
  ChannelMetadataChangePlan,
  ChannelMetadataChangeRequest,
  ChannelMetadataReadResult,
  ChannelMetadataView,
} from "../src/channel-metadata-service.js"
import type {
  ChannelPermissionOverwritePlan,
  ChannelPermissionOverwriteRequest,
} from "../src/channel-permission-overwrite-service.js"
import type {
  DeletionPlan,
  DeletionRequest,
} from "../src/deletion-service.js"
import type {
  ForumPostPlan,
  ForumPostRequest,
} from "../src/forum-post-service.js"
import type {
  ForumTagAuditResult,
  ForumTagChangePlan,
  ForumTagChangeRequest,
  ForumTagObservedState,
  PlannedForumTagView,
} from "../src/forum-tag-service.js"
import type {
  GuildScaffoldPlan,
  GuildScaffoldRequest,
} from "../src/guild-scaffold-service.js"
import type {
  GuildTemplateChangePlan,
  GuildTemplateChangeRequest,
  GuildTemplatePrivacyProjection,
  GuildTemplateStructure,
  ProjectedGuildTemplate,
} from "../src/guild-template-service.js"
import type {
  GuildExpressionChangeRequest,
  GuildExpressionKind,
  GuildExpressionPlan,
  GuildExpressionPrivacyProjection,
  ProjectedGuildExpression,
} from "../src/guild-expression-service.js"
import type {
  IntegrationAccessEvidence,
  IntegrationDeletionPlan,
  IntegrationDeletionRequest,
  IntegrationInventoryResult,
  IntegrationPrivacyProjection,
} from "../src/integration-service.js"
import type { DiscordGuildIntegrationSummary } from "../src/discord-client.js"
import {
  INVITE_OMITTED_FIELDS,
  type InviteAccessEvidence,
  type InviteDeletionPlan,
  type InviteDeletionRequest,
  type InvitePrivacyProjection,
  type ProjectedInvite,
} from "../src/invite-service.js"
import type {
  MessagePinPlan,
  MessagePinRequest,
} from "../src/message-pin-service.js"
import type {
  OnboardingAccessEvidence,
  OnboardingAuditResult,
  OnboardingChangePlan,
  OnboardingChangeRequest,
  OnboardingConfigurationView,
  OnboardingPrivacyProjection,
} from "../src/onboarding-service.js"
import type {
  WelcomeScreenAccessEvidence,
  WelcomeScreenAuditResult,
  WelcomeScreenChangePlan,
  WelcomeScreenChangeRequest,
  WelcomeScreenConfigurationView,
  WelcomeScreenPrivacyProjection,
} from "../src/welcome-screen-service.js"
import type {
  WidgetSettingsAccessEvidence,
  WidgetSettingsAuditResult,
  WidgetSettingsChangePlan,
  WidgetSettingsChangeRequest,
  WidgetSettingsConfigurationView,
  WidgetSettingsPrivacyProjection,
} from "../src/widget-settings-service.js"
import type {
  GuildSettingsAccessEvidence,
  GuildSettingsAuditResult,
  GuildSettingsChangePlan,
  GuildSettingsChangeRequest,
  GuildSettingsConfigurationView,
  GuildSettingsPrivacyProjection,
} from "../src/guild-settings-service.js"
import type {
  PollCreationPlan,
  PollCreationRequest,
  PollEndPlan,
  PollEndRequest,
  PollReadResult,
} from "../src/poll-service.js"
import type {
  MemberRoleChangePlan,
  MemberRoleChangeRequest,
} from "../src/member-role-service.js"
import type {
  MemberVoiceChangePlan,
  MemberVoiceChangeRequest,
} from "../src/member-voice-service.js"
import {
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
  type NormalizedDiscordRole,
  type RoleCreationPlan,
  type RoleCreationRequest,
} from "../src/role-administration-service.js"
import type {
  RoleConfigurationPlan,
  RoleConfigurationRequest,
} from "../src/role-configuration-service.js"
import type {
  RoleOrderEntry,
  RoleOrderingPlan,
  RoleOrderingRequest,
} from "../src/role-ordering-service.js"
import type {
  ChannelOrderEntry,
  ChannelOrderingPlan,
  ChannelOrderingRequest,
} from "../src/channel-ordering-service.js"
import type {
  ProjectedScheduledEvent,
  ScheduledEventChangeRequest,
  ScheduledEventPlan,
  ScheduledEventPrivacyProjection,
} from "../src/scheduled-event-service.js"
import type {
  ProjectedStageInstance,
  StageInstanceChangeRequest,
  StageInstancePlan,
  StageInstancePrivacyProjection,
} from "../src/stage-instance-service.js"
import type {
  ProjectedSoundboardSound,
  SoundboardChangeRequest,
  SoundboardPlan,
  SoundboardPrivacyProjection,
} from "../src/soundboard-service.js"
import {
  AdministrationExecutionError,
  AnnouncementCrosspostExecutionError,
  AnnouncementCrosspostOperationConflictError,
  AnnouncementSubscriptionExecutionError,
  AnnouncementSubscriptionOperationConflictError,
  AttachmentMessageExecutionError,
  AttachmentMessageOperationConflictError,
  AutoModerationExecutionError,
  AutoModerationOperationConflictError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
  ChannelCloneExecutionError,
  ChannelCloneOperationConflictError,
  ChannelMetadataExecutionError,
  ChannelMetadataOperationConflictError,
  ChannelOrderingExecutionError,
  ChannelOrderingOperationConflictError,
  ChannelPermissionOverwriteExecutionError,
  ChannelPermissionOverwriteOperationConflictError,
  ComponentMessageExecutionError,
  ComponentMessageOperationConflictError,
  DeletionExecutionError,
  DeletionOperationConflictError,
  DiscordApiError,
  ForumPostExecutionError,
  ForumPostOperationConflictError,
  ForumTagExecutionError,
  ForumTagOperationConflictError,
  GuildExpressionExecutionError,
  GuildExpressionOperationConflictError,
  GuildScaffoldExecutionError,
  GuildScaffoldOperationConflictError,
  GuildTemplateExecutionError,
  GuildTemplateOperationConflictError,
  IntegrationDeletionExecutionError,
  IntegrationDeletionOperationConflictError,
  InteractionExecutionError,
  InteractionRateLimitError,
  InviteDeletionExecutionError,
  InviteDeletionOperationConflictError,
  MessagePinExecutionError,
  MessagePinOperationConflictError,
  MemberRoleExecutionError,
  MemberRoleOperationConflictError,
  MemberRolePlanChangedError,
  MemberVoiceExecutionError,
  MemberVoiceOperationConflictError,
  MemberVoicePlanChangedError,
  OnboardingExecutionError,
  OnboardingOperationConflictError,
  PollExecutionError,
  PollOperationConflictError,
  ReactionModerationExecutionError,
  ReactionModerationOperationConflictError,
  RoleCreationExecutionError,
  RoleCreationOperationConflictError,
  RoleConfigurationExecutionError,
  RoleConfigurationOperationConflictError,
  RoleOrderingExecutionError,
  RoleOrderingOperationConflictError,
  ScheduledEventExecutionError,
  ScheduledEventOperationConflictError,
  SoundboardExecutionError,
  SoundboardOperationConflictError,
  StageInstanceExecutionError,
  StageInstanceOperationConflictError,
  ThreadCreationExecutionError,
  ThreadCreationOperationConflictError,
  ThreadGovernanceExecutionError,
  ThreadGovernanceOperationConflictError,
  WebhookChangeExecutionError,
  WebhookChangeOperationConflictError,
  WebhookCreationExecutionError,
  WebhookCreationOperationConflictError,
  WebhookDeletionExecutionError,
  WebhookDeletionOperationConflictError,
  WelcomeScreenExecutionError,
  WelcomeScreenOperationConflictError,
  WidgetSettingsExecutionError,
  WidgetSettingsOperationConflictError,
  GuildSettingsExecutionError,
  GuildSettingsOperationConflictError,
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationStateError,
} from "../src/errors.js"
import {
  createDiscordMcpServer,
  runDiscordMcpServer,
  type DiscordMcpRunOptions,
  type DiscordToolService,
} from "../src/mcp.js"
import { GatewayEventStore, type GatewayEventSource } from "../src/gateway-events.js"
import type {
  NativeInteractionRuntime,
  NativeInteractionSource,
} from "../src/native-interaction-broker.js"
import {
  nativeInteractionCommandContract,
  type NativeInteractionCommandPlan,
  type NativeInteractionCommandRequest,
} from "../src/native-interaction-command-service.js"
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_TEMPLATE_NAMES,
  MCP_RESOURCE_URIS,
} from "../src/mcp-guidance.js"
import { MCP_TOOL_CATALOG } from "../src/mcp-tool-catalog.js"
import { normalizeChannel, normalizeMessage } from "../src/normalize.js"
import { loadObservabilityConfig } from "../src/observability-config.js"
import { OperationalTelemetry } from "../src/observability.js"
import { operationKeyHash } from "../src/operation-store.js"
import {
  DISCORD_PERMISSIONS,
  discordPermissionBitfield,
  discordPermissionNames,
  evaluateBotChannelPermissions,
} from "../src/permissions.js"
import type { PolicyDescription } from "../src/policy.js"
import type { DiscordChannel, DiscordMessage } from "../src/types.js"
import type {
  ThreadCreationPlan,
  ThreadCreationRequest,
} from "../src/thread-creation-service.js"
import type {
  ThreadChangePlan,
  ThreadChangeRequest,
} from "../src/thread-governance-service.js"
import type {
  ProjectedWebhook,
  WebhookChangePlan,
  WebhookChangeRequest,
  WebhookCreationPlan,
  WebhookCreationRequest,
  WebhookDeletionPlan,
  WebhookDeletionRequest,
  WebhookPermissionEvidence,
  WebhookPrivacyProjection,
} from "../src/webhook-service.js"

const TOKEN = "test-discord-token"
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000
const LIST_CHANGED_TIMEOUT_MS = 2_000
const STATIC_RESOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const APPLICATION_ID = "110000000000000001"
const BOT_ID = "120000000000000001"
const GUILD_OWNER_ID = "130000000000000001"
const CHANNEL_ID = "200000000000000001"
const PARENT_ID = "200000000000000002"
const THREAD_ID = "250000000000000001"
const MESSAGE_ID = "300000000000000001"
const ROLE_ID = "350000000000000001"
const AUDIT_ENTRY_ID = "360000000000000001"
const USER_ID = "400000000000000001"
const AUDIT_REASON = "Reviewed safety incident 42"
const OPERATION_KEY = "channel-create-attempt-0001"
const ROLE_OPERATION_KEY = "role-create-attempt-0001"
const ROLE_CONFIGURATION_OPERATION_KEY = "role-configuration-attempt-0001"
const ROLE_ORDERING_OPERATION_KEY = "role-ordering-attempt-0001"
const ROLE_ORDERING_ANCHOR_ID = "350000000000000002"
const CHANNEL_ORDERING_ANCHOR_ID = "200000000000000004"
const CHANNEL_ORDERING_MID_ID = "200000000000000005"
const CHANNEL_ORDERING_OPERATION_KEY = "channel-ordering-attempt-0001"
const CHANNEL_CLONE_OPERATION_KEY = "channel-clone-attempt-0001"
const CHANNEL_CLONE_CREATED_ID = "200000000000000006"
const ATTACHMENT_OPERATION_KEY = "attachment-send-attempt-0001"
const COMPONENT_MESSAGE_OPERATION_KEY = "component-message-attempt-0001"
const FORUM_POST_OPERATION_KEY = "forum-post-attempt-0001"
const FORUM_TAG_OPERATION_KEY = "forum-tag-attempt-0001"
const FORUM_TAG_ID = "385000000000000001"
const CREATED_FORUM_TAG_ID = "385000000000000002"
const THREAD_CREATION_OPERATION_KEY = "thread-create-attempt-0001"
const GUILD_SCAFFOLD_OPERATION_KEY = "guild-scaffold-attempt-0001"
const MESSAGE_PIN_OPERATION_KEY = "message-pin-attempt-0001"
const REACTION_MODERATION_OPERATION_KEY = "reaction-moderation-attempt-0001"
const ANNOUNCEMENT_CROSSPOST_OPERATION_KEY = "announcement-crosspost-attempt-0001"
const ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY = "announcement-subscription-attempt-0001"
const ANNOUNCEMENT_SOURCE_CHANNEL_ID = "200000000000000003"
const ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID = "370000000000000002"
const NATIVE_INTERACTION_COMMAND_OPERATION_KEY = "native-command-attempt-0001"
const POLL_CREATION_OPERATION_KEY = "poll-create-attempt-0001"
const POLL_END_OPERATION_KEY = "poll-end-attempt-0001"
const POLL_QUESTION = "Which release theme should we choose?"
const POLL_ANSWER_ONE = "Reliability"
const POLL_ANSWER_TWO = "Usability"
const MEMBER_ROLE_OPERATION_KEY = "member-role-attempt-0001"
const MEMBER_VOICE_OPERATION_KEY = "member-voice-attempt-0001"
const THREAD_GOVERNANCE_OPERATION_KEY = "thread-governance-attempt-0001"
const PERMISSION_OVERWRITE_OPERATION_KEY = "permission-overwrite-attempt-0001"
const WEBHOOK_OPERATION_KEY = "webhook-delete-attempt-0001"
const WEBHOOK_CHANGE_OPERATION_KEY = "webhook-change-attempt-0001"
const WEBHOOK_CREATION_OPERATION_KEY = "webhook-create-attempt-0001"
const WEBHOOK_ID = "370000000000000001"
const INTEGRATION_OPERATION_KEY = "integration-delete-attempt-0001"
const INTEGRATION_ID = "375000000000000001"
const INTEGRATION_APPLICATION_ID = "375000000000000002"
const INTEGRATION_BOT_ID = "375000000000000003"
const INVITE_OPERATION_KEY = "invite-delete-attempt-0001"
const INVITE_REF = `iref_hmac_sha256_${"6".repeat(64)}`
const PRIVATE_INVITE_CODE = "private-invite-capability"
const GUILD_TEMPLATE_OPERATION_KEY = "guild-template-attempt-0001"
const GUILD_TEMPLATE_REF = `tref_hmac_sha256_${"7".repeat(64)}`
const PRIVATE_GUILD_TEMPLATE_CODE = "private-template-capability"
const ONBOARDING_OPERATION_KEY = "onboarding-change-attempt-0001"
const WELCOME_SCREEN_OPERATION_KEY = "welcome-screen-change-attempt-0001"
const WIDGET_SETTINGS_OPERATION_KEY = "widget-settings-change-attempt-0001"
const GUILD_SETTINGS_OPERATION_KEY = "guild-settings-change-attempt-0001"
const CHANNEL_METADATA_OPERATION_KEY = "channel-metadata-attempt-0001"
const ONBOARDING_PROMPT_TITLE = "Choose your community path"
const ONBOARDING_OPTION_TITLE = "Community member"
const ONBOARDING_OPTION_DESCRIPTION = "Join the community channels"
const WELCOME_SCREEN_DESCRIPTION = "Welcome to the reviewed community"
const WELCOME_SCREEN_CHANNEL_DESCRIPTION = "Read the community rules"
const ONBOARDING_DEFAULT_CHANNEL_IDS = Array.from(
  { length: ONBOARDING_LIMITS.enabledDefaultChannels },
  (_, index) => `${200000000000000001n + BigInt(index)}`,
)
const EMOJI_ID = "380000000000000001"
const STICKER_ID = "390000000000000001"
const GUILD_EXPRESSION_OPERATION_KEY = "guild-expression-attempt-0001"
const GUILD_EXPRESSION_PATH = "/test/discord-mcp/reviewed-expression.png"
const SOUNDBOARD_SOUND_ID = "391000000000000001"
const SOUNDBOARD_OPERATION_KEY = "soundboard-change-attempt-0001"
const SOUNDBOARD_PATH = "/test/discord-mcp/reviewed-sound.mp3"
const AUTOMOD_RULE_ID = "392000000000000001"
const AUTOMOD_OPERATION_KEY = "automod-attempt-0001"
const SCHEDULED_EVENT_ID = "395000000000000001"
const SCHEDULED_EVENT_OPERATION_KEY = "scheduled-event-attempt-0001"
const SCHEDULED_EVENT_COVER_PATH = "/test/discord-mcp/reviewed-event-cover.png"
const STAGE_INSTANCE_ID = "396000000000000001"
const STAGE_INSTANCE_OPERATION_KEY = "stage-instance-attempt-0001"
const ATTACHMENT_PATH = "/test/discord-mcp/report.txt"
const COMPONENT_LAYOUT: ComponentLayoutInput[] = [{
  accentColor: 0x58_65_F2,
  components: [{ content: `Reviewed component for <@${USER_ID}>`, kind: "text" as const }],
  kind: "container" as const,
  spoiler: false,
}]
const OPERATION_KEY_HASH = `sha256:${"c".repeat(64)}`
const DIGEST = `hmac-sha256:${"a".repeat(64)}`
const DIFFERENT_DIGEST = `hmac-sha256:${"b".repeat(64)}`

function rawChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    last_message_id: MESSAGE_ID,
    name: "general",
    nsfw: false,
    parent_id: null,
    permission_overwrites: [],
    position: 1,
    type: 0,
    ...overrides,
  }
}

function webhookChannel(channelId = CHANNEL_ID) {
  return {
    guildId: GUILD_ID,
    id: channelId,
    name: "general",
    parentId: null,
    type: 0,
    typeName: "guild-text",
  }
}

function rawMessage(content = "hello"): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: false,
      global_name: null,
      id: "400000000000000001",
      username: "member",
    },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    edited_timestamp: null,
    embeds: [],
    flags: 0,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    reactions: [],
    timestamp: "2026-08-14T00:00:00.000Z",
    tts: false,
    type: 0,
  }
}

function plan(
  digest = DIGEST,
  request: DeletionRequest = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    messageIds: [MESSAGE_ID],
    operationKey: OPERATION_KEY,
  },
): DeletionPlan {
  return {
    application: {
      id: APPLICATION_ID,
      messageContentIntent: "enabled",
    },
    auditReason: request.auditReason,
    bot: { id: BOT_ID },
    channel: {
      id: request.channelId,
      name: "private-channel",
      parentId: null,
      type: 0,
    },
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guild: { id: GUILD_ID, name: "private-guild" },
    messageIds: [...request.messageIds],
    messages: [{
      attachmentFilenames: [],
      author: {
        bot: false,
        globalName: null,
        id: "400000000000000001",
        username: "member",
      },
      contentLength: 5,
      contentPreview: "hello",
      editedTimestamp: null,
      id: MESSAGE_ID,
      timestamp: "2026-08-14T00:00:00.000Z",
      truncated: false,
      type: 0,
      url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${MESSAGE_ID}`,
    }],
    operationKeyHash: operationKeyHash(request.operationKey),
    operations: [{
      kind: "individual" as const,
      messageIds: [...request.messageIds],
    }],
    permission: {
      administrator: false,
      canReadMessages: true,
      confidence: "complete",
      connect: null,
      effectivePermissions: "74752",
      manageMessages: true,
      permissionSourceChannelId: request.channelId,
      privateThreadAccess: "not-applicable",
      readMessageHistory: true,
      requiredPermissionNames: [
        "VIEW_CHANNEL",
        "READ_MESSAGE_HISTORY",
        "MANAGE_MESSAGES",
      ],
      viewChannel: true,
    },
    privacy: {
      persistence: "content-free",
      previews: "transient-untrusted",
    },
    schemaVersion: 1,
    status: "planned" as const,
    warnings: ["Deletion is irreversible"],
  }
}

function messagePinPlan(
  request: MessagePinRequest,
  digest = DIGEST,
  action: "change" | "none" = "change",
): MessagePinPlan {
  const desiredPinned = request.desiredState === "pinned"
  const pinned = action === "none" ? desiredPinned : !desiredPinned
  return {
    action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channel: normalizeChannel(rawChannel({ id: request.channelId })),
    createdAt: "2026-08-20T00:00:00.000Z",
    digest,
    guild: { id: GUILD_ID, name: "Private guild name" },
    message: {
      attachmentFilenames: ["private-file.txt"],
      author: {
        bot: false,
        globalName: null,
        id: USER_ID,
        username: "private-member",
      },
      contentLength: 13,
      contentPreview: "private hello",
      editedTimestamp: null,
      id: request.messageId,
      jumpUrl: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId}`,
      pinned,
      timestamp: "2026-08-20T00:00:00.000Z",
      truncated: false,
      type: 0,
    },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      canReadMessages: true,
      confidence: "complete",
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        | DISCORD_PERMISSIONS.PIN_MESSAGES
      ).toString(),
      permissionSourceChannelId: request.channelId,
      pinMessages: true,
      privateThreadAccess: "not-applicable",
      readMessageHistory: true,
      viewChannel: true,
    },
    schemaVersion: 1,
    status: action === "none" ? "already-current" : "planned",
    target: {
      desiredState: request.desiredState,
      pinned: desiredPinned,
    },
    warnings: ["One-shot reviewed message pin change"],
  }
}

function announcementCrosspostPlan(
  request: AnnouncementCrosspostRequest,
  digest = DIGEST,
  action: "crosspost" | "none" = "crosspost",
): AnnouncementCrosspostPlan {
  const crossposted = action === "none"
  return {
    action,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channel: normalizeChannel(rawChannel({
      id: request.channelId,
      type: 5,
    })),
    createdAt: "2026-08-22T00:00:00.000Z",
    digest,
    guild: { id: GUILD_ID, name: "Private guild name" },
    message: {
      attachmentFilenames: ["private-file.txt"],
      author: {
        bot: false,
        globalName: null,
        id: USER_ID,
        username: "private-member",
      },
      contentLength: 20,
      contentPreview: "private announcement",
      crossposted,
      editedTimestamp: null,
      flags: crossposted ? 1 : 0,
      id: request.messageId,
      jumpUrl: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId}`,
      timestamp: "2026-08-22T00:00:00.000Z",
      truncated: false,
      type: 0,
    },
    messageContentIntent: "enabled",
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      authorship: "other",
      canReadMessages: true,
      confidence: "complete",
      effectivePermissions: (
        DISCORD_PERMISSIONS.MANAGE_MESSAGES
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        | DISCORD_PERMISSIONS.SEND_MESSAGES
        | DISCORD_PERMISSIONS.VIEW_CHANNEL
      ).toString(),
      manageMessages: true,
      permissionSourceChannelId: request.channelId,
      readMessageHistory: true,
      sendMessages: true,
      viewChannel: true,
    },
    schemaVersion: 1,
    status: action === "none" ? "already-crossposted" : "planned",
    target: { crossposted: true },
    warnings: ["Follower destinations are unavailable"],
  }
}

function announcementSubscriptionPlan(
  request: AnnouncementSubscriptionRequest,
  digest = DIGEST,
  writeRequired = true,
): AnnouncementSubscriptionPlan {
  const subscription = {
    createdAt: "2016-11-14T12:33:47.137Z",
    sourceChannelId: request.action === "subscribe"
      ? request.sourceChannelId
      : ANNOUNCEMENT_SOURCE_CHANNEL_ID,
    sourceGuildId: GUILD_ID,
    sourceIdentity: "available" as const,
    type: "channel-follower" as const,
    webhookId: ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
  }
  const current = request.action === "unsubscribe" || !writeRequired
    ? subscription
    : null
  const target = {
    channel: webhookChannel(request.targetChannelId),
    guild: { id: GUILD_ID, name: "Private target guild" },
    inventory: {
      channelFollowers: current ? 1 : 0,
      safetyLimit: 15,
      totalWebhooks: current ? 1 : 0,
    },
    permission: webhookPermission(request.targetChannelId),
    subscriptions: current ? [subscription] : [],
  }
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-23T00:00:00.000Z",
    current,
    desired: { subscribed: request.action === "subscribe" },
    digest,
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: {
      credentialsProjectedOut: true,
      messageDataAccessed: false,
      omittedFields: [
        "applicationMetadata",
        "creatorProfile",
        "followerSourceChannelName",
        "followerSourceGuildIcon",
        "followerSourceGuildName",
        "messageData",
        "unrelatedWebhookIdentifiers",
        "unknownRawFields",
        "webhookAvatar",
        "webhookName",
        "webhookToken",
        "webhookUrl",
      ],
    },
    risks: ["Future published announcements are delivered until removal"],
    schemaVersion: 1,
    source: request.action === "subscribe"
      ? {
          channel: {
            ...webhookChannel(request.sourceChannelId),
            type: 5,
            typeName: "guild-announcement",
          },
          guild: { id: GUILD_ID, name: "Private source guild" },
          permission: {
            administrator: false,
            confidence: "complete",
            effectivePermissions: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
            manageWebhooks: false,
            permissionSourceChannelId: request.sourceChannelId,
            viewChannel: true,
          },
        }
      : null,
    status: writeRequired ? "planned" : "already-current",
    target,
    warnings: ["One-shot reviewed subscription change"],
    writeRequired,
  }
}

function nativeInteractionCommandPlan(
  request: NativeInteractionCommandRequest,
  digest = DIGEST,
  mutation: "create" | "delete" | "none" = request.action === "install"
    ? "create"
    : "delete",
): NativeInteractionCommandPlan {
  const installed = mutation === "delete"
    || mutation === "none" && request.action === "install"
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    command: {
      contract: nativeInteractionCommandContract("discord-mcp"),
      id: installed ? "700000000000000001" : null,
      version: installed ? "700000000000000002" : null,
    },
    createdAt: "2026-08-22T00:00:00.000Z",
    digest,
    guild: { id: request.guildId, name: "Private guild name" },
    inventory: {
      chatInputCount: installed ? 1 : 0,
      chatInputLimit: 100,
      totalCount: installed ? 1 : 0,
    },
    mutation,
    operationKeyHash: OPERATION_KEY_HASH,
    schemaVersion: 1,
    status: mutation === "none"
      ? request.action === "install" ? "already-installed" : "already-absent"
      : "planned",
    warnings: ["One exact managed guild command"],
  }
}

function pollRead(
  channelId = CHANNEL_ID,
  messageId = MESSAGE_ID,
  ended = false,
): PollReadResult {
  return {
    author: {
      bot: true,
      id: BOT_ID,
      webhook: false,
    },
    channelId,
    createdAt: "2026-08-20T00:00:00.000Z",
    editedAt: null,
    guildId: GUILD_ID,
    messageId,
    poll: {
      allowMultiselect: false,
      answers: [
        {
          answerId: 7,
          count: 4,
          emoji: {
            animated: null,
            id: null,
            name: "🔒",
            type: "unicode",
          },
          meVoted: false,
          text: POLL_ANSWER_ONE,
        },
        {
          answerId: 3,
          count: 0,
          emoji: null,
          meVoted: false,
          text: POLL_ANSWER_TWO,
        },
      ],
      expiry: ended
        ? "2026-08-20T00:30:00.000Z"
        : "2026-08-21T00:00:00.000Z",
      layoutType: 1,
      lifecycleState: ended ? "ended" : "active",
      question: POLL_QUESTION,
      resultState: ended ? "final" : "approximate",
      resultsFinalized: ended,
      totalVotes: 4,
      unknownFieldCount: 0,
    },
    privacy: {
      persistence: "none",
      rawPayloads: "omitted",
      voterIdentities: "not-fetched",
    },
    schemaVersion: 1,
    status: "ok",
    url: `https://discord.com/channels/${GUILD_ID}/${channelId}/${messageId}`,
  }
}

function pollCreationPlan(
  request: PollCreationRequest,
  digest = DIGEST,
): PollCreationPlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channel: {
      guildId: GUILD_ID,
      id: request.channelId,
      parentId: null,
      type: 0,
    },
    createdAt: "2026-08-20T00:00:00.000Z",
    digest,
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissionNames: [
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "READ_MESSAGE_HISTORY",
        "SEND_POLLS",
      ],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.SEND_MESSAGES
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        | DISCORD_PERMISSIONS.SEND_POLLS
      ).toString(),
      permissionSourceChannelId: request.channelId,
      requiredPermissionNames: [
        "VIEW_CHANNEL",
        "READ_MESSAGE_HISTORY",
        "SEND_MESSAGES",
        "SEND_POLLS",
      ],
    },
    privacy: {
      persistence: "content-free-only",
      rawPayloads: "omitted",
      text: "transient",
      voterIdentities: "not-fetched",
    },
    risks: ["Poll messages cannot be edited"],
    schemaVersion: 1,
    status: "planned",
    target: {
      allowMultiselect: request.allowMultiselect ?? false,
      answers: request.answers.map((answer) => ({
        emoji: answer.emoji ?? null,
        text: answer.text,
      })),
      durationHours: request.durationHours ?? 24,
      question: request.question,
    },
    warnings: ["Poll text is transient"],
    writeRequired: true,
  }
}

function pollEndPlan(
  request: PollEndRequest,
  digest = DIGEST,
  writeRequired = true,
): PollEndPlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channel: {
      guildId: GUILD_ID,
      id: request.channelId,
      parentId: null,
      type: 0,
    },
    createdAt: "2026-08-20T00:00:00.000Z",
    digest,
    messageId: request.messageId,
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissionNames: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
      ).toString(),
      permissionSourceChannelId: request.channelId,
      requiredPermissionNames: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
    },
    poll: pollRead(request.channelId, request.messageId, !writeRequired).poll,
    privacy: {
      persistence: "content-free-only",
      rawPayloads: "omitted",
      text: "transient",
      voterIdentities: "not-fetched",
    },
    risks: ["Ending a poll is irreversible"],
    schemaVersion: 1,
    status: writeRequired ? "planned" : "already-ended",
    warnings: ["Vote-count changes invalidate the plan"],
    writeRequired,
  }
}

function projectedWebhook(channelId = CHANNEL_ID): ProjectedWebhook {
  return {
    applicationId: APPLICATION_ID,
    channelId,
    createdAt: "2016-11-14T12:33:47.137Z",
    creatorUserId: USER_ID,
    guildId: GUILD_ID,
    name: "Private webhook name",
    type: "incoming",
    webhookId: WEBHOOK_ID,
  }
}

function webhookPermission(channelId = CHANNEL_ID): WebhookPermissionEvidence {
  return {
    administrator: false,
    confidence: "complete",
    effectivePermissions: (
      DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.MANAGE_WEBHOOKS
    ).toString(),
    manageWebhooks: true,
    permissionSourceChannelId: channelId,
    viewChannel: true,
  }
}

function webhookPrivacy(): WebhookPrivacyProjection {
  return {
    credentialsProjectedOut: true,
    omittedFields: [
      "avatar",
      "sourceChannel",
      "sourceGuild",
      "token",
      "unknownRawFields",
      "url",
      "userProfile",
    ],
  }
}

function webhookDeletionPlan(
  request: WebhookDeletionRequest,
  digest = DIGEST,
): WebhookDeletionPlan {
  return {
    action: "delete",
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channel: webhookChannel(request.channelId),
    createdAt: "2026-08-21T00:00:00.000Z",
    digest,
    guild: { id: GUILD_ID, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: webhookPermission(request.channelId),
    privacy: webhookPrivacy(),
    schemaVersion: 1,
    status: "planned",
    target: projectedWebhook(request.channelId),
    warnings: ["One-shot reviewed Incoming webhook deletion"],
  }
}

function webhookEndpoint(
  channelId: string,
  webhooks: ProjectedWebhook[],
) {
  return {
    channel: webhookChannel(channelId),
    inventory: {
      returned: webhooks.length,
      safetyLimit: 15,
    },
    permission: webhookPermission(channelId),
    webhooks,
  }
}

function webhookCreationPlan(
  request: WebhookCreationRequest,
  digest = DIGEST,
): WebhookCreationPlan {
  return {
    action: "create",
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-22T00:00:00.000Z",
    desired: {
      channelId: request.channelId,
      name: request.name,
      type: "incoming",
    },
    digest,
    guild: { id: GUILD_ID, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: webhookPrivacy(),
    risks: ["Creation adds a durable bearer capability"],
    schemaVersion: 1,
    source: webhookEndpoint(request.channelId, [projectedWebhook(request.channelId)]),
    status: "planned",
    warnings: ["The credential is projected out inside the REST client"],
  }
}

function webhookChangePlan(
  request: WebhookChangeRequest,
  digest = DIGEST,
  writeRequired = true,
): WebhookChangePlan {
  const current = projectedWebhook(request.channelId)
  const destinationChannelId = request.destinationChannelId ?? request.channelId
  const desired = {
    ...current,
    channelId: destinationChannelId,
    name: request.name ?? current.name,
  }
  const requestedFields = [
    ...(request.destinationChannelId !== undefined ? ["channelId" as const] : []),
    ...(request.name !== undefined ? ["name" as const] : []),
  ]
  const changedFields = writeRequired ? requestedFields : []
  return {
    action: "update",
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    changedFields,
    createdAt: "2026-08-22T00:00:00.000Z",
    current,
    desired: writeRequired ? desired : current,
    destination: writeRequired && destinationChannelId !== request.channelId
      ? webhookEndpoint(destinationChannelId, [])
      : null,
    digest,
    guild: { id: GUILD_ID, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: webhookPrivacy(),
    requestedFields,
    risks: ["Existing bearer credentials remain active after a move"],
    schemaVersion: 1,
    source: webhookEndpoint(request.channelId, [current]),
    status: writeRequired ? "planned" : "already-current",
    warnings: ["Credentials never enter MCP data"],
    writeRequired,
  }
}

function integrationAccess(): IntegrationAccessEvidence {
  return {
    appliedRoleIds: [GUILD_ID],
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    effectivePermissionNames: ["MANAGE_GUILD"],
    effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
    manageGuild: true,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: "0",
  }
}

function integrationPrivacy(): IntegrationPrivacyProjection {
  return {
    externalAccountIdentitiesProjectedOut: true,
    namesAndProfilesProjectedOut: true,
    omittedFields: [
      "account.id",
      "account.name",
      "application.description",
      "application.icon",
      "application.name",
      "application.owner",
      "application.team",
      "integration.name",
      "rawPayload",
      "user.avatar",
      "user.discriminator",
      "user.email",
      "user.globalName",
      "user.username",
    ],
    persistence: "none",
    rawPayloads: "omitted",
  }
}

function projectedIntegration(
  id = INTEGRATION_ID,
): DiscordGuildIntegrationSummary {
  return {
    accountPresent: true,
    applicationId: id === INTEGRATION_ID ? INTEGRATION_APPLICATION_ID : null,
    associatedBotUserId: id === INTEGRATION_ID ? INTEGRATION_BOT_ID : null,
    enableEmoticons: null,
    enabled: true,
    expireBehavior: null,
    expireGracePeriod: null,
    id,
    knownScopes: id === INTEGRATION_ID ? ["bot", "identify"] : [],
    linkedUserPresent: false,
    revoked: null,
    roleId: null,
    subscriberCount: null,
    syncedAt: null,
    syncing: null,
    type: id === INTEGRATION_ID ? "discord" : "twitch",
    unknownFieldCounts: {
      account: 0,
      application: 0,
      bot: 0,
      integration: 0,
      user: 0,
    },
    unknownScopeCount: 0,
  }
}

function integrationInventory(guildId = GUILD_ID): IntegrationInventoryResult {
  const integrations = [
    projectedIntegration(),
    projectedIntegration("375000000000000004"),
  ]
  return {
    access: integrationAccess(),
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    guild: { id: guildId, name: "Private guild name" },
    integrations,
    page: {
      inventoryComplete: true,
      returned: integrations.length,
      safetyLimit: 50,
    },
    privacy: integrationPrivacy(),
    schemaVersion: 1,
    status: "ok",
  }
}

function integrationDeletionPlan(
  request: IntegrationDeletionRequest,
  digest = DIGEST,
): IntegrationDeletionPlan {
  const inventory = integrationInventory(request.guildId)
  const target = inventory.integrations.find(({ id }) => id === request.integrationId)
    || projectedIntegration(request.integrationId)
  return {
    access: inventory.access,
    acknowledgments: {
      associatedBotKicked: request.acknowledgeAssociatedBotKicked,
      associatedWebhooksRemoved: true,
    },
    action: "delete",
    applicationId: APPLICATION_ID,
    associatedBotMembership: {
      present: target.associatedBotUserId !== null,
      userId: target.associatedBotUserId,
    },
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-22T00:00:00.000Z",
    digest,
    guild: inventory.guild,
    inventory: inventory.integrations,
    operationKeyHash: OPERATION_KEY_HASH,
    page: {
      inventoryComplete: true,
      returned: inventory.integrations.length,
      safetyLimit: 50,
    },
    privacy: inventory.privacy,
    schemaVersion: 1,
    status: "planned",
    target,
    warnings: [
      "Integration deletion is permanent and Discord can remove associated webhooks",
      "Integration deletion can kick the associated bot from the guild",
    ],
  }
}

function inviteAccess(): InviteAccessEvidence {
  return {
    appliedRoleIds: [GUILD_ID],
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    effectivePermissionNames: ["MANAGE_GUILD"],
    effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
    manageGuild: true,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: "0",
  }
}

function onboardingRequest(
  overrides: Partial<OnboardingChangeRequest> = {},
): OnboardingChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    defaultChannelIds: ONBOARDING_DEFAULT_CHANNEL_IDS,
    enabled: true,
    guildId: GUILD_ID,
    mode: "default",
    operationKey: ONBOARDING_OPERATION_KEY,
    prompts: [{
      inOnboarding: true,
      options: [{
        channelIds: [CHANNEL_ID],
        description: ONBOARDING_OPTION_DESCRIPTION,
        emoji: null,
        roleIds: [ROLE_ID],
        title: ONBOARDING_OPTION_TITLE,
      }],
      required: true,
      singleSelect: true,
      title: ONBOARDING_PROMPT_TITLE,
      type: "multiple-choice",
    }],
    ...overrides,
  }
}

function onboardingAccess(): OnboardingAccessEvidence {
  return {
    appliedRoleIds: [GUILD_ID],
    authorizedForChange: true,
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    effectivePermissionNames: ["MANAGE_GUILD", "MANAGE_ROLES"],
    effectivePermissions: (
      DISCORD_PERMISSIONS.MANAGE_GUILD | DISCORD_PERMISSIONS.MANAGE_ROLES
    ).toString(),
    highestRoleIds: [ROLE_ID],
    highestRolePosition: 2,
    manageGuild: true,
    manageRoles: true,
    requiredChangePermissions: ["MANAGE_GUILD", "MANAGE_ROLES"],
    unknownPermissionBits: "0",
  }
}

function onboardingPrivacy(includeText: boolean): OnboardingPrivacyProjection {
  return {
    persistence: "none",
    rawPayloads: "omitted",
    text: includeText ? "included" : "omitted",
    unknownFields: "counts-only",
  }
}

function onboardingConfiguration(
  request: OnboardingChangeRequest | null,
  includeText: boolean,
): OnboardingConfigurationView {
  const defaultChannels = (request?.defaultChannelIds ?? []).map((id) => ({
    direct: true,
    everyoneCanSend: true,
    everyoneCanView: true,
    exists: true,
    id,
    type: 0,
  }))
  const configured = request !== null
  return {
    communityGuild: true,
    defaultChannels,
    enabled: request?.enabled ?? false,
    enablement: {
      constraintsMet:
        defaultChannels.length >= ONBOARDING_LIMITS.enabledDefaultChannels,
      defaultChannelCount: defaultChannels.length,
      distinctDefaultChannelCount: defaultChannels.length,
      requiredDefaultChannelCount: ONBOARDING_LIMITS.enabledDefaultChannels,
      requiredSendableDefaultChannelCount:
        ONBOARDING_LIMITS.enabledSendableDefaultChannels,
      sendableDefaultChannelCount: defaultChannels.length,
      visibleDefaultChannelCount: defaultChannels.length,
    },
    issues: [],
    mode: { name: request?.mode ?? "default", value: 0 },
    prompts: configured
      ? request.prompts.map((prompt) => ({
          id: prompt.promptId ?? null,
          inOnboarding: prompt.inOnboarding,
          options: prompt.options.map((option) => ({
            channelReferences: option.channelIds.map((id) => ({
              direct: true,
              everyoneCanSend: true,
              everyoneCanView: true,
              exists: true,
              id,
              type: 0,
            })),
            description: includeText ? option.description : null,
            descriptionCharacters: option.description === null
              ? null
              : [...option.description].length,
            emoji: {
              animated: null,
              guildEmojiId: null,
              healthy: true,
              kind: "none",
              restrictedRoleIds: [],
              unicode: null,
            },
            id: option.optionId ?? null,
            roleReferences: option.roleIds.map((id) => ({
              exists: true,
              id,
              reasons: [],
              safeSelfAssignable: true,
            })),
            title: includeText ? option.title : null,
            titleCharacters: [...option.title].length,
          })),
          required: prompt.required,
          singleSelect: prompt.singleSelect,
          title: includeText ? prompt.title : null,
          titleCharacters: [...prompt.title].length,
          type: { name: prompt.type, value: 0 },
        }))
      : [],
    replacementBlockedReasons: [],
    textIncluded: includeText,
    unknownEnumCount: 0,
    unknownFieldCount: 0,
  }
}

function onboardingAudit(includeText: boolean): OnboardingAuditResult {
  return {
    access: onboardingAccess(),
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelEvidence: {
      gatewayChannelCount: 1,
      httpChannelCount: 1,
      httpMode: "complete",
      layoutRevision: 1,
      layoutUpdatedAt: "2026-08-21T00:00:00.000Z",
      metadataCoverage: "complete",
      obfuscatedChannelCount: 0,
      trustedMetadataCount: 1,
    },
    configuration: onboardingConfiguration(onboardingRequest(), includeText),
    guild: { id: GUILD_ID, name: "Private guild name" },
    localLimits: {
      defaultChannels: ONBOARDING_LIMITS.defaultChannels,
      enabledDefaultChannels: ONBOARDING_LIMITS.enabledDefaultChannels,
      enabledSendableDefaultChannels:
        ONBOARDING_LIMITS.enabledSendableDefaultChannels,
      optionDescriptionCharacters: ONBOARDING_LIMITS.optionDescriptionCharacters,
      optionReferences: ONBOARDING_LIMITS.optionReferences,
      optionsPerPrompt: ONBOARDING_LIMITS.optionsPerPrompt,
      optionTitleCharacters: ONBOARDING_LIMITS.optionTitleCharacters,
      prompts: ONBOARDING_LIMITS.prompts,
      promptTitleCharacters: ONBOARDING_LIMITS.promptTitleCharacters,
    },
    privacy: onboardingPrivacy(includeText),
    schemaVersion: 1,
    status: "ok",
    verificationBoundary: {
      apiReadback: true,
      freshNonStaffClientCheckRecommended: true,
      memberExperienceVerified: false,
    },
  }
}

function onboardingPlan(
  request: OnboardingChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): OnboardingChangePlan {
  const desired = onboardingConfiguration(request, true)
  const current = effect === "none"
    ? desired
    : onboardingConfiguration(null, true)
  const changed = effect === "change"
  return {
    access: onboardingAccess(),
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channelEvidence: {
      gatewayChannelCount: 1,
      httpChannelCount: 1,
      httpMode: "complete",
      layoutRevision: 1,
      layoutUpdatedAt: "2026-08-21T00:00:00.000Z",
      metadataCoverage: "complete",
      obfuscatedChannelCount: 0,
      trustedMetadataCount: 1,
    },
    createdAt: "2026-08-21T00:00:00.000Z",
    current,
    desired,
    diff: {
      channelAssignmentsAdded: changed ? 1 : 0,
      channelAssignmentsRemoved: 0,
      defaultChannelsAdded: changed ? request.defaultChannelIds.length : 0,
      defaultChannelsRemoved: 0,
      emojiChanges: 0,
      enabledChanged: changed,
      modeChanged: false,
      optionsAdded: changed ? 1 : 0,
      optionsModified: 0,
      optionsRemoved: 0,
      optionsRetained: changed ? 0 : 1,
      promptsAdded: changed ? 1 : 0,
      promptsModified: 0,
      promptsRemoved: 0,
      promptsRetained: changed ? 0 : 1,
      roleAssignmentsAdded: changed ? 1 : 0,
      roleAssignmentsRemoved: 0,
      textChanges: changed ? 3 : 0,
    },
    digest,
    guild: { id: request.guildId, name: "Private guild name" },
    localLimits: onboardingAudit(true).localLimits,
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: onboardingPrivacy(true),
    risks: changed
      ? ["fresh-member-client-check-required", "full-replacement"]
      : [],
    schemaVersion: 1,
    status: changed ? "planned" : "already-current",
    verificationBoundary: onboardingAudit(true).verificationBoundary,
    warnings: ["Fresh non-staff client verification remains external"],
    writeRequired: changed,
  }
}

function welcomeScreenRequest(
  overrides: Partial<WelcomeScreenChangeRequest> = {},
): WelcomeScreenChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    channels: [{
      channelId: CHANNEL_ID,
      description: WELCOME_SCREEN_CHANNEL_DESCRIPTION,
      emoji: { kind: "unicode", unicode: "👋" },
    }],
    description: WELCOME_SCREEN_DESCRIPTION,
    enabled: true,
    guildId: GUILD_ID,
    operationKey: WELCOME_SCREEN_OPERATION_KEY,
    ...overrides,
  }
}

function welcomeScreenAccess(): WelcomeScreenAccessEvidence {
  return {
    appliedRoleIds: [GUILD_ID],
    authorizedForChange: true,
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    effectivePermissionNames: ["MANAGE_GUILD"],
    effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
    manageGuild: true,
    requiredChangePermission: "MANAGE_GUILD",
    unknownPermissionBits: "0",
    warnings: [],
  }
}

function welcomeScreenPrivacy(
  includeText: boolean,
): WelcomeScreenPrivacyProjection {
  return {
    persistence: "none",
    rawPayloads: "omitted",
    text: includeText ? "included" : "omitted",
    unknownFields: "counts-only",
  }
}

function welcomeScreenConfiguration(
  request: WelcomeScreenChangeRequest | null,
  includeText: boolean,
): WelcomeScreenConfigurationView {
  return {
    available: true,
    channels: (request?.channels ?? []).map((entry) => ({
      channel: {
        channelId: entry.channelId,
        direct: true,
        everyoneCanView: true,
        exists: true,
        parentId: null,
        type: 0,
      },
      description: includeText ? entry.description : null,
      descriptionCharacters: [...entry.description].length,
      emoji: entry.emoji.kind === "unicode"
        ? {
            animated: null,
            available: null,
            customEmojiId: null,
            healthy: true,
            kind: "unicode",
            restrictedRoleIds: [],
            unicode: includeText ? entry.emoji.unicode : null,
          }
        : entry.emoji.kind === "custom"
          ? {
              animated: false,
              available: true,
              customEmojiId: entry.emoji.emojiId,
              healthy: true,
              kind: "custom",
              restrictedRoleIds: [],
              unicode: null,
            }
          : {
              animated: null,
              available: null,
              customEmojiId: null,
              healthy: true,
              kind: "none",
              restrictedRoleIds: [],
              unicode: null,
            },
    })),
    communityGuild: true,
    description: includeText ? request?.description ?? null : null,
    descriptionCharacters: request?.description === null || request === null
      ? null
      : [...request.description].length,
    enabled: request?.enabled ?? false,
    issues: [],
    replacementBlockedReasons: [],
    textIncluded: includeText,
    unknownFieldCount: 0,
  }
}

function welcomeScreenAudit(includeText: boolean): WelcomeScreenAuditResult {
  return {
    access: welcomeScreenAccess(),
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    configuration: welcomeScreenConfiguration(welcomeScreenRequest(), includeText),
    guild: { id: GUILD_ID, name: "Private guild name" },
    localLimits: {
      channelDescriptionCharacters:
        WELCOME_SCREEN_LIMITS.channelDescriptionCharacters,
      channels: WELCOME_SCREEN_LIMITS.channels,
      descriptionCharacters: WELCOME_SCREEN_LIMITS.descriptionCharacters,
    },
    privacy: welcomeScreenPrivacy(includeText),
    schemaVersion: 1,
    status: "ok",
    verificationBoundary: {
      apiReadback: true,
      freshNonStaffClientCheckRecommended: true,
      memberExperienceVerified: false,
    },
  }
}

function welcomeScreenPlan(
  request: WelcomeScreenChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): WelcomeScreenChangePlan {
  const desired = welcomeScreenConfiguration(request, true)
  const changed = effect === "change"
  return {
    access: welcomeScreenAccess(),
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-21T00:00:00.000Z",
    current: changed
      ? welcomeScreenConfiguration(null, true)
      : desired,
    desired,
    diff: {
      channelEntriesAdded: changed ? request.channels.length : 0,
      channelEntriesModified: 0,
      channelEntriesMoved: 0,
      channelEntriesRemoved: 0,
      descriptionChanged: changed,
      emojiChanges: changed ? request.channels.length : 0,
      enabledChanged: changed,
      textChanges: changed ? request.channels.length + 1 : 0,
    },
    digest,
    guild: { id: request.guildId, name: "Private guild name" },
    localLimits: welcomeScreenAudit(true).localLimits,
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: welcomeScreenPrivacy(true),
    risks: changed ? ["full-replacement", "omitted-entries-deleted"] : [],
    schemaVersion: 1,
    status: changed ? "planned" : "already-current",
    verificationBoundary: welcomeScreenAudit(true).verificationBoundary,
    warnings: changed
      ? ["This replacement is complete and ordered"]
      : ["The complete desired Welcome Screen already matches Discord"],
    writeRequired: changed,
  }
}

function widgetSettingsRequest(
  overrides: Partial<WidgetSettingsChangeRequest> = {},
): WidgetSettingsChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    enabled: true,
    guildId: GUILD_ID,
    operationKey: WIDGET_SETTINGS_OPERATION_KEY,
    ...overrides,
  }
}

function widgetSettingsAccess(): WidgetSettingsAccessEvidence {
  return {
    appliedRoleIds: [GUILD_ID],
    authorizedForChange: true,
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    effectivePermissionNames: ["MANAGE_GUILD"],
    effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
    manageGuild: true,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: "0",
    warnings: [],
  }
}

function widgetSettingsPrivacy(): WidgetSettingsPrivacyProjection {
  return {
    anonymousEndpoints: "not-called",
    channelNames: "omitted",
    invites: "omitted",
    memberAndPresenceData: "omitted",
    persistence: "none",
    rawPayloads: "omitted",
    unknownFields: "counts-only",
  }
}

function widgetSettingsConfiguration(
  request: WidgetSettingsChangeRequest | null,
): WidgetSettingsConfigurationView {
  const channelId = request?.channelId ?? null
  return {
    channel: channelId === null
      ? null
      : {
          ageRestricted: false,
          channelId,
          direct: true,
          everyoneCanCreateInvites: false,
          everyoneCanView: true,
          exists: true,
          parentId: null,
          type: 0,
          unknownPermissionBits: "0",
        },
    channelId,
    changeBlockedReasons: [],
    enabled: request?.enabled ?? false,
    issues: [],
    unknownFieldCount: 0,
  }
}

function widgetSettingsAudit(): WidgetSettingsAuditResult {
  const request = widgetSettingsRequest()
  return {
    access: widgetSettingsAccess(),
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    configuration: widgetSettingsConfiguration(request),
    guild: { id: GUILD_ID, name: "Private guild name" },
    guildCrossCheck: {
      channelIdObserved: true,
      enabledObserved: true,
      status: "match",
    },
    localConstraints: {
      guildAllowlist: 100,
      supportedChannelTypes: [0, 2, 5, 13, 15, 16],
    },
    privacy: widgetSettingsPrivacy(),
    publicExposure: {
      anonymousInviteGenerationPotential: true,
      anonymousWidgetDataPotential: true,
      anonymousWidgetFetched: false,
      anonymousWidgetImageFetched: false,
      manualPrivateProfileRestorationMayBeRequired: false,
      privateProfileStateObserved: false,
      serverProfileVisibility: "public-by-widget",
    },
    schemaVersion: 1,
    status: "ok",
    verificationBoundary: {
      anonymousWidgetReadbackPerformed: false,
      apiReadback: true,
      freshNonMemberReviewRecommended: true,
      privateProfileRestorationVerified: false,
      privateProfileStateObserved: false,
    },
  }
}

function widgetSettingsPlan(
  request: WidgetSettingsChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): WidgetSettingsChangePlan {
  const desired = widgetSettingsConfiguration(request)
  const changed = effect === "change"
  const current = changed
    ? widgetSettingsConfiguration(null)
    : desired
  return {
    access: widgetSettingsAccess(),
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-22T00:00:00.000Z",
    current,
    desired,
    diff: {
      channelChanged: current.channelId !== desired.channelId,
      enabledChanged: current.enabled !== desired.enabled,
    },
    digest,
    guild: { id: request.guildId, name: "Private guild name" },
    guildCrossCheck: {
      channelIdObserved: true,
      enabledObserved: true,
      status: "match",
    },
    localConstraints: widgetSettingsAudit().localConstraints,
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: widgetSettingsPrivacy(),
    publicExposureAuthorization: {
      required: changed && (request.enabled || request.channelId !== null),
      satisfied: true,
    },
    risks: changed
      ? ["server-profile-public", "anonymous-widget-data"]
      : [],
    schemaVersion: 1,
    status: changed ? "planned" : "already-current",
    verificationBoundary: widgetSettingsAudit().verificationBoundary,
    warnings: changed
      ? ["Manual Private Profile restoration may be required after disabling"]
      : ["The complete desired authenticated widget settings already match Discord"],
    writeRequired: changed,
  }
}

function guildSettingsRequest(
  overrides: Partial<GuildSettingsChangeRequest> = {},
): GuildSettingsChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    defaultMessageNotifications: "only-mentions",
    explicitContentFilter: "all-members",
    guildId: GUILD_ID,
    operationKey: GUILD_SETTINGS_OPERATION_KEY,
    verificationLevel: "high",
    ...overrides,
  }
}

function guildSettingsAccess(): GuildSettingsAccessEvidence {
  return {
    appliedRoleIds: [GUILD_ID],
    authorizedForChange: true,
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    effectivePermissionNames: ["MANAGE_GUILD"],
    effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
    manageGuild: true,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: "0",
    warnings: [],
  }
}

function guildSettingsPrivacy(): GuildSettingsPrivacyProjection {
  return {
    channelNames: "omitted",
    guildPresentation: "omitted",
    memberData: "omitted",
    persistence: "none",
    rawPayloads: "omitted",
    roleNames: "omitted",
    unknownValues: "bit-presence-only",
  }
}

function guildSettingsConfiguration(
  request: GuildSettingsChangeRequest | null,
): GuildSettingsConfigurationView {
  const base: GuildSettingsConfigurationView = {
    afkChannel: null,
    afkChannelId: null,
    afkTimeoutSeconds: 300,
    defaultMessageNotifications: "all-messages",
    explicitContentFilter: "members-without-roles",
    issues: [],
    premiumProgressBarEnabled: false,
    suppressedSystemNotifications: [],
    systemChannel: {
      channelId: CHANNEL_ID,
      eligible: true,
      exists: true,
      metadata: "trusted",
      parentId: null,
      type: DISCORD_CHANNEL_TYPES.text,
    },
    systemChannelId: CHANNEL_ID,
    unknownSystemChannelFlagsPresent: false,
    verificationLevel: "medium",
  }
  if (!request) return base
  const afkChannelId = request.afkChannelId === undefined
    ? base.afkChannelId
    : request.afkChannelId
  const systemChannelId = request.systemChannelId === undefined
    ? base.systemChannelId
    : request.systemChannelId
  return {
    ...base,
    afkChannel: afkChannelId === null
      ? null
      : {
          channelId: afkChannelId,
          eligible: true,
          exists: true,
          metadata: "trusted",
          parentId: null,
          type: DISCORD_CHANNEL_TYPES.voice,
        },
    afkChannelId,
    afkTimeoutSeconds: request.afkTimeoutSeconds ?? base.afkTimeoutSeconds,
    defaultMessageNotifications: request.defaultMessageNotifications
      ?? base.defaultMessageNotifications,
    explicitContentFilter: request.explicitContentFilter
      ?? base.explicitContentFilter,
    premiumProgressBarEnabled: request.premiumProgressBarEnabled
      ?? base.premiumProgressBarEnabled,
    suppressedSystemNotifications: request.suppressedSystemNotifications === undefined
      ? base.suppressedSystemNotifications
      : [...request.suppressedSystemNotifications].sort(),
    systemChannel: systemChannelId === null
      ? null
      : {
          channelId: systemChannelId,
          eligible: true,
          exists: true,
          metadata: "trusted",
          parentId: null,
          type: DISCORD_CHANNEL_TYPES.text,
        },
    systemChannelId,
    verificationLevel: request.verificationLevel ?? base.verificationLevel,
  }
}

function guildSettingsInventory() {
  return {
    gatewayChannelCount: 1,
    httpChannelCount: 1,
    httpMode: "complete" as const,
    layoutRevision: 7,
    layoutUpdatedAt: "2026-08-23T00:00:00.000Z",
    metadataCoverage: "complete" as const,
    obfuscatedChannelCount: 0,
    trustedMetadataCount: 1,
  }
}

function guildSettingsLocalConstraints(): GuildSettingsAuditResult["localConstraints"] {
  return {
    afkChannelTypes: [DISCORD_CHANNEL_TYPES.voice],
    afkTimeoutSeconds: [60, 300, 900, 1_800, 3_600],
    defaultMessageNotifications: ["all-messages", "only-mentions"],
    explicitContentFilters: [
      "disabled",
      "members-without-roles",
      "all-members",
    ],
    guildAllowlist: 100,
    supportedFields: [...GUILD_SETTINGS_FIELDS],
    systemChannelTypes: [
      DISCORD_CHANNEL_TYPES.text,
      DISCORD_CHANNEL_TYPES.announcement,
    ],
    systemNotificationSuppressions: [
      "guild-reminders",
      "join-notification-replies",
      "join-notifications",
      "premium-subscriptions",
      "role-subscription-purchase-notification-replies",
      "role-subscription-purchase-notifications",
    ],
    verificationLevels: ["none", "low", "medium", "high", "very-high"],
  }
}

function guildSettingsAudit(): GuildSettingsAuditResult {
  return {
    access: guildSettingsAccess(),
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    configuration: guildSettingsConfiguration(null),
    guildId: GUILD_ID,
    inventory: guildSettingsInventory(),
    localConstraints: guildSettingsLocalConstraints(),
    privacy: guildSettingsPrivacy(),
    schemaVersion: 1,
    status: "ok",
    verificationBoundary: {
      automaticRetry: false,
      freshApiReadback: true,
      gatewayLayoutContinuity: true,
      mutationResponse: true,
      rollback: "not-automatic",
    },
  }
}

function guildSettingsPlan(
  request: GuildSettingsChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): GuildSettingsChangePlan {
  const requestedFields = GUILD_SETTINGS_FIELDS
    .filter((field) => Object.hasOwn(request, field))
    .sort()
  const desired = guildSettingsConfiguration(request)
  const changed = effect === "change"
  const current = changed ? guildSettingsConfiguration(null) : desired
  const effectByField = {
    afkChannelId: "routing-change",
    afkTimeoutSeconds: "timeout-change",
    defaultMessageNotifications: "noise-reducing",
    explicitContentFilter: "strengthening",
    premiumProgressBarEnabled: "presentation-change",
    suppressedSystemNotifications: "suppression-increase",
    systemChannelId: "routing-change",
    verificationLevel: "strengthening",
  } as const
  return {
    access: guildSettingsAccess(),
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    changedFields: changed ? requestedFields : [],
    createdAt: "2026-08-23T00:00:00.000Z",
    current,
    desired,
    digest,
    effects: changed
      ? requestedFields.map((field) => ({ effect: effectByField[field], field }))
      : [],
    guildId: request.guildId,
    inventory: guildSettingsInventory(),
    localConstraints: guildSettingsLocalConstraints(),
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: guildSettingsPrivacy(),
    requestedFields,
    risks: changed ? ["verification-strengthened", "notification-default-changed"] : [],
    schemaVersion: 1,
    status: changed ? "planned" : "already-current",
    verificationBoundary: guildSettingsAudit().verificationBoundary,
    warnings: changed
      ? ["Only the reviewed named fields will be patched"]
      : ["The requested guild settings already match Discord"],
    writeRequired: changed,
  }
}

const CHANNEL_METADATA_FIELDS = [
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "name",
  "nsfw",
  "rateLimitPerUser",
  "topic",
] as const

function channelMetadataRequest(
  overrides: Partial<ChannelMetadataChangeRequest> = {},
): ChannelMetadataChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    name: "announcements",
    operationKey: CHANNEL_METADATA_OPERATION_KEY,
    topic: null,
    ...overrides,
  }
}

function channelMetadataView(
  overrides: Partial<ChannelMetadataView> = {},
): ChannelMetadataView {
  return {
    applicableFields: [...CHANNEL_METADATA_FIELDS],
    defaultAutoArchiveDuration: 1_440,
    defaultThreadRateLimitPerUser: 0,
    guildId: GUILD_ID,
    id: CHANNEL_ID,
    name: "general",
    nsfw: false,
    parentId: null,
    permissionOverwriteCount: 0,
    position: 1,
    rateLimitPerUser: 0,
    topic: "Private release planning",
    type: 0,
    unknownFieldCount: 0,
    ...overrides,
  }
}

function channelMetadataRead(channelId = CHANNEL_ID): ChannelMetadataReadResult {
  return {
    metadata: channelMetadataView({ id: channelId }),
    privacy: {
      persistence: "none",
      rawPayloads: "omitted",
      text: "included",
      unknownFields: "counts-only",
    },
    schemaVersion: 1,
    status: "ok",
  }
}

function channelMetadataPlan(
  request: ChannelMetadataChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): ChannelMetadataChangePlan {
  const record = request as unknown as Record<string, unknown>
  const requestedFields = CHANNEL_METADATA_FIELDS.filter((field) => (
    Object.hasOwn(record, field)
  ))
  const desired = channelMetadataView({
    ...(Object.hasOwn(record, "defaultAutoArchiveDuration")
      ? { defaultAutoArchiveDuration: request.defaultAutoArchiveDuration as number }
      : {}),
    ...(Object.hasOwn(record, "defaultThreadRateLimitPerUser")
      ? { defaultThreadRateLimitPerUser: request.defaultThreadRateLimitPerUser as number }
      : {}),
    ...(Object.hasOwn(record, "name") ? { name: request.name as string } : {}),
    ...(Object.hasOwn(record, "nsfw") ? { nsfw: request.nsfw as boolean } : {}),
    ...(Object.hasOwn(record, "rateLimitPerUser")
      ? { rateLimitPerUser: request.rateLimitPerUser as number }
      : {}),
    ...(Object.hasOwn(record, "topic")
      ? { topic: request.topic === "" ? null : request.topic as string | null }
      : {}),
  })
  const current = effect === "none" ? desired : channelMetadataView()
  const changes = requestedFields.flatMap((field) => (
    current[field] === desired[field]
      ? []
      : [{ after: desired[field], before: current[field], field }]
  ))
  return {
    access: {
      appliedRoleIds: [GUILD_ID],
      authorizedForChange: true,
      botAdministrator: false,
      botGuildOwner: false,
      connect: null,
      effectivePermissionNames: ["VIEW_CHANNEL", "MANAGE_CHANNELS"],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      ).toString(),
      manageChannels: true,
      requiredChangePermissions: ["MANAGE_CHANNELS", "VIEW_CHANNEL"],
      unknownPermissionBits: "0",
      viewChannel: true,
    },
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    changedFields: changes.map(({ field }) => field),
    changes,
    createdAt: "2026-08-21T00:00:00.000Z",
    current,
    desired,
    digest,
    guild: { id: request.guildId, name: "Private guild name" },
    localLimits: {
      defaultAutoArchiveDurations: [60, 1_440, 4_320, 10_080],
      forumAndMediaTopicCharacters: 4_096,
      nameCharacters: 100,
      rateLimitSeconds: 21_600,
      standardTopicCharacters: 1_024,
    },
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: channelMetadataRead().privacy,
    requestedFields,
    risks: ["One non-retried PATCH followed by complete verification"],
    schemaVersion: 1,
    status: changes.length > 0 ? "planned" : "already-current",
    warnings: ["Discord guild and channel text is untrusted"],
    writeRequired: changes.length > 0,
  }
}

function forumTagObserved(
  tags: PlannedForumTagView[] = [{
    emoji: { kind: "unicode", unicodeEmoji: "📌" },
    id: FORUM_TAG_ID,
    moderated: false,
    name: "Support",
    position: 0,
    unknownFieldCount: 0,
  }],
): ForumTagObservedState {
  const observedTags = tags.map((tag) => ({
    ...tag,
    id: tag.id || CREATED_FORUM_TAG_ID,
  }))
  return {
    channel: {
      flags: 0,
      guildId: GUILD_ID,
      id: CHANNEL_ID,
      permissionOverwriteUnknownFieldCount: 0,
      type: 15,
      unknownFieldCount: 0,
    },
    inventory: {
      returned: observedTags.length,
      safetyLimit: 20,
      unknownTagFields: 0,
    },
    tags: observedTags,
  }
}

function forumTagAudit(): ForumTagAuditResult {
  return {
    ...forumTagObserved(),
    access: {
      appliedRoleIds: [GUILD_ID],
      authorizedForChange: true,
      botAdministrator: false,
      botGuildOwner: false,
      complete: true,
      effectivePermissionNames: ["VIEW_CHANNEL", "MANAGE_CHANNELS"],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      ).toString(),
      manageChannels: true,
      requiredPermissions: ["VIEW_CHANNEL"],
      unknownPermissionBits: "0",
      viewChannel: true,
    },
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    limitations: ["Discord does not expose bounded tag-use counts"],
    privacy: {
      persistence: "content-free-activity-only",
      rawPayloads: "omitted",
      tagText: "included-in-transient-results",
      unknownFields: "counts-only",
    },
    schemaVersion: 1,
    status: "ok",
  }
}

function forumTagPlan(
  request: ForumTagChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): ForumTagChangePlan {
  const current = forumTagObserved()
  const target = request.action === "create"
    ? effect === "none" ? current.tags[0] as ForumTagObservedState["tags"][number] : null
    : current.tags.find(({ id }) => id === request.tagId) || current.tags[0]!
  const targetId = target?.id
  let desiredTags: PlannedForumTagView[] = current.tags.map((tag) => ({ ...tag }))
  if (effect === "change" && request.action === "create") {
    desiredTags = [...desiredTags, {
      emoji: request.unicodeEmoji
        ? { kind: "unicode", unicodeEmoji: request.unicodeEmoji }
        : { kind: "none" },
      id: null,
      moderated: request.moderated ?? false,
      name: request.name,
      position: desiredTags.length,
      unknownFieldCount: 0,
    }]
  } else if (effect === "change" && request.action === "delete") {
    desiredTags = desiredTags.filter(({ id }) => id !== targetId)
      .map((tag, position) => ({ ...tag, position }))
  } else if (effect === "change" && request.action === "update-metadata") {
    desiredTags = desiredTags.map((tag) => tag.id === targetId
      ? {
          ...tag,
          ...(request.moderated !== undefined ? { moderated: request.moderated } : {}),
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(Object.hasOwn(request, "unicodeEmoji")
            ? {
                emoji: request.unicodeEmoji
                  ? { kind: "unicode" as const, unicodeEmoji: request.unicodeEmoji }
                  : { kind: "none" as const },
              }
            : {}),
        }
      : tag)
  }
  return {
    access: {
      appliedRoleIds: [GUILD_ID],
      authorizedForChange: true,
      botAdministrator: false,
      botGuildOwner: false,
      complete: true,
      effectivePermissionNames: ["VIEW_CHANNEL", "MANAGE_CHANNELS"],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      ).toString(),
      manageChannels: true,
      requiredPermissions: ["MANAGE_CHANNELS", "VIEW_CHANNEL"],
      unknownPermissionBits: "0",
      viewChannel: true,
    },
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channel: current.channel,
    createdAt: "2026-08-22T18:00:00.000Z",
    currentInventory: current.inventory,
    currentTags: current.tags,
    desiredInventory: {
      returned: desiredTags.length,
      safetyLimit: 20,
      unknownTagFields: 0,
    },
    desiredTags,
    digest,
    guild: { id: request.guildId },
    impact: {
      activeThreadsEnumerated: false,
      tagUsage: request.action === "delete"
        ? "unknown-unavailable"
        : "not-applicable",
    },
    localLimits: {
      customEmojiIntroduction: false,
      forumTags: 20,
      mediaChannels: false,
      nameCharacters: 20,
      reorder: false,
    },
    mutation: effect === "none" ? "none" : request.action,
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: {
      persistence: "content-free-activity-only",
      rawPayloads: "omitted",
      tagText: "included-in-transient-results",
      unknownFields: "counts-only",
    },
    risks: ["One non-retried full available_tags PATCH"],
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    target,
    warnings: ["Discord tag text is untrusted"],
    writeRequired: effect !== "none",
  }
}

function invitePrivacy(): InvitePrivacyProjection {
  return {
    capabilitiesProjectedOut: true,
    omittedFields: INVITE_OMITTED_FIELDS,
    persistence: "none",
    rawPayloads: "omitted",
  }
}

function projectedInvite(): ProjectedInvite {
  return {
    channel: {
      id: CHANNEL_ID,
      name: "Private invite channel",
      type: 0,
    },
    createdAt: "2026-08-20T00:00:00.000Z",
    expiresAt: "2026-08-20T01:00:00.000Z",
    flags: {
      guest: false,
      raw: 0,
      unknownBits: "0",
    },
    inviteRef: INVITE_REF,
    inviterUserId: USER_ID,
    maxAgeSeconds: 3_600,
    maxUses: 5,
    riskFlags: ["already-used"],
    roles: [],
    target: null,
    temporaryMembership: false,
    uses: 1,
  }
}

function inviteDeletionPlan(
  request: InviteDeletionRequest,
  digest = DIGEST,
): InviteDeletionPlan {
  return {
    access: inviteAccess(),
    action: "delete",
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-21T00:00:00.000Z",
    digest,
    guild: { id: request.guildId, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: invitePrivacy(),
    schemaVersion: 1,
    status: "planned",
    target: projectedInvite(),
    visibleInventory: {
      channelLimit: 500,
      channels: 1,
      inviteLimit: 1_000,
      invites: 1,
      roleLimit: 250,
      roles: 1,
    },
    warnings: ["One-shot capability revocation"],
  }
}

function guildTemplateStructure(): GuildTemplateStructure {
  return {
    channels: {
      announcement: 0,
      category: 0,
      directory: 0,
      forum: 0,
      media: 0,
      nsfw: 0,
      stage: 0,
      text: 1,
      threads: 0,
      total: 1,
      unknown: 0,
      voice: 0,
    },
    permissionOverwrites: {
      memberTargets: 0,
      roleTargets: 0,
      total: 0,
      unknownTargets: 0,
    },
    roles: {
      privileged: 0,
      riskyPermissionClasses: 0,
      total: 1,
      unknownPermissionBitfields: 0,
    },
    unknownFields: 0,
  }
}

function guildTemplatePrivacy(): GuildTemplatePrivacyProjection {
  return {
    capabilities: "opaque-process-local-references",
    omittedFields: [
      "code",
      "useUrl",
      "name",
      "description",
      "creatorProfile",
      "guildName",
      "roleNames",
      "channelNames",
      "channelTopics",
      "iconHashes",
      "serializedSourceGuild",
      "rawPayloads",
    ],
    persistence: "content-free-activity-only",
    rawPayloads: "omitted",
  }
}

function projectedGuildTemplate(): ProjectedGuildTemplate {
  return {
    createdAt: "2026-08-20T00:00:00.000Z",
    creatorUserId: USER_ID,
    isDirty: true,
    metadata: {
      descriptionCharacters: 28,
      nameCharacters: 21,
    },
    structure: guildTemplateStructure(),
    templateRef: GUILD_TEMPLATE_REF,
    unknownFieldCount: 0,
    updatedAt: "2026-08-21T00:00:00.000Z",
    usageCount: 3,
  }
}

function guildTemplatePlan(
  request: GuildTemplateChangeRequest,
  digest = DIGEST,
  mutation: GuildTemplateChangePlan["mutation"] = request.action,
): GuildTemplateChangePlan {
  const target = request.action === "create" ? null : projectedGuildTemplate()
  return {
    access: {
      appliedRoleIds: [ROLE_ID],
      botAdministrator: false,
      botIsGuildOwner: false,
      complete: true,
      effectivePermissionNames: ["MANAGE_GUILD"],
      effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
      manageGuild: true,
      requiredPermission: "MANAGE_GUILD",
      unknownPermissionBits: "0",
    },
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channelEvidence: {
      gatewayChannelCount: 1,
      httpChannelCount: 1,
      httpMode: "complete",
      layoutRevision: 1,
      layoutUpdatedAt: "2026-08-22T00:00:00.000Z",
      metadataCoverage: "complete",
      obfuscatedChannelCount: 0,
      trustedMetadataCount: 1,
    },
    createdAt: "2026-08-22T00:00:00.000Z",
    desiredMetadata: request.action === "create" || request.action === "update-metadata"
      ? { description: request.description, name: request.name }
      : null,
    digest,
    drift: target
      ? {
          ambiguousChannelIdentities: 0,
          ambiguousRoleIdentities: 0,
          channelComparisonComplete: true,
          channelSettingsChanged: 1,
          channelsAddedSinceSnapshot: 0,
          channelsMissingFromGuild: 0,
          roleSettingsChanged: 0,
          rolesAddedSinceSnapshot: 0,
          rolesMissingFromGuild: 0,
        }
      : null,
    guild: { id: request.guildId },
    inventory: { returned: 1, safetyLimit: 100 },
    liveStructure: guildTemplateStructure(),
    mutation,
    operationKeyHash: OPERATION_KEY_HASH,
    privacy: guildTemplatePrivacy(),
    risks: ["The reviewed capability will change"],
    schemaVersion: 1,
    status: mutation === "none" ? "already-current" : "planned",
    target,
    warnings: [
      "Template codes and use URLs are intentionally omitted",
      "The full private inventory is freshness-bound",
    ],
  }
}

function guildExpressionPrivacy(): GuildExpressionPrivacyProjection {
  return {
    omittedFields: [
      "cdnUrl",
      "imageBytes",
      "rawDiscordObject",
      "uploaderProfile",
    ],
    privateFieldsProjectedOut: true,
  }
}

function projectedGuildExpression(
  kind: GuildExpressionKind,
  expressionId = kind === "emoji" ? EMOJI_ID : STICKER_ID,
): ProjectedGuildExpression {
  return kind === "emoji"
    ? {
        animated: false,
        available: true,
        creatorUserId: BOT_ID,
        expressionId,
        kind,
        managed: false,
        name: "reviewed_emoji",
        requiresColons: true,
        roleIds: [ROLE_ID],
      }
    : {
        available: true,
        creatorUserId: BOT_ID,
        description: "Reviewed sticker",
        expressionId,
        formatType: 1,
        guildId: GUILD_ID,
        kind,
        name: "Reviewed sticker",
        tags: "reviewed",
      }
}

function guildExpressionPlan(
  request: GuildExpressionChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): GuildExpressionPlan {
  const existing = request.action === "create"
    ? null
    : projectedGuildExpression(request.kind, request.expressionId)
  const desired = request.action === "delete"
    ? null
    : request.kind === "emoji"
      ? {
          animated: existing?.kind === "emoji" ? existing.animated : false,
          available: existing?.kind === "emoji" ? existing.available : true,
          creatorUserId: existing?.creatorUserId ?? BOT_ID,
          expressionId: existing?.expressionId ?? null,
          kind: "emoji" as const,
          managed: existing?.kind === "emoji" ? existing.managed : false,
          name: request.name ?? (existing?.kind === "emoji" ? existing.name : "reviewed_emoji"),
          requiresColons: existing?.kind === "emoji" ? existing.requiresColons : true,
          roleIds: request.roleIds === undefined
            ? existing?.kind === "emoji" ? existing.roleIds : []
            : [...request.roleIds],
        }
      : {
          available: existing?.kind === "sticker" ? existing.available : true,
          creatorUserId: existing?.creatorUserId ?? BOT_ID,
          description: request.description === undefined
            ? existing?.kind === "sticker" ? existing.description : "Reviewed sticker"
            : request.description,
          expressionId: existing?.expressionId ?? null,
          formatType: existing?.kind === "sticker" ? existing.formatType : 1,
          guildId: request.guildId,
          kind: "sticker" as const,
          name: request.name ?? (existing?.kind === "sticker" ? existing.name : "Reviewed sticker"),
          tags: request.tags ?? (existing?.kind === "sticker" ? existing.tags : "reviewed"),
        }
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-21T00:00:00.000Z",
    desired,
    digest,
    effect,
    existing,
    file: request.action === "create"
      ? {
          contentDigest: `hmac-sha256:${"d".repeat(64)}`,
          review: {
            animated: false,
            canonicalPath: request.filePath,
            containedByConfiguredRoot: true,
            durationSeconds: null,
            format: "png",
            height: request.kind === "sticker" ? 320 : 64,
            mediaType: "image/png",
            ownerMatchesProcess: true,
            regularFile: true,
            singleLink: true,
            sizeBytes: 128,
            stableRead: true,
            width: request.kind === "sticker" ? 320 : 64,
          },
        }
      : null,
    guild: { id: request.guildId, name: "Private guild name" },
    kind: request.kind,
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      confidence: "complete",
      createGuildExpressions: true,
      effectivePermissions: (
        DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS
        | DISCORD_PERMISSIONS.MANAGE_GUILD_EXPRESSIONS
      ).toString(),
      guildOwner: false,
      manageGuildExpressions: true,
      ownershipRequired: false,
    },
    privacy: guildExpressionPrivacy(),
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    visibleInventory: {
      returned: 1,
      safetyLimit: request.kind === "emoji" ? 1_000 : 100,
    },
    warnings: ["One-shot reviewed guild expression change"],
  }
}

function soundboardPrivacy(): SoundboardPrivacyProjection {
  return {
    audioPersisted: false,
    creatorProfilesExposed: false,
    omittedFields: [
      "audioBytes",
      "cdnUrl",
      "creatorProfile",
      "rawDiscordObject",
    ],
    privateFieldsProjectedOut: true,
  }
}

function projectedSoundboardSound(
  soundId = SOUNDBOARD_SOUND_ID,
): ProjectedSoundboardSound {
  return {
    available: true,
    creatorUserId: BOT_ID,
    emoji: { emojiName: "🔔", kind: "unicode" },
    guildId: GUILD_ID,
    name: "Reviewed sound",
    soundId,
    unknownFieldCount: 0,
    volume: 0.75,
  }
}

function soundboardPlan(
  request: SoundboardChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): SoundboardPlan {
  const existing = request.action === "create"
    ? null
    : projectedSoundboardSound(request.soundId)
  const desired = request.action === "delete"
    ? null
    : request.action === "create"
      ? {
          available: true,
          creatorUserId: BOT_ID,
          emoji: request.emoji,
          guildId: request.guildId,
          name: request.name,
          soundId: null,
          volume: request.volume,
        }
      : {
          available: existing!.available,
          creatorUserId: existing!.creatorUserId as string,
          emoji: request.emoji ?? existing!.emoji,
          guildId: request.guildId,
          name: request.name ?? existing!.name,
          soundId: request.soundId,
          volume: request.volume ?? existing!.volume,
        }
  const requestedEmoji = request.action === "create"
    ? request.emoji
    : request.action === "update"
      ? request.emoji
      : undefined
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-21T00:00:00.000Z",
    customEmoji: requestedEmoji?.kind === "custom"
      ? {
          animated: false,
          available: true,
          emojiId: requestedEmoji.emojiId,
          managed: false,
          name: "reviewed_emoji",
        }
      : null,
    desired,
    digest,
    effect,
    existing,
    file: request.action === "create"
      ? {
          contentDigest: `hmac-sha256:${"e".repeat(64)}`,
          review: {
            canonicalPath: request.filePath,
            codec: "mpeg-1-layer-3",
            containedByConfiguredRoot: true,
            durationSeconds: 1.25,
            format: "mp3",
            mediaType: "audio/mpeg",
            ownerMatchesProcess: true,
            regularFile: true,
            singleLink: true,
            sizeBytes: 256,
            stableRead: true,
          },
        }
      : null,
    guild: { id: request.guildId, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      appliedRoleIds: [request.guildId],
      confidence: "complete",
      createGuildExpressions: true,
      effectivePermissionNames: [
        "CREATE_GUILD_EXPRESSIONS",
        "MANAGE_GUILD_EXPRESSIONS",
      ],
      effectivePermissions: (
        DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS
        | DISCORD_PERMISSIONS.MANAGE_GUILD_EXPRESSIONS
      ).toString(),
      guildOwner: false,
      manageGuildExpressions: true,
      ownershipRequired: false,
      warnings: [],
    },
    privacy: soundboardPrivacy(),
    schemaVersion: 1,
    soundId: request.action === "create" ? null : request.soundId,
    status: effect === "none" ? "already-current" : "planned",
    visibleInventory: {
      returned: 1,
      safetyLimit: 250,
    },
    warnings: ["One-shot reviewed guild soundboard change"],
  }
}

function autoModerationPrivacy(): AutoModerationPrivacyProjection {
  return {
    actionExecutionEventsExposed: false,
    omittedFields: [
      "actionExecutionContent",
      "matchedContent",
      "matchedKeyword",
      "rawDiscordObject",
    ],
    policyContentPersisted: false,
  }
}

function autoModerationReferences(): AutoModerationReferenceEvidence {
  return {
    alertChannels: [],
    exemptChannels: [],
    exemptRoles: [],
    healthy: true,
  }
}

function projectedAutoModerationRule(
  ruleId = AUTOMOD_RULE_ID,
): ProjectedAutoModerationRule {
  return {
    actions: [{ customMessage: "Review this message", type: "block-message" }],
    creatorUserId: BOT_ID,
    enabled: false,
    eventType: "message-send",
    exemptChannelIds: [],
    exemptRoleIds: [],
    guildId: GUILD_ID,
    name: "Reviewed keyword policy",
    ruleId,
    trigger: {
      allowList: [],
      keywordFilter: ["reviewed-keyword"],
      regexPatterns: [],
      type: "keyword",
    },
  }
}

function autoModerationPlan(
  request: AutoModerationChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): AutoModerationPlan {
  const normalized = normalizeAutoModerationChangeRequest(request)
  const existing = normalized.action === "create"
    ? null
    : projectedAutoModerationRule(normalized.ruleId)
  const desired = normalized.action === "delete"
    ? null
    : normalized.action === "create"
      ? {
          actions: [...normalized.actions],
          creatorUserId: BOT_ID,
          enabled: false,
          eventType: normalized.trigger.type === "member-profile"
            ? "member-update" as const
            : "message-send" as const,
          exemptChannelIds: [...normalized.exemptChannelIds],
          exemptRoleIds: [...normalized.exemptRoleIds],
          guildId: normalized.guildId,
          name: normalized.name,
          ruleId: null,
          trigger: normalized.trigger,
        }
      : normalized.action === "set-enabled"
        ? { ...existing!, enabled: normalized.enabled }
        : {
            ...existing!,
            ...(normalized.actions === undefined ? {} : { actions: [...normalized.actions] }),
            ...(normalized.exemptChannelIds === undefined
              ? {}
              : { exemptChannelIds: [...normalized.exemptChannelIds] }),
            ...(normalized.exemptRoleIds === undefined
              ? {}
              : { exemptRoleIds: [...normalized.exemptRoleIds] }),
            ...(normalized.name === undefined ? {} : { name: normalized.name }),
            ...(normalized.trigger === undefined ? {} : { trigger: normalized.trigger }),
          }
  return {
    action: normalized.action,
    applicationId: APPLICATION_ID,
    auditReason: normalized.auditReason,
    botId: BOT_ID,
    capacity: normalized.action === "create"
      ? {
          inventoryDigest: `hmac-sha256:${"d".repeat(64)}`,
          limitForTrigger: normalized.trigger.type === "keyword" ? 6 : 1,
          observedForTrigger: 0,
          safetyLimit: 10,
          visibleRules: 1,
        }
      : null,
    createdAt: "2026-08-21T00:00:00.000Z",
    desired,
    digest,
    effect: effect === "none" ? "none" : normalized.action,
    existing,
    guild: { id: normalized.guildId, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
      guildOwner: false,
      missingPermissions: [],
      requiredPermissions: ["MANAGE_GUILD"],
    },
    privacy: autoModerationPrivacy(),
    references: {
      desired: desired === null ? null : autoModerationReferences(),
      existing: existing === null ? null : autoModerationReferences(),
    },
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    warnings: ["One-shot reviewed AutoMod rule change"],
  }
}

function scheduledEventPrivacy(): ScheduledEventPrivacyProjection {
  return {
    omittedFields: [
      "coverImageCdnUrl",
      "coverImageHash",
      "creatorProfile",
      "rawDiscordObject",
      "subscriberProfiles",
    ],
    privateFieldsProjectedOut: true,
    subscriberIdentitiesExposed: false,
  }
}

function projectedScheduledEvent(
  eventId = SCHEDULED_EVENT_ID,
  subscriberCount: number | null = null,
): ProjectedScheduledEvent {
  return {
    channelId: CHANNEL_ID,
    creatorUserId: BOT_ID,
    description: "Reviewed event",
    entityId: null,
    entityType: "voice",
    eventId,
    guildId: GUILD_ID,
    hasCoverImage: false,
    location: null,
    name: "Planning session",
    privacyLevel: "guild-only",
    recurrence: null,
    scheduledEndTime: "2026-09-01T22:00:00.000Z",
    scheduledStartTime: "2026-09-01T20:00:00.000Z",
    status: "scheduled",
    subscriberCount,
  }
}

function scheduledEventAccess(
  entityType: "external" | "stage" | "voice" = "voice",
  channelId: string | null = entityType === "external" ? null : CHANNEL_ID,
) {
  return {
    administrator: false,
    channelId,
    confidence: "complete" as const,
    effectivePermissions: (
      DISCORD_PERMISSIONS.CREATE_EVENTS
      | DISCORD_PERMISSIONS.MANAGE_EVENTS
      | DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.CONNECT
      | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      | DISCORD_PERMISSIONS.MUTE_MEMBERS
      | DISCORD_PERMISSIONS.MOVE_MEMBERS
    ).toString(),
    entityType,
    guildOwner: false,
    missingPermissions: [] as [],
    permissionScope: entityType === "external" ? "guild" as const : "channel" as const,
    requiredPermissions: entityType === "external"
      ? ["CREATE_EVENTS" as const]
      : entityType === "voice"
        ? ["CREATE_EVENTS" as const, "VIEW_CHANNEL" as const, "CONNECT" as const]
        : [
            "CREATE_EVENTS" as const,
            "MANAGE_CHANNELS" as const,
            "MUTE_MEMBERS" as const,
            "MOVE_MEMBERS" as const,
          ],
  }
}

function scheduledEventPlan(
  request: ScheduledEventChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): ScheduledEventPlan {
  const existing = request.action === "create"
    ? null
    : projectedScheduledEvent(request.eventId)
  const hosting = request.action === "create"
    ? request.hosting
    : request.action === "update" && request.hosting
      ? request.hosting
      : existing?.entityType === "external"
        ? { entityType: "external" as const, location: existing.location || "Town Hall" }
        : {
            channelId: existing?.channelId || CHANNEL_ID,
            entityType: existing?.entityType === "stage" ? "stage" as const : "voice" as const,
          }
  const entityType = hosting.entityType
  const channelId = entityType === "external" ? null : hosting.channelId
  const location = entityType === "external" ? hosting.location : null
  const desired = request.action === "delete"
    ? null
    : request.action === "transition"
      ? { ...existing!, status: request.targetStatus }
      : {
          ...(existing || projectedScheduledEvent("placeholder")),
          channelId,
          creatorUserId: existing?.creatorUserId ?? BOT_ID,
          description: request.description === undefined
            ? existing?.description ?? null
            : request.description,
          entityType,
          eventId: existing?.eventId ?? null,
          hasCoverImage: request.coverImagePath === undefined
            ? existing?.hasCoverImage ?? false
            : request.coverImagePath !== null,
          location,
          name: request.name ?? existing?.name ?? "Planning session",
          scheduledEndTime: request.scheduledEndTime
            ?? existing?.scheduledEndTime
            ?? null,
          scheduledStartTime: request.scheduledStartTime
            ?? existing?.scheduledStartTime
            ?? "2026-09-01T20:00:00.000Z",
        }
  const permissionEntityType = existing?.entityType ?? entityType
  const permissionChannelId = existing?.channelId ?? channelId
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-21T00:00:00.000Z",
    desired,
    digest,
    effect: effect === "none" ? "none" : request.action,
    existing,
    file: "coverImagePath" in request && typeof request.coverImagePath === "string"
      ? {
          contentDigest: `hmac-sha256:${"e".repeat(64)}`,
          review: {
            canonicalPath: request.coverImagePath,
            containedByConfiguredRoot: true,
            format: "png",
            height: 512,
            mediaType: "image/png",
            ownerMatchesProcess: true,
            regularFile: true,
            singleLink: true,
            sizeBytes: 256,
            stableRead: true,
            width: 1024,
          },
        }
      : null,
    guild: { id: request.guildId, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      botOwned: existing === null ? null : true,
      current: scheduledEventAccess(permissionEntityType, permissionChannelId),
      destination: request.action === "create" || request.action === "update" && request.hosting
        ? scheduledEventAccess(entityType, channelId)
        : null,
      ownershipRequired: false,
    },
    privacy: scheduledEventPrivacy(),
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    visibleInventory: {
      digest: request.action === "create" ? `hmac-sha256:${"f".repeat(64)}` : null,
      returned: request.action === "create" ? 1 : null,
      safetyLimit: 100,
      visibility: "connector-visible",
    },
    warnings: ["One-shot reviewed scheduled event change"],
  }
}

function stageInstancePrivacy(): StageInstancePrivacyProjection {
  return {
    omittedFields: [
      "audienceState",
      "rawDiscordObject",
      "scheduledEventObject",
      "speakerState",
    ],
    rawPayloadExposed: false,
    speakerIdentitiesExposed: false,
    topicPersisted: false,
  }
}

function projectedStageInstance(
  topic = "Planning session",
): ProjectedStageInstance {
  return {
    channelId: CHANNEL_ID,
    discoverableDisabled: true,
    guildId: GUILD_ID,
    id: STAGE_INSTANCE_ID,
    privacyLevel: "guild-only",
    scheduledEventId: null,
    topic,
    unknownFieldCount: 0,
  }
}

function stageInstancePlan(
  request: StageInstanceChangeRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): StageInstancePlan {
  const existing = request.action === "start"
    ? null
    : projectedStageInstance()
  const desired = request.action === "end"
    ? null
    : {
        channelId: request.channelId,
        guildId: request.guildId,
        id: existing?.id ?? null,
        privacyLevel: "guild-only" as const,
        scheduledEventId: null,
        topic: request.topic,
      }
  const requiredPermissions = [
    "VIEW_CHANNEL",
    "CONNECT",
    "MANAGE_CHANNELS",
    "MUTE_MEMBERS",
    "MOVE_MEMBERS",
    ...(request.action === "start" && request.sendStartNotification
      ? ["MENTION_EVERYONE" as const]
      : []),
  ] as const
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channel: {
      guildId: request.guildId,
      id: request.channelId,
      name: "Private Stage channel",
      type: "stage",
    },
    createdAt: "2026-08-21T00:00:00.000Z",
    desired,
    digest,
    effect: effect === "none"
      ? "none"
      : request.action === "start"
        ? "create"
        : request.action === "update"
          ? "update"
          : "delete",
    existing,
    guild: { id: request.guildId, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      appliedRoleIds: [request.guildId],
      confidence: "complete",
      effectivePermissionNames: [...requiredPermissions],
      effectivePermissions: requiredPermissions.reduce(
        (bits, name) => bits | DISCORD_PERMISSIONS[name],
        0n,
      ).toString(),
      guildOwner: false,
      missingPermissions: [],
      requiredPermissions: [...requiredPermissions],
      unknownPermissionBits: "0",
      warnings: [],
    },
    privacy: stageInstancePrivacy(),
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    warnings: ["One-shot reviewed Stage-instance change"],
    writeRequired: effect !== "none",
  }
}

function permissionOverwritePlan(
  request: ChannelPermissionOverwriteRequest,
  digest = DIGEST,
  action: "delete" | "none" | "put" = request.mode === "delete" ? "delete" : "put",
): ChannelPermissionOverwritePlan {
  const changes = request.mode === "update" ? [...request.changes] : []
  const changedPermissions = changes.map(({ permission }) => permission)
  const desiredAllowPermissions = changes
    .filter(({ state }) => state === "allow")
    .map(({ permission }) => permission)
  const desiredDenyPermissions = changes
    .filter(({ state }) => state === "deny")
    .map(({ permission }) => permission)
  const current = request.mode === "delete" || action === "none"
    ? {
        allow: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
        allowPermissions: ["VIEW_CHANNEL" as const],
        deny: "0",
        denyPermissions: [],
        targetId: request.targetId,
        targetType: request.targetType,
        unknownAllow: "0",
        unknownDeny: "0",
      }
    : null
  const desired = action === "put"
    ? {
        allow: discordPermissionBitfield(desiredAllowPermissions).toString(),
        allowPermissions: desiredAllowPermissions,
        deny: discordPermissionBitfield(desiredDenyPermissions).toString(),
        denyPermissions: desiredDenyPermissions,
        targetId: request.targetId,
        targetType: request.targetType,
        unknownAllow: "0",
        unknownDeny: "0",
      }
    : action === "none"
      ? current
      : null
  const botPermissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  ).toString()
  return {
    action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    botPermission: {
      afterEffectivePermissions: botPermissions,
      beforeEffectivePermissions: botPermissions,
      confidence: "complete",
      manageRolesAfter: true,
      manageRolesBefore: true,
      viewChannelAfter: true,
      viewChannelBefore: true,
    },
    changes,
    channel: normalizeChannel(rawChannel({ id: request.channelId })),
    createdAt: "2026-08-21T00:00:00.000Z",
    currentOverwrite: current,
    desiredOverwrite: desired,
    digest,
    evaluatedPermissions: changedPermissions.length > 0
      ? changedPermissions
      : ["VIEW_CHANNEL"],
    guild: { id: GUILD_ID, name: "Private guild name" },
    operationKeyHash: OPERATION_KEY_HASH,
    parentSync: {
      after: null,
      before: null,
      parentChannelId: null,
    },
    requestedMode: request.mode,
    schemaVersion: 1,
    status: action === "none" ? "already-current" : "planned",
    target: {
      id: request.targetId,
      name: "Private target name",
      type: request.targetType,
    },
    targetAccess: {
      basis: request.targetType === "role"
        ? "standalone-role-baseline"
        : "member-effective",
      impacts: (changedPermissions.length > 0
        ? changedPermissions
        : ["VIEW_CHANNEL" as const]
      ).map((permission) => ({
        after: changes.find((change) => (
          change.permission === permission && change.state === "deny"
        )) ? "denied" as const : "allowed" as const,
        before: "allowed" as const,
        permission,
      })),
    },
    warnings: ["One-shot reviewed channel permission change"],
  }
}

function moderationPlan(digest = DIGEST) {
  return {
    action: "kick" as const,
    auditReason: AUDIT_REASON,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guildId: GUILD_ID,
    parameters: {
      deleteMessageSeconds: null,
      durationMinutes: null,
      estimatedTimeoutUntil: null,
    },
    permission: {
      botAdministrator: false,
      botHighestRolePosition: 2,
      required: "KICK_MEMBERS" as const,
      targetAdministrator: false,
      targetHighestRolePosition: 1,
    },
    schemaVersion: 1,
    status: "planned" as const,
    target: {
      banState: "not-banned" as const,
      bot: false,
      currentTimeoutUntil: null,
      globalName: null,
      id: USER_ID,
      membership: "member" as const,
      nickname: null,
      username: "member",
    },
  }
}

function attachmentPlan(
  request: AttachmentMessageRequest,
  digest = DIGEST,
): AttachmentMessagePlan {
  const filename = request.filename || "report.txt"
  return {
    channel: {
      guildId: GUILD_ID,
      id: request.channelId,
      parentId: null,
      type: 0,
    },
    createdAt: "2026-08-20T00:00:00.000Z",
    digest,
    file: {
      canonicalPath: request.filePath,
      containedByConfiguredRoot: true,
      description: request.description ?? null,
      filename,
      maxBytes: 10 * 1_024 * 1_024,
      ownerMatchesProcess: true,
      regularFile: true,
      singleLink: true,
      sizeBytes: 14,
      stableRead: true,
    },
    notificationUserIds: [...(request.notifyUserIds || [])].sort(),
    notifyReplyAuthor: request.notifyReplyAuthor ?? false,
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissionNames: [
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "ATTACH_FILES",
        "READ_MESSAGE_HISTORY",
      ],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.SEND_MESSAGES
        | DISCORD_PERMISSIONS.ATTACH_FILES
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
      ).toString(),
      permissionSourceChannelId: request.channelId,
      requiredPermissionNames: [
        "VIEW_CHANNEL",
        "READ_MESSAGE_HISTORY",
        "ATTACH_FILES",
        "SEND_MESSAGES",
      ],
    },
    reply: request.replyToMessageId
      ? { authorId: USER_ID, messageId: request.replyToMessageId }
      : null,
    schemaVersion: 1,
    status: "planned",
    target: {
      content: request.content ?? null,
      description: request.description ?? null,
      filename,
    },
    warnings: ["One-shot reviewed local file upload"],
  }
}

function componentMessagePlan(
  request: ComponentMessageRequest,
  digest = DIGEST,
  writeRequired = true,
): ComponentMessagePlan {
  const review = reviewComponentLayout(request.components, request.notifyUserIds)
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channel: {
      guildId: GUILD_ID,
      id: request.channelId,
      parentId: null,
      type: 0,
    },
    createdAt: "2026-08-22T00:00:00.000Z",
    current: request.action === "edit"
      ? {
          flags: 32_768,
          layout: writeRequired
            ? [{ content: "Before", kind: "text" }]
            : review.layout,
          messageId: request.messageId as string,
          parsedUserMentionIds: [],
          pinned: false,
          preview: writeRequired
            ? "[1] Text Display: \"Before\""
            : review.preview,
          timestamp: "2026-08-22T00:00:00.000Z",
        }
      : null,
    digest,
    guild: { id: GUILD_ID, name: "Private guild name" },
    messageContentIntent: "enabled",
    notificationUserIds: review.notificationUserIds,
    notifyReplyAuthor: request.notifyReplyAuthor ?? false,
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      administrator: false,
      appliedRoleIds: [GUILD_ID],
      canReadMessages: true,
      confidence: "complete",
      effectivePermissionNames: [
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "READ_MESSAGE_HISTORY",
      ],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.SEND_MESSAGES
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
      ).toString(),
      permissionSourceChannelId: request.channelId,
      privateThreadAccess: "not-applicable",
      requiredPermissionNames: [
        "VIEW_CHANNEL",
        "READ_MESSAGE_HISTORY",
        "SEND_MESSAGES",
      ],
    },
    privacy: {
      durableRecords: "content-free",
      omittedFields: [
        "attachmentUrls",
        "componentLayouts",
        "componentText",
        "embeds",
        "generatedComponentIds",
        "mentionProfiles",
        "nonce",
        "notificationUserIds",
        "parsedUserMentionIds",
        "rawOperationKey",
        "rawPayloads",
        "replyAuthorId",
      ],
      planPersistence: "none",
      rawPayloads: "omitted",
    },
    reply: request.replyToMessageId
      ? { authorId: USER_ID, messageId: request.replyToMessageId, type: 0 }
      : null,
    schemaVersion: 1,
    status: writeRequired ? "planned" : "already-current",
    target: {
      counts: review.counts,
      layout: review.layout,
      messageId: request.messageId ?? null,
      preview: review.preview,
      suppressedUserMentionIds: review.suppressedUserMentionIds,
      textCharacters: review.textCharacters,
    },
    warnings: review.warnings,
    writeRequired,
  }
}

function channelPlan(
  request: ChannelCreationRequest,
  digest = DIGEST,
  action: "create" | "none" = "create",
) {
  const category = request.kind === "category"
  const observed = {
    defaultAutoArchiveDuration: category
      ? null
      : request.defaultAutoArchiveDuration ?? 1_440,
    id: CHANNEL_ID,
    name: request.name,
    nsfw: category ? null : request.nsfw ?? false,
    parentId: request.parentId ?? null,
    rateLimitPerUser: category ? null : request.rateLimitPerUser ?? 0,
    topic: category ? null : request.topic ?? null,
    type: category ? 4 : request.kind === "forum" ? 15 : 0,
  }
  return {
    action,
    auditReason: request.auditReason,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    existingChannel: action === "none" ? observed : null,
    guild: {
      id: request.guildId,
      name: "Guild",
      ownerId: USER_ID,
    },
    operationKeyHash: OPERATION_KEY_HASH,
    parent: request.parentId
      ? { id: request.parentId, name: "Parent", visibleChildren: 2 }
      : null,
    permission: {
      botAdministrator: false,
      guildManageChannels: true,
      guildViewChannel: true,
      parentManageChannels: request.parentId ? true : null,
      parentViewChannel: request.parentId ? true : null,
    },
    schemaVersion: 1,
    status: action === "none" ? "already-current" as const : "planned" as const,
    target: {
      defaultAutoArchiveDuration: observed.defaultAutoArchiveDuration,
      kind: request.kind,
      name: request.name,
      nsfw: observed.nsfw,
      parentId: observed.parentId,
      rateLimitPerUser: observed.rateLimitPerUser,
      topic: observed.topic,
      type: observed.type,
    },
    visibleInventory: {
      guildChannels: 8,
      guildLimit: 500,
      parentChildren: request.parentId ? 2 : null,
      parentLimit: request.parentId ? 50 : null,
    },
    warnings: ["Visible inventory is bounded by Discord visibility"],
  }
}

function forumPostPlan(
  request: ForumPostRequest,
  digest = DIGEST,
): ForumPostPlan {
  return {
    createdAt: "2026-08-20T00:00:00.000Z",
    digest,
    guild: {
      id: GUILD_ID,
      name: "Guild",
      ownerId: USER_ID,
    },
    operationKeyHash: OPERATION_KEY_HASH,
    parent: {
      availableTagCount: 1,
      defaultAutoArchiveDuration: 1_440,
      defaultThreadRateLimitPerUser: 0,
      flags: 0,
      guildId: GUILD_ID,
      id: request.channelId,
      name: "ideas",
      requireTag: false,
      type: 15,
    },
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissionNames: [
        "VIEW_CHANNEL",
        "READ_MESSAGE_HISTORY",
        "SEND_MESSAGES",
      ],
      effectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        | DISCORD_PERMISSIONS.SEND_MESSAGES
      ).toString(),
      requiredPermissionNames: [
        "VIEW_CHANNEL",
        "READ_MESSAGE_HISTORY",
        "SEND_MESSAGES",
      ],
    },
    schemaVersion: 1,
    selectedTags: (request.appliedTagIds || []).map((id) => ({
      id,
      moderated: false,
      name: "reviewed",
    })),
    status: "planned",
    target: {
      appliedTagIds: [...(request.appliedTagIds || [])].sort(),
      auditReason: request.auditReason,
      autoArchiveDuration: request.autoArchiveDuration ?? null,
      content: request.content,
      name: request.name,
      notificationUserIds: [...(request.notifyUserIds || [])].sort(),
      rateLimitPerUser: request.rateLimitPerUser ?? null,
    },
    warnings: ["One-shot reviewed forum post"],
  }
}

function threadCreationPlan(
  request: ThreadCreationRequest,
  digest = DIGEST,
  writeRequired = true,
): ThreadCreationPlan {
  const sourceMessageId = request.mode === "from-message"
    ? request.sourceMessageId as string
    : null
  const threadType = request.mode === "standalone-private" ? 12 : 11
  const requiredPermission = request.mode === "standalone-private"
    ? "CREATE_PRIVATE_THREADS" as const
    : "CREATE_PUBLIC_THREADS" as const
  const requiredPermissionNames = [
    "VIEW_CHANNEL" as const,
    ...(request.mode === "from-message" ? ["READ_MESSAGE_HISTORY" as const] : []),
    requiredPermission,
  ]
  const permissionBits = requiredPermissionNames.reduce(
    (bits, name) => bits | DISCORD_PERMISSIONS[name],
    0n,
  )
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    createdAt: "2026-08-21T00:00:00.000Z",
    digest,
    existingThread: writeRequired ? null : {
      archived: false,
      autoArchiveDuration: 1_440,
      id: sourceMessageId as string,
      invitable: null,
      locked: false,
      name: "Existing thread",
      ownerId: USER_ID,
      rateLimitPerUser: 0,
      type: threadType,
      url: `https://discord.com/channels/${GUILD_ID}/${sourceMessageId}`,
    },
    guild: { id: GUILD_ID, name: "Guild", ownerId: USER_ID },
    operationKeyHash: OPERATION_KEY_HASH,
    parent: {
      defaultAutoArchiveDuration: 1_440,
      defaultThreadRateLimitPerUser: 0,
      guildId: GUILD_ID,
      id: request.parentChannelId,
      name: "support",
      type: 0,
    },
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissionNames: requiredPermissionNames,
      effectivePermissions: permissionBits.toString(),
      requiredPermissionNames,
    },
    privacy: {
      durableRecords: "content-free-only",
      sourceMessage: sourceMessageId ? "transient-review-only" : "not-fetched",
    },
    risks: writeRequired
      ? ["The creation POST is not automatically retried"]
      : ["The source already owns a thread"],
    schemaVersion: 1,
    sourceMessage: sourceMessageId ? {
      attachmentFilenames: ["private.txt"],
      author: {
        bot: false,
        globalName: null,
        id: USER_ID,
        username: "private-author",
      },
      contentLength: 22,
      contentPreview: "Private source content",
      editedTimestamp: null,
      id: sourceMessageId,
      timestamp: "2026-08-21T00:00:00.000Z",
      truncated: false,
    } : null,
    status: writeRequired ? "planned" : "source-already-threaded",
    target: {
      auditReason: request.auditReason,
      autoArchiveDuration: request.autoArchiveDuration ?? 1_440,
      invitable: request.mode === "standalone-private"
        ? request.invitable ?? false
        : null,
      mode: request.mode,
      name: request.name,
      parentChannelId: request.parentChannelId,
      rateLimitPerUser: request.rateLimitPerUser ?? 0,
      sourceMessageId,
      threadType,
    },
    warnings: ["One-shot reviewed thread creation"],
    writeRequired,
  }
}

function normalizedCreatedRole(
  request: RoleCreationRequest,
): NormalizedDiscordRole {
  const permissionBits = discordPermissionBitfield(request.permissions || [])
  return {
    colors: {
      primaryColor: request.primaryColor ?? 0,
      secondaryColor: null,
      tertiaryColor: null,
    },
    flags: 0,
    hoist: request.hoist ?? false,
    icon: null,
    id: ROLE_ID,
    managed: false,
    management: { id: null, type: "standard" },
    mentionable: request.mentionable ?? false,
    name: request.name,
    permissionNames: discordPermissionNames(permissionBits),
    permissions: permissionBits.toString(),
    position: 1,
    unicodeEmoji: null,
    unknownFieldCount: 0,
    unknownPermissionBits: "0",
  }
}

function rolePlan(
  request: RoleCreationRequest,
  digest = DIGEST,
  action: "create" | "none" = "create",
): RoleCreationPlan {
  const permissions = [...(request.permissions || [])]
  const permissionBits = discordPermissionBitfield(permissions)
  const botPermissionBits = permissionBits | DISCORD_PERMISSIONS.MANAGE_ROLES
  const observed = normalizedCreatedRole(request)
  const highRiskPermissionSet = new Set<string>(ROLE_CREATION_HIGH_RISK_PERMISSIONS)
  return {
    action,
    auditReason: request.auditReason,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    existingRole: action === "none" ? observed : null,
    guild: {
      features: [],
      id: request.guildId,
      name: "Guild",
      ownerId: USER_ID,
    },
    highRiskPermissions: permissions.filter((permission) => (
      highRiskPermissionSet.has(permission)
    )),
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      botAdministrator: false,
      botEffectivePermissionNames: discordPermissionNames(botPermissionBits),
      botEffectivePermissions: botPermissionBits.toString(),
      botHighestRoleIds: ["350000000000000002"],
      botHighestRolePosition: 2,
      guildManageRoles: true,
      requestedSubset: true,
    },
    schemaVersion: 1,
    status: action === "none" ? "already-current" : "planned",
    target: {
      hoist: request.hoist ?? false,
      mentionable: request.mentionable ?? false,
      name: request.name,
      permissionBits: permissionBits.toString(),
      permissions,
      primaryColor: request.primaryColor ?? 0,
    },
    visibleInventory: {
      guildLimit: 250,
      guildRoles: action === "none" ? 3 : 2,
    },
    warnings: ["New Discord roles begin at the bottom of the hierarchy"],
  }
}

function roleConfigurationPlan(
  request: RoleConfigurationRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): RoleConfigurationPlan {
  const record = request as unknown as Record<string, unknown>
  const basePermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
  const grantBits = discordPermissionBitfield(request.grantPermissions || [])
  const revokeBits = discordPermissionBitfield(request.revokePermissions || [])
  const desiredPermissions = (basePermissions | grantBits) & ~revokeBits
  const base: NormalizedDiscordRole = {
    colors: {
      primaryColor: 0,
      secondaryColor: null,
      tertiaryColor: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id: request.roleId,
    managed: false,
    management: { id: null, type: "standard" },
    mentionable: false,
    name: "Support",
    permissionNames: discordPermissionNames(basePermissions),
    permissions: basePermissions.toString(),
    position: 2,
    unicodeEmoji: null,
    unknownFieldCount: 0,
    unknownPermissionBits: "0",
  }
  const desired: NormalizedDiscordRole = {
    ...base,
    colors: {
      primaryColor: Object.hasOwn(record, "primaryColor")
        ? request.primaryColor as number
        : base.colors.primaryColor,
      secondaryColor: Object.hasOwn(record, "secondaryColor")
        ? request.secondaryColor as number | null
        : base.colors.secondaryColor,
      tertiaryColor: Object.hasOwn(record, "tertiaryColor")
        ? request.tertiaryColor as number | null
        : base.colors.tertiaryColor,
    },
    ...(Object.hasOwn(record, "hoist") ? { hoist: request.hoist as boolean } : {}),
    ...(Object.hasOwn(record, "mentionable")
      ? { mentionable: request.mentionable as boolean }
      : {}),
    ...(Object.hasOwn(record, "name") ? { name: request.name as string } : {}),
    permissionNames: discordPermissionNames(desiredPermissions),
    permissions: desiredPermissions.toString(),
  }
  const current = effect === "none" ? desired : base
  const candidates: RoleConfigurationPlan["changes"] = [
    { after: desired.colors, before: current.colors, field: "colors" },
    { after: desired.hoist, before: current.hoist, field: "hoist" },
    { after: desired.mentionable, before: current.mentionable, field: "mentionable" },
    { after: desired.name, before: current.name, field: "name" },
    {
      after: {
        names: desired.permissionNames,
        permissions: desired.permissions,
        unknownPermissionBits: desired.unknownPermissionBits,
      },
      before: {
        names: current.permissionNames,
        permissions: current.permissions,
        unknownPermissionBits: current.unknownPermissionBits,
      },
      field: "permissions",
    },
  ]
  const changes = candidates.filter(({ after, before }) => (
    JSON.stringify(after) !== JSON.stringify(before)
  ))
  const requestedFields = [
    "grantPermissions",
    "hoist",
    "mentionable",
    "name",
    "primaryColor",
    "revokePermissions",
    "secondaryColor",
    "tertiaryColor",
  ].filter((field) => Object.hasOwn(record, field)) as RoleConfigurationPlan["requestedFields"]
  const botPermissions = desiredPermissions | DISCORD_PERMISSIONS.MANAGE_ROLES
  const grantedPermissions = discordPermissionNames(
    BigInt(desired.permissions) & ~BigInt(current.permissions),
  )
  const revokedPermissions = discordPermissionNames(
    BigInt(current.permissions) & ~BigInt(desired.permissions),
  )
  const highRiskSet = new Set<string>(ROLE_CREATION_HIGH_RISK_PERMISSIONS)
  return {
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    changedFields: changes.map(({ field }) => field),
    changes,
    createdAt: "2026-08-21T00:00:00.000Z",
    current,
    desired,
    digest,
    grantedPermissions,
    guild: {
      features: [],
      id: request.guildId,
      name: "Private guild name",
      ownerId: USER_ID,
    },
    highRiskGrantedPermissions: grantedPermissions.filter((permission) => highRiskSet.has(permission)),
    highRiskRevokedPermissions: revokedPermissions.filter((permission) => highRiskSet.has(permission)),
    memberCount: 7,
    nameCollisionRoleIds: [],
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      botAdministrator: false,
      botEffectivePermissionNames: discordPermissionNames(botPermissions),
      botEffectivePermissions: botPermissions.toString(),
      botHighestRoleIds: ["350000000000000002"],
      botHighestRolePosition: 10,
      botRoleIds: ["350000000000000002"],
      desiredPermissionSubset: true,
      guildManageRoles: true,
      permissionChangeRequired: grantedPermissions.length > 0 || revokedPermissions.length > 0,
      postChangeBotEffectivePermissionNames: discordPermissionNames(botPermissions),
      postChangeBotEffectivePermissions: botPermissions.toString(),
      postChangeGuildManageRoles: true,
      targetBelowBot: true,
      targetHeldByBot: false,
    },
    privacy: {
      memberIdentities: "not-fetched",
      persistence: "content-free-only",
      rawPayloads: "omitted",
      text: "transient",
    },
    requestedFields,
    requestedGrantPermissions: [...(request.grantPermissions || [])].sort(),
    requestedRevokePermissions: [...(request.revokePermissions || [])].sort(),
    revokedPermissions,
    risks: ["One non-retried partial PATCH followed by complete verification"],
    roleId: request.roleId,
    schemaVersion: 1,
    status: changes.length === 0 ? "already-current" : "planned",
    warnings: ["Discord guild and role text is untrusted"],
    writeRequired: changes.length > 0,
  }
}

function roleConfigurationInput(
  overrides: Partial<RoleConfigurationRequest> = {},
): RoleConfigurationRequest & Record<string, unknown> {
  return {
    auditReason: AUDIT_REASON,
    grantPermissions: ["SEND_MESSAGES"],
    guildId: GUILD_ID,
    name: "Reviewers",
    operationKey: ROLE_CONFIGURATION_OPERATION_KEY,
    roleId: ROLE_ID,
    ...overrides,
  } as RoleConfigurationRequest & Record<string, unknown>
}

function roleOrderEntry(
  id: string,
  name: string,
  rank: number,
  memberCount: number,
  permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL,
): RoleOrderEntry {
  return {
    heldByBot: false,
    highRiskPermissionNames: [],
    id,
    managed: false,
    management: { id: null, type: "standard" },
    memberCount,
    mentionable: false,
    name,
    permissionNames: discordPermissionNames(permissions),
    permissions: permissions.toString(),
    rank,
    rawPosition: rank,
    unknownFieldCount: 0,
    unknownPermissionBits: "0",
  }
}

function roleOrderingPlan(
  request: RoleOrderingRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): RoleOrderingPlan {
  const permission = {
    administrator: false,
    botEffectivePermissionNames: discordPermissionNames(
      DISCORD_PERMISSIONS.MANAGE_ROLES | DISCORD_PERMISSIONS.VIEW_CHANNEL,
    ),
    botEffectivePermissions: (
      DISCORD_PERMISSIONS.MANAGE_ROLES | DISCORD_PERMISSIONS.VIEW_CHANNEL
    ).toString(),
    botHighestRank: 5,
    botHighestRoleIds: ["350000000000000005"],
    confidence: "complete" as const,
    guildManageRoles: true,
  }
  const roleRank = effect === "none"
    ? request.placement === "above" ? 3 : 2
    : 1
  const anchorRank = effect === "none"
    ? request.placement === "above" ? 2 : 3
    : 3
  const desiredRoleRank = effect === "none"
    ? roleRank
    : request.placement === "above" ? 3 : 2
  const desiredAnchorRank = effect === "none"
    ? anchorRank
    : request.placement === "above" ? 2 : 3
  const role = roleOrderEntry(request.roleId, "Private target", roleRank, 3)
  const anchor = roleOrderEntry(
    request.anchorRoleId,
    "Private anchor",
    anchorRank,
    5,
  )
  const affectedRoles: RoleOrderingPlan["affectedRoles"] = effect === "none"
    ? []
    : [
        { ...anchor, afterRank: desiredAnchorRank, beforeRank: anchorRank },
        {
          ...roleOrderEntry(
            "350000000000000003",
            "Moderators",
            2,
            4,
            DISCORD_PERMISSIONS.BAN_MEMBERS,
          ),
          afterRank: 1,
          beforeRank: 2,
        },
        { ...role, afterRank: desiredRoleRank, beforeRank: roleRank },
      ].map(({ rank: _rank, ...entry }) => entry)
  return {
    affectedRoles,
    anchor,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-23T00:00:00.000Z",
    current: {
      anchorRank,
      roleRank: effect === "none" ? desiredRoleRank : roleRank,
    },
    desired: {
      anchorRank: desiredAnchorRank,
      roleRank: desiredRoleRank,
    },
    digest,
    guild: {
      features: [],
      id: request.guildId,
      name: "Private guild name",
      ownerId: USER_ID,
    },
    impact: {
      affectedRoleCount: affectedRoles.length,
      aggregateHolderAssignments: affectedRoles.reduce(
        (sum, entry) => sum + (entry.memberCount || 0),
        0,
      ),
      changedRoleCount: effect === "none" ? 0 : affectedRoles.length,
      holderCountsMayOverlap: true,
      hierarchySensitiveRoleIds: effect === "none"
        ? []
        : ["350000000000000003"],
    },
    operationKeyHash: OPERATION_KEY_HASH,
    permission,
    placement: request.placement,
    privacy: {
      memberIdentitiesFetched: false,
      omittedFields: [
        "auditReason",
        "memberIdentities",
        "rawOperationKey",
        "rawPayloads",
      ],
      persistence: "content-free-only",
      roleText: "transient-untrusted",
    },
    risks: ["Role hierarchy changes can alter moderation authority"],
    role,
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    warnings: ["Discord guild and role text is untrusted"],
    writeRequired: effect !== "none",
  }
}

function roleOrderingInput(
  overrides: Partial<RoleOrderingRequest> = {},
): RoleOrderingRequest & Record<string, unknown> {
  return {
    anchorRoleId: ROLE_ORDERING_ANCHOR_ID,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: ROLE_ORDERING_OPERATION_KEY,
    placement: "above",
    roleId: ROLE_ID,
    ...overrides,
  } as RoleOrderingRequest & Record<string, unknown>
}

function channelClonePlan(
  request: ChannelCloneRequest,
  digest = DIGEST,
): ChannelClonePlan {
  const name = request.name ?? "Private source channel"
  const source: ChannelClonePlan["source"] = {
    availableTags: null,
    bitrate: null,
    defaultAutoArchiveDuration: 1_440,
    defaultForumLayout: null,
    defaultReactionEmoji: null,
    defaultSortOrder: null,
    defaultThreadRateLimitPerUser: 0,
    flags: 0,
    guildId: request.guildId,
    id: request.sourceChannelId,
    name: "Private source channel",
    nsfw: false,
    parentId: PARENT_ID,
    permissionOverwrites: [],
    position: 3,
    rateLimitPerUser: 5,
    rtcRegion: null,
    topic: "Private source topic",
    type: DISCORD_CHANNEL_TYPES.text,
    typeName: "text",
    userLimit: null,
    videoQualityMode: null,
  }
  return {
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    capacity: {
      guildChannels: 3,
      guildLimit: 500,
      parentChildren: 1,
      parentLimit: 50,
    },
    createdAt: "2026-08-23T14:00:00.000Z",
    digest,
    evidence: {
      httpMode: "complete",
      layoutRevision: 7,
      layoutUpdatedAt: "2026-08-23T13:59:59.000Z",
      obfuscatedChannels: 0,
    },
    guild: {
      features: [],
      id: request.guildId,
      name: "Private guild name",
      ownerId: GUILD_OWNER_ID,
      premiumTier: 0,
    },
    operationKeyHash: operationKeyHash(request.operationKey),
    parent: { id: PARENT_ID, name: "Private parent category" },
    permission: {
      administrator: false,
      guildEffectivePermissionNames: ["VIEW_CHANNEL", "MANAGE_CHANNELS"],
      guildEffectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      ).toString(),
      guildManageChannels: true,
      sourceEffectivePermissionNames: ["VIEW_CHANNEL", "MANAGE_CHANNELS"],
      sourceEffectivePermissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      ).toString(),
      sourceViewChannel: true,
    },
    privacy: {
      channelMetadata: "transient-untrusted",
      hiddenMetadataReturned: false,
      omittedFields: [
        "auditReason",
        "childResources",
        "hiddenChannelMetadata",
        "memberProfiles",
        "messages",
        "rawOperationKey",
        "rawPayloads",
      ],
      persistence: "content-free-only",
    },
    risks: [
      "Discord creates a new channel ID",
      "Discord chooses default placement because source position is omitted",
    ],
    schemaVersion: 1,
    source,
    status: "planned",
    target: {
      payload: {
        defaultAutoArchiveDuration: 1_440,
        defaultThreadRateLimitPerUser: 0,
        flags: 0,
        name,
        nsfw: false,
        parentId: PARENT_ID,
        permissionOverwrites: [],
        rateLimitPerUser: 5,
        topic: "Private source topic",
        type: DISCORD_CHANNEL_TYPES.text,
      },
      placement: "discord-default",
      regeneratedTagIds: false,
    },
    warnings: ["Success requires exact readback and a newer complete Gateway layout"],
  }
}

function channelCloneInput(
  overrides: Partial<ChannelCloneRequest> = {},
): ChannelCloneRequest & Record<string, unknown> {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "reviewed-copy",
    operationKey: CHANNEL_CLONE_OPERATION_KEY,
    sourceChannelId: CHANNEL_ID,
    ...overrides,
  } as ChannelCloneRequest & Record<string, unknown>
}

function channelOrderEntry(
  id: string,
  name: string,
  rank: number,
): ChannelOrderEntry {
  return {
    family: "text",
    id,
    metadataVisibility: "visible",
    name,
    obfuscated: false,
    parentChannelId: PARENT_ID,
    rank,
    rawPosition: rank,
    type: 0,
    unknownFieldCount: 0,
  }
}

function channelOrderingPlan(
  request: ChannelOrderingRequest,
  digest = DIGEST,
  effect: "change" | "none" = "change",
): ChannelOrderingPlan {
  const currentOrder = effect === "none"
    ? [CHANNEL_ORDERING_MID_ID, request.channelId, request.anchorChannelId]
    : [request.channelId, CHANNEL_ORDERING_MID_ID, request.anchorChannelId]
  const desiredOrder = [
    CHANNEL_ORDERING_MID_ID,
    request.channelId,
    request.anchorChannelId,
  ]
  const currentRank = new Map(currentOrder.map((id, rank) => [id, rank]))
  const desiredRank = new Map(desiredOrder.map((id, rank) => [id, rank]))
  const entries = new Map([
    [request.channelId, channelOrderEntry(
      request.channelId,
      "Private target channel",
      currentRank.get(request.channelId) as number,
    )],
    [CHANNEL_ORDERING_MID_ID, channelOrderEntry(
      CHANNEL_ORDERING_MID_ID,
      "Middle channel",
      currentRank.get(CHANNEL_ORDERING_MID_ID) as number,
    )],
    [request.anchorChannelId, channelOrderEntry(
      request.anchorChannelId,
      "Private anchor channel",
      currentRank.get(request.anchorChannelId) as number,
    )],
  ])
  const channel = entries.get(request.channelId) as ChannelOrderEntry
  const anchor = entries.get(request.anchorChannelId) as ChannelOrderEntry
  const positionWrites = effect === "none"
    ? []
    : desiredOrder.map((id, submittedPosition) => ({
        beforeRawPosition: (entries.get(id) as ChannelOrderEntry).rawPosition,
        channelId: id,
        submittedPosition,
      }))
  const affectedChannels = effect === "none"
    ? []
    : currentOrder.map((id) => {
        const { rank: _rank, ...entry } = entries.get(id) as ChannelOrderEntry
        return {
          ...entry,
          afterRank: desiredRank.get(id) as number,
          beforeRank: currentRank.get(id) as number,
          submittedPosition: desiredRank.get(id) as number,
        }
      })
  return {
    affectedChannels,
    anchor,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channel,
    createdAt: "2026-08-23T00:00:00.000Z",
    current: {
      anchorRank: currentRank.get(request.anchorChannelId) as number,
      channelRank: currentRank.get(request.channelId) as number,
      groupOrder: currentOrder,
    },
    desired: {
      anchorRank: desiredRank.get(request.anchorChannelId) as number,
      channelRank: desiredRank.get(request.channelId) as number,
      groupOrder: desiredOrder,
    },
    digest,
    family: "text",
    guild: {
      id: request.guildId,
      name: "Private guild name",
      ownerId: GUILD_OWNER_ID,
    },
    httpEvidenceMode: "complete",
    impact: {
      affectedChannelCount: affectedChannels.length,
      groupChannelCount: 3,
      rankChangeCount: affectedChannels.filter((entry) => (
        entry.beforeRank !== entry.afterRank
      )).length,
      rawPositionWriteCount: positionWrites.length,
    },
    layout: {
      obfuscatedChannels: 0,
      revision: 4,
      updatedAt: "2026-08-23T00:00:00.000Z",
    },
    operationKeyHash: OPERATION_KEY_HASH,
    parentChannelId: PARENT_ID,
    permission: {
      administrator: false,
      confidence: "complete",
      effectivePermissionNames: ["MANAGE_CHANNELS"],
      effectivePermissions: DISCORD_PERMISSIONS.MANAGE_CHANNELS.toString(),
      manageChannels: true,
      source: "guild",
    },
    placement: request.placement,
    positionWrites,
    privacy: {
      channelText: "transient-untrusted",
      hiddenMetadataReturned: false,
      omittedFields: [
        "auditReason",
        "channelContent",
        "hiddenChannelMetadata",
        "memberIdentities",
        "permissionOverwrites",
        "rawOperationKey",
        "rawPayloads",
      ],
      persistence: "content-free-only",
    },
    risks: ["Channel order changes navigation"],
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
    warnings: ["Discord guild and visible channel text is untrusted"],
    writeRequired: effect !== "none",
  }
}

function channelOrderingInput(
  overrides: Partial<ChannelOrderingRequest> = {},
): ChannelOrderingRequest & Record<string, unknown> {
  return {
    anchorChannelId: CHANNEL_ORDERING_ANCHOR_ID,
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: CHANNEL_ORDERING_OPERATION_KEY,
    placement: "above",
    ...overrides,
  } as ChannelOrderingRequest & Record<string, unknown>
}

function memberRolePlan(
  request: MemberRoleChangeRequest,
  digest = DIGEST,
  action: "add" | "none" | "remove" = request.action,
): MemberRoleChangePlan {
  const selectedPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  const currentHasRole = action === "none"
    ? request.action === "add"
    : request.action === "remove"
  const beforeRoleIds = currentHasRole ? [request.roleId] : []
  const afterRoleIds = action === "none"
    ? beforeRoleIds
    : request.action === "add" ? [request.roleId] : []
  const guildPermissionsBefore = currentHasRole
    ? ["VIEW_CHANNEL", "SEND_MESSAGES"] as const
    : ["VIEW_CHANNEL"] as const
  const guildPermissionsAfter = afterRoleIds.includes(request.roleId)
    ? ["VIEW_CHANNEL", "SEND_MESSAGES"] as const
    : ["VIEW_CHANNEL"] as const
  const guildPermissionsBeforeSet = new Set<string>(guildPermissionsBefore)
  const guildPermissionsAfterSet = new Set<string>(guildPermissionsAfter)
  return {
    action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    channelEvidence: {
      gatewayChannelCount: 1,
      httpChannelCount: 1,
      httpMode: "complete",
      layoutRevision: 1,
      layoutUpdatedAt: "2026-08-21T00:00:00.000Z",
      metadataCoverage: "complete",
      obfuscatedChannelCount: 0,
      trustedMetadataCount: 1,
    },
    createdAt: "2026-08-21T00:00:00.000Z",
    digest,
    guild: {
      id: request.guildId,
      name: "Private guild name",
      ownerId: USER_ID,
    },
    highRiskPermissions: [],
    highRiskPermissionGains: [],
    impact: {
      changedChannels: action === "none" ? 0 : 1,
      channels: action === "none" ? [] : [{
        channelId: CHANNEL_ID,
        channelType: 0,
        changes: [{
          after: request.action === "add" ? "allowed" : "denied",
          before: request.action === "add" ? "denied" : "allowed",
          permission: "SEND_MESSAGES",
        }],
      }],
      evaluatedChannels: 1,
      guildPermissions: {
        added: guildPermissionsAfter.filter((permission) => (
          !guildPermissionsBeforeSet.has(permission)
        )),
        after: [...guildPermissionsAfter],
        before: [...guildPermissionsBefore],
        removed: guildPermissionsBefore.filter((permission) => (
          !guildPermissionsAfterSet.has(permission)
        )),
      },
      permissions: ["VIEW_CHANNEL", "SEND_MESSAGES"],
    },
    member: {
      afterRoleIds,
      beforeRoleIds,
      id: request.userId,
      username: "untrusted-member-name",
    },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      botAdministrator: false,
      botEffectivePermissionNames: ["MANAGE_ROLES", "VIEW_CHANNEL", "SEND_MESSAGES"],
      botEffectivePermissions: (
        DISCORD_PERMISSIONS.MANAGE_ROLES | selectedPermissions
      ).toString(),
      botHighestRoleIds: ["350000000000000002"],
      botHighestRolePosition: 10,
      channelPermissionEscalationSubset: true,
      channelOverwriteUnknownPermissionBits: "0",
      guildRoleUnknownPermissionBits: "0",
      guildManageRoles: true,
      roleBelowBot: true,
      roleOverwriteUnknownPermissionBits: "0",
      rolePermissionsSubset: true,
      targetBelowBot: true,
      targetHighestRoleIds: [request.guildId],
      targetHighestRolePosition: 0,
    },
    requestedAction: request.action,
    role: {
      colors: {
        primaryColor: 0,
        secondaryColor: null,
        tertiaryColor: null,
      },
      flags: 0,
      hoist: false,
      icon: null,
      id: request.roleId,
      managed: false,
      management: { id: null, type: "standard" },
      mentionable: false,
      name: "untrusted-role-name",
      permissionNames: ["VIEW_CHANNEL", "SEND_MESSAGES"],
      permissions: selectedPermissions.toString(),
      position: 2,
      unicodeEmoji: null,
      unknownFieldCount: 0,
      unknownPermissionBits: "0",
    },
    schemaVersion: 1,
    status: action === "none" ? "already-current" : "planned",
    warnings: ["Threads are outside the direct-channel impact proof"],
  }
}

function memberVoicePlan(
  request: MemberVoiceChangeRequest,
  digest = DIGEST,
  writeRequired = true,
): MemberVoiceChangePlan {
  const permission = (
    requiredPermissions: Array<"CONNECT" | "DEAFEN_MEMBERS" | "MOVE_MEMBERS" | "MUTE_MEMBERS" | "VIEW_CHANNEL">,
    appliedRoleIds = [request.guildId, ROLE_ID],
  ) => ({
    administrator: false,
    allowed: true as const,
    appliedRoleIds,
    effectivePermissionNames: [...requiredPermissions],
    effectivePermissions: requiredPermissions.reduce(
      (bits, name) => bits | DISCORD_PERMISSIONS[name],
      0n,
    ).toString(),
    guildOwner: false,
    requiredPermissions,
    unknownPermissionBits: "0" as const,
    warnings: [],
  })
  const sourcePermissionNames = request.action === "set-server-mute"
    ? ["VIEW_CHANNEL", "CONNECT", "MUTE_MEMBERS"] as const
    : request.action === "set-server-deafen"
      ? ["VIEW_CHANNEL", "CONNECT", "DEAFEN_MEMBERS"] as const
      : ["VIEW_CHANNEL", "CONNECT", "MOVE_MEMBERS"] as const
  const destination = request.action === "move"
    ? {
        guildId: request.guildId,
        id: request.destinationChannelId,
        name: "untrusted-destination-name",
        type: "voice" as const,
      }
    : null
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    createdAt: "2026-08-22T00:00:00.000Z",
    destination,
    destinationBotPermission: request.action === "move"
      ? permission(["VIEW_CHANNEL", "CONNECT", "MOVE_MEMBERS"])
      : null,
    destinationTargetPermission: request.action === "move"
      ? permission(["VIEW_CHANNEL", "CONNECT"], [request.guildId])
      : null,
    digest,
    guild: {
      id: request.guildId,
      name: "Private guild name",
      ownerId: GUILD_OWNER_ID,
    },
    hierarchy: {
      botHighestRoleIds: [ROLE_ID],
      botHighestRolePosition: 10,
      targetAdministrator: false,
      targetBelowBot: true,
      targetHighestRoleIds: [request.guildId],
      targetHighestRolePosition: 0,
    },
    member: { id: request.userId, username: "untrusted-member-name" },
    operationKeyHash: OPERATION_KEY_HASH,
    permission: permission([...sourcePermissionNames]),
    privacy: {
      enumeration: "none",
      omittedFields: ["session ID", "embedded member"],
      persistence: "content-free-outcomes-only",
      rawPayloadExposed: false,
    },
    requestedEnabled: "enabled" in request ? request.enabled : null,
    risks: writeRequired ? ["Immediate voice-state change"] : [],
    schemaVersion: 1,
    state: {
      channel: {
        guildId: request.guildId,
        id: CHANNEL_ID,
        name: "untrusted-source-name",
        type: "voice",
      },
      connected: true,
      serverDeafened: false,
      serverMuted: false,
      unknownFieldCount: 0,
      userId: request.userId,
    },
    status: writeRequired ? "planned" : "already-current",
    warnings: ["Same-member serialization is process-local"],
    writeRequired,
  }
}

function threadGovernancePlan(
  request: ThreadChangeRequest,
  digest = DIGEST,
  writeRequired = true,
): ThreadChangePlan {
  const permission = (
    requestedPermissions: ThreadChangePlan["permission"]["requestedPermissions"],
    appliedRoleIds = [request.guildId, ROLE_ID],
  ): ThreadChangePlan["permission"] => ({
    administrator: false,
    allowed: true,
    appliedRoleIds,
    effectivePermissionNames: [
      "VIEW_CHANNEL",
      "SEND_MESSAGES_IN_THREADS",
      "MANAGE_THREADS",
    ],
    effectivePermissions: (
      DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS
      | DISCORD_PERMISSIONS.MANAGE_THREADS
    ).toString(),
    guildOwner: false,
    missingPermissions: [],
    requestedPermissions,
    unknownPermissionBits: "0",
    warnings: [],
  })
  const desired: ThreadChangePlan["desired"] = request.action === "rename"
    ? { field: "name", value: request.name }
    : request.action === "archive" || request.action === "unarchive"
      ? { field: "archived", value: request.action === "archive" }
      : request.action === "lock" || request.action === "unlock"
        ? { field: "locked", value: request.action === "lock" }
        : request.action === "set-auto-archive-duration"
          ? { field: "autoArchiveDuration", value: request.autoArchiveDuration }
          : request.action === "set-invitable"
            ? { field: "invitable", value: request.enabled }
            : request.action === "set-slowmode"
              ? { field: "rateLimitPerUser", value: request.rateLimitPerUser }
              : { field: "membership", value: request.action === "add-member" }
  const membershipAction = request.action === "add-member"
    || request.action === "remove-member"
  const membershipCurrent = membershipAction
    ? writeRequired
      ? request.action === "remove-member"
      : desired.value as boolean
    : null
  const thread = {
    archived: request.action === "unarchive"
      ? writeRequired
      : request.action === "archive" && !writeRequired,
    autoArchiveDuration: request.action === "set-auto-archive-duration"
      ? writeRequired
        ? request.autoArchiveDuration === 1440 ? 60 : 1440
        : request.autoArchiveDuration
      : 1440,
    guildId: request.guildId,
    id: request.threadId,
    invitable: request.action === "set-invitable"
      ? writeRequired ? !request.enabled : request.enabled
      : true,
    locked: request.action === "unlock"
      ? writeRequired
      : request.action === "lock" && !writeRequired,
    name: request.action === "rename" && !writeRequired
      ? request.name
      : "untrusted-thread-name",
    ownerId: GUILD_OWNER_ID,
    parentId: CHANNEL_ID,
    rateLimitPerUser: request.action === "set-slowmode"
      ? writeRequired
        ? request.rateLimitPerUser === 0 ? 5 : 0
        : request.rateLimitPerUser
      : 0,
    type: "private" as const,
    unknownFieldCount: 0,
    unknownMetadataFieldCount: 0,
  }
  const membership = membershipAction
    ? {
        isMember: membershipCurrent as boolean,
        joinedAt: membershipCurrent ? "2026-08-22T00:00:00.000Z" : null,
        unknownFieldCount: 0,
        userId: request.userId,
      }
    : null
  return {
    action: request.action,
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    authorizationBasis: writeRequired ? "manage-threads" : "already-current",
    botId: BOT_ID,
    connectorMembership: {
      isMember: true,
      joinedAt: "2026-08-21T00:00:00.000Z",
      unknownFieldCount: 0,
      userId: BOT_ID,
    },
    createdAt: "2026-08-22T00:00:00.000Z",
    desired,
    digest,
    guild: {
      id: request.guildId,
      name: "Private guild name",
      ownerId: GUILD_OWNER_ID,
    },
    member: membershipAction
      ? { id: request.userId, username: "untrusted-member-name" }
      : null,
    membership,
    operationKeyHash: OPERATION_KEY_HASH,
    parent: {
      id: CHANNEL_ID,
      name: "untrusted-parent-name",
      type: 0,
    },
    permission: permission(["VIEW_CHANNEL", "MANAGE_THREADS"]),
    privacy: {
      embeddedGuildMembers: "never-requested",
      enumeration: "none",
      omittedFields: [
        "applied tags",
        "current-user membership object",
        "flags",
        "last-message ID",
        "member count",
        "message count",
        "permission summary",
        "thread timestamps",
        "total message count",
        "unknown field values",
      ],
      persistence: "content-free-outcomes-only",
      rawPayloadExposed: false,
    },
    risks: writeRequired ? ["One exact non-retried thread write"] : [],
    schemaVersion: 1,
    status: writeRequired ? "planned" : "already-current",
    targetPermission: membershipAction
      ? permission(["VIEW_CHANNEL", "SEND_MESSAGES_IN_THREADS"], [request.guildId])
      : null,
    thread,
    warnings: ["Same-thread serialization is process-local"],
    writeRequired,
  }
}

function guildScaffoldPlan(
  request: GuildScaffoldRequest,
  digest = DIGEST,
): GuildScaffoldPlan {
  return {
    applicationId: APPLICATION_ID,
    auditReason: request.auditReason,
    botId: BOT_ID,
    counts: {
      alreadyCurrent: 0,
      completed: 0,
      ready: 2,
      total: 2,
      waitingForParent: 0,
    },
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    executionFrontier: {
      stepIndexes: [0, 1],
    },
    guild: {
      id: request.guildId,
      name: "Guild",
      ownerId: USER_ID,
    },
    operation: {
      operationKeyHash: OPERATION_KEY_HASH,
      requestDigest: DIGEST,
      status: "unreserved",
      stepLimit: request.stepLimit ?? 10,
    },
    permission: {
      botAdministrator: false,
      botEffectivePermissionNames: ["MANAGE_CHANNELS", "MANAGE_ROLES", "VIEW_CHANNEL"],
      botEffectivePermissions: (
        DISCORD_PERMISSIONS.MANAGE_CHANNELS
        | DISCORD_PERMISSIONS.MANAGE_ROLES
        | DISCORD_PERMISSIONS.VIEW_CHANNEL
      ).toString(),
      botHighestRoleIds: ["350000000000000002"],
      botHighestRolePosition: 2,
      guildManageChannels: true,
      guildManageRoles: true,
      guildViewChannel: true,
    },
    schemaVersion: 1,
    status: "planned",
    steps: [{
      existingResourceId: null,
      index: 0,
      key: "reviewer-role",
      kind: "role",
      operationKeyHash: OPERATION_KEY_HASH,
      parent: null,
      state: "ready",
      target: {
        hoist: false,
        mentionable: false,
        name: "reviewer",
        permissionBits: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
        permissions: ["VIEW_CHANNEL"],
        primaryColor: 0,
      },
    }, {
      existingResourceId: null,
      index: 1,
      key: "review-category",
      kind: "category",
      operationKeyHash: OPERATION_KEY_HASH,
      parent: null,
      state: "ready",
      target: {
        defaultAutoArchiveDuration: null,
        name: "Review",
        nsfw: null,
        rateLimitPerUser: null,
        topic: null,
      },
    }],
    visibleInventory: {
      channels: 5,
      channelLimit: 500,
      roles: 3,
      roleLimit: 250,
    },
    warnings: ["A newly created category requires a fresh child plan"],
  }
}

function fixturePolicy(): PolicyDescription {
  return {
    administrationEnabled: false,
    administrationGuildIds: [],
    announcementCrosspostChannelIds: [],
    announcementCrosspostsEnabled: false,
    announcementSubscriptionAuditEnabled: false,
    announcementSubscriptionChangesEnabled: false,
    announcementSubscriptionSourceChannelIds: [],
    announcementSubscriptionTargetChannelIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [],
    attachmentChannelIds: [],
    attachmentMaxBytes: 0,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    automodAlertChannelIds: [],
    automodAuditEnabled: false,
    automodChangesEnabled: false,
    automodGuildIds: [],
    banAuditEnabled: false,
    banAuditGuildIds: [],
    channelCloneAuditEnabled: false,
    channelCloneGuildIds: [],
    channelCloneSourceIds: [],
    channelCloningEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    channelMetadataChangesEnabled: false,
    channelMetadataIds: [],
    channelOrderingAuditEnabled: false,
    channelOrderingChangesEnabled: false,
    channelOrderingGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    forumTagAuditEnabled: false,
    forumTagChangesEnabled: false,
    forumTagChannelIds: [],
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    guildSettingsAuditEnabled: false,
    guildSettingsChangesEnabled: false,
    guildSettingsGuildIds: [],
    guildTemplateAuditEnabled: false,
    guildTemplateChangesEnabled: false,
    guildTemplateGuildIds: [],
    integrationAuditEnabled: false,
    integrationDeletionsEnabled: false,
    integrationGuildIds: [],
    integrationIds: [],
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    soundboardAuditEnabled: false,
    soundboardChangesEnabled: false,
    soundboardCreationEnabled: false,
    soundboardGuildIds: [],
    soundboardRootCount: 0,
    stageChannelIds: [],
    stageInstanceAuditEnabled: false,
    stageInstanceChangesEnabled: false,
    stageStartNotificationsEnabled: false,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    inviteAuditEnabled: false,
    inviteDeletionsEnabled: false,
    inviteGuildIds: [],
    memberDirectoryEnabled: true,
    memberDirectoryGuildIds: [GUILD_ID],
    memberRoleChangesEnabled: false,
    memberRoleGuildIds: [],
    memberRoleCount: 0,
    memberVoiceAuditEnabled: false,
    memberVoiceChangesEnabled: false,
    memberVoiceChannelIds: [],
    memberVoiceGuildIds: [],
    nativeCommandChangesEnabled: false,
    nativeCommandName: "discord-mcp",
    nativeInteractionChannelIds: [],
    nativeInteractionGuildIds: [],
    nativeInteractionMaxPending: 25,
    nativeInteractionsEnabled: false,
    nativeInteractionTtlSeconds: 600,
    nativeInteractionUserIds: [],
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    onboardingAuditEnabled: false,
    onboardingChangesEnabled: false,
    onboardingGuildIds: [],
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 0,
    pinChannelIds: [],
    pinManagementEnabled: false,
    pollAuditEnabled: false,
    pollChannelIds: [],
    pollCreationEnabled: false,
    pollEndingEnabled: false,
    pollVoterAuditEnabled: false,
    reactionChannelIds: [],
    reactionModerationEnabled: false,
    reactionUserAuditEnabled: false,
    readChannelScope: "all-visible",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    roleConfigurationEnabled: false,
    roleConfigurationIds: [],
    roleOrderingAuditEnabled: false,
    roleOrderingChangesEnabled: false,
    roleOrderingGuildIds: [],
    readGuildScope: "all-visible",
    threadCreationEnabled: false,
    threadAuditEnabled: false,
    threadChangesEnabled: false,
    threadGuildIds: [],
    threadIds: [],
    threadMemberUserIds: [],
    threadParentIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookChangesEnabled: false,
    webhookCreationEnabled: false,
    webhookDeletionsEnabled: false,
    welcomeScreenAuditEnabled: false,
    welcomeScreenChangesEnabled: false,
    welcomeScreenGuildIds: [],
    widgetPublicExposureEnabled: false,
    widgetSettingsAuditEnabled: false,
    widgetSettingsChangesEnabled: false,
    widgetSettingsGuildIds: [],
  }
}

function serviceFixture(overrides: {
  administrationError?: Error
  activityError?: Error
  announcementCrosspostAction?: "crosspost" | "none"
  announcementCrosspostError?: Error
  announcementCrosspostPlanDigest?: string
  announcementSubscriptionError?: Error
  announcementSubscriptionPlanDigest?: string
  announcementSubscriptionWriteRequired?: boolean
  attachmentError?: Error
  attachmentPlanDigest?: string
  autoModerationEffect?: "change" | "none"
  autoModerationError?: Error
  autoModerationPlanDigest?: string
  channelCreationAction?: "create" | "none"
  channelCreationError?: Error
  channelCreationPlanDigest?: string
  channelCloneError?: Error
  channelClonePlanDigest?: string
  channelMetadataEffect?: "change" | "none"
  channelMetadataError?: Error
  channelMetadataPlanDigest?: string
  channelOrderingEffect?: "change" | "none"
  channelOrderingError?: Error
  channelOrderingPlanDigest?: string
  componentMessageError?: Error
  componentMessagePlanDigest?: string
  componentMessageWriteRequired?: boolean
  deletionError?: Error
  forumPostError?: Error
  forumPostPlanDigest?: string
  forumTagEffect?: "change" | "none"
  forumTagError?: Error
  forumTagPlanDigest?: string
  guildScaffoldError?: Error
  guildScaffoldPlanDigest?: string
  guildTemplateError?: Error
  guildTemplateMutation?: GuildTemplateChangePlan["mutation"]
  guildTemplatePlanDigest?: string
  guildExpressionEffect?: "change" | "none"
  guildExpressionError?: Error
  guildExpressionPlanDigest?: string
  interactionError?: Error
  integrationDeletionError?: Error
  integrationDeletionPlanDigest?: string
  inviteDeletionError?: Error
  inviteDeletionPlanDigest?: string
  messageContent?: string
  messagePinAction?: "change" | "none"
  messagePinError?: Error
  messagePinPlanDigest?: string
  memberRoleAction?: "add" | "none" | "remove"
  memberRoleError?: Error
  memberRolePlanDigest?: string
  memberVoiceError?: Error
  memberVoicePlanDigest?: string
  memberVoiceWriteRequired?: boolean
  nativeInteractionCommandError?: Error
  nativeInteractionCommandMutation?: "create" | "delete" | "none"
  nativeInteractionCommandPlanDigest?: string
  onboardingEffect?: "change" | "none"
  onboardingError?: Error
  onboardingPlanDigest?: string
  welcomeScreenEffect?: "change" | "none"
  welcomeScreenError?: Error
  welcomeScreenPlanDigest?: string
  widgetSettingsEffect?: "change" | "none"
  widgetSettingsError?: Error
  widgetSettingsPlanDigest?: string
  guildSettingsEffect?: "change" | "none"
  guildSettingsError?: Error
  guildSettingsPlanDigest?: string
  permissionOverwriteAction?: "delete" | "none" | "put"
  permissionOverwriteError?: Error
  permissionOverwritePlanDigest?: string
  planDigest?: string
  pollCreationError?: Error
  pollCreationPlanDigest?: string
  pollEndError?: Error
  pollEndPlanDigest?: string
  pollEndWriteRequired?: boolean
  reactionModerationError?: Error
  reactionModerationPlanDigest?: string
  reactionModerationWriteRequired?: boolean
  roleCreationAction?: "create" | "none"
  roleCreationError?: Error
  roleCreationPlanDigest?: string
  roleConfigurationEffect?: "change" | "none"
  roleConfigurationError?: Error
  roleConfigurationPlanDigest?: string
  roleOrderingEffect?: "change" | "none"
  roleOrderingError?: Error
  roleOrderingPlanDigest?: string
  scheduledEventEffect?: "change" | "none"
  scheduledEventError?: Error
  scheduledEventPlanDigest?: string
  soundboardEffect?: "change" | "none"
  soundboardError?: Error
  soundboardPlanDigest?: string
  stageInstanceEffect?: "change" | "none"
  stageInstanceError?: Error
  stageInstancePlanDigest?: string
  threadCreationError?: Error
  threadCreationPlanDigest?: string
  threadCreationWriteRequired?: boolean
  threadGovernanceError?: Error
  threadGovernancePlanDigest?: string
  threadGovernanceWriteRequired?: boolean
  webhookDeletionError?: Error
  webhookDeletionPlanDigest?: string
  webhookChangeError?: Error
  webhookChangePlanDigest?: string
  webhookChangeWriteRequired?: boolean
  webhookCreationError?: Error
  webhookCreationPlanDigest?: string
} = {}) {
  const welcomeScreenCalls = {
    execute: 0,
    get: 0,
    plan: 0,
  }
  const widgetSettingsCalls = {
    execute: 0,
    get: 0,
    plan: 0,
  }
  const guildSettingsCalls = {
    execute: 0,
    get: 0,
    plan: 0,
  }
  const nativeInteractionCommandCalls = {
    execute: 0,
    plan: 0,
  }
  const calls = {
    active: 0,
    addReaction: 0,
    auditChannelOrder: 0,
    auditRoleOrder: 0,
    auditRoles: 0,
    archived: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    attachmentExecute: 0,
    attachmentPlan: 0,
    announcementCrosspostExecute: 0,
    announcementCrosspostPlan: 0,
    announcementSubscriptionExecute: 0,
    announcementSubscriptionList: 0,
    announcementSubscriptionPlan: 0,
    autoModerationExecute: 0,
    autoModerationGet: 0,
    autoModerationList: 0,
    autoModerationPlan: 0,
    banGet: 0,
    banList: 0,
    channelCloneExecute: 0,
    channelClonePlan: 0,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
    channelMetadataExecute: 0,
    channelMetadataGet: 0,
    channelMetadataPlan: 0,
    channelOrderingExecute: 0,
    channelOrderingPlan: 0,
    componentMessageExecute: 0,
    componentMessagePlan: 0,
    componentMessagePreview: 0,
    delete: 0,
    edit: 0,
    forumPostExecute: 0,
    forumPostPlan: 0,
    forumTagAudit: 0,
    forumTagExecute: 0,
    forumTagPlan: 0,
    guildScaffoldExecute: 0,
    guildScaffoldPlan: 0,
    guildScaffoldVerify: 0,
    guildTemplateExecute: 0,
    guildTemplateList: 0,
    guildTemplatePlan: 0,
    guildExpressionExecute: 0,
    guildExpressionGet: 0,
    guildExpressionList: 0,
    guildExpressionPlan: 0,
    integrationDeletionExecute: 0,
    integrationDeletionList: 0,
    integrationDeletionPlan: 0,
    inviteDeletionExecute: 0,
    inviteDeletionGet: 0,
    inviteDeletionList: 0,
    inviteDeletionPlan: 0,
    explain: 0,
    getRole: 0,
    memberGet: 0,
    memberList: 0,
    memberSearch: 0,
    listRoles: 0,
    messagePinExecute: 0,
    messagePinList: 0,
    messagePinPlan: 0,
    memberRoleExecute: 0,
    memberRolePlan: 0,
    memberVoiceExecute: 0,
    memberVoiceGet: 0,
    memberVoicePlan: 0,
    onboardingExecute: 0,
    onboardingGet: 0,
    onboardingPlan: 0,
    permissionOverwriteExecute: 0,
    permissionOverwriteList: 0,
    permissionOverwritePlan: 0,
    plan: 0,
    pollCreationExecute: 0,
    pollCreationPlan: 0,
    pollEndExecute: 0,
    pollEndPlan: 0,
    pollGet: 0,
    pollVoters: 0,
    principalExplain: 0,
    reactionModerationExecute: 0,
    reactionModerationPlan: 0,
    reactionUsers: 0,
    reactions: 0,
    removeOwnReaction: 0,
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    roleConfigurationExecute: 0,
    roleConfigurationPlan: 0,
    roleOrderingExecute: 0,
    roleOrderingPlan: 0,
    scheduledEventExecute: 0,
    scheduledEventGet: 0,
    scheduledEventList: 0,
    scheduledEventPlan: 0,
    soundboardDefaultList: 0,
    soundboardExecute: 0,
    soundboardGet: 0,
    soundboardGuildList: 0,
    soundboardPlan: 0,
    stageInstanceExecute: 0,
    stageInstanceGet: 0,
    stageInstanceList: 0,
    stageInstancePlan: 0,
    search: 0,
    send: 0,
    threadCreationExecute: 0,
    threadCreationPlan: 0,
    threadGovernanceExecute: 0,
    threadGovernanceGet: 0,
    threadGovernanceMembership: 0,
    threadGovernancePlan: 0,
    webhookDeletionExecute: 0,
    webhookDeletionGet: 0,
    webhookDeletionList: 0,
    webhookDeletionPlan: 0,
    webhookChangeExecute: 0,
    webhookChangePlan: 0,
    webhookCreationExecute: 0,
    webhookCreationPlan: 0,
  }
  const reactionModerationPlan = (
    request: Parameters<DiscordToolService["planReactionModeration"]>[0],
    digest: string,
  ): Awaited<ReturnType<DiscordToolService["planReactionModeration"]>> => {
    const writeRequired = overrides.reactionModerationWriteRequired ?? true
    const custom = request.emoji?.match(/^([^:]+):([0-9]+)$/)
    const emoji = request.scope === "all"
      ? null
      : custom
        ? {
            animated: false,
            id: custom[2] as string,
            kind: "custom" as const,
            name: custom[1] as string,
            routeToken: request.emoji as string,
          }
        : {
            animated: false,
            id: null,
            kind: "unicode" as const,
            name: request.emoji as string,
            routeToken: request.emoji as string,
          }
    const reactions = writeRequired && emoji
      ? [{
          burstCount: 0,
          count: 1,
          emoji,
          me: false,
          meBurst: false,
          normalCount: 1,
        }]
      : []
    return {
      action: writeRequired ? "remove" : "none",
      applicationId: APPLICATION_ID,
      auditReason: request.auditReason,
      botId: BOT_ID,
      channel: { id: request.channelId, parentId: null, type: 0 },
      createdAt: "2026-08-22T00:00:00.000Z",
      digest,
      guild: { id: GUILD_ID, name: "Private guild name" },
      message: {
        id: request.messageId,
        timestamp: "2026-08-22T00:00:00.000Z",
        type: 0,
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId}`,
      },
      operationKeyHash: OPERATION_KEY_HASH,
      permission: {
        administrator: false,
        appliedRoleIds: [GUILD_ID],
        canReadMessages: true,
        confidence: "complete",
        connect: null,
        effectivePermissions: "9216",
        manageMessages: true,
        permissionSourceChannelId: request.channelId,
        privateThreadAccess: "not-applicable",
        readMessageHistory: true,
        viewChannel: true,
      },
      privacy: {
        omittedFields: [
          "attachments",
          "author",
          "burstColors",
          "components",
          "content",
          "embeds",
          "memberProfiles",
          "rawPayloads",
          "userAvatars",
          "userGlobalNames",
          "userNames",
        ],
        persistence: "none",
        profilesProjectedOut: true,
        rawPayloads: "omitted",
      },
      reactions,
      schemaVersion: 1,
      status: writeRequired ? "planned" : "already-absent",
      target: {
        emoji,
        scope: request.scope,
        userBot: request.scope === "user" ? false : null,
        userId: request.userId ?? null,
      },
      warnings: ["Local audit reason only"],
      writeRequired,
    }
  }
  const service: DiscordToolService = {
    async auditChannelOrder(guildId) {
      calls.auditChannelOrder += 1
      const planned = channelOrderingPlan(channelOrderingInput({ guildId }))
      const channels = planned.current.groupOrder.map((id, rank) => ({
        ...(id === planned.channel.id
          ? planned.channel
          : id === planned.anchor.id
            ? planned.anchor
            : channelOrderEntry(id, "Middle channel", rank)),
        rank,
      }))
      return {
        applicationId: planned.applicationId,
        botId: planned.botId,
        groups: [{
          channels,
          family: "text",
          parentChannelId: planned.parentChannelId,
          permission: planned.permission,
          unsupportedType: null,
        }],
        guild: planned.guild,
        httpEvidenceMode: planned.httpEvidenceMode,
        layout: planned.layout,
        permission: {
          administrator: false,
          botEffectivePermissionNames: ["MANAGE_CHANNELS"],
          botEffectivePermissions: DISCORD_PERMISSIONS.MANAGE_CHANNELS.toString(),
          confidence: "complete",
          guildManageChannels: true,
        },
        privacy: planned.privacy,
        schemaVersion: 1,
        status: "ok",
      }
    },
    async auditRoleOrder(guildId) {
      calls.auditRoleOrder += 1
      const planned = roleOrderingPlan(roleOrderingInput({ guildId }))
      return {
        applicationId: planned.applicationId,
        botId: planned.botId,
        guild: planned.guild,
        order: [
          planned.role,
          ...planned.affectedRoles.map(({
            afterRank: _afterRank,
            beforeRank,
            ...entry
          }) => ({
            ...entry,
            rank: beforeRank,
          })).filter((entry) => (
            entry.id !== planned.role.id && entry.id !== planned.anchor.id
          )),
          planned.anchor,
        ].sort((left, right) => left.rank - right.rank),
        permission: planned.permission,
        privacy: planned.privacy,
        schemaVersion: 1,
        status: "ok",
      }
    },
    async executeGuildIntegrationDeletion(request, planDigest) {
      if (overrides.integrationDeletionError) {
        throw overrides.integrationDeletionError
      }
      calls.integrationDeletionExecute += 1
      return {
        activityId: "activity-integration-deletion",
        associatedBotUserId: INTEGRATION_BOT_ID,
        guildId: request.guildId,
        integrationId: request.integrationId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        targetApplicationId: INTEGRATION_APPLICATION_ID,
        verifiedAbsent: true,
        verifiedUnchanged: true,
      }
    },
    async executeChannelClone(request, planDigest) {
      if (overrides.channelCloneError) throw overrides.channelCloneError
      calls.channelCloneExecute += 1
      return {
        activityId: "activity-channel-clone",
        baselineLayoutRevision: 7,
        createdChannelId: CHANNEL_CLONE_CREATED_ID,
        guildId: request.guildId,
        observedLayoutRevision: 8,
        operationKeyHash: operationKeyHash(request.operationKey),
        parentId: PARENT_ID,
        planDigest,
        schemaVersion: 1,
        sourceChannelId: request.sourceChannelId,
        status: "completed",
        tagIdMap: [],
        type: DISCORD_CHANNEL_TYPES.text,
        typeName: "text",
        verification: "match",
      }
    },
    async executeChannelOrder(request, planDigest) {
      if (overrides.channelOrderingError) throw overrides.channelOrderingError
      calls.channelOrderingExecute += 1
      const planned = channelOrderingPlan(
        request,
        planDigest,
        overrides.channelOrderingEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-channel-ordering" : null,
        anchorChannelId: request.anchorChannelId,
        baselineLayoutRevision: planned.layout.revision,
        channelId: request.channelId,
        guildId: request.guildId,
        layoutMatched: true,
        observedAffectedChannels: planned.affectedChannels.map((entry) => ({
          id: entry.id,
          obfuscated: entry.obfuscated,
          parentChannelId: entry.parentChannelId,
          rank: entry.afterRank,
          rawPosition: entry.submittedPosition,
          type: entry.type,
        })),
        observedLayoutRevision: planned.writeRequired
          ? planned.layout.revision + 1
          : planned.layout.revision,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async executeNativeInteractionCommand(request, planDigest) {
      if (overrides.nativeInteractionCommandError) {
        throw overrides.nativeInteractionCommandError
      }
      nativeInteractionCommandCalls.execute += 1
      const planned = nativeInteractionCommandPlan(
        request,
        planDigest,
        overrides.nativeInteractionCommandMutation,
      )
      return {
        action: request.action,
        activityId: planned.mutation === "none"
          ? null
          : "activity-native-command",
        commandId: planned.command.id || "700000000000000001",
        guildId: request.guildId,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        readbackMatched: true,
        schemaVersion: 1,
        status: planned.mutation === "none"
          ? request.action === "install" ? "already-installed" : "already-absent"
          : "completed",
      }
    },
    async executeThreadChange(request, planDigest) {
      if (overrides.threadGovernanceError) throw overrides.threadGovernanceError
      calls.threadGovernanceExecute += 1
      const writeRequired = overrides.threadGovernanceWriteRequired ?? true
      const planned = threadGovernancePlan(request, planDigest, writeRequired)
      const observedThread = { ...planned.thread }
      if (planned.desired.field !== "membership") {
        observedThread[planned.desired.field] = planned.desired.value as never
      }
      const membershipAction = request.action === "add-member"
        || request.action === "remove-member"
      return {
        action: request.action,
        activityId: writeRequired ? "activity-thread-governance" : null,
        driftFields: [],
        guildId: request.guildId,
        observedMembership: membershipAction
          ? {
              isMember: request.action === "add-member",
              joinedAt: request.action === "add-member"
                ? "2026-08-22T00:00:00.000Z"
                : null,
              unknownFieldCount: 0,
              userId: request.userId,
            }
          : null,
        observedThread,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: writeRequired ? "completed" : "already-current",
        targetUserId: membershipAction ? request.userId : null,
        threadId: request.threadId,
        verification: writeRequired ? "match" : "not-required",
      }
    },
    async getThreadMembership(guildId, threadId, userId) {
      calls.threadGovernanceMembership += 1
      const planned = threadGovernancePlan({
        action: "add-member",
        auditReason: AUDIT_REASON,
        guildId,
        operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
        threadId,
        userId,
      })
      return {
        ...planned,
        member: planned.member!,
        membership: planned.membership!,
        status: "ok",
        targetPermission: planned.targetPermission!,
      }
    },
    async getThreadState(guildId, threadId) {
      calls.threadGovernanceGet += 1
      const planned = threadGovernancePlan({
        action: "rename",
        auditReason: AUDIT_REASON,
        guildId,
        name: "renamed-thread",
        operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
        threadId,
      })
      return { ...planned, status: "ok" }
    },
    async planThreadChange(request) {
      calls.threadGovernancePlan += 1
      return threadGovernancePlan(
        request,
        overrides.threadGovernancePlanDigest || DIGEST,
        overrides.threadGovernanceWriteRequired ?? true,
      )
    },
    async executeChannelMetadataChange(request, planDigest) {
      if (overrides.channelMetadataError) throw overrides.channelMetadataError
      calls.channelMetadataExecute += 1
      const planned = channelMetadataPlan(
        request,
        planDigest,
        overrides.channelMetadataEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-channel-metadata" : null,
        channelId: request.channelId,
        guildId: request.guildId,
        observed: planned.desired,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async getChannel(channelId) {
      calls.channelMetadataGet += 1
      return channelMetadataRead(channelId)
    },
    async auditForumTags() {
      calls.forumTagAudit += 1
      return forumTagAudit()
    },
    async planChannelMetadataChange(request) {
      calls.channelMetadataPlan += 1
      return channelMetadataPlan(
        request,
        overrides.channelMetadataPlanDigest || DIGEST,
        overrides.channelMetadataEffect,
      )
    },
    async executeOnboardingChange(request, planDigest) {
      if (overrides.onboardingError) throw overrides.onboardingError
      calls.onboardingExecute += 1
      const planned = onboardingPlan(
        request,
        planDigest,
        overrides.onboardingEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-onboarding" : null,
        guildId: request.guildId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async executeWelcomeScreenChange(request, planDigest) {
      if (overrides.welcomeScreenError) throw overrides.welcomeScreenError
      welcomeScreenCalls.execute += 1
      const planned = welcomeScreenPlan(
        request,
        planDigest,
        overrides.welcomeScreenEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-welcome-screen" : null,
        guildId: request.guildId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async executeWidgetSettingsChange(request, planDigest) {
      if (overrides.widgetSettingsError) throw overrides.widgetSettingsError
      widgetSettingsCalls.execute += 1
      const planned = widgetSettingsPlan(
        request,
        planDigest,
        overrides.widgetSettingsEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-widget-settings" : null,
        guildId: request.guildId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
        warnings: planned.warnings,
      }
    },
    async executeGuildSettingsChange(request, planDigest) {
      if (overrides.guildSettingsError) throw overrides.guildSettingsError
      guildSettingsCalls.execute += 1
      const planned = guildSettingsPlan(
        request,
        planDigest,
        overrides.guildSettingsEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-guild-settings" : null,
        driftFields: [],
        guildId: request.guildId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        requestedFields: planned.requestedFields,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
        warnings: planned.warnings,
      }
    },
    async getGuildOnboarding(_guildId, includeText = false) {
      calls.onboardingGet += 1
      return onboardingAudit(includeText)
    },
    async getGuildWelcomeScreen(_guildId, includeText = false) {
      welcomeScreenCalls.get += 1
      return welcomeScreenAudit(includeText)
    },
    async getGuildWidgetSettings() {
      widgetSettingsCalls.get += 1
      return widgetSettingsAudit()
    },
    async getGuildSettings() {
      guildSettingsCalls.get += 1
      return guildSettingsAudit()
    },
    async planOnboardingChange(request) {
      calls.onboardingPlan += 1
      return onboardingPlan(
        request,
        overrides.onboardingPlanDigest || DIGEST,
        overrides.onboardingEffect,
      )
    },
    async planWelcomeScreenChange(request) {
      welcomeScreenCalls.plan += 1
      return welcomeScreenPlan(
        request,
        overrides.welcomeScreenPlanDigest || DIGEST,
        overrides.welcomeScreenEffect,
      )
    },
    async planWidgetSettingsChange(request) {
      widgetSettingsCalls.plan += 1
      return widgetSettingsPlan(
        request,
        overrides.widgetSettingsPlanDigest || DIGEST,
        overrides.widgetSettingsEffect,
      )
    },
    async planGuildSettingsChange(request) {
      guildSettingsCalls.plan += 1
      return guildSettingsPlan(
        request,
        overrides.guildSettingsPlanDigest || DIGEST,
        overrides.guildSettingsEffect,
      )
    },
    async executeInviteDeletion(request, planDigest) {
      if (overrides.inviteDeletionError) throw overrides.inviteDeletionError
      calls.inviteDeletionExecute += 1
      return {
        activityId: "activity-invite-deletion",
        channelId: CHANNEL_ID,
        guildId: request.guildId,
        inviteRef: request.inviteRef,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        verifiedAbsent: true,
      }
    },
    async getGuildInvite(guildId, inviteRef) {
      calls.inviteDeletionGet += 1
      return {
        access: inviteAccess(),
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
        guild: { id: guildId, name: "Private guild name" },
        invite: { ...projectedInvite(), inviteRef },
        privacy: invitePrivacy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuildInvites(guildId, options) {
      calls.inviteDeletionList += 1
      return {
        access: inviteAccess(),
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
        guild: { id: guildId, name: "Private guild name" },
        invites: [projectedInvite()],
        page: {
          cursor: options?.cursor ?? null,
          hasMore: false,
          nextCursor: null,
          requestedLimit: options?.limit ?? 25,
          returned: 1,
          safetyLimit: 1_000,
        },
        privacy: invitePrivacy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuildTemplates(guildId) {
      calls.guildTemplateList += 1
      return {
        access: guildTemplatePlan({
          action: "delete",
          auditReason: AUDIT_REASON,
          guildId,
          operationKey: GUILD_TEMPLATE_OPERATION_KEY,
          templateRef: GUILD_TEMPLATE_REF,
        }).access,
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
        channelEvidence: guildTemplatePlan({
          action: "delete",
          auditReason: AUDIT_REASON,
          guildId,
          operationKey: GUILD_TEMPLATE_OPERATION_KEY,
          templateRef: GUILD_TEMPLATE_REF,
        }).channelEvidence,
        guild: { id: guildId },
        inventory: { returned: 1, safetyLimit: 100 },
        limitations: ["Guild Templates are snapshots rather than backups"],
        liveStructure: guildTemplateStructure(),
        privacy: guildTemplatePrivacy(),
        schemaVersion: 1,
        status: "ok",
        templates: [projectedGuildTemplate()],
      }
    },
    async listGuildIntegrations(guildId) {
      calls.integrationDeletionList += 1
      return integrationInventory(guildId)
    },
    async planInviteDeletion(request) {
      calls.inviteDeletionPlan += 1
      return inviteDeletionPlan(
        request,
        overrides.inviteDeletionPlanDigest || DIGEST,
      )
    },
    async executeAutoModerationChange(request, planDigest) {
      if (overrides.autoModerationError) throw overrides.autoModerationError
      calls.autoModerationExecute += 1
      const planned = autoModerationPlan(
        request,
        planDigest,
        overrides.autoModerationEffect,
      )
      const ruleId = request.action === "create"
        ? AUTOMOD_RULE_ID
        : request.ruleId
      return {
        action: request.action,
        activityId: planned.effect === "none" ? null : "activity-automod",
        guildId: request.guildId,
        observed: request.action === "delete"
          ? null
          : { ...planned.desired, ruleId } as ProjectedAutoModerationRule,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        ruleId,
        schemaVersion: 1,
        status: planned.effect === "none" ? "already-current" : "completed",
      }
    },
    async getAutoModerationRule(guildId, ruleId) {
      calls.autoModerationGet += 1
      const rule = projectedAutoModerationRule(ruleId)
      return {
        guild: { id: guildId, name: "Private guild name" },
        permission: {
          administrator: false,
          confidence: "complete",
          effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
          guildOwner: false,
          missingPermissions: [],
          requiredPermissions: ["MANAGE_GUILD"],
        },
        privacy: autoModerationPrivacy(),
        references: autoModerationReferences(),
        rule,
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listAutoModerationRules(guildId) {
      calls.autoModerationList += 1
      const rule = projectedAutoModerationRule()
      return {
        guild: { id: guildId, name: "Private guild name" },
        page: {
          returned: 1,
          safetyLimit: 10,
          visibility: "connector-visible",
        },
        permission: {
          administrator: false,
          confidence: "complete",
          effectivePermissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
          guildOwner: false,
          missingPermissions: [],
          requiredPermissions: ["MANAGE_GUILD"],
        },
        privacy: autoModerationPrivacy(),
        rules: [{
          actionTypes: rule.actions.map(({ type }) => type),
          creatorUserId: rule.creatorUserId,
          enabled: rule.enabled,
          eventType: rule.eventType,
          exemptChannelCount: rule.exemptChannelIds.length,
          exemptRoleCount: rule.exemptRoleIds.length,
          guildId,
          name: rule.name,
          policyEntryCounts: {
            allowList: 0,
            keywordFilter: 1,
            presets: 0,
            regexPatterns: 0,
          },
          references: { healthy: true },
          ruleId: rule.ruleId,
          triggerType: rule.trigger.type,
        }],
        schemaVersion: 1,
        status: "ok",
      }
    },
    async planAutoModerationChange(request) {
      calls.autoModerationPlan += 1
      return autoModerationPlan(
        request,
        overrides.autoModerationPlanDigest || DIGEST,
        overrides.autoModerationEffect,
      )
    },
    async executeScheduledEventChange(request, planDigest) {
      if (overrides.scheduledEventError) throw overrides.scheduledEventError
      calls.scheduledEventExecute += 1
      const planned = scheduledEventPlan(
        request,
        planDigest,
        overrides.scheduledEventEffect,
      )
      const eventId = request.action === "create"
        ? SCHEDULED_EVENT_ID
        : request.eventId
      return {
        action: request.action,
        activityId: planned.effect === "none" ? null : "activity-scheduled-event",
        eventId,
        guildId: request.guildId,
        observed: request.action === "delete"
          ? null
          : { ...planned.desired, eventId } as ProjectedScheduledEvent,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: planned.effect === "none" ? "already-current" : "completed",
      }
    },
    async getScheduledEvent(guildId, eventId, includeSubscriberCount) {
      calls.scheduledEventGet += 1
      const event = projectedScheduledEvent(
        eventId,
        includeSubscriberCount ? 7 : null,
      )
      return {
        access: scheduledEventAccess(event.entityType, event.channelId),
        event,
        guild: { id: guildId, name: "Private guild name" },
        privacy: scheduledEventPrivacy(),
        schemaVersion: 1,
        status: "ok",
        subscriberCountIncluded: includeSubscriberCount === true,
      }
    },
    async listScheduledEvents(guildId, includeSubscriberCount) {
      calls.scheduledEventList += 1
      const event = projectedScheduledEvent(
        SCHEDULED_EVENT_ID,
        includeSubscriberCount ? 7 : null,
      )
      return {
        events: [{
          access: scheduledEventAccess(event.entityType, event.channelId),
          event,
        }],
        guild: { id: guildId, name: "Private guild name" },
        page: {
          returned: 1,
          safetyLimit: 100,
          visibility: "connector-visible",
        },
        privacy: scheduledEventPrivacy(),
        schemaVersion: 1,
        status: "ok",
        subscriberCountsIncluded: includeSubscriberCount === true,
      }
    },
    async planScheduledEventChange(request) {
      calls.scheduledEventPlan += 1
      return scheduledEventPlan(
        request,
        overrides.scheduledEventPlanDigest || DIGEST,
        overrides.scheduledEventEffect,
      )
    },
    async executeStageInstanceChange(request, planDigest) {
      if (overrides.stageInstanceError) throw overrides.stageInstanceError
      calls.stageInstanceExecute += 1
      const planned = stageInstancePlan(
        request,
        planDigest,
        overrides.stageInstanceEffect,
      )
      return {
        action: request.action,
        activityId: planned.writeRequired ? "activity-stage-instance" : null,
        channelId: request.channelId,
        guildId: request.guildId,
        observed: request.action === "end"
          ? null
          : projectedStageInstance(request.topic),
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        stageInstanceId: STAGE_INSTANCE_ID,
        status: planned.writeRequired ? "completed" : "already-current",
      }
    },
    async getStageInstance(guildId, channelId) {
      calls.stageInstanceGet += 1
      const instance = projectedStageInstance()
      return {
        access: stageInstancePlan({
          action: "update",
          auditReason: AUDIT_REASON,
          channelId,
          guildId,
          operationKey: STAGE_INSTANCE_OPERATION_KEY,
          topic: instance.topic,
        }).permission,
        channel: {
          guildId,
          id: channelId,
          name: "Private Stage channel",
          type: "stage",
        },
        guild: { id: guildId, name: "Private guild name" },
        instance: { ...instance, channelId, guildId },
        privacy: stageInstancePrivacy(),
        schemaVersion: 1,
        status: "active",
      }
    },
    async listStageInstances() {
      calls.stageInstanceList += 1
      const instance = projectedStageInstance()
      return {
        entries: [{
          access: stageInstancePlan({
            action: "update",
            auditReason: AUDIT_REASON,
            channelId: CHANNEL_ID,
            guildId: GUILD_ID,
            operationKey: STAGE_INSTANCE_OPERATION_KEY,
            topic: instance.topic,
          }).permission,
          channel: {
            guildId: GUILD_ID,
            id: CHANNEL_ID,
            name: "Private Stage channel",
            type: "stage",
          },
          guild: { id: GUILD_ID, name: "Private guild name" },
          instance,
          privacy: stageInstancePrivacy(),
          schemaVersion: 1,
          status: "active",
        }],
        page: {
          active: 1,
          configured: 1,
          inactive: 0,
          returned: 1,
          safetyLimit: 25,
        },
        privacy: stageInstancePrivacy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async planStageInstanceChange(request) {
      calls.stageInstancePlan += 1
      return stageInstancePlan(
        request,
        overrides.stageInstancePlanDigest || DIGEST,
        overrides.stageInstanceEffect,
      )
    },
    async executeGuildExpressionChange(request, planDigest) {
      if (overrides.guildExpressionError) throw overrides.guildExpressionError
      calls.guildExpressionExecute += 1
      const planned = guildExpressionPlan(
        request,
        planDigest,
        overrides.guildExpressionEffect,
      )
      const expressionId = request.action === "create"
        ? request.kind === "emoji" ? EMOJI_ID : STICKER_ID
        : request.expressionId
      return {
        action: request.action,
        activityId: planned.effect === "none" ? null : "activity-guild-expression",
        expressionId,
        guildId: request.guildId,
        kind: request.kind,
        observed: request.action === "delete"
          ? null
          : { ...planned.desired, expressionId } as ProjectedGuildExpression,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: planned.effect === "none" ? "already-current" : "completed",
      }
    },
    async executeGuildTemplateChange(request, planDigest) {
      if (overrides.guildTemplateError) throw overrides.guildTemplateError
      calls.guildTemplateExecute += 1
      const planned = guildTemplatePlan(
        request,
        planDigest,
        overrides.guildTemplateMutation,
      )
      return {
        action: request.action,
        activityId: planned.mutation === "none" ? null : "activity-guild-template",
        guildId: request.guildId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        schemaVersion: 1,
        status: planned.mutation === "none" ? "already-current" : "completed",
        templateRef: request.action === "create"
          ? `tref_hmac_sha256_${"8".repeat(64)}`
          : request.templateRef as string,
      }
    },
    async executeSoundboardChange(request, planDigest) {
      if (overrides.soundboardError) throw overrides.soundboardError
      calls.soundboardExecute += 1
      const planned = soundboardPlan(
        request,
        planDigest,
        overrides.soundboardEffect,
      )
      const soundId = request.action === "create"
        ? SOUNDBOARD_SOUND_ID
        : request.soundId
      return {
        action: request.action,
        activityId: planned.effect === "none" ? null : "activity-soundboard",
        guildId: request.guildId,
        observed: request.action === "delete"
          ? null
          : { ...planned.desired, soundId } as ProjectedSoundboardSound,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        soundId,
        status: planned.effect === "none" ? "already-current" : "completed",
      }
    },
    async getGuildSoundboardSound(guildId, soundId) {
      calls.soundboardGet += 1
      return {
        guild: { id: guildId, name: "Private guild name" },
        permission: soundboardPlan({
          action: "delete",
          auditReason: AUDIT_REASON,
          guildId,
          operationKey: SOUNDBOARD_OPERATION_KEY,
          soundId,
        }).permission,
        privacy: soundboardPrivacy(),
        schemaVersion: 1,
        sound: projectedSoundboardSound(soundId),
        status: "ok",
      }
    },
    async listDefaultSoundboardSounds() {
      calls.soundboardDefaultList += 1
      return {
        page: { returned: 1, safetyLimit: 250 },
        privacy: soundboardPrivacy(),
        schemaVersion: 1,
        sounds: [{ ...projectedSoundboardSound(), creatorUserId: null, guildId: null }],
        status: "ok",
      }
    },
    async listGuildSoundboardSounds(guildId) {
      calls.soundboardGuildList += 1
      return {
        guild: { id: guildId, name: "Private guild name" },
        page: { returned: 1, safetyLimit: 250 },
        permission: soundboardPlan({
          action: "delete",
          auditReason: AUDIT_REASON,
          guildId,
          operationKey: SOUNDBOARD_OPERATION_KEY,
          soundId: SOUNDBOARD_SOUND_ID,
        }).permission,
        privacy: soundboardPrivacy(),
        schemaVersion: 1,
        sounds: [projectedSoundboardSound()],
        status: "ok",
      }
    },
    async planSoundboardChange(request) {
      calls.soundboardPlan += 1
      return soundboardPlan(
        request,
        overrides.soundboardPlanDigest || DIGEST,
        overrides.soundboardEffect,
      )
    },
    async getGuildExpression(guildId, kind, expressionId) {
      calls.guildExpressionGet += 1
      return {
        expression: projectedGuildExpression(kind, expressionId),
        guild: { id: guildId, name: "Private guild name" },
        kind,
        permission: guildExpressionPlan({
          action: "delete",
          auditReason: AUDIT_REASON,
          expressionId,
          guildId,
          kind,
          operationKey: GUILD_EXPRESSION_OPERATION_KEY,
        }).permission,
        privacy: guildExpressionPrivacy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuildExpressions(guildId, kind) {
      calls.guildExpressionList += 1
      return {
        expressions: [projectedGuildExpression(kind)],
        guild: { id: guildId, name: "Private guild name" },
        kind,
        page: {
          returned: 1,
          safetyLimit: kind === "emoji" ? 1_000 : 100,
        },
        permission: guildExpressionPlan({
          action: "delete",
          auditReason: AUDIT_REASON,
          expressionId: kind === "emoji" ? EMOJI_ID : STICKER_ID,
          guildId,
          kind,
          operationKey: GUILD_EXPRESSION_OPERATION_KEY,
        }).permission,
        privacy: guildExpressionPrivacy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async planGuildExpressionChange(request) {
      calls.guildExpressionPlan += 1
      return guildExpressionPlan(
        request,
        overrides.guildExpressionPlanDigest || DIGEST,
        overrides.guildExpressionEffect,
      )
    },
    async planGuildTemplateChange(request) {
      calls.guildTemplatePlan += 1
      return guildTemplatePlan(
        request,
        overrides.guildTemplatePlanDigest || DIGEST,
        overrides.guildTemplateMutation,
      )
    },
    async planGuildIntegrationDeletion(request) {
      calls.integrationDeletionPlan += 1
      return integrationDeletionPlan(
        request,
        overrides.integrationDeletionPlanDigest || DIGEST,
      )
    },
    async executeWebhookCreation(request, planDigest) {
      if (overrides.webhookCreationError) throw overrides.webhookCreationError
      calls.webhookCreationExecute += 1
      const created = {
        ...projectedWebhook(request.channelId),
        name: request.name,
      }
      return {
        activityId: "activity-webhook-creation",
        channelId: request.channelId,
        created,
        guildId: GUILD_ID,
        inventoryMatched: true,
        observed: created,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        responseMatched: true as const,
        schemaVersion: 1,
        status: "completed" as const,
      }
    },
    async executeWebhookChange(request, planDigest) {
      if (overrides.webhookChangeError) throw overrides.webhookChangeError
      calls.webhookChangeExecute += 1
      const plan = webhookChangePlan(
        request,
        planDigest,
        overrides.webhookChangeWriteRequired ?? true,
      )
      return {
        activityId: plan.writeRequired ? "activity-webhook-change" : null,
        channelId: request.channelId,
        destinationChannelId: plan.desired.channelId,
        guildId: GUILD_ID,
        inventoryMatched: true,
        observed: plan.desired,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        responseMatched: plan.writeRequired,
        schemaVersion: 1,
        sourceTargetAbsent: plan.writeRequired
          && plan.desired.channelId !== request.channelId,
        status: plan.writeRequired ? "completed" as const : "already-current" as const,
        webhookId: request.webhookId,
      }
    },
    async executeWebhookDeletion(request, planDigest) {
      if (overrides.webhookDeletionError) throw overrides.webhookDeletionError
      calls.webhookDeletionExecute += 1
      return {
        activityId: "activity-webhook-deletion",
        channelId: request.channelId,
        guildId: GUILD_ID,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        verifiedAbsent: true,
        webhookId: request.webhookId,
      }
    },
    async getChannelWebhook(channelId, webhookId) {
      calls.webhookDeletionGet += 1
      return {
        channel: webhookChannel(channelId),
        guild: { id: GUILD_ID, name: "Private guild name" },
        permission: webhookPermission(channelId),
        privacy: webhookPrivacy(),
        schemaVersion: 1,
        status: "ok",
        webhook: { ...projectedWebhook(channelId), webhookId },
      }
    },
    async listChannelWebhooks(channelId) {
      calls.webhookDeletionList += 1
      return {
        channel: webhookChannel(channelId),
        guild: { id: GUILD_ID, name: "Private guild name" },
        page: { returned: 1, safetyLimit: 15 },
        permission: webhookPermission(channelId),
        privacy: webhookPrivacy(),
        schemaVersion: 1,
        status: "ok",
        webhooks: [projectedWebhook(channelId)],
      }
    },
    async listAnnouncementSubscriptions(targetChannelId) {
      calls.announcementSubscriptionList += 1
      const planned = announcementSubscriptionPlan({
        action: "subscribe",
        auditReason: AUDIT_REASON,
        operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
        sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
        targetChannelId,
      }, DIGEST, false)
      return {
        privacy: planned.privacy,
        schemaVersion: 1,
        status: "ok",
        target: planned.target,
      }
    },
    async planWebhookDeletion(request) {
      calls.webhookDeletionPlan += 1
      return webhookDeletionPlan(
        request,
        overrides.webhookDeletionPlanDigest || DIGEST,
      )
    },
    async planWebhookChange(request) {
      calls.webhookChangePlan += 1
      return webhookChangePlan(
        request,
        overrides.webhookChangePlanDigest || DIGEST,
        overrides.webhookChangeWriteRequired ?? true,
      )
    },
    async planWebhookCreation(request) {
      calls.webhookCreationPlan += 1
      return webhookCreationPlan(
        request,
        overrides.webhookCreationPlanDigest || DIGEST,
      )
    },
    async addReaction(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.addReaction += 1
      return {
        activityId: "activity-reaction",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async removeOwnReaction(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.removeOwnReaction += 1
      return {
        activityId: "activity-reaction-remove-own",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async auditChannelRoleAccess(input) {
      calls.auditRoles += 1
      const actions = [...(input.actions || [
        "view-channel" as const,
        "read-messages" as const,
        "send-message" as const,
      ])]
      return {
        channel: normalizeChannel(rawChannel({ id: input.channelId })),
        confidence: "complete",
        guildId: GUILD_ID,
        memberOverwriteCount: 0,
        page: {
          hasMore: false,
          nextCursor: null,
          requestedLimit: input.limit ?? 50,
          returned: 1,
          totalRoles: 1,
        },
        permissionSourceChannelId: input.channelId,
        requestedActions: actions,
        roles: [{
          administrator: false,
          decisions: Object.fromEntries(actions.map((action) => [action, true])),
          id: GUILD_ID,
          managed: false,
          name: "@everyone",
          position: 0,
        }],
        schemaVersion: 1,
        status: "ok",
        summary: Object.fromEntries(actions.map((action) => [action, {
          allowed: 1,
          denied: 0,
          unknown: 0,
        }])),
        unknownPermissionBits: "0",
        warnings: [],
      }
    },
    async deleteMessages(request, planDigest) {
      if (overrides.deletionError) throw overrides.deletionError
      calls.delete += 1
      return {
        activityId: "activity-one",
        channelId: request.channelId,
        deletedMessageIds: [...request.messageIds],
        guildId: GUILD_ID,
        observedAbsentMessageIds: [...request.messageIds],
        operationKeyHash: operationKeyHash(request.operationKey),
        planDigest,
        remainingMessageIds: [],
        schemaVersion: 1,
        status: "completed",
        verifiedAbsent: true,
      }
    },
    describePolicy: fixturePolicy,
    async executeAttachmentMessage(request, planDigest) {
      if (overrides.attachmentError) throw overrides.attachmentError
      calls.attachmentExecute += 1
      const planned = attachmentPlan(request, planDigest)
      return {
        activityId: "activity-attachment",
        attachment: {
          descriptionPresent: request.description !== undefined,
          filename: planned.file.filename,
          sizeBytes: planned.file.sizeBytes,
        },
        channelId: request.channelId,
        guildId: GUILD_ID,
        messageId: MESSAGE_ID,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${MESSAGE_ID}`,
      }
    },
    async executeComponentMessage(request, planDigest) {
      if (overrides.componentMessageError) throw overrides.componentMessageError
      calls.componentMessageExecute += 1
      const writeRequired = overrides.componentMessageWriteRequired ?? true
      const planned = componentMessagePlan(request, planDigest, writeRequired)
      return {
        action: request.action,
        activityId: writeRequired ? "activity-component-message" : null,
        channelId: request.channelId,
        guildId: GUILD_ID,
        messageId: request.messageId ?? MESSAGE_ID,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        schemaVersion: 1,
        status: writeRequired ? "completed" : "already-current",
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId ?? MESSAGE_ID}`,
      }
    },
    async executeChannelCreation(request, planDigest) {
      if (overrides.channelCreationError) throw overrides.channelCreationError
      calls.channelCreationExecute += 1
      const planned = channelPlan(
        request,
        planDigest,
        overrides.channelCreationAction,
      )
      const observed = planned.existingChannel || {
        ...planned.target,
        id: CHANNEL_ID,
      }
      return {
        activityId: planned.action === "none" ? null : "activity-channel-create",
        channelId: observed.id,
        guildId: request.guildId,
        observed,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
      }
    },
    async executeChannelPermissionOverwrite(request, planDigest) {
      if (overrides.permissionOverwriteError) throw overrides.permissionOverwriteError
      calls.permissionOverwriteExecute += 1
      const planned = permissionOverwritePlan(
        request,
        planDigest,
        overrides.permissionOverwriteAction,
      )
      return {
        activityId: planned.action === "none" ? null : "activity-permission-overwrite",
        channelId: request.channelId,
        guildId: GUILD_ID,
        observedOverwrite: planned.desiredOverwrite,
        operationKeyHash: planned.operationKeyHash,
        overwriteSetMatched: true,
        planDigest,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
        targetId: request.targetId,
        targetMatched: true,
        targetType: request.targetType,
      }
    },
    async executeForumPost(request, planDigest) {
      if (overrides.forumPostError) throw overrides.forumPostError
      calls.forumPostExecute += 1
      const planned = forumPostPlan(request, planDigest)
      return {
        activityId: "activity-forum-post",
        driftFields: [],
        guildId: GUILD_ID,
        messageId: MESSAGE_ID,
        operationKeyHash: planned.operationKeyHash,
        parentChannelId: request.channelId,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        threadId: MESSAGE_ID,
        url: `https://discord.com/channels/${GUILD_ID}/${MESSAGE_ID}/${MESSAGE_ID}`,
        verification: "match",
      }
    },
    async executeForumTagChange(request, planDigest) {
      if (overrides.forumTagError) throw overrides.forumTagError
      calls.forumTagExecute += 1
      const planned = forumTagPlan(
        request,
        planDigest,
        overrides.forumTagEffect,
      )
      const tagId = request.action === "create"
        ? planned.target?.id || CREATED_FORUM_TAG_ID
        : request.tagId
      return {
        action: request.action,
        activityId: planned.writeRequired ? "activity-forum-tag" : null,
        channelId: request.channelId,
        guildId: request.guildId,
        observed: forumTagObserved(planned.desiredTags),
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        tagId,
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async executeThreadCreation(request, planDigest) {
      if (overrides.threadCreationError) throw overrides.threadCreationError
      calls.threadCreationExecute += 1
      const planned = threadCreationPlan(
        request,
        planDigest,
        overrides.threadCreationWriteRequired ?? true,
      )
      const threadId = request.sourceMessageId ?? MESSAGE_ID
      return {
        activityId: planned.writeRequired ? "activity-thread-create" : null,
        driftFields: [],
        guildId: GUILD_ID,
        mode: request.mode,
        operationKeyHash: OPERATION_KEY_HASH,
        parentChannelId: request.parentChannelId,
        planDigest,
        readbackMatched: true,
        recoveredFromAmbiguousResponse: false,
        responseMatched: planned.writeRequired ? true : null,
        schemaVersion: 1,
        sourceMessageId: request.sourceMessageId ?? null,
        status: planned.writeRequired ? "completed" : "source-already-threaded",
        threadId,
        url: `https://discord.com/channels/${GUILD_ID}/${threadId}`,
        verification: planned.writeRequired ? "match" : "not-required",
        writeRequired: planned.writeRequired,
      }
    },
    async executeGuildScaffold(request, planDigest) {
      if (overrides.guildScaffoldError) throw overrides.guildScaffoldError
      calls.guildScaffoldExecute += 1
      const planned = guildScaffoldPlan(request, planDigest)
      return {
        applicationId: planned.applicationId,
        botId: planned.botId,
        executedSteps: planned.steps.map((step) => ({
          activityId: `activity-scaffold-${step.index}`,
          index: step.index,
          key: step.key,
          kind: step.kind,
          resourceId: step.kind === "role" ? ROLE_ID : CHANNEL_ID,
          status: "completed" as const,
        })),
        guildId: request.guildId,
        operationKeyHash: planned.operation.operationKeyHash,
        planDigest,
        remaining: { ready: 0, waitingForParent: 0 },
        requestDigest: planned.operation.requestDigest,
        schemaVersion: 1,
        status: "completed" as const,
      }
    },
    async verifyGuildScaffold(request) {
      calls.guildScaffoldVerify += 1
      const planned = guildScaffoldPlan(request)
      return {
        applicationId: planned.applicationId,
        botId: planned.botId,
        checkedAt: planned.createdAt,
        counts: planned.counts,
        evidence: {
          callerRetainedRequestRequired: true as const,
          persistedDiscordContent: false as const,
          source: "live-discord-and-content-free-receipts" as const,
        },
        guildId: request.guildId,
        operation: {
          operationKeyHash: planned.operation.operationKeyHash,
          receiptStatus: planned.operation.status,
          requestDigest: planned.operation.requestDigest,
        },
        planDigest: planned.digest,
        schemaVersion: 1,
        status: "incomplete" as const,
        steps: planned.steps.map((step) => ({
          index: step.index,
          kind: step.kind,
          resourceId: step.existingResourceId,
          state: step.state,
        })),
      }
    },
    async executeMemberModeration(request, planDigest) {
      if (overrides.administrationError) throw overrides.administrationError
      calls.administrationExecute += 1
      return {
        action: request.action,
        activityId: "activity-moderation",
        guildId: request.guildId,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        timeoutUntil: null,
        userId: request.userId,
      }
    },
    async executeMessagePin(request, planDigest) {
      if (overrides.messagePinError) throw overrides.messagePinError
      calls.messagePinExecute += 1
      const planned = messagePinPlan(
        request,
        planDigest,
        overrides.messagePinAction,
      )
      return {
        activityId: planned.action === "none" ? null : "activity-message-pin",
        channelId: request.channelId,
        guildId: GUILD_ID,
        messageSnapshotMatched: true,
        messageId: request.messageId,
        observedPinned: request.desiredState === "pinned",
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId}`,
      }
    },
    async executeReactionModeration(request, planDigest) {
      if (overrides.reactionModerationError) {
        throw overrides.reactionModerationError
      }
      calls.reactionModerationExecute += 1
      const planned = reactionModerationPlan(request, planDigest)
      return {
        activityId: planned.writeRequired ? "activity-reaction-moderation" : null,
        channelId: request.channelId,
        exactSnapshotMatched: true,
        guildId: GUILD_ID,
        messageId: request.messageId,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-absent",
        targetAbsent: true,
        url: planned.message.url,
      }
    },
    async executeAnnouncementCrosspost(request, planDigest) {
      if (overrides.announcementCrosspostError) {
        throw overrides.announcementCrosspostError
      }
      calls.announcementCrosspostExecute += 1
      const planned = announcementCrosspostPlan(
        request,
        planDigest,
        overrides.announcementCrosspostAction,
      )
      return {
        activityId: planned.action === "none"
          ? null
          : "activity-announcement-crosspost",
        channelId: request.channelId,
        guildId: GUILD_ID,
        messageId: request.messageId,
        observedCrossposted: true,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        readbackSnapshotMatched: true,
        responseSnapshotMatched: true,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-crossposted" : "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId}`,
      }
    },
    async executeAnnouncementSubscription(request, planDigest) {
      if (overrides.announcementSubscriptionError) {
        throw overrides.announcementSubscriptionError
      }
      calls.announcementSubscriptionExecute += 1
      const writeRequired = overrides.announcementSubscriptionWriteRequired ?? true
      const planned = announcementSubscriptionPlan(
        request,
        planDigest,
        writeRequired,
      )
      return {
        action: request.action,
        activityId: writeRequired ? "activity-announcement-subscription" : null,
        inventoryMatched: true,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        readbackMatched: true,
        responseMatched: request.action === "subscribe" ? true : null,
        schemaVersion: 1,
        sourceChannelId: planned.current?.sourceChannelId
          ?? planned.source?.channel.id
          ?? null,
        sourceGuildId: planned.current?.sourceGuildId
          ?? planned.source?.guild.id
          ?? null,
        status: writeRequired ? "completed" : "already-current",
        targetChannelId: request.targetChannelId,
        targetGuildId: GUILD_ID,
        verifiedAbsent: request.action === "unsubscribe",
        webhookId: request.action === "unsubscribe"
          ? request.webhookId
          : ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
      }
    },
    async executePollCreation(request, planDigest) {
      if (overrides.pollCreationError) throw overrides.pollCreationError
      calls.pollCreationExecute += 1
      return {
        activityId: "activity-poll-create",
        channelId: request.channelId,
        expiryMatched: true,
        guildId: GUILD_ID,
        messageId: MESSAGE_ID,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${MESSAGE_ID}`,
        verification: "match",
      }
    },
    async executePollEnd(request, planDigest) {
      if (overrides.pollEndError) throw overrides.pollEndError
      calls.pollEndExecute += 1
      const writeRequired = overrides.pollEndWriteRequired ?? true
      return {
        activityId: writeRequired ? "activity-poll-end" : null,
        channelId: request.channelId,
        finalization: writeRequired ? "final" : "not-required",
        guildId: GUILD_ID,
        messageId: request.messageId,
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        schemaVersion: 1,
        status: writeRequired ? "completed" : "already-ended",
        url: `https://discord.com/channels/${GUILD_ID}/${request.channelId}/${request.messageId}`,
        verification: writeRequired ? "match" : "not-required",
      }
    },
    async executeMemberRoleChange(request, planDigest) {
      if (overrides.memberRoleError) throw overrides.memberRoleError
      calls.memberRoleExecute += 1
      const planned = memberRolePlan(
        request,
        planDigest,
        overrides.memberRoleAction,
      )
      const rolePresent = request.action === "add"
      return {
        action: request.action,
        activityId: planned.action === "none" ? null : "activity-member-role",
        guildId: request.guildId,
        observedRoleIds: rolePresent ? [request.roleId] : [],
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        roleId: request.roleId,
        rolePresent,
        roleSnapshotMatched: true,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
        userId: request.userId,
      }
    },
    async executeMemberVoiceChange(request, planDigest) {
      if (overrides.memberVoiceError) throw overrides.memberVoiceError
      calls.memberVoiceExecute += 1
      const writeRequired = overrides.memberVoiceWriteRequired ?? true
      const planned = memberVoicePlan(request, planDigest, writeRequired)
      const observedChannel = request.action === "disconnect"
        ? null
        : request.action === "move"
          ? planned.destination
          : planned.state.channel
      return {
        action: request.action,
        activityId: writeRequired ? "activity-member-voice" : null,
        guildId: request.guildId,
        observed: {
          channel: observedChannel,
          connected: observedChannel !== null,
          serverDeafened: request.action === "set-server-deafen"
            ? request.enabled
            : observedChannel ? planned.state.serverDeafened : null,
          serverMuted: request.action === "set-server-mute"
            ? request.enabled
            : observedChannel ? planned.state.serverMuted : null,
          unknownFieldCount: 0,
          userId: request.userId,
        },
        operationKeyHash: OPERATION_KEY_HASH,
        planDigest,
        schemaVersion: 1,
        status: writeRequired ? "completed" : "already-current",
        userId: request.userId,
        verification: writeRequired ? "match" : "not-required",
      }
    },
    async executeRoleCreation(request, planDigest) {
      if (overrides.roleCreationError) throw overrides.roleCreationError
      calls.roleCreationExecute += 1
      const planned = rolePlan(
        request,
        planDigest,
        overrides.roleCreationAction,
      )
      const observed = planned.existingRole || normalizedCreatedRole(request)
      return {
        activityId: planned.action === "none" ? null : "activity-role-create",
        guildId: request.guildId,
        observed,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        roleId: observed.id,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
      }
    },
    async executeRoleConfiguration(request, planDigest) {
      if (overrides.roleConfigurationError) throw overrides.roleConfigurationError
      calls.roleConfigurationExecute += 1
      const planned = roleConfigurationPlan(
        request,
        planDigest,
        overrides.roleConfigurationEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-role-configuration" : null,
        guildId: request.guildId,
        inventoryMatched: true,
        memberCount: planned.memberCount,
        memberCountsMatched: true,
        observed: planned.desired,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        roleId: request.roleId,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async executeRoleOrder(request, planDigest) {
      if (overrides.roleOrderingError) throw overrides.roleOrderingError
      calls.roleOrderingExecute += 1
      const planned = roleOrderingPlan(
        request,
        planDigest,
        overrides.roleOrderingEffect,
      )
      return {
        activityId: planned.writeRequired ? "activity-role-ordering" : null,
        anchorRoleId: request.anchorRoleId,
        memberCountsMatched: true,
        observedAffectedRoles: planned.affectedRoles.map(({ afterRank, ...entry }) => ({
          ...entry,
          rank: afterRank,
        })),
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        roleId: request.roleId,
        schemaVersion: 1,
        status: planned.writeRequired ? "completed" : "already-current",
        verification: planned.writeRequired ? "match" : "not-required",
      }
    },
    async explainChannelAccess(channelId) {
      calls.explain += 1
      const discordChannel = rawChannel({ id: channelId })
      return {
        botId: "600000000000000001",
        channel: normalizeChannel(discordChannel),
        guildId: GUILD_ID,
        permissions: evaluateBotChannelPermissions({
          botId: "600000000000000001",
          channel: discordChannel,
          guildId: GUILD_ID,
          member: { roles: [] },
          permissionChannel: discordChannel,
          roles: [{
            id: GUILD_ID,
            managed: false,
            name: "@everyone",
            permissions: (
              DISCORD_PERMISSIONS.VIEW_CHANNEL
              | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            ).toString(),
            position: 0,
          }],
        }),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async explainPrincipalPermissions(input) {
      calls.principalExplain += 1
      const subjectId = input.subjectKind === "connector"
        ? "600000000000000001"
        : input.subjectId as string
      return {
        channel: input.channelId
          ? normalizeChannel(rawChannel({ id: input.channelId }))
          : null,
        guildId: input.guildId,
        permissions: {
          action: input.action ?? null,
          administrator: false,
          allowed: true,
          appliedRoleIds: [GUILD_ID],
          basePermissions: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
          confidence: "complete",
          decisionTrace: [],
          effectivePermissionNames: ["VIEW_CHANNEL", "CONNECT"],
          effectivePermissions: (
            DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.CONNECT
          ).toString(),
          guildOwner: false,
          hierarchy: {
            actorHighestRoleIds: [],
            actorHighestRolePosition: null,
            allowed: null,
            reason: "No hierarchy action was requested",
            status: "not-applicable",
            targetHighestRoleIds: [],
            targetHighestRolePosition: null,
          },
          ignoredMemberOverwriteCount: 0,
          implicitDenies: [],
          ineffectivePermissions: [],
          memberOverwriteCount: 0,
          missingPermissions: [],
          permissionSourceChannelId: input.channelId ?? null,
          privateThreadAccess: "not-applicable",
          requestedPermissions: [...(input.requestedPermissions || [])],
          subjectId,
          subjectKind: input.subjectKind,
          subjectTimedOut: false,
          unknownPermissionBits: "0",
          warnings: [],
        },
        schemaVersion: 1,
        status: "ok",
        target: input.targetRoleId
          ? { id: input.targetRoleId, kind: "role" }
          : input.targetUserId
            ? { id: input.targetUserId, kind: "member" }
            : null,
      }
    },
    async editOwnMessage(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.edit += 1
      return {
        activityId: "activity-edit",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async getMessage() {
      return {
        channel: normalizeChannel(rawChannel()),
        guildId: GUILD_ID,
        message: normalizeMessage(rawMessage(overrides.messageContent), GUILD_ID),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getPoll(channelId, messageId) {
      calls.pollGet += 1
      return pollRead(channelId, messageId)
    },
    async getGuildAuditEntry(guildId, entryId, options) {
      return {
        entry: {
          actionName: "MEMBER_BAN_ADD",
          actionType: 22,
          actorUserId: USER_ID,
          changeCount: 1,
          changeKeys: ["reason"],
          createdAt: "2026-08-20T00:00:00.000Z",
          hasReason: true,
          id: entryId,
          optionKeys: [],
          redactedChangeKeyCount: 0,
          redactedOptionKeyCount: 0,
          targetId: USER_ID,
          targetIdentifierRedacted: false,
          ...(options?.includeReason ? { reason: AUDIT_REASON } : {}),
        },
        found: true,
        guildId,
        privacy: {
          changeValues: "omitted",
          embeddedObjects: "omitted",
          nonSnowflakeTargets: "redacted",
          optionValues: "omitted",
          persistence: "none",
          reasons: options?.includeReason ? "included" : "omitted",
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getGuildMember(guildId, userId) {
      calls.memberGet += 1
      return {
        guildId,
        member: {
          bot: false,
          globalName: "Member",
          joinedAt: "2026-08-20T00:00:00.000Z",
          nickname: "reviewer",
          pending: false,
          roleIds: [ROLE_ID],
          timeoutUntil: null,
          userId,
          username: "member",
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getMemberVoiceState(guildId, userId) {
      calls.memberVoiceGet += 1
      return {
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
        guild: { id: guildId, name: "Private guild name", ownerId: GUILD_OWNER_ID },
        member: { id: userId, username: "untrusted-member-name" },
        permission: {
          administrator: false,
          allowed: true,
          appliedRoleIds: [guildId, ROLE_ID],
          effectivePermissionNames: ["VIEW_CHANNEL", "CONNECT"],
          effectivePermissions: (
            DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.CONNECT
          ).toString(),
          guildOwner: false,
          requiredPermissions: ["VIEW_CHANNEL", "CONNECT"],
          unknownPermissionBits: "0",
          warnings: [],
        },
        privacy: {
          enumeration: "none",
          omittedFields: ["session ID"],
          persistence: "content-free-outcomes-only",
          rawPayloadExposed: false,
        },
        schemaVersion: 1,
        state: {
          channel: {
            guildId,
            id: CHANNEL_ID,
            name: "untrusted-source-name",
            type: "voice",
          },
          connected: true,
          serverDeafened: false,
          serverMuted: false,
          unknownFieldCount: 0,
          userId,
        },
        status: "ok",
        warnings: ["No occupant enumeration"],
      }
    },
    async getGuildBan(guildId, userId, options) {
      calls.banGet += 1
      return {
        access: {
          banMembers: true as const,
          botAdministrator: false,
          botIsGuildOwner: false,
          complete: true as const,
          requiredPermission: "BAN_MEMBERS" as const,
        },
        applicationId: APPLICATION_ID,
        ban: {
          bot: false,
          globalName: "Banned member",
          hasReason: true,
          ...(options?.includeReason ? { reason: "Private reason" } : {}),
          userId,
          username: "banned-member",
        },
        botId: BOT_ID,
        found: true as const,
        guildId,
        privacy: {
          caches: "none" as const,
          persistence: "none" as const,
          profiles: "minimized" as const,
          rawPayloads: "omitted" as const,
          reasons: options?.includeReason ? "included" as const : "omitted" as const,
        },
        schemaVersion: 1,
        status: "ok" as const,
      }
    },
    async getRole(guildId) {
      calls.getRole += 1
      return {
        guildId,
        role: normalizedCreatedRole({
          auditReason: AUDIT_REASON,
          guildId,
          name: "reviewer",
          operationKey: OPERATION_KEY,
          permissions: ["VIEW_CHANNEL"],
        }),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getStatus() {
      return {
        application: {
          guildMembersIntent: "enabled" as const,
          id: "500000000000000001",
          messageContentIntent: "enabled" as const,
          name: "Connector",
        },
        auditFile: "/memory/activity.jsonl",
        bot: { id: "600000000000000001", username: "bot" },
        guildPage: { accessible: 1, inScope: 1 },
        policy: fixturePolicy(),
        schemaVersion: 1,
        status: "ok",
        writeCoordination: {
          coverage: "receipt-backed-reviewed-writes",
          excludedWorkflows: [
            "legacy-member-moderation",
            "ordinary-message-interactions",
          ],
          localFilesystemRequired: true,
          mode: "durable-exact-target",
          resumableWorkflows: ["guild-scaffold"],
          sharedStateRootRequired: true,
        },
      }
    },
    async listActivity() {
      if (overrides.activityError) throw overrides.activityError
      return {
        entries: [],
        file: "/memory/activity.jsonl",
        skippedLines: 0,
      }
    },
    async listActiveThreads(guildId, options) {
      calls.active += 1
      return {
        guildId,
        page: {
          requestedLimit: options?.limit ?? 50,
          returned: 0,
          totalVisible: 0,
          truncated: false,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
      }
    },
    async listArchivedThreads(channelId, options) {
      calls.archived += 1
      const visibility = options?.visibility ?? "public"
      return {
        channel: normalizeChannel(rawChannel({ id: channelId })),
        guildId: GUILD_ID,
        page: {
          hasMore: false,
          nextCursor: null,
          requestedLimit: options?.limit ?? null,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
        visibility,
      }
    },
    async listChannels(guildId) {
      return {
        channels: [],
        guildId,
        inventory: {
          completeness: "visibility-bounded" as const,
          returned: 0,
          scope: "configured-policy-and-discord-visibility" as const,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listChannelPermissionOverwrites(channelId, options) {
      calls.permissionOverwriteList += 1
      return {
        inherited: false,
        overwrites: [{
          allow: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
          allowPermissions: ["VIEW_CHANNEL"],
          deny: "0",
          denyPermissions: [],
          targetId: ROLE_ID,
          targetType: "role",
          unknownAllow: "0",
          unknownDeny: "0",
        }],
        page: {
          hasMore: false,
          nextAfterTargetId: null,
          requestedLimit: options?.limit ?? 50,
          returned: 1,
          total: 1,
        },
        requestedChannel: normalizeChannel(rawChannel({ id: channelId })),
        schemaVersion: 1,
        sourceChannel: normalizeChannel(rawChannel({ id: channelId })),
        status: "ok",
      }
    },
    async listGuilds() {
      return {
        guilds: [],
        page: {
          after: null,
          before: null,
          requestedLimit: 200,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuildAuditEntries(guildId, options) {
      const includeReasons = options?.includeReasons ?? false
      return {
        entries: [{
          actionName: "MEMBER_BAN_ADD",
          actionType: 22,
          actorUserId: USER_ID,
          changeCount: 1,
          changeKeys: ["reason"],
          createdAt: "2026-08-20T00:00:00.000Z",
          hasReason: true,
          id: AUDIT_ENTRY_ID,
          optionKeys: [],
          redactedChangeKeyCount: 0,
          redactedOptionKeyCount: 0,
          targetId: USER_ID,
          targetIdentifierRedacted: false,
          ...(includeReasons ? { reason: AUDIT_REASON } : {}),
        }],
        guildId,
        page: {
          beforeEntryId: options?.beforeEntryId ?? null,
          hasMore: false,
          nextBeforeEntryId: null,
          requestedLimit: options?.limit ?? 25,
          returned: 1,
        },
        privacy: {
          changeValues: "omitted",
          embeddedObjects: "omitted",
          nonSnowflakeTargets: "redacted",
          optionValues: "omitted",
          persistence: "none",
          reasons: includeReasons ? "included" : "omitted",
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuildMembers(guildId, options) {
      calls.memberList += 1
      return {
        guildId,
        members: [],
        page: {
          afterUserId: options?.afterUserId ?? null,
          exhausted: true,
          nextAfterUserId: null,
          requestedLimit: options?.limit ?? 25,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuildBans(guildId, options) {
      calls.banList += 1
      return {
        access: {
          banMembers: true as const,
          botAdministrator: false,
          botIsGuildOwner: false,
          complete: true as const,
          requiredPermission: "BAN_MEMBERS" as const,
        },
        applicationId: APPLICATION_ID,
        bans: [{
          bot: false,
          globalName: "Banned member",
          hasReason: true,
          ...(options?.includeReasons ? { reason: "Private reason" } : {}),
          userId: USER_ID,
          username: "banned-member",
        }],
        botId: BOT_ID,
        guildId,
        page: {
          afterUserId: options?.afterUserId ?? null,
          hasMore: false,
          nextAfterUserId: null,
          requestedLimit: options?.limit ?? 25,
          returned: 1,
        },
        privacy: {
          caches: "none" as const,
          persistence: "none" as const,
          profiles: "minimized" as const,
          rawPayloads: "omitted" as const,
          reasons: options?.includeReasons ? "included" as const : "omitted" as const,
        },
        schemaVersion: 1,
        status: "ok" as const,
      }
    },
    async listMessagePins(channelId, options) {
      calls.messagePinList += 1
      return {
        channel: normalizeChannel(rawChannel({ id: channelId })),
        guildId: GUILD_ID,
        page: {
          hasMore: false,
          nextCursor: null,
          requestedLimit: options?.limit ?? 50,
          returned: 1,
        },
        pins: [{
          message: normalizeMessage({ ...rawMessage("pinned"), pinned: true }),
          pinnedAt: "2026-08-20T00:00:00.000Z",
        }],
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listMessageReactions(channelId, messageId) {
      calls.reactions += 1
      return {
        channel: { id: channelId, parentId: null, type: 0 },
        guildId: GUILD_ID,
        message: {
          id: messageId,
          timestamp: "2026-08-22T00:00:00.000Z",
          type: 0,
          url: `https://discord.com/channels/${GUILD_ID}/${channelId}/${messageId}`,
        },
        privacy: {
          omittedFields: [
            "attachments",
            "author",
            "burstColors",
            "components",
            "content",
            "embeds",
            "memberProfiles",
            "rawPayloads",
            "userAvatars",
            "userGlobalNames",
            "userNames",
          ],
          persistence: "none",
          profilesProjectedOut: true,
          rawPayloads: "omitted",
        },
        reactions: [{
          burstCount: 1,
          count: 3,
          emoji: {
            animated: false,
            id: USER_ID,
            kind: "custom",
            name: "party",
            routeToken: `party:${USER_ID}`,
          },
          me: true,
          meBurst: false,
          normalCount: 2,
        }],
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listReactionUsers(channelId, messageId, emoji, options) {
      calls.reactionUsers += 1
      const custom = emoji.match(/^([^:]+):([0-9]+)$/)
      return {
        channelId,
        emoji: custom
          ? {
              animated: false,
              id: custom[2] as string,
              kind: "custom",
              name: custom[1] as string,
              routeToken: emoji,
            }
          : {
              animated: false,
              id: null,
              kind: "unicode",
              name: emoji,
              routeToken: emoji,
            },
        guildId: GUILD_ID,
        messageId,
        page: {
          nextAfter: null,
          requestedAfter: options?.after ?? null,
          requestedLimit: options?.limit ?? 25,
          returned: 1,
        },
        privacy: {
          omittedFields: [
            "attachments",
            "author",
            "burstColors",
            "components",
            "content",
            "embeds",
            "memberProfiles",
            "rawPayloads",
            "userAvatars",
            "userGlobalNames",
            "userNames",
          ],
          persistence: "none",
          profilesProjectedOut: true,
          rawPayloads: "omitted",
        },
        reactionType: options?.type === 1 ? "burst" : "normal",
        schemaVersion: 1,
        status: "ok",
        users: [{ bot: false, id: USER_ID }],
      }
    },
    async listPollAnswerVoters(channelId, messageId, answerId, options) {
      calls.pollVoters += 1
      return {
        answerId,
        channelId,
        guildId: GUILD_ID,
        messageId,
        page: {
          after: options?.after ?? null,
          nextAfter: null,
          requestedLimit: options?.limit ?? 25,
          returned: 1,
        },
        privacy: {
          persistence: "none",
          profileFields: "omitted",
        },
        schemaVersion: 1,
        status: "ok",
        voterUserIds: [USER_ID],
      }
    },
    async listRoles(guildId) {
      calls.listRoles += 1
      return {
        guildId,
        page: { documentedLimit: 250, returned: 1 },
        roles: [normalizedCreatedRole({
          auditReason: AUDIT_REASON,
          guildId,
          name: "reviewer",
          operationKey: OPERATION_KEY,
          permissions: ["VIEW_CHANNEL"],
        })],
        schemaVersion: 1,
        status: "ok",
      }
    },
    async planMessageDeletion(request) {
      calls.plan += 1
      return plan(overrides.planDigest, request)
    },
    async planAttachmentMessage(request) {
      calls.attachmentPlan += 1
      return attachmentPlan(
        request,
        overrides.attachmentPlanDigest || DIGEST,
      )
    },
    async planComponentMessage(request) {
      calls.componentMessagePlan += 1
      return componentMessagePlan(
        request,
        overrides.componentMessagePlanDigest || DIGEST,
        overrides.componentMessageWriteRequired ?? true,
      )
    },
    previewComponentLayout(components, notifyUserIds) {
      calls.componentMessagePreview += 1
      return reviewComponentLayout(components, notifyUserIds)
    },
    async planChannelCreation(request) {
      calls.channelCreationPlan += 1
      return channelPlan(
        request,
        overrides.channelCreationPlanDigest || DIGEST,
        overrides.channelCreationAction,
      )
    },
    async planChannelPermissionOverwrite(request) {
      calls.permissionOverwritePlan += 1
      return permissionOverwritePlan(
        request,
        overrides.permissionOverwritePlanDigest || DIGEST,
        overrides.permissionOverwriteAction,
      )
    },
    async planForumPost(request) {
      calls.forumPostPlan += 1
      return forumPostPlan(
        request,
        overrides.forumPostPlanDigest || DIGEST,
      )
    },
    async planForumTagChange(request) {
      calls.forumTagPlan += 1
      return forumTagPlan(
        request,
        overrides.forumTagPlanDigest || DIGEST,
        overrides.forumTagEffect,
      )
    },
    async planThreadCreation(request) {
      calls.threadCreationPlan += 1
      return threadCreationPlan(
        request,
        overrides.threadCreationPlanDigest || DIGEST,
        overrides.threadCreationWriteRequired ?? true,
      )
    },
    async planGuildScaffold(request) {
      calls.guildScaffoldPlan += 1
      return guildScaffoldPlan(
        request,
        overrides.guildScaffoldPlanDigest || DIGEST,
      )
    },
    async planMemberModeration() {
      calls.administrationPlan += 1
      return moderationPlan(overrides.planDigest || DIGEST)
    },
    async planMemberRoleChange(request) {
      calls.memberRolePlan += 1
      return memberRolePlan(
        request,
        overrides.memberRolePlanDigest || DIGEST,
        overrides.memberRoleAction,
      )
    },
    async planMemberVoiceChange(request) {
      calls.memberVoicePlan += 1
      return memberVoicePlan(
        request,
        overrides.memberVoicePlanDigest || DIGEST,
        overrides.memberVoiceWriteRequired ?? true,
      )
    },
    async planMessagePin(request) {
      calls.messagePinPlan += 1
      return messagePinPlan(
        request,
        overrides.messagePinPlanDigest || DIGEST,
        overrides.messagePinAction,
      )
    },
    async planReactionModeration(request) {
      calls.reactionModerationPlan += 1
      return reactionModerationPlan(
        request,
        overrides.reactionModerationPlanDigest || DIGEST,
      )
    },
    async planAnnouncementCrosspost(request) {
      calls.announcementCrosspostPlan += 1
      return announcementCrosspostPlan(
        request,
        overrides.announcementCrosspostPlanDigest || DIGEST,
        overrides.announcementCrosspostAction,
      )
    },
    async planAnnouncementSubscription(request) {
      calls.announcementSubscriptionPlan += 1
      return announcementSubscriptionPlan(
        request,
        overrides.announcementSubscriptionPlanDigest || DIGEST,
        overrides.announcementSubscriptionWriteRequired ?? true,
      )
    },
    async planNativeInteractionCommand(request) {
      nativeInteractionCommandCalls.plan += 1
      return nativeInteractionCommandPlan(
        request,
        overrides.nativeInteractionCommandPlanDigest || DIGEST,
        overrides.nativeInteractionCommandMutation,
      )
    },
    async planPollCreation(request) {
      calls.pollCreationPlan += 1
      return pollCreationPlan(
        request,
        overrides.pollCreationPlanDigest || DIGEST,
      )
    },
    async planPollEnd(request) {
      calls.pollEndPlan += 1
      return pollEndPlan(
        request,
        overrides.pollEndPlanDigest || DIGEST,
        overrides.pollEndWriteRequired ?? true,
      )
    },
    async planRoleCreation(request) {
      calls.roleCreationPlan += 1
      return rolePlan(
        request,
        overrides.roleCreationPlanDigest || DIGEST,
        overrides.roleCreationAction,
      )
    },
    async planRoleConfiguration(request) {
      calls.roleConfigurationPlan += 1
      return roleConfigurationPlan(
        request,
        overrides.roleConfigurationPlanDigest || DIGEST,
        overrides.roleConfigurationEffect,
      )
    },
    async planRoleOrder(request) {
      calls.roleOrderingPlan += 1
      return roleOrderingPlan(
        request,
        overrides.roleOrderingPlanDigest || DIGEST,
        overrides.roleOrderingEffect,
      )
    },
    async planChannelClone(request) {
      calls.channelClonePlan += 1
      return channelClonePlan(
        request,
        overrides.channelClonePlanDigest || DIGEST,
      )
    },
    async planChannelOrder(request) {
      calls.channelOrderingPlan += 1
      return channelOrderingPlan(
        request,
        overrides.channelOrderingPlanDigest || DIGEST,
        overrides.channelOrderingEffect,
      )
    },
    async readMessages() {
      return {
        channel: normalizeChannel(rawChannel()),
        guildId: GUILD_ID,
        messages: [],
        page: {
          after: null,
          around: null,
          before: null,
          requestedLimit: 50,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async searchMessages(guildId, options) {
      calls.search += 1
      return {
        documentsIndexed: null,
        doingDeepHistoricalIndex: false,
        guildId,
        messages: [],
        page: {
          nextOffset: null,
          offset: options?.offset ?? 0,
          requestedLimit: options?.limit ?? 25,
          returned: 0,
          totalResultsEstimate: 0,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
      }
    },
    async searchGuildMembers(guildId, options) {
      calls.memberSearch += 1
      return {
        guildId,
        match: "username-or-nickname-prefix",
        members: [],
        page: {
          requestedLimit: options.limit ?? 10,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async sendMessage(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.send += 1
      return {
        activityId: "activity-send",
        channelId: input.channelId,
        guildId: GUILD_ID,
        localReplay: false,
        messageId: MESSAGE_ID,
        nonce: "stable-nonce",
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${MESSAGE_ID}`,
      }
    },
  }
  return {
    calls,
    nativeInteractionCommandCalls,
    service,
    welcomeScreenCalls,
    widgetSettingsCalls,
    guildSettingsCalls,
  }
}

async function connectedFixture(
  context: TestContext,
  options: {
    elicitationHandler?: (request: {
      params: {
        message: string
        requestedSchema: {
          properties: Record<string, unknown>
          required?: string[]
        }
      }
    }) => Promise<{
      action: "accept" | "cancel" | "decline"
      content?: { approve: boolean }
    }>
    environment?: NodeJS.ProcessEnv
    listChanged?: ClientOptions["listChanged"]
    serverMessages?: unknown[]
    serviceOverrides?: Parameters<typeof serviceFixture>[0]
    gateway?: GatewayEventSource
    nativeInteractions?: NativeInteractionSource
  } = {},
) {
  const serviceData = serviceFixture(options.serviceOverrides)
  const server = createDiscordMcpServer({
    environment: {
      DISCORD_BOT_TOKEN: TOKEN,
      ...options.environment,
    },
    ...(options.gateway ? { gateway: options.gateway } : {}),
    ...(options.nativeInteractions
      ? { nativeInteractions: options.nativeInteractions }
      : {}),
    requestStateKey: new Uint8Array(32).fill(9),
    service: serviceData.service,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  if (options.serverMessages) {
    const send = serverTransport.send.bind(serverTransport)
    serverTransport.send = async (message, sendOptions) => {
      options.serverMessages?.push(structuredClone(message))
      await send(message, sendOptions)
    }
  }
  await server.connect(serverTransport)
  const client = new Client(
    { name: "discord-mcp-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      ...(options.listChanged ? { listChanged: options.listChanged } : {}),
    },
  )
  if (options.elicitationHandler) {
    client.setRequestHandler(
      "elicitation/create",
      options.elicitationHandler as never,
    )
  }
  await client.connect(clientTransport)
  context.after(async () => {
    try {
      await client.close()
    } catch {}
    try {
      await server.close()
    } catch {}
  })
  return {
    client,
    ...serviceData,
  }
}

function inProcessStdioClientTransport(
  serverInput: PassThrough,
  serverOutput: PassThrough,
): Transport {
  const readBuffer = new ReadBuffer()
  let closed = false
  const transport: Transport = {
    async close() {
      if (closed) return
      closed = true
      serverOutput.off("data", onData)
      serverOutput.off("end", onClose)
      serverOutput.off("error", onError)
      serverInput.end()
      readBuffer.clear()
      transport.onclose?.()
    },
    async send(message: JSONRPCMessage) {
      if (closed) throw new Error("In-process stdio transport is closed")
      serverInput.write(serializeMessage(message))
    },
    async start() {
      serverOutput.on("data", onData)
      serverOutput.on("end", onClose)
      serverOutput.on("error", onError)
    },
  }

  function onClose() {
    if (closed) return
    closed = true
    readBuffer.clear()
    transport.onclose?.()
  }

  function onData(chunk: Buffer) {
    try {
      readBuffer.append(chunk)
      while (true) {
        const message = readBuffer.readMessage()
        if (message === null) return
        transport.onmessage?.(message)
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  function onError(error: Error) {
    transport.onerror?.(error)
  }

  return transport
}

async function connectedModernStdioFixture(
  context: TestContext,
  serviceOverrides?: Parameters<typeof serviceFixture>[0],
) {
  const serviceData = serviceFixture(serviceOverrides)
  const serverInput = new PassThrough()
  const serverOutput = new PassThrough()
  const handle = runDiscordMcpServer({
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    observability: new OperationalTelemetry({
      config: loadObservabilityConfig({}, [TOKEN]),
    }),
    requestStateKey: new Uint8Array(32).fill(9),
    service: serviceData.service,
    stderr: { write: () => true },
    stdin: serverInput,
    stdout: serverOutput,
  })
  const client = new Client(
    { name: "discord-mcp-modern-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    try {
      await client.close()
    } catch {}
    try {
      await handle.close()
    } catch {}
  })
  await client.connect(inProcessStdioClientTransport(serverInput, serverOutput))
  return { client, ...serviceData }
}

function structuredContent(result: { structuredContent?: unknown }): Record<string, unknown> {
  assert.ok(result.structuredContent)
  return result.structuredContent as Record<string, unknown>
}

function listedTool(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((entry) => entry.name === name)
  assert.ok(tool, `Expected MCP tool ${name}`)
  return tool
}

async function settleNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test("MCP server advertises bounded tools with accurate write annotations", async (context) => {
  const { client } = await connectedFixture(context)

  const result = await client.listTools()

  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    [
      "get_connector_status",
      "get_observability_status",
      "get_gateway_status",
      "get_gateway_events",
      "list_pending_discord_interactions",
      "respond_to_discord_interaction",
      "list_guilds",
      "list_channels",
      "get_channel",
      "audit_forum_tags",
      "list_roles",
      "audit_role_order",
      "audit_channel_order",
      "get_role",
      "get_guild_member",
      "get_member_voice_state",
      "get_thread_state",
      "get_thread_membership",
      "list_guild_members",
      "search_guild_members",
      "list_guild_bans",
      "get_guild_ban",
      "list_guild_invites",
      "get_guild_invite",
      "list_guild_templates",
      "get_guild_onboarding",
      "get_guild_welcome_screen",
      "get_guild_widget_settings",
      "get_guild_settings",
      "list_guild_audit_entries",
      "get_guild_audit_entry",
      "list_active_threads",
      "list_archived_threads",
      "explain_channel_access",
      "explain_principal_permissions",
      "audit_channel_role_access",
      "read_messages",
      "search_messages",
      "get_message",
      "list_message_reactions",
      "list_reaction_users",
      "get_poll",
      "list_poll_answer_voters",
      "list_message_pins",
      "list_channel_webhooks",
      "list_guild_integrations",
      "get_channel_webhook",
      "list_guild_emojis",
      "get_guild_emoji",
      "list_guild_stickers",
      "get_guild_sticker",
      "list_default_soundboard_sounds",
      "list_guild_soundboard_sounds",
      "get_guild_soundboard_sound",
      "list_automod_rules",
      "get_automod_rule",
      "list_scheduled_events",
      "get_scheduled_event",
      "list_stage_instances",
      "get_stage_instance",
      "list_channel_permission_overwrites",
      "send_message",
      "edit_own_message",
      "add_reaction",
      "remove_own_reaction",
      "plan_reaction_moderation",
      "execute_reaction_moderation",
      "plan_poll_creation",
      "execute_poll_creation",
      "plan_poll_end",
      "execute_poll_end",
      "plan_message_deletion",
      "delete_messages",
      "plan_message_pin",
      "execute_message_pin",
      "plan_announcement_crosspost",
      "execute_announcement_crosspost",
      "list_announcement_subscriptions",
      "plan_announcement_subscription",
      "execute_announcement_subscription",
      "plan_native_interaction_command",
      "execute_native_interaction_command",
      "plan_guild_template_change",
      "execute_guild_template_change",
      "plan_webhook_creation",
      "execute_webhook_creation",
      "plan_webhook_change",
      "execute_webhook_change",
      "plan_webhook_deletion",
      "execute_webhook_deletion",
      "plan_guild_integration_deletion",
      "execute_guild_integration_deletion",
      "plan_invite_deletion",
      "execute_invite_deletion",
      "plan_onboarding_change",
      "execute_onboarding_change",
      "plan_guild_welcome_screen_change",
      "execute_guild_welcome_screen_change",
      "plan_guild_widget_settings_change",
      "execute_guild_widget_settings_change",
      "plan_guild_settings_change",
      "execute_guild_settings_change",
      "plan_guild_expression_change",
      "execute_guild_expression_change",
      "plan_guild_soundboard_change",
      "execute_guild_soundboard_change",
      "plan_automod_change",
      "execute_automod_change",
      "plan_scheduled_event_change",
      "execute_scheduled_event_change",
      "plan_stage_instance_change",
      "execute_stage_instance_change",
      "plan_channel_metadata_change",
      "execute_channel_metadata_change",
      "plan_forum_tag_change",
      "execute_forum_tag_change",
      "plan_channel_permission_overwrite",
      "execute_channel_permission_overwrite",
      "plan_channel_creation",
      "execute_channel_creation",
      "plan_forum_post",
      "execute_forum_post",
      "plan_thread_creation",
      "execute_thread_creation",
      "preview_component_layout",
      "plan_component_message",
      "execute_component_message",
      "plan_attachment_message",
      "execute_attachment_message",
      "plan_guild_scaffold",
      "execute_guild_scaffold",
      "verify_guild_scaffold",
      "plan_member_role_change",
      "execute_member_role_change",
      "plan_member_voice_change",
      "execute_member_voice_change",
      "plan_thread_change",
      "execute_thread_change",
      "plan_role_creation",
      "execute_role_creation",
      "plan_role_configuration",
      "execute_role_configuration",
      "plan_role_order",
      "execute_role_order",
      "plan_channel_clone",
      "execute_channel_clone",
      "plan_channel_order",
      "execute_channel_order",
      "plan_member_moderation",
      "execute_member_moderation",
      "list_activity",
      "discover_discord_tools",
    ],
  )
  const deletion = result.tools.find((tool) => tool.name === "delete_messages")
  const messagePin = result.tools.find((tool) => tool.name === "execute_message_pin")
  const reactionModeration = result.tools.find((tool) => (
    tool.name === "execute_reaction_moderation"
  ))
  const removeOwnReaction = result.tools.find((tool) => (
    tool.name === "remove_own_reaction"
  ))
  const announcementCrosspost = result.tools.find((tool) => (
    tool.name === "execute_announcement_crosspost"
  ))
  const announcementSubscription = result.tools.find((tool) => (
    tool.name === "execute_announcement_subscription"
  ))
  const nativeInteractionCommand = result.tools.find((tool) => (
    tool.name === "execute_native_interaction_command"
  ))
  const guildTemplateChange = result.tools.find((tool) => (
    tool.name === "execute_guild_template_change"
  ))
  const forumTagChange = result.tools.find((tool) => (
    tool.name === "execute_forum_tag_change"
  ))
  const pollEnd = result.tools.find((tool) => tool.name === "execute_poll_end")
  const webhookChange = result.tools.find((tool) => tool.name === "execute_webhook_change")
  const webhookCreation = result.tools.find((tool) => tool.name === "execute_webhook_creation")
  const webhookDeletion = result.tools.find((tool) => tool.name === "execute_webhook_deletion")
  const integrationDeletion = result.tools.find((tool) => (
    tool.name === "execute_guild_integration_deletion"
  ))
  const inviteDeletion = result.tools.find((tool) => tool.name === "execute_invite_deletion")
  const onboarding = result.tools.find((tool) => tool.name === "execute_onboarding_change")
  const widgetSettings = result.tools.find((tool) => (
    tool.name === "execute_guild_widget_settings_change"
  ))
  const guildSettings = result.tools.find((tool) => (
    tool.name === "execute_guild_settings_change"
  ))
  const guildExpression = result.tools.find((tool) => (
    tool.name === "execute_guild_expression_change"
  ))
  const soundboard = result.tools.find((tool) => (
    tool.name === "execute_guild_soundboard_change"
  ))
  const scheduledEvent = result.tools.find((tool) => (
    tool.name === "execute_scheduled_event_change"
  ))
  const channelMetadata = result.tools.find((tool) => (
    tool.name === "execute_channel_metadata_change"
  ))
  const permissionOverwrite = result.tools.find((tool) => (
    tool.name === "execute_channel_permission_overwrite"
  ))
  const administration = result.tools.find((tool) => (
    tool.name === "execute_member_moderation"
  ))
  const memberRole = result.tools.find((tool) => (
    tool.name === "execute_member_role_change"
  ))
  const memberVoice = result.tools.find((tool) => (
    tool.name === "execute_member_voice_change"
  ))
  const threadChange = result.tools.find((tool) => (
    tool.name === "execute_thread_change"
  ))
  const roleConfiguration = result.tools.find((tool) => (
    tool.name === "execute_role_configuration"
  ))
  const roleOrdering = result.tools.find((tool) => (
    tool.name === "execute_role_order"
  ))
  const channelOrdering = result.tools.find((tool) => (
    tool.name === "execute_channel_order"
  ))
  const channelClone = result.tools.find((tool) => (
    tool.name === "execute_channel_clone"
  ))
  const componentMessage = result.tools.find((tool) => (
    tool.name === "execute_component_message"
  ))
  for (const tool of [
    deletion,
    messagePin,
    reactionModeration,
    removeOwnReaction,
    pollEnd,
    webhookChange,
    webhookDeletion,
    integrationDeletion,
    inviteDeletion,
    onboarding,
    widgetSettings,
    guildSettings,
    guildExpression,
    soundboard,
    scheduledEvent,
    channelMetadata,
    permissionOverwrite,
    administration,
    memberRole,
    memberVoice,
    threadChange,
    roleConfiguration,
    roleOrdering,
    channelClone,
    channelOrdering,
  ]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
  assert.deepEqual(announcementCrosspost?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(announcementSubscription?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(nativeInteractionCommand?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(guildTemplateChange?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(forumTagChange?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(componentMessage?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(webhookCreation?.annotations, {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(
    listedTool(result.tools, "respond_to_discord_interaction").annotations,
    {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      readOnlyHint: false,
    },
  )
  assert.deepEqual(
    listedTool(result.tools, "list_pending_discord_interactions").annotations,
    {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  )
  const administrationPlan = result.tools.find((tool) => (
    tool.name === "plan_member_moderation"
  ))
  assert.deepEqual(administrationPlan?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  for (const name of [
    "list_channel_permission_overwrites",
    "list_message_pins",
    "list_message_reactions",
    "list_reaction_users",
    "get_poll",
    "list_poll_answer_voters",
    "list_channel_webhooks",
    "list_guild_integrations",
    "get_channel_webhook",
    "list_guild_invites",
    "get_guild_invite",
    "list_guild_templates",
    "get_guild_onboarding",
    "get_guild_widget_settings",
    "get_guild_settings",
    "list_guild_emojis",
    "get_guild_emoji",
    "list_guild_stickers",
    "get_guild_sticker",
    "list_default_soundboard_sounds",
    "list_guild_soundboard_sounds",
    "get_guild_soundboard_sound",
    "list_scheduled_events",
    "get_scheduled_event",
    "get_channel",
    "audit_forum_tags",
    "audit_channel_order",
    "plan_channel_clone",
    "plan_channel_order",
    "plan_forum_tag_change",
    "plan_channel_metadata_change",
    "plan_channel_permission_overwrite",
    "plan_message_pin",
    "plan_announcement_crosspost",
    "plan_native_interaction_command",
    "plan_poll_creation",
    "plan_poll_end",
    "plan_thread_creation",
    "plan_component_message",
    "plan_member_role_change",
    "plan_webhook_change",
    "plan_webhook_creation",
    "plan_webhook_deletion",
    "plan_guild_integration_deletion",
    "plan_invite_deletion",
    "plan_guild_template_change",
    "plan_onboarding_change",
    "plan_guild_widget_settings_change",
    "plan_guild_settings_change",
    "plan_guild_expression_change",
    "plan_guild_soundboard_change",
    "plan_scheduled_event_change",
    "plan_role_configuration",
  ]) {
    assert.deepEqual(listedTool(result.tools, name).annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
    })
  }
  const channelCreationPlan = result.tools.find((tool) => (
    tool.name === "plan_channel_creation"
  ))
  assert.deepEqual(channelCreationPlan?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const channelCreation = result.tools.find((tool) => (
    tool.name === "execute_channel_creation"
  ))
  assert.deepEqual(channelCreation?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const forumPostPlanTool = result.tools.find((tool) => (
    tool.name === "plan_forum_post"
  ))
  assert.deepEqual(forumPostPlanTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const forumPost = result.tools.find((tool) => (
    tool.name === "execute_forum_post"
  ))
  assert.deepEqual(forumPost?.annotations, {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const threadCreation = result.tools.find((tool) => (
    tool.name === "execute_thread_creation"
  ))
  assert.deepEqual(threadCreation?.annotations, {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const pollCreation = result.tools.find((tool) => (
    tool.name === "execute_poll_creation"
  ))
  assert.deepEqual(pollCreation?.annotations, {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const roleCreationPlanTool = result.tools.find((tool) => (
    tool.name === "plan_role_creation"
  ))
  assert.deepEqual(roleCreationPlanTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const roleCreation = result.tools.find((tool) => (
    tool.name === "execute_role_creation"
  ))
  assert.deepEqual(roleCreation?.annotations, {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const guildScaffoldPlanTool = result.tools.find((tool) => (
    tool.name === "plan_guild_scaffold"
  ))
  assert.deepEqual(guildScaffoldPlanTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const guildScaffoldTool = result.tools.find((tool) => (
    tool.name === "execute_guild_scaffold"
  ))
  assert.deepEqual(guildScaffoldTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const guildScaffoldVerificationTool = result.tools.find((tool) => (
    tool.name === "verify_guild_scaffold"
  ))
  assert.deepEqual(guildScaffoldVerificationTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const attachmentPlanTool = result.tools.find((tool) => (
    tool.name === "plan_attachment_message"
  ))
  assert.deepEqual(attachmentPlanTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const attachmentExecuteTool = result.tools.find((tool) => (
    tool.name === "execute_attachment_message"
  ))
  assert.deepEqual(attachmentExecuteTool?.annotations, {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  assert.deepEqual(
    listedTool(result.tools, "preview_component_layout").annotations,
    {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  )
  const discovery = result.tools.find((tool) => (
    tool.name === "discover_discord_tools"
  ))
  assert.deepEqual(discovery?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  })
  const send = result.tools.find((tool) => tool.name === "send_message")
  const reaction = result.tools.find((tool) => tool.name === "add_reaction")
  for (const tool of [send, reaction]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
  const edit = result.tools.find((tool) => tool.name === "edit_own_message")
  assert.deepEqual(edit?.annotations, {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  for (const name of [
    "get_gateway_status",
    "get_gateway_events",
    "get_observability_status",
  ]) {
    const gatewayTool = result.tools.find((tool) => tool.name === name)
    assert.deepEqual(gatewayTool?.annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    })
  }
  const activity = result.tools.find((tool) => tool.name === "list_activity")
  assert.equal(activity?.annotations?.openWorldHint, false)
  for (const name of [
    "explain_principal_permissions",
    "audit_channel_role_access",
    "list_guild_audit_entries",
    "get_guild_audit_entry",
    "list_guild_bans",
    "get_guild_ban",
  ]) {
    assert.deepEqual(listedTool(result.tools, name).annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
    })
  }
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("MCP server validates the exact reviewed channel-workflow Gateway layout scope", async () => {
  const environment = {
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS: CHANNEL_ID,
    DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: GUILD_ID,
  }
  const service = serviceFixture().service
  const gateway = (enabled: boolean, guildId: string) => new GatewayEventStore({
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(),
    cursorNamespace: `layoutscope${enabled ? "enabled" : "disabled"}`,
    enabled,
    eventFeedEnabled: false,
    layoutGuildIds: new Set([guildId]),
  })

  assert.throws(
    () => createDiscordMcpServer({
      environment,
      gateway: gateway(false, GUILD_ID),
      service,
    }),
    /requires an enabled Gateway layout source/,
  )
  assert.throws(
    () => createDiscordMcpServer({
      environment,
      gateway: gateway(true, OTHER_GUILD_ID),
      service,
    }),
    /layout scope does not match configured exact guild scope/,
  )

  const server = createDiscordMcpServer({
    environment,
    gateway: gateway(true, GUILD_ID),
    service,
  })
  await server.close()
})

test("MCP tool discovery returns bounded exact contracts without contacting Discord", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const advertised = await client.listTools()

  const exact = structuredContent(await client.callTool({
    arguments: { query: "delete_messages" },
    name: "discover_discord_tools",
  }))
  const exactMatches = exact.matches as Array<Record<string, unknown>>
  assert.equal(exact.status, "ok")
  assert.equal(exact.surface, "full")
  assert.equal(exact.refreshToolsList, false)
  assert.deepEqual(exact.newlyEnabledToolNames, [])
  assert.equal(exactMatches.length, 1)
  assert.equal(exactMatches[0]?.name, "delete_messages")
  assert.equal(exactMatches[0]?.risk, "destructive")
  assert.deepEqual(
    exactMatches[0]?.annotations,
    listedTool(advertised.tools, "delete_messages").annotations,
  )
  assert.deepEqual(
    exactMatches[0]?.inputSchema,
    listedTool(advertised.tools, "delete_messages").inputSchema,
  )

  const bounded = structuredContent(await client.callTool({
    arguments: { detail: "full", limit: 1, risk: "destructive" },
    name: "discover_discord_tools",
  }))
  const boundedMatches = bounded.matches as Array<Record<string, unknown>>
  assert.equal(boundedMatches.length, 1)
  assert.equal(boundedMatches[0]?.risk, "destructive")
  assert.ok(Number(bounded.totalMatches) > boundedMatches.length)
  assert.ok(boundedMatches[0]?.inputSchema)

  const secretQuery = structuredContent(await client.callTool({
    arguments: { query: TOKEN },
    name: "discover_discord_tools",
  }))
  assert.equal((secretQuery.matches as unknown[]).length, 0)
  assert.doesNotMatch(JSON.stringify(secretQuery), new RegExp(TOKEN))
  assert.equal(Object.values(calls).every((count) => count === 0), true)
})

test("MCP activity results omit the private local file path", async (context) => {
  const { client } = await connectedFixture(context)

  const result = await client.callTool({
    arguments: {},
    name: "list_activity",
  })

  assert.notEqual(result.isError, true)
  assert.equal("file" in structuredContent(result), false)
  assert.doesNotMatch(JSON.stringify(result), /\/memory\/activity\.jsonl/)
})

test("progressive discovery enables exact reviewed workflows and emits list changes", async (context) => {
  const full = await connectedFixture(context)
  const fullTools = (await full.client.listTools()).tools
  let changedTools: Tool[] | null = null
  let notificationCount = 0
  let resolveFirstNotification: (() => void) | undefined
  let rejectFirstNotification: ((error: Error) => void) | undefined
  const firstNotification = new Promise<void>((resolve, reject) => {
    resolveFirstNotification = resolve
    rejectFirstNotification = reject
  })
  const progressive = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
    listChanged: {
      tools: {
        debounceMs: 0,
        onChanged(error, tools) {
          notificationCount += 1
          if (error) {
            rejectFirstNotification?.(error)
            return
          }
          changedTools = tools
          resolveFirstNotification?.()
        },
      },
    },
  })

  assert.deepEqual(
    (await progressive.client.listTools()).tools.map(({ name }) => name),
    ["discover_discord_tools"],
  )
  await assert.rejects(
    () => progressive.client.callTool({
      arguments: {
        auditReason: AUDIT_REASON,
        channelId: CHANNEL_ID,
        messageIds: [MESSAGE_ID],
        operationKey: OPERATION_KEY,
        planDigest: DIGEST,
      },
      name: "delete_messages",
    }),
    /disabled|not found|not registered|unknown/i,
  )

  const discovery = structuredContent(await progressive.client.callTool({
    arguments: { query: "delete_messages" },
    name: "discover_discord_tools",
  }))
  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "delete_messages",
    "plan_message_deletion",
  ])
  assert.equal(discovery.refreshToolsList, true)
  await firstNotification
  await settleNotifications()
  assert.ok(notificationCount >= 1)
  assert.ok(changedTools)
  assert.deepEqual((changedTools as Tool[]).map(({ name }) => name), [
    "plan_message_deletion",
    "delete_messages",
    MCP_DISCOVERY_TOOL_NAME,
  ])

  const refreshed = (await progressive.client.listTools()).tools
  assert.deepEqual(
    refreshed.map(({ name }) => name),
    [
      "plan_message_deletion",
      "delete_messages",
      "discover_discord_tools",
    ],
  )
  for (const name of ["plan_message_deletion", "delete_messages"]) {
    assert.deepEqual(
      listedTool(refreshed, name),
      listedTool(fullTools, name),
    )
  }

  const notificationsAfterFirstDiscovery = notificationCount
  const repeated = structuredContent(await progressive.client.callTool({
    arguments: { query: "delete_messages" },
    name: "discover_discord_tools",
  }))
  await settleNotifications()
  assert.deepEqual(repeated.newlyEnabledToolNames, [])
  assert.equal(repeated.refreshToolsList, false)
  assert.equal(notificationCount, notificationsAfterFirstDiscovery)
})

test("progressive discovery enables the complete reviewed channel-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_channel_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_channel_creation",
    "plan_channel_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_channel_creation",
      "execute_channel_creation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed channel-clone workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_channel_clone" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_channel_clone",
    "plan_channel_clone",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_channel_clone",
      "execute_channel_clone",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery separates channel-order audit from reviewed changes", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const auditDiscovery = structuredContent(await client.callTool({
    arguments: { query: "audit_channel_order" },
    name: "discover_discord_tools",
  }))
  assert.deepEqual(auditDiscovery.newlyEnabledToolNames, ["audit_channel_order"])

  const changeDiscovery = structuredContent(await client.callTool({
    arguments: { query: "execute_channel_order" },
    name: "discover_discord_tools",
  }))
  assert.deepEqual(changeDiscovery.newlyEnabledToolNames, [
    "execute_channel_order",
    "plan_channel_order",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "audit_channel_order",
      "plan_channel_order",
      "execute_channel_order",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed forum-post workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_forum_post" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_forum_post",
    "plan_forum_post",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_forum_post",
      "execute_forum_post",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed forum-tag workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_forum_tag_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_forum_tag_change",
    "plan_forum_tag_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_forum_tag_change",
      "execute_forum_tag_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed thread-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_thread_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_thread_creation",
    "plan_thread_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_thread_creation",
      "execute_thread_creation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed attachment-message workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_attachment_message" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_attachment_message",
    "plan_attachment_message",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_attachment_message",
      "execute_attachment_message",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed component-message workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_component_message" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_component_message",
    "plan_component_message",
    "preview_component_layout",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "preview_component_layout",
      "plan_component_message",
      "execute_component_message",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed guild-scaffold workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_guild_scaffold" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_guild_scaffold",
    "plan_guild_scaffold",
    "verify_guild_scaffold",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_guild_scaffold",
      "execute_guild_scaffold",
      "verify_guild_scaffold",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed role-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_role_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_role_creation",
    "plan_role_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_role_creation",
      "execute_role_creation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed member-role workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_member_role_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_member_role_change",
    "plan_member_role_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_member_role_change",
      "execute_member_role_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed member voice workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_member_voice_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_member_voice_change",
    "plan_member_voice_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_member_voice_change",
      "execute_member_voice_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed thread-governance workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_thread_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_thread_change",
    "plan_thread_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_thread_change",
      "execute_thread_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed message-pin workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_message_pin" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_message_pin",
    "plan_message_pin",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_message_pin",
      "execute_message_pin",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed reaction-moderation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_reaction_moderation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_reaction_moderation",
    "plan_reaction_moderation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_reaction_moderation",
      "execute_reaction_moderation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed announcement-crosspost workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_announcement_crosspost" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_announcement_crosspost",
    "plan_announcement_crosspost",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_announcement_crosspost",
      "execute_announcement_crosspost",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery keeps announcement audit separate from the reviewed change pair", async (context) => {
  const audit = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })
  const auditDiscovery = structuredContent(await audit.client.callTool({
    arguments: { query: "list_announcement_subscriptions" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(auditDiscovery.newlyEnabledToolNames, [
    "list_announcement_subscriptions",
  ])
  assert.deepEqual(
    (await audit.client.listTools()).tools.map(({ name }) => name),
    ["list_announcement_subscriptions", "discover_discord_tools"],
  )

  const reviewed = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await reviewed.client.callTool({
    arguments: { query: "execute_announcement_subscription" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_announcement_subscription",
    "plan_announcement_subscription",
  ])
  assert.deepEqual(
    (await reviewed.client.listTools()).tools.map(({ name }) => name),
    [
      "plan_announcement_subscription",
      "execute_announcement_subscription",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed poll-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_poll_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_poll_creation",
    "plan_poll_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_poll_creation",
      "execute_poll_creation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed poll-ending workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_poll_end" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_poll_end",
    "plan_poll_end",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_poll_end",
      "execute_poll_end",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed webhook-deletion workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_webhook_deletion" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_webhook_deletion",
    "plan_webhook_deletion",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_webhook_deletion",
      "execute_webhook_deletion",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed webhook-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_webhook_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_webhook_creation",
    "plan_webhook_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_webhook_creation",
      "execute_webhook_creation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed webhook-change workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_webhook_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_webhook_change",
    "plan_webhook_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_webhook_change",
      "execute_webhook_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed invite-deletion workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_invite_deletion" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_invite_deletion",
    "plan_invite_deletion",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_invite_deletion",
      "execute_invite_deletion",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed onboarding workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_onboarding_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_onboarding_change",
    "plan_onboarding_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_onboarding_change",
      "execute_onboarding_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed Welcome Screen workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_guild_welcome_screen_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_guild_welcome_screen_change",
    "plan_guild_welcome_screen_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_guild_welcome_screen_change",
      "execute_guild_welcome_screen_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed widget-settings workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_guild_widget_settings_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_guild_widget_settings_change",
    "plan_guild_widget_settings_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_guild_widget_settings_change",
      "execute_guild_widget_settings_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed guild-expression workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_guild_expression_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_guild_expression_change",
    "plan_guild_expression_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_guild_expression_change",
      "execute_guild_expression_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed soundboard workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_guild_soundboard_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_guild_soundboard_change",
    "plan_guild_soundboard_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_guild_soundboard_change",
      "execute_guild_soundboard_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed AutoMod workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_automod_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_automod_change",
    "plan_automod_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_automod_change",
      "execute_automod_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed scheduled-event workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_scheduled_event_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_scheduled_event_change",
    "plan_scheduled_event_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_scheduled_event_change",
      "execute_scheduled_event_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed Stage-instance workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_stage_instance_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_stage_instance_change",
    "plan_stage_instance_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_stage_instance_change",
      "execute_stage_instance_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed channel-metadata workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_channel_metadata_change" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_channel_metadata_change",
    "plan_channel_metadata_change",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_channel_metadata_change",
      "execute_channel_metadata_change",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed permission-overwrite workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_channel_permission_overwrite" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_channel_permission_overwrite",
    "plan_channel_permission_overwrite",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_channel_permission_overwrite",
      "execute_channel_permission_overwrite",
      "discover_discord_tools",
    ],
  )
})

test("MCP toolsets exclude unavailable tools from direct and discovered surfaces", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOLSETS: "messages,connector" },
  })

  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "get_connector_status",
      "read_messages",
      "search_messages",
      "get_message",
      "discover_discord_tools",
    ],
  )
  assert.deepEqual(
    (await client.listPrompts()).prompts.map(({ name }) => name),
    ["summarize_channel", "search_guild_messages"],
  )
  const unavailable = structuredContent(await client.callTool({
    arguments: { query: "moderation" },
    name: "discover_discord_tools",
  }))
  assert.equal(unavailable.totalMatches, 0)
  assert.deepEqual(unavailable.matches, [])
  assert.deepEqual(
    (unavailable.toolsets as Array<Record<string, unknown>>)
      .map(({ name }) => name),
    ["connector", "messages"],
  )
  await assert.rejects(
    () => client.callTool({ arguments: {}, name: "list_guilds" }),
    /not found|not registered|unknown/i,
  )
})

test("MCP message search requires a substantive filter and forwards bounded input", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const valid = await client.callTool({
    arguments: {
      content: "deploy",
      guildId: GUILD_ID,
      limit: 12,
      sortBy: "timestamp",
    },
    name: "search_messages",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "search_messages",
  })

  assert.equal(structuredContent(valid).status, "ok")
  assert.equal(calls.search, 1)
  assert.equal(invalid.isError, true)
  assert.equal(calls.search, 1)
})

test("MCP thread and permission tools validate cursors and invoke read-only services", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const active = await client.callTool({
    arguments: {
      guildId: GUILD_ID,
      limit: 3,
      parentChannelId: CHANNEL_ID,
    },
    name: "list_active_threads",
  })
  const archived = await client.callTool({
    arguments: {
      beforeTimestamp: "2026-08-14T00:00:00.000Z",
      channelId: CHANNEL_ID,
      limit: 4,
      visibility: "public",
    },
    name: "list_archived_threads",
  })
  const invalidCursor = await client.callTool({
    arguments: {
      beforeTimestamp: "not-an-iso-timestamp",
      channelId: CHANNEL_ID,
      visibility: "public",
    },
    name: "list_archived_threads",
  })
  const access = await client.callTool({
    arguments: { channelId: CHANNEL_ID },
    name: "explain_channel_access",
  })

  assert.equal(structuredContent(active).status, "ok")
  assert.equal(structuredContent(archived).status, "ok")
  assert.equal(invalidCursor.isError, true)
  assert.equal(structuredContent(access).status, "ok")
  assert.deepEqual(calls, {
    active: 1,
    addReaction: 0,
    auditChannelOrder: 0,
    auditRoleOrder: 0,
    auditRoles: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    announcementCrosspostExecute: 0,
    announcementCrosspostPlan: 0,
    announcementSubscriptionExecute: 0,
    announcementSubscriptionList: 0,
    announcementSubscriptionPlan: 0,
    archived: 1,
    attachmentExecute: 0,
    attachmentPlan: 0,
    autoModerationExecute: 0,
    autoModerationGet: 0,
    autoModerationList: 0,
    autoModerationPlan: 0,
    banGet: 0,
    banList: 0,
    channelCloneExecute: 0,
    channelClonePlan: 0,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
    channelMetadataExecute: 0,
    channelMetadataGet: 0,
    channelMetadataPlan: 0,
    channelOrderingExecute: 0,
    channelOrderingPlan: 0,
    componentMessageExecute: 0,
    componentMessagePlan: 0,
    componentMessagePreview: 0,
    delete: 0,
    edit: 0,
    explain: 1,
    forumPostExecute: 0,
    forumPostPlan: 0,
    forumTagAudit: 0,
    forumTagExecute: 0,
    forumTagPlan: 0,
    guildScaffoldExecute: 0,
    guildScaffoldPlan: 0,
    guildScaffoldVerify: 0,
    guildTemplateExecute: 0,
    guildTemplateList: 0,
    guildTemplatePlan: 0,
    guildExpressionExecute: 0,
    guildExpressionGet: 0,
    guildExpressionList: 0,
    guildExpressionPlan: 0,
    integrationDeletionExecute: 0,
    integrationDeletionList: 0,
    integrationDeletionPlan: 0,
    inviteDeletionExecute: 0,
    inviteDeletionGet: 0,
    inviteDeletionList: 0,
    inviteDeletionPlan: 0,
    getRole: 0,
    memberGet: 0,
    memberList: 0,
    memberSearch: 0,
    listRoles: 0,
    messagePinExecute: 0,
    messagePinList: 0,
    messagePinPlan: 0,
    memberRoleExecute: 0,
    memberRolePlan: 0,
    memberVoiceExecute: 0,
    memberVoiceGet: 0,
    memberVoicePlan: 0,
    onboardingExecute: 0,
    onboardingGet: 0,
    onboardingPlan: 0,
    permissionOverwriteExecute: 0,
    permissionOverwriteList: 0,
    permissionOverwritePlan: 0,
    plan: 0,
    pollCreationExecute: 0,
    pollCreationPlan: 0,
    pollEndExecute: 0,
    pollEndPlan: 0,
    pollGet: 0,
    pollVoters: 0,
    principalExplain: 0,
    reactionModerationExecute: 0,
    reactionModerationPlan: 0,
    reactionUsers: 0,
    reactions: 0,
    removeOwnReaction: 0,
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    roleConfigurationExecute: 0,
    roleConfigurationPlan: 0,
    roleOrderingExecute: 0,
    roleOrderingPlan: 0,
    scheduledEventExecute: 0,
    scheduledEventGet: 0,
    scheduledEventList: 0,
    scheduledEventPlan: 0,
    soundboardDefaultList: 0,
    soundboardExecute: 0,
    soundboardGet: 0,
    soundboardGuildList: 0,
    soundboardPlan: 0,
    stageInstanceExecute: 0,
    stageInstanceGet: 0,
    stageInstanceList: 0,
    stageInstancePlan: 0,
    search: 0,
    send: 0,
    threadCreationExecute: 0,
    threadCreationPlan: 0,
    threadGovernanceExecute: 0,
    threadGovernanceGet: 0,
    threadGovernanceMembership: 0,
    threadGovernancePlan: 0,
    webhookDeletionExecute: 0,
    webhookDeletionGet: 0,
    webhookDeletionList: 0,
    webhookDeletionPlan: 0,
    webhookChangeExecute: 0,
    webhookChangePlan: 0,
    webhookCreationExecute: 0,
    webhookCreationPlan: 0,
  })
})

test("MCP principal permission tools enforce exact subjects, targets, and bounded role audits", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const explained = await client.callTool({
    arguments: {
      action: "send-message",
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      subjectKind: "connector",
    },
    name: "explain_principal_permissions",
  })
  const audited = await client.callTool({
    arguments: {
      actions: ["view-channel", "send-message"],
      channelId: CHANNEL_ID,
      limit: 1,
    },
    name: "audit_channel_role_access",
  })
  const invalidSubject = await client.callTool({
    arguments: {
      action: "view-channel",
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      subjectId: USER_ID,
      subjectKind: "connector",
    },
    name: "explain_principal_permissions",
  })
  const invalidTarget = await client.callTool({
    arguments: {
      action: "kick-member",
      guildId: GUILD_ID,
      subjectKind: "connector",
    },
    name: "explain_principal_permissions",
  })
  const invalidHierarchyChannel = await client.callTool({
    arguments: {
      action: "kick-member",
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      subjectKind: "connector",
      targetUserId: USER_ID,
    },
    name: "explain_principal_permissions",
  })
  const duplicateActions = await client.callTool({
    arguments: {
      actions: ["view-channel", "view-channel"],
      channelId: CHANNEL_ID,
    },
    name: "audit_channel_role_access",
  })

  assert.equal(structuredContent(explained).status, "ok")
  assert.equal(structuredContent(audited).status, "ok")
  assert.equal(invalidSubject.isError, true)
  assert.equal(invalidTarget.isError, true)
  assert.equal(invalidHierarchyChannel.isError, true)
  assert.equal(duplicateActions.isError, true)
  assert.equal(calls.principalExplain, 1)
  assert.equal(calls.auditRoles, 1)
})

test("progressive permission discovery reveals only the requested exact tool", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: {
      DISCORD_MCP_TOOLSETS: "permissions",
      DISCORD_MCP_TOOL_SURFACE: "progressive",
    },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "explain_principal_permissions" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "explain_principal_permissions",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    ["explain_principal_permissions", "discover_discord_tools"],
  )
})

test("MCP role reads expose complete inventory and exact lookup with snowflake validation", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const inventory = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_roles",
  })
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, roleId: ROLE_ID },
    name: "get_role",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID, roleId: "not-a-snowflake" },
    name: "get_role",
  })

  assert.equal(structuredContent(inventory).status, "ok")
  assert.equal(structuredContent(exact).status, "ok")
  assert.equal(invalid.isError, true)
  assert.equal(calls.listRoles, 1)
  assert.equal(calls.getRole, 1)
})

test("MCP member directory exposes bounded privacy-minimized exact, cursor, and prefix reads", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const tools = (await client.listTools()).tools
  const listTool = listedTool(tools, "list_guild_members")
  const searchTool = listedTool(tools, "search_guild_members")

  assert.equal(
    (listTool.inputSchema.properties as Record<string, Record<string, unknown>>)
      .limit?.maximum,
    100,
  )
  assert.equal(
    (searchTool.inputSchema.properties as Record<string, Record<string, unknown>>)
      .limit?.maximum,
    25,
  )
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, userId: USER_ID },
    name: "get_guild_member",
  })
  const listed = await client.callTool({
    arguments: { afterUserId: USER_ID, guildId: GUILD_ID, limit: 9 },
    name: "list_guild_members",
  })
  const searched = await client.callTool({
    arguments: { guildId: GUILD_ID, limit: 7, query: "rev" },
    name: "search_guild_members",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID, query: "r" },
    name: "search_guild_members",
  })

  const member = structuredContent(exact).member as Record<string, unknown>
  assert.equal(member.userId, USER_ID)
  assert.equal("avatar" in member, false)
  assert.equal(structuredContent(listed).status, "ok")
  assert.equal(structuredContent(searched).status, "ok")
  assert.equal(invalid.isError, true)
  assert.doesNotMatch(JSON.stringify(searched.content), /rev|reviewer/i)
  assert.equal(calls.memberGet, 1)
  assert.equal(calls.memberList, 1)
  assert.equal(calls.memberSearch, 1)
})

test("MCP ban audit exposes bounded default-redacted pages and exact reads", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const tools = (await client.listTools()).tools
  const listTool = listedTool(tools, "list_guild_bans")

  assert.equal(
    (listTool.inputSchema.properties as Record<string, Record<string, unknown>>)
      .limit?.maximum,
    BAN_AUDIT_LIMITS.listPage,
  )
  const listed = await client.callTool({
    arguments: { afterUserId: USER_ID, guildId: GUILD_ID, limit: 9 },
    name: "list_guild_bans",
  })
  const invalidId = await client.callTool({
    arguments: { guildId: GUILD_ID, userId: "0" },
    name: "get_guild_ban",
  })
  const listedWithReasons = await client.callTool({
    arguments: { guildId: GUILD_ID, includeReasons: true, limit: 1 },
    name: "list_guild_bans",
  })
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, userId: USER_ID },
    name: "get_guild_ban",
  })
  const exactWithReason = await client.callTool({
    arguments: { guildId: GUILD_ID, includeReason: true, userId: USER_ID },
    name: "get_guild_ban",
  })
  const invalid = await client.callTool({
    arguments: {
      guildId: GUILD_ID,
      limit: BAN_AUDIT_LIMITS.listPage + 1,
    },
    name: "list_guild_bans",
  })

  assert.equal(structuredContent(listed).status, "ok")
  assert.equal(JSON.stringify(listed).includes("Private reason"), false)
  assert.equal(JSON.stringify(listedWithReasons).includes("Private reason"), true)
  assert.equal(structuredContent(exact).found, true)
  assert.equal(JSON.stringify(exact).includes("Private reason"), false)
  assert.equal(JSON.stringify(exactWithReason).includes("Private reason"), true)
  assert.doesNotMatch(JSON.stringify(listed.content), /banned-member|Private reason/)
  assert.doesNotMatch(JSON.stringify(exactWithReason.content), /banned-member|Private reason/)
  assert.equal(invalid.isError, true)
  assert.equal(invalidId.isError, true)
  assert.equal(calls.banList, 2)
  assert.equal(calls.banGet, 2)
})

test("progressive ban discovery reveals only the requested exact read", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: {
      DISCORD_MCP_TOOLSETS: "bans",
      DISCORD_MCP_TOOL_SURFACE: "progressive",
    },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "get_guild_ban" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, ["get_guild_ban"])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    ["get_guild_ban", "discover_discord_tools"],
  )
})

test("MCP guild audit-log tools enforce bounded privacy tiers and exact IDs", async (context) => {
  const { client } = await connectedFixture(context)
  const tools = (await client.listTools()).tools
  const listTool = listedTool(tools, "list_guild_audit_entries")

  assert.equal(
    (listTool.inputSchema.properties as Record<string, Record<string, unknown>>)
      .limit?.maximum,
    AUDIT_LOG_LIMITS.entryPage,
  )
  const listed = await client.callTool({
    arguments: {
      actionType: 22,
      actorUserId: USER_ID,
      guildId: GUILD_ID,
      limit: 1,
    },
    name: "list_guild_audit_entries",
  })
  const exact = await client.callTool({
    arguments: {
      entryId: AUDIT_ENTRY_ID,
      guildId: GUILD_ID,
      includeReason: true,
    },
    name: "get_guild_audit_entry",
  })
  const invalid = await client.callTool({
    arguments: { actionType: 0, guildId: GUILD_ID },
    name: "list_guild_audit_entries",
  })

  assert.equal(structuredContent(listed).status, "ok")
  assert.equal(JSON.stringify(listed).includes(AUDIT_REASON), false)
  assert.equal(structuredContent(exact).found, true)
  assert.equal(JSON.stringify(exact).includes(AUDIT_REASON), true)
  assert.equal(invalid.isError, true)
})

test("progressive audit-log discovery reveals only the requested exact read", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: {
      DISCORD_MCP_TOOLSETS: "audit-logs",
      DISCORD_MCP_TOOL_SURFACE: "progressive",
    },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "get_guild_audit_entry" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, ["get_guild_audit_entry"])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    ["get_guild_audit_entry", "discover_discord_tools"],
  )
})

test("MCP status and safety resource disclose durable coordination boundaries", async (context) => {
  const { client } = await connectedFixture(context)

  const status = structuredContent(await client.callTool({
    arguments: {},
    name: "get_connector_status",
  }))
  assert.deepEqual(status.writeCoordination, {
    coverage: "receipt-backed-reviewed-writes",
    excludedWorkflows: [
      "legacy-member-moderation",
      "ordinary-message-interactions",
    ],
    localFilesystemRequired: true,
    mode: "durable-exact-target",
    resumableWorkflows: ["guild-scaffold"],
    sharedStateRootRequired: true,
  })

  const resource = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
  const content = resource.contents[0]
  assert.ok(content && "text" in content)
  if (!content || !("text" in content)) throw new Error("Expected safety text")
  assert.match(content.text, /durable exact target claims/)
  assert.match(content.text, /Resumable guild scaffolds claim both guild role and channel collections/)
  assert.match(content.text, /interruption with pending evidence leaves them quarantined/)
  assert.match(content.text, /complete obfuscation-safe Gateway layout/)
  assert.match(content.text, /full normalized family payload/)
  assert.match(content.text, /newer complete matching Gateway layout/)
})

test("MCP Gateway tools expose local health and cursor continuity without content", async (context) => {
  const gateway = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    clock: () => new Date("2026-08-19T00:00:00.000Z"),
    cursorNamespace: "mcptooltest1",
    enabled: true,
  })
  const { client } = await connectedFixture(context, {
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GATEWAY: "true",
      DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
      DISCORD_MCP_BOT_ID: BOT_ID,
    },
    gateway,
  })
  gateway.transition("ready")
  gateway.ingestDispatch("MESSAGE_CREATE", {
    author: { username: TOKEN },
    channel_id: CHANNEL_ID,
    content: TOKEN,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })

  const status = structuredContent(await client.callTool({
    arguments: {},
    name: "get_gateway_status",
  }))
  const events = structuredContent(await client.callTool({
    arguments: {
      afterCursor: "gw1.foreigncursor.0.0",
      limit: 10,
    },
    name: "get_gateway_events",
  }))
  assert.equal(
    (status.connection as Record<string, unknown>).state,
    "ready",
  )
  assert.equal(
    (events.page as Record<string, unknown>).resetReason,
    "foreign-cursor",
  )
  assert.equal((events.events as unknown[]).length, 1)
  assert.doesNotMatch(JSON.stringify({ events, status }), new RegExp(TOKEN))
  assert.doesNotMatch(JSON.stringify(events), /author|attachment|embed|component|emoji|userId/)
})

test("MCP native Interaction resources and tools keep tokens private and requests untrusted", async (context) => {
  const reference = `iref_${"1".repeat(32)}`
  const pending = {
    channelId: CHANNEL_ID,
    commandId: "700000000000000001",
    commandVersion: "700000000000000002",
    createdAt: "2026-08-22T00:00:00.000Z",
    expiresAt: "2026-08-22T00:10:00.000Z",
    guildId: GUILD_ID,
    interactionId: "700000000000000003",
    reference,
    request: "Summarize the private release discussion",
    schemaVersion: 1,
    userId: USER_ID,
  }
  let listCalls = 0
  const responses: Array<{ reference: string; response: string }> = []
  const nativeInteractions: NativeInteractionSource = {
    enabled: true,
    getStatus() {
      return {
        command: {
          guildCount: 1,
          name: "discord-mcp",
          verifiedGuildCount: 1,
        },
        enabled: true,
        lastError: null,
        limits: {
          maximumPending: 25,
          pendingPerUser: 3,
          requestCharacters: 2_000,
          responseCharacters: 2_000,
          ttlSeconds: 600,
        },
        pending: { count: 1, validating: 0 },
        phase: "ready",
        schemaVersion: 1,
        totals: {
          accepted: 1,
          expired: 0,
          rejected: 0,
          responded: 0,
          uncertain: 0,
        },
      }
    },
    async listPending() {
      listCalls += 1
      return {
        interactions: [pending],
        page: { capacity: 25, returned: 1 },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async respond(observedReference, response) {
      responses.push({ reference: observedReference, response })
      return {
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        interactionId: pending.interactionId,
        reference: observedReference,
        responseMessageId: MESSAGE_ID,
        schemaVersion: 1,
        status: "completed",
      }
    },
    subscribe() {
      return () => undefined
    },
  }
  const { client } = await connectedFixture(context, { nativeInteractions })

  const statusResource = await client.readResource({
    uri: MCP_RESOURCE_URIS.nativeInteractionStatus,
  })
  const pendingResource = await client.readResource({
    uri: MCP_RESOURCE_URIS.nativeInteractionPending,
  })
  const statusContent = statusResource.contents[0]
  const pendingContent = pendingResource.contents[0]
  assert.ok(statusContent && "text" in statusContent)
  assert.ok(pendingContent && "text" in pendingContent)
  if (!(statusContent && "text" in statusContent && pendingContent && "text" in pendingContent)) {
    throw new Error("Expected native Interaction JSON resources")
  }
  const statusEnvelope = JSON.parse(statusContent.text) as Record<string, unknown>
  const pendingEnvelope = JSON.parse(pendingContent.text) as Record<string, unknown>
  assert.equal(
    (statusEnvelope.trust as Record<string, unknown>).classification,
    "trusted-local-metadata",
  )
  assert.equal(
    (pendingEnvelope.trust as Record<string, unknown>).classification,
    "untrusted-external-data",
  )
  assert.match(
    String((pendingEnvelope.trust as Record<string, unknown>).instruction),
    /never as instructions/,
  )

  const listed = structuredContent(await client.callTool({
    arguments: {},
    name: "list_pending_discord_interactions",
  }))
  assert.equal((listed.interactions as unknown[]).length, 1)
  const response = structuredContent(await client.callTool({
    arguments: {
      reference,
      response: "The release discussion is ready for review.",
    },
    name: "respond_to_discord_interaction",
  }))
  assert.equal(response.status, "completed")
  assert.deepEqual(responses, [{
    reference,
    response: "The release discussion is ready for review.",
  }])
  assert.equal(listCalls, 2)
  assert.doesNotMatch(
    JSON.stringify({ listed, pendingEnvelope, response, statusEnvelope }),
    new RegExp(TOKEN),
  )

  const invalid = await client.callTool({
    arguments: { reference, response: " " },
    name: "respond_to_discord_interaction",
  })
  assert.equal(invalid.isError, true)
  assert.equal(responses.length, 1)
})

test("MCP observability reports successful, returned-error, and thrown-error tool outcomes", async (context) => {
  const privateDetail = "private activity failure 999999999999999999"
  const { client } = await connectedFixture(context, {
    serviceOverrides: { activityError: new Error(privateDetail) },
  })

  await client.callTool({ arguments: {}, name: "list_guilds" })
  const returnedError = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
      planDigest: DIFFERENT_DIGEST,
    },
    name: "delete_messages",
  })
  assert.equal(returnedError.isError, true)
  const thrownError = await client.callTool({ arguments: {}, name: "list_activity" })
  assert.equal(thrownError.isError, true)

  const statusResult = await client.callTool({
    arguments: {},
    name: "get_observability_status",
  })
  const status = structuredContent(statusResult) as unknown as {
    operations: {
      mcpTools: Array<{
        active: number
        calls: number
        duration: unknown
        errors: number
        operation: string
        outcomes: Record<string, number>
        retries: number
      }>
    }
    privacy: Record<string, boolean>
  }
  const byName = new Map(status.operations.mcpTools.map((entry) => [entry.operation, entry]))
  assert.deepEqual(byName.get("list_guilds")?.outcomes, {
    error: 0,
    ok: 1,
    "tool-error": 0,
  })
  assert.deepEqual(byName.get("delete_messages")?.outcomes, {
    error: 0,
    ok: 0,
    "tool-error": 1,
  })
  assert.deepEqual(byName.get("list_activity")?.outcomes, {
    error: 1,
    ok: 0,
    "tool-error": 0,
  })
  assert.deepEqual(byName.get("get_observability_status"), {
    active: 1,
    calls: 0,
    duration: byName.get("get_observability_status")?.duration,
    errors: 0,
    operation: "get_observability_status",
    outcomes: { error: 0, ok: 0, "tool-error": 0 },
    retries: 0,
  })
  assert.deepEqual(status.privacy, {
    argumentsStored: false,
    contentStored: false,
    discordIdentifiersStored: false,
    errorDetailsStored: false,
    persistent: false,
    rawRoutesStored: false,
  })
  assert.equal(JSON.stringify(status).includes(privateDetail), false)

  const resource = await client.readResource({ uri: MCP_RESOURCE_URIS.observability })
  const content = resource.contents[0]
  assert.ok(content && "text" in content)
  if (!content || !("text" in content)) throw new Error("Expected observability text")
  const envelope = JSON.parse(content.text) as {
    data: { operations: { mcpTools: Array<{ active: number; calls: number; operation: string }> } }
  }
  const completedStatus = envelope.data.operations.mcpTools.find(
    ({ operation }) => operation === "get_observability_status",
  )
  assert.equal(completedStatus?.active, 0)
  assert.equal(completedStatus?.calls, 1)
  assert.equal(content.text.includes(privateDetail), false)
  assert.equal(content.text.includes(TOKEN), false)
})

test("MCP reaction reads separate aggregate access from identity audit", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const emoji = `party:${USER_ID}`

  const aggregates = await client.callTool({
    arguments: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
    name: "list_message_reactions",
  })
  const users = await client.callTool({
    arguments: {
      after: BOT_ID,
      channelId: CHANNEL_ID,
      emoji,
      limit: 10,
      messageId: MESSAGE_ID,
      type: "burst",
    },
    name: "list_reaction_users",
  })
  const invalid = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      emoji,
      limit: REACTION_LIMITS.userPage + 1,
      messageId: MESSAGE_ID,
    },
    name: "list_reaction_users",
  })

  const aggregateResult = structuredContent(aggregates)
  const userResult = structuredContent(users)
  assert.equal(aggregateResult.status, "ok")
  assert.equal((aggregateResult.reactions as unknown[]).length, 1)
  assert.equal("content" in (aggregateResult.message as Record<string, unknown>), false)
  assert.equal(JSON.stringify(aggregateResult).includes("Private guild name"), false)
  assert.equal(userResult.status, "ok")
  assert.equal(userResult.reactionType, "burst")
  assert.deepEqual(userResult.users, [{ bot: false, id: USER_ID }])
  assert.equal(JSON.stringify(userResult).includes("username"), false)
  assert.equal(invalid.isError, true)
  assert.equal(calls.reactions, 1)
  assert.equal(calls.reactionUsers, 1)
})

test("MCP interaction tools enforce bounded schemas and invoke idempotent services", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const sent = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const edited = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "replacement",
      messageId: MESSAGE_ID,
    },
    name: "edit_own_message",
  })
  const reacted = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    },
    name: "add_reaction",
  })
  const removedReaction = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    },
    name: "remove_own_reaction",
  })
  const invalid = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "unsafe retry key",
      idempotencyKey: "short",
    },
    name: "send_message",
  })

  assert.equal(structuredContent(sent).status, "completed")
  assert.equal(structuredContent(edited).status, "completed")
  assert.equal(structuredContent(reacted).status, "completed")
  assert.equal(structuredContent(removedReaction).status, "completed")
  assert.equal(invalid.isError, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.edit, 1)
  assert.equal(calls.addReaction, 1)
  assert.equal(calls.removeOwnReaction, 1)
})

test("MCP interaction errors expose local retry timing without secrets", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionRateLimitError(750),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const structured = structuredContent(result)

  assert.equal(result.isError, true)
  assert.equal(structured.status, "rate-limited")
  assert.equal((structured.error as Record<string, unknown>).retryAfterMs, 750)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("MCP interaction errors preserve Discord rate-limit timing", async (context) => {
  const discordError = new DiscordApiError({
    message: "Discord rate limit",
    method: "POST",
    retryAfterMs: 1_250,
    route: `/channels/${CHANNEL_ID}/messages`,
    status: 429,
  })
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionExecutionError(
        "Discord interaction did not complete with a verified outcome",
        {
          activityId: "activity-rate-limit",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          messageId: null,
          retryAfterMs: 1_250,
          schemaVersion: 1,
          status: "failed",
        },
        { cause: discordError },
      ),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const structured = structuredContent(result)

  assert.equal(result.isError, true)
  assert.equal(structured.status, "rate-limited")
  assert.equal((structured.error as Record<string, unknown>).retryAfterMs, 1_250)
})

test("MCP interaction errors distinguish uncertain external outcomes", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionExecutionError(
        "Discord interaction outcome is uncertain",
        {
          activityId: "activity-uncertain",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          messageId: null,
          retryAfterMs: null,
          schemaVersion: 1,
          status: "uncertain",
        },
      ),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })

  assert.equal(result.isError, true)
  assert.equal(structuredContent(result).status, "outcome-uncertain")
})

test("MCP deletion plans require bounded exact reviewed intent", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
    },
    name: "plan_message_deletion",
  })
  const missingReason = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
    },
    name: "plan_message_deletion",
  })
  const missingKey = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
    },
    name: "plan_message_deletion",
  })
  const duplicateTarget = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID, MESSAGE_ID],
      operationKey: OPERATION_KEY,
    },
    name: "plan_message_deletion",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(missingReason.isError, true)
  assert.equal(missingKey.isError, true)
  assert.equal(duplicateTarget.isError, true)
  assert.equal(calls.plan, 1)
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(OPERATION_KEY))
})

test("MCP deletion elicits exact confirmation before invoking the write service", async (context) => {
  let confirmationMessage = ""
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.plan, 1)
  assert.equal(calls.delete, 1)
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Message .* type 0/)
  assert.match(confirmationMessage, /Channel parent ID: none/)
  assert.match(confirmationMessage, /Private-thread access: not-applicable/)
  assert.match(confirmationMessage, /Plan created at: 2026-08-14T00:00:00.000Z/)
  assert.match(confirmationMessage, /Content: "hello"/)
  assert.match(confirmationMessage, new RegExp(DIGEST))
})

test("MCP deletion stops without writing when confirmation is declined", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "confirmation-declined")
  assert.equal(calls.delete, 0)
})

test("MCP deletion rejects an accepted confirmation without approval", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(calls.delete, 0)
})

test("MCP deletion refuses a changed plan before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { planDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.delete, 0)
})

test("MCP deletion signed state rejects changed reason, key, and target", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    messageIds: [MESSAGE_ID],
    operationKey: OPERATION_KEY,
    planDigest: DIGEST,
  }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "delete_messages",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")
  for (const changed of [
    { ...request, auditReason: "Different reviewed reason" },
    { ...request, operationKey: "message-deletion-attempt-0002" },
    { ...request, messageIds: [USER_ID] },
  ]) {
    const result = await fixture.client.request({
      method: "tools/call",
      params: {
        arguments: changed,
        inputResponses: {
          confirm_deletion: {
            action: "accept",
            content: { approve: true },
          },
        },
        name: "delete_messages",
        requestState: initial.requestState,
      },
    }, specTypeSchemas.CallToolResult)

    assert.equal(structuredContent(result).status, "confirmation-invalid")
    assert.equal(result.isError, true)
  }
  assert.equal(fixture.calls.delete, 0)
})

test("MCP deletion exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    messageIds: [MESSAGE_ID],
    operationKey: OPERATION_KEY,
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      deletionError: new DeletionExecutionError(
        "Discord message deletion outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "delete_messages",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-message-deletion",
    channelId: CHANNEL_ID,
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: operationKeyHash(OPERATION_KEY),
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      deletionError: new DeletionOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "delete_messages",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(OPERATION_KEY))
})

test("MCP attachment messages validate bounded local-file plans", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "Reviewed report",
      description: "Accessible report",
      filePath: ATTACHMENT_PATH,
      filename: "report.txt",
      operationKey: ATTACHMENT_OPERATION_KEY,
    },
    name: "plan_attachment_message",
  })
  const unsafeFilename = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: ATTACHMENT_PATH,
      filename: "../secret.txt",
      operationKey: ATTACHMENT_OPERATION_KEY,
    },
    name: "plan_attachment_message",
  })
  const shortKey = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: ATTACHMENT_PATH,
      operationKey: "short",
    },
    name: "plan_attachment_message",
  })
  const relativePath = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: "relative/report.txt",
      operationKey: ATTACHMENT_OPERATION_KEY,
    },
    name: "plan_attachment_message",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(unsafeFilename.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(relativePath.isError, true)
  assert.equal(calls.attachmentPlan, 1)
})

test("MCP attachment messages bind signed approval to the exact file and message", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: `Reviewed report for <@${USER_ID}>`,
      description: "Accessible report",
      filePath: ATTACHMENT_PATH,
      filename: "report.txt",
      notifyReplyAuthor: true,
      notifyUserIds: [USER_ID],
      operationKey: ATTACHMENT_OPERATION_KEY,
      planDigest: DIGEST,
      replyToMessageId: MESSAGE_ID,
    },
    name: "execute_attachment_message",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.attachmentPlan, 1)
  assert.equal(calls.attachmentExecute, 1)
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /report\.txt/)
  assert.match(confirmationMessage, /14 bytes/)
  assert.match(confirmationMessage, /Accessible report/)
  assert.match(confirmationMessage, /ATTACH_FILES/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(confirmationMessage, new RegExp(ATTACHMENT_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(ATTACHMENT_OPERATION_KEY),
  )
})

test("MCP attachment messages stop on declined confirmation or a changed plan", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: ATTACHMENT_PATH,
      operationKey: ATTACHMENT_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_attachment_message",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.attachmentExecute, 0)

  let confirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { attachmentPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: ATTACHMENT_PATH,
      operationKey: ATTACHMENT_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_attachment_message",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(changed.calls.attachmentExecute, 0)
})

test("MCP attachment messages expose uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      attachmentError: new AttachmentMessageExecutionError(
        "Discord attachment outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: ATTACHMENT_PATH,
      operationKey: ATTACHMENT_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_attachment_message",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      announcementCrosspostError: new AnnouncementCrosspostExecutionError(
        "Discord rejected the announcement crosspost before execution",
        { status: "failed" },
        {
          cause: new DiscordApiError({
            message: "Discord rate limit",
            method: "POST",
            retryAfterMs: 1_500,
            route: "/channels/{channel.id}/messages/{message.id}/crosspost",
            status: 429,
          }),
        },
      ),
    },
  })
  const rateLimitedResult = await rateLimited.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })
  assert.equal(
    structuredContent(rateLimitedResult).status,
    "announcement-crosspost-failed",
  )
  assert.equal(
    (structuredContent(rateLimitedResult).error as Record<string, unknown>)
      .retryAfterMs,
    1_500,
  )

  const receipt = {
    activityId: "activity-attachment-1",
    error: null,
    guildId: GUILD_ID,
    messageId: MESSAGE_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-20T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      attachmentError: new AttachmentMessageOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      filePath: ATTACHMENT_PATH,
      operationKey: ATTACHMENT_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_attachment_message",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(ATTACHMENT_OPERATION_KEY))
})

test("MCP component layout preview is local, strict, and recursively bounded", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const preview = await client.callTool({
    arguments: {
      components: COMPONENT_LAYOUT,
      notifyUserIds: [USER_ID],
    },
    name: "preview_component_layout",
  })
  const rawDiscord = await client.callTool({
    arguments: {
      components: [{ content: "Raw", type: 10 }],
    },
    name: "preview_component_layout",
  })
  const nested = await client.callTool({
    arguments: {
      components: [{
        components: [{
          components: [{ content: "Nested", kind: "text" }],
          kind: "container",
        }],
        kind: "container",
      }],
    },
    name: "preview_component_layout",
  })

  assert.equal(structuredContent(preview).status, "ok")
  assert.equal(
    structuredContent(preview).textCharacters,
    [...`Reviewed component for <@${USER_ID}>`].length,
  )
  assert.equal(rawDiscord.isError, true)
  assert.equal(nested.isError, true)
  assert.equal(calls.componentMessagePreview, 1)
})

test("MCP component-message planning enforces exact create and edit shapes", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const create = await client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      notifyUserIds: [USER_ID],
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
    },
    name: "plan_component_message",
  })
  const edit = await client.callTool({
    arguments: {
      action: "edit",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      messageId: MESSAGE_ID,
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
    },
    name: "plan_component_message",
  })
  const mixedCreate = await client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      messageId: MESSAGE_ID,
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
    },
    name: "plan_component_message",
  })
  const mixedEdit = await client.callTool({
    arguments: {
      action: "edit",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      messageId: MESSAGE_ID,
      notifyReplyAuthor: true,
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      replyToMessageId: MESSAGE_ID,
    },
    name: "plan_component_message",
  })

  assert.equal(structuredContent(create).status, "planned")
  assert.equal(structuredContent(edit).status, "planned")
  assert.equal(mixedCreate.isError, true)
  assert.equal(mixedEdit.isError, true)
  assert.equal(calls.componentMessagePlan, 2)
})

test("MCP component messages bind signed approval to the exact normalized layout", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      notifyReplyAuthor: true,
      notifyUserIds: [USER_ID],
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      planDigest: DIGEST,
      replyToMessageId: MESSAGE_ID,
    },
    name: "execute_component_message",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.componentMessagePlan, 1)
  assert.equal(calls.componentMessageExecute, 1)
  assert.match(confirmationMessage, /Components V2 create/)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Reviewed component/)
  assert.match(confirmationMessage, /SEND_MESSAGES/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(COMPONENT_MESSAGE_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(COMPONENT_MESSAGE_OPERATION_KEY),
  )
})

test("MCP component messages skip approval for exact no-op edits", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { componentMessageWriteRequired: false },
  })
  const result = await client.callTool({
    arguments: {
      action: "edit",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      messageId: MESSAGE_ID,
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_component_message",
  })

  assert.equal(structuredContent(result).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(calls.componentMessagePlan, 1)
  assert.equal(calls.componentMessageExecute, 1)
})

test("MCP component messages stop on declined approval, changed plans, and safe conflicts", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      notifyUserIds: [USER_ID],
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_component_message",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.componentMessageExecute, 0)

  let confirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { componentMessagePlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      notifyUserIds: [USER_ID],
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_component_message",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(changed.calls.componentMessageExecute, 0)

  const receipt = {
    activityId: "activity-component-1",
    error: null,
    guildId: GUILD_ID,
    messageId: MESSAGE_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept" as const,
      content: { approve: true },
    }),
    serviceOverrides: {
      componentMessageError: new ComponentMessageOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      notifyUserIds: [USER_ID],
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_component_message",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(COMPONENT_MESSAGE_OPERATION_KEY),
  )

  const uncertain = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept" as const,
      content: { approve: true },
    }),
    serviceOverrides: {
      componentMessageError: new ComponentMessageExecutionError(
        "Discord component-message outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      action: "create",
      channelId: CHANNEL_ID,
      components: COMPONENT_LAYOUT,
      notifyUserIds: [USER_ID],
      operationKey: COMPONENT_MESSAGE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_component_message",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")
})

test("MCP reaction moderation accepts exact scope-specific plans", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const emoji = `party:${USER_ID}`
  const common = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: REACTION_MODERATION_OPERATION_KEY,
  }

  const all = await client.callTool({
    arguments: { ...common, scope: "all" },
    name: "plan_reaction_moderation",
  })
  const oneEmoji = await client.callTool({
    arguments: { ...common, emoji, scope: "emoji" },
    name: "plan_reaction_moderation",
  })
  const oneUser = await client.callTool({
    arguments: { ...common, emoji, scope: "user", userId: USER_ID },
    name: "plan_reaction_moderation",
  })
  const mixedAll = await client.callTool({
    arguments: { ...common, emoji, scope: "all" },
    name: "plan_reaction_moderation",
  })
  const missingUser = await client.callTool({
    arguments: { ...common, emoji, scope: "user" },
    name: "plan_reaction_moderation",
  })

  assert.equal(structuredContent(all).status, "planned")
  assert.equal(structuredContent(oneEmoji).status, "planned")
  assert.equal(structuredContent(oneUser).status, "planned")
  assert.equal(mixedAll.isError, true)
  assert.equal(missingUser.isError, true)
  assert.equal(calls.reactionModerationPlan, 3)
})

test("MCP reaction moderation binds signed approval to the exact target", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const emoji = `party:${USER_ID}`

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      emoji,
      messageId: MESSAGE_ID,
      operationKey: REACTION_MODERATION_OPERATION_KEY,
      planDigest: DIGEST,
      scope: "user",
      userId: USER_ID,
    },
    name: "execute_reaction_moderation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.reactionModerationPlan, 1)
  assert.equal(calls.reactionModerationExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, /Target scope: user/)
  assert.match(confirmationMessage, /MANAGE_MESSAGES: true/)
  assert.match(confirmationMessage, /Local audit reason:/)
  assert.match(confirmationMessage, /untrusted/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.doesNotMatch(confirmationMessage, /Author:/)
  assert.doesNotMatch(confirmationMessage, /Content:/)
  assert.doesNotMatch(confirmationMessage, new RegExp(REACTION_MODERATION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(REACTION_MODERATION_OPERATION_KEY),
  )
})

test("MCP reaction moderation skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    emoji: `party:${USER_ID}`,
    messageId: MESSAGE_ID,
    operationKey: REACTION_MODERATION_OPERATION_KEY,
    planDigest: DIGEST,
    scope: "emoji" as const,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { reactionModerationWriteRequired: false },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_reaction_moderation",
  })
  assert.equal(structuredContent(noOpResult).status, "already-absent")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.reactionModerationExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_reaction_moderation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.reactionModerationExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { reactionModerationPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_reaction_moderation",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.reactionModerationExecute, 0)
})

test("MCP reaction moderation signed state rejects target changes", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    emoji: `party:${USER_ID}`,
    messageId: MESSAGE_ID,
    operationKey: REACTION_MODERATION_OPERATION_KEY,
    planDigest: DIGEST,
    scope: "user" as const,
    userId: USER_ID,
  }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "execute_reaction_moderation",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: { ...request, userId: BOT_ID },
      inputResponses: {
        confirm_reaction_moderation: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_reaction_moderation",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.reactionModerationExecute, 0)
})

test("MCP reaction moderation exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: REACTION_MODERATION_OPERATION_KEY,
    planDigest: DIGEST,
    scope: "all" as const,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      reactionModerationError: new ReactionModerationExecutionError(
        "Discord reaction-moderation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_reaction_moderation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-reaction-moderation",
    error: null,
    guildId: GUILD_ID,
    messageId: MESSAGE_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      reactionModerationError: new ReactionModerationOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_reaction_moderation",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(REACTION_MODERATION_OPERATION_KEY),
  )
})

test("MCP message pins list current timestamp-paginated pin pages", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: {
      before: "2026-08-20T00:00:00.000Z",
      channelId: CHANNEL_ID,
      limit: 25,
    },
    name: "list_message_pins",
  })
  const invalidCursor = await client.callTool({
    arguments: {
      before: MESSAGE_ID,
      channelId: CHANNEL_ID,
    },
    name: "list_message_pins",
  })
  const invalidLimit = await client.callTool({
    arguments: { channelId: CHANNEL_ID, limit: 51 },
    name: "list_message_pins",
  })

  assert.equal(structuredContent(listed).status, "ok")
  assert.equal((structuredContent(listed).page as Record<string, unknown>).requestedLimit, 25)
  assert.equal((structuredContent(listed).pins as unknown[]).length, 1)
  assert.equal(invalidCursor.isError, true)
  assert.equal(invalidLimit.isError, true)
  assert.equal(calls.messagePinList, 1)
})

test("MCP message pins validate exact reviewed plan inputs", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "pinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
    },
    name: "plan_message_pin",
  })
  const invalidState = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "toggle",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
    },
    name: "plan_message_pin",
  })
  const shortKey = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "unpinned",
      messageId: MESSAGE_ID,
      operationKey: "short",
    },
    name: "plan_message_pin",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(invalidState.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(calls.messagePinPlan, 1)
})

test("MCP message pins bind signed approval to the exact pin transition", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "pinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_message_pin",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.messagePinPlan, 1)
  assert.equal(calls.messagePinExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Current pinned state: false/)
  assert.match(confirmationMessage, /Desired pinned state: true/)
  assert.match(confirmationMessage, /PIN_MESSAGES: true/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(MESSAGE_PIN_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(MESSAGE_PIN_OPERATION_KEY),
  )
})

test("MCP message pins skip confirmation for no-ops and stop on refusal or drift", async (context) => {
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { messagePinAction: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "unpinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_message_pin",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.messagePinExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "unpinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_message_pin",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.messagePinExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { messagePinPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "pinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_message_pin",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.messagePinExecute, 0)
})

test("MCP message pins expose uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      messagePinError: new MessagePinExecutionError(
        "Discord message pin outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "pinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_message_pin",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-message-pin",
    error: null,
    guildId: GUILD_ID,
    messageId: MESSAGE_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-20T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      messagePinError: new MessagePinOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      desiredState: "unpinned",
      messageId: MESSAGE_ID,
      operationKey: MESSAGE_PIN_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_message_pin",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(MESSAGE_PIN_OPERATION_KEY),
  )
})

test("MCP announcement crossposts validate exact reviewed plan inputs", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
    },
    name: "plan_announcement_crosspost",
  })
  const invalidChannel = await client.callTool({
    arguments: {
      channelId: "bad",
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
    },
    name: "plan_announcement_crosspost",
  })
  const shortKey = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: "short",
    },
    name: "plan_announcement_crosspost",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(invalidChannel.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(calls.announcementCrosspostPlan, 1)
})

test("MCP announcement crossposts bind signed approval to exact irreversible fanout", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.announcementCrosspostPlan, 1)
  assert.equal(calls.announcementCrosspostExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Authorship class: other/)
  assert.match(confirmationMessage, /Message Content intent: enabled/)
  assert.match(confirmationMessage, /SEND_MESSAGES: true/)
  assert.match(confirmationMessage, /MANAGE_MESSAGES: true/)
  assert.match(confirmationMessage, /fanout can cross the source guild boundary/)
  assert.match(confirmationMessage, /cannot roll back/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(ANNOUNCEMENT_CROSSPOST_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(ANNOUNCEMENT_CROSSPOST_OPERATION_KEY),
  )
})

test("MCP announcement crossposts skip no-op confirmation and stop on refusal or drift", async (context) => {
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { announcementCrosspostAction: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })
  assert.equal(structuredContent(noOpResult).status, "already-crossposted")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.announcementCrosspostExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.announcementCrosspostExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: {
      announcementCrosspostPlanDigest: DIFFERENT_DIGEST,
    },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.announcementCrosspostExecute, 0)
})

test("MCP announcement crossposts expose uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      announcementCrosspostError: new AnnouncementCrosspostExecutionError(
        "Discord announcement-crosspost outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-announcement-crosspost",
    error: null,
    guildId: GUILD_ID,
    messageId: MESSAGE_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      announcementCrosspostError:
        new AnnouncementCrosspostOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: ANNOUNCEMENT_CROSSPOST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_announcement_crosspost",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(ANNOUNCEMENT_CROSSPOST_OPERATION_KEY),
  )
})

test("MCP announcement subscriptions expose exact audit and action-specific plans", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { targetChannelId: CHANNEL_ID },
    name: "list_announcement_subscriptions",
  })
  const subscribe = await client.callTool({
    arguments: {
      action: "subscribe",
      auditReason: AUDIT_REASON,
      operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
      sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
      targetChannelId: CHANNEL_ID,
    },
    name: "plan_announcement_subscription",
  })
  const unsubscribe = await client.callTool({
    arguments: {
      action: "unsubscribe",
      auditReason: AUDIT_REASON,
      operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
      targetChannelId: CHANNEL_ID,
      webhookId: ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
    },
    name: "plan_announcement_subscription",
  })
  const mixedSubscribe = await client.callTool({
    arguments: {
      action: "subscribe",
      auditReason: AUDIT_REASON,
      operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
      sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
      targetChannelId: CHANNEL_ID,
      webhookId: ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
    },
    name: "plan_announcement_subscription",
  })
  const mixedUnsubscribe = await client.callTool({
    arguments: {
      action: "unsubscribe",
      auditReason: AUDIT_REASON,
      operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
      sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
      targetChannelId: CHANNEL_ID,
      webhookId: ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
    },
    name: "plan_announcement_subscription",
  })

  assert.equal(structuredContent(listed).status, "ok")
  assert.equal(
    (structuredContent(listed).privacy as Record<string, unknown>).messageDataAccessed,
    false,
  )
  assert.equal(structuredContent(subscribe).action, "subscribe")
  assert.equal(structuredContent(unsubscribe).action, "unsubscribe")
  assert.equal(mixedSubscribe.isError, true)
  assert.equal(mixedUnsubscribe.isError, true)
  assert.equal(calls.announcementSubscriptionList, 1)
  assert.equal(calls.announcementSubscriptionPlan, 2)
})

test("MCP announcement subscription approval reviews minimized evidence while binding complete inventory", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "subscribe",
      auditReason: AUDIT_REASON,
      operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
      planDigest: DIGEST,
      sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
      targetChannelId: CHANNEL_ID,
    },
    name: "execute_announcement_subscription",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.announcementSubscriptionPlan, 1)
  assert.equal(calls.announcementSubscriptionExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(ANNOUNCEMENT_SOURCE_CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, /Target webhook inventory: 0 of 15/)
  assert.match(confirmationMessage, /Target bot MANAGE_WEBHOOKS: true/)
  assert.match(confirmationMessage, /Message data accessed: false/)
  assert.match(confirmationMessage, /future published announcement/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY),
  )
})

test("MCP announcement subscriptions skip exact no-ops and stop on refusal or drift", async (context) => {
  const argumentsValue = {
    action: "subscribe" as const,
    auditReason: AUDIT_REASON,
    operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
    planDigest: DIGEST,
    sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
    targetChannelId: CHANNEL_ID,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { announcementSubscriptionWriteRequired: false },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_announcement_subscription",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.announcementSubscriptionExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_announcement_subscription",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.announcementSubscriptionExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: {
      announcementSubscriptionPlanDigest: DIFFERENT_DIGEST,
    },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_announcement_subscription",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.announcementSubscriptionExecute, 0)
})

test("MCP announcement subscription signed state rejects action target changes", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = {
    action: "subscribe" as const,
    auditReason: AUDIT_REASON,
    operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
    planDigest: DIGEST,
    sourceChannelId: ANNOUNCEMENT_SOURCE_CHANNEL_ID,
    targetChannelId: CHANNEL_ID,
  }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "execute_announcement_subscription",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: { ...request, sourceChannelId: PARENT_ID },
      inputResponses: {
        confirm_announcement_subscription: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_announcement_subscription",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.announcementSubscriptionExecute, 0)
})

test("MCP announcement subscriptions expose uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "unsubscribe" as const,
    auditReason: AUDIT_REASON,
    operationKey: ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY,
    planDigest: DIGEST,
    targetChannelId: CHANNEL_ID,
    webhookId: ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      announcementSubscriptionError: new AnnouncementSubscriptionExecutionError(
        "Discord announcement subscription outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_announcement_subscription",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-announcement-subscription",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-23T00:00:00.000Z",
    verification: "match",
    webhookId: ANNOUNCEMENT_SUBSCRIPTION_WEBHOOK_ID,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      announcementSubscriptionError:
        new AnnouncementSubscriptionOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_announcement_subscription",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(ANNOUNCEMENT_SUBSCRIPTION_OPERATION_KEY),
  )
})

test("MCP managed native command planning is exact and signed approval binds execution", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const setup = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const planned = await setup.client.callTool({
    arguments: {
      action: "install",
      guildId: GUILD_ID,
      operationKey: NATIVE_INTERACTION_COMMAND_OPERATION_KEY,
    },
    name: "plan_native_interaction_command",
  })
  assert.equal(structuredContent(planned).mutation, "create")
  assert.equal(setup.nativeInteractionCommandCalls.plan, 1)

  const result = await setup.client.callTool({
    arguments: {
      action: "install",
      guildId: GUILD_ID,
      operationKey: NATIVE_INTERACTION_COMMAND_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_native_interaction_command",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(setup.nativeInteractionCommandCalls.plan, 2)
  assert.equal(setup.nativeInteractionCommandCalls.execute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, /Command name: discord-mcp/)
  assert.match(confirmationMessage, /Default member permissions: 0/)
  assert.match(confirmationMessage, /Guild only: true/)
  assert.match(confirmationMessage, /Request option maximum length: 2000/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(NATIVE_INTERACTION_COMMAND_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(NATIVE_INTERACTION_COMMAND_OPERATION_KEY),
  )
})

test("MCP managed native command execution skips no-ops and stops on refusal or drift", async (context) => {
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { nativeInteractionCommandMutation: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: {
      action: "install",
      guildId: GUILD_ID,
      operationKey: NATIVE_INTERACTION_COMMAND_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_native_interaction_command",
  })
  assert.equal(structuredContent(noOpResult).status, "already-installed")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.nativeInteractionCommandCalls.execute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "install",
      guildId: GUILD_ID,
      operationKey: NATIVE_INTERACTION_COMMAND_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_native_interaction_command",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.nativeInteractionCommandCalls.execute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { nativeInteractionCommandPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: {
      action: "install",
      guildId: GUILD_ID,
      operationKey: NATIVE_INTERACTION_COMMAND_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_native_interaction_command",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.nativeInteractionCommandCalls.execute, 0)
})

test("MCP poll reads preserve exact answer IDs and return voter IDs only", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const exact = await client.callTool({
    arguments: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
    name: "get_poll",
  })
  const voters = await client.callTool({
    arguments: {
      answerId: 7,
      channelId: CHANNEL_ID,
      limit: 25,
      messageId: MESSAGE_ID,
    },
    name: "list_poll_answer_voters",
  })
  const invalid = await client.callTool({
    arguments: {
      answerId: 0,
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    },
    name: "list_poll_answer_voters",
  })

  const exactPoll = structuredContent(exact).poll as {
    answers: Array<{ answerId: number }>
    question: string
    resultState: string
  }
  assert.deepEqual(exactPoll.answers.map(({ answerId }) => answerId), [7, 3])
  assert.equal(exactPoll.question, POLL_QUESTION)
  assert.equal(exactPoll.resultState, "approximate")
  assert.deepEqual(structuredContent(voters).voterUserIds, [USER_ID])
  assert.equal(JSON.stringify(voters).includes("username"), false)
  assert.equal(invalid.isError, true)
  assert.equal(calls.pollGet, 1)
  assert.equal(calls.pollVoters, 1)
})

test("MCP poll planning enforces bounded exact creation and ending inputs", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const created = await client.callTool({
    arguments: {
      answers: [
        { emoji: "🔒", text: POLL_ANSWER_ONE },
        { text: POLL_ANSWER_TWO },
      ],
      channelId: CHANNEL_ID,
      operationKey: POLL_CREATION_OPERATION_KEY,
      question: POLL_QUESTION,
    },
    name: "plan_poll_creation",
  })
  const ended = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: POLL_END_OPERATION_KEY,
    },
    name: "plan_poll_end",
  })
  const tooFewAnswers = await client.callTool({
    arguments: {
      answers: [{ text: POLL_ANSWER_ONE }],
      channelId: CHANNEL_ID,
      operationKey: POLL_CREATION_OPERATION_KEY,
      question: POLL_QUESTION,
    },
    name: "plan_poll_creation",
  })
  const tooLongDuration = await client.callTool({
    arguments: {
      answers: [{ text: POLL_ANSWER_ONE }, { text: POLL_ANSWER_TWO }],
      channelId: CHANNEL_ID,
      durationHours: 769,
      operationKey: POLL_CREATION_OPERATION_KEY,
      question: POLL_QUESTION,
    },
    name: "plan_poll_creation",
  })

  assert.equal(structuredContent(created).status, "planned")
  assert.equal(
    (structuredContent(created).target as Record<string, unknown>).durationHours,
    24,
  )
  assert.equal(structuredContent(ended).status, "planned")
  assert.equal(tooFewAnswers.isError, true)
  assert.equal(tooLongDuration.isError, true)
  assert.equal(calls.pollCreationPlan, 1)
  assert.equal(calls.pollEndPlan, 1)
})

test("MCP poll creation binds signed approval to every immutable field", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      allowMultiselect: true,
      answers: [
        { emoji: "🔒", text: POLL_ANSWER_ONE },
        { text: POLL_ANSWER_TWO },
      ],
      channelId: CHANNEL_ID,
      durationHours: 72,
      operationKey: POLL_CREATION_OPERATION_KEY,
      planDigest: DIGEST,
      question: POLL_QUESTION,
    },
    name: "execute_poll_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.pollCreationPlan, 1)
  assert.equal(calls.pollCreationExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(POLL_QUESTION.replace("?", "\\?")))
  assert.match(confirmationMessage, new RegExp(POLL_ANSWER_ONE))
  assert.match(confirmationMessage, /Duration hours: 72/u)
  assert.match(confirmationMessage, /Allow multiple answers: true/u)
  assert.match(confirmationMessage, /SEND_POLLS/u)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted transient Discord data/u)
  assert.doesNotMatch(confirmationMessage, new RegExp(POLL_CREATION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(POLL_CREATION_OPERATION_KEY),
  )
})

test("MCP poll ending binds signed approval to exact live counts", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: POLL_END_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_poll_end",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.pollEndPlan, 1)
  assert.equal(calls.pollEndExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Answer ID 7/u)
  assert.match(confirmationMessage, /count 4/u)
  assert.match(confirmationMessage, /Ending a poll is irreversible/u)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.doesNotMatch(confirmationMessage, new RegExp(POLL_END_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(POLL_END_OPERATION_KEY))
})

test("MCP poll writes stop on refusal or drift and skip approval for an ended poll", async (context) => {
  const declinedCreation = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedCreationResult = await declinedCreation.client.callTool({
    arguments: {
      answers: [{ text: POLL_ANSWER_ONE }, { text: POLL_ANSWER_TWO }],
      channelId: CHANNEL_ID,
      operationKey: POLL_CREATION_OPERATION_KEY,
      planDigest: DIGEST,
      question: POLL_QUESTION,
    },
    name: "execute_poll_creation",
  })
  assert.equal(structuredContent(declinedCreationResult).status, "confirmation-declined")
  assert.equal(declinedCreation.calls.pollCreationExecute, 0)

  let changedConfirmations = 0
  const changedEnd = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { pollEndPlanDigest: DIFFERENT_DIGEST },
  })
  const changedEndResult = await changedEnd.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: POLL_END_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_poll_end",
  })
  assert.equal(structuredContent(changedEndResult).status, "plan-changed")
  assert.equal(changedEndResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changedEnd.calls.pollEndExecute, 0)

  let noOpConfirmations = 0
  const noOpEnd = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { pollEndWriteRequired: false },
  })
  const noOpEndResult = await noOpEnd.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: POLL_END_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_poll_end",
  })
  assert.equal(structuredContent(noOpEndResult).status, "already-ended")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOpEnd.calls.pollEndExecute, 1)
})

test("MCP poll writes expose uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      pollCreationError: new PollExecutionError(
        "Discord poll creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      answers: [{ text: POLL_ANSWER_ONE }, { text: POLL_ANSWER_TWO }],
      channelId: CHANNEL_ID,
      operationKey: POLL_CREATION_OPERATION_KEY,
      planDigest: DIGEST,
      question: POLL_QUESTION,
    },
    name: "execute_poll_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-poll-end",
    error: null,
    guildId: GUILD_ID,
    messageId: MESSAGE_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    planDigest: DIGEST,
    status: "completed",
    timestamp: "2026-08-20T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      pollEndError: new PollOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      operationKey: POLL_END_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_poll_end",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(POLL_END_OPERATION_KEY))
})

test("MCP webhook reads expose only bounded credential-redacted evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { channelId: CHANNEL_ID },
    name: "list_channel_webhooks",
  })
  const exact = await client.callTool({
    arguments: { channelId: CHANNEL_ID, webhookId: WEBHOOK_ID },
    name: "get_channel_webhook",
  })
  const invalid = await client.callTool({
    arguments: { channelId: CHANNEL_ID, webhookId: "invalid" },
    name: "get_channel_webhook",
  })

  const listedContent = structuredContent(listed)
  const exactContent = structuredContent(exact)
  const listedWebhook = (listedContent.webhooks as Array<Record<string, unknown>>)[0]
  const exactWebhook = exactContent.webhook as Record<string, unknown>
  const expectedKeys = [
    "applicationId",
    "channelId",
    "createdAt",
    "creatorUserId",
    "guildId",
    "name",
    "type",
    "webhookId",
  ]

  assert.equal(listedContent.status, "ok")
  assert.equal(exactContent.status, "ok")
  assert.deepEqual(Object.keys(listedWebhook || {}).sort(), expectedKeys)
  assert.deepEqual(Object.keys(exactWebhook).sort(), expectedKeys)
  assert.equal(listedWebhook?.webhookId, WEBHOOK_ID)
  assert.equal(exactWebhook.webhookId, WEBHOOK_ID)
  assert.equal(
    (listedContent.privacy as Record<string, unknown>).credentialsProjectedOut,
    true,
  )
  assert.equal(invalid.isError, true)
  assert.equal(calls.webhookDeletionList, 1)
  assert.equal(calls.webhookDeletionGet, 1)
})

test("MCP webhook administration plans are strict and credential-free", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const creation = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    name: "Deploy relay",
    operationKey: WEBHOOK_CREATION_OPERATION_KEY,
  }
  const change = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    destinationChannelId: PARENT_ID,
    name: "Renamed relay",
    operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
    webhookId: WEBHOOK_ID,
  }
  const plannedCreation = await client.callTool({
    arguments: creation,
    name: "plan_webhook_creation",
  })
  const plannedChange = await client.callTool({
    arguments: change,
    name: "plan_webhook_change",
  })
  const credentialInput = await client.callTool({
    arguments: { ...creation, token: "credential-must-be-rejected" },
    name: "plan_webhook_creation",
  })
  const reservedName = await client.callTool({
    arguments: { ...creation, name: "Discord relay" },
    name: "plan_webhook_creation",
  })
  const emptyChange = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
      webhookId: WEBHOOK_ID,
    },
    name: "plan_webhook_change",
  })

  const creationContent = structuredContent(plannedCreation)
  const changeContent = structuredContent(plannedChange)
  assert.equal(creationContent.status, "planned")
  assert.equal(
    (creationContent.privacy as Record<string, unknown>).credentialsProjectedOut,
    true,
  )
  assert.deepEqual(
    (changeContent as { changedFields: unknown }).changedFields,
    ["channelId", "name"],
  )
  assert.equal(credentialInput.isError, true)
  assert.equal(reservedName.isError, true)
  assert.equal(emptyChange.isError, true)
  assert.equal(calls.webhookCreationPlan, 1)
  assert.equal(calls.webhookChangePlan, 1)
})

test("MCP webhook creation binds signed approval to complete credential-free evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      name: "Deploy relay",
      operationKey: WEBHOOK_CREATION_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_webhook_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.webhookCreationPlan, 1)
  assert.equal(calls.webhookCreationExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    WEBHOOK_ID,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Desired webhook name: "Deploy relay"/)
  assert.match(confirmationMessage, /Source webhook inventory: 1 of 15/)
  assert.match(confirmationMessage, /bot MANAGE_WEBHOOKS: true/i)
  assert.match(confirmationMessage, /bearer credential/i)
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(WEBHOOK_CREATION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(WEBHOOK_CREATION_OPERATION_KEY),
  )
})

test("MCP webhook changes bind approval to source and destination evidence and skip no-ops", async (context) => {
  let confirmationMessage = ""
  const changed = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
  })
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    destinationChannelId: PARENT_ID,
    name: "Renamed relay",
    operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
    planDigest: DIGEST,
    webhookId: WEBHOOK_ID,
  }
  const result = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_webhook_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(changed.calls.webhookChangePlan, 1)
  assert.equal(changed.calls.webhookChangeExecute, 1)
  assert.match(confirmationMessage, /Requested fields: \["channelId","name"\]/)
  assert.match(confirmationMessage, /Source exact credential-redacted webhooks:/)
  assert.match(confirmationMessage, /Destination exact credential-redacted webhooks:/)
  assert.match(confirmationMessage, new RegExp(PARENT_ID))
  assert.match(confirmationMessage, new RegExp(WEBHOOK_ID))
  assert.doesNotMatch(confirmationMessage, new RegExp(WEBHOOK_CHANGE_OPERATION_KEY))

  const noOp = await connectedFixture(context, {
    serviceOverrides: { webhookChangeWriteRequired: false },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      name: "Private webhook name",
      operationKey: "webhook-change-noop-0001",
      planDigest: DIGEST,
      webhookId: WEBHOOK_ID,
    },
    name: "execute_webhook_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOp.calls.webhookChangeExecute, 1)
})

test("MCP webhook administration signed state rejects changed intent", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const creationRequest = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    name: "Deploy relay",
    operationKey: WEBHOOK_CREATION_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const creationInitial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: creationRequest,
      name: "execute_webhook_creation",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })
  assert.equal(creationInitial.resultType, "input_required")
  const changedCreation = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: { ...creationRequest, name: "Different relay" },
      inputResponses: {
        confirm_webhook_creation: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_webhook_creation",
      requestState: creationInitial.requestState,
    },
  }, specTypeSchemas.CallToolResult)
  assert.equal(structuredContent(changedCreation).status, "confirmation-invalid")

  const changeRequest = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    destinationChannelId: PARENT_ID,
    operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
    planDigest: DIGEST,
    webhookId: WEBHOOK_ID,
  }
  const changeInitial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: changeRequest,
      name: "execute_webhook_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })
  assert.equal(changeInitial.resultType, "input_required")
  const changedDestination = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: { ...changeRequest, destinationChannelId: CHANNEL_ID },
      inputResponses: {
        confirm_webhook_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_webhook_change",
      requestState: changeInitial.requestState,
    },
  }, specTypeSchemas.CallToolResult)
  assert.equal(structuredContent(changedDestination).status, "confirmation-invalid")
  assert.equal(fixture.calls.webhookCreationExecute, 0)
  assert.equal(fixture.calls.webhookChangeExecute, 0)
})

test("MCP webhook administration stops on refusal, plan drift, uncertainty, and key reuse", async (context) => {
  const creationArguments = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    name: "Deploy relay",
    operationKey: WEBHOOK_CREATION_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: creationArguments,
    name: "execute_webhook_creation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.webhookCreationExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { webhookChangePlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      name: "Renamed relay",
      operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
      planDigest: DIGEST,
      webhookId: WEBHOOK_ID,
    },
    name: "execute_webhook_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.webhookChangeExecute, 0)

  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      webhookCreationError: new WebhookCreationExecutionError(
        "Discord webhook creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: creationArguments,
    name: "execute_webhook_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const uncertainChange = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      webhookChangeError: new WebhookChangeExecutionError(
        "Discord webhook change outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainChangeResult = await uncertainChange.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      name: "Renamed relay",
      operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
      planDigest: DIGEST,
      webhookId: WEBHOOK_ID,
    },
    name: "execute_webhook_change",
  })
  assert.equal(structuredContent(uncertainChangeResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-webhook-change",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
    webhookId: WEBHOOK_ID,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      webhookChangeError: new WebhookChangeOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      name: "Renamed relay",
      operationKey: WEBHOOK_CHANGE_OPERATION_KEY,
      planDigest: DIGEST,
      webhookId: WEBHOOK_ID,
    },
    name: "execute_webhook_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(WEBHOOK_CHANGE_OPERATION_KEY))

  const creationConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      webhookCreationError: new WebhookCreationOperationConflictError(receipt),
    },
  })
  const creationConflictResult = await creationConflict.client.callTool({
    arguments: creationArguments,
    name: "execute_webhook_creation",
  })
  assert.equal(
    structuredContent(creationConflictResult).status,
    "operation-key-conflict",
  )
  assert.doesNotMatch(
    JSON.stringify(creationConflictResult),
    new RegExp(WEBHOOK_CREATION_OPERATION_KEY),
  )
})

test("MCP webhook deletion plans reject credentials and unsafe operation keys", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const request = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    operationKey: WEBHOOK_OPERATION_KEY,
    webhookId: WEBHOOK_ID,
  }
  const planned = await client.callTool({
    arguments: request,
    name: "plan_webhook_deletion",
  })
  const credentialInput = await client.callTool({
    arguments: {
      ...request,
      token: "credential-must-be-rejected",
    },
    name: "plan_webhook_deletion",
  })
  const shortKey = await client.callTool({
    arguments: { ...request, operationKey: "short" },
    name: "plan_webhook_deletion",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.equal((content.target as Record<string, unknown>).webhookId, WEBHOOK_ID)
  assert.equal(
    (content.privacy as Record<string, unknown>).credentialsProjectedOut,
    true,
  )
  assert.equal(credentialInput.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(calls.webhookDeletionPlan, 1)
})

test("MCP webhook deletion binds signed approval to exact redacted evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      operationKey: WEBHOOK_OPERATION_KEY,
      planDigest: DIGEST,
      webhookId: WEBHOOK_ID,
    },
    name: "execute_webhook_deletion",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.webhookDeletionPlan, 1)
  assert.equal(calls.webhookDeletionExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    WEBHOOK_ID,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Webhook type: incoming/)
  assert.match(confirmationMessage, /Bot VIEW_CHANNEL: true/)
  assert.match(confirmationMessage, /Bot MANAGE_WEBHOOKS: true/)
  assert.match(confirmationMessage, /Credential and private fields omitted:/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(WEBHOOK_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(WEBHOOK_OPERATION_KEY),
  )
})

test("MCP webhook deletion stops on refusal or fresh-plan drift", async (context) => {
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    operationKey: WEBHOOK_OPERATION_KEY,
    planDigest: DIGEST,
    webhookId: WEBHOOK_ID,
  }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_webhook_deletion",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.webhookDeletionExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { webhookDeletionPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_webhook_deletion",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.webhookDeletionExecute, 0)
})

test("MCP webhook deletion exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    operationKey: WEBHOOK_OPERATION_KEY,
    planDigest: DIGEST,
    webhookId: WEBHOOK_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      webhookDeletionError: new WebhookDeletionExecutionError(
        "Discord webhook deletion outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_webhook_deletion",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-webhook-deletion",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
    webhookId: WEBHOOK_ID,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      webhookDeletionError: new WebhookDeletionOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_webhook_deletion",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(WEBHOOK_OPERATION_KEY),
  )
})

test("MCP integration reads expose only bounded privacy-safe evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_guild_integrations",
  })
  const invalid = await client.callTool({
    arguments: { guildId: "invalid" },
    name: "list_guild_integrations",
  })

  const content = structuredContent(listed)
  const projected = (content.integrations as Array<Record<string, unknown>>)[0]
  assert.equal(content.status, "ok")
  assert.deepEqual(Object.keys(projected || {}).sort(), [
    "accountPresent",
    "applicationId",
    "associatedBotUserId",
    "enableEmoticons",
    "enabled",
    "expireBehavior",
    "expireGracePeriod",
    "id",
    "knownScopes",
    "linkedUserPresent",
    "revoked",
    "roleId",
    "subscriberCount",
    "syncedAt",
    "syncing",
    "type",
    "unknownFieldCounts",
    "unknownScopeCount",
  ])
  assert.equal(projected?.id, INTEGRATION_ID)
  assert.equal(
    (content.privacy as Record<string, unknown>).namesAndProfilesProjectedOut,
    true,
  )
  assert.equal(
    (content.page as Record<string, unknown>).inventoryComplete,
    true,
  )
  assert.equal(invalid.isError, true)
  assert.equal(calls.integrationDeletionList, 1)
  assert.doesNotMatch(
    JSON.stringify(listed),
    /private-integration|private-account|private-application|private-user/,
  )
})

test("MCP integration deletion plans reject extra identity fields and unsafe keys", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const request = {
    acknowledgeAssociatedBotKicked: true,
    acknowledgeAssociatedWebhooksRemoved: true,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKey: INTEGRATION_OPERATION_KEY,
  }
  const planned = await client.callTool({
    arguments: request,
    name: "plan_guild_integration_deletion",
  })
  const identityInput = await client.callTool({
    arguments: {
      ...request,
      accountName: "private-account-name",
    },
    name: "plan_guild_integration_deletion",
  })
  const shortKey = await client.callTool({
    arguments: { ...request, operationKey: "short" },
    name: "plan_guild_integration_deletion",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.equal((content.target as Record<string, unknown>).id, INTEGRATION_ID)
  assert.equal(
    (content.privacy as Record<string, unknown>).externalAccountIdentitiesProjectedOut,
    true,
  )
  assert.equal(identityInput.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(calls.integrationDeletionPlan, 1)
})

test("MCP integration deletion binds signed approval to exact side effects", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      acknowledgeAssociatedBotKicked: true,
      acknowledgeAssociatedWebhooksRemoved: true,
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      integrationId: INTEGRATION_ID,
      operationKey: INTEGRATION_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_guild_integration_deletion",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.integrationDeletionPlan, 1)
  assert.equal(calls.integrationDeletionExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    INTEGRATION_ID,
    INTEGRATION_APPLICATION_ID,
    INTEGRATION_BOT_ID,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Integration type: discord/)
  assert.match(confirmationMessage, /Integration role ID:/)
  assert.match(confirmationMessage, /Integration enabled: true/)
  assert.match(confirmationMessage, /Inventory identities:/)
  assert.match(confirmationMessage, /Associated webhook removal acknowledged: true/)
  assert.match(confirmationMessage, /Associated bot kick acknowledged: true/)
  assert.match(confirmationMessage, /Bot MANAGE_GUILD: true/)
  assert.match(confirmationMessage, /Inventory complete: true/)
  assert.match(confirmationMessage, /Known OAuth scopes:/)
  assert.match(confirmationMessage, /Unknown field counts:/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(INTEGRATION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(INTEGRATION_OPERATION_KEY),
  )
})

test("MCP integration deletion stops on refusal, plan drift, uncertainty, and reuse", async (context) => {
  const argumentsValue = {
    acknowledgeAssociatedBotKicked: true,
    acknowledgeAssociatedWebhooksRemoved: true,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKey: INTEGRATION_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_integration_deletion",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.integrationDeletionExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { integrationDeletionPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_integration_deletion",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.integrationDeletionExecute, 0)

  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      integrationDeletionError: new IntegrationDeletionExecutionError(
        "Discord integration deletion outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_integration_deletion",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-integration-deletion",
    error: null,
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      integrationDeletionError:
        new IntegrationDeletionOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_integration_deletion",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(INTEGRATION_OPERATION_KEY),
  )
})

test("MCP invite reads expose only opaque capability-safe evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { guildId: GUILD_ID, limit: 7 },
    name: "list_guild_invites",
  })
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, inviteRef: INVITE_REF },
    name: "get_guild_invite",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID, inviteRef: PRIVATE_INVITE_CODE },
    name: "get_guild_invite",
  })

  const listedContent = structuredContent(listed)
  const exactContent = structuredContent(exact)
  const listedInvite = (listedContent.invites as Array<Record<string, unknown>>)[0]
  const exactInvite = exactContent.invite as Record<string, unknown>
  const expectedKeys = [
    "channel",
    "createdAt",
    "expiresAt",
    "flags",
    "inviteRef",
    "inviterUserId",
    "maxAgeSeconds",
    "maxUses",
    "riskFlags",
    "roles",
    "target",
    "temporaryMembership",
    "uses",
  ]

  assert.equal(listedContent.status, "ok")
  assert.equal(exactContent.status, "ok")
  assert.deepEqual(Object.keys(listedInvite || {}).sort(), expectedKeys)
  assert.deepEqual(Object.keys(exactInvite).sort(), expectedKeys)
  assert.equal(listedInvite?.inviteRef, INVITE_REF)
  assert.equal(exactInvite.inviteRef, INVITE_REF)
  assert.equal(
    (listedContent.privacy as Record<string, unknown>).capabilitiesProjectedOut,
    true,
  )
  assert.equal(invalid.isError, true)
  assert.equal(calls.inviteDeletionList, 1)
  assert.equal(calls.inviteDeletionGet, 1)
  assert.doesNotMatch(
    JSON.stringify([listed, exact, invalid]),
    new RegExp(PRIVATE_INVITE_CODE),
  )
})

test("MCP invite deletion plans reject capabilities and unsafe operation keys", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const request = {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    inviteRef: INVITE_REF,
    operationKey: INVITE_OPERATION_KEY,
  }
  const planned = await client.callTool({
    arguments: request,
    name: "plan_invite_deletion",
  })
  const capabilityInput = await client.callTool({
    arguments: {
      ...request,
      code: PRIVATE_INVITE_CODE,
    },
    name: "plan_invite_deletion",
  })
  const shortKey = await client.callTool({
    arguments: { ...request, operationKey: "short" },
    name: "plan_invite_deletion",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.equal((content.target as Record<string, unknown>).inviteRef, INVITE_REF)
  assert.equal(
    (content.privacy as Record<string, unknown>).capabilitiesProjectedOut,
    true,
  )
  assert.equal(capabilityInput.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(calls.inviteDeletionPlan, 1)
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(PRIVATE_INVITE_CODE))
})

test("MCP invite deletion binds signed approval to exact capability-safe evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      inviteRef: INVITE_REF,
      operationKey: INVITE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_invite_deletion",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.inviteDeletionPlan, 1)
  assert.equal(calls.inviteDeletionExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    INVITE_REF,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Bot MANAGE_GUILD: true/)
  assert.match(confirmationMessage, /Capability and private fields omitted:/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(INVITE_OPERATION_KEY))
  assert.doesNotMatch(confirmationMessage, new RegExp(PRIVATE_INVITE_CODE))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(INVITE_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(PRIVATE_INVITE_CODE))
})

test("MCP invite deletion stops on refusal or fresh-plan drift", async (context) => {
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    inviteRef: INVITE_REF,
    operationKey: INVITE_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_invite_deletion",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.inviteDeletionExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: argumentsValue,
    name: "execute_invite_deletion",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.inviteDeletionExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { inviteDeletionPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_invite_deletion",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.inviteDeletionExecute, 0)
})

test("MCP invite deletion exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    inviteRef: INVITE_REF,
    operationKey: INVITE_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      inviteDeletionError: new InviteDeletionExecutionError(
        "Discord invite deletion outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_invite_deletion",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-invite-deletion",
    error: null,
    guildId: GUILD_ID,
    inviteRef: INVITE_REF,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      inviteDeletionError: new InviteDeletionOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_invite_deletion",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(INVITE_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(PRIVATE_INVITE_CODE))
})

test("MCP Guild Template audit and plans expose only capability-safe evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_guild_templates",
  })
  const request = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: GUILD_TEMPLATE_OPERATION_KEY,
    templateRef: GUILD_TEMPLATE_REF,
  }
  const planned = await client.callTool({
    arguments: request,
    name: "plan_guild_template_change",
  })
  const capabilityInput = await client.callTool({
    arguments: { ...request, code: PRIVATE_GUILD_TEMPLATE_CODE },
    name: "plan_guild_template_change",
  })
  const rawReference = await client.callTool({
    arguments: { ...request, templateRef: PRIVATE_GUILD_TEMPLATE_CODE },
    name: "plan_guild_template_change",
  })
  const shortKey = await client.callTool({
    arguments: { ...request, operationKey: "short" },
    name: "plan_guild_template_change",
  })

  const listedContent = structuredContent(listed)
  const planContent = structuredContent(planned)
  const projected = (listedContent.templates as Array<Record<string, unknown>>)[0]
  assert.equal(listedContent.status, "ok")
  assert.deepEqual(listedContent.guild, { id: GUILD_ID })
  assert.equal(projected?.templateRef, GUILD_TEMPLATE_REF)
  assert.deepEqual(Object.keys(projected || {}).sort(), [
    "createdAt",
    "creatorUserId",
    "isDirty",
    "metadata",
    "structure",
    "templateRef",
    "unknownFieldCount",
    "updatedAt",
    "usageCount",
  ])
  assert.equal(planContent.status, "planned")
  assert.equal((planContent.target as Record<string, unknown>).templateRef, GUILD_TEMPLATE_REF)
  assert.deepEqual(planContent.liveStructure, guildTemplateStructure())
  assert.equal(capabilityInput.isError, true)
  assert.equal(rawReference.isError, true)
  assert.equal(shortKey.isError, true)
  assert.equal(calls.guildTemplateList, 1)
  assert.equal(calls.guildTemplatePlan, 1)
  assert.doesNotMatch(
    JSON.stringify([listed, planned, capabilityInput, rawReference, shortKey]),
    new RegExp(PRIVATE_GUILD_TEMPLATE_CODE),
  )
})

test("MCP Guild Template execution binds approval to the exact opaque capability", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "update-metadata",
      auditReason: AUDIT_REASON,
      description: "Reviewed description",
      guildId: GUILD_ID,
      name: "Reviewed template",
      operationKey: GUILD_TEMPLATE_OPERATION_KEY,
      planDigest: DIGEST,
      templateRef: GUILD_TEMPLATE_REF,
    },
    name: "execute_guild_template_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.guildTemplatePlan, 1)
  assert.equal(calls.guildTemplateExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    GUILD_TEMPLATE_REF,
    OPERATION_KEY_HASH,
    DIGEST,
    AUDIT_REASON,
    "Reviewed template",
    "Reviewed description",
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Bot ID/)
  assert.match(confirmationMessage, /Required permission confirmed: MANAGE_GUILD/)
  assert.match(confirmationMessage, /Templates in complete inventory: 1\/100/)
  assert.match(confirmationMessage, /Live channels: 1/)
  assert.match(confirmationMessage, /Live roles: 1/)
  assert.match(confirmationMessage, /Ambiguous channel identities: 0/)
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, /Private guild name/)
  assert.doesNotMatch(confirmationMessage, new RegExp(GUILD_TEMPLATE_OPERATION_KEY))
  assert.doesNotMatch(confirmationMessage, new RegExp(PRIVATE_GUILD_TEMPLATE_CODE))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(PRIVATE_GUILD_TEMPLATE_CODE),
  )
})

test("MCP Guild Template approval distinguishes omitted metadata from clearing it", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = {
    action: "update-metadata" as const,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "Reviewed template",
    operationKey: GUILD_TEMPLATE_OPERATION_KEY,
    templateRef: GUILD_TEMPLATE_REF,
  }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: { ...request, planDigest: DIGEST },
      name: "execute_guild_template_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...request,
        description: null,
        planDigest: DIGEST,
      },
      inputResponses: {
        confirm_guild_template_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_guild_template_change",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.guildTemplateExecute, 0)
})

test("MCP Guild Template execution stops on refusal or fresh-plan drift and skips no-ops", async (context) => {
  const argumentsValue = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: GUILD_TEMPLATE_OPERATION_KEY,
    planDigest: DIGEST,
    templateRef: GUILD_TEMPLATE_REF,
  }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_template_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.guildTemplateExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { guildTemplatePlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_template_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.guildTemplateExecute, 0)

  const noOp = await connectedFixture(context, {
    serviceOverrides: { guildTemplateMutation: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_template_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOp.calls.guildTemplateExecute, 1)
})

test("MCP Guild Template execution exposes uncertain and conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: GUILD_TEMPLATE_OPERATION_KEY,
    planDigest: DIGEST,
    templateRef: GUILD_TEMPLATE_REF,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildTemplateError: new GuildTemplateExecutionError(
        "Discord Guild Template outcome is uncertain",
        { status: "uncertain", templateRef: GUILD_TEMPLATE_REF },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_template_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-guild-template",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    resourceId: GUILD_TEMPLATE_REF,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildTemplateError: new GuildTemplateOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_template_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify([uncertainResult, conflictResult]),
    new RegExp(PRIVATE_GUILD_TEMPLATE_CODE),
  )
  assert.doesNotMatch(
    JSON.stringify([uncertainResult, conflictResult]),
    new RegExp(GUILD_TEMPLATE_OPERATION_KEY),
  )
})

test("MCP onboarding audit defaults to text omission and requires explicit opt-in", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const minimized = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "get_guild_onboarding",
  })
  const included = await client.callTool({
    arguments: { guildId: GUILD_ID, includeText: true },
    name: "get_guild_onboarding",
  })
  const invalid = await client.callTool({
    arguments: { guildId: "invalid" },
    name: "get_guild_onboarding",
  })

  const minimizedContent = structuredContent(minimized)
  const includedContent = structuredContent(included)
  assert.equal(
    (minimizedContent.privacy as Record<string, unknown>).text,
    "omitted",
  )
  assert.equal(
    (includedContent.privacy as Record<string, unknown>).text,
    "included",
  )
  assert.doesNotMatch(JSON.stringify(minimized), new RegExp(ONBOARDING_PROMPT_TITLE))
  assert.match(JSON.stringify(included), new RegExp(ONBOARDING_PROMPT_TITLE))
  assert.equal(invalid.isError, true)
  assert.equal(calls.onboardingGet, 2)
})

test("MCP onboarding plans preserve an exact bounded complete replacement", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const request = onboardingRequest()
  const planned = await client.callTool({
    arguments: { ...request },
    name: "plan_onboarding_change",
  })
  const duplicate = await client.callTool({
    arguments: {
      ...request,
      defaultChannelIds: [CHANNEL_ID, CHANNEL_ID],
    },
    name: "plan_onboarding_change",
  })
  const extra = await client.callTool({
    arguments: { ...request, futureField: true },
    name: "plan_onboarding_change",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.equal(content.writeRequired, true)
  assert.equal(content.operationKeyHash, OPERATION_KEY_HASH)
  assert.match(JSON.stringify(content.desired), new RegExp(ONBOARDING_PROMPT_TITLE))
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(ONBOARDING_OPERATION_KEY))
  assert.equal(duplicate.isError, true)
  assert.equal(extra.isError, true)
  assert.equal(calls.onboardingPlan, 1)
})

test("MCP onboarding execution binds approval to the complete reviewed state", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const request = onboardingRequest()

  const result = await client.callTool({
    arguments: { ...request, planDigest: DIGEST },
    name: "execute_onboarding_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.onboardingPlan, 1)
  assert.equal(calls.onboardingExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    ROLE_ID,
    OPERATION_KEY_HASH,
    ONBOARDING_PROMPT_TITLE,
    ONBOARDING_OPTION_TITLE,
    ONBOARDING_OPTION_DESCRIPTION,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /complete Discord onboarding configuration/)
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(ONBOARDING_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(ONBOARDING_OPERATION_KEY),
  )
})

test("MCP onboarding execution skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = {
    ...onboardingRequest(),
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { onboardingEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_onboarding_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.onboardingExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_onboarding_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.onboardingExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { onboardingPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_onboarding_change",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.onboardingExecute, 0)
})

test("MCP onboarding execution exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    ...onboardingRequest(),
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      onboardingError: new OnboardingExecutionError(
        "Discord onboarding outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_onboarding_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "PUT",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/onboarding`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      onboardingError: new OnboardingExecutionError(
        "Discord onboarding replacement was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: argumentsValue,
    name: "execute_onboarding_change",
  })
  const limitedStructured = structuredContent(limitedResult)
  assert.equal(limitedStructured.status, "rate-limited")
  assert.equal(
    (limitedStructured.error as Record<string, unknown>).retryAfterMs,
    2_500,
  )

  const receipt = {
    activityId: "activity-onboarding",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      onboardingError: new OnboardingOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_onboarding_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(ONBOARDING_OPERATION_KEY),
  )
})

test("MCP Welcome Screen audit defaults to text omission and requires explicit opt-in", async (context) => {
  const { client, welcomeScreenCalls } = await connectedFixture(context)
  const minimized = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "get_guild_welcome_screen",
  })
  const included = await client.callTool({
    arguments: { guildId: GUILD_ID, includeText: true },
    name: "get_guild_welcome_screen",
  })
  const invalid = await client.callTool({
    arguments: { guildId: "invalid" },
    name: "get_guild_welcome_screen",
  })

  const minimizedContent = structuredContent(minimized)
  const includedContent = structuredContent(included)
  assert.equal(
    (minimizedContent.privacy as Record<string, unknown>).text,
    "omitted",
  )
  assert.equal(
    (includedContent.privacy as Record<string, unknown>).text,
    "included",
  )
  assert.doesNotMatch(
    JSON.stringify(minimized),
    new RegExp(WELCOME_SCREEN_DESCRIPTION),
  )
  assert.match(JSON.stringify(included), new RegExp(WELCOME_SCREEN_DESCRIPTION))
  assert.equal(invalid.isError, true)
  assert.equal(welcomeScreenCalls.get, 2)
})

test("MCP Welcome Screen plans preserve an exact bounded complete replacement", async (context) => {
  const { client, welcomeScreenCalls } = await connectedFixture(context)
  const request = welcomeScreenRequest()
  const planned = await client.callTool({
    arguments: { ...request },
    name: "plan_guild_welcome_screen_change",
  })
  const duplicate = await client.callTool({
    arguments: {
      ...request,
      channels: [request.channels[0], request.channels[0]],
    },
    name: "plan_guild_welcome_screen_change",
  })
  const extra = await client.callTool({
    arguments: { ...request, futureField: true },
    name: "plan_guild_welcome_screen_change",
  })
  const invalidEmoji = await client.callTool({
    arguments: {
      ...request,
      channels: [{
        ...request.channels[0],
        emoji: { kind: "unicode", unicode: "not-an-emoji" },
      }],
    },
    name: "plan_guild_welcome_screen_change",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.equal(content.writeRequired, true)
  assert.equal(content.operationKeyHash, OPERATION_KEY_HASH)
  assert.match(
    JSON.stringify(content.desired),
    new RegExp(WELCOME_SCREEN_CHANNEL_DESCRIPTION),
  )
  assert.doesNotMatch(
    JSON.stringify(planned),
    new RegExp(WELCOME_SCREEN_OPERATION_KEY),
  )
  assert.equal(duplicate.isError, true)
  assert.equal(extra.isError, true)
  assert.equal(invalidEmoji.isError, true)
  assert.equal(welcomeScreenCalls.plan, 1)
})

test("MCP Welcome Screen execution binds approval to the complete reviewed state", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { client, welcomeScreenCalls } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const request = welcomeScreenRequest()

  const result = await client.callTool({
    arguments: { ...request, planDigest: DIGEST },
    name: "execute_guild_welcome_screen_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(welcomeScreenCalls.plan, 1)
  assert.equal(welcomeScreenCalls.execute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    OPERATION_KEY_HASH,
    WELCOME_SCREEN_DESCRIPTION,
    WELCOME_SCREEN_CHANNEL_DESCRIPTION,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /complete Discord Welcome Screen configuration/)
  assert.match(confirmationMessage, /Omitted channel entries are deleted/)
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(WELCOME_SCREEN_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(WELCOME_SCREEN_OPERATION_KEY),
  )
})

test("MCP Welcome Screen execution skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = {
    ...welcomeScreenRequest(),
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { welcomeScreenEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_welcome_screen_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.welcomeScreenCalls.execute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_welcome_screen_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.welcomeScreenCalls.execute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { welcomeScreenPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_welcome_screen_change",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.welcomeScreenCalls.execute, 0)
})

test("MCP Welcome Screen execution exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    ...welcomeScreenRequest(),
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      welcomeScreenError: new WelcomeScreenExecutionError(
        "Discord Welcome Screen outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_welcome_screen_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "PATCH",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/welcome-screen`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      welcomeScreenError: new WelcomeScreenExecutionError(
        "Discord Welcome Screen replacement was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_welcome_screen_change",
  })
  const limitedStructured = structuredContent(limitedResult)
  assert.equal(limitedStructured.status, "rate-limited")
  assert.equal(
    (limitedStructured.error as Record<string, unknown>).retryAfterMs,
    2_500,
  )

  const receipt = {
    activityId: "activity-welcome-screen",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      welcomeScreenError: new WelcomeScreenOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_welcome_screen_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(WELCOME_SCREEN_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(WELCOME_SCREEN_DESCRIPTION),
  )
})

test("MCP widget-settings audit stays authenticated and privacy-minimized", async (context) => {
  const { client, widgetSettingsCalls } = await connectedFixture(context)
  const audited = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "get_guild_widget_settings",
  })
  const invalid = await client.callTool({
    arguments: { guildId: "invalid" },
    name: "get_guild_widget_settings",
  })

  const content = structuredContent(audited)
  const privacy = content.privacy as Record<string, unknown>
  const exposure = content.publicExposure as Record<string, unknown>
  assert.equal(privacy.anonymousEndpoints, "not-called")
  assert.equal(privacy.channelNames, "omitted")
  assert.equal(privacy.memberAndPresenceData, "omitted")
  assert.equal(exposure.anonymousWidgetFetched, false)
  assert.equal(exposure.anonymousWidgetImageFetched, false)
  assert.doesNotMatch(JSON.stringify(audited), /widget\.json|widget-image/u)
  assert.equal(invalid.isError, true)
  assert.equal(widgetSettingsCalls.get, 1)
})

test("MCP widget-settings plans preserve one exact complete state", async (context) => {
  const { client, widgetSettingsCalls } = await connectedFixture(context)
  const request = widgetSettingsRequest()
  const planned = await client.callTool({
    arguments: { ...request },
    name: "plan_guild_widget_settings_change",
  })
  const cleared = await client.callTool({
    arguments: {
      ...request,
      channelId: null,
      enabled: false,
      operationKey: "widget-clear-attempt-0001",
    },
    name: "plan_guild_widget_settings_change",
  })
  const missing = await client.callTool({
    arguments: {
      auditReason: request.auditReason,
      enabled: request.enabled,
      guildId: request.guildId,
      operationKey: request.operationKey,
    },
    name: "plan_guild_widget_settings_change",
  })
  const extra = await client.callTool({
    arguments: { ...request, futureField: true },
    name: "plan_guild_widget_settings_change",
  })

  const content = structuredContent(planned)
  const authorization = content.publicExposureAuthorization as Record<string, unknown>
  assert.equal(content.status, "planned")
  assert.equal(content.writeRequired, true)
  assert.equal(content.operationKeyHash, OPERATION_KEY_HASH)
  assert.equal(authorization.required, true)
  assert.equal(authorization.satisfied, true)
  assert.equal(
    (structuredContent(cleared).desired as Record<string, unknown>).channelId,
    null,
  )
  assert.doesNotMatch(
    JSON.stringify(planned),
    new RegExp(WIDGET_SETTINGS_OPERATION_KEY),
  )
  assert.equal(missing.isError, true)
  assert.equal(extra.isError, true)
  assert.equal(widgetSettingsCalls.plan, 2)
})

test("MCP widget-settings execution binds approval to exposure consequences", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { client, widgetSettingsCalls } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const request = widgetSettingsRequest()

  const result = await client.callTool({
    arguments: { ...request, planDigest: DIGEST },
    name: "execute_guild_widget_settings_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(widgetSettingsCalls.plan, 1)
  assert.equal(widgetSettingsCalls.execute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    OPERATION_KEY_HASH,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /complete authenticated Discord widget settings/)
  assert.match(confirmationMessage, /Action-sensitive public-exposure authorization/)
  assert.match(confirmationMessage, /presence-bearing member summaries/)
  assert.match(confirmationMessage, /Manual Private Profile restoration/)
  assert.match(confirmationMessage, /Anonymous widget endpoints were not called/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(WIDGET_SETTINGS_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(WIDGET_SETTINGS_OPERATION_KEY),
  )
})

test("MCP widget-settings execution skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = {
    ...widgetSettingsRequest(),
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { widgetSettingsEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.widgetSettingsCalls.execute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.widgetSettingsCalls.execute, 0)

  const canceled = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "cancel" }),
  })
  const canceledResult = await canceled.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(canceledResult).status, "confirmation-declined")
  assert.equal(canceled.widgetSettingsCalls.execute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.widgetSettingsCalls.execute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { widgetSettingsPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.widgetSettingsCalls.execute, 0)
})

test("MCP widget-settings execution binds signed state to the exact request", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = widgetSettingsRequest()
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: { ...request, planDigest: DIGEST },
      name: "execute_guild_widget_settings_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...request,
        channelId: null,
        enabled: false,
        planDigest: DIGEST,
      },
      inputResponses: {
        confirm_widget_settings_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_guild_widget_settings_change",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.widgetSettingsCalls.execute, 0)
})

test("MCP widget-settings execution exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    ...widgetSettingsRequest(),
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      widgetSettingsError: new WidgetSettingsExecutionError(
        "Discord widget-settings outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "PATCH",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/widget`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      widgetSettingsError: new WidgetSettingsExecutionError(
        "Discord widget-settings change was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  const limitedStructured = structuredContent(limitedResult)
  assert.equal(limitedStructured.status, "rate-limited")
  assert.equal(
    (limitedStructured.error as Record<string, unknown>).retryAfterMs,
    2_500,
  )

  const receipt = {
    activityId: "activity-widget-settings",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    planDigest: DIGEST,
    status: "completed" as const,
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      widgetSettingsError: new WidgetSettingsOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_widget_settings_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(WIDGET_SETTINGS_OPERATION_KEY),
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), /private-channel/u)
})

test("MCP guild-settings audit exposes only named privacy-minimized state", async (context) => {
  const { client, guildSettingsCalls } = await connectedFixture(context)
  const audited = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "get_guild_settings",
  })
  const invalid = await client.callTool({
    arguments: { guildId: "invalid" },
    name: "get_guild_settings",
  })

  const content = structuredContent(audited)
  const configuration = content.configuration as Record<string, unknown>
  const privacy = content.privacy as Record<string, unknown>
  assert.equal(configuration.verificationLevel, "medium")
  assert.equal(configuration.defaultMessageNotifications, "all-messages")
  assert.deepEqual(configuration.suppressedSystemNotifications, [])
  assert.equal(configuration.unknownSystemChannelFlagsPresent, false)
  assert.equal(privacy.guildPresentation, "omitted")
  assert.equal(privacy.channelNames, "omitted")
  assert.equal(privacy.rawPayloads, "omitted")
  assert.equal("name" in content, false)
  assert.doesNotMatch(JSON.stringify(audited), /system_channel_flags|permissions/u)
  assert.equal(invalid.isError, true)
  assert.equal(guildSettingsCalls.get, 1)
})

test("MCP guild-settings plans preserve sparse named intent", async (context) => {
  const { client, guildSettingsCalls } = await connectedFixture(context)
  const request = guildSettingsRequest()
  const planned = await client.callTool({
    arguments: { ...request },
    name: "plan_guild_settings_change",
  })
  const suppressions = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: "guild-settings-suppressions-attempt-0001",
      suppressedSystemNotifications: [
        "join-notifications",
        "guild-reminders",
      ],
    },
    name: "plan_guild_settings_change",
  })
  const empty = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: GUILD_SETTINGS_OPERATION_KEY,
    },
    name: "plan_guild_settings_change",
  })
  const rawBitfield = await client.callTool({
    arguments: { ...request, systemChannelFlags: 3 },
    name: "plan_guild_settings_change",
  })
  const duplicate = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: GUILD_SETTINGS_OPERATION_KEY,
      suppressedSystemNotifications: [
        "join-notifications",
        "join-notifications",
      ],
    },
    name: "plan_guild_settings_change",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.equal(content.operationKeyHash, OPERATION_KEY_HASH)
  assert.deepEqual(content.requestedFields, [
    "defaultMessageNotifications",
    "explicitContentFilter",
    "verificationLevel",
  ])
  assert.deepEqual(content.changedFields, content.requestedFields)
  assert.deepEqual(
    (structuredContent(suppressions).desired as Record<string, unknown>)
      .suppressedSystemNotifications,
    ["guild-reminders", "join-notifications"],
  )
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(GUILD_SETTINGS_OPERATION_KEY))
  assert.equal(empty.isError, true)
  assert.equal(rawBitfield.isError, true)
  assert.equal(duplicate.isError, true)
  assert.equal(guildSettingsCalls.plan, 2)
})

test("MCP guild-settings execution binds approval to exact sparse intent", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { client, guildSettingsCalls } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const request = guildSettingsRequest()

  const result = await client.callTool({
    arguments: { ...request, planDigest: DIGEST },
    name: "execute_guild_settings_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(guildSettingsCalls.plan, 1)
  assert.equal(guildSettingsCalls.execute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    OPERATION_KEY_HASH,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Requested fields/)
  assert.match(confirmationMessage, /Current complete named settings/)
  assert.match(confirmationMessage, /Only requested fields are patched/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(confirmationMessage, new RegExp(GUILD_SETTINGS_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(GUILD_SETTINGS_OPERATION_KEY))
})

test("MCP guild-settings execution stops on no-op, refusal, drift, or changed signed intent", async (context) => {
  const argumentsValue = {
    ...guildSettingsRequest(),
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { guildSettingsEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_settings_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.guildSettingsCalls.execute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_settings_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.guildSettingsCalls.execute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { guildSettingsPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_settings_change",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.guildSettingsCalls.execute, 0)

  const signed = await connectedModernStdioFixture(context)
  const initial = await signed.client.request({
    method: "tools/call",
    params: {
      arguments: argumentsValue,
      name: "execute_guild_settings_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })
  assert.equal(initial.resultType, "input_required")
  const changed = await signed.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...argumentsValue,
        verificationLevel: "very-high",
      },
      inputResponses: {
        confirm_guild_settings_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_guild_settings_change",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)
  assert.equal(structuredContent(changed).status, "confirmation-invalid")
  assert.equal(changed.isError, true)
  assert.equal(signed.guildSettingsCalls.execute, 0)
})

test("MCP guild-settings execution exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    ...guildSettingsRequest(),
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildSettingsError: new GuildSettingsExecutionError(
        "Discord guild-settings outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_settings_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-guild-settings",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    planDigest: DIGEST,
    status: "completed" as const,
    timestamp: "2026-08-23T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildSettingsError: new GuildSettingsOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_settings_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(GUILD_SETTINGS_OPERATION_KEY))
})

test("MCP channel metadata reads and plans preserve exact bounded intent", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const read = await client.callTool({
    arguments: { channelId: CHANNEL_ID },
    name: "get_channel",
  })
  const invalidRead = await client.callTool({
    arguments: { channelId: "invalid" },
    name: "get_channel",
  })
  const request = channelMetadataRequest({
    defaultAutoArchiveDuration: 1_440,
    defaultThreadRateLimitPerUser: 0,
    nsfw: false,
    rateLimitPerUser: 0,
  })
  const planned = await client.callTool({
    arguments: { ...request },
    name: "plan_channel_metadata_change",
  })
  const missingField = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: CHANNEL_METADATA_OPERATION_KEY,
    },
    name: "plan_channel_metadata_change",
  })
  const extra = await client.callTool({
    arguments: { ...request, parentId: PARENT_ID },
    name: "plan_channel_metadata_change",
  })

  const readContent = structuredContent(read)
  const metadata = readContent.metadata as Record<string, unknown>
  const planContent = structuredContent(planned)
  assert.equal(metadata.id, CHANNEL_ID)
  assert.equal(metadata.topic, "Private release planning")
  assert.equal((readContent.privacy as Record<string, unknown>).persistence, "none")
  assert.equal("permissionOverwrites" in metadata, false)
  assert.equal(planContent.status, "planned")
  assert.deepEqual(planContent.requestedFields, [
    "defaultAutoArchiveDuration",
    "defaultThreadRateLimitPerUser",
    "name",
    "nsfw",
    "rateLimitPerUser",
    "topic",
  ])
  assert.equal(
    (planContent.desired as Record<string, unknown>).topic,
    null,
  )
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(CHANNEL_METADATA_OPERATION_KEY))
  assert.equal(invalidRead.isError, true)
  assert.equal(missingField.isError, true)
  assert.equal(extra.isError, true)
  assert.equal(calls.channelMetadataGet, 1)
  assert.equal(calls.channelMetadataPlan, 1)
})

test("MCP channel metadata execution binds signed approval to complete reviewed state", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const request = channelMetadataRequest()

  const result = await client.callTool({
    arguments: { ...request, planDigest: DIGEST },
    name: "execute_channel_metadata_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.channelMetadataPlan, 1)
  assert.equal(calls.channelMetadataExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    OPERATION_KEY_HASH,
    "Private release planning",
    "announcements",
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /VIEW_CHANNEL/)
  assert.match(confirmationMessage, /MANAGE_CHANNELS/)
  assert.match(confirmationMessage, /type-required CONNECT/)
  assert.match(confirmationMessage, /one non-retried partial PATCH/i)
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(confirmationMessage, new RegExp(CHANNEL_METADATA_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(CHANNEL_METADATA_OPERATION_KEY),
  )
})

test("MCP channel metadata execution skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = {
    ...channelMetadataRequest(),
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { channelMetadataEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.channelMetadataExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.channelMetadataExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.channelMetadataExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { channelMetadataPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.channelMetadataExecute, 0)
})

test("MCP channel metadata execution exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    ...channelMetadataRequest(),
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelMetadataError: new ChannelMetadataExecutionError(
        "Discord channel metadata outcome is uncertain",
        {
          activityId: "activity-channel-metadata",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          operationKeyHash: OPERATION_KEY_HASH,
          planDigest: DIGEST,
          schemaVersion: 1,
          status: "uncertain",
        },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-channel-metadata",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    resourceId: CHANNEL_ID,
    status: "completed",
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelMetadataError: new ChannelMetadataOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(CHANNEL_METADATA_OPERATION_KEY),
  )

  const claimId = `claim_${"c".repeat(32)}`
  for (const coordination of [
    {
      error: new WriteCoordinationConflictError(claimId),
      status: "coordination-conflict",
    },
    {
      error: new WriteCoordinationQuarantinedError(claimId),
      status: "coordination-quarantined",
    },
  ]) {
    const fixture = await connectedFixture(context, {
      elicitationHandler: approve,
      serviceOverrides: { channelMetadataError: coordination.error },
    })
    const result = await fixture.client.callTool({
      arguments: argumentsValue,
      name: "execute_channel_metadata_change",
    })
    const structured = structuredContent(result)
    assert.equal(structured.status, coordination.status)
    assert.equal(
      (structured.error as Record<string, unknown>).claimId,
      claimId,
    )
    assert.match(JSON.stringify(result), new RegExp(claimId))
  }

  const stateError = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelMetadataError: new WriteCoordinationStateError(
        "Discord write coordination state is unavailable",
      ),
    },
  })
  const stateResult = await stateError.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_metadata_change",
  })
  assert.equal(
    structuredContent(stateResult).status,
    "coordination-state-error",
  )
})

test("MCP guild expression reads expose only bounded privacy-safe evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const emojis = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_guild_emojis",
  })
  const emoji = await client.callTool({
    arguments: { expressionId: EMOJI_ID, guildId: GUILD_ID },
    name: "get_guild_emoji",
  })
  const stickers = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_guild_stickers",
  })
  const sticker = await client.callTool({
    arguments: { expressionId: STICKER_ID, guildId: GUILD_ID },
    name: "get_guild_sticker",
  })
  const invalid = await client.callTool({
    arguments: { expressionId: "invalid", guildId: GUILD_ID },
    name: "get_guild_emoji",
  })

  const listedEmoji = (
    structuredContent(emojis).expressions as Array<Record<string, unknown>>
  )[0]
  const exactEmoji = structuredContent(emoji).expression as Record<string, unknown>
  const listedSticker = (
    structuredContent(stickers).expressions as Array<Record<string, unknown>>
  )[0]
  const exactSticker = structuredContent(sticker).expression as Record<string, unknown>
  assert.deepEqual(Object.keys(listedEmoji || {}).sort(), [
    "animated",
    "available",
    "creatorUserId",
    "expressionId",
    "kind",
    "managed",
    "name",
    "requiresColons",
    "roleIds",
  ])
  assert.deepEqual(Object.keys(exactEmoji).sort(), Object.keys(listedEmoji || {}).sort())
  assert.deepEqual(Object.keys(listedSticker || {}).sort(), [
    "available",
    "creatorUserId",
    "description",
    "expressionId",
    "formatType",
    "guildId",
    "kind",
    "name",
    "tags",
  ])
  assert.deepEqual(Object.keys(exactSticker).sort(), Object.keys(listedSticker || {}).sort())
  assert.equal(listedEmoji?.expressionId, EMOJI_ID)
  assert.equal(listedSticker?.expressionId, STICKER_ID)
  assert.equal(
    (structuredContent(emojis).privacy as Record<string, unknown>)
      .privateFieldsProjectedOut,
    true,
  )
  for (const value of [emojis, emoji, stickers, sticker]) {
    const serialized = JSON.stringify(value)
    assert.doesNotMatch(serialized, /cdn\.discordapp\.com|https?:\/\//)
  }
  assert.equal(invalid.isError, true)
  assert.equal(calls.guildExpressionList, 2)
  assert.equal(calls.guildExpressionGet, 2)
})

test("MCP guild expression plans accept every exact action and reject transported bytes", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const validRequests = [
    {
      action: "create",
      auditReason: AUDIT_REASON,
      filePath: GUILD_EXPRESSION_PATH,
      guildId: GUILD_ID,
      kind: "emoji",
      name: "reviewed_emoji",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
      roleIds: [ROLE_ID],
    },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      expressionId: EMOJI_ID,
      guildId: GUILD_ID,
      kind: "emoji",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
      roleIds: [],
    },
    {
      action: "delete",
      auditReason: AUDIT_REASON,
      expressionId: EMOJI_ID,
      guildId: GUILD_ID,
      kind: "emoji",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
    },
    {
      action: "create",
      auditReason: AUDIT_REASON,
      description: "Reviewed sticker",
      filePath: GUILD_EXPRESSION_PATH,
      guildId: GUILD_ID,
      kind: "sticker",
      name: "Reviewed sticker",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
      tags: "reviewed",
    },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      description: null,
      expressionId: STICKER_ID,
      guildId: GUILD_ID,
      kind: "sticker",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
    },
    {
      action: "delete",
      auditReason: AUDIT_REASON,
      expressionId: STICKER_ID,
      guildId: GUILD_ID,
      kind: "sticker",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
    },
  ]
  for (const request of validRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_guild_expression_change",
    })
    assert.equal(structuredContent(result).status, "planned")
    assert.doesNotMatch(JSON.stringify(result), new RegExp(GUILD_EXPRESSION_OPERATION_KEY))
  }

  const invalidRequests = [
    {
      ...validRequests[0],
      imageUrl: "https://cdn.example/reviewed.png",
    },
    {
      ...validRequests[0],
      image: "data:image/png;base64,AAAA",
    },
    { ...validRequests[0], filePath: "relative/reviewed.png" },
    { ...validRequests[1], roleIds: [ROLE_ID, ROLE_ID] },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      expressionId: EMOJI_ID,
      guildId: GUILD_ID,
      kind: "emoji",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
    },
    { ...validRequests[2], name: "not-accepted" },
    { ...validRequests[3], roleIds: [ROLE_ID] },
    { ...validRequests[3], description: "\ud800x" },
    { ...validRequests[3], name: "\ud800x" },
    { ...validRequests[3], tags: "\ud800" },
    { ...validRequests[4], filePath: GUILD_EXPRESSION_PATH },
    { ...validRequests[5], operationKey: "short" },
  ]
  for (const request of invalidRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_guild_expression_change",
    })
    assert.equal(result.isError, true)
  }
  assert.equal(calls.guildExpressionPlan, validRequests.length)
})

test("MCP guild expression execution binds signed approval to exact reviewed evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "create",
      auditReason: AUDIT_REASON,
      filePath: GUILD_EXPRESSION_PATH,
      guildId: GUILD_ID,
      kind: "emoji",
      name: "reviewed_emoji",
      operationKey: GUILD_EXPRESSION_OPERATION_KEY,
      planDigest: DIGEST,
      roleIds: [ROLE_ID],
    },
    name: "execute_guild_expression_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).expressionId, EMOJI_ID)
  assert.equal(calls.guildExpressionPlan, 1)
  assert.equal(calls.guildExpressionExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    GUILD_EXPRESSION_PATH,
    ROLE_ID,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Bot CREATE_GUILD_EXPRESSIONS: true/)
  assert.match(confirmationMessage, /Bot MANAGE_GUILD_EXPRESSIONS: true/)
  assert.match(confirmationMessage, /Regular owned single-link file: true/)
  assert.match(confirmationMessage, /File animated: false/)
  assert.match(confirmationMessage, /File duration: not applicable/)
  assert.match(confirmationMessage, /Private fields projected out:/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(confirmationMessage, new RegExp(GUILD_EXPRESSION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(GUILD_EXPRESSION_OPERATION_KEY),
  )
})

test("MCP guild expression execution stops on no-op, refusal, or fresh-plan drift", async (context) => {
  const argumentsValue = {
    action: "update",
    auditReason: AUDIT_REASON,
    expressionId: EMOJI_ID,
    guildId: GUILD_ID,
    kind: "emoji",
    name: "reviewed_emoji",
    operationKey: GUILD_EXPRESSION_OPERATION_KEY,
    planDigest: DIGEST,
    roleIds: [ROLE_ID],
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { guildExpressionEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_expression_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.guildExpressionExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_expression_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.guildExpressionExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { guildExpressionPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_expression_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.guildExpressionExecute, 0)
})

test("MCP guild expression execution exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "delete",
    auditReason: AUDIT_REASON,
    expressionId: STICKER_ID,
    guildId: GUILD_ID,
    kind: "sticker",
    operationKey: GUILD_EXPRESSION_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildExpressionError: new GuildExpressionExecutionError(
        "Discord guild expression outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_expression_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-guild-expression",
    error: null,
    expressionId: STICKER_ID,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildExpressionError: new GuildExpressionOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_expression_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(GUILD_EXPRESSION_OPERATION_KEY),
  )
})

test("MCP soundboard reads expose only bounded privacy-safe evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const defaults = await client.callTool({
    arguments: {},
    name: "list_default_soundboard_sounds",
  })
  const guild = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_guild_soundboard_sounds",
  })
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, soundId: SOUNDBOARD_SOUND_ID },
    name: "get_guild_soundboard_sound",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID, soundId: "invalid" },
    name: "get_guild_soundboard_sound",
  })

  const defaultSound = (
    structuredContent(defaults).sounds as Array<Record<string, unknown>>
  )[0]
  const guildSound = (
    structuredContent(guild).sounds as Array<Record<string, unknown>>
  )[0]
  const exactSound = structuredContent(exact).sound as Record<string, unknown>
  assert.deepEqual(Object.keys(guildSound || {}).sort(), [
    "available",
    "creatorUserId",
    "emoji",
    "guildId",
    "name",
    "soundId",
    "unknownFieldCount",
    "volume",
  ])
  assert.deepEqual(Object.keys(exactSound).sort(), Object.keys(guildSound || {}).sort())
  assert.equal(defaultSound?.guildId, null)
  assert.equal(defaultSound?.creatorUserId, null)
  assert.equal(guildSound?.soundId, SOUNDBOARD_SOUND_ID)
  assert.equal(exactSound.soundId, SOUNDBOARD_SOUND_ID)
  assert.equal(
    (structuredContent(guild).privacy as Record<string, unknown>).audioPersisted,
    false,
  )
  for (const value of [defaults, guild, exact]) {
    const serialized = JSON.stringify(value)
    assert.doesNotMatch(serialized, /cdn\.discordapp\.com|https?:\/\//)
    assert.equal(serialized.includes("audioBytes"), true)
  }
  assert.equal(invalid.isError, true)
  assert.equal(calls.soundboardDefaultList, 1)
  assert.equal(calls.soundboardGuildList, 1)
  assert.equal(calls.soundboardGet, 1)
})

test("MCP soundboard plans accept exact actions and reject transported audio", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const validRequests = [{
    action: "create",
    auditReason: AUDIT_REASON,
    emoji: { emojiId: EMOJI_ID, kind: "custom" },
    filePath: SOUNDBOARD_PATH,
    guildId: GUILD_ID,
    name: "Reviewed sound",
    operationKey: SOUNDBOARD_OPERATION_KEY,
    volume: 0.75,
  }, {
    action: "update",
    auditReason: AUDIT_REASON,
    emoji: { kind: "none" },
    guildId: GUILD_ID,
    name: "Updated sound",
    operationKey: SOUNDBOARD_OPERATION_KEY,
    soundId: SOUNDBOARD_SOUND_ID,
    volume: 0,
  }, {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: SOUNDBOARD_OPERATION_KEY,
    soundId: SOUNDBOARD_SOUND_ID,
  }]
  for (const request of validRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_guild_soundboard_change",
    })
    assert.equal(structuredContent(result).status, "planned")
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SOUNDBOARD_OPERATION_KEY))
  }

  const invalidRequests = [
    { ...validRequests[0], sound: "data:audio/mpeg;base64,AAAA" },
    { ...validRequests[0], soundUrl: "https://cdn.example/reviewed.mp3" },
    { ...validRequests[0], filePath: "relative/reviewed.mp3" },
    { ...validRequests[0], emoji: { emojiName: "not emoji", kind: "unicode" } },
    { ...validRequests[0], volume: 1.01 },
    { ...validRequests[0], name: "Cafe\u0301 sound" },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: SOUNDBOARD_OPERATION_KEY,
      soundId: SOUNDBOARD_SOUND_ID,
    },
    { ...validRequests[2], name: "not-accepted" },
    { ...validRequests[2], operationKey: "short" },
  ]
  for (const request of invalidRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_guild_soundboard_change",
    })
    assert.equal(result.isError, true)
  }
  assert.equal(calls.soundboardPlan, validRequests.length)
})

test("MCP soundboard execution binds signed approval to exact reviewed evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "create",
      auditReason: AUDIT_REASON,
      emoji: { emojiId: EMOJI_ID, kind: "custom" },
      filePath: SOUNDBOARD_PATH,
      guildId: GUILD_ID,
      name: "Reviewed sound",
      operationKey: SOUNDBOARD_OPERATION_KEY,
      planDigest: DIGEST,
      volume: 0.75,
    },
    name: "execute_guild_soundboard_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).soundId, SOUNDBOARD_SOUND_ID)
  assert.equal(calls.soundboardPlan, 1)
  assert.equal(calls.soundboardExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    SOUNDBOARD_PATH,
    EMOJI_ID,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /File format: mp3/)
  assert.match(confirmationMessage, /File codec: mpeg-1-layer-3/)
  assert.match(confirmationMessage, /File duration: 1.25 seconds/)
  assert.match(confirmationMessage, /Bot CREATE_GUILD_EXPRESSIONS: true/)
  assert.match(confirmationMessage, /Bot MANAGE_GUILD_EXPRESSIONS: true/)
  assert.match(confirmationMessage, /Regular owned single-link file: true/)
  assert.match(confirmationMessage, /Private fields projected out:/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(confirmationMessage, new RegExp(SOUNDBOARD_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(SOUNDBOARD_OPERATION_KEY),
  )
})

test("MCP soundboard execution stops on no-op, refusal, or fresh-plan drift", async (context) => {
  const argumentsValue = {
    action: "update",
    auditReason: AUDIT_REASON,
    emoji: { emojiName: "🔔", kind: "unicode" },
    guildId: GUILD_ID,
    name: "Reviewed sound",
    operationKey: SOUNDBOARD_OPERATION_KEY,
    planDigest: DIGEST,
    soundId: SOUNDBOARD_SOUND_ID,
    volume: 0.75,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { soundboardEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_soundboard_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.soundboardExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_soundboard_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.soundboardExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { soundboardPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_soundboard_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.soundboardExecute, 0)
})

test("MCP soundboard execution exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: SOUNDBOARD_OPERATION_KEY,
    planDigest: DIGEST,
    soundId: SOUNDBOARD_SOUND_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      soundboardError: new SoundboardExecutionError(
        "Discord guild soundboard outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_soundboard_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-soundboard",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    soundId: SOUNDBOARD_SOUND_ID,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      soundboardError: new SoundboardOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_guild_soundboard_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(SOUNDBOARD_OPERATION_KEY),
  )
})

test("MCP AutoMod reads separate summary inventory from exact transient policy", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_automod_rules",
  })
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, ruleId: AUTOMOD_RULE_ID },
    name: "get_automod_rule",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID, ruleId: "invalid" },
    name: "get_automod_rule",
  })

  const listedContent = structuredContent(listed)
  const exactContent = structuredContent(exact)
  assert.equal(listedContent.status, "ok")
  assert.equal(exactContent.status, "ok")
  assert.equal(JSON.stringify(listedContent).includes("reviewed-keyword"), false)
  assert.equal(JSON.stringify(exactContent).includes("reviewed-keyword"), true)
  assert.equal(
    (exactContent.privacy as Record<string, unknown>).actionExecutionEventsExposed,
    false,
  )
  assert.equal(invalid.isError, true)
  assert.equal(calls.autoModerationList, 1)
  assert.equal(calls.autoModerationGet, 1)
})

test("MCP AutoMod plans accept exact lifecycle unions and reject unsafe policy shapes", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const validRequests = [{
    action: "create",
    actions: [{ customMessage: "Review this message", type: "block-message" }],
    auditReason: AUDIT_REASON,
    exemptChannelIds: [],
    exemptRoleIds: [],
    guildId: GUILD_ID,
    name: "Reviewed keyword policy",
    operationKey: AUTOMOD_OPERATION_KEY,
    trigger: {
      keywordFilter: ["reviewed-keyword"],
      type: "keyword",
    },
  }, {
    action: "update",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "Updated reviewed policy",
    operationKey: AUTOMOD_OPERATION_KEY,
    ruleId: AUTOMOD_RULE_ID,
  }, {
    action: "set-enabled",
    auditReason: AUDIT_REASON,
    enabled: true,
    guildId: GUILD_ID,
    operationKey: AUTOMOD_OPERATION_KEY,
    ruleId: AUTOMOD_RULE_ID,
  }, {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: AUTOMOD_OPERATION_KEY,
    ruleId: AUTOMOD_RULE_ID,
  }]
  for (const request of validRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_automod_change",
    })
    assert.equal(structuredContent(result).status, "planned")
    assert.doesNotMatch(JSON.stringify(result), new RegExp(AUTOMOD_OPERATION_KEY))
  }

  const invalidRequests = [{
    ...validRequests[0],
    enabled: true,
  }, {
    ...validRequests[0],
    actions: [{ durationSeconds: 60, type: "timeout" }],
    trigger: { type: "spam" },
  }, {
    ...validRequests[0],
    actions: [{ type: "block-member-interaction" }],
    exemptChannelIds: [CHANNEL_ID],
    trigger: {
      keywordFilter: ["unsafe-profile"],
      type: "member-profile",
    },
  }, {
    ...validRequests[1],
    name: undefined,
  }, {
    ...validRequests[2],
    actions: [{ type: "block-message" }],
  }, {
    ...validRequests[3],
    planDigest: DIGEST,
  }]
  for (const request of invalidRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_automod_change",
    })
    assert.equal(result.isError, true)
  }
  assert.equal(calls.autoModerationPlan, validRequests.length)
})

test("MCP AutoMod execution binds signed approval to the complete reviewed policy", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const argumentsValue = {
    action: "create",
    actions: [{ customMessage: "Review this message", type: "block-message" }],
    auditReason: AUDIT_REASON,
    exemptChannelIds: [],
    exemptRoleIds: [],
    guildId: GUILD_ID,
    name: "Reviewed keyword policy",
    operationKey: AUTOMOD_OPERATION_KEY,
    planDigest: DIGEST,
    trigger: {
      keywordFilter: ["reviewed-keyword"],
      type: "keyword",
    },
  }

  const result = await client.callTool({
    arguments: argumentsValue,
    name: "execute_automod_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).ruleId, AUTOMOD_RULE_ID)
  assert.equal(calls.autoModerationPlan, 1)
  assert.equal(calls.autoModerationExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    "Reviewed keyword policy",
    "reviewed-keyword",
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Guild permission evidence:/)
  assert.match(confirmationMessage, /Privacy projection:/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(confirmationMessage, new RegExp(AUTOMOD_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(AUTOMOD_OPERATION_KEY))
})

test("MCP AutoMod execution handles no-op, refusal, drift, uncertainty, and conflicts safely", async (context) => {
  const argumentsValue = {
    action: "set-enabled",
    auditReason: AUDIT_REASON,
    enabled: true,
    guildId: GUILD_ID,
    operationKey: AUTOMOD_OPERATION_KEY,
    planDigest: DIGEST,
    ruleId: AUTOMOD_RULE_ID,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { autoModerationEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_automod_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.autoModerationExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_automod_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.autoModerationExecute, 0)

  const changed = await connectedFixture(context, {
    serviceOverrides: { autoModerationPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_automod_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changed.calls.autoModerationExecute, 0)

  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      autoModerationError: new AutoModerationExecutionError(
        "Discord AutoMod outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_automod_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-automod",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    ruleId: AUTOMOD_RULE_ID,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      autoModerationError: new AutoModerationOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_automod_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(AUTOMOD_OPERATION_KEY))
})

test("MCP scheduled event reads expose bounded privacy-safe evidence and opt-in counts", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: { guildId: GUILD_ID, includeSubscriberCount: true },
    name: "list_scheduled_events",
  })
  const exact = await client.callTool({
    arguments: {
      eventId: SCHEDULED_EVENT_ID,
      guildId: GUILD_ID,
      includeSubscriberCount: false,
    },
    name: "get_scheduled_event",
  })
  const invalid = await client.callTool({
    arguments: { eventId: "invalid", guildId: GUILD_ID },
    name: "get_scheduled_event",
  })

  const listedContent = structuredContent(listed)
  const exactContent = structuredContent(exact)
  const listedItem = (
    listedContent.events as Array<Record<string, unknown>>
  )[0] || {}
  const listedEvent = listedItem.event as Record<string, unknown>
  const exactEvent = exactContent.event as Record<string, unknown>
  assert.equal(listedContent.status, "ok")
  assert.equal(exactContent.status, "ok")
  assert.equal(listedContent.subscriberCountsIncluded, true)
  assert.equal(exactContent.subscriberCountIncluded, false)
  assert.equal(listedEvent.subscriberCount, 7)
  assert.equal(exactEvent.subscriberCount, null)
  assert.deepEqual(Object.keys(exactEvent).sort(), [
    "channelId",
    "creatorUserId",
    "description",
    "entityId",
    "entityType",
    "eventId",
    "guildId",
    "hasCoverImage",
    "location",
    "name",
    "privacyLevel",
    "recurrence",
    "scheduledEndTime",
    "scheduledStartTime",
    "status",
    "subscriberCount",
  ])
  assert.equal(
    (exactContent.privacy as Record<string, unknown>).subscriberIdentitiesExposed,
    false,
  )
  for (const privateField of [
    "coverImageCdnUrl",
    "coverImageHash",
    "creatorProfile",
    "subscriberProfiles",
  ]) {
    assert.equal(privateField in exactEvent, false)
    assert.equal(privateField in listedEvent, false)
  }
  assert.equal(invalid.isError, true)
  assert.equal(calls.scheduledEventList, 1)
  assert.equal(calls.scheduledEventGet, 1)
})

test("MCP scheduled event plans accept exact lifecycle actions and reject transported media", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const validRequests = [
    {
      action: "create",
      auditReason: AUDIT_REASON,
      coverImagePath: SCHEDULED_EVENT_COVER_PATH,
      description: "Reviewed public planning session",
      guildId: GUILD_ID,
      hosting: { entityType: "external", location: "Town Hall" },
      name: "Planning session",
      operationKey: SCHEDULED_EVENT_OPERATION_KEY,
      recurrence: {
        frequency: "daily",
        weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      scheduledEndTime: "2026-09-01T22:00:00.000Z",
      scheduledStartTime: "2026-09-01T20:00:00.000Z",
    },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      coverImagePath: null,
      description: null,
      eventId: SCHEDULED_EVENT_ID,
      guildId: GUILD_ID,
      name: "Updated planning session",
      operationKey: SCHEDULED_EVENT_OPERATION_KEY,
    },
    {
      action: "transition",
      auditReason: AUDIT_REASON,
      eventId: SCHEDULED_EVENT_ID,
      guildId: GUILD_ID,
      operationKey: SCHEDULED_EVENT_OPERATION_KEY,
      targetStatus: "active",
    },
    {
      action: "delete",
      auditReason: AUDIT_REASON,
      eventId: SCHEDULED_EVENT_ID,
      guildId: GUILD_ID,
      operationKey: SCHEDULED_EVENT_OPERATION_KEY,
    },
  ]
  for (const request of validRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_scheduled_event_change",
    })
    assert.equal(structuredContent(result).status, "planned")
    assert.doesNotMatch(
      JSON.stringify(result),
      new RegExp(SCHEDULED_EVENT_OPERATION_KEY),
    )
  }

  const invalidRequests = [
    { ...validRequests[0], coverImageUrl: "https://cdn.example/event.png" },
    { ...validRequests[0], coverImage: "data:image/png;base64,AAAA" },
    { ...validRequests[0], coverImagePath: "relative/event.png" },
    { ...validRequests[0], scheduledEndTime: undefined },
    {
      ...validRequests[0],
      hosting: { entityType: "voice", location: "not-a-channel" },
    },
    {
      ...validRequests[0],
      recurrence: { frequency: "daily", weekdays: ["monday"] },
    },
    {
      ...validRequests[0],
      scheduledEndTime: "2026-09-01T19:00:00.000Z",
    },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      eventId: SCHEDULED_EVENT_ID,
      guildId: GUILD_ID,
      operationKey: SCHEDULED_EVENT_OPERATION_KEY,
    },
    { ...validRequests[2], targetStatus: "scheduled" },
    { ...validRequests[3], name: "not-accepted" },
    { ...validRequests[3], operationKey: "short" },
  ]
  for (const request of invalidRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_scheduled_event_change",
    })
    assert.equal(result.isError, true)
  }
  assert.equal(calls.scheduledEventPlan, validRequests.length)
})

test("MCP scheduled event execution binds signed approval to exact reviewed evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "create",
      auditReason: AUDIT_REASON,
      coverImagePath: SCHEDULED_EVENT_COVER_PATH,
      description: "Reviewed public planning session",
      guildId: GUILD_ID,
      hosting: { entityType: "external", location: "Town Hall" },
      name: "Planning session",
      operationKey: SCHEDULED_EVENT_OPERATION_KEY,
      planDigest: DIGEST,
      recurrence: { frequency: "weekly", interval: 2, weekday: "tuesday" },
      scheduledEndTime: "2026-09-01T22:00:00.000Z",
      scheduledStartTime: "2026-09-01T20:00:00.000Z",
    },
    name: "execute_scheduled_event_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).eventId, SCHEDULED_EVENT_ID)
  assert.equal(calls.scheduledEventPlan, 1)
  assert.equal(calls.scheduledEventExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    SCHEDULED_EVENT_COVER_PATH,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Current permission evidence:/)
  assert.match(confirmationMessage, /Visible inventory:/)
  assert.match(confirmationMessage, /Regular owned single-link file: true/)
  assert.match(confirmationMessage, /Subscriber identities exposed: false/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(SCHEDULED_EVENT_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(SCHEDULED_EVENT_OPERATION_KEY),
  )
})

test("MCP scheduled event execution stops on no-op, refusal, or fresh-plan drift", async (context) => {
  const argumentsValue = {
    action: "update",
    auditReason: AUDIT_REASON,
    eventId: SCHEDULED_EVENT_ID,
    guildId: GUILD_ID,
    name: "Planning session",
    operationKey: SCHEDULED_EVENT_OPERATION_KEY,
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { scheduledEventEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_scheduled_event_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.scheduledEventExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_scheduled_event_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.scheduledEventExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { scheduledEventPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_scheduled_event_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.scheduledEventExecute, 0)
})

test("MCP scheduled event execution exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "delete",
    auditReason: AUDIT_REASON,
    eventId: SCHEDULED_EVENT_ID,
    guildId: GUILD_ID,
    operationKey: SCHEDULED_EVENT_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      scheduledEventError: new ScheduledEventExecutionError(
        "Discord scheduled event outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_scheduled_event_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-scheduled-event",
    error: null,
    eventId: SCHEDULED_EVENT_ID,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      scheduledEventError: new ScheduledEventOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_scheduled_event_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(SCHEDULED_EVENT_OPERATION_KEY),
  )
})

test("MCP Stage-instance reads expose bounded active state without audience data", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: {},
    name: "list_stage_instances",
  })
  const exact = await client.callTool({
    arguments: { channelId: CHANNEL_ID, guildId: GUILD_ID },
    name: "get_stage_instance",
  })
  const invalid = await client.callTool({
    arguments: { channelId: "invalid", guildId: GUILD_ID },
    name: "get_stage_instance",
  })

  const listedContent = structuredContent(listed)
  const exactContent = structuredContent(exact)
  const entry = (listedContent.entries as Array<Record<string, unknown>>)[0] || {}
  const listedInstance = entry.instance as Record<string, unknown>
  const exactInstance = exactContent.instance as Record<string, unknown>
  assert.equal(listedContent.status, "ok")
  assert.equal(exactContent.status, "active")
  assert.equal(listedInstance.id, STAGE_INSTANCE_ID)
  assert.equal(exactInstance.privacyLevel, "guild-only")
  assert.equal(exactInstance.scheduledEventId, null)
  assert.equal(exactInstance.unknownFieldCount, 0)
  assert.equal(
    (exactContent.privacy as Record<string, unknown>).speakerIdentitiesExposed,
    false,
  )
  for (const privateField of [
    "audienceState",
    "rawDiscordObject",
    "scheduledEventObject",
    "speakerState",
  ]) {
    assert.equal(privateField in listedInstance, false)
    assert.equal(privateField in exactInstance, false)
  }
  assert.equal(invalid.isError, true)
  assert.equal(calls.stageInstanceList, 1)
  assert.equal(calls.stageInstanceGet, 1)
})

test("MCP Stage-instance plans enforce exact lifecycle-specific inputs", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const validRequests = [
    {
      action: "start",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: STAGE_INSTANCE_OPERATION_KEY,
      sendStartNotification: true,
      topic: "Planning session",
    },
    {
      action: "update",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: STAGE_INSTANCE_OPERATION_KEY,
      topic: "Questions",
    },
    {
      action: "end",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: STAGE_INSTANCE_OPERATION_KEY,
    },
  ]
  for (const request of validRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_stage_instance_change",
    })
    assert.equal(structuredContent(result).status, "planned")
    assert.doesNotMatch(JSON.stringify(result), new RegExp(STAGE_INSTANCE_OPERATION_KEY))
  }

  const invalidRequests = [
    { ...validRequests[0], topic: " " },
    { ...validRequests[0], topic: "x".repeat(121) },
    { ...validRequests[1], sendStartNotification: true },
    { ...validRequests[2], topic: "Not accepted" },
    { ...validRequests[2], operationKey: "short" },
  ]
  for (const request of invalidRequests) {
    const result = await client.callTool({
      arguments: request,
      name: "plan_stage_instance_change",
    })
    assert.equal(result.isError, true)
  }
  assert.equal(calls.stageInstancePlan, validRequests.length)
})

test("MCP Stage-instance execution binds signed approval to exact reviewed evidence", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "start",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: STAGE_INSTANCE_OPERATION_KEY,
      planDigest: DIGEST,
      sendStartNotification: true,
      topic: "Planning session",
    },
    name: "execute_stage_instance_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).stageInstanceId, STAGE_INSTANCE_ID)
  assert.equal(calls.stageInstancePlan, 1)
  assert.equal(calls.stageInstanceExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /MENTION_EVERYONE/)
  assert.match(confirmationMessage, /privacyLevel.*guild-only/)
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /blocks later same-channel changes/)
  assert.doesNotMatch(confirmationMessage, new RegExp(STAGE_INSTANCE_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(STAGE_INSTANCE_OPERATION_KEY))
})

test("MCP Stage-instance execution stops on no-op, refusal, or fresh-plan drift", async (context) => {
  const argumentsValue = {
    action: "update",
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: STAGE_INSTANCE_OPERATION_KEY,
    planDigest: DIGEST,
    topic: "Planning session",
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { stageInstanceEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_stage_instance_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.stageInstanceExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_stage_instance_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.stageInstanceExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { stageInstancePlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_stage_instance_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.stageInstanceExecute, 0)
})

test("MCP Stage-instance execution exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "end",
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: STAGE_INSTANCE_OPERATION_KEY,
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      stageInstanceError: new StageInstanceExecutionError(
        "Discord Stage-instance outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_stage_instance_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-stage-instance",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    stageInstanceId: STAGE_INSTANCE_ID,
    status: "completed" as const,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match" as const,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      stageInstanceError: new StageInstanceOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_stage_instance_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(STAGE_INSTANCE_OPERATION_KEY))
})

test("MCP channel permission overwrites expose bounded read inventory", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const listed = await client.callTool({
    arguments: {
      afterTargetId: ROLE_ID,
      channelId: CHANNEL_ID,
      limit: 25,
    },
    name: "list_channel_permission_overwrites",
  })
  const invalidLimit = await client.callTool({
    arguments: { channelId: CHANNEL_ID, limit: 101 },
    name: "list_channel_permission_overwrites",
  })

  assert.equal(structuredContent(listed).status, "ok")
  assert.equal(
    (structuredContent(listed).page as Record<string, unknown>).requestedLimit,
    25,
  )
  assert.equal((structuredContent(listed).overwrites as unknown[]).length, 1)
  assert.equal(invalidLimit.isError, true)
  assert.equal(calls.permissionOverwriteList, 1)
})

test("MCP channel permission plans accept named exact deltas or explicit deletion only", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      changes: [{ permission: "SEND_MESSAGES", state: "deny" }],
      channelId: CHANNEL_ID,
      mode: "update",
      operationKey: PERMISSION_OVERWRITE_OPERATION_KEY,
      targetId: ROLE_ID,
      targetType: "role",
    },
    name: "plan_channel_permission_overwrite",
  })
  const missingChanges = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      mode: "update",
      operationKey: PERMISSION_OVERWRITE_OPERATION_KEY,
      targetId: ROLE_ID,
      targetType: "role",
    },
    name: "plan_channel_permission_overwrite",
  })
  const deleteWithChanges = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      changes: [{ permission: "VIEW_CHANNEL", state: "inherit" }],
      channelId: CHANNEL_ID,
      mode: "delete",
      operationKey: PERMISSION_OVERWRITE_OPERATION_KEY,
      targetId: USER_ID,
      targetType: "member",
    },
    name: "plan_channel_permission_overwrite",
  })
  const rawBitfield = await client.callTool({
    arguments: {
      allow: "1024",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      mode: "update",
      operationKey: PERMISSION_OVERWRITE_OPERATION_KEY,
      targetId: ROLE_ID,
      targetType: "role",
    },
    name: "plan_channel_permission_overwrite",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(missingChanges.isError, true)
  assert.equal(deleteWithChanges.isError, true)
  assert.equal(rawBitfield.isError, true)
  assert.equal(calls.permissionOverwritePlan, 1)
})

test("MCP channel permission changes bind signed approval to the exact transition", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      changes: [{ permission: "SEND_MESSAGES", state: "deny" }],
      channelId: CHANNEL_ID,
      mode: "update",
      operationKey: PERMISSION_OVERWRITE_OPERATION_KEY,
      planDigest: DIGEST,
      targetId: ROLE_ID,
      targetType: "role",
    },
    name: "execute_channel_permission_overwrite",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.permissionOverwritePlan, 1)
  assert.equal(calls.permissionOverwriteExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(ROLE_ID))
  assert.match(confirmationMessage, /SEND_MESSAGES/)
  assert.match(confirmationMessage, /Connector retains VIEW_CHANNEL: true/)
  assert.match(confirmationMessage, /Connector retains MANAGE_ROLES: true/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted/)
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(PERMISSION_OVERWRITE_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(PERMISSION_OVERWRITE_OPERATION_KEY),
  )
})

test("MCP channel permission changes stop on no-op, refusal, drift, uncertainty, and conflicts", async (context) => {
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { permissionOverwriteAction: "none" },
  })
  const argumentsValue = {
    auditReason: AUDIT_REASON,
    changes: [{ permission: "SEND_MESSAGES", state: "deny" }],
    channelId: CHANNEL_ID,
    mode: "update",
    operationKey: PERMISSION_OVERWRITE_OPERATION_KEY,
    planDigest: DIGEST,
    targetId: ROLE_ID,
    targetType: "role",
  }
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_permission_overwrite",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.permissionOverwriteExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_permission_overwrite",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.permissionOverwriteExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { permissionOverwritePlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_permission_overwrite",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)

  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      permissionOverwriteError: new ChannelPermissionOverwriteExecutionError(
        "Discord channel permission outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_permission_overwrite",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-permission-overwrite",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    targetId: ROLE_ID,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      permissionOverwriteError: new ChannelPermissionOverwriteOperationConflictError(
        receipt,
      ),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_permission_overwrite",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(PERMISSION_OVERWRITE_OPERATION_KEY),
  )
})

test("MCP channel creation plans bounded additive types and rejects category settings", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      defaultAutoArchiveDuration: 1_440,
      guildId: GUILD_ID,
      kind: "forum",
      name: "launches",
      nsfw: false,
      operationKey: OPERATION_KEY,
      parentId: PARENT_ID,
      rateLimitPerUser: 30,
      topic: "Reviewed releases",
    },
    name: "plan_channel_creation",
  })
  const invalidCategory = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "category",
      name: "launches",
      operationKey: OPERATION_KEY,
      topic: "not accepted",
    },
    name: "plan_channel_creation",
  })
  const invalidKey = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: "short",
    },
    name: "plan_channel_creation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(invalidCategory.isError, true)
  assert.equal(invalidKey.isError, true)
  assert.equal(calls.channelCreationPlan, 1)
})

test("MCP channel creation binds signed approval to the exact additive request", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      defaultAutoArchiveDuration: 4_320,
      guildId: GUILD_ID,
      kind: "forum",
      name: "launches",
      nsfw: false,
      operationKey: OPERATION_KEY,
      parentId: PARENT_ID,
      planDigest: DIGEST,
      rateLimitPerUser: 30,
      topic: "Reviewed releases",
    },
    name: "execute_channel_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.channelCreationPlan, 1)
  assert.equal(calls.channelCreationExecute, 1)
  assert.match(confirmationMessage, /Action: create/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(PARENT_ID))
  assert.match(confirmationMessage, /Channel kind: forum/)
  assert.match(confirmationMessage, /Reviewed releases/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(OPERATION_KEY))
})

test("MCP channel creation returns an already-current no-op without confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { channelCreationAction: "none" },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })

  assert.equal(structuredContent(result).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(calls.channelCreationPlan, 1)
  assert.equal(calls.channelCreationExecute, 1)
})

test("MCP channel creation declines or rejects approval without reserving execution", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.channelCreationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.channelCreationExecute, 0)
})

test("MCP channel creation refuses changed plans before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { channelCreationPlanDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.channelCreationExecute, 0)
})

test("MCP channel creation exposes uncertain and one-shot conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationExecutionError(
        "Discord channel creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const blocked = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationExecutionError(
        "A concurrent logical target ended uncertain",
        { status: "blocked-prior-uncertain" },
      ),
    },
  })
  const blockedResult = await blocked.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(
    structuredContent(blockedResult).status,
    "blocked-prior-uncertain",
  )

  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationOperationConflictError({
        operationKeyHash: OPERATION_KEY_HASH,
        operationKey: OPERATION_KEY,
        status: "uncertain",
      }),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(OPERATION_KEY))

  const receipt = {
    activityId: "activity-0001",
    channelId: CHANNEL_ID,
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-14T00:00:00.000Z",
    verification: "match",
  }
  const completedConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationOperationConflictError(receipt),
    },
  })
  const completedConflictResult = await completedConflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(
    structuredContent(completedConflictResult).status,
    "operation-key-conflict",
  )
  assert.deepEqual(
    (structuredContent(completedConflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
})

test("MCP forum-tag tools expose bounded audit and exact action schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const audited = await client.callTool({
    arguments: { channelId: CHANNEL_ID },
    name: "audit_forum_tags",
  })
  const created = await client.callTool({
    arguments: {
      action: "create",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      moderated: true,
      name: "Escalated",
      operationKey: FORUM_TAG_OPERATION_KEY,
      unicodeEmoji: "🚨",
    },
    name: "plan_forum_tag_change",
  })
  const updated = await client.callTool({
    arguments: {
      action: "update-metadata",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: FORUM_TAG_OPERATION_KEY,
      tagId: FORUM_TAG_ID,
      unicodeEmoji: null,
    },
    name: "plan_forum_tag_change",
  })
  const deleted = await client.callTool({
    arguments: {
      action: "delete",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: FORUM_TAG_OPERATION_KEY,
      tagId: FORUM_TAG_ID,
    },
    name: "plan_forum_tag_change",
  })
  const emptyUpdate = await client.callTool({
    arguments: {
      action: "update-metadata",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: FORUM_TAG_OPERATION_KEY,
      tagId: FORUM_TAG_ID,
    },
    name: "plan_forum_tag_change",
  })
  const customEmoji = await client.callTool({
    arguments: {
      action: "create",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      name: "Custom",
      operationKey: FORUM_TAG_OPERATION_KEY,
      unicodeEmoji: `<:private:${EMOJI_ID}>`,
    },
    name: "plan_forum_tag_change",
  })

  assert.equal(structuredContent(audited).status, "ok")
  assert.deepEqual(
    (structuredContent(audited).inventory as Record<string, unknown>).returned,
    1,
  )
  assert.equal(structuredContent(created).mutation, "create")
  assert.equal(structuredContent(updated).mutation, "update-metadata")
  assert.equal(structuredContent(deleted).mutation, "delete")
  assert.equal(emptyUpdate.isError, true)
  assert.equal(customEmoji.isError, true)
  assert.equal(calls.forumTagAudit, 1)
  assert.equal(calls.forumTagPlan, 3)
})

test("MCP forum-tag changes bind signed approval to the exact ordered replacement", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "create",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      moderated: true,
      name: "Escalated",
      operationKey: FORUM_TAG_OPERATION_KEY,
      planDigest: DIGEST,
      unicodeEmoji: "🚨",
    },
    name: "execute_forum_tag_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).tagId, CREATED_FORUM_TAG_ID)
  assert.equal(calls.forumTagPlan, 1)
  assert.equal(calls.forumTagExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    FORUM_TAG_ID,
    "Escalated",
    "🚨",
    AUDIT_REASON,
    OPERATION_KEY_HASH,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Current ordered tags/)
  assert.match(confirmationMessage, /Desired ordered tags/)
  assert.match(confirmationMessage, /Deletion impact evidence/)
  assert.match(confirmationMessage, /VIEW_CHANNEL: true/)
  assert.match(confirmationMessage, /MANAGE_CHANNELS: true/)
  assert.match(confirmationMessage, /untrusted/)
  assert.match(confirmationMessage, /one non-retried full available_tags PATCH/)
  assert.doesNotMatch(confirmationMessage, new RegExp(FORUM_TAG_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(FORUM_TAG_OPERATION_KEY),
  )
})

test("MCP forum-tag no-ops skip approval while refusal and plan drift stop writes", async (context) => {
  const createArguments = {
    action: "create",
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    name: "Support",
    operationKey: FORUM_TAG_OPERATION_KEY,
    planDigest: DIGEST,
    unicodeEmoji: "📌",
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { forumTagEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: createArguments,
    name: "execute_forum_tag_change",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.forumTagExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "delete",
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: FORUM_TAG_OPERATION_KEY,
      planDigest: DIGEST,
      tagId: FORUM_TAG_ID,
    },
    name: "execute_forum_tag_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.forumTagExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { forumTagPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: createArguments,
    name: "execute_forum_tag_change",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.forumTagExecute, 0)
})

test("MCP forum-tag signed state distinguishes omitted metadata from null", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        action: "update-metadata",
        auditReason: AUDIT_REASON,
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        name: "Escalated",
        operationKey: FORUM_TAG_OPERATION_KEY,
        planDigest: DIGEST,
        tagId: FORUM_TAG_ID,
      },
      name: "execute_forum_tag_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        action: "update-metadata",
        auditReason: AUDIT_REASON,
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        name: "Escalated",
        operationKey: FORUM_TAG_OPERATION_KEY,
        planDigest: DIGEST,
        tagId: FORUM_TAG_ID,
        unicodeEmoji: null,
      },
      inputResponses: {
        confirm_forum_tag_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_forum_tag_change",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.forumTagExecute, 0)
})

test("MCP forum-tag changes expose uncertain and content-free conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    action: "delete",
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: FORUM_TAG_OPERATION_KEY,
    planDigest: DIGEST,
    tagId: FORUM_TAG_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      forumTagError: new ForumTagExecutionError(
        "Discord forum-tag outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_forum_tag_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-forum-tag",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    resourceId: FORUM_TAG_ID,
    status: "completed",
    timestamp: "2026-08-22T18:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      forumTagError: new ForumTagOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_forum_tag_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(FORUM_TAG_OPERATION_KEY),
  )
})

test("MCP forum posts plan exact tags, settings, notifications, and content", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      appliedTagIds: [ROLE_ID],
      auditReason: AUDIT_REASON,
      autoArchiveDuration: 4_320,
      channelId: CHANNEL_ID,
      content: `Please review the bounded launch proposal <@${USER_ID}>`,
      name: "Reviewed launch proposal",
      notifyUserIds: [USER_ID],
      operationKey: FORUM_POST_OPERATION_KEY,
      rateLimitPerUser: 30,
    },
    name: "plan_forum_post",
  })
  const duplicateTags = await client.callTool({
    arguments: {
      appliedTagIds: [ROLE_ID, ROLE_ID],
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      content: `Please review the bounded launch proposal <@${USER_ID}>`,
      name: "Reviewed launch proposal",
      operationKey: FORUM_POST_OPERATION_KEY,
    },
    name: "plan_forum_post",
  })
  const invalidContent = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      content: "   ",
      name: "Reviewed launch proposal",
      operationKey: FORUM_POST_OPERATION_KEY,
    },
    name: "plan_forum_post",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.deepEqual(
    (structuredContent(planned).target as Record<string, unknown>).appliedTagIds,
    [ROLE_ID],
  )
  assert.equal(duplicateTags.isError, true)
  assert.equal(invalidContent.isError, true)
  assert.equal(calls.forumPostPlan, 1)
})

test("MCP forum posts bind signed approval to the exact reviewed request", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      appliedTagIds: [ROLE_ID],
      auditReason: AUDIT_REASON,
      autoArchiveDuration: 4_320,
      channelId: CHANNEL_ID,
      content: `Please review the bounded launch proposal <@${USER_ID}>`,
      name: "Reviewed launch proposal",
      notifyUserIds: [USER_ID],
      operationKey: FORUM_POST_OPERATION_KEY,
      planDigest: DIGEST,
      rateLimitPerUser: 30,
    },
    name: "execute_forum_post",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.forumPostPlan, 1)
  assert.equal(calls.forumPostExecute, 1)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, /Reviewed launch proposal/)
  assert.match(confirmationMessage, /bounded launch proposal/)
  assert.match(confirmationMessage, new RegExp(ROLE_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, /Required bot permissions/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /without automatic retry/)
  assert.doesNotMatch(confirmationMessage, new RegExp(FORUM_POST_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(FORUM_POST_OPERATION_KEY),
  )
})

test("MCP forum posts stop before execution on refusal or a changed plan", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      content: "Please review the bounded launch proposal",
      name: "Reviewed launch proposal",
      operationKey: FORUM_POST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_forum_post",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.forumPostExecute, 0)

  let confirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { forumPostPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      content: "Please review the bounded launch proposal",
      name: "Reviewed launch proposal",
      operationKey: FORUM_POST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_forum_post",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(changed.calls.forumPostExecute, 0)
})

test("MCP forum posts expose uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      forumPostError: new ForumPostExecutionError(
        "Discord forum-post outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      content: "Please review the bounded launch proposal",
      name: "Reviewed launch proposal",
      operationKey: FORUM_POST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_forum_post",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-forum-post",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    threadId: MESSAGE_ID,
    timestamp: "2026-08-20T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      forumPostError: new ForumPostOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channelId: CHANNEL_ID,
      content: "Please review the bounded launch proposal",
      name: "Reviewed launch proposal",
      operationKey: FORUM_POST_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_forum_post",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(FORUM_POST_OPERATION_KEY),
  )
})

test("MCP thread creation validates exact mode-specific requests", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const anchored = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "from-message",
      name: "Reviewed source thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      sourceMessageId: MESSAGE_ID,
    },
    name: "plan_thread_creation",
  })
  const privateThread = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "standalone-private",
      name: "Reviewed private thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
    },
    name: "plan_thread_creation",
  })
  const invalidSource = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "standalone-public",
      name: "Invalid public thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      sourceMessageId: MESSAGE_ID,
    },
    name: "plan_thread_creation",
  })
  const invalidInvitable = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      invitable: true,
      mode: "from-message",
      name: "Invalid anchored thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      sourceMessageId: MESSAGE_ID,
    },
    name: "plan_thread_creation",
  })

  assert.equal(structuredContent(anchored).status, "planned")
  assert.equal(
    (structuredContent(privateThread).target as Record<string, unknown>).invitable,
    false,
  )
  assert.equal(invalidSource.isError, true)
  assert.equal(invalidInvitable.isError, true)
  assert.equal(calls.threadCreationPlan, 2)
})

test("MCP thread creation binds signed approval to source, settings, and digest", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      autoArchiveDuration: 4_320,
      mode: "from-message",
      name: "Reviewed source thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      planDigest: DIGEST,
      rateLimitPerUser: 30,
      sourceMessageId: MESSAGE_ID,
    },
    name: "execute_thread_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.threadCreationPlan, 1)
  assert.equal(calls.threadCreationExecute, 1)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Private source content/)
  assert.match(confirmationMessage, /Reviewed source thread/)
  assert.match(confirmationMessage, /Auto-archive minutes: 4320/)
  assert.match(confirmationMessage, /Thread slowmode seconds: 30/)
  assert.match(confirmationMessage, /Required bot permissions/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.doesNotMatch(confirmationMessage, new RegExp(THREAD_CREATION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(THREAD_CREATION_OPERATION_KEY),
  )
})

test("MCP existing source threads skip approval while refusal and plan drift stop writes", async (context) => {
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { threadCreationWriteRequired: false },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "from-message",
      name: "Ignored settings",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      planDigest: DIGEST,
      sourceMessageId: MESSAGE_ID,
    },
    name: "execute_thread_creation",
  })
  assert.equal(structuredContent(noOpResult).status, "source-already-threaded")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.threadCreationExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "standalone-public",
      name: "Declined thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      planDigest: DIGEST,
    },
    name: "execute_thread_creation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.threadCreationExecute, 0)

  let changedConfirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      changedConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { threadCreationPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "standalone-private",
      name: "Changed thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      planDigest: DIGEST,
    },
    name: "execute_thread_creation",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changedConfirmations, 0)
  assert.equal(changed.calls.threadCreationExecute, 0)
})

test("MCP thread creation exposes uncertain and one-shot conflict outcomes safely", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      threadCreationError: new ThreadCreationExecutionError(
        "Discord thread-creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "standalone-private",
      name: "Uncertain thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      planDigest: DIGEST,
    },
    name: "execute_thread_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-thread-create",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    threadId: MESSAGE_ID,
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      threadCreationError: new ThreadCreationOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      mode: "standalone-public",
      name: "Conflict thread",
      operationKey: THREAD_CREATION_OPERATION_KEY,
      parentChannelId: CHANNEL_ID,
      planDigest: DIGEST,
    },
    name: "execute_thread_creation",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(THREAD_CREATION_OPERATION_KEY),
  )
})

test("MCP guild scaffolds validate bounded additive resource graphs", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channels: [{
        key: "review-category",
        kind: "category",
        name: "Review",
      }],
      guildId: GUILD_ID,
      operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
      roles: [{
        key: "reviewer-role",
        name: "reviewer",
        permissions: ["VIEW_CHANNEL"],
      }],
      stepLimit: 2,
    },
    name: "plan_guild_scaffold",
  })
  const tooSmall = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channels: [{
        key: "review-category",
        kind: "category",
        name: "Review",
      }],
      guildId: GUILD_ID,
      operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
      roles: [],
    },
    name: "plan_guild_scaffold",
  })
  const unsafeRole = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channels: [{
        key: "review-category",
        kind: "category",
        name: "Review",
      }],
      guildId: GUILD_ID,
      operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
      roles: [{
        key: "reviewer-role",
        name: "reviewer",
        permissions: ["ADMINISTRATOR"],
      }],
    },
    name: "plan_guild_scaffold",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(tooSmall.isError, true)
  assert.equal(unsafeRole.isError, true)
  assert.equal(calls.guildScaffoldPlan, 1)
})

test("MCP guild scaffold verification returns only fresh content-free evidence", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channels: [{
        key: "review-category",
        kind: "category",
        name: "Private Review Space",
      }],
      guildId: GUILD_ID,
      operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
      roles: [{
        key: "reviewer-role",
        name: "Private Reviewer",
        permissions: ["VIEW_CHANNEL"],
      }],
      stepLimit: 2,
    },
    name: "verify_guild_scaffold",
  })
  const verification = structuredContent(result)

  assert.equal(result.isError, undefined)
  assert.equal(verification.status, "incomplete")
  assert.equal(verification.guildId, GUILD_ID)
  assert.equal(
    (verification.operation as Record<string, unknown>).operationKeyHash,
    OPERATION_KEY_HASH,
  )
  assert.deepEqual(verification.evidence, {
    callerRetainedRequestRequired: true,
    persistedDiscordContent: false,
    source: "live-discord-and-content-free-receipts",
  })
  assert.deepEqual(verification.steps, [{
    index: 0,
    kind: "role",
    resourceId: null,
    state: "ready",
  }, {
    index: 1,
    kind: "category",
    resourceId: null,
    state: "ready",
  }])
  assert.equal(calls.guildScaffoldVerify, 1)
  assert.equal(calls.guildScaffoldPlan, 0)
  assert.equal(calls.guildScaffoldExecute, 0)

  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /Private Review Space|Private Reviewer/)
  assert.equal(serialized.includes(AUDIT_REASON), false)
  assert.equal(serialized.includes(GUILD_SCAFFOLD_OPERATION_KEY), false)
})

test("MCP guild scaffolds bind signed approval to the exact reviewed frontier", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      channels: [{
        key: "review-category",
        kind: "category",
        name: "Review",
      }],
      guildId: GUILD_ID,
      operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
      planDigest: DIGEST,
      roles: [{
        key: "reviewer-role",
        name: "reviewer",
        permissions: ["VIEW_CHANNEL"],
      }],
      stepLimit: 2,
    },
    name: "execute_guild_scaffold",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.guildScaffoldPlan, 1)
  assert.equal(calls.guildScaffoldExecute, 1)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, /reviewer-role/)
  assert.match(confirmationMessage, /review-category/)
  assert.match(confirmationMessage, /Exact target/)
  assert.match(confirmationMessage, /Execution frontier step indexes: \[0,1\]/)
  assert.match(confirmationMessage, /In this execution frontier: true/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /forces a pause/)
  assert.doesNotMatch(confirmationMessage, new RegExp(GUILD_SCAFFOLD_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(GUILD_SCAFFOLD_OPERATION_KEY),
  )
})

test("MCP guild scaffolds stop before execution on refusal or a changed plan", async (context) => {
  const arguments_ = {
    auditReason: AUDIT_REASON,
    channels: [{ key: "review-category", kind: "category", name: "Review" }],
    guildId: GUILD_ID,
    operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
    planDigest: DIGEST,
    roles: [{
      key: "reviewer-role",
      name: "reviewer",
      permissions: ["VIEW_CHANNEL"],
    }],
  }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: arguments_,
    name: "execute_guild_scaffold",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.guildScaffoldExecute, 0)

  let confirmations = 0
  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { guildScaffoldPlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: arguments_,
    name: "execute_guild_scaffold",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changed.calls.guildScaffoldExecute, 0)
  assert.equal(confirmations, 0)
})

test("MCP guild scaffolds expose resumable, uncertain, and content-free conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const arguments_ = {
    auditReason: AUDIT_REASON,
    channels: [{ key: "review-category", kind: "category", name: "Review" }],
    guildId: GUILD_ID,
    operationKey: GUILD_SCAFFOLD_OPERATION_KEY,
    planDigest: DIGEST,
    roles: [{
      key: "reviewer-role",
      name: "reviewer",
      permissions: ["VIEW_CHANNEL"],
    }],
  }
  const paused = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildScaffoldError: new GuildScaffoldExecutionError(
        "A scaffold step stopped before write reservation",
        { status: "paused-step-prewrite" },
      ),
    },
  })
  const pausedResult = await paused.client.callTool({
    arguments: arguments_,
    name: "execute_guild_scaffold",
  })
  assert.equal(structuredContent(pausedResult).status, "paused-step-prewrite")

  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildScaffoldError: new GuildScaffoldExecutionError(
        "A scaffold write outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: arguments_,
    name: "execute_guild_scaffold",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "scaffold-operation",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    resourceId: null,
    status: "pending" as const,
    timestamp: "2026-08-20T00:00:00.000Z",
    verification: null,
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildScaffoldError: new GuildScaffoldOperationConflictError(
        "The scaffold operation is already reserved",
        receipt,
      ),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: arguments_,
    name: "execute_guild_scaffold",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(GUILD_SCAFFOLD_OPERATION_KEY),
  )

  const unsafeConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      guildScaffoldError: new GuildScaffoldOperationConflictError(
        "The scaffold receipt is unsafe",
        { ...receipt, operationKey: GUILD_SCAFFOLD_OPERATION_KEY },
      ),
    },
  })
  const unsafeResult = await unsafeConflict.client.callTool({
    arguments: arguments_,
    name: "execute_guild_scaffold",
  })
  assert.deepEqual(
    (structuredContent(unsafeResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(
    JSON.stringify(unsafeResult),
    new RegExp(GUILD_SCAFFOLD_OPERATION_KEY),
  )
})

test("MCP member-role changes plan exact IDs and reject unsafe schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      action: "add",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "plan_member_role_change",
  })
  const invalidAction = await client.callTool({
    arguments: {
      action: "replace",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "plan_member_role_change",
  })
  const extraField = await client.callTool({
    arguments: {
      action: "remove",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      replaceAllRoles: true,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "plan_member_role_change",
  })
  const invalidRole = await client.callTool({
    arguments: {
      action: "remove",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      roleId: "role-name",
      userId: USER_ID,
    },
    name: "plan_member_role_change",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(structuredContent(planned).requestedAction, "add")
  assert.equal(invalidAction.isError, true)
  assert.equal(extraField.isError, true)
  assert.equal(invalidRole.isError, true)
  assert.equal(calls.memberRolePlan, 1)
})

test("MCP member-role changes bind signed approval to exact role impact", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "add",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      planDigest: DIGEST,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "execute_member_role_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.memberRolePlan, 1)
  assert.equal(calls.memberRoleExecute, 1)
  assert.match(confirmationMessage, /Requested action: add/)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, new RegExp(ROLE_ID))
  assert.match(confirmationMessage, /Guild permissions added: SEND_MESSAGES/)
  assert.match(confirmationMessage, /Channel permission escalations are a bot subset: true/)
  assert.match(confirmationMessage, /SEND_MESSAGES: denied -> allowed/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(MEMBER_ROLE_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(MEMBER_ROLE_OPERATION_KEY),
  )
})

test("MCP member-role changes skip confirmation for no-ops and stop on refusal", async (context) => {
  let confirmations = 0
  const current = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { memberRoleAction: "none" },
  })
  const currentResult = await current.client.callTool({
    arguments: {
      action: "add",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      planDigest: DIGEST,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(currentResult).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(current.calls.memberRoleExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "remove",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      planDigest: DIGEST,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.memberRoleExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      action: "add",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      planDigest: DIGEST,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.memberRoleExecute, 0)
})

test("MCP member-role changes refuse fresh-plan drift before confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { memberRolePlanDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      action: "add",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_ROLE_OPERATION_KEY,
      planDigest: DIGEST,
      roleId: ROLE_ID,
      userId: USER_ID,
    },
    name: "execute_member_role_change",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.memberRoleExecute, 0)
})

test("MCP member-role changes expose uncertain, rate-limited, and conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const arguments_ = {
    action: "add" as const,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: MEMBER_ROLE_OPERATION_KEY,
    planDigest: DIGEST,
    roleId: ROLE_ID,
    userId: USER_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberRoleError: new MemberRoleExecutionError(
        "Discord member-role outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: arguments_,
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const changed = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberRoleError: new MemberRolePlanChangedError(DIGEST, DIFFERENT_DIGEST),
    },
  })
  const changedResult = await changed.client.callTool({
    arguments: arguments_,
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(
    ((structuredContent(changedResult).error as Record<string, unknown>).actualDigest),
    DIFFERENT_DIGEST,
  )

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "PUT",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/members/${USER_ID}/roles/${ROLE_ID}`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberRoleError: new MemberRoleExecutionError(
        "Discord member-role change was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: arguments_,
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(limitedResult).status, "rate-limited")
  assert.equal(
    ((structuredContent(limitedResult).error as Record<string, unknown>).retryAfterMs),
    2_500,
  )

  const receipt = {
    activityId: "activity-member-role",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    roleId: ROLE_ID,
    status: "completed",
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberRoleError: new MemberRoleOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: arguments_,
    name: "execute_member_role_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(MEMBER_ROLE_OPERATION_KEY))

  const unsafeConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberRoleError: new MemberRoleOperationConflictError({
        ...receipt,
        operationKey: MEMBER_ROLE_OPERATION_KEY,
      }),
    },
  })
  const unsafeResult = await unsafeConflict.client.callTool({
    arguments: arguments_,
    name: "execute_member_role_change",
  })
  assert.deepEqual(
    (structuredContent(unsafeResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(JSON.stringify(unsafeResult), new RegExp(MEMBER_ROLE_OPERATION_KEY))
})

test("MCP member voice tools audit exact state and reject unsafe action shapes", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const audited = await client.callTool({
    arguments: { guildId: GUILD_ID, userId: USER_ID },
    name: "get_member_voice_state",
  })
  const planned = await client.callTool({
    arguments: {
      action: "move",
      auditReason: AUDIT_REASON,
      destinationChannelId: PARENT_ID,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      userId: USER_ID,
    },
    name: "plan_member_voice_change",
  })
  const invalidRequests = [
    {
      action: "move",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      userId: USER_ID,
    },
    {
      action: "disconnect",
      auditReason: AUDIT_REASON,
      enabled: false,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      userId: USER_ID,
    },
    {
      action: "set-server-mute",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      userId: USER_ID,
    },
    {
      action: "set-server-deafen",
      auditReason: AUDIT_REASON,
      destinationChannelId: PARENT_ID,
      enabled: true,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      userId: USER_ID,
    },
  ]
  const invalidResults = await Promise.all(invalidRequests.map((arguments_) => (
    client.callTool({ arguments: arguments_, name: "plan_member_voice_change" })
  )))
  const invalidUser = await client.callTool({
    arguments: { guildId: GUILD_ID, userId: "0" },
    name: "get_member_voice_state",
  })

  assert.equal(structuredContent(audited).status, "ok")
  assert.equal(
    ((structuredContent(audited).privacy as Record<string, unknown>).enumeration),
    "none",
  )
  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(structuredContent(planned).action, "move")
  assert.equal(structuredContent(planned).destinationChannelId, undefined)
  assert.equal(invalidResults.every((result) => result.isError === true), true)
  assert.equal(invalidUser.isError, true)
  assert.equal(calls.memberVoiceGet, 1)
  assert.equal(calls.memberVoicePlan, 1)
})

test("MCP member voice changes bind signed approval to exact state and authority", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "move",
      auditReason: AUDIT_REASON,
      destinationChannelId: PARENT_ID,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_voice_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.memberVoicePlan, 1)
  assert.equal(calls.memberVoiceExecute, 1)
  assert.match(confirmationMessage, /Action: move/)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_OWNER_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(PARENT_ID))
  assert.match(confirmationMessage, /Source bot permissions: VIEW_CHANNEL, CONNECT, MOVE_MEMBERS/)
  assert.match(confirmationMessage, /Destination member permissions: VIEW_CHANNEL, CONNECT/)
  assert.match(confirmationMessage, /Target is below bot: true/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(MEMBER_VOICE_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(MEMBER_VOICE_OPERATION_KEY),
  )
})

test("MCP member voice changes skip no-op confirmation and stop on refusal", async (context) => {
  let confirmations = 0
  const current = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { memberVoiceWriteRequired: false },
  })
  const currentResult = await current.client.callTool({
    arguments: {
      action: "set-server-mute",
      auditReason: AUDIT_REASON,
      enabled: false,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(currentResult).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(current.calls.memberVoiceExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "disconnect",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.memberVoiceExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      action: "set-server-deafen",
      auditReason: AUDIT_REASON,
      enabled: true,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.memberVoiceExecute, 0)
})

test("MCP member voice changes refuse fresh-plan drift before confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { memberVoicePlanDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      action: "move",
      auditReason: AUDIT_REASON,
      destinationChannelId: PARENT_ID,
      guildId: GUILD_ID,
      operationKey: MEMBER_VOICE_OPERATION_KEY,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_voice_change",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.memberVoiceExecute, 0)
})

test("MCP member voice approval state binds the exact action-specific request", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = {
    action: "move" as const,
    auditReason: AUDIT_REASON,
    destinationChannelId: PARENT_ID,
    guildId: GUILD_ID,
    operationKey: MEMBER_VOICE_OPERATION_KEY,
    planDigest: DIGEST,
    userId: USER_ID,
  }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "execute_member_voice_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...request,
        destinationChannelId: MESSAGE_ID,
      },
      inputResponses: {
        confirm_member_voice_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_member_voice_change",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.memberVoiceExecute, 0)
})

test("MCP member voice changes expose uncertain, rate-limited, and conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const arguments_ = {
    action: "move" as const,
    auditReason: AUDIT_REASON,
    destinationChannelId: PARENT_ID,
    guildId: GUILD_ID,
    operationKey: MEMBER_VOICE_OPERATION_KEY,
    planDigest: DIGEST,
    userId: USER_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberVoiceError: new MemberVoiceExecutionError(
        "Discord member voice outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: arguments_,
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const changed = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberVoiceError: new MemberVoicePlanChangedError(DIGEST, DIFFERENT_DIGEST),
    },
  })
  const changedResult = await changed.client.callTool({
    arguments: arguments_,
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(
    ((structuredContent(changedResult).error as Record<string, unknown>).actualDigest),
    DIFFERENT_DIGEST,
  )

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "PATCH",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/members/${USER_ID}`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberVoiceError: new MemberVoiceExecutionError(
        "Discord member voice change was rate limited",
        { status: "uncertain" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: arguments_,
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(limitedResult).status, "rate-limited")
  assert.equal(
    ((structuredContent(limitedResult).error as Record<string, unknown>).retryAfterMs),
    2_500,
  )

  const receipt = {
    activityId: "activity-member-voice",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-22T00:00:00.000Z",
    userId: USER_ID,
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberVoiceError: new MemberVoiceOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: arguments_,
    name: "execute_member_voice_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(MEMBER_VOICE_OPERATION_KEY),
  )

  const unsafeConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      memberVoiceError: new MemberVoiceOperationConflictError({
        ...receipt,
        operationKey: MEMBER_VOICE_OPERATION_KEY,
      }),
    },
  })
  const unsafeResult = await unsafeConflict.client.callTool({
    arguments: arguments_,
    name: "execute_member_voice_change",
  })
  assert.deepEqual(
    (structuredContent(unsafeResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(
    JSON.stringify(unsafeResult),
    new RegExp(MEMBER_VOICE_OPERATION_KEY),
  )
})

test("MCP thread governance audits exact state and rejects mixed action shapes", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const audited = await client.callTool({
    arguments: { guildId: GUILD_ID, threadId: THREAD_ID },
    name: "get_thread_state",
  })
  const membership = await client.callTool({
    arguments: { guildId: GUILD_ID, threadId: THREAD_ID, userId: USER_ID },
    name: "get_thread_membership",
  })
  const planned = await client.callTool({
    arguments: {
      action: "rename",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewed-thread-name",
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      threadId: THREAD_ID,
    },
    name: "plan_thread_change",
  })
  const invalidMetadata = await client.callTool({
    arguments: {
      action: "archive",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "must-not-be-accepted",
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      threadId: THREAD_ID,
    },
    name: "plan_thread_change",
  })
  const invalidMembership = await client.callTool({
    arguments: {
      action: "add-member",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      threadId: THREAD_ID,
    },
    name: "plan_thread_change",
  })

  assert.equal(structuredContent(audited).status, "ok")
  assert.equal(
    ((structuredContent(audited).privacy as Record<string, unknown>).enumeration),
    "none",
  )
  assert.equal(
    ((structuredContent(audited).privacy as Record<string, unknown>).rawPayloadExposed),
    false,
  )
  assert.equal(structuredContent(membership).status, "ok")
  assert.equal(
    ((structuredContent(membership).membership as Record<string, unknown>).userId),
    USER_ID,
  )
  assert.equal(structuredContent(planned).status, "planned")
  assert.deepEqual(structuredContent(planned).desired, {
    field: "name",
    value: "reviewed-thread-name",
  })
  assert.equal(invalidMetadata.isError, true)
  assert.equal(invalidMembership.isError, true)
  assert.equal(calls.threadGovernanceGet, 1)
  assert.equal(calls.threadGovernanceMembership, 1)
  assert.equal(calls.threadGovernancePlan, 1)
})

test("MCP thread changes bind signed approval to exact state and authority", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      action: "rename",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewed-thread-name",
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      planDigest: DIGEST,
      threadId: THREAD_ID,
    },
    name: "execute_thread_change",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.threadGovernancePlan, 1)
  assert.equal(calls.threadGovernanceExecute, 1)
  assert.match(confirmationMessage, /Action: rename/)
  assert.match(confirmationMessage, new RegExp(APPLICATION_ID))
  assert.match(confirmationMessage, new RegExp(BOT_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(GUILD_OWNER_ID))
  assert.match(confirmationMessage, new RegExp(CHANNEL_ID))
  assert.match(confirmationMessage, new RegExp(THREAD_ID))
  assert.match(confirmationMessage, /Desired field: name/)
  assert.match(confirmationMessage, /Desired value: "reviewed-thread-name"/)
  assert.match(confirmationMessage, /Authorization basis: manage-threads/)
  assert.match(confirmationMessage, /VIEW_CHANNEL, MANAGE_THREADS/)
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(
    confirmationMessage,
    new RegExp(THREAD_GOVERNANCE_OPERATION_KEY),
  )
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(THREAD_GOVERNANCE_OPERATION_KEY),
  )
})

test("MCP thread changes skip no-op confirmation and stop on refusal or fresh drift", async (context) => {
  let confirmations = 0
  const current = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { threadGovernanceWriteRequired: false },
  })
  const currentResult = await current.client.callTool({
    arguments: {
      action: "set-slowmode",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      planDigest: DIGEST,
      rateLimitPerUser: 0,
      threadId: THREAD_ID,
    },
    name: "execute_thread_change",
  })
  assert.equal(structuredContent(currentResult).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(current.calls.threadGovernanceExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "archive",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      planDigest: DIGEST,
      threadId: THREAD_ID,
    },
    name: "execute_thread_change",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.threadGovernanceExecute, 0)

  const changed = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { threadGovernancePlanDigest: DIFFERENT_DIGEST },
  })
  const changedResult = await changed.client.callTool({
    arguments: {
      action: "lock",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      planDigest: DIGEST,
      threadId: THREAD_ID,
    },
    name: "execute_thread_change",
  })
  assert.equal(structuredContent(changedResult).status, "plan-changed")
  assert.equal(changedResult.isError, true)
  assert.equal(changed.calls.threadGovernanceExecute, 0)
  assert.equal(confirmations, 0)
})

test("MCP thread approval state binds the exact action-specific request", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = {
    action: "rename" as const,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "reviewed-thread-name",
    operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
    planDigest: DIGEST,
    threadId: THREAD_ID,
  }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "execute_thread_change",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")

  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...request,
        name: "different-thread-name",
      },
      inputResponses: {
        confirm_thread_change: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_thread_change",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.threadGovernanceExecute, 0)
})

test("MCP thread changes expose uncertain, rate-limited, and conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const arguments_ = {
    action: "archive" as const,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
    planDigest: DIGEST,
    threadId: THREAD_ID,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      threadGovernanceError: new ThreadGovernanceExecutionError(
        "Discord thread outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: arguments_,
    name: "execute_thread_change",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "PATCH",
    retryAfterMs: 2_500,
    route: `/channels/${THREAD_ID}`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      threadGovernanceError: new ThreadGovernanceExecutionError(
        "Discord thread change was rate limited",
        { status: "uncertain" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: arguments_,
    name: "execute_thread_change",
  })
  assert.equal(structuredContent(limitedResult).status, "rate-limited")
  assert.equal(
    ((structuredContent(limitedResult).error as Record<string, unknown>).retryAfterMs),
    2_500,
  )

  const receipt = {
    activityId: "activity-thread-governance",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    threadId: THREAD_ID,
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      threadGovernanceError: new ThreadGovernanceOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: arguments_,
    name: "execute_thread_change",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(THREAD_GOVERNANCE_OPERATION_KEY),
  )

  const unsafeConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      threadGovernanceError: new ThreadGovernanceOperationConflictError({
        ...receipt,
        operationKey: THREAD_GOVERNANCE_OPERATION_KEY,
      }),
    },
  })
  const unsafeResult = await unsafeConflict.client.callTool({
    arguments: arguments_,
    name: "execute_thread_change",
  })
  assert.deepEqual(
    (structuredContent(unsafeResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(
    JSON.stringify(unsafeResult),
    new RegExp(THREAD_GOVERNANCE_OPERATION_KEY),
  )
})

test("MCP role creation plans named permissions and rejects unsafe schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      hoist: true,
      mentionable: false,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      primaryColor: 0x12_34_56,
    },
    name: "plan_role_creation",
  })
  const administrator = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "admin",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["ADMINISTRATOR"],
    },
    name: "plan_role_creation",
  })
  const duplicate = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL", "VIEW_CHANNEL"],
    },
    name: "plan_role_creation",
  })
  const reserved = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "@everyone",
      operationKey: ROLE_OPERATION_KEY,
    },
    name: "plan_role_creation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(administrator.isError, true)
  assert.equal(duplicate.isError, true)
  assert.equal(reserved.isError, true)
  assert.equal(calls.roleCreationPlan, 1)
})

test("MCP role creation binds signed approval to exact properties and permissions", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      hoist: true,
      mentionable: false,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      planDigest: DIGEST,
      primaryColor: 0x12_34_56,
    },
    name: "execute_role_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.roleCreationPlan, 1)
  assert.equal(calls.roleCreationExecute, 1)
  assert.match(confirmationMessage, /Action: create/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, /Role name: "reviewer"/)
  assert.match(confirmationMessage, /VIEW_CHANNEL, READ_MESSAGE_HISTORY/)
  assert.match(confirmationMessage, /Primary color: 1193046/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(ROLE_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(ROLE_OPERATION_KEY))
})

test("MCP role creation handles no-op and refused confirmation without unsafe writes", async (context) => {
  let confirmations = 0
  const current = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { roleCreationAction: "none" },
  })
  const currentResult = await current.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL"],
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(currentResult).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(current.calls.roleCreationExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.roleCreationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.roleCreationExecute, 0)
})

test("MCP role creation refuses changed plans before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { roleCreationPlanDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.roleCreationExecute, 0)
})

test("MCP role creation exposes uncertain and one-shot conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationExecutionError(
        "Discord role creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const blocked = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationExecutionError(
        "A concurrent logical target ended uncertain",
        { status: "blocked-prior-uncertain" },
      ),
    },
  })
  const blockedResult = await blocked.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(
    structuredContent(blockedResult).status,
    "blocked-prior-uncertain",
  )

  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationOperationConflictError({
        operationKey: ROLE_OPERATION_KEY,
        operationKeyHash: OPERATION_KEY_HASH,
        status: "uncertain",
      }),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(ROLE_OPERATION_KEY))

  const receipt = {
    activityId: "activity-role-create",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    roleId: ROLE_ID,
    status: "completed",
    timestamp: "2026-08-14T00:00:00.000Z",
    verification: "match",
  }
  const completedConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationOperationConflictError(receipt),
    },
  })
  const completedConflictResult = await completedConflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(
    structuredContent(completedConflictResult).status,
    "operation-key-conflict",
  )
  assert.deepEqual(
    (structuredContent(completedConflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
})

test("MCP role configuration plans exact partial intent and rejects unsafe schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: roleConfigurationInput({
      hoist: true,
      mentionable: false,
      primaryColor: 0x12_34_56,
      secondaryColor: null,
      tertiaryColor: null,
    }),
    name: "plan_role_configuration",
  })
  const missingChange = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: ROLE_CONFIGURATION_OPERATION_KEY,
      roleId: ROLE_ID,
    },
    name: "plan_role_configuration",
  })
  const administrator = await client.callTool({
    arguments: roleConfigurationInput({ grantPermissions: ["ADMINISTRATOR"] }),
    name: "plan_role_configuration",
  })
  const overlap = await client.callTool({
    arguments: roleConfigurationInput({
      grantPermissions: ["SEND_MESSAGES"],
      revokePermissions: ["SEND_MESSAGES"],
    }),
    name: "plan_role_configuration",
  })
  const extra = await client.callTool({
    arguments: { ...roleConfigurationInput(), position: 10 },
    name: "plan_role_configuration",
  })

  const content = structuredContent(planned)
  assert.equal(content.status, "planned")
  assert.deepEqual(content.requestedFields, [
    "grantPermissions",
    "hoist",
    "mentionable",
    "name",
    "primaryColor",
    "secondaryColor",
    "tertiaryColor",
  ])
  assert.equal(content.memberCount, 7)
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(ROLE_CONFIGURATION_OPERATION_KEY))
  assert.equal(missingChange.isError, true)
  assert.equal(administrator.isError, true)
  assert.equal(overlap.isError, true)
  assert.equal(extra.isError, true)
  assert.equal(calls.roleConfigurationPlan, 1)
})

test("MCP role configuration binds signed approval to exact state and permission deltas", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const result = await client.callTool({
    arguments: {
      ...roleConfigurationInput({ revokePermissions: ["VIEW_CHANNEL"] }),
      planDigest: DIGEST,
    },
    name: "execute_role_configuration",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.roleConfigurationPlan, 1)
  assert.equal(calls.roleConfigurationExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    ROLE_ID,
    "Affected member count: 7",
    "Reviewers",
    "SEND_MESSAGES",
    "VIEW_CHANNEL",
    OPERATION_KEY_HASH,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Current role:/)
  assert.match(confirmationMessage, /Desired role:/)
  assert.match(confirmationMessage, /Effective permission revocations:/)
  assert.match(confirmationMessage, /Permission bitfield changes: true/)
  assert.match(confirmationMessage, /strictly below connector: true/)
  assert.match(confirmationMessage, /untrusted/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(ROLE_CONFIGURATION_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(ROLE_CONFIGURATION_OPERATION_KEY),
  )
})

test("MCP role configuration skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = {
    ...roleConfigurationInput(),
    planDigest: DIGEST,
  }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { roleConfigurationEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_configuration",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.roleConfigurationExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_configuration",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.roleConfigurationExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { roleConfigurationPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_configuration",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.roleConfigurationExecute, 0)
})

test("MCP role configuration exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = {
    ...roleConfigurationInput(),
    planDigest: DIGEST,
  }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleConfigurationError: new RoleConfigurationExecutionError(
        "Discord role configuration outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_configuration",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-role-configuration",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    roleId: ROLE_ID,
    status: "completed",
    timestamp: "2026-08-21T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleConfigurationError: new RoleConfigurationOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_configuration",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(ROLE_CONFIGURATION_OPERATION_KEY),
  )
})

test("MCP role ordering audits complete evidence and rejects ambiguous schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const audited = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "audit_role_order",
  })
  const planned = await client.callTool({
    arguments: roleOrderingInput(),
    name: "plan_role_order",
  })
  const sameRole = await client.callTool({
    arguments: roleOrderingInput({ anchorRoleId: ROLE_ID }),
    name: "plan_role_order",
  })
  const numericPosition = await client.callTool({
    arguments: { ...roleOrderingInput(), position: 10 },
    name: "plan_role_order",
  })

  const audit = structuredContent(audited)
  const plan = structuredContent(planned)
  assert.equal(audit.status, "ok")
  assert.equal((audit.order as unknown[]).length, 3)
  assert.equal(
    (audit.privacy as Record<string, unknown>).memberIdentitiesFetched,
    false,
  )
  assert.equal(plan.status, "planned")
  assert.equal(plan.placement, "above")
  assert.equal(
    (plan.impact as Record<string, unknown>).aggregateHolderAssignments,
    12,
  )
  assert.equal(sameRole.isError, true)
  assert.equal(numericPosition.isError, true)
  assert.equal(calls.auditRoleOrder, 1)
  assert.equal(calls.roleOrderingPlan, 1)
  assert.doesNotMatch(JSON.stringify(audited), new RegExp(ROLE_ORDERING_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(ROLE_ORDERING_OPERATION_KEY))
})

test("MCP role ordering binds approval to relative placement and complete impact", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const result = await client.callTool({
    arguments: { ...roleOrderingInput(), planDigest: DIGEST },
    name: "execute_role_order",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.roleOrderingPlan, 1)
  assert.equal(calls.roleOrderingExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    ROLE_ID,
    ROLE_ORDERING_ANCHOR_ID,
    "Private target",
    "Private anchor",
    "Moderators",
    "BAN_MEMBERS",
    OPERATION_KEY_HASH,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Placement: above/)
  assert.match(confirmationMessage, /Current ranks:/)
  assert.match(confirmationMessage, /Desired ranks:/)
  assert.match(confirmationMessage, /AggregateHolderAssignments|aggregateHolderAssignments/)
  assert.match(confirmationMessage, /complete hierarchy/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(ROLE_ORDERING_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(ROLE_ORDERING_OPERATION_KEY),
  )
})

test("MCP role ordering skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = { ...roleOrderingInput(), planDigest: DIGEST }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { roleOrderingEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_order",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.roleOrderingExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_order",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.roleOrderingExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { roleOrderingPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_order",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.roleOrderingExecute, 0)
})

test("MCP role-order approval state binds the exact target and anchor", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = { ...roleOrderingInput(), planDigest: DIGEST }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "execute_role_order",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")
  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...request,
        anchorRoleId: "350000000000000004",
      },
      inputResponses: {
        confirm_role_order: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_role_order",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.roleOrderingExecute, 0)
})

test("MCP role ordering exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = { ...roleOrderingInput(), planDigest: DIGEST }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleOrderingError: new RoleOrderingExecutionError(
        "Discord role-ordering outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_order",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-role-ordering",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    roleId: ROLE_ID,
    status: "completed",
    timestamp: "2026-08-23T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleOrderingError: new RoleOrderingOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_role_order",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(ROLE_ORDERING_OPERATION_KEY),
  )
})

test("MCP channel cloning plans one exact atomic payload without exposing the raw key", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const planned = await client.callTool({
    arguments: channelCloneInput(),
    name: "plan_channel_clone",
  })
  const extra = await client.callTool({
    arguments: { ...channelCloneInput(), position: 4 },
    name: "plan_channel_clone",
  })
  const invalidSource = await client.callTool({
    arguments: channelCloneInput({ sourceChannelId: "0" }),
    name: "plan_channel_clone",
  })

  const plan = structuredContent(planned)
  const target = plan.target as Record<string, unknown>
  const payload = target.payload as Record<string, unknown>
  assert.equal(plan.status, "planned")
  assert.equal((plan.source as Record<string, unknown>).id, CHANNEL_ID)
  assert.equal(payload.name, "reviewed-copy")
  assert.equal(payload.parentId, PARENT_ID)
  assert.equal("position" in payload, false)
  assert.equal(target.placement, "discord-default")
  assert.equal(extra.isError, true)
  assert.equal(invalidSource.isError, true)
  assert.equal(calls.channelClonePlan, 1)
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(CHANNEL_CLONE_OPERATION_KEY))
})

test("MCP channel cloning binds approval to source, atomic payload, and placement exclusion", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const result = await client.callTool({
    arguments: { ...channelCloneInput(), planDigest: DIGEST },
    name: "execute_channel_clone",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(structuredContent(result).createdChannelId, CHANNEL_CLONE_CREATED_ID)
  assert.equal(calls.channelClonePlan, 1)
  assert.equal(calls.channelCloneExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    PARENT_ID,
    "Private source channel",
    "Private source topic",
    "reviewed-copy",
    "MANAGE_CHANNELS",
    operationKeyHash(CHANNEL_CLONE_OPERATION_KEY),
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Target atomic create payload:/)
  assert.match(confirmationMessage, /source channel position is intentionally omitted/i)
  assert.match(confirmationMessage, /one non-retried atomic channel create/i)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(CHANNEL_CLONE_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(CHANNEL_CLONE_OPERATION_KEY),
  )
})

test("MCP channel cloning stops on refusal, drift, or mismatched signed state", async (context) => {
  const argumentsValue = { ...channelCloneInput(), planDigest: DIGEST }
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_clone",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.channelCloneExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { channelClonePlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_clone",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.channelCloneExecute, 0)

  const signed = await connectedModernStdioFixture(context)
  const initial = await signed.client.request({
    method: "tools/call",
    params: {
      arguments: argumentsValue,
      name: "execute_channel_clone",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })
  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")
  const invalid = await signed.client.request({
    method: "tools/call",
    params: {
      arguments: { ...argumentsValue, name: "different-reviewed-copy" },
      inputResponses: {
        confirm_channel_clone: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_channel_clone",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)
  assert.equal(structuredContent(invalid).status, "confirmation-invalid")
  assert.equal(invalid.isError, true)
  assert.equal(signed.calls.channelCloneExecute, 0)
})

test("MCP channel cloning exposes uncertainty and only content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = { ...channelCloneInput(), planDigest: DIGEST }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCloneError: new ChannelCloneExecutionError(
        "Discord channel-clone outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_clone",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-channel-clone",
    createdChannelId: CHANNEL_CLONE_CREATED_ID,
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: operationKeyHash(CHANNEL_CLONE_OPERATION_KEY),
    status: "completed",
    timestamp: "2026-08-23T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCloneError: new ChannelCloneOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_clone",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(CHANNEL_CLONE_OPERATION_KEY),
  )
})

test("MCP channel ordering audits complete safe layout and rejects ambiguous schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const audited = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "audit_channel_order",
  })
  const planned = await client.callTool({
    arguments: channelOrderingInput(),
    name: "plan_channel_order",
  })
  const sameChannel = await client.callTool({
    arguments: channelOrderingInput({ anchorChannelId: CHANNEL_ID }),
    name: "plan_channel_order",
  })
  const numericPosition = await client.callTool({
    arguments: { ...channelOrderingInput(), position: 10 },
    name: "plan_channel_order",
  })

  const audit = structuredContent(audited)
  const plan = structuredContent(planned)
  assert.equal(audit.status, "ok")
  assert.equal((audit.groups as unknown[]).length, 1)
  assert.equal(
    (audit.privacy as Record<string, unknown>).hiddenMetadataReturned,
    false,
  )
  assert.equal(plan.status, "planned")
  assert.equal(plan.placement, "above")
  assert.equal(
    (plan.impact as Record<string, unknown>).rawPositionWriteCount,
    3,
  )
  assert.equal(sameChannel.isError, true)
  assert.equal(numericPosition.isError, true)
  assert.equal(calls.auditChannelOrder, 1)
  assert.equal(calls.channelOrderingPlan, 1)
  assert.doesNotMatch(JSON.stringify(audited), new RegExp(CHANNEL_ORDERING_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(planned), new RegExp(CHANNEL_ORDERING_OPERATION_KEY))
})

test("MCP channel ordering binds approval to layout, relative placement, and full payload", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return { action: "accept", content: { approve: true } }
    },
    serverMessages,
  })
  const result = await client.callTool({
    arguments: { ...channelOrderingInput(), planDigest: DIGEST },
    name: "execute_channel_order",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.channelOrderingPlan, 1)
  assert.equal(calls.channelOrderingExecute, 1)
  for (const value of [
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    CHANNEL_ID,
    CHANNEL_ORDERING_ANCHOR_ID,
    PARENT_ID,
    "Private target channel",
    "Private anchor channel",
    "Middle channel",
    "MANAGE_CHANNELS",
    OPERATION_KEY_HASH,
    AUDIT_REASON,
    DIGEST,
  ]) {
    assert.match(confirmationMessage, new RegExp(value))
  }
  assert.match(confirmationMessage, /Placement: above/)
  assert.match(confirmationMessage, /Current order:/)
  assert.match(confirmationMessage, /Desired order:/)
  assert.match(confirmationMessage, /Complete position writes:/)
  assert.match(confirmationMessage, /complete same-parent sortable family/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(CHANNEL_ORDERING_OPERATION_KEY))
  assert.doesNotMatch(
    JSON.stringify(serverMessages),
    new RegExp(CHANNEL_ORDERING_OPERATION_KEY),
  )
})

test("MCP channel ordering skips no-op approval and stops on refusal or drift", async (context) => {
  const argumentsValue = { ...channelOrderingInput(), planDigest: DIGEST }
  let noOpConfirmations = 0
  const noOp = await connectedFixture(context, {
    elicitationHandler: async () => {
      noOpConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { channelOrderingEffect: "none" },
  })
  const noOpResult = await noOp.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_order",
  })
  assert.equal(structuredContent(noOpResult).status, "already-current")
  assert.equal(noOpConfirmations, 0)
  assert.equal(noOp.calls.channelOrderingExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_order",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.channelOrderingExecute, 0)

  let driftConfirmations = 0
  const drift = await connectedFixture(context, {
    elicitationHandler: async () => {
      driftConfirmations += 1
      return { action: "accept", content: { approve: true } }
    },
    serviceOverrides: { channelOrderingPlanDigest: DIFFERENT_DIGEST },
  })
  const driftResult = await drift.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_order",
  })
  assert.equal(structuredContent(driftResult).status, "plan-changed")
  assert.equal(driftResult.isError, true)
  assert.equal(driftConfirmations, 0)
  assert.equal(drift.calls.channelOrderingExecute, 0)
})

test("MCP channel-order approval state binds exact target and anchor channels", async (context) => {
  const fixture = await connectedModernStdioFixture(context)
  const request = { ...channelOrderingInput(), planDigest: DIGEST }
  const initial = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: request,
      name: "execute_channel_order",
    },
  }, withInputRequired(specTypeSchemas.CallToolResult), {
    allowInputRequired: true,
  })

  assert.equal(initial.resultType, "input_required")
  assert.equal(typeof initial.requestState, "string")
  const result = await fixture.client.request({
    method: "tools/call",
    params: {
      arguments: {
        ...request,
        anchorChannelId: "200000000000000006",
      },
      inputResponses: {
        confirm_channel_order: {
          action: "accept",
          content: { approve: true },
        },
      },
      name: "execute_channel_order",
      requestState: initial.requestState,
    },
  }, specTypeSchemas.CallToolResult)

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(fixture.calls.channelOrderingExecute, 0)
})

test("MCP channel ordering exposes uncertainty and content-free conflicts", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const argumentsValue = { ...channelOrderingInput(), planDigest: DIGEST }
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelOrderingError: new ChannelOrderingExecutionError(
        "Discord channel-ordering outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_order",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const receipt = {
    activityId: "activity-channel-ordering",
    channelId: CHANNEL_ID,
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-23T00:00:00.000Z",
    verification: "match",
  }
  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelOrderingError: new ChannelOrderingOperationConflictError(receipt),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: argumentsValue,
    name: "execute_channel_order",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
  assert.doesNotMatch(
    JSON.stringify(conflictResult),
    new RegExp(CHANNEL_ORDERING_OPERATION_KEY),
  )
})

test("MCP member moderation plans exact targets and enforces action-specific schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })
  const invalid = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      deleteMessageSeconds: 0,
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })
  const oversizedReason = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: "é".repeat(200),
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(calls.administrationPlan, 1)
  assert.equal(invalid.isError, true)
  assert.equal(oversizedReason.isError, true)
  assert.equal(calls.administrationPlan, 1)
})

test("MCP member moderation binds signed confirmation to target, action, reason, and digest", async (context) => {
  let confirmationMessage = ""
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
  })

  const result = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.administrationPlan, 1)
  assert.equal(calls.administrationExecute, 1)
  assert.match(confirmationMessage, /Action: kick/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
})

test("MCP member moderation declines or rejects approval without invoking execution", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.administrationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.administrationExecute, 0)
})

test("MCP member moderation refuses a changed plan before eliciting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { planDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.administrationExecute, 0)
})

test("MCP member moderation reports uncertain and rate-limited execution outcomes", async (context) => {
  const uncertain = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: true },
    }),
    serviceOverrides: {
      administrationError: new AdministrationExecutionError(
        "Discord moderation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "DELETE",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/members/${USER_ID}`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: true },
    }),
    serviceOverrides: {
      administrationError: new AdministrationExecutionError(
        "Discord moderation was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  const limitedStructured = structuredContent(limitedResult)
  assert.equal(limitedStructured.status, "rate-limited")
  assert.equal(
    (limitedStructured.error as Record<string, unknown>).retryAfterMs,
    2_500,
  )
})

test("MCP tool errors redact the Discord token", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      activityError: new Error(`activity failed with ${TOKEN}`),
    },
  })

  const result = await client.callTool({
    arguments: {},
    name: "list_activity",
  })

  assert.equal(result.isError, true)
  assert.equal(structuredContent(result).status, "error")
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.match(JSON.stringify(result), /\[redacted\]/)
})

test("MCP tool results redact the Discord token if Discord returns it as data", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      messageContent: `message containing ${TOKEN}`,
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    },
    name: "get_message",
  })

  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.match(JSON.stringify(result), /\[redacted\]/)
})

test("MCP stdio progressive discovery negotiates modern tool-list changes", async (context) => {
  const transport = new StdioClientTransport({
    args: ["--import", "tsx", "src/cli.ts", "serve"],
    command: process.execPath,
    cwd: process.cwd(),
    env: {
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_TOOLSETS: "deletion",
      DISCORD_MCP_TOOL_SURFACE: "progressive",
      PATH: process.env.PATH || "",
    },
    stderr: "pipe",
  })
  let diagnostics = ""
  transport.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk)
  })
  let changedTools: Tool[] | null = null
  let resolveNotification: (() => void) | undefined
  let rejectNotification: ((error: Error) => void) | undefined
  const notification = new Promise<void>((resolve, reject) => {
    resolveNotification = resolve
    rejectNotification = reject
  })
  const client = new Client(
    { name: "discord-mcp-stdio-progressive-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      listChanged: {
        tools: {
          debounceMs: 0,
          onChanged(error, tools) {
            if (error) {
              rejectNotification?.(error)
              return
            }
            changedTools = tools
            resolveNotification?.()
          },
        },
      },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    try {
      await client.close()
    } catch {}
  })

  await client.connect(transport)
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [MCP_DISCOVERY_TOOL_NAME],
  )
  const discovered = structuredContent(await client.callTool({
    arguments: { query: "plan_message_deletion" },
    name: MCP_DISCOVERY_TOOL_NAME,
  }))
  assert.deepEqual(discovered.newlyEnabledToolNames, [
    "delete_messages",
    "plan_message_deletion",
  ])

  let notificationTimer: NodeJS.Timeout | undefined
  await Promise.race([
    notification,
    new Promise<never>((_resolve, reject) => {
      notificationTimer = setTimeout(
        () => reject(new Error("Timed out waiting for MCP tool-list change")),
        LIST_CHANGED_TIMEOUT_MS,
      )
    }),
  ]).finally(() => {
    if (notificationTimer) clearTimeout(notificationTimer)
  })
  assert.ok(changedTools)
  assert.deepEqual((changedTools as Tool[]).map(({ name }) => name), [
    "plan_message_deletion",
    "delete_messages",
    MCP_DISCOVERY_TOOL_NAME,
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_message_deletion",
      "delete_messages",
      MCP_DISCOVERY_TOOL_NAME,
    ],
  )
  assert.match(diagnostics, /stdio server ready/)
  assert.doesNotMatch(diagnostics, new RegExp(TOKEN))
})

test("MCP stdio entrypoint negotiates modern catalogs without stdout noise", async (context) => {
  const transport = new StdioClientTransport({
    args: ["--import", "tsx", "src/cli.ts", "serve"],
    command: process.execPath,
    cwd: process.cwd(),
    env: {
      DISCORD_BOT_TOKEN: TOKEN,
      PATH: process.env.PATH || "",
    },
    stderr: "pipe",
  })
  let diagnostics = ""
  transport.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk)
  })
  const client = new Client(
    { name: "discord-mcp-stdio-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    try {
      await client.close()
    } catch {}
  })

  await client.connect(transport)
  const [tools, prompts, resources, templates, safety] = await Promise.all([
    client.listTools(),
    client.listPrompts(),
    client.listResources(),
    client.listResourceTemplates(),
    client.readResource({ uri: "discord://connector/safety" }),
  ])

  assert.equal(tools.tools.length, Object.keys(MCP_TOOL_CATALOG).length + 1)
  assert.equal(prompts.prompts.length, Object.keys(MCP_PROMPT_NAMES).length)
  assert.equal(resources.resources.length, Object.keys(MCP_RESOURCE_URIS).length)
  assert.equal(
    templates.resourceTemplates.length,
    Object.keys(MCP_RESOURCE_TEMPLATE_NAMES).length,
  )
  for (const catalog of [tools, prompts, resources, templates]) {
    assert.equal(catalog.cacheScope, "public")
    assert.equal(catalog.ttlMs, CATALOG_CACHE_TTL_MS)
  }
  assert.equal(safety.cacheScope, "public")
  assert.equal(safety.ttlMs, STATIC_RESOURCE_CACHE_TTL_MS)
  assert.match(diagnostics, /stdio server ready/)
  assert.doesNotMatch(diagnostics, new RegExp(TOKEN))
})

test("MCP stdio startup fails before reporting ready when the token is absent", () => {
  let diagnostics = ""

  assert.throws(
    () => runDiscordMcpServer({
      environment: {},
      stderr: {
        write(value) {
          diagnostics += String(value)
          return true
        },
      },
    }),
    /DISCORD_BOT_TOKEN is required/,
  )
  assert.equal(diagnostics, "")
})

test("MCP stdio runner rejects a source-only native Interaction adapter", () => {
  assert.throws(
    () => runDiscordMcpServer({
      environment: { DISCORD_BOT_TOKEN: TOKEN },
      nativeInteractions: undefined,
    } as unknown as DiscordMcpRunOptions),
    /accept nativeInteractionRuntime, not a source-only/,
  )
})

test("MCP stdio runner starts native Interaction ingress before Gateway and stops it after", async () => {
  const feed = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    cursorNamespace: "nativeinteractionrunner",
    enabled: true,
    eventFeedEnabled: false,
    layoutGuildIds: new Set(),
  })
  const lifecycle: string[] = []
  let releasePreflight: (() => void) | undefined
  const preflight = new Promise<void>((resolve) => {
    releasePreflight = resolve
  })
  const nativeInteractionRuntime: NativeInteractionRuntime = {
    enabled: true,
    getStatus() {
      return {
        command: {
          guildCount: 1,
          name: "discord-mcp",
          verifiedGuildCount: 1,
        },
        enabled: true,
        lastError: null,
        limits: {
          maximumPending: 25,
          pendingPerUser: 3,
          requestCharacters: 2_000,
          responseCharacters: 2_000,
          ttlSeconds: 600,
        },
        pending: { count: 0, validating: 0 },
        phase: "ready",
        schemaVersion: 1,
        totals: {
          accepted: 0,
          expired: 0,
          rejected: 0,
          responded: 0,
          uncertain: 0,
        },
      }
    },
    ingestInteraction() {},
    async listPending() {
      return {
        interactions: [],
        page: { capacity: 25, returned: 0 },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async respond() {
      throw new Error("No pending native Interaction")
    },
    async start() {
      lifecycle.push("native-start")
      await preflight
    },
    async stop() {
      lifecycle.push("native-stop")
    },
    subscribe() {
      return () => undefined
    },
  }
  const gatewayRuntime: NonNullable<DiscordMcpRunOptions["gatewayRuntime"]> = {
    enabled: true,
    layoutEnabled: feed.layoutEnabled,
    getChannelLayout: (guildId) => feed.getChannelLayout(guildId),
    getChannelLayoutStatus: () => feed.getChannelLayoutStatus(),
    getStatus: () => feed.getStatus(),
    listEvents: (options) => feed.listEvents(options),
    start() {
      lifecycle.push("gateway-start")
    },
    async stop() {
      lifecycle.push("gateway-stop")
    },
    subscribe: (listener) => feed.subscribe(listener),
    subscribeChannelLayouts: (listener) => feed.subscribeChannelLayouts(listener),
  }
  const serviceData = serviceFixture()
  const handle = runDiscordMcpServer({
    environment: {
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS: "true",
      DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
      DISCORD_MCP_BOT_ID: BOT_ID,
      DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_NATIVE_INTERACTION_USER_IDS: USER_ID,
    },
    gatewayRuntime,
    nativeInteractionRuntime,
    service: serviceData.service,
    stderr: { write: () => true },
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  })

  assert.deepEqual(lifecycle, ["native-start"])
  releasePreflight?.()
  await settleNotifications()
  assert.deepEqual(lifecycle, ["native-start", "gateway-start"])
  await handle.close()
  assert.deepEqual(lifecycle, [
    "native-start",
    "gateway-start",
    "gateway-stop",
    "native-stop",
  ])
})

test("MCP stdio runner stops Gateway and observability runtimes idempotently", async () => {
  const feed = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    cursorNamespace: "runnergateway",
    enabled: true,
    eventFeedEnabled: false,
    layoutGuildIds: new Set(),
  })
  let starts = 0
  let stops = 0
  let reportStopped: (() => void) | undefined
  const stopped = new Promise<void>((resolve) => {
    reportStopped = resolve
  })
  const gatewayRuntime: NonNullable<DiscordMcpRunOptions["gatewayRuntime"]> = {
    enabled: true,
    layoutEnabled: feed.layoutEnabled,
    getChannelLayout: (guildId) => feed.getChannelLayout(guildId),
    getChannelLayoutStatus: () => feed.getChannelLayoutStatus(),
    getStatus: () => feed.getStatus(),
    listEvents: (options) => feed.listEvents(options),
    start() {
      starts += 1
    },
    async stop() {
      stops += 1
      reportStopped?.()
    },
    subscribe: (listener) => feed.subscribe(listener),
    subscribeChannelLayouts: (listener) => feed.subscribeChannelLayouts(listener),
  }
  let flushes = 0
  let telemetryStops = 0
  const observabilityRuntime = new OperationalTelemetry({
    config: loadObservabilityConfig({
      DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    }, [TOKEN]),
    otlpFactory(_config, sink) {
      sink.transitionExporter("running")
      return {
        async forceFlush() {
          flushes += 1
        },
        async shutdown() {
          telemetryStops += 1
          sink.transitionExporter("stopped")
        },
      }
    },
  })
  let diagnostics = ""
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const handle = runDiscordMcpServer({
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    gatewayRuntime,
    stdin,
    observabilityRuntime,
    stderr: {
      write(value) {
        diagnostics += String(value)
        return true
      },
    },
    stdout,
  })

  assert.equal(starts, 1)
  assert.equal(observabilityRuntime.getObservabilityStatus().exporter.state, "running")
  assert.match(diagnostics, /stdio server ready/)
  stdin.end()
  await stopped
  await handle.close()
  assert.equal(stops, 1)
  assert.equal(flushes, 1)
  assert.equal(telemetryStops, 1)
  assert.equal(observabilityRuntime.getObservabilityStatus().exporter.state, "stopped")
})
