import {
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
  type RequestMeta,
} from "@modelcontextprotocol/server"
import {
  createTraceState,
  type SpanContext,
  type TraceState,
} from "@opentelemetry/api"

const TRACEPARENT_VERSION = "00"
const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ZERO_SPAN_ID = "0000000000000000"
const ZERO_TRACE_ID = "00000000000000000000000000000000"
const TRACESTATE_MAX_CHARACTERS = 512
const TRACESTATE_MAX_MEMBERS = 32

function strictTraceState(value: unknown): TraceState | undefined {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > TRACESTATE_MAX_CHARACTERS
  ) return undefined
  const members = value.split(",")
  if (
    members.length > TRACESTATE_MAX_MEMBERS
    || members.some((member) => member.trim().length === 0)
  ) return undefined
  const normalized = members.map((member) => member.trim()).join(",")
  const traceState = createTraceState(normalized)
  return traceState.serialize() === normalized ? traceState : undefined
}

export function extractMcpRemoteSpanContext(
  metadata: RequestMeta | undefined,
): SpanContext | undefined {
  const traceparent = metadata?.[TRACEPARENT_META_KEY]
  if (typeof traceparent !== "string") return undefined
  const match = TRACEPARENT_PATTERN.exec(traceparent)
  if (!match || match[1] !== TRACEPARENT_VERSION) return undefined
  const traceId = match[2]
  const spanId = match[3]
  const flags = match[4]
  if (
    !traceId
    || !spanId
    || !flags
    || traceId === ZERO_TRACE_ID
    || spanId === ZERO_SPAN_ID
  ) return undefined
  const traceState = strictTraceState(metadata?.[TRACESTATE_META_KEY])
  return {
    isRemote: true,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
    traceId,
    ...(traceState ? { traceState } : {}),
  }
}
