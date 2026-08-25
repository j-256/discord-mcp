import { metrics, trace } from "@opentelemetry/api"
import { MeterProvider } from "@opentelemetry/sdk-metrics"
import { TracerProvider } from "@opentelemetry/sdk-trace"

import { loadObservabilityDocumentConfig } from "../../src/observability-config.js"
import { OperationalTelemetry } from "../../src/observability.js"

const preloadedTracerProvider = new TracerProvider()
trace.setGlobalTracerProvider(preloadedTracerProvider)
const preloadedMeterProvider = new MeterProvider()
metrics.setGlobalMeterProvider(preloadedMeterProvider)

const privateValue = process.env.TEST_PRIVATE_VALUE || "private-value"
const privateToken = process.env.TEST_PRIVATE_TOKEN || "private-token"
const telemetry = new OperationalTelemetry({
  config: loadObservabilityDocumentConfig({
    ...(process.env.TEST_OTLP_ENDPOINT
      ? { endpoint: process.env.TEST_OTLP_ENDPOINT }
      : {}),
    exportEnabled: true,
    headers: {
      provider: "environment",
      variable: "TEST_OTLP_HEADERS",
    },
    ...(process.env.TEST_OTLP_SERVICE_NAME
      ? { serviceName: process.env.TEST_OTLP_SERVICE_NAME }
      : {}),
  }, process.env, [privateToken]),
})

try {
  telemetry.start()
  const tool = telemetry.startTool("get_message")
  await tool.run(async () => {
    const rest = telemetry.startDiscordRequest("get_message")
    await rest.run(async () => {
      rest.response({ sharedRateLimit: false, statusCode: 403 })
    })
    rest.end({
      errorCategory: "discord-client-error",
      outcome: "error",
      statusCode: 403,
    })
  })
  tool.end({ outcome: "ok" })
  telemetry.startTool(privateValue).end({
    errorCategory: "unknown",
    outcome: "error",
  })
  await telemetry.stop()
  await Promise.all([
    preloadedTracerProvider.shutdown(),
    preloadedMeterProvider.shutdown(),
  ])
  process.stdout.write(JSON.stringify(telemetry.getObservabilityStatus()))
} catch {
  process.stderr.write("OTLP fixture failed\n")
  process.exitCode = 1
}
