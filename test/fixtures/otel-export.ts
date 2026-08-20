import { metrics, trace } from "@opentelemetry/api"
import { MeterProvider } from "@opentelemetry/sdk-metrics"
import { TracerProvider } from "@opentelemetry/sdk-trace"

import { loadObservabilityConfig } from "../../src/observability-config.js"
import { OperationalTelemetry } from "../../src/observability.js"

const preloadedTracerProvider = new TracerProvider()
trace.setGlobalTracerProvider(preloadedTracerProvider)
const preloadedMeterProvider = new MeterProvider()
metrics.setGlobalMeterProvider(preloadedMeterProvider)

const privateValue = process.env.TEST_PRIVATE_VALUE || "private-value"
const privateToken = process.env.TEST_PRIVATE_TOKEN || "private-token"
const telemetry = new OperationalTelemetry({
  config: loadObservabilityConfig(process.env, [privateToken]),
})

try {
  telemetry.start()
  const tool = telemetry.startTool("get_message")
  await tool.run(async () => {
    const rest = telemetry.startDiscordRequest("get_message")
    await rest.run(async () => undefined)
    rest.end({ outcome: "ok", statusCode: 200 })
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
