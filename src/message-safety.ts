import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import type { DiscordAllowedMentions } from "./discord-client.js"
import { InteractionIdentityError } from "./errors.js"
import type { ScopePolicy } from "./policy.js"
import type { DiscordMessage } from "./types.js"

const MESSAGE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const MESSAGE_USER_MENTION_PATTERN = /<@!?([0-9]{1,20})>/gu

export function assertDiscordSnowflake(value: string, name: string): void {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a Discord snowflake`)
  }
}

export function assertDiscordMessageContent(content: string): void {
  if (typeof content !== "string" || !content.trim()) {
    throw new RangeError("Discord message content must not be blank")
  }
  if (content.length > DISCORD_LIMITS.messageContentCharacters) {
    throw new RangeError(
      `Discord message content must not exceed ${DISCORD_LIMITS.messageContentCharacters} characters`,
    )
  }
  if (MESSAGE_CONTROL_PATTERN.test(content)) {
    throw new RangeError("Discord message content contains unsupported control characters")
  }
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    if (code < 0xD800 || code > 0xDFFF) continue
    const next = content.charCodeAt(index + 1)
    if (code <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      index += 1
      continue
    }
    throw new RangeError("Discord message content contains invalid Unicode")
  }
}

export function canonicalDiscordNotificationUserIds(
  content: string,
  requested: readonly string[] | undefined,
): string[] {
  if (requested !== undefined && !Array.isArray(requested)) {
    throw new RangeError("Discord message notification user IDs must be an array")
  }
  const userIds = [...(requested || [])]
  if (userIds.length > CONNECTOR_LIMITS.interactionNotificationUsers) {
    throw new RangeError(
      `Discord message notifications must not exceed ${CONNECTOR_LIMITS.interactionNotificationUsers} users`,
    )
  }
  if (new Set(userIds).size !== userIds.length) {
    throw new RangeError("Discord message notification user IDs must be unique")
  }
  for (const userId of userIds) {
    assertDiscordSnowflake(userId, "Discord notification user ID")
  }
  const visibleMentions = new Set(
    [...content.matchAll(MESSAGE_USER_MENTION_PATTERN)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  )
  for (const userId of userIds) {
    if (!visibleMentions.has(userId)) {
      throw new RangeError(
        `Discord notification user ${userId} must have a visible user mention in content`,
      )
    }
  }
  return userIds.sort()
}

export function discordNotificationUserIds(
  content: string,
  requested: readonly string[] | undefined,
  policy: ScopePolicy,
): string[] {
  const userIds = canonicalDiscordNotificationUserIds(content, requested)
  policy.assertNotificationUsers(userIds)
  return userIds
}

export function discordAllowedMentions(
  userIds: readonly string[],
  repliedUser: boolean,
): DiscordAllowedMentions {
  return userIds.length > 0
    ? { replied_user: repliedUser, users: [...userIds] }
    : { parse: [], replied_user: repliedUser }
}

export function assertDiscordMessageIdentity(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId?: string,
): void {
  if (
    (messageId !== undefined && message.id !== messageId)
    || !DISCORD_SNOWFLAKE_PATTERN.test(message.id)
    || message.channel_id !== channelId
    || Boolean(message.guild_id && message.guild_id !== guildId)
  ) {
    throw new InteractionIdentityError("Discord returned a different interaction message than requested")
  }
}

export function assertDiscordBotMessage(
  message: DiscordMessage,
  botId: string,
): void {
  if (message.author.id !== botId || !message.author.bot || message.webhook_id !== undefined) {
    throw new InteractionIdentityError("Discord interaction message is not owned by the verified bot")
  }
}

export function assertDiscordReplyReference(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  replyToMessageId: string | undefined,
): void {
  const reference = message.message_reference
  if (replyToMessageId === undefined) {
    if (reference !== undefined) {
      throw new InteractionIdentityError(
        "Discord returned a reply reference for a non-reply send",
      )
    }
    return
  }
  if (reference === undefined) {
    throw new InteractionIdentityError(
      "Discord returned no reply reference for the requested send",
    )
  }
  if (
    reference.message_id !== replyToMessageId
    || (reference.channel_id !== undefined && reference.channel_id !== channelId)
    || (reference.guild_id !== undefined && reference.guild_id !== guildId)
    || (reference.type !== undefined
      && reference.type !== DISCORD_MESSAGE_REFERENCE_TYPES.default)
  ) {
    throw new InteractionIdentityError(
      "Discord returned a reply reference that does not match the requested send",
    )
  }
}
