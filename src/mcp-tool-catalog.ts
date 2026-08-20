import type {
  RegisteredTool,
  ToolAnnotations,
} from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  CONNECTOR_LIMITS,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  MCP_TOOL_SURFACES,
  SCHEMA_VERSION,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import type { McpToolName } from "./observability-catalog.js"

export type CanonicalMcpToolName = Exclude<
  McpToolName,
  typeof MCP_DISCOVERY_TOOL_NAME
>

export const MCP_DISCOVERY_RISKS = [
  "destructive",
  "external-read",
  "local-read",
  "write",
] as const

export type McpDiscoveryRisk = typeof MCP_DISCOVERY_RISKS[number]

const MCP_DISCOVERY_DETAILS = [
  "compact",
  "full",
] as const

type McpDiscoveryDetail = typeof MCP_DISCOVERY_DETAILS[number]
type McpToolWorkflow =
  | "attachment-message"
  | "channel-creation"
  | "member-moderation"
  | "message-deletion"
  | "role-creation"

interface ToolCatalogMetadata {
  keywords: readonly string[]
  toolset: McpToolsetName
  workflow?: McpToolWorkflow
}

interface CompleteToolAnnotations {
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
  readOnlyHint: boolean
}

export const MCP_TOOL_CATALOG = Object.freeze({
  add_reaction: {
    keywords: ["emoji", "react", "reaction"],
    toolset: "interactions",
  },
  audit_channel_role_access: {
    keywords: ["access", "audit", "channel", "matrix", "permissions", "role"],
    toolset: "permissions",
  },
  delete_messages: {
    keywords: ["bulk", "delete", "exact ids", "remove"],
    toolset: "deletion",
    workflow: "message-deletion",
  },
  edit_own_message: {
    keywords: ["edit", "message", "own", "update"],
    toolset: "interactions",
  },
  execute_attachment_message: {
    keywords: ["attachment", "execute", "file", "message", "send", "upload"],
    toolset: "attachments",
    workflow: "attachment-message",
  },
  execute_channel_creation: {
    keywords: ["category", "channel", "create", "execute", "forum", "text"],
    toolset: "channel-creation",
    workflow: "channel-creation",
  },
  execute_member_moderation: {
    keywords: ["ban", "execute", "kick", "moderate", "timeout", "unban"],
    toolset: "moderation",
    workflow: "member-moderation",
  },
  execute_role_creation: {
    keywords: ["create", "execute", "permission", "role"],
    toolset: "role-creation",
    workflow: "role-creation",
  },
  explain_channel_access: {
    keywords: ["access", "permissions", "read", "view"],
    toolset: "guilds",
  },
  explain_principal_permissions: {
    keywords: ["action", "effective", "hierarchy", "member", "permissions", "role"],
    toolset: "permissions",
  },
  get_guild_audit_entry: {
    keywords: ["audit", "entry", "exact", "guild", "history", "moderation"],
    toolset: "audit-logs",
  },
  get_connector_status: {
    keywords: ["application", "bot", "identity", "scope", "status"],
    toolset: "connector",
  },
  get_gateway_events: {
    keywords: ["cursor", "event", "realtime", "subscription"],
    toolset: "gateway",
  },
  get_gateway_status: {
    keywords: ["connection", "gateway", "health", "realtime", "status"],
    toolset: "gateway",
  },
  get_message: {
    keywords: ["exact", "fetch", "message", "read"],
    toolset: "messages",
  },
  get_observability_status: {
    keywords: ["health", "metrics", "observability", "telemetry", "traces"],
    toolset: "observability",
  },
  get_role: {
    keywords: ["exact", "permission", "read", "role"],
    toolset: "roles",
  },
  list_active_threads: {
    keywords: ["active", "forum", "list", "thread"],
    toolset: "threads",
  },
  list_activity: {
    keywords: ["activity", "audit", "history", "outcome", "write"],
    toolset: "activity",
  },
  list_archived_threads: {
    keywords: ["archive", "forum", "list", "thread"],
    toolset: "threads",
  },
  list_channels: {
    keywords: ["channel", "guild", "list", "server"],
    toolset: "guilds",
  },
  list_guilds: {
    keywords: ["guild", "list", "server"],
    toolset: "guilds",
  },
  list_guild_audit_entries: {
    keywords: ["action", "actor", "audit", "guild", "history", "moderation"],
    toolset: "audit-logs",
  },
  list_roles: {
    keywords: ["guild", "hierarchy", "list", "permission", "role"],
    toolset: "roles",
  },
  plan_member_moderation: {
    keywords: ["ban", "kick", "moderate", "plan", "review", "timeout", "unban"],
    toolset: "moderation",
    workflow: "member-moderation",
  },
  plan_attachment_message: {
    keywords: ["attachment", "file", "message", "plan", "review", "upload"],
    toolset: "attachments",
    workflow: "attachment-message",
  },
  plan_channel_creation: {
    keywords: ["category", "channel", "create", "forum", "plan", "review", "text"],
    toolset: "channel-creation",
    workflow: "channel-creation",
  },
  plan_message_deletion: {
    keywords: ["delete", "exact ids", "plan", "remove", "review"],
    toolset: "deletion",
    workflow: "message-deletion",
  },
  plan_role_creation: {
    keywords: ["create", "permission", "plan", "review", "role"],
    toolset: "role-creation",
    workflow: "role-creation",
  },
  read_messages: {
    keywords: ["channel", "history", "list", "message", "read"],
    toolset: "messages",
  },
  search_messages: {
    keywords: ["author", "content", "filter", "guild", "message", "search"],
    toolset: "messages",
  },
  send_message: {
    keywords: ["create", "message", "reply", "send", "write"],
    toolset: "interactions",
  },
} satisfies Record<CanonicalMcpToolName, ToolCatalogMetadata>)

export const discoverDiscordToolsInputSchema = z.strictObject({
  detail: z.enum(MCP_DISCOVERY_DETAILS)
    .default("compact")
    .describe("Compact match cards or full exact input contracts"),
  limit: z.number()
    .int()
    .min(1)
    .max(CONNECTOR_LIMITS.toolDiscoveryMatches)
    .default(5)
    .describe("Maximum direct matches to return"),
  query: z.string()
    .min(1)
    .max(CONNECTOR_LIMITS.toolDiscoveryQueryCharacters)
    .refine((value) => value.trim().length > 0, "query must not be blank")
    .optional()
    .describe("Capability or exact canonical tool name to find"),
  risk: z.enum(MCP_DISCOVERY_RISKS)
    .optional()
    .describe("Optional exact MCP risk class"),
  toolset: z.enum(MCP_TOOLSET_NAMES)
    .optional()
    .describe("Optional exact configured toolset"),
})

export type DiscoverDiscordToolsInput = z.infer<
  typeof discoverDiscordToolsInputSchema
>

export interface TrackedMcpTool {
  handle: RegisteredTool
  inputSchema: Record<string, unknown>
  name: CanonicalMcpToolName
}

interface SearchableMcpTool extends TrackedMcpTool {
  annotations: CompleteToolAnnotations
  description: string
  keywords: readonly string[]
  normalizedDescription: string
  normalizedKeywords: string
  normalizedName: string
  normalizedTitle: string
  risk: McpDiscoveryRisk
  summary: string
  title: string
  toolset: McpToolsetName
  workflow?: McpToolWorkflow
}

export interface DiscordToolDiscoveryCatalog {
  entries: readonly SearchableMcpTool[]
  surface: McpToolSurface
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "discord",
  "for",
  "in",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "tool",
])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function toolSummary(description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim()
  if (normalized.length <= CONNECTOR_LIMITS.toolDiscoverySummaryCharacters) {
    return normalized
  }
  return `${normalized.slice(0, CONNECTOR_LIMITS.toolDiscoverySummaryCharacters - 3).trimEnd()}...`
}

function completeAnnotations(
  annotations: ToolAnnotations | undefined,
  name: string,
): CompleteToolAnnotations {
  if (
    typeof annotations?.destructiveHint !== "boolean"
    || typeof annotations.idempotentHint !== "boolean"
    || typeof annotations.openWorldHint !== "boolean"
    || typeof annotations.readOnlyHint !== "boolean"
  ) {
    throw new Error(`MCP tool ${name} must have complete risk annotations`)
  }
  return {
    destructiveHint: annotations.destructiveHint,
    idempotentHint: annotations.idempotentHint,
    openWorldHint: annotations.openWorldHint,
    readOnlyHint: annotations.readOnlyHint,
  }
}

function discoveryRisk(
  annotations: CompleteToolAnnotations,
): McpDiscoveryRisk {
  if (annotations.destructiveHint) return "destructive"
  if (!annotations.readOnlyHint) return "write"
  return annotations.openWorldHint ? "external-read" : "local-read"
}

export function parseMcpToolSurface(
  value: string | undefined,
  name: string,
): McpToolSurface {
  if (value === undefined || value.trim() === "") return "full"
  const normalized = value.trim().toLowerCase()
  if ((MCP_TOOL_SURFACES as readonly string[]).includes(normalized)) {
    return normalized as McpToolSurface
  }
  throw new ConfigurationError(
    `${name} must be one of: ${MCP_TOOL_SURFACES.join(", ")}`,
  )
}

export function parseMcpToolsets(
  value: string | undefined,
  name: string,
): ReadonlySet<McpToolsetName> {
  if (value === undefined || value.trim() === "") {
    return new Set(MCP_TOOLSET_NAMES)
  }
  const selected = [...new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )]
  if (selected.length === 0) {
    throw new ConfigurationError(`${name} must select all or at least one toolset`)
  }
  if (selected.includes("all")) {
    if (selected.length !== 1) {
      throw new ConfigurationError(`${name} cannot combine all with named toolsets`)
    }
    return new Set(MCP_TOOLSET_NAMES)
  }
  const unknown = selected.filter((entry) => (
    !(MCP_TOOLSET_NAMES as readonly string[]).includes(entry)
  ))
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `${name} contains unknown toolsets: ${unknown.join(", ")}. Known: ${MCP_TOOLSET_NAMES.join(", ")}`,
    )
  }
  return new Set(selected as McpToolsetName[])
}

export function selectedMcpToolsets(
  toolsets: ReadonlySet<McpToolsetName>,
): McpToolsetName[] {
  return MCP_TOOLSET_NAMES.filter((name) => toolsets.has(name))
}

export function mcpToolSelected(
  name: CanonicalMcpToolName,
  toolsets: ReadonlySet<McpToolsetName>,
): boolean {
  return toolsets.has(MCP_TOOL_CATALOG[name].toolset)
}

export function selectedCanonicalMcpToolNames(
  toolsets: ReadonlySet<McpToolsetName>,
): CanonicalMcpToolName[] {
  return (Object.keys(MCP_TOOL_CATALOG) as CanonicalMcpToolName[])
    .filter((name) => mcpToolSelected(name, toolsets))
}

export function createDiscordToolDiscoveryCatalog(
  tools: readonly TrackedMcpTool[],
  surface: McpToolSurface,
): DiscordToolDiscoveryCatalog {
  const seen = new Set<CanonicalMcpToolName>()
  const entries = tools.map((tool): SearchableMcpTool => {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tracked MCP tool ${tool.name}`)
    }
    seen.add(tool.name)
    const metadata: ToolCatalogMetadata = MCP_TOOL_CATALOG[tool.name]
    const annotations = completeAnnotations(tool.handle.annotations, tool.name)
    const description = tool.handle.description || ""
    const title = tool.handle.title || tool.name
    return {
      ...tool,
      annotations,
      description,
      keywords: metadata.keywords,
      normalizedDescription: normalize(description),
      normalizedKeywords: normalize(metadata.keywords.join(" ")),
      normalizedName: normalize(tool.name),
      normalizedTitle: normalize(title),
      risk: discoveryRisk(annotations),
      summary: toolSummary(description),
      title,
      toolset: metadata.toolset,
      ...(metadata.workflow ? { workflow: metadata.workflow } : {}),
    }
  })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  if (surface === "progressive") {
    for (const entry of entries) entry.handle.disable()
  }
  return { entries, surface }
}

function scoreTool(
  entry: SearchableMcpTool,
  query: string,
  terms: readonly string[],
): number {
  if (query === "") return 1
  if (entry.normalizedName === query) return 10_000
  let score = 0
  if (entry.normalizedName.startsWith(query)) score += 500
  if (entry.normalizedTitle.startsWith(query)) score += 300
  for (const term of terms) {
    if (entry.normalizedName.includes(term)) score += 100
    if (entry.normalizedTitle.includes(term)) score += 60
    if (normalize(entry.toolset).includes(term)) score += 30
    if (entry.normalizedKeywords.includes(term)) score += 40
    if (entry.normalizedDescription.includes(term)) score += 10
  }
  return score
}

function toolsetSummaries(entries: readonly SearchableMcpTool[]) {
  return MCP_TOOLSET_NAMES
    .map((name) => {
      const tools = entries.filter((entry) => entry.toolset === name)
      return {
        availableTools: tools.length,
        enabledTools: tools.filter((entry) => entry.handle.enabled).length,
        name,
      }
    })
    .filter(({ availableTools }) => availableTools > 0)
}

function workflowNames(
  entries: readonly SearchableMcpTool[],
  matches: readonly SearchableMcpTool[],
): CanonicalMcpToolName[] {
  const names = new Set(matches.map(({ name }) => name))
  const workflows = new Set(
    matches
      .map(({ workflow }) => workflow)
      .filter((workflow): workflow is McpToolWorkflow => workflow !== undefined),
  )
  for (const entry of entries) {
    if (entry.workflow && workflows.has(entry.workflow)) names.add(entry.name)
  }
  return [...names].sort()
}

function matchResult(
  entry: SearchableMcpTool,
  includeContract: boolean,
) {
  return {
    enabled: entry.handle.enabled,
    name: entry.name,
    risk: entry.risk,
    summary: entry.summary,
    title: entry.title,
    toolset: entry.toolset,
    ...(entry.workflow ? { workflow: entry.workflow } : {}),
    ...(includeContract
      ? {
          annotations: entry.annotations,
          description: entry.description,
          inputSchema: entry.inputSchema,
        }
      : {}),
  }
}

export function discoverDiscordTools(
  input: DiscoverDiscordToolsInput,
  catalog: DiscordToolDiscoveryCatalog,
) {
  const query = normalize(input.query || "")
  const terms = [...new Set(
    query
      .split(" ")
      .filter((term) => term && !SEARCH_STOP_WORDS.has(term)),
  )]
  const hasFilters = Boolean(input.query || input.risk || input.toolset)
  const exactEntry = query === ""
    ? undefined
    : catalog.entries.find((entry) => (
        entry.normalizedName === query
        && (!input.toolset || entry.toolset === input.toolset)
        && (!input.risk || entry.risk === input.risk)
      ))
  const ranked = hasFilters
    ? catalog.entries
        .filter((entry) => !input.toolset || entry.toolset === input.toolset)
        .filter((entry) => !input.risk || entry.risk === input.risk)
        .map((entry) => ({ entry, score: scoreTool(entry, query, terms) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => (
          right.score - left.score
          || left.entry.name.localeCompare(right.entry.name)
        ))
    : []
  const selected = exactEntry
    ? [exactEntry]
    : ranked.slice(0, input.limit).map(({ entry }) => entry)
  const exact = exactEntry !== undefined
  const activationNames = workflowNames(catalog.entries, selected)
  const newlyEnabledToolNames: CanonicalMcpToolName[] = []
  if (catalog.surface === "progressive") {
    for (const name of activationNames) {
      const entry = catalog.entries.find((candidate) => candidate.name === name)
      if (!entry || entry.handle.enabled) continue
      entry.handle.enable()
      newlyEnabledToolNames.push(name)
    }
  }
  const includeAllContracts = input.detail === "full" || exact
  return {
    detail: input.detail as McpDiscoveryDetail,
    matches: selected.map((entry) => matchResult(entry, includeAllContracts)),
    newlyEnabledToolNames,
    refreshToolsList: newlyEnabledToolNames.length > 0,
    schemaVersion: SCHEMA_VERSION,
    status: "ok" as const,
    surface: catalog.surface,
    toolsets: toolsetSummaries(catalog.entries),
    totalMatches: exact ? 1 : ranked.length,
  }
}
