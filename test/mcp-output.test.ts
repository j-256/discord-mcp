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
  contentFreeToolReceipt,
  DISCORD_MCP_RECEIPT_PREFIX,
  DISCORD_MCP_RECEIPT_SCHEMA,
  MCP_READ_RESPONSE_TOO_LARGE_CODE,
  redactMcpValue,
  serializedMcpResultBytes,
  withContentFreeToolReceipt,
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

test("reviewed tool results retain summaries and add content-free receipts", () => {
  const structuredContent = {
    digest: `hmac-sha256:${"a".repeat(64)}`,
    operationKeyHash: `sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status: "planned",
    transientName: "private guild name",
    writeRequired: true,
  }
  const original = {
    content: [{ text: "Plan ready", type: "text" as const }],
    structuredContent,
  }
  const compatible = withContentFreeToolReceipt(original)
  const receipt = JSON.parse(
    compatible.content[1]?.text.slice(DISCORD_MCP_RECEIPT_PREFIX.length) || "null",
  )

  assert.equal(compatible.content[0]?.text, "Plan ready")
  assert.equal(compatible.content[1]?.type, "text")
  assert.ok(compatible.content[1]?.text.startsWith(DISCORD_MCP_RECEIPT_PREFIX))
  assert.deepEqual(receipt, {
    receiptSchema: DISCORD_MCP_RECEIPT_SCHEMA,
    schemaVersion: 1,
    status: "planned",
    digest: structuredContent.digest,
    operationKeyHash: structuredContent.operationKeyHash,
    writeRequired: true,
  })
  assert.equal(JSON.stringify(receipt).includes(structuredContent.transientName), false)
  assert.equal(withContentFreeToolReceipt(compatible), compatible)
})

test("content-free receipts follow recursive secret redaction and strict projection", () => {
  const secret = "private-\"secret\"\nvalue"
  const redacted = redactMcpValue({
    content: [{ text: "Safe summary", type: "text" as const }],
    structuredContent: {
      digest: `hmac-sha256:${"c".repeat(64)}`,
      nested: { secret },
      schemaVersion: 1,
      status: "planned",
    },
  }, [secret])
  const compatible = withContentFreeToolReceipt(redacted)

  assert.equal(JSON.stringify(compatible).includes(secret), false)
  assert.equal(JSON.stringify(compatible.content).includes("[redacted]"), false)
})

test("content-free receipts reject malformed evidence and omit arbitrary error fields", () => {
  const structuredContent = {
    actualDigest: `sha256:${"d".repeat(64)}`,
    digest: `hmac-sha256:${"a".repeat(64)}`,
    error: {
      category: "server",
      code: "PLAN_STALE",
      message: "private reason at /private/path",
      recoveryHint: "open a private URL",
      retriable: true,
    },
    expectedDigest: `sha256:${"e".repeat(64)}`,
    nextAction: "request-fresh-plan",
    operationKey: "raw-private-key",
    operationKeyHash: "sha256:too-short",
    planDigest: `sha256:${"A".repeat(64)}`,
    requestDigest: `hmac-sha256:${"c".repeat(64)}`,
    schemaVersion: 1,
    status: "stale",
    writeRequired: false,
  }
  const receipt = contentFreeToolReceipt(structuredContent)

  assert.deepEqual(receipt, {
    receiptSchema: DISCORD_MCP_RECEIPT_SCHEMA,
    schemaVersion: 1,
    status: "stale",
    digest: structuredContent.digest,
    requestDigest: structuredContent.requestDigest,
    actualDigest: structuredContent.actualDigest,
    expectedDigest: structuredContent.expectedDigest,
    nextAction: "request-fresh-plan",
    writeRequired: false,
    error: {
      category: "server",
      code: "PLAN_STALE",
      retriable: true,
    },
  })
  assert.equal(JSON.stringify(receipt).includes("private"), false)
  assert.equal(JSON.stringify(receipt).includes("operationKey"), false)
  assert.equal(JSON.stringify(receipt).includes("planDigest"), false)
  assert.equal(contentFreeToolReceipt({
    digest: "sha256:not-a-digest",
    error: {
      category: "Server Error",
      code: "private-code",
      retriable: "yes",
    },
    nextAction: "../../private",
    schemaVersion: 0,
    status: "PRIVATE",
    writeRequired: "true",
  }), undefined)
})

test("tool results without continuation evidence remain unchanged", () => {
  const result = {
    content: [{ text: "Unstructured result", type: "text" as const }],
    structuredContent: {
      profileName: "private profile",
      schemaVersion: 1,
      status: "ok",
    },
  }
  assert.equal(withContentFreeToolReceipt(result), result)
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
  assert.equal(result.content.length, 2)
  assert.ok(
    result.content[1]?.type === "text"
    && result.content[1].text.startsWith(DISCORD_MCP_RECEIPT_PREFIX),
  )
  assert.equal(result.content[1]?.text.includes(MCP_READ_RESPONSE_TOO_LARGE_CODE), true)
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
