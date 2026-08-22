import { performance } from "node:perf_hooks"

import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type ContextManager,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api"

import type { ObservabilityConfig } from "./observability-config.js"
import {
  OBSERVABILITY_DEFAULTS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  AdministrationExecutionError,
  AdministrationPlanChangedError,
  AnnouncementCrosspostExecutionError,
  AnnouncementCrosspostOperationConflictError,
  AnnouncementCrosspostPlanChangedError,
  AuditLogError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
  ChannelCreationPlanChangedError,
  ComponentMessageEvidenceError,
  ComponentMessageExecutionError,
  ComponentMessageOperationConflictError,
  ComponentMessagePlanChangedError,
  ConfigurationError,
  DeletionExecutionError,
  DeletionPlanChangedError,
  DiscordApiError,
  InteractionConflictError,
  InteractionExecutionError,
  InteractionIdentityError,
  InteractionRateLimitError,
  OperationStoreError,
  PolicyError,
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationStateError,
} from "./errors.js"
import {
  DISCORD_REST_OPERATIONS,
  MCP_TOOL_RISK_CLASSES,
  type DiscordRestOperation,
  type McpToolName,
  type McpToolRiskClass,
} from "./observability-catalog.js"
import {
  startOtlpRuntime,
  type OtlpHealthSink,
  type OtlpRuntimeHandle,
  type OtlpRuntimeState,
  type OtlpSignal,
} from "./otel-runtime.js"

export type OperationalErrorCategory =
  | "audit-error"
  | "cancelled"
  | "configuration-error"
  | "coordination-conflict"
  | "coordination-quarantined"
  | "coordination-state-error"
  | "discord-client-error"
  | "discord-rate-limited"
  | "discord-server-error"
  | "execution-error"
  | "idempotency-conflict"
  | "identity-error"
  | "local-rate-limited"
  | "network-error"
  | "plan-changed"
  | "policy-error"
  | "timeout"
  | "unknown"
  | "validation-error"

export type OperationalOutcome = "error" | "ok" | "tool-error"
export type OperationalKind = "discord-rest" | "mcp-tool"
export type HttpStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "none"

export interface OperationCompletion {
  errorCategory?: OperationalErrorCategory
  outcome: OperationalOutcome
  statusCode?: number
}

export interface OperationObservation {
  end(completion: OperationCompletion): void
  retry(): void
  run<T>(callback: () => Promise<T>): Promise<T>
}

export interface OperationalObserver {
  getObservabilityStatus(): ObservabilitySnapshot
  startDiscordRequest(operation: string): OperationObservation
  startTool(name: string): OperationObservation
}

export interface ObservabilityRuntime extends OperationalObserver {
  start(): void
  stop(): Promise<void>
}

interface MutableDuration {
  buckets: number[]
  count: number
  maxMs: number
  sumMs: number
}

interface MutableOperation {
  active: number
  calls: number
  duration: MutableDuration
  errors: number
  outcomes: Record<OperationalOutcome, number>
  retries: number
}

export interface DurationSnapshot {
  buckets: Array<{ count: number; leMs: number }>
  count: number
  maxMs: number
  sumMs: number
}

export interface OperationSnapshot {
  active: number
  calls: number
  duration: DurationSnapshot
  errors: number
  operation: string
  outcomes: Record<OperationalOutcome, number>
  retries: number
}

export interface ObservabilitySnapshot {
  exporter: {
    attempts: number
    enabled: boolean
    endpointConfigured: boolean
    failures: number
    headersConfigured: boolean
    lastFailureAt: string | null
    lastSuccessAt: string | null
    state: "disabled" | "failed" | "not-started" | "running" | "stopped"
    successes: number
  }
  logging: {
    enabled: boolean
    failures: number
  }
  operations: {
    discordRest: OperationSnapshot[]
    mcpTools: OperationSnapshot[]
    totals: OperationSnapshot
  }
  privacy: {
    argumentsStored: false
    contentStored: false
    discordIdentifiersStored: false
    errorDetailsStored: false
    persistent: false
    rawRoutesStored: false
  }
  schemaVersion: number
  startedAt: string
  status: "ok"
}

export interface OperationalTelemetryOptions {
  clock?: () => number
  config: ObservabilityConfig
  monotonicClock?: () => number
  otlpFactory?: typeof startOtlpRuntime
  shutdownTimeoutMs?: number
  stderr?: Pick<NodeJS.WriteStream, "write">
}

interface Instruments {
  restCalls: Counter
  restDuration: Histogram
  restErrors: Counter
  restRetries: Counter
  toolCalls: Counter
  toolDuration: Histogram
  toolErrors: Counter
}

const EMPTY_OUTCOMES = Object.freeze({
  error: 0,
  ok: 0,
  "tool-error": 0,
})

function mutableOperation(): MutableOperation {
  return {
    active: 0,
    calls: 0,
    duration: {
      buckets: OBSERVABILITY_DEFAULTS.durationBucketsMs.map(() => 0),
      count: 0,
      maxMs: 0,
      sumMs: 0,
    },
    errors: 0,
    outcomes: { ...EMPTY_OUTCOMES },
    retries: 0,
  }
}

function statusClass(statusCode: number | undefined): HttpStatusClass {
  if (!statusCode || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return "none"
  }
  return `${Math.floor(statusCode / 100)}xx` as Exclude<HttpStatusClass, "none">
}

function fixedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, value) * 1_000) / 1_000
}

function durationSnapshot(value: MutableDuration): DurationSnapshot {
  return {
    buckets: OBSERVABILITY_DEFAULTS.durationBucketsMs.map((leMs, index) => ({
      count: value.buckets[index] || 0,
      leMs,
    })),
    count: value.count,
    maxMs: fixedDuration(value.maxMs),
    sumMs: fixedDuration(value.sumMs),
  }
}

function operationSnapshot(operation: string, value: MutableOperation): OperationSnapshot {
  return {
    active: value.active,
    calls: value.calls,
    duration: durationSnapshot(value.duration),
    errors: value.errors,
    operation,
    outcomes: { ...value.outcomes },
    retries: value.retries,
  }
}

export function classifyOperationalError(error: unknown): OperationalErrorCategory {
  if (error instanceof DiscordApiError) {
    if (error.status === 429) return "discord-rate-limited"
    if (error.status >= 500) return "discord-server-error"
    return "discord-client-error"
  }
  if (
    error instanceof AdministrationPlanChangedError
    || error instanceof AnnouncementCrosspostPlanChangedError
    || error instanceof ChannelCreationPlanChangedError
    || error instanceof ComponentMessagePlanChangedError
    || error instanceof DeletionPlanChangedError
  ) return "plan-changed"
  if (error instanceof PolicyError) return "policy-error"
  if (error instanceof ConfigurationError) return "configuration-error"
  if (error instanceof WriteCoordinationConflictError) return "coordination-conflict"
  if (error instanceof WriteCoordinationQuarantinedError) {
    return "coordination-quarantined"
  }
  if (error instanceof WriteCoordinationStateError) return "coordination-state-error"
  if (error instanceof AuditLogError || error instanceof OperationStoreError) {
    return "audit-error"
  }
  if (
    error instanceof ChannelCreationOperationConflictError
    || error instanceof AnnouncementCrosspostOperationConflictError
    || error instanceof ComponentMessageOperationConflictError
    || error instanceof InteractionConflictError
  ) return "idempotency-conflict"
  if (
    error instanceof ComponentMessageEvidenceError
    || error instanceof InteractionIdentityError
  ) return "identity-error"
  if (error instanceof InteractionRateLimitError) return "local-rate-limited"
  if (
    error instanceof AdministrationExecutionError
    || error instanceof AnnouncementCrosspostExecutionError
    || error instanceof ChannelCreationExecutionError
    || error instanceof ComponentMessageExecutionError
    || error instanceof DeletionExecutionError
    || error instanceof InteractionExecutionError
  ) return "execution-error"
  if (error instanceof RangeError || error instanceof TypeError) return "validation-error"
  if (error instanceof Error && error.name === "AbortError") return "cancelled"
  return "unknown"
}

export class OperationalTelemetry implements ObservabilityRuntime, OtlpHealthSink {
  readonly #clock: () => number
  readonly #config: ObservabilityConfig
  #contextManager: ContextManager | undefined
  #exportAttempts = 0
  #exportFailures = 0
  #exportLastFailureAt: string | null = null
  #exportLastSuccessAt: string | null = null
  #exportState: ObservabilitySnapshot["exporter"]["state"]
  #exportSuccesses = 0
  #instruments: Instruments | undefined
  #logFailures = 0
  readonly #monotonicClock: () => number
  readonly #operations = new Map<string, MutableOperation>()
  readonly #otlpFactory: typeof startOtlpRuntime
  #otel: OtlpRuntimeHandle | undefined
  readonly #shutdownTimeoutMs: number
  #started = false
  readonly #startedAt: string
  readonly #stderr: Pick<NodeJS.WriteStream, "write">
  #stopPromise: Promise<void> | undefined
  #tracer: Tracer | undefined

  constructor(options: OperationalTelemetryOptions) {
    this.#clock = options.clock || Date.now
    this.#config = options.config
    this.#exportState = options.config.exportEnabled ? "not-started" : "disabled"
    this.#monotonicClock = options.monotonicClock || performance.now.bind(performance)
    this.#otlpFactory = options.otlpFactory || startOtlpRuntime
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs
      ?? OBSERVABILITY_DEFAULTS.shutdownTimeoutMs
    this.#startedAt = new Date(this.#clock()).toISOString()
    this.#stderr = options.stderr || process.stderr
  }

  #timestamp(): string {
    return new Date(this.#clock()).toISOString()
  }

  #writeLog(value: Record<string, boolean | number | string>): void {
    if (!this.#config.jsonLogsEnabled) return
    try {
      this.#stderr.write(`${JSON.stringify(value)}\n`)
    } catch {
      this.#logFailures += 1
    }
  }

  #initializeInstruments(meter: Meter): void {
    this.#instruments = {
      restCalls: meter.createCounter("discord.rest.calls", {
        description: "Completed Discord REST operations",
      }),
      restDuration: meter.createHistogram("discord.rest.duration", {
        description: "Discord REST operation duration",
        unit: "ms",
      }),
      restErrors: meter.createCounter("discord.rest.errors", {
        description: "Failed Discord REST operations",
      }),
      restRetries: meter.createCounter("discord.rest.retries", {
        description: "Discord REST retries",
      }),
      toolCalls: meter.createCounter("mcp.tool.calls", {
        description: "Completed MCP tool calls",
      }),
      toolDuration: meter.createHistogram("mcp.tool.duration", {
        description: "MCP tool call duration",
        unit: "ms",
      }),
      toolErrors: meter.createCounter("mcp.tool.errors", {
        description: "MCP tool calls returning or throwing errors",
      }),
    }
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    const exportConfig = this.#config.export
    if (!exportConfig) return
    try {
      this.#otel = this.#otlpFactory(exportConfig, this)
      this.#contextManager = this.#otel.contextManager
      this.#tracer = this.#otel.tracer
      if (this.#otel.meter) this.#initializeInstruments(this.#otel.meter)
    } catch {
      this.transitionExporter("failed")
    }
  }

  stop(): Promise<void> {
    this.#stopPromise ??= (async () => {
      const otel = this.#otel
      if (!otel) {
        if (this.#config.exportEnabled && this.#exportState !== "failed") {
          this.#exportState = "stopped"
        }
        return
      }
      const shutdown = (async (): Promise<"failed" | "stopped"> => {
        let failed = false
        try {
          await otel.forceFlush()
        } catch {
          failed = true
        }
        try {
          await otel.shutdown()
        } catch {
          failed = true
        }
        return failed ? "failed" : "stopped"
      })()
      let timer: ReturnType<typeof setTimeout> | undefined
      const state = await Promise.race([
        shutdown,
        new Promise<"failed">((resolve) => {
          timer = setTimeout(() => resolve("failed"), this.#shutdownTimeoutMs)
        }),
      ])
      if (timer) clearTimeout(timer)
      this.transitionExporter(state)
    })()
    return this.#stopPromise
  }

  transitionExporter(state: OtlpRuntimeState): void {
    this.#exportState = state
    this.#writeLog({
      component: "observability",
      event: "exporter-state",
      state,
      timestamp: this.#timestamp(),
    })
  }

  recordExport(signal: OtlpSignal, success: boolean): void {
    this.#exportAttempts += 1
    if (success) {
      this.#exportSuccesses += 1
      this.#exportLastSuccessAt = this.#timestamp()
    } else {
      this.#exportFailures += 1
      this.#exportLastFailureAt = this.#timestamp()
    }
    this.#writeLog({
      component: "observability",
      event: "export",
      signal,
      status: success ? "ok" : "error",
      timestamp: this.#timestamp(),
    })
  }

  #operation(kind: OperationalKind, operation: string): MutableOperation {
    const key = `${kind}:${operation}`
    let value = this.#operations.get(key)
    if (!value) {
      value = mutableOperation()
      this.#operations.set(key, value)
    }
    return value
  }

  #startObservation(options: {
    kind: OperationalKind
    method?: string
    operation: string
    risk?: McpToolRiskClass | "unknown"
  }): OperationObservation {
    const aggregate = this.#operation(options.kind, options.operation)
    aggregate.active += 1
    const startedAt = this.#monotonicClock()
    let span: Span | undefined
    let spanContext: Context | undefined
    if (this.#exportState === "running") {
      try {
        const attributes: Record<string, boolean | number | string> = {
          "operation.kind": options.kind,
          "operation.name": options.operation,
        }
        if (options.method) attributes["http.request.method"] = options.method
        if (options.risk) attributes["mcp.tool.risk"] = options.risk
        if (this.#tracer) {
          const parentContext = this.#contextManager?.active() || context.active()
          span = this.#tracer.startSpan(
            options.kind === "mcp-tool"
              ? `mcp.tool.${options.operation}`
              : `discord.rest.${options.operation}`,
            {
              attributes,
              kind: options.kind === "mcp-tool" ? SpanKind.SERVER : SpanKind.CLIENT,
            },
            parentContext,
          )
          spanContext = trace.setSpan(parentContext, span)
        }
      } catch {}
    }
    let completed = false
    let retries = 0
    return {
      end: (completion) => {
        if (completed) return
        completed = true
        const durationMs = fixedDuration(this.#monotonicClock() - startedAt)
        aggregate.active = Math.max(0, aggregate.active - 1)
        aggregate.calls += 1
        aggregate.retries += retries
        aggregate.outcomes[completion.outcome] += 1
        if (completion.outcome !== "ok") aggregate.errors += 1
        aggregate.duration.count += 1
        aggregate.duration.sumMs += durationMs
        aggregate.duration.maxMs = Math.max(aggregate.duration.maxMs, durationMs)
        for (const [index, boundary] of OBSERVABILITY_DEFAULTS.durationBucketsMs.entries()) {
          if (durationMs <= boundary) aggregate.duration.buckets[index] = (aggregate.duration.buckets[index] || 0) + 1
        }

        const attributes: Record<string, boolean | number | string> = {
          "operation.name": options.operation,
          "operation.outcome": completion.outcome,
        }
        if (completion.errorCategory) attributes["error.category"] = completion.errorCategory
        if (options.method) attributes["http.request.method"] = options.method
        if (options.risk) attributes["mcp.tool.risk"] = options.risk
        if (retries > 0) attributes["operation.retry_count"] = retries
        if (completion.statusCode !== undefined) {
          attributes["http.response.status_code"] = completion.statusCode
        }
        attributes["http.response.status_class"] = statusClass(completion.statusCode)
        try {
          if (options.kind === "mcp-tool") {
            this.#instruments?.toolCalls.add(1, attributes)
            this.#instruments?.toolDuration.record(durationMs, attributes)
            if (completion.outcome !== "ok") this.#instruments?.toolErrors.add(1, attributes)
          } else {
            this.#instruments?.restCalls.add(1, attributes)
            this.#instruments?.restDuration.record(durationMs, attributes)
            if (completion.outcome !== "ok") this.#instruments?.restErrors.add(1, attributes)
            if (retries > 0) this.#instruments?.restRetries.add(retries, attributes)
          }
          span?.setAttributes(attributes)
          span?.setStatus({
            code: completion.outcome === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          })
          span?.end()
        } catch {}
        this.#writeLog({
          component: options.kind,
          durationMs,
          ...(completion.errorCategory ? { errorCategory: completion.errorCategory } : {}),
          event: "operation-complete",
          operation: options.operation,
          outcome: completion.outcome,
          retries,
          ...(options.method ? { method: options.method } : {}),
          ...(completion.statusCode !== undefined ? { statusCode: completion.statusCode } : {}),
          timestamp: this.#timestamp(),
        })
      },
      retry: () => {
        if (!completed) retries += 1
      },
      run: async <T>(callback: () => Promise<T>): Promise<T> => {
        if (!spanContext) return callback()
        let invoked = false
        try {
          const manager = this.#contextManager || context
          return await manager.with(spanContext, () => {
            invoked = true
            return callback()
          })
        } catch (error) {
          if (invoked) throw error
          return callback()
        }
      },
    }
  }

  startTool(name: string): OperationObservation {
    const operation: McpToolName | "unknown" = Object.hasOwn(MCP_TOOL_RISK_CLASSES, name)
      ? name as McpToolName
      : "unknown"
    const risk = operation === "unknown" ? "unknown" : MCP_TOOL_RISK_CLASSES[operation]
    return this.#startObservation({
      kind: "mcp-tool",
      operation,
      risk,
    })
  }

  startDiscordRequest(operationName: string): OperationObservation {
    const operation: DiscordRestOperation | "unknown" = Object.hasOwn(
      DISCORD_REST_OPERATIONS,
      operationName,
    )
      ? operationName as DiscordRestOperation
      : "unknown"
    return this.#startObservation({
      kind: "discord-rest",
      ...(operation === "unknown" ? {} : { method: DISCORD_REST_OPERATIONS[operation] }),
      operation,
    })
  }

  #operationEntries(kind: OperationalKind): OperationSnapshot[] {
    const prefix = `${kind}:`
    return [...this.#operations.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => operationSnapshot(key.slice(prefix.length), value))
      .sort((left, right) => left.operation.localeCompare(right.operation))
  }

  getObservabilityStatus(): ObservabilitySnapshot {
    const mcpTools = this.#operationEntries("mcp-tool")
    const discordRest = this.#operationEntries("discord-rest")
    const total = mutableOperation()
    for (const operation of [...mcpTools, ...discordRest]) {
      total.active += operation.active
      total.calls += operation.calls
      total.errors += operation.errors
      total.retries += operation.retries
      total.duration.count += operation.duration.count
      total.duration.maxMs = Math.max(total.duration.maxMs, operation.duration.maxMs)
      total.duration.sumMs += operation.duration.sumMs
      for (const [index, bucket] of operation.duration.buckets.entries()) {
        total.duration.buckets[index] = (total.duration.buckets[index] || 0) + bucket.count
      }
      for (const outcome of ["error", "ok", "tool-error"] as const) {
        total.outcomes[outcome] += operation.outcomes[outcome]
      }
    }
    const exportConfig = this.#config.export
    return {
      exporter: {
        attempts: this.#exportAttempts,
        enabled: this.#config.exportEnabled,
        endpointConfigured: exportConfig?.endpointConfigured ?? false,
        failures: this.#exportFailures,
        headersConfigured: exportConfig?.headersConfigured ?? false,
        lastFailureAt: this.#exportLastFailureAt,
        lastSuccessAt: this.#exportLastSuccessAt,
        state: this.#exportState,
        successes: this.#exportSuccesses,
      },
      logging: {
        enabled: this.#config.jsonLogsEnabled,
        failures: this.#logFailures,
      },
      operations: {
        discordRest,
        mcpTools,
        totals: operationSnapshot("all", total),
      },
      privacy: {
        argumentsStored: false,
        contentStored: false,
        discordIdentifiersStored: false,
        errorDetailsStored: false,
        persistent: false,
        rawRoutesStored: false,
      },
      schemaVersion: SCHEMA_VERSION,
      startedAt: this.#startedAt,
      status: "ok",
    }
  }
}
