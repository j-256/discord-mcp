export interface DiscordApplication {
  bot?: DiscordUser
  description: string
  flags?: number
  flags_new?: string
  id: string
  name: string
  verify_key?: string
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
  features?: string[]
  icon?: string | null
  id: string
  name: string
  owner?: boolean
  owner_id?: string
  permissions?: string
}

export interface DiscordGuildMember {
  communication_disabled_until?: string | null
  nick?: string | null
  roles: string[]
  user?: DiscordUser
}

export interface DiscordMessage {
  attachments?: DiscordAttachment[]
  author: DiscordUser
  channel_id: string
  components?: unknown[]
  content: string
  edited_timestamp?: string | null
  embeds?: unknown[]
  flags?: number
  guild_id?: string
  id: string
  mention_everyone?: boolean
  mention_roles?: string[]
  mentions?: DiscordUser[]
  message_reference?: {
    channel_id?: string
    guild_id?: string
    message_id?: string
    type?: number
  }
  nonce?: number | string | null
  pinned?: boolean
  reactions?: unknown[]
  referenced_message?: DiscordMessage | null
  timestamp: string
  tts?: boolean
  type: number
  webhook_id?: string
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
  user_id?: string
}

export interface DiscordUser {
  avatar?: string | null
  bot?: boolean
  discriminator?: string
  global_name?: string | null
  id: string
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
