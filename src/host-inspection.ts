import { createHash } from "node:crypto"

import { ConfigurationError } from "./errors.js"
import {
  createHostAdapterCatalog,
  findHostAdapter,
  type HostAdapter,
  type HostAdapterId,
} from "./host-adapters.js"
import type { HostActivationPlan } from "./host-activation.js"
import {
  HOST_JSON_MAX_BYTES,
  HOST_JSON_MIN_BYTES,
  readHostJsonSnapshot,
  type HostFileReview,
} from "./host-file.js"
import { stableString } from "./normalize.js"

export const HOST_INSPECTION_FORMAT = "discord-mcp.host-inspection.v1"
export const HOST_INSPECTION_SCHEMA_VERSION = 1
export const HOST_INSPECTION_MIN_BYTES = HOST_JSON_MIN_BYTES
export const HOST_INSPECTION_MAX_BYTES = HOST_JSON_MAX_BYTES

export const HOST_INSPECTION_DIFFERENCES = Object.freeze([
  "host-root-invalid",
  "server-collection-missing",
  "server-entry-missing",
  "server-entry-invalid",
  "command-mismatch",
  "arguments-mismatch",
  "transport-mismatch",
  "environment-reference-mismatch",
  "server-options-mismatch",
  "sensitive-input-collection-missing",
  "sensitive-input-missing",
  "sensitive-input-ambiguous",
  "sensitive-input-mismatch",
  "extension-name-mismatch",
  "extension-version-mismatch",
  "extension-description-mismatch",
  "extension-settings-mismatch",
  "extension-options-mismatch",
] as const)

export type HostInspectionDifference = typeof HOST_INSPECTION_DIFFERENCES[number]

export interface HostInspectionReport {
  readonly adapter: {
    readonly activationDigest: string
    readonly adapterDigest: string
    readonly hostServerName: string
    readonly id: HostAdapterId
    readonly title: string
  }
  readonly comparison: {
    readonly differences: readonly HostInspectionDifference[]
    readonly matchedSensitiveInputCount: number
    readonly expectedSensitiveInputCount: number
    readonly serverEntry: "drifted" | "exact" | "invalid" | "missing"
    readonly unrelatedState: "ignored" | "not-applicable"
  }
  readonly fileReview: HostFileReview
  readonly format: typeof HOST_INSPECTION_FORMAT
  readonly inspectionDigest: string
  readonly limitations: readonly string[]
  readonly privacy: {
    readonly activityRecordsCreated: false
    readonly credentialValuesReturned: false
    readonly discordContacted: false
    readonly hostConfigurationChanged: false
    readonly hostConfigurationRead: true
    readonly hostPathReturned: false
    readonly networkContacted: false
    readonly possibleCredentialMaterialRead: true
    readonly processStarted: false
    readonly rawHostConfigurationReturned: false
    readonly unrelatedHostStateReturned: false
  }
  readonly schemaVersion: typeof HOST_INSPECTION_SCHEMA_VERSION
  readonly status: "drift" | "match"
}

interface ComparisonResult {
  readonly differences: readonly HostInspectionDifference[]
  readonly expectedSensitiveInputCount: number
  readonly matchedSensitiveInputCount: number
  readonly serverEntry: HostInspectionReport["comparison"]["serverEntry"]
  readonly unrelatedState: HostInspectionReport["comparison"]["unrelatedState"]
}

const HOST_INSPECTION_DIGEST_DOMAIN = "discord-mcp-host-inspection-v1\0"
const SHARED_ADAPTER_IDS = new Set<HostAdapterId>(["cursor", "mcp-json", "vscode"])
const STANDARD_SERVER_KEYS = new Set(["args", "command", "env", "type"])
const HOST_INSPECTION_LIMITATIONS = Object.freeze([
  "A match proves one stable static file projection, not that the host loaded it or retained it unchanged.",
  "JSON is byte-, depth-, and node-bounded; non-finite, unsafe-integer, and negative-zero values fail closed.",
  "Inspection does not prove secret availability, host approval behavior, elicitation support, process startup, MCP negotiation, or Discord access.",
  "The parent must be canonical, process-owned, and not writable by group or world where portable metadata exists; other platforms cannot verify that boundary.",
  "On platforms without portable owner and mode metadata, file ownership and access are reported as platform-unverified rather than claimed private.",
  "Unrelated host entries and inputs are deliberately ignored and are not returned, counted, hashed, or assessed.",
  "Activation, adapter, and inspection digests can confirm already-suspected private launcher references and are not anonymity mechanisms.",
])

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactValue(left: unknown, right: unknown): boolean {
  return stableString(left) === stableString(right)
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(HOST_INSPECTION_DIGEST_DOMAIN)
    .update(stableString(value))
    .digest("hex")}`
}

function expectedServer(adapter: HostAdapter): {
  readonly collection: "mcpServers" | "servers"
  readonly value: Record<string, unknown>
} {
  const collection = adapter.id === "vscode" ? "servers" : "mcpServers"
  const container = ownValue(adapter.configuration, collection)
  if (!isRecord(container)) {
    throw new ConfigurationError(`Host adapter ${adapter.id} has an invalid server collection`)
  }
  const value = ownValue(container, adapter.hostServerName)
  if (!isRecord(value)) {
    throw new ConfigurationError(`Host adapter ${adapter.id} has an invalid server entry`)
  }
  return { collection, value }
}

function compareServer(
  root: unknown,
  adapter: HostAdapter,
  differences: Set<HostInspectionDifference>,
): HostInspectionReport["comparison"]["serverEntry"] {
  if (!isRecord(root)) {
    differences.add("host-root-invalid")
    return "invalid"
  }
  const expected = expectedServer(adapter)
  const collection = ownValue(root, expected.collection)
  if (!isRecord(collection)) {
    differences.add("server-collection-missing")
    return "invalid"
  }
  if (!Object.hasOwn(collection, adapter.hostServerName)) {
    differences.add("server-entry-missing")
    return "missing"
  }
  const actual = ownValue(collection, adapter.hostServerName)
  if (!isRecord(actual)) {
    differences.add("server-entry-invalid")
    return "invalid"
  }
  if (!exactValue(actual.command, expected.value.command)) differences.add("command-mismatch")
  if (!exactValue(actual.args, expected.value.args)) differences.add("arguments-mismatch")
  if (!exactValue(actual.type, expected.value.type)) differences.add("transport-mismatch")
  if (!exactValue(actual.env, expected.value.env)) differences.add("environment-reference-mismatch")
  const actualOptions = Object.fromEntries(
    Object.entries(actual).filter(([key]) => !STANDARD_SERVER_KEYS.has(key)),
  )
  const expectedOptions = Object.fromEntries(
    Object.entries(expected.value).filter(([key]) => !STANDARD_SERVER_KEYS.has(key)),
  )
  if (!exactValue(actualOptions, expectedOptions)) differences.add("server-options-mismatch")
  return exactValue(actual, expected.value) ? "exact" : "drifted"
}

function compareVscodeInputs(
  root: unknown,
  adapter: HostAdapter,
  differences: Set<HostInspectionDifference>,
): { expected: number; matched: number } {
  const expectedInputs = Array.isArray(adapter.configuration.inputs)
    ? adapter.configuration.inputs.filter(isRecord)
    : []
  if (expectedInputs.length === 0) return { expected: 0, matched: 0 }
  if (!isRecord(root) || !Array.isArray(root.inputs)) {
    differences.add("sensitive-input-collection-missing")
    return { expected: expectedInputs.length, matched: 0 }
  }
  let matched = 0
  for (const expected of expectedInputs) {
    const id = expected.id
    const candidates = root.inputs.filter((value) => isRecord(value) && value.id === id)
    if (candidates.length === 0) {
      differences.add("sensitive-input-missing")
    } else if (candidates.length > 1) {
      differences.add("sensitive-input-ambiguous")
    } else if (!exactValue(candidates[0], expected)) {
      differences.add("sensitive-input-mismatch")
    } else {
      matched += 1
    }
  }
  return { expected: expectedInputs.length, matched }
}

function compareGeminiDocument(
  root: unknown,
  adapter: HostAdapter,
  differences: Set<HostInspectionDifference>,
): { expected: number; matched: number } {
  if (!isRecord(root)) return { expected: 0, matched: 0 }
  if (!exactValue(root.name, adapter.configuration.name)) differences.add("extension-name-mismatch")
  if (!exactValue(root.version, adapter.configuration.version)) differences.add("extension-version-mismatch")
  if (!exactValue(root.description, adapter.configuration.description)) differences.add("extension-description-mismatch")
  if (!exactValue(root.settings, adapter.configuration.settings)) differences.add("extension-settings-mismatch")
  if (!exactValue(root, adapter.configuration)) differences.add("extension-options-mismatch")
  const expectedSettings = Array.isArray(adapter.configuration.settings)
    ? adapter.configuration.settings.length
    : 0
  const matched = exactValue(root.settings, adapter.configuration.settings) ? expectedSettings : 0
  return { expected: expectedSettings, matched }
}

function compareConfiguration(value: unknown, adapter: HostAdapter): ComparisonResult {
  const differences = new Set<HostInspectionDifference>()
  const serverEntry = compareServer(value, adapter, differences)
  const sensitive = adapter.id === "vscode"
    ? compareVscodeInputs(value, adapter, differences)
    : adapter.id === "gemini-extension"
      ? compareGeminiDocument(value, adapter, differences)
      : { expected: 0, matched: 0 }
  const canonicalDifferences = HOST_INSPECTION_DIFFERENCES.filter((entry) => differences.has(entry))
  return Object.freeze({
    differences: Object.freeze(canonicalDifferences),
    expectedSensitiveInputCount: sensitive.expected,
    matchedSensitiveInputCount: sensitive.matched,
    serverEntry,
    unrelatedState: SHARED_ADAPTER_IDS.has(adapter.id) ? "ignored" : "not-applicable",
  })
}

export function inspectHostAdapterFile(
  plan: HostActivationPlan,
  adapterId: HostAdapterId,
  file: string,
): HostInspectionReport {
  const adapter = findHostAdapter(createHostAdapterCatalog(plan), adapterId)
  const source = readHostJsonSnapshot(file)
  if (source.state !== "present") {
    throw new ConfigurationError("Host configuration file was not found")
  }
  let comparison: ComparisonResult
  try {
    comparison = compareConfiguration(source.document, adapter)
  } finally {
    source.bytes.fill(0)
  }
  const payload = {
    adapter: {
      activationDigest: adapter.activationDigest,
      adapterDigest: adapter.adapterDigest,
      hostServerName: adapter.hostServerName,
      id: adapter.id,
      title: adapter.title,
    },
    comparison,
    fileReview: source.fileReview,
    format: HOST_INSPECTION_FORMAT as typeof HOST_INSPECTION_FORMAT,
    limitations: HOST_INSPECTION_LIMITATIONS,
    privacy: {
      activityRecordsCreated: false as const,
      credentialValuesReturned: false as const,
      discordContacted: false as const,
      hostConfigurationChanged: false as const,
      hostConfigurationRead: true as const,
      hostPathReturned: false as const,
      networkContacted: false as const,
      possibleCredentialMaterialRead: true as const,
      processStarted: false as const,
      rawHostConfigurationReturned: false as const,
      unrelatedHostStateReturned: false as const,
    },
    schemaVersion: HOST_INSPECTION_SCHEMA_VERSION as typeof HOST_INSPECTION_SCHEMA_VERSION,
    status: comparison.differences.length === 0 ? "match" as const : "drift" as const,
  }
  return deepFreeze({
    ...payload,
    inspectionDigest: digest(payload),
  })
}
