import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  BotProfileActivity,
  BotProfileActivityStatus,
} from "./activity-log.js"
import {
  BotProfileImageFileError,
  readBotProfileImageFileSnapshot,
  type BotProfileImageFileReview,
  type BotProfileImageFileSnapshot,
} from "./bot-profile-file.js"
import {
  normalizeDesiredBotUsername,
  type DiscordCurrentBotProfile,
  type ModifyCurrentBotProfileInput,
} from "./bot-profile.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  BotProfileEvidenceError,
  BotProfileExecutionError,
  BotProfileOperationConflictError,
  BotProfilePlanChangedError,
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

export const BOT_PROFILE_FIELDS = Object.freeze([
  "avatar",
  "banner",
  "username",
] as const)

export type BotProfileField = typeof BOT_PROFILE_FIELDS[number]

export type BotProfileImageChange =
  | { action: "clear" }
  | { action: "set"; filePath: string }

export interface BotProfileChangeRequest {
  acknowledgeApplicationWideChange: true
  avatar?: BotProfileImageChange
  banner?: BotProfileImageChange
  operationKey: string
  reviewReason: string
  username?: string
}

export interface NormalizedBotProfileChangeRequest {
  acknowledgeApplicationWideChange: true
  avatar?: BotProfileImageChange
  banner?: BotProfileImageChange
  operationKeyHash: string
  reviewReason: string
  username?: string
}

export interface BotProfileImageState {
  animated: boolean
  present: boolean
}

export interface BotProfilePresentation {
  avatar: BotProfileImageState
  banner: BotProfileImageState
  username: string
}

export interface BotProfileAuditResult {
  applicationId: string
  botId: string
  privacy: BotProfilePrivacyProjection
  profile: BotProfilePresentation
  responseUnknownFieldCount: number
  schemaVersion: number
  status: "ok"
}

export type BotProfilePlanFileReview = Omit<
  BotProfileImageFileReview,
  "canonicalPath"
>

export interface BotProfilePlanFile {
  contentDigest: string
  review: BotProfilePlanFileReview
}

export interface BotProfilePrivacyProjection {
  omittedFields: readonly [
    "application-payload",
    "avatar-hash",
    "banner-hash",
    "file-paths",
    "image-bytes",
    "raw-operation-key",
    "raw-user-payload",
  ]
  persistence: "content-free-records-only"
}

export interface BotProfileChangePlan {
  applicationId: string
  botId: string
  changedFields: BotProfileField[]
  createdAt: string
  current: BotProfilePresentation
  desired: BotProfilePresentation
  digest: string
  effect: "change" | "none"
  files: {
    avatar: BotProfilePlanFile | null
    banner: BotProfilePlanFile | null
  }
  operationKeyHash: string
  privacy: BotProfilePrivacyProjection
  requestedFields: BotProfileField[]
  responseUnknownFieldCount: number
  reviewReason: string
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verification: {
    applicationIdentity: "exact"
    imageByteEquality: "not-observable"
    mutationResponse: "strict-current-bot-profile"
    readback: "independent-exact-editable-state"
  }
  warnings: string[]
  writeRequired: boolean
}

export interface BotProfileChangeResult {
  activityId: string | null
  applicationId: string
  botId: string
  changedFields: BotProfileField[]
  observed: BotProfilePresentation
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed"
}

export interface BotProfileServiceClient {
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  getCurrentBotProfile: DiscordClient["getCurrentBotProfile"]
  modifyCurrentBotProfile: DiscordClient["modifyCurrentBotProfile"]
}

export interface BotProfileServiceOptions {
  activityStore: ActivityStore
  client: BotProfileServiceClient
  clock?: () => Date
  fileRoots: readonly string[]
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    "assertBotProfileAuditable" | "assertBotProfileChangeAllowed"
  >
  randomId?: () => string
}

interface BuiltBotProfilePlan {
  avatarSnapshot: BotProfileImageFileSnapshot | null
  bannerSnapshot: BotProfileImageFileSnapshot | null
  current: DiscordCurrentBotProfile
  mutationInput: ModifyCurrentBotProfileInput
  plan: BotProfileChangePlan
}

type BotProfileTargetOutcome = "settled" | "uncertain"

const BOT_PROFILE_STATE_UNAVAILABLE = "bot-profile-state-unavailable"
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const BOT_PROFILE_LOCKS = new Map<string, Promise<BotProfileTargetOutcome>>()
const PRIVACY_PROJECTION = Object.freeze({
  omittedFields: Object.freeze([
    "application-payload",
    "avatar-hash",
    "banner-hash",
    "file-paths",
    "image-bytes",
    "raw-operation-key",
    "raw-user-payload",
  ] as const),
  persistence: "content-free-records-only" as const,
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

function normalizeReviewReason(value: unknown): string {
  if (
    typeof value !== "string"
    || value.trim().length < 1
    || value.length > CONNECTOR_LIMITS.botProfileReviewReasonCharacters
    || CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord bot-profile review reason must contain 1-${CONNECTOR_LIMITS.botProfileReviewReasonCharacters} safe characters`,
    )
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(
      "Discord bot-profile review reason contains invalid Unicode",
      { cause: error },
    )
  }
  return value
}

function normalizeImageChange(
  value: unknown,
  field: "avatar" | "banner",
): BotProfileImageChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`Discord bot ${field} change must be an exact object`)
  }
  const record = value as Record<string, unknown>
  if (record.action === "clear" && exactKeys(record, ["action"])) {
    return { action: "clear" }
  }
  if (
    record.action === "set"
    && exactKeys(record, ["action", "filePath"])
    && typeof record.filePath === "string"
  ) {
    return { action: "set", filePath: record.filePath }
  }
  throw new RangeError(
    `Discord bot ${field} change must be exactly clear or set with one local file path`,
  )
}

export function normalizeBotProfileChangeRequest(
  request: BotProfileChangeRequest,
): NormalizedBotProfileChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord bot-profile request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  const keys = Object.keys(record)
  const required = [
    "acknowledgeApplicationWideChange",
    "operationKey",
    "reviewReason",
  ]
  if (
    keys.some((key) => ![
      ...required,
      ...BOT_PROFILE_FIELDS,
    ].includes(key))
    || required.some((key) => !keys.includes(key))
    || keys.some((key) => record[key] === undefined)
    || record.acknowledgeApplicationWideChange !== true
    || !BOT_PROFILE_FIELDS.some((field) => keys.includes(field))
  ) {
    throw new RangeError(
      "Discord bot-profile request requires exact fields, application-wide acknowledgement, and at least one change",
    )
  }
  return {
    acknowledgeApplicationWideChange: true,
    ...(record.avatar !== undefined
      ? { avatar: normalizeImageChange(record.avatar, "avatar") }
      : {}),
    ...(record.banner !== undefined
      ? { banner: normalizeImageChange(record.banner, "banner") }
      : {}),
    operationKeyHash: operationKeyHash(record.operationKey as string),
    reviewReason: normalizeReviewReason(record.reviewReason),
    ...(record.username !== undefined
      ? { username: normalizeDesiredBotUsername(record.username) }
      : {}),
  }
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
    || !application.bot
    || application.bot.id !== botId
    || application.bot.bot !== true
    || application.bot.system === true
  ) {
    throw new BotProfileEvidenceError(
      "Discord returned current-application evidence for a different bot identity",
    )
  }
}

function imageState(hash: string | null): BotProfileImageState {
  return {
    animated: hash?.startsWith("a_") ?? false,
    present: hash !== null,
  }
}

function presentation(profile: DiscordCurrentBotProfile): BotProfilePresentation {
  return {
    avatar: imageState(profile.avatarHash),
    banner: imageState(profile.bannerHash),
    username: profile.username,
  }
}

function publicFile(
  snapshot: BotProfileImageFileSnapshot | null,
): BotProfilePlanFile | null {
  if (!snapshot) return null
  const { canonicalPath: _canonicalPath, ...review } = snapshot.review
  return {
    contentDigest: snapshot.contentDigest,
    review,
  }
}

function requestedFields(
  request: NormalizedBotProfileChangeRequest,
): BotProfileField[] {
  return BOT_PROFILE_FIELDS.filter((field) => request[field] !== undefined)
}

function changedFields(
  request: NormalizedBotProfileChangeRequest,
  current: DiscordCurrentBotProfile,
): BotProfileField[] {
  return requestedFields(request).filter((field) => {
    if (field === "username") return request.username !== current.username
    const change = request[field]
    if (!change) return false
    return change.action === "set" || current[`${field}Hash`] !== null
  })
}

function desiredPresentation(
  request: NormalizedBotProfileChangeRequest,
  current: DiscordCurrentBotProfile,
  avatarSnapshot: BotProfileImageFileSnapshot | null,
  bannerSnapshot: BotProfileImageFileSnapshot | null,
): BotProfilePresentation {
  const image = (
    field: "avatar" | "banner",
    snapshot: BotProfileImageFileSnapshot | null,
  ): BotProfileImageState => {
    const change = request[field]
    if (!change) return imageState(current[`${field}Hash`])
    if (change.action === "clear") return { animated: false, present: false }
    return {
      animated: snapshot!.review.animated,
      present: true,
    }
  }
  return {
    avatar: image("avatar", avatarSnapshot),
    banner: image("banner", bannerSnapshot),
    username: request.username ?? current.username,
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
    throw new BotProfileExecutionError(
      "Discord bot-profile changes require an application-scoped operation store",
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
  plan: BotProfileChangePlan
  status: BotProfileActivityStatus
  timestamp: string
  verification?: "match" | null
}): BotProfileActivity {
  return {
    applicationId: options.applicationId,
    avatarChanged: options.plan.changedFields.includes("avatar"),
    bannerChanged: options.plan.changedFields.includes("banner"),
    botId: options.botId,
    error: options.error ?? null,
    id: options.activityId,
    kind: "bot-profile-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    usernameChanged: options.plan.changedFields.includes("username"),
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  applicationId: string
  botId: string
  error?: string | null
  plan: BotProfileChangePlan
  status: ApplicationOperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): ApplicationOperationReceipt {
  return {
    activityId: options.activityId,
    applicationId: options.applicationId,
    error: options.error ?? null,
    kind: "bot-profile-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.botId,
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
    botId: receipt.resourceId,
    error: receipt.error,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function executionBlocksApplication(error: unknown): boolean {
  if (
    !(error instanceof BotProfileExecutionError)
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
  priorUncertainError: () => BotProfileExecutionError,
): Promise<T> {
  const prior = BOT_PROFILE_LOCKS.get(applicationId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: BotProfileTargetOutcome) => void = () => undefined
  const tail = new Promise<BotProfileTargetOutcome>((resolve) => {
    release = resolve
  })
  BOT_PROFILE_LOCKS.set(applicationId, tail)
  let outcome: BotProfileTargetOutcome = "settled"
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
    if (BOT_PROFILE_LOCKS.get(applicationId) === tail) {
      BOT_PROFILE_LOCKS.delete(applicationId)
    }
  }
}

function sameEditableProfile(
  left: DiscordCurrentBotProfile,
  right: DiscordCurrentBotProfile,
): boolean {
  return left.id === right.id
    && left.bot === right.bot
    && left.username === right.username
    && left.avatarHash === right.avatarHash
    && left.bannerHash === right.bannerHash
}

function assertExpectedTransition(
  current: DiscordCurrentBotProfile,
  request: NormalizedBotProfileChangeRequest,
  avatarSnapshot: BotProfileImageFileSnapshot | null,
  bannerSnapshot: BotProfileImageFileSnapshot | null,
  observed: DiscordCurrentBotProfile,
): void {
  const expectedUsername = request.username ?? current.username
  if (observed.username !== expectedUsername) {
    throw new BotProfileEvidenceError(
      "Discord bot-profile evidence did not match the reviewed username transition",
    )
  }
  for (const field of ["avatar", "banner"] as const) {
    const change = request[field]
    const observedHash = observed[`${field}Hash`]
    if (!change && observedHash !== current[`${field}Hash`]) {
      throw new BotProfileEvidenceError(
        `Discord bot-profile evidence changed the unreviewed ${field}`,
      )
    }
    if (change?.action === "clear" && observedHash !== null) {
      throw new BotProfileEvidenceError(
        `Discord bot-profile evidence did not clear the reviewed ${field}`,
      )
    }
    if (change?.action === "set") {
      const snapshot = field === "avatar" ? avatarSnapshot : bannerSnapshot
      if (
        observedHash === null
        || observedHash.startsWith("a_") !== snapshot!.review.animated
      ) {
        throw new BotProfileEvidenceError(
          `Discord bot-profile evidence did not accept the reviewed ${field} presentation`,
        )
      }
    }
  }
}

export class BotProfileService {
  readonly #activityStore: ActivityStore
  readonly #client: BotProfileServiceClient
  readonly #clock: () => Date
  readonly #fileRoots: readonly string[]
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: BotProfileServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: BotProfileServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#fileRoots = options.fileRoots
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async get(
    applicationId: string,
    botId: string,
    options: RequestOptions = {},
  ): Promise<BotProfileAuditResult> {
    this.#policy.assertBotProfileAuditable()
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    const [application, profile] = await Promise.all([
      this.#client.getCurrentApplication(options),
      this.#client.getCurrentBotProfile(botId, options),
    ])
    validateApplicationIdentity(application, applicationId, botId)
    return {
      applicationId,
      botId,
      privacy: PRIVACY_PROJECTION,
      profile: presentation(profile),
      responseUnknownFieldCount: profile.unknownFieldCount,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedBotProfileChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltBotProfilePlan> {
    this.#policy.assertBotProfileChangeAllowed()
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    const [application, current] = await Promise.all([
      this.#client.getCurrentApplication(options),
      this.#client.getCurrentBotProfile(botId, options),
    ])
    validateApplicationIdentity(application, applicationId, botId)
    const [avatarSnapshot, bannerSnapshot] = await Promise.all([
      request.avatar?.action === "set"
        ? readBotProfileImageFileSnapshot({
          filePath: request.avatar.filePath,
          kind: "avatar",
          planKey: this.#planKey,
          roots: this.#fileRoots,
        })
        : Promise.resolve(null),
      request.banner?.action === "set"
        ? readBotProfileImageFileSnapshot({
          filePath: request.banner.filePath,
          kind: "banner",
          planKey: this.#planKey,
          roots: this.#fileRoots,
        })
        : Promise.resolve(null),
    ])
    const fields = requestedFields(request)
    const changes = changedFields(request, current)
    const desired = desiredPresentation(
      request,
      current,
      avatarSnapshot,
      bannerSnapshot,
    )
    const risks = [
      "This changes the bot profile across every guild installation and direct conversation",
      "Discord's current-user PATCH has no conditional update, so an external profile edit can race this workflow",
      "Discord does not document audit-log reason support for current-user changes",
      "The operation key is one-shot and an ambiguous outcome is never retried",
    ]
    const warnings = [
      "The review reason is bound to this plan but is neither sent to Discord nor persisted",
      "Image readback proves accepted presentation metadata, not remote byte equality",
      "Usernames, local paths, raw image hashes, and image metadata are never persisted by this workflow",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      current,
      desired,
      files: {
        avatar: avatarSnapshot
          ? {
              binding: avatarSnapshot.binding,
              contentDigest: avatarSnapshot.contentDigest,
              review: avatarSnapshot.review,
            }
          : null,
        banner: bannerSnapshot
          ? {
              binding: bannerSnapshot.binding,
              contentDigest: bannerSnapshot.contentDigest,
              review: bannerSnapshot.review,
            }
          : null,
      },
      request,
      risks,
      warnings,
    })
    const mutationInput: ModifyCurrentBotProfileInput = {
      ...(changes.includes("avatar")
        ? {
            avatar: request.avatar!.action === "clear"
              ? { kind: "clear" as const }
              : {
                  bytes: avatarSnapshot!.bytes,
                  format: avatarSnapshot!.review.format,
                  kind: "image" as const,
                },
          }
        : {}),
      ...(changes.includes("banner")
        ? {
            banner: request.banner!.action === "clear"
              ? { kind: "clear" as const }
              : {
                  bytes: bannerSnapshot!.bytes,
                  format: bannerSnapshot!.review.format,
                  kind: "image" as const,
                },
          }
        : {}),
      ...(changes.includes("username") ? { username: request.username } : {}),
    }
    return {
      avatarSnapshot,
      bannerSnapshot,
      current,
      mutationInput,
      plan: {
        applicationId,
        botId,
        changedFields: changes,
        createdAt: this.#clock().toISOString(),
        current: presentation(current),
        desired,
        digest,
        effect: changes.length > 0 ? "change" : "none",
        files: {
          avatar: publicFile(avatarSnapshot),
          banner: publicFile(bannerSnapshot),
        },
        operationKeyHash: request.operationKeyHash,
        privacy: PRIVACY_PROJECTION,
        requestedFields: fields,
        responseUnknownFieldCount: current.unknownFieldCount,
        reviewReason: request.reviewReason,
        risks,
        schemaVersion: SCHEMA_VERSION,
        status: changes.length > 0 ? "planned" : "already-current",
        verification: {
          applicationIdentity: "exact",
          imageByteEquality: "not-observable",
          mutationResponse: "strict-current-bot-profile",
          readback: "independent-exact-editable-state",
        },
        warnings,
        writeRequired: changes.length > 0,
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: BotProfileChangeRequest,
    options: RequestOptions = {},
  ): Promise<BotProfileChangePlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeBotProfileChangeRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: BotProfileChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<BotProfileChangeResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord bot-profile plan digest is invalid")
    }
    const normalized = normalizeBotProfileChangeRequest(request)
    return withApplicationLock(
      applicationId,
      () => this.#executeLocked(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new BotProfileExecutionError(
        "Discord bot-profile changes are blocked after an uncertain same-application outcome",
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
    request: NormalizedBotProfileChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<BotProfileChangeResult> {
    let built: BuiltBotProfilePlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof BotProfileEvidenceError
        || error instanceof BotProfileImageFileError
      ) {
        throw new BotProfilePlanChangedError(
          expectedDigest,
          BOT_PROFILE_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const {
      avatarSnapshot,
      bannerSnapshot,
      current,
      mutationInput,
      plan,
    } = built
    if (plan.digest !== expectedDigest) {
      throw new BotProfilePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      applicationId,
      botId,
      changedFields: plan.changedFields,
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
      botId,
      plan,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new BotProfileOperationConflictError(receiptView(reservation.receipt))
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
          botId,
          error: safeErrorCode(error),
          plan,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new BotProfileExecutionError(
        "Discord bot-profile change was blocked because pending activity could not be recorded",
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
    let observed: BotProfilePresentation | null = null
    try {
      const response = await this.#client.modifyCurrentBotProfile(
        botId,
        mutationInput,
        options,
      )
      mutationResponseReceived = true
      assertExpectedTransition(
        current,
        request,
        avatarSnapshot,
        bannerSnapshot,
        response,
      )
      const readback = await this.#client.getCurrentBotProfile(botId, options)
      assertExpectedTransition(
        current,
        request,
        avatarSnapshot,
        bannerSnapshot,
        readback,
      )
      if (!sameEditableProfile(response, readback)) {
        throw new BotProfileEvidenceError(
          "Discord bot-profile response and independent readback did not match",
        )
      }
      observed = presentation(readback)
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
          botId,
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
      throw new BotProfileExecutionError(
        "Discord bot-profile change did not complete with a verified successful outcome",
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

    const result: BotProfileChangeResult = {
      ...baseResult,
      activityId,
      observed: observed!,
      status: "completed",
    }
    try {
      await operationStore.finishApplication(operationReceipt({
        activityId,
        applicationId,
        botId,
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
      throw new BotProfileExecutionError(
        "Discord bot-profile change completed but the operation receipt failed",
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
      throw new BotProfileExecutionError(
        "Discord bot-profile change completed but the final activity record failed",
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
