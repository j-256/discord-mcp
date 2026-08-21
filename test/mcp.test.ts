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
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import type {
  AttachmentMessagePlan,
  AttachmentMessageRequest,
} from "../src/attachment-message-service.js"
import type { ChannelCreationRequest } from "../src/channel-administration-service.js"
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
import type {
  MessagePinPlan,
  MessagePinRequest,
} from "../src/message-pin-service.js"
import {
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
  type NormalizedDiscordRole,
  type RoleCreationPlan,
  type RoleCreationRequest,
} from "../src/role-administration-service.js"
import {
  AdministrationExecutionError,
  AttachmentMessageExecutionError,
  AttachmentMessageOperationConflictError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
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
  MessagePinExecutionError,
  MessagePinOperationConflictError,
  RoleCreationExecutionError,
  RoleCreationOperationConflictError,
  WebhookDeletionExecutionError,
  WebhookDeletionOperationConflictError,
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
const ATTACHMENT_OPERATION_KEY = "attachment-send-attempt-0001"
const FORUM_POST_OPERATION_KEY = "forum-post-attempt-0001"
const GUILD_SCAFFOLD_OPERATION_KEY = "guild-scaffold-attempt-0001"
const MESSAGE_PIN_OPERATION_KEY = "message-pin-attempt-0001"
const PERMISSION_OVERWRITE_OPERATION_KEY = "permission-overwrite-attempt-0001"
const WEBHOOK_OPERATION_KEY = "webhook-delete-attempt-0001"
const WEBHOOK_ID = "370000000000000001"
const EMOJI_ID = "380000000000000001"
const STICKER_ID = "390000000000000001"
const GUILD_EXPRESSION_OPERATION_KEY = "guild-expression-attempt-0001"
const GUILD_EXPRESSION_PATH = "/test/discord-mcp/reviewed-expression.png"
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
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
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
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    memberDirectoryEnabled: true,
    memberDirectoryGuildIds: [GUILD_ID],
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 0,
    pinChannelIds: [],
    pinManagementEnabled: false,
    readChannelScope: "all-visible",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    readGuildScope: "all-visible",
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookDeletionsEnabled: false,
  }
}

function serviceFixture(overrides: {
  administrationError?: Error
  activityError?: Error
  attachmentError?: Error
  attachmentPlanDigest?: string
  channelCreationAction?: "create" | "none"
  channelCreationError?: Error
  channelCreationPlanDigest?: string
  forumPostError?: Error
  forumPostPlanDigest?: string
  guildScaffoldError?: Error
  guildScaffoldPlanDigest?: string
  guildExpressionEffect?: "change" | "none"
  guildExpressionError?: Error
  guildExpressionPlanDigest?: string
  interactionError?: Error
  messageContent?: string
  messagePinAction?: "change" | "none"
  messagePinError?: Error
  messagePinPlanDigest?: string
  permissionOverwriteAction?: "delete" | "none" | "put"
  permissionOverwriteError?: Error
  permissionOverwritePlanDigest?: string
  planDigest?: string
  roleCreationAction?: "create" | "none"
  roleCreationError?: Error
  roleCreationPlanDigest?: string
  webhookDeletionError?: Error
  webhookDeletionPlanDigest?: string
} = {}) {
  const calls = {
    active: 0,
    addReaction: 0,
    auditRoles: 0,
    archived: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    attachmentExecute: 0,
    attachmentPlan: 0,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
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
    explain: 0,
    getRole: 0,
    memberGet: 0,
    memberList: 0,
    memberSearch: 0,
    listRoles: 0,
    messagePinExecute: 0,
    messagePinList: 0,
    messagePinPlan: 0,
    permissionOverwriteExecute: 0,
    permissionOverwriteList: 0,
    permissionOverwritePlan: 0,
    plan: 0,
    principalExplain: 0,
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    search: 0,
    send: 0,
    webhookDeletionExecute: 0,
    webhookDeletionGet: 0,
    webhookDeletionList: 0,
    webhookDeletionPlan: 0,
  }
  const service: DiscordToolService = {
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
    async planMessagePin(request) {
      calls.messagePinPlan += 1
      return messagePinPlan(
        request,
        overrides.messagePinPlanDigest || DIGEST,
        overrides.messagePinAction,
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
  return { calls, service }
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
      "list_roles",
      "get_role",
      "get_guild_member",
      "list_guild_members",
      "search_guild_members",
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
      "list_message_pins",
      "list_channel_webhooks",
      "get_channel_webhook",
      "list_guild_emojis",
      "get_guild_emoji",
      "list_guild_stickers",
      "get_guild_sticker",
      "list_channel_permission_overwrites",
      "send_message",
      "edit_own_message",
      "add_reaction",
      "plan_message_deletion",
      "delete_messages",
      "plan_message_pin",
      "execute_message_pin",
      "plan_webhook_deletion",
      "execute_webhook_deletion",
      "plan_guild_expression_change",
      "execute_guild_expression_change",
      "plan_channel_permission_overwrite",
      "execute_channel_permission_overwrite",
      "plan_channel_creation",
      "execute_channel_creation",
      "plan_forum_post",
      "execute_forum_post",
      "plan_attachment_message",
      "execute_attachment_message",
      "plan_guild_scaffold",
      "execute_guild_scaffold",
      "plan_role_creation",
      "execute_role_creation",
      "plan_member_moderation",
      "execute_member_moderation",
      "list_activity",
      "discover_discord_tools",
    ],
  )
  const deletion = result.tools.find((tool) => tool.name === "delete_messages")
  const messagePin = result.tools.find((tool) => tool.name === "execute_message_pin")
  const webhookDeletion = result.tools.find((tool) => tool.name === "execute_webhook_deletion")
  const guildExpression = result.tools.find((tool) => (
    tool.name === "execute_guild_expression_change"
  ))
  const permissionOverwrite = result.tools.find((tool) => (
    tool.name === "execute_channel_permission_overwrite"
  ))
  const administration = result.tools.find((tool) => (
    tool.name === "execute_member_moderation"
  ))
  for (const tool of [
    deletion,
    messagePin,
    webhookDeletion,
    guildExpression,
    permissionOverwrite,
    administration,
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
    "list_channel_webhooks",
    "get_channel_webhook",
    "list_guild_emojis",
    "get_guild_emoji",
    "list_guild_stickers",
    "get_guild_sticker",
    "plan_channel_permission_overwrite",
    "plan_message_pin",
    "plan_webhook_deletion",
    "plan_guild_expression_change",
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
    channelCreationExecute: 0,
    channelCreationPlan: 0,
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
    getRole: 0,
    memberGet: 0,
    memberList: 0,
    memberSearch: 0,
    listRoles: 0,
    messagePinExecute: 0,
    messagePinList: 0,
    messagePinPlan: 0,
    permissionOverwriteExecute: 0,
    permissionOverwriteList: 0,
    permissionOverwritePlan: 0,
    plan: 0,
    principalExplain: 0,
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    search: 0,
    send: 0,
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
  assert.equal(resources.resources.length, 7)
  assert.equal(templates.resourceTemplates.length, 10)
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
