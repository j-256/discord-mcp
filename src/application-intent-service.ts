import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ApplicationIntentActivity,
  ApplicationIntentActivityStatus,
} from "./activity-log.js"
import {
  type ApplicationFlagEvidence,
  type ApplicationFlagEvidenceSource,
  type ApplicationMessageContentRequirement,
  type ApplicationPostureRequirements,
  projectApplicationFlagEvidence,
} from "./application-posture.js"
import {
  DISCORD_APPLICATION_FLAGS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  ApplicationIntentEvidenceError,
  ApplicationIntentExecutionError,
  ApplicationIntentOperationConflictError,
  ApplicationIntentPlanChangedError,
  DiscordApiError,
  PolicyError,
} from "./errors.js"
import {
  type ApplicationOperationReceipt,
  type ApplicationOperationStore,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type { DiscordApplication, RequestOptions } from "./types.js"

export const APPLICATION_INTENTS = Object.freeze([
  "guild-members",
  "message-content",
] as const)

export type ApplicationIntent = typeof APPLICATION_INTENTS[number]

export interface ApplicationIntentEnablementRequest {
  acknowledgePrivilegeExpansion: true
  intent: ApplicationIntent
  operationKey: string
  reviewReason: string
}

export interface NormalizedApplicationIntentEnablementRequest {
  acknowledgePrivilegeExpansion: true
  intent: ApplicationIntent
  operationKeyHash: string
  reviewReason: string
}

export interface ApplicationIntentState {
  enabled: boolean
  evidenceSource: ApplicationFlagEvidenceSource
  fullAuthorization: boolean
  limitedToggle: boolean
}

export interface ApplicationIntentEnablementPlan {
  applicationId: string
  botId: string
  createdAt: string
  current: ApplicationIntentState
  desired: {
    enabled: true
    method: "limited-application-flag"
  }
  digest: string
  effect: "change" | "none"
  intent: ApplicationIntent
  operationKeyHash: string
  policyRequirement: "recommended" | "required"
  privacy: {
    omittedFields: readonly [
      "raw-application-flags",
      "review-reason",
      "raw-operation-key",
      "raw-discord-application",
    ]
    persistence: "content-free-records-only"
  }
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verification: {
    applicationIdentity: "exact"
    flagTransition: "exact-additive-single-intent"
    freshReadback: true
    nonTargetFlags: "preserved"
    response: "strict-current-application"
  }
  warnings: string[]
  writeRequired: boolean
}

export interface ApplicationIntentEnablementResult {
  activityId: string | null
  applicationId: string
  intent: ApplicationIntent
  observed: ApplicationIntentState
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed"
}

export interface ApplicationIntentServiceClient {
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  modifyCurrentApplicationFlags: DiscordClient["modifyCurrentApplicationFlags"]
}

export interface ApplicationIntentServiceOptions {
  activityStore: ActivityStore
  client: ApplicationIntentServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface ApplicationIntentBits {
  full: bigint
  limited: bigint
}

interface BuiltApplicationIntentPlan {
  expectedFlags: bigint
  outgoingLimitedMask: number
  plan: ApplicationIntentEnablementPlan
}

type ApplicationIntentTargetOutcome = "settled" | "uncertain"

const APPLICATION_INTENT_STATE_UNAVAILABLE = "application-intent-state-unavailable"
const REVIEW_REASON_CHARACTERS = 512
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const EDITABLE_LIMITED_FLAG_MASK = DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited
  | DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited
  | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited
const INTENT_BITS = Object.freeze({
  "guild-members": Object.freeze({
    full: DISCORD_APPLICATION_FLAGS.gatewayGuildMembers,
    limited: DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited,
  }),
  "message-content": Object.freeze({
    full: DISCORD_APPLICATION_FLAGS.gatewayMessageContent,
    limited: DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited,
  }),
}) satisfies Readonly<Record<ApplicationIntent, ApplicationIntentBits>>
const APPLICATION_INTENT_LOCKS = new Map<
  string,
  Promise<ApplicationIntentTargetOutcome>
>()
const PRIVACY_PROJECTION = Object.freeze({
  omittedFields: Object.freeze([
    "raw-application-flags",
    "review-reason",
    "raw-operation-key",
    "raw-discord-application",
  ] as const),
  persistence: "content-free-records-only" as const,
})

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const normalizedExpected = [...expected].sort()
  return actual.length === normalizedExpected.length
    && actual.every((key, index) => key === normalizedExpected[index])
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${name} must be a positive Discord snowflake ID`)
  }
}

function normalizeReviewReason(value: unknown): string {
  if (
    typeof value !== "string"
    || value.trim().length < 1
    || value.length > REVIEW_REASON_CHARACTERS
    || CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord application intent review reason must contain 1-${REVIEW_REASON_CHARACTERS} safe characters`,
    )
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(
      "Discord application intent review reason contains invalid Unicode",
      { cause: error },
    )
  }
  return value
}

export function normalizeApplicationIntentEnablementRequest(
  request: ApplicationIntentEnablementRequest,
): NormalizedApplicationIntentEnablementRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord application intent request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !exactKeys(record, [
      "acknowledgePrivilegeExpansion",
      "intent",
      "operationKey",
      "reviewReason",
    ])
    || record.acknowledgePrivilegeExpansion !== true
    || typeof record.intent !== "string"
    || !(APPLICATION_INTENTS as readonly string[]).includes(record.intent)
  ) {
    throw new RangeError(
      "Discord application intent request requires exact target and privilege acknowledgement",
    )
  }
  return {
    acknowledgePrivilegeExpansion: true,
    intent: record.intent as ApplicationIntent,
    operationKeyHash: operationKeyHash(record.operationKey as string),
    reviewReason: normalizeReviewReason(record.reviewReason),
  }
}

export function applicationIntentPolicyRequirement(
  intent: ApplicationIntent,
  requirements: ApplicationPostureRequirements,
): "recommended" | "required" {
  if (intent === "guild-members") {
    if (!requirements.guildMembersIntentRequired) {
      throw new PolicyError(
        "Discord Guild Members intent enablement requires member-directory policy",
      )
    }
    return "required"
  }
  const requirement: ApplicationMessageContentRequirement =
    requirements.messageContentIntent
  if (requirement === "not-required") {
    throw new PolicyError(
      "Discord Message Content intent enablement requires a configured tool that uses it",
    )
  }
  return requirement
}

function validateApplicationIdentity(
  application: DiscordApplication,
  applicationId: string,
  botId: string,
): void {
  if (
    !application
    || typeof application !== "object"
    || Array.isArray(application)
    || application.id !== applicationId
    || (
      application.bot?.id !== undefined
      && application.bot.id !== botId
    )
  ) {
    throw new ApplicationIntentEvidenceError(
      "Discord returned current-application evidence for a different identity",
    )
  }
}

function exactFlagEvidence(
  application: DiscordApplication,
  applicationId: string,
  botId: string,
): ApplicationFlagEvidence {
  validateApplicationIdentity(application, applicationId, botId)
  let evidence: ApplicationFlagEvidence | null
  try {
    evidence = projectApplicationFlagEvidence(application)
  } catch (error) {
    throw new ApplicationIntentEvidenceError(
      "Discord returned invalid current-application flag evidence",
      { cause: error },
    )
  }
  if (!evidence) {
    throw new ApplicationIntentEvidenceError(
      "Discord did not return authoritative current-application flag evidence",
    )
  }
  return evidence
}

function intentState(
  evidence: ApplicationFlagEvidence,
  intent: ApplicationIntent,
): ApplicationIntentState {
  const bits = INTENT_BITS[intent]
  const fullAuthorization = (evidence.value & bits.full) !== 0n
  const limitedToggle = (evidence.value & bits.limited) !== 0n
  return {
    enabled: fullAuthorization || limitedToggle,
    evidenceSource: evidence.source,
    fullAuthorization,
    limitedToggle,
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

function applicationOperationStore(
  store: OperationStore,
): ApplicationOperationStore {
  if (
    !store.finishApplication
    || !store.getApplication
    || !store.reserveApplication
  ) {
    throw new ApplicationIntentExecutionError(
      "Discord application intent enablement requires an application-scoped operation store",
      { status: "blocked-operation-store-incompatible" },
    )
  }
  return store as ApplicationOperationStore
}

function activityEntry(options: {
  activityId: string
  applicationId: string
  botId: string
  error?: string | null
  plan: ApplicationIntentEnablementPlan
  status: ApplicationIntentActivityStatus
  timestamp: string
  verification?: "match" | null
}): ApplicationIntentActivity {
  return {
    applicationId: options.applicationId,
    botId: options.botId,
    error: options.error ?? null,
    id: options.activityId,
    intent: options.plan.intent,
    kind: "application-intent-enablement",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  applicationId: string
  error?: string | null
  plan: ApplicationIntentEnablementPlan
  status: ApplicationOperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): ApplicationOperationReceipt {
  return {
    activityId: options.activityId,
    applicationId: options.applicationId,
    error: options.error ?? null,
    kind: "application-intent-enablement",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.applicationId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function receiptView(receipt: ApplicationOperationReceipt) {
  return {
    activityId: receipt.activityId,
    applicationId: receipt.applicationId,
    error: receipt.error,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function executionBlocksApplication(error: unknown): boolean {
  if (
    !(error instanceof ApplicationIntentExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-operation-record-failed", "uncertain"]
    .includes(String(error.result.status))
}

async function withApplicationLock<T>(
  applicationId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ApplicationIntentExecutionError,
): Promise<T> {
  const prior = APPLICATION_INTENT_LOCKS.get(applicationId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ApplicationIntentTargetOutcome) => void = () => undefined
  const tail = new Promise<ApplicationIntentTargetOutcome>((resolve) => {
    release = resolve
  })
  APPLICATION_INTENT_LOCKS.set(applicationId, tail)
  let outcome: ApplicationIntentTargetOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksApplication(error)) outcome = "uncertain"
    throw error
  } finally {
    release(outcome)
    if (APPLICATION_INTENT_LOCKS.get(applicationId) === tail) {
      APPLICATION_INTENT_LOCKS.delete(applicationId)
    }
  }
}

export class ApplicationIntentService {
  readonly #activityStore: ActivityStore
  readonly #client: ApplicationIntentServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ApplicationIntentServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    requirements: ApplicationPostureRequirements,
    request: NormalizedApplicationIntentEnablementRequest,
    options: RequestOptions,
  ): Promise<BuiltApplicationIntentPlan> {
    this.#policy.assertApplicationIntentChangeAllowed()
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    const requirement = applicationIntentPolicyRequirement(
      request.intent,
      requirements,
    )
    const application = await this.#client.getCurrentApplication(options)
    const evidence = exactFlagEvidence(application, applicationId, botId)
    const current = intentState(evidence, request.intent)
    const bits = INTENT_BITS[request.intent]
    const outgoingLimitedMask = Number(
      (evidence.value & EDITABLE_LIMITED_FLAG_MASK) | bits.limited,
    )
    if (
      !Number.isSafeInteger(outgoingLimitedMask)
      || outgoingLimitedMask < 0
      || outgoingLimitedMask > Number(EDITABLE_LIMITED_FLAG_MASK)
    ) {
      throw new ApplicationIntentEvidenceError(
        "Discord current-application flags cannot be represented by the limited intent request",
      )
    }
    const expectedFlags = evidence.value | bits.limited
    const effect = current.enabled ? "none" : "change"
    const risks = [
      "This enables a privileged intent for the application across every guild installation",
      "Discord's current-application PATCH has no conditional update, so an external Developer Portal edit can race this workflow",
      "Discord does not document audit-log reason support for current-application changes",
      "The operation key is one-shot and cannot be retried after reservation",
    ]
    const warnings = [
      "The review reason is bound to this plan but is neither sent to Discord nor persisted",
      "The raw operation key and application flag values are never returned or persisted",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      expectedFlags: expectedFlags.toString(10),
      observedFlags: evidence.value.toString(10),
      outgoingLimitedMask,
      policyRequirement: requirement,
      request,
      risks,
      warnings,
    })
    return {
      expectedFlags,
      outgoingLimitedMask,
      plan: {
        applicationId,
        botId,
        createdAt: this.#clock().toISOString(),
        current,
        desired: {
          enabled: true,
          method: "limited-application-flag",
        },
        digest,
        effect,
        intent: request.intent,
        operationKeyHash: request.operationKeyHash,
        policyRequirement: requirement,
        privacy: PRIVACY_PROJECTION,
        risks,
        schemaVersion: SCHEMA_VERSION,
        status: effect === "change" ? "planned" : "already-current",
        verification: {
          applicationIdentity: "exact",
          flagTransition: "exact-additive-single-intent",
          freshReadback: true,
          nonTargetFlags: "preserved",
          response: "strict-current-application",
        },
        warnings,
        writeRequired: effect === "change",
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    requirements: ApplicationPostureRequirements,
    request: ApplicationIntentEnablementRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationIntentEnablementPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      requirements,
      normalizeApplicationIntentEnablementRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    requirements: ApplicationPostureRequirements,
    request: ApplicationIntentEnablementRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationIntentEnablementResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord application intent plan digest is invalid")
    }
    const normalized = normalizeApplicationIntentEnablementRequest(request)
    return withApplicationLock(
      applicationId,
      () => this.#executeLocked(
        applicationId,
        botId,
        requirements,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ApplicationIntentExecutionError(
        "Discord application intent changes are blocked after an uncertain same-application outcome",
        {
          applicationId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeLocked(
    applicationId: string,
    botId: string,
    requirements: ApplicationPostureRequirements,
    request: NormalizedApplicationIntentEnablementRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ApplicationIntentEnablementResult> {
    let built: BuiltApplicationIntentPlan
    try {
      built = await this.#buildPlan(
        applicationId,
        botId,
        requirements,
        request,
        options,
      )
    } catch (error) {
      if (error instanceof ApplicationIntentEvidenceError) {
        throw new ApplicationIntentPlanChangedError(
          expectedDigest,
          APPLICATION_INTENT_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { expectedFlags, outgoingLimitedMask, plan } = built
    if (plan.digest !== expectedDigest) {
      throw new ApplicationIntentPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      applicationId,
      intent: request.intent,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      return {
        ...baseResult,
        activityId: null,
        observed: plan.current,
        status: "already-current",
      }
    }

    const operationStore = applicationOperationStore(this.#operationStore)
    const activityId = this.#randomId()
    const reservation = await operationStore.reserveApplication(operationReceipt({
      activityId,
      applicationId,
      plan,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ApplicationIntentOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        applicationId,
        botId,
        plan,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await operationStore.finishApplication(operationReceipt({
          activityId,
          applicationId,
          error: safeErrorCode(error),
          plan,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ApplicationIntentExecutionError(
        "Discord application intent enablement was blocked because pending activity could not be recorded",
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

    let mutationResponseReceived = false
    let observed: ApplicationIntentState | null = null
    try {
      const modified = await this.#client.modifyCurrentApplicationFlags(
        { flags: outgoingLimitedMask },
        options,
      )
      mutationResponseReceived = true
      const responseEvidence = exactFlagEvidence(modified, applicationId, botId)
      if (responseEvidence.value !== expectedFlags) {
        throw new ApplicationIntentEvidenceError(
          "Discord current-application response did not match the exact reviewed flag transition",
        )
      }
      const readback = await this.#client.getCurrentApplication(options)
      const readbackEvidence = exactFlagEvidence(readback, applicationId, botId)
      if (readbackEvidence.value !== expectedFlags) {
        throw new ApplicationIntentEvidenceError(
          "Discord current-application readback did not match the exact reviewed flag transition",
        )
      }
      observed = intentState(readbackEvidence, request.intent)
      if (!observed.enabled || !observed.limitedToggle) {
        throw new ApplicationIntentEvidenceError(
          "Discord current-application readback did not enable the reviewed limited intent",
        )
      }
    } catch (error) {
      const status = !mutationResponseReceived
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await operationStore.finishApplication(operationReceipt({
          activityId,
          applicationId,
          error: errorCode,
          plan,
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
          applicationId,
          botId,
          error: errorCode,
          plan,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationIntentExecutionError(
        "Discord application intent enablement did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          observed,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const result: ApplicationIntentEnablementResult = {
      ...baseResult,
      activityId,
      observed: observed!,
      status: "completed",
    }
    try {
      await operationStore.finishApplication(operationReceipt({
        activityId,
        applicationId,
        plan,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          applicationId,
          botId,
          error: safeErrorCode(error),
          plan,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationIntentExecutionError(
        "Discord application intent enablement completed but the operation receipt failed",
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
        applicationId,
        botId,
        plan,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new ApplicationIntentExecutionError(
        "Discord application intent enablement completed but the final activity record failed",
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
