import { createHash, randomBytes } from "node:crypto"
import { constants } from "node:fs"
import type { BigIntStats } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"

import { DISCORD_SNOWFLAKE_PATTERN } from "./constants.js"
import {
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationResolutionError,
  WriteCoordinationStateError,
} from "./errors.js"
import {
  OPERATION_KEY_HASH_PATTERN,
  OPERATION_KINDS,
  type OperationKind,
  type OperationReceiptStatus,
  type OperationStore,
} from "./operation-store.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"

export const WRITE_COORDINATION_RESOURCE_KINDS = [
  "channel",
  "member",
  "message",
  "role",
  "webhook",
] as const

export const WRITE_COORDINATION_GUILD_COLLECTIONS = [
  "application-commands",
  "automod",
  "channels",
  "emojis",
  "invites",
  "onboarding",
  "roles",
  "scheduled-events",
  "soundboard",
  "stickers",
  "welcome-screen",
  "widget-settings",
] as const

export type WriteCoordinationResourceKind =
  typeof WRITE_COORDINATION_RESOURCE_KINDS[number]
export type WriteCoordinationGuildCollection =
  typeof WRITE_COORDINATION_GUILD_COLLECTIONS[number]

export type WriteCoordinationTarget =
  | {
    id: string
    kind: WriteCoordinationResourceKind
  }
  | {
    collection: WriteCoordinationGuildCollection
    guildId: string
    kind: "guild-collection"
  }

export interface WriteCoordinationIntent {
  kind: OperationKind
  operationKeyHash: string
  planDigest: string
  targets: readonly WriteCoordinationTarget[]
}

export interface WriteCoordinator {
  run<T>(
    intent: WriteCoordinationIntent,
    operation: () => Promise<T>,
  ): Promise<T>
}

export type WriteCoordinationOwnerState = "alive" | "dead" | "unknown"
export type WriteCoordinationReceiptState =
  | OperationReceiptStatus
  | "different-plan"
  | "missing"
  | "unreadable"
export type WriteCoordinationClaimState =
  | "active"
  | "auto-reclaimable"
  | "review-required"

export interface WriteCoordinationClaimStatus {
  claimId: string
  createdAt: string
  kind: OperationKind
  operationKeyHash: string
  ownerPid: number
  ownerState: WriteCoordinationOwnerState
  planDigest: string
  publishedTargetCount: number
  receiptState: WriteCoordinationReceiptState
  schemaVersion: 1
  state: WriteCoordinationClaimState
  targets: WriteCoordinationTarget[]
}

export interface WriteCoordinationList {
  claims: WriteCoordinationClaimStatus[]
  schemaVersion: 1
  status: "ok"
}

export interface WriteCoordinationResolution {
  claimId: string
  releasedTargetCount: number
  schemaVersion: 1
  status: "already-resolved" | "resolved"
}

export interface FileWriteCoordinatorOptions {
  clock?: () => Date
  ownerPid?: number
  processAlive?: (pid: number) => boolean
  randomId?: () => string
}

interface WriteClaimRecord {
  claimId: string
  createdAt: string
  kind: OperationKind
  operationKeyHash: string
  ownerPid: number
  planDigest: string
  schemaVersion: 1
  targets: WriteCoordinationTarget[]
}

interface ResolutionAcknowledgement {
  claim: WriteClaimRecord
  reason: "operator-reviewed"
  resolvedAt: string
  resolverPid: number
  schemaVersion: 1
}

interface PublishedClaim {
  hash: string
  record: WriteClaimRecord
}

type ReceiptEvidence = WriteCoordinationReceiptState

const CLAIM_SCHEMA_VERSION = 1
const RESOLUTION_SCHEMA_VERSION = 1
const CLAIM_ID_PATTERN = /^claim_[a-f0-9]{32}$/
const TARGET_HASH_PATTERN = /^[a-f0-9]{64}$/
const MAX_CLAIM_BYTES = 16_384
const MAX_RESOLUTION_BYTES = 32_768
const MAX_TARGETS = 8
const CLAIM_FILE = "claim.json"
const ACKNOWLEDGEMENT_FILE = "acknowledgement.json"
const RESOLUTION_REASON = "operator-reviewed"
const ACTIVE_LOCAL_CLAIMS_SYMBOL = Symbol.for(
  "io.github.j-256.discord-mcp.write-coordination.active.v1",
)
const PROCESS_GLOBAL = globalThis as unknown as Record<symbol, unknown>
const ACTIVE_LOCAL_CLAIMS = PROCESS_GLOBAL[ACTIVE_LOCAL_CLAIMS_SYMBOL] instanceof Map
  ? PROCESS_GLOBAL[ACTIVE_LOCAL_CLAIMS_SYMBOL] as Map<string, Promise<void>>
  : new Map<string, Promise<void>>()
PROCESS_GLOBAL[ACTIVE_LOCAL_CLAIMS_SYMBOL] = ACTIVE_LOCAL_CLAIMS

const CLAIM_KEYS = [
  "claimId",
  "createdAt",
  "kind",
  "operationKeyHash",
  "ownerPid",
  "planDigest",
  "schemaVersion",
  "targets",
] as const

const ACKNOWLEDGEMENT_KEYS = [
  "claim",
  "reason",
  "resolvedAt",
  "resolverPid",
  "schemaVersion",
] as const

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function normalizeClaimId(value: unknown): string {
  if (typeof value !== "string" || !CLAIM_ID_PATTERN.test(value)) {
    throw new WriteCoordinationResolutionError("Discord write claim ID is invalid")
  }
  return value
}

function parseTarget(value: unknown): WriteCoordinationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WriteCoordinationStateError("Discord write target is not an object")
  }
  const record = value as Record<string, unknown>
  if (record.kind === "guild-collection") {
    if (
      !exactKeys(record, ["collection", "guildId", "kind"])
      || typeof record.guildId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
      || typeof record.collection !== "string"
      || !(WRITE_COORDINATION_GUILD_COLLECTIONS as readonly string[])
        .includes(record.collection)
    ) {
      throw new WriteCoordinationStateError("Discord guild-collection write target is invalid")
    }
    return {
      collection: record.collection as WriteCoordinationGuildCollection,
      guildId: record.guildId,
      kind: "guild-collection",
    }
  }
  if (
    !exactKeys(record, ["id", "kind"])
    || typeof record.id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.id)
    || typeof record.kind !== "string"
    || !(WRITE_COORDINATION_RESOURCE_KINDS as readonly string[]).includes(record.kind)
  ) {
    throw new WriteCoordinationStateError("Discord resource write target is invalid")
  }
  return {
    id: record.id,
    kind: record.kind as WriteCoordinationResourceKind,
  }
}

function targetDescriptor(target: WriteCoordinationTarget): string {
  return target.kind === "guild-collection"
    ? `guild-collection\0${target.guildId}\0${target.collection}`
    : `resource\0${target.kind}\0${target.id}`
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeTargets(
  values: readonly WriteCoordinationTarget[] | unknown,
): WriteCoordinationTarget[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_TARGETS) {
    throw new WriteCoordinationStateError(
      `Discord write coordination requires 1-${MAX_TARGETS} targets`,
    )
  }
  const byDescriptor = new Map<string, WriteCoordinationTarget>()
  for (const value of values) {
    const target = parseTarget(value)
    byDescriptor.set(targetDescriptor(target), target)
  }
  return [...byDescriptor.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([, target]) => target)
}

function parseClaim(value: unknown): WriteClaimRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WriteCoordinationStateError("Discord write claim is not an object")
  }
  const record = value as Record<string, unknown>
  if (
    !exactKeys(record, CLAIM_KEYS)
    || record.schemaVersion !== CLAIM_SCHEMA_VERSION
    || typeof record.claimId !== "string"
    || !CLAIM_ID_PATTERN.test(record.claimId)
    || !validTimestamp(record.createdAt)
    || typeof record.kind !== "string"
    || !(OPERATION_KINDS as readonly string[]).includes(record.kind)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || !Number.isSafeInteger(record.ownerPid)
    || (record.ownerPid as number) < 1
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
  ) {
    throw new WriteCoordinationStateError("Discord write claim has an invalid shape")
  }
  const targets = normalizeTargets(record.targets)
  if (
    !Array.isArray(record.targets)
    || targets.length !== record.targets.length
    || JSON.stringify(targets) !== JSON.stringify(record.targets)
  ) {
    throw new WriteCoordinationStateError(
      "Discord write claim targets are duplicated or not canonical",
    )
  }
  return {
    claimId: record.claimId,
    createdAt: record.createdAt,
    kind: record.kind as OperationKind,
    operationKeyHash: record.operationKeyHash,
    ownerPid: record.ownerPid as number,
    planDigest: record.planDigest,
    schemaVersion: CLAIM_SCHEMA_VERSION,
    targets,
  }
}

function parseAcknowledgement(value: unknown): ResolutionAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WriteCoordinationStateError("Discord write resolution is not an object")
  }
  const record = value as Record<string, unknown>
  if (
    !exactKeys(record, ACKNOWLEDGEMENT_KEYS)
    || record.schemaVersion !== RESOLUTION_SCHEMA_VERSION
    || record.reason !== RESOLUTION_REASON
    || !validTimestamp(record.resolvedAt)
    || !Number.isSafeInteger(record.resolverPid)
    || (record.resolverPid as number) < 1
  ) {
    throw new WriteCoordinationStateError("Discord write resolution has an invalid shape")
  }
  return {
    claim: parseClaim(record.claim),
    reason: RESOLUTION_REASON,
    resolvedAt: record.resolvedAt,
    resolverPid: record.resolverPid as number,
    schemaVersion: RESOLUTION_SCHEMA_VERSION,
  }
}

function normalizeIntent(intent: WriteCoordinationIntent): WriteCoordinationIntent {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
    throw new WriteCoordinationStateError("Discord write coordination intent is invalid")
  }
  if (
    !OPERATION_KINDS.includes(intent.kind)
    || !OPERATION_KEY_HASH_PATTERN.test(intent.operationKeyHash)
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(intent.planDigest)
  ) {
    throw new WriteCoordinationStateError("Discord write coordination identity is invalid")
  }
  return {
    kind: intent.kind,
    operationKeyHash: intent.operationKeyHash,
    planDigest: intent.planDigest,
    targets: normalizeTargets(intent.targets),
  }
}

export function writeResourceTarget(
  kind: WriteCoordinationResourceKind,
  id: string,
): WriteCoordinationTarget {
  return parseTarget({ id, kind })
}

export function writeGuildCollectionTarget(
  collection: WriteCoordinationGuildCollection,
  guildId: string,
): WriteCoordinationTarget {
  return parseTarget({ collection, guildId, kind: "guild-collection" })
}

export function writeCoordinationTargetHash(target: WriteCoordinationTarget): string {
  const normalized = parseTarget(target)
  return createHash("sha256")
    .update("discord-mcp-write-target.v1\0")
    .update(targetDescriptor(normalized))
    .digest("hex")
}

export function writeCoordinationDirectory(activityFile: string): string {
  if (typeof activityFile !== "string" || !activityFile.trim()) {
    throw new RangeError("Discord activity-file path is required")
  }
  return `${activityFile}.coordination`
}

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
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

function assertPrivateDirectoryMetadata(metadata: BigIntStats): void {
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077n) !== 0n
    || (
      typeof process.getuid === "function"
      && metadata.uid !== BigInt(process.getuid())
    )
  ) {
    throw new WriteCoordinationStateError(
      "Discord write coordination directory is not private",
    )
  }
}

async function inspectPrivateDirectory(
  directory: string,
  missingAllowed: boolean,
): Promise<boolean> {
  try {
    assertPrivateDirectoryMetadata(await lstat(directory, { bigint: true }))
    return true
  } catch (error) {
    if (missingAllowed && isNodeError(error, "ENOENT")) return false
    if (error instanceof WriteCoordinationStateError) throw error
    throw new WriteCoordinationStateError(
      "Unable to inspect Discord write coordination directory",
      { cause: error },
    )
  }
}

function assertPrivateFileMetadata(metadata: BigIntStats, maxBytes: number): void {
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.nlink !== 1n
    || (metadata.mode & 0o077n) !== 0n
    || metadata.size < 2n
    || metadata.size > BigInt(maxBytes)
    || (
      typeof process.getuid === "function"
      && metadata.uid !== BigInt(process.getuid())
    )
  ) {
    throw new WriteCoordinationStateError(
      "Discord write coordination record is not a private regular file",
    )
  }
}

async function readPrivateRecord(
  file: string,
  maxBytes: number,
  missingAllowed: boolean,
): Promise<unknown | undefined> {
  let before: BigIntStats
  try {
    before = await lstat(file, { bigint: true })
  } catch (error) {
    if (missingAllowed && isNodeError(error, "ENOENT")) return undefined
    throw new WriteCoordinationStateError(
      "Unable to inspect Discord write coordination record",
      { cause: error },
    )
  }
  assertPrivateFileMetadata(before, maxBytes)
  let handle
  try {
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
    handle = await open(file, constants.O_RDONLY | noFollow)
    const opened = await handle.stat({ bigint: true })
    assertPrivateFileMetadata(opened, maxBytes)
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new WriteCoordinationStateError(
        "Discord write coordination record changed while it was opened",
      )
    }
    const bytes = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    const afterPath = await lstat(file, { bigint: true })
    if (
      bytes.byteLength !== Number(opened.size)
      || !sameMetadata(opened, afterRead)
      || !sameMetadata(afterRead, afterPath)
    ) {
      throw new WriteCoordinationStateError(
        "Discord write coordination record changed while it was read",
      )
    }
    const text = bytes.toString("utf8")
    const lines = text.split("\n")
    if (lines.length !== 2 || !lines[0] || lines[1] !== "") {
      throw new WriteCoordinationStateError(
        "Discord write coordination record is not one complete record",
      )
    }
    try {
      return JSON.parse(lines[0] as string) as unknown
    } catch (error) {
      throw new WriteCoordinationStateError(
        "Discord write coordination record is not valid JSON",
        { cause: error },
      )
    }
  } catch (error) {
    if (error instanceof WriteCoordinationStateError) throw error
    throw new WriteCoordinationStateError(
      "Unable to read Discord write coordination record",
      { cause: error },
    )
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    throw new WriteCoordinationStateError(
      "Unable to sync Discord write coordination state",
      { cause: error },
    )
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function writeExclusiveRecord(file: string, value: unknown): Promise<void> {
  let handle
  try {
    handle = await open(file, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8")
    await handle.sync()
  } catch (error) {
    throw new WriteCoordinationStateError(
      "Unable to write Discord write coordination record",
      { cause: error },
    )
  } finally {
    await handle?.close().catch(() => undefined)
  }
  await syncDirectory(dirname(file))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw new WriteCoordinationStateError(
      "Unable to inspect Discord write coordination state",
      { cause: error },
    )
  }
}

function sameClaim(left: WriteClaimRecord, right: WriteClaimRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function localClaimKey(directoryIdentity: string, claimId: string): string {
  return `${directoryIdentity}\0${claimId}`
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isNodeError(error, "ESRCH")) return false
    if (isNodeError(error, "EPERM")) return true
    throw error
  }
}

function safeRecoveryEvidence(evidence: ReceiptEvidence): boolean {
  return ["completed", "different-plan", "failed", "missing"].includes(evidence)
}

export class FileWriteCoordinator implements WriteCoordinator {
  readonly #claimsDirectory: string
  readonly #clock: () => Date
  readonly #directory: string
  #directoryIdentity: string | undefined
  readonly #operationStore: OperationStore
  readonly #ownerPid: number
  readonly #processAlive: (pid: number) => boolean
  readonly #randomId: () => string
  readonly #resolutionsDirectory: string
  readonly #retiredDirectory: string
  readonly #stagingDirectory: string

  constructor(
    directory: string,
    operationStore: OperationStore,
    options: FileWriteCoordinatorOptions = {},
  ) {
    if (
      typeof directory !== "string"
      || !isAbsolute(directory)
      || resolve(directory) !== directory
      || directory.includes("\0")
    ) {
      throw new RangeError(
        "Discord write coordination directory must be one normalized absolute path",
      )
    }
    const ownerPid = options.ownerPid ?? process.pid
    if (!Number.isSafeInteger(ownerPid) || ownerPid < 1) {
      throw new RangeError("Discord write coordination owner PID is invalid")
    }
    this.#directory = directory
    this.#claimsDirectory = join(directory, "claims")
    this.#stagingDirectory = join(directory, "staging")
    this.#retiredDirectory = join(directory, "retired")
    this.#resolutionsDirectory = join(directory, "resolutions")
    this.#operationStore = operationStore
    this.#clock = options.clock || (() => new Date())
    this.#ownerPid = ownerPid
    this.#processAlive = options.processAlive || defaultProcessAlive
    this.#randomId = options.randomId
      || (() => `claim_${randomBytes(16).toString("hex")}`)
  }

  async #ensureDirectory(create: boolean): Promise<boolean> {
    if (!create && !await inspectPrivateDirectory(this.#directory, true)) return false
    if (create) {
      try {
        await mkdir(this.#directory, { mode: 0o700, recursive: true })
      } catch (error) {
        throw new WriteCoordinationStateError(
          "Unable to create Discord write coordination directory",
          { cause: error },
        )
      }
      await inspectPrivateDirectory(this.#directory, false)
    }
    for (const directory of [
      this.#claimsDirectory,
      this.#stagingDirectory,
      this.#retiredDirectory,
      this.#resolutionsDirectory,
    ]) {
      if (create) {
        try {
          await mkdir(directory, { mode: 0o700 })
        } catch (error) {
          if (!isNodeError(error, "EEXIST")) {
            throw new WriteCoordinationStateError(
              "Unable to create Discord write coordination directory",
              { cause: error },
            )
          }
        }
      }
      if (!await inspectPrivateDirectory(directory, !create)) {
        if (!create) {
          throw new WriteCoordinationStateError(
            "Discord write coordination directory is incomplete",
          )
        }
        throw new WriteCoordinationStateError(
          "Discord write coordination directory disappeared",
        )
      }
    }
    let metadata: BigIntStats
    try {
      metadata = await lstat(this.#directory, { bigint: true })
      assertPrivateDirectoryMetadata(metadata)
    } catch (error) {
      if (error instanceof WriteCoordinationStateError) throw error
      throw new WriteCoordinationStateError(
        "Unable to identify Discord write coordination directory",
        { cause: error },
      )
    }
    const identity = `${metadata.dev}:${metadata.ino}`
    if (this.#directoryIdentity && this.#directoryIdentity !== identity) {
      throw new WriteCoordinationStateError(
        "Discord write coordination directory changed identity",
      )
    }
    this.#directoryIdentity = identity
    return true
  }

  #localClaimKey(claimId: string): string {
    if (!this.#directoryIdentity) {
      throw new WriteCoordinationStateError(
        "Discord write coordination directory identity is unavailable",
      )
    }
    return localClaimKey(this.#directoryIdentity, claimId)
  }

  #retiredTargetDirectory(record: WriteClaimRecord, target: WriteCoordinationTarget): string {
    return join(
      this.#retiredDirectory,
      `${record.claimId}-${writeCoordinationTargetHash(target)}`,
    )
  }

  async #readClaimDirectory(
    directory: string,
    expectedHash: string,
    missingAllowed: boolean,
  ): Promise<WriteClaimRecord | undefined> {
    if (!await inspectPrivateDirectory(directory, missingAllowed)) return undefined
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch (error) {
      if (missingAllowed && !await pathExists(directory)) return undefined
      throw new WriteCoordinationStateError(
        "Unable to inspect Discord write claim directory",
        { cause: error },
      )
    }
    if (entries.length !== 1 || entries[0] !== CLAIM_FILE) {
      if (missingAllowed && !await pathExists(directory)) return undefined
      throw new WriteCoordinationStateError(
        "Discord write claim directory has unexpected entries",
      )
    }
    let value: unknown
    try {
      value = await readPrivateRecord(
        join(directory, CLAIM_FILE),
        MAX_CLAIM_BYTES,
        false,
      )
    } catch (error) {
      if (missingAllowed && !await pathExists(directory)) return undefined
      throw error
    }
    const record = parseClaim(value)
    if (!record.targets.some(
      (target) => writeCoordinationTargetHash(target) === expectedHash,
    )) {
      throw new WriteCoordinationStateError(
        "Discord write claim does not match its target directory",
      )
    }
    return record
  }

  async #readPublishedClaim(
    target: WriteCoordinationTarget,
  ): Promise<WriteClaimRecord | undefined> {
    const hash = writeCoordinationTargetHash(target)
    return this.#readClaimDirectory(
      join(this.#claimsDirectory, hash),
      hash,
      true,
    )
  }

  async #publishTarget(
    record: WriteClaimRecord,
    target: WriteCoordinationTarget,
  ): Promise<boolean> {
    const hash = writeCoordinationTargetHash(target)
    let staging: string
    try {
      staging = await mkdtemp(join(this.#stagingDirectory, ".claim-"))
    } catch (error) {
      throw new WriteCoordinationStateError(
        "Unable to stage Discord write claim",
        { cause: error },
      )
    }
    let published = false
    try {
      await inspectPrivateDirectory(staging, false)
      await writeExclusiveRecord(join(staging, CLAIM_FILE), record)
      const targetDirectory = join(this.#claimsDirectory, hash)
      try {
        await rename(staging, targetDirectory)
        published = true
      } catch (error) {
        if (await pathExists(targetDirectory)) return false
        throw new WriteCoordinationStateError(
          "Unable to publish Discord write claim",
          { cause: error },
        )
      }
      await Promise.all([
        syncDirectory(this.#claimsDirectory),
        syncDirectory(this.#stagingDirectory),
      ])
      return true
    } finally {
      if (!published) {
        await rm(staging, { force: true, recursive: true }).catch(() => undefined)
        await syncDirectory(this.#stagingDirectory).catch(() => undefined)
      }
    }
  }

  async #retireOwnedClaim(record: WriteClaimRecord): Promise<number> {
    let released = 0
    for (const target of record.targets) {
      const hash = writeCoordinationTargetHash(target)
      const source = join(this.#claimsDirectory, hash)
      const destination = this.#retiredTargetDirectory(record, target)
      const existing = await this.#readClaimDirectory(source, hash, true)
      if (!existing) {
        const retired = await this.#readClaimDirectory(destination, hash, true)
        if (retired && !sameClaim(retired, record)) {
          throw new WriteCoordinationStateError(
            "Discord retired write claim changed identity",
          )
        }
        continue
      }
      if (existing.claimId !== record.claimId) continue
      if (!sameClaim(existing, record)) {
        throw new WriteCoordinationStateError(
          "Discord write claim changed identity before release",
        )
      }
      const retired = await this.#readClaimDirectory(destination, hash, true)
      if (retired) {
        if (!sameClaim(retired, record)) {
          throw new WriteCoordinationStateError(
            "Discord retired write claim changed identity",
          )
        }
        throw new WriteCoordinationStateError(
          "Discord write claim exists in active and retired state",
        )
      }
      try {
        await rename(source, destination)
      } catch (error) {
        if (!await pathExists(source)) continue
        throw new WriteCoordinationStateError(
          "Unable to retire Discord write claim",
          { cause: error },
        )
      }
      released += 1
    }
    await Promise.all([
      syncDirectory(this.#claimsDirectory),
      syncDirectory(this.#retiredDirectory),
    ])
    for (const target of record.targets) {
      const retired = this.#retiredTargetDirectory(record, target)
      await rm(retired, { force: true, recursive: true }).catch(() => undefined)
    }
    await syncDirectory(this.#retiredDirectory).catch(() => undefined)
    return released
  }

  async #receiptEvidence(record: WriteClaimRecord): Promise<ReceiptEvidence> {
    try {
      const receipt = await this.#operationStore.get(
        record.kind,
        record.operationKeyHash,
      )
      if (!receipt) return "missing"
      if (receipt.planDigest !== record.planDigest) return "different-plan"
      return receipt.status
    } catch {
      return "unreadable"
    }
  }

  #ownerState(record: WriteClaimRecord): WriteCoordinationOwnerState {
    if (ACTIVE_LOCAL_CLAIMS.has(this.#localClaimKey(record.claimId))) {
      return "alive"
    }
    if (record.ownerPid === this.#ownerPid) return "dead"
    try {
      return this.#processAlive(record.ownerPid) ? "alive" : "dead"
    } catch {
      return "unknown"
    }
  }

  async #acquire(record: WriteClaimRecord): Promise<void> {
    for (;;) {
      let incumbent: WriteClaimRecord | undefined
      let retry = false
      try {
        for (const target of record.targets) {
          if (await this.#publishTarget(record, target)) continue
          incumbent = await this.#readPublishedClaim(target)
          if (!incumbent) {
            retry = true
          }
          break
        }
      } catch (error) {
        await this.#retireOwnedClaim(record).catch(() => undefined)
        throw error
      }
      if (retry) {
        await this.#retireOwnedClaim(record)
        continue
      }
      if (!incumbent) return
      await this.#retireOwnedClaim(record)

      const local = ACTIVE_LOCAL_CLAIMS.get(
        this.#localClaimKey(incumbent.claimId),
      )
      if (local) {
        await local
        continue
      }

      const ownerState = this.#ownerState(incumbent)
      if (ownerState === "alive" && incumbent.ownerPid !== this.#ownerPid) {
        throw new WriteCoordinationConflictError(incumbent.claimId)
      }
      if (ownerState === "unknown") {
        throw new WriteCoordinationQuarantinedError(incumbent.claimId)
      }
      const evidence = await this.#receiptEvidence(incumbent)
      if (!safeRecoveryEvidence(evidence)) {
        throw new WriteCoordinationQuarantinedError(incumbent.claimId)
      }
      await this.#retireOwnedClaim(incumbent)
    }
  }

  async #scanClaims(): Promise<PublishedClaim[]> {
    if (!await this.#ensureDirectory(false)) return []
    let entries
    try {
      entries = await readdir(this.#claimsDirectory, { withFileTypes: true })
    } catch (error) {
      throw new WriteCoordinationStateError(
        "Unable to list Discord write claims",
        { cause: error },
      )
    }
    const claims: PublishedClaim[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !TARGET_HASH_PATTERN.test(entry.name)) {
        throw new WriteCoordinationStateError(
          "Discord write claims directory has an unexpected entry",
        )
      }
      const record = await this.#readClaimDirectory(
        join(this.#claimsDirectory, entry.name),
        entry.name,
        true,
      )
      if (!record) continue
      claims.push({ hash: entry.name, record })
    }
    return claims
  }

  async list(): Promise<WriteCoordinationList> {
    const published = await this.#scanClaims()
    const grouped = new Map<string, { hashes: Set<string>; record: WriteClaimRecord }>()
    for (const claim of published) {
      const existing = grouped.get(claim.record.claimId)
      if (existing) {
        if (!sameClaim(existing.record, claim.record)) {
          throw new WriteCoordinationStateError(
            "Discord write claim ID has conflicting records",
          )
        }
        existing.hashes.add(claim.hash)
      } else {
        grouped.set(claim.record.claimId, {
          hashes: new Set([claim.hash]),
          record: claim.record,
        })
      }
    }
    const claims = await Promise.all([...grouped.values()].map(async ({ hashes, record }) => {
      const ownerState = this.#ownerState(record)
      const receiptState = await this.#receiptEvidence(record)
      const state: WriteCoordinationClaimState = ownerState === "alive"
        ? "active"
        : ownerState === "dead" && safeRecoveryEvidence(receiptState)
          ? "auto-reclaimable"
          : "review-required"
      return {
        claimId: record.claimId,
        createdAt: record.createdAt,
        kind: record.kind,
        operationKeyHash: record.operationKeyHash,
        ownerPid: record.ownerPid,
        ownerState,
        planDigest: record.planDigest,
        publishedTargetCount: hashes.size,
        receiptState,
        schemaVersion: CLAIM_SCHEMA_VERSION,
        state,
        targets: record.targets,
      } satisfies WriteCoordinationClaimStatus
    }))
    claims.sort((left, right) => (
      compareCanonicalText(left.createdAt, right.createdAt)
      || compareCanonicalText(left.claimId, right.claimId)
    ))
    return {
      claims,
      schemaVersion: CLAIM_SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #readAcknowledgement(
    claimId: string,
  ): Promise<ResolutionAcknowledgement | undefined> {
    const directory = join(this.#resolutionsDirectory, claimId)
    if (!await inspectPrivateDirectory(directory, true)) return undefined
    const entries = await readdir(directory)
    if (entries.length !== 1 || entries[0] !== ACKNOWLEDGEMENT_FILE) {
      throw new WriteCoordinationStateError(
        "Discord write resolution directory has unexpected entries",
      )
    }
    return parseAcknowledgement(await readPrivateRecord(
      join(directory, ACKNOWLEDGEMENT_FILE),
      MAX_RESOLUTION_BYTES,
      false,
    ))
  }

  async #publishAcknowledgement(
    acknowledgement: ResolutionAcknowledgement,
  ): Promise<void> {
    const existing = await this.#readAcknowledgement(acknowledgement.claim.claimId)
    if (existing) {
      if (!sameClaim(existing.claim, acknowledgement.claim)) {
        throw new WriteCoordinationResolutionError(
          "Discord write claim already has a different resolution acknowledgement",
        )
      }
      return
    }
    let staging: string
    try {
      staging = await mkdtemp(join(this.#resolutionsDirectory, ".resolution-"))
    } catch (error) {
      throw new WriteCoordinationStateError(
        "Unable to stage Discord write resolution",
        { cause: error },
      )
    }
    let published = false
    try {
      await inspectPrivateDirectory(staging, false)
      await writeExclusiveRecord(
        join(staging, ACKNOWLEDGEMENT_FILE),
        acknowledgement,
      )
      const target = join(
        this.#resolutionsDirectory,
        acknowledgement.claim.claimId,
      )
      try {
        await rename(staging, target)
        published = true
      } catch (error) {
        if (!await pathExists(target)) {
          throw new WriteCoordinationStateError(
            "Unable to publish Discord write resolution",
            { cause: error },
          )
        }
        const concurrent = await this.#readAcknowledgement(
          acknowledgement.claim.claimId,
        )
        if (!concurrent || !sameClaim(concurrent.claim, acknowledgement.claim)) {
          throw new WriteCoordinationResolutionError(
            "Discord write claim already has a different resolution acknowledgement",
          )
        }
      }
      await syncDirectory(this.#resolutionsDirectory)
    } finally {
      if (!published) {
        await rm(staging, { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  async resolve(
    claimIdValue: string,
    confirmationValue: string,
  ): Promise<WriteCoordinationResolution> {
    const claimId = normalizeClaimId(claimIdValue)
    if (confirmationValue !== claimId) {
      throw new WriteCoordinationResolutionError(
        "Discord write claim resolution requires the exact claim ID as confirmation",
      )
    }
    await this.#ensureDirectory(true)
    const published = await this.#scanClaims()
    const records = published
      .filter((claim) => claim.record.claimId === claimId)
      .map((claim) => claim.record)
    let record = records[0]
    for (const candidate of records.slice(1)) {
      if (!record || !sameClaim(record, candidate)) {
        throw new WriteCoordinationResolutionError(
          "Discord write claim has conflicting target records",
        )
      }
    }
    const existingAcknowledgement = await this.#readAcknowledgement(claimId)
    if (!record) {
      if (!existingAcknowledgement) {
        throw new WriteCoordinationResolutionError("Discord write claim was not found")
      }
      record = existingAcknowledgement.claim
      await this.#retireOwnedClaim(record)
      return {
        claimId,
        releasedTargetCount: 0,
        schemaVersion: RESOLUTION_SCHEMA_VERSION,
        status: "already-resolved",
      }
    }
    if (this.#ownerState(record) !== "dead") {
      throw new WriteCoordinationResolutionError(
        "Discord write claim owner must be stopped before resolution",
      )
    }
    if (existingAcknowledgement && !sameClaim(existingAcknowledgement.claim, record)) {
      throw new WriteCoordinationResolutionError(
        "Discord write claim resolution acknowledgement changed identity",
      )
    }
    if (!existingAcknowledgement) {
      await this.#publishAcknowledgement({
        claim: record,
        reason: RESOLUTION_REASON,
        resolvedAt: this.#clock().toISOString(),
        resolverPid: this.#ownerPid,
        schemaVersion: RESOLUTION_SCHEMA_VERSION,
      })
    }
    const releasedTargetCount = await this.#retireOwnedClaim(record)
    return {
      claimId,
      releasedTargetCount,
      schemaVersion: RESOLUTION_SCHEMA_VERSION,
      status: "resolved",
    }
  }

  async run<T>(
    intentValue: WriteCoordinationIntent,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (typeof operation !== "function") {
      throw new TypeError("Discord write coordination operation must be a function")
    }
    const intent = normalizeIntent(intentValue)
    await this.#ensureDirectory(true)
    const claimId = this.#randomId()
    if (!CLAIM_ID_PATTERN.test(claimId)) {
      throw new WriteCoordinationStateError(
        "Generated Discord write claim ID is invalid",
      )
    }
    const record: WriteClaimRecord = {
      claimId,
      createdAt: this.#clock().toISOString(),
      kind: intent.kind,
      operationKeyHash: intent.operationKeyHash,
      ownerPid: this.#ownerPid,
      planDigest: intent.planDigest,
      schemaVersion: CLAIM_SCHEMA_VERSION,
      targets: [...intent.targets],
    }
    parseClaim(record)

    let resolveLocal: (() => void) | undefined
    const localDone = new Promise<void>((resolvePromise) => {
      resolveLocal = resolvePromise
    })
    const activeKey = this.#localClaimKey(claimId)
    if (ACTIVE_LOCAL_CLAIMS.has(activeKey)) {
      throw new WriteCoordinationStateError("Discord write claim ID is already active")
    }
    ACTIVE_LOCAL_CLAIMS.set(activeKey, localDone)
    try {
      await this.#acquire(record)
      let result: T
      try {
        result = await operation()
      } catch (error) {
        const evidence = await this.#receiptEvidence(record)
        if (!safeRecoveryEvidence(evidence)) {
          throw new WriteCoordinationQuarantinedError(record.claimId, { cause: error })
        }
        await this.#retireOwnedClaim(record)
        throw error
      }
      const evidence = await this.#receiptEvidence(record)
      if (!safeRecoveryEvidence(evidence)) {
        throw new WriteCoordinationQuarantinedError(record.claimId)
      }
      await this.#retireOwnedClaim(record)
      return result
    } finally {
      ACTIVE_LOCAL_CLAIMS.delete(activeKey)
      resolveLocal?.()
    }
  }
}
