import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildDepartureActivity,
  GuildDepartureActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  DiscordApiError,
  GuildDepartureEvidenceError,
  GuildDepartureExecutionError,
  GuildDepartureOperationConflictError,
  GuildDeparturePlanChangedError,
} from "./errors.js"
import {
  operationKeyHash,
  type OperationReceipt,
  type OperationStore,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "guild-membership-state-unavailable"
const REQUEST_KEYS = [
  "acknowledgeAccessLoss",
  "acknowledgeConcurrentOperationsStopped",
  "acknowledgeReinviteRequired",
  "guildId",
  "operationKey",
  "reviewReason",
] as const
const PRIVACY_OMITTED_FIELDS = [
  "guilds.otherGuildIds",
  "guilds.otherGuildNames",
  "guilds.otherGuildProfiles",
  "member",
  "permissions",
  "rawPayloads",
  "reviewReason",
] as const
const GUILD_DEPARTURE_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()

export interface GuildDepartureRequest {
  acknowledgeAccessLoss: boolean
  acknowledgeConcurrentOperationsStopped: boolean
  acknowledgeReinviteRequired: boolean
  guildId: string
  operationKey: string
  reviewReason: string
}

export interface NormalizedGuildDepartureRequest extends Omit<
  GuildDepartureRequest,
  "operationKey"
> {
  operationKeyHash: string
}

export interface GuildDeparturePrivacyProjection {
  otherGuildIdentitiesProjectedOut: true
  omittedFields: typeof PRIVACY_OMITTED_FIELDS
  persistence: "content-free-identifiers-only"
  rawPayloads: "omitted"
  targetGuildName: "transient-review-only"
}

export interface GuildDeparturePlan {
  acknowledgments: {
    accessLoss: true
    concurrentOperationsStopped: true
    reinviteRequired: true
  }
  action: "leave"
  applicationId: string
  botId: string
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
    requesterIsOwner: false
  }
  membership: {
    botMemberVerified: true
    complete: true
    inspectedGuilds: number
    pages: number
    present: true
  }
  operationKeyHash: string
  privacy: GuildDeparturePrivacyProjection
  reviewReason: string
  schemaVersion: number
  status: "planned"
  warnings: string[]
}

export interface GuildDepartureResult {
  activityId: string
  applicationId: string
  botId: string
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed"
  verifiedAbsent: true
}

export interface GuildDepartureServiceClient extends Pick<
  DiscordClient,
  "getGuild" | "getGuildMember" | "leaveGuild" | "listCurrentUserGuilds"
> {}

export interface GuildDepartureServiceOptions {
  activityStore: ActivityStore
  client: GuildDepartureServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertGuildDepartureAllowed">
  randomId?: () => string
}

interface CurrentGuildTarget {
  id: string
  name: string
  owner: boolean
}

interface CurrentGuildInventory {
  complete: true
  inspectedGuilds: number
  pages: number
  target: CurrentGuildTarget | null
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, description: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
}

export function normalizeGuildDepartureRequest(
  request: GuildDepartureRequest,
): NormalizedGuildDepartureRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild departure request must be an object")
  }
  if (!hasExactKeys(request as unknown as Record<string, unknown>, REQUEST_KEYS)) {
    throw new RangeError("Discord guild departure request must contain exact fields")
  }
  assertPositiveSnowflake(request.guildId, "Discord departure guild ID")
  if (
    typeof request.acknowledgeAccessLoss !== "boolean"
    || typeof request.acknowledgeConcurrentOperationsStopped !== "boolean"
    || typeof request.acknowledgeReinviteRequired !== "boolean"
    || !validText(
      request.reviewReason,
      CONNECTOR_LIMITS.guildDepartureReviewReasonCharacters,
    )
  ) {
    throw new RangeError("Discord guild departure request fields are invalid")
  }
  return {
    acknowledgeAccessLoss: request.acknowledgeAccessLoss,
    acknowledgeConcurrentOperationsStopped: request.acknowledgeConcurrentOperationsStopped,
    acknowledgeReinviteRequired: request.acknowledgeReinviteRequired,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
    reviewReason: request.reviewReason,
  }
}

function evidenceError(message: string, cause?: unknown): GuildDepartureEvidenceError {
  return new GuildDepartureEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function exactGuild(value: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validText(value.name, DISCORD_LIMITS.guildNameCharacters)
    || !positiveSnowflake(value.owner_id)
  ) {
    throw evidenceError("Discord returned invalid departure guild evidence")
  }
  return value
}

function exactBotMember(value: DiscordGuildMember, botId: string): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(value.roles).size !== value.roles.length
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
  ) {
    throw evidenceError("Discord returned invalid connector bot membership evidence")
  }
  return value
}

function currentGuildTarget(value: DiscordGuild): CurrentGuildTarget {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !positiveSnowflake(value.id)
    || !validText(value.name, DISCORD_LIMITS.guildNameCharacters)
    || typeof value.owner !== "boolean"
  ) {
    throw evidenceError("Discord returned invalid current-guild membership evidence")
  }
  return { id: value.id, name: value.name, owner: value.owner }
}

function privacyProjection(): GuildDeparturePrivacyProjection {
  return {
    otherGuildIdentitiesProjectedOut: true,
    omittedFields: PRIVACY_OMITTED_FIELDS,
    persistence: "content-free-identifiers-only",
    rawPayloads: "omitted",
    targetGuildName: "transient-review-only",
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
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
  error?: string | null
  plan: GuildDeparturePlan
  request: NormalizedGuildDepartureRequest
  status: GuildDepartureActivityStatus
  timestamp: string
  verification?: "match" | null
}): GuildDepartureActivity {
  return {
    applicationId: options.plan.applicationId,
    botId: options.plan.botId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-departure",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: GuildDeparturePlan
  request: NormalizedGuildDepartureRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-departure",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.guildId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof GuildDepartureExecutionError)
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
  priorUncertainError: () => GuildDepartureExecutionError,
): Promise<T> {
  const prior = GUILD_DEPARTURE_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  GUILD_DEPARTURE_LOCKS.set(guildId, tail)
  let outcome: "settled" | "uncertain" = "settled"
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
    release(outcome)
    if (outcome === "settled" && GUILD_DEPARTURE_LOCKS.get(guildId) === tail) {
      GUILD_DEPARTURE_LOCKS.delete(guildId)
    }
  }
}

export class GuildDepartureService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildDepartureServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: GuildDepartureServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: GuildDepartureServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #currentGuildInventory(
    targetGuildId: string,
    options: RequestOptions,
  ): Promise<CurrentGuildInventory> {
    const seen = new Set<string>()
    let after: string | undefined
    let pages = 0
    let target: CurrentGuildTarget | null = null
    while (pages < CONNECTOR_LIMITS.guildDepartureGuildPages) {
      const rawPage = await this.#client.listCurrentUserGuilds({
        ...options,
        ...(after === undefined ? {} : { after }),
        limit: DISCORD_LIMITS.currentUserGuilds,
      })
      if (
        !Array.isArray(rawPage)
        || rawPage.length > DISCORD_LIMITS.currentUserGuilds
      ) {
        throw evidenceError("Discord returned an invalid current-guild membership page")
      }
      pages += 1
      let maximumId: string | undefined
      for (const value of rawPage) {
        const guild = currentGuildTarget(value)
        if (
          seen.has(guild.id)
          || (after !== undefined && BigInt(guild.id) <= BigInt(after))
        ) {
          throw evidenceError(
            "Discord returned duplicate or cursor-violating current-guild membership evidence",
          )
        }
        seen.add(guild.id)
        if (maximumId === undefined || BigInt(guild.id) > BigInt(maximumId)) {
          maximumId = guild.id
        }
        if (guild.id === targetGuildId) {
          if (target !== null) {
            throw evidenceError("Discord returned duplicate target guild membership evidence")
          }
          target = guild
        }
      }
      if (rawPage.length < DISCORD_LIMITS.currentUserGuilds) {
        return {
          complete: true,
          inspectedGuilds: seen.size,
          pages,
          target,
        }
      }
      if (maximumId === undefined || maximumId === after) {
        throw evidenceError("Discord current-guild membership cursor did not advance")
      }
      after = maximumId
    }
    throw evidenceError("Discord current-guild membership inventory exceeded its safety bound")
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedGuildDepartureRequest,
    options: RequestOptions,
  ): Promise<GuildDeparturePlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertGuildDepartureAllowed(request.guildId)
    const priorReceipt = await this.#operationStore.get(
      "guild-departure",
      request.operationKeyHash,
    )
    if (priorReceipt) {
      throw new GuildDepartureOperationConflictError(receiptView(priorReceipt))
    }
    if (!request.acknowledgeAccessLoss) {
      throw new RangeError("Discord guild departure requires acknowledging immediate access loss")
    }
    if (!request.acknowledgeReinviteRequired) {
      throw new RangeError("Discord guild departure requires acknowledging separate re-entry")
    }
    if (!request.acknowledgeConcurrentOperationsStopped) {
      throw new RangeError(
        "Discord guild departure requires acknowledging that overlapping guild work is stopped",
      )
    }
    const [inventory, rawGuild, rawMember] = await Promise.all([
      this.#currentGuildInventory(request.guildId, options),
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
    ])
    const guild = exactGuild(rawGuild, request.guildId)
    exactBotMember(rawMember, botId)
    if (!inventory.target) {
      throw evidenceError("Discord connector bot is absent from the complete guild inventory")
    }
    if (inventory.target.name !== guild.name) {
      throw evidenceError("Discord returned inconsistent target guild identity evidence")
    }
    const botIsOwner = guild.owner_id === botId
    if (inventory.target.owner !== botIsOwner) {
      throw evidenceError("Discord returned inconsistent requester ownership evidence")
    }
    if (botIsOwner) {
      throw evidenceError("Discord connector bot cannot leave a guild it owns")
    }
    const acknowledgments = {
      accessLoss: true as const,
      concurrentOperationsStopped: true as const,
      reinviteRequired: true as const,
    }
    const privacy = privacyProjection()
    const warnings = [
      "The connector bot will immediately lose access to this guild",
      "A separate Discord invitation or installation action is required to restore bot access",
      "Pending workflows, resources, and Gateway state for this guild become unusable after departure",
      "Discord does not document an audit-log reason for guild departure; the review reason remains local and transient",
      "All other guild identities and raw membership payloads are projected out",
      "All connector and external operations against this guild must remain stopped until departure settles",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      "The connector sends one non-retried departure request and does not roll the operation back",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      acknowledgments,
      applicationId,
      botId,
      botMemberRoleIds: [...rawMember.roles].sort(),
      domain: "discord-mcp-guild-departure-plan.v1",
      guild: {
        id: guild.id,
        name: guild.name,
        ownerId: guild.owner_id,
        requesterIsOwner: false,
      },
      inventory: {
        complete: true,
        inspectedGuilds: inventory.inspectedGuilds,
        pages: inventory.pages,
        target: inventory.target,
      },
      privacy,
      request,
      warnings,
    })
    return {
      acknowledgments,
      action: "leave",
      applicationId,
      botId,
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: guild.id,
        name: guild.name,
        requesterIsOwner: false,
      },
      membership: {
        botMemberVerified: true,
        complete: true,
        inspectedGuilds: inventory.inspectedGuilds,
        pages: inventory.pages,
        present: true,
      },
      operationKeyHash: request.operationKeyHash,
      privacy,
      reviewReason: request.reviewReason,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      warnings,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: GuildDepartureRequest,
    options: RequestOptions = {},
  ): Promise<GuildDeparturePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeGuildDepartureRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildDepartureRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildDepartureResult> {
    const normalized = normalizeGuildDepartureRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild departure plan digest is invalid")
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
      () => new GuildDepartureExecutionError(
        "Discord guild departure was blocked because a prior same-guild operation ended with an uncertain outcome",
        {
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedGuildDepartureRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildDepartureResult> {
    let plan: GuildDeparturePlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof GuildDepartureEvidenceError
        || error instanceof DiscordApiError && [403, 404].includes(error.status)
      ) {
        throw new GuildDeparturePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new GuildDeparturePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      applicationId,
      botId,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
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
      throw new GuildDepartureOperationConflictError(receiptView(reservation.receipt))
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
      throw new GuildDepartureExecutionError(
        "Discord guild departure was blocked because pending activity could not be recorded",
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

    let mutationCompleted = false
    try {
      await this.#client.leaveGuild(request.guildId, options)
      mutationCompleted = true
      const observed = await this.#currentGuildInventory(request.guildId, options)
      if (observed.target !== null) {
        throw evidenceError("Discord guild departure readback still reports target membership")
      }
    } catch (error) {
      const settledClientFailure = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429
      const status = settledClientFailure ? "failed" : "uncertain"
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
      throw new GuildDepartureExecutionError(
        "Discord guild departure did not complete with exact verified state",
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
          verifiedAbsent: null,
        },
        { cause: error },
      )
    }

    const result: GuildDepartureResult = {
      ...baseResult,
      activityId,
      status: "completed",
      verifiedAbsent: true,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
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
      throw new GuildDepartureExecutionError(
        "Discord guild departure completed but the operation receipt failed",
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
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new GuildDepartureExecutionError(
        "Discord guild departure completed but the final activity record failed",
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
