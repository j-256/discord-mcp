import { createHash, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ApplicationEntitlementActivity,
} from "./activity-log.js"
import type {
  ApplicationEntitlementInspectionRecord,
  ApplicationEntitlementInspectionResult,
  ApplicationMonetizationAuditService,
} from "./application-monetization-audit-service.js"
import type {
  ApplicationSkuAuditResult,
  ApplicationSkuRecord,
} from "./application-sku-audit-service.js"
import {
  AUDIT_LOG_LIMITS,
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  ApplicationEntitlementBeneficiary,
  DiscordClient,
} from "./discord-client.js"
import { encodeDiscordAuditReason } from "./discord-client.js"
import {
  ApplicationEntitlementEvidenceError,
  ApplicationEntitlementExecutionError,
  ApplicationEntitlementOperationConflictError,
  ApplicationEntitlementPlanChangedError,
  DiscordApiError,
} from "./errors.js"
import {
  operationKeyHash,
  type ApplicationEntitlementOperationReceipt,
  type ApplicationEntitlementOperationStore,
  type OperationStore,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordApplication,
  DiscordApplicationEntitlement,
  RequestOptions,
} from "./types.js"

export type ApplicationEntitlementChangeAction =
  | "consume"
  | "create-test"
  | "delete-test"

export interface CreateApplicationTestEntitlementRequest {
  action: "create"
  auditReason: string
  beneficiary: ApplicationEntitlementBeneficiary
  operationKey: string
  skuId: string
}

export interface DeleteApplicationTestEntitlementRequest {
  acknowledgeIrreversibleDeletion: true
  action: "delete"
  auditReason: string
  beneficiary: ApplicationEntitlementBeneficiary
  creationOperationKey: string
  entitlementId: string
  operationKey: string
  skuId: string
}

export type ApplicationTestEntitlementChangeRequest =
  | CreateApplicationTestEntitlementRequest
  | DeleteApplicationTestEntitlementRequest

export interface ApplicationEntitlementConsumptionRequest {
  acknowledgeExternalFulfillment: true
  auditReason: string
  entitlementId: string
  fulfillmentReference: string
  operationKey: string
  skuId: string
  userId: string
}

interface NormalizedApplicationEntitlementRequestBase {
  auditReason: string
  beneficiary: ApplicationEntitlementBeneficiary
  operationKeyHash: string
  skuId: string
}

export type NormalizedApplicationTestEntitlementChangeRequest =
  | (Omit<
    CreateApplicationTestEntitlementRequest,
    "action" | "operationKey"
  > & NormalizedApplicationEntitlementRequestBase & { action: "create-test" })
  | (Omit<
    DeleteApplicationTestEntitlementRequest,
    "action" | "creationOperationKey" | "operationKey"
  > & NormalizedApplicationEntitlementRequestBase & {
    action: "delete-test"
    creationOperationKeyHash: string
  })

export interface NormalizedApplicationEntitlementConsumptionRequest extends
  NormalizedApplicationEntitlementRequestBase {
  acknowledgeExternalFulfillment: true
  action: "consume"
  entitlementId: string
  fulfillmentReferenceHash: string
  userId: string
}

export interface ApplicationEntitlementPrivacyProjection {
  auditReason: "digest-bound-not-persisted"
  fulfillmentReference: "hash-only"
  persistence: "content-free-records-only"
  productText: "omitted"
  rawPayloads: "omitted"
  rawOperationKeys: "hash-only"
}

export interface ApplicationEntitlementSkuEvidence {
  available: boolean
  catalogDigest: string
  catalogRecords: number
  id: string
  purchaseScope: ApplicationSkuRecord["flags"]["purchaseScope"]
  type: ApplicationSkuRecord["type"]["name"]
}

export interface ApplicationTestEntitlementPlan {
  acknowledgeIrreversibleDeletion: boolean
  action: "create-test" | "delete-test"
  applicationId: string
  auditReason: string
  beneficiary: {
    id: string
    type: "guild" | "user"
  }
  botId: string
  createdAt: string
  creationReceipt: {
    activityId: string
    creationOperationKeyHash: string
    entitlementId: string
    verified: true
  } | null
  current: ApplicationEntitlementInspectionRecord[]
  digest: string
  effect: "change" | "none"
  entitlementId: string | null
  inventory: {
    complete: true
    digest: string
    returned: number
    safetyLimit: number
  }
  operationKeyHash: string
  privacy: ApplicationEntitlementPrivacyProjection
  risks: string[]
  schemaVersion: number
  sku: ApplicationEntitlementSkuEvidence
  status: "already-absent" | "already-entitled" | "planned"
  verification: {
    automaticRetry: false
    exactReadback: true
    rollback: "none"
  }
  warnings: string[]
  writeRequired: boolean
}

export interface ApplicationEntitlementConsumptionPlan {
  acknowledgeExternalFulfillment: true
  action: "consume"
  applicationId: string
  auditReason: string
  beneficiary: {
    id: string
    type: "user"
  }
  botId: string
  createdAt: string
  current: ApplicationEntitlementInspectionRecord
  digest: string
  effect: "change" | "none"
  entitlementId: string
  fulfillmentReferenceHash: string
  operationKeyHash: string
  privacy: ApplicationEntitlementPrivacyProjection
  risks: string[]
  schemaVersion: number
  sku: ApplicationEntitlementSkuEvidence
  status: "already-consumed" | "planned"
  verification: {
    automaticRetry: false
    exactReadback: true
    externalFulfillmentVerifiedByConnector: false
    rollback: "none"
  }
  warnings: string[]
  writeRequired: boolean
}

export interface ApplicationEntitlementChangeResult {
  action: ApplicationEntitlementChangeAction
  activityId: string | null
  applicationId: string
  beneficiary: {
    id: string
    type: "guild" | "user"
  }
  entitlementId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  skuId: string
  status: "already-absent" | "already-consumed" | "already-entitled" | "completed"
  verification: "match" | "not-required"
}

export interface ApplicationEntitlementServiceClient extends Pick<
  DiscordClient,
  | "consumeApplicationEntitlement"
  | "createApplicationTestEntitlement"
  | "deleteApplicationTestEntitlement"
> {}

export interface ApplicationEntitlementServiceOptions {
  activityStore: ActivityStore
  client: ApplicationEntitlementServiceClient
  clock?: () => Date
  monetizationAuditService: Pick<
    ApplicationMonetizationAuditService,
    "auditEntitlements" | "inspectEntitlement"
  >
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertApplicationEntitlementConsumptionAllowed"
    | "assertApplicationTestEntitlementChangeAllowed"
  >
  randomId?: () => string
}

interface BuiltApplicationTestEntitlementPlan {
  plan: ApplicationTestEntitlementPlan
  request: NormalizedApplicationTestEntitlementChangeRequest
}

interface BuiltApplicationEntitlementConsumptionPlan {
  plan: ApplicationEntitlementConsumptionPlan
  request: NormalizedApplicationEntitlementConsumptionRequest
}

type ApplicationEntitlementTargetOutcome = "settled" | "uncertain"

interface ApplicationEntitlementLockState {
  tails: Map<string, Promise<ApplicationEntitlementTargetOutcome>>
  uncertainApplications: Set<string>
}

const APPLICATION_ENTITLEMENT_STATE_UNAVAILABLE =
  "application-entitlement-state-unavailable"
const APPLICATION_ENTITLEMENT_LOCKS = new WeakMap<
  OperationStore,
  ApplicationEntitlementLockState
>()
const CONSUMABLE_ENTITLEMENT_TYPES: ReadonlySet<
  ApplicationEntitlementInspectionRecord["type"]
> = new Set([
  "free-purchase",
  "premium-purchase",
  "purchase",
  "test-mode-purchase",
])
const PRIVACY: ApplicationEntitlementPrivacyProjection = Object.freeze({
  auditReason: "digest-bound-not-persisted",
  fulfillmentReference: "hash-only",
  persistence: "content-free-records-only",
  productText: "omitted",
  rawPayloads: "omitted",
  rawOperationKeys: "hash-only",
})

function entitlementLocks(operationStore: OperationStore): ApplicationEntitlementLockState {
  let state = APPLICATION_ENTITLEMENT_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainApplications: new Set() }
    APPLICATION_ENTITLEMENT_LOCKS.set(operationStore, state)
  }
  return state
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const normalized = [...expected].sort()
  return actual.length === normalized.length
    && actual.every((key, index) => key === normalized[index])
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${description} must be a positive Discord snowflake ID`)
  }
}

function normalizeBeneficiary(value: unknown): ApplicationEntitlementBeneficiary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord application entitlement beneficiary is invalid")
  }
  const record = value as Record<string, unknown>
  if (record.type === "guild" && exactKeys(record, ["guildId", "type"])) {
    assertSnowflake(record.guildId, "Discord application entitlement guild ID")
    return { guildId: record.guildId, type: "guild" }
  }
  if (record.type === "user" && exactKeys(record, ["type", "userId"])) {
    assertSnowflake(record.userId, "Discord application entitlement user ID")
    return { type: "user", userId: record.userId }
  }
  throw new RangeError("Discord application entitlement beneficiary is invalid")
}

function normalizeAuditReason(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > AUDIT_LOG_LIMITS.reasonCharacters
  ) {
    throw new RangeError("Discord application entitlement audit reason is invalid")
  }
  encodeDiscordAuditReason(value)
  return value
}

export function fulfillmentReferenceHash(value: string): string {
  if (
    typeof value !== "string"
    || value.length
      < CONNECTOR_LIMITS.applicationEntitlementFulfillmentReferenceMinimumCharacters
    || value.length > CONNECTOR_LIMITS.applicationEntitlementFulfillmentReferenceCharacters
    || !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    throw new RangeError(
      "Discord entitlement fulfillment reference must be 16-128 safe ASCII characters",
    )
  }
  return `sha256:${createHash("sha256")
    .update("guildcontrol-application-entitlement-fulfillment.v1\0")
    .update(value)
    .digest("hex")}`
}

export function normalizeApplicationTestEntitlementChangeRequest(
  value: ApplicationTestEntitlementChangeRequest,
): NormalizedApplicationTestEntitlementChangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord application test entitlement request is invalid")
  }
  const record = value as unknown as Record<string, unknown>
  if (record.action === "create") {
    if (!exactKeys(record, [
      "action",
      "auditReason",
      "beneficiary",
      "operationKey",
      "skuId",
    ])) throw new RangeError("Discord application test entitlement create request is invalid")
    assertSnowflake(record.skuId, "Discord application test entitlement SKU ID")
    return {
      action: "create-test",
      auditReason: normalizeAuditReason(record.auditReason),
      beneficiary: normalizeBeneficiary(record.beneficiary),
      operationKeyHash: operationKeyHash(record.operationKey as string),
      skuId: record.skuId,
    }
  }
  if (record.action === "delete") {
    if (!exactKeys(record, [
      "acknowledgeIrreversibleDeletion",
      "action",
      "auditReason",
      "beneficiary",
      "creationOperationKey",
      "entitlementId",
      "operationKey",
      "skuId",
    ]) || record.acknowledgeIrreversibleDeletion !== true) {
      throw new RangeError(
        "Discord application test entitlement deletion requires acknowledgeIrreversibleDeletion=true",
      )
    }
    assertSnowflake(record.entitlementId, "Discord application test entitlement ID")
    assertSnowflake(record.skuId, "Discord application test entitlement SKU ID")
    const operationHash = operationKeyHash(record.operationKey as string)
    const creationHash = operationKeyHash(record.creationOperationKey as string)
    if (operationHash === creationHash) {
      throw new RangeError(
        "Discord application test entitlement deletion requires a distinct operation key",
      )
    }
    return {
      acknowledgeIrreversibleDeletion: true,
      action: "delete-test",
      auditReason: normalizeAuditReason(record.auditReason),
      beneficiary: normalizeBeneficiary(record.beneficiary),
      creationOperationKeyHash: creationHash,
      entitlementId: record.entitlementId,
      operationKeyHash: operationHash,
      skuId: record.skuId,
    }
  }
  throw new RangeError("Discord application test entitlement action must be create or delete")
}

export function normalizeApplicationEntitlementConsumptionRequest(
  value: ApplicationEntitlementConsumptionRequest,
): NormalizedApplicationEntitlementConsumptionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord application entitlement consumption request is invalid")
  }
  const record = value as unknown as Record<string, unknown>
  if (
    !exactKeys(record, [
      "acknowledgeExternalFulfillment",
      "auditReason",
      "entitlementId",
      "fulfillmentReference",
      "operationKey",
      "skuId",
      "userId",
    ])
    || record.acknowledgeExternalFulfillment !== true
  ) {
    throw new RangeError(
      "Discord entitlement consumption requires acknowledgeExternalFulfillment=true",
    )
  }
  assertSnowflake(record.entitlementId, "Discord consumable entitlement ID")
  assertSnowflake(record.skuId, "Discord consumable entitlement SKU ID")
  assertSnowflake(record.userId, "Discord consumable entitlement user ID")
  return {
    acknowledgeExternalFulfillment: true,
    action: "consume",
    auditReason: normalizeAuditReason(record.auditReason),
    beneficiary: { type: "user", userId: record.userId },
    entitlementId: record.entitlementId,
    fulfillmentReferenceHash: fulfillmentReferenceHash(
      record.fulfillmentReference as string,
    ),
    operationKeyHash: operationKeyHash(record.operationKey as string),
    skuId: record.skuId,
    userId: record.userId,
  }
}

function beneficiaryView(beneficiary: ApplicationEntitlementBeneficiary): {
  id: string
  type: "guild" | "user"
} {
  return beneficiary.type === "guild"
    ? { id: beneficiary.guildId, type: "guild" }
    : { id: beneficiary.userId, type: "user" }
}

function skuEvidence(
  applicationId: string,
  botId: string,
  audit: ApplicationSkuAuditResult,
  skuId: string,
  purpose: "consume" | "test",
  beneficiaryType: "guild" | "user",
  planKey: Uint8Array,
): ApplicationEntitlementSkuEvidence {
  if (
    audit.status !== "ok"
    || audit.application.id !== applicationId
    || audit.application.botId !== botId
    || audit.inventory.completeness !== "complete-current-application"
    || audit.records.length !== audit.inventory.count
    || audit.records.length > DISCORD_LIMITS.applicationSkuRecords
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord returned invalid complete application SKU evidence",
    )
  }
  const selected = audit.records.find((record) => record.id === skuId)
  if (!selected) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord application entitlement SKU is not owned by the pinned application",
    )
  }
  if (
    selected.unknownFieldCount !== 0
    || selected.flags.unknownBitCount !== 0
    || selected.type.name === "unknown"
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord application entitlement changes require complete selected SKU evidence",
    )
  }
  if (
    purpose === "test"
    && (
      selected.type.name !== "subscription"
      || selected.flags.purchaseScope !== beneficiaryType
    )
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord test entitlements require a subscription SKU matching the beneficiary scope",
    )
  }
  if (
    purpose === "consume"
    && (
      selected.type.name !== "consumable"
      || selected.flags.purchaseScope !== "unspecified"
    )
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord entitlement consumption requires an unambiguous consumable SKU",
    )
  }
  const catalogProjection = audit.records.map((record) => ({
    available: record.flags.available,
    guildSubscription: record.flags.guildSubscription,
    id: record.id,
    purchaseScope: record.flags.purchaseScope,
    type: record.type.name,
    unknownFieldCount: record.unknownFieldCount,
    unknownFlagBits: record.flags.unknownBitCount,
    userSubscription: record.flags.userSubscription,
  }))
  return {
    available: selected.flags.available,
    catalogDigest: reviewedPlanDigest(planKey, {
      applicationId,
      records: catalogProjection,
    }),
    catalogRecords: audit.records.length,
    id: selected.id,
    purchaseScope: selected.flags.purchaseScope,
    type: selected.type.name,
  }
}

function inventoryDigest(
  planKey: Uint8Array,
  applicationId: string,
  beneficiary: ReturnType<typeof beneficiaryView>,
  records: readonly ApplicationEntitlementInspectionRecord[],
  skuId: string,
): string {
  return reviewedPlanDigest(planKey, {
    applicationId,
    beneficiary,
    records,
    skuId,
  })
}

function assertCompleteEntitlement(
  inspection: ApplicationEntitlementInspectionResult,
  options: {
    allowDeleted: boolean
    applicationId: string
    beneficiary: ReturnType<typeof beneficiaryView>
    botId: string
    entitlementId: string
    perpetualTest: boolean
    skuId: string
  },
): ApplicationEntitlementInspectionRecord {
  const entitlement = inspection.entitlement
  if (
    inspection.status !== "ok"
    || inspection.application.id !== options.applicationId
    || inspection.application.botId !== options.botId
    || inspection.beneficiary.id !== options.beneficiary.id
    || inspection.beneficiary.type !== options.beneficiary.type
    || inspection.sku.id !== options.skuId
    || inspection.evidence.projectionComplete !== true
    || inspection.evidence.unknownFields !== 0
    || inspection.evidence.unknownType
    || inspection.evidence.unknownSkuFields !== 0
    || inspection.evidence.unknownSkuFlagBits !== 0
    || inspection.evidence.unknownSkuType
    || entitlement.id !== options.entitlementId
    || entitlement.skuId !== options.skuId
    || entitlement.unknownFieldCount !== 0
    || entitlement.type === "unknown"
    || (!options.allowDeleted && entitlement.deleted)
    || (options.perpetualTest && (
      entitlement.startsAt !== null
      || entitlement.endsAt !== null
    ))
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord returned unsafe application entitlement lifecycle evidence",
    )
  }
  return entitlement
}

function createdEntitlementId(
  value: DiscordApplicationEntitlement,
  applicationId: string,
  beneficiary: ApplicationEntitlementBeneficiary,
  skuId: string,
): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord returned invalid test entitlement creation evidence",
    )
  }
  const record = value as unknown as Record<string, unknown>
  if (
    Object.keys(record).length > DISCORD_LIMITS.applicationEntitlementFields
    || !positiveSnowflake(record.id)
    || record.application_id !== applicationId
    || record.sku_id !== skuId
    || record.deleted !== false
    || !Number.isSafeInteger(record.type)
    || (record.type as number) < 1
    || (record.consumed !== undefined && typeof record.consumed !== "boolean")
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord returned invalid test entitlement creation evidence",
    )
  }
  const userId = record.user_id === undefined || record.user_id === null
    ? null
    : record.user_id
  const guildId = record.guild_id === undefined || record.guild_id === null
    ? null
    : record.guild_id
  if (
    (userId !== null && !positiveSnowflake(userId))
    || (guildId !== null && !positiveSnowflake(guildId))
    || (beneficiary.type === "user"
      ? userId !== beneficiary.userId || guildId !== null
      : guildId !== beneficiary.guildId)
  ) {
    throw new ApplicationEntitlementEvidenceError(
      "Discord returned mismatched test entitlement creation evidence",
    )
  }
  return record.id
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function entitlementOperationStore(
  store: OperationStore,
): ApplicationEntitlementOperationStore {
  if (
    !store.checkpointApplicationEntitlement
    || !store.finishApplication
    || !store.getApplication
    || !store.reserveApplication
  ) {
    throw new ApplicationEntitlementExecutionError(
      "Discord application entitlement changes require a checkpoint-capable application operation store",
      { status: "blocked-operation-store-incompatible" },
    )
  }
  return store as ApplicationEntitlementOperationStore
}

function receiptView(receipt: ApplicationEntitlementOperationReceipt) {
  return {
    action: receipt.action,
    activityId: receipt.activityId,
    applicationId: receipt.applicationId,
    beneficiaryId: receipt.beneficiaryId,
    beneficiaryType: receipt.beneficiaryType,
    creationOperationKeyHash: receipt.creationOperationKeyHash,
    entitlementId: receipt.entitlementId,
    error: receipt.error,
    fulfillmentReferenceHash: receipt.fulfillmentReferenceHash,
    operationKeyHash: receipt.operationKeyHash,
    skuId: receipt.skuId,
    stage: receipt.stage,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function operationReceipt(options: {
  activityId: string
  applicationId: string
  entitlementId: string | null
  error?: string | null
  plan: ApplicationEntitlementConsumptionPlan | ApplicationTestEntitlementPlan
  request:
    | NormalizedApplicationEntitlementConsumptionRequest
    | NormalizedApplicationTestEntitlementChangeRequest
  stage: ApplicationEntitlementOperationReceipt["stage"]
  status: ApplicationEntitlementOperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): ApplicationEntitlementOperationReceipt {
  const beneficiary = beneficiaryView(options.request.beneficiary)
  const creationOperationKeyHash = options.request.action === "delete-test"
    ? options.request.creationOperationKeyHash
    : null
  const fulfillmentReferenceHash = options.request.action === "consume"
    ? options.request.fulfillmentReferenceHash
    : null
  return {
    action: options.request.action,
    activityId: options.activityId,
    applicationId: options.applicationId,
    beneficiaryId: beneficiary.id,
    beneficiaryType: beneficiary.type,
    creationOperationKeyHash,
    entitlementId: options.entitlementId,
    error: options.error ?? null,
    fulfillmentReferenceHash,
    kind: "application-entitlement-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.entitlementId,
    schemaVersion: 2,
    skuId: options.request.skuId,
    stage: options.stage,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function activityEntry(
  receipt: ApplicationEntitlementOperationReceipt,
): ApplicationEntitlementActivity {
  return {
    action: receipt.action,
    applicationId: receipt.applicationId,
    beneficiaryId: receipt.beneficiaryId,
    beneficiaryType: receipt.beneficiaryType,
    creationOperationKeyHash: receipt.creationOperationKeyHash,
    entitlementId: receipt.entitlementId,
    error: receipt.error,
    fulfillmentReferenceHash: receipt.fulfillmentReferenceHash,
    id: receipt.activityId,
    kind: "application-entitlement-change",
    operationKeyHash: receipt.operationKeyHash,
    planDigest: receipt.planDigest,
    schemaVersion: SCHEMA_VERSION,
    skuId: receipt.skuId,
    stage: receipt.stage,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function executionBlocksApplication(error: unknown): boolean {
  if (
    !(error instanceof ApplicationEntitlementExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-operation-record-failed", "uncertain"]
    .includes(String(error.result.status))
}

async function withApplicationLock<T>(
  state: ApplicationEntitlementLockState,
  applicationId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ApplicationEntitlementExecutionError,
): Promise<T> {
  const prior = state.tails.get(applicationId) ?? Promise.resolve("settled" as const)
  let release: (outcome: ApplicationEntitlementTargetOutcome) => void = () => undefined
  const tail = new Promise<ApplicationEntitlementTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(applicationId, tail)
  let outcome: ApplicationEntitlementTargetOutcome = "settled"
  try {
    if (state.uncertainApplications.has(applicationId) || await prior === "uncertain") {
      outcome = "uncertain"
      state.uncertainApplications.add(applicationId)
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksApplication(error)) {
      outcome = "uncertain"
      state.uncertainApplications.add(applicationId)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(applicationId) === tail) state.tails.delete(applicationId)
  }
}

export class ApplicationEntitlementService {
  readonly #activityStore: ActivityStore
  readonly #client: ApplicationEntitlementServiceClient
  readonly #clock: () => Date
  readonly #locks: ApplicationEntitlementLockState
  readonly #monetizationAuditService: ApplicationEntitlementServiceOptions["monetizationAuditService"]
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ApplicationEntitlementServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: ApplicationEntitlementServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#locks = entitlementLocks(options.operationStore)
    this.#monetizationAuditService = options.monetizationAuditService
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async #assertOperationAvailable(operationHash: string): Promise<void> {
    const receipt = await entitlementOperationStore(this.#operationStore)
      .getApplication("application-entitlement-change", operationHash)
    if (!receipt) return
    if (receipt.kind !== "application-entitlement-change") {
      throw new ApplicationEntitlementEvidenceError(
        "Discord returned a mismatched application entitlement operation receipt",
      )
    }
    throw new ApplicationEntitlementOperationConflictError(receiptView(receipt))
  }

  async #creationReceipt(
    applicationId: string,
    beneficiary: ReturnType<typeof beneficiaryView>,
    entitlementId: string,
    skuId: string,
    creationOperationKeyHash: string,
  ): Promise<ApplicationEntitlementOperationReceipt> {
    const receipt = await entitlementOperationStore(this.#operationStore).getApplication(
      "application-entitlement-change",
      creationOperationKeyHash,
    )
    if (
      !receipt
      || receipt.kind !== "application-entitlement-change"
      || receipt.action !== "create-test"
      || receipt.applicationId !== applicationId
      || receipt.beneficiaryId !== beneficiary.id
      || receipt.beneficiaryType !== beneficiary.type
      || receipt.entitlementId !== entitlementId
      || receipt.skuId !== skuId
      || receipt.stage !== "terminal"
      || receipt.status !== "completed"
      || receipt.verification !== "match"
    ) {
      throw new ApplicationEntitlementEvidenceError(
        "Discord test entitlement deletion requires a matching completed connector creation receipt",
      )
    }
    return receipt
  }

  async #inspect(
    application: DiscordApplication,
    botId: string,
    beneficiary: ApplicationEntitlementBeneficiary,
    entitlementId: string,
    skuId: string,
    skuAudit: ApplicationSkuAuditResult,
    options: RequestOptions,
  ): Promise<ApplicationEntitlementInspectionResult> {
    return this.#monetizationAuditService.inspectEntitlement(
      application,
      botId,
      beneficiary,
      entitlementId,
      skuId,
      skuAudit.records,
      options,
    )
  }

  async #buildTestPlan(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: NormalizedApplicationTestEntitlementChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltApplicationTestEntitlementPlan> {
    const beneficiary = beneficiaryView(request.beneficiary)
    this.#policy.assertApplicationTestEntitlementChangeAllowed(
      beneficiary,
      request.skuId,
    )
    assertSnowflake(application.id, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    await this.#assertOperationAvailable(request.operationKeyHash)
    const sku = skuEvidence(
      application.id,
      botId,
      skuAudit,
      request.skuId,
      "test",
      beneficiary.type,
      this.#planKey,
    )
    let creationReceipt: ApplicationTestEntitlementPlan["creationReceipt"] = null
    let current: ApplicationEntitlementInspectionRecord[]
    if (request.action === "create-test") {
      const audit = await this.#monetizationAuditService.auditEntitlements(
        application,
        botId,
        request.beneficiary,
        [request.skuId],
        skuAudit.records,
        { ...options, limit: DISCORD_LIMITS.applicationEntitlementPage },
      )
      if (
        audit.page.possibleMore
        || audit.page.returned !== audit.records.length
        || audit.records.some((record) => (
          record.type === "unknown"
          || record.unknownFieldCount !== 0
        ))
      ) {
        throw new ApplicationEntitlementEvidenceError(
          "Discord test entitlement creation requires complete exact-beneficiary inventory evidence",
        )
      }
      current = audit.records.map((record) => ({ ...record, deleted: false }))
    } else {
      const receipt = await this.#creationReceipt(
        application.id,
        beneficiary,
        request.entitlementId,
        request.skuId,
        request.creationOperationKeyHash,
      )
      creationReceipt = {
        activityId: receipt.activityId,
        creationOperationKeyHash: receipt.operationKeyHash,
        entitlementId: receipt.entitlementId!,
        verified: true,
      }
      try {
        const inspection = await this.#inspect(
          application,
          botId,
          request.beneficiary,
          request.entitlementId,
          request.skuId,
          skuAudit,
          options,
        )
        current = [assertCompleteEntitlement(inspection, {
          allowDeleted: true,
          applicationId: application.id,
          beneficiary,
          botId,
          entitlementId: request.entitlementId,
          perpetualTest: true,
          skuId: request.skuId,
        })]
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) current = []
        else throw error
      }
    }
    current.sort((left, right) => (
      BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0
    ))
    const effect = request.action === "create-test"
      ? current.length === 0 ? "change" : "none"
      : current.length === 0 || current[0]!.deleted ? "none" : "change"
    const status = effect === "change"
      ? "planned"
      : request.action === "create-test"
        ? "already-entitled"
        : "already-absent"
    const entitlementId = request.action === "delete-test"
      ? request.entitlementId
      : current[0]?.id ?? null
    const digest = inventoryDigest(
      this.#planKey,
      application.id,
      beneficiary,
      current,
      request.skuId,
    )
    const risks = [
      "Test entitlement changes affect premium access for one exact configured beneficiary",
      ...(request.action === "delete-test"
        ? ["Deletion removes premium access immediately and is irreversible"]
        : []),
      "The operation key is one-shot and cannot be retried after reservation",
      "A transport ambiguity or incomplete readback quarantines later application entitlement writes",
    ]
    const warnings = [
      "Test entitlements are only for subscription implementation testing and not one-time purchases",
      "Deletion is limited to an exact entitlement proven by a completed connector creation receipt",
      "Discord does not document audit-log reason support for entitlement writes; the reason is local review context only",
      "Product text, purchaser identity outside the exact beneficiary, raw payloads, audit reasons, and raw operation keys are never persisted",
    ]
    const planDigest = reviewedPlanDigest(this.#planKey, {
      acknowledgeIrreversibleDeletion: request.action === "delete-test",
      action: request.action,
      applicationId: application.id,
      auditReason: request.auditReason,
      beneficiary,
      botId,
      creationReceipt,
      current,
      entitlementId,
      inventoryDigest: digest,
      operationKeyHash: request.operationKeyHash,
      risks,
      sku,
      warnings,
    })
    return {
      plan: {
        acknowledgeIrreversibleDeletion: request.action === "delete-test",
        action: request.action,
        applicationId: application.id,
        auditReason: request.auditReason,
        beneficiary,
        botId,
        createdAt: this.#clock().toISOString(),
        creationReceipt,
        current,
        digest: planDigest,
        effect,
        entitlementId,
        inventory: {
          complete: true,
          digest,
          returned: current.length,
          safetyLimit: DISCORD_LIMITS.applicationEntitlementPage,
        },
        operationKeyHash: request.operationKeyHash,
        privacy: PRIVACY,
        risks,
        schemaVersion: SCHEMA_VERSION,
        sku,
        status,
        verification: {
          automaticRetry: false,
          exactReadback: true,
          rollback: "none",
        },
        warnings,
        writeRequired: effect === "change",
      },
      request,
    }
  }

  async #buildConsumptionPlan(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: NormalizedApplicationEntitlementConsumptionRequest,
    options: RequestOptions,
  ): Promise<BuiltApplicationEntitlementConsumptionPlan> {
    this.#policy.assertApplicationEntitlementConsumptionAllowed(
      request.userId,
      request.skuId,
    )
    assertSnowflake(application.id, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    await this.#assertOperationAvailable(request.operationKeyHash)
    const sku = skuEvidence(
      application.id,
      botId,
      skuAudit,
      request.skuId,
      "consume",
      "user",
      this.#planKey,
    )
    const current = assertCompleteEntitlement(
      await this.#inspect(
        application,
        botId,
        request.beneficiary,
        request.entitlementId,
        request.skuId,
        skuAudit,
        options,
      ),
      {
        allowDeleted: false,
        applicationId: application.id,
        beneficiary: beneficiaryView(request.beneficiary),
        botId,
        entitlementId: request.entitlementId,
        perpetualTest: false,
        skuId: request.skuId,
      },
    )
    const observedAt = this.#clock().getTime()
    if (
      current.consumed === null
      || !CONSUMABLE_ENTITLEMENT_TYPES.has(current.type)
      || (current.startsAt !== null && Date.parse(current.startsAt) > observedAt)
      || (current.endsAt !== null && Date.parse(current.endsAt) <= observedAt)
    ) {
      throw new ApplicationEntitlementEvidenceError(
        "Discord entitlement is not a current consumable one-time purchase",
      )
    }
    const effect = current.consumed ? "none" : "change"
    const risks = [
      "Entitlement consumption is irreversible and enables repurchase of the consumable SKU",
      "The connector cannot verify application-specific fulfillment",
      "The operation key is one-shot and cannot be retried after reservation",
      "A transport ambiguity or incomplete readback quarantines later application entitlement writes",
    ]
    const warnings = [
      "Approve consumption only after the application has durably granted the purchased benefit",
      "The fulfillment reference is operator evidence, not Discord proof of fulfillment",
      "Discord recommends consuming promptly after fulfillment",
      "The audit reason and raw fulfillment reference are transient and never sent to Discord or persisted",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      acknowledgeExternalFulfillment: true,
      applicationId: application.id,
      auditReason: request.auditReason,
      beneficiary: beneficiaryView(request.beneficiary),
      botId,
      current,
      fulfillmentReferenceHash: request.fulfillmentReferenceHash,
      operationKeyHash: request.operationKeyHash,
      risks,
      sku,
      warnings,
    })
    return {
      plan: {
        acknowledgeExternalFulfillment: true,
        action: "consume",
        applicationId: application.id,
        auditReason: request.auditReason,
        beneficiary: { id: request.userId, type: "user" },
        botId,
        createdAt: this.#clock().toISOString(),
        current,
        digest,
        effect,
        entitlementId: request.entitlementId,
        fulfillmentReferenceHash: request.fulfillmentReferenceHash,
        operationKeyHash: request.operationKeyHash,
        privacy: PRIVACY,
        risks,
        schemaVersion: SCHEMA_VERSION,
        sku,
        status: effect === "change" ? "planned" : "already-consumed",
        verification: {
          automaticRetry: false,
          exactReadback: true,
          externalFulfillmentVerifiedByConnector: false,
          rollback: "none",
        },
        warnings,
        writeRequired: effect === "change",
      },
      request,
    }
  }

  async planTestEntitlementChange(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: ApplicationTestEntitlementChangeRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationTestEntitlementPlan> {
    return (await this.#buildTestPlan(
      application,
      botId,
      skuAudit,
      normalizeApplicationTestEntitlementChangeRequest(request),
      options,
    )).plan
  }

  async planEntitlementConsumption(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: ApplicationEntitlementConsumptionRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementConsumptionPlan> {
    return (await this.#buildConsumptionPlan(
      application,
      botId,
      skuAudit,
      normalizeApplicationEntitlementConsumptionRequest(request),
      options,
    )).plan
  }

  executeTestEntitlementChange(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: ApplicationTestEntitlementChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementChangeResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord application test entitlement plan digest is invalid")
    }
    const normalized = normalizeApplicationTestEntitlementChangeRequest(request)
    return withApplicationLock(
      this.#locks,
      application.id,
      () => this.#executeTestLocked(
        application,
        botId,
        skuAudit,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ApplicationEntitlementExecutionError(
        "Discord application entitlement changes are blocked after an uncertain same-application outcome",
        {
          applicationId: application.id,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  executeEntitlementConsumption(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: ApplicationEntitlementConsumptionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementChangeResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord application entitlement consumption plan digest is invalid")
    }
    const normalized = normalizeApplicationEntitlementConsumptionRequest(request)
    return withApplicationLock(
      this.#locks,
      application.id,
      () => this.#executeConsumptionLocked(
        application,
        botId,
        skuAudit,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ApplicationEntitlementExecutionError(
        "Discord application entitlement changes are blocked after an uncertain same-application outcome",
        {
          applicationId: application.id,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeTestLocked(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: NormalizedApplicationTestEntitlementChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ApplicationEntitlementChangeResult> {
    let built: BuiltApplicationTestEntitlementPlan
    try {
      built = await this.#buildTestPlan(
        application,
        botId,
        skuAudit,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof ApplicationEntitlementEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ApplicationEntitlementPlanChangedError(
          expectedDigest,
          APPLICATION_ENTITLEMENT_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    if (built.plan.digest !== expectedDigest) {
      throw new ApplicationEntitlementPlanChangedError(
        expectedDigest,
        built.plan.digest,
      )
    }
    return this.#executeBuilt(
      application,
      botId,
      skuAudit,
      built.plan,
      built.request,
      options,
    )
  }

  async #executeConsumptionLocked(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    request: NormalizedApplicationEntitlementConsumptionRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ApplicationEntitlementChangeResult> {
    let built: BuiltApplicationEntitlementConsumptionPlan
    try {
      built = await this.#buildConsumptionPlan(
        application,
        botId,
        skuAudit,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof ApplicationEntitlementEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ApplicationEntitlementPlanChangedError(
          expectedDigest,
          APPLICATION_ENTITLEMENT_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    if (built.plan.digest !== expectedDigest) {
      throw new ApplicationEntitlementPlanChangedError(
        expectedDigest,
        built.plan.digest,
      )
    }
    return this.#executeBuilt(
      application,
      botId,
      skuAudit,
      built.plan,
      built.request,
      options,
    )
  }

  async #executeBuilt(
    application: DiscordApplication,
    botId: string,
    skuAudit: ApplicationSkuAuditResult,
    plan: ApplicationEntitlementConsumptionPlan | ApplicationTestEntitlementPlan,
    request:
      | NormalizedApplicationEntitlementConsumptionRequest
      | NormalizedApplicationTestEntitlementChangeRequest,
    options: RequestOptions,
  ): Promise<ApplicationEntitlementChangeResult> {
    const beneficiary = beneficiaryView(request.beneficiary)
    const noOpEntitlementId = request.action === "create-test"
      ? plan.entitlementId
      : request.entitlementId
    const baseResult = {
      action: request.action,
      applicationId: application.id,
      beneficiary,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      skuId: request.skuId,
    }
    if (plan.effect === "none") {
      if (!noOpEntitlementId) {
        throw new ApplicationEntitlementEvidenceError(
          "Discord application entitlement no-op lacks an exact target identity",
        )
      }
      return {
        ...baseResult,
        activityId: null,
        entitlementId: noOpEntitlementId,
        status: request.action === "create-test"
          ? "already-entitled"
          : request.action === "delete-test"
            ? "already-absent"
            : "already-consumed",
        verification: "not-required",
      }
    }

    const operationStore = entitlementOperationStore(this.#operationStore)
    const activityId = this.#randomId()
    let entitlementId = request.action === "create-test" ? null : request.entitlementId
    const pending = operationReceipt({
      activityId,
      applicationId: application.id,
      entitlementId,
      plan,
      request,
      stage: "reserved",
      status: "pending",
      timestamp: this.#clock().toISOString(),
    })
    const reservation = await operationStore.reserveApplication(pending)
    if (!reservation.created) {
      if (reservation.receipt.kind !== "application-entitlement-change") {
        throw new ApplicationEntitlementEvidenceError(
          "Discord returned a mismatched application entitlement reservation",
        )
      }
      throw new ApplicationEntitlementOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry(pending))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await operationStore.finishApplication(operationReceipt({
          activityId,
          applicationId: application.id,
          entitlementId,
          error: safeErrorCode(error),
          plan,
          request,
          stage: "terminal",
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ApplicationEntitlementExecutionError(
        "Discord application entitlement change was blocked because pending activity could not be recorded",
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
      if (request.action === "create-test") {
        const created = await this.#client.createApplicationTestEntitlement(
          application.id,
          { beneficiary: request.beneficiary, skuId: request.skuId },
          options,
        )
        mutationCompleted = true
        entitlementId = createdEntitlementId(
          created,
          application.id,
          request.beneficiary,
          request.skuId,
        )
        const checkpoint = operationReceipt({
          activityId,
          applicationId: application.id,
          entitlementId,
          plan,
          request,
          stage: "target-known",
          status: "pending",
          timestamp: this.#clock().toISOString(),
        })
        await operationStore.checkpointApplicationEntitlement(checkpoint)
        await this.#activityStore.append(activityEntry(checkpoint))
        const observed = assertCompleteEntitlement(
          await this.#inspect(
            application,
            botId,
            request.beneficiary,
            entitlementId,
            request.skuId,
            skuAudit,
            options,
          ),
          {
            allowDeleted: false,
            applicationId: application.id,
            beneficiary,
            botId,
            entitlementId,
            perpetualTest: true,
            skuId: request.skuId,
          },
        )
        if (observed.deleted) {
          throw new ApplicationEntitlementEvidenceError(
            "Discord test entitlement creation readback was not active",
          )
        }
      } else if (request.action === "delete-test") {
        await this.#client.deleteApplicationTestEntitlement(
          application.id,
          request.entitlementId,
          options,
        )
        mutationCompleted = true
        try {
          const observed = assertCompleteEntitlement(
            await this.#inspect(
              application,
              botId,
              request.beneficiary,
              request.entitlementId,
              request.skuId,
              skuAudit,
              options,
            ),
            {
              allowDeleted: true,
              applicationId: application.id,
              beneficiary,
              botId,
              entitlementId: request.entitlementId,
              perpetualTest: true,
              skuId: request.skuId,
            },
          )
          if (!observed.deleted) {
            throw new ApplicationEntitlementEvidenceError(
              "Discord test entitlement deletion readback remained active",
            )
          }
        } catch (error) {
          if (!(error instanceof DiscordApiError && error.status === 404)) throw error
        }
      } else {
        await this.#client.consumeApplicationEntitlement(
          application.id,
          request.entitlementId,
          options,
        )
        mutationCompleted = true
        const observed = assertCompleteEntitlement(
          await this.#inspect(
            application,
            botId,
            request.beneficiary,
            request.entitlementId,
            request.skuId,
            skuAudit,
            options,
          ),
          {
            allowDeleted: false,
            applicationId: application.id,
            beneficiary,
            botId,
            entitlementId: request.entitlementId,
            perpetualTest: false,
            skuId: request.skuId,
          },
        )
        if (observed.consumed !== true) {
          throw new ApplicationEntitlementEvidenceError(
            "Discord entitlement consumption readback was not consumed",
          )
        }
      }
    } catch (error) {
      const status = !mutationCompleted
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
          applicationId: application.id,
          entitlementId,
          error: errorCode,
          plan,
          request,
          stage: "terminal",
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry(operationReceipt({
          activityId,
          applicationId: application.id,
          entitlementId,
          error: errorCode,
          plan,
          request,
          stage: "terminal",
          status,
          timestamp: this.#clock().toISOString(),
        })))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationEntitlementExecutionError(
        "Discord application entitlement change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          entitlementId,
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

    if (!entitlementId) {
      throw new ApplicationEntitlementExecutionError(
        "Discord application entitlement change returned no exact target identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const completed = operationReceipt({
      activityId,
      applicationId: application.id,
      entitlementId,
      plan,
      request,
      stage: "terminal",
      status: "completed",
      timestamp: this.#clock().toISOString(),
      verification: "match",
    })
    const result: ApplicationEntitlementChangeResult = {
      ...baseResult,
      activityId,
      entitlementId,
      status: "completed",
      verification: "match",
    }
    try {
      await operationStore.finishApplication(completed)
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry(completed))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationEntitlementExecutionError(
        "Discord application entitlement change completed but the operation receipt failed",
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
      await this.#activityStore.append(activityEntry(completed))
    } catch (error) {
      throw new ApplicationEntitlementExecutionError(
        "Discord application entitlement change completed but the final activity record failed",
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
