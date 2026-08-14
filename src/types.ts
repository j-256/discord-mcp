export interface DiscordApplication {
  bot?: DiscordUser
  description: string
  flags?: number
  id: string
  name: string
  verify_key?: string
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
  guild_id?: string
  id: string
  last_message_id?: string | null
  name?: string | null
  nsfw?: boolean
  parent_id?: string | null
  permission_overwrites?: unknown[]
  position?: number
  thread_metadata?: {
    archive_timestamp?: string
    archived?: boolean
    auto_archive_duration?: number
    invitable?: boolean
    locked?: boolean
  }
  topic?: string | null
  type: number
}

export interface DiscordGuild {
  features?: string[]
  icon?: string | null
  id: string
  name: string
  owner?: boolean
  permissions?: string
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
  pinned?: boolean
  reactions?: unknown[]
  referenced_message?: DiscordMessage | null
  timestamp: string
  tts?: boolean
  type: number
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
