import { createHash } from "node:crypto"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  CONNECTOR_LIMITS,
  CONTENT_FREE_ERROR_PATTERN,
  CONTENT_FREE_IDENTIFIER_PATTERN,
  DISCORD_SNOWFLAKE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
} from "./constants.js"
import { OperationStoreError } from "./errors.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"

export const OPERATION_KEY_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/

export const OPERATION_KINDS = [
  "channel-creation",
] as const

export type OperationKind = typeof OPERATION_KINDS[number]
export type OperationReceiptStatus = "completed" | "failed" | "pending" | "uncertain"
export type OperationVerification = "drift" | "match" | null

export interface OperationReceipt {
  activityId: string
  error: string | null
  guildId: string
  kind: OperationKind
  operationKeyHash: string
  planDigest: string
  resourceId: string | null
  schemaVersion: 1
  status: OperationReceiptStatus
  timestamp: string
  verification: OperationVerification
}

export interface OperationReservation {
  created: boolean
  receipt: OperationReceipt
}

export interface OperationStore {
  finish(receipt: OperationReceipt): Promise<void>
  get(kind: OperationKind, operationKeyHash: string): Promise<OperationReceipt | undefined>
  reserve(receipt: OperationReceipt): Promise<OperationReservation>
}

const OPERATION_RECEIPT_SCHEMA_VERSION = 1
const RECEIPT_KEYS = [
  "activityId",
  "error",
  "guildId",
  "kind",
  "operationKeyHash",
  "planDigest",
  "resourceId",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
] as const

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function parseReceipt(value: unknown): OperationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationStoreError("Discord operation receipt is not an object")
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== [...RECEIPT_KEYS].sort().join("\0")
    || record.schemaVersion !== OPERATION_RECEIPT_SCHEMA_VERSION
    || !OPERATION_KINDS.includes(record.kind as OperationKind)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.activityId !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.activityId)
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.resourceId === null || (
      typeof record.resourceId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.resourceId)
    ))
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || !validTimestamp(record.timestamp)
  ) {
    throw new OperationStoreError("Discord operation receipt has an invalid shape")
  }
  if (record.status === "pending" && (
    record.error !== null
    || record.resourceId !== null
    || record.verification !== null
  )) {
    throw new OperationStoreError("Pending Discord operation receipt contains terminal state")
  }
  if (record.status === "completed" && (
    record.error !== null
    || record.resourceId === null
    || !["drift", "match"].includes(String(record.verification))
  )) {
    throw new OperationStoreError("Completed Discord operation receipt lacks verified state")
  }
  if (record.status === "failed" && (
    record.error === null
    || record.resourceId !== null
  )) {
    throw new OperationStoreError("Failed Discord operation receipt has invalid outcome state")
  }
  if (record.status === "uncertain" && record.error === null) {
    throw new OperationStoreError("Uncertain Discord operation receipt lacks an error category")
  }
  if (record.status !== "completed" && record.verification !== null) {
    throw new OperationStoreError("Incomplete Discord operation receipt contains verification state")
  }
  return {
    activityId: record.activityId,
    error: record.error,
    guildId: record.guildId,
    kind: record.kind as OperationKind,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    resourceId: record.resourceId,
    schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
    status: record.status as OperationReceiptStatus,
    timestamp: record.timestamp,
    verification: record.verification as OperationVerification,
  }
}

function assertIdentity(
  pending: OperationReceipt,
  terminal: OperationReceipt,
): void {
  if (
    pending.activityId !== terminal.activityId
    || pending.guildId !== terminal.guildId
    || pending.kind !== terminal.kind
    || pending.operationKeyHash !== terminal.operationKeyHash
    || pending.planDigest !== terminal.planDigest
  ) {
    throw new OperationStoreError("Discord operation terminal receipt changed reserved identity")
  }
  if (terminal.status === "pending") {
    throw new OperationStoreError("Discord operation terminal receipt is still pending")
  }
}

function sameTerminal(left: OperationReceipt, right: OperationReceipt): boolean {
  return left.activityId === right.activityId
    && left.error === right.error
    && left.guildId === right.guildId
    && left.kind === right.kind
    && left.operationKeyHash === right.operationKeyHash
    && left.planDigest === right.planDigest
    && left.resourceId === right.resourceId
    && left.status === right.status
    && left.verification === right.verification
}

export function operationKeyHash(operationKey: string): string {
  if (
    typeof operationKey !== "string"
    || operationKey.length < CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters
    || operationKey.length > CONNECTOR_LIMITS.idempotencyKeyCharacters
    || !IDEMPOTENCY_KEY_PATTERN.test(operationKey)
  ) {
    throw new RangeError(
      `Discord operation key must be ${CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters}-${CONNECTOR_LIMITS.idempotencyKeyCharacters} safe ASCII characters`,
    )
  }
  return `sha256:${createHash("sha256")
    .update("discord-mcp-operation-key.v1\0")
    .update(operationKey)
    .digest("hex")}`
}

export function operationReceiptDirectory(activityFile: string): string {
  return `${activityFile}.operations`
}

function receiptStem(kind: OperationKind, hash: string): string {
  if (!OPERATION_KINDS.includes(kind) || !OPERATION_KEY_HASH_PATTERN.test(hash)) {
    throw new OperationStoreError("Discord operation receipt identity is invalid")
  }
  return `${kind}-${hash.slice("sha256:".length)}`
}

async function readReceiptFile(file: string): Promise<OperationReceipt | undefined> {
  let metadata
  try {
    metadata = await lstat(file)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined
    throw new OperationStoreError("Unable to inspect Discord operation receipt", { cause: error })
  }
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.nlink !== 1
    || (metadata.mode & 0o077) !== 0
    || metadata.size < 2
    || metadata.size > CONNECTOR_LIMITS.operationReceiptBytes
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new OperationStoreError("Discord operation receipt is not a private regular file")
  }
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    throw new OperationStoreError("Unable to read Discord operation receipt", { cause: error })
  }
  const lines = text.split("\n").filter((line) => line.length > 0)
  if (lines.length !== 1 || !text.endsWith("\n")) {
    throw new OperationStoreError("Discord operation receipt is not one complete record")
  }
  try {
    return parseReceipt(JSON.parse(lines[0] as string) as unknown)
  } catch (error) {
    if (error instanceof OperationStoreError) throw error
    throw new OperationStoreError("Discord operation receipt is not valid JSON", { cause: error })
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    throw new OperationStoreError("Unable to sync Discord operation receipt", { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function writeExclusive(file: string, receipt: OperationReceipt): Promise<boolean> {
  let handle
  try {
    handle = await open(file, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8")
    await handle.sync()
  } catch (error) {
    if (isNodeError(error, "EEXIST")) return false
    throw new OperationStoreError("Unable to write Discord operation receipt", { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
  await syncDirectory(dirname(file))
  return true
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw new OperationStoreError("Unable to inspect Discord operation receipt", { cause: error })
  }
}

async function publishReceiptDirectory(
  parent: string,
  target: string,
  receiptFile: string,
  receipt: OperationReceipt,
): Promise<boolean> {
  let staging: string
  try {
    staging = await mkdtemp(join(parent, ".operation-receipt-"))
  } catch (error) {
    throw new OperationStoreError("Unable to stage Discord operation receipt", { cause: error })
  }
  let published = false
  try {
    if (!await writeExclusive(join(staging, receiptFile), receipt)) {
      throw new OperationStoreError("Discord operation staging receipt already exists")
    }
    try {
      await rename(staging, target)
      published = true
    } catch (error) {
      if (await pathExists(target)) return false
      throw new OperationStoreError("Unable to publish Discord operation receipt", { cause: error })
    }
    await syncDirectory(parent)
    return true
  } finally {
    if (!published) {
      await rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}

async function assertPrivateDirectory(
  directory: string,
  missingAllowed: boolean,
): Promise<boolean> {
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (missingAllowed && isNodeError(error, "ENOENT")) return false
    throw new OperationStoreError("Unable to inspect Discord operation directory", { cause: error })
  }
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new OperationStoreError("Discord operation directory is not private")
  }
  return true
}

async function readTerminalReceipt(
  directory: string,
  receiptFile: string,
): Promise<OperationReceipt | undefined> {
  if (!await assertPrivateDirectory(directory, true)) return undefined
  const receipt = await readReceiptFile(join(directory, receiptFile))
  if (!receipt) {
    throw new OperationStoreError("Discord operation terminal directory has no receipt")
  }
  return receipt
}

export class FileOperationStore implements OperationStore {
  readonly #directory: string

  constructor(directory: string) {
    this.#directory = directory
  }

  async #assertDirectory(create: boolean): Promise<boolean> {
    if (create) {
      try {
        await mkdir(this.#directory, { mode: 0o700, recursive: true })
      } catch (error) {
        throw new OperationStoreError("Unable to create Discord operation directory", { cause: error })
      }
    }
    return assertPrivateDirectory(this.#directory, !create)
  }

  #paths(kind: OperationKind, hash: string) {
    const stem = receiptStem(kind, hash)
    const operation = join(this.#directory, stem)
    const terminalDirectory = join(operation, "terminal")
    return {
      operation,
      pending: join(operation, "pending.json"),
      terminalDirectory,
    }
  }

  async get(
    kind: OperationKind,
    hash: string,
  ): Promise<OperationReceipt | undefined> {
    if (!await this.#assertDirectory(false)) return undefined
    const paths = this.#paths(kind, hash)
    if (!await assertPrivateDirectory(paths.operation, true)) return undefined
    const [pending, terminal] = await Promise.all([
      readReceiptFile(paths.pending),
      readTerminalReceipt(paths.terminalDirectory, "receipt.json"),
    ])
    if (!pending) {
      throw new OperationStoreError("Discord operation directory has no reservation")
    }
    if (pending.status !== "pending") {
      throw new OperationStoreError("Discord operation reservation is not pending")
    }
    if (!terminal) return pending
    assertIdentity(pending, terminal)
    return terminal
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const normalized = parseReceipt(receipt)
    if (normalized.status !== "pending") {
      throw new OperationStoreError("Discord operation reservation must be pending")
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    const created = await publishReceiptDirectory(
      this.#directory,
      paths.operation,
      "pending.json",
      normalized,
    )
    if (created) return { created: true, receipt: normalized }
    const existing = await this.get(normalized.kind, normalized.operationKeyHash)
    if (!existing) {
      throw new OperationStoreError("Discord operation reservation disappeared")
    }
    return { created: false, receipt: existing }
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    const normalized = parseReceipt(receipt)
    if (normalized.status === "pending") {
      throw new OperationStoreError("Discord operation terminal receipt cannot be pending")
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    if (!await assertPrivateDirectory(paths.operation, true)) {
      throw new OperationStoreError("Discord operation has no reservation")
    }
    const pending = await readReceiptFile(paths.pending)
    if (!pending) {
      throw new OperationStoreError("Discord operation has no reservation")
    }
    assertIdentity(pending, normalized)
    if (await publishReceiptDirectory(
      paths.operation,
      paths.terminalDirectory,
      "receipt.json",
      normalized,
    )) return
    const existing = await readTerminalReceipt(
      paths.terminalDirectory,
      "receipt.json",
    )
    if (!existing) {
      throw new OperationStoreError("Discord operation terminal receipt disappeared")
    }
    assertIdentity(pending, existing)
    if (!sameTerminal(existing, normalized)) {
      throw new OperationStoreError("Discord operation already has a different terminal receipt")
    }
  }
}
