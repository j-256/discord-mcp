export const MCP_RESOURCE_NAMES = Object.freeze({
  activity: "connector_activity",
  guilds: "scoped_guilds",
  gatewayEvents: "gateway_events",
  gatewayStatus: "gateway_status",
  policy: "connector_policy",
  safety: "connector_safety",
})

export const MCP_RESOURCE_URIS = Object.freeze({
  activity: "discord://connector/activity",
  guilds: "discord://guilds",
  gatewayEvents: "discord://gateway/events",
  gatewayStatus: "discord://gateway/status",
  policy: "discord://connector/policy",
  safety: "discord://connector/safety",
})

export const MCP_RESOURCE_TEMPLATE_NAMES = Object.freeze({
  channelAccess: "channel_access",
  exactMessage: "exact_message",
  guildChannels: "guild_channels",
})

export const MCP_RESOURCE_TEMPLATE_URIS = Object.freeze({
  channelAccess: "discord://channels/{channelId}/access",
  exactMessage: "discord://channels/{channelId}/messages/{messageId}",
  guildChannels: "discord://guilds/{guildId}/channels",
})

export const MCP_PROMPT_NAMES = Object.freeze({
  reviewMemberModeration: "review_member_moderation",
  reviewMessageDeletion: "review_message_deletion",
  searchGuildMessages: "search_guild_messages",
  summarizeChannel: "summarize_channel",
})
