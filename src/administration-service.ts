import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MemberModerationActivity,
  MemberModerationActivityAction,
} from "./activity-log.js"
import {
  ADMINISTRATION_LIMITS,
  DISCORD_LIMITS,
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
  AdministrationPlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
import {
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

export interface MemberModerationRequest {
  action: MemberModerationActivityAction
  auditReason: string
  deleteMessageSeconds?: number
  durationMinutes?: number
  guildId: string
  userId: string
}

export interface NormalizedMemberModerationRequest {
  action: MemberModerationActivityAction
  auditReason: string
  deleteMessageSeconds: number | null
  durationMinutes: number | null
  guildId: string
  userId: string
}

export interface MemberModerationPlan {
  action: MemberModerationActivityAction
  auditReason: string
  createdAt: string
  digest: string
  guildId: string
  parameters: {
    deleteMessageSeconds: number | null
    durationMinutes: number | null
    estimatedTimeoutUntil: string | null
  }
  permission: {
    botAdministrator: boolean
    botHighestRolePosition: number
    required: DiscordPermissionName
    targetAdministrator: boolean | null
    targetHighestRolePosition: number | null
  }
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
}

export interface MemberModerationResult {
  action: MemberModerationActivityAction
  activityId: string
  guildId: string
  planDigest: string
  schemaVersion: number
  status: "completed"
  timeoutUntil: string | null
  userId: string
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

class AdministrationStateError extends Error {
  override name = "AdministrationStateError"
}

class AdministrationResponseIdentityError extends Error {
  override name = "AdministrationResponseIdentityError"
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
  if (!ACTIONS.has(request.action)) {
    throw new RangeError("Discord member moderation action is not supported")
  }
  if (
    !DISCORD_SNOWFLAKE_PATTERN.test(request.guildId)
    || !DISCORD_SNOWFLAKE_PATTERN.test(request.userId)
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

function activityError(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError status=${error.status} code=${error.code ?? "unknown"}`
  }
  return error instanceof Error ? error.name : "UnknownError"
}

function failureStatus(error: unknown): "failed" | "uncertain" {
  if (error instanceof DiscordApiError && error.status >= 400 && error.status < 500) {
    return "failed"
  }
  return "uncertain"
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: MemberModerationPlan
  request: NormalizedMemberModerationRequest
  status: MemberModerationActivity["status"]
  timeoutUntil?: string | null
  timestamp: string
}): MemberModerationActivity {
  return {
    action: options.request.action,
    deleteMessageSeconds: options.request.deleteMessageSeconds,
    durationMinutes: options.request.durationMinutes,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "member-moderation",
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timeoutUntil: options.timeoutUntil ?? null,
    timestamp: options.timestamp,
    userId: options.request.userId,
  }
}

export class AdministrationService {
  readonly #activityStore: ActivityStore
  readonly #client: AdministrationServiceOptions["client"]
  readonly #clock: () => Date
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: AdministrationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async plan(
    botId: string,
    request: MemberModerationRequest,
    options: RequestOptions = {},
  ): Promise<MemberModerationPlan> {
    return this.#planNormalized(
      botId,
      normalizeMemberModerationRequest(request),
      options,
    )
  }

  async #state(
    botId: string,
    request: NormalizedMemberModerationRequest,
    options: RequestOptions,
  ): Promise<ModerationState> {
    this.#policy.assertMemberAdministrationAllowed(request.guildId, request.userId)
    if (request.userId === botId) {
      throw new AdministrationStateError("The connector bot cannot moderate itself")
    }

    const [guild, botMember, roles] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
    ])
    if (
      guild.id !== request.guildId
      || !guild.owner_id
      || !DISCORD_SNOWFLAKE_PATTERN.test(guild.owner_id)
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
    botId: string,
    request: NormalizedMemberModerationRequest,
    options: RequestOptions,
  ): Promise<MemberModerationPlan> {
    const state = await this.#state(botId, request, options)
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
    const digest = reviewedPlanDigest(this.#planKey, {
      action: request.action,
      auditReason: request.auditReason,
      banState: state.ban ? "banned" : "not-banned",
      botId,
      botMember: memberSnapshot(state.botMember),
      botPermissions: state.botPermissions.effectivePermissions,
      deleteMessageSeconds: request.deleteMessageSeconds,
      durationMinutes: request.durationMinutes,
      guildId: request.guildId,
      guildOwnerId: state.guild.owner_id,
      roles: roleSnapshot(state.roles, relevantRoleIds),
      targetMember: state.targetMember ? memberSnapshot(state.targetMember) : null,
      targetPermissions: state.targetPermissions?.effectivePermissions ?? null,
      targetUser: {
        bot: state.targetUser.bot ?? false,
        id: state.targetUser.id,
      },
      userId: request.userId,
    })
    return {
      action: request.action,
      auditReason: request.auditReason,
      createdAt: createdAt.toISOString(),
      digest,
      guildId: request.guildId,
      parameters: {
        deleteMessageSeconds: request.deleteMessageSeconds,
        durationMinutes: request.durationMinutes,
        estimatedTimeoutUntil,
      },
      permission: {
        botAdministrator: state.botPermissions.administrator,
        botHighestRolePosition: state.botPermissions.highestRolePosition,
        required: requiredPermission(request.action),
        targetAdministrator: state.targetPermissions?.administrator ?? null,
        targetHighestRolePosition: state.targetPermissions?.highestRolePosition ?? null,
      },
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
    }
  }

  async execute(
    botId: string,
    request: MemberModerationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberModerationResult> {
    const normalized = normalizeMemberModerationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord administration plan digest is invalid")
    }
    let plan: MemberModerationPlan
    try {
      plan = await this.#planNormalized(botId, normalized, options)
    } catch (error) {
      if (
        error instanceof AdministrationStateError
        || (error instanceof DiscordApiError && error.status === 404)
      ) {
        throw new AdministrationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new AdministrationPlanChangedError(expectedDigest, plan.digest)
    }

    const activityId = this.#randomId()
    await this.#activityStore.append(activityEntry({
      activityId,
      plan,
      request: normalized,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))

    let timeoutUntil: string | null = null
    try {
      if (normalized.action === "kick") {
        await this.#client.removeGuildMember(
          normalized.guildId,
          normalized.userId,
          normalized.auditReason,
          options,
        )
      } else if (normalized.action === "ban") {
        await this.#client.createGuildBan(
          normalized.guildId,
          normalized.userId,
          normalized.deleteMessageSeconds as number,
          normalized.auditReason,
          options,
        )
      } else if (normalized.action === "unban") {
        await this.#client.removeGuildBan(
          normalized.guildId,
          normalized.userId,
          normalized.auditReason,
          options,
        )
      } else {
        timeoutUntil = normalized.action === "timeout"
          ? new Date(
              this.#clock().getTime() + (normalized.durationMinutes as number) * 60_000,
            ).toISOString()
          : null
        const member = await this.#client.modifyGuildMemberTimeout(
          normalized.guildId,
          normalized.userId,
          { communicationDisabledUntil: timeoutUntil },
          normalized.auditReason,
          options,
        )
        const returnedTimeoutUntil = member.communication_disabled_until ?? null
        const timeoutMatches = timeoutUntil === null
          ? returnedTimeoutUntil === null
          : returnedTimeoutUntil !== null
            && !Number.isNaN(Date.parse(returnedTimeoutUntil))
            && Date.parse(returnedTimeoutUntil) === Date.parse(timeoutUntil)
        if (!member.user || member.user.id !== normalized.userId || !timeoutMatches) {
          throw new AdministrationResponseIdentityError(
            "Discord returned mismatched member state after timeout modification",
          )
        }
      }
    } catch (error) {
      const status = failureStatus(error)
      const result = {
        action: normalized.action,
        activityId,
        error: activityError(error),
        guildId: normalized.guildId,
        planDigest: plan.digest,
        retryAfterMs: error instanceof DiscordApiError
          ? error.retryAfterMs ?? null
          : null,
        schemaVersion: SCHEMA_VERSION,
        status,
        timeoutUntil,
        userId: normalized.userId,
      }
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: result.error,
          plan,
          request: normalized,
          status,
          timeoutUntil,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (auditError) {
        result.error = `${result.error}; final activity write failed: ${errorMessage(auditError)}`
      }
      throw new AdministrationExecutionError(
        "Discord member moderation did not complete with a known successful outcome",
        result,
        { cause: error },
      )
    }

    const result: MemberModerationResult = {
      action: normalized.action,
      activityId,
      guildId: normalized.guildId,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      timeoutUntil,
      userId: normalized.userId,
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: normalized,
        status: "completed",
        timeoutUntil,
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      throw new AdministrationExecutionError(
        "Discord member moderation completed but the final activity record failed",
        {
          ...result,
          auditError: errorMessage(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return result
  }
}
