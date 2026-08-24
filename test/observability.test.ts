import assert from "node:assert/strict"
import test from "node:test"

import {
  AnnouncementCrosspostExecutionError,
  AnnouncementCrosspostOperationConflictError,
  AnnouncementCrosspostPlanChangedError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
  ChannelCreationPlanChangedError,
  ComponentMessageEvidenceError,
  ComponentMessageExecutionError,
  ComponentMessageOperationConflictError,
  ComponentMessagePlanChangedError,
  ConfigurationError,
  DiscordApiError,
  OperationStoreError,
  PolicyError,
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationStateError,
} from "../src/errors.js"
import {
  loadObservabilityDocumentConfig,
  parseOtlpHeaders,
  type ObservabilityConfig,
} from "../src/observability-config.js"
import type { ConnectorConfigDocumentObservability } from "../src/config-document.js"
import {
  classifyOperationalError,
  OperationalTelemetry,
} from "../src/observability.js"

const TOKEN = "test-discord-token"
const GENERAL_HEADERS = "DISCORD_TEST_OTLP_HEADERS"
const METRIC_HEADERS = "DISCORD_TEST_OTLP_METRIC_HEADERS"

function observabilityConfig(
  observability: ConnectorConfigDocumentObservability,
  environment: NodeJS.ProcessEnv = {},
): ObservabilityConfig {
  return loadObservabilityDocumentConfig(observability, environment, [TOKEN])
}

function unsafeObservability(value: unknown): ConnectorConfigDocumentObservability {
  return value as ConnectorConfigDocumentObservability
}

function disabledConfig(jsonLogsEnabled = false): ObservabilityConfig {
  return {
    export: undefined,
    exportEnabled: false,
    jsonLogsEnabled,
  }
}

test("observability export is double-gated and disabled configuration ignores export settings", () => {
  const config = observabilityConfig({
    endpoint: "not a URL",
    headers: { provider: "environment", variable: GENERAL_HEADERS },
    jsonLogsEnabled: true,
    protocol: "grpc",
  }, {
    [GENERAL_HEADERS]: `authorization=${TOKEN}`,
  })

  assert.deepEqual(config, {
    export: undefined,
    exportEnabled: false,
    jsonLogsEnabled: true,
  })
})

test("observability export applies secure OTLP HTTP defaults and signal overrides", () => {
  const config = observabilityConfig({
    compression: "gzip",
    endpoint: "https://collector.example.test/otel",
    exportEnabled: true,
    headers: { provider: "environment", variable: GENERAL_HEADERS },
    metrics: {
      endpoint: "https://metrics.example.test/ingest",
      headers: { provider: "environment", variable: METRIC_HEADERS },
      timeoutMs: 2_500,
    },
    serviceName: "discord-mcp.production",
    traceSampleRatio: 0.25,
    traceSampler: "parentbased_traceidratio",
    traces: { compression: "none" },
  }, {
    [GENERAL_HEADERS]: "authorization=Bearer%20example,x-team=platform",
    [METRIC_HEADERS]: "x-team=metrics",
  })

  assert.equal(config.exportEnabled, true)
  assert.equal(config.export?.traces.url, "https://collector.example.test/otel/v1/traces")
  assert.equal(config.export?.metrics.url, "https://metrics.example.test/ingest")
  assert.deepEqual(config.export?.traces.headers, {
    authorization: "Bearer example",
    "x-team": "platform",
  })
  assert.deepEqual(config.export?.metrics.headers, {
    authorization: "Bearer example",
    "x-team": "metrics",
  })
  assert.equal(config.export?.traces.compression, "none")
  assert.equal(config.export?.metrics.compression, "gzip")
  assert.equal(config.export?.traces.timeoutMs, 10_000)
  assert.equal(config.export?.metrics.timeoutMs, 2_500)
  assert.equal(config.export?.serviceName, "discord-mcp.production")
  assert.equal(config.export?.traceSampler, "parentbased_traceidratio")
  assert.equal(config.export?.traceSampleRatio, 0.25)
  assert.equal(config.export?.endpointConfigured, true)
  assert.equal(config.export?.headersConfigured, true)
})

test("observability export permits only credential-free HTTPS or loopback HTTP collectors", () => {
  const invalidEndpoints = [
    "http://collector.example.test:4318",
    "https://user:password@collector.example.test",
    "https://collector.example.test/path?token=value",
    "https://collector.example.test/path#fragment",
    `http://localhost:4318/${encodeURIComponent(TOKEN)}`,
    `http://localhost:4318/${encodeURIComponent(encodeURIComponent(TOKEN))}`,
  ]
  for (const endpoint of invalidEndpoints) {
    assert.throws(
      () => observabilityConfig({
        endpoint,
        exportEnabled: true,
      }),
      ConfigurationError,
    )
  }

  const loopback = observabilityConfig({
    endpoint: "http://127.0.0.1:4318",
    exportEnabled: true,
  })
  assert.equal(loopback.export?.traces.url, "http://127.0.0.1:4318/v1/traces")
})

test("observability configuration rejects unsafe protocols, headers, limits, and samplers", () => {
  const invalid: Array<{
    environment?: NodeJS.ProcessEnv
    observability: ConnectorConfigDocumentObservability
  }> = [
    { observability: unsafeObservability({ protocol: "grpc" }) },
    { observability: unsafeObservability({ compression: "brotli" }) },
    { observability: { timeoutMs: 0 } },
    { observability: { timeoutMs: 60_001 } },
    {
      environment: { [GENERAL_HEADERS]: "x=value,x=again" },
      observability: {
        headers: { provider: "environment", variable: GENERAL_HEADERS },
      },
    },
    {
      environment: { [GENERAL_HEADERS]: "x=%0D%0Aunsafe" },
      observability: {
        headers: { provider: "environment", variable: GENERAL_HEADERS },
      },
    },
    {
      environment: {
        [GENERAL_HEADERS]: `authorization=${encodeURIComponent(TOKEN)}`,
      },
      observability: {
        headers: { provider: "environment", variable: GENERAL_HEADERS },
      },
    },
    { observability: { serviceName: "unsafe service name" } },
    { observability: { serviceName: "discord-mcp.999999999999999999" } },
    {
      observability: unsafeObservability({
        traceSampler: "remote_parent_sampled",
      }),
    },
    {
      observability: {
        traceSampleRatio: 1.1,
        traceSampler: "traceidratio",
      },
    },
  ]
  for (const candidate of invalid) {
    assert.throws(
      () => observabilityConfig({
        ...candidate.observability,
        exportEnabled: true,
      }, candidate.environment),
      ConfigurationError,
    )
  }
  assert.throws(
    () => parseOtlpHeaders(`${encodeURIComponent(TOKEN)}=value`, "headers", [TOKEN]),
    ConfigurationError,
  )
})

test("local operational telemetry keeps bounded aggregate data and fixed privacy claims", async () => {
  let wallClock = Date.parse("2026-08-20T00:00:00.000Z")
  let monotonicClock = 0
  const logLines: string[] = []
  const telemetry = new OperationalTelemetry({
    clock: () => wallClock,
    config: disabledConfig(true),
    monotonicClock: () => monotonicClock,
    stderr: {
      write(value) {
        logLines.push(String(value))
        return true
      },
    },
  })
  telemetry.start()

  const tool = telemetry.startTool("get_message")
  monotonicClock = 12.3456
  tool.end({ outcome: "ok" })
  tool.end({ outcome: "error", errorCategory: "unknown" })

  const rest = telemetry.startDiscordRequest("get_message")
  rest.retry()
  monotonicClock = 37.3456
  wallClock += 1_000
  rest.end({
    errorCategory: "discord-rate-limited",
    outcome: "error",
    statusCode: 429,
  })

  const secret = "999999999999999999/private-route/message body"
  monotonicClock = 40
  telemetry.startTool(secret).end({ outcome: "tool-error" })
  monotonicClock = 44
  telemetry.startDiscordRequest(secret).end({ outcome: "ok" })

  const snapshot = telemetry.getObservabilityStatus()
  assert.equal(snapshot.exporter.state, "disabled")
  assert.deepEqual(snapshot.privacy, {
    argumentsStored: false,
    contentStored: false,
    discordIdentifiersStored: false,
    errorDetailsStored: false,
    persistent: false,
    rawRoutesStored: false,
  })
  assert.equal(snapshot.operations.totals.calls, 4)
  assert.equal(snapshot.operations.totals.errors, 2)
  assert.equal(snapshot.operations.totals.retries, 1)
  assert.deepEqual(snapshot.operations.totals.outcomes, {
    error: 1,
    ok: 2,
    "tool-error": 1,
  })
  assert.equal(snapshot.operations.mcpTools.find(({ operation }) => operation === "get_message")?.calls, 1)
  assert.equal(snapshot.operations.mcpTools.find(({ operation }) => operation === "unknown")?.calls, 1)
  assert.equal(snapshot.operations.discordRest.find(({ operation }) => operation === "get_message")?.duration.sumMs, 25)
  assert.equal(snapshot.operations.discordRest.find(({ operation }) => operation === "get_message")?.duration.buckets.find(({ leMs }) => leMs === 25)?.count, 1)
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(secret))
  assert.doesNotMatch(logLines.join(""), new RegExp(secret))
  assert.equal(logLines.length, 4)
  await telemetry.stop()
})

test("operational telemetry isolates exporter lifecycle and exposes only exporter health", async () => {
  const config = observabilityConfig({
    endpoint: "https://collector.example.test/private",
    exportEnabled: true,
    headers: { provider: "environment", variable: GENERAL_HEADERS },
  }, {
    [GENERAL_HEADERS]: "authorization=Bearer%20private",
  })
  let flushes = 0
  let shutdowns = 0
  const telemetry = new OperationalTelemetry({
    config,
    otlpFactory(_exportConfig, sink) {
      sink.transitionExporter("running")
      sink.recordExport("traces", true)
      sink.recordExport("metrics", false)
      return {
        async forceFlush() {
          flushes += 1
        },
        async shutdown() {
          shutdowns += 1
          sink.transitionExporter("stopped")
        },
      }
    },
  })

  assert.equal(telemetry.getObservabilityStatus().exporter.state, "not-started")
  telemetry.start()
  const running = telemetry.getObservabilityStatus()
  assert.deepEqual(running.exporter, {
    attempts: 2,
    enabled: true,
    endpointConfigured: true,
    failures: 1,
    headersConfigured: true,
    lastFailureAt: running.exporter.lastFailureAt,
    lastSuccessAt: running.exporter.lastSuccessAt,
    state: "running",
    successes: 1,
  })
  assert.equal(JSON.stringify(running).includes("collector.example.test"), false)
  assert.equal(JSON.stringify(running).includes("Bearer private"), false)

  await telemetry.stop()
  await telemetry.stop()
  assert.equal(flushes, 1)
  assert.equal(shutdowns, 1)
  assert.equal(telemetry.getObservabilityStatus().exporter.state, "stopped")
})

test("operational telemetry swallows exporter and logging failures", () => {
  const config = observabilityConfig({
    exportEnabled: true,
    jsonLogsEnabled: true,
  })
  const telemetry = new OperationalTelemetry({
    config,
    otlpFactory() {
      throw new Error("collector secret detail")
    },
    stderr: {
      write() {
        throw new Error("stderr failed")
      },
    },
  })

  assert.doesNotThrow(() => telemetry.start())
  const snapshot = telemetry.getObservabilityStatus()
  assert.equal(snapshot.exporter.state, "failed")
  assert.equal(snapshot.logging.failures, 1)
  assert.equal(JSON.stringify(snapshot).includes("collector secret detail"), false)
})

test("operational telemetry still shuts down after a final flush failure", async () => {
  const config = observabilityConfig({ exportEnabled: true })
  let shutdowns = 0
  const telemetry = new OperationalTelemetry({
    config,
    otlpFactory(_exportConfig, sink) {
      sink.transitionExporter("running")
      return {
        async forceFlush() {
          throw new Error("private flush failure")
        },
        async shutdown() {
          shutdowns += 1
        },
      }
    },
  })
  telemetry.start()

  await telemetry.stop()

  assert.equal(shutdowns, 1)
  assert.equal(telemetry.getObservabilityStatus().exporter.state, "failed")
})

test("operational errors collapse to fixed categories", () => {
  assert.equal(classifyOperationalError(new PolicyError("private detail")), "policy-error")
  assert.equal(
    classifyOperationalError(new AnnouncementCrosspostPlanChangedError("expected", "actual")),
    "plan-changed",
  )
  assert.equal(
    classifyOperationalError(new AnnouncementCrosspostOperationConflictError({})),
    "idempotency-conflict",
  )
  assert.equal(
    classifyOperationalError(new AnnouncementCrosspostExecutionError("private detail", {})),
    "execution-error",
  )
  assert.equal(
    classifyOperationalError(new ChannelCreationPlanChangedError("expected", "actual")),
    "plan-changed",
  )
  assert.equal(
    classifyOperationalError(new ChannelCreationOperationConflictError({})),
    "idempotency-conflict",
  )
  assert.equal(
    classifyOperationalError(new ChannelCreationExecutionError("private detail", {})),
    "execution-error",
  )
  assert.equal(
    classifyOperationalError(new ComponentMessagePlanChangedError("expected", "actual")),
    "plan-changed",
  )
  assert.equal(
    classifyOperationalError(new ComponentMessageOperationConflictError({})),
    "idempotency-conflict",
  )
  assert.equal(
    classifyOperationalError(new ComponentMessageEvidenceError("private detail")),
    "identity-error",
  )
  assert.equal(
    classifyOperationalError(new ComponentMessageExecutionError("private detail", {})),
    "execution-error",
  )
  assert.equal(
    classifyOperationalError(new OperationStoreError("private detail")),
    "audit-error",
  )
  assert.equal(
    classifyOperationalError(new WriteCoordinationConflictError("claim_00000000000000000000000000000000")),
    "coordination-conflict",
  )
  assert.equal(
    classifyOperationalError(new WriteCoordinationQuarantinedError("claim_00000000000000000000000000000000")),
    "coordination-quarantined",
  )
  assert.equal(
    classifyOperationalError(new WriteCoordinationStateError("private detail")),
    "coordination-state-error",
  )
  assert.equal(classifyOperationalError(new RangeError("private detail")), "validation-error")
  assert.equal(classifyOperationalError(new DOMException("private detail", "AbortError")), "cancelled")
  assert.equal(classifyOperationalError(new DiscordApiError({
    message: "private detail",
    method: "GET",
    route: "/private/route",
    status: 503,
  })), "discord-server-error")
  assert.equal(classifyOperationalError(new Error("private detail")), "unknown")
})
