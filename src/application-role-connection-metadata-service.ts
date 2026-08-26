import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ApplicationRoleConnectionMetadataActivity,
  ApplicationRoleConnectionMetadataActivityStatus,
} from "./activity-log.js"
import {
  ApplicationRoleConnectionMetadataDefinitionError,
  applicationRoleConnectionMetadataRecordDigest,
  applicationRoleConnectionMetadataSchemaBody,
  applicationRoleConnectionMetadataSchemaDigest,
  normalizeApplicationRoleConnectionMetadataSchema,
  projectApplicationRoleConnectionMetadataSchema,
  sameApplicationRoleConnectionMetadataSchema,
  type ApplicationRoleConnectionMetadataDefinition,
} from "./application-role-connection-metadata-definition.js"
import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  ApplicationRoleConnectionMetadataEvidenceError,
  ApplicationRoleConnectionMetadataExecutionError,
  ApplicationRoleConnectionMetadataOperationConflictError,
  ApplicationRoleConnectionMetadataPlanChangedError,
  DiscordApiError,
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

export interface ReplaceApplicationRoleConnectionMetadataRequest {
  acknowledgeGlobalReplacement: true
  action: "replace"
  operationKey: string
  records: ApplicationRoleConnectionMetadataDefinition[]
}

export interface ClearApplicationRoleConnectionMetadataRequest {
  acknowledgeSchemaClearance: true
  action: "clear"
  operationKey: string
}

export type ApplicationRoleConnectionMetadataChangeRequest =
  | ClearApplicationRoleConnectionMetadataRequest
  | ReplaceApplicationRoleConnectionMetadataRequest

interface NormalizedRequestBase {
  action: "clear" | "replace"
  operationKeyHash: string
}

export type NormalizedApplicationRoleConnectionMetadataChangeRequest =
  | (Omit<ClearApplicationRoleConnectionMetadataRequest, "operationKey"> & NormalizedRequestBase)
  | (Omit<ReplaceApplicationRoleConnectionMetadataRequest, "operationKey"> & NormalizedRequestBase)

export interface ApplicationRoleConnectionMetadataDiff {
  added: number
  changed: number
  removed: number
  reordered: boolean
  unchanged: number
}

export interface ApplicationRoleConnectionMetadataPlan {
  acknowledgement: "application-wide-replacement" | "complete-schema-clearance"
  action: "clear" | "replace"
  applicationId: string
  botId: string
  createdAt: string
  current: ApplicationRoleConnectionMetadataDefinition[]
  currentSchemaDigest: string
  desired: ApplicationRoleConnectionMetadataDefinition[]
  desiredSchemaDigest: string
  diff: ApplicationRoleConnectionMetadataDiff
  digest: string
  effect: "change" | "none"
  operationKeyHash: string
  privacy: {
    definitionsPersisted: false
    omitted: readonly [
      "guild-role-configuration",
      "raw-discord-payloads",
      "user-role-connection-values",
      "verification-endpoint-url",
    ]
    text: "transient-untrusted"
  }
  risks: string[]
  schemaVersion: number
  status: "already-current" | "already-empty" | "planned"
  verification: {
    applicationIdentity: "exact"
    independentReadback: true
    requestRetries: false
    response: "exact-complete-schema"
  }
  verificationEndpointConfigured: boolean
  warnings: string[]
  writeRequired: boolean
}

export interface ApplicationRoleConnectionMetadataResult {
  action: "clear" | "replace"
  activityId: string | null
  applicationId: string
  botId: string
  observed: ApplicationRoleConnectionMetadataDefinition[]
  observedSchemaDigest: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "already-empty" | "completed"
}

export interface ApplicationRoleConnectionMetadataServiceClient {
  listApplicationRoleConnectionMetadata:
    DiscordClient["listApplicationRoleConnectionMetadata"]
  replaceApplicationRoleConnectionMetadata:
    DiscordClient["replaceApplicationRoleConnectionMetadata"]
}

export interface ApplicationRoleConnectionMetadataServiceOptions {
  activityStore: ActivityStore
  client: ApplicationRoleConnectionMetadataServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface BuiltPlan {
  plan: ApplicationRoleConnectionMetadataPlan
}

type ApplicationTargetOutcome = "settled" | "uncertain"

const STATE_UNAVAILABLE = "application-role-connection-metadata-state-unavailable"
const ENDPOINT_MAXIMUM_CHARACTERS = 2_048
const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u
const APPLICATION_LOCKS = new Map<string, Promise<ApplicationTargetOutcome>>()
const PRIVACY = Object.freeze({
  definitionsPersisted: false as const,
  omitted: Object.freeze([
    "guild-role-configuration",
    "raw-discord-payloads",
    "user-role-connection-values",
    "verification-endpoint-url",
  ] as const),
  text: "transient-untrusted" as const,
})

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index])
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

export function normalizeApplicationRoleConnectionMetadataChangeRequest(
  request: ApplicationRoleConnectionMetadataChangeRequest,
): NormalizedApplicationRoleConnectionMetadataChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord linked-role metadata request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (record.action === "clear") {
    if (
      !exactKeys(record, ["acknowledgeSchemaClearance", "action", "operationKey"])
      || record.acknowledgeSchemaClearance !== true
    ) {
      throw new RangeError(
        "Discord linked-role metadata clearance requires exact acknowledgement",
      )
    }
    return {
      acknowledgeSchemaClearance: true,
      action: "clear",
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "replace") {
    if (
      !exactKeys(record, [
        "acknowledgeGlobalReplacement",
        "action",
        "operationKey",
        "records",
      ])
      || record.acknowledgeGlobalReplacement !== true
    ) {
      throw new RangeError(
        "Discord linked-role metadata replacement requires exact global acknowledgement",
      )
    }
    const records = normalizeApplicationRoleConnectionMetadataSchema(record.records)
    if (records.length === 0) {
      throw new RangeError(
        "Discord linked-role metadata replacement requires at least one record; use clear for an empty schema",
      )
    }
    applicationRoleConnectionMetadataSchemaBody(records)
    return {
      acknowledgeGlobalReplacement: true,
      action: "replace",
      operationKeyHash: operationKeyHash(record.operationKey as string),
      records,
    }
  }
  throw new RangeError("Discord linked-role metadata action must be clear or replace")
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function endpointConfigured(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > ENDPOINT_MAXIMUM_CHARACTERS
    || CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new ApplicationRoleConnectionMetadataEvidenceError(
      "Discord returned invalid current-application linked-role endpoint evidence",
    )
  }
  return true
}

function validateIdentity(
  application: DiscordApplication,
  botId: string,
): { applicationId: string; endpointConfigured: boolean } {
  if (!application || typeof application !== "object" || Array.isArray(application)) {
    throw new ApplicationRoleConnectionMetadataEvidenceError(
      "Discord returned invalid current-application identity evidence",
    )
  }
  assertSnowflake(application.id, "Discord application ID")
  assertSnowflake(botId, "Discord bot ID")
  if (application.bot?.id !== undefined && application.bot.id !== botId) {
    throw new ApplicationRoleConnectionMetadataEvidenceError(
      "Discord returned linked-role metadata evidence for a different bot identity",
    )
  }
  return {
    applicationId: application.id,
    endpointConfigured: endpointConfigured(application.role_connections_verification_url),
  }
}

function exactSchema(value: unknown): ApplicationRoleConnectionMetadataDefinition[] {
  try {
    return projectApplicationRoleConnectionMetadataSchema(value)
  } catch (error) {
    if (error instanceof ApplicationRoleConnectionMetadataDefinitionError) {
      throw new ApplicationRoleConnectionMetadataEvidenceError(
        "Discord returned linked-role metadata evidence that cannot be reproduced exactly",
        { cause: error },
      )
    }
    throw error
  }
}

function schemaDiff(
  current: readonly ApplicationRoleConnectionMetadataDefinition[],
  desired: readonly ApplicationRoleConnectionMetadataDefinition[],
): ApplicationRoleConnectionMetadataDiff {
  const currentByKey = new Map(current.map((definition) => [definition.key, definition]))
  const desiredByKey = new Map(desired.map((definition) => [definition.key, definition]))
  let added = 0
  let changed = 0
  let removed = 0
  let unchanged = 0
  for (const definition of desired) {
    const existing = currentByKey.get(definition.key)
    if (!existing) {
      added += 1
    } else if (
      applicationRoleConnectionMetadataRecordDigest(existing)
      === applicationRoleConnectionMetadataRecordDigest(definition)
    ) {
      unchanged += 1
    } else {
      changed += 1
    }
  }
  for (const definition of current) {
    if (!desiredByKey.has(definition.key)) removed += 1
  }
  const currentCommon = current
    .map((definition) => definition.key)
    .filter((key) => desiredByKey.has(key))
  const desiredCommon = desired
    .map((definition) => definition.key)
    .filter((key) => currentByKey.has(key))
  return {
    added,
    changed,
    removed,
    reordered: currentCommon.join("\0") !== desiredCommon.join("\0"),
    unchanged,
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

function applicationOperationStore(store: OperationStore): ApplicationOperationStore {
  if (!store.finishApplication || !store.getApplication || !store.reserveApplication) {
    throw new ApplicationRoleConnectionMetadataExecutionError(
      "Discord linked-role metadata changes require an application-scoped operation store",
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
  plan: ApplicationRoleConnectionMetadataPlan
  status: ApplicationRoleConnectionMetadataActivityStatus
  timestamp: string
  verification?: "match" | null
}): ApplicationRoleConnectionMetadataActivity {
  return {
    action: options.plan.action,
    addedRecordCount: options.plan.diff.added,
    applicationId: options.applicationId,
    botId: options.botId,
    changedRecordCount: options.plan.diff.changed,
    currentRecordCount: options.plan.current.length,
    desiredRecordCount: options.plan.desired.length,
    error: options.error ?? null,
    id: options.activityId,
    kind: "application-role-connection-metadata-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    removedRecordCount: options.plan.diff.removed,
    reordered: options.plan.diff.reordered,
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
  plan: ApplicationRoleConnectionMetadataPlan
  status: ApplicationOperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): ApplicationOperationReceipt {
  return {
    activityId: options.activityId,
    applicationId: options.applicationId,
    error: options.error ?? null,
    kind: "application-role-connection-metadata-change",
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
    !(error instanceof ApplicationRoleConnectionMetadataExecutionError)
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
  priorUncertainError: () => ApplicationRoleConnectionMetadataExecutionError,
): Promise<T> {
  const prior = APPLICATION_LOCKS.get(applicationId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ApplicationTargetOutcome) => void = () => undefined
  const tail = new Promise<ApplicationTargetOutcome>((resolve) => {
    release = resolve
  })
  APPLICATION_LOCKS.set(applicationId, tail)
  let outcome: ApplicationTargetOutcome = "settled"
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
    if (APPLICATION_LOCKS.get(applicationId) === tail) APPLICATION_LOCKS.delete(applicationId)
  }
}

export class ApplicationRoleConnectionMetadataService {
  readonly #activityStore: ActivityStore
  readonly #client: ApplicationRoleConnectionMetadataServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ApplicationRoleConnectionMetadataServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async #buildPlan(
    application: DiscordApplication,
    botId: string,
    request: NormalizedApplicationRoleConnectionMetadataChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltPlan> {
    this.#policy.assertApplicationRoleConnectionMetadataChangeAllowed()
    const identity = validateIdentity(application, botId)
    const current = exactSchema(
      await this.#client.listApplicationRoleConnectionMetadata(
        identity.applicationId,
        options,
      ),
    )
    const desired = request.action === "clear" ? [] : request.records
    const diff = schemaDiff(current, desired)
    const effect = sameApplicationRoleConnectionMetadataSchema(current, desired)
      ? "none"
      : "change"
    const currentSchemaDigest = applicationRoleConnectionMetadataSchemaDigest(current)
    const desiredSchemaDigest = applicationRoleConnectionMetadataSchemaDigest(desired)
    const risks = [
      "Linked-role metadata replacement changes one application-wide schema across every guild installation",
      "Omitted or changed records can invalidate existing guild linked-role criteria without revealing affected guilds or roles",
      "Discord's replacement endpoint has no conditional update and accepts no audit-log reason",
      "The operation key is one-shot and cannot be retried after reservation",
    ]
    const warnings = [
      ...(request.action === "clear"
        ? ["Schema clearance removes every application-owned linked-role criterion"]
        : []),
      ...(!identity.endpointConfigured && request.action === "replace"
        ? ["The current application reports no linked-role verification endpoint"]
        : []),
      "Metadata labels and localization values are transient untrusted data and are never persisted",
      "This workflow cannot inspect guild role usage, user eligibility, or user role-connection values",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId: identity.applicationId,
      botId,
      current,
      currentSchemaDigest,
      desired,
      desiredSchemaDigest,
      diff,
      endpointConfigured: identity.endpointConfigured,
      request,
      risks,
      warnings,
    })
    return {
      plan: {
        acknowledgement: request.action === "clear"
          ? "complete-schema-clearance"
          : "application-wide-replacement",
        action: request.action,
        applicationId: identity.applicationId,
        botId,
        createdAt: this.#clock().toISOString(),
        current,
        currentSchemaDigest,
        desired,
        desiredSchemaDigest,
        diff,
        digest,
        effect,
        operationKeyHash: request.operationKeyHash,
        privacy: PRIVACY,
        risks,
        schemaVersion: SCHEMA_VERSION,
        status: effect === "change"
          ? "planned"
          : request.action === "clear"
            ? "already-empty"
            : "already-current",
        verification: {
          applicationIdentity: "exact",
          independentReadback: true,
          requestRetries: false,
          response: "exact-complete-schema",
        },
        verificationEndpointConfigured: identity.endpointConfigured,
        warnings,
        writeRequired: effect === "change",
      },
    }
  }

  async plan(
    application: DiscordApplication,
    botId: string,
    request: ApplicationRoleConnectionMetadataChangeRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationRoleConnectionMetadataPlan> {
    return (await this.#buildPlan(
      application,
      botId,
      normalizeApplicationRoleConnectionMetadataChangeRequest(request),
      options,
    )).plan
  }

  execute(
    application: DiscordApplication,
    botId: string,
    request: ApplicationRoleConnectionMetadataChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationRoleConnectionMetadataResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord linked-role metadata plan digest is invalid")
    }
    const normalized = normalizeApplicationRoleConnectionMetadataChangeRequest(request)
    const applicationId = application.id
    assertSnowflake(applicationId, "Discord application ID")
    return withApplicationLock(
      applicationId,
      () => this.#executeLocked(
        application,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ApplicationRoleConnectionMetadataExecutionError(
        "Discord linked-role metadata changes are blocked after an uncertain same-application outcome",
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
    application: DiscordApplication,
    botId: string,
    request: NormalizedApplicationRoleConnectionMetadataChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ApplicationRoleConnectionMetadataResult> {
    let built: BuiltPlan
    try {
      built = await this.#buildPlan(application, botId, request, options)
    } catch (error) {
      if (error instanceof ApplicationRoleConnectionMetadataEvidenceError) {
        throw new ApplicationRoleConnectionMetadataPlanChangedError(
          expectedDigest,
          STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan } = built
    if (plan.digest !== expectedDigest) {
      throw new ApplicationRoleConnectionMetadataPlanChangedError(
        expectedDigest,
        plan.digest,
      )
    }
    const baseResult = {
      action: plan.action,
      applicationId: plan.applicationId,
      botId,
      operationKeyHash: plan.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      return {
        ...baseResult,
        activityId: null,
        observed: plan.current,
        observedSchemaDigest: plan.currentSchemaDigest,
        status: plan.status as "already-current" | "already-empty",
      }
    }

    const operationStore = applicationOperationStore(this.#operationStore)
    const activityId = this.#randomId()
    const reservation = await operationStore.reserveApplication(operationReceipt({
      activityId,
      applicationId: plan.applicationId,
      plan,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ApplicationRoleConnectionMetadataOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        applicationId: plan.applicationId,
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
          applicationId: plan.applicationId,
          error: safeErrorCode(error),
          plan,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ApplicationRoleConnectionMetadataExecutionError(
        "Discord linked-role metadata change was blocked because pending activity could not be recorded",
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
    let observed: ApplicationRoleConnectionMetadataDefinition[] | null = null
    try {
      const response = await this.#client.replaceApplicationRoleConnectionMetadata(
        plan.applicationId,
        applicationRoleConnectionMetadataSchemaBody(plan.desired),
        options,
      )
      mutationResponseReceived = true
      const responseSchema = exactSchema(response)
      if (!sameApplicationRoleConnectionMetadataSchema(responseSchema, plan.desired)) {
        throw new ApplicationRoleConnectionMetadataEvidenceError(
          "Discord linked-role metadata response did not match the reviewed complete schema",
        )
      }
      observed = exactSchema(
        await this.#client.listApplicationRoleConnectionMetadata(
          plan.applicationId,
          options,
        ),
      )
      if (!sameApplicationRoleConnectionMetadataSchema(observed, plan.desired)) {
        throw new ApplicationRoleConnectionMetadataEvidenceError(
          "Discord linked-role metadata readback did not match the reviewed complete schema",
        )
      }
    } catch (error) {
      const status = !mutationResponseReceived
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await operationStore.finishApplication(operationReceipt({
          activityId,
          applicationId: plan.applicationId,
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
          applicationId: plan.applicationId,
          botId,
          error: errorCode,
          plan,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationRoleConnectionMetadataExecutionError(
        "Discord linked-role metadata change did not complete with a verified successful outcome",
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

    const result: ApplicationRoleConnectionMetadataResult = {
      ...baseResult,
      activityId,
      observed: observed!,
      observedSchemaDigest: applicationRoleConnectionMetadataSchemaDigest(observed!),
      status: "completed",
    }
    try {
      await operationStore.finishApplication(operationReceipt({
        activityId,
        applicationId: plan.applicationId,
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
          applicationId: plan.applicationId,
          botId,
          error: safeErrorCode(error),
          plan,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationRoleConnectionMetadataExecutionError(
        "Discord linked-role metadata change completed but the operation receipt failed",
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
        applicationId: plan.applicationId,
        botId,
        plan,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new ApplicationRoleConnectionMetadataExecutionError(
        "Discord linked-role metadata change completed but the final activity record failed",
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
