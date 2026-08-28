import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"

import {
  CATALOG_EVIDENCE_FORMAT,
  CATALOG_ONLY_ERROR_CODE,
  checkDiscordCatalog,
  createDiscordCatalogServer,
} from "../src/catalog.js"
import {
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import { MCP_POLICY_COMPLETION_BINDINGS } from "../src/mcp-completions.js"
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_RESOURCE_TEMPLATE_URIS,
  selectedMcpPromptNames,
} from "../src/mcp-guidance.js"
import {
  MCP_APP_EXTENSION_ID,
  MCP_PLAN_REVIEW_APP_HTML,
  MCP_PLAN_REVIEW_APP_MIME_TYPE,
  MCP_PLAN_REVIEW_APP_RESOURCE_META,
  MCP_PLAN_REVIEW_APP_URI,
  MCP_PLAN_REVIEW_TOOL_META,
  MCP_PLAN_REVIEW_TOOL_NAMES,
  isPlanReviewToolName,
} from "../src/mcp-plan-review-app.js"
import { DISCORD_MCP_RECEIPT_PREFIX } from "../src/mcp-output.js"
import {
  createMcpToolAccessManifest,
  selectedCanonicalMcpToolNames,
} from "../src/mcp-tool-catalog.js"
import { stableString } from "../src/normalize.js"
import {
  DISCORD_REST_OPERATIONS,
  MCP_TOOL_RISK_CLASSES,
} from "../src/observability-catalog.js"

const CHANNEL_ID = "200000000000000001"
const EXPECTED_TOOL_NAMES = [
  ...selectedCanonicalMcpToolNames(new Set(MCP_TOOLSET_NAMES)),
  MCP_DISCOVERY_TOOL_NAME,
].sort()
const EXPECTED_PROMPT_NAMES = selectedMcpPromptNames(
  new Set(MCP_TOOLSET_NAMES),
).sort()
const EXPECTED_RESOURCE_URIS = Object.values(MCP_RESOURCE_URIS).sort()
const EXPECTED_RESOURCE_TEMPLATE_URIS = Object.values(
  MCP_RESOURCE_TEMPLATE_URIS,
).sort()
const REQUIRED_ANNOTATIONS = [
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
  "readOnlyHint",
] as const
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

async function withCatalogClient(
  callback: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createDiscordCatalogServer()
  const client = new Client(
    { name: "catalog-test-client", version: "1.0.0" },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    await callback(client)
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort()
}

function sortedByIdentity<T>(
  values: readonly T[],
  identity: (value: T) => string,
): T[] {
  return [...values].sort((left, right) => {
    const leftIdentity = identity(left)
    const rightIdentity = identity(right)
    if (leftIdentity < rightIdentity) return -1
    if (leftIdentity > rightIdentity) return 1
    return 0
  })
}

function evidenceDigest(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown
  return `sha256:${createHash("sha256").update(stableString(normalized)).digest("hex")}`
}

function textDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function restoreEnvironment(
  before: ReadonlyMap<string, string | undefined>,
): void {
  for (const [name, value] of before) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

test("domain prompts retain toolset boundaries while goal routing spans configured toolsets", () => {
  assert.deepEqual(
    selectedMcpPromptNames(new Set(["guild-blueprints"])).sort(),
    [
      MCP_PROMPT_NAMES.authorGuildBlueprint,
      MCP_PROMPT_NAMES.reviewGuildBlueprint,
      MCP_PROMPT_NAMES.routeDiscordGoal,
    ].sort(),
  )
  assert.equal(
    selectedMcpPromptNames(new Set(["messages"]))
      .includes(MCP_PROMPT_NAMES.authorGuildBlueprint),
    false,
  )
  assert.equal(
    selectedMcpPromptNames(new Set(["messages"]))
      .includes(MCP_PROMPT_NAMES.routeDiscordGoal),
    true,
  )
  assert.equal(
    selectedMcpPromptNames(new Set())
      .includes(MCP_PROMPT_NAMES.routeDiscordGoal),
    false,
  )
})

test("credential-free catalog exposes every exact production contract with complete metadata", async () => {
  await withCatalogClient(async (client) => {
    const [tools, prompts, resources, templates] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
      client.listResourceTemplates(),
    ])

    assert.deepEqual(sorted(tools.tools.map((tool) => tool.name)), EXPECTED_TOOL_NAMES)
    assert.deepEqual(sorted(prompts.prompts.map((prompt) => prompt.name)), EXPECTED_PROMPT_NAMES)
    assert.deepEqual(sorted(resources.resources.map((resource) => resource.uri)), EXPECTED_RESOURCE_URIS)
    assert.deepEqual(
      sorted(templates.resourceTemplates.map((template) => template.uriTemplate)),
      EXPECTED_RESOURCE_TEMPLATE_URIS,
    )
    assert.equal(new Set(tools.tools.map((tool) => tool.name)).size, tools.tools.length)
    for (const tool of tools.tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} input schema`)
      assert.equal(tool.outputSchema?.type, "object", `${tool.name} output schema`)
      assert.ok(tool.description?.trim(), `${tool.name} description`)
      assert.ok(tool.title?.trim(), `${tool.name} title`)
      for (const annotation of REQUIRED_ANNOTATIONS) {
        assert.equal(typeof tool.annotations?.[annotation], "boolean", `${tool.name} ${annotation}`)
      }
    }

    assert.match(client.getInstructions() || "", /credential-free catalog/)
    assert.match(client.getInstructions() || "", /every tools\/call request returns the fixed CATALOG_ONLY result/)
    assert.match(client.getInstructions() || "", /operational serve command/)
    assert.deepEqual(client.getServerCapabilities()?.completions, {})
    assert.deepEqual(
      client.getServerCapabilities()?.extensions?.[MCP_APP_EXTENSION_ID],
      { mimeTypes: [MCP_PLAN_REVIEW_APP_MIME_TYPE] },
    )
    for (const tool of tools.tools) {
      if (isPlanReviewToolName(tool.name)) {
        assert.deepEqual(tool._meta, MCP_PLAN_REVIEW_TOOL_META, tool.name)
      } else {
        assert.equal(tool._meta?.ui, undefined, tool.name)
      }
      assert.equal(tool._meta?.["ui/resourceUri"], undefined, tool.name)
    }
  })
})

test("catalog guards listed, invalid, discovery, and unknown tool calls identically", async () => {
  await withCatalogClient(async (client) => {
    await client.listTools()
    const results = await Promise.all([
      client.callTool({ arguments: {}, name: "read_messages" }),
      client.callTool({ arguments: { query: "messages" }, name: MCP_DISCOVERY_TOOL_NAME }),
      client.callTool({ arguments: { ignored: true }, name: "unknown_catalog_probe" }),
    ])

    assert.deepEqual(results[1], results[0])
    assert.deepEqual(results[2], results[0])
    assert.equal(results[0]?.isError, true)
    assert.deepEqual(results[0]?.structuredContent, {
      error: {
        category: "client",
        code: CATALOG_ONLY_ERROR_CODE,
        recoveryHint: "Use discord-mcp serve with credentialed configuration to execute tools",
        retriable: false,
      },
      schemaVersion: 1,
      status: "catalog-only",
    })
    assert.equal(results[0]?.content.length, 2)
    const receipt = results[0]?.content[1]
    assert.equal(receipt?.type, "text")
    if (receipt?.type === "text") {
      assert.ok(receipt.text.startsWith(DISCORD_MCP_RECEIPT_PREFIX))
      assert.equal(receipt.text.includes(CATALOG_ONLY_ERROR_CODE), true)
    }
  })
})

test("catalog serves local guidance while live resources remain isolated", async () => {
  await withCatalogClient(async (client) => {
    const safety = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
    const componentTemplates = await client.readResource({
      uri: MCP_RESOURCE_URIS.componentTemplates,
    })
    const toolAccess = await client.readResource({
      uri: MCP_RESOURCE_URIS.toolAccess,
    })
    const planReviewApp = await client.readResource({ uri: MCP_PLAN_REVIEW_APP_URI })
    const policy = await client.readResource({ uri: MCP_RESOURCE_URIS.policy })
    const prompt = await client.getPrompt({
      arguments: { channelId: CHANNEL_ID },
      name: MCP_PROMPT_NAMES.summarizeChannel,
    })
    const [resourceCompletion, promptCompletion] = await Promise.all([
      client.complete({
        argument: { name: "guildId", value: "" },
        ref: {
          type: "ref/resource",
          uri: MCP_RESOURCE_TEMPLATE_URIS.guildChannels,
        },
      }),
      client.complete({
        argument: { name: "channelId", value: "" },
        ref: {
          name: MCP_PROMPT_NAMES.summarizeChannel,
          type: "ref/prompt",
        },
      }),
    ])

    assert.equal(safety.contents.length, 1)
    assert.match("text" in safety.contents[0]! ? safety.contents[0].text : "", /review-first workflows/)
    assert.equal(componentTemplates.contents.length, 1)
    assert.match(
      "text" in componentTemplates.contents[0]!
        ? componentTemplates.contents[0].text
        : "",
      /compile_component_template/,
    )
    assert.equal(toolAccess.contents.length, 1)
    const toolAccessContent = toolAccess.contents[0]
    assert.ok(toolAccessContent && "text" in toolAccessContent)
    if (!toolAccessContent || !("text" in toolAccessContent)) {
      throw new Error("Expected tool access resource text")
    }
    assert.deepEqual(
      (JSON.parse(toolAccessContent.text) as Record<string, unknown>).data,
      createMcpToolAccessManifest(),
    )
    assert.deepEqual(planReviewApp.contents, [{
      _meta: MCP_PLAN_REVIEW_APP_RESOURCE_META,
      mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
      text: MCP_PLAN_REVIEW_APP_HTML,
      uri: MCP_PLAN_REVIEW_APP_URI,
    }])
    assert.equal(policy.contents.length, 1)
    assert.doesNotMatch(JSON.stringify(policy), /catalog-only-placeholder/)
    assert.ok(prompt.messages.length > 0)
    assert.deepEqual(resourceCompletion.completion.values, [])
    assert.deepEqual(promptCompletion.completion.values, [])
    await assert.rejects(
      client.readResource({ uri: MCP_RESOURCE_URIS.guilds }),
      /CATALOG_ONLY/,
    )
    await assert.rejects(
      client.readResource({ uri: MCP_RESOURCE_URIS.activity }),
      /CATALOG_ONLY/,
    )
    await assert.rejects(
      client.readResource({ uri: MCP_RESOURCE_URIS.gatewayStatus }),
      /CATALOG_ONLY/,
    )
    await assert.rejects(
      client.readResource({ uri: MCP_RESOURCE_URIS.gatewayEvents }),
      /CATALOG_ONLY/,
    )
    await assert.rejects(
      client.readResource({ uri: MCP_RESOURCE_URIS.observability }),
      /CATALOG_ONLY/,
    )
  })
})

test("catalog evidence digest binds the normalized advertised contract and safety response", async () => {
  let expectedContractDigest = ""
  let expectedSafetyResourceDigest = ""
  let expectedToolAccessResourceDigest = ""
  await withCatalogClient(async (client) => {
    const [tools, prompts, resources, templates] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
      client.listResourceTemplates(),
    ])
    const safety = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
    const toolAccessResource = await client.readResource({
      uri: MCP_RESOURCE_URIS.toolAccess,
    })
    const planReviewAppResource = await client.readResource({
      uri: MCP_PLAN_REVIEW_APP_URI,
    })
    const executionGuard = await client.callTool({
      arguments: {},
      name: "read_messages",
    })
    expectedContractDigest = evidenceDigest({
      completionBindings: MCP_POLICY_COMPLETION_BINDINGS,
      executionGuard,
      instructions: client.getInstructions() || "",
      prompts: sortedByIdentity(prompts.prompts, (prompt) => prompt.name),
      resourceTemplates: sortedByIdentity(
        templates.resourceTemplates,
        (template) => template.uriTemplate,
      ),
      resources: sortedByIdentity(resources.resources, (resource) => resource.uri),
      planReviewAppResource,
      safetyResource: safety,
      serverCapabilities: client.getServerCapabilities(),
      toolAccessResource,
      tools: sortedByIdentity(tools.tools, (tool) => tool.name),
    })
    expectedSafetyResourceDigest = evidenceDigest(safety)
    expectedToolAccessResourceDigest = evidenceDigest(toolAccessResource)
  })

  const report = await checkDiscordCatalog()
  assert.equal(report.contractDigest, expectedContractDigest)
  assert.equal(report.safetyResourceDigest, expectedSafetyResourceDigest)
  assert.equal(report.toolAccessResourceDigest, expectedToolAccessResourceDigest)
})

test("catalog self-check ignores hostile ambient credentials and unrelated settings", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-catalog-test-"))
  const activityFile = join(temporaryDirectory, "activity.jsonl")
  const ambientSecret = "ambient-catalog-secret"
  const overrides = new Map<string, string>([
    [DEFAULT_TOKEN_ENVIRONMENT_VARIABLE, ambientSecret],
    [CONFIG_FILE_ENVIRONMENT_VARIABLE, activityFile],
  ])
  const before = new Map(
    [...overrides].map(([name]) => [name, process.env[name]] as const),
  )
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    for (const [name, value] of overrides) process.env[name] = value
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error("Catalog attempted network access")
    }) as typeof fetch

    const report = await checkDiscordCatalog()
    const repeatedReport = await checkDiscordCatalog()

    assert.deepEqual(repeatedReport, report)
    assert.equal(report.status, "ok")
    assert.equal(report.evidenceFormat, CATALOG_EVIDENCE_FORMAT)
    assert.equal(report.credentialsRequired, false)
    assert.equal(report.discordExecution, "disabled")
    assert.equal(report.executionGuard, CATALOG_ONLY_ERROR_CODE)
    assert.equal(report.gateway, "disabled")
    assert.equal(report.observabilityExport, "disabled")
    assert.deepEqual(report.planReviewApp, {
      externalNetworkDomains: [],
      extensionId: MCP_APP_EXTENSION_ID,
      htmlDigest: textDigest(MCP_PLAN_REVIEW_APP_HTML),
      linkedToolCount: MCP_PLAN_REVIEW_TOOL_NAMES.length,
      linkedToolNames: [...MCP_PLAN_REVIEW_TOOL_NAMES],
      mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
      permissions: [],
      resourceDigest: evidenceDigest({
        contents: [{
          _meta: MCP_PLAN_REVIEW_APP_RESOURCE_META,
          mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
          text: MCP_PLAN_REVIEW_APP_HTML,
          uri: MCP_PLAN_REVIEW_APP_URI,
        }],
      }),
      resourceUri: MCP_PLAN_REVIEW_APP_URI,
      serverToolAuthority: false,
      toolVisibility: ["model"],
    })
    assert.equal(report.activityRecordsCreated, false)
    assert.equal(report.completionBindingCount, MCP_POLICY_COMPLETION_BINDINGS.length)
    assert.equal(report.completionCatalogValuesExposed, false)
    assert.deepEqual(report.completionBindings, MCP_POLICY_COMPLETION_BINDINGS)
    assert.equal(report.toolCount, EXPECTED_TOOL_NAMES.length)
    assert.deepEqual(report.toolNames, EXPECTED_TOOL_NAMES)
    assert.equal(report.promptCount, EXPECTED_PROMPT_NAMES.length)
    assert.deepEqual(report.promptNames, EXPECTED_PROMPT_NAMES)
    assert.equal(report.resourceCount, EXPECTED_RESOURCE_URIS.length)
    assert.deepEqual(report.resourceUris, EXPECTED_RESOURCE_URIS)
    assert.equal(report.resourceTemplateCount, EXPECTED_RESOURCE_TEMPLATE_URIS.length)
    assert.deepEqual(report.resourceTemplateUris, EXPECTED_RESOURCE_TEMPLATE_URIS)
    assert.deepEqual(report.toolsetNames, [...MCP_TOOLSET_NAMES].sort())
    assert.match(report.contractDigest, SHA256_DIGEST_PATTERN)
    assert.match(report.safetyResourceDigest, SHA256_DIGEST_PATTERN)
    assert.match(report.toolAccessResourceDigest, SHA256_DIGEST_PATTERN)
    assert.notEqual(report.contractDigest, report.safetyResourceDigest)
    assert.notEqual(report.contractDigest, report.toolAccessResourceDigest)
    assert.deepEqual(
      report.accessStageCounts,
      createMcpToolAccessManifest().stageCounts,
    )
    assert.equal(
      Object.values(report.accessStageCounts).reduce((total, count) => total + count, 0),
      report.toolCount,
    )
    assert.deepEqual(
      report.riskClassCounts,
      Object.fromEntries(
        Object.values(MCP_TOOL_RISK_CLASSES)
          .sort()
          .reduce((entries, riskClass) => {
            entries.set(riskClass, (entries.get(riskClass) || 0) + 1)
            return entries
          }, new Map<string, number>()),
      ),
    )
    assert.equal(
      Object.values(report.riskClassCounts).reduce((total, count) => total + count, 0),
      report.toolCount,
    )
    assert.equal(report.restOperationCount, Object.keys(DISCORD_REST_OPERATIONS).length)
    assert.equal(
      Object.values(report.restMethodCounts).reduce((total, count) => total + count, 0),
      report.restOperationCount,
    )
    assert.equal(fetchCalls, 0)
    assert.doesNotMatch(JSON.stringify(report), new RegExp(ambientSecret))
    assert.doesNotMatch(JSON.stringify(report), new RegExp(temporaryDirectory))
    await assert.rejects(stat(activityFile), { code: "ENOENT" })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment(before)
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})
