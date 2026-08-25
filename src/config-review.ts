import { createHash } from "node:crypto"

import {
  CONFIG_CAPABILITY_NAMES,
  CONFIG_LIMIT_NAMES,
  CONFIG_RUNTIME_NAMES,
  CONFIG_SCOPE_NAMES,
  CONFIG_STORAGE_NAMES,
  loadConnectorConfigDocumentFile,
  type ConnectorConfigDocument,
  type ConnectorConfigDocumentObservability,
} from "./config-document.js"
import {
  resolveConnectorConfigFile,
  summarizeConnectorConfigDocument,
  validateConnectorConfigDocumentPolicy,
  writeConnectorConfigDocumentFile,
  type ConnectorConfigSummary,
  type ConfigWriteOutcome,
} from "./config-operator.js"
import {
  DISCORD_LIMITS,
  GUILD_PRUNE_DEFAULTS,
  INTERACTION_DEFAULTS,
  MCP_READ_RESPONSE_DEFAULTS,
  NATIVE_INTERACTION_DEFAULTS,
} from "./constants.js"
import { ConfigChangeError } from "./errors.js"
import { selectedCanonicalMcpToolNames } from "./mcp-tool-catalog.js"
import { stableString } from "./normalize.js"

export const CONFIG_CHANGE_REPORT_SCHEMA_VERSION = 1
export const CONFIG_CHANGE_PLAN_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

const CONFIG_CHANGE_PLAN_FORMAT = "discord-mcp.config-change-plan.v1"
const OMITTED_VALUE = Object.freeze({ state: "omitted" as const })

export type ConfigChangeCategory =
  | "capability"
  | "credential"
  | "feature-scope"
  | "gateway"
  | "limits"
  | "metadata"
  | "observability"
  | "read-scope"
  | "runtime"
  | "storage"
  | "tool-surface"

export type ConfigChangeImpact =
  | "authority-expansion"
  | "authority-reduction"
  | "authority-redistribution"
  | "metadata-only"
  | "operational-change"

export interface ConfigChangeRecord {
  readonly after: unknown
  readonly before: unknown
  readonly category: ConfigChangeCategory
  readonly impact: ConfigChangeImpact
  readonly path: string
}

export interface ConfigChangeImpactSummary {
  readonly authorityExpansions: number
  readonly authorityReductions: number
  readonly authorityRedistributions: number
  readonly metadataOnly: number
  readonly operationalChanges: number
  readonly total: number
}

export interface ConfigChangeCommand {
  readonly args: readonly string[]
  readonly command: "discord-mcp"
}

export interface ConfigChangePlanOptions {
  readonly candidateFile: string
  readonly file: string
}

export interface ConfigChangeApplyOptions extends ConfigChangePlanOptions {
  readonly confirmation: string
  readonly planDigest: string
}

export interface ConfigChangePlanReport {
  readonly action: "plan"
  readonly candidateDocument: ConnectorConfigDocument
  readonly candidateDocumentDigest: string
  readonly candidateFile: string
  readonly candidateSummary: ConnectorConfigSummary
  readonly changes: readonly ConfigChangeRecord[]
  readonly confirmation: {
    readonly requiredValue: string
  }
  readonly currentDocumentDigest: string
  readonly currentSummary: ConnectorConfigSummary
  readonly execution: {
    readonly configurationWritten: false
    readonly discordContacted: false
    readonly secretValuesRead: false
  }
  readonly file: string
  readonly format: typeof CONFIG_CHANGE_PLAN_FORMAT
  readonly impact: ConfigChangeImpactSummary
  readonly nextChecks: readonly ConfigChangeCommand[]
  readonly planDigest: string
  readonly schemaVersion: typeof CONFIG_CHANGE_REPORT_SCHEMA_VERSION
  readonly status: "already-current" | "planned"
  readonly tools: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
  }
  readonly warnings: readonly string[]
}

export interface ConfigChangeApplyReport extends Omit<
  ConfigChangePlanReport,
  "action" | "execution" | "status"
> {
  readonly action: "apply"
  readonly applied: boolean
  readonly backupFile?: string
  readonly execution: {
    readonly configurationWritten: boolean
    readonly discordContacted: false
    readonly secretValuesRead: false
  }
  readonly status: "already-current" | "applied"
}

interface InternalConfigChangePlan {
  readonly currentDocument: ConnectorConfigDocument
  readonly report: ConfigChangePlanReport
}

interface RawValue {
  readonly present: boolean
  readonly value: unknown
}

const LIMIT_DEFAULTS = Object.freeze({
  attachmentMaxBytes: DISCORD_LIMITS.attachmentBytes,
  guildPruneMaxMembers: GUILD_PRUNE_DEFAULTS.maximumMemberCount,
  interactionMaxWritesPerMinute: INTERACTION_DEFAULTS.maxWritesPerMinute,
  interactionMinWriteIntervalMs: INTERACTION_DEFAULTS.minWriteIntervalMs,
  mcpReadResponseMaxBytes: MCP_READ_RESPONSE_DEFAULTS.maxBytes,
  nativeInteractionMaxPending: NATIVE_INTERACTION_DEFAULTS.maximumPending,
  nativeInteractionTtlSeconds: NATIVE_INTERACTION_DEFAULTS.ttlSeconds,
})

const OBSERVABILITY_PATHS = Object.freeze([
  ["compression"],
  ["endpoint"],
  ["exportEnabled"],
  ["headers"],
  ["jsonLogsEnabled"],
  ["metrics", "compression"],
  ["metrics", "endpoint"],
  ["metrics", "headers"],
  ["metrics", "protocol"],
  ["metrics", "timeoutMs"],
  ["protocol"],
  ["serviceName"],
  ["timeoutMs"],
  ["traceSampleRatio"],
  ["traceSampler"],
  ["traces", "compression"],
  ["traces", "endpoint"],
  ["traces", "headers"],
  ["traces", "protocol"],
  ["traces", "timeoutMs"],
] as const)

function digest(value: unknown, domain?: string): string {
  const hash = createHash("sha256")
  if (domain) hash.update(domain).update("\0")
  return `sha256:${hash.update(stableString(value)).digest("hex")}`
}

function ownValue(
  object: Readonly<Record<string, unknown>>,
  key: string,
): RawValue {
  return Object.hasOwn(object, key)
    ? { present: true, value: object[key] }
    : { present: false, value: undefined }
}

function displayValue(value: RawValue): unknown {
  return value.present ? value.value : OMITTED_VALUE
}

function sameRaw(left: RawValue, right: RawValue): boolean {
  return left.present === right.present
    && (!left.present || stableString(left.value) === stableString(right.value))
}

function addChange(
  changes: ConfigChangeRecord[],
  path: string,
  category: ConfigChangeCategory,
  impact: ConfigChangeImpact,
  before: RawValue,
  after: RawValue,
): void {
  if (sameRaw(before, after)) return
  changes.push(Object.freeze({
    after: displayValue(after),
    before: displayValue(before),
    category,
    impact,
    path,
  }))
}

function booleanImpact(
  before: RawValue,
  after: RawValue,
  defaultValue = false,
): ConfigChangeImpact {
  const beforeValue = before.present ? before.value : defaultValue
  const afterValue = after.present ? after.value : defaultValue
  if (beforeValue === afterValue) return "metadata-only"
  return afterValue ? "authority-expansion" : "authority-reduction"
}

function arrayValues(value: RawValue): readonly string[] {
  return value.present ? value.value as readonly string[] : []
}

function setImpact(
  before: RawValue,
  after: RawValue,
  inverse = false,
): ConfigChangeImpact {
  const beforeValues = new Set(arrayValues(before))
  const afterValues = new Set(arrayValues(after))
  const added = [...afterValues].some((value) => !beforeValues.has(value))
  const removed = [...beforeValues].some((value) => !afterValues.has(value))
  if (!added && !removed) return "metadata-only"
  if (added && removed) return "authority-redistribution"
  if (added) return inverse ? "authority-reduction" : "authority-expansion"
  return inverse ? "authority-expansion" : "authority-reduction"
}

function readChannelScopeImpact(
  before: RawValue,
  after: RawValue,
): ConfigChangeImpact {
  const beforeValues = arrayValues(before)
  const afterValues = arrayValues(after)
  if (beforeValues.length === 0 && afterValues.length > 0) {
    return "authority-reduction"
  }
  if (beforeValues.length > 0 && afterValues.length === 0) {
    return "authority-expansion"
  }
  return setImpact(before, after)
}

function numberImpact(
  before: RawValue,
  after: RawValue,
  defaultValue: number,
  inverse = false,
): ConfigChangeImpact {
  const beforeValue = before.present ? before.value as number : defaultValue
  const afterValue = after.present ? after.value as number : defaultValue
  if (beforeValue === afterValue) return "metadata-only"
  const increased = afterValue > beforeValue
  if (increased) return inverse ? "authority-reduction" : "authority-expansion"
  return inverse ? "authority-expansion" : "authority-reduction"
}

function nestedValue(
  source: ConnectorConfigDocumentObservability,
  path: readonly string[],
): RawValue {
  let current: unknown = source
  for (const [index, key] of path.entries()) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return { present: false, value: undefined }
    }
    const value = ownValue(current as Readonly<Record<string, unknown>>, key)
    if (!value.present) return value
    if (index === path.length - 1) return value
    current = value.value
  }
  return { present: false, value: undefined }
}

function observabilityImpact(
  path: readonly string[],
  before: RawValue,
  after: RawValue,
): ConfigChangeImpact {
  const name = path.join(".")
  if (name === "exportEnabled" || name === "jsonLogsEnabled") {
    return booleanImpact(before, after)
  }
  if (name === "traceSampleRatio") {
    return numberImpact(before, after, 1)
  }
  if (name.endsWith("endpoint") || name.endsWith("headers")) {
    return "authority-redistribution"
  }
  return "operational-change"
}

function configChanges(
  current: ConnectorConfigDocument,
  candidate: ConnectorConfigDocument,
): readonly ConfigChangeRecord[] {
  const changes: ConfigChangeRecord[] = []
  const currentRecord = current as unknown as Readonly<Record<string, unknown>>
  const candidateRecord = candidate as unknown as Readonly<Record<string, unknown>>

  addChange(
    changes,
    "$.$schema",
    "metadata",
    "metadata-only",
    ownValue(currentRecord, "$schema"),
    ownValue(candidateRecord, "$schema"),
  )
  addChange(
    changes,
    "$.name",
    "metadata",
    "metadata-only",
    ownValue(currentRecord, "name"),
    ownValue(candidateRecord, "name"),
  )
  addChange(
    changes,
    "$.credential",
    "credential",
    "authority-redistribution",
    ownValue(currentRecord, "credential"),
    ownValue(candidateRecord, "credential"),
  )

  for (const name of ["guildIds", "channelIds"] as const) {
    const before = ownValue(current.readScope, name)
    const after = ownValue(candidate.readScope, name)
    addChange(
      changes,
      `$.readScope.${name}`,
      "read-scope",
      name === "channelIds"
        ? readChannelScopeImpact(before, after)
        : setImpact(before, after),
      before,
      after,
    )
  }

  const currentCapabilities = current.capabilities as Readonly<Record<string, unknown>>
  const candidateCapabilities = candidate.capabilities as Readonly<Record<string, unknown>>
  for (const name of CONFIG_CAPABILITY_NAMES) {
    const before = ownValue(currentCapabilities, name)
    const after = ownValue(candidateCapabilities, name)
    addChange(
      changes,
      `$.capabilities.${name}`,
      "capability",
      booleanImpact(before, after),
      before,
      after,
    )
  }

  const currentScopes = current.scopes as Readonly<Record<string, unknown>>
  const candidateScopes = candidate.scopes as Readonly<Record<string, unknown>>
  for (const name of CONFIG_SCOPE_NAMES) {
    const before = ownValue(currentScopes, name)
    const after = ownValue(candidateScopes, name)
    addChange(
      changes,
      `$.scopes.${name}`,
      "feature-scope",
      setImpact(before, after, name === "protectedUserIds"),
      before,
      after,
    )
  }

  const currentTools = current.tools as unknown as Readonly<Record<string, unknown>>
  const candidateTools = candidate.tools as unknown as Readonly<Record<string, unknown>>
  addChange(
    changes,
    "$.tools.surface",
    "tool-surface",
    "operational-change",
    ownValue(currentTools, "surface"),
    ownValue(candidateTools, "surface"),
  )
  const currentToolsets = ownValue(currentTools, "toolsets")
  const candidateToolsets = ownValue(candidateTools, "toolsets")
  addChange(
    changes,
    "$.tools.toolsets",
    "tool-surface",
    setImpact(currentToolsets, candidateToolsets),
    currentToolsets,
    candidateToolsets,
  )

  const currentGateway = current.gateway as unknown as Readonly<Record<string, unknown>>
  const candidateGateway = candidate.gateway as unknown as Readonly<Record<string, unknown>>
  const currentGatewayEnabled = ownValue(currentGateway, "enabled")
  const candidateGatewayEnabled = ownValue(candidateGateway, "enabled")
  addChange(
    changes,
    "$.gateway.enabled",
    "gateway",
    booleanImpact(currentGatewayEnabled, candidateGatewayEnabled),
    currentGatewayEnabled,
    candidateGatewayEnabled,
  )
  const currentGatewayBuffer = ownValue(currentGateway, "eventBufferSize")
  const candidateGatewayBuffer = ownValue(candidateGateway, "eventBufferSize")
  addChange(
    changes,
    "$.gateway.eventBufferSize",
    "gateway",
    numberImpact(currentGatewayBuffer, candidateGatewayBuffer, 0),
    currentGatewayBuffer,
    candidateGatewayBuffer,
  )

  const currentLimits = current.limits as Readonly<Record<string, unknown>>
  const candidateLimits = candidate.limits as Readonly<Record<string, unknown>>
  for (const name of CONFIG_LIMIT_NAMES) {
    const before = ownValue(currentLimits, name)
    const after = ownValue(candidateLimits, name)
    addChange(
      changes,
      `$.limits.${name}`,
      "limits",
      numberImpact(
        before,
        after,
        LIMIT_DEFAULTS[name],
        name === "interactionMinWriteIntervalMs",
      ),
      before,
      after,
    )
  }

  const currentStorage = current.storage as unknown as Readonly<Record<string, unknown>>
  const candidateStorage = candidate.storage as unknown as Readonly<Record<string, unknown>>
  for (const name of CONFIG_STORAGE_NAMES) {
    const before = ownValue(currentStorage, name)
    const after = ownValue(candidateStorage, name)
    const impact = name === "auditFile"
      ? "authority-redistribution"
      : setImpact(before, after)
    addChange(
      changes,
      `$.storage.${name}`,
      "storage",
      impact,
      before,
      after,
    )
  }

  const currentRuntime = current.runtime as Readonly<Record<string, unknown>>
  const candidateRuntime = candidate.runtime as Readonly<Record<string, unknown>>
  for (const name of CONFIG_RUNTIME_NAMES) {
    const before = ownValue(currentRuntime, name)
    const after = ownValue(candidateRuntime, name)
    const beforeValue = before.present
      ? before.value
      : NATIVE_INTERACTION_DEFAULTS.commandName
    const afterValue = after.present
      ? after.value
      : NATIVE_INTERACTION_DEFAULTS.commandName
    addChange(
      changes,
      `$.runtime.${name}`,
      "runtime",
      beforeValue === afterValue ? "metadata-only" : "operational-change",
      before,
      after,
    )
  }

  for (const path of OBSERVABILITY_PATHS) {
    const before = nestedValue(current.observability, path)
    const after = nestedValue(candidate.observability, path)
    addChange(
      changes,
      `$.observability.${path.join(".")}`,
      "observability",
      observabilityImpact(path, before, after),
      before,
      after,
    )
  }

  return Object.freeze(changes.sort((left, right) => left.path.localeCompare(right.path)))
}

function impactSummary(
  changes: readonly ConfigChangeRecord[],
): ConfigChangeImpactSummary {
  return Object.freeze({
    authorityExpansions: changes.filter(({ impact }) => impact === "authority-expansion").length,
    authorityReductions: changes.filter(({ impact }) => impact === "authority-reduction").length,
    authorityRedistributions: changes.filter(({ impact }) => impact === "authority-redistribution").length,
    metadataOnly: changes.filter(({ impact }) => impact === "metadata-only").length,
    operationalChanges: changes.filter(({ impact }) => impact === "operational-change").length,
    total: changes.length,
  })
}

function changedTools(
  current: ConnectorConfigDocument,
  candidate: ConnectorConfigDocument,
): ConfigChangePlanReport["tools"] {
  const before = new Set(selectedCanonicalMcpToolNames(new Set(current.tools.toolsets)))
  const after = new Set(selectedCanonicalMcpToolNames(new Set(candidate.tools.toolsets)))
  return Object.freeze({
    added: Object.freeze([...after].filter((name) => !before.has(name)).sort()),
    removed: Object.freeze([...before].filter((name) => !after.has(name)).sort()),
  })
}

function nextChecks(file: string): readonly ConfigChangeCommand[] {
  return Object.freeze([
    Object.freeze({
      args: Object.freeze(["config", "validate", file]),
      command: "discord-mcp" as const,
    }),
    Object.freeze({
      args: Object.freeze(["doctor", "--config", file, "--online"]),
      command: "discord-mcp" as const,
    }),
    Object.freeze({
      args: Object.freeze(["smoke", "--config", file]),
      command: "discord-mcp" as const,
    }),
  ])
}

function planWarnings(
  candidate: ConnectorConfigDocument,
  changes: readonly ConfigChangeRecord[],
  tools: ConfigChangePlanReport["tools"],
): readonly string[] {
  const warnings = [
    "A local policy replacement does not grant Discord permissions, enable Developer Portal intents, install the bot, or prove live access",
    "After application, run offline validation, online doctor, and read-only MCP smoke before relying on the changed policy",
  ]
  if (changes.some(({ category, impact }) => (
    category === "read-scope" && impact === "authority-expansion"
  ))) {
    warnings.push("The candidate expands the outer Discord read boundary")
  }
  if (changes.some(({ category, impact }) => (
    category === "capability" && impact === "authority-expansion"
  ))) {
    warnings.push("The candidate enables additional independently gated feature authority")
  }
  if (tools.added.length > 0) {
    warnings.push("The candidate exposes additional canonical MCP tools through its selected toolsets")
  }
  if (changes.some(({ category, impact }) => (
    category === "gateway" && impact === "authority-expansion"
  ))) {
    warnings.push("The candidate enables or increases privacy-safe Gateway collection or retention")
  }
  if (changes.some(({ category }) => category === "observability")) {
    warnings.push("The candidate changes content-free logging or telemetry behavior; review every destination and external header reference")
  }
  if (changes.some(({ category }) => category === "storage")) {
    warnings.push("The candidate changes local file-read or activity-state boundaries")
  }
  if (changes.some(({ category }) => category === "credential")) {
    warnings.push("The candidate references a different external credential source; planning does not read or verify that secret")
  }
  if (candidate.readScope.channelIds.length === 0) {
    warnings.push("The candidate has no channel allowlist, so channel reads rely on Discord visibility inside the exact guild boundary")
  }
  return Object.freeze(warnings)
}

function createConfigChangePlan(
  options: ConfigChangePlanOptions,
): InternalConfigChangePlan {
  const file = resolveConnectorConfigFile(options.file)
  const candidateFile = resolveConnectorConfigFile(options.candidateFile)
  if (file === candidateFile) {
    throw new ConfigChangeError(
      "Configuration change planning requires distinct active and candidate files",
      "review",
    )
  }
  let currentDocument: ConnectorConfigDocument
  try {
    currentDocument = validateConnectorConfigDocumentPolicy(
      loadConnectorConfigDocumentFile(file),
    )
  } catch (error) {
    throw new ConfigChangeError(
      "The active configuration is unavailable or invalid",
      "active",
      { cause: error },
    )
  }
  let candidateDocument: ConnectorConfigDocument
  try {
    candidateDocument = validateConnectorConfigDocumentPolicy(
      loadConnectorConfigDocumentFile(candidateFile),
    )
  } catch (error) {
    throw new ConfigChangeError(
      "The candidate configuration is unavailable or invalid",
      "candidate",
      { cause: error },
    )
  }
  if (
    currentDocument.identity.applicationId !== candidateDocument.identity.applicationId
    || currentDocument.identity.botId !== candidateDocument.identity.botId
  ) {
    throw new ConfigChangeError(
      "Configuration candidate identity must exactly match the active application and bot",
      "identity",
    )
  }
  const changes = configChanges(currentDocument, candidateDocument)
  const tools = changedTools(currentDocument, candidateDocument)
  const warnings = planWarnings(candidateDocument, changes, tools)
  const currentDocumentDigest = digest(currentDocument)
  const candidateDocumentDigest = digest(candidateDocument)
  const confirmation = Object.freeze({ requiredValue: currentDocument.name })
  const planDigest = digest({
    candidateDocumentDigest,
    candidateFile,
    changes,
    confirmation,
    currentDocumentDigest,
    file,
    format: CONFIG_CHANGE_PLAN_FORMAT,
    tools,
    warnings,
  }, CONFIG_CHANGE_PLAN_FORMAT)
  const report: ConfigChangePlanReport = Object.freeze({
    action: "plan",
    candidateDocument,
    candidateDocumentDigest,
    candidateFile,
    candidateSummary: summarizeConnectorConfigDocument(candidateDocument),
    changes,
    confirmation,
    currentDocumentDigest,
    currentSummary: summarizeConnectorConfigDocument(currentDocument),
    execution: Object.freeze({
      configurationWritten: false as const,
      discordContacted: false as const,
      secretValuesRead: false as const,
    }),
    file,
    format: CONFIG_CHANGE_PLAN_FORMAT,
    impact: impactSummary(changes),
    nextChecks: nextChecks(file),
    planDigest,
    schemaVersion: CONFIG_CHANGE_REPORT_SCHEMA_VERSION,
    status: changes.length === 0 ? "already-current" : "planned",
    tools,
    warnings,
  })
  return { currentDocument, report }
}

export function planConfigChange(
  options: ConfigChangePlanOptions,
): ConfigChangePlanReport {
  return createConfigChangePlan(options).report
}

export async function applyConfigChange(
  options: ConfigChangeApplyOptions,
): Promise<ConfigChangeApplyReport> {
  const planned = createConfigChangePlan(options)
  const report = planned.report
  if (options.confirmation !== report.confirmation.requiredValue) {
    throw new ConfigChangeError(
      `Configuration change confirmation must exactly match ${report.confirmation.requiredValue}`,
      "review",
    )
  }
  if (!CONFIG_CHANGE_PLAN_DIGEST_PATTERN.test(options.planDigest)) {
    throw new ConfigChangeError(
      "Configuration change plan digest is invalid",
      "review",
    )
  }
  if (options.planDigest !== report.planDigest) {
    throw new ConfigChangeError(
      "Configuration change plan is stale or does not match the exact active and candidate files",
      "review",
    )
  }
  if (report.status === "already-current") {
    return Object.freeze({
      ...report,
      action: "apply",
      applied: false,
      execution: Object.freeze({
        configurationWritten: false,
        discordContacted: false as const,
        secretValuesRead: false as const,
      }),
      status: "already-current",
    })
  }
  let outcome: ConfigWriteOutcome
  try {
    outcome = await writeConnectorConfigDocumentFile(
      report.file,
      report.candidateDocument,
      {
        expectedCurrent: planned.currentDocument,
        overwrite: true,
      },
    )
  } catch (error) {
    throw new ConfigChangeError(
      "Configuration change application was blocked by fresh file or publication evidence",
      "review",
      { cause: error },
    )
  }
  return Object.freeze({
    ...report,
    action: "apply",
    applied: true,
    ...(outcome.backupFile ? { backupFile: outcome.backupFile } : {}),
    execution: Object.freeze({
      configurationWritten: true,
      discordContacted: false as const,
      secretValuesRead: false as const,
    }),
    status: "applied",
  })
}
