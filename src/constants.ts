export const CONNECTOR_NAME = "discord-mcp"
export const CONNECTOR_VERSION = "0.1.0"
export const SCHEMA_VERSION = 1

export const DISCORD_API_BASE_URL = "https://discord.com/api/v10"
export const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
export const DISCORD_WEB_BASE_URL = "https://discord.com"
export const DISCORD_USER_AGENT = `DiscordBot (discord-mcp, ${CONNECTOR_VERSION})`
export const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{1,20}$/
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export const ENVIRONMENT_NAMES = Object.freeze({
  adminGuildIds: "DISCORD_MCP_ADMIN_GUILD_IDS",
  allowedChannelIds: "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  allowedGuildIds: "DISCORD_MCP_ALLOWED_GUILD_IDS",
  allowAdministration: "DISCORD_MCP_ALLOW_ADMINISTRATION",
  allowDeletions: "DISCORD_MCP_ALLOW_DELETIONS",
  allowGateway: "DISCORD_MCP_ALLOW_GATEWAY",
  allowInteractions: "DISCORD_MCP_ALLOW_INTERACTIONS",
  applicationId: "DISCORD_MCP_APPLICATION_ID",
  auditFile: "DISCORD_MCP_AUDIT_FILE",
  deleteChannelIds: "DISCORD_MCP_DELETE_CHANNEL_IDS",
  gatewayEventBufferSize: "DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE",
  interactionChannelIds: "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
  interactionMaxWritesPerMinute: "DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE",
  interactionMinWriteIntervalMs: "DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS",
  mentionUserIds: "DISCORD_MCP_MENTION_USER_IDS",
  protectedUserIds: "DISCORD_MCP_PROTECTED_USER_IDS",
  token: "DISCORD_BOT_TOKEN",
})

export const DISCORD_LIMITS = Object.freeze({
  allowedMentionUsers: 100,
  auditReasonEncodedCharacters: 512,
  automaticRetryWaitMs: 5_000,
  archivedThreads: 100,
  archivedThreadsMinimum: 2,
  bulkDeleteAgeMs: 14 * 24 * 60 * 60 * 1_000,
  bulkDeleteSafetyMarginMs: 60_000,
  banDeleteMessageSeconds: 7 * 24 * 60 * 60,
  channelMessages: 100,
  currentUserGuilds: 200,
  deletionMessages: 100,
  guildMessageSearch: 25,
  messageContentCharacters: 2_000,
  messageNonceCharacters: 25,
  requestTimeoutMs: 30_000,
  retries: 3,
  searchChannelIds: 500,
  searchContentCharacters: 1_024,
  searchFilenameCharacters: 1_024,
  searchFilterCharacters: 256,
  searchFilterIds: 100,
  searchFilterStrings: 100,
  searchOffset: 9_975,
  searchSlop: 100,
  snowflakeCharacters: 20,
})

export const CONNECTOR_LIMITS = Object.freeze({
  activityEntries: 100,
  activityPageDefault: 25,
  activeThreads: 100,
  contentPreviewCharacters: 240,
  gatewayChannelMappings: 10_000,
  gatewayCursorCharacters: 128,
  gatewayEventBufferSize: 1_000,
  gatewayEventPage: 100,
  idempotencyKeyCharacters: 128,
  idempotencyKeyMinimumCharacters: 16,
  interactionEmojiCharacters: 100,
  interactionLedgerEntries: 1_000,
  interactionLedgerTtlMs: 10 * 60 * 1_000,
  interactionMaxWritesPerMinute: 60,
  interactionMinWriteIntervalMs: 60_000,
  interactionNotificationUsers: 10,
  mentionUserAllowlist: 100,
  messagePageDefault: 50,
  protectedUserAllowlist: 100,
  searchFilterIds: 25,
  searchFilterStrings: 25,
  threadPageDefault: 50,
})

export const GATEWAY_DEFAULTS = Object.freeze({
  authenticationTimeoutMs: 30_000,
  connectionTimeoutMs: 30_000,
  eventBufferSize: 100,
  eventPage: 50,
  heartbeatMaximumMs: 120_000,
  heartbeatMinimumMs: 1_000,
  identifyBudget: 10,
  identifyBudgetWindowMs: 60 * 60 * 1_000,
  identifyMinimumIntervalMs: 5_000,
  maximumPayloadBytes: 1_048_576,
  reconnectMaximumMs: 30_000,
  reconnectMinimumMs: 1_000,
})

export const DISCORD_GATEWAY_INTENTS = Object.freeze({
  guildMessages: 1 << 9,
  guildMessagePolls: 1 << 24,
  guildMessageReactions: 1 << 10,
  guilds: 1 << 0,
})

export const DISCORD_GATEWAY_INTENT_MASK = DISCORD_GATEWAY_INTENTS.guilds
  | DISCORD_GATEWAY_INTENTS.guildMessages
  | DISCORD_GATEWAY_INTENTS.guildMessagePolls
  | DISCORD_GATEWAY_INTENTS.guildMessageReactions

export const ADMINISTRATION_LIMITS = Object.freeze({
  timeoutMinutes: 28 * 24 * 60 - 1,
})

export const MEMBER_MODERATION_ACTIONS = [
  "ban",
  "kick",
  "remove-timeout",
  "timeout",
  "unban",
] as const

export type MemberModerationAction = typeof MEMBER_MODERATION_ACTIONS[number]

export const INTERACTION_DEFAULTS = Object.freeze({
  maxWritesPerMinute: 10,
  minWriteIntervalMs: 500,
})

export const DISCORD_APPLICATION_FLAGS = Object.freeze({
  gatewayMessageContent: 1n << 18n,
  gatewayMessageContentLimited: 1n << 19n,
})

export const DISCORD_CHANNEL_TYPES = Object.freeze({
  announcement: 5,
  announcementThread: 10,
  category: 4,
  directory: 14,
  dm: 1,
  forum: 15,
  groupDm: 3,
  media: 16,
  privateThread: 12,
  publicThread: 11,
  stageVoice: 13,
  text: 0,
  voice: 2,
})

export const DISCORD_MESSAGE_REFERENCE_TYPES = Object.freeze({
  default: 0,
})

export const CHANNEL_TYPE_NAMES = Object.freeze({
  [DISCORD_CHANNEL_TYPES.text]: "guild-text",
  [DISCORD_CHANNEL_TYPES.dm]: "dm",
  [DISCORD_CHANNEL_TYPES.voice]: "guild-voice",
  [DISCORD_CHANNEL_TYPES.groupDm]: "group-dm",
  [DISCORD_CHANNEL_TYPES.category]: "guild-category",
  [DISCORD_CHANNEL_TYPES.announcement]: "guild-announcement",
  [DISCORD_CHANNEL_TYPES.announcementThread]: "announcement-thread",
  [DISCORD_CHANNEL_TYPES.publicThread]: "public-thread",
  [DISCORD_CHANNEL_TYPES.privateThread]: "private-thread",
  [DISCORD_CHANNEL_TYPES.stageVoice]: "guild-stage-voice",
  [DISCORD_CHANNEL_TYPES.directory]: "guild-directory",
  [DISCORD_CHANNEL_TYPES.forum]: "guild-forum",
  [DISCORD_CHANNEL_TYPES.media]: "guild-media",
} as const)
