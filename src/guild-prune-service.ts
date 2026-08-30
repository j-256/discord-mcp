import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildPruneActivity,
  GuildPruneActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildPruneResponse,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildPruneEvidenceError,
  GuildPruneExecutionError,
  GuildPruneOperationConflictError,
  GuildPrunePlanChangedError,
  errorMessage,
} from "./errors.js"
import {
  operationKeyHash,
  type OperationReceipt,
  type OperationStore,
} from "./operation-store.js"
import {
  discordPermissionNames,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const REQUEST_KEYS = [
  "acknowledgeNonExactMemberSet",
  "auditReason",
  "days",
  "guildId",
  "includeRoleIds",
  "maximumEstimatedMemberCount",
  "operationKey",
] as const
const REQUIRED_PERMISSIONS = [
  "KICK_MEMBERS",
  "MANAGE_GUILD",
] as const satisfies readonly DiscordPermissionName[]
const PROTECTED_ROLE_PERMISSIONS = [
  "ADMINISTRATOR",
  "BAN_MEMBERS",
  "DEAFEN_MEMBERS",
  "KICK_MEMBERS",
  "MANAGE_CHANNELS",
  "MANAGE_EVENTS",
  "MANAGE_GUILD",
  "MANAGE_GUILD_EXPRESSIONS",
  "MANAGE_MESSAGES",
  "MANAGE_NICKNAMES",
  "MANAGE_ROLES",
  "MANAGE_THREADS",
  "MANAGE_WEBHOOKS",
  "MODERATE_MEMBERS",
  "MOVE_MEMBERS",
  "MUTE_MEMBERS",
  "VIEW_AUDIT_LOG",
] as const satisfies readonly DiscordPermissionName[]
const STATE_UNAVAILABLE = "guild-prune-state-unavailable"

export interface GuildPruneRequest {
  acknowledgeNonExactMemberSet: true
  auditReason: string
  days: number
  guildId: string
  includeRoleIds?: readonly string[]
  maximumEstimatedMemberCount: number
  operationKey: string
}

export interface NormalizedGuildPruneRequest {
  acknowledgeNonExactMemberSet: true
  auditReason: string
  days: number
  guildId: string
  includeRoleIds: string[]
  maximumEstimatedMemberCount: number
  operationKey: string
  operationKeyHash: string
}

export interface GuildPruneRolePlan {
  id: string
  managed: false
  permissionNames: DiscordPermissionName[]
  permissions: string
  position: number
  unknownPermissionBits: "0"
}

export interface GuildPruneProtectionPlan {
  membership: "absent" | "present"
  outsideCohortRoleIds: string[]
  protection: "guild-owner" | "not-in-guild" | "role-shield"
  sources: Array<"configured" | "connector" | "guild-owner">
  userId: string
}

export interface GuildPrunePlan {
  acknowledgeNonExactMemberSet: true
  applicationId: string
  auditReason: string
  botId: string
  cohort: {
    exactMemberIdsAvailable: false
    inactivity: "discord-defined"
    inactivityDays: number
    includedRoleRule: "every-assigned-role-is-included"
    rolelessMembersAlwaysIncluded: true
  }
  createdAt: string
  digest: string
  estimatedMemberCount: number
  estimatedRequests: {
    destructive: 1
    planningEvidence: number
    readback: 0
  }
  guildId: string
  includeRoleIds: string[]
  includeRoles: GuildPruneRolePlan[]
  maximumEstimatedMemberCount: number
  operationKeyHash: string
  permission: {
    appliedRoleIds: string[]
    botAdministrator: boolean
    botGuildOwner: boolean
    botHighestRoleIds: string[]
    botHighestRolePosition: number
    effectivePermissionNames: DiscordPermissionName[]
    effectivePermissions: string
    required: readonly ["KICK_MEMBERS", "MANAGE_GUILD"]
    unknownPermissionBits: string
  }
  policyMaximumMemberCount: number
  privacy: {
    exactCandidateMemberIds: "unavailable-from-discord"
    persistence: "content-free-counts-and-ids-only"
    profiles: "omitted"
    rawPayloadExposed: false
  }
  protections: GuildPruneProtectionPlan[]
  risks: string[]
  schemaVersion: number
  status: "planned"
  verificationBoundary: {
    automaticRetry: false
    countCeilingEnforcement: "pre-dispatch-only"
    destructiveRequests: 1
    exactMemberReadback: false
    outcomeEvidence: "strict-discord-response-count"
    rollback: "not-automatic"
  }
  warnings: string[]
  writeRequired: boolean
}

export interface GuildPruneResult {
  activityId: string | null
  actualPrunedCount: number
  guildId: string
  includeRoleIds: string[]
  operationKeyHash: string
  planDigest: string
  reviewedEstimatedMemberCount: number
  schemaVersion: number
  status: "completed" | "completed-with-drift" | "noop"
  verification: "drift" | "match" | "not-required"
}

export interface GuildPruneServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "beginGuildPrune"
    | "getGuild"
    | "getGuildMember"
    | "getGuildPruneCount"
    | "getGuildRoles"
  >
  clock?: () => Date
  maximumMemberCount: number
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  protectedUserIds: ReadonlySet<string>
  randomId?: () => string
}

interface GuildPruneState {
  botMember: DiscordGuildMember
  botPermissions: GuildMemberPermissionResult
  estimatedMemberCount: number
  guild: DiscordGuild
  includeRoles: DiscordRole[]
  protections: InternalProtection[]
  roles: DiscordRole[]
}

interface InternalProtection {
  member: DiscordGuildMember | undefined
  sources: GuildPruneProtectionPlan["sources"]
  userId: string
}

interface ClassifiedOutcome {
  actualPrunedCount: number | null
  error: string | null
  status: GuildPruneActivityStatus
  verification: "drift" | "match" | null
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

export function normalizeGuildPruneRequest(
  request: GuildPruneRequest,
): NormalizedGuildPruneRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild prune request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))
    || request.acknowledgeNonExactMemberSet !== true
    || typeof request.auditReason !== "string"
    || typeof request.guildId !== "string"
    || typeof request.operationKey !== "string"
    || !(request.includeRoleIds === undefined || Array.isArray(request.includeRoleIds))
  ) {
    throw new RangeError("Discord guild prune request is invalid")
  }
  if (!positiveSnowflake(request.guildId)) {
    throw new RangeError("Discord guild prune requires an exact guild snowflake")
  }
  if (
    !Number.isInteger(request.days)
    || request.days < DISCORD_LIMITS.guildPruneDaysMinimum
    || request.days > DISCORD_LIMITS.guildPruneDaysMaximum
  ) {
    throw new RangeError(
      `Discord guild prune days must be an integer between ${DISCORD_LIMITS.guildPruneDaysMinimum} and ${DISCORD_LIMITS.guildPruneDaysMaximum}`,
    )
  }
  const includeRoleIds = [...(request.includeRoleIds ?? [])]
  if (
    includeRoleIds.length > CONNECTOR_LIMITS.guildPruneIncludeRoles
    || includeRoleIds.some((roleId) => !positiveSnowflake(roleId))
    || new Set(includeRoleIds).size !== includeRoleIds.length
  ) {
    throw new RangeError(
      `Discord guild prune accepts at most ${CONNECTOR_LIMITS.guildPruneIncludeRoles} unique exact include-role snowflakes`,
    )
  }
  if (
    !Number.isInteger(request.maximumEstimatedMemberCount)
    || request.maximumEstimatedMemberCount < 1
    || request.maximumEstimatedMemberCount > CONNECTOR_LIMITS.guildPruneMaximumMembers
  ) {
    throw new RangeError(
      `Discord guild prune maximumEstimatedMemberCount must be an integer between 1 and ${CONNECTOR_LIMITS.guildPruneMaximumMembers}`,
    )
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    acknowledgeNonExactMemberSet: true,
    auditReason: request.auditReason,
    days: request.days,
    guildId: request.guildId,
    includeRoleIds: includeRoleIds.sort(compareSnowflakes),
    maximumEstimatedMemberCount: request.maximumEstimatedMemberCount,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

async function optionalMember(
  promise: Promise<DiscordGuildMember>,
): Promise<DiscordGuildMember | undefined> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return undefined
    throw error
  }
}

function exactMember(
  member: DiscordGuildMember,
  expectedUserId: string,
  description: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !member.user
    || member.user.id !== expectedUserId
    || !Array.isArray(member.roles)
    || member.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(member.roles).size !== member.roles.length
  ) {
    throw new GuildPruneEvidenceError(
      `Discord returned invalid or mismatched ${description} member evidence`,
    )
  }
  return member
}

function validateGuildRoles(value: DiscordRole[], guildId: string): DiscordRole[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new GuildPruneEvidenceError(
      "Discord returned an incomplete or excessive guild role inventory",
    )
  }
  const ids = new Set<string>()
  for (const role of value) {
    if (
      !role
      || typeof role !== "object"
      || !positiveSnowflake(role.id)
      || ids.has(role.id)
      || typeof role.managed !== "boolean"
      || typeof role.permissions !== "string"
      || !Number.isInteger(role.position)
      || role.position < 0
    ) {
      throw new GuildPruneEvidenceError("Discord returned invalid guild role evidence")
    }
    try {
      parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw new GuildPruneEvidenceError(
        `Discord returned invalid guild role permission evidence: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    ids.add(role.id)
  }
  if (!ids.has(guildId)) {
    throw new GuildPruneEvidenceError("Discord guild role inventory omitted the @everyone role")
  }
  return value
}

function evaluatePermissions(
  guildId: string,
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw new GuildPruneEvidenceError(
      `Discord connector permission evidence is invalid: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  if (!result.complete) {
    throw new GuildPruneEvidenceError(
      `Discord connector permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result
}

function protectedPermissions(role: DiscordRole): DiscordPermissionName[] {
  const names = new Set(discordPermissionNames(parseDiscordPermissionBits(role.permissions)))
  return PROTECTED_ROLE_PERMISSIONS.filter((permission) => names.has(permission))
}

function assertSafeCohortRole(
  role: DiscordRole,
  description: string,
): void {
  const bits = parseDiscordPermissionBits(role.permissions)
  const unknown = unknownDiscordPermissionBits(bits)
  const protectedNames = protectedPermissions(role)
  if (unknown !== 0n) {
    throw new GuildPruneEvidenceError(
      `Discord ${description} contains permission bits unknown to this build`,
    )
  }
  if (protectedNames.length > 0) {
    throw new GuildPruneEvidenceError(
      `Discord ${description} carries protected permissions: ${protectedNames.join(", ")}`,
    )
  }
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    permissions: role.permissions,
    position: role.position,
  })).sort((left, right) => compareSnowflakes(left.id, right.id))
}

function memberSnapshot(member: DiscordGuildMember | undefined) {
  if (!member) return null
  return {
    roles: [...member.roles].sort(compareSnowflakes),
    userId: member.user?.id ?? null,
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
  return normalized || "UnknownError"
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  outcome?: ClassifiedOutcome
  plan: GuildPrunePlan
  request: NormalizedGuildPruneRequest
  timestamp: string
}): GuildPruneActivity {
  return {
    actualPrunedCount: options.outcome?.actualPrunedCount ?? null,
    days: options.request.days,
    error: options.outcome?.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    includeRoleIds: [...options.request.includeRoleIds],
    kind: "guild-prune",
    maximumEstimatedMemberCount: options.request.maximumEstimatedMemberCount,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    policyMaximumMemberCount: options.plan.policyMaximumMemberCount,
    reviewedEstimatedMemberCount: options.plan.estimatedMemberCount,
    schemaVersion: SCHEMA_VERSION,
    status: options.outcome?.status ?? "pending",
    timestamp: options.timestamp,
    verification: options.outcome?.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: GuildPrunePlan
  request: NormalizedGuildPruneRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-prune",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.guildId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.status === "completed"
      ? options.verification ?? "match"
      : null,
  }
}

function classifyOutcome(
  reviewedCount: number,
  response: DiscordGuildPruneResponse | undefined,
  dispatchError: unknown,
): ClassifiedOutcome {
  if (response) {
    const match = response.pruned === reviewedCount
    return {
      actualPrunedCount: response.pruned,
      error: null,
      status: match ? "completed" : "completed-with-drift",
      verification: match ? "match" : "drift",
    }
  }
  const definiteClientRefusal = dispatchError instanceof DiscordApiError
    && dispatchError.status >= 400
    && dispatchError.status < 500
    && dispatchError.status !== 408
    && dispatchError.status !== 429
  return {
    actualPrunedCount: null,
    error: safeErrorCode(dispatchError),
    status: definiteClientRefusal ? "failed" : "uncertain",
    verification: null,
  }
}

export class GuildPruneService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildPruneServiceOptions["client"]
  readonly #clock: () => Date
  readonly #maximumMemberCount: number
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #protectedUserIds: ReadonlySet<string>
  readonly #randomId: () => string

  constructor(options: GuildPruneServiceOptions) {
    if (
      !Number.isInteger(options.maximumMemberCount)
      || options.maximumMemberCount < 1
      || options.maximumMemberCount > CONNECTOR_LIMITS.guildPruneMaximumMembers
    ) {
      throw new RangeError("Discord guild prune service maximum member count is invalid")
    }
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#maximumMemberCount = options.maximumMemberCount
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#protectedUserIds = options.protectedUserIds
    this.#randomId = options.randomId || randomUUID
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildPruneRequest,
    options: RequestOptions = {},
  ): Promise<GuildPrunePlan> {
    return this.#planNormalized(
      applicationId,
      botId,
      normalizeGuildPruneRequest(request),
      options,
    )
  }

  async #state(
    applicationId: string,
    botId: string,
    request: NormalizedGuildPruneRequest,
    options: RequestOptions,
  ): Promise<GuildPruneState> {
    if (!positiveSnowflake(applicationId) || !positiveSnowflake(botId)) {
      throw new RangeError(
        "Discord guild prune planning requires exact application and bot snowflakes",
      )
    }
    this.#policy.assertGuildPruneAuditAllowed(request.guildId, request.includeRoleIds)
    if (request.maximumEstimatedMemberCount > this.#maximumMemberCount) {
      throw new GuildPruneEvidenceError(
        `Discord guild prune request ceiling exceeds the configured ${this.#maximumMemberCount}-member ceiling`,
      )
    }
    const receipt = await this.#operationStore.get("guild-prune", request.operationKeyHash)
    if (receipt) throw new GuildPruneOperationConflictError(receiptView(receipt))

    const [guild, botMemberValue, roleValue] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
    ])
    if (guild.id !== request.guildId || !positiveSnowflake(guild.owner_id)) {
      throw new GuildPruneEvidenceError(
        "Discord returned incomplete or mismatched guild evidence",
      )
    }
    const botMember = exactMember(botMemberValue, botId, "connector bot")
    const roles = validateGuildRoles(roleValue, request.guildId)
    const rolesById = new Map(roles.map((role) => [role.id, role]))
    const botPermissions = evaluatePermissions(request.guildId, botMember, roles)
    const botGuildOwner = guild.owner_id === botId
    for (const permission of REQUIRED_PERMISSIONS) {
      if (!botGuildOwner && !hasGuildPermission(botPermissions, permission)) {
        throw new GuildPruneEvidenceError(
          `Discord connector bot lacks ${permission} for guild pruning`,
        )
      }
    }

    const everyone = rolesById.get(request.guildId) as DiscordRole
    assertSafeCohortRole(everyone, "@everyone role")
    const includeRoles = request.includeRoleIds.map((roleId) => {
      if (roleId === request.guildId) {
        throw new GuildPruneEvidenceError(
          "Discord guild prune cannot include the @everyone role explicitly",
        )
      }
      const role = rolesById.get(roleId)
      if (!role) {
        throw new GuildPruneEvidenceError(
          `Discord guild prune role inventory omitted include role ${roleId}`,
        )
      }
      if (role.managed) {
        throw new GuildPruneEvidenceError(
          `Discord guild prune include role ${roleId} is managed`,
        )
      }
      if (!botGuildOwner && role.position >= botPermissions.highestRolePosition) {
        throw new GuildPruneEvidenceError(
          `Discord guild prune include role ${roleId} is not below the connector's highest role`,
        )
      }
      assertSafeCohortRole(role, `guild prune include role ${roleId}`)
      return role
    })

    const includeRoleSet = new Set(request.includeRoleIds)
    const botOutsideRoles = botMember.roles.filter((roleId) => !includeRoleSet.has(roleId))
    if (botOutsideRoles.length === 0) {
      throw new GuildPruneEvidenceError(
        "Discord connector bot lacks an assigned role outside the prune cohort",
      )
    }
    const protections: InternalProtection[] = [{
      member: botMember,
      sources: ["connector"],
      userId: botId,
    }, {
      member: undefined,
      sources: ["guild-owner"],
      userId: guild.owner_id,
    }]
    const configuredIds = [...this.#protectedUserIds]
      .filter((userId) => userId !== botId && userId !== guild.owner_id)
      .sort(compareSnowflakes)
    for (let index = 0; index < configuredIds.length; index += 4) {
      const batch = configuredIds.slice(index, index + 4)
      const members = await Promise.all(batch.map(async (userId) => ({
        member: await optionalMember(
          this.#client.getGuildMember(request.guildId, userId, options),
        ),
        userId,
      })))
      for (const { member: memberValue, userId } of members) {
        const member = memberValue
          ? exactMember(memberValue, userId, `protected user ${userId}`)
          : undefined
        if (member) {
          for (const roleId of member.roles) {
            if (!rolesById.has(roleId)) {
              throw new GuildPruneEvidenceError(
                `Discord protected user ${userId} references unknown role ${roleId}`,
              )
            }
          }
          if (!member.roles.some((roleId) => !includeRoleSet.has(roleId))) {
            throw new GuildPruneEvidenceError(
              `Discord protected user ${userId} lacks an assigned role outside the prune cohort`,
            )
          }
        }
        protections.push({ member, sources: ["configured"], userId })
      }
    }
    const estimate = await this.#client.getGuildPruneCount(
      request.guildId,
      request.days,
      request.includeRoleIds,
      options,
    )
    if (!Number.isSafeInteger(estimate.pruned) || estimate.pruned < 0) {
      throw new GuildPruneEvidenceError("Discord returned invalid guild prune count evidence")
    }
    if (estimate.pruned > request.maximumEstimatedMemberCount) {
      throw new GuildPruneEvidenceError(
        `Discord guild prune estimate ${estimate.pruned} exceeds the request ceiling ${request.maximumEstimatedMemberCount}`,
      )
    }
    if (estimate.pruned > this.#maximumMemberCount) {
      throw new GuildPruneEvidenceError(
        `Discord guild prune estimate ${estimate.pruned} exceeds the configured ceiling ${this.#maximumMemberCount}`,
      )
    }
    return {
      botMember,
      botPermissions,
      estimatedMemberCount: estimate.pruned,
      guild,
      includeRoles,
      protections,
      roles,
    }
  }

  async #planNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedGuildPruneRequest,
    options: RequestOptions,
  ): Promise<GuildPrunePlan> {
    const state = await this.#state(applicationId, botId, request, options)
    const botGuildOwner = state.guild.owner_id === botId
    const unknownPermissionBits = unknownDiscordPermissionBits(
      BigInt(state.botPermissions.effectivePermissions),
    ).toString()
    const permission: GuildPrunePlan["permission"] = {
      appliedRoleIds: [...state.botPermissions.appliedRoleIds].sort(compareSnowflakes),
      botAdministrator: state.botPermissions.administrator,
      botGuildOwner,
      botHighestRoleIds: [...state.botPermissions.highestRoleIds].sort(compareSnowflakes),
      botHighestRolePosition: state.botPermissions.highestRolePosition,
      effectivePermissionNames: [...state.botPermissions.effectivePermissionNames],
      effectivePermissions: state.botPermissions.effectivePermissions,
      required: REQUIRED_PERMISSIONS,
      unknownPermissionBits,
    }
    const includeRoles = state.includeRoles.map((role): GuildPruneRolePlan => ({
      id: role.id,
      managed: false,
      permissionNames: discordPermissionNames(parseDiscordPermissionBits(role.permissions)),
      permissions: role.permissions,
      position: role.position,
      unknownPermissionBits: "0",
    }))
    const includeRoleSet = new Set(request.includeRoleIds)
    const protections = state.protections.map((protection): GuildPruneProtectionPlan => {
      if (protection.sources.includes("guild-owner")) {
        return {
          membership: "present",
          outsideCohortRoleIds: [],
          protection: "guild-owner",
          sources: protection.sources,
          userId: protection.userId,
        }
      }
      if (!protection.member) {
        return {
          membership: "absent",
          outsideCohortRoleIds: [],
          protection: "not-in-guild",
          sources: protection.sources,
          userId: protection.userId,
        }
      }
      return {
        membership: "present",
        outsideCohortRoleIds: protection.member.roles
          .filter((roleId) => !includeRoleSet.has(roleId))
          .sort(compareSnowflakes),
        protection: "role-shield",
        sources: protection.sources,
        userId: protection.userId,
      }
    }).sort((left, right) => compareSnowflakes(left.userId, right.userId))
    const cohort: GuildPrunePlan["cohort"] = {
      exactMemberIdsAvailable: false,
      inactivity: "discord-defined",
      inactivityDays: request.days,
      includedRoleRule: "every-assigned-role-is-included",
      rolelessMembersAlwaysIncluded: true,
    }
    const privacy: GuildPrunePlan["privacy"] = {
      exactCandidateMemberIds: "unavailable-from-discord",
      persistence: "content-free-counts-and-ids-only",
      profiles: "omitted",
      rawPayloadExposed: false,
    }
    const verificationBoundary: GuildPrunePlan["verificationBoundary"] = {
      automaticRetry: false,
      countCeilingEnforcement: "pre-dispatch-only",
      destructiveRequests: 1,
      exactMemberReadback: false,
      outcomeEvidence: "strict-discord-response-count",
      rollback: "not-automatic",
    }
    const risks = [
      `Discord identifies the ${state.estimatedMemberCount}-member estimated cohort without exposing any member IDs`,
      "Discord will irreversibly kick the eligible inactive cohort in one request",
      "External membership, activity, or role changes after the final estimate can change the actual count",
      "Discord does not enforce either reviewed count ceiling during the mutation",
      ...(request.includeRoleIds.length > 0
        ? ["Every selected include role widens the cohort beyond roleless members"]
        : []),
      "A transport-ambiguous outcome cannot be resolved through exact member readback",
    ]
    const warnings = [
      ...(state.botPermissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped KICK_MEMBERS and MANAGE_GUILD"]
        : []),
      ...(botGuildOwner
        ? ["Discord connector bot is the guild owner and bypasses ordinary role hierarchy"]
        : []),
      ...(unknownPermissionBits !== "0"
        ? [`Connector-bot permission evidence contains bits unknown to this build: ${unknownPermissionBits}`]
        : []),
      "The guild owner is protected by Discord ownership and hierarchy, not by candidate-member evidence",
      "The operation key is one-shot after dispatch and no automatic retry or rollback exists",
      "The response count is the only settled mutation evidence; exact removed-member identities remain unavailable",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      acknowledgeNonExactMemberSet: true,
      applicationId,
      auditReason: request.auditReason,
      botId,
      botMember: memberSnapshot(state.botMember),
      cohort,
      domain: "guildcontrol-guild-prune-plan.v1",
      estimatedMemberCount: state.estimatedMemberCount,
      guildId: request.guildId,
      guildOwnerId: state.guild.owner_id,
      includeRoleIds: request.includeRoleIds,
      maximumEstimatedMemberCount: request.maximumEstimatedMemberCount,
      operationKeyHash: request.operationKeyHash,
      permission,
      policyMaximumMemberCount: this.#maximumMemberCount,
      privacy,
      protections: state.protections.map((protection) => ({
        member: memberSnapshot(protection.member),
        sources: protection.sources,
        userId: protection.userId,
      })).sort((left, right) => compareSnowflakes(left.userId, right.userId)),
      risks,
      roles: roleSnapshot(state.roles),
      verificationBoundary,
      warnings,
    })
    return {
      acknowledgeNonExactMemberSet: true,
      applicationId,
      auditReason: request.auditReason,
      botId,
      cohort,
      createdAt: this.#clock().toISOString(),
      digest,
      estimatedMemberCount: state.estimatedMemberCount,
      estimatedRequests: {
        destructive: 1,
        planningEvidence: 4 + state.protections.filter((entry) => (
          entry.sources.includes("configured")
        )).length,
        readback: 0,
      },
      guildId: request.guildId,
      includeRoleIds: [...request.includeRoleIds],
      includeRoles,
      maximumEstimatedMemberCount: request.maximumEstimatedMemberCount,
      operationKeyHash: request.operationKeyHash,
      permission,
      policyMaximumMemberCount: this.#maximumMemberCount,
      privacy,
      protections,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      verificationBoundary,
      warnings,
      writeRequired: state.estimatedMemberCount > 0,
    }
  }

  async execute(
    applicationId: string,
    botId: string,
    requestValue: GuildPruneRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildPruneResult> {
    const request = normalizeGuildPruneRequest(requestValue)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild prune plan digest is invalid")
    }
    this.#policy.assertGuildPruneExecutionAllowed(request.guildId, request.includeRoleIds)
    let plan: GuildPrunePlan
    try {
      plan = await this.#planNormalized(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof GuildPruneEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildPrunePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new GuildPrunePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: request.guildId,
      includeRoleIds: [...request.includeRoleIds],
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      reviewedEstimatedMemberCount: plan.estimatedMemberCount,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        actualPrunedCount: 0,
        status: "noop",
        verification: "not-required",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new GuildPruneOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new GuildPruneExecutionError(
        "Discord guild prune was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let response: DiscordGuildPruneResponse | undefined
    let dispatchError: unknown
    try {
      response = await this.#client.beginGuildPrune(
        request.guildId,
        request.days,
        request.includeRoleIds,
        request.auditReason,
        options,
      )
    } catch (error) {
      dispatchError = error
    }
    const outcome = classifyOutcome(plan.estimatedMemberCount, response, dispatchError)
    const receiptStatus = ["completed", "completed-with-drift"].includes(outcome.status)
      ? "completed"
      : outcome.status === "uncertain"
        ? "uncertain"
        : "failed"
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        error: receiptStatus === "completed" ? null : outcome.error,
        plan,
        request,
        status: receiptStatus,
        timestamp: this.#clock().toISOString(),
        verification: receiptStatus === "completed" ? outcome.verification : null,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          outcome,
          plan,
          request,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildPruneExecutionError(
        "Discord guild prune finished but the operation receipt failed",
        {
          ...baseResult,
          ...outcome,
          activityId,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
        { cause: error },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        outcome,
        plan,
        request,
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      throw new GuildPruneExecutionError(
        "Discord guild prune finished but the final activity record failed",
        {
          ...baseResult,
          ...outcome,
          activityId,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }

    const result = {
      ...baseResult,
      activityId,
      actualPrunedCount: outcome.actualPrunedCount,
      status: outcome.status,
      verification: outcome.verification,
    }
    if (outcome.status === "completed" || outcome.status === "completed-with-drift") {
      return result as GuildPruneResult
    }
    throw new GuildPruneExecutionError(
      outcome.status === "uncertain"
        ? "Discord guild prune ended without a safely settled count outcome"
        : "Discord guild prune was refused before a settled success response",
      {
        ...result,
        retryAfterMs: dispatchError instanceof DiscordApiError
          ? dispatchError.retryAfterMs ?? null
          : null,
      },
      dispatchError === undefined ? undefined : { cause: dispatchError },
    )
  }
}
