import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fsyncSync,
  linkSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, resolve } from "node:path"

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
  inspectHostJsonTarget,
  readHostJsonSnapshot,
  type HostFileBinding,
  type HostFileReview,
  type HostJsonPresentSnapshot,
  type HostJsonSnapshot,
} from "./host-file.js"
import {
  inspectHostAdapterFile,
  type HostInspectionReport,
} from "./host-inspection.js"
import { stableString } from "./normalize.js"

export const HOST_CHANGE_PLAN_FORMAT = "guildcontrol.host-change-plan.v1"
export const HOST_CHANGE_APPLY_FORMAT = "guildcontrol.host-change-apply.v1"
export const HOST_CHANGE_SCHEMA_VERSION = 1
export const HOST_CHANGE_PLAN_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

const HOST_CHANGE_PLAN_DIGEST_DOMAIN = "guildcontrol-host-change-plan-v1\0"
const PRIVATE_FILE_MODE = 0o600
const SHARED_ADAPTER_IDS = new Set<HostAdapterId>(["cursor", "mcp-json", "vscode"])
const HOST_CHANGE_LIMITATIONS = Object.freeze([
  "A successful file change does not prove that the host loaded this path, accepted its schema, resolved its credential, started the server, negotiated MCP, or reached Discord.",
  "Existing JSON is byte-, depth-, and node-bounded; non-finite, unsafe-integer, and negative-zero values fail closed before planning.",
  "Freshness binds stable filesystem identity metadata rather than hashing private host bytes; it is not a content commitment against a privileged filesystem adversary.",
  "The reported digests commit to the selected activation, adapter, explicit target path, and metadata, so complete candidate context can confirm already-suspected private references even though no path value is returned.",
  "Shared JSON documents are serialized with canonical indentation, so whitespace is normalized while unrelated JSON values are preserved semantically.",
  "Possible credential strings parsed from an existing host file cannot be reliably erased from the JavaScript runtime heap.",
  "A retained backup contains the complete previous private host file, including any credential material already stored there.",
  "The sibling lock coordinates this connector's operations; an external writer that ignores it can still race the final publication window.",
  "Owner-only modes and directory synchronization are enforced only where the platform exposes portable filesystem semantics; otherwise review host-side ACLs and crash durability.",
  "An interrupted apply can leave a sibling lock or temporary artifact; never remove one until no apply operation can still be using it.",
])

export type HostChangeOperation = "create" | "unchanged" | "update"
export type HostOwnedEntryChange = "add" | "replace" | "unchanged"
export type HostChangeStrategy = "merge-owned-records" | "replace-dedicated-document"

export interface HostChangeSummary {
  readonly backupRequired: boolean
  readonly canonicalJsonRewrite: boolean
  readonly operation: HostChangeOperation
  readonly sensitiveInputs: {
    readonly added: number
    readonly replaced: number
    readonly unchanged: number
  }
  readonly serverEntry: HostOwnedEntryChange
  readonly strategy: HostChangeStrategy
  readonly unrelatedState: "not-applicable" | "preserved" | "replaced"
}

export interface HostChangePlanReport {
  readonly adapter: {
    readonly activationDigest: string
    readonly adapterDigest: string
    readonly hostServerName: string
    readonly id: HostAdapterId
    readonly title: string
  }
  readonly change: HostChangeSummary
  readonly confirmation: {
    readonly requiredValue: string
  }
  readonly fileReview: {
    readonly directory: {
      readonly canonical: true
      readonly owner: "platform-unverified" | "trusted"
      readonly writableByOthers: false | "platform-unverified"
    }
    readonly existingFile: HostFileReview | null
    readonly state: "absent" | "present"
  }
  readonly format: typeof HOST_CHANGE_PLAN_FORMAT
  readonly limitations: readonly string[]
  readonly planDigest: string
  readonly privacy: {
    readonly activityRecordsCreated: false
    readonly credentialValuesReturned: false
    readonly discordContacted: false
    readonly hostConfigurationChanged: false
    readonly hostConfigurationRead: boolean
    readonly hostPathReturned: false
    readonly networkContacted: false
    readonly possibleCredentialMaterialRead: boolean
    readonly privateHostBytesHashed: false
    readonly processStarted: false
    readonly rawHostConfigurationReturned: false
    readonly unrelatedHostStateReturned: false
  }
  readonly schemaVersion: typeof HOST_CHANGE_SCHEMA_VERSION
  readonly status: "ready"
}

export interface HostChangeApplyReport {
  readonly adapter: HostChangePlanReport["adapter"]
  readonly backup: {
    readonly created: boolean
    readonly file?: string
  }
  readonly change: HostChangeSummary
  readonly format: typeof HOST_CHANGE_APPLY_FORMAT
  readonly inspection: HostInspectionReport
  readonly limitations: readonly string[]
  readonly planDigest: string
  readonly privacy: {
    readonly activityRecordsCreated: false
    readonly credentialValuesReturned: false
    readonly discordContacted: false
    readonly hostConfigurationChanged: boolean
    readonly hostConfigurationRead: true
    readonly hostPathReturned: boolean
    readonly networkContacted: false
    readonly possibleCredentialMaterialRead: boolean
    readonly privateHostBytesHashed: false
    readonly processStarted: false
    readonly rawHostConfigurationReturned: false
    readonly unrelatedHostStateReturned: false
  }
  readonly schemaVersion: typeof HOST_CHANGE_SCHEMA_VERSION
  readonly status: "applied" | "unchanged"
}

export interface ApplyHostChangeOptions {
  readonly confirmation: string
  readonly inspect?: typeof inspectHostAdapterFile
  readonly planDigest: string
}

interface PreparedHostChange {
  readonly adapter: HostAdapter
  readonly desiredBytes: Buffer
  readonly desiredDocument: Readonly<Record<string, unknown>>
  readonly report: HostChangePlanReport
  readonly snapshot: HostJsonSnapshot
}

interface DocumentChange {
  readonly desiredDocument: Readonly<Record<string, unknown>>
  readonly sensitiveInputs: HostChangeSummary["sensitiveInputs"]
  readonly serverEntry: HostOwnedEntryChange
  readonly strategy: HostChangeStrategy
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
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

function cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value))
}

function setOwnValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function expectedServer(adapter: HostAdapter): {
  readonly collection: "mcpServers" | "servers"
  readonly value: Readonly<Record<string, unknown>>
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

function mergeVscodeInputs(
  root: Record<string, unknown>,
  adapter: HostAdapter,
): HostChangeSummary["sensitiveInputs"] {
  const actualValue = ownValue(root, "inputs")
  if (actualValue !== undefined && !Array.isArray(actualValue)) {
    throw new ConfigurationError("VS Code host configuration inputs must be an array")
  }
  const expectedInputs = Array.isArray(adapter.configuration.inputs)
    ? adapter.configuration.inputs.filter(isRecord)
    : []
  if (expectedInputs.length === 0) {
    return Object.freeze({ added: 0, replaced: 0, unchanged: 0 })
  }
  const inputs = actualValue === undefined ? [] : [...actualValue as unknown[]]
  let added = 0
  let replaced = 0
  let unchanged = 0
  for (const expected of expectedInputs) {
    const indexes = inputs.flatMap((value, index) => (
      isRecord(value) && value.id === expected.id ? [index] : []
    ))
    if (indexes.length > 1) {
      throw new ConfigurationError("VS Code host configuration has an ambiguous generated input")
    }
    const index = indexes[0]
    if (index === undefined) {
      inputs.push(expected)
      added += 1
    } else if (exactValue(inputs[index], expected)) {
      unchanged += 1
    } else {
      inputs[index] = expected
      replaced += 1
    }
  }
  root.inputs = inputs
  return Object.freeze({ added, replaced, unchanged })
}

function mergeSharedDocument(
  document: unknown,
  adapter: HostAdapter,
): DocumentChange {
  if (!isRecord(document)) {
    throw new ConfigurationError("Host configuration root must be one JSON object")
  }
  const expected = expectedServer(adapter)
  const actualCollection = ownValue(document, expected.collection)
  if (actualCollection !== undefined && !isRecord(actualCollection)) {
    throw new ConfigurationError("Host configuration server collection must be one JSON object")
  }
  const collection = actualCollection === undefined ? {} : cloneRecord(actualCollection)
  const existing = ownValue(collection, adapter.hostServerName)
  const serverEntry: HostOwnedEntryChange = !Object.hasOwn(collection, adapter.hostServerName)
    ? "add"
    : exactValue(existing, expected.value)
      ? "unchanged"
      : "replace"
  setOwnValue(collection, adapter.hostServerName, expected.value)
  const root = cloneRecord(document)
  root[expected.collection] = collection
  const sensitiveInputs = adapter.id === "vscode"
    ? mergeVscodeInputs(root, adapter)
    : Object.freeze({ added: 0, replaced: 0, unchanged: 0 })
  return {
    desiredDocument: root,
    sensitiveInputs,
    serverEntry,
    strategy: "merge-owned-records",
  }
}

function dedicatedServerChange(document: unknown, adapter: HostAdapter): HostOwnedEntryChange {
  if (!isRecord(document)) return "replace"
  const expected = expectedServer(adapter)
  const collection = ownValue(document, expected.collection)
  if (!isRecord(collection) || !Object.hasOwn(collection, adapter.hostServerName)) return "replace"
  return exactValue(ownValue(collection, adapter.hostServerName), expected.value)
    ? "unchanged"
    : "replace"
}

function createDocumentChange(snapshot: HostJsonSnapshot, adapter: HostAdapter): DocumentChange {
  if (snapshot.state === "absent") {
    if (SHARED_ADAPTER_IDS.has(adapter.id)) {
      return mergeSharedDocument({}, adapter)
    }
    return {
      desiredDocument: adapter.configuration,
      sensitiveInputs: Object.freeze({ added: 0, replaced: 0, unchanged: 0 }),
      serverEntry: "add",
      strategy: "replace-dedicated-document",
    }
  }
  if (SHARED_ADAPTER_IDS.has(adapter.id)) {
    return mergeSharedDocument(snapshot.document, adapter)
  }
  if (!isRecord(snapshot.document)) {
    throw new ConfigurationError("Dedicated host extension root must be one JSON object")
  }
  return {
    desiredDocument: adapter.configuration,
    sensitiveInputs: Object.freeze({ added: 0, replaced: 0, unchanged: 0 }),
    serverEntry: dedicatedServerChange(snapshot.document, adapter),
    strategy: "replace-dedicated-document",
  }
}

function planDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(HOST_CHANGE_PLAN_DIGEST_DOMAIN)
    .update(stableString(value))
    .digest("hex")}`
}

function serializedDocument(document: Readonly<Record<string, unknown>>): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8")
  if (bytes.byteLength > HOST_JSON_MAX_BYTES) {
    bytes.fill(0)
    throw new ConfigurationError("Merged host configuration exceeds the bounded JSON file size")
  }
  return bytes
}

function prepareHostChange(
  activation: HostActivationPlan,
  adapterId: HostAdapterId,
  file: string,
): PreparedHostChange {
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), adapterId)
  let snapshot: HostJsonSnapshot | undefined
  let desiredBytes: Buffer | undefined
  try {
    snapshot = readHostJsonSnapshot(file, { allowAbsent: true })
    const documentChange = createDocumentChange(snapshot, adapter)
    desiredBytes = serializedDocument(documentChange.desiredDocument)
    const exactBytes = snapshot.state === "present"
      && snapshot.bytes.equals(desiredBytes)
    const operation: HostChangeOperation = snapshot.state === "absent"
      ? "create"
      : exactBytes
        ? "unchanged"
        : "update"
    const change = deepFreeze({
      backupRequired: operation === "update",
      canonicalJsonRewrite: operation !== "unchanged",
      operation,
      sensitiveInputs: documentChange.sensitiveInputs,
      serverEntry: documentChange.serverEntry,
      strategy: documentChange.strategy,
      unrelatedState: SHARED_ADAPTER_IDS.has(adapter.id)
        ? "preserved" as const
        : operation === "update"
          ? "replaced" as const
          : "not-applicable" as const,
    })
    const digest = planDigest({
      activationDigest: adapter.activationDigest,
      adapterDigest: adapter.adapterDigest,
      adapterId: adapter.id,
      binding: snapshot.binding,
      change,
      hostServerName: adapter.hostServerName,
      target: snapshot.target,
    })
    const present = snapshot.state === "present"
    const report = deepFreeze({
      adapter: {
        activationDigest: adapter.activationDigest,
        adapterDigest: adapter.adapterDigest,
        hostServerName: adapter.hostServerName,
        id: adapter.id,
        title: adapter.title,
      },
      change,
      confirmation: { requiredValue: adapter.hostServerName },
      fileReview: {
        directory: {
          canonical: true as const,
          owner: process.platform === "win32" ? "platform-unverified" as const : "trusted" as const,
          writableByOthers: process.platform === "win32" ? "platform-unverified" as const : false as const,
        },
        existingFile: snapshot.state === "present" ? snapshot.fileReview : null,
        state: snapshot.state,
      },
      format: HOST_CHANGE_PLAN_FORMAT as typeof HOST_CHANGE_PLAN_FORMAT,
      limitations: HOST_CHANGE_LIMITATIONS,
      planDigest: digest,
      privacy: {
        activityRecordsCreated: false as const,
        credentialValuesReturned: false as const,
        discordContacted: false as const,
        hostConfigurationChanged: false as const,
        hostConfigurationRead: present,
        hostPathReturned: false as const,
        networkContacted: false as const,
        possibleCredentialMaterialRead: present,
        privateHostBytesHashed: false as const,
        processStarted: false as const,
        rawHostConfigurationReturned: false as const,
        unrelatedHostStateReturned: false as const,
      },
      schemaVersion: HOST_CHANGE_SCHEMA_VERSION as typeof HOST_CHANGE_SCHEMA_VERSION,
      status: "ready" as const,
    })
    return {
      adapter,
      desiredBytes,
      desiredDocument: documentChange.desiredDocument,
      report,
      snapshot,
    }
  } catch (error) {
    if (snapshot?.state === "present") snapshot.bytes.fill(0)
    desiredBytes?.fill(0)
    throw error
  }
}

function clearPrepared(prepared: PreparedHostChange): void {
  prepared.desiredBytes.fill(0)
  if (prepared.snapshot.state === "present") prepared.snapshot.bytes.fill(0)
}

export function planHostAdapterFile(
  activation: HostActivationPlan,
  adapterId: HostAdapterId,
  file: string,
): HostChangePlanReport {
  const prepared = prepareHostChange(activation, adapterId, file)
  try {
    return prepared.report
  } finally {
    clearPrepared(prepared)
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === "win32") return
  let fileDescriptor: number | undefined
  try {
    fileDescriptor = openSync(directory, fsConstants.O_RDONLY)
    fsyncSync(fileDescriptor)
  } catch (error) {
    throw new ConfigurationError("Unable to sync host configuration directory", { cause: error })
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
  }
}

function writeExclusivePrivateFile(file: string, bytes: Buffer, mode = PRIVATE_FILE_MODE): void {
  let created = false
  let fileDescriptor: number | undefined
  const errors: unknown[] = []
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    fileDescriptor = openSync(
      file,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      PRIVATE_FILE_MODE,
    )
    created = true
    writeFileSync(fileDescriptor, bytes)
    if (process.platform !== "win32") fchmodSync(fileDescriptor, mode)
    fsyncSync(fileDescriptor)
  } catch (error) {
    errors.push(error)
  }
  if (fileDescriptor !== undefined) {
    try {
      closeSync(fileDescriptor)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    if (created) {
      try {
        unlinkSync(file)
      } catch {
        // Cleanup is best effort because the primary error remains authoritative
      }
    }
    throw new ConfigurationError("Unable to write private host configuration artifact", {
      cause: errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Multiple host configuration writes failed"),
    })
  }
}

function withHostChangeLock<Value>(
  directory: string,
  targetName: string,
  operation: () => Value,
): Value {
  const lock = resolve(directory, `.${targetName}.guildcontrol.lock`)
  let fileDescriptor: number | undefined
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    fileDescriptor = openSync(
      lock,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      PRIVATE_FILE_MODE,
    )
    fsyncSync(fileDescriptor)
    syncDirectory(directory)
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor)
      } catch {
        // The fixed lock error below avoids exposing filesystem details
      }
      try {
        unlinkSync(lock)
      } catch {
        // The fixed lock error below avoids exposing filesystem details
      }
    }
    if (isNodeError(error, "EEXIST")) {
      throw new ConfigurationError(
        "Host configuration is locked by another installation operation; after an interrupted apply, verify that no apply is running before removing its sibling lock and replanning",
      )
    }
    throw new ConfigurationError("Unable to lock host configuration", { cause: error })
  }

  let result: Value | undefined
  let operationError: unknown
  try {
    result = operation()
  } catch (error) {
    operationError = error
  }
  const cleanupErrors: unknown[] = []
  try {
    closeSync(fileDescriptor)
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    unlinkSync(lock)
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    syncDirectory(directory)
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (operationError !== undefined || cleanupErrors.length > 0) {
    if (operationError !== undefined && cleanupErrors.length === 0) throw operationError
    throw new ConfigurationError("Host configuration operation or lock cleanup failed", {
      cause: new AggregateError(
        [operationError, ...cleanupErrors].filter((error) => error !== undefined),
        "Host configuration operation or cleanup failed",
      ),
    })
  }
  return result as Value
}

function snapshotsMatch(left: HostJsonSnapshot, right: HostJsonSnapshot): boolean {
  if (left.state !== right.state) return false
  if (stableString(left.binding) !== stableString(right.binding)) return false
  return left.state === "absent"
    || (right.state === "present" && left.bytes.equals(right.bytes))
}

function assertTargetUnchanged(snapshot: HostJsonSnapshot): void {
  const current = readHostJsonSnapshot(snapshot.target, { allowAbsent: true })
  try {
    if (!snapshotsMatch(snapshot, current)) {
      throw new ConfigurationError("Host configuration changed after the reviewed plan")
    }
  } finally {
    if (current.state === "present") current.bytes.fill(0)
  }
}

function originalMode(snapshot: HostJsonPresentSnapshot): number {
  return Number(BigInt(snapshot.binding.file.mode) & 0o777n)
}

function createBackup(
  directory: string,
  targetName: string,
  snapshot: HostJsonPresentSnapshot,
): string {
  const backup = resolve(
    directory,
    `.${targetName}.guildcontrol.backup.${Date.now()}-${randomUUID()}`,
  )
  writeExclusivePrivateFile(backup, snapshot.bytes, originalMode(snapshot))
  syncDirectory(directory)
  return backup
}

function readExactHostFileBinding(
  file: string,
  desiredBytes: Buffer,
): HostFileBinding {
  const snapshot = readHostJsonSnapshot(file)
  try {
    if (snapshot.state !== "present" || !snapshot.bytes.equals(desiredBytes)) {
      throw new ConfigurationError("Host configuration bytes did not verify exactly")
    }
    return snapshot.binding.file
  } finally {
    if (snapshot.state === "present") snapshot.bytes.fill(0)
  }
}

function assertExactHostFileBinding(
  file: string,
  desiredBytes: Buffer,
  expectedBinding: HostFileBinding,
): void {
  const snapshot = readHostJsonSnapshot(file)
  try {
    if (
      snapshot.state !== "present"
      || stableString(snapshot.binding.file) !== stableString(expectedBinding)
      || !snapshot.bytes.equals(desiredBytes)
    ) {
      throw new ConfigurationError("Host configuration changed during exact verification")
    }
  } finally {
    if (snapshot.state === "present") snapshot.bytes.fill(0)
  }
}

function verifyExactHostProjection(
  activation: HostActivationPlan,
  adapterId: HostAdapterId,
  file: string,
  inspect: typeof inspectHostAdapterFile,
): HostInspectionReport {
  const inspection = inspect(activation, adapterId, file)
  if (inspection.status !== "match") {
    throw new ConfigurationError("Host adapter projection did not verify exactly")
  }
  return inspection
}

function verifyRestoredFile(file: string, expectedBytes: Buffer): void {
  const restored = readHostJsonSnapshot(file)
  try {
    if (restored.state !== "present" || !restored.bytes.equals(expectedBytes)) {
      throw new ConfigurationError("Restored host configuration did not verify exactly")
    }
  } finally {
    if (restored.state === "present") restored.bytes.fill(0)
  }
}

function verifyRemovedFile(file: string): void {
  const restored = readHostJsonSnapshot(file, { allowAbsent: true })
  if (restored.state === "present") {
    restored.bytes.fill(0)
    throw new ConfigurationError("New host configuration could not be removed after failure")
  }
}

function applyReport(
  prepared: PreparedHostChange,
  inspection: HostInspectionReport,
  backupFile?: string,
): HostChangeApplyReport {
  const changed = prepared.report.change.operation !== "unchanged"
  return deepFreeze({
    adapter: prepared.report.adapter,
    backup: {
      created: backupFile !== undefined,
      ...(backupFile === undefined ? {} : { file: backupFile }),
    },
    change: prepared.report.change,
    format: HOST_CHANGE_APPLY_FORMAT as typeof HOST_CHANGE_APPLY_FORMAT,
    inspection,
    limitations: HOST_CHANGE_LIMITATIONS,
    planDigest: prepared.report.planDigest,
    privacy: {
      activityRecordsCreated: false as const,
      credentialValuesReturned: false as const,
      discordContacted: false as const,
      hostConfigurationChanged: changed,
      hostConfigurationRead: true as const,
      hostPathReturned: backupFile !== undefined,
      networkContacted: false as const,
      possibleCredentialMaterialRead: prepared.snapshot.state === "present",
      privateHostBytesHashed: false as const,
      processStarted: false as const,
      rawHostConfigurationReturned: false as const,
      unrelatedHostStateReturned: false as const,
    },
    schemaVersion: HOST_CHANGE_SCHEMA_VERSION as typeof HOST_CHANGE_SCHEMA_VERSION,
    status: changed ? "applied" as const : "unchanged" as const,
  })
}

export function applyHostAdapterFile(
  activation: HostActivationPlan,
  adapterId: HostAdapterId,
  file: string,
  options: ApplyHostChangeOptions,
): HostChangeApplyReport {
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), adapterId)
  if (options.confirmation !== adapter.hostServerName) {
    throw new ConfigurationError(
      `Host configuration confirmation must exactly match ${adapter.hostServerName}`,
    )
  }
  if (!HOST_CHANGE_PLAN_DIGEST_PATTERN.test(options.planDigest)) {
    throw new ConfigurationError("Host configuration plan digest is invalid")
  }
  const context = inspectHostJsonTarget(file)
  const targetName = basename(context.target)
  return withHostChangeLock(context.directory, targetName, () => {
    const prepared = prepareHostChange(activation, adapterId, context.target)
    let backupFile: string | undefined
    let publishedBinding: HostFileBinding | undefined
    let temporaryFile: string | undefined
    let published = false
    try {
      if (prepared.report.planDigest !== options.planDigest) {
        throw new ConfigurationError(
          "Host configuration changed after review; rerun host plan",
        )
      }
      if (prepared.report.change.operation === "unchanged") {
        const exactBinding = readExactHostFileBinding(
          context.target,
          prepared.desiredBytes,
        )
        const inspection = verifyExactHostProjection(
          activation,
          adapterId,
          context.target,
          options.inspect ?? inspectHostAdapterFile,
        )
        assertExactHostFileBinding(context.target, prepared.desiredBytes, exactBinding)
        return applyReport(prepared, inspection)
      }

      temporaryFile = resolve(
        context.directory,
        `.${targetName}.guildcontrol.${randomUUID()}.tmp`,
      )
      writeExclusivePrivateFile(temporaryFile, prepared.desiredBytes)
      assertTargetUnchanged(prepared.snapshot)
      if (prepared.snapshot.state === "present") {
        backupFile = createBackup(context.directory, targetName, prepared.snapshot)
        assertTargetUnchanged(prepared.snapshot)
        renameSync(temporaryFile, context.target)
        temporaryFile = undefined
        published = true
      } else {
        try {
          const source = temporaryFile
          linkSync(source, context.target)
          published = true
          unlinkSync(source)
          temporaryFile = undefined
        } catch (error) {
          if (isNodeError(error, "EEXIST")) {
            throw new ConfigurationError("Host configuration was created after the reviewed plan")
          }
          throw error
        }
      }
      syncDirectory(context.directory)
      publishedBinding = readExactHostFileBinding(
        context.target,
        prepared.desiredBytes,
      )
      const inspection = verifyExactHostProjection(
        activation,
        adapterId,
        context.target,
        options.inspect ?? inspectHostAdapterFile,
      )
      assertExactHostFileBinding(
        context.target,
        prepared.desiredBytes,
        publishedBinding,
      )
      return applyReport(prepared, inspection, backupFile)
    } catch (error) {
      if (published) {
        try {
          publishedBinding ??= readExactHostFileBinding(
            context.target,
            prepared.desiredBytes,
          )
          assertExactHostFileBinding(
            context.target,
            prepared.desiredBytes,
            publishedBinding,
          )
          if (prepared.snapshot.state === "present") {
            if (backupFile === undefined) {
              throw new ConfigurationError("Host configuration backup is unavailable")
            }
            readExactHostFileBinding(backupFile, prepared.snapshot.bytes)
            renameSync(backupFile, context.target)
            backupFile = undefined
            syncDirectory(context.directory)
            verifyRestoredFile(context.target, prepared.snapshot.bytes)
          } else {
            unlinkSync(context.target)
            syncDirectory(context.directory)
            verifyRemovedFile(context.target)
          }
        } catch (rollbackError) {
          throw new ConfigurationError(
            "Host configuration publication could not be verified or rolled back",
            {
              cause: new AggregateError(
                [error, rollbackError],
                "Host configuration verification and rollback failed",
              ),
            },
          )
        }
        throw new ConfigurationError(
          "Published host configuration failed exact verification and was rolled back",
          { cause: error },
        )
      }
      if (backupFile !== undefined) {
        try {
          unlinkSync(backupFile)
          backupFile = undefined
          syncDirectory(context.directory)
        } catch (cleanupError) {
          throw new ConfigurationError("Host configuration failed before publication and backup cleanup is uncertain", {
            cause: new AggregateError(
              [error, cleanupError],
              "Host configuration operation and backup cleanup failed",
            ),
          })
        }
      }
      throw error
    } finally {
      if (temporaryFile !== undefined) {
        try {
          unlinkSync(temporaryFile)
        } catch {
          // The primary operation report remains authoritative
        }
      }
      clearPrepared(prepared)
    }
  })
}
