import {
  AUDIT_LOG_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  GuildAuditLogPageOptions,
} from "./discord-client.js"
import { DiscordAuditEvidenceError } from "./errors.js"
import type {
  RequestOptions,
} from "./types.js"

const DISCORD_EPOCH_MS = 1_420_070_400_000n
const AUDIT_LOG_KEY_PATTERN = /^(?:\$[A-Za-z]+|[A-Za-z][A-Za-z0-9_]*|[0-9]{1,20})$/

export const DISCORD_GUILD_AUDIT_ACTION_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: "GUILD_UPDATE",
  10: "CHANNEL_CREATE",
  11: "CHANNEL_UPDATE",
  12: "CHANNEL_DELETE",
  13: "CHANNEL_OVERWRITE_CREATE",
  14: "CHANNEL_OVERWRITE_UPDATE",
  15: "CHANNEL_OVERWRITE_DELETE",
  20: "MEMBER_KICK",
  21: "MEMBER_PRUNE",
  22: "MEMBER_BAN_ADD",
  23: "MEMBER_BAN_REMOVE",
  24: "MEMBER_UPDATE",
  25: "MEMBER_ROLE_UPDATE",
  26: "MEMBER_MOVE",
  27: "MEMBER_DISCONNECT",
  28: "BOT_ADD",
  30: "ROLE_CREATE",
  31: "ROLE_UPDATE",
  32: "ROLE_DELETE",
  40: "INVITE_CREATE",
  41: "INVITE_UPDATE",
  42: "INVITE_DELETE",
  50: "WEBHOOK_CREATE",
  51: "WEBHOOK_UPDATE",
  52: "WEBHOOK_DELETE",
  60: "EMOJI_CREATE",
  61: "EMOJI_UPDATE",
  62: "EMOJI_DELETE",
  72: "MESSAGE_DELETE",
  73: "MESSAGE_BULK_DELETE",
  74: "MESSAGE_PIN",
  75: "MESSAGE_UNPIN",
  80: "INTEGRATION_CREATE",
  81: "INTEGRATION_UPDATE",
  82: "INTEGRATION_DELETE",
  83: "STAGE_INSTANCE_CREATE",
  84: "STAGE_INSTANCE_UPDATE",
  85: "STAGE_INSTANCE_DELETE",
  90: "STICKER_CREATE",
  91: "STICKER_UPDATE",
  92: "STICKER_DELETE",
  100: "GUILD_SCHEDULED_EVENT_CREATE",
  101: "GUILD_SCHEDULED_EVENT_UPDATE",
  102: "GUILD_SCHEDULED_EVENT_DELETE",
  110: "THREAD_CREATE",
  111: "THREAD_UPDATE",
  112: "THREAD_DELETE",
  121: "APPLICATION_COMMAND_PERMISSION_UPDATE",
  130: "SOUNDBOARD_SOUND_CREATE",
  131: "SOUNDBOARD_SOUND_UPDATE",
  132: "SOUNDBOARD_SOUND_DELETE",
  140: "AUTO_MODERATION_RULE_CREATE",
  141: "AUTO_MODERATION_RULE_UPDATE",
  142: "AUTO_MODERATION_RULE_DELETE",
  143: "AUTO_MODERATION_BLOCK_MESSAGE",
  144: "AUTO_MODERATION_FLAG_TO_CHANNEL",
  145: "AUTO_MODERATION_USER_COMMUNICATION_DISABLED",
  146: "AUTO_MODERATION_QUARANTINE_USER",
  150: "CREATOR_MONETIZATION_REQUEST_CREATED",
  151: "CREATOR_MONETIZATION_TERMS_ACCEPTED",
  163: "ONBOARDING_PROMPT_CREATE",
  164: "ONBOARDING_PROMPT_UPDATE",
  165: "ONBOARDING_PROMPT_DELETE",
  166: "ONBOARDING_CREATE",
  167: "ONBOARDING_UPDATE",
  190: "GUILD_HOME_SETTINGS_CREATE",
  191: "GUILD_HOME_SETTINGS_UPDATE",
  192: "VOICE_CHANNEL_STATUS_CREATE",
  193: "VOICE_CHANNEL_STATUS_DELETE",
})

export interface GuildAuditLogClient {
  getGuildAuditLog: DiscordClient["getGuildAuditLog"]
}

export interface GuildAuditLogServiceOptions {
  client: GuildAuditLogClient
}

export interface ListGuildAuditEntriesOptions extends RequestOptions {
  actionType?: number
  actorUserId?: string
  beforeEntryId?: string
  includeReasons?: boolean
  limit?: number
}

export interface GetGuildAuditEntryOptions extends RequestOptions {
  includeReason?: boolean
}

interface ValidatedGuildAuditEntry {
  actionType: number
  actorUserId: string | null
  changeCount: number
  changeKeys: string[]
  id: string
  optionKeys: string[]
  reason: string | null
  redactedChangeKeyCount: number
  redactedOptionKeyCount: number
  targetId: string | null
  targetIdentifierRedacted: boolean
}

interface EvidenceRequirements {
  actionType?: number
  actorUserId?: string
  cursor?: string
  direction: "ascending" | "descending"
  maximumEntries: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isPositiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) > 0n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, name: string): asserts value is string {
  if (!isPositiveSnowflake(value)) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

function assertPositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
}

function assertBoolean(value: unknown, name: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new RangeError(`${name} must be a boolean`)
  }
}

function assertValidUnicode(value: string, name: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new DiscordAuditEvidenceError(`${name} contains invalid Unicode`, { cause: error })
  }
}

function structuralKeys(values: readonly string[]) {
  const safe = new Set<string>()
  for (const value of values) {
    if (
      value.length <= AUDIT_LOG_LIMITS.reflectedKeyCharacters
      && AUDIT_LOG_KEY_PATTERN.test(value)
    ) {
      safe.add(value)
    }
  }
  return {
    keys: [...safe].sort(),
    redacted: values.length - safe.size,
  }
}

function validatedChangeKeys(value: unknown) {
  if (value === undefined || value === null) {
    return { count: 0, keys: [] as string[], redacted: 0 }
  }
  if (!Array.isArray(value)) {
    throw new DiscordAuditEvidenceError("Discord guild audit changes are not an array")
  }
  if (value.length > AUDIT_LOG_LIMITS.changes) {
    throw new DiscordAuditEvidenceError("Discord guild audit changes exceed the evidence limit")
  }
  const keys = value.map((change, index) => {
    if (!isRecord(change) || typeof change.key !== "string") {
      throw new DiscordAuditEvidenceError(
        `Discord guild audit change ${index} has an invalid shape`,
      )
    }
    return change.key
  })
  const result = structuralKeys(keys)
  return { count: value.length, ...result }
}

function validatedOptionKeys(value: unknown) {
  if (value === undefined || value === null) {
    return { keys: [] as string[], redacted: 0 }
  }
  if (!isRecord(value)) {
    throw new DiscordAuditEvidenceError("Discord guild audit options are not an object")
  }
  const keys = Object.keys(value)
  if (keys.length > AUDIT_LOG_LIMITS.options) {
    throw new DiscordAuditEvidenceError("Discord guild audit options exceed the evidence limit")
  }
  return structuralKeys(keys)
}

function validatedReason(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") {
    throw new DiscordAuditEvidenceError("Discord guild audit reason is not a string")
  }
  assertValidUnicode(value, "Discord guild audit reason")
  const length = [...value].length
  if (length < 1 || length > AUDIT_LOG_LIMITS.reasonCharacters) {
    throw new DiscordAuditEvidenceError("Discord guild audit reason violates its documented limit")
  }
  return value
}

function validateEntry(value: unknown, index: number): ValidatedGuildAuditEntry {
  if (!isRecord(value)) {
    throw new DiscordAuditEvidenceError(`Discord guild audit entry ${index} is not an object`)
  }
  if (!isPositiveSnowflake(value.id)) {
    throw new DiscordAuditEvidenceError(`Discord guild audit entry ${index} has an invalid ID`)
  }
  if (!Number.isSafeInteger(value.action_type) || (value.action_type as number) < 1) {
    throw new DiscordAuditEvidenceError(
      `Discord guild audit entry ${value.id} has an invalid action type`,
    )
  }
  if (!("user_id" in value) || !(value.user_id === null || isPositiveSnowflake(value.user_id))) {
    throw new DiscordAuditEvidenceError(
      `Discord guild audit entry ${value.id} has an invalid actor user ID`,
    )
  }
  if (!("target_id" in value) || !(value.target_id === null || typeof value.target_id === "string")) {
    throw new DiscordAuditEvidenceError(
      `Discord guild audit entry ${value.id} has an invalid target identifier`,
    )
  }
  const reason = validatedReason(value.reason)
  const changes = validatedChangeKeys(value.changes)
  const options = validatedOptionKeys(value.options)
  const targetId = isPositiveSnowflake(value.target_id) ? value.target_id : null
  return {
    actionType: value.action_type as number,
    actorUserId: value.user_id as string | null,
    changeCount: changes.count,
    changeKeys: changes.keys,
    id: value.id,
    optionKeys: options.keys,
    reason,
    redactedChangeKeyCount: changes.redacted,
    redactedOptionKeyCount: options.redacted,
    targetId,
    targetIdentifierRedacted: value.target_id !== null && targetId === null,
  }
}

function validateEvidence(
  value: unknown,
  requirements: EvidenceRequirements,
): ValidatedGuildAuditEntry[] {
  if (!isRecord(value) || !Array.isArray(value.audit_log_entries)) {
    throw new DiscordAuditEvidenceError("Discord guild audit response has an invalid shape")
  }
  if (value.audit_log_entries.length > requirements.maximumEntries) {
    throw new DiscordAuditEvidenceError("Discord guild audit response exceeds the requested limit")
  }
  const entries = value.audit_log_entries.map(validateEntry)
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new DiscordAuditEvidenceError("Discord guild audit response repeats an entry ID")
    }
    seen.add(entry.id)
    if (requirements.actorUserId && entry.actorUserId !== requirements.actorUserId) {
      throw new DiscordAuditEvidenceError("Discord guild audit response violates the actor filter")
    }
    if (requirements.actionType && entry.actionType !== requirements.actionType) {
      throw new DiscordAuditEvidenceError("Discord guild audit response violates the action filter")
    }
    if (requirements.cursor) {
      const id = BigInt(entry.id)
      const cursor = BigInt(requirements.cursor)
      const withinCursor = requirements.direction === "descending"
        ? id < cursor
        : id > cursor
      if (!withinCursor) {
        throw new DiscordAuditEvidenceError("Discord guild audit response violates its cursor")
      }
    }
  }
  for (let index = 1; index < entries.length; index += 1) {
    const previous = BigInt(entries[index - 1]?.id as string)
    const current = BigInt(entries[index]?.id as string)
    const ordered = requirements.direction === "descending"
      ? previous > current
      : previous < current
    if (!ordered) {
      throw new DiscordAuditEvidenceError("Discord guild audit response has invalid ordering")
    }
  }
  return entries
}

function privacy(includeReasons: boolean) {
  return {
    changeValues: "omitted" as const,
    embeddedObjects: "omitted" as const,
    nonSnowflakeTargets: "redacted" as const,
    optionValues: "omitted" as const,
    persistence: "none" as const,
    reasons: includeReasons ? "included" as const : "omitted" as const,
  }
}

function projectedEntry(entry: ValidatedGuildAuditEntry, includeReason: boolean) {
  const createdAtMs = (BigInt(entry.id) >> 22n) + DISCORD_EPOCH_MS
  return {
    actionName: DISCORD_GUILD_AUDIT_ACTION_NAMES[entry.actionType] ?? null,
    actionType: entry.actionType,
    actorUserId: entry.actorUserId,
    changeCount: entry.changeCount,
    changeKeys: entry.changeKeys,
    createdAt: new Date(Number(createdAtMs)).toISOString(),
    hasReason: entry.reason !== null,
    id: entry.id,
    optionKeys: entry.optionKeys,
    redactedChangeKeyCount: entry.redactedChangeKeyCount,
    redactedOptionKeyCount: entry.redactedOptionKeyCount,
    targetId: entry.targetId,
    targetIdentifierRedacted: entry.targetIdentifierRedacted,
    ...(includeReason ? { reason: entry.reason } : {}),
  }
}

export class GuildAuditLogService {
  readonly #client: GuildAuditLogClient

  constructor(options: GuildAuditLogServiceOptions) {
    this.#client = options.client
  }

  async list(
    guildId: string,
    options: ListGuildAuditEntriesOptions = {},
  ) {
    assertPositiveSnowflake(guildId, "Discord guild audit-log guild ID")
    if (options.beforeEntryId !== undefined) {
      assertPositiveSnowflake(
        options.beforeEntryId,
        "Discord guild audit-log before entry ID",
      )
    }
    if (options.actorUserId !== undefined) {
      assertPositiveSnowflake(
        options.actorUserId,
        "Discord guild audit-log actor user ID",
      )
    }
    if (options.actionType !== undefined) {
      assertPositiveSafeInteger(
        options.actionType,
        "Discord guild audit-log action type",
      )
    }
    if (
      options.limit !== undefined
      && (
        !Number.isInteger(options.limit)
        || options.limit < 1
        || options.limit > AUDIT_LOG_LIMITS.entryPage
      )
    ) {
      throw new RangeError(
        `Discord guild audit-log limit must be an integer between 1 and ${AUDIT_LOG_LIMITS.entryPage}`,
      )
    }
    assertBoolean(options.includeReasons, "Discord guild audit-log includeReasons")
    const limit = options.limit ?? AUDIT_LOG_LIMITS.entryPageDefault
    const fetchLimit = limit + 1
    const clientOptions: GuildAuditLogPageOptions = {
      ...(options.actionType !== undefined ? { actionType: options.actionType } : {}),
      ...(options.actorUserId ? { actorUserId: options.actorUserId } : {}),
      ...(options.beforeEntryId ? { before: options.beforeEntryId } : {}),
      limit: fetchLimit,
      ...(options.signal ? { signal: options.signal } : {}),
    }
    const entries = validateEvidence(
      await this.#client.getGuildAuditLog(guildId, clientOptions),
      {
        ...(options.actionType !== undefined ? { actionType: options.actionType } : {}),
        ...(options.actorUserId ? { actorUserId: options.actorUserId } : {}),
        ...(options.beforeEntryId ? { cursor: options.beforeEntryId } : {}),
        direction: "descending",
        maximumEntries: fetchLimit,
      },
    )
    const returned = entries.slice(0, limit)
    const hasMore = entries.length > limit
    const includeReasons = options.includeReasons ?? false
    return {
      entries: returned.map((entry) => projectedEntry(entry, includeReasons)),
      guildId,
      page: {
        beforeEntryId: options.beforeEntryId ?? null,
        hasMore,
        nextBeforeEntryId: hasMore ? returned.at(-1)?.id ?? null : null,
        requestedLimit: limit,
        returned: returned.length,
      },
      privacy: privacy(includeReasons),
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }

  async get(
    guildId: string,
    entryId: string,
    options: GetGuildAuditEntryOptions = {},
  ) {
    assertPositiveSnowflake(guildId, "Discord guild audit-log guild ID")
    assertPositiveSnowflake(entryId, "Discord guild audit-log entry ID")
    assertBoolean(options.includeReason, "Discord guild audit-log includeReason")
    const includeReason = options.includeReason ?? false
    const after = (BigInt(entryId) - 1n).toString()
    const clientOptions: GuildAuditLogPageOptions = {
      after,
      limit: 1,
      ...(options.signal ? { signal: options.signal } : {}),
    }
    const entries = validateEvidence(
      await this.#client.getGuildAuditLog(guildId, clientOptions),
      {
        cursor: after,
        direction: "ascending",
        maximumEntries: 1,
      },
    )
    const entry = entries[0]
    if (!entry || entry.id !== entryId) {
      return {
        entryId,
        found: false as const,
        guildId,
        privacy: privacy(includeReason),
        schemaVersion: SCHEMA_VERSION,
        status: "not-found" as const,
      }
    }
    return {
      entry: projectedEntry(entry, includeReason),
      found: true as const,
      guildId,
      privacy: privacy(includeReason),
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }
}
