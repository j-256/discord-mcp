import type { ApplicationSkuRecord } from "./application-sku-audit-service.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  ApplicationEntitlementBeneficiary,
  ApplicationEntitlementPageOptions,
  ApplicationSubscriptionPageOptions,
  DiscordClient,
} from "./discord-client.js"
import { ApplicationMonetizationEvidenceError } from "./errors.js"
import { canonicalExplicitOffsetIso8601Timestamp } from "./iso-timestamp.js"
import type { DiscordApplication, RequestOptions } from "./types.js"

export type ApplicationEntitlementTypeName =
  | "application-subscription"
  | "developer-gift"
  | "free-purchase"
  | "premium-purchase"
  | "premium-subscription"
  | "purchase"
  | "test-mode-purchase"
  | "unknown"
  | "user-gift"

export type ApplicationSubscriptionStatusName =
  | "active"
  | "ending"
  | "inactive"
  | "unknown"

export interface ApplicationMonetizationPage {
  boundaryIds: {
    first: string | null
    last: string | null
  }
  cursor: {
    after: string | null
    before: string | null
  }
  possibleMore: boolean
  requestedLimit: number
  returned: number
}

export interface ApplicationEntitlementRecord {
  consumed: boolean | null
  endsAt: string | null
  id: string
  skuId: string
  startsAt: string | null
  type: ApplicationEntitlementTypeName
  unknownFieldCount: number
}

export interface ApplicationEntitlementInspectionRecord extends
  ApplicationEntitlementRecord {
  deleted: boolean
}

export interface ApplicationEntitlementInspectionResult {
  application: {
    botId: string
    id: string
  }
  beneficiary: {
    id: string
    type: "guild" | "user"
  }
  entitlement: ApplicationEntitlementInspectionRecord
  evidence: {
    projectionComplete: boolean
    unknownFields: number
    unknownSkuFlagBits: number
    unknownSkuFields: number
    unknownSkuType: boolean
    unknownType: boolean
  }
  privacy: ApplicationMonetizationPrivacy
  schemaVersion: number
  sku: {
    available: boolean
    id: string
    purchaseScope: ApplicationSkuRecord["flags"]["purchaseScope"]
    type: ApplicationSkuRecord["type"]["name"]
  }
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationEntitlementAuditResult {
  application: {
    botId: string
    id: string
  }
  beneficiary: {
    id: string
    type: "guild" | "user"
  }
  evidence: {
    unknownFields: number
    unknownTypes: number
  }
  inventory: {
    completeness: "bounded-present-access-page"
    projectionComplete: boolean
    skuIds: string[]
  }
  page: ApplicationMonetizationPage
  privacy: ApplicationMonetizationPrivacy
  records: ApplicationEntitlementRecord[]
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationSubscriptionRecord {
  canceledAt: string | null
  currentPeriod: {
    end: string
    start: string
  }
  entitlementCount: number
  id: string
  relatedSkus: {
    configuredIds: string[]
    omittedUnconfigured: number
  }
  renewalSkus: {
    configuredIds: string[] | null
    omittedUnconfigured: number
  }
  status: ApplicationSubscriptionStatusName
  unknownFieldCount: number
}

export interface ApplicationSubscriptionAuditResult {
  application: {
    botId: string
    id: string
  }
  evidence: {
    unknownFields: number
    unknownStatuses: number
  }
  inventory: {
    accessAuthority: "entitlements-only"
    completeness: "bounded-user-and-sku-page"
    projectionComplete: boolean
    skuId: string
    userId: string
  }
  page: ApplicationMonetizationPage
  privacy: ApplicationMonetizationPrivacy
  records: ApplicationSubscriptionRecord[]
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationMonetizationPrivacy {
  omitted: readonly string[]
  persistence: "none"
  rawPayloads: "omitted"
  unknownFields: "counts-only"
}

export interface ApplicationMonetizationAuditServiceClient extends Pick<
  DiscordClient,
  "getApplicationEntitlement" | "listApplicationEntitlements" | "listApplicationSubscriptions"
> {}

export interface ApplicationMonetizationAuditServiceOptions {
  client: ApplicationMonetizationAuditServiceClient
}

const ENTITLEMENT_KEYS = Object.freeze([
  "application_id",
  "consumed",
  "deleted",
  "ends_at",
  "guild_id",
  "id",
  "sku_id",
  "starts_at",
  "type",
  "user_id",
] as const)
const SUBSCRIPTION_KEYS = Object.freeze([
  "canceled_at",
  "country",
  "current_period_end",
  "current_period_start",
  "entitlement_ids",
  "id",
  "renewal_sku_ids",
  "sku_ids",
  "status",
  "user_id",
] as const)
const ENTITLEMENT_TYPES = Object.freeze({
  1: "purchase",
  2: "premium-subscription",
  3: "developer-gift",
  4: "test-mode-purchase",
  5: "free-purchase",
  6: "user-gift",
  7: "premium-purchase",
  8: "application-subscription",
} as const satisfies Record<number, ApplicationEntitlementTypeName>)
const SUBSCRIPTION_STATUSES = Object.freeze({
  0: "active",
  1: "inactive",
  2: "ending",
} as const satisfies Record<number, ApplicationSubscriptionStatusName>)
const PRIVACY_OMISSIONS = Object.freeze([
  "country-and-payment-source",
  "entitlement-to-subscription-links",
  "guild-entitlement-purchaser-user-ids",
  "payment-and-revenue-data",
  "raw-discord-payloads",
  "sku-benefits-names-prices-and-media",
  "subscription-entitlement-ids",
  "subject-profiles",
  "unconfigured-related-sku-ids",
  "unknown-field-values",
] as const)
const ENTITLEMENT_WARNINGS = Object.freeze([
  "The audit contains only a bounded page filtered to one exact configured beneficiary and configured application-owned SKUs",
  "Discord filters ended and deleted entitlements out of this present-access view",
  "Consumed state and application-specific product rules still require caller interpretation",
  "The audit cannot enumerate purchasers or mutate entitlements, subscriptions, or SKUs",
] as const)
const SUBSCRIPTION_WARNINGS = Object.freeze([
  "Subscription state is lifecycle and reporting evidence, not authority to grant access",
  "Use exact beneficiary entitlement evidence to determine access to a SKU",
  "The audit contains only a bounded page filtered to one exact configured user and one configured application-owned subscription SKU",
  "The audit cannot enumerate purchasers or mutate entitlements, subscriptions, or SKUs",
] as const)
const INSPECTION_WARNINGS = Object.freeze([
  "The inspection covers one exact entitlement only and is not a beneficiary inventory",
  "Entitlement state is access evidence only for the exact configured beneficiary and current-application SKU",
  "SKU and entitlement evidence can change after this read",
  "The inspection cannot mutate entitlements, subscriptions, or SKUs",
] as const)

function evidenceError(options?: ErrorOptions): ApplicationMonetizationEvidenceError {
  return new ApplicationMonetizationEvidenceError(
    "Discord returned invalid application monetization evidence",
    options,
  )
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function recordValue(
  value: unknown,
  maximumFields: number,
): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length > maximumFields
  ) throw evidenceError()
  return value as Record<string, unknown>
}

function optionalSnowflake(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!positiveSnowflake(value)) throw evidenceError()
  return value
}

function optionalTimestamp(value: unknown, description: string): string | null {
  if (value === undefined || value === null) return null
  try {
    return canonicalExplicitOffsetIso8601Timestamp(value, description)
  } catch (error) {
    throw evidenceError({ cause: error })
  }
}

function snowflakeArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw evidenceError()
  if (!value.every(positiveSnowflake) || new Set(value).size !== value.length) {
    throw evidenceError()
  }
  return value
}

function entitlementType(value: number): ApplicationEntitlementTypeName {
  return ENTITLEMENT_TYPES[value as keyof typeof ENTITLEMENT_TYPES] || "unknown"
}

function subscriptionStatus(value: number): ApplicationSubscriptionStatusName {
  return SUBSCRIPTION_STATUSES[value as keyof typeof SUBSCRIPTION_STATUSES] || "unknown"
}

function page(
  ids: readonly string[],
  options: ApplicationEntitlementPageOptions | ApplicationSubscriptionPageOptions,
): ApplicationMonetizationPage {
  const requestedLimit = options.limit ?? CONNECTOR_LIMITS.applicationMonetizationPageDefault
  return {
    boundaryIds: {
      first: ids[0] ?? null,
      last: ids.at(-1) ?? null,
    },
    cursor: {
      after: options.after ?? null,
      before: options.before ?? null,
    },
    possibleMore: ids.length === requestedLimit,
    requestedLimit,
    returned: ids.length,
  }
}

function applicationSkuMap(
  applicationId: string,
  skus: readonly ApplicationSkuRecord[],
): Map<string, ApplicationSkuRecord> {
  if (!positiveSnowflake(applicationId) || skus.length > DISCORD_LIMITS.applicationSkuRecords) {
    throw evidenceError()
  }
  const entries = skus.map((sku) => [sku.id, sku] as const)
  if (
    entries.some(([id]) => !positiveSnowflake(id))
    || new Set(entries.map(([id]) => id)).size !== entries.length
  ) throw evidenceError()
  return new Map(entries)
}

function configuredSkuIds(
  requestedSkuIds: readonly string[],
  skus: ReadonlyMap<string, ApplicationSkuRecord>,
  maximum: number = CONNECTOR_LIMITS.applicationMonetizationSkuFilters,
): string[] {
  if (
    requestedSkuIds.length < 1
    || requestedSkuIds.length > maximum
    || !requestedSkuIds.every(positiveSnowflake)
    || new Set(requestedSkuIds).size !== requestedSkuIds.length
  ) throw new RangeError("Application monetization SKU filters are invalid")
  const result = [...requestedSkuIds].sort((left, right) => (
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
  ))
  if (result.some((skuId) => !skus.has(skuId))) {
    throw new ApplicationMonetizationEvidenceError(
      "One or more requested SKU IDs are not owned by the pinned application",
    )
  }
  return result
}

function projectEntitlement(
  value: unknown,
  applicationId: string,
  beneficiary: ApplicationEntitlementBeneficiary,
  skuIds: ReadonlySet<string>,
  allowDeleted = false,
): ApplicationEntitlementInspectionRecord {
  const input = recordValue(value, DISCORD_LIMITS.applicationEntitlementFields)
  if (
    !positiveSnowflake(input.id)
    || input.application_id !== applicationId
    || !positiveSnowflake(input.sku_id)
    || !skuIds.has(input.sku_id)
    || !Number.isSafeInteger(input.type)
    || (input.type as number) < 1
    || typeof input.deleted !== "boolean"
    || (!allowDeleted && input.deleted)
    || (input.consumed !== undefined && typeof input.consumed !== "boolean")
  ) throw evidenceError()
  const userId = optionalSnowflake(input.user_id)
  const guildId = optionalSnowflake(input.guild_id)
  if (
    beneficiary.type === "user"
      ? userId !== beneficiary.userId || guildId !== null
      : guildId !== beneficiary.guildId
  ) throw evidenceError()
  const startsAt = optionalTimestamp(input.starts_at, "Discord entitlement start timestamp")
  const endsAt = optionalTimestamp(input.ends_at, "Discord entitlement end timestamp")
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw evidenceError()
  }
  return {
    consumed: input.consumed ?? null,
    deleted: input.deleted,
    endsAt,
    id: input.id,
    skuId: input.sku_id,
    startsAt,
    type: entitlementType(input.type as number),
    unknownFieldCount: Object.keys(input).filter((key) => !ENTITLEMENT_KEYS.includes(
      key as typeof ENTITLEMENT_KEYS[number],
    )).length,
  }
}

function projectedSkuSet(
  value: unknown,
  applicationSkus: ReadonlyMap<string, ApplicationSkuRecord>,
  configuredSkus: ReadonlySet<string>,
): { configuredIds: string[]; omittedUnconfigured: number } {
  const ids = snowflakeArray(value, DISCORD_LIMITS.applicationSkuRecords)
  if (ids.some((id) => !applicationSkus.has(id))) throw evidenceError()
  const configuredIds = ids
    .filter((id) => configuredSkus.has(id))
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
  return {
    configuredIds,
    omittedUnconfigured: ids.length - configuredIds.length,
  }
}

function projectSubscription(
  value: unknown,
  userId: string,
  requestedSkuId: string,
  applicationSkus: ReadonlyMap<string, ApplicationSkuRecord>,
  configuredSkus: ReadonlySet<string>,
): ApplicationSubscriptionRecord {
  const input = recordValue(value, DISCORD_LIMITS.applicationSubscriptionFields)
  if (
    !positiveSnowflake(input.id)
    || input.user_id !== userId
    || !Number.isSafeInteger(input.status)
    || (input.status as number) < 0
  ) throw evidenceError()
  const relatedSkus = projectedSkuSet(input.sku_ids, applicationSkus, configuredSkus)
  if (!relatedSkus.configuredIds.includes(requestedSkuId)) throw evidenceError()
  const renewalSkus = input.renewal_sku_ids === undefined || input.renewal_sku_ids === null
    ? { configuredIds: null, omittedUnconfigured: 0 }
    : projectedSkuSet(input.renewal_sku_ids, applicationSkus, configuredSkus)
  const entitlementIds = snowflakeArray(
    input.entitlement_ids,
    DISCORD_LIMITS.applicationEntitlementPage,
  )
  const start = optionalTimestamp(
    input.current_period_start,
    "Discord subscription period start timestamp",
  )
  const end = optionalTimestamp(
    input.current_period_end,
    "Discord subscription period end timestamp",
  )
  if (start === null || end === null || Date.parse(end) <= Date.parse(start)) {
    throw evidenceError()
  }
  const canceledAt = optionalTimestamp(
    input.canceled_at,
    "Discord subscription cancellation timestamp",
  )
  if (
    input.country !== undefined
    && (typeof input.country !== "string" || !/^[A-Z]{2}$/u.test(input.country))
  ) throw evidenceError()
  return {
    canceledAt,
    currentPeriod: { end, start },
    entitlementCount: entitlementIds.length,
    id: input.id,
    relatedSkus,
    renewalSkus,
    status: subscriptionStatus(input.status as number),
    unknownFieldCount: Object.keys(input).filter((key) => !SUBSCRIPTION_KEYS.includes(
      key as typeof SUBSCRIPTION_KEYS[number],
    )).length,
  }
}

export class ApplicationMonetizationAuditService {
  readonly #client: ApplicationMonetizationAuditServiceClient

  constructor(options: ApplicationMonetizationAuditServiceOptions) {
    this.#client = options.client
  }

  async auditEntitlements(
    application: DiscordApplication,
    botId: string,
    beneficiary: ApplicationEntitlementBeneficiary,
    requestedSkuIds: readonly string[],
    skus: readonly ApplicationSkuRecord[],
    options: ApplicationEntitlementPageOptions = {},
  ): Promise<ApplicationEntitlementAuditResult> {
    if (!positiveSnowflake(application.id) || !positiveSnowflake(botId)) throw evidenceError()
    const skuMap = applicationSkuMap(application.id, skus)
    const skuIds = configuredSkuIds(requestedSkuIds, skuMap)
    const raw = await this.#client.listApplicationEntitlements(
      application.id,
      beneficiary,
      skuIds,
      options,
    )
    const skuSet = new Set(skuIds)
    const records = raw.map((value) => {
      const { deleted: _deleted, ...record } = projectEntitlement(
        value,
        application.id,
        beneficiary,
        skuSet,
      )
      return record
    })
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      throw evidenceError()
    }
    const unknownFields = records.reduce(
      (count, record) => count + record.unknownFieldCount,
      0,
    )
    const unknownTypes = records.filter((record) => record.type === "unknown").length
    return {
      application: { botId, id: application.id },
      beneficiary: {
        id: beneficiary.type === "guild" ? beneficiary.guildId : beneficiary.userId,
        type: beneficiary.type,
      },
      evidence: { unknownFields, unknownTypes },
      inventory: {
        completeness: "bounded-present-access-page",
        projectionComplete: unknownFields === 0 && unknownTypes === 0,
        skuIds,
      },
      page: page(records.map((record) => record.id), options),
      privacy: {
        omitted: PRIVACY_OMISSIONS,
        persistence: "none",
        rawPayloads: "omitted",
        unknownFields: "counts-only",
      },
      records,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      warnings: ENTITLEMENT_WARNINGS,
    }
  }

  async inspectEntitlement(
    application: DiscordApplication,
    botId: string,
    beneficiary: ApplicationEntitlementBeneficiary,
    entitlementId: string,
    requestedSkuId: string,
    skus: readonly ApplicationSkuRecord[],
    options: RequestOptions = {},
  ): Promise<ApplicationEntitlementInspectionResult> {
    if (
      !positiveSnowflake(application.id)
      || !positiveSnowflake(botId)
      || !positiveSnowflake(entitlementId)
    ) throw evidenceError()
    const skuMap = applicationSkuMap(application.id, skus)
    const skuIds = configuredSkuIds([requestedSkuId], skuMap)
    const skuId = skuIds[0]
    if (!skuId) throw evidenceError()
    const sku = skuMap.get(skuId)
    if (!sku) throw evidenceError()
    const entitlement = projectEntitlement(
      await this.#client.getApplicationEntitlement(
        application.id,
        entitlementId,
        options,
      ),
      application.id,
      beneficiary,
      new Set([skuId]),
      true,
    )
    if (entitlement.id !== entitlementId) throw evidenceError()
    const unknownType = entitlement.type === "unknown"
    const unknownSkuType = sku.type.name === "unknown"
    const projectionComplete = entitlement.unknownFieldCount === 0
      && !unknownType
      && sku.flags.unknownBitCount === 0
      && sku.unknownFieldCount === 0
      && !unknownSkuType
    return {
      application: { botId, id: application.id },
      beneficiary: {
        id: beneficiary.type === "guild" ? beneficiary.guildId : beneficiary.userId,
        type: beneficiary.type,
      },
      entitlement,
      evidence: {
        projectionComplete,
        unknownFields: entitlement.unknownFieldCount,
        unknownSkuFlagBits: sku.flags.unknownBitCount,
        unknownSkuFields: sku.unknownFieldCount,
        unknownSkuType,
        unknownType,
      },
      privacy: {
        omitted: PRIVACY_OMISSIONS,
        persistence: "none",
        rawPayloads: "omitted",
        unknownFields: "counts-only",
      },
      schemaVersion: SCHEMA_VERSION,
      sku: {
        available: sku.flags.available,
        id: sku.id,
        purchaseScope: sku.flags.purchaseScope,
        type: sku.type.name,
      },
      status: "ok",
      warnings: INSPECTION_WARNINGS,
    }
  }

  async auditSubscriptions(
    application: DiscordApplication,
    botId: string,
    userId: string,
    requestedSkuId: string,
    configuredSkuScope: readonly string[],
    skus: readonly ApplicationSkuRecord[],
    options: ApplicationSubscriptionPageOptions = {},
  ): Promise<ApplicationSubscriptionAuditResult> {
    if (
      !positiveSnowflake(application.id)
      || !positiveSnowflake(botId)
      || !positiveSnowflake(userId)
    ) throw evidenceError()
    const skuMap = applicationSkuMap(application.id, skus)
    const configuredIds = configuredSkuIds(
      configuredSkuScope,
      skuMap,
      CONNECTOR_LIMITS.applicationMonetizationSkuAllowlist,
    )
    if (!configuredIds.includes(requestedSkuId)) {
      throw new RangeError("Application subscription SKU is outside the configured scope")
    }
    const requestedSku = skuMap.get(requestedSkuId)
    if (requestedSku?.type.name !== "subscription") {
      throw new ApplicationMonetizationEvidenceError(
        "Application subscription audit requires a current application subscription SKU",
      )
    }
    const raw = await this.#client.listApplicationSubscriptions(
      requestedSkuId,
      userId,
      options,
    )
    const configuredSet = new Set(configuredIds)
    const records = raw.map((value) => projectSubscription(
      value,
      userId,
      requestedSkuId,
      skuMap,
      configuredSet,
    ))
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      throw evidenceError()
    }
    const unknownFields = records.reduce(
      (count, record) => count + record.unknownFieldCount,
      0,
    )
    const unknownStatuses = records.filter((record) => record.status === "unknown").length
    return {
      application: { botId, id: application.id },
      evidence: { unknownFields, unknownStatuses },
      inventory: {
        accessAuthority: "entitlements-only",
        completeness: "bounded-user-and-sku-page",
        projectionComplete: unknownFields === 0 && unknownStatuses === 0,
        skuId: requestedSkuId,
        userId,
      },
      page: page(records.map((record) => record.id), options),
      privacy: {
        omitted: PRIVACY_OMISSIONS,
        persistence: "none",
        rawPayloads: "omitted",
        unknownFields: "counts-only",
      },
      records,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      warnings: SUBSCRIPTION_WARNINGS,
    }
  }
}
