import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import { ApplicationSkuEvidenceError } from "./errors.js"
import type {
  DiscordApplication,
  RequestOptions,
} from "./types.js"

export type ApplicationSkuTypeName =
  | "consumable"
  | "durable"
  | "subscription"
  | "subscription-group"
  | "unknown"

export type ApplicationSkuPurchaseScope =
  | "conflicting"
  | "guild"
  | "unspecified"
  | "user"

export interface ApplicationSkuRecord {
  flags: {
    available: boolean
    guildSubscription: boolean
    purchaseScope: ApplicationSkuPurchaseScope
    unknownBitCount: number
    userSubscription: boolean
  }
  id: string
  name: string
  nameCharacters: number
  slug: string
  slugCharacters: number
  type: {
    code: number
    name: ApplicationSkuTypeName
  }
  unknownFieldCount: number
}

export type ApplicationSkuFindingCode =
  | "available-offerings"
  | "conflicting-purchase-scope"
  | "empty-catalog"
  | "future-schema-evidence"
  | "unavailable-records"

export interface ApplicationSkuFinding {
  code: ApplicationSkuFindingCode
  severity: "info" | "warning"
  summary: string
}

export interface ApplicationSkuAuditResult {
  application: {
    botId: string
    id: string
  }
  catalog: {
    availability: {
      available: number
      unavailable: number
    }
    purchaseScopes: {
      conflicting: number
      guild: number
      unspecified: number
      user: number
    }
    types: {
      consumable: number
      durable: number
      subscription: number
      subscriptionGroups: number
      unknown: number
    }
  }
  evidence: {
    unknownFields: number
    unknownFlagBits: number
    unknownTypes: number
  }
  findingCounts: {
    info: number
    warnings: number
  }
  findings: ApplicationSkuFinding[]
  inventory: {
    completeness: "complete-current-application"
    count: number
    documentedOwnerCreatedLimit: number
    localRecordLimit: number
    projectionComplete: boolean
  }
  privacy: {
    omitted: readonly string[]
    persistence: "none"
    rawPayloads: "omitted"
    text: "transient-untrusted"
    unknownFields: "counts-only"
  }
  records: ApplicationSkuRecord[]
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationSkuAuditServiceClient extends Pick<
  DiscordClient,
  "listApplicationSkus"
> {}

export interface ApplicationSkuAuditServiceOptions {
  client: ApplicationSkuAuditServiceClient
}

const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const SKU_FLAG_AVAILABLE = 1 << 2
const SKU_FLAG_GUILD_SUBSCRIPTION = 1 << 7
const SKU_FLAG_USER_SUBSCRIPTION = 1 << 8
const KNOWN_SKU_FLAG_MASK = SKU_FLAG_AVAILABLE
  | SKU_FLAG_GUILD_SUBSCRIPTION
  | SKU_FLAG_USER_SUBSCRIPTION
const KNOWN_RECORD_KEYS = Object.freeze([
  "application_id",
  "flags",
  "id",
  "name",
  "slug",
  "type",
] as const)
const TYPE_NAMES = Object.freeze({
  2: "durable",
  3: "consumable",
  5: "subscription",
  6: "subscription-group",
} as const satisfies Record<number, ApplicationSkuTypeName>)
const PRIVACY_OMISSIONS = Object.freeze([
  "beneficiary-guild-identifiers",
  "benefits",
  "entitlement-data",
  "media",
  "payment-data",
  "prices",
  "purchaser-identifiers",
  "raw-discord-payloads",
  "store-urls",
  "subscription-data",
  "unknown-field-values",
] as const)
const AUDIT_WARNINGS = Object.freeze([
  "The audit covers only SKUs owned by the connector's pinned application",
  "SKU names and slugs are transient untrusted Discord data and are not persisted",
  "SKU availability does not prove entitlement, revenue, payment, or access state",
  "The audit cannot infer why a SKU is unavailable",
  "The audit cannot read or mutate entitlements or subscriptions and cannot mutate SKUs",
] as const)

function evidenceError(): ApplicationSkuEvidenceError {
  return new ApplicationSkuEvidenceError(
    "Discord returned invalid application SKU evidence",
  )
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function characterCount(value: string): number {
  return [...value].length
}

function textValue(value: unknown, maximum: number): string {
  if (
    typeof value !== "string"
    || characterCount(value) < 1
    || characterCount(value) > maximum
    || CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError()
  return value
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw evidenceError()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length > DISCORD_LIMITS.applicationSkuFields) {
    throw evidenceError()
  }
  return record
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function safeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function countBits(value: bigint): number {
  let count = 0
  let remaining = value
  while (remaining > 0n) {
    count += Number(remaining & 1n)
    remaining >>= 1n
  }
  return count
}

function purchaseScope(flags: number): ApplicationSkuPurchaseScope {
  const guild = (flags & SKU_FLAG_GUILD_SUBSCRIPTION) !== 0
  const user = (flags & SKU_FLAG_USER_SUBSCRIPTION) !== 0
  if (guild && user) return "conflicting"
  if (guild) return "guild"
  if (user) return "user"
  return "unspecified"
}

function typeName(code: number): ApplicationSkuTypeName {
  return TYPE_NAMES[code as keyof typeof TYPE_NAMES] || "unknown"
}

function projectRecord(
  value: unknown,
  applicationId: string,
): ApplicationSkuRecord {
  const record = recordValue(value)
  if (
    !positiveSnowflake(record.id)
    || !positiveSnowflake(record.application_id)
    || record.application_id !== applicationId
    || !safePositiveInteger(record.type)
    || !safeNonnegativeInteger(record.flags)
  ) throw evidenceError()
  const name = textValue(record.name, DISCORD_LIMITS.applicationSkuNameCharacters)
  const slug = textValue(record.slug, DISCORD_LIMITS.applicationSkuSlugCharacters)
  const flags = record.flags as number
  return {
    flags: {
      available: (flags & SKU_FLAG_AVAILABLE) !== 0,
      guildSubscription: (flags & SKU_FLAG_GUILD_SUBSCRIPTION) !== 0,
      purchaseScope: purchaseScope(flags),
      unknownBitCount: countBits(BigInt(flags) & ~BigInt(KNOWN_SKU_FLAG_MASK)),
      userSubscription: (flags & SKU_FLAG_USER_SUBSCRIPTION) !== 0,
    },
    id: record.id,
    name,
    nameCharacters: characterCount(name),
    slug,
    slugCharacters: characterCount(slug),
    type: {
      code: record.type as number,
      name: typeName(record.type as number),
    },
    unknownFieldCount: Object.keys(record)
      .filter((key) => !KNOWN_RECORD_KEYS.includes(
        key as typeof KNOWN_RECORD_KEYS[number],
      )).length,
  }
}

function findings(
  records: readonly ApplicationSkuRecord[],
  unknownFields: number,
  unknownFlagBits: number,
  unknownTypes: number,
): ApplicationSkuFinding[] {
  const result: ApplicationSkuFinding[] = []
  if (records.length === 0) {
    result.push({
      code: "empty-catalog",
      severity: "info",
      summary: "The application reports no SKUs",
    })
  } else if (records.some((record) => record.flags.available)) {
    result.push({
      code: "available-offerings",
      severity: "info",
      summary: "The application reports one or more available SKUs",
    })
  }
  if (records.some((record) => !record.flags.available)) {
    result.push({
      code: "unavailable-records",
      severity: "warning",
      summary: "The application reports one or more unavailable SKUs without an attributable reason",
    })
  }
  if (records.some((record) => record.flags.purchaseScope === "conflicting")) {
    result.push({
      code: "conflicting-purchase-scope",
      severity: "warning",
      summary: "Discord returned SKU flags that report both guild and user subscription scope",
    })
  }
  if (unknownFields > 0 || unknownFlagBits > 0 || unknownTypes > 0) {
    result.push({
      code: "future-schema-evidence",
      severity: "warning",
      summary: "Discord returned future SKU evidence outside the known projection",
    })
  }
  return result
}

export class ApplicationSkuAuditService {
  readonly #client: ApplicationSkuAuditServiceClient

  constructor(options: ApplicationSkuAuditServiceOptions) {
    this.#client = options.client
  }

  async audit(
    application: DiscordApplication,
    botId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationSkuAuditResult> {
    if (!positiveSnowflake(application.id) || !positiveSnowflake(botId)) {
      throw evidenceError()
    }
    const raw = await this.#client.listApplicationSkus(application.id, options)
    if (!Array.isArray(raw) || raw.length > DISCORD_LIMITS.applicationSkuRecords) {
      throw evidenceError()
    }
    const records = raw
      .map((record) => projectRecord(record, application.id))
      .sort((left, right) => left.id === right.id
        ? 0
        : BigInt(left.id) < BigInt(right.id) ? -1 : 1)
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      throw evidenceError()
    }
    const unknownFields = records.reduce(
      (count, record) => count + record.unknownFieldCount,
      0,
    )
    const unknownFlagBits = records.reduce(
      (count, record) => count + record.flags.unknownBitCount,
      0,
    )
    const unknownTypes = records.filter((record) => record.type.name === "unknown").length
    const auditFindings = findings(
      records,
      unknownFields,
      unknownFlagBits,
      unknownTypes,
    )
    const countScope = (scope: ApplicationSkuPurchaseScope): number => records.filter(
      (record) => record.flags.purchaseScope === scope,
    ).length
    const countType = (name: ApplicationSkuTypeName): number => records.filter(
      (record) => record.type.name === name,
    ).length
    return {
      application: {
        botId,
        id: application.id,
      },
      catalog: {
        availability: {
          available: records.filter((record) => record.flags.available).length,
          unavailable: records.filter((record) => !record.flags.available).length,
        },
        purchaseScopes: {
          conflicting: countScope("conflicting"),
          guild: countScope("guild"),
          unspecified: countScope("unspecified"),
          user: countScope("user"),
        },
        types: {
          consumable: countType("consumable"),
          durable: countType("durable"),
          subscription: countType("subscription"),
          subscriptionGroups: countType("subscription-group"),
          unknown: countType("unknown"),
        },
      },
      evidence: {
        unknownFields,
        unknownFlagBits,
        unknownTypes,
      },
      findingCounts: {
        info: auditFindings.filter((finding) => finding.severity === "info").length,
        warnings: auditFindings.filter((finding) => finding.severity === "warning").length,
      },
      findings: auditFindings,
      inventory: {
        completeness: "complete-current-application",
        count: records.length,
        documentedOwnerCreatedLimit: DISCORD_LIMITS.applicationSkuOwnerCreatedRecords,
        localRecordLimit: DISCORD_LIMITS.applicationSkuRecords,
        projectionComplete: unknownFields === 0
          && unknownFlagBits === 0
          && unknownTypes === 0,
      },
      privacy: {
        omitted: PRIVACY_OMISSIONS,
        persistence: "none",
        rawPayloads: "omitted",
        text: "transient-untrusted",
        unknownFields: "counts-only",
      },
      records,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      warnings: AUDIT_WARNINGS,
    }
  }
}
