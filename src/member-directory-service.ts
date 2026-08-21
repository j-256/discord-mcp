import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_DIRECTORY_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordGuildMember,
  RequestOptions,
} from "./types.js"

const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const MEMBER_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u

export interface MemberDirectoryRecord {
  bot: boolean
  globalName: string | null
  joinedAt: string | null
  nickname: string | null
  pending: boolean | null
  roleIds: string[]
  timeoutUntil: string | null
  userId: string
  username: string
}

export interface MemberDirectoryListOptions extends RequestOptions {
  afterUserId?: string
  limit?: number
}

export interface MemberDirectorySearchOptions extends RequestOptions {
  limit?: number
  query: string
}

export interface MemberDirectoryClient {
  getGuildMember: DiscordClient["getGuildMember"]
  listGuildMembers: DiscordClient["listGuildMembers"]
  searchGuildMembers: DiscordClient["searchGuildMembers"]
}

export interface MemberDirectoryServiceOptions {
  client: MemberDirectoryClient
  policy: Pick<ScopePolicy, "assertMemberDirectoryAllowed">
}

function memberDirectoryEvidenceError(): ConfigurationError {
  return new ConfigurationError("Discord returned malformed member-directory evidence")
}

function positiveSnowflake(value: unknown): value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    return false
  }
  const numeric = BigInt(value)
  return numeric >= 1n && numeric <= DISCORD_SNOWFLAKE_MAX
}

function boundedMemberText(
  value: unknown,
  nullable: boolean,
): string | null {
  if (nullable && (value === null || value === undefined)) return null
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MEMBER_DIRECTORY_LIMITS.nameCharacters
    || MEMBER_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw memberDirectoryEvidenceError()
  }
  try {
    encodeURIComponent(value)
  } catch {
    throw memberDirectoryEvidenceError()
  }
  return value
}

function memberTimestamp(value: unknown, required: boolean): string | null {
  if (value === null || (!required && value === undefined)) return null
  if (
    typeof value !== "string"
    || !ISO_8601_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw memberDirectoryEvidenceError()
  }
  return value
}

function memberBoolean(value: unknown): boolean | null {
  if (value === undefined) return null
  if (typeof value !== "boolean") throw memberDirectoryEvidenceError()
  return value
}

function normalizeMember(raw: DiscordGuildMember): MemberDirectoryRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw memberDirectoryEvidenceError()
  }
  const user = raw.user
  if (
    !user
    || typeof user !== "object"
    || Array.isArray(user)
    || !positiveSnowflake(user.id)
    || (user.bot !== undefined && typeof user.bot !== "boolean")
    || !Array.isArray(raw.roles)
    || raw.roles.length > DISCORD_LIMITS.guildRoles
    || raw.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(raw.roles).size !== raw.roles.length
    || raw.joined_at === undefined
  ) {
    throw memberDirectoryEvidenceError()
  }
  return {
    bot: user.bot === true,
    globalName: boundedMemberText(user.global_name, true),
    joinedAt: memberTimestamp(raw.joined_at, true),
    nickname: boundedMemberText(raw.nick, true),
    pending: memberBoolean(raw.pending),
    roleIds: [...raw.roles].sort((left, right) => (
      BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
    )),
    timeoutUntil: memberTimestamp(raw.communication_disabled_until, false),
    userId: user.id,
    username: boundedMemberText(user.username, false) as string,
  }
}

function assertLimit(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`Member-directory limit must be an integer between 1 and ${maximum}`)
  }
}

function assertUniqueMembers(members: readonly MemberDirectoryRecord[]): void {
  if (new Set(members.map(({ userId }) => userId)).size !== members.length) {
    throw memberDirectoryEvidenceError()
  }
}

export function normalizeMemberDirectoryQuery(query: string): string {
  if (typeof query !== "string") {
    throw new RangeError("Member-directory query must be a string")
  }
  const normalized = query.trim()
  if (
    normalized.length < MEMBER_DIRECTORY_LIMITS.queryMinimumCharacters
    || normalized.length > MEMBER_DIRECTORY_LIMITS.queryCharacters
    || MEMBER_TEXT_CONTROL_PATTERN.test(normalized)
  ) {
    throw new RangeError(
      `Member-directory query must contain ${MEMBER_DIRECTORY_LIMITS.queryMinimumCharacters}-${MEMBER_DIRECTORY_LIMITS.queryCharacters} trimmed characters without controls`,
    )
  }
  try {
    encodeURIComponent(normalized)
  } catch {
    throw new RangeError("Member-directory query must contain valid Unicode")
  }
  return normalized
}

export class MemberDirectoryService {
  readonly #client: MemberDirectoryClient
  readonly #policy: Pick<ScopePolicy, "assertMemberDirectoryAllowed">

  constructor(options: MemberDirectoryServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async get(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ) {
    this.#policy.assertMemberDirectoryAllowed(guildId)
    const member = normalizeMember(
      await this.#client.getGuildMember(guildId, userId, options),
    )
    if (member.userId !== userId) throw memberDirectoryEvidenceError()
    return {
      guildId,
      member,
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }

  async list(
    guildId: string,
    options: MemberDirectoryListOptions = {},
  ) {
    this.#policy.assertMemberDirectoryAllowed(guildId)
    if (options.afterUserId !== undefined && !positiveSnowflake(options.afterUserId)) {
      throw new RangeError("Member-directory after cursor must be a positive Discord snowflake")
    }
    const limit = options.limit ?? MEMBER_DIRECTORY_LIMITS.listPageDefault
    assertLimit(limit, MEMBER_DIRECTORY_LIMITS.listPage)
    const raw = await this.#client.listGuildMembers(guildId, {
      ...(options.afterUserId ? { after: options.afterUserId } : {}),
      limit,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!Array.isArray(raw) || raw.length > limit) {
      throw memberDirectoryEvidenceError()
    }
    const members = raw.map(normalizeMember)
    assertUniqueMembers(members)
    let previous = options.afterUserId ? BigInt(options.afterUserId) : 0n
    for (const member of members) {
      const current = BigInt(member.userId)
      if (current <= previous) throw memberDirectoryEvidenceError()
      previous = current
    }
    return {
      guildId,
      members,
      page: {
        afterUserId: options.afterUserId ?? null,
        exhausted: members.length < limit,
        nextAfterUserId: members.length === limit
          ? members.at(-1)?.userId ?? null
          : null,
        requestedLimit: limit,
        returned: members.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }

  async search(
    guildId: string,
    options: MemberDirectorySearchOptions,
  ) {
    this.#policy.assertMemberDirectoryAllowed(guildId)
    const query = normalizeMemberDirectoryQuery(options.query)
    const limit = options.limit ?? MEMBER_DIRECTORY_LIMITS.searchPageDefault
    assertLimit(limit, MEMBER_DIRECTORY_LIMITS.searchPage)
    const raw = await this.#client.searchGuildMembers(guildId, {
      limit,
      query,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!Array.isArray(raw) || raw.length > limit) {
      throw memberDirectoryEvidenceError()
    }
    const members = raw.map(normalizeMember)
    assertUniqueMembers(members)
    return {
      guildId,
      match: "username-or-nickname-prefix" as const,
      members,
      page: {
        requestedLimit: limit,
        returned: members.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }
}
