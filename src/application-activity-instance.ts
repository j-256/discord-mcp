import {
  APPLICATION_ACTIVITY_INSTANCE_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import { ApplicationActivityInstanceEvidenceError } from "./errors.js"

export type DiscordApplicationActivityLocationKind = "gc" | "pc"

export interface DiscordApplicationActivityInstance {
  applicationId: string
  instanceId: string
  launchId: string
  location: {
    channelId: string
    guildId: string | null
    kind: DiscordApplicationActivityLocationKind
    unknownFieldCount: number
  }
  unknownFieldCount: number
  userIds: string[]
}

const CONTROL_OR_WHITESPACE_PATTERN = /[\s\p{Cc}]/u
const PATH_DELIMITER_PATTERN = /[\\/#?]/u
const KNOWN_INSTANCE_FIELDS = Object.freeze([
  "application_id",
  "instance_id",
  "launch_id",
  "location",
  "users",
] as const)
const KNOWN_LOCATION_FIELDS = Object.freeze([
  "channel_id",
  "guild_id",
  "id",
  "kind",
] as const)

function evidenceError(): ApplicationActivityInstanceEvidenceError {
  return new ApplicationActivityInstanceEvidenceError(
    "Discord returned invalid application Activity-instance evidence",
  )
}

function characterCount(value: string): number {
  return [...value].length
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function boundedRecord(
  value: unknown,
  maximumFields: number,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError()
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length > maximumFields) throw evidenceError()
  return record
}

function boundedOpaqueText(value: unknown, maximumCharacters: number): string {
  if (
    typeof value !== "string"
    || characterCount(value) < 1
    || characterCount(value) > maximumCharacters
    || CONTROL_OR_WHITESPACE_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError()
  return value
}

function unknownFieldCount(
  record: Readonly<Record<string, unknown>>,
  knownFields: readonly string[],
): number {
  return Object.keys(record).filter((key) => !knownFields.includes(key)).length
}

export function normalizeApplicationActivityInstanceId(value: unknown): string {
  if (
    typeof value !== "string"
    || characterCount(value) < 1
    || characterCount(value)
      > APPLICATION_ACTIVITY_INSTANCE_LIMITS.instanceIdCharacters
    || CONTROL_OR_WHITESPACE_PATTERN.test(value)
    || PATH_DELIMITER_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError(
      "Discord application Activity instance ID is empty, too long, or unsafe",
    )
  }
  return value
}

export function projectApplicationActivityInstance(
  value: unknown,
  expectedApplicationId: string,
  expectedInstanceId: string,
): DiscordApplicationActivityInstance {
  if (!positiveSnowflake(expectedApplicationId)) throw evidenceError()
  let normalizedInstanceId: string
  try {
    normalizedInstanceId = normalizeApplicationActivityInstanceId(expectedInstanceId)
  } catch {
    throw evidenceError()
  }
  const record = boundedRecord(
    value,
    APPLICATION_ACTIVITY_INSTANCE_LIMITS.responseFields,
  )
  if (
    !positiveSnowflake(record.application_id)
    || record.application_id !== expectedApplicationId
    || record.instance_id !== normalizedInstanceId
    || !positiveSnowflake(record.launch_id)
    || !Array.isArray(record.users)
    || record.users.length > APPLICATION_ACTIVITY_INSTANCE_LIMITS.participants
  ) throw evidenceError()

  const location = boundedRecord(
    record.location,
    APPLICATION_ACTIVITY_INSTANCE_LIMITS.locationFields,
  )
  boundedOpaqueText(
    location.id,
    APPLICATION_ACTIVITY_INSTANCE_LIMITS.locationIdCharacters,
  )
  if (
    (location.kind !== "gc" && location.kind !== "pc")
    || !positiveSnowflake(location.channel_id)
  ) throw evidenceError()
  const guildId = location.guild_id === undefined || location.guild_id === null
    ? null
    : positiveSnowflake(location.guild_id)
      ? location.guild_id
      : null
  if (
    (location.kind === "gc" && guildId === null)
    || (location.kind === "pc" && location.guild_id !== undefined && location.guild_id !== null)
  ) throw evidenceError()

  const userIds: string[] = []
  const uniqueUserIds = new Set<string>()
  for (const userId of record.users) {
    if (!positiveSnowflake(userId) || uniqueUserIds.has(userId)) throw evidenceError()
    uniqueUserIds.add(userId)
    userIds.push(userId)
  }

  return {
    applicationId: expectedApplicationId,
    instanceId: normalizedInstanceId,
    launchId: record.launch_id,
    location: {
      channelId: location.channel_id,
      guildId,
      kind: location.kind,
      unknownFieldCount: unknownFieldCount(location, KNOWN_LOCATION_FIELDS),
    },
    unknownFieldCount: unknownFieldCount(record, KNOWN_INSTANCE_FIELDS),
    userIds,
  }
}
