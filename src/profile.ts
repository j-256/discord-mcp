import { randomUUID } from "node:crypto"
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises"
import { homedir } from "node:os"
import {
  basename,
  isAbsolute,
  join,
  resolve,
} from "node:path"

import {
  CONNECTOR_LIMITS,
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import {
  loadConnectorConfigDocument,
  type ConnectorConfig,
} from "./config.js"
import {
  createConnectorConfigDocument,
  parseConnectorConfigDocument,
  parseStrictConfigJson,
  type ConnectorConfigDocument,
  type ConnectorConfigDocumentObservability,
} from "./config-document.js"
import {
  ConfigDocumentError,
  ProfileError,
} from "./errors.js"

const PROFILE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/
const TRASH_FILE_PATTERN = /^[0-9]{13}-[0-9a-f-]{36}\.json$/

export type ConnectorProfile = ConnectorConfigDocument

export interface ProfileLocationOptions {
  directory?: string
  environment?: NodeJS.ProcessEnv
  homeDirectory?: string
  platform?: NodeJS.Platform
}

export interface SaveProfileOptions extends ProfileLocationOptions {
  overwrite?: boolean
}

export interface ActivatedProfile {
  config: ConnectorConfig
  profile: ConnectorProfile
}

export interface TrashedProfile {
  name: string
  trashId: string
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function normalizeProfileName(value: string): string {
  if (typeof value !== "string") throw new ProfileError("Profile name must be a string")
  const normalized = value.trim()
  if (
    !PROFILE_NAME_PATTERN.test(normalized)
    || WINDOWS_DEVICE_NAME_PATTERN.test(normalized)
  ) {
    throw new ProfileError(
      "Profile name must be a bounded lowercase filename-safe identifier",
    )
  }
  return normalized
}

export function parseConnectorProfile(
  value: unknown,
  expectedName?: string,
): ConnectorProfile {
  if (!isRecord(value)) throw new ProfileError("Profile must be a JSON object")
  try {
    const profile = parseConnectorConfigDocument(value, expectedName)
    if (profile.readScope.guildMode !== "allowlist") {
      throw new ProfileError("Profiles require an exact guild read allowlist")
    }
    return profile
  } catch (error) {
    if (error instanceof ConfigDocumentError) {
      throw new ProfileError(error.message.replace("Configuration", "Profile"), {
        cause: error,
      })
    }
    throw error
  }
}

export function createConnectorProfile(options: {
  applicationId: string
  botId: string
  capabilities?: Readonly<Record<string, boolean>>
  channelIds?: readonly string[]
  credentialFile?: string
  credentialVariable?: string
  gatewayEnabled?: boolean
  gatewayEventBufferSize?: number
  guildIds: readonly string[]
  limits?: Readonly<Record<string, number>>
  name: string
  observability?: ConnectorConfigDocumentObservability
  runtime?: Readonly<Record<string, string>>
  scopes?: Readonly<Record<string, readonly string[]>>
  storage?: Readonly<Record<string, string | readonly string[]>>
  toolsets: readonly McpToolsetName[]
  toolSurface: McpToolSurface
}): ConnectorProfile {
  return parseConnectorProfile(createConnectorConfigDocument(options))
}

export function resolveProfileDirectory(
  options: ProfileLocationOptions = {},
): string {
  if (options.directory !== undefined) {
    const directory = options.directory.trim()
    if (!directory || directory.includes("\0") || !isAbsolute(directory)) {
      throw new ProfileError("Profile directory override must be an absolute path")
    }
    return resolve(directory)
  }
  const environment = options.environment || process.env
  const platform = options.platform || process.platform
  const homeDirectory = options.homeDirectory || homedir()
  let root: string
  if (platform === "win32") {
    root = environment.APPDATA?.trim() || join(homeDirectory, "AppData", "Roaming")
  } else if (platform === "darwin") {
    root = join(homeDirectory, "Library", "Application Support")
  } else {
    const configured = environment.XDG_CONFIG_HOME?.trim()
    root = configured && isAbsolute(configured)
      ? configured
      : join(homeDirectory, ".config")
  }
  return resolve(root, "guildcontrol", "profiles")
}

export function profilePath(
  name: string,
  options: ProfileLocationOptions = {},
): string {
  return join(resolveProfileDirectory(options), `${normalizeProfileName(name)}.json`)
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return
  let handle
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    throw new ProfileError("Unable to sync profile storage", { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertPrivateDirectory(
  directory: string,
  create: boolean,
): Promise<boolean> {
  if (create) {
    try {
      await mkdir(directory, { mode: 0o700, recursive: true })
    } catch (error) {
      throw new ProfileError("Unable to create profile directory", { cause: error })
    }
  }
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (!create && isNodeError(error, "ENOENT")) return false
    throw new ProfileError("Unable to inspect profile directory", { cause: error })
  }
  let canonical: string
  try {
    canonical = await realpath(directory)
  } catch (error) {
    throw new ProfileError("Unable to resolve profile directory", { cause: error })
  }
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || resolve(canonical) !== resolve(directory)
    || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new ProfileError("Profile directory is not private and canonical")
  }
  return true
}

async function readProfileFile(
  file: string,
  expectedName: string,
): Promise<ConnectorProfile> {
  let metadata
  try {
    metadata = await lstat(file)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new ProfileError(`Profile not found: ${expectedName}`)
    }
    throw new ProfileError("Unable to inspect profile file", { cause: error })
  }
  let canonical: string
  try {
    canonical = await realpath(file)
  } catch (error) {
    throw new ProfileError("Unable to resolve profile file", { cause: error })
  }
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.nlink !== 1
    || metadata.size < 3
    || metadata.size > CONNECTOR_LIMITS.configBytes
    || resolve(canonical) !== resolve(file)
    || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new ProfileError("Profile is not a private canonical regular file")
  }
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    throw new ProfileError("Unable to read profile file", { cause: error })
  }
  if (!text.endsWith("\n") || text.includes("\0")) {
    throw new ProfileError("Profile must contain one complete JSON document")
  }
  try {
    return parseConnectorProfile(parseStrictConfigJson(text), expectedName)
  } catch (error) {
    if (error instanceof ProfileError) throw error
    if (error instanceof ConfigDocumentError) {
      throw new ProfileError(error.message.replace("Configuration file", "Profile"), {
        cause: error,
      })
    }
    throw new ProfileError("Profile is not valid JSON", { cause: error })
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw new ProfileError("Unable to inspect profile path", { cause: error })
  }
}

export async function loadProfile(
  name: string,
  options: ProfileLocationOptions = {},
): Promise<ConnectorProfile> {
  const normalizedName = normalizeProfileName(name)
  const directory = resolveProfileDirectory(options)
  if (!await assertPrivateDirectory(directory, false)) {
    throw new ProfileError(`Profile not found: ${normalizedName}`)
  }
  return readProfileFile(join(directory, `${normalizedName}.json`), normalizedName)
}

export async function listProfiles(
  options: ProfileLocationOptions = {},
): Promise<ConnectorProfile[]> {
  const directory = resolveProfileDirectory(options)
  if (!await assertPrivateDirectory(directory, false)) return []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    throw new ProfileError("Unable to list profile directory", { cause: error })
  }
  const names = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".json"))
    .map((entry) => normalizeProfileName(basename(entry.name, ".json")))
    .sort()
  return Promise.all(names.map((name) => readProfileFile(
    join(directory, `${name}.json`),
    name,
  )))
}

async function withProfileLock<T>(
  directory: string,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = join(directory, `.${name}.lock`)
  let handle
  try {
    handle = await open(lock, "wx", 0o600)
    await handle.sync()
    await syncDirectory(directory)
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined)
      await unlink(lock).catch(() => undefined)
      await syncDirectory(directory).catch(() => undefined)
    }
    if (isNodeError(error, "EEXIST")) {
      throw new ProfileError(`Profile ${name} is locked by another operation`)
    }
    throw new ProfileError("Unable to lock profile", { cause: error })
  }

  let completed = false
  let operationError: unknown
  let result: T | undefined
  try {
    result = await operation()
    completed = true
  } catch (error) {
    operationError = error
  }

  const cleanupErrors: unknown[] = []
  await handle.close().catch((error: unknown) => cleanupErrors.push(error))
  await unlink(lock).catch((error: unknown) => cleanupErrors.push(error))
  await syncDirectory(directory).catch((error: unknown) => cleanupErrors.push(error))
  if (cleanupErrors.length > 0) {
    const cleanupError = cleanupErrors.length === 1
      ? cleanupErrors[0]
      : new AggregateError(cleanupErrors, "Multiple profile lock cleanup operations failed")
    if (!completed) {
      throw new ProfileError("Profile operation and lock cleanup failed", {
        cause: new AggregateError(
          [operationError, cleanupError],
          "Profile operation and lock cleanup failed",
        ),
      })
    }
    throw new ProfileError("Profile operation completed but lock cleanup failed", {
      cause: cleanupError,
    })
  }
  if (!completed) throw operationError
  return result as T
}

async function writeTemporaryProfile(
  directory: string,
  profile: ConnectorProfile,
): Promise<string> {
  const temporary = join(directory, `.${profile.name}.${randomUUID()}.tmp`)
  let handle
  const errors: unknown[] = []
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(profile, null, 2)}\n`, "utf8")
    await handle.sync()
  } catch (error) {
    errors.push(error)
  }
  await handle?.close().catch((error: unknown) => errors.push(error))
  if (errors.length > 0) {
    if (handle) await unlink(temporary).catch(() => undefined)
    throw new ProfileError("Unable to write private profile", {
      cause: errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Multiple private profile writes failed"),
    })
  }
  return temporary
}

async function removeTemporaryProfile(file: string): Promise<void> {
  try {
    await unlink(file)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return
    throw new ProfileError("Unable to remove temporary profile", { cause: error })
  }
}

export async function saveProfile(
  profile: ConnectorProfile,
  options: SaveProfileOptions = {},
): Promise<ConnectorProfile> {
  const normalized = parseConnectorProfile(profile)
  const directory = resolveProfileDirectory(options)
  await assertPrivateDirectory(directory, true)
  return withProfileLock(directory, normalized.name, async () => {
    const target = join(directory, `${normalized.name}.json`)
    const exists = await pathExists(target)
    if (exists) {
      const current = await readProfileFile(target, normalized.name)
      if (!options.overwrite) {
        throw new ProfileError(`Profile ${normalized.name} already exists`)
      }
      if (
        current.identity.applicationId !== normalized.identity.applicationId
        || current.identity.botId !== normalized.identity.botId
      ) {
        throw new ProfileError(
          `Profile ${normalized.name} is locked to its verified Discord identity`,
        )
      }
    }
    const temporary = await writeTemporaryProfile(directory, normalized)
    try {
      if (exists) {
        await rename(temporary, target)
      } else {
        let linked = false
        try {
          await link(temporary, target)
          linked = true
          await unlink(temporary)
        } catch (error) {
          if (!linked && isNodeError(error, "EEXIST")) {
            throw new ProfileError(
              `Profile ${normalized.name} was created by another operation`,
            )
          }
          if (linked) {
            try {
              await unlink(target)
            } catch (rollbackError) {
              throw new ProfileError("Unable to roll back partial profile publication", {
                cause: new AggregateError(
                  [error, rollbackError],
                  "Profile publication and rollback failed",
                ),
              })
            }
          }
          throw error
        }
      }
      await syncDirectory(directory)
    } catch (error) {
      try {
        await removeTemporaryProfile(temporary)
      } catch (cleanupError) {
        throw new ProfileError("Unable to publish or clean up profile", {
          cause: new AggregateError(
            [error, cleanupError],
            "Profile publication and cleanup failed",
          ),
        })
      }
      if (error instanceof ProfileError) throw error
      throw new ProfileError("Unable to publish profile", { cause: error })
    }
    return normalized
  })
}

function profileTrashDirectory(directory: string, name: string): string {
  return join(directory, ".trash", normalizeProfileName(name))
}

async function nextTrashId(directory: string): Promise<string> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    throw new ProfileError("Unable to list profile trash", { cause: error })
  }
  const latestTimestamp = entries
    .filter((entry) => entry.isFile() && TRASH_FILE_PATTERN.test(entry.name))
    .map((entry) => Number(entry.name.slice(0, 13)))
    .reduce((latest, timestamp) => Math.max(latest, timestamp), 0)
  const timestamp = Math.max(Date.now(), latestTimestamp + 1)
  return `${String(timestamp).padStart(13, "0")}-${randomUUID()}`
}

export async function trashProfile(
  name: string,
  options: ProfileLocationOptions = {},
): Promise<TrashedProfile> {
  const normalizedName = normalizeProfileName(name)
  const directory = resolveProfileDirectory(options)
  if (!await assertPrivateDirectory(directory, false)) {
    throw new ProfileError(`Profile not found: ${normalizedName}`)
  }
  return withProfileLock(directory, normalizedName, async () => {
    const source = join(directory, `${normalizedName}.json`)
    await readProfileFile(source, normalizedName)
    const trashDirectory = profileTrashDirectory(directory, normalizedName)
    await assertPrivateDirectory(trashDirectory, true)
    const trashId = await nextTrashId(trashDirectory)
    try {
      await rename(source, join(trashDirectory, `${trashId}.json`))
    } catch (error) {
      throw new ProfileError("Unable to move profile into recoverable trash", {
        cause: error,
      })
    }
    await Promise.all([
      syncDirectory(directory),
      syncDirectory(trashDirectory),
    ])
    return { name: normalizedName, trashId }
  })
}

export async function restoreProfile(
  name: string,
  options: ProfileLocationOptions = {},
): Promise<TrashedProfile> {
  const normalizedName = normalizeProfileName(name)
  const directory = resolveProfileDirectory(options)
  if (!await assertPrivateDirectory(directory, false)) {
    throw new ProfileError(`No trashed profile found: ${normalizedName}`)
  }
  return withProfileLock(directory, normalizedName, async () => {
    const target = join(directory, `${normalizedName}.json`)
    if (await pathExists(target)) {
      throw new ProfileError(`Profile ${normalizedName} already exists`)
    }
    const trashDirectory = profileTrashDirectory(directory, normalizedName)
    if (!await assertPrivateDirectory(trashDirectory, false)) {
      throw new ProfileError(`No trashed profile found: ${normalizedName}`)
    }
    let entries
    try {
      entries = await readdir(trashDirectory, { withFileTypes: true })
    } catch (error) {
      throw new ProfileError("Unable to list profile trash", { cause: error })
    }
    const candidate = entries
      .filter((entry) => entry.isFile() && TRASH_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .at(-1)
    if (!candidate) {
      throw new ProfileError(`No trashed profile found: ${normalizedName}`)
    }
    const source = join(trashDirectory, candidate)
    await readProfileFile(source, normalizedName)
    try {
      await link(source, target)
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        throw new ProfileError(`Profile ${normalizedName} already exists`)
      }
      throw new ProfileError("Unable to restore profile", { cause: error })
    }
    try {
      await unlink(source)
    } catch (error) {
      try {
        await unlink(target)
      } catch (rollbackError) {
        throw new ProfileError("Unable to complete or roll back profile restore", {
          cause: new AggregateError(
            [error, rollbackError],
            "Profile restore and rollback failed",
          ),
        })
      }
      throw new ProfileError("Unable to complete profile restore", { cause: error })
    }
    await Promise.all([
      syncDirectory(directory),
      syncDirectory(trashDirectory),
    ])
    return {
      name: normalizedName,
      trashId: basename(candidate, ".json"),
    }
  })
}

export async function activateProfile(
  name: string,
  options: ProfileLocationOptions & {
    environment?: NodeJS.ProcessEnv
  } = {},
): Promise<ActivatedProfile> {
  const profile = await loadProfile(name, options)
  const source = options.environment || process.env
  if (source[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()) {
    throw new ProfileError(
      `Profile ${profile.name} conflicts with ${CONFIG_FILE_ENVIRONMENT_VARIABLE}`,
    )
  }
  return {
    config: loadConnectorConfigDocument(profile, source),
    profile,
  }
}
