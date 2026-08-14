export const CONNECTOR_NAME = "discord-mcp"
export const CONNECTOR_VERSION = "0.1.0"
export const SCHEMA_VERSION = 1

export const DISCORD_API_BASE_URL = "https://discord.com/api/v10"
export const DISCORD_USER_AGENT = `DiscordBot (discord-mcp, ${CONNECTOR_VERSION})`
export const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{1,20}$/

export const ENVIRONMENT_NAMES = Object.freeze({
  allowedChannelIds: "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  allowedGuildIds: "DISCORD_MCP_ALLOWED_GUILD_IDS",
  allowDeletions: "DISCORD_MCP_ALLOW_DELETIONS",
  applicationId: "DISCORD_MCP_APPLICATION_ID",
  auditFile: "DISCORD_MCP_AUDIT_FILE",
  deleteChannelIds: "DISCORD_MCP_DELETE_CHANNEL_IDS",
  token: "DISCORD_BOT_TOKEN",
})

export const DISCORD_LIMITS = Object.freeze({
  automaticRetryWaitMs: 5_000,
  bulkDeleteAgeMs: 14 * 24 * 60 * 60 * 1_000,
  bulkDeleteSafetyMarginMs: 60_000,
  channelMessages: 100,
  currentUserGuilds: 200,
  deletionMessages: 100,
  requestTimeoutMs: 30_000,
  retries: 3,
})

export const CONNECTOR_LIMITS = Object.freeze({
  activityEntries: 100,
  contentPreviewCharacters: 240,
})

export const CHANNEL_TYPE_NAMES = Object.freeze({
  0: "guild-text",
  1: "dm",
  2: "guild-voice",
  3: "group-dm",
  4: "guild-category",
  5: "guild-announcement",
  10: "announcement-thread",
  11: "public-thread",
  12: "private-thread",
  13: "guild-stage-voice",
  14: "guild-directory",
  15: "guild-forum",
  16: "guild-media",
} as const)
