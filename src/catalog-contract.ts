import type { CallToolResult } from "@modelcontextprotocol/server"

import { SCHEMA_VERSION } from "./constants.js"

export const CATALOG_ONLY_ERROR_CODE = "CATALOG_ONLY"
export const CATALOG_ONLY_MESSAGE = "Tool execution is disabled in credential-free catalog mode"
export const CATALOG_ONLY_RECOVERY = "Use discord-mcp serve with credentialed configuration to execute tools"
export const CATALOG_ONLY_STATUS = "catalog-only"

export function catalogOnlyResult(): CallToolResult {
  return {
    content: [{
      text: CATALOG_ONLY_MESSAGE,
      type: "text",
    }],
    isError: true,
    structuredContent: {
      error: {
        category: "client",
        code: CATALOG_ONLY_ERROR_CODE,
        recoveryHint: CATALOG_ONLY_RECOVERY,
        retriable: false,
      },
      schemaVersion: SCHEMA_VERSION,
      status: CATALOG_ONLY_STATUS,
    },
  }
}
