import { createHash } from "node:crypto"
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs"
import type { BigIntStats } from "node:fs"
import { resolve } from "node:path"
import { TextDecoder } from "node:util"

import { parseStrictConfigJson } from "./config-document.js"
import { ConfigurationError } from "./errors.js"
import {
  createHostAdapterCatalog,
  findHostAdapter,
  type HostAdapter,
  type HostAdapterId,
} from "./host-adapters.js"
import type { HostActivationPlan } from "./host-activation.js"
import { stableString } from "./normalize.js"

export const HOST_INSPECTION_FORMAT = "discord-mcp.host-inspection.v1"
export const HOST_INSPECTION_SCHEMA_VERSION = 1
export const HOST_INSPECTION_MIN_BYTES = 2
export const HOST_INSPECTION_MAX_BYTES = 1_048_576

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
  readonly fileReview: {
    readonly access: "owner-private" | "platform-unverified"
    readonly bounded: true
    readonly canonical: true
    readonly owner: "platform-unverified" | "trusted"
    readonly regularFile: true
    readonly singleLink: true
    readonly stableRead: true
  }
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

interface FileReadResult {
  readonly bytes: Buffer
  readonly fileReview: HostInspectionReport["fileReview"]
}

interface ComparisonResult {
  readonly differences: readonly HostInspectionDifference[]
  readonly expectedSensitiveInputCount: number
  readonly matchedSensitiveInputCount: number
  readonly serverEntry: HostInspectionReport["comparison"]["serverEntry"]
  readonly unrelatedState: HostInspectionReport["comparison"]["unrelatedState"]
}

const HOST_INSPECTION_DIGEST_DOMAIN = "discord-mcp-host-inspection-v1\0"
const HOST_INSPECTION_EXPOSED_MODE_MASK = 0o077n
const SHARED_ADAPTER_IDS = new Set<HostAdapterId>(["cursor", "mcp-json", "vscode"])
const STANDARD_SERVER_KEYS = new Set(["args", "command", "env", "type"])
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })
const HOST_INSPECTION_LIMITATIONS = Object.freeze([
  "A match proves one stable static file projection, not that the host loaded it or retained it unchanged.",
  "Inspection does not prove secret availability, host approval behavior, elicitation support, process startup, MCP negotiation, or Discord access.",
  "On platforms without portable owner and mode metadata, file ownership and access are reported as platform-unverified rather than claimed private.",
  "Unrelated host entries and inputs are deliberately ignored and are not returned, counted, hashed, or assessed.",
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.ctimeNs === right.ctimeNs
    && left.mtimeNs === right.mtimeNs
}

function assertSafeHostFile(metadata: BigIntStats): void {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ConfigurationError("Host configuration must be one regular file")
  }
  if (metadata.nlink !== 1n) {
    throw new ConfigurationError("Host configuration must have exactly one hard link")
  }
  if (
    metadata.size < BigInt(HOST_INSPECTION_MIN_BYTES)
    || metadata.size > BigInt(HOST_INSPECTION_MAX_BYTES)
  ) {
    throw new ConfigurationError("Host configuration exceeds the bounded JSON file size")
  }
  if (process.platform !== "win32") {
    const userId = typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined
    if (userId === undefined || ![0n, userId].includes(metadata.uid)) {
      throw new ConfigurationError("Host configuration owner is not trusted")
    }
    if ((metadata.mode & HOST_INSPECTION_EXPOSED_MODE_MASK) !== 0n) {
      throw new ConfigurationError("Host configuration must not grant group or world access")
    }
  }
}

function readExactBytes(fileDescriptor: number, expectedBytes: number): Buffer {
  const buffer = Buffer.alloc(expectedBytes + 1)
  let offset = 0
  while (offset < buffer.byteLength) {
    const bytesRead = readSync(
      fileDescriptor,
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    )
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset !== expectedBytes) {
    buffer.fill(0)
    throw new ConfigurationError("Host configuration changed while it was read")
  }
  return buffer.subarray(0, expectedBytes)
}

function readHostConfiguration(file: string): FileReadResult {
  if (typeof file !== "string" || !file.trim() || file.includes("\0")) {
    throw new ConfigurationError("Host inspection requires a valid explicit file path")
  }
  const path = resolve(file)
  let bytes: Buffer | undefined
  let fileDescriptor: number | undefined
  try {
    const canonical = realpathSync.native(path)
    const beforePath = lstatSync(path, { bigint: true })
    if (canonical !== path || beforePath.isSymbolicLink()) {
      throw new ConfigurationError("Host configuration path must not contain symbolic links")
    }
    assertSafeHostFile(beforePath)
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    fileDescriptor = openSync(path, fsConstants.O_RDONLY | noFollow)
    const beforeRead = fstatSync(fileDescriptor, { bigint: true })
    assertSafeHostFile(beforeRead)
    if (beforePath.dev !== beforeRead.dev || beforePath.ino !== beforeRead.ino) {
      throw new ConfigurationError("Host configuration changed while it was opened")
    }
    bytes = readExactBytes(fileDescriptor, Number(beforeRead.size))
    const afterRead = fstatSync(fileDescriptor, { bigint: true })
    const afterPath = lstatSync(path, { bigint: true })
    if (
      realpathSync.native(path) !== path
      || !sameFile(beforeRead, afterRead)
      || !sameFile(afterRead, afterPath)
    ) {
      throw new ConfigurationError("Host configuration changed while it was read")
    }
    return {
      bytes,
      fileReview: Object.freeze({
        access: process.platform === "win32" ? "platform-unverified" : "owner-private",
        bounded: true,
        canonical: true,
        owner: process.platform === "win32" ? "platform-unverified" : "trusted",
        regularFile: true,
        singleLink: true,
        stableRead: true,
      }),
    }
  } catch (error) {
    bytes?.fill(0)
    if (error instanceof ConfigurationError) throw error
    if (isNodeError(error, "ENOENT")) {
      throw new ConfigurationError("Host configuration file was not found")
    }
    if (isNodeError(error, "ELOOP")) {
      throw new ConfigurationError("Host configuration path must not contain symbolic links")
    }
    throw new ConfigurationError("Unable to inspect host configuration file")
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor)
      } catch {
        bytes?.fill(0)
        throw new ConfigurationError("Unable to finalize host configuration inspection")
      }
    }
  }
}

function parseHostConfiguration(bytes: Buffer): unknown {
  if (bytes.includes(0) || bytes.byteLength > HOST_INSPECTION_MAX_BYTES) {
    throw new ConfigurationError("Host configuration is not valid bounded JSON")
  }
  try {
    const text = STRICT_UTF8_DECODER.decode(bytes)
    return parseStrictConfigJson(text.endsWith("\n") ? text : `${text}\n`)
  } catch {
    throw new ConfigurationError("Host configuration is not valid strict JSON")
  }
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
  const source = readHostConfiguration(file)
  let comparison: ComparisonResult
  try {
    comparison = compareConfiguration(parseHostConfiguration(source.bytes), adapter)
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
