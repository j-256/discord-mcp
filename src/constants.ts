export const CONNECTOR_NAME = "discord-mcp"
export const CONNECTOR_VERSION = "0.1.0"
export const SCHEMA_VERSION = 1

export const DISCORD_API_BASE_URL = "https://discord.com/api/v10"
export const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
export const DISCORD_WEB_BASE_URL = "https://discord.com"
export const DISCORD_USER_AGENT = `DiscordBot (discord-mcp, ${CONNECTOR_VERSION})`
export const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{1,20}$/
export const DISCORD_SNOWFLAKE_MAX = 18_446_744_073_709_551_615n
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
export const GUILD_SCAFFOLD_SYMBOL_PATTERN = /^[a-z][a-z0-9_-]*$/
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
  "audit-logs",
  "automod",
  "bans",
  "channel-creation",
  "connector",
  "deletion",
  "forum-posts",
  "gateway",
  "guild-expressions",
  "guild-scaffolds",
  "guilds",
  "interactions",
  "member-roles",
  "members",
  "messages",
  "moderation",
  "observability",
  "permission-overwrites",
  "permissions",
  "pins",
  "role-creation",
  "roles",
  "scheduled-events",
  "threads",
  "webhooks",
] as const

export type McpToolsetName = typeof MCP_TOOLSET_NAMES[number]

export const ENVIRONMENT_NAMES = Object.freeze({
  adminGuildIds: "DISCORD_MCP_ADMIN_GUILD_IDS",
  allowedChannelIds: "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  allowedGuildIds: "DISCORD_MCP_ALLOWED_GUILD_IDS",
  allowAdministration: "DISCORD_MCP_ALLOW_ADMINISTRATION",
  allowAttachments: "DISCORD_MCP_ALLOW_ATTACHMENTS",
  allowAutomodAudit: "DISCORD_MCP_ALLOW_AUTOMOD_AUDIT",
  allowAutomodChanges: "DISCORD_MCP_ALLOW_AUTOMOD_CHANGES",
  allowBanAudit: "DISCORD_MCP_ALLOW_BAN_AUDIT",
  allowChannelCreation: "DISCORD_MCP_ALLOW_CHANNEL_CREATION",
  allowDeletions: "DISCORD_MCP_ALLOW_DELETIONS",
  allowForumPosts: "DISCORD_MCP_ALLOW_FORUM_POSTS",
  allowGateway: "DISCORD_MCP_ALLOW_GATEWAY",
  allowGuildExpressionAudit: "DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT",
  allowGuildExpressionChanges: "DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES",
  allowGuildScaffolds: "DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS",
  allowInteractions: "DISCORD_MCP_ALLOW_INTERACTIONS",
  allowMemberDirectory: "DISCORD_MCP_ALLOW_MEMBER_DIRECTORY",
  allowMemberRoleChanges: "DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES",
  allowPinManagement: "DISCORD_MCP_ALLOW_PIN_MANAGEMENT",
  allowObservabilityExport: "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT",
  allowPermissionOverwrites: "DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES",
  allowRoleCreation: "DISCORD_MCP_ALLOW_ROLE_CREATION",
  allowScheduledEventAudit: "DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT",
  allowScheduledEventChanges: "DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES",
  allowWebhookAudit: "DISCORD_MCP_ALLOW_WEBHOOK_AUDIT",
  allowWebhookDeletions: "DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS",
  applicationId: "DISCORD_MCP_APPLICATION_ID",
  attachmentChannelIds: "DISCORD_MCP_ATTACHMENT_CHANNEL_IDS",
  attachmentMaxBytes: "DISCORD_MCP_ATTACHMENT_MAX_BYTES",
  attachmentRoots: "DISCORD_MCP_ATTACHMENT_ROOTS",
  automodAlertChannelIds: "DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS",
  automodGuildIds: "DISCORD_MCP_AUTOMOD_GUILD_IDS",
  banAuditGuildIds: "DISCORD_MCP_BAN_AUDIT_GUILD_IDS",
  auditFile: "DISCORD_MCP_AUDIT_FILE",
  botId: "DISCORD_MCP_BOT_ID",
  channelCreationGuildIds: "DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS",
  deleteChannelIds: "DISCORD_MCP_DELETE_CHANNEL_IDS",
  forumPostChannelIds: "DISCORD_MCP_FORUM_POST_CHANNEL_IDS",
  gatewayEventBufferSize: "DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE",
  guildScaffoldGuildIds: "DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS",
  guildExpressionGuildIds: "DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS",
  guildExpressionRoots: "DISCORD_MCP_GUILD_EXPRESSION_ROOTS",
  interactionChannelIds: "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
  interactionMaxWritesPerMinute: "DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE",
  interactionMinWriteIntervalMs: "DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS",
  mentionUserIds: "DISCORD_MCP_MENTION_USER_IDS",
  memberDirectoryGuildIds: "DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS",
  memberRoleGuildIds: "DISCORD_MCP_MEMBER_ROLE_GUILD_IDS",
  memberRoleIds: "DISCORD_MCP_MEMBER_ROLE_IDS",
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
  pinChannelIds: "DISCORD_MCP_PIN_CHANNEL_IDS",
  permissionOverwriteChannelIds: "DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS",
  roleCreationGuildIds: "DISCORD_MCP_ROLE_CREATION_GUILD_IDS",
  scheduledEventGuildIds: "DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS",
  scheduledEventRoots: "DISCORD_MCP_SCHEDULED_EVENT_ROOTS",
  token: "DISCORD_BOT_TOKEN",
  toolSurface: "DISCORD_MCP_TOOL_SURFACE",
  toolsets: "DISCORD_MCP_TOOLSETS",
  webhookChannelIds: "DISCORD_MCP_WEBHOOK_CHANNEL_IDS",
})

export const DISCORD_LIMITS = Object.freeze({
  allowedMentionUsers: 100,
  attachmentBytes: 10 * 1_024 * 1_024,
  attachmentDescriptionCharacters: 1_024,
  attachmentFilenameCharacters: 240,
  autoModerationActions: 3,
  autoModerationAllowListKeywords: 100,
  autoModerationAllowListPresetKeywords: 1_000,
  autoModerationCustomMessageCharacters: 150,
  autoModerationExemptChannels: 50,
  autoModerationExemptRoles: 20,
  autoModerationKeywordCharacters: 60,
  autoModerationKeywordEntries: 1_000,
  autoModerationMentionLimit: 50,
  autoModerationRegexCharacters: 260,
  autoModerationRegexPatterns: 10,
  autoModerationRuleNameCharacters: 100,
  autoModerationRules: 10,
  autoModerationTimeoutSeconds: 2_419_200,
  auditReasonEncodedCharacters: 512,
  automaticRetryWaitMs: 5_000,
  archivedThreads: 100,
  archivedThreadsMinimum: 2,
  bulkDeleteAgeMs: 14 * 24 * 60 * 60 * 1_000,
  bulkDeleteSafetyMarginMs: 60_000,
  banDeleteMessageSeconds: 7 * 24 * 60 * 60,
  channelMessages: 100,
  channelPins: 50,
  channelPermissionOverwrites: 1_000,
  channelNameCharacters: 100,
  channelRateLimitSeconds: 21_600,
  channelTopicCharacters: 1_024,
  categoryChannels: 50,
  currentUserGuilds: 200,
  deletionMessages: 100,
  guildMessageSearch: 25,
  forumAppliedTags: 5,
  forumAvailableTags: 20,
  guildRoles: 250,
  guildEmojis: 1_000,
  guildFeatureCharacters: 100,
  guildFeatures: 256,
  guildStickers: 100,
  guildChannels: 500,
  emojiBytes: 256 * 1_024,
  emojiNameCharacters: 32,
  messageContentCharacters: 2_000,
  messageNonceCharacters: 25,
  requestTimeoutMs: 30_000,
  retries: 3,
  roleColor: 0xFF_FF_FF,
  roleNameCharacters: 100,
  scheduledEventCoverBytes: 8 * 1_024 * 1_024,
  scheduledEventDescriptionCharacters: 1_000,
  scheduledEventLocationCharacters: 100,
  scheduledEventNameCharacters: 100,
  scheduledEvents: 100,
  searchChannelIds: 500,
  searchContentCharacters: 1_024,
  searchFilenameCharacters: 1_024,
  searchFilterCharacters: 256,
  searchFilterIds: 100,
  searchFilterStrings: 100,
  searchOffset: 9_975,
  searchSlop: 100,
  snowflakeCharacters: 20,
  stickerBytes: 512 * 1_024,
  stickerDescriptionCharacters: 100,
  stickerDurationSeconds: 5,
  stickerNameCharacters: 30,
  stickerPixels: 320,
  stickerTagCharacters: 200,
  webhookNameCharacters: 80,
  webhooksPerChannel: 15,
})

export const PERMISSION_LIMITS = Object.freeze({
  auditActions: 5,
  auditRolePage: 100,
  auditRolePageDefault: 50,
  overwritePage: 100,
  overwritePageDefault: 50,
})

export const MEMBER_DIRECTORY_LIMITS = Object.freeze({
  listPage: 100,
  listPageDefault: 25,
  nameCharacters: 100,
  queryCharacters: 100,
  queryMinimumCharacters: 2,
  searchPage: 25,
  searchPageDefault: 10,
})

export const AUDIT_LOG_LIMITS = Object.freeze({
  changes: 100,
  entryPage: 50,
  entryPageDefault: 25,
  options: 50,
  reasonCharacters: 512,
  reflectedKeyCharacters: 100,
  responseEntries: 100,
})

export const BAN_AUDIT_LIMITS = Object.freeze({
  listPage: 100,
  listPageDefault: 25,
  reasonCharacters: 512,
  responseEntries: 101,
  userTextCharacters: 100,
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
  memberRoleAllowlist: 100,
  memberRoleImpactChannels: 50,
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
  scaffoldChannels: 20,
  scaffoldRoles: 10,
  scaffoldStepLimit: 10,
  scaffoldSteps: 25,
  scaffoldSymbolCharacters: 32,
  profileBytes: 16_384,
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

export const MEMBER_ROLE_ACTIONS = [
  "add",
  "remove",
] as const

export type MemberRoleAction = typeof MEMBER_ROLE_ACTIONS[number]

export const INTERACTION_DEFAULTS = Object.freeze({
  maxWritesPerMinute: 10,
  minWriteIntervalMs: 500,
})

export const DISCORD_APPLICATION_FLAGS = Object.freeze({
  gatewayGuildMembers: 1n << 14n,
  gatewayGuildMembersLimited: 1n << 15n,
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

export const DISCORD_CHANNEL_FLAGS = Object.freeze({
  requireTag: 1 << 4,
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
