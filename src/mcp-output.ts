import {
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
} from "@modelcontextprotocol/server"

import { SCHEMA_VERSION } from "./constants.js"
import { redactText } from "./errors.js"

export const MCP_READ_RESPONSE_TOO_LARGE_CODE = "MCP_READ_RESPONSE_TOO_LARGE"
export const MCP_READ_RESPONSE_TOO_LARGE_STATUS = "response-too-large"

const MCP_READ_RESPONSE_BUDGET_CONFIG_PATH = "$.limits.mcpReadResponseMaxBytes"
const MCP_READ_RESPONSE_RECOVERY = `Narrow the request or review ${MCP_READ_RESPONSE_BUDGET_CONFIG_PATH}.`
const MCP_READ_RESPONSE_TOO_LARGE_MESSAGE = `Discord MCP withheld an oversized read result. ${MCP_READ_RESPONSE_RECOVERY}`

type McpReadSurface = "prompt" | "resource"

export function redactMcpValue<T>(
  value: T,
  secrets: readonly (string | undefined)[],
): T {
  if (typeof value === "string") return redactText(value, secrets) as T
  if (Array.isArray(value)) {
    return value.map((entry) => redactMcpValue(entry, secrets)) as T
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactMcpValue(entry, secrets),
      ]),
    ) as T
  }
  return value
}

export function redactedJson(
  value: unknown,
  secrets: readonly (string | undefined)[],
): string {
  return JSON.stringify(redactMcpValue(value, secrets), null, 2)
}

export function serializedMcpResultBytes(value: unknown): number {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError("MCP application result must be JSON-serializable")
  }
  return Buffer.byteLength(serialized, "utf8")
}

function oversizedToolResult(maxBytes: number): CallToolResult {
  return {
    content: [{
      text: MCP_READ_RESPONSE_TOO_LARGE_MESSAGE,
      type: "text",
    }],
    isError: true,
    structuredContent: {
      error: {
        category: "client",
        code: MCP_READ_RESPONSE_TOO_LARGE_CODE,
        recoveryHint: MCP_READ_RESPONSE_RECOVERY,
        retriable: false,
      },
      responseBudget: {
        limitBytes: maxBytes,
        measurement: "above-limit",
        scope: "mcp-read-result",
      },
      schemaVersion: SCHEMA_VERSION,
      status: MCP_READ_RESPONSE_TOO_LARGE_STATUS,
    },
  }
}

export function budgetMcpToolResult<T>(
  result: T,
  maxBytes: number,
  preserveMutationOutcome: boolean,
): T | CallToolResult {
  if (
    preserveMutationOutcome
    || serializedMcpResultBytes(result) <= maxBytes
  ) return result
  return oversizedToolResult(maxBytes)
}

export function assertMcpReadResultBudget<T>(
  result: T,
  maxBytes: number,
  surface: McpReadSurface,
): T {
  if (serializedMcpResultBytes(result) <= maxBytes) return result
  throw new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    MCP_READ_RESPONSE_TOO_LARGE_MESSAGE,
    {
      code: MCP_READ_RESPONSE_TOO_LARGE_CODE,
      limitBytes: maxBytes,
      measurement: "above-limit",
      recoveryHint: MCP_READ_RESPONSE_RECOVERY,
      surface,
    },
  )
}
