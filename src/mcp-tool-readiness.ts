import { connectorConfigFields } from "./config-document.js"
import {
  MCP_DISCOVERY_TOOL_NAME,
  type McpToolsetName,
} from "./constants.js"
import type { McpToolName } from "./observability-catalog.js"
import {
  DISCORD_PERMISSION_NAMES,
  type DiscordPermissionName,
} from "./permissions.js"

export const MCP_TOOL_AUTH_CLASSES = Object.freeze([
  "bot",
  "bot-and-stored-webhook-token",
  "none",
  "short-lived-interaction-token",
] as const)

export type McpToolAuthClass = typeof MCP_TOOL_AUTH_CLASSES[number]

export const MCP_TOOL_TARGET_SCOPES = Object.freeze([
  "application",
  "channel",
  "guild",
  "interaction",
  "local",
  "user",
  "webhook",
] as const)

export type McpToolTargetScope = typeof MCP_TOOL_TARGET_SCOPES[number]

export const MCP_TOOL_PERMISSION_MODES = Object.freeze([
  "all-listed",
  "conditional",
  "delegated-runtime",
  "none",
] as const)

export type McpToolPermissionMode = typeof MCP_TOOL_PERMISSION_MODES[number]

export const MCP_TOOL_HIERARCHY_MODES = Object.freeze([
  "conditional",
  "not-applicable",
  "required",
] as const)

export type McpToolHierarchyMode = typeof MCP_TOOL_HIERARCHY_MODES[number]

export const MCP_TOOL_GATEWAY_INTENTS = Object.freeze([
  "GUILDS",
  "GUILD_MEMBERS",
  "MESSAGE_CONTENT",
] as const)

export type McpToolGatewayIntent = typeof MCP_TOOL_GATEWAY_INTENTS[number]

export interface McpToolIntentRequirement {
  name: McpToolGatewayIntent
  privileged: boolean
  status: "conditional" | "recommended" | "required"
}

export interface McpToolPermissionCondition {
  case: string
  permissions: readonly DiscordPermissionName[]
}

export interface McpToolStaticRequirements {
  authentication: McpToolAuthClass
  configuration: {
    evaluation: "operation-runtime"
    policyPaths: readonly string[]
    recipeNames: readonly (
      | "coordination-channel"
      | "channel-publisher"
      | "direct-messenger"
      | "guild-builder"
      | "guild-starter"
      | "incident-response"
    )[]
    presetNames: readonly ("channel-reader" | "server-observer")[]
  }
  discord: {
    conditions: readonly McpToolPermissionCondition[]
    hierarchy: McpToolHierarchyMode
    intents: readonly McpToolIntentRequirement[]
    permissionMode: McpToolPermissionMode
    permissions: readonly DiscordPermissionName[]
    verification: "not-applicable" | "operation-runtime"
  }
  source: "exact-tool" | "toolset"
  targetScope: McpToolTargetScope
}

interface RequirementSource {
  authentication?: McpToolAuthClass
  conditions?: readonly McpToolPermissionCondition[]
  hierarchy?: McpToolHierarchyMode
  intents?: readonly McpToolIntentRequirement[]
  permissionMode?: McpToolPermissionMode
  permissions?: readonly DiscordPermissionName[]
  policyPaths?: readonly string[]
  targetScope: McpToolTargetScope
}

const GUILD_READ_SCOPE = "$.readScope.guildIds"
const CHANNEL_READ_SCOPE = "$.readScope.channelIds"
const GATEWAY_ENABLED = "$.gateway.enabled"

const intent = (
  name: McpToolGatewayIntent,
  status: McpToolIntentRequirement["status"],
): McpToolIntentRequirement => ({
  name,
  privileged: name === "GUILD_MEMBERS" || name === "MESSAGE_CONTENT",
  status,
})

const condition = (
  caseName: string,
  permissions: readonly DiscordPermissionName[],
): McpToolPermissionCondition => ({ case: caseName, permissions })

const local = (
  policyPaths: readonly string[] = [],
): RequirementSource => ({
  authentication: "none",
  permissionMode: "none",
  policyPaths,
  targetScope: "local",
})

const application = (
  policyPaths: readonly string[] = [],
): RequirementSource => ({
  permissionMode: "none",
  policyPaths,
  targetScope: "application",
})

const guild = (
  policyPaths: readonly string[],
  permissions: readonly DiscordPermissionName[] = [],
  options: Omit<RequirementSource, "permissions" | "policyPaths" | "targetScope"> = {},
): RequirementSource => ({
  ...options,
  permissions,
  policyPaths: [GUILD_READ_SCOPE, ...policyPaths],
  targetScope: "guild",
})

const channel = (
  policyPaths: readonly string[],
  permissions: readonly DiscordPermissionName[],
  options: Omit<RequirementSource, "permissions" | "policyPaths" | "targetScope"> = {},
): RequirementSource => ({
  ...options,
  permissions,
  policyPaths: [GUILD_READ_SCOPE, CHANNEL_READ_SCOPE, ...policyPaths],
  targetScope: "channel",
})

const MCP_TOOLSET_REQUIREMENTS = Object.freeze({
  activity: local(["$.storage.auditFile"]),
  "announcement-crossposts": channel([
    "$.capabilities.announcementCrossposts",
    "$.scopes.announcementCrosspostChannelIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "SEND_MESSAGES"], {
    conditions: [condition("message-authored-by-another-user", ["MANAGE_MESSAGES"])],
    intents: [intent("MESSAGE_CONTENT", "required")],
    permissionMode: "conditional",
  }),
  "announcement-subscriptions": channel([
    "$.capabilities.announcementSubscriptionAudit",
    "$.capabilities.announcementSubscriptionChanges",
    "$.scopes.announcementSubscriptionSourceChannelIds",
    "$.scopes.announcementSubscriptionTargetChannelIds",
  ], ["VIEW_CHANNEL", "MANAGE_WEBHOOKS"]),
  "application-commands": application([
    "$.capabilities.applicationCommandChanges",
    "$.capabilities.globalApplicationCommandChanges",
    GUILD_READ_SCOPE,
    "$.scopes.applicationCommandGuildIds",
  ]),
  "application-emojis": application([
    "$.capabilities.applicationEmojiAudit",
    "$.capabilities.applicationEmojiChanges",
    "$.storage.applicationEmojiRoots",
  ]),
  "application-entitlement-changes": application([
    "$.capabilities.applicationEntitlementConsumption",
    "$.capabilities.applicationTestEntitlementChanges",
    "$.scopes.applicationConsumableEntitlementSkuIds",
    "$.scopes.applicationConsumableEntitlementUserIds",
    "$.scopes.applicationTestEntitlementGuildIds",
    "$.scopes.applicationTestEntitlementSkuIds",
    "$.scopes.applicationTestEntitlementUserIds",
  ]),
  "application-monetization": application([
    "$.capabilities.applicationMonetizationAudit",
    "$.scopes.applicationEntitlementGuildIds",
    "$.scopes.applicationEntitlementUserIds",
    "$.scopes.applicationMonetizationSkuIds",
    "$.scopes.applicationSubscriptionUserIds",
  ]),
  "application-security": application([
    "$.capabilities.applicationIntentChanges",
  ]),
  attachments: channel([
    "$.capabilities.attachments",
    "$.scopes.attachmentChannelIds",
    "$.storage.attachmentRoots",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "ATTACH_FILES"], {
    conditions: [
      condition("direct-channel", ["SEND_MESSAGES"]),
      condition("thread-channel", ["SEND_MESSAGES_IN_THREADS"]),
    ],
    intents: [intent("MESSAGE_CONTENT", "required")],
    permissionMode: "conditional",
  }),
  "audit-logs": guild([
    GUILD_READ_SCOPE,
  ], ["VIEW_AUDIT_LOG"]),
  automod: guild([
    "$.capabilities.automodAudit",
    "$.capabilities.automodChanges",
    "$.scopes.automodAlertChannelIds",
    "$.scopes.automodGuildIds",
  ], ["MANAGE_GUILD"], {
    conditions: [condition("timeout-action", ["MODERATE_MEMBERS"])],
    permissionMode: "conditional",
  }),
  bans: guild([
    "$.capabilities.banAudit",
    "$.scopes.banAuditGuildIds",
  ], ["BAN_MEMBERS"]),
  "bot-profile": application([
    "$.capabilities.botProfileAudit",
    "$.capabilities.botProfileChanges",
    "$.storage.botProfileRoots",
  ]),
  "bulk-bans": guild([
    "$.capabilities.bulkBanAudit",
    "$.capabilities.bulkBans",
    "$.scopes.bulkBanGuildIds",
    "$.scopes.protectedUserIds",
  ], ["BAN_MEMBERS", "MANAGE_GUILD"], { hierarchy: "required" }),
  "channel-cloning": guild([
    "$.capabilities.channelCloneAudit",
    "$.capabilities.channelCloning",
    "$.scopes.channelCloneGuildIds",
    "$.scopes.channelCloneSourceIds",
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS"], {
    intents: [intent("GUILDS", "required")],
  }),
  "channel-creation": guild([
    "$.capabilities.channelCreation",
    "$.scopes.channelCreationGuildIds",
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS"]),
  "channel-deletion": channel([
    "$.capabilities.channelDeletionAudit",
    "$.capabilities.channelDeletions",
    "$.gateway.enabled",
    "$.scopes.channelDeletionIds",
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS", "MANAGE_GUILD"], {
    conditions: [
      condition("thread-capable-target", ["READ_MESSAGE_HISTORY", "MANAGE_THREADS"]),
      condition("webhook-capable-target", ["MANAGE_WEBHOOKS"]),
    ],
    intents: [intent("GUILDS", "required")],
    permissionMode: "conditional",
  }),
  "channel-metadata": channel([
    "$.capabilities.channelMetadataChanges",
    "$.scopes.channelMetadataIds",
  ], ["VIEW_CHANNEL"], {
    conditions: [
      condition("metadata-change", ["MANAGE_CHANNELS"]),
      condition("voice-status-change", ["SET_VOICE_CHANNEL_STATUS"]),
      condition("voice-status-change-while-disconnected", ["MANAGE_CHANNELS"]),
    ],
    intents: [intent("GUILDS", "required")],
    permissionMode: "conditional",
  }),
  "channel-ordering": guild([
    "$.capabilities.channelOrderingAudit",
    "$.capabilities.channelOrderingChanges",
    "$.scopes.channelOrderingGuildIds",
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS"], {
    intents: [intent("GUILDS", "required")],
  }),
  connector: application(),
  coordination: channel([], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"]),
  deletion: channel([
    "$.capabilities.deletions",
    "$.scopes.deleteChannelIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "MANAGE_MESSAGES"], {
    intents: [intent("MESSAGE_CONTENT", "required")],
  }),
  "direct-messages": {
    permissionMode: "none",
    policyPaths: [
      "$.capabilities.directMessageAudit",
      "$.capabilities.directMessageAttachments",
      "$.capabilities.directMessageDeletion",
      "$.capabilities.directMessageDelivery",
      "$.capabilities.directMessageEditing",
      "$.scopes.directMessageUserIds",
    ],
    targetScope: "user",
  },
  "embed-messages": channel([
    "$.capabilities.embedMessages",
    "$.scopes.embedMessageChannelIds",
    "$.scopes.componentLinkOrigins",
    "$.scopes.mentionUserIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "EMBED_LINKS"], {
    conditions: [
      condition("direct-channel", ["SEND_MESSAGES"]),
      condition("thread-channel", ["SEND_MESSAGES_IN_THREADS"]),
    ],
    intents: [intent("MESSAGE_CONTENT", "required")],
    permissionMode: "conditional",
  }),
  "forum-posts": channel([
    "$.capabilities.forumPosts",
    "$.scopes.forumPostChannelIds",
    "$.scopes.mentionUserIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "SEND_MESSAGES"], {
    intents: [intent("MESSAGE_CONTENT", "required")],
  }),
  "forum-tags": channel([
    "$.capabilities.forumTagAudit",
    "$.capabilities.forumTagChanges",
    "$.scopes.forumTagChannelIds",
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS"]),
  gateway: local([GATEWAY_ENABLED, "$.gateway.eventBufferSize"]),
  "guild-blueprints": guild([
    "$.capabilities.guildScaffolds",
    "$.scopes.guildScaffoldGuildIds",
    GUILD_READ_SCOPE,
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS", "MANAGE_GUILD", "MANAGE_ROLES"], {
    intents: [intent("GUILDS", "required")],
    permissionMode: "delegated-runtime",
  }),
  "guild-community": guild([
    "$.capabilities.guildCommunityAudit",
    "$.capabilities.guildCommunityChanges",
    "$.scopes.guildCommunityGuildIds",
  ], ["MANAGE_GUILD"], {
    conditions: [condition("first-time-community-enablement", ["ADMINISTRATOR"])],
    intents: [intent("GUILDS", "required")],
    permissionMode: "conditional",
  }),
  "guild-departure": guild([
    "$.capabilities.guildDepartures",
    "$.scopes.guildDepartureGuildIds",
  ]),
  "guild-expressions": guild([
    "$.capabilities.guildExpressionAudit",
    "$.capabilities.guildExpressionChanges",
    "$.scopes.guildExpressionGuildIds",
    "$.storage.guildExpressionRoots",
  ], [], {
    conditions: [
      condition("expression-create", ["CREATE_GUILD_EXPRESSIONS"]),
      condition("expression-edit-or-delete", ["MANAGE_GUILD_EXPRESSIONS"]),
    ],
    permissionMode: "conditional",
  }),
  "guild-incidents": guild([
    "$.capabilities.guildIncidentAudit",
    "$.capabilities.guildIncidentChanges",
    "$.scopes.guildIncidentGuildIds",
  ], ["MANAGE_GUILD"]),
  "guild-profile": guild([
    "$.capabilities.guildProfileAudit",
    "$.capabilities.guildProfileChanges",
    "$.scopes.guildProfileGuildIds",
  ], ["MANAGE_GUILD"]),
  "guild-prunes": guild([
    "$.capabilities.guildPruneAudit",
    "$.capabilities.guildPrunes",
    "$.scopes.guildPruneGuildIds",
    "$.scopes.guildPruneIncludeRoleIds",
    "$.scopes.protectedUserIds",
  ], ["KICK_MEMBERS", "MANAGE_GUILD"]),
  "guild-scaffolds": guild([
    "$.capabilities.guildScaffolds",
    "$.scopes.guildScaffoldGuildIds",
  ], ["VIEW_CHANNEL", "MANAGE_CHANNELS", "MANAGE_ROLES"], {
    intents: [intent("GUILDS", "required")],
    permissionMode: "delegated-runtime",
  }),
  "guild-settings": guild([
    "$.capabilities.guildSettingsAudit",
    "$.capabilities.guildSettingsChanges",
    "$.scopes.guildSettingsGuildIds",
  ], ["MANAGE_GUILD"], {
    intents: [intent("GUILDS", "required")],
  }),
  "guild-templates": guild([
    "$.capabilities.guildTemplateAudit",
    "$.capabilities.guildTemplateChanges",
    "$.scopes.guildTemplateGuildIds",
  ], ["MANAGE_GUILD"], {
    intents: [intent("GUILDS", "required")],
  }),
  guilds: guild([GUILD_READ_SCOPE]),
  integrations: guild([
    "$.capabilities.integrationAudit",
    "$.capabilities.integrationDeletions",
    "$.scopes.integrationGuildIds",
    "$.scopes.integrationIds",
  ], ["MANAGE_GUILD"]),
  interactions: channel([
    "$.capabilities.interactions",
    "$.capabilities.reactionModeration",
    "$.capabilities.reactionUserAudit",
    "$.scopes.componentLinkOrigins",
    "$.scopes.interactionChannelIds",
    "$.scopes.mentionUserIds",
    "$.scopes.reactionChannelIds",
  ], ["VIEW_CHANNEL"], {
    conditions: [
      condition("reaction-create", ["ADD_REACTIONS"]),
      condition("reaction-moderation", ["MANAGE_MESSAGES"]),
      condition("message-readback", ["READ_MESSAGE_HISTORY"]),
      condition("direct-channel-message", ["SEND_MESSAGES"]),
      condition("thread-message", ["SEND_MESSAGES_IN_THREADS"]),
    ],
    intents: [intent("MESSAGE_CONTENT", "conditional")],
    permissionMode: "conditional",
  }),
  invites: guild([
    "$.capabilities.inviteAudit",
    "$.capabilities.inviteCreation",
    "$.capabilities.inviteDeletions",
    "$.capabilities.inviteRoleAssignment",
    "$.scopes.inviteCreationChannelIds",
    "$.scopes.inviteGuildIds",
    "$.scopes.inviteRoleIds",
    "$.storage.inviteCapabilityRoots",
  ], [], {
    conditions: [
      condition("create", ["VIEW_CHANNEL", "CREATE_INSTANT_INVITE"]),
      condition("exact-user-acceptance", ["MANAGE_GUILD"]),
      condition("guild-audit", ["MANAGE_GUILD"]),
      condition("delete", ["MANAGE_CHANNELS"]),
    ],
    intents: [intent("GUILDS", "conditional")],
    permissionMode: "conditional",
  }),
  "linked-roles": application([
    "$.capabilities.applicationRoleConnectionMetadataChanges",
  ]),
  "member-nicknames": guild([
    "$.capabilities.nicknameChanges",
    "$.capabilities.otherMemberNicknameChanges",
    "$.scopes.nicknameGuildIds",
    "$.scopes.protectedUserIds",
  ], [], {
    conditions: [
      condition("current-bot", ["CHANGE_NICKNAME"]),
      condition("other-member", ["MANAGE_NICKNAMES"]),
    ],
    hierarchy: "conditional",
    permissionMode: "conditional",
  }),
  "member-roles": guild([
    "$.capabilities.bulkMemberRoleChanges",
    "$.capabilities.memberRoleChanges",
    "$.scopes.bulkMemberRoleGuildIds",
    "$.scopes.bulkMemberRoleIds",
    "$.scopes.memberRoleGuildIds",
    "$.scopes.memberRoleIds",
    "$.scopes.protectedUserIds",
  ], ["MANAGE_ROLES"], {
    hierarchy: "required",
    intents: [intent("GUILDS", "required")],
  }),
  "member-verification": guild([
    "$.capabilities.memberVerificationChanges",
    "$.scopes.memberVerificationGuildIds",
    "$.scopes.protectedUserIds",
  ], [], {
    conditions: [
      condition("guild-owner", []),
      condition("manage-guild-path", ["MANAGE_GUILD"]),
      condition("manage-roles-path", ["MANAGE_ROLES"]),
      condition("moderation-path", [
        "BAN_MEMBERS",
        "KICK_MEMBERS",
        "MODERATE_MEMBERS",
      ]),
    ],
    hierarchy: "required",
    permissionMode: "delegated-runtime",
  }),
  members: guild([
    "$.capabilities.memberDirectory",
    "$.scopes.memberDirectoryGuildIds",
  ], [], { intents: [intent("GUILD_MEMBERS", "required")] }),
  "message-forwarding": channel([
    "$.capabilities.crossGuildMessageForwarding",
    "$.capabilities.messageForwarding",
    "$.scopes.messageForwardSourceChannelIds",
    "$.scopes.messageForwardTargetChannelIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "SEND_MESSAGES"], {
    intents: [intent("MESSAGE_CONTENT", "required")],
  }),
  messages: channel([
    CHANNEL_READ_SCOPE,
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
    intents: [intent("MESSAGE_CONTENT", "recommended")],
  }),
  moderation: guild([
    "$.capabilities.administration",
    "$.scopes.adminGuildIds",
    "$.scopes.protectedUserIds",
  ], [], {
    conditions: [
      condition("ban-or-unban", ["BAN_MEMBERS"]),
      condition("kick", ["KICK_MEMBERS"]),
      condition("timeout", ["MODERATE_MEMBERS"]),
    ],
    hierarchy: "required",
    permissionMode: "conditional",
  }),
  "native-interactions": application([
    "$.capabilities.nativeCommandChanges",
    "$.capabilities.nativeInteractions",
    GUILD_READ_SCOPE,
    "$.runtime.nativeCommandName",
    "$.scopes.nativeInteractionChannelIds",
    "$.scopes.nativeInteractionGuildIds",
    "$.scopes.nativeInteractionUserIds",
  ]),
  observability: local(),
  onboarding: guild([
    "$.capabilities.onboardingAudit",
    "$.capabilities.onboardingChanges",
    "$.scopes.onboardingGuildIds",
  ], [], {
    conditions: [condition("replacement", ["MANAGE_GUILD", "MANAGE_ROLES"])],
    intents: [intent("GUILDS", "required")],
    permissionMode: "conditional",
  }),
  "permission-overwrites": channel([
    "$.capabilities.permissionOverwrites",
    "$.scopes.permissionOverwriteChannelIds",
  ], ["VIEW_CHANNEL", "MANAGE_ROLES"]),
  "permission-sync": channel([
    "$.capabilities.permissionSyncs",
    "$.scopes.permissionSyncChannelIds",
  ], ["VIEW_CHANNEL", "MANAGE_ROLES"]),
  permissions: channel([
    CHANNEL_READ_SCOPE,
    GUILD_READ_SCOPE,
  ], ["VIEW_CHANNEL"]),
  pins: channel([
    "$.capabilities.pinManagement",
    "$.scopes.pinChannelIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "PIN_MESSAGES"], {
    intents: [intent("MESSAGE_CONTENT", "required")],
  }),
  polls: channel([
    "$.capabilities.pollAudit",
    "$.capabilities.pollCreation",
    "$.capabilities.pollEnding",
    "$.capabilities.pollVoterAudit",
    "$.scopes.pollChannelIds",
  ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
    conditions: [
      condition("voice-or-stage-channel", ["CONNECT"]),
      condition("create-in-direct-channel", ["SEND_MESSAGES", "SEND_POLLS"]),
      condition("create-in-thread", ["SEND_MESSAGES_IN_THREADS", "SEND_POLLS"]),
      condition("end", ["MANAGE_MESSAGES"]),
    ],
    intents: [intent("MESSAGE_CONTENT", "required")],
    permissionMode: "conditional",
  }),
  "role-configuration": guild([
    "$.capabilities.roleConfiguration",
    "$.scopes.roleConfigurationIds",
  ], ["MANAGE_ROLES"], { hierarchy: "required" }),
  "role-creation": guild([
    "$.capabilities.roleCreation",
    "$.scopes.roleCreationGuildIds",
  ], ["MANAGE_ROLES"], { hierarchy: "required" }),
  "role-deletion": guild([
    "$.capabilities.roleDeletionAudit",
    "$.capabilities.roleDeletions",
    "$.gateway.enabled",
    "$.scopes.roleDeletionIds",
  ], ["MANAGE_GUILD", "MANAGE_ROLES"], {
    hierarchy: "required",
    intents: [intent("GUILDS", "required")],
  }),
  "role-ordering": guild([
    "$.capabilities.roleOrderingAudit",
    "$.capabilities.roleOrderingChanges",
    "$.scopes.roleOrderingGuildIds",
  ], ["MANAGE_ROLES"], { hierarchy: "required" }),
  roles: guild([GUILD_READ_SCOPE]),
  "scheduled-events": guild([
    "$.capabilities.scheduledEventAudit",
    "$.capabilities.scheduledEventChanges",
    "$.capabilities.scheduledEventUserAudit",
    "$.scopes.scheduledEventGuildIds",
    "$.storage.scheduledEventRoots",
  ], [], {
    conditions: [
      condition("create", ["CREATE_EVENTS"]),
      condition("edit-or-delete", ["MANAGE_EVENTS"]),
      condition("voice-or-stage-target", ["VIEW_CHANNEL", "CONNECT"]),
      condition("stage-create", ["MANAGE_CHANNELS", "MUTE_MEMBERS", "MOVE_MEMBERS"]),
    ],
    permissionMode: "conditional",
  }),
  soundboard: guild([
    "$.capabilities.soundboardAudit",
    "$.capabilities.soundboardChanges",
    "$.capabilities.soundboardPlayback",
    "$.scopes.soundboardGuildIds",
    "$.scopes.soundboardPlaybackChannelIds",
    "$.scopes.soundboardPlaybackSourceGuildIds",
    "$.storage.soundboardRoots",
  ], [], {
    conditions: [
      condition("create", ["CREATE_GUILD_EXPRESSIONS"]),
      condition("edit-or-delete", ["MANAGE_GUILD_EXPRESSIONS"]),
      condition("playback", ["VIEW_CHANNEL", "CONNECT", "SPEAK", "USE_SOUNDBOARD"]),
      condition("external-sound-playback", ["USE_EXTERNAL_SOUNDS"]),
    ],
    intents: [intent("GUILDS", "conditional")],
    permissionMode: "conditional",
  }),
  "stage-instances": channel([
    "$.capabilities.stageInstanceAudit",
    "$.capabilities.stageInstanceChanges",
    "$.capabilities.stageStartNotifications",
    "$.scopes.stageChannelIds",
  ], ["VIEW_CHANNEL"], {
    conditions: [condition("change", [
      "CONNECT",
      "MANAGE_CHANNELS",
      "MUTE_MEMBERS",
      "MOVE_MEMBERS",
    ])],
    permissionMode: "conditional",
  }),
  "thread-governance": channel([
    "$.capabilities.threadAudit",
    "$.capabilities.threadChanges",
    "$.scopes.threadIds",
    "$.scopes.threadMemberUserIds",
  ], ["VIEW_CHANNEL"], {
    conditions: [
      condition("self-membership", ["SEND_MESSAGES_IN_THREADS"]),
      condition("other-member-or-state-change", ["MANAGE_THREADS"]),
    ],
    permissionMode: "conditional",
  }),
  threads: channel([
    "$.capabilities.threadCreation",
    "$.scopes.threadGuildIds",
    "$.scopes.threadParentIds",
  ], ["VIEW_CHANNEL"], {
    conditions: [
      condition("message-thread", ["CREATE_PUBLIC_THREADS", "READ_MESSAGE_HISTORY"]),
      condition("public-thread", ["CREATE_PUBLIC_THREADS", "SEND_MESSAGES"]),
      condition("private-thread", ["CREATE_PRIVATE_THREADS", "SEND_MESSAGES"]),
      condition("archived-private-thread-audit", ["READ_MESSAGE_HISTORY", "MANAGE_THREADS"]),
    ],
    permissionMode: "conditional",
  }),
  "voice-moderation": guild([
    "$.capabilities.memberVoiceAudit",
    "$.capabilities.memberVoiceChanges",
    "$.scopes.memberVoiceChannelIds",
    "$.scopes.memberVoiceGuildIds",
    "$.scopes.protectedUserIds",
  ], ["VIEW_CHANNEL", "CONNECT"], {
    conditions: [
      condition("disconnect-or-move", ["MOVE_MEMBERS"]),
      condition("destination-channel", ["CONNECT"]),
      condition("server-mute", ["MUTE_MEMBERS"]),
      condition("server-deafen", ["DEAFEN_MEMBERS"]),
    ],
    hierarchy: "required",
    permissionMode: "conditional",
  }),
  "welcome-screen": guild([
    "$.capabilities.welcomeScreenAudit",
    "$.capabilities.welcomeScreenChanges",
    "$.scopes.welcomeScreenGuildIds",
  ], ["MANAGE_GUILD"]),
  webhooks: channel([
    "$.capabilities.webhookAudit",
    "$.capabilities.webhookChanges",
    "$.capabilities.webhookCreation",
    "$.capabilities.webhookDeletions",
    "$.capabilities.webhookMessageAudit",
    "$.capabilities.webhookMessageChanges",
    "$.capabilities.webhookMessageDeletions",
    "$.capabilities.webhookMessageDelivery",
    "$.scopes.webhookChannelIds",
    "$.scopes.webhookGuildIds",
    "$.scopes.webhookMessageChannelIds",
    "$.storage.webhookCredentialRoot",
  ], ["VIEW_CHANNEL", "MANAGE_WEBHOOKS"]),
  "widget-settings": guild([
    "$.capabilities.widgetPublicExposure",
    "$.capabilities.widgetSettingsAudit",
    "$.capabilities.widgetSettingsChanges",
    "$.scopes.widgetSettingsGuildIds",
  ], ["MANAGE_GUILD"]),
} satisfies Record<McpToolsetName, RequirementSource>)

const LOCAL_TOOL_NAMES: ReadonlySet<McpToolName> = new Set([
  MCP_DISCOVERY_TOOL_NAME,
  "compile_component_template",
  "compile_guild_blueprint_starter",
  "create_coordination_address",
  "preview_guild_blueprint",
  "get_gateway_events",
  "get_gateway_status",
  "get_observability_status",
  "list_activity",
  "list_discord_interaction_continuations",
  "list_pending_discord_interactions",
  "parse_discord_reference",
  "preview_component_layout",
  "preview_embed_message",
])

const STORED_WEBHOOK_TOOL_NAMES: ReadonlySet<McpToolName> = new Set([
  "edit_webhook_message",
  "execute_webhook_message_deletion",
  "get_webhook_message",
  "plan_webhook_message_deletion",
  "send_webhook_message",
])

const INTERACTION_TOKEN_TOOL_NAMES: ReadonlySet<McpToolName> = new Set([
  "respond_to_discord_interaction",
  "send_discord_interaction_followup",
])

const GUILD_EXPRESSION_READ_TOOL_NAMES: ReadonlySet<McpToolName> = new Set([
  "get_guild_emoji",
  "get_guild_sticker",
  "list_guild_emojis",
  "list_guild_stickers",
])

const GUILD_SOUNDBOARD_READ_TOOL_NAMES: ReadonlySet<McpToolName> = new Set([
  "list_guild_soundboard_sounds",
  "get_guild_soundboard_sound",
])

const CHANNEL_READ_OVERRIDES: ReadonlySet<McpToolName> = new Set([
  "audit_channel_role_access",
  "explain_channel_access",
  "explain_principal_permissions",
  "get_channel",
])

function exactRequirement(
  name: McpToolName,
  toolset: McpToolsetName,
): RequirementSource | undefined {
  if (LOCAL_TOOL_NAMES.has(name)) {
    if (name === "get_gateway_events" || name === "get_gateway_status") {
      return local([GATEWAY_ENABLED, "$.gateway.eventBufferSize"])
    }
    if (
      name === "list_discord_interaction_continuations"
      || name === "list_pending_discord_interactions"
    ) {
      return local(["$.capabilities.nativeInteractions"])
    }
    if (name === "list_activity") return local(["$.storage.auditFile"])
    if (name === "parse_discord_reference") {
      return local([GUILD_READ_SCOPE, CHANNEL_READ_SCOPE])
    }
    return local()
  }
  if (STORED_WEBHOOK_TOOL_NAMES.has(name)) {
    const policyPaths = [
      GUILD_READ_SCOPE,
      CHANNEL_READ_SCOPE,
      "$.scopes.webhookMessageChannelIds",
      "$.storage.webhookCredentialRoot",
    ]
    if (name === "get_webhook_message") {
      policyPaths.push("$.capabilities.webhookMessageAudit")
    } else if (name === "send_webhook_message") {
      policyPaths.push("$.capabilities.webhookMessageDelivery")
    } else if (name === "edit_webhook_message") {
      policyPaths.push(
        "$.capabilities.webhookMessageAudit",
        "$.capabilities.webhookMessageChanges",
      )
    } else {
      policyPaths.push(
        "$.capabilities.webhookMessageAudit",
        "$.capabilities.webhookMessageDeletions",
      )
    }
    return {
      authentication: "bot-and-stored-webhook-token",
      permissionMode: "all-listed",
      permissions: ["VIEW_CHANNEL"],
      policyPaths,
      targetScope: "webhook",
    }
  }
  if (INTERACTION_TOKEN_TOOL_NAMES.has(name)) {
    return {
      authentication: "short-lived-interaction-token",
      permissionMode: "none",
      policyPaths: MCP_TOOLSET_REQUIREMENTS["native-interactions"].policyPaths ?? [],
      targetScope: "interaction",
    }
  }
  if (name === "plan_component_message" || name === "execute_component_message") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.componentLinkOrigins",
      "$.scopes.interactionChannelIds",
      "$.scopes.mentionUserIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      conditions: [
        condition("direct-channel", ["SEND_MESSAGES"]),
        condition("thread-channel", ["SEND_MESSAGES_IN_THREADS"]),
      ],
      intents: [intent("MESSAGE_CONTENT", "required")],
      permissionMode: "conditional",
    })
  }
  if (name === "verify_component_message") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.componentLinkOrigins",
      "$.scopes.interactionChannelIds",
      "$.scopes.mentionUserIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      intents: [intent("MESSAGE_CONTENT", "required")],
    })
  }
  if (name === "verify_embed_message") {
    return channel([
      "$.capabilities.embedMessages",
      "$.scopes.embedMessageChannelIds",
      "$.scopes.mentionUserIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      intents: [intent("MESSAGE_CONTENT", "required")],
    })
  }
  if (name === "list_message_reactions") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.interactionChannelIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"])
  }
  if (name === "list_reaction_users") {
    return channel([
      "$.capabilities.reactionUserAudit",
      "$.scopes.reactionChannelIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"])
  }
  if (name === "get_current_bot_profile") {
    return application(["$.capabilities.botProfileAudit"])
  }
  if (name === "audit_application_commands") return guild([])
  if (name === "audit_bot_installations" || name === "get_connector_status") {
    return application([GUILD_READ_SCOPE])
  }
  if (name === "inspect_application_activity_instance") {
    return channel([], [])
  }
  if (name === "list_default_soundboard_sounds") {
    return application(["$.capabilities.soundboardAudit"])
  }
  if (name === "list_voice_regions") return application()
  if (GUILD_EXPRESSION_READ_TOOL_NAMES.has(name)) {
    return guild([
      "$.capabilities.guildExpressionAudit",
      "$.scopes.guildExpressionGuildIds",
    ])
  }
  if (GUILD_SOUNDBOARD_READ_TOOL_NAMES.has(name)) {
    return guild([
      "$.capabilities.soundboardAudit",
      "$.scopes.soundboardGuildIds",
    ])
  }
  if (name === "get_guild_welcome_screen") {
    return guild([
      "$.capabilities.welcomeScreenAudit",
      "$.scopes.welcomeScreenGuildIds",
    ], [], {
      conditions: [condition("disabled-screen", ["MANAGE_GUILD"])],
      permissionMode: "conditional",
    })
  }
  if (name === "list_guild_templates") {
    return guild([
      "$.capabilities.guildTemplateAudit",
      "$.scopes.guildTemplateGuildIds",
    ], ["MANAGE_GUILD"])
  }
  if (name === "list_guild_voice_regions") return guild([])
  if (name === "list_active_threads") return guild([], ["VIEW_CHANNEL"])
  if (name === "list_archived_threads") {
    return channel([], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      conditions: [condition("private-archive", ["MANAGE_THREADS"])],
      permissionMode: "conditional",
    })
  }
  if (CHANNEL_READ_OVERRIDES.has(name)) {
    return channel([], ["VIEW_CHANNEL"])
  }
  if (name === "catch_up_messages") {
    return channel([], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      conditions: [condition("voice-or-stage-channel", ["CONNECT"])],
      intents: [intent("MESSAGE_CONTENT", "required")],
      permissionMode: "conditional",
    })
  }
  if (name === "add_reaction" || name === "add_reactions") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.interactionChannelIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      conditions: [condition("reaction-not-already-present", ["ADD_REACTIONS"])],
      permissionMode: "conditional",
    })
  }
  if (name === "remove_own_reaction") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.interactionChannelIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"])
  }
  if (name === "execute_reaction_moderation" || name === "plan_reaction_moderation") {
    return channel([
      "$.capabilities.reactionModeration",
      "$.scopes.reactionChannelIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "MANAGE_MESSAGES"])
  }
  if (name === "signal_command_processing") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.interactionChannelIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "SEND_MESSAGES"])
  }
  if (name === "send_message" || name === "edit_own_message") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.interactionChannelIds",
      "$.scopes.mentionUserIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      conditions: [
        condition("direct-channel", ["SEND_MESSAGES"]),
        condition("thread-channel", ["SEND_MESSAGES_IN_THREADS"]),
        condition("edit-readback", ["READ_MESSAGE_HISTORY"]),
      ],
      intents: [intent("MESSAGE_CONTENT", "conditional")],
      permissionMode: "conditional",
    })
  }
  if (name === "send_coordination_note") {
    return channel([
      "$.capabilities.interactions",
      "$.scopes.interactionChannelIds",
      "$.scopes.mentionUserIds",
    ], ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"], {
      conditions: [
        condition("direct-channel", ["SEND_MESSAGES"]),
        condition("thread-channel", ["SEND_MESSAGES_IN_THREADS"]),
      ],
      permissionMode: "conditional",
    })
  }
  if (toolset === "native-interactions") return application(
    MCP_TOOLSET_REQUIREMENTS["native-interactions"].policyPaths ?? [],
  )
  return undefined
}

const CONFIG_FIELD_PATHS = new Set(
  connectorConfigFields().map(({ path }) => path),
)
const PERMISSION_ORDER = new Map(
  DISCORD_PERMISSION_NAMES.map((name, index) => [name, index]),
)
const INTENT_ORDER = new Map(
  MCP_TOOL_GATEWAY_INTENTS.map((name, index) => [name, index]),
)

function canonicalPermissions(
  permissions: readonly DiscordPermissionName[] = [],
): DiscordPermissionName[] {
  const unique = [...new Set(permissions)]
  unique.sort((left, right) => (
    (PERMISSION_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (PERMISSION_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
  ))
  return unique
}

function canonicalIntents(
  intents: readonly McpToolIntentRequirement[] = [],
): McpToolIntentRequirement[] {
  const byName = new Map<McpToolGatewayIntent, McpToolIntentRequirement>()
  for (const candidate of intents) {
    if (byName.has(candidate.name)) {
      throw new Error(`Duplicate MCP tool intent requirement ${candidate.name}`)
    }
    if (
      candidate.privileged
      !== (candidate.name === "GUILD_MEMBERS" || candidate.name === "MESSAGE_CONTENT")
    ) {
      throw new Error(`MCP tool intent ${candidate.name} has incorrect privilege metadata`)
    }
    byName.set(candidate.name, Object.freeze({ ...candidate }))
  }
  return [...byName.values()].sort((left, right) => (
    (INTENT_ORDER.get(left.name) ?? Number.MAX_SAFE_INTEGER)
    - (INTENT_ORDER.get(right.name) ?? Number.MAX_SAFE_INTEGER)
  ))
}

function curatedSetup(toolset: McpToolsetName, toolName: McpToolName) {
  const serverObserverToolsets: readonly McpToolsetName[] = [
    "activity",
    "connector",
    "guilds",
    "observability",
    "permissions",
    "roles",
  ]
  const channelReaderToolsets: readonly McpToolsetName[] = [
    ...serverObserverToolsets,
    "messages",
  ]
  const recipeByToolset = Object.freeze({
    coordination: "coordination-channel",
    "direct-messages": "direct-messenger",
    "embed-messages": "channel-publisher",
    "guild-blueprints": "guild-builder",
    "guild-incidents": "incident-response",
    interactions: "channel-publisher",
    messages: "channel-publisher",
  } as const satisfies Partial<Record<
    McpToolsetName,
    McpToolStaticRequirements["configuration"]["recipeNames"][number]
  >>)
  const presetNames: Array<"channel-reader" | "server-observer"> = []
  if (serverObserverToolsets.includes(toolset)) presetNames.push("server-observer")
  if (channelReaderToolsets.includes(toolset)) presetNames.push("channel-reader")
  const recipe = recipeByToolset[toolset as keyof typeof recipeByToolset]
  const recipeNames = toolset === "guild-blueprints"
    && toolName !== "capture_guild_blueprint"
    ? ["guild-starter", "guild-builder"] as const
    : recipe
      ? [recipe]
      : []
  return {
    presetNames,
    recipeNames,
  }
}

function normalizeSource(
  source: RequirementSource,
  toolName: McpToolName,
  toolset: McpToolsetName,
  origin: McpToolStaticRequirements["source"],
): McpToolStaticRequirements {
  const policyPaths = [...new Set(source.policyPaths || [])].sort()
  for (const path of policyPaths) {
    if (!CONFIG_FIELD_PATHS.has(path)) {
      throw new Error(`Unknown MCP tool readiness policy path ${path}`)
    }
  }
  const permissions = canonicalPermissions(source.permissions)
  const conditions = [...(source.conditions || [])]
    .map((candidate) => Object.freeze({
      case: candidate.case,
      permissions: Object.freeze(canonicalPermissions(candidate.permissions)),
    }))
    .sort((left, right) => left.case.localeCompare(right.case))
  if (new Set(conditions.map(({ case: caseName }) => caseName)).size !== conditions.length) {
    throw new Error("MCP tool readiness permission conditions must have unique case names")
  }
  const permissionMode = source.permissionMode
    ?? (permissions.length === 0 ? "none" : "all-listed")
  if (permissionMode === "none" && (permissions.length > 0 || conditions.length > 0)) {
    throw new Error("Permission-free MCP readiness cannot list Discord permissions")
  }
  if (permissionMode === "conditional" && conditions.length === 0) {
    throw new Error("Conditional MCP readiness must name at least one permission case")
  }
  const authentication = source.authentication ?? "bot"
  const setup = curatedSetup(toolset, toolName)
  return Object.freeze({
    authentication,
    configuration: Object.freeze({
      evaluation: "operation-runtime" as const,
      policyPaths: Object.freeze(policyPaths),
      presetNames: Object.freeze(setup.presetNames),
      recipeNames: Object.freeze(setup.recipeNames),
    }),
    discord: Object.freeze({
      conditions: Object.freeze(conditions),
      hierarchy: source.hierarchy ?? "not-applicable",
      intents: Object.freeze(canonicalIntents(source.intents)),
      permissionMode,
      permissions: Object.freeze(permissions),
      verification: authentication === "none"
        ? "not-applicable" as const
        : "operation-runtime" as const,
    }),
    source: origin,
    targetScope: source.targetScope,
  })
}

export function mcpToolStaticRequirements(
  name: McpToolName,
  toolset: McpToolsetName,
): McpToolStaticRequirements {
  const exact = exactRequirement(name, toolset)
  return normalizeSource(
    exact ?? MCP_TOOLSET_REQUIREMENTS[toolset],
    name,
    toolset,
    exact ? "exact-tool" : "toolset",
  )
}
