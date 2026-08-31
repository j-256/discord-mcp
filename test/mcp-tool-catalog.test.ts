import assert from "node:assert/strict"
import test from "node:test"

import type { RegisteredTool, ToolAnnotations } from "@modelcontextprotocol/server"

import { CONFIG_RECIPES } from "../src/config-recipes.js"
import {
  CONNECTOR_LIMITS,
  MCP_ALWAYS_AVAILABLE_TOOL_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_DOCUMENTATION_SEARCH_TOOL_NAME,
} from "../src/constants.js"
import {
  MCP_TOOL_ACCESS_STAGES,
  MCP_TOOL_CATALOG,
  createMcpToolAccessDocument,
  createMcpToolAccessIndex,
  createMcpToolAccessManifest,
  createDiscordToolDiscoveryCatalog,
  discoverDiscordTools,
  mcpToolAccessEntry,
  mcpToolAccessContract,
  mcpToolUseGuidance,
  type CanonicalMcpToolName,
  type TrackedMcpTool,
} from "../src/mcp-tool-catalog.js"
import { mcpToolStaticRequirements } from "../src/mcp-tool-readiness.js"
import { SETUP_PRESETS } from "../src/setup-presets.js"

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

test("tool discovery prefers caller-retained multi-channel catch-up", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({
      description: "Catch up across bounded exact Discord channels with independent cursors",
      name: "catch_up_messages",
      title: "Catch up across Discord channels",
    }),
    trackedTool({
      description: "Read one bounded page of Discord messages",
      name: "read_messages",
      title: "Read Discord messages",
    }),
  ], "full")

  const result = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "catch up on new unread messages across channels",
  }, catalog)

  assert.equal(result.matches[0]?.name, "catch_up_messages")
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
    trackedTool({
      name: "get_guild_vanity_url",
      title: "Audit privacy-bounded Discord guild vanity URL",
    }),
    trackedTool({ name: "plan_channel_creation", title: "Plan channel creation" }),
  ], "full")

  const variants = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "reorder roles",
  }, catalog)
  assert.equal(variants.matches[0]?.name, "execute_role_order")

  const terse = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "messages",
  }, catalog)
  assert.equal(terse.matches.some(({ name }) => name === "read_messages"), true)

  const vanity = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "check vanity invite uses",
  }, catalog)
  assert.equal(vanity.matches[0]?.name, "get_guild_vanity_url")

  const weak = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "create an entire Discord server",
  }, catalog)
  assert.deepEqual(weak.matches, [])
})

test("tool discovery distinguishes one reaction from an additive reaction set", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({
      description: "Add one own Discord reaction",
      name: "add_reaction",
      title: "Add one reaction",
    }),
    trackedTool({
      description: "Add an ordered unique set of own Discord reactions",
      name: "add_reactions",
      title: "Add multiple reactions",
    }),
  ], "full")

  const result = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "add multiple emoji reactions as a status menu",
  }, catalog)

  assert.equal(result.matches[0]?.name, "add_reactions")
})

test("tool discovery routes Discord task handoffs to bounded direct replies", () => {
  const catalog = createDiscordToolDiscoveryCatalog([
    trackedTool({
      description: "Inspect one bounded page of direct replies to an exact task message",
      name: "list_message_replies",
      title: "List exact Discord message replies",
    }),
    trackedTool({
      description: "List aggregate emoji reactions on one message",
      name: "list_message_reactions",
      title: "List message reactions",
    }),
  ], "full")

  const result = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "inspect replies to a coordination task handoff",
  }, catalog)

  assert.equal(result.matches[0]?.name, "list_message_replies")
})

test("tool discovery promotes reviewed execute entry points without crossing exact risk filters", () => {
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
  assert.equal(natural.matches[0]?.name, "delete_messages")

  const readOnly = discoverDiscordTools({
    detail: "compact",
    limit: 1,
    query: "delete a message",
    risk: "external-read",
  }, catalog)
  assert.equal(readOnly.matches[0]?.name, "plan_message_deletion")

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

  const exactPlan = discoverDiscordTools({
    detail: "compact",
    limit: 5,
    query: "plan_message_deletion",
  }, catalog)
  assert.deepEqual(exactPlan.matches.map(({ name }) => name), ["plan_message_deletion"])
  assert.equal(
    exactPlan.matches[0]?.access.guidance.preferredNextTool,
    "delete_messages",
  )
})

test("tool access manifest classifies every tool and binds reviewed companions", () => {
  const manifest = createMcpToolAccessManifest()
  const requirementsUriTemplate = "discord://connector/tool-access/{toolName}"
  const index = createMcpToolAccessIndex(requirementsUriTemplate)
  assert.equal(
    manifest.entries.length,
    Object.keys(MCP_TOOL_CATALOG).length + MCP_ALWAYS_AVAILABLE_TOOL_NAMES.length,
  )
  assert.equal(manifest.entries[0]?.name, "add_reaction")
  assert.equal(
    manifest.entries.some(({ name }) => name === MCP_DISCOVERY_TOOL_NAME),
    true,
  )
  assert.equal(
    manifest.entries.some(({ name }) => name === MCP_DOCUMENTATION_SEARCH_TOOL_NAME),
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
  assert.deepEqual(manifest.requirementCoverage, {
    authenticationCounts: Object.fromEntries(
      ["bot", "bot-and-stored-webhook-token", "none", "short-lived-interaction-token"]
        .map((name) => [name, manifest.entries.filter(({ requirements }) => (
          requirements.authentication === name
        )).length]),
    ),
    complete: true,
    exactToolEntries: manifest.entries.filter(({ requirements }) => (
      requirements.source === "exact-tool"
    )).length,
    permissionModeCounts: Object.fromEntries(
      ["all-listed", "conditional", "delegated-runtime", "none"]
        .map((name) => [name, manifest.entries.filter(({ requirements }) => (
          requirements.discord.permissionMode === name
        )).length]),
    ),
    targetAccessProven: false,
    targetScopeCounts: Object.fromEntries(
      ["application", "channel", "guild", "interaction", "local", "user", "webhook"]
        .map((name) => [name, manifest.entries.filter(({ requirements }) => (
          requirements.targetScope === name
        )).length]),
    ),
    toolsetEntries: manifest.entries.filter(({ requirements }) => (
      requirements.source === "toolset"
    )).length,
    unknownEntries: 0,
  })
  assert.equal(
    manifest.requirementCoverage.exactToolEntries
      + manifest.requirementCoverage.toolsetEntries,
    manifest.entries.length,
  )
  assert.deepEqual(index.entries, manifest.entries.map(({
    name,
    stage,
    toolset,
    workflow,
  }) => ({ name, stage, toolset, workflow })))
  assert.deepEqual(index.exactRequirementToolNames, manifest.entries
    .filter(({ requirements }) => requirements.source === "exact-tool")
    .map(({ name }) => name))
  assert.deepEqual(index.requirementsResource, {
    uriTemplate: requirementsUriTemplate,
    variable: "toolName",
  })
  assert.deepEqual(index.requirementCoverage, manifest.requirementCoverage)
  assert.deepEqual(index.stageContracts, manifest.stageContracts)
  assert.deepEqual(index.workflows, manifest.workflows)
  assert.equal(index.entries.every((entry) => !("requirements" in entry)), true)
  const channelOrderDocument = createMcpToolAccessDocument(
    "execute_channel_order",
  )
  assert.deepEqual(
    channelOrderDocument.entry,
    mcpToolAccessEntry("execute_channel_order"),
  )
  assert.equal(channelOrderDocument.authorityGranted, false)
  assert.equal(channelOrderDocument.discordContacted, false)
  assert.equal(
    createMcpToolAccessDocument("get_gateway_status").readiness,
    "not-applicable",
  )
  assert.deepEqual(manifest.stageContracts["review-execute"], {
    approval: "host-write-and-signed-interactive",
    authorizationEvidence: "fresh-plan-recheck",
    discordRequest: "write",
    planDigestInput: "computed-by-execute-or-explicit",
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
      .length + MCP_ALWAYS_AVAILABLE_TOOL_NAMES.length,
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
    guidance: mcpToolUseGuidance("get_gateway_status"),
    planDigestInput: "not-applicable",
    readiness: "not-applicable",
    requirements: mcpToolStaticRequirements("get_gateway_status", "gateway"),
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
    guidance: mcpToolUseGuidance("plan_message_deletion"),
    planDigestInput: "not-applicable",
    readiness: "target-specific",
    requirements: mcpToolStaticRequirements("plan_message_deletion", "deletion"),
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
    guidance: mcpToolUseGuidance("delete_messages"),
    planDigestInput: "computed-by-execute-or-explicit",
    readiness: "target-specific",
    requirements: mcpToolStaticRequirements("delete_messages", "deletion"),
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
    guidance: mcpToolUseGuidance("send_message"),
    planDigestInput: "not-applicable",
    readiness: "target-specific",
    requirements: mcpToolStaticRequirements("send_message", "message-writes"),
    stage: "guarded-write",
  })
  assert.deepEqual(mcpToolUseGuidance("plan_message_deletion"), {
    impact: "destructive-or-high-impact-discord-write",
    impactLabel: "Destructive or high-impact Discord change",
    impactSummary: "Performs a destructive, authority-changing, or otherwise high-impact Discord mutation",
    preferredNextAction: "call-tool",
    preferredNextTool: "delete_messages",
    preferredNextToolReason: "The execute tool prepares a fresh plan internally and requests signed review before any write",
    reviewRequirement: "signed-interactive-review",
    workflowRole: "plan",
  })
  assert.deepEqual(mcpToolUseGuidance("send_message"), {
    impact: "visible-discord-write",
    impactLabel: "Visible Discord write",
    impactSummary: "Creates or changes user-visible Discord interaction content",
    preferredNextAction: "call-tool",
    preferredNextTool: "send_message",
    preferredNextToolReason: "This tool performs the bounded write after MCP host write approval",
    reviewRequirement: "host-write-approval",
    workflowRole: "standalone",
  })
})

test("tool readiness distinguishes static setup, credentials, and live proof", () => {
  const manifest = createMcpToolAccessManifest()
  const byName = new Map(manifest.entries.map((entry) => [entry.name, entry]))

  assert.deepEqual(
    byName.get("send_message")?.requirements.configuration.recipeNames,
    ["message-channel"],
  )
  assert.deepEqual(byName.get("send_message")?.requirements.discord.intents, [])

  assert.deepEqual(byName.get("get_gateway_status")?.requirements.discord, {
    conditions: [],
    hierarchy: "not-applicable",
    intents: [],
    permissionMode: "none",
    permissions: [],
    verification: "not-applicable",
  })
  assert.equal(
    byName.get("send_webhook_message")?.requirements.authentication,
    "bot-and-stored-webhook-token",
  )
  assert.deepEqual(
    byName.get("send_webhook_message")?.requirements.discord.permissions,
    ["VIEW_CHANNEL"],
  )
  assert.deepEqual(
    byName.get("send_webhook_message")?.requirements.configuration.policyPaths,
    [
      "$.capabilities.webhookMessageDelivery",
      "$.readScope.channelIds",
      "$.readScope.guildIds",
      "$.scopes.webhookMessageChannelIds",
      "$.storage.webhookCredentialRoot",
    ],
  )
  assert.equal(
    byName.get("get_connector_status")?.requirements.authentication,
    "bot",
  )
  assert.deepEqual(
    byName.get("get_connector_status")?.requirements.configuration.policyPaths,
    ["$.readScope.guildIds"],
  )
  assert.equal(
    byName.get("audit_application_commands")?.requirements.targetScope,
    "guild",
  )
  assert.deepEqual(
    byName.get("inspect_application_activity_instance")?.requirements.configuration.policyPaths,
    ["$.readScope.channelIds", "$.readScope.guildIds"],
  )
  assert.equal(
    byName.get("respond_to_discord_interaction")?.requirements.authentication,
    "short-lived-interaction-token",
  )
  assert.deepEqual(
    byName.get("plan_bulk_guild_ban")?.requirements.discord.permissions,
    ["BAN_MEMBERS", "MANAGE_GUILD"],
  )
  assert.equal(
    byName.get("plan_bulk_guild_ban")?.requirements.discord.hierarchy,
    "required",
  )
  assert.deepEqual(
    byName.get("read_messages")?.requirements.configuration.presetNames,
    ["channel-reader"],
  )
  assert.deepEqual(
    byName.get("catch_up_messages")?.requirements.configuration.presetNames,
    ["channel-reader"],
  )
  assert.deepEqual(
    byName.get("catch_up_messages")?.requirements.discord,
    {
      conditions: [{
        case: "voice-or-stage-channel",
        permissions: ["CONNECT"],
      }],
      hierarchy: "not-applicable",
      intents: [{
        name: "MESSAGE_CONTENT",
        privileged: true,
        status: "required",
      }],
      permissionMode: "conditional",
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      verification: "operation-runtime",
    },
  )
  assert.deepEqual(
    byName.get("list_message_replies")?.requirements.configuration.presetNames,
    ["channel-reader"],
  )
  assert.deepEqual(
    byName.get("list_message_replies")?.requirements.discord,
    {
      conditions: [],
      hierarchy: "not-applicable",
      intents: [{
        name: "MESSAGE_CONTENT",
        privileged: true,
        status: "recommended",
      }],
      permissionMode: "all-listed",
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      verification: "operation-runtime",
    },
  )
  assert.deepEqual(
    byName.get("create_coordination_address")?.requirements,
    {
      authentication: "none",
      configuration: {
        evaluation: "operation-runtime",
        policyPaths: [],
        presetNames: [],
        recipeNames: ["coordination-channel"],
      },
      discord: {
        conditions: [],
        hierarchy: "not-applicable",
        intents: [],
        permissionMode: "none",
        permissions: [],
        verification: "not-applicable",
      },
      source: "exact-tool",
      targetScope: "local",
    },
  )
  assert.deepEqual(
    byName.get("list_coordination_addresses")?.requirements,
    byName.get("list_coordination_notes")?.requirements,
  )
  assert.deepEqual(
    byName.get("list_coordination_notes")?.requirements.discord,
    {
      conditions: [],
      hierarchy: "not-applicable",
      intents: [],
      permissionMode: "all-listed",
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      verification: "operation-runtime",
    },
  )
  assert.deepEqual(
    byName.get("send_coordination_note")?.requirements.configuration.policyPaths,
    [
      "$.capabilities.interactions",
      "$.readScope.channelIds",
      "$.readScope.guildIds",
      "$.scopes.interactionChannelIds",
      "$.scopes.mentionUserIds",
    ],
  )
  assert.deepEqual(
    byName.get("send_coordination_note")?.requirements.configuration.recipeNames,
    ["coordination-channel"],
  )
  assert.deepEqual(
    byName.get("send_coordination_note")?.requirements.discord,
    {
      conditions: [
        { case: "direct-channel", permissions: ["SEND_MESSAGES"] },
        { case: "thread-channel", permissions: ["SEND_MESSAGES_IN_THREADS"] },
      ],
      hierarchy: "not-applicable",
      intents: [],
      permissionMode: "conditional",
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      verification: "operation-runtime",
    },
  )
  assert.deepEqual(
    byName.get("plan_guild_blueprint")?.requirements.configuration.recipeNames,
    ["guild-starter", "guild-builder"],
  )
  assert.deepEqual(
    byName.get("compile_guild_blueprint_starter")?.requirements.configuration.recipeNames,
    ["guild-starter", "guild-builder"],
  )
  assert.deepEqual(
    byName.get("capture_guild_blueprint")?.requirements.configuration.recipeNames,
    ["guild-builder"],
  )
  assert.equal(
    byName.get("plan_guild_blueprint")?.requirements.discord.permissionMode,
    "delegated-runtime",
  )
  assert.deepEqual(
    byName.get("plan_component_message")?.requirements.discord.permissions,
    ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
  )
  assert.deepEqual(
    byName.get("plan_component_message")?.requirements.discord.conditions,
    [
      { case: "direct-channel", permissions: ["SEND_MESSAGES"] },
      { case: "thread-channel", permissions: ["SEND_MESSAGES_IN_THREADS"] },
    ],
  )
  assert.deepEqual(
    byName.get("verify_component_message")?.requirements.discord.conditions,
    [],
  )
  assert.deepEqual(
    byName.get("list_voice_regions")?.requirements.configuration.policyPaths,
    [],
  )
  assert.deepEqual(
    byName.get("list_default_soundboard_sounds")?.requirements.configuration.policyPaths,
    ["$.capabilities.soundboardAudit"],
  )
  assert.deepEqual(
    byName.get("get_current_bot_profile")?.requirements.configuration.policyPaths,
    ["$.capabilities.botProfileAudit"],
  )
  assert.deepEqual(
    byName.get("parse_discord_reference")?.requirements.configuration.policyPaths,
    ["$.readScope.channelIds", "$.readScope.guildIds"],
  )
  assert.deepEqual(
    byName.get("add_reaction")?.requirements.discord.conditions,
    [{
      case: "reaction-not-already-present",
      permissions: ["ADD_REACTIONS"],
    }],
  )
  assert.deepEqual(
    byName.get("add_reactions")?.requirements,
    byName.get("add_reaction")?.requirements,
  )
  assert.deepEqual(
    byName.get("list_archived_threads")?.requirements.discord,
    {
      conditions: [{ case: "private-archive", permissions: ["MANAGE_THREADS"] }],
      hierarchy: "not-applicable",
      intents: [],
      permissionMode: "conditional",
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      verification: "operation-runtime",
    },
  )
  for (const entry of manifest.entries) {
    if (entry.requirements.targetScope === "guild") {
      assert.equal(
        entry.requirements.configuration.policyPaths.includes("$.readScope.guildIds"),
        true,
      )
    }
    if (entry.requirements.targetScope === "channel") {
      assert.equal(
        entry.requirements.configuration.policyPaths.includes("$.readScope.guildIds")
          && entry.requirements.configuration.policyPaths.includes("$.readScope.channelIds"),
        true,
      )
    }
  }
  assert.equal(
    manifest.entries.every(({ requirements }) => (
      requirements.discord.verification === "not-applicable"
        ? requirements.authentication === "none"
        : requirements.authentication !== "none"
    )),
    true,
  )
  assert.deepEqual(
    manifest.entries.filter(({ stage, requirements }) => (
      stage === "local" && requirements.authentication !== "none"
      || stage !== "local" && requirements.authentication === "none"
    )),
    [],
  )
  assert.equal(
    manifest.entries.every(({ requirements }) => (
      Object.isFrozen(requirements)
      && Object.isFrozen(requirements.configuration)
      && Object.isFrozen(requirements.configuration.policyPaths)
      && Object.isFrozen(requirements.discord)
      && Object.isFrozen(requirements.discord.conditions)
      && requirements.discord.conditions.every(Object.isFrozen)
      && Object.isFrozen(requirements.discord.intents)
      && requirements.discord.intents.every(Object.isFrozen)
      && Object.isFrozen(requirements.discord.permissions)
    )),
    true,
  )
  for (const entry of manifest.entries) {
    for (const presetName of entry.requirements.configuration.presetNames) {
      const preset = SETUP_PRESETS.find(({ name }) => name === presetName)
      assert.ok(preset)
      assert.equal(preset.toolNames.includes(entry.name), true)
    }
    for (const recipeName of entry.requirements.configuration.recipeNames) {
      const recipe = CONFIG_RECIPES.find(({ name }) => name === recipeName)
      assert.ok(recipe)
      assert.equal(recipe.toolNames.includes(entry.name), true)
    }
  }
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
