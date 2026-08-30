import { createHash, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  BulkGuildBanActivity,
  BulkGuildBanActivityStatus,
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
  type DiscordBulkGuildBanResponse,
  type DiscordClient,
} from "./discord-client.js"
import {
  BulkGuildBanEvidenceError,
  BulkGuildBanExecutionError,
  BulkGuildBanOperationConflictError,
  BulkGuildBanPlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
import {
  operationKeyHash,
  type OperationReceipt,
  type OperationStore,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
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
  DiscordBan,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  DiscordUser,
  RequestOptions,
} from "./types.js"

const REQUEST_KEYS = [
  "auditReason",
  "deleteMessageSeconds",
  "guildId",
  "operationKey",
  "userIds",
] as const
const REQUIRED_PERMISSIONS = [
  "BAN_MEMBERS",
  "MANAGE_GUILD",
] as const satisfies readonly DiscordPermissionName[]
const STATE_UNAVAILABLE = "bulk-guild-ban-state-unavailable"

export interface BulkGuildBanRequest {
  auditReason: string
  deleteMessageSeconds?: number
  guildId: string
  operationKey: string
  userIds: readonly string[]
}

export interface NormalizedBulkGuildBanRequest {
  auditReason: string
  deleteMessageSeconds: number
  guildId: string
  operationKey: string
  operationKeyHash: string
  targetSetDigest: string
  userIds: string[]
}

export interface BulkGuildBanTargetPlan {
  administrator: boolean | null
  banState: "not-banned"
  bot: boolean
  globalName: string | null
  highestRoleIds: string[]
  highestRolePosition: number | null
  id: string
  membership: "member" | "non-member"
  nickname: string | null
  roleIds: string[]
  username: string
}

export interface BulkGuildBanPlan {
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  deleteMessageSeconds: number
  digest: string
  estimatedRequests: {
    destructive: 1
    planningEvidence: number
    readback: number
  }
  guildId: string
  memberCount: number
  nonMemberCount: number
  operationKeyHash: string
  permission: {
    appliedRoleIds: string[]
    botAdministrator: boolean
    botGuildOwner: boolean
    botHighestRoleIds: string[]
    botHighestRolePosition: number
    effectivePermissionNames: DiscordPermissionName[]
    effectivePermissions: string
    required: readonly ["BAN_MEMBERS", "MANAGE_GUILD"]
    unknownPermissionBits: string
  }
  privacy: {
    persistence: "content-free-exact-id-outcomes-only"
    rawPayloadExposed: false
    transientUntrustedFields: readonly [
      "globalName",
      "nickname",
      "username",
    ]
  }
  risks: string[]
  schemaVersion: number
  status: "planned"
  targetCount: number
  targetSetDigest: string
  targets: BulkGuildBanTargetPlan[]
  verificationBoundary: {
    automaticRetry: false
    destructiveRequests: 1
    exactReadbackPerTarget: true
    partialSuccess: "explicit"
    rollback: "not-automatic"
    subsetRetry: "never-automatic"
  }
  warnings: string[]
}

export interface BulkGuildBanResult {
  activityId: string
  guildId: string
  observedBannedUserIds: string[]
  observedNotBannedUserIds: string[]
  operationKeyHash: string
  planDigest: string
  requestedUserIds: string[]
  responseBannedUserIds: string[]
  responseFailedUserIds: string[]
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  targetSetDigest: string
  verification: "drift" | "match"
}

export interface BulkGuildBanServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "bulkGuildBan"
    | "getGuild"
    | "getGuildBan"
    | "getGuildMember"
    | "getGuildRoles"
    | "getUser"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface BulkGuildBanState {
  botMember: DiscordGuildMember
  botPermissions: GuildMemberPermissionResult
  guild: DiscordGuild
  roles: DiscordRole[]
  targets: TargetState[]
}

interface TargetState {
  member: DiscordGuildMember | undefined
  permissions: GuildMemberPermissionResult | undefined
  user: DiscordUser
}

interface ReadbackState {
  bannedUserIds: string[]
  complete: boolean
  error: unknown
  notBannedUserIds: string[]
}

interface ClassifiedOutcome {
  error: string | null
  observedBannedUserIds: string[]
  observedNotBannedUserIds: string[]
  responseBannedUserIds: string[]
  responseFailedUserIds: string[]
  status: BulkGuildBanActivityStatus
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

function exactTargetSetDigest(userIds: readonly string[]): string {
  const hash = createHash("sha256")
  hash.update("guildcontrol-bulk-guild-ban-targets.v1\0")
  for (const userId of userIds) hash.update(userId).update("\0")
  return `sha256:${hash.digest("hex")}`
}

export function normalizeBulkGuildBanRequest(
  request: BulkGuildBanRequest,
): NormalizedBulkGuildBanRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord bulk guild ban request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))
    || typeof request.auditReason !== "string"
    || typeof request.guildId !== "string"
    || typeof request.operationKey !== "string"
    || !Array.isArray(request.userIds)
  ) {
    throw new RangeError("Discord bulk guild ban request is invalid")
  }
  if (!positiveSnowflake(request.guildId)) {
    throw new RangeError("Discord bulk guild ban requires an exact guild snowflake")
  }
  if (
    request.userIds.length < 2
    || request.userIds.length > DISCORD_LIMITS.bulkGuildBanUsers
    || request.userIds.some((userId) => !positiveSnowflake(userId))
    || new Set(request.userIds).size !== request.userIds.length
  ) {
    throw new RangeError(
      `Discord bulk guild ban requires 2-${DISCORD_LIMITS.bulkGuildBanUsers} unique exact user snowflakes`,
    )
  }
  const deleteMessageSeconds = request.deleteMessageSeconds ?? 0
  if (
    !Number.isInteger(deleteMessageSeconds)
    || deleteMessageSeconds < 0
    || deleteMessageSeconds > DISCORD_LIMITS.banDeleteMessageSeconds
  ) {
    throw new RangeError(
      `Discord bulk guild ban deleteMessageSeconds must be an integer between 0 and ${DISCORD_LIMITS.banDeleteMessageSeconds}`,
    )
  }
  encodeDiscordAuditReason(request.auditReason)
  const userIds = [...request.userIds].sort(compareSnowflakes)
  return {
    auditReason: request.auditReason,
    deleteMessageSeconds,
    guildId: request.guildId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    targetSetDigest: exactTargetSetDigest(userIds),
    userIds,
  }
}

async function optionalDiscordEntity<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return undefined
    throw error
  }
}

async function mapInBatches<T, U>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T) => Promise<U>,
): Promise<U[]> {
  const output: U[] = []
  for (let index = 0; index < values.length; index += concurrency) {
    const batch = values.slice(index, index + concurrency)
    const settled = await Promise.allSettled(batch.map(callback))
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (failure) throw failure.reason
    output.push(...settled.map((result) => (result as PromiseFulfilledResult<U>).value))
  }
  return output
}

function exactUser(
  user: DiscordUser | undefined,
  expectedUserId: string,
  description: string,
): DiscordUser {
  if (
    !user
    || user.id !== expectedUserId
    || typeof user.username !== "string"
    || user.username.length < 1
    || user.username.length > CONNECTOR_LIMITS.contentPreviewCharacters
    || !(user.global_name === undefined
      || user.global_name === null
      || (
        typeof user.global_name === "string"
        && user.global_name.length <= CONNECTOR_LIMITS.contentPreviewCharacters
      ))
    || !(user.bot === undefined || typeof user.bot === "boolean")
  ) {
    throw new BulkGuildBanEvidenceError(
      `Discord returned invalid or mismatched ${description} user evidence`,
    )
  }
  return user
}

function exactMember(
  member: DiscordGuildMember,
  expectedUserId: string,
  description: string,
): DiscordGuildMember {
  if (!member || typeof member !== "object" || Array.isArray(member)) {
    throw new BulkGuildBanEvidenceError(
      `Discord returned invalid ${description} member evidence`,
    )
  }
  exactUser(member.user, expectedUserId, description)
  if (
    !Array.isArray(member.roles)
    || member.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(member.roles).size !== member.roles.length
    || !(member.nick === undefined || member.nick === null || (
      typeof member.nick === "string"
      && member.nick.length <= CONNECTOR_LIMITS.contentPreviewCharacters
    ))
  ) {
    throw new BulkGuildBanEvidenceError(
      `Discord returned invalid ${description} member evidence`,
    )
  }
  return member
}

function exactBan(ban: DiscordBan, expectedUserId: string): DiscordBan {
  exactUser(ban.user, expectedUserId, "guild ban")
  return ban
}

function validateGuildRoles(value: DiscordRole[], guildId: string): DiscordRole[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new BulkGuildBanEvidenceError(
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
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(role.permissions)
      || !Number.isInteger(role.position)
      || role.position < 0
    ) {
      throw new BulkGuildBanEvidenceError("Discord returned invalid guild role evidence")
    }
    ids.add(role.id)
  }
  if (!ids.has(guildId)) {
    throw new BulkGuildBanEvidenceError(
      "Discord guild role inventory omitted the @everyone role",
    )
  }
  return value
}

function evaluatePermissions(
  guildId: string,
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
  description: string,
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw new BulkGuildBanEvidenceError(
      `Discord ${description} permission evidence is invalid: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  if (!result.complete) {
    throw new BulkGuildBanEvidenceError(
      `Discord ${description} permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
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
  plan: BulkGuildBanPlan
  request: NormalizedBulkGuildBanRequest
  status?: BulkGuildBanActivityStatus
  timestamp: string
}): BulkGuildBanActivity {
  const outcome = options.outcome
  return {
    deleteMessageSeconds: options.request.deleteMessageSeconds,
    error: outcome?.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "bulk-guild-ban",
    observedBannedUserIds: outcome?.observedBannedUserIds ?? [],
    observedNotBannedUserIds: outcome?.observedNotBannedUserIds ?? [],
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    requestedUserIds: [...options.request.userIds],
    responseBannedUserIds: outcome?.responseBannedUserIds ?? [],
    responseFailedUserIds: outcome?.responseFailedUserIds ?? [],
    schemaVersion: SCHEMA_VERSION,
    status: options.status ?? outcome?.status ?? "pending",
    timestamp: options.timestamp,
    verification: outcome?.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: BulkGuildBanPlan
  request: NormalizedBulkGuildBanRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "bulk-guild-ban",
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

function responseMatchesReadback(
  response: DiscordBulkGuildBanResponse,
  readback: ReadbackState,
): boolean {
  return JSON.stringify(response.bannedUserIds) === JSON.stringify(readback.bannedUserIds)
    && JSON.stringify(response.failedUserIds) === JSON.stringify(readback.notBannedUserIds)
}

function classifyOutcome(
  request: NormalizedBulkGuildBanRequest,
  response: DiscordBulkGuildBanResponse | undefined,
  dispatchError: unknown,
  readback: ReadbackState,
): ClassifiedOutcome {
  const common = {
    observedBannedUserIds: readback.bannedUserIds,
    observedNotBannedUserIds: readback.notBannedUserIds,
    responseBannedUserIds: response?.bannedUserIds ?? [],
    responseFailedUserIds: response?.failedUserIds ?? [],
  }
  if (!readback.complete) {
    return {
      ...common,
      error: safeErrorCode(readback.error ?? dispatchError),
      status: "uncertain",
      verification: null,
    }
  }
  const allBanned = readback.bannedUserIds.length === request.userIds.length
  const noneBanned = readback.bannedUserIds.length === 0
  if (response) {
    const matches = responseMatchesReadback(response, readback)
    if (matches && allBanned) {
      return { ...common, error: null, status: "completed", verification: "match" }
    }
    if (matches && noneBanned) {
      return {
        ...common,
        error: "BulkGuildBanFailed.response",
        status: "failed",
        verification: "match",
      }
    }
    if (matches) {
      return {
        ...common,
        error: "BulkGuildBanPartial.response",
        status: "partial",
        verification: "match",
      }
    }
    if (allBanned) {
      return {
        ...common,
        error: null,
        status: "completed-with-drift",
        verification: "drift",
      }
    }
    if (noneBanned) {
      return {
        ...common,
        error: "BulkGuildBanFailed.drift",
        status: "failed",
        verification: "drift",
      }
    }
    return {
      ...common,
      error: "BulkGuildBanPartial.drift",
      status: "partial-with-drift",
      verification: "drift",
    }
  }

  const definiteClientRefusal = dispatchError instanceof DiscordApiError
    && dispatchError.status >= 400
    && dispatchError.status < 500
    && dispatchError.status !== 408
    && dispatchError.status !== 429
  if (allBanned) {
    return {
      ...common,
      error: null,
      status: "completed-with-drift",
      verification: "drift",
    }
  }
  if (definiteClientRefusal && noneBanned) {
    return {
      ...common,
      error: safeErrorCode(dispatchError),
      status: "failed",
      verification: "match",
    }
  }
  if (definiteClientRefusal) {
    return {
      ...common,
      error: safeErrorCode(dispatchError),
      status: "partial-with-drift",
      verification: "drift",
    }
  }
  return {
    ...common,
    error: safeErrorCode(dispatchError),
    status: "uncertain",
    verification: null,
  }
}

export class BulkGuildBanService {
  readonly #activityStore: ActivityStore
  readonly #client: BulkGuildBanServiceOptions["client"]
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: BulkGuildBanServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async plan(
    applicationId: string,
    botId: string,
    request: BulkGuildBanRequest,
    options: RequestOptions = {},
  ): Promise<BulkGuildBanPlan> {
    return this.#planNormalized(
      applicationId,
      botId,
      normalizeBulkGuildBanRequest(request),
      options,
    )
  }

  async #state(
    applicationId: string,
    botId: string,
    request: NormalizedBulkGuildBanRequest,
    options: RequestOptions,
  ): Promise<BulkGuildBanState> {
    if (!positiveSnowflake(applicationId) || !positiveSnowflake(botId)) {
      throw new RangeError(
        "Discord bulk guild ban planning requires exact application and bot snowflakes",
      )
    }
    this.#policy.assertBulkBanAuditAllowed(request.guildId)
    const receipt = await this.#operationStore.get(
      "bulk-guild-ban",
      request.operationKeyHash,
    )
    if (receipt) throw new BulkGuildBanOperationConflictError(receiptView(receipt))

    const [guild, botMemberValue, roleValue] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
    ])
    if (
      guild.id !== request.guildId
      || !positiveSnowflake(guild.owner_id)
    ) {
      throw new BulkGuildBanEvidenceError(
        "Discord returned incomplete or mismatched guild evidence",
      )
    }
    const botMember = exactMember(botMemberValue, botId, "connector bot")
    const roles = validateGuildRoles(roleValue, request.guildId)
    const botPermissions = evaluatePermissions(
      request.guildId,
      botMember,
      roles,
      "connector bot",
    )
    const botGuildOwner = guild.owner_id === botId
    for (const permission of REQUIRED_PERMISSIONS) {
      if (!botGuildOwner && !hasGuildPermission(botPermissions, permission)) {
        throw new BulkGuildBanEvidenceError(
          `Discord connector bot lacks ${permission} for bulk guild bans`,
        )
      }
    }

    const targets = await mapInBatches(
      request.userIds,
      CONNECTOR_LIMITS.bulkGuildBanReadConcurrency,
      async (userId): Promise<TargetState> => {
        this.#policy.assertUserNotProtected(userId)
        if (userId === botId) {
          throw new BulkGuildBanEvidenceError(
            "The connector bot cannot be targeted by a bulk guild ban",
          )
        }
        if (userId === guild.owner_id) {
          throw new BulkGuildBanEvidenceError(
            "The Discord guild owner cannot be targeted by a bulk guild ban",
          )
        }
        const ban = await optionalDiscordEntity(
          this.#client.getGuildBan(request.guildId, userId, options),
        )
        if (ban) {
          exactBan(ban, userId)
          throw new BulkGuildBanEvidenceError(
            `Discord user ${userId} is already banned from the guild`,
          )
        }
        const member = await optionalDiscordEntity(
          this.#client.getGuildMember(request.guildId, userId, options),
        )
        const user = member
          ? exactUser(exactMember(member, userId, "target").user, userId, "target")
          : exactUser(
              await this.#client.getUser(userId, options),
              userId,
              "nonmember target",
            )
        if (user.bot === true) {
          throw new BulkGuildBanEvidenceError(
            `Discord bot user ${userId} cannot be targeted by a bulk guild ban`,
          )
        }
        const permissions = member
          ? evaluatePermissions(request.guildId, member, roles, `target ${userId}`)
          : undefined
        if (
          permissions
          && !botGuildOwner
          && botPermissions.highestRolePosition <= permissions.highestRolePosition
        ) {
          throw new BulkGuildBanEvidenceError(
            `Discord connector bot's highest role is not above target ${userId}`,
          )
        }
        return { member, permissions, user }
      },
    )
    return {
      botMember,
      botPermissions,
      guild,
      roles,
      targets,
    }
  }

  async #planNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedBulkGuildBanRequest,
    options: RequestOptions,
  ): Promise<BulkGuildBanPlan> {
    const state = await this.#state(applicationId, botId, request, options)
    const botGuildOwner = state.guild.owner_id === botId
    const unknownPermissionBits = unknownDiscordPermissionBits(
      BigInt(state.botPermissions.effectivePermissions),
    ).toString()
    const permission: BulkGuildBanPlan["permission"] = {
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
    const targets = state.targets.map((target, index): BulkGuildBanTargetPlan => ({
      administrator: target.permissions?.administrator ?? null,
      banState: "not-banned",
      bot: target.user.bot ?? false,
      globalName: target.user.global_name ?? null,
      highestRoleIds: target.permissions
        ? [...target.permissions.highestRoleIds].sort(compareSnowflakes)
        : [],
      highestRolePosition: target.permissions?.highestRolePosition ?? null,
      id: request.userIds[index] as string,
      membership: target.member ? "member" : "non-member",
      nickname: target.member?.nick ?? null,
      roleIds: target.member ? [...target.member.roles].sort(compareSnowflakes) : [],
      username: target.user.username,
    }))
    const memberCount = targets.filter((target) => target.membership === "member").length
    const nonMemberCount = targets.length - memberCount
    const privacy: BulkGuildBanPlan["privacy"] = {
      persistence: "content-free-exact-id-outcomes-only",
      rawPayloadExposed: false,
      transientUntrustedFields: ["globalName", "nickname", "username"],
    }
    const verificationBoundary: BulkGuildBanPlan["verificationBoundary"] = {
      automaticRetry: false,
      destructiveRequests: 1,
      exactReadbackPerTarget: true,
      partialSuccess: "explicit",
      rollback: "not-automatic",
      subsetRetry: "never-automatic",
    }
    const risks = [
      `Discord will attempt to ban all ${request.userIds.length} exact users in one irreversible batch request`,
      ...(request.deleteMessageSeconds > 0
        ? [`Discord may delete up to ${request.deleteMessageSeconds} seconds of recent message history for every successfully banned user`]
        : []),
      "Discord may return a mixed success response and successful targets are never rolled back",
      "An ambiguous dispatch or incomplete readback quarantines every exact target until operator review",
    ]
    const warnings = [
      ...(state.botPermissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped BAN_MEMBERS and MANAGE_GUILD"]
        : []),
      ...(botGuildOwner
        ? ["Discord connector bot is the guild owner and bypasses ordinary role hierarchy"]
        : []),
      ...(unknownPermissionBits !== "0"
        ? [`Connector-bot permission evidence contains bits unknown to this build: ${unknownPermissionBits}`]
        : []),
      "Username, global name, and nickname are transient untrusted Discord content",
      "The operation key is one-shot and every target remains spent after dispatch",
      "No failed subset is retried automatically; any later action needs fresh review and a new key",
      "External Discord administration remains a race between the response and exact readback",
    ]
    const stableTargets = state.targets.map((target, index) => ({
      bot: target.user.bot ?? false,
      id: request.userIds[index],
      member: memberSnapshot(target.member),
      permissions: target.permissions
        ? {
            administrator: target.permissions.administrator,
            effectivePermissions: target.permissions.effectivePermissions,
            highestRoleIds: [...target.permissions.highestRoleIds].sort(compareSnowflakes),
            highestRolePosition: target.permissions.highestRolePosition,
          }
        : null,
    }))
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      auditReason: request.auditReason,
      botId,
      botMember: memberSnapshot(state.botMember),
      deleteMessageSeconds: request.deleteMessageSeconds,
      domain: "guildcontrol-bulk-guild-ban-plan.v1",
      guildId: request.guildId,
      guildOwnerId: state.guild.owner_id,
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      risks,
      roles: roleSnapshot(state.roles),
      targetSetDigest: request.targetSetDigest,
      targets: stableTargets,
      verificationBoundary,
      warnings,
    })
    return {
      applicationId,
      auditReason: request.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      deleteMessageSeconds: request.deleteMessageSeconds,
      digest,
      estimatedRequests: {
        destructive: 1,
        planningEvidence: 3 + request.userIds.length * 2 + nonMemberCount,
        readback: request.userIds.length,
      },
      guildId: request.guildId,
      memberCount,
      nonMemberCount,
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      targetCount: request.userIds.length,
      targetSetDigest: request.targetSetDigest,
      targets,
      verificationBoundary,
      warnings,
    }
  }

  async #readback(
    request: NormalizedBulkGuildBanRequest,
    options: RequestOptions,
  ): Promise<ReadbackState> {
    const bannedUserIds: string[] = []
    const notBannedUserIds: string[] = []
    let firstError: unknown
    for (
      let index = 0;
      index < request.userIds.length;
      index += CONNECTOR_LIMITS.bulkGuildBanReadConcurrency
    ) {
      const batch = request.userIds.slice(
        index,
        index + CONNECTOR_LIMITS.bulkGuildBanReadConcurrency,
      )
      const settled = await Promise.allSettled(batch.map(async (userId) => {
        const ban = await optionalDiscordEntity(
          this.#client.getGuildBan(request.guildId, userId, options),
        )
        if (ban) exactBan(ban, userId)
        return { banned: Boolean(ban), userId }
      }))
      for (const result of settled) {
        if (result.status === "rejected") {
          firstError ??= result.reason
        } else if (result.value.banned) {
          bannedUserIds.push(result.value.userId)
        } else {
          notBannedUserIds.push(result.value.userId)
        }
      }
    }
    return {
      bannedUserIds: bannedUserIds.sort(compareSnowflakes),
      complete: firstError === undefined,
      error: firstError,
      notBannedUserIds: notBannedUserIds.sort(compareSnowflakes),
    }
  }

  async execute(
    applicationId: string,
    botId: string,
    requestValue: BulkGuildBanRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<BulkGuildBanResult> {
    const request = normalizeBulkGuildBanRequest(requestValue)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord bulk guild ban plan digest is invalid")
    }
    this.#policy.assertBulkBanExecutionAllowed(request.guildId)
    let plan: BulkGuildBanPlan
    try {
      plan = await this.#planNormalized(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof BulkGuildBanEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new BulkGuildBanPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new BulkGuildBanPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      requestedUserIds: [...request.userIds],
      schemaVersion: SCHEMA_VERSION,
      targetSetDigest: request.targetSetDigest,
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
      throw new BulkGuildBanOperationConflictError(receiptView(reservation.receipt))
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
      throw new BulkGuildBanExecutionError(
        "Discord bulk guild ban was blocked because pending activity could not be recorded",
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

    let response: DiscordBulkGuildBanResponse | undefined
    let dispatchError: unknown
    try {
      response = await this.#client.bulkGuildBan(
        request.guildId,
        request.userIds,
        request.deleteMessageSeconds,
        request.auditReason,
        options,
      )
    } catch (error) {
      dispatchError = error
    }
    const readback = await this.#readback(request, options)
    const outcome = classifyOutcome(request, response, dispatchError, readback)
    const receiptStatus = outcome.status === "completed"
      || outcome.status === "completed-with-drift"
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
      throw new BulkGuildBanExecutionError(
        "Discord bulk guild ban finished but the operation receipt failed",
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
      throw new BulkGuildBanExecutionError(
        "Discord bulk guild ban finished but the final activity record failed",
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
      observedBannedUserIds: outcome.observedBannedUserIds,
      observedNotBannedUserIds: outcome.observedNotBannedUserIds,
      responseBannedUserIds: outcome.responseBannedUserIds,
      responseFailedUserIds: outcome.responseFailedUserIds,
      status: outcome.status,
      verification: outcome.verification,
    }
    if (outcome.status === "completed" || outcome.status === "completed-with-drift") {
      return result as BulkGuildBanResult
    }
    throw new BulkGuildBanExecutionError(
      outcome.status === "uncertain"
        ? "Discord bulk guild ban ended without a safely settled outcome"
        : "Discord bulk guild ban did not ban every reviewed target",
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
