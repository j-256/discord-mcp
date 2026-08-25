import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"

export const DISCORD_REFERENCE_LIMITS = Object.freeze({
  characters: 512,
  commandPathCharacters: 100,
  commandPathSegments: 3,
})

export const DISCORD_REFERENCE_KINDS = [
  "application-command-mention",
  "channel-mention",
  "custom-emoji-mention",
  "guild-channel",
  "guild-message",
  "private-channel",
  "private-message",
  "role-mention",
  "user-mention",
] as const

export type DiscordReferenceKind = typeof DISCORD_REFERENCE_KINDS[number]

export type DiscordReferencePolicyDecision =
  | "allowed"
  | "blocked"
  | "not-applicable"
  | "unknown"

export type DiscordReferencePolicyStatus =
  | "blocked"
  | "eligible"
  | "incomplete"
  | "not-applicable"

export type DiscordReferenceReadDecision = Exclude<
  DiscordReferencePolicyDecision,
  "not-applicable"
>

export interface DiscordReferencePolicyEvaluator {
  channelRead(channelId: string): DiscordReferenceReadDecision
  guildRead(guildId: string): DiscordReferenceReadDecision
}

export interface DiscordReferencePolicyProjection {
  channelRead: DiscordReferencePolicyDecision
  guildRead: DiscordReferencePolicyDecision
  status: DiscordReferencePolicyStatus
}

export interface DiscordReferencePrivacyProjection {
  discordAccessVerified: false
  downstreamAuthorizationRequired: true
  namesReturned: false
  networkContacted: false
  persisted: false
}

interface DiscordReferenceBase {
  policy: DiscordReferencePolicyProjection
  privacy: DiscordReferencePrivacyProjection
  schemaVersion: typeof SCHEMA_VERSION
  status: "parsed"
}

export type DiscordReferenceResult = DiscordReferenceBase & (
  | {
    ids: { commandId: string }
    kind: "application-command-mention"
  }
  | {
    ids: { channelId: string }
    kind: "channel-mention"
  }
  | {
    animated: boolean
    ids: { emojiId: string }
    kind: "custom-emoji-mention"
  }
  | {
    ids: { channelId: string; guildId: string }
    kind: "guild-channel"
  }
  | {
    ids: { channelId: string; guildId: string; messageId: string }
    kind: "guild-message"
  }
  | {
    ids: { channelId: string }
    kind: "private-channel"
  }
  | {
    ids: { channelId: string; messageId: string }
    kind: "private-message"
  }
  | {
    ids: { roleId: string }
    kind: "role-mention"
  }
  | {
    deprecatedSyntax: boolean
    ids: { userId: string }
    kind: "user-mention"
  }
)

const CHANNEL_LINK_PATTERN = /^https:\/\/discord\.com\/channels\/(@me|[0-9]{1,20})\/([0-9]{1,20})(?:\/([0-9]{1,20}))?$/u
const USER_MENTION_PATTERN = /^<@(!?)([0-9]{1,20})>$/u
const CHANNEL_MENTION_PATTERN = /^<#([0-9]{1,20})>$/u
const ROLE_MENTION_PATTERN = /^<@&([0-9]{1,20})>$/u
const COMMAND_MENTION_PATTERN = /^<\/([^:<>]{1,100}):([0-9]{1,20})>$/u
const COMMAND_SEGMENT_PATTERN = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u
const CUSTOM_EMOJI_MENTION_PATTERN = /^<(a?):([A-Za-z0-9_]{2,32}):([0-9]{1,20})>$/u
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const SENSITIVE_DISCORD_LINK_PATTERNS = Object.freeze([
  /^https:\/\/(?:www\.)?discord\.gg\//iu,
  /^https:\/\/discord\.com\/(?:invite|oauth2)\//iu,
  /^https:\/\/discord\.com\/api(?:\/v[0-9]+)?\/webhooks\//iu,
  /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\//iu,
])

const PRIVACY_PROJECTION = Object.freeze({
  discordAccessVerified: false,
  downstreamAuthorizationRequired: true,
  namesReturned: false,
  networkContacted: false,
  persisted: false,
}) satisfies DiscordReferencePrivacyProjection

const NOT_APPLICABLE_POLICY = Object.freeze({
  channelRead: "not-applicable",
  guildRead: "not-applicable",
  status: "not-applicable",
}) satisfies DiscordReferencePolicyProjection

function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) return false
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false
    }
  }
  return true
}

function positiveSnowflake(value: string | undefined): value is string {
  if (value === undefined || !DISCORD_SNOWFLAKE_PATTERN.test(value)) return false
  if (value.length > 1 && value.startsWith("0")) return false
  const numeric = BigInt(value)
  return numeric >= 1n && numeric <= DISCORD_SNOWFLAKE_MAX
}

function requireSnowflake(value: string | undefined): string {
  if (!positiveSnowflake(value)) {
    throw new RangeError("Discord reference contains an invalid snowflake")
  }
  return value
}

function base(policy: DiscordReferencePolicyProjection): DiscordReferenceBase {
  return {
    policy,
    privacy: PRIVACY_PROJECTION,
    schemaVersion: SCHEMA_VERSION,
    status: "parsed",
  }
}

function guildLinkPolicy(
  guildId: string,
  channelId: string,
  policy: DiscordReferencePolicyEvaluator,
): DiscordReferencePolicyProjection {
  const guildRead = policy.guildRead(guildId)
  const channelRead = policy.channelRead(channelId)
  return {
    channelRead,
    guildRead,
    status: guildRead === "blocked" || channelRead === "blocked"
      ? "blocked"
      : guildRead === "allowed" && channelRead === "allowed"
        ? "eligible"
        : "incomplete",
  }
}

function channelMentionPolicy(
  channelId: string,
  policy: DiscordReferencePolicyEvaluator,
): DiscordReferencePolicyProjection {
  const channelRead = policy.channelRead(channelId)
  return {
    channelRead,
    guildRead: "unknown",
    status: channelRead === "blocked" ? "blocked" : "incomplete",
  }
}

function privateLinkPolicy(): DiscordReferencePolicyProjection {
  return {
    channelRead: "unknown",
    guildRead: "not-applicable",
    status: "incomplete",
  }
}

function validCommandPath(value: string): boolean {
  if ([...value].length > DISCORD_REFERENCE_LIMITS.commandPathCharacters) return false
  const segments = value.split(" ")
  return segments.length >= 1
    && segments.length <= DISCORD_REFERENCE_LIMITS.commandPathSegments
    && segments.every((segment) => (
      COMMAND_SEGMENT_PATTERN.test(segment)
      && segment.toLowerCase() === segment
    ))
}

function assertBoundedReference(reference: unknown): asserts reference is string {
  if (typeof reference !== "string") {
    throw new TypeError("Discord reference must be one string")
  }
  if (
    reference.length === 0
    || [...reference].length > DISCORD_REFERENCE_LIMITS.characters
  ) {
    throw new RangeError("Discord reference must fit the local character limit")
  }
  if (
    reference.trim() !== reference
    || CONTROL_PATTERN.test(reference)
    || !wellFormedUnicode(reference)
  ) {
    throw new RangeError("Discord reference is malformed")
  }
  if (SENSITIVE_DISCORD_LINK_PATTERNS.some((pattern) => pattern.test(reference))) {
    throw new RangeError("Discord invite, webhook, OAuth, and media links are not accepted")
  }
}

export function parseDiscordReference(
  reference: unknown,
  policy: DiscordReferencePolicyEvaluator,
): DiscordReferenceResult {
  assertBoundedReference(reference)

  const link = CHANNEL_LINK_PATTERN.exec(reference)
  if (link) {
    const guild = link[1]
    const channelId = requireSnowflake(link[2])
    const rawMessageId = link[3]
    if (guild === "@me") {
      if (rawMessageId === undefined) {
        return {
          ...base(privateLinkPolicy()),
          ids: { channelId },
          kind: "private-channel",
        }
      }
      return {
        ...base(privateLinkPolicy()),
        ids: { channelId, messageId: requireSnowflake(rawMessageId) },
        kind: "private-message",
      }
    }
    const guildId = requireSnowflake(guild)
    const localPolicy = guildLinkPolicy(guildId, channelId, policy)
    if (rawMessageId === undefined) {
      return {
        ...base(localPolicy),
        ids: { channelId, guildId },
        kind: "guild-channel",
      }
    }
    return {
      ...base(localPolicy),
      ids: { channelId, guildId, messageId: requireSnowflake(rawMessageId) },
      kind: "guild-message",
    }
  }

  const userMention = USER_MENTION_PATTERN.exec(reference)
  if (userMention) {
    return {
      ...base(NOT_APPLICABLE_POLICY),
      deprecatedSyntax: userMention[1] === "!",
      ids: { userId: requireSnowflake(userMention[2]) },
      kind: "user-mention",
    }
  }

  const channelMention = CHANNEL_MENTION_PATTERN.exec(reference)
  if (channelMention) {
    const channelId = requireSnowflake(channelMention[1])
    return {
      ...base(channelMentionPolicy(channelId, policy)),
      ids: { channelId },
      kind: "channel-mention",
    }
  }

  const roleMention = ROLE_MENTION_PATTERN.exec(reference)
  if (roleMention) {
    return {
      ...base(NOT_APPLICABLE_POLICY),
      ids: { roleId: requireSnowflake(roleMention[1]) },
      kind: "role-mention",
    }
  }

  const commandMention = COMMAND_MENTION_PATTERN.exec(reference)
  if (commandMention && validCommandPath(commandMention[1] || "")) {
    return {
      ...base(NOT_APPLICABLE_POLICY),
      ids: { commandId: requireSnowflake(commandMention[2]) },
      kind: "application-command-mention",
    }
  }

  const customEmojiMention = CUSTOM_EMOJI_MENTION_PATTERN.exec(reference)
  if (customEmojiMention) {
    return {
      ...base(NOT_APPLICABLE_POLICY),
      animated: customEmojiMention[1] === "a",
      ids: { emojiId: requireSnowflake(customEmojiMention[3]) },
      kind: "custom-emoji-mention",
    }
  }

  throw new RangeError("Discord reference format is unsupported")
}
