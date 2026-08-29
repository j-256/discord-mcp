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
import { dirname, resolve } from "node:path"
import { TextDecoder } from "node:util"

import { parseStrictConfigJson } from "./config-document.js"
import { ConfigurationError } from "./errors.js"

export const HOST_JSON_MIN_BYTES = 2
export const HOST_JSON_MAX_BYTES = 1_048_576
export const HOST_JSON_MAX_NODES = 100_000

const EXPOSED_FILE_MODE_MASK = 0o077n
const WRITABLE_DIRECTORY_MODE_MASK = 0o022n
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })

export interface HostDirectoryBinding {
  readonly device: string
  readonly group: string
  readonly inode: string
  readonly mode: string
  readonly owner: string
}

export interface HostFileBinding {
  readonly changedNanoseconds: string
  readonly device: string
  readonly group: string
  readonly inode: string
  readonly links: string
  readonly mode: string
  readonly modifiedNanoseconds: string
  readonly owner: string
  readonly sizeBytes: string
}

export interface HostFileReview {
  readonly access: "owner-private" | "platform-unverified"
  readonly bounded: true
  readonly canonical: true
  readonly owner: "platform-unverified" | "trusted"
  readonly regularFile: true
  readonly singleLink: true
  readonly stableRead: true
}

export interface HostJsonPresentSnapshot {
  readonly binding: {
    readonly directory: HostDirectoryBinding
    readonly file: HostFileBinding
    readonly state: "present"
  }
  readonly bytes: Buffer
  readonly document: unknown
  readonly fileReview: HostFileReview
  readonly state: "present"
  readonly target: string
}

export interface HostJsonAbsentSnapshot {
  readonly binding: {
    readonly directory: HostDirectoryBinding
    readonly state: "absent"
  }
  readonly state: "absent"
  readonly target: string
}

export type HostJsonSnapshot = HostJsonAbsentSnapshot | HostJsonPresentSnapshot

export interface HostJsonTargetContext {
  readonly binding: HostDirectoryBinding
  readonly directory: string
  readonly target: string
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

function directoryBinding(metadata: BigIntStats): HostDirectoryBinding {
  return Object.freeze({
    device: metadata.dev.toString(),
    group: metadata.gid.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    owner: metadata.uid.toString(),
  })
}

function fileBinding(metadata: BigIntStats): HostFileBinding {
  return Object.freeze({
    changedNanoseconds: metadata.ctimeNs.toString(),
    device: metadata.dev.toString(),
    group: metadata.gid.toString(),
    inode: metadata.ino.toString(),
    links: metadata.nlink.toString(),
    mode: metadata.mode.toString(),
    modifiedNanoseconds: metadata.mtimeNs.toString(),
    owner: metadata.uid.toString(),
    sizeBytes: metadata.size.toString(),
  })
}

function assertSafeDirectory(directory: string): HostDirectoryBinding {
  let metadata: BigIntStats
  try {
    metadata = lstatSync(directory, { bigint: true })
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new ConfigurationError("Host configuration directory was not found")
    }
    throw new ConfigurationError("Unable to inspect host configuration directory")
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ConfigurationError("Host configuration parent must be one directory")
  }
  try {
    if (realpathSync.native(directory) !== directory) {
      throw new ConfigurationError(
        "Host configuration directory path must be canonical and contain no symbolic links",
      )
    }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error
    throw new ConfigurationError("Unable to resolve host configuration directory")
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid !== "function" || metadata.uid !== BigInt(process.getuid())) {
      throw new ConfigurationError("Host configuration directory must be owned by the process user")
    }
    if ((metadata.mode & WRITABLE_DIRECTORY_MODE_MASK) !== 0n) {
      throw new ConfigurationError(
        "Host configuration directory must not be group or world writable",
      )
    }
  }
  return directoryBinding(metadata)
}

function assertSafeHostFile(metadata: BigIntStats): void {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ConfigurationError("Host configuration must be one regular file")
  }
  if (metadata.nlink !== 1n) {
    throw new ConfigurationError("Host configuration must have exactly one hard link")
  }
  if (
    metadata.size < BigInt(HOST_JSON_MIN_BYTES)
    || metadata.size > BigInt(HOST_JSON_MAX_BYTES)
  ) {
    throw new ConfigurationError("Host configuration exceeds the bounded JSON file size")
  }
  if (process.platform !== "win32") {
    const userId = typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined
    if (userId === undefined || ![0n, userId].includes(metadata.uid)) {
      throw new ConfigurationError("Host configuration owner is not trusted")
    }
    if ((metadata.mode & EXPOSED_FILE_MODE_MASK) !== 0n) {
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

function assertSafelyRepresentableJson(document: unknown): void {
  const pending: unknown[] = [document]
  let nodes = 0
  while (pending.length > 0) {
    const value = pending.pop()
    nodes += 1
    if (nodes > HOST_JSON_MAX_NODES) {
      throw new ConfigurationError("Host configuration exceeds the bounded JSON structure")
    }
    if (typeof value === "number") {
      if (
        !Number.isFinite(value)
        || (Number.isInteger(value) && !Number.isSafeInteger(value))
        || Object.is(value, -0)
      ) {
        throw new ConfigurationError(
          "Host configuration contains a number that cannot be safely rewritten",
        )
      }
    } else if (Array.isArray(value)) {
      if (value.length > HOST_JSON_MAX_NODES - nodes - pending.length) {
        throw new ConfigurationError("Host configuration exceeds the bounded JSON structure")
      }
      for (const child of value) pending.push(child)
    } else if (value !== null && typeof value === "object") {
      const children = Object.values(value)
      if (children.length > HOST_JSON_MAX_NODES - nodes - pending.length) {
        throw new ConfigurationError("Host configuration exceeds the bounded JSON structure")
      }
      for (const child of children) pending.push(child)
    }
  }
}

function parseHostConfiguration(bytes: Buffer): unknown {
  if (bytes.includes(0) || bytes.byteLength > HOST_JSON_MAX_BYTES) {
    throw new ConfigurationError("Host configuration is not valid bounded JSON")
  }
  let document: unknown
  try {
    const text = STRICT_UTF8_DECODER.decode(bytes)
    document = parseStrictConfigJson(text.endsWith("\n") ? text : `${text}\n`)
  } catch {
    throw new ConfigurationError("Host configuration is not valid strict JSON")
  }
  assertSafelyRepresentableJson(document)
  return document
}

export function resolveHostJsonTarget(file: string): string {
  if (typeof file !== "string" || !file.trim() || file.includes("\0")) {
    throw new ConfigurationError("Host configuration requires a valid explicit file path")
  }
  return resolve(file)
}

export function inspectHostJsonTarget(file: string): HostJsonTargetContext {
  const target = resolveHostJsonTarget(file)
  const directory = dirname(target)
  return Object.freeze({
    binding: assertSafeDirectory(directory),
    directory,
    target,
  })
}

export function readHostJsonSnapshot(
  file: string,
  options: { readonly allowAbsent?: boolean } = {},
): HostJsonSnapshot {
  const context = inspectHostJsonTarget(file)
  const target = context.target
  const parentBinding = context.binding
  let beforePath: BigIntStats
  try {
    beforePath = lstatSync(target, { bigint: true })
  } catch (error) {
    if (isNodeError(error, "ENOENT") && options.allowAbsent === true) {
      return Object.freeze({
        binding: Object.freeze({
          directory: parentBinding,
          state: "absent" as const,
        }),
        state: "absent" as const,
        target,
      })
    }
    if (isNodeError(error, "ENOENT")) {
      throw new ConfigurationError("Host configuration file was not found")
    }
    throw new ConfigurationError("Unable to inspect host configuration file")
  }

  let bytes: Buffer | undefined
  let fileDescriptor: number | undefined
  try {
    if (realpathSync.native(target) !== target || beforePath.isSymbolicLink()) {
      throw new ConfigurationError("Host configuration path must not contain symbolic links")
    }
    assertSafeHostFile(beforePath)
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    fileDescriptor = openSync(target, fsConstants.O_RDONLY | noFollow)
    const beforeRead = fstatSync(fileDescriptor, { bigint: true })
    assertSafeHostFile(beforeRead)
    if (beforePath.dev !== beforeRead.dev || beforePath.ino !== beforeRead.ino) {
      throw new ConfigurationError("Host configuration changed while it was opened")
    }
    bytes = readExactBytes(fileDescriptor, Number(beforeRead.size))
    const document = parseHostConfiguration(bytes)
    const afterRead = fstatSync(fileDescriptor, { bigint: true })
    const afterPath = lstatSync(target, { bigint: true })
    if (
      realpathSync.native(target) !== target
      || !sameFile(beforeRead, afterRead)
      || !sameFile(afterRead, afterPath)
    ) {
      throw new ConfigurationError("Host configuration changed while it was read")
    }
    return Object.freeze({
      binding: Object.freeze({
        directory: parentBinding,
        file: fileBinding(afterRead),
        state: "present" as const,
      }),
      bytes,
      document,
      fileReview: Object.freeze({
        access: process.platform === "win32" ? "platform-unverified" : "owner-private",
        bounded: true as const,
        canonical: true as const,
        owner: process.platform === "win32" ? "platform-unverified" : "trusted",
        regularFile: true as const,
        singleLink: true as const,
        stableRead: true as const,
      }),
      state: "present" as const,
      target,
    })
  } catch (error) {
    bytes?.fill(0)
    if (error instanceof ConfigurationError) throw error
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
