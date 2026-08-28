import type { BotProfileImageFormat } from "./bot-profile-file.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import { BotProfileEvidenceError } from "./errors.js"
import {
  GuildExpressionFileError,
  inspectDiscordImageDataBytes,
} from "./guild-expression-file.js"

export interface DiscordCurrentBotProfile {
  avatarHash: string | null
  bannerHash: string | null
  bot: true
  id: string
  unknownFieldCount: number
  username: string
}

export type ModifyCurrentBotProfileImageInput =
  | { kind: "clear" }
  | {
    bytes: Uint8Array
    format: BotProfileImageFormat
    kind: "image"
  }

export interface ModifyCurrentBotProfileInput {
  avatar?: ModifyCurrentBotProfileImageInput
  banner?: ModifyCurrentBotProfileImageInput
  username?: string
}

const CURRENT_BOT_PROFILE_KEYS = [
  "accent_color",
  "avatar",
  "avatar_decoration_data",
  "banner",
  "bot",
  "collectibles",
  "discriminator",
  "email",
  "flags",
  "global_name",
  "id",
  "locale",
  "mfa_enabled",
  "premium_type",
  "primary_guild",
  "public_flags",
  "system",
  "username",
  "verified",
] as const
const BOT_PROFILE_INPUT_KEYS = ["avatar", "banner", "username"] as const
const BOT_PROFILE_IMAGE_INPUT_KEYS = ["bytes", "format", "kind"] as const
const BOT_PROFILE_CLEAR_INPUT_KEYS = ["kind"] as const
const PROFILE_HASH_PATTERN = /^(?:a_)?[a-f0-9]{32}$/u
const USERNAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const PROHIBITED_USERNAME_PATTERN = /[@#:`]|discord/iu

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index])
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${name} must be a positive Discord snowflake ID`)
  }
}

function assertValidUnicode(value: string, name: string): void {
  try {
    new TextEncoder().encode(value)
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${name} contains invalid Unicode`, { cause: error })
  }
}

export function normalizeDesiredBotUsername(value: unknown): string {
  if (
    typeof value !== "string"
    || [...value].length < DISCORD_LIMITS.botUsernameMinimumCharacters
    || [...value].length > DISCORD_LIMITS.botUsernameCharacters
    || value.trim() !== value
    || value.replace(/\s+/gu, " ") !== value
    || USERNAME_CONTROL_PATTERN.test(value)
    || PROHIBITED_USERNAME_PATTERN.test(value)
    || ["everyone", "here"].includes(value.toLowerCase())
  ) {
    throw new RangeError(
      `Discord bot username must contain ${DISCORD_LIMITS.botUsernameMinimumCharacters}-${DISCORD_LIMITS.botUsernameCharacters} safe characters and satisfy Discord username restrictions`,
    )
  }
  assertValidUnicode(value, "Discord bot username")
  return value
}

function returnedUsername(value: unknown): string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > DISCORD_LIMITS.botUsernameCharacters
    || USERNAME_CONTROL_PATTERN.test(value)
  ) {
    throw new BotProfileEvidenceError(
      "Discord returned invalid current bot-profile evidence",
    )
  }
  try {
    assertValidUnicode(value, "Discord current bot username")
  } catch (error) {
    throw new BotProfileEvidenceError(
      "Discord returned invalid current bot-profile evidence",
      { cause: error },
    )
  }
  return value
}

function returnedImageHash(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string" || !PROFILE_HASH_PATTERN.test(value)) {
    throw new BotProfileEvidenceError(
      "Discord returned invalid current bot-profile evidence",
    )
  }
  return value
}

export function projectCurrentBotProfile(
  value: unknown,
  expectedBotId: string,
): DiscordCurrentBotProfile {
  assertSnowflake(expectedBotId, "Discord expected bot ID")
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BotProfileEvidenceError(
      "Discord returned invalid current bot-profile evidence",
    )
  }
  const record = value as Record<string, unknown>
  try {
    assertSnowflake(record.id, "Discord current bot-profile user ID")
  } catch (error) {
    throw new BotProfileEvidenceError(
      "Discord returned invalid current bot-profile evidence",
      { cause: error },
    )
  }
  if (
    record.id !== expectedBotId
    || record.bot !== true
    || record.system === true
  ) {
    throw new BotProfileEvidenceError(
      "Discord returned mismatched current bot-profile identity evidence",
    )
  }
  return {
    avatarHash: returnedImageHash(record.avatar),
    bannerHash: returnedImageHash(record.banner),
    bot: true,
    id: expectedBotId,
    unknownFieldCount: Object.keys(record).filter(
      (key) => !CURRENT_BOT_PROFILE_KEYS.includes(
        key as typeof CURRENT_BOT_PROFILE_KEYS[number],
      ),
    ).length,
    username: returnedUsername(record.username),
  }
}

function imageData(
  value: ModifyCurrentBotProfileImageInput,
  description: string,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`${description} change must be an exact object`)
  }
  const record = value as unknown as Record<string, unknown>
  if (value.kind === "clear") {
    if (!exactKeys(record, BOT_PROFILE_CLEAR_INPUT_KEYS)) {
      throw new RangeError(`${description} clear change has unsupported fields`)
    }
    return null
  }
  if (
    value.kind !== "image"
    || !exactKeys(record, BOT_PROFILE_IMAGE_INPUT_KEYS)
    || !(value.bytes instanceof Uint8Array)
    || value.bytes.byteLength < 1
    || value.bytes.byteLength > CONNECTOR_LIMITS.botProfileImageBytes
  ) {
    throw new RangeError(`${description} image change is invalid`)
  }
  let details
  try {
    details = inspectDiscordImageDataBytes(value.bytes)
  } catch (error) {
    if (error instanceof GuildExpressionFileError) {
      throw new RangeError(`${description} image bytes are invalid`, { cause: error })
    }
    throw error
  }
  if (details.format !== value.format) {
    throw new RangeError(`${description} image format does not match its bytes`)
  }
  return `data:${details.mediaType};base64,${Buffer.from(value.bytes).toString("base64")}`
}

export function currentBotProfileBody(
  input: ModifyCurrentBotProfileInput,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RangeError("Discord current bot-profile input must be an exact object")
  }
  const record = input as unknown as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length < 1
    || keys.some((key) => !BOT_PROFILE_INPUT_KEYS.includes(
      key as typeof BOT_PROFILE_INPUT_KEYS[number],
    ))
    || keys.some((key) => record[key] === undefined)
  ) {
    throw new RangeError(
      "Discord current bot-profile input requires supported explicit fields",
    )
  }
  return {
    ...(input.avatar !== undefined
      ? { avatar: imageData(input.avatar, "Discord bot avatar") }
      : {}),
    ...(input.banner !== undefined
      ? { banner: imageData(input.banner, "Discord bot banner") }
      : {}),
    ...(input.username !== undefined
      ? { username: normalizeDesiredBotUsername(input.username) }
      : {}),
  }
}
