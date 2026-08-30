import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MemberModerationActivity,
  MemberModerationActivityAction,
} from "./activity-log.js"
import {
  ADMINISTRATION_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_MODERATION_ACTIONS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
} from "./discord-client.js"
import {
  AdministrationExecutionError,
  AdministrationOperationConflictError,
  AdministrationPlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
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
import type {
  DiscordBan,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  DiscordUser,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "administration-state-unavailable"
const ACTIONS: ReadonlySet<string> = new Set(MEMBER_MODERATION_ACTIONS)
const REQUEST_KEYS = [
  "action",
  "auditReason",
  "deleteMessageSeconds",
  "durationMinutes",
  "guildId",
  "operationKey",
  "userId",
] as const

export interface MemberModerationRequest {
  action: MemberModerationActivityAction
  auditReason: string
  deleteMessageSeconds?: number
  durationMinutes?: number
  guildId: string
  operationKey: string
  userId: string
}

export interface NormalizedMemberModerationRequest {
  action: MemberModerationActivityAction
  auditReason: string
  deleteMessageSeconds: number | null
  durationMinutes: number | null
  guildId: string
  operationKey: string
  operationKeyHash: string
  userId: string
}

export interface MemberModerationPrivacyProjection {
  persistence: "content-free-outcomes-only"
  rawPayloadExposed: false
  transientUntrustedFields: readonly [
    "globalName",
    "nickname",
    "username",
  ]
}

export interface MemberModerationVerificationBoundary {
  automaticRetry: false
  freshApiReadback: true
  mutationResponse: "action-dependent"
  rollback: "not-automatic"
}

export interface MemberModerationPlan {
  action: MemberModerationActivityAction
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  digest: string
  guildId: string
  operationKeyHash: string
  parameters: {
    deleteMessageSeconds: number | null
    durationMinutes: number | null
    estimatedTimeoutUntil: string | null
  }
  permission: {
    botAdministrator: boolean
    botHighestRolePosition: number
    effectivePermissionNames: DiscordPermissionName[]
    effectivePermissions: string
    required: DiscordPermissionName
    targetAdministrator: boolean | null
    targetHighestRolePosition: number | null
    unknownPermissionBits: string
  }
  privacy: MemberModerationPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "planned"
  target: {
    banState: "banned" | "not-banned"
    bot: boolean
    currentTimeoutUntil: string | null
    globalName: string | null
    id: string
    membership: "member" | "non-member"
    nickname: string | null
    username: string
  }
  verificationBoundary: MemberModerationVerificationBoundary
  warnings: string[]
}

export type MemberModerationObservedState =
  | {
      kind: "ban"
      state: "banned" | "not-banned"
    }
  | {
      kind: "membership"
      state: "member" | "non-member"
    }
  | {
      kind: "timeout"
      timeoutUntil: string | null
    }

export interface MemberModerationResult {
  action: MemberModerationActivityAction
  activityId: string
  guildId: string
  observedState: MemberModerationObservedState
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  timeoutUntil: string | null
  userId: string
  verification: "drift" | "match"
}

export interface AdministrationServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "createGuildBan"
    | "getGuild"
    | "getGuildBan"
    | "getGuildMember"
    | "getGuildRoles"
    | "getUser"
    | "modifyGuildMemberTimeout"
    | "removeGuildBan"
    | "removeGuildMember"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface ModerationState {
  ban: DiscordBan | undefined
  botMember: DiscordGuildMember
  botPermissions: GuildMemberPermissionResult
  guild: DiscordGuild
  roles: DiscordRole[]
  targetMember: DiscordGuildMember | undefined
  targetPermissions: GuildMemberPermissionResult | undefined
  targetUser: DiscordUser
}

interface ModerationReadback {
  observedState: MemberModerationObservedState
  timeoutUntil: string | null
  verification: "drift" | "match"
}

type ModerationTargetOutcome = "settled" | "uncertain"

interface ModerationLockState {
  tails: Map<string, Promise<ModerationTargetOutcome>>
  uncertainTargets: Set<string>
}

const MODERATION_LOCKS = new WeakMap<OperationStore, ModerationLockState>()

function moderationLocks(operationStore: OperationStore): ModerationLockState {
  let state = MODERATION_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainTargets: new Set() }
    MODERATION_LOCKS.set(operationStore, state)
  }
  return state
}

class AdministrationStateError extends Error {
  override name = "AdministrationStateError"
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertIntegerRange(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

export function normalizeMemberModerationRequest(
  request: MemberModerationRequest,
): NormalizedMemberModerationRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord member moderation request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))
    || typeof request.action !== "string"
    || typeof request.auditReason !== "string"
    || typeof request.guildId !== "string"
    || typeof request.operationKey !== "string"
    || typeof request.userId !== "string"
  ) {
    throw new RangeError("Discord member moderation request is invalid")
  }
  if (!ACTIONS.has(request.action)) {
    throw new RangeError("Discord member moderation action is not supported")
  }
  if (
    !positiveSnowflake(request.guildId)
    || !positiveSnowflake(request.userId)
  ) {
    throw new RangeError("Discord member moderation requires exact snowflake IDs")
  }
  encodeDiscordAuditReason(request.auditReason)

  let deleteMessageSeconds: number | null = null
  let durationMinutes: number | null = null
  if (request.action === "ban") {
    deleteMessageSeconds = request.deleteMessageSeconds ?? 0
    assertIntegerRange(
      deleteMessageSeconds,
      0,
      DISCORD_LIMITS.banDeleteMessageSeconds,
      "Discord ban message-history deletion seconds",
    )
    if (request.durationMinutes !== undefined) {
      throw new RangeError("Discord ban does not accept durationMinutes")
    }
  } else if (request.action === "timeout") {
    if (request.durationMinutes === undefined) {
      throw new RangeError("Discord timeout requires durationMinutes")
    }
    durationMinutes = request.durationMinutes
    assertIntegerRange(
      durationMinutes,
      1,
      ADMINISTRATION_LIMITS.timeoutMinutes,
      "Discord timeout durationMinutes",
    )
    if (request.deleteMessageSeconds !== undefined) {
      throw new RangeError("Discord timeout does not accept deleteMessageSeconds")
    }
  } else if (
    request.deleteMessageSeconds !== undefined
    || request.durationMinutes !== undefined
  ) {
    throw new RangeError(`Discord ${request.action} does not accept action parameters`)
  }

  return {
    action: request.action,
    auditReason: request.auditReason,
    deleteMessageSeconds,
    durationMinutes,
    guildId: request.guildId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    userId: request.userId,
  }
}

function requiredPermission(
  action: MemberModerationActivityAction,
): DiscordPermissionName {
  if (action === "kick") return "KICK_MEMBERS"
  if (action === "timeout" || action === "remove-timeout") {
    return "MODERATE_MEMBERS"
  }
  return "BAN_MEMBERS"
}

function exactMember(
  member: DiscordGuildMember,
  expectedUserId: string,
  description: string,
): DiscordGuildMember {
  if (!member.user || member.user.id !== expectedUserId) {
    throw new AdministrationStateError(
      `Discord returned a different ${description} member than requested`,
    )
  }
  return member
}

function exactBan(
  ban: DiscordBan,
  expectedUserId: string,
): DiscordBan {
  if (ban.user.id !== expectedUserId) {
    throw new AdministrationStateError("Discord returned a different guild ban than requested")
  }
  return ban
}

function exactUser(user: DiscordUser, expectedUserId: string): DiscordUser {
  if (user.id !== expectedUserId) {
    throw new AdministrationStateError("Discord returned a different user than requested")
  }
  return user
}

async function optionalDiscordEntity<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return undefined
    throw error
  }
}

function timeoutState(member: DiscordGuildMember | undefined): string | null {
  const value = member?.communication_disabled_until ?? null
  if (value === null) return null
  if (Number.isNaN(Date.parse(value))) {
    throw new AdministrationStateError("Discord returned an invalid member timeout timestamp")
  }
  return value
}

function assertCompletePermissions(
  result: GuildMemberPermissionResult,
  description: string,
): void {
  if (!result.complete) {
    throw new AdministrationStateError(
      `Discord ${description} permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
}

function memberSnapshot(member: DiscordGuildMember) {
  return {
    communicationDisabledUntil: member.communication_disabled_until ?? null,
    roles: [...member.roles].sort(),
    userId: member.user?.id ?? null,
  }
}

function roleSnapshot(
  roles: readonly DiscordRole[],
  relevantRoleIds: ReadonlySet<string>,
) {
  return [...roles]
    .filter((role) => relevantRoleIds.has(role.id))
    .map((role) => ({
      id: role.id,
      permissions: role.permissions,
      position: role.position,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
  return normalized || "UnknownError"
}

function privacyProjection(): MemberModerationPrivacyProjection {
  return {
    persistence: "content-free-outcomes-only",
    rawPayloadExposed: false,
    transientUntrustedFields: [
      "globalName",
      "nickname",
      "username",
    ],
  }
}

function verificationBoundary(): MemberModerationVerificationBoundary {
  return {
    automaticRetry: false,
    freshApiReadback: true,
    mutationResponse: "action-dependent",
    rollback: "not-automatic",
  }
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
  plan: MemberModerationPlan
  request: NormalizedMemberModerationRequest
  status: MemberModerationActivity["status"]
  timeoutUntil?: string | null
  timestamp: string
  verification?: "drift" | "match" | null
}): MemberModerationActivity {
  return {
    action: options.request.action,
    deleteMessageSeconds: options.request.deleteMessageSeconds,
    durationMinutes: options.request.durationMinutes,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "member-moderation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timeoutUntil: options.timeoutUntil ?? null,
    timestamp: options.timestamp,
    userId: options.request.userId,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: MemberModerationPlan
  request: NormalizedMemberModerationRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "member-moderation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.request.userId,
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
    !(error instanceof AdministrationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  const status = (error.result as { status: unknown }).status
  return status === "uncertain" || status === "completed-operation-record-failed"
}

async function withTargetLock<T>(
  state: ModerationLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => AdministrationExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: ModerationTargetOutcome) => void = () => undefined
  const tail = new Promise<ModerationTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: ModerationTargetOutcome = "settled"
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

export class AdministrationService {
  readonly #activityStore: ActivityStore
  readonly #client: AdministrationServiceOptions["client"]
  readonly #clock: () => Date
  readonly #locks: ModerationLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: AdministrationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = moderationLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async plan(
    applicationId: string,
    botId: string,
    request: MemberModerationRequest,
    options: RequestOptions = {},
  ): Promise<MemberModerationPlan> {
    return this.#planNormalized(
      applicationId,
      botId,
      normalizeMemberModerationRequest(request),
      options,
    )
  }

  async #state(
    applicationId: string,
    botId: string,
    request: NormalizedMemberModerationRequest,
    options: RequestOptions,
  ): Promise<ModerationState> {
    if (!positiveSnowflake(applicationId) || !positiveSnowflake(botId)) {
      throw new RangeError(
        "Discord member moderation planning requires exact application and bot snowflakes",
      )
    }
    this.#policy.assertMemberAdministrationAllowed(request.guildId, request.userId)
    if (request.userId === botId) {
      throw new AdministrationStateError("The connector bot cannot moderate itself")
    }
    const receipt = await this.#operationStore.get(
      "member-moderation",
      request.operationKeyHash,
    )
    if (receipt) throw new AdministrationOperationConflictError(receiptView(receipt))

    const [guild, botMember, roles] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
    ])
    if (
      guild.id !== request.guildId
      || !guild.owner_id
      || !positiveSnowflake(guild.owner_id)
    ) {
      throw new AdministrationStateError("Discord returned incomplete or mismatched guild evidence")
    }
    if (guild.owner_id === request.userId) {
      throw new AdministrationStateError("The Discord guild owner cannot be moderated")
    }
    exactMember(botMember, botId, "connector bot")

    let botPermissions: GuildMemberPermissionResult
    try {
      botPermissions = evaluateGuildMemberPermissions({
        guildId: request.guildId,
        member: botMember,
        roles,
      })
    } catch (error) {
      throw new AdministrationStateError(
        `Discord connector bot permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    assertCompletePermissions(botPermissions, "connector bot")
    const permission = requiredPermission(request.action)
    if (!hasGuildPermission(botPermissions, permission)) {
      throw new AdministrationStateError(
        `Discord connector bot lacks ${permission} for ${request.action}`,
      )
    }

    let targetMember: DiscordGuildMember | undefined
    let ban: DiscordBan | undefined
    if (["kick", "remove-timeout", "timeout"].includes(request.action)) {
      targetMember = await optionalDiscordEntity(
        this.#client.getGuildMember(request.guildId, request.userId, options),
      )
      if (!targetMember) {
        throw new AdministrationStateError(
          `Discord ${request.action} requires a current guild member`,
        )
      }
    } else if (request.action === "ban") {
      [targetMember, ban] = await Promise.all([
        optionalDiscordEntity(
          this.#client.getGuildMember(request.guildId, request.userId, options),
        ),
        optionalDiscordEntity(
          this.#client.getGuildBan(request.guildId, request.userId, options),
        ),
      ])
      if (ban) {
        exactBan(ban, request.userId)
        throw new AdministrationStateError("Discord user is already banned from the guild")
      }
    } else {
      ban = await optionalDiscordEntity(
        this.#client.getGuildBan(request.guildId, request.userId, options),
      )
      if (!ban) {
        throw new AdministrationStateError("Discord unban requires an existing guild ban")
      }
      exactBan(ban, request.userId)
    }

    let targetUser: DiscordUser
    let targetPermissions: GuildMemberPermissionResult | undefined
    if (targetMember) {
      exactMember(targetMember, request.userId, "target")
      targetUser = targetMember.user as DiscordUser
      try {
        targetPermissions = evaluateGuildMemberPermissions({
          guildId: request.guildId,
          member: targetMember,
          roles,
        })
      } catch (error) {
        throw new AdministrationStateError(
          `Discord target permission evidence is invalid: ${errorMessage(error)}`,
          { cause: error },
        )
      }
      assertCompletePermissions(targetPermissions, "target")
      if (botPermissions.highestRolePosition <= targetPermissions.highestRolePosition) {
        throw new AdministrationStateError(
          "Discord connector bot's highest role is not above the target's highest role",
        )
      }
      if (
        ["remove-timeout", "timeout"].includes(request.action)
        && targetPermissions.administrator
      ) {
        throw new AdministrationStateError("Discord administrators cannot be timed out")
      }
    } else if (ban) {
      targetUser = exactUser(ban.user, request.userId)
    } else {
      targetUser = exactUser(
        await this.#client.getUser(request.userId, options),
        request.userId,
      )
    }

    const currentTimeoutUntil = timeoutState(targetMember)
    if (request.action === "remove-timeout") {
      if (!currentTimeoutUntil || Date.parse(currentTimeoutUntil) <= this.#clock().getTime()) {
        throw new AdministrationStateError(
          "Discord remove-timeout requires a currently active timeout",
        )
      }
    }

    return {
      ban,
      botMember,
      botPermissions,
      guild,
      roles,
      targetMember,
      targetPermissions,
      targetUser,
    }
  }

  async #planNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedMemberModerationRequest,
    options: RequestOptions,
  ): Promise<MemberModerationPlan> {
    const state = await this.#state(applicationId, botId, request, options)
    const createdAt = this.#clock()
    const currentTimeoutUntil = timeoutState(state.targetMember)
    const estimatedTimeoutUntil = request.durationMinutes === null
      ? null
      : new Date(
          createdAt.getTime() + request.durationMinutes * 60_000,
        ).toISOString()
    const relevantRoleIds = new Set([
      ...state.botPermissions.appliedRoleIds,
      ...(state.targetPermissions?.appliedRoleIds || []),
    ])
    const unknownPermissionBits = unknownDiscordPermissionBits(
      BigInt(state.botPermissions.effectivePermissions),
    ).toString()
    const permission = {
      botAdministrator: state.botPermissions.administrator,
      botHighestRolePosition: state.botPermissions.highestRolePosition,
      effectivePermissionNames: [...state.botPermissions.effectivePermissionNames],
      effectivePermissions: state.botPermissions.effectivePermissions,
      required: requiredPermission(request.action),
      targetAdministrator: state.targetPermissions?.administrator ?? null,
      targetHighestRolePosition: state.targetPermissions?.highestRolePosition ?? null,
      unknownPermissionBits,
    }
    const privacy = privacyProjection()
    const boundary = verificationBoundary()
    const risks = [
      {
        ban: "The exact user will be banned and cannot rejoin until separately unbanned",
        kick: "The exact member will be removed and must use a valid invite to rejoin",
        "remove-timeout": "The exact member will immediately regain communication privileges allowed by channel policy",
        timeout: "The exact member will be prevented from communicating for the reviewed duration",
        unban: "The exact user will be allowed to rejoin through a valid invite",
      }[request.action],
      ...(request.action === "ban" && (request.deleteMessageSeconds ?? 0) > 0
        ? [`Discord will also delete up to ${request.deleteMessageSeconds} seconds of the exact user's recent message history`]
        : []),
      "A transport or readback failure after dispatch creates an uncertain outcome and quarantines later same-member writes until operator review",
    ]
    const warnings = [
      ...(state.botPermissions.administrator
        ? [`Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped ${permission.required}`]
        : []),
      ...(unknownPermissionBits !== "0"
        ? [`Connector-bot permission evidence contains bits unknown to this build: ${unknownPermissionBits}`]
        : []),
      "Username, global name, and nickname are transient untrusted Discord content",
      "The operation key is one-shot and cannot be retried after reservation",
      "This workflow performs one exact non-retried mutation, one exact fresh readback, and never rolls back",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      banState: state.ban ? "banned" : "not-banned",
      botId,
      botMember: memberSnapshot(state.botMember),
      botPermissions: state.botPermissions.effectivePermissions,
      deleteMessageSeconds: request.deleteMessageSeconds,
      durationMinutes: request.durationMinutes,
      domain: "guildcontrol-member-moderation-plan.v2",
      guildId: request.guildId,
      guildOwnerId: state.guild.owner_id,
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      risks,
      roles: roleSnapshot(state.roles, relevantRoleIds),
      targetMember: state.targetMember ? memberSnapshot(state.targetMember) : null,
      targetPermissions: state.targetPermissions?.effectivePermissions ?? null,
      targetUser: {
        bot: state.targetUser.bot ?? false,
        id: state.targetUser.id,
      },
      userId: request.userId,
      verificationBoundary: boundary,
      warnings,
    })
    return {
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      createdAt: createdAt.toISOString(),
      digest,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      parameters: {
        deleteMessageSeconds: request.deleteMessageSeconds,
        durationMinutes: request.durationMinutes,
        estimatedTimeoutUntil,
      },
      permission,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      target: {
        banState: state.ban ? "banned" : "not-banned",
        bot: state.targetUser.bot ?? false,
        currentTimeoutUntil,
        globalName: state.targetUser.global_name ?? null,
        id: state.targetUser.id,
        membership: state.targetMember ? "member" : "non-member",
        nickname: state.targetMember?.nick ?? null,
        username: state.targetUser.username,
      },
      verificationBoundary: boundary,
      warnings,
    }
  }

  async #readback(
    request: NormalizedMemberModerationRequest,
    desiredTimeoutUntil: string | null,
    responseTimeoutUntil: string | null,
    options: RequestOptions,
  ): Promise<ModerationReadback> {
    if (request.action === "kick") {
      const member = await optionalDiscordEntity(
        this.#client.getGuildMember(request.guildId, request.userId, options),
      )
      if (member) exactMember(member, request.userId, "kick readback target")
      const state = member ? "member" : "non-member"
      return {
        observedState: { kind: "membership", state },
        timeoutUntil: null,
        verification: state === "non-member" ? "match" : "drift",
      }
    }
    if (request.action === "ban" || request.action === "unban") {
      const ban = await optionalDiscordEntity(
        this.#client.getGuildBan(request.guildId, request.userId, options),
      )
      if (ban) exactBan(ban, request.userId)
      const state = ban ? "banned" : "not-banned"
      const expected = request.action === "ban" ? "banned" : "not-banned"
      return {
        observedState: { kind: "ban", state },
        timeoutUntil: null,
        verification: state === expected ? "match" : "drift",
      }
    }
    const member = exactMember(
      await this.#client.getGuildMember(request.guildId, request.userId, options),
      request.userId,
      "timeout readback target",
    )
    const observedTimeoutUntil = timeoutState(member)
    const expectedTime = desiredTimeoutUntil === null
      ? null
      : Date.parse(desiredTimeoutUntil)
    const responseTime = responseTimeoutUntil === null
      ? null
      : Date.parse(responseTimeoutUntil)
    const observedTime = observedTimeoutUntil === null
      ? null
      : Date.parse(observedTimeoutUntil)
    return {
      observedState: {
        kind: "timeout",
        timeoutUntil: observedTimeoutUntil,
      },
      timeoutUntil: desiredTimeoutUntil,
      verification: responseTime === expectedTime && observedTime === expectedTime
        ? "match"
        : "drift",
    }
  }

  execute(
    applicationId: string,
    botId: string,
    request: MemberModerationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberModerationResult> {
    const normalized = normalizeMemberModerationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord administration plan digest is invalid")
    }
    return withTargetLock(
      this.#locks,
      targetKey(normalized.guildId, normalized.userId),
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new AdministrationExecutionError(
        "Discord member moderation was blocked because a prior same-member operation ended without a durable outcome",
        {
          action: normalized.action,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          userId: normalized.userId,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedMemberModerationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<MemberModerationResult> {
    let plan: MemberModerationPlan
    try {
      plan = await this.#planNormalized(
        applicationId,
        botId,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof AdministrationStateError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new AdministrationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new AdministrationPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      userId: request.userId,
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
      throw new AdministrationOperationConflictError(receiptView(reservation.receipt))
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
      throw new AdministrationExecutionError(
        "Discord member moderation was blocked because pending activity could not be recorded",
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
    let timeoutUntil: string | null = null
    let responseTimeoutUntil: string | null = null
    let readback: ModerationReadback
    try {
      mutationStarted = true
      if (request.action === "kick") {
        await this.#client.removeGuildMember(
          request.guildId,
          request.userId,
          request.auditReason,
          options,
        )
      } else if (request.action === "ban") {
        await this.#client.createGuildBan(
          request.guildId,
          request.userId,
          request.deleteMessageSeconds as number,
          request.auditReason,
          options,
        )
      } else if (request.action === "unban") {
        await this.#client.removeGuildBan(
          request.guildId,
          request.userId,
          request.auditReason,
          options,
        )
      } else {
        timeoutUntil = request.action === "timeout"
          ? new Date(
              this.#clock().getTime() + (request.durationMinutes as number) * 60_000,
            ).toISOString()
          : null
        const member = await this.#client.modifyGuildMemberTimeout(
          request.guildId,
          request.userId,
          { communicationDisabledUntil: timeoutUntil },
          request.auditReason,
          options,
        )
        mutationReturned = true
        responseTimeoutUntil = timeoutState(
          exactMember(member, request.userId, "timeout mutation response target"),
        )
      }
      mutationReturned = true
      readback = await this.#readback(
        request,
        timeoutUntil,
        responseTimeoutUntil,
        options,
      )
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
          timeoutUntil,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AdministrationExecutionError(
        "Discord member moderation did not complete with a verified outcome",
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
          timeoutUntil,
        },
        { cause: error },
      )
    }

    const status = readback.verification === "match"
      ? "completed"
      : "completed-with-drift"
    const result: MemberModerationResult = {
      ...baseResult,
      activityId,
      observedState: readback.observedState,
      status,
      timeoutUntil: readback.timeoutUntil,
      verification: readback.verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: readback.verification,
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
          timeoutUntil,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AdministrationExecutionError(
        "Discord member moderation completed but the operation receipt failed",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
          timeoutUntil,
          verification: readback.verification,
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
        timeoutUntil,
        timestamp: this.#clock().toISOString(),
        verification: readback.verification,
      }))
    } catch (error) {
      throw new AdministrationExecutionError(
        "Discord member moderation completed but the final activity record failed",
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
