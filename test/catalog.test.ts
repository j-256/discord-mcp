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
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
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

test("catalog evidence digest binds the normalized advertised contract and safety response", async () => {
  let expectedContractDigest = ""
  let expectedSafetyResourceDigest = ""
  await withCatalogClient(async (client) => {
    const [tools, prompts, resources, templates] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
      client.listResourceTemplates(),
    ])
    const safety = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
    const executionGuard = await client.callTool({
      arguments: {},
      name: "read_messages",
    })
    expectedContractDigest = evidenceDigest({
      executionGuard,
      instructions: client.getInstructions() || "",
      prompts: sortedByIdentity(prompts.prompts, (prompt) => prompt.name),
      resourceTemplates: sortedByIdentity(
        templates.resourceTemplates,
        (template) => template.uriTemplate,
      ),
      resources: sortedByIdentity(resources.resources, (resource) => resource.uri),
      safetyResource: safety,
      tools: sortedByIdentity(tools.tools, (tool) => tool.name),
    })
    expectedSafetyResourceDigest = evidenceDigest(safety)
  })

  const report = await checkDiscordCatalog()
  assert.equal(report.contractDigest, expectedContractDigest)
  assert.equal(report.safetyResourceDigest, expectedSafetyResourceDigest)
})

test("catalog self-check ignores hostile ambient credentials, policy, Gateway, telemetry, and activity paths", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-catalog-test-"))
  const activityFile = join(temporaryDirectory, "activity.jsonl")
  const ambientSecret = "ambient-catalog-secret"
  const overrides = new Map<string, string>([
    [DEFAULT_TOKEN_ENVIRONMENT_VARIABLE, ambientSecret],
    ["DISCORD_MCP_ALLOW_GATEWAY", "true"],
    ["DISCORD_MCP_APPLICATION_ID", "invalid"],
    ["DISCORD_MCP_TOOLSETS", "connector"],
    ["DISCORD_MCP_TOOL_SURFACE", "progressive"],
    ["DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT", "true"],
    ["OTEL_EXPORTER_OTLP_ENDPOINT", "not-a-url"],
    ["DISCORD_MCP_AUDIT_FILE", activityFile],
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
    assert.equal(report.activityRecordsCreated, false)
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
    assert.notEqual(report.contractDigest, report.safetyResourceDigest)
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
