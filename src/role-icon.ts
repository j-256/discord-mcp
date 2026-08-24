import { CONNECTOR_LIMITS } from "./constants.js"

const ROLE_ICON_EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u
const ROLE_ICON_EMOJI_CONTROL_OR_SPACE_PATTERN = /[\p{Control}\p{White_Space}]/u

export function isRoleIconUnicodeEmoji(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || value.normalize("NFC") !== value
    || ROLE_ICON_EMOJI_CONTROL_OR_SPACE_PATTERN.test(value)
    || !ROLE_ICON_EMOJI_PATTERN.test(value)
  ) return false
  try {
    encodeURIComponent(value)
  } catch {
    return false
  }
  return [
    ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value),
  ].length === 1
}

export function assertRoleIconUnicodeEmoji(
  value: unknown,
): asserts value is string {
  if (!isRoleIconUnicodeEmoji(value)) {
    throw new RangeError("Discord role icon Unicode emoji must be one NFC emoji grapheme")
  }
}
