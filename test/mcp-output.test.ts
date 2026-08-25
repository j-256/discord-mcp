import assert from "node:assert/strict"
import test from "node:test"

import {
  isCallToolResult,
  ProtocolError,
  ProtocolErrorCode,
  STDIO_DEFAULT_MAX_BUFFER_SIZE,
} from "@modelcontextprotocol/server"

import { MCP_READ_RESPONSE_LIMITS } from "../src/constants.js"
import {
  assertMcpReadResultBudget,
  budgetMcpToolResult,
  MCP_READ_RESPONSE_TOO_LARGE_CODE,
  serializedMcpResultBytes,
} from "../src/mcp-output.js"

test("MCP result byte measurement uses compact UTF-8 JSON", () => {
  assert.equal(serializedMcpResultBytes({ value: "plain" }), 17)
  assert.equal(serializedMcpResultBytes({ value: "\u00e9" }), 14)
  assert.throws(
    () => serializedMcpResultBytes(undefined),
    /must be JSON-serializable/,
  )
})

test("MCP read-response maximum leaves transport framing headroom", () => {
  assert.ok(
    STDIO_DEFAULT_MAX_BUFFER_SIZE
      - MCP_READ_RESPONSE_LIMITS.maximumBytes
      >= 2 * 1_024 * 1_024,
  )
})

test("MCP tool budget preserves fitting reads and every mutation outcome", () => {
  const fitting = {
    content: [{ text: "ok", type: "text" as const }],
    structuredContent: { schemaVersion: 1, status: "ok" },
  }
  const oversizedMutation = {
    content: [{ text: "x".repeat(200), type: "text" as const }],
    structuredContent: { schemaVersion: 1, status: "completed" },
  }
  assert.equal(budgetMcpToolResult(fitting, 1_024, false), fitting)
  assert.equal(budgetMcpToolResult(oversizedMutation, 1, true), oversizedMutation)
})

test("MCP tool budget replaces an oversized read without leaking its value or size", () => {
  const secret = "unique-withheld-value"
  const result = budgetMcpToolResult({
    content: [{ text: secret.repeat(20), type: "text" as const }],
    structuredContent: { schemaVersion: 1, status: "ok", value: secret },
  }, 64, false)
  assert.equal(isCallToolResult(result), true)
  assert.equal("isError" in result && result.isError, true)
  assert.equal(JSON.stringify(result).includes(secret), false)
  const structured = result.structuredContent as Record<string, unknown>
  assert.equal(structured.status, "response-too-large")
  assert.equal(
    (structured.error as { code?: string } | undefined)?.code,
    MCP_READ_RESPONSE_TOO_LARGE_CODE,
  )
  assert.deepEqual(structured.responseBudget, {
    limitBytes: 64,
    measurement: "above-limit",
    scope: "mcp-read-result",
  })
})

test("MCP resource and prompt budgets fail with bounded InvalidParams errors", () => {
  const secret = "unique-withheld-resource-value"
  const fitting = { contents: [{ text: "ok", uri: "discord://safety" }] }
  assert.equal(assertMcpReadResultBudget(fitting, 1_024, "resource"), fitting)

  for (const surface of ["prompt", "resource"] as const) {
    assert.throws(
      () => assertMcpReadResultBudget({ value: secret.repeat(20) }, 64, surface),
      (error: unknown) => {
        assert.equal(error instanceof ProtocolError, true)
        if (!(error instanceof ProtocolError)) return false
        assert.equal(error.code, ProtocolErrorCode.InvalidParams)
        assert.equal(error.message.includes(secret), false)
        assert.deepEqual(error.data, {
          code: MCP_READ_RESPONSE_TOO_LARGE_CODE,
          limitBytes: 64,
          measurement: "above-limit",
          recoveryHint: "Narrow the request or review $.limits.mcpReadResponseMaxBytes.",
          surface,
        })
        return true
      },
    )
  }
})
