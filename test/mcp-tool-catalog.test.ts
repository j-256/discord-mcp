import assert from "node:assert/strict"
import test from "node:test"

import type { RegisteredTool, ToolAnnotations } from "@modelcontextprotocol/server"

import {
  CONNECTOR_LIMITS,
  MCP_DISCOVERY_TOOL_NAME,
} from "../src/constants.js"
import {
  MCP_TOOL_ACCESS_STAGES,
  MCP_TOOL_CATALOG,
  createMcpToolAccessManifest,
  createDiscordToolDiscoveryCatalog,
  discoverDiscordTools,
  mcpToolAccessContract,
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

test("tool access manifest classifies every tool and binds reviewed companions", () => {
  const manifest = createMcpToolAccessManifest()
  assert.equal(
    manifest.entries.length,
    Object.keys(MCP_TOOL_CATALOG).length + 1,
  )
  assert.equal(manifest.entries[0]?.name, "add_reaction")
  assert.equal(
    manifest.entries.some(({ name }) => name === MCP_DISCOVERY_TOOL_NAME),
    true,
  )
  assert.equal(
    Object.values(manifest.stageCounts).reduce((total, count) => total + count, 0),
    manifest.entries.length,
  )
  assert.deepEqual(
    Object.keys(manifest.stageCounts).sort(),
    [...MCP_TOOL_ACCESS_STAGES].sort(),
  )
  assert.equal(manifest.authorityGranted, false)
  assert.equal(manifest.credentialsRequired, false)
  assert.equal(manifest.discordContacted, false)
  assert.equal(manifest.readiness, "target-specific")
  assert.deepEqual(manifest.stageContracts["review-execute"], {
    approval: "host-write-and-signed-interactive",
    authorizationEvidence: "fresh-plan-recheck",
    discordRequest: "write",
    readiness: "target-specific",
  })
  assert.deepEqual(manifest.workflows["message-deletion"], {
    execute: ["delete_messages"],
    plan: ["plan_message_deletion"],
    verify: [],
  })

  const selected = createMcpToolAccessManifest(
    new Set(["connector", "messages"] as const),
  )
  assert.deepEqual(selected.toolsetNames, ["connector", "messages"])
  assert.equal(
    selected.entries.length,
    Object.values(MCP_TOOL_CATALOG)
      .filter(({ toolset }) => selected.toolsetNames.includes(toolset))
      .length + 1,
  )
  assert.equal(
    selected.entries.every((entry) => (
      entry.name === MCP_DISCOVERY_TOOL_NAME
      || selected.toolsetNames.includes(entry.toolset)
    )),
    true,
  )

  assert.deepEqual(mcpToolAccessContract("get_gateway_status"), {
    approval: "none",
    authorizationEvidence: "none",
    companions: { execute: [], plan: [], verify: [] },
    discordRequest: "none",
    readiness: "not-applicable",
    stage: "local",
  })
  assert.deepEqual(mcpToolAccessContract("plan_message_deletion"), {
    approval: "none",
    authorizationEvidence: "target-bound-plan",
    companions: {
      execute: ["delete_messages"],
      plan: ["plan_message_deletion"],
      verify: [],
    },
    discordRequest: "read",
    readiness: "target-specific",
    stage: "review-plan",
  })
  assert.deepEqual(mcpToolAccessContract("delete_messages"), {
    approval: "host-write-and-signed-interactive",
    authorizationEvidence: "fresh-plan-recheck",
    companions: {
      execute: ["delete_messages"],
      plan: ["plan_message_deletion"],
      verify: [],
    },
    discordRequest: "write",
    readiness: "target-specific",
    stage: "review-execute",
  })
  assert.equal(
    mcpToolAccessContract("verify_direct_message_change").stage,
    "receipt-verify",
  )
  assert.deepEqual(mcpToolAccessContract("send_message"), {
    approval: "host-write-approval",
    authorizationEvidence: "operation-runtime",
    companions: { execute: [], plan: [], verify: [] },
    discordRequest: "write",
    readiness: "target-specific",
    stage: "guarded-write",
  })
})

test("tool discovery returns the canonical access contract in compact results", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({
      annotations: DESTRUCTIVE_ANNOTATIONS,
      name: "execute_role_order",
      title: "Execute role ordering",
    }),
    trackedTool({ name: "plan_role_order", title: "Plan role ordering" }),
  ], "full")
  const result = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "execute_role_order",
  }, catalog)

  assert.deepEqual(
    result.matches[0]?.access,
    mcpToolAccessContract("execute_role_order"),
  )
})
