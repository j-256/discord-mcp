import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import { ApplicationRoleConnectionMetadataEvidenceError } from "./errors.js"
import type {
  DiscordApplication,
  RequestOptions,
} from "./types.js"

export type ApplicationRoleConnectionMetadataTypeName =
  | "boolean-equal"
  | "boolean-not-equal"
  | "datetime-greater-than-or-equal"
  | "datetime-less-than-or-equal"
  | "integer-equal"
  | "integer-greater-than-or-equal"
  | "integer-less-than-or-equal"
  | "integer-not-equal"
  | "unknown"

export type ApplicationRoleConnectionMetadataValueKind =
  | "boolean"
  | "datetime"
  | "integer"
  | "unknown"

export type ApplicationRoleConnectionMetadataComparison =
  | "equal"
  | "greater-than-or-equal"
  | "less-than-or-equal"
  | "not-equal"
  | "unknown"

export interface ApplicationRoleConnectionMetadataRecord {
  description: string
  descriptionCharacters: number
  key: string
  localizations: {
    descriptions: number
    names: number
  }
  name: string
  nameCharacters: number
  type: {
    code: number
    comparison: ApplicationRoleConnectionMetadataComparison
    name: ApplicationRoleConnectionMetadataTypeName
    valueKind: ApplicationRoleConnectionMetadataValueKind
  }
  unknownFieldCount: number
}

export type ApplicationRoleConnectionMetadataFindingCode =
  | "active-schema"
  | "empty-schema"
  | "future-schema-evidence"
  | "schema-without-verification-endpoint"
  | "verification-endpoint-without-schema"

export interface ApplicationRoleConnectionMetadataFinding {
  code: ApplicationRoleConnectionMetadataFindingCode
  severity: "info" | "warning"
  summary: string
}

export interface ApplicationRoleConnectionMetadataAuditResult {
  application: {
    botId: string
    id: string
    verificationEndpointConfigured: boolean
  }
  evidence: {
    unknownFields: number
    unknownTypes: number
  }
  findingCounts: {
    info: number
    warnings: number
  }
  findings: ApplicationRoleConnectionMetadataFinding[]
  inventory: {
    completeness: "complete-current-application"
    count: number
    documentedLimit: number
    projectionComplete: boolean
  }
  privacy: {
    omitted: readonly string[]
    persistence: "none"
    rawPayloads: "omitted"
    text: "transient-untrusted"
    unknownFields: "counts-only"
  }
  records: ApplicationRoleConnectionMetadataRecord[]
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationRoleConnectionMetadataAuditServiceClient extends Pick<
  DiscordClient,
  "listApplicationRoleConnectionMetadata"
> {}

export interface ApplicationRoleConnectionMetadataAuditServiceOptions {
  client: ApplicationRoleConnectionMetadataAuditServiceClient
}

const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const KEY_PATTERN = /^[a-z0-9_]+$/u
const LOCALE_KEY_PATTERN = /^[A-Za-z0-9-]{2,20}$/u
const MAXIMUM_TYPE_CODE = 255
const MAXIMUM_URL_CHARACTERS = 2_048
const KNOWN_RECORD_KEYS = Object.freeze([
  "description",
  "description_localizations",
  "key",
  "name",
  "name_localizations",
  "type",
] as const)
const TYPE_PROJECTIONS = Object.freeze({
  1: {
    comparison: "less-than-or-equal",
    name: "integer-less-than-or-equal",
    valueKind: "integer",
  },
  2: {
    comparison: "greater-than-or-equal",
    name: "integer-greater-than-or-equal",
    valueKind: "integer",
  },
  3: {
    comparison: "equal",
    name: "integer-equal",
    valueKind: "integer",
  },
  4: {
    comparison: "not-equal",
    name: "integer-not-equal",
    valueKind: "integer",
  },
  5: {
    comparison: "less-than-or-equal",
    name: "datetime-less-than-or-equal",
    valueKind: "datetime",
  },
  6: {
    comparison: "greater-than-or-equal",
    name: "datetime-greater-than-or-equal",
    valueKind: "datetime",
  },
  7: {
    comparison: "equal",
    name: "boolean-equal",
    valueKind: "boolean",
  },
  8: {
    comparison: "not-equal",
    name: "boolean-not-equal",
    valueKind: "boolean",
  },
} as const satisfies Record<number, {
  comparison: ApplicationRoleConnectionMetadataComparison
  name: ApplicationRoleConnectionMetadataTypeName
  valueKind: ApplicationRoleConnectionMetadataValueKind
}>)
const PRIVACY_OMISSIONS = Object.freeze([
  "guild-role-configuration",
  "localization-values",
  "raw-discord-payloads",
  "unknown-field-values",
  "user-role-connection-values",
  "verification-endpoint-url",
] as const)
const AUDIT_WARNINGS = Object.freeze([
  "The audit covers only metadata owned by the connector's pinned application",
  "Metadata labels are transient untrusted Discord data and are not persisted",
  "Metadata definitions do not prove which guild roles use them or whether any user satisfies them",
  "The audit cannot read user role-connection values and cannot mutate the application schema",
] as const)

function evidenceError(): ApplicationRoleConnectionMetadataEvidenceError {
  return new ApplicationRoleConnectionMetadataEvidenceError(
    "Discord returned invalid application role-connection metadata evidence",
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

function textValue(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string"
    || characterCount(value) < minimum
    || characterCount(value) > maximum
    || CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError()
  return value
}

function recordValue(value: unknown, maximumFields: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw evidenceError()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length > maximumFields) throw evidenceError()
  return record
}

function localizationCount(value: unknown, maximumValueCharacters: number): number {
  if (value === undefined || value === null) return 0
  const localizations = recordValue(
    value,
    DISCORD_LIMITS.applicationRoleConnectionMetadataLocalizations,
  )
  for (const [locale, label] of Object.entries(localizations)) {
    if (!LOCALE_KEY_PATTERN.test(locale)) throw evidenceError()
    textValue(label, 1, maximumValueCharacters)
  }
  return Object.keys(localizations).length
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function endpointConfigured(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAXIMUM_URL_CHARACTERS
    || CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError()
  return true
}

function typeProjection(code: number): ApplicationRoleConnectionMetadataRecord["type"] {
  const known = TYPE_PROJECTIONS[code as keyof typeof TYPE_PROJECTIONS]
  return known
    ? { code, ...known }
    : {
        code,
        comparison: "unknown",
        name: "unknown",
        valueKind: "unknown",
      }
}

function projectRecord(value: unknown): ApplicationRoleConnectionMetadataRecord {
  const record = recordValue(
    value,
    DISCORD_LIMITS.applicationRoleConnectionMetadataFields,
  )
  const key = textValue(
    record.key,
    1,
    DISCORD_LIMITS.applicationRoleConnectionMetadataKeyCharacters,
  )
  if (!KEY_PATTERN.test(key)) throw evidenceError()
  const name = textValue(
    record.name,
    1,
    DISCORD_LIMITS.applicationRoleConnectionMetadataNameCharacters,
  )
  const description = textValue(
    record.description,
    1,
    DISCORD_LIMITS.applicationRoleConnectionMetadataDescriptionCharacters,
  )
  if (
    !Number.isInteger(record.type)
    || (record.type as number) < 1
    || (record.type as number) > MAXIMUM_TYPE_CODE
  ) throw evidenceError()
  return {
    description,
    descriptionCharacters: characterCount(description),
    key,
    localizations: {
      descriptions: localizationCount(
        record.description_localizations,
        DISCORD_LIMITS.applicationRoleConnectionMetadataDescriptionCharacters,
      ),
      names: localizationCount(
        record.name_localizations,
        DISCORD_LIMITS.applicationRoleConnectionMetadataNameCharacters,
      ),
    },
    name,
    nameCharacters: characterCount(name),
    type: typeProjection(record.type as number),
    unknownFieldCount: Object.keys(record)
      .filter((keyName) => !KNOWN_RECORD_KEYS.includes(
        keyName as typeof KNOWN_RECORD_KEYS[number],
      )).length,
  }
}

function findings(
  endpoint: boolean,
  records: readonly ApplicationRoleConnectionMetadataRecord[],
  unknownFields: number,
  unknownTypes: number,
): ApplicationRoleConnectionMetadataFinding[] {
  const result: ApplicationRoleConnectionMetadataFinding[] = []
  if (endpoint && records.length > 0) {
    result.push({
      code: "active-schema",
      severity: "info",
      summary: "The application reports a verification endpoint and linked-role metadata schema",
    })
  } else if (endpoint) {
    result.push({
      code: "verification-endpoint-without-schema",
      severity: "warning",
      summary: "The application reports a verification endpoint but no linked-role metadata records",
    })
  } else if (records.length > 0) {
    result.push({
      code: "schema-without-verification-endpoint",
      severity: "warning",
      summary: "The application has linked-role metadata records but reports no verification endpoint",
    })
  } else {
    result.push({
      code: "empty-schema",
      severity: "info",
      summary: "The application reports neither a linked-role verification endpoint nor metadata records",
    })
  }
  if (unknownFields > 0 || unknownTypes > 0) {
    result.push({
      code: "future-schema-evidence",
      severity: "warning",
      summary: "Discord returned future linked-role metadata evidence outside the known projection",
    })
  }
  return result
}

export class ApplicationRoleConnectionMetadataAuditService {
  readonly #client: ApplicationRoleConnectionMetadataAuditServiceClient

  constructor(options: ApplicationRoleConnectionMetadataAuditServiceOptions) {
    this.#client = options.client
  }

  async audit(
    application: DiscordApplication,
    botId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationRoleConnectionMetadataAuditResult> {
    if (!positiveSnowflake(application.id) || !positiveSnowflake(botId)) {
      throw evidenceError()
    }
    const verificationEndpointConfigured = endpointConfigured(
      application.role_connections_verification_url,
    )
    const raw = await this.#client.listApplicationRoleConnectionMetadata(
      application.id,
      options,
    )
    if (
      !Array.isArray(raw)
      || raw.length > DISCORD_LIMITS.applicationRoleConnectionMetadataRecords
    ) throw evidenceError()
    const records = raw.map(projectRecord)
    if (new Set(records.map((record) => record.key)).size !== records.length) {
      throw evidenceError()
    }
    const unknownFields = records.reduce(
      (count, record) => count + record.unknownFieldCount,
      0,
    )
    const unknownTypes = records.filter(
      (record) => record.type.name === "unknown",
    ).length
    const auditFindings = findings(
      verificationEndpointConfigured,
      records,
      unknownFields,
      unknownTypes,
    )
    return {
      application: {
        botId,
        id: application.id,
        verificationEndpointConfigured,
      },
      evidence: {
        unknownFields,
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
        documentedLimit: DISCORD_LIMITS.applicationRoleConnectionMetadataRecords,
        projectionComplete: unknownFields === 0 && unknownTypes === 0,
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
