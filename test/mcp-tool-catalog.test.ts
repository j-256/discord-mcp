import assert from "node:assert/strict"
import test from "node:test"

import type { RegisteredTool, ToolAnnotations } from "@modelcontextprotocol/server"

import { CONNECTOR_LIMITS } from "../src/constants.js"
import {
  createDiscordToolDiscoveryCatalog,
  type CanonicalMcpToolName,
  type TrackedMcpTool,
} from "../src/mcp-tool-catalog.js"

const COMPLETE_ANNOTATIONS = Object.freeze({
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
})

function trackedTool(options: {
  annotations?: ToolAnnotations
  description?: string
  name?: CanonicalMcpToolName
} = {}): TrackedMcpTool {
  const state = { enabled: true }
  const handle = {
    annotations: options.annotations ?? COMPLETE_ANNOTATIONS,
    description: options.description ?? "List configured Discord guilds",
    disable() {
      state.enabled = false
    },
    enable() {
      state.enabled = true
    },
    get enabled() {
      return state.enabled
    },
    set enabled(value: boolean) {
      state.enabled = value
    },
    title: "List Discord guilds",
  } as unknown as RegisteredTool
  return {
    handle,
    inputSchema: { additionalProperties: false, type: "object" },
    name: options.name ?? "list_guilds",
  }
}

test("tool discovery catalog rejects incomplete annotations and duplicate exact names", () => {
  const incomplete = trackedTool({
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      readOnlyHint: true,
    },
  })
  assert.throws(
    () => createDiscordToolDiscoveryCatalog([incomplete], "full"),
    /complete risk annotations/,
  )

  const duplicate = trackedTool()
  assert.throws(
    () => createDiscordToolDiscoveryCatalog([duplicate, duplicate], "full"),
    /Duplicate tracked MCP tool list_guilds/,
  )
})

test("progressive catalog disables exact handles and bounds compact summaries", () => {
  const tracked = trackedTool({ description: "x".repeat(500) })
  const catalog = createDiscordToolDiscoveryCatalog([tracked], "progressive")

  assert.equal(tracked.handle.enabled, false)
  assert.equal(catalog.entries[0]?.summary.length, CONNECTOR_LIMITS.toolDiscoverySummaryCharacters)
  assert.match(catalog.entries[0]?.summary || "", /\.\.\.$/)
})
