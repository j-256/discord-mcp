import { createHmac } from "node:crypto"
import { constants } from "node:fs"
import type { BigIntStats } from "node:fs"
import {
  lstat,
  open,
  realpath,
} from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path"

export interface OwnedLocalFileReview {
  canonicalPath: string
  containedByConfiguredRoot: true
  ownerMatchesProcess: true
  regularFile: true
  singleLink: true
  sizeBytes: number
  stableRead: true
}

export interface OwnedLocalFileSnapshot {
  binding: {
    ctimeNanoseconds: string
    device: string
    inode: string
    mode: string
    modifiedNanoseconds: string
    owner: string
    sizeBytes: string
  }
  bytes: Uint8Array
  contentDigest: string
  review: OwnedLocalFileReview
}

export interface ReadOwnedLocalFileOptions {
  description: string
  digestDomain: string
  filePath: string
  maxBytes: number
  planKey: Uint8Array
  roots: readonly string[]
}

export class OwnedLocalFileError extends Error {
  override name = "OwnedLocalFileError"
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function insideRoot(path: string, root: string): boolean {
  const child = relative(root, path)
  return child.length > 0
    && !isAbsolute(child)
    && child !== ".."
    && !child.startsWith(`..${sep}`)
}

function sameIdentity(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameStableMetadata(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.ctimeNs === right.ctimeNs
    && left.mtimeNs === right.mtimeNs
}

function assertOwnedRegularFile(
  metadata: BigIntStats,
  maxBytes: number,
  description: string,
): void {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new OwnedLocalFileError(`${description} path must name a regular file`)
  }
  if (metadata.nlink !== 1n) {
    throw new OwnedLocalFileError(`${description} file must have exactly one hard link`)
  }
  if (typeof process.getuid !== "function") {
    throw new OwnedLocalFileError(
      `${description} file ownership cannot be verified on this runtime`,
    )
  }
  if (metadata.uid !== BigInt(process.getuid())) {
    throw new OwnedLocalFileError(`${description} file must be owned by the connector user`)
  }
  if (metadata.size < 1n || metadata.size > BigInt(maxBytes)) {
    throw new OwnedLocalFileError(
      `${description} file must contain between 1 and ${maxBytes} bytes`,
    )
  }
}

function byteDigest(
  digestDomain: string,
  planKey: Uint8Array,
  bytes: Uint8Array,
): string {
  return `hmac-sha256:${createHmac("sha256", planKey)
    .update(`${digestDomain}\0`)
    .update(bytes)
    .digest("hex")}`
}

async function readBoundedBytes(
  handle: FileHandle,
  expectedBytes: number,
  description: string,
): Promise<Uint8Array> {
  const buffer = Buffer.allocUnsafe(expectedBytes + 1)
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    )
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset !== expectedBytes) {
    throw new OwnedLocalFileError(`${description} file changed while it was read`)
  }
  return new Uint8Array(buffer.subarray(0, expectedBytes))
}

export async function readOwnedLocalFileSnapshot(
  options: ReadOwnedLocalFileOptions,
): Promise<OwnedLocalFileSnapshot> {
  if (
    typeof options.description !== "string"
    || !options.description
    || typeof options.digestDomain !== "string"
    || !/^[a-z0-9.-]+$/u.test(options.digestDomain)
  ) {
    throw new RangeError("Owned local-file context is invalid")
  }
  if (
    typeof options.filePath !== "string"
    || !options.filePath
    || options.filePath.trim() !== options.filePath
    || options.filePath.includes("\0")
    || !isAbsolute(options.filePath)
  ) {
    throw new RangeError(`${options.description} path must be one exact absolute path`)
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new RangeError(`${options.description} byte limit must be a positive safe integer`)
  }
  if (options.roots.length < 1 || options.roots.some((root) => !isAbsolute(root))) {
    throw new OwnedLocalFileError(`${options.description} roots are not configured`)
  }

  const lexicalPath = resolve(options.filePath)
  if (lexicalPath !== options.filePath) {
    throw new OwnedLocalFileError(`${options.description} path must already be canonical`)
  }
  let canonicalPath: string
  let beforePath
  try {
    canonicalPath = await realpath(options.filePath)
    beforePath = await lstat(options.filePath, { bigint: true })
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new OwnedLocalFileError(`${options.description} path does not exist`, { cause: error })
    }
    throw new OwnedLocalFileError(`Unable to inspect ${options.description.toLowerCase()} path`, {
      cause: error,
    })
  }
  if (canonicalPath !== lexicalPath) {
    throw new OwnedLocalFileError(`${options.description} path must not contain symbolic links`)
  }
  if (!options.roots.some((root) => insideRoot(canonicalPath, root))) {
    throw new OwnedLocalFileError(`${options.description} path is outside configured roots`)
  }
  assertOwnedRegularFile(beforePath, options.maxBytes, options.description)

  let handle
  try {
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
    handle = await open(canonicalPath, constants.O_RDONLY | noFollow)
    const beforeRead = await handle.stat({ bigint: true })
    assertOwnedRegularFile(beforeRead, options.maxBytes, options.description)
    if (!sameIdentity(beforePath, beforeRead)) {
      throw new OwnedLocalFileError(`${options.description} path changed while it was opened`)
    }
    const bytes = await readBoundedBytes(handle, Number(beforeRead.size), options.description)
    const afterRead = await handle.stat({ bigint: true })
    if (
      bytes.byteLength !== Number(beforeRead.size)
      || !sameStableMetadata(beforeRead, afterRead)
    ) {
      throw new OwnedLocalFileError(`${options.description} file changed while it was read`)
    }

    const [afterPath, finalPath] = await Promise.all([
      lstat(canonicalPath, { bigint: true }),
      realpath(canonicalPath),
    ])
    if (
      finalPath !== canonicalPath
      || !sameStableMetadata(afterRead, afterPath)
    ) {
      throw new OwnedLocalFileError(`${options.description} path changed while it was read`)
    }

    return {
      binding: {
        ctimeNanoseconds: afterRead.ctimeNs.toString(),
        device: afterRead.dev.toString(),
        inode: afterRead.ino.toString(),
        mode: afterRead.mode.toString(),
        modifiedNanoseconds: afterRead.mtimeNs.toString(),
        owner: afterRead.uid.toString(),
        sizeBytes: afterRead.size.toString(),
      },
      bytes: new Uint8Array(bytes),
      contentDigest: byteDigest(options.digestDomain, options.planKey, bytes),
      review: {
        canonicalPath,
        containedByConfiguredRoot: true,
        ownerMatchesProcess: true,
        regularFile: true,
        singleLink: true,
        sizeBytes: bytes.byteLength,
        stableRead: true,
      },
    }
  } catch (error) {
    if (error instanceof OwnedLocalFileError) throw error
    if (isNodeError(error, "ELOOP")) {
      throw new OwnedLocalFileError(`${options.description} path must not be a symbolic link`, {
        cause: error,
      })
    }
    throw new OwnedLocalFileError(`Unable to read ${options.description.toLowerCase()} file`, {
      cause: error,
    })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
