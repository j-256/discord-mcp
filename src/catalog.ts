import type { Readable, Writable } from "node:stream"

import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server"
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio"

import {
  CATALOG_ONLY_ERROR_CODE,
  CATALOG_ONLY_MESSAGE,
  CATALOG_ONLY_RECOVERY,
  CATALOG_ONLY_STATUS,
} from "./catalog-contract.js"
import { loadConnectorConfig } from "./config.js"
import {
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
  ENVIRONMENT_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  SCHEMA_VERSION,
} from "./constants.js"
import type { GatewayEventSource } from "./gateway-events.js"
import {
  MCP_RESOURCE_URIS,
  MCP_RESOURCE_TEMPLATE_URIS,
  selectedMcpPromptNames,
} from "./mcp-guidance.js"
import {
  createDiscordMcpServer,
  type DiscordToolService,
} from "./mcp.js"
import {
  selectedCanonicalMcpToolNames,
} from "./mcp-tool-catalog.js"
import { stableString } from "./normalize.js"
import type { OperationalObserver } from "./observability.js"
import { ScopePolicy } from "./policy.js"

const CATALOG_HOME_DIRECTORY = "/discord-mcp-catalog"
const CATALOG_TOKEN_PLACEHOLDER = "catalog-only-placeholder"
const CATALOG_PROBE_TOOL_NAME = "read_messages"
const CATALOG_UNKNOWN_TOOL_NAME = "catalog_only_unknown_probe"
const REQUIRED_ANNOTATIONS = [
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
  "readOnlyHint",
] as const

const CATALOG_ENVIRONMENT: NodeJS.ProcessEnv = Object.freeze({
  [ENVIRONMENT_NAMES.auditFile]: `${CATALOG_HOME_DIRECTORY}/activity.jsonl`,
  [ENVIRONMENT_NAMES.token]: CATALOG_TOKEN_PLACEHOLDER,
  [ENVIRONMENT_NAMES.toolSurface]: "full",
  [ENVIRONMENT_NAMES.toolsets]: "all",
})

const CATALOG_CONFIG = loadConnectorConfig(CATALOG_ENVIRONMENT, {
  homeDirectory: CATALOG_HOME_DIRECTORY,
})
const CATALOG_POLICY = new ScopePolicy(CATALOG_CONFIG).describe()
const EXPECTED_TOOL_NAMES = Object.freeze([
  ...selectedCanonicalMcpToolNames(new Set(MCP_TOOLSET_NAMES)),
  MCP_DISCOVERY_TOOL_NAME,
].sort())
const EXPECTED_PROMPT_NAMES = Object.freeze(
  selectedMcpPromptNames(new Set(MCP_TOOLSET_NAMES)).sort(),
)
const EXPECTED_RESOURCE_URIS = Object.freeze(
  Object.values(MCP_RESOURCE_URIS).sort(),
)
const EXPECTED_RESOURCE_TEMPLATE_URIS = Object.freeze(
  Object.values(MCP_RESOURCE_TEMPLATE_URIS).sort(),
)

export interface DiscordCatalogCheckReport {
  activityRecordsCreated: false
  credentialsRequired: false
  discordExecution: "disabled"
  executionGuard: typeof CATALOG_ONLY_ERROR_CODE
  gateway: "disabled"
  observabilityExport: "disabled"
  promptCount: number
  resourceCount: number
  resourceTemplateCount: number
  schemaVersion: number
  serverName: string
  serverVersion: string
  status: "ok"
  toolCount: number
}

export interface DiscordCatalogRunOptions {
  stderr?: Pick<NodeJS.WriteStream, "write">
  stdin?: Readable
  stdout?: Writable
}

export { CATALOG_ONLY_ERROR_CODE } from "./catalog-contract.js"

class CatalogOnlyError extends Error {
  constructor() {
    super(`${CATALOG_ONLY_ERROR_CODE}: ${CATALOG_ONLY_MESSAGE}`)
    this.name = "CatalogOnlyError"
  }
}

function catalogService(): DiscordToolService {
  return new Proxy({} as DiscordToolService, {
    get(_target, property) {
      if (property === "describePolicy") return () => CATALOG_POLICY
      return () => {
        throw new CatalogOnlyError()
      }
    },
  })
}

function catalogGateway(): GatewayEventSource {
  return {
    enabled: false,
    getStatus() {
      throw new CatalogOnlyError()
    },
    listEvents() {
      throw new CatalogOnlyError()
    },
    subscribe() {
      throw new CatalogOnlyError()
    },
  }
}

function catalogObservability(): OperationalObserver {
  return {
    getObservabilityStatus() {
      throw new CatalogOnlyError()
    },
    startDiscordRequest() {
      throw new CatalogOnlyError()
    },
    startTool() {
      throw new CatalogOnlyError()
    },
  }
}

function catalogInvariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Catalog check failed: ${message}`)
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function assertExactCatalog(
  actualNames: readonly string[],
  expectedNames: readonly string[],
  label: string,
): void {
  catalogInvariant(
    new Set(actualNames).size === actualNames.length,
    `${label} contains duplicate identities`,
  )
  const actual = [...actualNames].sort()
  catalogInvariant(
    stableString(actual) === stableString(expectedNames),
    `${label} does not match production registrations`,
  )
}

function assertToolContract(tool: {
  annotations?: Record<string, unknown> | undefined
  description?: string | undefined
  inputSchema: Record<string, unknown>
  name: string
  outputSchema?: Record<string, unknown> | undefined
  title?: string | undefined
}): void {
  catalogInvariant(tool.inputSchema.type === "object", `${tool.name} input schema is not an object`)
  catalogInvariant(tool.outputSchema?.type === "object", `${tool.name} output schema is not an object`)
  catalogInvariant(Boolean(tool.description?.trim()), `${tool.name} lacks a description`)
  catalogInvariant(Boolean(tool.title?.trim()), `${tool.name} lacks a title`)
  for (const annotation of REQUIRED_ANNOTATIONS) {
    catalogInvariant(
      typeof tool.annotations?.[annotation] === "boolean",
      `${tool.name} lacks boolean ${annotation}`,
    )
  }
}

function assertCatalogOnlyResult(result: CallToolResult): void {
  catalogInvariant(result.isError === true, "execution guard did not return a tool error")
  catalogInvariant(result.content.length === 1, "execution guard content changed")
  const content = result.content[0]
  catalogInvariant(
    content?.type === "text" && content.text === CATALOG_ONLY_MESSAGE,
    "execution guard message changed",
  )
  const structured = objectValue(result.structuredContent)
  const error = objectValue(structured?.error)
  catalogInvariant(structured?.schemaVersion === SCHEMA_VERSION, "execution guard schema version changed")
  catalogInvariant(structured?.status === CATALOG_ONLY_STATUS, "execution guard status changed")
  catalogInvariant(error?.category === "client", "execution guard category changed")
  catalogInvariant(error?.code === CATALOG_ONLY_ERROR_CODE, "execution guard code changed")
  catalogInvariant(error?.recoveryHint === CATALOG_ONLY_RECOVERY, "execution guard recovery changed")
  catalogInvariant(error?.retriable === false, "execution guard became retriable")
}

export function createDiscordCatalogServer(): McpServer {
  const server = createDiscordMcpServer({
    catalogOnly: true,
    config: CATALOG_CONFIG,
    environment: CATALOG_ENVIRONMENT,
    gateway: catalogGateway(),
    observability: catalogObservability(),
    service: catalogService(),
  })
  return server
}

export async function checkDiscordCatalog(): Promise<DiscordCatalogCheckReport> {
  const server = createDiscordCatalogServer()
  const client = new Client(
    { name: "discord-mcp-catalog-check", version: CONNECTOR_VERSION },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const [toolsResult, promptsResult, resourcesResult, templatesResult] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
      client.listResourceTemplates(),
    ])
    assertExactCatalog(
      toolsResult.tools.map((tool) => tool.name),
      EXPECTED_TOOL_NAMES,
      "tool catalog",
    )
    for (const tool of toolsResult.tools) assertToolContract(tool)
    assertExactCatalog(
      promptsResult.prompts.map((prompt) => prompt.name),
      EXPECTED_PROMPT_NAMES,
      "prompt catalog",
    )
    assertExactCatalog(
      resourcesResult.resources.map((resource) => resource.uri),
      EXPECTED_RESOURCE_URIS,
      "resource catalog",
    )
    assertExactCatalog(
      templatesResult.resourceTemplates.map((template) => template.uriTemplate),
      EXPECTED_RESOURCE_TEMPLATE_URIS,
      "resource-template catalog",
    )

    const safety = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
    const safetyContent = safety.contents[0]
    catalogInvariant(safety.contents.length === 1, "static safety resource count changed")
    catalogInvariant(
      safetyContent && "text" in safetyContent
        && typeof safetyContent.text === "string"
        && safetyContent.text.includes("review-first workflows"),
      "static safety resource is unavailable",
    )

    catalogInvariant(EXPECTED_TOOL_NAMES.includes(CATALOG_PROBE_TOOL_NAME), "probe tool is not listed")
    const knownGuard = await client.callTool({
      arguments: {},
      name: CATALOG_PROBE_TOOL_NAME,
    })
    const unknownGuard = await client.callTool({
      arguments: { ignored: true },
      name: CATALOG_UNKNOWN_TOOL_NAME,
    })
    assertCatalogOnlyResult(knownGuard)
    assertCatalogOnlyResult(unknownGuard)
    catalogInvariant(
      stableString(knownGuard) === stableString(unknownGuard),
      "known and unknown tool guards differ",
    )

    return {
      activityRecordsCreated: false,
      credentialsRequired: false,
      discordExecution: "disabled",
      executionGuard: CATALOG_ONLY_ERROR_CODE,
      gateway: "disabled",
      observabilityExport: "disabled",
      promptCount: promptsResult.prompts.length,
      resourceCount: resourcesResult.resources.length,
      resourceTemplateCount: templatesResult.resourceTemplates.length,
      schemaVersion: SCHEMA_VERSION,
      serverName: CONNECTOR_NAME,
      serverVersion: CONNECTOR_VERSION,
      status: "ok",
      toolCount: toolsResult.tools.length,
    }
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

export function runDiscordMcpCatalog(options: DiscordCatalogRunOptions = {}) {
  const stderr = options.stderr || process.stderr
  const handle = serveStdio(createDiscordCatalogServer, {
    onerror() {
      stderr.write("[mcp] Catalog transport error\n")
    },
    transport: new StdioServerTransport(
      options.stdin || process.stdin,
      options.stdout || process.stdout,
    ),
  })
  stderr.write("[mcp] Discord credential-free catalog stdio server ready\n")
  return handle
}
