import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  PERMISSION_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import { ConfigurationError, DiscordApiError } from "./errors.js"
import { normalizeChannel } from "./normalize.js"
import {
  DISCORD_CHANNEL_PERMISSION_ACTIONS,
  DEFAULT_DISCORD_CHANNEL_PERMISSION_ACTIONS,
  DISCORD_PERMISSION_ACTIONS,
  DISCORD_PERMISSION_NAMES,
  evaluatePrincipalPermissions,
  type DiscordChannelPermissionAction,
  type DiscordPermissionAction,
  type DiscordPermissionName,
  type PrincipalPermissionResult,
  type PrincipalPermissionSubject,
  type PrincipalPermissionTarget,
  type PrivateThreadMembershipEvidence,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  normalizeDiscordRoleInventory,
  type NormalizedDiscordRole,
} from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

export const PRINCIPAL_PERMISSION_SUBJECT_KINDS = [
  "connector",
  "member",
  "role",
] as const

export type PrincipalPermissionSubjectKind =
  typeof PRINCIPAL_PERMISSION_SUBJECT_KINDS[number]

export interface ExplainPrincipalPermissionsRequest {
  action?: DiscordPermissionAction
  channelId?: string
  guildId: string
  requestedPermissions?: readonly DiscordPermissionName[]
  subjectId?: string
  subjectKind: PrincipalPermissionSubjectKind
  targetRoleId?: string
  targetUserId?: string
}

export interface ExplainPrincipalPermissionsResult {
  channel: ReturnType<typeof normalizeChannel> | null
  guildId: string
  permissions: PrincipalPermissionResult
  schemaVersion: number
  status: "ok"
  target: {
    id: string
    kind: "member" | "role"
  } | null
}

export interface AuditChannelRoleAccessRequest {
  actions?: readonly DiscordChannelPermissionAction[]
  afterRoleId?: string
  channelId: string
  limit?: number
}

export interface AuditChannelRoleAccessResult {
  channel: ReturnType<typeof normalizeChannel>
  confidence: "complete" | "partial"
  guildId: string
  memberOverwriteCount: number
  page: {
    hasMore: boolean
    nextCursor: string | null
    requestedLimit: number
    returned: number
    totalRoles: number
  }
  permissionSourceChannelId: string
  requestedActions: DiscordChannelPermissionAction[]
  roles: Array<{
    administrator: boolean
    decisions: Partial<Record<DiscordChannelPermissionAction, boolean | null>>
    id: string
    managed: boolean
    name: string
    position: number
  }>
  schemaVersion: number
  status: "ok"
  summary: Partial<Record<DiscordChannelPermissionAction, {
    allowed: number
    denied: number
    unknown: number
  }>>
  unknownPermissionBits: string
  warnings: string[]
}

export interface PermissionServiceOptions {
  client: Pick<
    DiscordClient,
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getThreadMember"
  >
  clock?: () => Date
  policy: ScopePolicy
}

interface PermissionChannelEvidence {
  channel: DiscordChannel
  guildId: string
  permissionChannel: DiscordChannel
}

const SUBJECT_KIND_SET: ReadonlySet<string> = new Set(
  PRINCIPAL_PERMISSION_SUBJECT_KINDS,
)
const ACTION_SET: ReadonlySet<string> = new Set(DISCORD_PERMISSION_ACTIONS)
const CHANNEL_ACTION_SET: ReadonlySet<string> = new Set(
  DISCORD_CHANNEL_PERMISSION_ACTIONS,
)
const PERMISSION_NAME_SET: ReadonlySet<string> = new Set(DISCORD_PERMISSION_NAMES)
const ROLE_TARGET_ACTION_SET: ReadonlySet<DiscordPermissionAction> = new Set([
  "assign-role",
  "remove-role",
])
const MEMBER_TARGET_ACTION_SET: ReadonlySet<DiscordPermissionAction> = new Set([
  "ban-member",
  "kick-member",
  "timeout-member",
])
const THREAD_TYPE_SET: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const KNOWN_CHANNEL_TYPE_SET: ReadonlySet<number> = new Set(
  Object.values(DISCORD_CHANNEL_TYPES),
)

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild & { owner_id: string } {
  if (!guild || typeof guild !== "object" || guild.id !== guildId) {
    throw new ConfigurationError("Discord returned a different guild for permission evaluation")
  }
  if (
    typeof guild.owner_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(guild.owner_id)
  ) {
    throw new ConfigurationError("Discord guild omitted valid owner identity evidence")
  }
  return guild as DiscordGuild & { owner_id: string }
}

function exactMember(
  member: DiscordGuildMember,
  guildId: string,
  userId: string,
  description: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || !member.user
    || member.user.id !== userId
  ) {
    throw new ConfigurationError(`Discord returned mismatched ${description} member evidence`)
  }
  const seen = new Set<string>()
  for (const roleId of member.roles) {
    if (typeof roleId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)) {
      throw new ConfigurationError(`Discord returned an invalid ${description} member role ID`)
    }
    if (seen.has(roleId)) {
      throw new ConfigurationError(`Discord returned a duplicate ${description} member role ID`)
    }
    if (roleId === guildId) {
      throw new ConfigurationError(`Discord returned an explicit @everyone ${description} member role`)
    }
    seen.add(roleId)
  }
  const timeout = member.communication_disabled_until
  if (timeout !== undefined && timeout !== null) {
    if (typeof timeout !== "string" || !Number.isFinite(Date.parse(timeout))) {
      throw new ConfigurationError(`Discord returned an invalid ${description} timeout timestamp`)
    }
  }
  return member
}

function exactThreadMember(
  member: DiscordThreadMember,
  threadId: string,
  userId: string,
): void {
  if (
    !member
    || typeof member !== "object"
    || member.id !== threadId
    || member.user_id !== userId
    || !Number.isSafeInteger(member.flags)
    || member.flags < 0
    || typeof member.join_timestamp !== "string"
    || !Number.isFinite(Date.parse(member.join_timestamp))
  ) {
    throw new ConfigurationError("Discord returned mismatched thread-member evidence")
  }
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
  description: string,
): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || channel.id !== channelId
    || !Number.isSafeInteger(channel.type)
    || !KNOWN_CHANNEL_TYPE_SET.has(channel.type)
    || (
      channel.guild_id !== undefined
      && (
        typeof channel.guild_id !== "string"
        || !DISCORD_SNOWFLAKE_PATTERN.test(channel.guild_id)
      )
    )
    || (
      channel.parent_id !== undefined
      && channel.parent_id !== null
      && (
        typeof channel.parent_id !== "string"
        || !DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
      )
    )
    || (
      channel.permission_overwrites !== undefined
      && !Array.isArray(channel.permission_overwrites)
    )
  ) {
    throw new ConfigurationError(`Discord returned invalid ${description} channel evidence`)
  }
  return channel
}

function exactRole(
  roles: readonly NormalizedDiscordRole[],
  roleId: string,
  description: string,
): NormalizedDiscordRole {
  const role = roles.find((candidate) => candidate.id === roleId)
  if (!role) {
    throw new ConfigurationError(`Discord ${description} role is absent from the guild inventory`)
  }
  return role
}

function normalizePermissionNames(
  values: readonly DiscordPermissionName[] | undefined,
): DiscordPermissionName[] {
  if (values === undefined) return []
  if (!Array.isArray(values)) {
    throw new RangeError("Discord requested permissions must be an array")
  }
  const seen = new Set<DiscordPermissionName>()
  for (const value of values as readonly unknown[]) {
    if (typeof value !== "string" || !PERMISSION_NAME_SET.has(value)) {
      throw new RangeError("Discord requested permissions contain an unknown name")
    }
    if (seen.has(value as DiscordPermissionName)) {
      throw new RangeError(`Discord permission ${value} is duplicated`)
    }
    seen.add(value as DiscordPermissionName)
  }
  return DISCORD_PERMISSION_NAMES.filter((name) => seen.has(name))
}

function normalizeExplainRequest(
  request: ExplainPrincipalPermissionsRequest,
): ExplainPrincipalPermissionsRequest & {
  requestedPermissions: DiscordPermissionName[]
} {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord principal permission request must be an object")
  }
  assertSnowflake(request.guildId, "Discord permission guild ID")
  if (!SUBJECT_KIND_SET.has(request.subjectKind)) {
    throw new RangeError("Discord permission subject kind is not supported")
  }
  if (request.subjectKind === "connector") {
    if (request.subjectId !== undefined) {
      throw new RangeError("Connector permission subjects do not accept subjectId")
    }
  } else {
    assertSnowflake(request.subjectId, "Discord permission subject ID")
  }
  if (request.channelId !== undefined) {
    assertSnowflake(request.channelId, "Discord permission channel ID")
  }
  if (request.action !== undefined && !ACTION_SET.has(request.action)) {
    throw new RangeError("Discord permission action is not supported")
  }
  const requestedPermissions = normalizePermissionNames(request.requestedPermissions)
  if (!request.action && requestedPermissions.length === 0) {
    throw new RangeError("Discord principal permission request needs an action or permission")
  }
  if (request.action && CHANNEL_ACTION_SET.has(request.action) && !request.channelId) {
    throw new RangeError(`Discord permission action ${request.action} requires channelId`)
  }
  if (
    request.action
    && (ROLE_TARGET_ACTION_SET.has(request.action) || MEMBER_TARGET_ACTION_SET.has(request.action))
    && request.channelId
  ) {
    throw new RangeError(`Discord permission action ${request.action} does not accept channelId`)
  }
  if (request.action && ROLE_TARGET_ACTION_SET.has(request.action)) {
    assertSnowflake(request.targetRoleId, "Discord permission target role ID")
    if (request.targetUserId !== undefined) {
      throw new RangeError(`Discord permission action ${request.action} does not accept targetUserId`)
    }
  } else if (request.action && MEMBER_TARGET_ACTION_SET.has(request.action)) {
    assertSnowflake(request.targetUserId, "Discord permission target user ID")
    if (request.targetRoleId !== undefined) {
      throw new RangeError(`Discord permission action ${request.action} does not accept targetRoleId`)
    }
  } else if (request.targetRoleId !== undefined || request.targetUserId !== undefined) {
    throw new RangeError("Permission targets are valid only for hierarchy actions")
  }
  if (
    request.action
    && (ROLE_TARGET_ACTION_SET.has(request.action) || MEMBER_TARGET_ACTION_SET.has(request.action))
    && request.subjectKind === "role"
  ) {
    throw new RangeError("Discord hierarchy actions require a connector or member subject")
  }
  return { ...request, requestedPermissions }
}

function normalizeAuditRequest(
  request: AuditChannelRoleAccessRequest,
): Required<Pick<AuditChannelRoleAccessRequest, "actions" | "channelId" | "limit">>
  & Pick<AuditChannelRoleAccessRequest, "afterRoleId"> {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord channel role audit request must be an object")
  }
  assertSnowflake(request.channelId, "Discord role audit channel ID")
  if (request.afterRoleId !== undefined) {
    assertSnowflake(request.afterRoleId, "Discord role audit cursor")
  }
  const actions = request.actions ?? DEFAULT_DISCORD_CHANNEL_PERMISSION_ACTIONS
  if (
    !Array.isArray(actions)
    || actions.length < 1
    || actions.length > PERMISSION_LIMITS.auditActions
  ) {
    throw new RangeError(
      `Discord role audit needs 1-${PERMISSION_LIMITS.auditActions} actions`,
    )
  }
  const seen = new Set<DiscordChannelPermissionAction>()
  for (const action of actions as readonly unknown[]) {
    if (typeof action !== "string" || !CHANNEL_ACTION_SET.has(action)) {
      throw new RangeError("Discord role audit contains an unsupported channel action")
    }
    if (seen.has(action as DiscordChannelPermissionAction)) {
      throw new RangeError(`Discord role audit action ${action} is duplicated`)
    }
    seen.add(action as DiscordChannelPermissionAction)
  }
  const limit = request.limit ?? PERMISSION_LIMITS.auditRolePageDefault
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > PERMISSION_LIMITS.auditRolePage
  ) {
    throw new RangeError(
      `Discord role audit limit must be an integer between 1 and ${PERMISSION_LIMITS.auditRolePage}`,
    )
  }
  return {
    ...(request.afterRoleId ? { afterRoleId: request.afterRoleId } : {}),
    actions: DISCORD_CHANNEL_PERMISSION_ACTIONS.filter((action) => seen.has(action)),
    channelId: request.channelId,
    limit,
  }
}

function normalizedGuildChannel(channel: DiscordChannel, guildId: string) {
  return normalizeChannel({
    ...channel,
    guild_id: channel.guild_id || guildId,
  })
}

export class PermissionService {
  readonly #client: PermissionServiceOptions["client"]
  readonly #clock: () => Date
  readonly #policy: ScopePolicy

  constructor(options: PermissionServiceOptions) {
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#policy = options.policy
  }

  async #channelEvidence(
    channelId: string,
    expectedGuildId: string | undefined,
    options: RequestOptions,
  ): Promise<PermissionChannelEvidence> {
    const channel = exactChannel(
      await this.#client.getChannel(channelId, options),
      channelId,
      "permission target",
    )
    const guildId = this.#policy.assertChannelReadable(channel)
    if (expectedGuildId && guildId !== expectedGuildId) {
      throw new ConfigurationError("Discord permission channel belongs to another guild")
    }
    let permissionChannel = channel
    if (THREAD_TYPE_SET.has(channel.type)) {
      if (!channel.parent_id) {
        throw new ConfigurationError("Discord permission thread omitted its parent channel ID")
      }
      permissionChannel = exactChannel(
        await this.#client.getChannel(channel.parent_id, options),
        channel.parent_id,
        "thread parent",
      )
      const parentGuildId = this.#policy.assertChannelReadable(permissionChannel)
      if (parentGuildId !== guildId || THREAD_TYPE_SET.has(permissionChannel.type)) {
        throw new ConfigurationError("Discord returned an invalid thread permission source")
      }
    }
    return { channel, guildId, permissionChannel }
  }

  async #privateThreadMembership(
    channel: DiscordChannel | undefined,
    subject: PrincipalPermissionSubject,
    options: RequestOptions,
  ): Promise<PrivateThreadMembershipEvidence | undefined> {
    if (channel?.type !== DISCORD_CHANNEL_TYPES.privateThread) return undefined
    if (subject.kind === "role" || subject.kind === "connector") {
      return subject.kind === "connector" ? "member" : "unknown"
    }
    try {
      const member = await this.#client.getThreadMember(channel.id, subject.id, options)
      exactThreadMember(member, channel.id, subject.id)
      return "member"
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) return "not-member"
      throw error
    }
  }

  async explain(
    connectorBotId: string,
    request: ExplainPrincipalPermissionsRequest,
    options: RequestOptions = {},
  ): Promise<ExplainPrincipalPermissionsResult> {
    assertSnowflake(connectorBotId, "Discord connector bot ID")
    const normalized = normalizeExplainRequest(request)
    this.#policy.assertGuildAllowed(normalized.guildId)
    const channelEvidencePromise = normalized.channelId
      ? this.#channelEvidence(normalized.channelId, normalized.guildId, options)
      : Promise.resolve(undefined)
    const subjectUserId = normalized.subjectKind === "connector"
      ? connectorBotId
      : normalized.subjectKind === "member" ? normalized.subjectId : undefined
    const targetUserId = normalized.targetUserId
    const subjectMemberPromise = subjectUserId
      ? this.#client.getGuildMember(normalized.guildId, subjectUserId, options)
      : Promise.resolve(undefined)
    const targetMemberPromise = targetUserId
      ? targetUserId === subjectUserId
        ? subjectMemberPromise
        : this.#client.getGuildMember(normalized.guildId, targetUserId, options)
      : Promise.resolve(undefined)
    const guildPromise = normalized.subjectKind === "role"
      ? Promise.resolve(undefined)
      : this.#client.getGuild(normalized.guildId, options)
    const [rawGuild, rawRoles, channelEvidence, rawSubjectMember, rawTargetMember] = await Promise.all([
      guildPromise,
      this.#client.getGuildRoles(normalized.guildId, options),
      channelEvidencePromise,
      subjectMemberPromise,
      targetMemberPromise,
    ])
    const guild = rawGuild ? exactGuild(rawGuild, normalized.guildId) : undefined
    const roles = normalizeDiscordRoleInventory(rawRoles, normalized.guildId)
    let subject: PrincipalPermissionSubject
    if (normalized.subjectKind === "role") {
      exactRole(roles, normalized.subjectId as string, "subject")
      subject = { id: normalized.subjectId as string, kind: "role" }
    } else {
      const subjectId = normalized.subjectKind === "connector"
        ? connectorBotId
        : normalized.subjectId as string
      subject = {
        id: subjectId,
        kind: normalized.subjectKind,
        member: exactMember(
          rawSubjectMember as DiscordGuildMember,
          normalized.guildId,
          subjectId,
          "subject",
        ),
      }
    }
    let target: PrincipalPermissionTarget | undefined
    if (normalized.targetRoleId) {
      exactRole(roles, normalized.targetRoleId, "target")
      target = { id: normalized.targetRoleId, kind: "role" }
    } else if (normalized.targetUserId) {
      target = {
        id: normalized.targetUserId,
        kind: "member",
        member: exactMember(
          rawTargetMember as DiscordGuildMember,
          normalized.guildId,
          normalized.targetUserId,
          "target",
        ),
      }
    }
    const privateThreadMembership = await this.#privateThreadMembership(
      channelEvidence?.channel,
      subject,
      options,
    )
    const permissions = evaluatePrincipalPermissions({
      ...(normalized.action ? { action: normalized.action } : {}),
      ...(channelEvidence
        ? {
          channel: channelEvidence.channel,
          permissionChannel: channelEvidence.permissionChannel,
        }
        : {}),
      guildId: normalized.guildId,
      guildOwnerId: guild?.owner_id ?? normalized.guildId,
      now: this.#clock(),
      ...(privateThreadMembership ? { privateThreadMembership } : {}),
      requestedPermissions: normalized.requestedPermissions,
      roles,
      subject,
      ...(target ? { target } : {}),
    })
    return {
      channel: channelEvidence
        ? normalizedGuildChannel(channelEvidence.channel, channelEvidence.guildId)
        : null,
      guildId: normalized.guildId,
      permissions,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      target: target ? { id: target.id, kind: target.kind } : null,
    }
  }

  async auditChannelRoles(
    request: AuditChannelRoleAccessRequest,
    options: RequestOptions = {},
  ): Promise<AuditChannelRoleAccessResult> {
    const normalized = normalizeAuditRequest(request)
    const channelEvidence = await this.#channelEvidence(
      normalized.channelId,
      undefined,
      options,
    )
    const rawRoles = await this.#client.getGuildRoles(channelEvidence.guildId, options)
    const roles = normalizeDiscordRoleInventory(rawRoles, channelEvidence.guildId)
    const now = this.#clock()
    let offset = 0
    if (normalized.afterRoleId) {
      const cursorIndex = roles.findIndex((role) => role.id === normalized.afterRoleId)
      if (cursorIndex < 0) {
        throw new RangeError("Discord role audit cursor is absent from the current role inventory")
      }
      offset = cursorIndex + 1
    }

    const evaluated = roles.map((role) => {
      const decisions: Partial<Record<DiscordChannelPermissionAction, boolean | null>> = {}
      const results: PrincipalPermissionResult[] = []
      for (const action of normalized.actions) {
        const result = evaluatePrincipalPermissions({
          action,
          channel: channelEvidence.channel,
          guildId: channelEvidence.guildId,
          guildOwnerId: channelEvidence.guildId,
          now,
          permissionChannel: channelEvidence.permissionChannel,
          privateThreadMembership: "unknown",
          roles,
          subject: { id: role.id, kind: "role" },
        })
        decisions[action] = result.allowed
        results.push(result)
      }
      return { decisions, results, role }
    })
    const summary: AuditChannelRoleAccessResult["summary"] = {}
    for (const action of normalized.actions) {
      const counts = { allowed: 0, denied: 0, unknown: 0 }
      for (const entry of evaluated) {
        const decision = entry.decisions[action]
        if (decision === true) counts.allowed += 1
        else if (decision === false) counts.denied += 1
        else counts.unknown += 1
      }
      summary[action] = counts
    }
    const pageEntries = evaluated.slice(offset, offset + normalized.limit)
    const hasMore = offset + pageEntries.length < evaluated.length
    const warnings = [...new Set(
      evaluated.flatMap(({ results }) => results.flatMap((result) => result.warnings)),
    )]
    const memberOverwriteCount = evaluated[0]?.results[0]?.memberOverwriteCount ?? 0
    const unknownPermissionBits = evaluated.reduce(
      (bits, entry) => entry.results.reduce(
        (actionBits, result) => actionBits | BigInt(result.unknownPermissionBits),
        bits,
      ),
      0n,
    )
    return {
      channel: normalizedGuildChannel(channelEvidence.channel, channelEvidence.guildId),
      confidence: evaluated.some(({ results }) => (
        results.some((result) => result.confidence === "partial")
      )) ? "partial" : "complete",
      guildId: channelEvidence.guildId,
      memberOverwriteCount,
      page: {
        hasMore,
        nextCursor: hasMore ? pageEntries.at(-1)?.role.id ?? null : null,
        requestedLimit: normalized.limit,
        returned: pageEntries.length,
        totalRoles: evaluated.length,
      },
      permissionSourceChannelId: channelEvidence.permissionChannel.id,
      requestedActions: [...normalized.actions],
      roles: pageEntries.map(({ decisions, results, role }) => ({
        administrator: results.some((result) => result.administrator),
        decisions,
        id: role.id,
        managed: role.managed,
        name: role.name,
        position: role.position,
      })),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      summary,
      unknownPermissionBits: unknownPermissionBits.toString(),
      warnings,
    }
  }
}
