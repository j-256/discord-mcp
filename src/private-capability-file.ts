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
  dirname,
  isAbsolute,
  parse,
  resolve,
} from "node:path"

import { INVITE_LIMITS } from "./constants.js"

const CAPABILITY_FILE_MODE = 0o600
const CAPABILITY_FILE_PERMISSION_MASK = 0o777n

export interface PrivateCapabilityTargetReview {
  canonicalPath: string
  directChildOfConfiguredRoot: true
  exclusiveCreate: true
  fileMode: "0600"
  rootCanonical: true
  rootOwnerMatchesProcess: true
  rootPrivate: true
  targetAbsent: true
}

export interface PrivateCapabilityFileReservation {
  readonly review: PrivateCapabilityTargetReview
  discard(): Promise<boolean>
  write(content: string): Promise<void>
}

export interface PrivateCapabilityFileHandle {
  chmod(mode: number): Promise<void>
  close(): Promise<void>
  stat(options: { bigint: true }): Promise<BigIntStats>
  sync(): Promise<void>
  writeFile(data: string, encoding: BufferEncoding): Promise<void>
}

export interface PrivateCapabilityFileSystem {
  lstat(path: string, options: { bigint: true }): Promise<BigIntStats>
  open(path: string, flags: number, mode: number): Promise<PrivateCapabilityFileHandle>
  realpath(path: string): Promise<string>
  unlink(path: string): Promise<void>
}

export const DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM: PrivateCapabilityFileSystem = {
  lstat: (path, options) => lstat(path, options),
  open: (path, flags, mode) => open(path, flags, mode) as Promise<FileHandle>,
  realpath,
  unlink,
}

export class PrivateCapabilityFileError extends Error {
  override name = "PrivateCapabilityFileError"
}

interface ReviewedTarget {
  review: PrivateCapabilityTargetReview
  root: string
  rootIdentity: BigIntStats
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertPrivateRoot(
  metadata: BigIntStats,
  canonical: string,
  root: string,
  processUserId: number,
): void {
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || canonical !== root
    || metadata.uid !== BigInt(processUserId)
    || (metadata.mode & 0o022n) !== 0n
  ) {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output root must be canonical, owned by the process user, and not group or world writable",
    )
  }
}

function assertTargetPath(file: string): string {
  if (
    typeof file !== "string"
    || !file
    || file.length > INVITE_LIMITS.capabilityPathCharacters
    || file.trim() !== file
    || /[\u0000-\u001F\u007F]/u.test(file)
    || !isAbsolute(file)
    || resolve(file) !== file
  ) {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output must be one exact absolute canonical path",
    )
  }
  return file
}

function assertRoots(roots: readonly string[]): void {
  if (
    !Array.isArray(roots)
    || roots.length < 1
    || roots.some((root) => (
      typeof root !== "string"
      || !isAbsolute(root)
      || resolve(root) !== root
      || root === parse(root).root
    ))
  ) {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output roots are not configured",
    )
  }
}

async function reviewedTarget(
  fileValue: string,
  roots: readonly string[],
  fileSystem: PrivateCapabilityFileSystem,
): Promise<ReviewedTarget> {
  const file = assertTargetPath(fileValue)
  assertRoots(roots)
  const parent = dirname(file)
  const root = roots.find((entry) => entry === parent)
  if (!root) {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output must be a direct child of a configured root",
    )
  }
  if (typeof process.getuid !== "function") {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output ownership cannot be verified on this runtime",
    )
  }
  const processUserId = process.getuid()

  let metadata: BigIntStats
  let canonical: string
  try {
    [metadata, canonical] = await Promise.all([
      fileSystem.lstat(root, { bigint: true }),
      fileSystem.realpath(root),
    ])
  } catch {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output root could not be inspected",
    )
  }
  assertPrivateRoot(metadata, canonical, root, processUserId)

  try {
    await fileSystem.lstat(file, { bigint: true })
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return {
        review: {
          canonicalPath: file,
          directChildOfConfiguredRoot: true,
          exclusiveCreate: true,
          fileMode: "0600",
          rootCanonical: true,
          rootOwnerMatchesProcess: true,
          rootPrivate: true,
          targetAbsent: true,
        },
        root,
        rootIdentity: metadata,
      }
    }
    throw new PrivateCapabilityFileError(
      "Discord invite capability output target could not be inspected",
    )
  }
  throw new PrivateCapabilityFileError(
    "Discord invite capability output target already exists",
  )
}

export async function reviewPrivateCapabilityTarget(
  file: string,
  roots: readonly string[],
  fileSystem: PrivateCapabilityFileSystem = DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM,
): Promise<PrivateCapabilityTargetReview> {
  return (await reviewedTarget(file, roots, fileSystem)).review
}

function assertReservedFile(
  opened: BigIntStats,
  linked: BigIntStats,
  processUserId: number,
): void {
  if (
    !opened.isFile()
    || opened.isSymbolicLink()
    || !linked.isFile()
    || linked.isSymbolicLink()
    || !sameIdentity(opened, linked)
    || opened.nlink !== 1n
    || linked.nlink !== 1n
    || opened.uid !== BigInt(processUserId)
    || linked.uid !== BigInt(processUserId)
    || (opened.mode & CAPABILITY_FILE_PERMISSION_MASK) !== BigInt(CAPABILITY_FILE_MODE)
    || (linked.mode & CAPABILITY_FILE_PERMISSION_MASK) !== BigInt(CAPABILITY_FILE_MODE)
  ) {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output reservation is not one private owned regular file",
    )
  }
}

class Reservation implements PrivateCapabilityFileReservation {
  readonly review: PrivateCapabilityTargetReview
  readonly #file: string
  readonly #fileSystem: PrivateCapabilityFileSystem
  readonly #handle: PrivateCapabilityFileHandle
  readonly #identity: BigIntStats
  readonly #root: string
  readonly #rootIdentity: BigIntStats
  #closed = false
  #written = false

  constructor(options: {
    file: string
    fileSystem: PrivateCapabilityFileSystem
    handle: PrivateCapabilityFileHandle
    identity: BigIntStats
    review: PrivateCapabilityTargetReview
    root: string
    rootIdentity: BigIntStats
  }) {
    this.#file = options.file
    this.#fileSystem = options.fileSystem
    this.#handle = options.handle
    this.#identity = options.identity
    this.#root = options.root
    this.#rootIdentity = options.rootIdentity
    this.review = options.review
  }

  async #close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#handle.close()
  }

  async #unlinkReservedPath(): Promise<boolean> {
    let linked: BigIntStats
    try {
      linked = await this.#fileSystem.lstat(this.#file, { bigint: true })
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return true
      return false
    }
    if (!sameIdentity(this.#identity, linked)) return false
    try {
      await this.#fileSystem.unlink(this.#file)
      return true
    } catch {
      return false
    }
  }

  async discard(): Promise<boolean> {
    if (this.#written) return false
    await this.#close().catch(() => undefined)
    return this.#unlinkReservedPath()
  }

  async #assertLiveReservation(expectedSize: number): Promise<void> {
    if (typeof process.getuid !== "function") {
      throw new PrivateCapabilityFileError(
        "Discord invite capability output ownership cannot be verified on this runtime",
      )
    }
    const [opened, linked, canonical, rootMetadata, rootCanonical] = await Promise.all([
      this.#handle.stat({ bigint: true }),
      this.#fileSystem.lstat(this.#file, { bigint: true }),
      this.#fileSystem.realpath(this.#file),
      this.#fileSystem.lstat(this.#root, { bigint: true }),
      this.#fileSystem.realpath(this.#root),
    ])
    const processUserId = process.getuid()
    assertPrivateRoot(rootMetadata, rootCanonical, this.#root, processUserId)
    assertReservedFile(opened, linked, processUserId)
    if (
      canonical !== this.#file
      || !sameIdentity(this.#identity, opened)
      || !sameIdentity(this.#rootIdentity, rootMetadata)
      || opened.size !== BigInt(expectedSize)
    ) {
      throw new PrivateCapabilityFileError(
        "Discord invite capability output changed while it was written",
      )
    }
  }

  async write(content: string): Promise<void> {
    const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : 0
    if (
      this.#closed
      || this.#written
      || size < 1
      || size > INVITE_LIMITS.capabilityFileBytes
      || !content.endsWith("\n")
      || content.includes("\0")
    ) {
      if (!this.#written) await this.discard()
      throw new PrivateCapabilityFileError(
        "Discord invite capability output content is invalid",
      )
    }
    try {
      await this.#assertLiveReservation(0)
      await this.#handle.writeFile(content, "utf8")
      await this.#handle.sync()
      await this.#assertLiveReservation(size)
      await this.#close()
      this.#written = true
    } catch {
      await this.#close().catch(() => undefined)
      await this.#unlinkReservedPath()
      throw new PrivateCapabilityFileError(
        "Unable to write private Discord invite capability file",
      )
    }
  }
}

export async function reservePrivateCapabilityFile(
  file: string,
  roots: readonly string[],
  fileSystem: PrivateCapabilityFileSystem = DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM,
): Promise<PrivateCapabilityFileReservation> {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new PrivateCapabilityFileError(
      "Discord invite capability output requires no-follow file creation support",
    )
  }
  const target = await reviewedTarget(file, roots, fileSystem)
  let handle: PrivateCapabilityFileHandle | undefined
  let openedIdentity: BigIntStats | undefined
  try {
    handle = await fileSystem.open(
      target.review.canonicalPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      CAPABILITY_FILE_MODE,
    )
    await handle.chmod(CAPABILITY_FILE_MODE)
    const [opened, linked, canonical, rootMetadata, rootCanonical] = await Promise.all([
      handle.stat({ bigint: true }),
      fileSystem.lstat(target.review.canonicalPath, { bigint: true }),
      fileSystem.realpath(target.review.canonicalPath),
      fileSystem.lstat(target.root, { bigint: true }),
      fileSystem.realpath(target.root),
    ])
    openedIdentity = opened
    if (typeof process.getuid !== "function") {
      throw new PrivateCapabilityFileError(
        "Discord invite capability output ownership cannot be verified on this runtime",
      )
    }
    const processUserId = process.getuid()
    assertPrivateRoot(rootMetadata, rootCanonical, target.root, processUserId)
    assertReservedFile(opened, linked, processUserId)
    if (
      canonical !== target.review.canonicalPath
      || !sameIdentity(target.rootIdentity, rootMetadata)
    ) {
      throw new PrivateCapabilityFileError(
        "Discord invite capability output changed while it was reserved",
      )
    }
    return new Reservation({
      file: target.review.canonicalPath,
      fileSystem,
      handle,
      identity: opened,
      review: target.review,
      root: target.root,
      rootIdentity: target.rootIdentity,
    })
  } catch (error) {
    if (handle && !openedIdentity) {
      openedIdentity = await handle.stat({ bigint: true }).catch(() => undefined)
    }
    await handle?.close().catch(() => undefined)
    if (openedIdentity) {
      try {
        const linked = await fileSystem.lstat(target.review.canonicalPath, { bigint: true })
        if (sameIdentity(openedIdentity, linked)) {
          await fileSystem.unlink(target.review.canonicalPath)
        }
      } catch {
        // The reservation cleanup is best effort and never replaces or follows another path
      }
    }
    if (isNodeError(error, "EEXIST")) {
      throw new PrivateCapabilityFileError(
        "Discord invite capability output target already exists",
      )
    }
    if (error instanceof PrivateCapabilityFileError) throw error
    throw new PrivateCapabilityFileError(
      "Unable to reserve private Discord invite capability file",
    )
  }
}
