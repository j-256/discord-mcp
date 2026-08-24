import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import {
  isAbsolute,
  resolve,
} from "node:path"

import { z } from "zod"

import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
  GATEWAY_DEFAULTS,
  MCP_TOOLSET_NAMES,
  MCP_TOOL_SURFACES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { ConfigDocumentError, ConfigurationError } from "./errors.js"

export const CONFIG_DOCUMENT_SCHEMA_VERSION = 2
export const CONFIG_DOCUMENT_SCHEMA_ID =
  "https://raw.githubusercontent.com/j-256/discord-mcp/main/discord-mcp.config.schema.json"

const CONFIG_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/
const TOKEN_ENVIRONMENT_PATTERN = /^DISCORD_(?:[A-Z0-9]+_)*TOKEN$/
const HEADER_ENVIRONMENT_PATTERN = /^[A-Z][A-Z0-9_]{0,118}_HEADERS$/
const CONFIG_JSON_MAX_DEPTH = 64
const CONFIG_STRING_CHARACTERS = 4_096
const CONFIG_SCOPE_ENTRIES = 1_000
const CONFIG_ROOT_ENTRIES = 32

type EnvironmentKey = keyof typeof ENVIRONMENT_NAMES
type ConfigScalar = boolean | number | string | readonly string[]

export interface EnvironmentSecretReference {
  provider: "environment"
  variable: string
}

export interface ConnectorConfigDocumentObservabilitySignal {
  compression?: string
  endpoint?: string
  headers?: EnvironmentSecretReference
  protocol?: string
  timeoutMs?: number
}

export interface ConnectorConfigDocumentObservability {
  compression?: string
  endpoint?: string
  exportEnabled?: boolean
  headers?: EnvironmentSecretReference
  jsonLogsEnabled?: boolean
  metrics?: ConnectorConfigDocumentObservabilitySignal
  protocol?: string
  serviceName?: string
  timeoutMs?: number
  traceSampleRatio?: number
  traceSampler?: string
  traces?: ConnectorConfigDocumentObservabilitySignal
}

export interface ConnectorConfigDocument {
  $schema?: typeof CONFIG_DOCUMENT_SCHEMA_ID
  capabilities: Readonly<Record<string, boolean>>
  credential: EnvironmentSecretReference
  gateway: {
    enabled: boolean
    eventBufferSize: number
  }
  identity: {
    applicationId: string
    botId: string
  }
  limits: Readonly<Record<string, number>>
  name: string
  observability: ConnectorConfigDocumentObservability
  readScope: {
    channelIds: readonly string[]
    guildIds: readonly string[]
  }
  runtime: Readonly<Record<string, string>>
  schemaVersion: 2
  scopes: Readonly<Record<string, readonly string[]>>
  storage: Readonly<Record<string, string | readonly string[]>>
  tools: {
    surface: McpToolSurface
    toolsets: readonly McpToolsetName[]
  }
}

export interface ConnectorConfigDocumentPolicy {
  capabilities: Readonly<Record<string, boolean>>
  limits: Readonly<Record<string, number>>
  observability: ConnectorConfigDocumentObservability
  runtime: Readonly<Record<string, string>>
  scopes: Readonly<Record<string, readonly string[]>>
  storage: Readonly<Record<string, string | readonly string[]>>
}

export interface ConfigDocumentField {
  defaultValue: boolean | number | string | readonly string[] | undefined
  description: string
  environmentVariable: string | undefined
  kind: "boolean" | "integer" | "number" | "path" | "paths" | "secret-reference" | "snowflake" | "snowflakes" | "string" | "strings"
  path: string
  required: boolean
}

interface ConfigSectionMapping {
  documentKey: string
  environmentKey: EnvironmentKey
  environmentVariable: string
}

const RESERVED_ENVIRONMENT_KEYS = new Set<EnvironmentKey>([
  "allowedChannelIds",
  "allowedGuildIds",
  "allowGateway",
  "allowObservabilityExport",
  "applicationId",
  "botId",
  "configFile",
  "gatewayEventBufferSize",
  "observabilityLogs",
  "otelCompression",
  "otelEndpoint",
  "otelHeaders",
  "otelMetricsCompression",
  "otelMetricsEndpoint",
  "otelMetricsHeaders",
  "otelMetricsProtocol",
  "otelMetricsTimeout",
  "otelProtocol",
  "otelServiceName",
  "otelTimeout",
  "otelTraceCompression",
  "otelTraceEndpoint",
  "otelTraceHeaders",
  "otelTraceProtocol",
  "otelTraceTimeout",
  "otelTracesSampler",
  "otelTracesSamplerArg",
  "token",
  "toolSurface",
  "toolsets",
])

const LIMIT_ENVIRONMENT_KEYS = new Set<EnvironmentKey>([
  "attachmentMaxBytes",
  "interactionMaxWritesPerMinute",
  "interactionMinWriteIntervalMs",
  "nativeInteractionMaxPending",
  "nativeInteractionTtlSeconds",
])

const STORAGE_ENVIRONMENT_KEYS = new Set<EnvironmentKey>([
  "applicationEmojiRoots",
  "attachmentRoots",
  "auditFile",
  "guildExpressionRoots",
  "scheduledEventRoots",
  "soundboardRoots",
])

const RUNTIME_ENVIRONMENT_KEYS = new Set<EnvironmentKey>([
  "nativeCommandName",
])

function lowerInitial(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`
}

function humanizeConfigKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bIds$/, "IDs")
    .toLowerCase()
}

function sectionMappings(
  matches: (key: EnvironmentKey) => boolean,
  documentKey: (key: EnvironmentKey) => string = (key) => key,
): readonly ConfigSectionMapping[] {
  return (Object.entries(ENVIRONMENT_NAMES) as [EnvironmentKey, string][])
    .filter(([key]) => !RESERVED_ENVIRONMENT_KEYS.has(key) && matches(key))
    .map(([environmentKey, environmentVariable]) => ({
      documentKey: documentKey(environmentKey),
      environmentKey,
      environmentVariable,
    }))
}

export const CONFIG_CAPABILITY_MAPPINGS = Object.freeze(sectionMappings(
  (key) => key.startsWith("allow"),
  (key) => lowerInitial(key.slice("allow".length)),
))

export const CONFIG_SCOPE_MAPPINGS = Object.freeze(sectionMappings(
  (key) => key.endsWith("Ids"),
))

export const CONFIG_LIMIT_MAPPINGS = Object.freeze(sectionMappings(
  (key) => LIMIT_ENVIRONMENT_KEYS.has(key),
))

export const CONFIG_STORAGE_MAPPINGS = Object.freeze(sectionMappings(
  (key) => STORAGE_ENVIRONMENT_KEYS.has(key),
))

export const CONFIG_RUNTIME_MAPPINGS = Object.freeze(sectionMappings(
  (key) => RUNTIME_ENVIRONMENT_KEYS.has(key),
))

const MAPPED_ENVIRONMENT_KEYS = new Set<EnvironmentKey>([
  ...CONFIG_CAPABILITY_MAPPINGS.map((entry) => entry.environmentKey),
  ...CONFIG_SCOPE_MAPPINGS.map((entry) => entry.environmentKey),
  ...CONFIG_LIMIT_MAPPINGS.map((entry) => entry.environmentKey),
  ...CONFIG_STORAGE_MAPPINGS.map((entry) => entry.environmentKey),
  ...CONFIG_RUNTIME_MAPPINGS.map((entry) => entry.environmentKey),
])

const UNMAPPED_ENVIRONMENT_KEYS = (Object.keys(ENVIRONMENT_NAMES) as EnvironmentKey[])
  .filter((key) => !RESERVED_ENVIRONMENT_KEYS.has(key) && !MAPPED_ENVIRONMENT_KEYS.has(key))

if (UNMAPPED_ENVIRONMENT_KEYS.length > 0) {
  throw new Error(`Connector configuration fields are unmapped: ${UNMAPPED_ENVIRONMENT_KEYS.join(", ")}`)
}

function canonicalArray<T extends string>(
  values: readonly T[],
  order?: readonly T[],
): boolean {
  const canonical = order
    ? order.filter((entry) => values.includes(entry))
    : [...values].sort()
  return new Set(values).size === values.length
    && canonical.every((entry, index) => entry === values[index])
}

const snowflakeSchema = z.string()
  .regex(DISCORD_SNOWFLAKE_PATTERN, "must be a Discord snowflake")

const absolutePathSchema = z.string()
  .min(1)
  .max(CONFIG_STRING_CHARACTERS)
  .refine(
    (value) => !value.includes("\0") && isAbsolute(value) && resolve(value) === value,
    "must be an absolute canonical path",
  )

function snowflakeArraySchema(minimum: number, maximum: number): z.ZodType<string[]> {
  return z.array(snowflakeSchema)
    .min(minimum)
    .max(maximum)
    .refine((values) => canonicalArray(values), "must contain unique sorted Discord snowflakes")
}

const rootArraySchema = z.array(absolutePathSchema)
  .max(CONFIG_ROOT_ENTRIES)
  .refine((values) => canonicalArray(values), "must contain unique sorted paths")

const configNameSchema = z.string()
  .regex(CONFIG_NAME_PATTERN, "must be a bounded lowercase filename-safe identifier")
  .refine((value) => !WINDOWS_DEVICE_NAME_PATTERN.test(value), "must not be a reserved filename")

const tokenReferenceSchema = z.strictObject({
  provider: z.literal("environment"),
  variable: z.string()
    .max(128)
    .regex(TOKEN_ENVIRONMENT_PATTERN, "must name an uppercase Discord token environment variable"),
}).describe("Environment reference for the Discord bot token")

const headerReferenceSchema = z.strictObject({
  provider: z.literal("environment"),
  variable: z.string()
    .max(128)
    .regex(HEADER_ENVIRONMENT_PATTERN, "must name an uppercase header environment variable"),
}).describe("Environment reference for an OTLP header string")

const CHANNEL_METADATA_CAPABILITY_DESCRIPTION = "Enable reviewed channel metadata and exact ordinary voice-channel status policy"
const CHANNEL_METADATA_SCOPE_DESCRIPTION = "Exact Discord ID allowlist for reviewed channel metadata and ordinary voice-channel status"

function capabilityDescription(documentKey: string): string {
  return documentKey === "channelMetadataChanges"
    ? CHANNEL_METADATA_CAPABILITY_DESCRIPTION
    : `Enable ${humanizeConfigKey(documentKey)} policy`
}

function scopeDescription(documentKey: string): string {
  return documentKey === "channelMetadataIds"
    ? CHANNEL_METADATA_SCOPE_DESCRIPTION
    : `Exact Discord ID allowlist for ${humanizeConfigKey(documentKey)}`
}

function storageDescription(documentKey: string): string {
  return documentKey === "guildExpressionRoots"
    ? "Owned local roots shared by guild-expression creation and reviewed role-icon images"
    : `Owned local roots for ${humanizeConfigKey(documentKey)}`
}

const capabilityShape = Object.fromEntries(
  CONFIG_CAPABILITY_MAPPINGS.map((entry) => [
    entry.documentKey,
    z.boolean()
      .describe(capabilityDescription(entry.documentKey))
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodBoolean>>

const scopeShape = Object.fromEntries(
  CONFIG_SCOPE_MAPPINGS.map((entry) => [
    entry.documentKey,
    snowflakeArraySchema(0, CONFIG_SCOPE_ENTRIES)
      .describe(scopeDescription(entry.documentKey))
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodType<string[]>>>

const limitShape = Object.fromEntries(
  CONFIG_LIMIT_MAPPINGS.map((entry) => [
    entry.documentKey,
    z.number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .describe(`Numeric policy limit for ${humanizeConfigKey(entry.documentKey)}`)
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodNumber>>

const storageShape = Object.fromEntries(
  CONFIG_STORAGE_MAPPINGS.map((entry) => [
    entry.documentKey,
    entry.environmentKey === "auditFile"
      ? absolutePathSchema
        .describe("Absolute path for the content-free activity log")
        .optional()
      : rootArraySchema
        .describe(storageDescription(entry.documentKey))
        .optional(),
  ]),
) as Record<string, z.ZodType>

const runtimeShape = Object.fromEntries(
  CONFIG_RUNTIME_MAPPINGS.map((entry) => [
    entry.documentKey,
    z.string()
      .min(1)
      .max(CONFIG_STRING_CHARACTERS)
      .describe(`Runtime setting for ${humanizeConfigKey(entry.documentKey)}`)
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodString>>

const observabilitySignalSchema = z.strictObject({
  compression: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
    .describe("OTLP compression mode")
    .optional(),
  endpoint: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
    .describe("Credential-free absolute OTLP endpoint")
    .optional(),
  headers: headerReferenceSchema.optional(),
  protocol: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
    .describe("OTLP transport protocol")
    .optional(),
  timeoutMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
    .describe("OTLP request timeout in milliseconds")
    .optional(),
})

export const CONNECTOR_CONFIG_DOCUMENT_SCHEMA = z.strictObject({
  $schema: z.literal(CONFIG_DOCUMENT_SCHEMA_ID)
    .describe("Editor schema identifier for this configuration format")
    .optional(),
  capabilities: z.strictObject(capabilityShape)
    .describe("Explicit capability gates; omitted gates remain disabled")
    .default({}),
  credential: tokenReferenceSchema,
  gateway: z.strictObject({
    enabled: z.boolean().describe("Enable the optional privacy-safe Discord Gateway client"),
    eventBufferSize: z.number().int().min(1).max(CONNECTOR_LIMITS.gatewayEventBufferSize)
      .describe("Maximum bounded Gateway event buffer size"),
  }).describe("Optional Discord Gateway policy"),
  identity: z.strictObject({
    applicationId: snowflakeSchema.describe("Expected Discord application identity"),
    botId: snowflakeSchema.describe("Expected Discord bot user identity"),
  }).describe("Pinned Discord application and bot identity"),
  limits: z.strictObject(limitShape)
    .describe("Optional numeric policy limits")
    .default({}),
  name: configNameSchema.describe("Bounded lowercase identifier for this policy"),
  observability: z.strictObject({
    compression: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Common OTLP compression mode")
      .optional(),
    endpoint: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Common credential-free absolute OTLP endpoint")
      .optional(),
    exportEnabled: z.boolean().describe("Enable OTLP export").optional(),
    headers: headerReferenceSchema.optional(),
    jsonLogsEnabled: z.boolean().describe("Enable content-free JSON operational logs").optional(),
    metrics: observabilitySignalSchema.optional(),
    protocol: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Common OTLP transport protocol")
      .optional(),
    serviceName: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Bounded non-identifying telemetry service name")
      .optional(),
    timeoutMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
      .describe("Common OTLP request timeout in milliseconds")
      .optional(),
    traceSampleRatio: z.number().min(0).max(1)
      .describe("Trace sampling ratio")
      .optional(),
    traceSampler: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Trace sampler name")
      .optional(),
    traces: observabilitySignalSchema.optional(),
  }).describe("Optional content-free local and OTLP observability policy").default({}),
  readScope: z.strictObject({
    channelIds: snowflakeArraySchema(0, DISCORD_LIMITS.searchChannelIds)
      .describe("Optional exact channel allowlist inside the guild boundary"),
    guildIds: snowflakeArraySchema(1, DISCORD_LIMITS.currentUserGuilds)
      .describe("Exact guild allowlist forming the outer read boundary"),
  }).describe("Required outer Discord read boundary"),
  runtime: z.strictObject(runtimeShape)
    .describe("Optional non-secret runtime settings")
    .default({}),
  schemaVersion: z.literal(CONFIG_DOCUMENT_SCHEMA_VERSION)
    .describe("Configuration format version"),
  scopes: z.strictObject(scopeShape)
    .describe("Exact per-feature Discord ID allowlists")
    .default({}),
  storage: z.strictObject(storageShape)
    .describe("Local content-free activity and owned-file paths")
    .default({}),
  tools: z.strictObject({
    surface: z.enum(MCP_TOOL_SURFACES).describe("MCP tool discovery surface"),
    toolsets: z.array(z.enum(MCP_TOOLSET_NAMES))
      .min(1)
      .max(MCP_TOOLSET_NAMES.length)
      .refine(
        (values) => canonicalArray(values, MCP_TOOLSET_NAMES),
        "must contain unique toolsets in canonical order",
      )
      .describe("Canonical MCP toolset selection"),
  }).describe("Advertised MCP tool surface"),
}).meta({
  description: "Strict non-secret configuration for discord-mcp",
  id: CONFIG_DOCUMENT_SCHEMA_ID,
  title: "discord-mcp configuration",
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "$"
  return path.reduce<string>((result, entry) => (
    typeof entry === "number"
      ? `${result}[${entry}]`
      : `${result}.${String(entry)}`
  ), "$")
}

function schemaError(error: z.ZodError): ConfigDocumentError {
  const issue = error.issues[0]
  if (!issue) return new ConfigDocumentError("Configuration document is invalid")
  return new ConfigDocumentError(
    `Configuration document ${issuePath(issue.path)} ${issue.message}`,
    { cause: error },
  )
}

export function normalizeConfigName(value: string): string {
  const result = configNameSchema.safeParse(value.trim())
  if (!result.success) throw schemaError(result.error)
  return result.data
}

function assertSecretReferenceDoesNotConflict(
  reference: EnvironmentSecretReference,
  allowedCanonicalTarget: string,
  path: string,
): void {
  const recognized = new Set<string>(Object.values(ENVIRONMENT_NAMES))
  if (
    reference.variable !== allowedCanonicalTarget
    && recognized.has(reference.variable)
  ) {
    throw new ConfigDocumentError(
      `Configuration document ${path}.variable conflicts with connector policy`,
    )
  }
}

function secretReferences(document: ConnectorConfigDocument): readonly {
  path: string
  reference: EnvironmentSecretReference
  target: string
}[] {
  const result: {
    path: string
    reference: EnvironmentSecretReference
    target: string
  }[] = [{
    path: "$.credential",
    reference: document.credential,
    target: ENVIRONMENT_NAMES.token,
  }]
  const common = document.observability.headers
  const traces = document.observability.traces?.headers
  const metrics = document.observability.metrics?.headers
  if (common) result.push({
    path: "$.observability.headers",
    reference: common,
    target: ENVIRONMENT_NAMES.otelHeaders,
  })
  if (traces) result.push({
    path: "$.observability.traces.headers",
    reference: traces,
    target: ENVIRONMENT_NAMES.otelTraceHeaders,
  })
  if (metrics) result.push({
    path: "$.observability.metrics.headers",
    reference: metrics,
    target: ENVIRONMENT_NAMES.otelMetricsHeaders,
  })
  return result
}

export function connectorConfigSecretEnvironmentNames(
  document: ConnectorConfigDocument,
): readonly string[] {
  return Object.freeze([
    ...new Set(secretReferences(parseConnectorConfigDocument(document))
      .map((entry) => entry.reference.variable)),
  ])
}

export function parseConnectorConfigDocument(
  value: unknown,
  expectedName?: string,
): ConnectorConfigDocument {
  if (isRecord(value) && value.schemaVersion !== CONFIG_DOCUMENT_SCHEMA_VERSION) {
    throw new ConfigDocumentError(
      `Unsupported configuration schema version: ${String(value.schemaVersion)}`,
    )
  }
  const result = CONNECTOR_CONFIG_DOCUMENT_SCHEMA.safeParse(value)
  if (!result.success) throw schemaError(result.error)
  const document = result.data as ConnectorConfigDocument
  if (expectedName !== undefined && document.name !== normalizeConfigName(expectedName)) {
    throw new ConfigDocumentError("Configuration name does not match its filename")
  }
  for (const secret of secretReferences(document)) {
    assertSecretReferenceDoesNotConflict(secret.reference, secret.target, secret.path)
  }
  return document
}

export function createConnectorConfigDocument(options: {
  applicationId: string
  botId: string
  capabilities?: Readonly<Record<string, boolean>>
  channelIds?: readonly string[]
  credentialVariable?: string
  gatewayEnabled?: boolean
  gatewayEventBufferSize?: number
  guildIds: readonly string[]
  limits?: Readonly<Record<string, number>>
  name: string
  observability?: ConnectorConfigDocumentObservability
  runtime?: Readonly<Record<string, string>>
  scopes?: Readonly<Record<string, readonly string[]>>
  storage?: Readonly<Record<string, string | readonly string[]>>
  toolsets: readonly McpToolsetName[]
  toolSurface: McpToolSurface
}): ConnectorConfigDocument {
  return parseConnectorConfigDocument({
    $schema: CONFIG_DOCUMENT_SCHEMA_ID,
    capabilities: options.capabilities ?? {},
    credential: {
      provider: "environment",
      variable: options.credentialVariable ?? ENVIRONMENT_NAMES.token,
    },
    gateway: {
      enabled: options.gatewayEnabled ?? false,
      eventBufferSize: options.gatewayEventBufferSize ?? GATEWAY_DEFAULTS.eventBufferSize,
    },
    identity: {
      applicationId: options.applicationId,
      botId: options.botId,
    },
    limits: options.limits ?? {},
    name: options.name,
    observability: options.observability ?? {},
    readScope: {
      channelIds: [...(options.channelIds ?? [])].sort(),
      guildIds: [...options.guildIds].sort(),
    },
    runtime: options.runtime ?? {},
    schemaVersion: CONFIG_DOCUMENT_SCHEMA_VERSION,
    scopes: options.scopes ?? {},
    storage: options.storage ?? {},
    tools: {
      surface: options.toolSurface,
      toolsets: MCP_TOOLSET_NAMES.filter((entry) => options.toolsets.includes(entry)),
    },
  })
}

function canonicalEnvironmentList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))].sort()
}

function canonicalEnvironmentRoots(value: string): string[] {
  const normalized = value.trim()
  const entries = normalized.startsWith("[")
    ? JSON.parse(normalized) as unknown
    : [normalized]
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
    throw new ConfigDocumentError("Validated storage roots could not be normalized")
  }
  return [...new Set(entries.map((entry) => entry.trim()))].sort()
}

function presentEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name]?.trim()
  return value ? value : undefined
}

function environmentSecretReference(
  environment: NodeJS.ProcessEnv,
  variable: string,
): EnvironmentSecretReference | undefined {
  return presentEnvironmentValue(environment, variable)
    ? { provider: "environment", variable }
    : undefined
}

export function configDocumentPolicyFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ConnectorConfigDocumentPolicy {
  const capabilities: Record<string, boolean> = {}
  for (const mapping of CONFIG_CAPABILITY_MAPPINGS) {
    const value = presentEnvironmentValue(environment, mapping.environmentVariable)
    if (value !== undefined) capabilities[mapping.documentKey] = value.toLowerCase() === "true"
  }

  const scopes: Record<string, string[]> = {}
  for (const mapping of CONFIG_SCOPE_MAPPINGS) {
    const value = presentEnvironmentValue(environment, mapping.environmentVariable)
    if (value !== undefined) scopes[mapping.documentKey] = canonicalEnvironmentList(value)
  }

  const limits: Record<string, number> = {}
  for (const mapping of CONFIG_LIMIT_MAPPINGS) {
    const value = presentEnvironmentValue(environment, mapping.environmentVariable)
    if (value !== undefined) limits[mapping.documentKey] = Number(value)
  }

  const storage: Record<string, string | string[]> = {}
  for (const mapping of CONFIG_STORAGE_MAPPINGS) {
    const value = presentEnvironmentValue(environment, mapping.environmentVariable)
    if (value === undefined) continue
    storage[mapping.documentKey] = mapping.environmentKey === "auditFile"
      ? resolve(value)
      : canonicalEnvironmentRoots(value)
  }

  const runtime: Record<string, string> = {}
  for (const mapping of CONFIG_RUNTIME_MAPPINGS) {
    const value = presentEnvironmentValue(environment, mapping.environmentVariable)
    if (value !== undefined) runtime[mapping.documentKey] = value
  }

  const traceHeaders = environmentSecretReference(
    environment,
    ENVIRONMENT_NAMES.otelTraceHeaders,
  )
  const metricHeaders = environmentSecretReference(
    environment,
    ENVIRONMENT_NAMES.otelMetricsHeaders,
  )
  const traceCompression = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelTraceCompression,
  )
  const traceEndpoint = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelTraceEndpoint,
  )
  const traceProtocol = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelTraceProtocol,
  )
  const traceTimeout = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelTraceTimeout,
  )
  const traces = {
    ...(traceCompression ? { compression: traceCompression } : {}),
    ...(traceEndpoint ? { endpoint: traceEndpoint } : {}),
    ...(traceHeaders ? { headers: traceHeaders } : {}),
    ...(traceProtocol ? { protocol: traceProtocol } : {}),
    ...(traceTimeout ? { timeoutMs: Number(traceTimeout) } : {}),
  }
  const metricCompression = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelMetricsCompression,
  )
  const metricEndpoint = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelMetricsEndpoint,
  )
  const metricProtocol = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelMetricsProtocol,
  )
  const metricTimeout = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelMetricsTimeout,
  )
  const metrics = {
    ...(metricCompression ? { compression: metricCompression } : {}),
    ...(metricEndpoint ? { endpoint: metricEndpoint } : {}),
    ...(metricHeaders ? { headers: metricHeaders } : {}),
    ...(metricProtocol ? { protocol: metricProtocol } : {}),
    ...(metricTimeout ? { timeoutMs: Number(metricTimeout) } : {}),
  }
  const commonHeaders = environmentSecretReference(
    environment,
    ENVIRONMENT_NAMES.otelHeaders,
  )
  const generalCompression = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelCompression,
  )
  const endpoint = presentEnvironmentValue(environment, ENVIRONMENT_NAMES.otelEndpoint)
  const exportEnabled = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.allowObservabilityExport,
  )
  const jsonLogsEnabled = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.observabilityLogs,
  )
  const protocol = presentEnvironmentValue(environment, ENVIRONMENT_NAMES.otelProtocol)
  const serviceName = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelServiceName,
  )
  const timeout = presentEnvironmentValue(environment, ENVIRONMENT_NAMES.otelTimeout)
  const traceSampleRatio = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelTracesSamplerArg,
  )
  const traceSampler = presentEnvironmentValue(
    environment,
    ENVIRONMENT_NAMES.otelTracesSampler,
  )
  const observability: ConnectorConfigDocumentObservability = {
    ...(generalCompression ? { compression: generalCompression } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(exportEnabled ? { exportEnabled: exportEnabled.toLowerCase() === "true" } : {}),
    ...(commonHeaders ? { headers: commonHeaders } : {}),
    ...(jsonLogsEnabled
      ? { jsonLogsEnabled: jsonLogsEnabled.toLowerCase() === "true" }
      : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(protocol ? { protocol } : {}),
    ...(serviceName ? { serviceName } : {}),
    ...(timeout ? { timeoutMs: Number(timeout) } : {}),
    ...(traceSampleRatio ? { traceSampleRatio: Number(traceSampleRatio) } : {}),
    ...(traceSampler ? { traceSampler } : {}),
    ...(Object.keys(traces).length > 0 ? { traces } : {}),
  }
  return { capabilities, limits, observability, runtime, scopes, storage }
}

class JsonCursor {
  readonly #text: string
  #index = 0

  constructor(text: string) {
    this.#text = text
  }

  assertNoDuplicateKeys(): void {
    this.#skipWhitespace()
    this.#value(0, "$")
    this.#skipWhitespace()
    if (this.#index !== this.#text.length) this.#invalid()
  }

  #invalid(message = "Configuration file is not valid JSON"): never {
    throw new ConfigDocumentError(message)
  }

  #skipWhitespace(): void {
    while (/\s/.test(this.#text[this.#index] || "")) this.#index += 1
  }

  #string(): string {
    if (this.#text[this.#index] !== "\"") this.#invalid()
    const start = this.#index
    this.#index += 1
    let escaped = false
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index]
      this.#index += 1
      if (escaped) {
        escaped = false
        continue
      }
      if (character === "\\") {
        escaped = true
        continue
      }
      if (character === "\"") {
        const raw = this.#text.slice(start, this.#index)
        try {
          return JSON.parse(raw) as string
        } catch (error) {
          throw new ConfigDocumentError("Configuration file is not valid JSON", {
            cause: error,
          })
        }
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) this.#invalid()
    }
    this.#invalid()
  }

  #value(depth: number, path: string): void {
    if (depth > CONFIG_JSON_MAX_DEPTH) {
      this.#invalid("Configuration file exceeds the maximum JSON nesting depth")
    }
    this.#skipWhitespace()
    const character = this.#text[this.#index]
    if (character === "{") return this.#object(depth, path)
    if (character === "[") return this.#array(depth, path)
    if (character === "\"") {
      this.#string()
      return
    }
    const remainder = this.#text.slice(this.#index)
    const token = remainder.match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/)?.[0]
    if (!token) this.#invalid()
    this.#index += token.length
  }

  #object(depth: number, path: string): void {
    this.#index += 1
    this.#skipWhitespace()
    if (this.#text[this.#index] === "}") {
      this.#index += 1
      return
    }
    const keys = new Set<string>()
    while (true) {
      const key = this.#string()
      if (keys.has(key)) {
        throw new ConfigDocumentError(
          `Configuration file contains duplicate object key at ${path}.${key}`,
        )
      }
      keys.add(key)
      this.#skipWhitespace()
      if (this.#text[this.#index] !== ":") this.#invalid()
      this.#index += 1
      this.#value(depth + 1, `${path}.${key}`)
      this.#skipWhitespace()
      const separator = this.#text[this.#index]
      if (separator === "}") {
        this.#index += 1
        return
      }
      if (separator !== ",") this.#invalid()
      this.#index += 1
      this.#skipWhitespace()
    }
  }

  #array(depth: number, path: string): void {
    this.#index += 1
    this.#skipWhitespace()
    if (this.#text[this.#index] === "]") {
      this.#index += 1
      return
    }
    let index = 0
    while (true) {
      this.#value(depth + 1, `${path}[${index}]`)
      index += 1
      this.#skipWhitespace()
      const separator = this.#text[this.#index]
      if (separator === "]") {
        this.#index += 1
        return
      }
      if (separator !== ",") this.#invalid()
      this.#index += 1
      this.#skipWhitespace()
    }
  }
}

export function parseStrictConfigJson(text: string): unknown {
  if (!text.endsWith("\n") || text.includes("\0")) {
    throw new ConfigDocumentError(
      "Configuration file must contain one complete newline-terminated JSON document",
    )
  }
  new JsonCursor(text).assertNoDuplicateKeys()
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof ConfigDocumentError) throw error
    throw new ConfigDocumentError("Configuration file is not valid JSON", { cause: error })
  }
}

export function parseConnectorConfigJson(text: string): ConnectorConfigDocument {
  return parseConnectorConfigDocument(parseStrictConfigJson(text))
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

export function loadConnectorConfigDocumentFile(
  file: string,
  options: {
    platform?: NodeJS.Platform
    processUserId?: number
  } = {},
): ConnectorConfigDocument {
  const normalized = file.trim()
  if (
    !normalized
    || normalized.includes("\0")
    || !isAbsolute(normalized)
    || resolve(normalized) !== normalized
  ) {
    throw new ConfigDocumentError("Configuration file path must be absolute and canonical")
  }
  let handle: number | undefined
  try {
    handle = openSync(normalized, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const opened = fstatSync(handle)
    const linked = lstatSync(normalized)
    const canonical = realpathSync.native(normalized)
    const platform = options.platform ?? process.platform
    const processUserId = options.processUserId
      ?? (typeof process.getuid === "function" ? process.getuid() : undefined)
    if (
      !opened.isFile()
      || !linked.isFile()
      || linked.isSymbolicLink()
      || opened.dev !== linked.dev
      || opened.ino !== linked.ino
      || opened.nlink !== 1
      || opened.size < 3
      || opened.size > CONNECTOR_LIMITS.configBytes
      || canonical !== normalized
      || (
        platform !== "win32"
        && (
          processUserId === undefined
          || ![0, processUserId].includes(opened.uid)
          || (opened.mode & 0o022) !== 0
        )
      )
    ) {
      throw new ConfigDocumentError(
        "Configuration file must be a bounded canonical non-writable regular file owned by the process user or root",
      )
    }
    return parseConnectorConfigJson(readFileSync(handle, "utf8"))
  } catch (error) {
    if (error instanceof ConfigDocumentError) throw error
    const message = isNodeError(error, "ENOENT")
      ? "Configuration file was not found"
      : "Unable to inspect or read configuration file"
    throw new ConfigDocumentError(message, { cause: error })
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

function nonEmptyEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name]?.trim()
  return value ? value : undefined
}

function setEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  value: ConfigScalar | undefined,
): void {
  if (value === undefined) return
  environment[name] = Array.isArray(value)
    ? value.join(",")
    : String(value)
}

function sectionEnvironment(
  target: NodeJS.ProcessEnv,
  section: Readonly<Record<string, ConfigScalar>>,
  mappings: readonly ConfigSectionMapping[],
): void {
  for (const mapping of mappings) {
    const value = section[mapping.documentKey]
    if (value === undefined) continue
    if (
      mapping.environmentKey.endsWith("Roots")
      && Array.isArray(value)
    ) {
      target[mapping.environmentVariable] = JSON.stringify(value)
      continue
    }
    setEnvironmentValue(target, mapping.environmentVariable, value)
  }
}

function setObservabilityEnvironment(
  target: NodeJS.ProcessEnv,
  observability: ConnectorConfigDocumentObservability,
): void {
  setEnvironmentValue(target, ENVIRONMENT_NAMES.allowObservabilityExport, observability.exportEnabled)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.observabilityLogs, observability.jsonLogsEnabled)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelEndpoint, observability.endpoint)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelProtocol, observability.protocol)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelCompression, observability.compression)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTimeout, observability.timeoutMs)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelServiceName, observability.serviceName)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTracesSampler, observability.traceSampler)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTracesSamplerArg, observability.traceSampleRatio)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTraceEndpoint, observability.traces?.endpoint)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTraceProtocol, observability.traces?.protocol)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTraceCompression, observability.traces?.compression)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelTraceTimeout, observability.traces?.timeoutMs)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelMetricsEndpoint, observability.metrics?.endpoint)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelMetricsProtocol, observability.metrics?.protocol)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelMetricsCompression, observability.metrics?.compression)
  setEnvironmentValue(target, ENVIRONMENT_NAMES.otelMetricsTimeout, observability.metrics?.timeoutMs)
}

export function activateConnectorConfigDocument(
  documentValue: ConnectorConfigDocument,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const document = parseConnectorConfigDocument(documentValue)
  const secrets = secretReferences(document)
  const recognized = new Set<string>(Object.values(ENVIRONMENT_NAMES))
  const permitted = new Set<string>([
    ENVIRONMENT_NAMES.configFile,
    ...secrets.map((entry) => entry.reference.variable),
  ])
  const conflicts = Object.keys(source)
    .filter((name) => (
      !permitted.has(name)
      && (
        recognized.has(name)
        || name.startsWith("DISCORD_MCP_")
        || name.startsWith("OTEL_")
      )
      && nonEmptyEnvironmentValue(source, name) !== undefined
    ))
    .sort()
  if (conflicts.length > 0) {
    throw new ConfigDocumentError(
      `Selected configuration conflicts with policy environment variables: ${conflicts.join(", ")}`,
    )
  }

  const resolvedSecrets = new Map<string, string>()
  for (const secret of secrets) {
    const value = nonEmptyEnvironmentValue(source, secret.reference.variable)
    if (!value) {
      throw new ConfigDocumentError(
        `Configuration document ${secret.path} requires ${secret.reference.variable}`,
      )
    }
    resolvedSecrets.set(secret.target, value)
  }

  const environment = { ...source }
  for (const name of Object.keys(environment)) {
    if (
      recognized.has(name)
      || name.startsWith("DISCORD_MCP_")
      || name.startsWith("OTEL_")
    ) delete environment[name]
  }
  for (const secret of secrets) {
    if (!(Object.values(ENVIRONMENT_NAMES) as string[]).includes(secret.reference.variable)) {
      delete environment[secret.reference.variable]
    }
  }
  for (const [target, value] of resolvedSecrets) environment[target] = value

  environment[ENVIRONMENT_NAMES.applicationId] = document.identity.applicationId
  environment[ENVIRONMENT_NAMES.botId] = document.identity.botId
  environment[ENVIRONMENT_NAMES.allowedGuildIds] = document.readScope.guildIds.join(",")
  environment[ENVIRONMENT_NAMES.allowedChannelIds] = document.readScope.channelIds.join(",")
  environment[ENVIRONMENT_NAMES.toolSurface] = document.tools.surface
  environment[ENVIRONMENT_NAMES.toolsets] = document.tools.toolsets.join(",")
  environment[ENVIRONMENT_NAMES.allowGateway] = String(document.gateway.enabled)
  environment[ENVIRONMENT_NAMES.gatewayEventBufferSize] = String(
    document.gateway.eventBufferSize,
  )
  sectionEnvironment(environment, document.capabilities, CONFIG_CAPABILITY_MAPPINGS)
  sectionEnvironment(environment, document.scopes, CONFIG_SCOPE_MAPPINGS)
  sectionEnvironment(environment, document.limits, CONFIG_LIMIT_MAPPINGS)
  sectionEnvironment(environment, document.storage, CONFIG_STORAGE_MAPPINGS)
  sectionEnvironment(environment, document.runtime, CONFIG_RUNTIME_MAPPINGS)
  setObservabilityEnvironment(environment, document.observability)
  return environment
}

export function activateConnectorConfigFile(
  source: NodeJS.ProcessEnv = process.env,
): {
  document: ConnectorConfigDocument
  environment: NodeJS.ProcessEnv
  file: string
} | undefined {
  const file = nonEmptyEnvironmentValue(source, ENVIRONMENT_NAMES.configFile)
  if (!file) return undefined
  const document = loadConnectorConfigDocumentFile(file)
  return {
    document,
    environment: activateConnectorConfigDocument(document, source),
    file,
  }
}

const OBSERVABILITY_ENVIRONMENT_PATHS = Object.freeze(new Map<string, string>([
  [ENVIRONMENT_NAMES.allowObservabilityExport, "$.observability.exportEnabled"],
  [ENVIRONMENT_NAMES.observabilityLogs, "$.observability.jsonLogsEnabled"],
  [ENVIRONMENT_NAMES.otelCompression, "$.observability.compression"],
  [ENVIRONMENT_NAMES.otelEndpoint, "$.observability.endpoint"],
  [ENVIRONMENT_NAMES.otelHeaders, "$.observability.headers"],
  [ENVIRONMENT_NAMES.otelMetricsCompression, "$.observability.metrics.compression"],
  [ENVIRONMENT_NAMES.otelMetricsEndpoint, "$.observability.metrics.endpoint"],
  [ENVIRONMENT_NAMES.otelMetricsHeaders, "$.observability.metrics.headers"],
  [ENVIRONMENT_NAMES.otelMetricsProtocol, "$.observability.metrics.protocol"],
  [ENVIRONMENT_NAMES.otelMetricsTimeout, "$.observability.metrics.timeoutMs"],
  [ENVIRONMENT_NAMES.otelProtocol, "$.observability.protocol"],
  [ENVIRONMENT_NAMES.otelServiceName, "$.observability.serviceName"],
  [ENVIRONMENT_NAMES.otelTimeout, "$.observability.timeoutMs"],
  [ENVIRONMENT_NAMES.otelTraceCompression, "$.observability.traces.compression"],
  [ENVIRONMENT_NAMES.otelTraceEndpoint, "$.observability.traces.endpoint"],
  [ENVIRONMENT_NAMES.otelTraceHeaders, "$.observability.traces.headers"],
  [ENVIRONMENT_NAMES.otelTraceProtocol, "$.observability.traces.protocol"],
  [ENVIRONMENT_NAMES.otelTraceTimeout, "$.observability.traces.timeoutMs"],
  [ENVIRONMENT_NAMES.otelTracesSampler, "$.observability.traceSampler"],
  [ENVIRONMENT_NAMES.otelTracesSamplerArg, "$.observability.traceSampleRatio"],
]))

export const CONFIG_DOCUMENT_ENVIRONMENT_PATHS = Object.freeze(new Map<string, string>([
  [ENVIRONMENT_NAMES.token, "$.credential"],
  [ENVIRONMENT_NAMES.applicationId, "$.identity.applicationId"],
  [ENVIRONMENT_NAMES.botId, "$.identity.botId"],
  [ENVIRONMENT_NAMES.allowedGuildIds, "$.readScope.guildIds"],
  [ENVIRONMENT_NAMES.allowedChannelIds, "$.readScope.channelIds"],
  [ENVIRONMENT_NAMES.toolSurface, "$.tools.surface"],
  [ENVIRONMENT_NAMES.toolsets, "$.tools.toolsets"],
  [ENVIRONMENT_NAMES.allowGateway, "$.gateway.enabled"],
  [ENVIRONMENT_NAMES.gatewayEventBufferSize, "$.gateway.eventBufferSize"],
  ...CONFIG_CAPABILITY_MAPPINGS.map((entry) => [
    entry.environmentVariable,
    `$.capabilities.${entry.documentKey}`,
  ] as const),
  ...CONFIG_SCOPE_MAPPINGS.map((entry) => [
    entry.environmentVariable,
    `$.scopes.${entry.documentKey}`,
  ] as const),
  ...CONFIG_LIMIT_MAPPINGS.map((entry) => [
    entry.environmentVariable,
    `$.limits.${entry.documentKey}`,
  ] as const),
  ...CONFIG_STORAGE_MAPPINGS.map((entry) => [
    entry.environmentVariable,
    `$.storage.${entry.documentKey}`,
  ] as const),
  ...CONFIG_RUNTIME_MAPPINGS.map((entry) => [
    entry.environmentVariable,
    `$.runtime.${entry.documentKey}`,
  ] as const),
  ...OBSERVABILITY_ENVIRONMENT_PATHS,
]))

export function configDocumentConfigurationError(error: unknown): unknown {
  if (!(error instanceof ConfigurationError) || error instanceof ConfigDocumentError) {
    return error
  }
  let message = error.message
  const entries = [...CONFIG_DOCUMENT_ENVIRONMENT_PATHS]
    .sort(([left], [right]) => right.length - left.length)
  for (const [name, path] of entries) message = message.replaceAll(name, path)
  return new ConfigDocumentError(message, { cause: error })
}

export function connectorConfigJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(CONNECTOR_CONFIG_DOCUMENT_SCHEMA, {
    target: "draft-2020-12",
  }) as Record<string, unknown>
  return {
    ...schema,
    $id: CONFIG_DOCUMENT_SCHEMA_ID,
    description: "Strict non-secret configuration for discord-mcp",
    title: "discord-mcp configuration",
  }
}

export function connectorConfigFields(): readonly ConfigDocumentField[] {
  return Object.freeze([
    {
      defaultValue: undefined,
      description: "Editor schema identifier for this configuration format",
      environmentVariable: undefined,
      kind: "string",
      path: "$.$schema",
      required: false,
    },
    {
      defaultValue: CONFIG_DOCUMENT_SCHEMA_VERSION,
      description: "Configuration format version",
      environmentVariable: undefined,
      kind: "integer",
      path: "$.schemaVersion",
      required: true,
    },
    {
      defaultValue: undefined,
      description: "Bounded lowercase identifier for this policy",
      environmentVariable: undefined,
      kind: "string",
      path: "$.name",
      required: true,
    },
    {
      defaultValue: undefined,
      description: "Environment reference for the Discord bot token",
      environmentVariable: ENVIRONMENT_NAMES.token,
      kind: "secret-reference",
      path: "$.credential",
      required: true,
    },
    ...([
      ["$.identity.applicationId", ENVIRONMENT_NAMES.applicationId],
      ["$.identity.botId", ENVIRONMENT_NAMES.botId],
    ] as const).map(([path, environmentVariable]) => ({
      defaultValue: undefined,
      description: path.endsWith("applicationId")
        ? "Expected Discord application identity"
        : "Expected Discord bot user identity",
      environmentVariable,
      kind: "snowflake" as const,
      path,
      required: true,
    })),
    ...([
      ["$.readScope.guildIds", ENVIRONMENT_NAMES.allowedGuildIds, undefined],
      ["$.readScope.channelIds", ENVIRONMENT_NAMES.allowedChannelIds, []],
    ] as const).map(([path, environmentVariable, defaultValue]) => ({
      defaultValue,
      description: path.endsWith("guildIds")
        ? "Exact guild allowlist forming the outer read boundary"
        : "Optional exact channel allowlist inside the guild boundary",
      environmentVariable,
      kind: "snowflakes" as const,
      path,
      required: true,
    })),
    {
      defaultValue: "progressive",
      description: "MCP tool discovery surface",
      environmentVariable: ENVIRONMENT_NAMES.toolSurface,
      kind: "string",
      path: "$.tools.surface",
      required: true,
    },
    {
      defaultValue: undefined,
      description: "Canonical MCP toolset selection",
      environmentVariable: ENVIRONMENT_NAMES.toolsets,
      kind: "strings",
      path: "$.tools.toolsets",
      required: true,
    },
    {
      defaultValue: false,
      description: "Enable the optional privacy-safe Discord Gateway client",
      environmentVariable: ENVIRONMENT_NAMES.allowGateway,
      kind: "boolean",
      path: "$.gateway.enabled",
      required: true,
    },
    {
      defaultValue: GATEWAY_DEFAULTS.eventBufferSize,
      description: "Maximum bounded Gateway event buffer size",
      environmentVariable: ENVIRONMENT_NAMES.gatewayEventBufferSize,
      kind: "integer",
      path: "$.gateway.eventBufferSize",
      required: true,
    },
    ...CONFIG_CAPABILITY_MAPPINGS.map((entry) => ({
      defaultValue: false,
      description: capabilityDescription(entry.documentKey),
      environmentVariable: entry.environmentVariable,
      kind: "boolean" as const,
      path: `$.capabilities.${entry.documentKey}`,
      required: false,
    })),
    ...CONFIG_SCOPE_MAPPINGS.map((entry) => ({
      defaultValue: [],
      description: scopeDescription(entry.documentKey),
      environmentVariable: entry.environmentVariable,
      kind: "snowflakes" as const,
      path: `$.scopes.${entry.documentKey}`,
      required: false,
    })),
    ...CONFIG_LIMIT_MAPPINGS.map((entry) => ({
      defaultValue: undefined,
      description: `Numeric policy limit for ${humanizeConfigKey(entry.documentKey)}`,
      environmentVariable: entry.environmentVariable,
      kind: "integer" as const,
      path: `$.limits.${entry.documentKey}`,
      required: false,
    })),
    ...CONFIG_STORAGE_MAPPINGS.map((entry) => ({
      defaultValue: entry.environmentKey === "auditFile" ? undefined : [],
      description: entry.environmentKey === "auditFile"
        ? "Absolute path for the content-free activity log"
        : storageDescription(entry.documentKey),
      environmentVariable: entry.environmentVariable,
      kind: (entry.environmentKey === "auditFile" ? "path" : "paths") as "path" | "paths",
      path: `$.storage.${entry.documentKey}`,
      required: false,
    })),
    ...CONFIG_RUNTIME_MAPPINGS.map((entry) => ({
      defaultValue: undefined,
      description: `Runtime setting for ${humanizeConfigKey(entry.documentKey)}`,
      environmentVariable: entry.environmentVariable,
      kind: "string" as const,
      path: `$.runtime.${entry.documentKey}`,
      required: false,
    })),
    ...[...OBSERVABILITY_ENVIRONMENT_PATHS].map(([environmentVariable, path]) => ({
      defaultValue: undefined,
      description: `Observability setting for ${humanizeConfigKey(path.split(".").at(-1) || path)}`,
      environmentVariable,
      kind: environmentVariable.endsWith("_HEADERS")
        ? "secret-reference" as const
        : environmentVariable.endsWith("_TIMEOUT")
          || environmentVariable === ENVIRONMENT_NAMES.otelTracesSamplerArg
          ? "number" as const
          : environmentVariable.startsWith("DISCORD_MCP_")
            ? "boolean" as const
            : "string" as const,
      path,
      required: false,
    })),
  ])
}
