import { CHANNEL_TYPE_NAMES, CONNECTOR_LIMITS } from "./constants.js"
import type {
  DiscordAttachment,
  DiscordChannel,
  DiscordGuild,
  DiscordMessage,
  DiscordUser,
} from "./types.js"

function normalizeUser(user: DiscordUser) {
  return {
    bot: user.bot || false,
    globalName: user.global_name ?? null,
    id: user.id,
    username: user.username,
  }
}

function normalizeAttachment(attachment: DiscordAttachment) {
  return {
    contentType: attachment.content_type ?? null,
    description: attachment.description ?? null,
    filename: attachment.filename,
    height: attachment.height ?? null,
    id: attachment.id,
    proxyUrl: attachment.proxy_url ?? null,
    size: attachment.size,
    url: attachment.url,
    width: attachment.width ?? null,
  }
}

export function normalizeGuild(guild: DiscordGuild) {
  return {
    features: [...(guild.features || [])].sort(),
    id: guild.id,
    name: guild.name,
    owner: guild.owner || false,
    permissions: guild.permissions ?? null,
  }
}

export function normalizeChannel(channel: DiscordChannel) {
  const typeName = CHANNEL_TYPE_NAMES[channel.type as keyof typeof CHANNEL_TYPE_NAMES]
  return {
    guildId: channel.guild_id ?? null,
    id: channel.id,
    lastMessageId: channel.last_message_id ?? null,
    name: channel.name ?? null,
    nsfw: channel.nsfw || false,
    parentId: channel.parent_id ?? null,
    position: channel.position ?? null,
    thread: channel.thread_metadata
      ? {
          archiveTimestamp: channel.thread_metadata.archive_timestamp ?? null,
          archived: channel.thread_metadata.archived || false,
          autoArchiveDuration: channel.thread_metadata.auto_archive_duration ?? null,
          invitable: channel.thread_metadata.invitable ?? null,
          locked: channel.thread_metadata.locked || false,
        }
      : null,
    topic: channel.topic ?? null,
    type: channel.type,
    typeName: typeName || "unknown",
  }
}

export function normalizeMessage(message: DiscordMessage) {
  return {
    attachments: (message.attachments || []).map(normalizeAttachment),
    author: normalizeUser(message.author),
    channelId: message.channel_id,
    components: message.components || [],
    content: message.content,
    editedTimestamp: message.edited_timestamp ?? null,
    embeds: message.embeds || [],
    flags: message.flags ?? 0,
    guildId: message.guild_id ?? null,
    id: message.id,
    mentionEveryone: message.mention_everyone || false,
    mentionRoleIds: message.mention_roles || [],
    mentions: (message.mentions || []).map(normalizeUser),
    messageReference: message.message_reference
      ? {
          channelId: message.message_reference.channel_id ?? null,
          guildId: message.message_reference.guild_id ?? null,
          messageId: message.message_reference.message_id ?? null,
          type: message.message_reference.type ?? null,
        }
      : null,
    pinned: message.pinned || false,
    reactions: message.reactions || [],
    referencedMessageId: message.referenced_message?.id ?? null,
    timestamp: message.timestamp,
    tts: message.tts || false,
    type: message.type,
  }
}

export function deletionSnapshot(message: DiscordMessage) {
  const normalized = normalizeMessage(message)
  return {
    attachments: normalized.attachments.map((attachment) => ({
      contentType: attachment.contentType,
      description: attachment.description,
      filename: attachment.filename,
      id: attachment.id,
      size: attachment.size,
    })),
    authorId: normalized.author.id,
    channelId: normalized.channelId,
    components: normalized.components,
    content: normalized.content,
    editedTimestamp: normalized.editedTimestamp,
    embeds: normalized.embeds,
    flags: normalized.flags,
    guildId: normalized.guildId,
    id: normalized.id,
    timestamp: normalized.timestamp,
    type: normalized.type,
  }
}

export function deletionPreview(message: DiscordMessage) {
  const content = message.content
  const previewLength = CONNECTOR_LIMITS.contentPreviewCharacters
  return {
    attachmentFilenames: (message.attachments || []).map((attachment) => attachment.filename),
    author: normalizeUser(message.author),
    contentLength: [...content].length,
    contentPreview: [...content].slice(0, previewLength).join(""),
    editedTimestamp: message.edited_timestamp ?? null,
    id: message.id,
    timestamp: message.timestamp,
    truncated: [...content].length > previewLength,
  }
}

export function stableString(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`
  const record = value as Record<string, unknown>
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(record[key])}`)
  return `{${fields.join(",")}}`
}
