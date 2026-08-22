import assert from "node:assert/strict"
import process from "node:process"
import { PassThrough } from "node:stream"
import test, { type TestContext } from "node:test"

import {
  Client,
  InMemoryTransport,
  type ClientOptions,
  type Tool,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

import {
  AUDIT_LOG_LIMITS,
  BAN_AUDIT_LIMITS,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  ONBOARDING_LIMITS,
  WELCOME_SCREEN_LIMITS,
} from "../src/constants.js"
import type {
  AttachmentMessagePlan,
  AttachmentMessageRequest,
} from "../src/attachment-message-service.js"
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
  ForumPostPlan,
  ForumPostRequest,
} from "../src/forum-post-service.js"
import type {
  GuildScaffoldPlan,
  GuildScaffoldRequest,
} from "../src/guild-scaffold-service.js"
import type {
  GuildExpressionChangeRequest,
  GuildExpressionKind,
  GuildExpressionPlan,
  GuildExpressionPrivacyProjection,
  ProjectedGuildExpression,
} from "../src/guild-expression-service.js"
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
  AttachmentMessageExecutionError,
  AttachmentMessageOperationConflictError,
  AutoModerationExecutionError,
  AutoModerationOperationConflictError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
  ChannelMetadataExecutionError,
  ChannelMetadataOperationConflictError,
  ChannelPermissionOverwriteExecutionError,
  ChannelPermissionOverwriteOperationConflictError,
  DiscordApiError,
  ForumPostExecutionError,
  ForumPostOperationConflictError,
  GuildExpressionExecutionError,
  GuildExpressionOperationConflictError,
  GuildScaffoldExecutionError,
  GuildScaffoldOperationConflictError,
  InteractionExecutionError,
  InteractionRateLimitError,
  InviteDeletionExecutionError,
  InviteDeletionOperationConflictError,
  MessagePinExecutionError,
  MessagePinOperationConflictError,
  MemberRoleExecutionError,
  MemberRoleOperationConflictError,
  MemberRolePlanChangedError,
  OnboardingExecutionError,
  OnboardingOperationConflictError,
  PollExecutionError,
  PollOperationConflictError,
  RoleCreationExecutionError,
  RoleCreationOperationConflictError,
  RoleConfigurationExecutionError,
  RoleConfigurationOperationConflictError,
  ScheduledEventExecutionError,
  ScheduledEventOperationConflictError,
  SoundboardExecutionError,
  SoundboardOperationConflictError,
  StageInstanceExecutionError,
  StageInstanceOperationConflictError,
  ThreadCreationExecutionError,
  ThreadCreationOperationConflictError,
  WebhookDeletionExecutionError,
  WebhookDeletionOperationConflictError,
  WelcomeScreenExecutionError,
  WelcomeScreenOperationConflictError,
} from "../src/errors.js"
import {
  createDiscordMcpServer,
  runDiscordMcpServer,
  type DiscordMcpRunOptions,
  type DiscordToolService,
} from "../src/mcp.js"
import { GatewayEventStore, type GatewayEventSource } from "../src/gateway-events.js"
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_TEMPLATE_NAMES,
  MCP_RESOURCE_URIS,
} from "../src/mcp-guidance.js"
import { MCP_TOOL_CATALOG } from "../src/mcp-tool-catalog.js"
import { normalizeChannel, normalizeMessage } from "../src/normalize.js"
import { loadObservabilityConfig } from "../src/observability-config.js"
import { OperationalTelemetry } from "../src/observability.js"
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
  ProjectedWebhook,
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
const APPLICATION_ID = "110000000000000001"
const BOT_ID = "120000000000000001"
const CHANNEL_ID = "200000000000000001"
const PARENT_ID = "200000000000000002"
const MESSAGE_ID = "300000000000000001"
const ROLE_ID = "350000000000000001"
const AUDIT_ENTRY_ID = "360000000000000001"
const USER_ID = "400000000000000001"
const AUDIT_REASON = "Reviewed safety incident 42"
const OPERATION_KEY = "channel-create-attempt-0001"
const ROLE_OPERATION_KEY = "role-create-attempt-0001"
const ROLE_CONFIGURATION_OPERATION_KEY = "role-configuration-attempt-0001"
const ATTACHMENT_OPERATION_KEY = "attachment-send-attempt-0001"
const FORUM_POST_OPERATION_KEY = "forum-post-attempt-0001"
const THREAD_CREATION_OPERATION_KEY = "thread-create-attempt-0001"
const GUILD_SCAFFOLD_OPERATION_KEY = "guild-scaffold-attempt-0001"
const MESSAGE_PIN_OPERATION_KEY = "message-pin-attempt-0001"
const POLL_CREATION_OPERATION_KEY = "poll-create-attempt-0001"
const POLL_END_OPERATION_KEY = "poll-end-attempt-0001"
const POLL_QUESTION = "Which release theme should we choose?"
const POLL_ANSWER_ONE = "Reliability"
const POLL_ANSWER_TWO = "Usability"
const MEMBER_ROLE_OPERATION_KEY = "member-role-attempt-0001"
const PERMISSION_OVERWRITE_OPERATION_KEY = "permission-overwrite-attempt-0001"
const WEBHOOK_OPERATION_KEY = "webhook-delete-attempt-0001"
const WEBHOOK_ID = "370000000000000001"
const INVITE_OPERATION_KEY = "invite-delete-attempt-0001"
const INVITE_REF = `iref_hmac_sha256_${"6".repeat(64)}`
const PRIVATE_INVITE_CODE = "private-invite-capability"
const ONBOARDING_OPERATION_KEY = "onboarding-change-attempt-0001"
const WELCOME_SCREEN_OPERATION_KEY = "welcome-screen-change-attempt-0001"
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

function plan(digest = DIGEST) {
  return {
    channelId: CHANNEL_ID,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guildId: GUILD_ID,
    messageIds: [MESSAGE_ID],
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
    }],
    operations: [{
      kind: "individual" as const,
      messageIds: [MESSAGE_ID],
    }],
    schemaVersion: 1,
    status: "planned" as const,
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
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    channelMetadataChangesEnabled: false,
    channelMetadataIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
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
    readChannelScope: "all-visible",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    roleConfigurationEnabled: false,
    roleConfigurationIds: [],
    readGuildScope: "all-visible",
    threadCreationEnabled: false,
    threadParentIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookDeletionsEnabled: false,
    welcomeScreenAuditEnabled: false,
    welcomeScreenChangesEnabled: false,
    welcomeScreenGuildIds: [],
  }
}

function serviceFixture(overrides: {
  administrationError?: Error
  activityError?: Error
  attachmentError?: Error
  attachmentPlanDigest?: string
  autoModerationEffect?: "change" | "none"
  autoModerationError?: Error
  autoModerationPlanDigest?: string
  channelCreationAction?: "create" | "none"
  channelCreationError?: Error
  channelCreationPlanDigest?: string
  channelMetadataEffect?: "change" | "none"
  channelMetadataError?: Error
  channelMetadataPlanDigest?: string
  forumPostError?: Error
  forumPostPlanDigest?: string
  guildScaffoldError?: Error
  guildScaffoldPlanDigest?: string
  guildExpressionEffect?: "change" | "none"
  guildExpressionError?: Error
  guildExpressionPlanDigest?: string
  interactionError?: Error
  inviteDeletionError?: Error
  inviteDeletionPlanDigest?: string
  messageContent?: string
  messagePinAction?: "change" | "none"
  messagePinError?: Error
  messagePinPlanDigest?: string
  memberRoleAction?: "add" | "none" | "remove"
  memberRoleError?: Error
  memberRolePlanDigest?: string
  onboardingEffect?: "change" | "none"
  onboardingError?: Error
  onboardingPlanDigest?: string
  welcomeScreenEffect?: "change" | "none"
  welcomeScreenError?: Error
  welcomeScreenPlanDigest?: string
  permissionOverwriteAction?: "delete" | "none" | "put"
  permissionOverwriteError?: Error
  permissionOverwritePlanDigest?: string
  planDigest?: string
  pollCreationError?: Error
  pollCreationPlanDigest?: string
  pollEndError?: Error
  pollEndPlanDigest?: string
  pollEndWriteRequired?: boolean
  roleCreationAction?: "create" | "none"
  roleCreationError?: Error
  roleCreationPlanDigest?: string
  roleConfigurationEffect?: "change" | "none"
  roleConfigurationError?: Error
  roleConfigurationPlanDigest?: string
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
  webhookDeletionError?: Error
  webhookDeletionPlanDigest?: string
} = {}) {
  const welcomeScreenCalls = {
    execute: 0,
    get: 0,
    plan: 0,
  }
  const calls = {
    active: 0,
    addReaction: 0,
    auditRoles: 0,
    archived: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    attachmentExecute: 0,
    attachmentPlan: 0,
    autoModerationExecute: 0,
    autoModerationGet: 0,
    autoModerationList: 0,
    autoModerationPlan: 0,
    banGet: 0,
    banList: 0,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
    channelMetadataExecute: 0,
    channelMetadataGet: 0,
    channelMetadataPlan: 0,
    delete: 0,
    edit: 0,
    forumPostExecute: 0,
    forumPostPlan: 0,
    guildScaffoldExecute: 0,
    guildScaffoldPlan: 0,
    guildExpressionExecute: 0,
    guildExpressionGet: 0,
    guildExpressionList: 0,
    guildExpressionPlan: 0,
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
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    roleConfigurationExecute: 0,
    roleConfigurationPlan: 0,
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
    webhookDeletionExecute: 0,
    webhookDeletionGet: 0,
    webhookDeletionList: 0,
    webhookDeletionPlan: 0,
  }
  const service: DiscordToolService = {
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
    async getGuildOnboarding(_guildId, includeText = false) {
      calls.onboardingGet += 1
      return onboardingAudit(includeText)
    },
    async getGuildWelcomeScreen(_guildId, includeText = false) {
      welcomeScreenCalls.get += 1
      return welcomeScreenAudit(includeText)
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
    async planWebhookDeletion(request) {
      calls.webhookDeletionPlan += 1
      return webhookDeletionPlan(
        request,
        overrides.webhookDeletionPlanDigest || DIGEST,
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
    async deleteMessages(channelId, messageIds, planDigest) {
      calls.delete += 1
      return {
        activityId: "activity-one",
        channelId,
        deletedMessageIds: [...messageIds],
        guildId: GUILD_ID,
        planDigest,
        schemaVersion: 1,
        status: "completed",
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
          effectivePermissionNames: ["VIEW_CHANNEL"],
          effectivePermissions: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
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
    async planMessageDeletion() {
      calls.plan += 1
      return plan(overrides.planDigest)
    },
    async planAttachmentMessage(request) {
      calls.attachmentPlan += 1
      return attachmentPlan(
        request,
        overrides.attachmentPlanDigest || DIGEST,
      )
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
    async planMessagePin(request) {
      calls.messagePinPlan += 1
      return messagePinPlan(
        request,
        overrides.messagePinPlanDigest || DIGEST,
        overrides.messagePinAction,
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
  return { calls, service, welcomeScreenCalls }
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
  } = {},
) {
  const serviceData = serviceFixture(options.serviceOverrides)
  const server = createDiscordMcpServer({
    environment: {
      DISCORD_BOT_TOKEN: TOKEN,
      ...options.environment,
    },
    ...(options.gateway ? { gateway: options.gateway } : {}),
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
      "list_guilds",
      "list_channels",
      "get_channel",
      "list_roles",
      "get_role",
      "get_guild_member",
      "list_guild_members",
      "search_guild_members",
      "list_guild_bans",
      "get_guild_ban",
      "list_guild_invites",
      "get_guild_invite",
      "get_guild_onboarding",
      "get_guild_welcome_screen",
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
      "get_poll",
      "list_poll_answer_voters",
      "list_message_pins",
      "list_channel_webhooks",
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
      "plan_poll_creation",
      "execute_poll_creation",
      "plan_poll_end",
      "execute_poll_end",
      "plan_message_deletion",
      "delete_messages",
      "plan_message_pin",
      "execute_message_pin",
      "plan_webhook_deletion",
      "execute_webhook_deletion",
      "plan_invite_deletion",
      "execute_invite_deletion",
      "plan_onboarding_change",
      "execute_onboarding_change",
      "plan_guild_welcome_screen_change",
      "execute_guild_welcome_screen_change",
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
      "plan_channel_permission_overwrite",
      "execute_channel_permission_overwrite",
      "plan_channel_creation",
      "execute_channel_creation",
      "plan_forum_post",
      "execute_forum_post",
      "plan_thread_creation",
      "execute_thread_creation",
      "plan_attachment_message",
      "execute_attachment_message",
      "plan_guild_scaffold",
      "execute_guild_scaffold",
      "plan_member_role_change",
      "execute_member_role_change",
      "plan_role_creation",
      "execute_role_creation",
      "plan_role_configuration",
      "execute_role_configuration",
      "plan_member_moderation",
      "execute_member_moderation",
      "list_activity",
      "discover_discord_tools",
    ],
  )
  const deletion = result.tools.find((tool) => tool.name === "delete_messages")
  const messagePin = result.tools.find((tool) => tool.name === "execute_message_pin")
  const pollEnd = result.tools.find((tool) => tool.name === "execute_poll_end")
  const webhookDeletion = result.tools.find((tool) => tool.name === "execute_webhook_deletion")
  const inviteDeletion = result.tools.find((tool) => tool.name === "execute_invite_deletion")
  const onboarding = result.tools.find((tool) => tool.name === "execute_onboarding_change")
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
  const roleConfiguration = result.tools.find((tool) => (
    tool.name === "execute_role_configuration"
  ))
  for (const tool of [
    deletion,
    messagePin,
    pollEnd,
    webhookDeletion,
    inviteDeletion,
    onboarding,
    guildExpression,
    soundboard,
    scheduledEvent,
    channelMetadata,
    permissionOverwrite,
    administration,
    memberRole,
    roleConfiguration,
  ]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
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
    "get_poll",
    "list_poll_answer_voters",
    "list_channel_webhooks",
    "get_channel_webhook",
    "list_guild_invites",
    "get_guild_invite",
    "get_guild_onboarding",
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
    "plan_channel_metadata_change",
    "plan_channel_permission_overwrite",
    "plan_message_pin",
    "plan_poll_creation",
    "plan_poll_end",
    "plan_thread_creation",
    "plan_member_role_change",
    "plan_webhook_deletion",
    "plan_invite_deletion",
    "plan_onboarding_change",
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
        channelId: CHANNEL_ID,
        messageIds: [MESSAGE_ID],
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
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_guild_scaffold",
      "execute_guild_scaffold",
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
    auditRoles: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    archived: 1,
    attachmentExecute: 0,
    attachmentPlan: 0,
    autoModerationExecute: 0,
    autoModerationGet: 0,
    autoModerationList: 0,
    autoModerationPlan: 0,
    banGet: 0,
    banList: 0,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
    channelMetadataExecute: 0,
    channelMetadataGet: 0,
    channelMetadataPlan: 0,
    delete: 0,
    edit: 0,
    explain: 1,
    forumPostExecute: 0,
    forumPostPlan: 0,
    guildScaffoldExecute: 0,
    guildScaffoldPlan: 0,
    guildExpressionExecute: 0,
    guildExpressionGet: 0,
    guildExpressionList: 0,
    guildExpressionPlan: 0,
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
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    roleConfigurationExecute: 0,
    roleConfigurationPlan: 0,
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
    webhookDeletionExecute: 0,
    webhookDeletionGet: 0,
    webhookDeletionList: 0,
    webhookDeletionPlan: 0,
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

test("MCP Gateway tools expose local health and cursor continuity without content", async (context) => {
  const gateway = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    clock: () => new Date("2026-08-19T00:00:00.000Z"),
    cursorNamespace: "mcptooltest1",
    enabled: true,
  })
  const { client } = await connectedFixture(context, { gateway })
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

test("MCP observability reports successful, returned-error, and thrown-error tool outcomes", async (context) => {
  const privateDetail = "private activity failure 999999999999999999"
  const { client } = await connectedFixture(context, {
    serviceOverrides: { activityError: new Error(privateDetail) },
  })

  await client.callTool({ arguments: {}, name: "list_guilds" })
  const returnedError = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
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
  assert.equal(invalid.isError, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.edit, 1)
  assert.equal(calls.addReaction, 1)
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
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.plan, 1)
  assert.equal(calls.delete, 1)
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Content: "hello"/)
  assert.match(confirmationMessage, new RegExp(DIGEST))
})

test("MCP deletion stops without writing when confirmation is declined", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
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
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
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
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.delete, 0)
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

test("MCP stdio runner stops Gateway and observability runtimes idempotently", async () => {
  const feed = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    cursorNamespace: "runnergateway",
    enabled: true,
  })
  let starts = 0
  let stops = 0
  let reportStopped: (() => void) | undefined
  const stopped = new Promise<void>((resolve) => {
    reportStopped = resolve
  })
  const gatewayRuntime: NonNullable<DiscordMcpRunOptions["gatewayRuntime"]> = {
    enabled: true,
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
