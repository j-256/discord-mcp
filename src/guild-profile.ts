import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import { GuildProfileEvidenceError } from "./errors.js"

const ASSET_HASH_PATTERN = /^(?:a_)?[a-f0-9]{32}$/iu
const DESIRED_FORBIDDEN_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}]/u
const EDGE_WHITESPACE_PATTERN = /^\p{White_Space}|\p{White_Space}$/u
const INBOUND_FORBIDDEN_CHARACTER_PATTERN = /[\p{Cc}\p{Cs}]/u
const PROFILE_KEYS = [
  "description",
  "id",
  "mediaPresence",
  "name",
  "ownerId",
] as const
const MEDIA_PRESENCE_KEYS = [
  "banner",
  "discoverySplash",
  "icon",
  "inviteSplash",
] as const

export interface DiscordGuildProfileMediaPresence {
  banner: boolean
  discoverySplash: boolean
  icon: boolean
  inviteSplash: boolean
}

export interface DiscordGuildProfile {
  description: string | null
  id: string
  mediaPresence: DiscordGuildProfileMediaPresence
  name: string
  ownerId: string
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function validInboundText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string"
    && [...value].length >= minimum
    && [...value].length <= maximum
    && validUnicode(value)
    && !INBOUND_FORBIDDEN_CHARACTER_PATTERN.test(value)
}

function validDesiredText(value: string, minimum: number, maximum: number): boolean {
  return [...value].length >= minimum
    && [...value].length <= maximum
    && validUnicode(value)
    && !DESIRED_FORBIDDEN_CHARACTER_PATTERN.test(value)
    && !EDGE_WHITESPACE_PATTERN.test(value)
}

export function normalizeDesiredGuildProfileName(value: unknown): string {
  if (
    typeof value !== "string"
    || !validDesiredText(
      value,
      DISCORD_LIMITS.guildNameMinimumCharacters,
      DISCORD_LIMITS.guildNameCharacters,
    )
  ) {
    throw new RangeError(
      `Discord guild name must contain ${DISCORD_LIMITS.guildNameMinimumCharacters}-${DISCORD_LIMITS.guildNameCharacters} Unicode characters without controls, formatting code points, surrogates, or surrounding whitespace`,
    )
  }
  return value
}

export function normalizeDesiredGuildProfileDescription(
  value: unknown,
): string | null {
  if (value === null) return null
  if (
    typeof value !== "string"
    || !validDesiredText(value, 1, DISCORD_LIMITS.guildDescriptionCharacters)
  ) {
    throw new RangeError(
      `Discord guild description must be null or contain 1-${DISCORD_LIMITS.guildDescriptionCharacters} Unicode characters without controls, formatting code points, surrogates, or surrounding whitespace`,
    )
  }
  return value
}

function assetPresent(value: unknown): boolean {
  if (value === null) return false
  if (typeof value !== "string" || !ASSET_HASH_PATTERN.test(value)) {
    throw new GuildProfileEvidenceError(
      "Discord returned invalid guild profile media evidence",
    )
  }
  return true
}

export function validateGuildProfileProjection(
  value: unknown,
  guildId: string,
): DiscordGuildProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildProfileEvidenceError(
      "Discord returned incomplete or invalid guild profile evidence",
    )
  }
  const record = value as Record<string, unknown>
  if (
    !exactKeys(record, PROFILE_KEYS)
    || record.id !== guildId
    || !positiveSnowflake(record.id)
    || !positiveSnowflake(record.ownerId)
    || !validInboundText(
      record.name,
      DISCORD_LIMITS.guildNameMinimumCharacters,
      DISCORD_LIMITS.guildNameCharacters,
    )
    || !(record.description === null || validInboundText(
      record.description,
      0,
      DISCORD_LIMITS.guildDescriptionCharacters,
    ))
    || !record.mediaPresence
    || typeof record.mediaPresence !== "object"
    || Array.isArray(record.mediaPresence)
  ) {
    throw new GuildProfileEvidenceError(
      "Discord returned incomplete or invalid guild profile evidence",
    )
  }
  const media = record.mediaPresence as Record<string, unknown>
  if (
    !exactKeys(media, MEDIA_PRESENCE_KEYS)
    || MEDIA_PRESENCE_KEYS.some((key) => typeof media[key] !== "boolean")
  ) {
    throw new GuildProfileEvidenceError(
      "Discord returned incomplete or invalid guild profile media evidence",
    )
  }
  return {
    description: record.description,
    id: record.id,
    mediaPresence: {
      banner: media.banner,
      discoverySplash: media.discoverySplash,
      icon: media.icon,
      inviteSplash: media.inviteSplash,
    } as DiscordGuildProfileMediaPresence,
    name: record.name,
    ownerId: record.ownerId,
  }
}

export function projectGuildProfile(
  value: unknown,
  guildId: string,
): DiscordGuildProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildProfileEvidenceError(
      "Discord returned incomplete or invalid guild profile evidence",
    )
  }
  const record = value as Record<string, unknown>
  if (
    record.id !== guildId
    || !positiveSnowflake(record.id)
    || !positiveSnowflake(record.owner_id)
    || !validInboundText(
      record.name,
      DISCORD_LIMITS.guildNameMinimumCharacters,
      DISCORD_LIMITS.guildNameCharacters,
    )
    || !(record.description === null || validInboundText(
      record.description,
      0,
      DISCORD_LIMITS.guildDescriptionCharacters,
    ))
    || !Object.hasOwn(record, "banner")
    || !Object.hasOwn(record, "discovery_splash")
    || !Object.hasOwn(record, "icon")
    || !Object.hasOwn(record, "splash")
  ) {
    throw new GuildProfileEvidenceError(
      "Discord returned incomplete or invalid guild profile evidence",
    )
  }
  return validateGuildProfileProjection({
    description: record.description,
    id: record.id,
    mediaPresence: {
      banner: assetPresent(record.banner),
      discoverySplash: assetPresent(record.discovery_splash),
      icon: assetPresent(record.icon),
      inviteSplash: assetPresent(record.splash),
    },
    name: record.name,
    ownerId: record.owner_id,
  }, guildId)
}
