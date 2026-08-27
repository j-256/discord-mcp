import assert from "node:assert/strict"
import test from "node:test"

import type { RegisteredTool, ToolAnnotations } from "@modelcontextprotocol/server"

import { CONNECTOR_LIMITS } from "../src/constants.js"
import {
  createDiscordToolDiscoveryCatalog,
  discoverDiscordTools,
  type CanonicalMcpToolName,
  type TrackedMcpTool,
} from "../src/mcp-tool-catalog.js"

const COMPLETE_ANNOTATIONS = Object.freeze({
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
})

const WRITE_ANNOTATIONS = Object.freeze({
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
})

const DESTRUCTIVE_ANNOTATIONS = Object.freeze({
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
})

function trackedTool(options: {
  annotations?: ToolAnnotations
  description?: string
  name?: CanonicalMcpToolName
  title?: string
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
    title: options.title ?? "List Discord guilds",
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

test("tool discovery rewards distinct token evidence without substring collisions", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({
      description: "Read a bounded page of recent Discord messages",
      name: "read_messages",
      title: "Read recent channel messages",
    }),
    trackedTool({
      description: "Review channel order with repeated channel evidence",
      name: "audit_channel_order",
      title: "Audit channel channel order",
    }),
    trackedTool({
      description: "Review one exact role order",
      name: "plan_role_order",
      title: "Review role order",
    }),
  ], "full")

  const ranked = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "summarize recent channel messages",
  }, catalog)
  assert.equal(ranked.matches[0]?.name, "read_messages")
  assert.equal(ranked.matches.some(({ name }) => name === "audit_channel_order"), false)

  const collision = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "view",
  }, catalog)
  assert.equal(collision.matches.some(({ name }) => name === "plan_role_order"), false)
})

test("tool discovery normalizes safe variants while rejecting weak multi-term matches", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({ name: "list_roles", title: "List Discord roles" }),
    trackedTool({ name: "plan_role_order", title: "Plan role ordering" }),
    trackedTool({
      annotations: WRITE_ANNOTATIONS,
      name: "execute_role_order",
      title: "Execute role ordering",
    }),
    trackedTool({ name: "read_messages", title: "Read Discord messages" }),
    trackedTool({ name: "plan_channel_creation", title: "Plan channel creation" }),
  ], "full")

  const variants = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "reorder roles",
  }, catalog)
  assert.equal(variants.matches[0]?.name, "plan_role_order")

  const terse = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "messages",
  }, catalog)
  assert.equal(terse.matches.some(({ name }) => name === "read_messages"), true)

  const weak = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "create an entire Discord server",
  }, catalog)
  assert.deepEqual(weak.matches, [])
})

test("tool discovery promotes reviewed planners without crossing exact risk filters", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({
      name: "plan_message_deletion",
      title: "Plan exact message deletion",
    }),
    trackedTool({
      annotations: DESTRUCTIVE_ANNOTATIONS,
      name: "delete_messages",
      title: "Delete exact messages",
    }),
  ], "full")

  const natural = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "delete a message",
  }, catalog)
  assert.equal(natural.matches[0]?.name, "plan_message_deletion")

  const destructiveOnly = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "delete a message",
    risk: "destructive",
  }, catalog)
  assert.equal(destructiveOnly.matches[0]?.name, "delete_messages")

  const exact = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "delete_messages",
  }, catalog)
  assert.deepEqual(exact.matches.map(({ name }) => name), ["delete_messages"])
})
