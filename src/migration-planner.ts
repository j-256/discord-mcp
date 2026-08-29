import { createHash } from "node:crypto"

import {
  checkDiscordCatalog,
  type DiscordCatalogCheckReport,
} from "./catalog.js"
import {
  CONFIG_RECIPE_NAMES,
  getConfigRecipe,
  type ConfigRecipeName,
} from "./config-recipes.js"
import {
  CONNECTOR_NAME,
  CONNECTOR_NPM_PACKAGE,
  CONNECTOR_VERSION,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  MIGRATION_SOURCE_DEFINITIONS,
  MIGRATION_SOURCE_IDS,
  type MigrationAuditFidelity,
  type MigrationDisposition,
  type MigrationGroupDefinition,
  type MigrationSourceDefinition,
  type MigrationSourceId,
} from "./migration-manifests.js"
import { stableString } from "./normalize.js"
import {
  MCP_TOOL_RISK_CLASSES,
  type McpToolName,
} from "./observability-catalog.js"
import {
  SETUP_PRESET_NAMES,
  type SetupPresetName,
} from "./setup-presets.js"

export const MIGRATION_CATALOG_FORMAT = "discord-mcp.migration-catalog.v1"
export const MIGRATION_PLAN_FORMAT = "discord-mcp.migration-plan.v1"
export const MIGRATION_REPORT_SCHEMA_VERSION = 1
export const MIGRATION_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

const TARGET_CONFIG_FILE = "./discord-mcp.json"
const TARGET_HOST_GUIDE_FILE = "./discord-mcp-host.html"
const TARGET_CREDENTIAL_VARIABLE = "DISCORD_BOT_TOKEN"
const PLACEHOLDER_GUILD_ID = "GUILD_ID"
const PLACEHOLDER_CHANNEL_ID = "CHANNEL_ID"
const PLACEHOLDER_USER_ID = "USER_ID"
const PLACEHOLDER_PLAN_DIGEST = "PLAN_DIGEST"
const PINNED_GITHUB_SOURCE_PATH = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tree\/[0-9a-f]{40}$/u
const REGISTRY_ORIGIN = "https://registry.modelcontextprotocol.io"

const MIGRATION_LIMITATIONS = Object.freeze([
  "The planner does not rewrite prompts, arguments, source configuration, credentials, policy, or MCP host settings.",
  "A target tool name states the supported outcome route, not argument-level compatibility or permission readiness.",
  "Only the exact source release and audit basis named by the selected manifest are covered.",
  "The operator must verify required outcomes before disabling the source server and must separately revoke credentials that are no longer needed.",
])

export interface MigrationExecutionDisclosure {
  readonly activityRecordsCreated: false
  readonly configurationRead: false
  readonly credentialsRead: false
  readonly discordContacted: false
  readonly hostConfigurationRead: false
  readonly networkContacted: false
  readonly policyChanged: false
  readonly processStarted: false
  readonly sourceInspected: false
  readonly sourceOrHostChanged: false
}

const MIGRATION_EXECUTION: MigrationExecutionDisclosure = Object.freeze({
  activityRecordsCreated: false,
  configurationRead: false,
  credentialsRead: false,
  discordContacted: false,
  hostConfigurationRead: false,
  networkContacted: false,
  policyChanged: false,
  processStarted: false,
  sourceInspected: false,
  sourceOrHostChanged: false,
})

export interface MigrationOutcomeMapping {
  readonly disposition: MigrationDisposition
  readonly id: string
  readonly instruction: string
  readonly outcome: string
  readonly recipes: readonly ConfigRecipeName[]
  readonly sourceTools: readonly string[]
  readonly targetTools: readonly McpToolName[]
  readonly trustChange: string
}

export interface MigrationSourceSummary {
  readonly auditFidelity: MigrationAuditFidelity
  readonly baselinePreset: SetupPresetName
  readonly dispositionToolCounts: Record<MigrationDisposition, number>
  readonly evidenceUrl: string
  readonly id: MigrationSourceId
  readonly limitations: readonly string[]
  readonly mappingCount: number
  readonly manifestDigest: string
  readonly product: string
  readonly registryName: string
  readonly registryUrl: string
  readonly sourceInventoryDigest: string
  readonly sourceToolCount: number
  readonly version: string
}

export interface MigrationCatalogReport {
  readonly catalogDigest: string
  readonly execution: MigrationExecutionDisclosure
  readonly format: typeof MIGRATION_CATALOG_FORMAT
  readonly schemaVersion: typeof MIGRATION_REPORT_SCHEMA_VERSION
  readonly sources: readonly MigrationSourceSummary[]
  readonly status: "ok"
}

export interface MigrationPlanStep {
  readonly commands: readonly string[]
  readonly completion: string
  readonly id: string
  readonly title: string
}

export interface MigrationPlanReport {
  readonly argumentsTranslated: false
  readonly catalogDigest: string
  readonly configurationImported: false
  readonly execution: MigrationExecutionDisclosure
  readonly format: typeof MIGRATION_PLAN_FORMAT
  readonly hostSettingsChanged: false
  readonly limitations: readonly string[]
  readonly mappings: readonly MigrationOutcomeMapping[]
  readonly planDigest: string
  readonly schemaVersion: typeof MIGRATION_REPORT_SCHEMA_VERSION
  readonly source: MigrationSourceSummary
  readonly status: "planned"
  readonly steps: readonly MigrationPlanStep[]
  readonly summary: {
    readonly dispositionToolCounts: Record<MigrationDisposition, number>
    readonly mappingCount: number
    readonly sourceToolCount: number
    readonly targetRecipeCount: number
    readonly targetToolCount: number
  }
  readonly target: {
    readonly catalogContractDigest: string
    readonly name: typeof CONNECTOR_NAME
    readonly package: typeof CONNECTOR_NPM_PACKAGE
    readonly preset: SetupPresetName
    readonly version: typeof CONNECTOR_VERSION
  }
}

export interface MigrationPlannerOptions {
  checkCatalog?: () => Promise<DiscordCatalogCheckReport>
}

interface MaterializedMigrationSource {
  readonly definition: MigrationSourceDefinition
  readonly mappings: readonly MigrationOutcomeMapping[]
  readonly summary: MigrationSourceSummary
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableString(value)).digest("hex")}`
}

function sortedUnique(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort()
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${label} contains duplicate values`)
  }
  return sorted
}

function canonicalSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function validateSourceEvidenceUrl(value: string, sourceId: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Migration source ${sourceId} evidence URL is invalid`)
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !PINNED_GITHUB_SOURCE_PATH.test(url.pathname)
  ) {
    throw new Error(`Migration source ${sourceId} evidence must use one commit-pinned GitHub tree URL`)
  }
}

function validateRegistryEvidenceUrl(definition: MigrationSourceDefinition): void {
  const expected = `${REGISTRY_ORIGIN}/v0.1/servers/${encodeURIComponent(definition.registryName)}/versions/${definition.version}`
  if (definition.registryUrl !== expected) {
    throw new Error(`Migration source ${definition.id} Registry evidence does not match its identity`)
  }
}

function matchingSourceTools(
  sourceTools: readonly string[],
  group: MigrationGroupDefinition,
): string[] {
  const names = new Set(group.sourceNames || [])
  const prefixes = group.sourcePrefixes || []
  if (names.size === 0 && prefixes.length === 0) {
    throw new Error(`Migration group ${group.id} has no source selector`)
  }
  if (names.size !== (group.sourceNames || []).length) {
    throw new Error(`Migration group ${group.id} contains duplicate source names`)
  }
  if (new Set(prefixes).size !== prefixes.length) {
    throw new Error(`Migration group ${group.id} contains duplicate source prefixes`)
  }
  for (const name of names) {
    if (!sourceTools.includes(name)) {
      throw new Error(`Migration group ${group.id} names unknown source tool ${name}`)
    }
  }
  const matches = sourceTools.filter((name) => (
    names.has(name) || prefixes.some((prefix) => name.startsWith(prefix))
  ))
  if (matches.length === 0) {
    throw new Error(`Migration group ${group.id} matches no source tools`)
  }
  return matches
}

function materializeMapping(
  definition: MigrationSourceDefinition,
  group: MigrationGroupDefinition,
): MigrationOutcomeMapping {
  const sourceTools = matchingSourceTools(definition.sourceTools, group)
  const targetTools = sortedUnique(group.targetTools, `Migration group ${group.id} target tools`) as McpToolName[]
  const recipes = sortedUnique(group.recipes, `Migration group ${group.id} recipes`) as ConfigRecipeName[]
  if (group.disposition === "intentionally-excluded" && (targetTools.length > 0 || recipes.length > 0)) {
    throw new Error(`Excluded migration group ${group.id} cannot claim target routes`)
  }
  for (const tool of targetTools) {
    if (!Object.hasOwn(MCP_TOOL_RISK_CLASSES, tool)) {
      throw new Error(`Migration group ${group.id} names unknown target tool ${tool}`)
    }
  }
  for (const recipe of recipes) {
    if (!(CONFIG_RECIPE_NAMES as readonly string[]).includes(recipe)) {
      throw new Error(`Migration group ${group.id} names unknown recipe ${recipe}`)
    }
  }
  return Object.freeze({
    disposition: group.disposition,
    id: group.id,
    instruction: group.instruction,
    outcome: group.outcome,
    recipes: Object.freeze(recipes),
    sourceTools: Object.freeze(sourceTools),
    targetTools: Object.freeze(targetTools),
    trustChange: group.trustChange,
  })
}

function dispositionToolCounts(
  mappings: readonly MigrationOutcomeMapping[],
): Record<MigrationDisposition, number> {
  const counts: Record<MigrationDisposition, number> = {
    "intentionally-excluded": 0,
    "review-required": 0,
    supported: 0,
  }
  for (const mapping of mappings) {
    counts[mapping.disposition] += mapping.sourceTools.length
  }
  return Object.freeze(counts)
}

function materializeSource(
  definition: MigrationSourceDefinition,
): MaterializedMigrationSource {
  if (!MIGRATION_SOURCE_IDS.includes(definition.id)) {
    throw new Error(`Unknown migration source definition ${definition.id}`)
  }
  if (!(SETUP_PRESET_NAMES as readonly string[]).includes(definition.baselinePreset)) {
    throw new Error(`Migration source ${definition.id} names unknown preset ${definition.baselinePreset}`)
  }
  if (!definition.id.endsWith(`@${definition.version}`)) {
    throw new Error(`Migration source ${definition.id} version does not match its identity`)
  }
  validateSourceEvidenceUrl(definition.evidenceUrl, definition.id)
  validateRegistryEvidenceUrl(definition)
  const sourceTools = sortedUnique(definition.sourceTools, `Migration source ${definition.id} tools`)
  if (sourceTools.some((name, index) => name !== definition.sourceTools[index])) {
    throw new Error(`Migration source ${definition.id} tools must be canonically ordered`)
  }
  const sourceInventoryDigest = digest(sourceTools)
  if (sourceInventoryDigest !== definition.auditedInventoryDigest) {
    throw new Error(`Migration source ${definition.id} inventory does not match its audited digest`)
  }
  const groupIds = definition.groups.map(({ id }) => id)
  if (new Set(groupIds).size !== groupIds.length) {
    throw new Error(`Migration source ${definition.id} contains duplicate group IDs`)
  }
  const mappings = definition.groups
    .map((group) => materializeMapping(definition, group))
    .sort((left, right) => left.id.localeCompare(right.id))
  const accounted = mappings.flatMap(({ sourceTools: names }) => names).sort()
  if (
    accounted.length !== sourceTools.length
    || accounted.some((name, index) => name !== sourceTools[index])
  ) {
    const duplicate = accounted.find((name, index) => name === accounted[index - 1])
    const missing = sourceTools.find((name) => !accounted.includes(name))
    throw new Error(
      `Migration source ${definition.id} must account for every tool exactly once${duplicate ? `; duplicate ${duplicate}` : ""}${missing ? `; missing ${missing}` : ""}`,
    )
  }
  const normalizedManifest = {
    auditFidelity: definition.auditFidelity,
    baselinePreset: definition.baselinePreset,
    evidenceUrl: definition.evidenceUrl,
    id: definition.id,
    limitations: [...definition.limitations],
    mappings,
    product: definition.product,
    registryName: definition.registryName,
    registryUrl: definition.registryUrl,
    sourceInventoryDigest,
    version: definition.version,
  }
  const summary: MigrationSourceSummary = Object.freeze({
    auditFidelity: definition.auditFidelity,
    baselinePreset: definition.baselinePreset,
    dispositionToolCounts: dispositionToolCounts(mappings),
    evidenceUrl: definition.evidenceUrl,
    id: definition.id,
    limitations: Object.freeze([...definition.limitations]),
    mappingCount: mappings.length,
    manifestDigest: digest(normalizedManifest),
    product: definition.product,
    registryName: definition.registryName,
    registryUrl: definition.registryUrl,
    sourceInventoryDigest,
    sourceToolCount: sourceTools.length,
    version: definition.version,
  })
  return Object.freeze({
    definition,
    mappings: Object.freeze(mappings),
    summary,
  })
}

function materializeSources(): readonly MaterializedMigrationSource[] {
  const definitionIds = MIGRATION_SOURCE_DEFINITIONS.map(({ id }) => id)
  if (
    definitionIds.length !== MIGRATION_SOURCE_IDS.length
    || definitionIds.some((id, index) => id !== MIGRATION_SOURCE_IDS[index])
  ) {
    throw new Error("Migration source definitions must match the canonical source ID order")
  }
  return Object.freeze(MIGRATION_SOURCE_DEFINITIONS.map(materializeSource))
}

const MATERIALIZED_SOURCES = materializeSources()

function catalogPayload(): Omit<MigrationCatalogReport, "catalogDigest"> {
  return {
    execution: MIGRATION_EXECUTION,
    format: MIGRATION_CATALOG_FORMAT,
    schemaVersion: MIGRATION_REPORT_SCHEMA_VERSION as typeof MIGRATION_REPORT_SCHEMA_VERSION,
    sources: MATERIALIZED_SOURCES.map(({ summary }) => summary),
    status: "ok",
  }
}

export function createMigrationCatalog(): MigrationCatalogReport {
  const payload = catalogPayload()
  return Object.freeze({
    catalogDigest: digest(payload),
    ...payload,
  })
}

export function normalizeMigrationSourceId(value: string): MigrationSourceId {
  if (typeof value !== "string") {
    throw new ConfigurationError("Migration source must be a string")
  }
  const normalized = value.trim().toLowerCase()
  if (!(MIGRATION_SOURCE_IDS as readonly string[]).includes(normalized)) {
    throw new ConfigurationError(
      `Migration source must be one of: ${MIGRATION_SOURCE_IDS.join(", ")}`,
    )
  }
  return normalized as MigrationSourceId
}

function selectedSource(value: string): MaterializedMigrationSource {
  const id = normalizeMigrationSourceId(value)
  return MATERIALIZED_SOURCES.find(({ summary }) => summary.id === id) as MaterializedMigrationSource
}

function recipeSteps(recipes: readonly ConfigRecipeName[]): MigrationPlanStep[] {
  return recipes.flatMap((recipe) => {
    const requirement = getConfigRecipe(recipe).requirements.scope
    const placeholder = requirement.kind === "guild"
      ? PLACEHOLDER_GUILD_ID
      : requirement.kind === "channel"
        ? PLACEHOLDER_CHANNEL_ID
        : PLACEHOLDER_USER_ID
    const option = `${requirement.option} ${placeholder}`
    return [{
      commands: [
        `discord-mcp recipe plan ${recipe} ${TARGET_CONFIG_FILE} ${option}`,
        `discord-mcp recipe apply ${recipe} ${TARGET_CONFIG_FILE} ${option} --plan-digest ${PLACEHOLDER_PLAN_DIGEST} --confirm ${recipe}`,
      ],
      completion: `The ${recipe} plan was reviewed, its fresh digest was used once, and only the intended exact scope was added.`,
      id: `recipe-${recipe}`,
      title: `Add ${recipe} only if required`,
    }]
  })
}

function planSteps(
  preset: SetupPresetName,
  recipes: readonly ConfigRecipeName[],
): readonly MigrationPlanStep[] {
  const scopeArguments = preset === "channel-reader"
    ? `--guild-id ${PLACEHOLDER_GUILD_ID} --channel-id ${PLACEHOLDER_CHANNEL_ID}`
    : `--guild-id ${PLACEHOLDER_GUILD_ID}`
  return Object.freeze([
    {
      commands: ["discord-mcp catalog --check"],
      completion: "The installed target contract and digest were inspected without credentials or execution.",
      id: "inspect-target",
      title: "Inspect the target contract",
    },
    {
      commands: [`discord-mcp setup --config ${TARGET_CONFIG_FILE} --preset ${preset} ${scopeArguments} --token-env ${TARGET_CREDENTIAL_VARIABLE}`],
      completion: "A new strict schema-v2 policy contains only the selected exact read scope and a non-secret credential reference.",
      id: "create-baseline",
      title: "Create a least-privilege baseline",
    },
    ...recipeSteps(recipes),
    {
      commands: [
        `discord-mcp config workbench ${TARGET_CONFIG_FILE} --html ./discord-mcp-policy-workbench.html`,
      ],
      completion: "Any outcome not covered by a named recipe was reviewed in the offline workbench and added with its exact capability and scope only.",
      id: "review-additional-authority",
      title: "Review any additional authority",
    },
    {
      commands: [`discord-mcp host --config ${TARGET_CONFIG_FILE} --html ${TARGET_HOST_GUIDE_FILE}`],
      completion: "The selected MCP host adapter, launch descriptor, and first read request were reviewed without changing host settings.",
      id: "plan-host-activation",
      title: "Generate host activation guidance",
    },
    {
      commands: [
        `discord-mcp doctor --config ${TARGET_CONFIG_FILE}`,
        `discord-mcp doctor --config ${TARGET_CONFIG_FILE} --online`,
        `discord-mcp smoke --config ${TARGET_CONFIG_FILE}`,
      ],
      completion: "Offline policy checks, live identity and scope checks, and a real stdio MCP handshake all succeeded.",
      id: "verify-target",
      title: "Verify policy, Discord access, and stdio",
    },
    {
      commands: [],
      completion: "Every required source outcome was checked against this plan before the old server was disabled, and obsolete credentials were separately revoked.",
      id: "retire-source",
      title: "Retire the source deliberately",
    },
  ])
}

export async function createMigrationPlan(
  sourceValue: string,
  options: MigrationPlannerOptions = {},
): Promise<MigrationPlanReport> {
  const selected = selectedSource(sourceValue)
  const catalog = createMigrationCatalog()
  const targetCatalog = await (options.checkCatalog || checkDiscordCatalog)()
  const targetNames = new Set(targetCatalog.toolNames)
  const targetTools = canonicalSet(
    selected.mappings.flatMap(({ targetTools: tools }) => tools),
  )
  for (const tool of targetTools) {
    if (!targetNames.has(tool)) {
      throw new Error(`Migration source ${selected.summary.id} target tool ${tool} is absent from the negotiated catalog`)
    }
  }
  const recipes = canonicalSet(
    selected.mappings.flatMap(({ recipes: names }) => names),
  ) as ConfigRecipeName[]
  const payload = {
    argumentsTranslated: false as const,
    catalogDigest: catalog.catalogDigest,
    configurationImported: false as const,
    execution: MIGRATION_EXECUTION,
    format: MIGRATION_PLAN_FORMAT as typeof MIGRATION_PLAN_FORMAT,
    hostSettingsChanged: false as const,
    limitations: Object.freeze([...selected.summary.limitations, ...MIGRATION_LIMITATIONS]),
    mappings: selected.mappings,
    schemaVersion: MIGRATION_REPORT_SCHEMA_VERSION as typeof MIGRATION_REPORT_SCHEMA_VERSION,
    source: selected.summary,
    status: "planned" as const,
    steps: planSteps(selected.summary.baselinePreset, recipes),
    summary: Object.freeze({
      dispositionToolCounts: selected.summary.dispositionToolCounts,
      mappingCount: selected.mappings.length,
      sourceToolCount: selected.summary.sourceToolCount,
      targetRecipeCount: recipes.length,
      targetToolCount: targetTools.length,
    }),
    target: Object.freeze({
      catalogContractDigest: targetCatalog.contractDigest,
      name: CONNECTOR_NAME,
      package: CONNECTOR_NPM_PACKAGE,
      preset: selected.summary.baselinePreset,
      version: CONNECTOR_VERSION,
    }),
  }
  return Object.freeze({
    ...payload,
    planDigest: digest(payload),
  })
}

export function verifyMigrationPlan(plan: MigrationPlanReport): boolean {
  if (
    plan.format !== MIGRATION_PLAN_FORMAT
    || plan.schemaVersion !== MIGRATION_REPORT_SCHEMA_VERSION
    || plan.status !== "planned"
    || !MIGRATION_DIGEST_PATTERN.test(plan.planDigest)
  ) {
    return false
  }
  const { planDigest, ...payload } = plan
  return digest(payload) === planDigest
}
