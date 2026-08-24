import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import { GuildIncidentEvidenceError } from "./errors.js"

const INCIDENT_KEYS = [
  "dms_disabled_until",
  "dm_spam_detected_at",
  "invites_disabled_until",
  "raid_detected_at",
] as const
const MUTATION_INPUT_KEYS = [
  "directMessagesDisabledUntil",
  "invitesDisabledUntil",
] as const
const ISO_TIMESTAMP_PATTERN = /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})(?:\.[0-9]+)?(?<offset>Z|[+-](?<offsetHour>[0-9]{2}):(?<offsetMinute>[0-9]{2}))$/u

export interface DiscordGuildIncidentActions {
  directMessagesDisabledUntil: string | null
  dmSpamDetected: boolean
  invitesDisabledUntil: string | null
  raidDetected: boolean
  sourceAvailable: boolean
  unknownFieldCount: number
}

export interface DiscordGuildIncidentState extends DiscordGuildIncidentActions {
  guildId: string
  ownerId: string
}

export interface ModifyGuildIncidentActionsInput {
  directMessagesDisabledUntil?: string | null
  invitesDisabledUntil?: string | null
}

function evidenceError(options?: ErrorOptions): GuildIncidentEvidenceError {
  return new GuildIncidentEvidenceError(
    "Discord returned invalid guild incident-action evidence",
    options,
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

export function canonicalGuildIncidentTimestamp(
  value: unknown,
  description: string,
): string {
  const match = typeof value === "string" ? ISO_TIMESTAMP_PATTERN.exec(value) : null
  const parts = match?.groups
  if (!match || !parts) {
    throw new RangeError(`${description} must be an ISO 8601 timestamp with an offset`)
  }
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  const offsetHour = parts.offset === "Z" ? 0 : Number(parts.offsetHour)
  const offsetMinute = parts.offset === "Z" ? 0 : Number(parts.offsetMinute)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1] ?? 0
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) {
    throw new RangeError(`${description} must be an ISO 8601 timestamp with an offset`)
  }
  const parsed = Date.parse(value as string)
  if (Number.isNaN(parsed)) {
    throw new RangeError(`${description} must be an ISO 8601 timestamp with an offset`)
  }
  return new Date(parsed).toISOString()
}

function optionalIncidentTimestamp(
  value: unknown,
  description: string,
): string | null {
  if (value === null) return null
  try {
    return canonicalGuildIncidentTimestamp(value, description)
  } catch (error) {
    throw evidenceError({ cause: error })
  }
}

function optionalDetectionTimestamp(
  value: unknown,
  description: string,
): boolean {
  if (value === undefined || value === null) return false
  optionalIncidentTimestamp(value, description)
  return true
}

function projectIncidentObject(value: unknown): DiscordGuildIncidentActions {
  const input = record(value)
  if (
    !input
    || !Object.hasOwn(input, "dms_disabled_until")
    || !Object.hasOwn(input, "invites_disabled_until")
  ) {
    throw evidenceError()
  }
  return {
    directMessagesDisabledUntil: optionalIncidentTimestamp(
      input.dms_disabled_until,
      "Discord guild direct-message incident timestamp",
    ),
    dmSpamDetected: optionalDetectionTimestamp(
      input.dm_spam_detected_at,
      "Discord guild direct-message spam detection timestamp",
    ),
    invitesDisabledUntil: optionalIncidentTimestamp(
      input.invites_disabled_until,
      "Discord guild invite incident timestamp",
    ),
    raidDetected: optionalDetectionTimestamp(
      input.raid_detected_at,
      "Discord guild raid detection timestamp",
    ),
    sourceAvailable: true,
    unknownFieldCount: Object.keys(input)
      .filter((key) => !(INCIDENT_KEYS as readonly string[]).includes(key))
      .length,
  }
}

export function projectGuildIncidentState(
  value: unknown,
  expectedGuildId: string,
): DiscordGuildIncidentState {
  const input = record(value)
  if (
    !input
    || !positiveSnowflake(input.id)
    || input.id !== expectedGuildId
    || !positiveSnowflake(input.owner_id)
  ) {
    throw evidenceError()
  }
  if (!Object.hasOwn(input, "incidents_data")) {
    return {
      directMessagesDisabledUntil: null,
      dmSpamDetected: false,
      guildId: input.id,
      invitesDisabledUntil: null,
      ownerId: input.owner_id,
      raidDetected: false,
      sourceAvailable: false,
      unknownFieldCount: 0,
    }
  }
  const incidents = input.incidents_data === null
    ? {
        directMessagesDisabledUntil: null,
        dmSpamDetected: false,
        invitesDisabledUntil: null,
        raidDetected: false,
        sourceAvailable: true,
        unknownFieldCount: 0,
      } as const
    : projectIncidentObject(input.incidents_data)
  return {
    ...incidents,
    guildId: input.id,
    ownerId: input.owner_id,
  }
}

export function projectGuildIncidentMutationResponse(
  value: unknown,
): DiscordGuildIncidentActions {
  return projectIncidentObject(value)
}

export function normalizeModifyGuildIncidentActionsInput(
  value: ModifyGuildIncidentActionsInput,
): ModifyGuildIncidentActionsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord guild incident-action input must be an exact object")
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (
    keys.length < 1
    || keys.some((key) => !(MUTATION_INPUT_KEYS as readonly string[]).includes(key))
  ) {
    throw new RangeError("Discord guild incident-action input must contain supported fields only")
  }
  const normalized: ModifyGuildIncidentActionsInput = {}
  for (const field of MUTATION_INPUT_KEYS) {
    if (!Object.hasOwn(input, field)) continue
    const selected = input[field]
    normalized[field] = selected === null
      ? null
      : canonicalGuildIncidentTimestamp(
          selected,
          `Discord guild incident-action ${field}`,
        )
  }
  return normalized
}

export function guildIncidentActionsBody(
  input: ModifyGuildIncidentActionsInput,
): Record<string, unknown> {
  const normalized = normalizeModifyGuildIncidentActionsInput(input)
  return {
    ...(Object.hasOwn(normalized, "directMessagesDisabledUntil")
      ? { dms_disabled_until: normalized.directMessagesDisabledUntil }
      : {}),
    ...(Object.hasOwn(normalized, "invitesDisabledUntil")
      ? { invites_disabled_until: normalized.invitesDisabledUntil }
      : {}),
  }
}
