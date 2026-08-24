import {
  loadConnectorConfigDocument,
  type ConfigOptions,
  type ConnectorConfig,
} from "../src/config.js"
import {
  createConnectorConfigDocument,
  type ConnectorConfigDocument,
  type ConnectorConfigDocumentObservability,
} from "../src/config-document.js"
import {
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  GATEWAY_DEFAULTS,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
  type McpToolSurface,
} from "../src/constants.js"
import { ConfigurationError } from "../src/errors.js"

const FIXTURE_APPLICATION_ID = "900000000000000001"
const FIXTURE_BOT_ID = "900000000000000002"
const FIXTURE_GUILD_ID = "100000000000000001"
const FIXTURE_TOKEN_VARIABLE = DEFAULT_TOKEN_ENVIRONMENT_VARIABLE
const FIXTURE_OTLP_HEADERS_VARIABLE = "FIXTURE_OTLP_HEADERS"
const FIXTURE_OTLP_TRACE_HEADERS_VARIABLE = "FIXTURE_OTLP_TRACE_HEADERS"
const FIXTURE_OTLP_METRIC_HEADERS_VARIABLE = "FIXTURE_OTLP_METRIC_HEADERS"

const LIMIT_VARIABLES = Object.freeze(new Map([
  ["DISCORD_MCP_ATTACHMENT_MAX_BYTES", "attachmentMaxBytes"],
  ["DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE", "interactionMaxWritesPerMinute"],
  ["DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS", "interactionMinWriteIntervalMs"],
  ["DISCORD_MCP_NATIVE_INTERACTION_MAX_PENDING", "nativeInteractionMaxPending"],
  ["DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS", "nativeInteractionTtlSeconds"],
]))

const STORAGE_VARIABLES = Object.freeze(new Map([
  ["DISCORD_MCP_APPLICATION_EMOJI_ROOTS", "applicationEmojiRoots"],
  ["DISCORD_MCP_ATTACHMENT_ROOTS", "attachmentRoots"],
  ["DISCORD_MCP_AUDIT_FILE", "auditFile"],
  ["DISCORD_MCP_GUILD_EXPRESSION_ROOTS", "guildExpressionRoots"],
  ["DISCORD_MCP_SCHEDULED_EVENT_ROOTS", "scheduledEventRoots"],
  ["DISCORD_MCP_SOUNDBOARD_ROOTS", "soundboardRoots"],
]))

function lowerCamel(value: string): string {
  const words = value.toLowerCase().split("_")
  return words.map((word, index) => (
    index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`
  )).join("")
}

function list(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))].sort()
}

function booleanValue(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  throw new Error(`${name} must be true or false`)
}

function roots(value: string): string[] {
  const normalized = value.trim()
  let parsed: unknown
  try {
    parsed = normalized.startsWith("[")
      ? JSON.parse(normalized) as unknown
      : [normalized]
  } catch (error) {
    throw new ConfigurationError("Storage roots must be valid JSON", { cause: error })
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map(String).sort()
}

function signal(
  environment: NodeJS.ProcessEnv,
  prefix: "METRICS" | "TRACES",
  headerVariable: string,
): ConnectorConfigDocumentObservability["metrics"] {
  const source = `OTEL_EXPORTER_OTLP_${prefix}_`
  const compression = environment[`${source}COMPRESSION`]
  const endpoint = environment[`${source}ENDPOINT`]
  const headers = environment[`${source}HEADERS`]
  const protocol = environment[`${source}PROTOCOL`]
  const timeout = environment[`${source}TIMEOUT`]
  const result = {
    ...(compression
      ? { compression }
      : {}),
    ...(endpoint
      ? { endpoint }
      : {}),
    ...(headers
      ? { headers: { provider: "environment" as const, variable: headerVariable } }
      : {}),
    ...(protocol
      ? { protocol }
      : {}),
    ...(timeout
      ? { timeoutMs: Number(timeout) }
      : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export interface FixtureConfigInput {
  document: ConnectorConfigDocument
  environment: NodeJS.ProcessEnv
}

export function fixtureConfigInput(
  source: NodeJS.ProcessEnv,
): FixtureConfigInput {
  const capabilities: Record<string, boolean> = {}
  const scopes: Record<string, string[]> = {}
  const limits: Record<string, number> = {}
  const storage: Record<string, string | string[]> = {}
  const runtime: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (
      name.startsWith("DISCORD_MCP_ALLOW_")
      && name !== "DISCORD_MCP_ALLOW_GATEWAY"
      && name !== "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT"
    ) {
      capabilities[lowerCamel(name.slice("DISCORD_MCP_ALLOW_".length))] = booleanValue(value, name)
      continue
    }
    const limit = LIMIT_VARIABLES.get(name)
    if (limit) {
      limits[limit] = Number(value)
      continue
    }
    const stored = STORAGE_VARIABLES.get(name)
    if (stored) {
      storage[stored] = stored === "auditFile" ? value.trim() : roots(value)
      continue
    }
    if (
      name.startsWith("DISCORD_MCP_")
      && name.endsWith("_IDS")
      && name !== "DISCORD_MCP_ALLOWED_CHANNEL_IDS"
      && name !== "DISCORD_MCP_ALLOWED_GUILD_IDS"
    ) {
      scopes[lowerCamel(name.slice("DISCORD_MCP_".length))] = list(value)
    }
  }

  const configuredToolsets = list(source.DISCORD_MCP_TOOLSETS)
    .map((entry) => entry.toLowerCase())
  const toolsets = configuredToolsets.length === 0 || configuredToolsets.includes("all")
    ? [...MCP_TOOLSET_NAMES]
    : MCP_TOOLSET_NAMES.filter((entry) => configuredToolsets.includes(entry))
  const traces = signal(source, "TRACES", FIXTURE_OTLP_TRACE_HEADERS_VARIABLE)
  const metrics = signal(source, "METRICS", FIXTURE_OTLP_METRIC_HEADERS_VARIABLE)
  const observability: ConnectorConfigDocumentObservability = {
    ...(source.OTEL_EXPORTER_OTLP_COMPRESSION
      ? { compression: source.OTEL_EXPORTER_OTLP_COMPRESSION }
      : {}),
    ...(source.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { endpoint: source.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    ...(source.DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT
      ? { exportEnabled: booleanValue(source.DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT, "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT") }
      : {}),
    ...(source.OTEL_EXPORTER_OTLP_HEADERS
      ? { headers: { provider: "environment", variable: FIXTURE_OTLP_HEADERS_VARIABLE } as const }
      : {}),
    ...(source.DISCORD_MCP_OBSERVABILITY_LOGS
      ? { jsonLogsEnabled: booleanValue(source.DISCORD_MCP_OBSERVABILITY_LOGS, "DISCORD_MCP_OBSERVABILITY_LOGS") }
      : {}),
    ...(metrics ? { metrics } : {}),
    ...(source.OTEL_EXPORTER_OTLP_PROTOCOL
      ? { protocol: source.OTEL_EXPORTER_OTLP_PROTOCOL }
      : {}),
    ...(source.OTEL_SERVICE_NAME ? { serviceName: source.OTEL_SERVICE_NAME } : {}),
    ...(source.OTEL_EXPORTER_OTLP_TIMEOUT
      ? { timeoutMs: Number(source.OTEL_EXPORTER_OTLP_TIMEOUT) }
      : {}),
    ...(source.OTEL_TRACES_SAMPLER_ARG
      ? { traceSampleRatio: Number(source.OTEL_TRACES_SAMPLER_ARG) }
      : {}),
    ...(source.OTEL_TRACES_SAMPLER
      ? { traceSampler: source.OTEL_TRACES_SAMPLER }
      : {}),
    ...(traces ? { traces } : {}),
  }
  if (source.DISCORD_MCP_NATIVE_COMMAND_NAME) {
    runtime.nativeCommandName = source.DISCORD_MCP_NATIVE_COMMAND_NAME
  }
  const document = createConnectorConfigDocument({
    applicationId: source.DISCORD_MCP_APPLICATION_ID?.trim() || FIXTURE_APPLICATION_ID,
    botId: source.DISCORD_MCP_BOT_ID?.trim() || FIXTURE_BOT_ID,
    capabilities,
    channelIds: source.DISCORD_MCP_ALLOWED_CHANNEL_IDS === undefined
      ? []
      : list(source.DISCORD_MCP_ALLOWED_CHANNEL_IDS),
    credentialVariable: FIXTURE_TOKEN_VARIABLE,
    gatewayEnabled: source.DISCORD_MCP_ALLOW_GATEWAY
      ? booleanValue(source.DISCORD_MCP_ALLOW_GATEWAY, "DISCORD_MCP_ALLOW_GATEWAY")
      : false,
    gatewayEventBufferSize: source.DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE
      ? Number(source.DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE)
      : GATEWAY_DEFAULTS.eventBufferSize,
    guildIds: source.DISCORD_MCP_ALLOWED_GUILD_IDS === undefined
      ? [FIXTURE_GUILD_ID]
      : list(source.DISCORD_MCP_ALLOWED_GUILD_IDS),
    limits,
    name: "test-policy",
    observability,
    runtime,
    scopes,
    storage,
    toolsets: toolsets as readonly McpToolsetName[],
    toolSurface: (source.DISCORD_MCP_TOOL_SURFACE?.trim().toLowerCase() || "full") as McpToolSurface,
  })
  const environment: NodeJS.ProcessEnv = {
    [FIXTURE_TOKEN_VARIABLE]: source.DISCORD_BOT_TOKEN,
    ...(source.OTEL_EXPORTER_OTLP_HEADERS
      ? { [FIXTURE_OTLP_HEADERS_VARIABLE]: source.OTEL_EXPORTER_OTLP_HEADERS }
      : {}),
    ...(source.OTEL_EXPORTER_OTLP_TRACES_HEADERS
      ? { [FIXTURE_OTLP_TRACE_HEADERS_VARIABLE]: source.OTEL_EXPORTER_OTLP_TRACES_HEADERS }
      : {}),
    ...(source.OTEL_EXPORTER_OTLP_METRICS_HEADERS
      ? { [FIXTURE_OTLP_METRIC_HEADERS_VARIABLE]: source.OTEL_EXPORTER_OTLP_METRICS_HEADERS }
      : {}),
    ...(source.XDG_STATE_HOME ? { XDG_STATE_HOME: source.XDG_STATE_HOME } : {}),
  }
  return { document, environment }
}

export function loadFixtureConfig(
  source: NodeJS.ProcessEnv,
  options: ConfigOptions = {},
): ConnectorConfig {
  const fixture = fixtureConfigInput(source)
  return loadConnectorConfigDocument(
    fixture.document,
    fixture.environment,
    options,
  )
}
