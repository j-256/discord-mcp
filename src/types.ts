export interface DiscordApplication {
  bot?: DiscordUser
  bot_public?: boolean
  bot_require_code_grant?: boolean
  custom_install_url?: string | null
  description: string
  event_webhooks_status?: number
  event_webhooks_types?: string[]
  event_webhooks_url?: string | null
  flags?: number
  flags_new?: string
  id: string
  install_params?: DiscordApplicationInstallParams
  integration_types_config?: Record<
    string,
    DiscordApplicationIntegrationTypeConfiguration
  >
  interactions_endpoint_url?: string | null
  name: string
  redirect_uris?: string[]
  role_connections_verification_url?: string | null
  rpc_origins?: string[]
  verify_key?: string
}

export interface DiscordApplicationInstallParams {
  permissions: string
  scopes: string[]
}

export interface DiscordApplicationIntegrationTypeConfiguration {
  oauth2_install_params?: DiscordApplicationInstallParams
}

export interface DiscordApplicationCommandOptionChoice {
  name: string
  name_localizations?: Record<string, string> | null
  value: number | string
}

export interface DiscordApplicationCommandOption {
  autocomplete?: boolean
  channel_types?: number[]
  choices?: DiscordApplicationCommandOptionChoice[]
  description: string
  description_localizations?: Record<string, string> | null
  file_types?: string[]
  max_value?: number
  max_length?: number
  min_value?: number
  min_length?: number
  name: string
  name_localizations?: Record<string, string> | null
  options?: DiscordApplicationCommandOption[]
  required?: boolean
  type: number
}

export interface DiscordApplicationCommand {
  application_id: string
  contexts?: number[] | null
  default_permission?: boolean
  default_member_permissions?: string | null
  description: string
  description_localizations?: Record<string, string> | null
  dm_permission?: boolean
  guild_id?: string
  handler?: number
  id: string
  integration_types?: number[] | null
  name: string
  name_localizations?: Record<string, string> | null
  nsfw?: boolean
  options?: DiscordApplicationCommandOption[]
  type: number
  version: string
}

export interface DiscordApplicationRoleConnectionMetadata {
  description: string
  description_localizations?: Record<string, string> | null
  key: string
  name: string
  name_localizations?: Record<string, string> | null
  type: number
}

export interface DiscordApplicationSku {
  application_id: string
  flags: number
  id: string
  name: string
  slug: string
  type: number
}

export interface DiscordBan {
  reason?: string | null
  user: DiscordUser
}

export interface DiscordGuildAuditLogChange {
  key: string
  new_value?: unknown
  old_value?: unknown
}

export interface DiscordGuildAuditLogEntry {
  action_type: number
  changes?: DiscordGuildAuditLogChange[] | null
  id: string
  options?: Record<string, unknown> | null
  reason?: string | null
  target_id: string | null
  user_id: string | null
}

export interface DiscordGuildAuditLog {
  application_commands?: unknown[]
  audit_log_entries: DiscordGuildAuditLogEntry[]
  auto_moderation_rules?: unknown[]
  guild_scheduled_events?: unknown[]
  integrations?: unknown[]
  threads?: unknown[]
  users?: DiscordUser[]
  webhooks?: unknown[]
}

export interface DiscordAttachment {
  content_type?: string | null
  description?: string | null
  filename: string
  height?: number | null
  id: string
  proxy_url?: string
  size: number
  url: string
  width?: number | null
}

export interface DiscordChannel {
  applied_tags?: string[]
  available_tags?: DiscordForumTag[]
  bitrate?: number
  default_auto_archive_duration?: number | null
  default_forum_layout?: number
  default_reaction_emoji?: DiscordDefaultReaction | null
  default_sort_order?: number | null
  default_thread_rate_limit_per_user?: number | null
  flags?: number
  guild_id?: string
  id: string
  last_message_id?: string | null
  member?: DiscordThreadMember
  member_count?: number
  message_count?: number
  name?: string | null
  nsfw?: boolean
  owner_id?: string
  parent_id?: string | null
  permission_overwrites?: DiscordPermissionOverwrite[]
  position?: number
  rate_limit_per_user?: number | null
  recipients?: DiscordUser[]
  rtc_region?: string | null
  thread_metadata?: {
    archive_timestamp?: string
    archived?: boolean
    auto_archive_duration?: number
    create_timestamp?: string | null
    invitable?: boolean
    locked?: boolean
  }
  topic?: string | null
  total_message_sent?: number
  type: number
  user_limit?: number
  video_quality_mode?: number
}

export interface DiscordCreatedForumPost extends DiscordChannel {
  message: DiscordMessage
}

export interface DiscordDefaultReaction {
  emoji_id?: string | null
  emoji_name?: string | null
}

export interface DiscordForumTag {
  emoji_id?: string | null
  emoji_name?: string | null
  id: string
  moderated: boolean
  name: string
}

export interface DiscordGuild {
  afk_channel_id?: string | null
  afk_timeout?: number
  banner?: string | null
  default_message_notifications?: number
  description?: string | null
  discovery_splash?: string | null
  explicit_content_filter?: number
  features?: string[]
  icon?: string | null
  id: string
  name: string
  owner?: boolean
  owner_id?: string
  premium_tier?: number
  premium_progress_bar_enabled?: boolean
  public_updates_channel_id?: string | null
  rules_channel_id?: string | null
  safety_alerts_channel_id?: string | null
  splash?: string | null
  permissions?: string
  system_channel_flags?: number
  system_channel_id?: string | null
  verification_level?: number
  widget_channel_id?: string | null
  widget_enabled?: boolean
}

export interface DiscordGuildMember {
  communication_disabled_until?: string | null
  deaf?: boolean
  joined_at?: string | null
  mute?: boolean
  nick?: string | null
  pending?: boolean
  roles: string[]
  user?: DiscordUser
}

export interface DiscordMessage {
  activity?: unknown
  application_id?: string
  attachments?: DiscordAttachment[]
  author: DiscordUser
  channel_id: string
  components?: unknown[]
  content: string
  call?: unknown
  edited_timestamp?: string | null
  embeds?: unknown[]
  flags?: number
  guild_id?: string
  id: string
  interaction_metadata?: {
    authorizing_integration_owners: Record<string, string>
    id: string
    type: number
    user: DiscordUser
  }
  mention_everyone?: boolean
  mention_roles?: string[]
  mentions?: DiscordUser[]
  message_reference?: {
    channel_id?: string
    guild_id?: string
    message_id?: string
    type?: number
  }
  message_snapshots?: DiscordMessageSnapshot[]
  nonce?: number | string | null
  pinned?: boolean
  poll?: DiscordPoll
  reactions?: DiscordReaction[]
  referenced_message?: DiscordMessage | null
  sticker_items?: unknown[]
  stickers?: unknown[]
  timestamp: string
  tts?: boolean
  type: number
  webhook_id?: string
}

export interface DiscordMessageSnapshot {
  message: {
    attachments?: DiscordAttachment[]
    components?: unknown[]
    content?: string
    edited_timestamp?: string | null
    embeds?: unknown[]
    flags?: number
    mention_roles?: string[]
    mentions?: DiscordUser[]
    sticker_items?: unknown[]
    stickers?: unknown[]
    timestamp?: string
    type?: number
  }
}

export interface DiscordPartialEmoji {
  animated?: boolean
  id?: string | null
  name?: string | null
}

export interface DiscordReactionCountDetails {
  burst: number
  normal: number
}

export interface DiscordReaction {
  burst_colors: string[]
  count: number
  count_details: DiscordReactionCountDetails
  emoji: DiscordPartialEmoji
  me: boolean
  me_burst: boolean
}

export type DiscordReactionType = 0 | 1

export interface DiscordPollMedia {
  emoji?: {
    animated?: boolean
    id?: string | null
    name?: string | null
  } | null
  text?: string | null
}

export interface DiscordPollAnswer {
  answer_id: number
  poll_media: DiscordPollMedia
}

export interface DiscordPollAnswerCount {
  count: number
  id: number
  me_voted: boolean
}

export interface DiscordPollResults {
  answer_counts: DiscordPollAnswerCount[]
  is_finalized: boolean
}

export interface DiscordPoll {
  allow_multiselect: boolean
  answers: DiscordPollAnswer[]
  expiry: string | null
  layout_type: number
  question: DiscordPollMedia
  results?: DiscordPollResults
}

export interface DiscordPollVoters {
  users: DiscordUser[]
}

export interface DiscordMessagePin {
  message: DiscordMessage
  pinned_at: string
}

export interface DiscordMessagePinPage {
  has_more: boolean
  items: DiscordMessagePin[]
}

export interface DiscordMessageSearchIndexing {
  code: 110000
  documents_indexed?: number
  message: string
  retry_after: number
}

export interface DiscordMessageSearchResponse {
  documents_indexed?: number
  doing_deep_historical_index: boolean
  members?: unknown[]
  messages: DiscordMessage[][]
  threads?: DiscordChannel[]
  total_results: number
}

export interface DiscordPermissionOverwrite {
  allow?: string | null
  deny?: string | null
  id: string
  type: number
}

export interface DiscordRole {
  color?: number
  colors?: DiscordRoleColors
  flags?: number
  hoist?: boolean
  id: string
  icon?: string | null
  managed: boolean
  mentionable?: boolean
  name: string
  permissions: string
  position: number
  tags?: DiscordRoleTags
  unicode_emoji?: string | null
}

export interface DiscordStageInstance {
  channel_id: string
  discoverable_disabled: boolean
  guild_id: string
  guild_scheduled_event_id?: string | null
  id: string
  privacy_level: number
  topic: string
}

export interface DiscordRoleColors {
  primary_color: number
  secondary_color: number | null
  tertiary_color: number | null
}

export interface DiscordRoleTags {
  available_for_purchase?: null
  bot_id?: string
  guild_connections?: null
  integration_id?: string
  premium_subscriber?: null
  subscription_listing_id?: string
}

export interface DiscordThreadList {
  has_more?: boolean
  members?: unknown[]
  threads: DiscordChannel[]
}

export interface DiscordThreadMember {
  flags: number
  id?: string
  join_timestamp: string
  member?: DiscordGuildMember
  unknown_field_count?: number
  user_id?: string
}

export interface DiscordUser {
  avatar?: string | null
  bot?: boolean
  discriminator?: string
  global_name?: string | null
  id: string
  system?: boolean
  username: string
}

export interface DiscordErrorBody {
  code?: number
  errors?: unknown
  global?: boolean
  message?: string
  retry_after?: number
}

export interface MessageCursor {
  after?: string
  around?: string
  before?: string
}

export interface RequestOptions {
  signal?: AbortSignal
}
