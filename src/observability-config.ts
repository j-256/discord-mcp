import {
  CONNECTOR_LIMITS,
  OBSERVABILITY_DEFAULTS,
} from "./constants.js"
import type {
  ConnectorConfigDocumentObservability,
  EnvironmentSecretReference,
} from "./config-document.js"
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
  baseName: string,
  signalValue: string | undefined,
  signalName: string,
  signalPath: "v1/metrics" | "v1/traces",
  secrets: readonly string[],
): string {
  if (signalValue?.trim()) {
    return parseEndpoint(signalValue.trim(), signalName, secrets).href
  }
  const base = parseEndpoint(baseValue, baseName, secrets).href
  return `${base.endsWith("/") ? base : `${base}/`}${signalPath}`
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

function parseServiceName(
  value: string | undefined,
  name: string,
  secrets: readonly string[],
): string {
  const normalized = value?.trim() || OBSERVABILITY_DEFAULTS.serviceName
  rejectSecret(normalized, name, secrets)
  if (
    normalized.length > CONNECTOR_LIMITS.observabilityServiceNameCharacters
    || !SERVICE_NAME_PATTERN.test(normalized)
    || SNOWFLAKE_LIKE_PATTERN.test(normalized)
  ) {
    throw new ConfigurationError(
      `${name} must contain 1-${CONNECTOR_LIMITS.observabilityServiceNameCharacters} `
      + "safe characters without snowflake-like identifiers",
    )
  }
  return normalized
}

function mergeHeaders(
  general: Readonly<Record<string, string>>,
  signal: Readonly<Record<string, string>>,
  name: string,
  generalName: string,
): Readonly<Record<string, string>> {
  const result = { ...general, ...signal }
  if (Object.keys(result).length > CONNECTOR_LIMITS.observabilityHeaders) {
    throw new ConfigurationError(
      `${name} and ${generalName} must contain at most ${CONNECTOR_LIMITS.observabilityHeaders} combined headers`,
    )
  }
  return Object.freeze(result)
}

function resolveHeaderReference(
  reference: EnvironmentSecretReference | undefined,
  environment: NodeJS.ProcessEnv,
  path: string,
): string | undefined {
  if (!reference) return undefined
  const value = environment[reference.variable]?.trim()
  if (!value) {
    throw new ConfigurationError(`${path} requires ${reference.variable}`)
  }
  return value
}

function documentTimeout(
  signalValue: number | undefined,
  generalValue: number | undefined,
  path: string,
): number {
  const value = signalValue ?? generalValue ?? OBSERVABILITY_DEFAULTS.exportTimeoutMs
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > CONNECTOR_LIMITS.observabilityTimeoutMs
  ) {
    throw new ConfigurationError(
      `${path} must be an integer between 1 and ${CONNECTOR_LIMITS.observabilityTimeoutMs}`,
    )
  }
  return value
}

function documentSampler(
  observability: ConnectorConfigDocumentObservability,
): { ratio: number; sampler: OtlpTraceSampler } {
  const sampler = observability.traceSampler?.trim() || "parentbased_always_on"
  if (!TRACE_SAMPLERS.has(sampler)) {
    throw new ConfigurationError("$.observability.traceSampler is not supported")
  }
  const ratio = observability.traceSampleRatio ?? 1
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new ConfigurationError("$.observability.traceSampleRatio must be between 0 and 1")
  }
  return { ratio, sampler: sampler as OtlpTraceSampler }
}

export function loadObservabilityDocumentConfig(
  observability: ConnectorConfigDocumentObservability,
  environment: NodeJS.ProcessEnv,
  secrets: readonly string[],
): ObservabilityConfig {
  const exportEnabled = observability.exportEnabled ?? false
  const jsonLogsEnabled = observability.jsonLogsEnabled ?? false
  if (!exportEnabled) {
    return { export: undefined, exportEnabled, jsonLogsEnabled }
  }

  const generalHeaders = parseOtlpHeaders(
    resolveHeaderReference(
      observability.headers,
      environment,
      "$.observability.headers",
    ),
    "$.observability.headers",
    secrets,
  )
  const traceHeaders = parseOtlpHeaders(
    resolveHeaderReference(
      observability.traces?.headers,
      environment,
      "$.observability.traces.headers",
    ),
    "$.observability.traces.headers",
    secrets,
  )
  const metricHeaders = parseOtlpHeaders(
    resolveHeaderReference(
      observability.metrics?.headers,
      environment,
      "$.observability.metrics.headers",
    ),
    "$.observability.metrics.headers",
    secrets,
  )
  const baseValue = observability.endpoint?.trim()
    || OBSERVABILITY_DEFAULTS.otlpBaseUrl
  assertProtocol(
    observability.traces?.protocol,
    observability.protocol,
    "$.observability.traces.protocol",
  )
  assertProtocol(
    observability.metrics?.protocol,
    observability.protocol,
    "$.observability.metrics.protocol",
  )
  const sampler = documentSampler(observability)
  const traces = {
    compression: parseCompression(
      observability.traces?.compression,
      observability.compression,
      "$.observability.traces.compression",
    ),
    headers: mergeHeaders(
      generalHeaders,
      traceHeaders,
      "$.observability.traces.headers",
      "$.observability.headers",
    ),
    timeoutMs: documentTimeout(
      observability.traces?.timeoutMs,
      observability.timeoutMs,
      "$.observability.traces.timeoutMs",
    ),
    url: signalUrl(
      baseValue,
      "$.observability.endpoint",
      observability.traces?.endpoint,
      "$.observability.traces.endpoint",
      "v1/traces",
      secrets,
    ),
  } satisfies OtlpSignalConfig
  const metrics = {
    compression: parseCompression(
      observability.metrics?.compression,
      observability.compression,
      "$.observability.metrics.compression",
    ),
    headers: mergeHeaders(
      generalHeaders,
      metricHeaders,
      "$.observability.metrics.headers",
      "$.observability.headers",
    ),
    timeoutMs: documentTimeout(
      observability.metrics?.timeoutMs,
      observability.timeoutMs,
      "$.observability.metrics.timeoutMs",
    ),
    url: signalUrl(
      baseValue,
      "$.observability.endpoint",
      observability.metrics?.endpoint,
      "$.observability.metrics.endpoint",
      "v1/metrics",
      secrets,
    ),
  } satisfies OtlpSignalConfig

  return {
    export: {
      endpointConfigured: Boolean(
        observability.endpoint?.trim()
        || observability.traces?.endpoint?.trim()
        || observability.metrics?.endpoint?.trim()
      ),
      headersConfigured: Object.keys(traces.headers).length > 0
        || Object.keys(metrics.headers).length > 0,
      metrics,
      serviceName: parseServiceName(
        observability.serviceName,
        "$.observability.serviceName",
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
