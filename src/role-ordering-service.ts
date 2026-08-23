import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  RoleOrderingActivity,
  RoleOrderingActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildRoleMemberCounts,
} from "./discord-client.js"
import {
  DiscordApiError,
  RoleOrderingEvidenceError,
  RoleOrderingExecutionError,
  RoleOrderingOperationConflictError,
  RoleOrderingPlanChangedError,
} from "./errors.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  discordPermissionNames,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import {
  DiscordRoleEvidenceError,
  normalizeDiscordRoleInventory,
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
  type NormalizedDiscordRole,
} from "./role-administration-service.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "role-ordering-state-unavailable"
const GUILD_NAME_CHARACTERS = 100
const USERNAME_CHARACTERS = 32
const ROLE_ORDERING_LOCKS = new Map<string, Promise<RoleOrderingTargetOutcome>>()
const ROLE_ORDERING_UNCERTAIN_GUILDS = new Set<string>()
const HIERARCHY_SENSITIVE_PERMISSION_SET = new Set<DiscordPermissionName>([
  "ADMINISTRATOR",
  ...ROLE_CREATION_HIGH_RISK_PERMISSIONS,
])
const PRIVACY_OMISSIONS = Object.freeze([
  "auditReason",
  "memberIdentities",
  "rawOperationKey",
  "rawPayloads",
] as const)

type RoleOrderingTargetOutcome = "settled" | "uncertain"
export type RoleOrderPlacement = "above" | "below"

export interface RoleOrderingRequest {
  anchorRoleId: string
  auditReason: string
  guildId: string
  operationKey: string
  placement: RoleOrderPlacement
  roleId: string
}

export interface NormalizedRoleOrderingRequest extends RoleOrderingRequest {
  operationKeyHash: string
}

export interface RoleOrderEntry {
  heldByBot: boolean
  highRiskPermissionNames: DiscordPermissionName[]
  id: string
  managed: boolean
  management: NormalizedDiscordRole["management"]
  memberCount: number | null
  mentionable: boolean
  name: string
  permissionNames: DiscordPermissionName[]
  permissions: string
  rank: number
  rawPosition: number
  unknownFieldCount: number
  unknownPermissionBits: string
}

export interface RoleOrderingPermissionEvidence {
  administrator: boolean
  botEffectivePermissionNames: DiscordPermissionName[]
  botEffectivePermissions: string
  botHighestRank: number
  botHighestRoleIds: string[]
  confidence: "complete"
  guildManageRoles: boolean
}

export interface RoleOrderingPrivacyProjection {
  memberIdentitiesFetched: false
  omittedFields: typeof PRIVACY_OMISSIONS
  persistence: "content-free-only"
  roleText: "transient-untrusted"
}

export interface RoleOrderAuditResult {
  applicationId: string
  botId: string
  guild: {
    features: string[]
    id: string
    name: string
    ownerId: string
  }
  order: RoleOrderEntry[]
  permission: RoleOrderingPermissionEvidence
  privacy: RoleOrderingPrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface RoleOrderingAffectedRole extends Omit<RoleOrderEntry, "rank"> {
  afterRank: number
  beforeRank: number
}

export interface RoleOrderingPlan {
  affectedRoles: RoleOrderingAffectedRole[]
  anchor: RoleOrderEntry
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  current: {
    anchorRank: number
    roleRank: number
  }
  desired: {
    anchorRank: number
    roleRank: number
  }
  digest: string
  guild: RoleOrderAuditResult["guild"]
  impact: {
    affectedRoleCount: number
    aggregateHolderAssignments: number
    changedRoleCount: number
    holderCountsMayOverlap: true
    hierarchySensitiveRoleIds: string[]
  }
  operationKeyHash: string
  permission: RoleOrderingPermissionEvidence
  placement: RoleOrderPlacement
  privacy: RoleOrderingPrivacyProjection
  risks: string[]
  role: RoleOrderEntry
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
  writeRequired: boolean
}

export interface RoleOrderingResult {
  activityId: string | null
  anchorRoleId: string
  memberCountsMatched: boolean
  observedAffectedRoles: RoleOrderEntry[]
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  roleId: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
}

export interface RoleOrderingServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoleMemberCounts"
  | "getGuildRoles"
  | "modifyGuildRolePositions"
> {}

export interface RoleOrderingServiceOptions {
  activityStore: ActivityStore
  client: RoleOrderingServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    "assertRoleOrderingAuditable" | "assertRoleOrderingChangeable"
  >
  randomId?: () => string
}

interface ValidatedGuild extends DiscordGuild {
  features: string[]
  owner_id: string
}

interface RoleOrderingState {
  botMember: DiscordGuildMember
  counts: DiscordGuildRoleMemberCounts
  guild: ValidatedGuild
  order: RoleOrderEntry[]
  permission: RoleOrderingPermissionEvidence
  roles: NormalizedDiscordRole[]
}

interface BuiltRoleOrderingPlan {
  currentOrderIds: string[]
  desiredOrderIds: string[]
  expectedCounts: DiscordGuildRoleMemberCounts
  plan: RoleOrderingPlan
  request: NormalizedRoleOrderingRequest
  roles: NormalizedDiscordRole[]
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) throw new RangeError(`${description} must be an exact Discord snowflake`)
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function compareCanonicalLowToHigh(
  left: NormalizedDiscordRole,
  right: NormalizedDiscordRole,
): number {
  return left.position - right.position
    || compareSnowflakes(right.id, left.id)
}

function canonicalRoles(roles: readonly NormalizedDiscordRole[]): NormalizedDiscordRole[] {
  return [...roles].sort(compareCanonicalLowToHigh)
}

export function normalizeRoleOrderingRequest(
  request: RoleOrderingRequest,
): NormalizedRoleOrderingRequest {
  if (
    !request
    || typeof request !== "object"
    || Array.isArray(request)
    || !hasOnlyKeys(request as unknown as Record<string, unknown>, [
      "anchorRoleId",
      "auditReason",
      "guildId",
      "operationKey",
      "placement",
      "roleId",
    ])
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) throw new RangeError("Discord role-ordering request must be an exact object")
  assertSnowflake(request.guildId, "Discord role-ordering guild ID")
  assertSnowflake(request.roleId, "Discord role-ordering role ID")
  assertSnowflake(request.anchorRoleId, "Discord role-ordering anchor role ID")
  if (request.roleId === request.anchorRoleId) {
    throw new RangeError("Discord role-ordering target and anchor roles must be distinct")
  }
  if (request.placement !== "above" && request.placement !== "below") {
    throw new RangeError("Discord role-ordering placement must be above or below")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    ...request,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function evidenceError(message: string, cause?: unknown): RoleOrderingEvidenceError {
  return new RoleOrderingEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function exactGuild(value: DiscordGuild, guildId: string): ValidatedGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || typeof value.name !== "string"
    || value.name.length < 1
    || value.name.length > GUILD_NAME_CHARACTERS
    || /[\u0000-\u001F\u007F]/u.test(value.name)
    || !validUnicode(value.name)
    || typeof value.owner_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value.owner_id)
    || !Array.isArray(value.features)
    || value.features.length > DISCORD_LIMITS.guildFeatures
    || value.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || !/^[A-Z0-9_]+$/u.test(feature)
    ))
    || new Set(value.features).size !== value.features.length
  ) throw evidenceError("Discord returned invalid role-ordering guild evidence")
  return {
    ...value,
    features: [...value.features].sort(),
    owner_id: value.owner_id,
  }
}

function exactBotMember(
  value: DiscordGuildMember,
  botId: string,
  roles: readonly NormalizedDiscordRole[],
  guildId: string,
): DiscordGuildMember {
  const roleIds = new Set(roles.map((role) => role.id))
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
    || typeof value.user.username !== "string"
    || value.user.username.length < 1
    || value.user.username.length > USERNAME_CHARACTERS
    || /[\u0000-\u001F\u007F]/u.test(value.user.username)
    || !validUnicode(value.user.username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => (
      typeof roleId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)
      || !roleIds.has(roleId)
    ))
    || new Set(value.roles).size !== value.roles.length
  ) throw evidenceError("Discord returned invalid connector membership for role ordering")
  return {
    ...value,
    roles: [...value.roles].sort(compareSnowflakes),
    user: {
      bot: true,
      id: botId,
      username: value.user.username,
    },
  }
}

function exactCounts(
  value: DiscordGuildRoleMemberCounts,
  roles: readonly NormalizedDiscordRole[],
  guildId: string,
): DiscordGuildRoleMemberCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned invalid role-ordering member counts")
  }
  const expectedIds = roles
    .map((role) => role.id)
    .filter((roleId) => roleId !== guildId)
    .sort(compareSnowflakes)
  const actualIds = Object.keys(value).sort(compareSnowflakes)
  if (
    stableString(actualIds) !== stableString(expectedIds)
    || actualIds.some((roleId) => {
      const count = value[roleId]
      return !Number.isSafeInteger(count) || (count as number) < 0
    })
  ) throw evidenceError("Discord role-ordering member counts do not match the role inventory")
  const counts: Record<string, number> = {}
  for (const roleId of actualIds) counts[roleId] = value[roleId] as number
  return counts
}

function exactPermissions(
  guildId: string,
  member: DiscordGuildMember,
  rawRoles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  let permissions: GuildMemberPermissionResult
  try {
    permissions = evaluateGuildMemberPermissions({
      guildId,
      member,
      roles: rawRoles,
    })
  } catch (error) {
    throw evidenceError("Discord connector role-ordering permission evidence is invalid", error)
  }
  if (!permissions.complete) {
    throw evidenceError(
      `Discord connector role-ordering permission evidence is incomplete: ${permissions.warnings.join("; ")}`,
    )
  }
  return permissions
}

function roleSnapshot(role: NormalizedDiscordRole) {
  return {
    colors: role.colors,
    flags: role.flags,
    hoist: role.hoist,
    icon: role.icon,
    id: role.id,
    managed: role.managed,
    management: role.management,
    mentionable: role.mentionable,
    name: role.name,
    permissions: role.permissions,
    position: role.position,
    unicodeEmoji: role.unicodeEmoji,
    unknownFieldCount: role.unknownFieldCount,
    unknownPermissionBits: role.unknownPermissionBits,
  }
}

function roleMetadataSnapshot(role: NormalizedDiscordRole) {
  const { position: _position, ...snapshot } = roleSnapshot(role)
  return snapshot
}

function inventorySnapshot(roles: readonly NormalizedDiscordRole[]) {
  return [...roles]
    .sort((left, right) => compareSnowflakes(left.id, right.id))
    .map(roleSnapshot)
}

function inventoryMetadataSnapshot(roles: readonly NormalizedDiscordRole[]) {
  return [...roles]
    .sort((left, right) => compareSnowflakes(left.id, right.id))
    .map(roleMetadataSnapshot)
}

function memberSnapshot(member: DiscordGuildMember) {
  return {
    roles: [...member.roles].sort(compareSnowflakes),
    user: {
      bot: member.user?.bot,
      id: member.user?.id,
    },
  }
}

function privacyProjection(): RoleOrderingPrivacyProjection {
  return {
    memberIdentitiesFetched: false,
    omittedFields: PRIVACY_OMISSIONS,
    persistence: "content-free-only",
    roleText: "transient-untrusted",
  }
}

function permissionEvidence(
  permissions: GuildMemberPermissionResult,
  order: readonly NormalizedDiscordRole[],
  member: DiscordGuildMember,
): RoleOrderingPermissionEvidence {
  const ranks = new Map(order.map((role, rank) => [role.id, rank]))
  const held = member.roles
    .map((roleId) => ({ id: roleId, rank: ranks.get(roleId) }))
    .filter((entry): entry is { id: string; rank: number } => entry.rank !== undefined)
  const botHighestRank = held.reduce((highest, entry) => Math.max(highest, entry.rank), 0)
  const botHighestRoleIds = held
    .filter((entry) => entry.rank === botHighestRank)
    .map((entry) => entry.id)
    .sort(compareSnowflakes)
  return {
    administrator: permissions.administrator,
    botEffectivePermissionNames: discordPermissionNames(BigInt(permissions.effectivePermissions)),
    botEffectivePermissions: permissions.effectivePermissions,
    botHighestRank,
    botHighestRoleIds,
    confidence: "complete",
    guildManageRoles: hasGuildPermission(permissions, "MANAGE_ROLES"),
  }
}

function roleEntry(
  role: NormalizedDiscordRole,
  rank: number,
  counts: DiscordGuildRoleMemberCounts,
  member: DiscordGuildMember,
  guildId: string,
): RoleOrderEntry {
  const heldByBot = member.roles.includes(role.id)
  return {
    heldByBot,
    highRiskPermissionNames: role.permissionNames.filter((permission) => (
      HIERARCHY_SENSITIVE_PERMISSION_SET.has(permission)
    )),
    id: role.id,
    managed: role.managed,
    management: role.management,
    memberCount: role.id === guildId ? null : counts[role.id] as number,
    mentionable: role.mentionable,
    name: role.name,
    permissionNames: role.permissionNames,
    permissions: role.permissions,
    rank,
    rawPosition: role.position,
    unknownFieldCount: role.unknownFieldCount,
    unknownPermissionBits: role.unknownPermissionBits,
  }
}

function projectOrder(
  roles: readonly NormalizedDiscordRole[],
  counts: DiscordGuildRoleMemberCounts,
  member: DiscordGuildMember,
  guildId: string,
): RoleOrderEntry[] {
  return canonicalRoles(roles).map((role, rank) => (
    roleEntry(role, rank, counts, member, guildId)
  ))
}

function desiredOrder(
  order: readonly RoleOrderEntry[],
  request: NormalizedRoleOrderingRequest,
): RoleOrderEntry[] {
  const remaining = order.filter((entry) => entry.id !== request.roleId)
  const anchorIndex = remaining.findIndex((entry) => entry.id === request.anchorRoleId)
  if (anchorIndex < 0) throw evidenceError("Discord role-ordering anchor is missing")
  const target = order.find((entry) => entry.id === request.roleId)
  if (!target) throw evidenceError("Discord role-ordering target is missing")
  const insertionIndex = request.placement === "above" ? anchorIndex + 1 : anchorIndex
  return [
    ...remaining.slice(0, insertionIndex),
    target,
    ...remaining.slice(insertionIndex),
  ]
}

function affectedRoleIds(
  order: readonly RoleOrderEntry[],
  request: NormalizedRoleOrderingRequest,
): string[] {
  const targetRank = order.findIndex((role) => role.id === request.roleId)
  const anchorRank = order.findIndex((role) => role.id === request.anchorRoleId)
  if (targetRank < 0 || anchorRank < 0) {
    throw evidenceError("Discord role-ordering target or anchor is missing")
  }
  return order
    .slice(Math.min(targetRank, anchorRank), Math.max(targetRank, anchorRank) + 1)
    .map((role) => role.id)
}

function affectedRoles(
  current: readonly RoleOrderEntry[],
  desired: readonly RoleOrderEntry[],
  ids: readonly string[],
): RoleOrderingAffectedRole[] {
  const currentRanks = new Map(current.map((role) => [role.id, role.rank]))
  const desiredRanks = new Map(desired.map((role, rank) => [role.id, rank]))
  const byId = new Map(current.map((role) => [role.id, role]))
  return ids.map((roleId) => {
    const role = byId.get(roleId)
    const beforeRank = currentRanks.get(roleId)
    const afterRank = desiredRanks.get(roleId)
    if (!role || beforeRank === undefined || afterRank === undefined) {
      throw evidenceError("Discord role-ordering affected segment is incomplete")
    }
    const { rank: _rank, ...entry } = role
    return {
      ...entry,
      afterRank,
      beforeRank,
    }
  }).sort((left, right) => right.beforeRank - left.beforeRank)
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
  return normalized || "UnknownError"
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: RoleOrderingPlan
  request: NormalizedRoleOrderingRequest
  status: RoleOrderingActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): RoleOrderingActivity {
  return {
    anchorRoleId: options.request.anchorRoleId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "role-ordering",
    operationKeyHash: options.request.operationKeyHash,
    placement: options.request.placement,
    planDigest: options.plan.digest,
    roleId: options.request.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: RoleOrderingPlan
  request: NormalizedRoleOrderingRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "role-ordering",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" || options.status === "uncertain"
      ? options.request.roleId
      : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    roleId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof RoleOrderingExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => RoleOrderingExecutionError,
): Promise<T> {
  const prior = ROLE_ORDERING_LOCKS.get(guildId) ?? Promise.resolve(
    ROLE_ORDERING_UNCERTAIN_GUILDS.has(guildId)
      ? "uncertain" as const
      : "settled" as const,
  )
  let release: (outcome: RoleOrderingTargetOutcome) => void = () => undefined
  const tail = new Promise<RoleOrderingTargetOutcome>((resolve) => {
    release = resolve
  })
  ROLE_ORDERING_LOCKS.set(guildId, tail)
  let outcome: RoleOrderingTargetOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (uncertainExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    if (outcome === "uncertain") ROLE_ORDERING_UNCERTAIN_GUILDS.add(guildId)
    release(outcome)
    if (ROLE_ORDERING_LOCKS.get(guildId) === tail) ROLE_ORDERING_LOCKS.delete(guildId)
  }
}

export class RoleOrderingService {
  readonly #activityStore: ActivityStore
  readonly #client: RoleOrderingServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: RoleOrderingServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: RoleOrderingServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async #state(
    botId: string,
    guildId: string,
    options: RequestOptions,
  ): Promise<RoleOrderingState> {
    const [guildValue, memberValue, rawRoles, countsValue] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildRoleMemberCounts(guildId, options),
    ])
    const guild = exactGuild(guildValue, guildId)
    let roles: NormalizedDiscordRole[]
    try {
      roles = normalizeDiscordRoleInventory(rawRoles, guildId)
    } catch (error) {
      throw evidenceError("Discord returned invalid role-ordering inventory evidence", error)
    }
    const botMember = exactBotMember(memberValue, botId, roles, guildId)
    const counts = exactCounts(countsValue, roles, guildId)
    const canonical = canonicalRoles(roles)
    const evaluated = exactPermissions(guildId, botMember, rawRoles)
    const permission = permissionEvidence(evaluated, canonical, botMember)
    return {
      botMember,
      counts,
      guild,
      order: projectOrder(roles, counts, botMember, guildId),
      permission,
      roles,
    }
  }

  async audit(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<RoleOrderAuditResult> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(guildId, "Discord role-ordering guild ID")
    this.#policy.assertRoleOrderingAuditable(guildId)
    const state = await this.#state(botId, guildId, options)
    return {
      applicationId,
      botId,
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      order: state.order,
      permission: state.permission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedRoleOrderingRequest,
    options: RequestOptions,
  ): Promise<BuiltRoleOrderingPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertRoleOrderingChangeable(request.guildId)
    const existingReceipt = await this.#operationStore.get(
      "role-ordering",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new RoleOrderingOperationConflictError(receiptView(existingReceipt))
    }
    const state = await this.#state(botId, request.guildId, options)
    if (!state.permission.guildManageRoles) {
      throw evidenceError("Discord connector bot lacks guild-level MANAGE_ROLES for role ordering")
    }
    if (state.permission.botHighestRank < 1 || state.permission.botHighestRoleIds.length < 1) {
      throw evidenceError("Discord connector bot has no role above @everyone for role ordering")
    }
    const role = state.order.find((entry) => entry.id === request.roleId)
    const anchor = state.order.find((entry) => entry.id === request.anchorRoleId)
    if (!role || !anchor) {
      throw evidenceError("Discord role-ordering target or anchor is absent from the complete inventory")
    }
    for (const [label, entry] of [["target", role], ["anchor", anchor]] as const) {
      if (entry.management.type !== "standard" || entry.managed) {
        throw evidenceError(`Discord role-ordering ${label} must be a standard unmanaged role`)
      }
      if (entry.heldByBot) {
        throw evidenceError(`Discord role-ordering ${label} cannot be held by the connector bot`)
      }
      if (entry.rank >= state.permission.botHighestRank) {
        throw evidenceError(`Discord role-ordering ${label} is not below the connector bot`)
      }
    }
    const desired = desiredOrder(state.order, request)
    const currentOrderIds = state.order.map((entry) => entry.id)
    const desiredOrderIds = desired.map((entry) => entry.id)
    const writeRequired = stableString(currentOrderIds) !== stableString(desiredOrderIds)
    const ids = affectedRoleIds(state.order, request)
    const affected = affectedRoles(state.order, desired, ids)
    if (writeRequired) {
      const unsafe = affected.find((entry) => (
        entry.management.type !== "standard"
        || entry.managed
        || entry.heldByBot
        || entry.beforeRank >= state.permission.botHighestRank
        || entry.afterRank >= state.permission.botHighestRank
      ))
      if (unsafe) {
        throw evidenceError(
          `Discord role-ordering affected segment crosses an unsafe role: ${unsafe.id}`,
        )
      }
      const unknown = state.order.find((entry) => entry.unknownFieldCount !== 0)
      if (unknown) {
        throw evidenceError(
          `Discord role-ordering inventory contains unknown fields on role ${unknown.id}`,
        )
      }
    }
    const desiredRanks = new Map(desired.map((entry, rank) => [entry.id, rank]))
    const aggregateHolderAssignments = affected.reduce(
      (total, entry) => total + (entry.memberCount ?? 0),
      0,
    )
    const hierarchySensitiveRoleIds = affected
      .filter((entry) => entry.highRiskPermissionNames.length > 0)
      .map((entry) => entry.id)
      .sort(compareSnowflakes)
    const changedRoleCount = affected.filter((entry) => (
      entry.beforeRank !== entry.afterRank
    )).length
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      counts: state.counts,
      currentOrderIds,
      desiredOrderIds,
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      inventory: inventorySnapshot(state.roles),
      permission: state.permission,
      request: {
        anchorRoleId: request.anchorRoleId,
        auditReason: request.auditReason,
        guildId: request.guildId,
        operationKeyHash: request.operationKeyHash,
        placement: request.placement,
        roleId: request.roleId,
      },
    })
    const warnings = [
      "Role names are untrusted Discord text and are never persisted by this workflow",
      "Aggregate holder counts can overlap because one member may hold multiple affected roles",
      "Role position does not change ordinary permission aggregation or channel overwrite order",
      ...(state.permission.administrator
        ? ["Discord connector has ADMINISTRATOR; replace it with narrowly scoped MANAGE_ROLES"]
        : []),
      ...(hierarchySensitiveRoleIds.length > 0
        ? [`Hierarchy-sensitive permissions are present on affected role IDs: ${hierarchySensitiveRoleIds.join(", ")}`]
        : []),
      "The operation key is one-shot and cannot be retried after reservation, including after uncertainty",
      "The MCP facade durably coordinates the guild role collection and exact endpoints; direct service consumers must provide equivalent exclusion",
    ]
    const risks = [
      "Changing role order can change who may sort, edit, grant, kick, ban, or rename relative principals and can change hoisted member-list presentation",
      "Every non-target role relationship is preserved, and the complete affected segment is shown for review",
      "The PATCH is sent once without automatic retry or compensating reorder",
      "Any order, identity, metadata, response, or readback mismatch is uncertain and quarantines the guild role collection",
    ]
    const plan: RoleOrderingPlan = {
      affectedRoles: affected,
      anchor,
      applicationId,
      auditReason: request.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      current: {
        anchorRank: anchor.rank,
        roleRank: role.rank,
      },
      desired: {
        anchorRank: desiredRanks.get(anchor.id) as number,
        roleRank: desiredRanks.get(role.id) as number,
      },
      digest,
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      impact: {
        affectedRoleCount: affected.length,
        aggregateHolderAssignments,
        changedRoleCount,
        holderCountsMayOverlap: true,
        hierarchySensitiveRoleIds,
      },
      operationKeyHash: request.operationKeyHash,
      permission: state.permission,
      placement: request.placement,
      privacy: privacyProjection(),
      risks,
      role,
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-current",
      warnings,
      writeRequired,
    }
    return {
      currentOrderIds,
      desiredOrderIds,
      expectedCounts: state.counts,
      plan,
      request,
      roles: state.roles,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: RoleOrderingRequest,
    options: RequestOptions = {},
  ): Promise<RoleOrderingPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeRoleOrderingRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: RoleOrderingRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleOrderingResult> {
    const normalized = normalizeRoleOrderingRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord role-ordering plan digest is invalid")
    }
    return withGuildLock(
      normalized.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new RoleOrderingExecutionError(
        "Discord role ordering was blocked because a prior same-guild operation ended uncertain",
        {
          anchorRoleId: normalized.anchorRoleId,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          roleId: normalized.roleId,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedRoleOrderingRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<RoleOrderingResult> {
    let built: BuiltRoleOrderingPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof RoleOrderingEvidenceError
        || error instanceof DiscordRoleEvidenceError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) throw new RoleOrderingPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      throw error
    }
    const { desiredOrderIds, expectedCounts, plan, roles } = built
    if (plan.digest !== expectedDigest) {
      throw new RoleOrderingPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      anchorRoleId: request.anchorRoleId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      roleId: request.roleId,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        memberCountsMatched: true,
        observedAffectedRoles: plan.affectedRoles.map((entry) => {
          const { afterRank: _afterRank, beforeRank, ...role } = entry
          return { ...role, rank: beforeRank }
        }),
        readbackMatched: true,
        responseMatched: true,
        status: "already-current",
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
      throw new RoleOrderingOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
        status: "pending",
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
      throw new RoleOrderingExecutionError(
        "Discord role ordering was blocked because pending activity could not be recorded",
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

    let memberCountsMatched: boolean | null = null
    let mutationAccepted = false
    let observedAffectedRoles: RoleOrderEntry[] = []
    let readbackMatched: boolean | null = null
    let responseMatched: boolean | null = null
    try {
      const responseValue = await this.#client.modifyGuildRolePositions(
        request.guildId,
        [{ id: request.roleId, position: plan.desired.roleRank }],
        request.auditReason,
        options,
      )
      mutationAccepted = true
      let responseRoles: NormalizedDiscordRole[]
      try {
        responseRoles = normalizeDiscordRoleInventory(responseValue, request.guildId)
      } catch (error) {
        throw evidenceError("Discord returned invalid role-ordering response evidence", error)
      }
      responseMatched = stableString(
        inventoryMetadataSnapshot(responseRoles),
      ) === stableString(inventoryMetadataSnapshot(roles))
        && stableString(canonicalRoles(responseRoles).map((role) => role.id))
          === stableString(desiredOrderIds)
      if (!responseMatched) {
        throw evidenceError("Discord role-ordering response does not match the reviewed hierarchy")
      }
      const [readbackValue, countsValue] = await Promise.all([
        this.#client.getGuildRoles(request.guildId, options),
        this.#client.getGuildRoleMemberCounts(request.guildId, options),
      ])
      let readbackRoles: NormalizedDiscordRole[]
      try {
        readbackRoles = normalizeDiscordRoleInventory(readbackValue, request.guildId)
      } catch (error) {
        throw evidenceError("Discord returned invalid role-ordering readback evidence", error)
      }
      const readbackCounts = exactCounts(countsValue, readbackRoles, request.guildId)
      readbackMatched = stableString(inventorySnapshot(readbackRoles))
        === stableString(inventorySnapshot(responseRoles))
        && stableString(canonicalRoles(readbackRoles).map((role) => role.id))
          === stableString(desiredOrderIds)
      if (!readbackMatched) {
        throw evidenceError("Discord role-ordering readback does not match the accepted response")
      }
      memberCountsMatched = stableString(readbackCounts) === stableString(expectedCounts)
      const affectedIds = new Set(plan.affectedRoles.map((role) => role.id))
      observedAffectedRoles = projectOrder(
        readbackRoles,
        readbackCounts,
        {
          roles: plan.permission.botHighestRoleIds,
          user: { bot: true, id: botId, username: "connector" },
        },
        request.guildId,
      ).filter((role) => affectedIds.has(role.id))
    } catch (error) {
      const status = !mutationAccepted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: errorCode,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new RoleOrderingExecutionError(
        "Discord role ordering did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          memberCountsMatched,
          observedAffectedRoles,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = memberCountsMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: RoleOrderingResult = {
      ...baseResult,
      activityId,
      memberCountsMatched: memberCountsMatched === true,
      observedAffectedRoles,
      readbackMatched: readbackMatched === true,
      responseMatched: responseMatched === true,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new RoleOrderingExecutionError(
        "Discord role ordering completed but the operation receipt failed",
        {
          ...result,
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
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new RoleOrderingExecutionError(
        "Discord role ordering completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return result
  }
}
