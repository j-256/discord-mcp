import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MemberNicknameActivity,
  MemberNicknameActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_DIRECTORY_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildMemberNicknameUpdate,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  MemberNicknameEvidenceError,
  MemberNicknameExecutionError,
  MemberNicknameOperationConflictError,
  MemberNicknamePlanChangedError,
} from "./errors.js"
import {
  normalizeDesiredMemberNickname,
  projectMemberNickname,
} from "./member-nickname.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
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
import { normalizeDiscordRoleInventory } from "./role-administration-service.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "member-nickname-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\p{Cc}\p{Cs}]/u
const MEMBER_NICKNAME_REQUEST_KEYS = [
  "auditReason",
  "guildId",
  "nickname",
  "operationKey",
  "target",
] as const
const CURRENT_BOT_TARGET_KEYS = ["kind"] as const
const MEMBER_TARGET_KEYS = ["kind", "userId"] as const

export type MemberNicknameTarget =
  | { kind: "current-bot" }
  | { kind: "member"; userId: string }

export interface MemberNicknameChangeRequest {
  auditReason: string
  guildId: string
  nickname: string | null
  operationKey: string
  target: MemberNicknameTarget
}

export interface NormalizedMemberNicknameChangeRequest {
  auditReason: string
  guildId: string
  nickname: string | null
  operationKey: string
  operationKeyHash: string
  target: MemberNicknameTarget
}

export interface MemberNicknamePermissionEvidence {
  administrator: boolean
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  requiredPermission: "CHANGE_NICKNAME" | "MANAGE_NICKNAMES"
  requiredPermissionPresent: true
  unknownPermissionBits: string
}

export interface MemberNicknameHierarchyEvidence {
  botHighestRoleIds: string[]
  botHighestRolePosition: number
  targetAdministrator: false
  targetBelowBot: true
  targetHighestRoleIds: string[]
  targetHighestRolePosition: number
}

export interface MemberNicknamePrivacyProjection {
  persistence: "content-free-outcomes-only"
  rawPayloadExposed: false
  transientUntrustedFields: readonly [
    "currentNickname",
    "desiredNickname",
    "guildName",
    "username",
  ]
}

export interface MemberNicknameChangePlan {
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  desiredNickname: string | null
  digest: string
  guild: {
    id: string
    name: string
    ownerId: string
  }
  hierarchy: MemberNicknameHierarchyEvidence | null
  operationKeyHash: string
  permission: MemberNicknamePermissionEvidence
  privacy: MemberNicknamePrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  target: {
    bot: boolean
    currentNickname: string | null
    id: string
    kind: MemberNicknameTarget["kind"]
    pending: boolean
    username: string
  }
  warnings: string[]
  writeRequired: boolean
}

export interface MemberNicknameChangeResult {
  activityId: string | null
  guildId: string
  observedNickname: string | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  targetKind: MemberNicknameTarget["kind"]
  userId: string
  verification: "drift" | "match" | "not-required"
}

export interface MemberNicknameServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "modifyCurrentMemberNickname"
    | "modifyGuildMemberNickname"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface MemberNicknameState {
  botMember: ExactMember
  botPermissions: GuildMemberPermissionResult
  guild: DiscordGuild & { name: string; owner_id: string }
  hierarchy: MemberNicknameHierarchyEvidence | null
  roles: DiscordRole[]
  targetId: string
  targetMember: ExactMember
  targetPermissions: GuildMemberPermissionResult
}

type ExactMember = DiscordGuildMember & {
  nick?: string | null
  user: NonNullable<DiscordGuildMember["user"]>
}

type MemberNicknameTargetOutcome = "settled" | "uncertain"

interface MemberNicknameLockState {
  tails: Map<string, Promise<MemberNicknameTargetOutcome>>
  uncertainTargets: Set<string>
}

const MEMBER_NICKNAME_LOCKS = new WeakMap<OperationStore, MemberNicknameLockState>()

function memberNicknameLocks(operationStore: OperationStore): MemberNicknameLockState {
  let state = MEMBER_NICKNAME_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainTargets: new Set() }
    MEMBER_NICKNAME_LOCKS.set(operationStore, state)
  }
  return state
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
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
  if (leftId === rightId) return 0
  return leftId < rightId ? -1 : 1
}

export function normalizeMemberNicknameChangeRequest(
  value: MemberNicknameChangeRequest,
): NormalizedMemberNicknameChangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord member nickname change request must be an object")
  }
  const record = value as unknown as Record<string, unknown>
  if (!exactKeys(record, MEMBER_NICKNAME_REQUEST_KEYS)) {
    throw new RangeError("Discord member nickname change request has unsupported fields")
  }
  if (!validSnowflake(value.guildId)) {
    throw new RangeError("Discord member nickname change requires an exact guild snowflake")
  }
  if (typeof value.auditReason !== "string") {
    throw new RangeError("Discord member nickname audit reason must be a string")
  }
  encodeDiscordAuditReason(value.auditReason)
  const nickname = normalizeDesiredMemberNickname(value.nickname)
  if (!value.target || typeof value.target !== "object" || Array.isArray(value.target)) {
    throw new RangeError("Discord member nickname target must be an exact object")
  }
  const targetRecord = value.target as unknown as Record<string, unknown>
  let target: MemberNicknameTarget
  if (value.target.kind === "current-bot") {
    if (!exactKeys(targetRecord, CURRENT_BOT_TARGET_KEYS)) {
      throw new RangeError("Discord current-bot nickname target accepts only its kind")
    }
    target = { kind: "current-bot" }
  } else if (value.target.kind === "member") {
    if (!exactKeys(targetRecord, MEMBER_TARGET_KEYS) || !validSnowflake(value.target.userId)) {
      throw new RangeError("Discord member nickname target requires one exact user snowflake")
    }
    target = { kind: "member", userId: value.target.userId }
  } else {
    throw new RangeError("Discord member nickname target kind is invalid")
  }
  return {
    auditReason: value.auditReason,
    guildId: value.guildId,
    nickname,
    operationKey: value.operationKey,
    operationKeyHash: operationKeyHash(value.operationKey),
    target,
  }
}

function evidenceError(message: string, cause?: unknown): MemberNicknameEvidenceError {
  return new MemberNicknameEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function exactGuild(
  value: DiscordGuild,
  guildId: string,
): DiscordGuild & { name: string; owner_id: string } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validSnowflake(value.owner_id)
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
  ) {
    throw evidenceError("Discord returned invalid member nickname guild evidence")
  }
  return value as DiscordGuild & { name: string; owner_id: string }
}

function exactMember(
  value: DiscordGuildMember,
  guildId: string,
  userId: string,
  requireBot: boolean,
  description: string,
): ExactMember {
  const username = value?.user?.username
  let nickname: string | null
  try {
    nickname = projectMemberNickname(value?.nick)
  } catch (error) {
    throw evidenceError(`Discord returned invalid ${description} nickname evidence`, error)
  }
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.user?.id !== userId
    || (requireBot && value.user.bot !== true)
    || (value.user.bot !== undefined && typeof value.user.bot !== "boolean")
    || typeof username !== "string"
    || username.length < 1
    || [...username].length > MEMBER_DIRECTORY_LIMITS.nameCharacters
    || TEXT_CONTROL_PATTERN.test(username)
    || !validUnicode(username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.some((roleId) => !validSnowflake(roleId))
    || value.roles.includes(guildId)
    || new Set(value.roles).size !== value.roles.length
    || (value.pending !== undefined && typeof value.pending !== "boolean")
  ) {
    throw evidenceError(`Discord returned invalid or mismatched ${description} membership evidence`)
  }
  return {
    ...value,
    nick: nickname,
  } as ExactMember
}

function exactRoles(
  values: readonly DiscordRole[],
  guildId: string,
  members: readonly ExactMember[],
): DiscordRole[] {
  try {
    normalizeDiscordRoleInventory(values, guildId)
  } catch (error) {
    throw evidenceError(
      `Discord member nickname role evidence is invalid: ${errorMessage(error)}`,
      error,
    )
  }
  const ids = new Set(values.map((role) => role.id))
  for (const member of members) {
    if (member.roles.some((roleId) => !ids.has(roleId))) {
      throw evidenceError("Discord member nickname evidence references an unknown role")
    }
  }
  return [...values]
}

function guildPermissions(
  member: ExactMember,
  roles: readonly DiscordRole[],
  guildId: string,
  description: string,
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError(`Discord ${description} permission evidence is invalid`, error)
  }
  if (!result.complete || result.highestRoleIds.length !== 1) {
    throw evidenceError(`Discord ${description} permission evidence is incomplete`)
  }
  return result
}

function rolesSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    permissions: role.permissions,
    position: role.position,
  })).sort((left, right) => compareSnowflakes(left.id, right.id))
}

function memberSnapshot(member: ExactMember) {
  return {
    bot: member.user.bot === true,
    nickname: member.nick ?? null,
    pending: member.pending ?? false,
    roles: [...member.roles].sort(compareSnowflakes),
    userId: member.user.id,
    username: member.user.username,
  }
}

function permissionSnapshot(result: GuildMemberPermissionResult) {
  return {
    administrator: result.administrator,
    effectivePermissions: result.effectivePermissions,
    highestRoleIds: [...result.highestRoleIds],
    highestRolePosition: result.highestRolePosition,
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(result.effectivePermissions),
    ).toString(),
  }
}

function privacyProjection(): MemberNicknamePrivacyProjection {
  return {
    persistence: "content-free-outcomes-only",
    rawPayloadExposed: false,
    transientUntrustedFields: [
      "currentNickname",
      "desiredNickname",
      "guildName",
      "username",
    ],
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
    userId: receipt.resourceId,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: MemberNicknameChangePlan
  request: NormalizedMemberNicknameChangeRequest
  status: MemberNicknameActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): MemberNicknameActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "member-nickname-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetKind: options.request.target.kind,
    timestamp: options.timestamp,
    userId: options.plan.target.id,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: MemberNicknameChangePlan
  request: NormalizedMemberNicknameChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "member-nickname-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.plan.target.id,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function targetKey(guildId: string, userId: string): string {
  return `${guildId}\0${userId}`
}

function executionBlocksTarget(error: unknown): boolean {
  if (
    !(error instanceof MemberNicknameExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  const status = (error.result as { status: unknown }).status
  return status === "uncertain" || status === "completed-operation-record-failed"
}

async function withTargetLock<T>(
  state: MemberNicknameLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => MemberNicknameExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: MemberNicknameTargetOutcome) => void = () => undefined
  const tail = new Promise<MemberNicknameTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: MemberNicknameTargetOutcome = "settled"
  try {
    if (state.uncertainTargets.has(key) || await prior === "uncertain") {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksTarget(error)) {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(key) === tail) state.tails.delete(key)
  }
}

export class MemberNicknameService {
  readonly #activityStore: ActivityStore
  readonly #client: MemberNicknameServiceOptions["client"]
  readonly #clock: () => Date
  readonly #locks: MemberNicknameLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: MemberNicknameServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = memberNicknameLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #evidence(
    applicationId: string,
    botId: string,
    request: NormalizedMemberNicknameChangeRequest,
    options: RequestOptions,
  ): Promise<MemberNicknameState> {
    if (!validSnowflake(applicationId) || !validSnowflake(botId)) {
      throw new RangeError(
        "Discord member nickname planning requires exact application and bot snowflakes",
      )
    }
    this.#policy.assertNicknameChangeAllowed(request.guildId)
    const targetId = request.target.kind === "current-bot"
      ? botId
      : request.target.userId
    if (request.target.kind === "member") {
      if (targetId === botId) {
        throw evidenceError(
          "Discord connector bot nickname changes must use the current-bot target",
        )
      }
      this.#policy.assertOtherMemberNicknameChangeAllowed(request.guildId, targetId)
    }
    const receipt = await this.#operationStore.get(
      "member-nickname-change",
      request.operationKeyHash,
    )
    if (receipt) throw new MemberNicknameOperationConflictError(receiptView(receipt))

    const guildPromise = this.#client.getGuild(request.guildId, options)
    const botMemberPromise = this.#client.getGuildMember(
      request.guildId,
      botId,
      options,
    )
    const targetMemberPromise = targetId === botId
      ? botMemberPromise
      : this.#client.getGuildMember(request.guildId, targetId, options)
    const rolesPromise = this.#client.getGuildRoles(request.guildId, options)
    const [rawGuild, rawBotMember, rawTargetMember, rawRoles] = await Promise.all([
      guildPromise,
      botMemberPromise,
      targetMemberPromise,
      rolesPromise,
    ])
    const guild = exactGuild(rawGuild, request.guildId)
    const botMember = exactMember(
      rawBotMember,
      request.guildId,
      botId,
      true,
      "connector-bot",
    )
    const targetMember = targetId === botId
      ? botMember
      : exactMember(
          rawTargetMember,
          request.guildId,
          targetId,
          false,
          "target-member",
        )
    const roles = exactRoles(
      rawRoles,
      request.guildId,
      targetId === botId ? [botMember] : [botMember, targetMember],
    )
    const botPermissions = guildPermissions(
      botMember,
      roles,
      request.guildId,
      "connector bot",
    )
    const targetPermissions = targetId === botId
      ? botPermissions
      : guildPermissions(targetMember, roles, request.guildId, "target member")
    const requiredPermission = request.target.kind === "current-bot"
      ? "CHANGE_NICKNAME"
      : "MANAGE_NICKNAMES"
    if (!hasGuildPermission(botPermissions, requiredPermission)) {
      throw evidenceError(
        `Discord connector bot lacks required ${requiredPermission} permission`,
      )
    }
    let hierarchy: MemberNicknameHierarchyEvidence | null = null
    if (request.target.kind === "member") {
      if (targetId === guild.owner_id) {
        throw evidenceError("Discord nickname changes cannot target the guild owner")
      }
      if (targetMember.pending === true) {
        throw evidenceError("Discord nickname changes cannot target a pending member")
      }
      if (targetPermissions.administrator) {
        throw evidenceError("Discord nickname changes cannot target an administrator")
      }
      if (botPermissions.highestRolePosition <= targetPermissions.highestRolePosition) {
        throw evidenceError(
          "Discord nickname target must be strictly below the connector bot's highest role",
        )
      }
      hierarchy = {
        botHighestRoleIds: [...botPermissions.highestRoleIds],
        botHighestRolePosition: botPermissions.highestRolePosition,
        targetAdministrator: false,
        targetBelowBot: true,
        targetHighestRoleIds: [...targetPermissions.highestRoleIds],
        targetHighestRolePosition: targetPermissions.highestRolePosition,
      }
    }
    return {
      botMember,
      botPermissions,
      guild,
      hierarchy,
      roles,
      targetId,
      targetMember,
      targetPermissions,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedMemberNicknameChangeRequest,
    options: RequestOptions,
  ): Promise<MemberNicknameChangePlan> {
    const state = await this.#evidence(applicationId, botId, request, options)
    const currentNickname = state.targetMember.nick ?? null
    const writeRequired = currentNickname !== request.nickname
    const requiredPermission = request.target.kind === "current-bot"
      ? "CHANGE_NICKNAME"
      : "MANAGE_NICKNAMES"
    const unknownPermissionBits = unknownDiscordPermissionBits(
      BigInt(state.botPermissions.effectivePermissions),
    ).toString()
    const permission: MemberNicknamePermissionEvidence = {
      administrator: state.botPermissions.administrator,
      effectivePermissionNames: [...state.botPermissions.effectivePermissionNames],
      effectivePermissions: state.botPermissions.effectivePermissions,
      requiredPermission,
      requiredPermissionPresent: true,
      unknownPermissionBits,
    }
    const privacy = privacyProjection()
    const warnings = [
      ...(state.botPermissions.administrator
        ? [`Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped ${requiredPermission}`]
        : []),
      ...(unknownPermissionBits !== "0"
        ? [`Connector-bot permission evidence contains bits unknown to this build: ${unknownPermissionBits}`]
        : []),
      ...(request.target.kind === "current-bot"
        ? ["The narrow current-member route does not grant authority over other members"]
        : ["The other-member gate, protected-user policy, owner and administrator exclusions, and strict role hierarchy all apply"]),
      "Nickname and identity labels in this plan are transient untrusted Discord content",
      "Same-member serialization and uncertainty quarantine are process-local defense in depth",
      "The operation key is one-shot and cannot be retried after reservation",
      "This workflow performs one exact non-retried nickname PATCH, one exact readback, and never rolls back",
    ]
    const risks = writeRequired
      ? [
          request.nickname === null
            ? "The exact member's guild nickname will be cleared immediately"
            : "The exact member's guild nickname will change immediately and be visible throughout the guild",
          "A transport or readback failure after dispatch creates an uncertain outcome that blocks later same-member nickname changes in this process",
        ]
      : []
    const requestSnapshot = {
      auditReason: request.auditReason,
      guildId: request.guildId,
      nickname: request.nickname,
      operationKeyHash: request.operationKeyHash,
      target: request.target,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      botPermissions: permissionSnapshot(state.botPermissions),
      domain: "discord-mcp-member-nickname-change-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      hierarchy: state.hierarchy,
      localPolicy: {
        featureEnabled: true,
        guildAllowed: request.guildId,
        otherMemberEnabled: request.target.kind === "member",
        targetProtected: false,
      },
      permission,
      privacy,
      request: requestSnapshot,
      risks,
      roles: rolesSnapshot(state.roles),
      targetMember: memberSnapshot(state.targetMember),
      targetPermissions: permissionSnapshot(state.targetPermissions),
      warnings,
    })
    return {
      applicationId,
      auditReason: request.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      desiredNickname: request.nickname,
      digest,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      hierarchy: state.hierarchy,
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-current",
      target: {
        bot: state.targetMember.user.bot === true,
        currentNickname,
        id: state.targetId,
        kind: request.target.kind,
        pending: state.targetMember.pending ?? false,
        username: state.targetMember.user.username,
      },
      warnings,
      writeRequired,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: MemberNicknameChangeRequest,
    options: RequestOptions = {},
  ): Promise<MemberNicknameChangePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeMemberNicknameChangeRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: MemberNicknameChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberNicknameChangeResult> {
    const normalized = normalizeMemberNicknameChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord member nickname plan digest is invalid")
    }
    const userId = normalized.target.kind === "current-bot"
      ? botId
      : normalized.target.userId
    const key = targetKey(normalized.guildId, userId)
    return withTargetLock(
      this.#locks,
      key,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new MemberNicknameExecutionError(
        "Discord member nickname change was blocked because a prior same-member operation ended without a durable outcome",
        {
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          targetKind: normalized.target.kind,
          userId,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedMemberNicknameChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<MemberNicknameChangeResult> {
    let plan: MemberNicknameChangePlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof MemberNicknameEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new MemberNicknamePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new MemberNicknamePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      targetKind: request.target.kind,
      userId: plan.target.id,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        observedNickname: plan.target.currentNickname,
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
      throw new MemberNicknameOperationConflictError(receiptView(reservation.receipt))
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
      throw new MemberNicknameExecutionError(
        "Discord member nickname change was blocked because pending activity could not be recorded",
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

    let mutationStarted = false
    let mutationReturned = false
    let response: DiscordGuildMemberNicknameUpdate | null = null
    let observedNickname: string | null = null
    try {
      mutationStarted = true
      response = request.target.kind === "current-bot"
        ? await this.#client.modifyCurrentMemberNickname(
            request.guildId,
            botId,
            request.nickname,
            request.auditReason,
            options,
          )
        : await this.#client.modifyGuildMemberNickname(
            request.guildId,
            request.target.userId,
            request.nickname,
            request.auditReason,
            options,
          )
      mutationReturned = true
      if (response.userId !== plan.target.id) {
        throw evidenceError("Discord returned a nickname response for another member")
      }
      const readback = exactMember(
        await this.#client.getGuildMember(
          request.guildId,
          plan.target.id,
          options,
        ),
        request.guildId,
        plan.target.id,
        request.target.kind === "current-bot",
        "nickname readback",
      )
      observedNickname = readback.nick ?? null
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      const status = definiteMutationRefusal ? "failed" : "uncertain"
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
      throw new MemberNicknameExecutionError(
        "Discord member nickname change did not complete with a verified outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = response.nickname === request.nickname
      && observedNickname === request.nickname
      ? "match"
      : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: MemberNicknameChangeResult = {
      ...baseResult,
      activityId,
      observedNickname,
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
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new MemberNicknameExecutionError(
        "Discord member nickname change completed but the operation receipt failed",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
          verification,
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
      throw new MemberNicknameExecutionError(
        "Discord member nickname change completed but the final activity record failed",
        {
          ...baseResult,
          activityId,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
          verification,
        },
        { cause: error },
      )
    }
    return result
  }
}
