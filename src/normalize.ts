import {
  CHANNEL_TYPE_NAMES,
  CONNECTOR_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_WEB_BASE_URL,
} from "./constants.js"
import type {
  DiscordAttachment,
  DiscordChannel,
  DiscordGuild,
  DiscordMessage,
  DiscordForumTag,
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
    size: attachment.size,
    width: attachment.width ?? null,
  }
}

function normalizeForumTag(tag: DiscordForumTag) {
  return {
    emojiId: tag.emoji_id ?? null,
    emojiName: tag.emoji_name ?? null,
    id: tag.id,
    moderated: tag.moderated,
    name: tag.name,
  }
}

export function discordChannelUrl(guildId: string, channelId: string): string {
  return `${DISCORD_WEB_BASE_URL}/channels/${guildId}/${channelId}`
}

export function discordMessageUrl(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return `${discordChannelUrl(guildId, channelId)}/${messageId}`
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
  const guildId = channel.guild_id ?? null
  return {
    appliedTagIds: [...(channel.applied_tags || [])],
    availableTags: (channel.available_tags || []).map(normalizeForumTag),
    defaultAutoArchiveDuration: channel.default_auto_archive_duration ?? null,
    defaultForumLayout: channel.default_forum_layout ?? null,
    defaultReaction: channel.default_reaction_emoji
      ? {
          emojiId: channel.default_reaction_emoji.emoji_id ?? null,
          emojiName: channel.default_reaction_emoji.emoji_name ?? null,
        }
      : null,
    defaultSortOrder: channel.default_sort_order ?? null,
    flags: channel.flags ?? 0,
    guildId,
    id: channel.id,
    lastMessageId: channel.last_message_id ?? null,
    memberCount: channel.member_count ?? null,
    messageCount: channel.message_count ?? null,
    name: channel.name ?? null,
    nsfw: channel.nsfw || false,
    ownerId: channel.owner_id ?? null,
    parentId: channel.parent_id ?? null,
    permissionOverwriteCount: channel.permission_overwrites?.length ?? null,
    position: channel.position ?? null,
    rateLimitPerUser: channel.rate_limit_per_user ?? null,
    thread: channel.thread_metadata
      ? {
          archiveTimestamp: channel.thread_metadata.archive_timestamp ?? null,
          archived: channel.thread_metadata.archived || false,
          autoArchiveDuration: channel.thread_metadata.auto_archive_duration ?? null,
          createTimestamp: channel.thread_metadata.create_timestamp ?? null,
          invitable: channel.thread_metadata.invitable ?? null,
          locked: channel.thread_metadata.locked || false,
        }
      : null,
    topic: channel.topic ?? null,
    totalMessageSent: channel.total_message_sent ?? null,
    type: channel.type,
    typeName: typeName || "unknown",
    url: guildId ? discordChannelUrl(guildId, channel.id) : null,
  }
}

export function normalizeMessage(message: DiscordMessage, fallbackGuildId?: string) {
  const guildId = message.guild_id ?? fallbackGuildId ?? null
  if (
    message.message_snapshots !== undefined
    && (
      !Array.isArray(message.message_snapshots)
      || message.message_snapshots.length > 1
    )
  ) {
    throw new TypeError("Discord message snapshots are malformed")
  }
  const forwardedSnapshotCount = message.message_snapshots?.length ?? 0
  const hasSnapshotFlag = (
    (message.flags ?? 0) & DISCORD_MESSAGE_FLAGS.hasSnapshot
  ) !== 0
  if (forwardedSnapshotCount > 0 && !hasSnapshotFlag) {
    throw new TypeError("Discord message snapshot flags are inconsistent")
  }
  return {
    attachments: (message.attachments || []).map(normalizeAttachment),
    author: normalizeUser(message.author),
    channelId: message.channel_id,
    components: message.components || [],
    content: message.content,
    editedTimestamp: message.edited_timestamp ?? null,
    embeds: message.embeds || [],
    flags: message.flags ?? 0,
    forwardedSnapshotCount,
    forwardedSnapshotRedacted: hasSnapshotFlag || forwardedSnapshotCount > 0,
    guildId,
    id: message.id,
    jumpUrl: guildId
      ? discordMessageUrl(guildId, message.channel_id, message.id)
      : null,
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

export function normalizeSearchMessage(
  message: DiscordMessage,
  guildId: string,
) {
  return {
    attachmentCount: message.attachments?.length ?? 0,
    attachments: (message.attachments || []).map((attachment) => ({
      contentType: attachment.content_type ?? null,
      filename: attachment.filename,
      id: attachment.id,
      size: attachment.size,
    })),
    author: normalizeUser(message.author),
    channelId: message.channel_id,
    componentCount: message.components?.length ?? 0,
    content: message.content,
    editedTimestamp: message.edited_timestamp ?? null,
    embedCount: message.embeds?.length ?? 0,
    flags: message.flags ?? 0,
    guildId,
    id: message.id,
    jumpUrl: discordMessageUrl(guildId, message.channel_id, message.id),
    mentionEveryone: message.mention_everyone || false,
    pinned: message.pinned || false,
    timestamp: message.timestamp,
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
