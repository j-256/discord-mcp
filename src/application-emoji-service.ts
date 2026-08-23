import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ApplicationEmojiActivity,
  ApplicationEmojiActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordApplicationEmojiInventory,
  DiscordApplicationEmojiSummary,
  DiscordClient,
} from "./discord-client.js"
import {
  ApplicationEmojiEvidenceError,
  ApplicationEmojiExecutionError,
  ApplicationEmojiOperationConflictError,
  ApplicationEmojiPlanChangedError,
  DiscordApiError,
} from "./errors.js"
import {
  GuildExpressionFileError,
  readApplicationEmojiFileSnapshot,
  type GuildExpressionFileReview,
  type GuildExpressionFileSnapshot,
} from "./guild-expression-file.js"
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
import type { RequestOptions } from "./types.js"

export const APPLICATION_EMOJI_OMITTED_FIELDS = Object.freeze([
  "cdnUrl",
  "imageBytes",
  "rawDiscordObject",
  "roleIds",
  "uploaderId",
  "uploaderProfile",
] as const)

const APPLICATION_EMOJI_NAME_PATTERN = /^[A-Za-z0-9_]+$/u
const APPLICATION_EMOJI_STATE_UNAVAILABLE = "application-emoji-state-unavailable"
const APPLICATION_EMOJI_LOCKS = new Map<
  string,
  Promise<ApplicationEmojiTargetOutcome>
>()

type ApplicationEmojiTargetOutcome = "settled" | "uncertain"
export type ApplicationEmojiAction = "create" | "delete" | "rename"

export interface CreateApplicationEmojiRequest {
  action: "create"
  filePath: string
  name: string
  operationKey: string
}

export interface RenameApplicationEmojiRequest {
  action: "rename"
  emojiId: string
  name: string
  operationKey: string
}

export interface DeleteApplicationEmojiRequest {
  acknowledgeGlobalImpact: true
  action: "delete"
  emojiId: string
  operationKey: string
}

export type ApplicationEmojiChangeRequest =
  | CreateApplicationEmojiRequest
  | DeleteApplicationEmojiRequest
  | RenameApplicationEmojiRequest

interface NormalizedApplicationEmojiRequestBase {
  action: ApplicationEmojiAction
  operationKeyHash: string
}

export type NormalizedApplicationEmojiChangeRequest =
  | (Omit<CreateApplicationEmojiRequest, "operationKey"> & NormalizedApplicationEmojiRequestBase)
  | (Omit<DeleteApplicationEmojiRequest, "operationKey"> & NormalizedApplicationEmojiRequestBase)
  | (Omit<RenameApplicationEmojiRequest, "operationKey"> & NormalizedApplicationEmojiRequestBase)

export interface ProjectedApplicationEmoji {
  animated: boolean
  available: boolean
  emojiId: string
  managed: boolean
  name: string
  requiresColons: boolean
  unknownFieldCount: number
  uploaderProjectedOut: true
}

export type PlannedApplicationEmoji = Omit<
  ProjectedApplicationEmoji,
  "emojiId"
> & { emojiId: string | null }

export interface ApplicationEmojiPrivacyProjection {
  omittedFields: typeof APPLICATION_EMOJI_OMITTED_FIELDS
  privateFieldsProjectedOut: true
}

export interface ApplicationEmojiInventoryResult {
  applicationId: string
  botId: string
  emojis: ProjectedApplicationEmoji[]
  page: {
    returned: number
    safetyLimit: number
  }
  privacy: ApplicationEmojiPrivacyProjection
  responseUnknownFieldCount: number
  schemaVersion: number
  status: "ok"
}

export interface ApplicationEmojiLookupResult extends Omit<
  ApplicationEmojiInventoryResult,
  "emojis" | "page"
> {
  emoji: ProjectedApplicationEmoji
}

export interface ApplicationEmojiPlan {
  action: ApplicationEmojiAction
  applicationId: string
  botId: string
  createdAt: string
  desired: PlannedApplicationEmoji | null
  digest: string
  effect: "change" | "none"
  emojiId: string | null
  existing: ProjectedApplicationEmoji | null
  file: {
    contentDigest: string
    review: GuildExpressionFileReview
  } | null
  inventory: {
    digest: string
    returned: number
    safetyLimit: number
  }
  operationKeyHash: string
  privacy: ApplicationEmojiPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-absent" | "already-current" | "planned"
  verification: {
    imageBytesReadableAfterWrite: false
    metadataReadback: "exact-application-emoji"
  }
  warnings: string[]
  writeRequired: boolean
}

export interface ApplicationEmojiResult {
  action: ApplicationEmojiAction
  activityId: string | null
  applicationId: string
  emojiId: string
  observed: ProjectedApplicationEmoji | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-absent" | "already-current" | "completed" | "completed-with-drift"
}

export interface ApplicationEmojiServiceClient {
  createApplicationEmoji: DiscordClient["createApplicationEmoji"]
  deleteApplicationEmoji: DiscordClient["deleteApplicationEmoji"]
  getApplicationEmoji: DiscordClient["getApplicationEmoji"]
  listApplicationEmojis: DiscordClient["listApplicationEmojis"]
  modifyApplicationEmoji: DiscordClient["modifyApplicationEmoji"]
}

export interface ApplicationEmojiServiceOptions {
  activityStore: ActivityStore
  client: ApplicationEmojiServiceClient
  clock?: () => Date
  fileRoots: readonly string[]
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface ExactApplicationEmojiInventory {
  emojis: ProjectedApplicationEmoji[]
  responseUnknownFieldCount: number
}

interface BuiltApplicationEmojiPlan {
  fileSnapshot: GuildExpressionFileSnapshot | null
  plan: ApplicationEmojiPlan
}

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

function normalizeName(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 2
    || value.length > 32
    || !APPLICATION_EMOJI_NAME_PATTERN.test(value)
  ) {
    throw new RangeError(
      "Discord application emoji name must contain 2-32 ASCII letters, digits, or underscores",
    )
  }
  return value
}

export function normalizeApplicationEmojiChangeRequest(
  request: ApplicationEmojiChangeRequest,
): NormalizedApplicationEmojiChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord application emoji request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (record.action === "create") {
    if (
      !exactKeys(record, ["action", "filePath", "name", "operationKey"])
      || typeof record.filePath !== "string"
      || !record.filePath
    ) {
      throw new RangeError("Discord application emoji create request is invalid")
    }
    return {
      action: "create",
      filePath: record.filePath,
      name: normalizeName(record.name),
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "rename") {
    if (!exactKeys(record, ["action", "emojiId", "name", "operationKey"])) {
      throw new RangeError("Discord application emoji rename request is invalid")
    }
    assertSnowflake(record.emojiId, "Discord application emoji ID")
    return {
      action: "rename",
      emojiId: record.emojiId,
      name: normalizeName(record.name),
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "delete") {
    if (
      !exactKeys(record, [
        "acknowledgeGlobalImpact",
        "action",
        "emojiId",
        "operationKey",
      ])
      || record.acknowledgeGlobalImpact !== true
    ) {
      throw new RangeError(
        "Discord application emoji deletion requires acknowledgeGlobalImpact=true",
      )
    }
    assertSnowflake(record.emojiId, "Discord application emoji ID")
    return {
      acknowledgeGlobalImpact: true,
      action: "delete",
      emojiId: record.emojiId,
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  throw new RangeError("Discord application emoji action must be create, rename, or delete")
}

function projectedEmoji(
  value: DiscordApplicationEmojiSummary,
): ProjectedApplicationEmoji {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.animated !== "boolean"
    || typeof value.available !== "boolean"
    || typeof value.managed !== "boolean"
    || typeof value.requiresColons !== "boolean"
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
    || value.uploaderProjectedOut !== true
  ) {
    throw new ApplicationEmojiEvidenceError(
      "Discord returned invalid projected application emoji evidence",
    )
  }
  try {
    assertSnowflake(value.id, "Discord application emoji ID")
    normalizeName(value.name)
  } catch (error) {
    throw new ApplicationEmojiEvidenceError(
      "Discord returned invalid projected application emoji evidence",
      { cause: error },
    )
  }
  return {
    animated: value.animated,
    available: value.available,
    emojiId: value.id,
    managed: value.managed,
    name: value.name,
    requiresColons: value.requiresColons,
    unknownFieldCount: value.unknownFieldCount,
    uploaderProjectedOut: true,
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  if (leftId < rightId) return -1
  if (leftId > rightId) return 1
  return 0
}

function exactInventory(
  value: DiscordApplicationEmojiInventory,
): ExactApplicationEmojiInventory {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Array.isArray(value.items)
    || value.items.length > DISCORD_LIMITS.applicationEmojis
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) {
    throw new ApplicationEmojiEvidenceError(
      "Discord returned an invalid application emoji inventory",
    )
  }
  const emojis = value.items.map(projectedEmoji)
  if (new Set(emojis.map((emoji) => emoji.emojiId)).size !== emojis.length) {
    throw new ApplicationEmojiEvidenceError(
      "Discord returned duplicate application emoji IDs",
    )
  }
  emojis.sort((left, right) => compareSnowflakes(left.emojiId, right.emojiId))
  return {
    emojis,
    responseUnknownFieldCount: value.unknownFieldCount,
  }
}

function assertChangeSafeInventory(
  inventory: ExactApplicationEmojiInventory,
): void {
  if (
    inventory.responseUnknownFieldCount > 0
    || inventory.emojis.some((emoji) => (
      emoji.unknownFieldCount > 0
      || emoji.managed
      || !emoji.requiresColons
    ))
  ) {
    throw new ApplicationEmojiEvidenceError(
      "Discord application emoji changes require complete known unmanaged inventory evidence",
    )
  }
}

function assertChangeSafeReadback(
  emoji: ProjectedApplicationEmoji,
  expectedEmojiId: string,
): void {
  if (
    emoji.emojiId !== expectedEmojiId
    || emoji.unknownFieldCount > 0
    || emoji.managed
    || !emoji.requiresColons
  ) {
    throw new ApplicationEmojiEvidenceError(
      "Discord returned unsafe application emoji readback evidence",
    )
  }
}

function privacyProjection(): ApplicationEmojiPrivacyProjection {
  return {
    omittedFields: APPLICATION_EMOJI_OMITTED_FIELDS,
    privateFieldsProjectedOut: true,
  }
}

function inventoryResult(
  applicationId: string,
  botId: string,
  inventory: ExactApplicationEmojiInventory,
): ApplicationEmojiInventoryResult {
  return {
    applicationId,
    botId,
    emojis: inventory.emojis,
    page: {
      returned: inventory.emojis.length,
      safetyLimit: DISCORD_LIMITS.applicationEmojis,
    },
    privacy: privacyProjection(),
    responseUnknownFieldCount: inventory.responseUnknownFieldCount,
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
  }
}

function sameEmoji(
  left: PlannedApplicationEmoji,
  right: PlannedApplicationEmoji,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function targetId(
  request: NormalizedApplicationEmojiChangeRequest,
): string | null {
  return request.action === "create" ? null : request.emojiId
}

function activityEntry(options: {
  activityId: string
  applicationId: string
  emojiId?: string | null
  error?: string | null
  plan: ApplicationEmojiPlan
  request: NormalizedApplicationEmojiChangeRequest
  status: ApplicationEmojiActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ApplicationEmojiActivity {
  return {
    action: options.request.action,
    applicationId: options.applicationId,
    emojiId: options.emojiId === undefined
      ? targetId(options.request)
      : options.emojiId,
    error: options.error ?? null,
    id: options.activityId,
    kind: "application-emoji-change",
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
  applicationId: string
  emojiId?: string | null
  error?: string | null
  plan: ApplicationEmojiPlan
  request: NormalizedApplicationEmojiChangeRequest
  status: ApplicationOperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): ApplicationOperationReceipt {
  return {
    activityId: options.activityId,
    applicationId: options.applicationId,
    error: options.error ?? null,
    kind: "application-emoji-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.emojiId ?? targetId(options.request),
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
    emojiId: receipt.resourceId,
    error: receipt.error,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function executionBlocksApplication(error: unknown): boolean {
  if (
    !(error instanceof ApplicationEmojiExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-operation-record-failed", "uncertain"]
    .includes(String(error.result.status))
}

function applicationOperationStore(
  store: OperationStore,
): ApplicationOperationStore {
  if (
    !store.finishApplication
    || !store.getApplication
    || !store.reserveApplication
  ) {
    throw new ApplicationEmojiExecutionError(
      "Discord application emoji changes require an application-scoped operation store",
      { status: "blocked-operation-store-incompatible" },
    )
  }
  return store as ApplicationOperationStore
}

async function withApplicationLock<T>(
  applicationId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ApplicationEmojiExecutionError,
): Promise<T> {
  const prior = APPLICATION_EMOJI_LOCKS.get(applicationId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ApplicationEmojiTargetOutcome) => void = () => undefined
  const tail = new Promise<ApplicationEmojiTargetOutcome>((resolve) => {
    release = resolve
  })
  APPLICATION_EMOJI_LOCKS.set(applicationId, tail)
  let outcome: ApplicationEmojiTargetOutcome = "settled"
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
    if (APPLICATION_EMOJI_LOCKS.get(applicationId) === tail) {
      APPLICATION_EMOJI_LOCKS.delete(applicationId)
    }
  }
}

export class ApplicationEmojiService {
  readonly #activityStore: ActivityStore
  readonly #client: ApplicationEmojiServiceClient
  readonly #clock: () => Date
  readonly #fileRoots: readonly string[]
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ApplicationEmojiServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#fileRoots = options.fileRoots
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async list(
    applicationId: string,
    botId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiInventoryResult> {
    this.#policy.assertApplicationEmojiAuditable()
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    const inventory = exactInventory(
      await this.#client.listApplicationEmojis(applicationId, options),
    )
    return inventoryResult(applicationId, botId, inventory)
  }

  async get(
    applicationId: string,
    botId: string,
    emojiId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiLookupResult> {
    this.#policy.assertApplicationEmojiAuditable()
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    assertSnowflake(emojiId, "Discord application emoji ID")
    const emoji = projectedEmoji(
      await this.#client.getApplicationEmoji(applicationId, emojiId, options),
    )
    if (emoji.emojiId !== emojiId) {
      throw new ApplicationEmojiEvidenceError(
        "Discord returned a different application emoji than requested",
      )
    }
    return {
      applicationId,
      botId,
      emoji,
      privacy: privacyProjection(),
      responseUnknownFieldCount: 0,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedApplicationEmojiChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltApplicationEmojiPlan> {
    this.#policy.assertApplicationEmojiChangeAllowed()
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    const [inventory, fileSnapshot] = await Promise.all([
      this.#client.listApplicationEmojis(applicationId, options)
        .then(exactInventory),
      request.action === "create"
        ? readApplicationEmojiFileSnapshot({
          filePath: request.filePath,
          planKey: this.#planKey,
          roots: this.#fileRoots,
        })
        : Promise.resolve(null),
    ])
    assertChangeSafeInventory(inventory)
    const existing = request.action === "create"
      ? null
      : inventory.emojis.find((emoji) => emoji.emojiId === request.emojiId) ?? null
    if (request.action === "rename" && existing === null) {
      throw new ApplicationEmojiEvidenceError(
        "Discord application emoji rename target is absent",
      )
    }
    if (request.action === "create") {
      if (inventory.emojis.length >= DISCORD_LIMITS.applicationEmojis) {
        throw new ApplicationEmojiEvidenceError(
          "Discord application emoji inventory is at the documented capacity",
        )
      }
      if (inventory.emojis.some((emoji) => emoji.name === request.name)) {
        throw new ApplicationEmojiEvidenceError(
          "Discord application emoji creation name collides with the exact inventory",
        )
      }
    }
    if (
      request.action === "rename"
      && inventory.emojis.some((emoji) => (
        emoji.emojiId !== request.emojiId
        && emoji.name === request.name
      ))
    ) {
      throw new ApplicationEmojiEvidenceError(
        "Discord application emoji rename name collides with the exact inventory",
      )
    }
    let desired: PlannedApplicationEmoji | null
    if (request.action === "delete") {
      desired = null
    } else if (request.action === "create") {
      desired = {
        animated: fileSnapshot!.review.animated,
        available: true,
        emojiId: null,
        managed: false,
        name: request.name,
        requiresColons: true,
        unknownFieldCount: 0,
        uploaderProjectedOut: true,
      }
    } else {
      desired = {
        ...existing!,
        name: request.name,
      }
    }
    const effect = request.action === "delete"
      ? existing === null ? "none" : "change"
      : request.action === "rename" && existing !== null
        && sameEmoji(existing, desired!)
        ? "none"
        : "change"
    const inventoryDigest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      emojis: inventory.emojis,
      responseUnknownFieldCount: inventory.responseUnknownFieldCount,
    })
    const privacy = privacyProjection()
    const risks = [
      "Application emoji changes affect one application-wide collection across every installation",
      ...(request.action === "create"
        ? ["Application emoji image bytes cannot be read back after creation"]
        : []),
      "Discord does not document audit-log reason support for application emoji writes",
      "The operation key is one-shot and cannot be retried after reservation",
    ]
    const warnings = [
      ...(request.action === "delete"
        ? ["Deletion is irreversible and may break emoji references across every application installation"]
        : []),
      ...(request.action === "rename"
        ? ["Renaming changes public metadata anywhere the application emoji is referenced"]
        : []),
      "Emoji names and local paths are untrusted data and are never persisted by this workflow",
    ]
    const reviewedRequest = request.action === "create"
      ? { ...request, filePath: request.filePath }
      : request
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      desired,
      existing,
      file: fileSnapshot
        ? {
            binding: fileSnapshot.binding,
            contentDigest: fileSnapshot.contentDigest,
            review: fileSnapshot.review,
          }
        : null,
      inventoryDigest,
      request: reviewedRequest,
      risks,
      warnings,
    })
    const status = effect === "change"
      ? "planned"
      : request.action === "delete"
        ? "already-absent"
        : "already-current"
    return {
      fileSnapshot,
      plan: {
        action: request.action,
        applicationId,
        botId,
        createdAt: this.#clock().toISOString(),
        desired,
        digest,
        effect,
        emojiId: targetId(request),
        existing,
        file: fileSnapshot
          ? {
              contentDigest: fileSnapshot.contentDigest,
              review: fileSnapshot.review,
            }
          : null,
        inventory: {
          digest: inventoryDigest,
          returned: inventory.emojis.length,
          safetyLimit: DISCORD_LIMITS.applicationEmojis,
        },
        operationKeyHash: request.operationKeyHash,
        privacy,
        risks,
        schemaVersion: SCHEMA_VERSION,
        status,
        verification: {
          imageBytesReadableAfterWrite: false,
          metadataReadback: "exact-application-emoji",
        },
        warnings,
        writeRequired: effect === "change",
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: ApplicationEmojiChangeRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeApplicationEmojiChangeRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: ApplicationEmojiChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ApplicationEmojiResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord application emoji plan digest is invalid")
    }
    const normalized = normalizeApplicationEmojiChangeRequest(request)
    return withApplicationLock(
      applicationId,
      () => this.#executeLocked(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ApplicationEmojiExecutionError(
        "Discord application emoji changes are blocked after an uncertain same-application outcome",
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
    request: NormalizedApplicationEmojiChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ApplicationEmojiResult> {
    let built: BuiltApplicationEmojiPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ApplicationEmojiEvidenceError
        || error instanceof GuildExpressionFileError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ApplicationEmojiPlanChangedError(
          expectedDigest,
          APPLICATION_EMOJI_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { fileSnapshot, plan } = built
    if (plan.digest !== expectedDigest) {
      throw new ApplicationEmojiPlanChangedError(expectedDigest, plan.digest)
    }
    const fallbackEmojiId = request.action === "create" ? null : request.emojiId
    const baseResult = {
      action: request.action,
      applicationId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      return {
        ...baseResult,
        activityId: null,
        emojiId: fallbackEmojiId!,
        observed: plan.existing,
        status: request.action === "delete" ? "already-absent" : "already-current",
      }
    }

    const operationStore = applicationOperationStore(this.#operationStore)
    const activityId = this.#randomId()
    const reservation = await operationStore.reserveApplication(
      operationReceipt({
        activityId,
        applicationId,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }),
    )
    if (!reservation.created) {
      throw new ApplicationEmojiOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        applicationId,
        plan,
        request,
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
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ApplicationEmojiExecutionError(
        "Discord application emoji change was blocked because pending activity could not be recorded",
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

    let emojiId = fallbackEmojiId
    let mutationCompleted = false
    let observed: ProjectedApplicationEmoji | null = null
    try {
      if (request.action === "create") {
        const created = projectedEmoji(
          await this.#client.createApplicationEmoji(applicationId, {
            bytes: fileSnapshot!.bytes,
            format: fileSnapshot!.review.format as "avif" | "gif" | "jpeg" | "png" | "webp",
            name: request.name,
          }, options),
        )
        mutationCompleted = true
        emojiId = created.emojiId
        const desired = { ...plan.desired!, emojiId }
        if (!sameEmoji(created, desired)) {
          throw new ApplicationEmojiEvidenceError(
            "Discord application emoji creation response did not match the reviewed intent",
          )
        }
        observed = projectedEmoji(
          await this.#client.getApplicationEmoji(applicationId, emojiId, options),
        )
        assertChangeSafeReadback(observed, emojiId)
      } else if (request.action === "rename") {
        const modified = projectedEmoji(
          await this.#client.modifyApplicationEmoji(
            applicationId,
            request.emojiId,
            { name: request.name },
            options,
          ),
        )
        mutationCompleted = true
        if (!sameEmoji(modified, plan.desired!)) {
          throw new ApplicationEmojiEvidenceError(
            "Discord application emoji rename response did not match the reviewed intent",
          )
        }
        observed = projectedEmoji(
          await this.#client.getApplicationEmoji(
            applicationId,
            request.emojiId,
            options,
          ),
        )
        assertChangeSafeReadback(observed, request.emojiId)
      } else {
        await this.#client.deleteApplicationEmoji(
          applicationId,
          request.emojiId,
          options,
        )
        mutationCompleted = true
        const inventory = exactInventory(
          await this.#client.listApplicationEmojis(applicationId, options),
        )
        assertChangeSafeInventory(inventory)
        observed = inventory.emojis.find(
          (emoji) => emoji.emojiId === request.emojiId,
        ) ?? null
      }
    } catch (error) {
      const status = !mutationCompleted
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
          emojiId,
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
          applicationId,
          emojiId,
          error: errorCode,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ApplicationEmojiExecutionError(
        "Discord application emoji change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          emojiId,
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

    if (!emojiId) {
      throw new ApplicationEmojiExecutionError(
        "Discord application emoji change returned no exact resource identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const matched = request.action === "delete"
      ? observed === null
      : observed !== null && sameEmoji(
        observed,
        { ...plan.desired!, emojiId },
      )
    const verification = matched ? "match" : "drift"
    const status = matched ? "completed" : "completed-with-drift"
    const result: ApplicationEmojiResult = {
      ...baseResult,
      activityId,
      emojiId,
      observed,
      status,
    }
    try {
      await operationStore.finishApplication(operationReceipt({
        activityId,
        applicationId,
        emojiId,
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
          applicationId,
          emojiId,
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
      throw new ApplicationEmojiExecutionError(
        "Discord application emoji change completed but the operation receipt failed",
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
        emojiId,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ApplicationEmojiExecutionError(
        "Discord application emoji change completed but the final activity record failed",
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
