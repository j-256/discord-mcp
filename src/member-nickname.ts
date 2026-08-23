import { DISCORD_LIMITS } from "./constants.js"

const FORBIDDEN_NICKNAME_CODE_POINT_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}]/u
const INBOUND_NICKNAME_CONTROL_PATTERN = /[\p{Cc}\p{Cs}]/u
const EDGE_WHITESPACE_PATTERN = /^\p{White_Space}|\p{White_Space}$/u
const REPEATED_WHITESPACE_PATTERN = /\p{White_Space}{2,}/u

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

export function normalizeDesiredMemberNickname(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") {
    throw new RangeError("Discord member nickname must be a string or null")
  }
  const length = [...value].length
  if (
    length < 1
    || length > DISCORD_LIMITS.guildNicknameCharacters
    || !validUnicode(value)
    || FORBIDDEN_NICKNAME_CODE_POINT_PATTERN.test(value)
    || EDGE_WHITESPACE_PATTERN.test(value)
    || REPEATED_WHITESPACE_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord member nickname must contain 1-${DISCORD_LIMITS.guildNicknameCharacters} Unicode characters without controls, formatting code points, surrounding whitespace, or repeated whitespace`,
    )
  }
  return value
}

export function projectMemberNickname(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > DISCORD_LIMITS.guildNicknameCharacters
    || !validUnicode(value)
    || INBOUND_NICKNAME_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError("Discord returned an invalid member nickname")
  }
  return value
}
