import { constants } from "node:fs"
import type { BigIntStats } from "node:fs"
import {
  lstat,
  open,
  realpath,
  unlink,
} from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import {
  isAbsolute,
  join,
  parse,
  resolve,
} from "node:path"
import { TextDecoder } from "node:util"

import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"

const CREDENTIAL_FILE_MODE = 0o600
const CREDENTIAL_FILE_PERMISSION_MASK = 0o777n
const ROOT_OWNER_PERMISSION_MASK = 0o700n
const ROOT_PRIVATE_PERMISSION_MASK = 0o077n
const OVERFLOW_PROBE_BYTES = 1

export type WebhookCredentialStoreErrorCode =
  | "exists"
  | "invalid"
  | "missing"
  | "unavailable"

export class WebhookCredentialStoreError extends Error {
  readonly code: WebhookCredentialStoreErrorCode
  override name = "WebhookCredentialStoreError"

  constructor(code: WebhookCredentialStoreErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface WebhookCredentialFileHandle {
  chmod(mode: number): Promise<void>
  close(): Promise<void>
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>
  stat(options: { bigint: true }): Promise<BigIntStats>
  sync(): Promise<void>
  writeFile(data: string, encoding: BufferEncoding): Promise<void>
}

export interface WebhookCredentialFileSystem {
  lstat(path: string, options: { bigint: true }): Promise<BigIntStats>
  open(path: string, flags: number, mode?: number): Promise<WebhookCredentialFileHandle>
  realpath(path: string): Promise<string>
  unlink(path: string): Promise<void>
}

export const DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM: WebhookCredentialFileSystem = {
  lstat: (path, options) => lstat(path, options),
  open: (path, flags, mode) => open(path, flags, mode) as Promise<FileHandle>,
  realpath,
  unlink,
}

interface RootIdentity {
  canonical: string
  metadata: BigIntStats
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameStableMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.ctimeNs === right.ctimeNs
    && left.mtimeNs === right.mtimeNs
}

function processUserId(): number {
  if (typeof process.getuid !== "function") {
    throw new WebhookCredentialStoreError(
      "unavailable",
      "Discord webhook credential ownership cannot be verified on this runtime",
    )
  }
  return process.getuid()
}

function assertWebhookId(webhookId: string): void {
  if (
    typeof webhookId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(webhookId)
    || BigInt(webhookId) < 1n
    || BigInt(webhookId) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new WebhookCredentialStoreError(
      "invalid",
      "Discord webhook credential ID is invalid",
    )
  }
}

function assertToken(token: string): void {
  if (
    typeof token !== "string"
    || token.length < 1
    || token.length > DISCORD_LIMITS.webhookTokenCharacters
    || /\s|[\u0000-\u001F\u007F]/u.test(token)
  ) {
    throw new WebhookCredentialStoreError(
      "invalid",
      "Discord webhook credential content is invalid",
    )
  }
}

function assertRootPath(root: string): void {
  if (
    typeof root !== "string"
    || !isAbsolute(root)
    || resolve(root) !== root
    || root === parse(root).root
    || root.trim() !== root
    || /[\u0000-\u001F\u007F]/u.test(root)
  ) {
    throw new WebhookCredentialStoreError(
      "invalid",
      "Discord webhook credential root is invalid",
    )
  }
}

function assertRootMetadata(
  root: string,
  canonical: string,
  metadata: BigIntStats,
): void {
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || canonical !== root
    || metadata.uid !== BigInt(processUserId())
    || (metadata.mode & ROOT_OWNER_PERMISSION_MASK) !== ROOT_OWNER_PERMISSION_MASK
    || (metadata.mode & ROOT_PRIVATE_PERMISSION_MASK) !== 0n
  ) {
    throw new WebhookCredentialStoreError(
      "invalid",
      "Discord webhook credential root must be canonical, process-owned, and 0700",
    )
  }
}

function assertFileMetadata(metadata: BigIntStats): void {
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.nlink !== 1n
    || metadata.uid !== BigInt(processUserId())
    || (metadata.mode & CREDENTIAL_FILE_PERMISSION_MASK) !== BigInt(CREDENTIAL_FILE_MODE)
    || metadata.size < 2n
    || metadata.size > BigInt(DISCORD_LIMITS.webhookTokenCharacters + 1)
  ) {
    throw new WebhookCredentialStoreError(
      "invalid",
      "Discord webhook credential file must be one bounded process-owned 0600 regular file",
    )
  }
}

async function readBounded(
  handle: WebhookCredentialFileHandle,
  expectedBytes: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(expectedBytes + OVERFLOW_PROBE_BYTES)
  let offset = 0
  while (offset < buffer.byteLength) {
    const result = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    )
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return buffer.subarray(0, offset)
}

export class WebhookCredentialStore {
  readonly #fileSystem: WebhookCredentialFileSystem
  readonly #root: string

  constructor(
    root: string,
    fileSystem: WebhookCredentialFileSystem = DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM,
  ) {
    assertRootPath(root)
    this.#root = root
    this.#fileSystem = fileSystem
  }

  pathFor(webhookId: string): string {
    assertWebhookId(webhookId)
    return join(this.#root, `${webhookId}.token`)
  }

  async #rootIdentity(): Promise<RootIdentity> {
    let metadata: BigIntStats
    let canonical: string
    try {
      [metadata, canonical] = await Promise.all([
        this.#fileSystem.lstat(this.#root, { bigint: true }),
        this.#fileSystem.realpath(this.#root),
      ])
    } catch {
      throw new WebhookCredentialStoreError(
        "unavailable",
        "Discord webhook credential root could not be inspected",
      )
    }
    assertRootMetadata(this.#root, canonical, metadata)
    return { canonical, metadata }
  }

  async #syncRoot(expected: RootIdentity): Promise<void> {
    let handle: WebhookCredentialFileHandle | undefined
    try {
      const directoryOnly = typeof constants.O_DIRECTORY === "number"
        ? constants.O_DIRECTORY
        : 0
      const noFollow = typeof constants.O_NOFOLLOW === "number"
        ? constants.O_NOFOLLOW
        : 0
      handle = await this.#fileSystem.open(
        this.#root,
        constants.O_RDONLY | directoryOnly | noFollow,
      )
      const [opened, linked, canonical] = await Promise.all([
        handle.stat({ bigint: true }),
        this.#fileSystem.lstat(this.#root, { bigint: true }),
        this.#fileSystem.realpath(this.#root),
      ])
      assertRootMetadata(this.#root, canonical, opened)
      assertRootMetadata(this.#root, canonical, linked)
      if (
        !sameIdentity(expected.metadata, opened)
        || !sameIdentity(opened, linked)
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential root changed before synchronization",
        )
      }
      await handle.sync()
      const [openedAfter, linkedAfter, rootAfter] = await Promise.all([
        handle.stat({ bigint: true }),
        this.#fileSystem.lstat(this.#root, { bigint: true }),
        this.#rootIdentity(),
      ])
      assertRootMetadata(this.#root, rootAfter.canonical, openedAfter)
      assertRootMetadata(this.#root, rootAfter.canonical, linkedAfter)
      if (
        !sameIdentity(opened, openedAfter)
        || !sameIdentity(openedAfter, linkedAfter)
        || !sameIdentity(openedAfter, rootAfter.metadata)
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential root changed during synchronization",
        )
      }
    } catch (error) {
      if (error instanceof WebhookCredentialStoreError) throw error
      throw new WebhookCredentialStoreError(
        "unavailable",
        "Discord webhook credential root could not be synchronized",
      )
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async read(webhookId: string): Promise<string> {
    const file = this.pathFor(webhookId)
    const rootBefore = await this.#rootIdentity()
    let handle: WebhookCredentialFileHandle | undefined
    try {
      const noFollow = typeof constants.O_NOFOLLOW === "number"
        ? constants.O_NOFOLLOW
        : 0
      handle = await this.#fileSystem.open(file, constants.O_RDONLY | noFollow)
      const [openedBefore, linkedBefore, canonical] = await Promise.all([
        handle.stat({ bigint: true }),
        this.#fileSystem.lstat(file, { bigint: true }),
        this.#fileSystem.realpath(file),
      ])
      assertFileMetadata(openedBefore)
      assertFileMetadata(linkedBefore)
      if (
        canonical !== file
        || !sameIdentity(openedBefore, linkedBefore)
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential file changed while it was opened",
        )
      }
      const bytes = await readBounded(handle, Number(openedBefore.size))
      const [openedAfter, linkedAfter, rootAfter] = await Promise.all([
        handle.stat({ bigint: true }),
        this.#fileSystem.lstat(file, { bigint: true }),
        this.#rootIdentity(),
      ])
      if (
        bytes.byteLength !== Number(openedBefore.size)
        || !sameStableMetadata(openedBefore, openedAfter)
        || !sameStableMetadata(openedAfter, linkedAfter)
        || !sameIdentity(rootBefore.metadata, rootAfter.metadata)
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential file changed while it was read",
        )
      }
      let content: string
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      } catch {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential file is not valid UTF-8",
        )
      }
      if (!content.endsWith("\n") || content.slice(0, -1).includes("\n")) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential file must contain one newline-terminated token",
        )
      }
      const token = content.slice(0, -1)
      assertToken(token)
      return token
    } catch (error) {
      if (error instanceof WebhookCredentialStoreError) throw error
      if (isNodeError(error, "ENOENT")) {
        throw new WebhookCredentialStoreError(
          "missing",
          "Discord webhook credential is not provisioned",
        )
      }
      throw new WebhookCredentialStoreError(
        "unavailable",
        "Discord webhook credential could not be inspected or read",
      )
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async write(webhookId: string, token: string): Promise<void> {
    const file = this.pathFor(webhookId)
    assertToken(token)
    const rootBefore = await this.#rootIdentity()
    if (typeof constants.O_NOFOLLOW !== "number") {
      throw new WebhookCredentialStoreError(
        "unavailable",
        "Discord webhook credential storage requires no-follow file creation",
      )
    }
    let handle: WebhookCredentialFileHandle | undefined
    let identity: BigIntStats | undefined
    try {
      handle = await this.#fileSystem.open(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        CREDENTIAL_FILE_MODE,
      )
      await handle.chmod(CREDENTIAL_FILE_MODE)
      const opened = await handle.stat({ bigint: true })
      identity = opened
      const [linked, canonical, rootAfter] = await Promise.all([
        this.#fileSystem.lstat(file, { bigint: true }),
        this.#fileSystem.realpath(file),
        this.#rootIdentity(),
      ])
      if (
        canonical !== file
        || !sameIdentity(opened, linked)
        || !sameIdentity(rootBefore.metadata, rootAfter.metadata)
        || opened.size !== 0n
        || linked.size !== 0n
        || opened.nlink !== 1n
        || opened.uid !== BigInt(processUserId())
        || (opened.mode & CREDENTIAL_FILE_PERMISSION_MASK) !== BigInt(CREDENTIAL_FILE_MODE)
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential reservation changed before use",
        )
      }
      const content = `${token}\n`
      await handle.writeFile(content, "utf8")
      await handle.sync()
      const [openedAfter, linkedAfter] = await Promise.all([
        handle.stat({ bigint: true }),
        this.#fileSystem.lstat(file, { bigint: true }),
      ])
      assertFileMetadata(openedAfter)
      assertFileMetadata(linkedAfter)
      if (
        !sameIdentity(opened, openedAfter)
        || !sameIdentity(openedAfter, linkedAfter)
        || openedAfter.size !== BigInt(Buffer.byteLength(content, "utf8"))
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential file changed while it was written",
        )
      }
      await handle.close()
      handle = undefined
      await this.#syncRoot(rootBefore)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (identity) {
        try {
          const linked = await this.#fileSystem.lstat(file, { bigint: true })
          if (sameIdentity(identity, linked)) {
            await this.#fileSystem.unlink(file)
            await this.#syncRoot(rootBefore).catch(() => undefined)
          }
        } catch {}
      }
      if (error instanceof WebhookCredentialStoreError) throw error
      if (isNodeError(error, "EEXIST")) {
        throw new WebhookCredentialStoreError(
          "exists",
          "Discord webhook credential is already provisioned",
        )
      }
      throw new WebhookCredentialStoreError(
        "unavailable",
        "Discord webhook credential could not be stored",
      )
    }
  }

  async remove(webhookId: string): Promise<boolean> {
    const file = this.pathFor(webhookId)
    const rootBefore = await this.#rootIdentity()
    let handle: WebhookCredentialFileHandle | undefined
    try {
      const noFollow = typeof constants.O_NOFOLLOW === "number"
        ? constants.O_NOFOLLOW
        : 0
      handle = await this.#fileSystem.open(file, constants.O_RDONLY | noFollow)
      const [opened, linked, canonical] = await Promise.all([
        handle.stat({ bigint: true }),
        this.#fileSystem.lstat(file, { bigint: true }),
        this.#fileSystem.realpath(file),
      ])
      assertFileMetadata(opened)
      assertFileMetadata(linked)
      if (canonical !== file || !sameIdentity(opened, linked)) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential file changed before removal",
        )
      }
      await handle.close()
      handle = undefined
      const [linkedBeforeUnlink, rootAfter] = await Promise.all([
        this.#fileSystem.lstat(file, { bigint: true }),
        this.#rootIdentity(),
      ])
      if (
        !sameIdentity(opened, linkedBeforeUnlink)
        || !sameIdentity(rootBefore.metadata, rootAfter.metadata)
      ) {
        throw new WebhookCredentialStoreError(
          "invalid",
          "Discord webhook credential changed before removal",
        )
      }
      await this.#fileSystem.unlink(file)
      await this.#syncRoot(rootBefore)
      return true
    } catch (error) {
      if (error instanceof WebhookCredentialStoreError) throw error
      if (isNodeError(error, "ENOENT")) return false
      throw new WebhookCredentialStoreError(
        "unavailable",
        "Discord webhook credential could not be removed",
      )
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }
}
