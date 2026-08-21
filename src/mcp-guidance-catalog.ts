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
  exactMessage: "exact_message",
  exactRole: "exact_role",
  guildChannels: "guild_channels",
  guildRoles: "guild_roles",
})

export const MCP_RESOURCE_TEMPLATE_URIS = Object.freeze({
  channelAccess: "discord://channels/{channelId}/access",
  exactMessage: "discord://channels/{channelId}/messages/{messageId}",
  exactRole: "discord://guilds/{guildId}/roles/{roleId}",
  guildChannels: "discord://guilds/{guildId}/channels",
  guildRoles: "discord://guilds/{guildId}/roles",
})

export const MCP_PROMPT_NAMES = Object.freeze({
  reviewAttachmentMessage: "review_attachment_message",
  reviewChannelCreation: "review_channel_creation",
  reviewForumPost: "review_forum_post",
  reviewGuildScaffold: "review_guild_scaffold",
  reviewMemberModeration: "review_member_moderation",
  reviewMessageDeletion: "review_message_deletion",
  reviewMessagePin: "review_message_pin",
  reviewRoleCreation: "review_role_creation",
  searchGuildMessages: "search_guild_messages",
  summarizeChannel: "summarize_channel",
})

export type McpPromptName = typeof MCP_PROMPT_NAMES[
  keyof typeof MCP_PROMPT_NAMES
]

export const MCP_PROMPT_TOOLSETS = Object.freeze({
  [MCP_PROMPT_NAMES.reviewAttachmentMessage]: "attachments",
  [MCP_PROMPT_NAMES.reviewChannelCreation]: "channel-creation",
  [MCP_PROMPT_NAMES.reviewForumPost]: "forum-posts",
  [MCP_PROMPT_NAMES.reviewGuildScaffold]: "guild-scaffolds",
  [MCP_PROMPT_NAMES.reviewMemberModeration]: "moderation",
  [MCP_PROMPT_NAMES.reviewMessageDeletion]: "deletion",
  [MCP_PROMPT_NAMES.reviewMessagePin]: "pins",
  [MCP_PROMPT_NAMES.reviewRoleCreation]: "role-creation",
  [MCP_PROMPT_NAMES.searchGuildMessages]: "messages",
  [MCP_PROMPT_NAMES.summarizeChannel]: "messages",
} satisfies Record<McpPromptName, McpToolsetName>)

export function selectedMcpPromptNames(
  toolsets: ReadonlySet<McpToolsetName>,
): McpPromptName[] {
  return (Object.values(MCP_PROMPT_NAMES) as McpPromptName[])
    .filter((name) => toolsets.has(MCP_PROMPT_TOOLSETS[name]))
}
