import type { McpToolsetName } from "./constants.js"

export const MCP_RESOURCE_NAMES = Object.freeze({
  activity: "connector_activity",
  guilds: "scoped_guilds",
  gatewayEvents: "gateway_events",
  gatewayStatus: "gateway_status",
  observability: "connector_observability",
  policy: "connector_policy",
  safety: "connector_safety",
})

export const MCP_RESOURCE_URIS = Object.freeze({
  activity: "discord://connector/activity",
  guilds: "discord://guilds",
  gatewayEvents: "discord://gateway/events",
  gatewayStatus: "discord://gateway/status",
  observability: "discord://connector/observability",
  policy: "discord://connector/policy",
  safety: "discord://connector/safety",
})

export const MCP_RESOURCE_TEMPLATE_NAMES = Object.freeze({
  channelAccess: "channel_access",
  channelPermissionOverwrites: "channel_permission_overwrites",
  channelWebhooks: "channel_webhooks",
  exactMessage: "exact_message",
  exactMember: "exact_member",
  exactRole: "exact_role",
  guildAutomodRules: "guild_automod_rules",
  guildChannels: "guild_channels",
  guildEmojis: "guild_emojis",
  guildRoles: "guild_roles",
  guildScheduledEvents: "guild_scheduled_events",
  guildStickers: "guild_stickers",
})

export const MCP_RESOURCE_TEMPLATE_URIS = Object.freeze({
  channelAccess: "discord://channels/{channelId}/access",
  channelPermissionOverwrites: "discord://channels/{channelId}/permission-overwrites",
  channelWebhooks: "discord://channels/{channelId}/webhooks",
  exactMessage: "discord://channels/{channelId}/messages/{messageId}",
  exactMember: "discord://guilds/{guildId}/members/{userId}",
  exactRole: "discord://guilds/{guildId}/roles/{roleId}",
  guildAutomodRules: "discord://guilds/{guildId}/automod-rules",
  guildChannels: "discord://guilds/{guildId}/channels",
  guildEmojis: "discord://guilds/{guildId}/emojis",
  guildRoles: "discord://guilds/{guildId}/roles",
  guildScheduledEvents: "discord://guilds/{guildId}/scheduled-events",
  guildStickers: "discord://guilds/{guildId}/stickers",
})

export const MCP_PROMPT_NAMES = Object.freeze({
  findGuildMembers: "find_guild_members",
  reviewAttachmentMessage: "review_attachment_message",
  reviewAutomodChange: "review_automod_change",
  reviewChannelCreation: "review_channel_creation",
  reviewChannelPermissionOverwrite: "review_channel_permission_overwrite",
  reviewForumPost: "review_forum_post",
  reviewGuildExpressionChange: "review_guild_expression_change",
  reviewGuildScaffold: "review_guild_scaffold",
  reviewMemberModeration: "review_member_moderation",
  reviewMemberRoleChange: "review_member_role_change",
  reviewMessageDeletion: "review_message_deletion",
  reviewMessagePin: "review_message_pin",
  reviewRoleCreation: "review_role_creation",
  reviewScheduledEventChange: "review_scheduled_event_change",
  reviewWebhookDeletion: "review_webhook_deletion",
  searchGuildMessages: "search_guild_messages",
  summarizeChannel: "summarize_channel",
})

export type McpPromptName = typeof MCP_PROMPT_NAMES[
  keyof typeof MCP_PROMPT_NAMES
]

export const MCP_PROMPT_TOOLSETS = Object.freeze({
  [MCP_PROMPT_NAMES.findGuildMembers]: "members",
  [MCP_PROMPT_NAMES.reviewAttachmentMessage]: "attachments",
  [MCP_PROMPT_NAMES.reviewAutomodChange]: "automod",
  [MCP_PROMPT_NAMES.reviewChannelCreation]: "channel-creation",
  [MCP_PROMPT_NAMES.reviewChannelPermissionOverwrite]: "permission-overwrites",
  [MCP_PROMPT_NAMES.reviewForumPost]: "forum-posts",
  [MCP_PROMPT_NAMES.reviewGuildExpressionChange]: "guild-expressions",
  [MCP_PROMPT_NAMES.reviewGuildScaffold]: "guild-scaffolds",
  [MCP_PROMPT_NAMES.reviewMemberModeration]: "moderation",
  [MCP_PROMPT_NAMES.reviewMemberRoleChange]: "member-roles",
  [MCP_PROMPT_NAMES.reviewMessageDeletion]: "deletion",
  [MCP_PROMPT_NAMES.reviewMessagePin]: "pins",
  [MCP_PROMPT_NAMES.reviewRoleCreation]: "role-creation",
  [MCP_PROMPT_NAMES.reviewScheduledEventChange]: "scheduled-events",
  [MCP_PROMPT_NAMES.reviewWebhookDeletion]: "webhooks",
  [MCP_PROMPT_NAMES.searchGuildMessages]: "messages",
  [MCP_PROMPT_NAMES.summarizeChannel]: "messages",
} satisfies Record<McpPromptName, McpToolsetName>)

export function selectedMcpPromptNames(
  toolsets: ReadonlySet<McpToolsetName>,
): McpPromptName[] {
  return (Object.values(MCP_PROMPT_NAMES) as McpPromptName[])
    .filter((name) => toolsets.has(MCP_PROMPT_TOOLSETS[name]))
}
