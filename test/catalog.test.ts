import assert from "node:assert/strict"
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
  CATALOG_ONLY_ERROR_CODE,
  checkDiscordCatalog,
  createDiscordCatalogServer,
} from "../src/catalog.js"
import {
  ENVIRONMENT_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_RESOURCE_TEMPLATE_URIS,
  selectedMcpPromptNames,
} from "../src/mcp-guidance.js"
import { selectedCanonicalMcpToolNames } from "../src/mcp-tool-catalog.js"

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

function restoreEnvironment(
  before: ReadonlyMap<string, string | undefined>,
): void {
  for (const [name, value] of before) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

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
  })
})

test("catalog serves local guidance while live resources remain isolated", async () => {
  await withCatalogClient(async (client) => {
    const safety = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
    const policy = await client.readResource({ uri: MCP_RESOURCE_URIS.policy })
    const prompt = await client.getPrompt({
      arguments: { channelId: CHANNEL_ID },
      name: MCP_PROMPT_NAMES.summarizeChannel,
    })

    assert.equal(safety.contents.length, 1)
    assert.match("text" in safety.contents[0]! ? safety.contents[0].text : "", /review-first workflows/)
    assert.equal(policy.contents.length, 1)
    assert.doesNotMatch(JSON.stringify(policy), /catalog-only-placeholder/)
    assert.ok(prompt.messages.length > 0)
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

test("catalog self-check ignores hostile ambient credentials, policy, Gateway, telemetry, and activity paths", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-catalog-test-"))
  const activityFile = join(temporaryDirectory, "activity.jsonl")
  const ambientSecret = "ambient-catalog-secret"
  const overrides = new Map<string, string>([
    [ENVIRONMENT_NAMES.token, ambientSecret],
    [ENVIRONMENT_NAMES.allowGateway, "true"],
    [ENVIRONMENT_NAMES.applicationId, "invalid"],
    [ENVIRONMENT_NAMES.toolsets, "connector"],
    [ENVIRONMENT_NAMES.toolSurface, "progressive"],
    [ENVIRONMENT_NAMES.allowObservabilityExport, "true"],
    [ENVIRONMENT_NAMES.otelEndpoint, "not-a-url"],
    [ENVIRONMENT_NAMES.auditFile, activityFile],
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

    assert.equal(report.status, "ok")
    assert.equal(report.credentialsRequired, false)
    assert.equal(report.discordExecution, "disabled")
    assert.equal(report.executionGuard, CATALOG_ONLY_ERROR_CODE)
    assert.equal(report.gateway, "disabled")
    assert.equal(report.observabilityExport, "disabled")
    assert.equal(report.activityRecordsCreated, false)
    assert.equal(report.toolCount, EXPECTED_TOOL_NAMES.length)
    assert.equal(report.promptCount, EXPECTED_PROMPT_NAMES.length)
    assert.equal(report.resourceCount, EXPECTED_RESOURCE_URIS.length)
    assert.equal(report.resourceTemplateCount, EXPECTED_RESOURCE_TEMPLATE_URIS.length)
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
