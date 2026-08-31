import { randomUUID } from "node:crypto"
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises"
import {
  basename,
  dirname,
  resolve,
} from "node:path"

import { loadConnectorConfigDocument } from "./config.js"
import {
  CONFIG_DOCUMENT_SCHEMA_ID,
  CONFIG_SCOPE_GROUP_TYPES,
  connectorConfigFields,
  connectorConfigJsonSchema,
  connectorConfigSecretEnvironmentNames,
  connectorConfigSecretFilePaths,
  createConnectorConfigDocument,
  expandedConnectorReadScope,
  expandedConnectorScope,
  inspectConnectorConfigDocumentFile,
  parseConnectorConfigDocument,
  type ConfigDocumentField,
  type ConnectorCredentialReference,
  type ConnectorConfigDocument,
} from "./config-document.js"
import { appendConfigRecipeDependencyGuidance } from "./config-recipe-guidance.js"
import { DEFAULT_TOKEN_ENVIRONMENT_VARIABLE } from "./constants.js"
import { ConfigDocumentError, ConfigurationError } from "./errors.js"
import { stableString } from "./normalize.js"
import { getSetupPreset } from "./setup-presets.js"

export const CONFIG_OPERATOR_REPORT_SCHEMA_VERSION = 6

const FILE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export interface ConnectorConfigSummary {
  capabilitiesEnabled: readonly string[]
  configSchemaVersion: number
  credential: ConnectorCredentialReference
  gateway: {
    enabled: boolean
    eventBufferSize: number
  }
  identity: {
    applicationId: string
    botId: string
  }
  limitsConfigured: readonly string[]
  name: string
  notifications: {
    userMentions: ConnectorConfigDocument["notifications"]["userMentions"]
  }
  readScope: {
    channelEntries?: readonly string[]
    channelMode: ConnectorConfigDocument["readScope"]["channelMode"]
    channelIds: readonly string[]
    guildEntries?: readonly string[]
    guildMode: ConnectorConfigDocument["readScope"]["guildMode"]
    guildIds: readonly string[]
  }
  groupsConfigured: readonly {
    exactIdCount: number
    groupCount: number
    type: string
  }[]
  runtimeConfigured: readonly string[]
  secretEnvironmentVariables: readonly string[]
  secretFilePaths: readonly string[]
  scopesConfigured: readonly {
    authoredCount: number
    count: number
    name: string
  }[]
  storageConfigured: readonly string[]
  tools: {
    surface: string
    toolsets: readonly string[]
  }
  threads: {
    messageWrites: ConnectorConfigDocument["threads"]["messageWrites"]
    reads: ConnectorConfigDocument["threads"]["reads"]
  }
}

export interface ConfigValidationReport {
  file: string
  schemaVersion: number
  status: "ok"
  summary: ConnectorConfigSummary
  targetFile: string
  validation: {
    crossFieldPolicy: true
    discordContacted: false
    secretValuesRead: false
  }
}

export interface ConfigShowReport extends ConfigValidationReport {
  document: ConnectorConfigDocument
}

export interface ConfigExplainEntry extends ConfigDocumentField {
  schema: unknown
}

export interface ConfigExplainReport {
  fields: readonly ConfigExplainEntry[]
  query: string
  schemaId: string
  schemaVersion: number
  status: "ok"
}

export interface ConfigWriteReport extends ConfigShowReport {
  action: "init"
  backupFile?: string
  created: boolean
  source: "new"
}

export interface ConfigWriteOptions {
  expectedCurrent?: ConnectorConfigDocument
  expectedTargetFile?: string
  overwrite?: boolean
}

export interface ConfigInitOptions extends ConfigWriteOptions {
  applicationId: string
  botId: string
  channelIds?: readonly string[]
  credentialFile?: string
  credentialVariable?: string
  file: string
  guildIds: readonly string[]
  name: string
  preset?: string
}

export interface ConfigWriteOutcome {
  backupFile?: string
  created: boolean
  document: ConnectorConfigDocument
  file: string
  targetFile: string
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

export function resolveConnectorConfigFile(file: string): string {
  const normalized = file.trim()
  if (!normalized || FILE_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new ConfigDocumentError(
      "Configuration file path must not be empty or contain control characters",
    )
  }
  return resolve(normalized)
}

export function resolveConnectorSecretFile(file: string): string {
  const normalized = file.trim()
  if (!normalized || FILE_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new ConfigDocumentError(
      "Credential file path must not be empty or contain control characters",
    )
  }
  return resolve(normalized)
}

function validationEnvironment(
  document: ConnectorConfigDocument,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const variable of connectorConfigSecretEnvironmentNames(document)) {
    environment[variable] = variable.endsWith("_HEADERS")
      ? "x-config-validation=placeholder"
      : "config-validation-token"
  }
  return environment
}

function validationDocument(
  document: ConnectorConfigDocument,
): ConnectorConfigDocument {
  return {
    ...document,
    credential: {
      provider: "environment",
      variable: DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
    },
  }
}

export function validateConnectorConfigDocumentPolicy(
  documentValue: ConnectorConfigDocument,
  options: { guidanceFile?: string } = {},
): ConnectorConfigDocument {
  const document = parseConnectorConfigDocument(documentValue)
  const placeholderDocument = validationDocument(document)
  const environment = validationEnvironment(placeholderDocument)
  try {
    loadConnectorConfigDocument(
      placeholderDocument,
      environment,
    )
  } catch (error) {
    if (error instanceof ConfigDocumentError) throw error
    if (error instanceof ConfigurationError) {
      throw new ConfigDocumentError(
        appendConfigRecipeDependencyGuidance(
          document,
          error.message,
          options.guidanceFile,
        ),
        { cause: error },
      )
    }
    throw error
  }
  return document
}

export function summarizeConnectorConfigDocument(
  documentValue: ConnectorConfigDocument,
): ConnectorConfigSummary {
  const document = parseConnectorConfigDocument(documentValue)
  const expandedReadScope = expandedConnectorReadScope(document)
  return {
    capabilitiesEnabled: Object.entries(document.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .sort(),
    configSchemaVersion: document.schemaVersion,
    credential: { ...document.credential },
    gateway: { ...document.gateway },
    groupsConfigured: CONFIG_SCOPE_GROUP_TYPES
      .flatMap((type) => {
        const groups = document.groups[type]
        if (!groups || Object.keys(groups).length === 0) return []
        return [{
          exactIdCount: new Set(Object.values(groups).flat()).size,
          groupCount: Object.keys(groups).length,
          type,
        }]
      })
      .sort((left, right) => left.type.localeCompare(right.type)),
    identity: { ...document.identity },
    limitsConfigured: Object.keys(document.limits).sort(),
    name: document.name,
    notifications: { ...document.notifications },
    readScope: {
      ...(document.readScope.channelIds.some((entry) => entry.startsWith("@"))
        ? { channelEntries: [...document.readScope.channelIds] }
        : {}),
      channelMode: document.readScope.channelMode,
      channelIds: [...expandedReadScope.channelIds],
      ...(document.readScope.guildIds.some((entry) => entry.startsWith("@"))
        ? { guildEntries: [...document.readScope.guildIds] }
        : {}),
      guildMode: document.readScope.guildMode,
      guildIds: [...expandedReadScope.guildIds],
    },
    runtimeConfigured: Object.keys(document.runtime).sort(),
    secretEnvironmentVariables: [...connectorConfigSecretEnvironmentNames(document)].sort(),
    secretFilePaths: [...connectorConfigSecretFilePaths(document)].sort(),
    scopesConfigured: Object.entries(document.scopes)
      .filter(([, ids]) => ids.length > 0)
      .map(([name, ids]) => ({
        authoredCount: ids.length,
        count: expandedConnectorScope(document, name as keyof ConnectorConfigDocument["scopes"]).length,
        name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    storageConfigured: Object.keys(document.storage).sort(),
    tools: {
      surface: document.tools.surface,
      toolsets: [...document.tools.toolsets],
    },
    threads: { ...document.threads },
  }
}

function validationReport(
  file: string,
  document: ConnectorConfigDocument,
  targetFile = file,
): ConfigValidationReport {
  return {
    file,
    schemaVersion: CONFIG_OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
    summary: summarizeConnectorConfigDocument(document),
    targetFile,
    validation: {
      crossFieldPolicy: true,
      discordContacted: false,
      secretValuesRead: false,
    },
  }
}

export function validateConnectorConfigFile(file: string): ConfigValidationReport {
  const normalized = resolveConnectorConfigFile(file)
  const inspection = inspectConnectorConfigDocumentFile(normalized)
  const document = validateConnectorConfigDocumentPolicy(
    inspection.document,
    { guidanceFile: normalized },
  )
  return validationReport(normalized, document, inspection.targetFile)
}

export function showConnectorConfigFile(file: string): ConfigShowReport {
  const normalized = resolveConnectorConfigFile(file)
  const inspection = inspectConnectorConfigDocumentFile(normalized)
  const document = validateConnectorConfigDocumentPolicy(
    inspection.document,
    { guidanceFile: normalized },
  )
  return {
    ...validationReport(normalized, document, inspection.targetFile),
    document,
  }
}

function schemaAtPath(schema: unknown, path: string): unknown {
  if (path === "$.$schema") {
    return (schema as { properties?: Record<string, unknown> }).properties?.$schema
  }
  const keys = path.replace(/^\$\.?/, "").split(".").filter(Boolean)
  let current = schema
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
    current = (current as { properties?: Record<string, unknown> }).properties?.[key]
  }
  return current
}

function normalizedExplainQuery(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized || normalized === "$" || normalized === ".") return "$"
  if (normalized.includes("\0") || normalized.includes("[")) {
    throw new ConfigDocumentError("Configuration field path is invalid")
  }
  return normalized.startsWith("$.") ? normalized : `$.${normalized.replace(/^\./, "")}`
}

export function explainConnectorConfig(
  path?: string,
): ConfigExplainReport {
  const query = normalizedExplainQuery(path)
  const schema = connectorConfigJsonSchema()
  const fields = connectorConfigFields()
    .filter((field) => (
      query === "$"
      || field.path === query
      || field.path.startsWith(`${query}.`)
    ))
    .map((field) => ({
      ...field,
      schema: schemaAtPath(schema, field.path),
    }))
  if (fields.length === 0) {
    throw new ConfigDocumentError(`Unknown configuration field path: ${query}`)
  }
  return {
    fields,
    query,
    schemaId: CONFIG_DOCUMENT_SCHEMA_ID,
    schemaVersion: CONFIG_OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return
  let handle
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    throw new ConfigDocumentError("Unable to sync configuration directory", {
      cause: error,
    })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertConfigDirectory(directory: string): Promise<void> {
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new ConfigDocumentError(
        "Configuration directory was not found; create a canonical process-owned private directory before setup",
      )
    }
    throw new ConfigDocumentError("Unable to inspect configuration directory", {
      cause: error,
    })
  }
  if (metadata.isSymbolicLink()) {
    throw new ConfigDocumentError(
      "Configuration directory must not be a symbolic link",
    )
  }
  if (!metadata.isDirectory()) {
    throw new ConfigDocumentError(
      "Configuration parent must be a directory",
    )
  }
  let canonical
  try {
    canonical = await realpath(directory)
  } catch (error) {
    throw new ConfigDocumentError("Unable to resolve configuration directory", {
      cause: error,
    })
  }
  if (canonical !== directory) {
    throw new ConfigDocumentError(
      "Configuration directory path must be canonical and contain no symbolic-link component",
    )
  }
  if (process.platform === "win32") return
  if (typeof process.getuid !== "function") {
    throw new ConfigDocumentError(
      "Configuration directory ownership could not be verified",
    )
  }
  if (metadata.uid !== process.getuid()) {
    throw new ConfigDocumentError(
      "Configuration directory must be owned by the process user",
    )
  }
  if ((metadata.mode & 0o022) !== 0) {
    throw new ConfigDocumentError(
      "Configuration directory must not be group or world writable",
    )
  }
}

export async function ensureConnectorConfigDirectory(
  directory: string,
): Promise<string> {
  const normalized = directory.trim()
  if (!normalized || FILE_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new ConfigDocumentError(
      "Configuration directory path must not be empty or contain control characters",
    )
  }
  const target = resolve(normalized)
  try {
    await mkdir(target, { mode: 0o700, recursive: true })
  } catch (error) {
    throw new ConfigDocumentError("Unable to create private configuration directory", {
      cause: error,
    })
  }
  await assertConfigDirectory(target)
  if (process.platform !== "win32") {
    const metadata = await lstat(target)
    if ((metadata.mode & 0o077) !== 0) {
      throw new ConfigDocumentError(
        "CLI-owned configuration directory must be accessible only to the process user",
      )
    }
  }
  return target
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw new ConfigDocumentError("Unable to inspect configuration path", {
      cause: error,
    })
  }
}

async function writeTemporaryConfig(
  directory: string,
  targetName: string,
  document: ConnectorConfigDocument,
): Promise<string> {
  const temporary = resolve(
    directory,
    `.${targetName}.${randomUUID()}.tmp`,
  )
  let handle
  const errors: unknown[] = []
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8")
    await handle.sync()
  } catch (error) {
    errors.push(error)
  }
  await handle?.close().catch((error: unknown) => errors.push(error))
  if (errors.length > 0) {
    if (handle) await unlink(temporary).catch(() => undefined)
    throw new ConfigDocumentError("Unable to write temporary configuration", {
      cause: errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Multiple configuration writes failed"),
    })
  }
  return temporary
}

async function withConfigLock<T>(
  directory: string,
  targetName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = resolve(directory, `.${targetName}.lock`)
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
      throw new ConfigDocumentError("Configuration file is locked by another operation")
    }
    throw new ConfigDocumentError("Unable to lock configuration file", { cause: error })
  }

  let result: T | undefined
  let operationError: unknown
  try {
    result = await operation()
  } catch (error) {
    operationError = error
  }
  const cleanupErrors: unknown[] = []
  await handle.close().catch((error: unknown) => cleanupErrors.push(error))
  await unlink(lock).catch((error: unknown) => cleanupErrors.push(error))
  await syncDirectory(directory).catch((error: unknown) => cleanupErrors.push(error))
  if (operationError !== undefined || cleanupErrors.length > 0) {
    const errors = [operationError, ...cleanupErrors].filter((error) => error !== undefined)
    if (operationError !== undefined && cleanupErrors.length === 0) throw operationError
    throw new ConfigDocumentError("Configuration operation or lock cleanup failed", {
      cause: new AggregateError(errors, "Configuration operation or cleanup failed"),
    })
  }
  return result as T
}

export async function writeConnectorConfigDocumentFile(
  file: string,
  documentValue: ConnectorConfigDocument,
  options: ConfigWriteOptions = {},
): Promise<ConfigWriteOutcome> {
  const requestedFile = resolveConnectorConfigFile(file)
  const requestedDirectory = dirname(requestedFile)
  await assertConfigDirectory(requestedDirectory)
  const document = validateConnectorConfigDocumentPolicy(
    documentValue,
    { guidanceFile: requestedFile },
  )
  const initiallyExists = await pathExists(requestedFile)
  const initialInspection = initiallyExists
    ? inspectConnectorConfigDocumentFile(requestedFile)
    : undefined
  const targetFile = initialInspection?.targetFile ?? requestedFile
  const targetDirectory = dirname(targetFile)
  const targetName = basename(targetFile)
  await assertConfigDirectory(targetDirectory)
  if (
    options.expectedTargetFile !== undefined
    && resolveConnectorConfigFile(options.expectedTargetFile) !== targetFile
  ) {
    throw new ConfigDocumentError(
      "Configuration file target changed after the reviewed source was read",
    )
  }
  return withConfigLock(targetDirectory, targetName, async () => {
    const exists = await pathExists(requestedFile)
    if (exists !== initiallyExists) {
      throw new ConfigDocumentError(exists
        ? "Configuration file was created by another operation"
        : "Configuration file was removed after the reviewed source was read")
    }
    const inspection = exists
      ? inspectConnectorConfigDocumentFile(requestedFile)
      : undefined
    if (inspection && inspection.targetFile !== targetFile) {
      throw new ConfigDocumentError(
        "Configuration file symlink was retargeted after inspection",
      )
    }
    let backupFile: string | undefined
    if (exists) {
      if (!inspection) {
        throw new ConfigDocumentError(
          "Configuration file could not be inspected after locking",
        )
      }
      const current = inspection.document
      if (
        options.expectedCurrent !== undefined
        && stableString(current) !== stableString(
          parseConnectorConfigDocument(options.expectedCurrent),
        )
      ) {
        throw new ConfigDocumentError(
          "Configuration file changed after the reviewed source was read",
        )
      }
      if (!options.overwrite) {
        throw new ConfigDocumentError("Configuration file already exists")
      }
      if (
        current.identity.applicationId !== document.identity.applicationId
        || current.identity.botId !== document.identity.botId
      ) {
        throw new ConfigDocumentError(
          "Configuration file is locked to its existing Discord identity",
        )
      }
    } else if (options.expectedCurrent !== undefined) {
      throw new ConfigDocumentError(
        "Configuration file was removed after the reviewed source was read",
      )
    }

    const temporary = await writeTemporaryConfig(targetDirectory, targetName, document)
    let published = false
    try {
      if (exists) {
        backupFile = resolve(
          targetDirectory,
          `.${targetName}.backup.${Date.now()}-${randomUUID()}`,
        )
        await rename(targetFile, backupFile)
        try {
          await rename(temporary, targetFile)
          published = true
        } catch (error) {
          try {
            await rename(backupFile, targetFile)
            backupFile = undefined
          } catch (rollbackError) {
            throw new ConfigDocumentError(
              "Unable to publish or roll back configuration replacement",
              {
                cause: new AggregateError(
                  [error, rollbackError],
                  "Configuration replacement and rollback failed",
                ),
              },
            )
          }
          throw error
        }
      } else {
        let linked = false
        try {
          await link(temporary, targetFile)
          linked = true
          await unlink(temporary)
          published = true
        } catch (error) {
          if (linked) {
            try {
              await unlink(targetFile)
            } catch (rollbackError) {
              throw new ConfigDocumentError(
                "Unable to roll back partial configuration publication",
                {
                  cause: new AggregateError(
                    [error, rollbackError],
                    "Configuration publication and rollback failed",
                  ),
                },
              )
            }
          }
          throw error
        }
      }
      await syncDirectory(targetDirectory)
    } catch (error) {
      if (!published) await unlink(temporary).catch(() => undefined)
      if (!exists && isNodeError(error, "EEXIST")) {
        throw new ConfigDocumentError(
          "Configuration file was created by another operation",
        )
      }
      if (error instanceof ConfigDocumentError) throw error
      throw new ConfigDocumentError("Unable to publish configuration file", {
        cause: error,
      })
    }

    const verifiedInspection = inspectConnectorConfigDocumentFile(requestedFile)
    if (verifiedInspection.targetFile !== targetFile) {
      throw new ConfigDocumentError(
        "Configuration file symlink changed during publication",
      )
    }
    const verified = validateConnectorConfigDocumentPolicy(verifiedInspection.document)
    if (JSON.stringify(verified) !== JSON.stringify(document)) {
      throw new ConfigDocumentError("Published configuration did not verify exactly")
    }
    return {
      ...(backupFile ? { backupFile } : {}),
      created: !exists,
      document,
      file: requestedFile,
      targetFile,
    }
  })
}

function writeReport(
  action: ConfigWriteReport["action"],
  source: ConfigWriteReport["source"],
  outcome: ConfigWriteOutcome,
): ConfigWriteReport {
  return {
    action,
    ...(outcome.backupFile ? { backupFile: outcome.backupFile } : {}),
    created: outcome.created,
    document: outcome.document,
    ...validationReport(outcome.file, outcome.document, outcome.targetFile),
    source,
  }
}

export async function initializeConnectorConfigFile(
  options: ConfigInitOptions,
): Promise<ConfigWriteReport> {
  const preset = getSetupPreset(options.preset ?? "server-observer")
  if (
    preset.requirements.channelIds === "required"
    && (options.channelIds?.length ?? 0) === 0
  ) {
    throw new ConfigurationError(
      `Configuration preset ${preset.name} requires at least one channel ID`,
    )
  }
  const document = createConnectorConfigDocument({
    applicationId: options.applicationId,
    botId: options.botId,
    channelIds: options.channelIds ?? [],
    ...(options.credentialFile !== undefined
      ? { credentialFile: resolveConnectorSecretFile(options.credentialFile) }
      : {}),
    ...(options.credentialVariable !== undefined
      ? { credentialVariable: options.credentialVariable }
      : {}),
    gatewayEnabled: preset.gatewayEnabled,
    guildIds: options.guildIds,
    name: options.name,
    toolsets: preset.toolsets,
    toolSurface: preset.toolSurface,
  })
  const outcome = await writeConnectorConfigDocumentFile(
    options.file,
    document,
    { ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }) },
  )
  return writeReport("init", "new", outcome)
}
