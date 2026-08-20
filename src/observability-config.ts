import {
  CONNECTOR_LIMITS,
  ENVIRONMENT_NAMES,
  OBSERVABILITY_DEFAULTS,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"

export type OtlpCompression = "gzip" | "none"
export type OtlpTraceSampler =
  | "always_off"
  | "always_on"
  | "parentbased_always_off"
  | "parentbased_always_on"
  | "parentbased_traceidratio"
  | "traceidratio"

export interface OtlpSignalConfig {
  compression: OtlpCompression
  headers: Readonly<Record<string, string>>
  timeoutMs: number
  url: string
}

export interface ObservabilityExportConfig {
  endpointConfigured: boolean
  headersConfigured: boolean
  metrics: OtlpSignalConfig
  serviceName: string
  traceSampleRatio: number
  traceSampler: OtlpTraceSampler
  traces: OtlpSignalConfig
}

export interface ObservabilityConfig {
  export: ObservabilityExportConfig | undefined
  exportEnabled: boolean
  jsonLogsEnabled: boolean
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const SNOWFLAKE_LIKE_PATTERN = /[0-9]{17,}/
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const TRACE_SAMPLERS: ReadonlySet<string> = new Set([
  "always_off",
  "always_on",
  "parentbased_always_off",
  "parentbased_always_on",
  "parentbased_traceidratio",
  "traceidratio",
])
const UNSUPPORTED_OTLP_ENVIRONMENT_NAMES = Object.freeze([
  "OTEL_EXPORTER_OTLP_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY",
])

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value.trim() === "") return false
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  throw new ConfigurationError(`${name} must be true or false`)
}

function rejectSecret(value: string, name: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (secret && value.includes(secret)) {
      throw new ConfigurationError(`${name} must not contain the Discord bot token`)
    }
  }
}

function rejectEncodedSecret(value: string, name: string, secrets: readonly string[]): void {
  let candidate = value
  for (let pass = 0; pass < 3; pass += 1) {
    rejectSecret(candidate, name, secrets)
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return
      candidate = decoded
    } catch {
      return
    }
  }
  rejectSecret(candidate, name, secrets)
}

function decodeHeaderPart(value: string, name: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ConfigurationError(`${name} contains invalid percent encoding`)
  }
}

export function parseOtlpHeaders(
  value: string | undefined,
  name: string,
  secrets: readonly string[],
): Readonly<Record<string, string>> {
  if (!value?.trim()) return Object.freeze({})
  rejectEncodedSecret(value, name, secrets)
  const headers: Record<string, string> = {}
  const entries = value.split(",")
  if (entries.length > CONNECTOR_LIMITS.observabilityHeaders) {
    throw new ConfigurationError(
      `${name} must contain at most ${CONNECTOR_LIMITS.observabilityHeaders} headers`,
    )
  }
  for (const entry of entries) {
    const separator = entry.indexOf("=")
    if (separator < 1) throw new ConfigurationError(`${name} must contain key=value pairs`)
    const key = decodeHeaderPart(entry.slice(0, separator).trim(), name).toLowerCase()
    const headerValue = decodeHeaderPart(entry.slice(separator + 1).trim(), name)
    rejectSecret(key, name, secrets)
    if (!HEADER_NAME_PATTERN.test(key)) {
      throw new ConfigurationError(`${name} contains an invalid HTTP header name`)
    }
    if (
      !headerValue
      || headerValue.length > CONNECTOR_LIMITS.observabilityHeaderValueCharacters
      || /[\r\n]/.test(headerValue)
    ) {
      throw new ConfigurationError(`${name} contains an invalid HTTP header value`)
    }
    rejectSecret(headerValue, name, secrets)
    if (Object.hasOwn(headers, key)) {
      throw new ConfigurationError(`${name} must not contain duplicate header names`)
    }
    headers[key] = headerValue
  }
  return Object.freeze(headers)
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "[::1]"
    || /^127(?:\.[0-9]{1,3}){3}$/.test(hostname)
}

function parseEndpoint(value: string, name: string, secrets: readonly string[]): URL {
  if (value.length > CONNECTOR_LIMITS.observabilityOtlpEndpointCharacters) {
    throw new ConfigurationError(
      `${name} must not exceed ${CONNECTOR_LIMITS.observabilityOtlpEndpointCharacters} characters`,
    )
  }
  rejectEncodedSecret(value, name, secrets)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigurationError(`${name} must be an absolute HTTP or HTTPS URL`)
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new ConfigurationError(
      `${name} must be a credential-free HTTP or HTTPS URL without query or fragment`,
    )
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname.toLowerCase())) {
    throw new ConfigurationError(`${name} requires HTTPS except for a loopback collector`)
  }
  return url
}

function signalUrl(
  baseValue: string,
  signalValue: string | undefined,
  signalName: string,
  signalPath: "v1/metrics" | "v1/traces",
  secrets: readonly string[],
): string {
  if (signalValue?.trim()) {
    return parseEndpoint(signalValue.trim(), signalName, secrets).href
  }
  const base = parseEndpoint(baseValue, ENVIRONMENT_NAMES.otelEndpoint, secrets).href
  return `${base.endsWith("/") ? base : `${base}/`}${signalPath}`
}

function parseTimeout(
  signalValue: string | undefined,
  generalValue: string | undefined,
  signalName: string,
): number {
  const value = signalValue?.trim() || generalValue?.trim()
  if (!value) return OBSERVABILITY_DEFAULTS.exportTimeoutMs
  if (!/^[0-9]+$/.test(value)) {
    throw new ConfigurationError(
      `${signalName} must be an integer between 1 and ${CONNECTOR_LIMITS.observabilityTimeoutMs}`,
    )
  }
  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed)
    || parsed < 1
    || parsed > CONNECTOR_LIMITS.observabilityTimeoutMs
  ) {
    throw new ConfigurationError(
      `${signalName} must be an integer between 1 and ${CONNECTOR_LIMITS.observabilityTimeoutMs}`,
    )
  }
  return parsed
}

function parseCompression(
  signalValue: string | undefined,
  generalValue: string | undefined,
  signalName: string,
): OtlpCompression {
  const value = signalValue?.trim() || generalValue?.trim() || "none"
  if (value === "gzip" || value === "none") return value
  throw new ConfigurationError(`${signalName} must be gzip or none`)
}

function assertProtocol(
  signalValue: string | undefined,
  generalValue: string | undefined,
  signalName: string,
): void {
  const value = signalValue?.trim() || generalValue?.trim() || "http/protobuf"
  if (value !== "http/protobuf") {
    throw new ConfigurationError(`${signalName} supports only http/protobuf`)
  }
}

function parseServiceName(value: string | undefined, secrets: readonly string[]): string {
  const normalized = value?.trim() || OBSERVABILITY_DEFAULTS.serviceName
  rejectSecret(normalized, ENVIRONMENT_NAMES.otelServiceName, secrets)
  if (
    normalized.length > CONNECTOR_LIMITS.observabilityServiceNameCharacters
    || !SERVICE_NAME_PATTERN.test(normalized)
    || SNOWFLAKE_LIKE_PATTERN.test(normalized)
  ) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.otelServiceName} must contain 1-${CONNECTOR_LIMITS.observabilityServiceNameCharacters} safe characters without snowflake-like identifiers`,
    )
  }
  return normalized
}

function parseSampler(environment: NodeJS.ProcessEnv): {
  ratio: number
  sampler: OtlpTraceSampler
} {
  const rawSampler = environment[ENVIRONMENT_NAMES.otelTracesSampler]?.trim()
    || "parentbased_always_on"
  if (!TRACE_SAMPLERS.has(rawSampler)) {
    throw new ConfigurationError(`${ENVIRONMENT_NAMES.otelTracesSampler} is not supported`)
  }
  const rawRatio = environment[ENVIRONMENT_NAMES.otelTracesSamplerArg]?.trim()
  const ratio = rawRatio ? Number(rawRatio) : 1
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new ConfigurationError(`${ENVIRONMENT_NAMES.otelTracesSamplerArg} must be between 0 and 1`)
  }
  return { ratio, sampler: rawSampler as OtlpTraceSampler }
}

function mergeHeaders(
  general: Readonly<Record<string, string>>,
  signal: Readonly<Record<string, string>>,
  name: string,
): Readonly<Record<string, string>> {
  const result = { ...general, ...signal }
  if (Object.keys(result).length > CONNECTOR_LIMITS.observabilityHeaders) {
    throw new ConfigurationError(
      `${name} and ${ENVIRONMENT_NAMES.otelHeaders} must contain at most ${CONNECTOR_LIMITS.observabilityHeaders} combined headers`,
    )
  }
  return Object.freeze(result)
}

export function loadObservabilityConfig(
  environment: NodeJS.ProcessEnv,
  secrets: readonly string[],
): ObservabilityConfig {
  const exportEnabled = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowObservabilityExport],
    ENVIRONMENT_NAMES.allowObservabilityExport,
  )
  const jsonLogsEnabled = parseBoolean(
    environment[ENVIRONMENT_NAMES.observabilityLogs],
    ENVIRONMENT_NAMES.observabilityLogs,
  )
  if (!exportEnabled) {
    return { export: undefined, exportEnabled, jsonLogsEnabled }
  }
  for (const name of UNSUPPORTED_OTLP_ENVIRONMENT_NAMES) {
    if (environment[name]?.trim()) {
      throw new ConfigurationError(`${name} is not supported`)
    }
  }

  assertProtocol(
    environment[ENVIRONMENT_NAMES.otelTraceProtocol],
    environment[ENVIRONMENT_NAMES.otelProtocol],
    ENVIRONMENT_NAMES.otelTraceProtocol,
  )
  assertProtocol(
    environment[ENVIRONMENT_NAMES.otelMetricsProtocol],
    environment[ENVIRONMENT_NAMES.otelProtocol],
    ENVIRONMENT_NAMES.otelMetricsProtocol,
  )
  const generalHeaders = parseOtlpHeaders(
    environment[ENVIRONMENT_NAMES.otelHeaders],
    ENVIRONMENT_NAMES.otelHeaders,
    secrets,
  )
  const traceHeaders = parseOtlpHeaders(
    environment[ENVIRONMENT_NAMES.otelTraceHeaders],
    ENVIRONMENT_NAMES.otelTraceHeaders,
    secrets,
  )
  const metricHeaders = parseOtlpHeaders(
    environment[ENVIRONMENT_NAMES.otelMetricsHeaders],
    ENVIRONMENT_NAMES.otelMetricsHeaders,
    secrets,
  )
  const baseValue = environment[ENVIRONMENT_NAMES.otelEndpoint]?.trim()
    || OBSERVABILITY_DEFAULTS.otlpBaseUrl
  const sampler = parseSampler(environment)
  const traces = {
    compression: parseCompression(
      environment[ENVIRONMENT_NAMES.otelTraceCompression],
      environment[ENVIRONMENT_NAMES.otelCompression],
      ENVIRONMENT_NAMES.otelTraceCompression,
    ),
    headers: mergeHeaders(generalHeaders, traceHeaders, ENVIRONMENT_NAMES.otelTraceHeaders),
    timeoutMs: parseTimeout(
      environment[ENVIRONMENT_NAMES.otelTraceTimeout],
      environment[ENVIRONMENT_NAMES.otelTimeout],
      ENVIRONMENT_NAMES.otelTraceTimeout,
    ),
    url: signalUrl(
      baseValue,
      environment[ENVIRONMENT_NAMES.otelTraceEndpoint],
      ENVIRONMENT_NAMES.otelTraceEndpoint,
      "v1/traces",
      secrets,
    ),
  } satisfies OtlpSignalConfig
  const metrics = {
    compression: parseCompression(
      environment[ENVIRONMENT_NAMES.otelMetricsCompression],
      environment[ENVIRONMENT_NAMES.otelCompression],
      ENVIRONMENT_NAMES.otelMetricsCompression,
    ),
    headers: mergeHeaders(generalHeaders, metricHeaders, ENVIRONMENT_NAMES.otelMetricsHeaders),
    timeoutMs: parseTimeout(
      environment[ENVIRONMENT_NAMES.otelMetricsTimeout],
      environment[ENVIRONMENT_NAMES.otelTimeout],
      ENVIRONMENT_NAMES.otelMetricsTimeout,
    ),
    url: signalUrl(
      baseValue,
      environment[ENVIRONMENT_NAMES.otelMetricsEndpoint],
      ENVIRONMENT_NAMES.otelMetricsEndpoint,
      "v1/metrics",
      secrets,
    ),
  } satisfies OtlpSignalConfig

  return {
    export: {
      endpointConfigured: Boolean(
        environment[ENVIRONMENT_NAMES.otelEndpoint]?.trim()
        || environment[ENVIRONMENT_NAMES.otelTraceEndpoint]?.trim()
        || environment[ENVIRONMENT_NAMES.otelMetricsEndpoint]?.trim()
      ),
      headersConfigured: Object.keys(traces.headers).length > 0
        || Object.keys(metrics.headers).length > 0,
      metrics,
      serviceName: parseServiceName(
        environment[ENVIRONMENT_NAMES.otelServiceName],
        secrets,
      ),
      traceSampleRatio: sampler.ratio,
      traceSampler: sampler.sampler,
      traces,
    },
    exportEnabled,
    jsonLogsEnabled,
  }
}
