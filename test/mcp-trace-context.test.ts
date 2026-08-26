import assert from "node:assert/strict"
import test from "node:test"

import type { RequestMeta } from "@modelcontextprotocol/server"

import { extractMcpRemoteSpanContext } from "../src/mcp-trace-context.js"

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
const SPAN_ID = "00f067aa0ba902b7"
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`

function metadata(value: Record<string, unknown>): RequestMeta {
  return value as RequestMeta
}

test("MCP trace context accepts a strict remote parent and complete tracestate", () => {
  const context = extractMcpRemoteSpanContext(metadata({
    traceparent: TRACEPARENT,
    tracestate: "vendor=value, tenant@system=opaque",
  }))

  assert.ok(context)
  assert.equal(context.traceId, TRACE_ID)
  assert.equal(context.spanId, SPAN_ID)
  assert.equal(context.traceFlags, 1)
  assert.equal(context.isRemote, true)
  assert.equal(
    context.traceState?.serialize(),
    "vendor=value,tenant@system=opaque",
  )
})

test("MCP trace context preserves an unsampled remote parent", () => {
  const context = extractMcpRemoteSpanContext(metadata({
    traceparent: `00-${TRACE_ID}-${SPAN_ID}-00`,
  }))

  assert.ok(context)
  assert.equal(context.traceFlags, 0)
  assert.equal(context.traceState, undefined)
})

test("MCP trace context rejects malformed, unsupported, and zero parents", () => {
  const invalid = [
    undefined,
    metadata({ traceparent: 42 }),
    metadata({ traceparent: TRACEPARENT.toUpperCase() }),
    metadata({ traceparent: `01-${TRACE_ID}-${SPAN_ID}-01` }),
    metadata({ traceparent: `00-${"0".repeat(32)}-${SPAN_ID}-01` }),
    metadata({ traceparent: `00-${TRACE_ID}-${"0".repeat(16)}-01` }),
    metadata({ traceparent: `${TRACEPARENT}-extra` }),
    metadata({ traceparent: ` ${TRACEPARENT}` }),
  ]

  for (const candidate of invalid) {
    assert.equal(extractMcpRemoteSpanContext(candidate), undefined)
  }
})

test("MCP trace context drops invalid tracestate without dropping its parent", () => {
  const invalid = [
    42,
    "",
    "vendor=one,vendor=two",
    "vendor==value",
    "vendor=value,,other=two",
    `vendor=${"x".repeat(513)}`,
    Array.from({ length: 33 }, (_, index) => `k${index}=v`).join(","),
  ]

  for (const tracestate of invalid) {
    const context = extractMcpRemoteSpanContext(metadata({
      traceparent: TRACEPARENT,
      tracestate,
    }))
    assert.ok(context)
    assert.equal(context.traceState, undefined)
  }
})

test("MCP trace context never imports arbitrary baggage", () => {
  const privateBaggage = "private-user=999999999999999999,message=private-content"
  const context = extractMcpRemoteSpanContext(metadata({
    baggage: privateBaggage,
    traceparent: TRACEPARENT,
  }))

  assert.ok(context)
  assert.equal(JSON.stringify(context).includes(privateBaggage), false)
  assert.equal("baggage" in context, false)
})
