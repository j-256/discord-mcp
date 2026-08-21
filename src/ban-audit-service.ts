import {
  BAN_AUDIT_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  GuildBanPageOptions,
} from "./discord-client.js"
import {
  BanAuditEvidenceError,
  DiscordApiError,
} from "./errors.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordBan,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const BAN_TEXT_CONTROL_PATTERN = /\p{Cc}/u

export interface BanAuditListOptions extends RequestOptions {
  afterUserId?: string
  includeReasons?: boolean
  limit?: number
}

export interface BanAuditGetOptions extends RequestOptions {
  includeReason?: boolean
}

export interface BanAuditRecord {
  bot: boolean
  globalName: string | null
  hasReason: boolean
  reason?: string | null
  userId: string
  username: string
}

export interface BanAuditClient {
  getGuild: DiscordClient["getGuild"]
  getGuildBan: DiscordClient["getGuildBan"]
  getGuildMember: DiscordClient["getGuildMember"]
  getGuildRoles: DiscordClient["getGuildRoles"]
  listGuildBans: DiscordClient["listGuildBans"]
}

export interface BanAuditServiceOptions {
  client: BanAuditClient
  policy: Pick<ScopePolicy, "assertBanAuditAllowed">
}

interface ValidatedBan {
  bot: boolean
  globalName: string | null
  reason: string | null
  userId: string
  username: string
}

export interface BanAuditAccess {
  banMembers: true
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  requiredPermission: "BAN_MEMBERS"
}

function evidenceError(message: string): BanAuditEvidenceError {
  return new BanAuditEvidenceError(message)
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, name: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

function assertBoolean(value: unknown, name: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new RangeError(`${name} must be a boolean`)
  }
}

export function assertBanAuditListInput(
  guildId: string,
  options: BanAuditListOptions,
): void {
  assertPositiveSnowflake(guildId, "Discord ban-audit guild ID")
  if (options.afterUserId !== undefined) {
    assertPositiveSnowflake(
      options.afterUserId,
      "Discord ban-audit after user ID",
    )
  }
  if (
    options.limit !== undefined
    && (
      !Number.isInteger(options.limit)
      || options.limit < 1
      || options.limit > BAN_AUDIT_LIMITS.listPage
    )
  ) {
    throw new RangeError(
      `Discord ban-audit limit must be an integer between 1 and ${BAN_AUDIT_LIMITS.listPage}`,
    )
  }
  assertBoolean(options.includeReasons, "Discord ban-audit includeReasons")
}

export function assertBanAuditGetInput(
  guildId: string,
  userId: string,
  options: BanAuditGetOptions,
): void {
  assertPositiveSnowflake(guildId, "Discord ban-audit guild ID")
  assertPositiveSnowflake(userId, "Discord ban-audit user ID")
  assertBoolean(options.includeReason, "Discord ban-audit includeReason")
}

function boundedUserText(value: unknown, nullable: boolean): string | null {
  if (nullable && (value === null || value === undefined)) return null
  if (typeof value !== "string") {
    throw evidenceError("Discord returned malformed ban-audit user text")
  }
  const length = [...value].length
  if (
    length < 1
    || length > BAN_AUDIT_LIMITS.userTextCharacters
    || BAN_TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw evidenceError("Discord returned malformed ban-audit user text")
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new BanAuditEvidenceError(
      "Discord returned invalid Unicode in ban-audit user text",
      { cause: error },
    )
  }
  return value
}

function validatedReason(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") {
    throw evidenceError("Discord returned a non-string guild ban reason")
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new BanAuditEvidenceError(
      "Discord returned invalid Unicode in a guild ban reason",
      { cause: error },
    )
  }
  const length = [...value].length
  if (length < 1 || length > BAN_AUDIT_LIMITS.reasonCharacters) {
    throw evidenceError("Discord returned a guild ban reason outside its documented bound")
  }
  return value
}

function validateBan(value: unknown): ValidatedBan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned a malformed guild ban")
  }
  const ban = value as DiscordBan
  if (
    !ban.user
    || typeof ban.user !== "object"
    || Array.isArray(ban.user)
    || !positiveSnowflake(ban.user.id)
    || (ban.user.bot !== undefined && typeof ban.user.bot !== "boolean")
  ) {
    throw evidenceError("Discord returned a malformed guild ban user")
  }
  return {
    bot: ban.user.bot === true,
    globalName: boundedUserText(ban.user.global_name, true),
    reason: validatedReason(ban.reason),
    userId: ban.user.id,
    username: boundedUserText(ban.user.username, false) as string,
  }
}

function projectBan(ban: ValidatedBan, includeReason: boolean): BanAuditRecord {
  return {
    bot: ban.bot,
    globalName: ban.globalName,
    hasReason: ban.reason !== null,
    ...(includeReason ? { reason: ban.reason } : {}),
    userId: ban.userId,
    username: ban.username,
  }
}

function privacy(includeReasons: boolean) {
  return {
    caches: "none" as const,
    persistence: "none" as const,
    profiles: "minimized" as const,
    rawPayloads: "omitted" as const,
    reasons: includeReasons ? "included" as const : "omitted" as const,
  }
}

function exactGuild(value: DiscordGuild, guildId: string): DiscordGuild & { owner_id: string } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !positiveSnowflake(value.owner_id)
  ) {
    throw evidenceError("Discord returned incomplete or mismatched ban-audit guild evidence")
  }
  return value as DiscordGuild & { owner_id: string }
}

function exactBotMember(
  value: DiscordGuildMember,
  guildId: string,
  botId: string,
): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw evidenceError("Discord returned incomplete or mismatched ban-audit bot evidence")
  }
  return value
}

function completePermissions(
  member: DiscordGuildMember,
  guildId: string,
  roles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  if (!Array.isArray(roles) || roles.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded ban-audit role inventory")
  }
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw new BanAuditEvidenceError(
      "Discord returned invalid ban-audit permission evidence",
      { cause: error },
    )
  }
  if (!result.complete) {
    throw evidenceError(
      `Discord ban-audit permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result
}

export class BanAuditService {
  readonly #client: BanAuditClient
  readonly #policy: Pick<ScopePolicy, "assertBanAuditAllowed">

  constructor(options: BanAuditServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async #access(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions,
  ): Promise<BanAuditAccess> {
    assertPositiveSnowflake(applicationId, "Discord ban-audit application ID")
    assertPositiveSnowflake(botId, "Discord ban-audit bot ID")
    assertPositiveSnowflake(guildId, "Discord ban-audit guild ID")
    this.#policy.assertBanAuditAllowed(guildId)
    const [rawGuild, rawBotMember, roles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawBotMember, guildId, botId)
    const permissions = completePermissions(botMember, guildId, roles)
    const botIsGuildOwner = guild.owner_id === botId
    if (!botIsGuildOwner && !hasGuildPermission(permissions, "BAN_MEMBERS")) {
      throw evidenceError("Discord connector bot lacks guild-level BAN_MEMBERS")
    }
    return {
      banMembers: true,
      botAdministrator: permissions.administrator,
      botIsGuildOwner,
      complete: true,
      requiredPermission: "BAN_MEMBERS",
    }
  }

  async list(
    applicationId: string,
    botId: string,
    guildId: string,
    options: BanAuditListOptions = {},
  ) {
    assertBanAuditListInput(guildId, options)
    const access = await this.#access(applicationId, botId, guildId, options)
    const limit = options.limit ?? BAN_AUDIT_LIMITS.listPageDefault
    const fetchLimit = limit + 1
    const clientOptions: GuildBanPageOptions = {
      ...(options.afterUserId ? { after: options.afterUserId } : {}),
      limit: fetchLimit,
      ...(options.signal ? { signal: options.signal } : {}),
    }
    const raw = await this.#client.listGuildBans(guildId, clientOptions)
    if (!Array.isArray(raw) || raw.length > fetchLimit) {
      throw evidenceError("Discord returned an oversized or malformed guild ban page")
    }
    const validated = raw.map(validateBan)
    let previous = options.afterUserId ? BigInt(options.afterUserId) : 0n
    for (const ban of validated) {
      const current = BigInt(ban.userId)
      if (current <= previous) {
        throw evidenceError("Discord returned duplicate, unordered, or cursor-violating guild bans")
      }
      previous = current
    }
    const returned = validated.slice(0, limit)
    const hasMore = validated.length > limit
    const includeReasons = options.includeReasons ?? false
    return {
      access,
      applicationId,
      bans: returned.map((ban) => projectBan(ban, includeReasons)),
      botId,
      guildId,
      page: {
        afterUserId: options.afterUserId ?? null,
        hasMore,
        nextAfterUserId: hasMore ? returned.at(-1)?.userId ?? null : null,
        requestedLimit: limit,
        returned: returned.length,
      },
      privacy: privacy(includeReasons),
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    userId: string,
    options: BanAuditGetOptions = {},
  ) {
    assertBanAuditGetInput(guildId, userId, options)
    const access = await this.#access(applicationId, botId, guildId, options)
    const includeReason = options.includeReason ?? false
    let raw: DiscordBan
    try {
      raw = await this.#client.getGuildBan(guildId, userId, options)
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        return {
          access,
          applicationId,
          botId,
          found: false as const,
          guildId,
          privacy: privacy(includeReason),
          schemaVersion: SCHEMA_VERSION,
          status: "not-found" as const,
          userId,
        }
      }
      throw error
    }
    const ban = validateBan(raw)
    if (ban.userId !== userId) {
      throw evidenceError("Discord returned a different guild ban than requested")
    }
    return {
      access,
      applicationId,
      ban: projectBan(ban, includeReason),
      botId,
      found: true as const,
      guildId,
      privacy: privacy(includeReason),
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
    }
  }
}
