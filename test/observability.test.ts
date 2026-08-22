import assert from "node:assert/strict"
import test from "node:test"

import {
  AnnouncementCrosspostExecutionError,
  AnnouncementCrosspostOperationConflictError,
  AnnouncementCrosspostPlanChangedError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
  ChannelCreationPlanChangedError,
  ConfigurationError,
  DiscordApiError,
  OperationStoreError,
  PolicyError,
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationStateError,
} from "../src/errors.js"
import {
  loadObservabilityConfig,
  parseOtlpHeaders,
  type ObservabilityConfig,
} from "../src/observability-config.js"
import {
  classifyOperationalError,
  OperationalTelemetry,
} from "../src/observability.js"

const TOKEN = "test-discord-token"

function disabledConfig(jsonLogsEnabled = false): ObservabilityConfig {
  return {
    export: undefined,
    exportEnabled: false,
    jsonLogsEnabled,
  }
}

test("observability export is double-gated and disabled configuration ignores OTEL inputs", () => {
  const config = loadObservabilityConfig({
    DISCORD_MCP_OBSERVABILITY_LOGS: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "not a URL",
    OTEL_EXPORTER_OTLP_HEADERS: `authorization=${TOKEN}`,
    OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
  }, [TOKEN])

  assert.deepEqual(config, {
    export: undefined,
    exportEnabled: false,
    jsonLogsEnabled: true,
  })
})

test("observability export applies secure OTLP HTTP defaults and signal overrides", () => {
  const config = loadObservabilityConfig({
    DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test/otel",
    OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20example,x-team=platform",
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://metrics.example.test/ingest",
    OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-team=metrics",
    OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: "2500",
    OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: "none",
    OTEL_SERVICE_NAME: "discord-mcp.production",
    OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
    OTEL_TRACES_SAMPLER_ARG: "0.25",
  }, [TOKEN])

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
      () => loadObservabilityConfig({
        DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      }, [TOKEN]),
      ConfigurationError,
    )
  }

  const loopback = loadObservabilityConfig({
    DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
  }, [TOKEN])
  assert.equal(loopback.export?.traces.url, "http://127.0.0.1:4318/v1/traces")
})

test("observability configuration rejects unsafe protocols, headers, limits, and samplers", () => {
  const invalid: NodeJS.ProcessEnv[] = [
    { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
    { OTEL_EXPORTER_OTLP_COMPRESSION: "brotli" },
    { OTEL_EXPORTER_OTLP_TIMEOUT: "0" },
    { OTEL_EXPORTER_OTLP_TIMEOUT: "60001" },
    { OTEL_EXPORTER_OTLP_HEADERS: "x=value,x=again" },
    { OTEL_EXPORTER_OTLP_HEADERS: "x=%0D%0Aunsafe" },
    { OTEL_EXPORTER_OTLP_HEADERS: `authorization=${encodeURIComponent(TOKEN)}` },
    { OTEL_EXPORTER_OTLP_CLIENT_KEY: "/private/collector.key" },
    { OTEL_SERVICE_NAME: "unsafe service name" },
    { OTEL_SERVICE_NAME: "discord-mcp.999999999999999999" },
    { OTEL_TRACES_SAMPLER: "remote_parent_sampled" },
    { OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "1.1" },
  ]
  for (const environment of invalid) {
    assert.throws(
      () => loadObservabilityConfig({
        DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
        ...environment,
      }, [TOKEN]),
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
  const config = loadObservabilityConfig({
    DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test/private",
    OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20private",
  }, [TOKEN])
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
  const config = loadObservabilityConfig({
    DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    DISCORD_MCP_OBSERVABILITY_LOGS: "true",
  }, [TOKEN])
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
  const config = loadObservabilityConfig({
    DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
  }, [TOKEN])
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
