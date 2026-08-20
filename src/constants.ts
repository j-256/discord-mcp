export const CONNECTOR_NAME = "discord-mcp"
export const CONNECTOR_VERSION = "0.1.0"
export const SCHEMA_VERSION = 1

export const DISCORD_API_BASE_URL = "https://discord.com/api/v10"
export const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
export const DISCORD_WEB_BASE_URL = "https://discord.com"
export const DISCORD_USER_AGENT = `DiscordBot (discord-mcp, ${CONNECTOR_VERSION})`
export const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{1,20}$/
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
export const CONTENT_FREE_ERROR_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/
export const CONTENT_FREE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const MCP_DISCOVERY_TOOL_NAME = "discover_discord_tools"

export const MCP_TOOL_SURFACES = [
  "full",
  "progressive",
] as const

export type McpToolSurface = typeof MCP_TOOL_SURFACES[number]

export const MCP_TOOLSET_NAMES = [
  "activity",
  "attachments",
  "channel-creation",
  "connector",
  "deletion",
  "gateway",
  "guilds",
  "interactions",
  "messages",
  "moderation",
  "observability",
  "permissions",
  "role-creation",
  "roles",
  "threads",
] as const

export type McpToolsetName = typeof MCP_TOOLSET_NAMES[number]

export const ENVIRONMENT_NAMES = Object.freeze({
  adminGuildIds: "DISCORD_MCP_ADMIN_GUILD_IDS",
  allowedChannelIds: "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  allowedGuildIds: "DISCORD_MCP_ALLOWED_GUILD_IDS",
  allowAdministration: "DISCORD_MCP_ALLOW_ADMINISTRATION",
  allowAttachments: "DISCORD_MCP_ALLOW_ATTACHMENTS",
  allowChannelCreation: "DISCORD_MCP_ALLOW_CHANNEL_CREATION",
  allowDeletions: "DISCORD_MCP_ALLOW_DELETIONS",
  allowGateway: "DISCORD_MCP_ALLOW_GATEWAY",
  allowInteractions: "DISCORD_MCP_ALLOW_INTERACTIONS",
  allowObservabilityExport: "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT",
  allowRoleCreation: "DISCORD_MCP_ALLOW_ROLE_CREATION",
  applicationId: "DISCORD_MCP_APPLICATION_ID",
  attachmentChannelIds: "DISCORD_MCP_ATTACHMENT_CHANNEL_IDS",
  attachmentMaxBytes: "DISCORD_MCP_ATTACHMENT_MAX_BYTES",
  attachmentRoots: "DISCORD_MCP_ATTACHMENT_ROOTS",
  auditFile: "DISCORD_MCP_AUDIT_FILE",
  channelCreationGuildIds: "DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS",
  deleteChannelIds: "DISCORD_MCP_DELETE_CHANNEL_IDS",
  gatewayEventBufferSize: "DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE",
  interactionChannelIds: "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
  interactionMaxWritesPerMinute: "DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE",
  interactionMinWriteIntervalMs: "DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS",
  mentionUserIds: "DISCORD_MCP_MENTION_USER_IDS",
  observabilityLogs: "DISCORD_MCP_OBSERVABILITY_LOGS",
  otelCompression: "OTEL_EXPORTER_OTLP_COMPRESSION",
  otelEndpoint: "OTEL_EXPORTER_OTLP_ENDPOINT",
  otelHeaders: "OTEL_EXPORTER_OTLP_HEADERS",
  otelMetricsCompression: "OTEL_EXPORTER_OTLP_METRICS_COMPRESSION",
  otelMetricsEndpoint: "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  otelMetricsHeaders: "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  otelMetricsProtocol: "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  otelMetricsTimeout: "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT",
  otelProtocol: "OTEL_EXPORTER_OTLP_PROTOCOL",
  otelServiceName: "OTEL_SERVICE_NAME",
  otelTimeout: "OTEL_EXPORTER_OTLP_TIMEOUT",
  otelTraceCompression: "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION",
  otelTraceEndpoint: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  otelTraceHeaders: "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  otelTraceProtocol: "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  otelTraceTimeout: "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
  otelTracesSampler: "OTEL_TRACES_SAMPLER",
  otelTracesSamplerArg: "OTEL_TRACES_SAMPLER_ARG",
  protectedUserIds: "DISCORD_MCP_PROTECTED_USER_IDS",
  roleCreationGuildIds: "DISCORD_MCP_ROLE_CREATION_GUILD_IDS",
  token: "DISCORD_BOT_TOKEN",
  toolSurface: "DISCORD_MCP_TOOL_SURFACE",
  toolsets: "DISCORD_MCP_TOOLSETS",
})

export const DISCORD_LIMITS = Object.freeze({
  allowedMentionUsers: 100,
  attachmentBytes: 10 * 1_024 * 1_024,
  attachmentDescriptionCharacters: 1_024,
  attachmentFilenameCharacters: 240,
  auditReasonEncodedCharacters: 512,
  automaticRetryWaitMs: 5_000,
  archivedThreads: 100,
  archivedThreadsMinimum: 2,
  bulkDeleteAgeMs: 14 * 24 * 60 * 60 * 1_000,
  bulkDeleteSafetyMarginMs: 60_000,
  banDeleteMessageSeconds: 7 * 24 * 60 * 60,
  channelMessages: 100,
  channelNameCharacters: 100,
  channelRateLimitSeconds: 21_600,
  channelTopicCharacters: 1_024,
  categoryChannels: 50,
  currentUserGuilds: 200,
  deletionMessages: 100,
  guildMessageSearch: 25,
  guildRoles: 250,
  guildChannels: 500,
  messageContentCharacters: 2_000,
  messageNonceCharacters: 25,
  requestTimeoutMs: 30_000,
  retries: 3,
  roleColor: 0xFF_FF_FF,
  roleNameCharacters: 100,
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

export const PERMISSION_LIMITS = Object.freeze({
  auditActions: 5,
  auditRolePage: 100,
  auditRolePageDefault: 50,
})

export const CONNECTOR_LIMITS = Object.freeze({
  activityEntries: 100,
  activityPageDefault: 25,
  activeThreads: 100,
  attachmentPathCharacters: 4_096,
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
  toolDiscoveryMatches: 8,
  toolDiscoveryQueryCharacters: 200,
  toolDiscoverySummaryCharacters: 200,
  observabilityHeaders: 32,
  observabilityHeaderValueCharacters: 4_096,
  observabilityOtlpEndpointCharacters: 2_048,
  observabilityServiceNameCharacters: 64,
  observabilityTimeoutMs: 60_000,
  operationReceiptBytes: 16_384,
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

export const OBSERVABILITY_DEFAULTS = Object.freeze({
  durationBucketsMs: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000],
  exportIntervalMs: 30_000,
  exportTimeoutMs: 10_000,
  otlpBaseUrl: "http://localhost:4318",
  serviceName: CONNECTOR_NAME,
  shutdownTimeoutMs: 5_000,
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

export const CHANNEL_CREATION_KINDS = [
  "category",
  "forum",
  "text",
] as const

export type ChannelCreationKind = typeof CHANNEL_CREATION_KINDS[number]

export const CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS = [
  60,
  1_440,
  4_320,
  10_080,
] as const

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
