import { createHash } from "node:crypto"
import type { Readable, Writable } from "node:stream"

import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import type {
  CallToolResult,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  McpServer,
  ReadResourceResult,
  ServerCapabilities,
} from "@modelcontextprotocol/server"
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio"

import {
  CATALOG_ONLY_ERROR_CODE,
  CATALOG_ONLY_MESSAGE,
  CATALOG_ONLY_RECOVERY,
  CATALOG_ONLY_STATUS,
} from "./catalog-contract.js"
import { loadConnectorConfigDocument } from "./config.js"
import { createConnectorConfigDocument } from "./config-document.js"
import {
  CONNECTOR_DESCRIPTION,
  CONNECTOR_ICON_MIME_TYPE,
  CONNECTOR_ICON_SIZES,
  CONNECTOR_ICON_URL,
  CONNECTOR_NAME,
  CONNECTOR_TITLE,
  CONNECTOR_VERSION,
  CONNECTOR_WEBSITE_URL,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
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
  MCP_COMPLETION_VALUE_LIMIT,
  MCP_POLICY_COMPLETION_BINDINGS,
  type McpPolicyCompletionBinding,
} from "./mcp-completions.js"
import {
  createDiscordMcpServer,
  type DiscordToolService,
} from "./mcp.js"
import {
  DISCORD_MCP_RECEIPT_PREFIX,
  DISCORD_MCP_RECEIPT_SCHEMA,
} from "./mcp-output.js"
import {
  MCP_APP_EXTENSION_ID,
  MCP_PLAN_REVIEW_APP_HTML,
  MCP_PLAN_REVIEW_APP_MIME_TYPE,
  MCP_PLAN_REVIEW_APP_RESOURCE_META,
  MCP_PLAN_REVIEW_APP_URI,
  MCP_PLAN_REVIEW_TOOL_META,
  MCP_PLAN_REVIEW_TOOL_NAMES,
  isPlanReviewToolName,
} from "./mcp-plan-review-app.js"
import {
  createMcpToolAccessDocument,
  createMcpToolAccessIndex,
  createMcpToolAccessManifest,
  type McpToolAccessManifest,
  type McpToolAccessStage,
  selectedCanonicalMcpToolNames,
} from "./mcp-tool-catalog.js"
import { stableString } from "./normalize.js"
import {
  DISCORD_REST_OPERATIONS,
  MCP_TOOL_RISK_CLASSES,
  type DiscordRestMethod,
  type McpToolName,
  type McpToolRiskClass,
} from "./observability-catalog.js"
import type { OperationalObserver } from "./observability.js"
import { ScopePolicy } from "./policy.js"

export const CATALOG_EVIDENCE_FORMAT = "discord-mcp.catalog-evidence.v3"

const CATALOG_HOME_DIRECTORY = "/discord-mcp-catalog"
const CATALOG_TOKEN_PLACEHOLDER = "catalog-only-placeholder"
const CATALOG_APPLICATION_ID = "900000000000000001"
const CATALOG_BOT_ID = "900000000000000002"
const CATALOG_GUILD_ID = "900000000000000003"
const CATALOG_PROBE_TOOL_NAME = "read_messages"
const CATALOG_UNKNOWN_TOOL_NAME = "catalog_only_unknown_probe"
const REQUIRED_ANNOTATIONS = [
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
  "readOnlyHint",
] as const

const CATALOG_ENVIRONMENT: NodeJS.ProcessEnv = Object.freeze({
  [DEFAULT_TOKEN_ENVIRONMENT_VARIABLE]: CATALOG_TOKEN_PLACEHOLDER,
})

const CATALOG_DOCUMENT = createConnectorConfigDocument({
  applicationId: CATALOG_APPLICATION_ID,
  botId: CATALOG_BOT_ID,
  guildIds: [CATALOG_GUILD_ID],
  name: "catalog",
  storage: {
    auditFile: `${CATALOG_HOME_DIRECTORY}/activity.jsonl`,
  },
  toolsets: MCP_TOOLSET_NAMES,
  toolSurface: "full",
})

const CATALOG_CONFIG = loadConnectorConfigDocument(CATALOG_DOCUMENT, CATALOG_ENVIRONMENT, {
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
  accessStageCounts: Record<McpToolAccessStage, number>
  activityRecordsCreated: false
  completionBindingCount: number
  completionBindings: McpPolicyCompletionBinding[]
  policyCompletionValuesExposed: false
  contractDigest: string
  credentialsRequired: false
  discordExecution: "disabled"
  evidenceFormat: typeof CATALOG_EVIDENCE_FORMAT
  executionGuard: typeof CATALOG_ONLY_ERROR_CODE
  gateway: "disabled"
  observabilityExport: "disabled"
  planReviewApp: {
    externalNetworkDomains: []
    extensionId: typeof MCP_APP_EXTENSION_ID
    htmlDigest: string
    linkedToolCount: number
    linkedToolNames: string[]
    mimeType: typeof MCP_PLAN_REVIEW_APP_MIME_TYPE
    permissions: []
    resourceDigest: string
    resourceUri: typeof MCP_PLAN_REVIEW_APP_URI
    serverToolAuthority: false
    toolVisibility: ["model"]
  }
  promptCount: number
  promptNames: string[]
  resourceCount: number
  resourceTemplateCount: number
  resourceTemplateUris: string[]
  resourceUris: string[]
  restMethodCounts: Record<DiscordRestMethod, number>
  restOperationCount: number
  riskClassCounts: Record<McpToolRiskClass, number>
  safetyResourceDigest: string
  schemaVersion: number
  serverName: string
  serverVersion: string
  status: "ok"
  toolCount: number
  toolAccessManifest: McpToolAccessManifest
  toolAccessResourceDigest: string
  toolNames: string[]
  toolsetNames: string[]
}

export interface DiscordCatalogSnapshot {
  executionGuard: CallToolResult
  instructions: string
  prompts: ListPromptsResult["prompts"]
  planReviewAppResource: ReadResourceResult
  report: DiscordCatalogCheckReport
  resourceTemplates: ListResourceTemplatesResult["resourceTemplates"]
  resources: ListResourcesResult["resources"]
  safetyResource: ReadResourceResult
  serverCapabilities: ServerCapabilities
  tools: ListToolsResult["tools"]
  toolAccessResource: ReadResourceResult
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
    layoutEnabled: false,
    getChannelLayout() {
      throw new CatalogOnlyError()
    },
    getChannelLayoutStatus() {
      throw new CatalogOnlyError()
    },
    getStatus() {
      throw new CatalogOnlyError()
    },
    listEvents() {
      throw new CatalogOnlyError()
    },
    subscribe() {
      throw new CatalogOnlyError()
    },
    subscribeChannelLayouts() {
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

function jsonValue(value: unknown, label: string): unknown {
  const encoded = JSON.stringify(value)
  catalogInvariant(encoded !== undefined, `${label} is not JSON serializable`)
  return JSON.parse(encoded) as unknown
}

function assertServerIdentity(value: unknown): void {
  const expected = {
    description: CONNECTOR_DESCRIPTION,
    icons: [{
      mimeType: CONNECTOR_ICON_MIME_TYPE,
      sizes: [...CONNECTOR_ICON_SIZES],
      src: CONNECTOR_ICON_URL,
    }],
    name: CONNECTOR_NAME,
    title: CONNECTOR_TITLE,
    version: CONNECTOR_VERSION,
    websiteUrl: CONNECTOR_WEBSITE_URL,
  }
  catalogInvariant(
    stableString(jsonValue(value, "server identity")) === stableString(expected),
    "server identity does not match public release metadata",
  )
}

function sha256Digest(value: unknown, label: string): string {
  return `sha256:${createHash("sha256")
    .update(stableString(jsonValue(value, label)))
    .digest("hex")}`
}

function sha256TextDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
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

function valueCounts<T extends string>(values: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(
    [...new Set(values)].sort().map((value) => [value, 0]),
  ) as Record<T, number>
  for (const value of values) counts[value] += 1
  return counts
}

function catalogRiskClassCounts(
  toolNames: readonly string[],
): Record<McpToolRiskClass, number> {
  const riskClasses = toolNames.map((name) => {
    catalogInvariant(
      Object.hasOwn(MCP_TOOL_RISK_CLASSES, name),
      `${name} lacks an internal risk classification`,
    )
    return MCP_TOOL_RISK_CLASSES[name as McpToolName]
  })
  return valueCounts(riskClasses)
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
  _meta?: Record<string, unknown> | undefined
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

function assertPlanReviewAppToolContract(
  tools: ListToolsResult["tools"],
): void {
  const linkedToolNames: string[] = []
  for (const tool of tools) {
    const meta = objectValue(tool._meta)
    const ui = objectValue(meta?.ui)
    catalogInvariant(
      meta?.["ui/resourceUri"] === undefined,
      `${tool.name} uses deprecated flat MCP App metadata`,
    )
    if (isPlanReviewToolName(tool.name)) {
      catalogInvariant(
        stableString(ui) === stableString(MCP_PLAN_REVIEW_TOOL_META.ui),
        `${tool.name} does not carry the exact display-only plan-review metadata`,
      )
      linkedToolNames.push(tool.name)
    } else {
      catalogInvariant(
        ui === undefined,
        `${tool.name} unexpectedly carries plan-review app metadata`,
      )
    }
  }
  assertExactCatalog(
    linkedToolNames,
    [...MCP_PLAN_REVIEW_TOOL_NAMES],
    "plan-review app tool linkage",
  )
}

function assertPlanReviewAppHtml(html: string): void {
  catalogInvariant(html.startsWith("<!doctype html>"), "plan-review app is not a complete HTML document")
  catalogInvariant(
    html.includes("connect-src 'none'")
    && html.includes("frame-src 'none'")
    && html.includes("object-src 'none'")
    && html.includes("base-uri 'none'"),
    "plan-review app lacks its restrictive document CSP",
  )
  for (const forbidden of [
    ".innerHTML",
    "insertAdjacentHTML",
    "document.write",
    "eval(",
    "Function(",
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "sendBeacon",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator.clipboard",
    "document.cookie",
    "window.open",
    "tools/call",
    "resources/read",
    "<a ",
    "<form",
  ]) {
    catalogInvariant(!html.includes(forbidden), `plan-review app contains forbidden authority ${forbidden}`)
  }
  catalogInvariant(
    html.includes('method: "ui/initialize"')
    && html.includes('notify("ui/notifications/initialized"')
    && html.includes('message.method === "ui/resource-teardown"')
    && html.includes("event.source !== window.parent")
    && html.includes('window.parent.postMessage(message, "*")'),
    "plan-review app lifecycle or parent boundary is incomplete",
  )
}

function assertCatalogOnlyResult(result: CallToolResult): void {
  catalogInvariant(result.isError === true, "execution guard did not return a tool error")
  catalogInvariant(result.content.length === 2, "execution guard content changed")
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
  const fallback = result.content[1]
  catalogInvariant(
    fallback?.type === "text"
    && fallback.text === `${DISCORD_MCP_RECEIPT_PREFIX}${JSON.stringify({
      receiptSchema: DISCORD_MCP_RECEIPT_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      status: CATALOG_ONLY_STATUS,
      error: {
        category: "client",
        code: CATALOG_ONLY_ERROR_CODE,
        retriable: false,
      },
    })}`,
    "execution guard content-free receipt changed",
  )
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

export async function inspectDiscordCatalog(): Promise<DiscordCatalogSnapshot> {
  const server = createDiscordCatalogServer()
  const client = new Client(
    { name: "discord-mcp-catalog-check", version: CONNECTOR_VERSION },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    assertServerIdentity(client.getServerVersion())
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
    assertPlanReviewAppToolContract(toolsResult.tools)
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
    const serverCapabilities = client.getServerCapabilities()
    catalogInvariant(serverCapabilities, "server capabilities are unavailable")
    catalogInvariant(
      serverCapabilities.completions !== undefined,
      "completion capability is not advertised",
    )
    const extensions = objectValue(serverCapabilities.extensions)
    catalogInvariant(
      stableString(extensions?.[MCP_APP_EXTENSION_ID]) === stableString({
        mimeTypes: [MCP_PLAN_REVIEW_APP_MIME_TYPE],
      }),
      "plan-review app extension capability is not advertised exactly",
    )
    const completionBindings = MCP_POLICY_COMPLETION_BINDINGS.map((candidate) => ({
      argument: candidate.argument,
      kind: candidate.kind,
      policyFields: [...candidate.policyFields],
      reference: candidate.reference,
    }))
    const completionResults = await Promise.all(
      completionBindings.map((candidate) => client.complete({
        argument: { name: candidate.argument, value: "" },
        ref: candidate.kind === "prompt"
          ? { name: candidate.reference, type: "ref/prompt" as const }
          : { type: "ref/resource" as const, uri: candidate.reference },
      })),
    )
    for (const [index, result] of completionResults.entries()) {
      const candidate = completionBindings[index]
      catalogInvariant(candidate, "completion binding disappeared during inspection")
      catalogInvariant(
        result.completion.values.length === 0
        && (result.completion.total === undefined || result.completion.total === 0)
        && result.completion.hasMore !== true,
        `${candidate.reference} ${candidate.argument} exposed catalog completion values`,
      )
    }

    const safety = await client.readResource({ uri: MCP_RESOURCE_URIS.safety })
    const safetyContent = safety.contents[0]
    catalogInvariant(safety.contents.length === 1, "static safety resource count changed")
    catalogInvariant(
      safetyContent && "text" in safetyContent
        && typeof safetyContent.text === "string"
        && safetyContent.text.includes("review-first workflows"),
      "static safety resource is unavailable",
    )
    const toolAccessResource = await client.readResource({
      uri: MCP_RESOURCE_URIS.toolAccess,
    })
    const toolAccessContent = toolAccessResource.contents[0]
    catalogInvariant(
      toolAccessResource.contents.length === 1
      && toolAccessContent
      && "text" in toolAccessContent
      && toolAccessContent.uri === MCP_RESOURCE_URIS.toolAccess
      && toolAccessContent.mimeType === "application/json",
      "tool access resource identity changed",
    )
    let toolAccessValue: unknown
    try {
      toolAccessValue = JSON.parse(toolAccessContent.text)
    } catch {
      throw new Error("Discord catalog invariant failed: tool access resource is not JSON")
    }
    const toolAccessEnvelope = objectValue(toolAccessValue)
    const expectedToolAccess = createMcpToolAccessManifest()
    const expectedToolAccessIndex = createMcpToolAccessIndex(
      MCP_RESOURCE_TEMPLATE_URIS.toolAccess,
    )
    catalogInvariant(
      stableString(toolAccessEnvelope?.data) === stableString(expectedToolAccessIndex),
      "tool access resource does not match the canonical index",
    )
    catalogInvariant(
      !toolAccessContent.text.includes(CATALOG_TOKEN_PLACEHOLDER),
      "tool access resource exposed the catalog credential placeholder",
    )
    const toolAccessNameCompletion = await client.complete({
      argument: { name: "toolName", value: "" },
      ref: {
        type: "ref/resource",
        uri: MCP_RESOURCE_TEMPLATE_URIS.toolAccess,
      },
    })
    catalogInvariant(
      stableString(toolAccessNameCompletion.completion.values)
        === stableString(EXPECTED_TOOL_NAMES.slice(0, MCP_COMPLETION_VALUE_LIMIT))
      && toolAccessNameCompletion.completion.total === EXPECTED_TOOL_NAMES.length
      && toolAccessNameCompletion.completion.hasMore
        === (EXPECTED_TOOL_NAMES.length > MCP_COMPLETION_VALUE_LIMIT),
      "tool access completion does not match the canonical tool inventory",
    )
    const toolAccessProbeName = "get_connector_status"
    const toolAccessDetailResource = await client.readResource({
      uri: MCP_RESOURCE_TEMPLATE_URIS.toolAccess.replace(
        "{toolName}",
        toolAccessProbeName,
      ),
    })
    const toolAccessDetailContent = toolAccessDetailResource.contents[0]
    catalogInvariant(
      toolAccessDetailResource.contents.length === 1
      && toolAccessDetailContent
      && "text" in toolAccessDetailContent
      && toolAccessDetailContent.mimeType === "application/json",
      "exact tool access resource identity changed",
    )
    let toolAccessDetailValue: unknown
    try {
      toolAccessDetailValue = JSON.parse(toolAccessDetailContent.text)
    } catch {
      throw new Error("Discord catalog invariant failed: exact tool access resource is not JSON")
    }
    catalogInvariant(
      stableString(objectValue(toolAccessDetailValue)?.data)
        === stableString(createMcpToolAccessDocument(toolAccessProbeName)),
      "exact tool access resource does not match the canonical contract",
    )
    catalogInvariant(
      !toolAccessDetailContent.text.includes(CATALOG_TOKEN_PLACEHOLDER),
      "exact tool access resource exposed the catalog credential placeholder",
    )
    const planReviewAppResource = await client.readResource({
      uri: MCP_PLAN_REVIEW_APP_URI,
    })
    const planReviewAppContent = planReviewAppResource.contents[0]
    catalogInvariant(
      planReviewAppResource.contents.length === 1,
      "plan-review app resource count changed",
    )
    catalogInvariant(
      planReviewAppContent
      && "text" in planReviewAppContent
      && planReviewAppContent.uri === MCP_PLAN_REVIEW_APP_URI
      && planReviewAppContent.mimeType === MCP_PLAN_REVIEW_APP_MIME_TYPE
      && planReviewAppContent.text === MCP_PLAN_REVIEW_APP_HTML,
      "plan-review app resource bytes or identity changed",
    )
    catalogInvariant(
      stableString(planReviewAppContent._meta) === stableString(MCP_PLAN_REVIEW_APP_RESOURCE_META),
      "plan-review app content security metadata changed",
    )
    const listedPlanReviewApp = resourcesResult.resources.find(
      (resource) => resource.uri === MCP_PLAN_REVIEW_APP_URI,
    )
    catalogInvariant(
      listedPlanReviewApp
      && listedPlanReviewApp.mimeType === MCP_PLAN_REVIEW_APP_MIME_TYPE
      && stableString(listedPlanReviewApp._meta) === stableString(MCP_PLAN_REVIEW_APP_RESOURCE_META),
      "plan-review app discovery metadata changed",
    )
    assertPlanReviewAppHtml(MCP_PLAN_REVIEW_APP_HTML)

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

    const toolNames = toolsResult.tools.map((tool) => tool.name).sort()
    const promptNames = promptsResult.prompts.map((prompt) => prompt.name).sort()
    const resourceUris = resourcesResult.resources.map((resource) => resource.uri).sort()
    const resourceTemplateUris = templatesResult.resourceTemplates
      .map((template) => template.uriTemplate)
      .sort()
    const instructions = client.getInstructions() || ""
    const prompts = sortedByIdentity(promptsResult.prompts, (prompt) => prompt.name)
    const resourceTemplates = sortedByIdentity(
      templatesResult.resourceTemplates,
      (template) => template.uriTemplate,
    )
    const resources = sortedByIdentity(resourcesResult.resources, (resource) => resource.uri)
    const tools = sortedByIdentity(toolsResult.tools, (tool) => tool.name)
    const protocolContract = {
      completionBindings,
      executionGuard: knownGuard,
      instructions,
      prompts,
      resourceTemplates,
      resources,
      planReviewAppResource,
      safetyResource: safety,
      serverCapabilities,
      toolAccessDetailResource,
      toolAccessManifest: expectedToolAccess,
      toolAccessNameCompletion,
      toolAccessResource,
      tools,
    }
    const restMethods = Object.values(DISCORD_REST_OPERATIONS)
    const report: DiscordCatalogCheckReport = {
      accessStageCounts: expectedToolAccess.stageCounts,
      activityRecordsCreated: false,
      completionBindingCount: completionBindings.length,
      completionBindings,
      policyCompletionValuesExposed: false,
      contractDigest: sha256Digest(protocolContract, "protocol contract"),
      credentialsRequired: false,
      discordExecution: "disabled",
      evidenceFormat: CATALOG_EVIDENCE_FORMAT,
      executionGuard: CATALOG_ONLY_ERROR_CODE,
      gateway: "disabled",
      observabilityExport: "disabled",
      planReviewApp: {
        externalNetworkDomains: [],
        extensionId: MCP_APP_EXTENSION_ID,
        htmlDigest: sha256TextDigest(MCP_PLAN_REVIEW_APP_HTML),
        linkedToolCount: MCP_PLAN_REVIEW_TOOL_NAMES.length,
        linkedToolNames: [...MCP_PLAN_REVIEW_TOOL_NAMES],
        mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
        permissions: [],
        resourceDigest: sha256Digest(planReviewAppResource, "plan-review app resource"),
        resourceUri: MCP_PLAN_REVIEW_APP_URI,
        serverToolAuthority: false,
        toolVisibility: ["model"],
      },
      promptCount: promptsResult.prompts.length,
      promptNames,
      resourceCount: resourcesResult.resources.length,
      resourceTemplateCount: templatesResult.resourceTemplates.length,
      resourceTemplateUris,
      resourceUris,
      restMethodCounts: valueCounts(restMethods),
      restOperationCount: restMethods.length,
      riskClassCounts: catalogRiskClassCounts(toolNames),
      safetyResourceDigest: sha256Digest(safety, "safety resource"),
      schemaVersion: SCHEMA_VERSION,
      serverName: CONNECTOR_NAME,
      serverVersion: CONNECTOR_VERSION,
      status: "ok",
      toolCount: toolsResult.tools.length,
      toolAccessManifest: expectedToolAccess,
      toolAccessResourceDigest: sha256Digest(
        toolAccessResource,
        "tool access resource",
      ),
      toolNames,
      toolsetNames: [...MCP_TOOLSET_NAMES].sort(),
    }
    return {
      executionGuard: knownGuard,
      instructions,
      prompts,
      planReviewAppResource,
      report,
      resourceTemplates,
      resources,
      safetyResource: safety,
      serverCapabilities,
      toolAccessResource,
      tools,
    }
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

export async function checkDiscordCatalog(): Promise<DiscordCatalogCheckReport> {
  return (await inspectDiscordCatalog()).report
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
