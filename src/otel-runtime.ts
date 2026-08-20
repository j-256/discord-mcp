import {
  type Attributes,
  type ContextManager,
  type Meter,
  type Tracer,
} from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics"
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  type Sampler,
  type SpanExporter,
  TracerProvider,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace"

import type { ObservabilityExportConfig, OtlpTraceSampler } from "./observability-config.js"
import {
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
  OBSERVABILITY_DEFAULTS,
} from "./constants.js"

export type OtlpSignal = "metrics" | "traces"
export type OtlpRuntimeState = "failed" | "running" | "stopped"

export interface OtlpHealthSink {
  recordExport(signal: OtlpSignal, success: boolean): void
  transitionExporter(state: OtlpRuntimeState): void
}

export interface OtlpRuntimeHandle {
  contextManager?: ContextManager
  forceFlush(): Promise<void>
  meter?: Meter
  shutdown(): Promise<void>
  tracer?: Tracer
}

function compression(value: "gzip" | "none"): CompressionAlgorithm {
  return value === "gzip" ? CompressionAlgorithm.GZIP : CompressionAlgorithm.NONE
}

function sampler(kind: OtlpTraceSampler, ratio: number): Sampler {
  const ratioSampler = () => new TraceIdRatioBasedSampler(ratio)
  switch (kind) {
    case "always_off":
      return new AlwaysOffSampler()
    case "always_on":
      return new AlwaysOnSampler()
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() })
    case "parentbased_traceidratio":
      return new ParentBasedSampler({ root: ratioSampler() })
    case "traceidratio":
      return ratioSampler()
    case "parentbased_always_on":
      return new ParentBasedSampler({ root: new AlwaysOnSampler() })
  }
}

function trackTraceExporter(
  delegate: OTLPTraceExporter,
  sink: OtlpHealthSink,
): SpanExporter {
  return {
    export(spans, callback) {
      delegate.export(spans, (result) => {
        sink.recordExport("traces", result.code === 0)
        callback(result)
      })
    },
    forceFlush: () => delegate.forceFlush(),
    shutdown: () => delegate.shutdown(),
  }
}

function trackMetricExporter(
  delegate: OTLPMetricExporter,
  sink: OtlpHealthSink,
): PushMetricExporter {
  return {
    export(resourceMetrics, callback) {
      delegate.export(resourceMetrics, (result) => {
        sink.recordExport("metrics", result.code === 0)
        callback(result)
      })
    },
    forceFlush: () => delegate.forceFlush(),
    selectAggregation: delegate.selectAggregation.bind(delegate),
    selectAggregationTemporality: delegate.selectAggregationTemporality.bind(delegate),
    shutdown: () => delegate.shutdown(),
  }
}

export function startOtlpRuntime(
  config: ObservabilityExportConfig,
  sink: OtlpHealthSink,
): OtlpRuntimeHandle {
  const resourceAttributes: Attributes = {
    "mcp.transport": "stdio",
    "service.name": config.serviceName,
    "service.version": CONNECTOR_VERSION,
  }
  const resource = resourceFromAttributes(resourceAttributes)
  const traceExporter = trackTraceExporter(new OTLPTraceExporter({
    compression: compression(config.traces.compression),
    headers: { ...config.traces.headers },
    keepAlive: true,
    timeoutMillis: config.traces.timeoutMs,
    url: config.traces.url,
  }), sink)
  const metricExporter = trackMetricExporter(new OTLPMetricExporter({
    compression: compression(config.metrics.compression),
    headers: { ...config.metrics.headers },
    keepAlive: true,
    temporalityPreference: AggregationTemporality.CUMULATIVE,
    timeoutMillis: config.metrics.timeoutMs,
    url: config.metrics.url,
  }), sink)
  const tracerProvider = new TracerProvider({
    resource,
    sampler: sampler(config.traceSampler, config.traceSampleRatio),
    spanLimits: {
      attributeCountLimit: 16,
      attributePerEventCountLimit: 0,
      attributePerLinkCountLimit: 0,
      attributeValueLengthLimit: 128,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
    spanProcessors: [new BatchSpanProcessor({
      exporter: traceExporter,
      exportTimeoutMillis: config.traces.timeoutMs,
      maxExportBatchSize: 64,
      maxQueueSize: 512,
      scheduledDelayMillis: 5_000,
    })],
  })
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: OBSERVABILITY_DEFAULTS.exportIntervalMs,
    exportTimeoutMillis: config.metrics.timeoutMs,
  })
  const meterProvider = new MeterProvider({
    readers: [metricReader],
    resource,
  })
  const localContextManager = new AsyncLocalStorageContextManager().enable()
  sink.transitionExporter("running")

  let shutdownPromise: Promise<void> | undefined
  return {
    contextManager: localContextManager,
    async forceFlush() {
      await Promise.all([
        tracerProvider.forceFlush(),
        meterProvider.forceFlush(),
      ])
    },
    meter: meterProvider.getMeter(OTEL_INSTRUMENTATION_NAME, CONNECTOR_VERSION),
    shutdown() {
      shutdownPromise ??= (async () => {
        const results = await Promise.allSettled([
          tracerProvider.shutdown(),
          meterProvider.shutdown(),
        ])
        const failed = results.some((result) => result.status === "rejected")
        let contextFailed = false
        try {
          localContextManager.disable()
        } catch {
          contextFailed = true
        }
        if (failed || contextFailed) {
          throw new Error("OpenTelemetry provider shutdown failed")
        }
      })()
      return shutdownPromise
    },
    tracer: tracerProvider.getTracer(OTEL_INSTRUMENTATION_NAME, CONNECTOR_VERSION),
  }
}

export const OTEL_INSTRUMENTATION_NAME = CONNECTOR_NAME
