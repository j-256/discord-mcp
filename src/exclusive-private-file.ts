import { open, unlink } from "node:fs/promises"
import { resolve } from "node:path"

import { ConfigurationError } from "./errors.js"

export interface ExclusivePrivateFileHandle {
  close(): Promise<void>
  sync(): Promise<void>
  writeFile(data: string, encoding: BufferEncoding): Promise<void>
}

export interface ExclusivePrivateFileSystem {
  open(
    file: string,
    flags: "wx",
    mode: number,
  ): Promise<ExclusivePrivateFileHandle>
  unlink(file: string): Promise<void>
}

export interface ExclusivePrivateFileMessages {
  exists: string
  failure: string
  invalidPath: string
}

export const DEFAULT_EXCLUSIVE_PRIVATE_FILE_SYSTEM: ExclusivePrivateFileSystem = {
  open: (file, flags, mode) => open(file, flags, mode),
  unlink,
}

export function resolveExclusivePrivateFile(
  file: string,
  messages: ExclusivePrivateFileMessages,
): string {
  if (!file.trim() || file.includes("\0")) {
    throw new ConfigurationError(messages.invalidPath)
  }
  return resolve(file)
}

export async function writeExclusivePrivateFile(
  file: string,
  content: string,
  messages: ExclusivePrivateFileMessages,
  fileSystem: ExclusivePrivateFileSystem = DEFAULT_EXCLUSIVE_PRIVATE_FILE_SYSTEM,
): Promise<void> {
  let created = false
  let handle: ExclusivePrivateFileHandle | undefined
  let closed = false
  try {
    handle = await fileSystem.open(file, "wx", 0o600)
    created = true
    await handle.writeFile(content, "utf8")
    await handle.sync()
    await handle.close()
    closed = true
  } catch (error) {
    if (handle && !closed) await handle.close().catch(() => undefined)
    if (created) await fileSystem.unlink(file).catch(() => undefined)
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ConfigurationError(messages.exists)
    }
    throw new ConfigurationError(messages.failure, { cause: error })
  }
}
