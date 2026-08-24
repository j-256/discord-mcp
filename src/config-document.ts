import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs"
import type { BigIntStats } from "node:fs"
import {
  isAbsolute,
  resolve,
} from "node:path"
import { TextDecoder } from "node:util"

import { z } from "zod"

import {
  CONNECTOR_LIMITS,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_TOKEN_ENVIRONMENT_PATTERN,
  GATEWAY_DEFAULTS,
  MCP_TOOLSET_NAMES,
  MCP_TOOL_SURFACES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { ConfigDocumentError } from "./errors.js"

export const CONFIG_DOCUMENT_SCHEMA_VERSION = 2
export const CONFIG_DOCUMENT_SCHEMA_ID =
  "https://raw.githubusercontent.com/j-256/discord-mcp/main/discord-mcp.config.schema.json"

const CONFIG_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/
const HEADER_ENVIRONMENT_PATTERN = /^[A-Z][A-Z0-9_]{0,118}_HEADERS$/
const CONFIG_JSON_MAX_DEPTH = 64
const CREDENTIAL_FILE_OVERFLOW_PROBE_BYTES = 1
const CONFIG_STRING_CHARACTERS = 4_096
const CONFIG_SCOPE_ENTRIES = 1_000
const CONFIG_ROOT_ENTRIES = 32

export interface EnvironmentSecretReference {
  provider: "environment"
  variable: string
}

export interface FileSecretReference {
  path: string
  provider: "file"
}

export type ConnectorCredentialReference =
  | EnvironmentSecretReference
  | FileSecretReference

export interface ConnectorConfigDocumentObservabilitySignal {
  compression?: string
  endpoint?: string
  headers?: EnvironmentSecretReference
  protocol?: string
  timeoutMs?: number
}

export interface ConnectorConfigDocumentObservability {
  compression?: string
  endpoint?: string
  exportEnabled?: boolean
  headers?: EnvironmentSecretReference
  jsonLogsEnabled?: boolean
  metrics?: ConnectorConfigDocumentObservabilitySignal
  protocol?: string
  serviceName?: string
  timeoutMs?: number
  traceSampleRatio?: number
  traceSampler?: string
  traces?: ConnectorConfigDocumentObservabilitySignal
}

export interface ConnectorConfigDocument {
  $schema?: typeof CONFIG_DOCUMENT_SCHEMA_ID
  capabilities: Readonly<Partial<Record<ConnectorConfigCapabilityName, boolean>>>
  credential: ConnectorCredentialReference
  gateway: {
    enabled: boolean
    eventBufferSize: number
  }
  identity: {
    applicationId: string
    botId: string
  }
  limits: Readonly<Partial<Record<ConnectorConfigLimitName, number>>>
  name: string
  observability: ConnectorConfigDocumentObservability
  readScope: {
    channelIds: readonly string[]
    guildIds: readonly string[]
  }
  runtime: Readonly<Partial<Record<ConnectorConfigRuntimeName, string>>>
  schemaVersion: 2
  scopes: Readonly<Partial<Record<ConnectorConfigScopeName, readonly string[]>>>
  storage: ConnectorConfigDocumentStorage
  tools: {
    surface: McpToolSurface
    toolsets: readonly McpToolsetName[]
  }
}

export interface ConfigDocumentField {
  defaultValue: boolean | number | string | readonly string[] | undefined
  description: string
  kind: "boolean" | "integer" | "number" | "path" | "paths" | "secret-reference" | "snowflake" | "snowflakes" | "string" | "strings"
  path: string
  required: boolean
}

function humanizeConfigKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bIds$/, "IDs")
    .toLowerCase()
}

export const CONFIG_CAPABILITY_NAMES = Object.freeze([
  "administration",
  "applicationEmojiAudit",
  "applicationEmojiChanges",
  "announcementCrossposts",
  "announcementSubscriptionAudit",
  "announcementSubscriptionChanges",
  "attachments",
  "automodAudit",
  "automodChanges",
  "banAudit",
  "channelCreation",
  "channelDeletionAudit",
  "channelDeletions",
  "channelCloneAudit",
  "channelCloning",
  "channelMetadataChanges",
  "channelOrderingAudit",
  "channelOrderingChanges",
  "deletions",
  "forumPosts",
  "forumTagAudit",
  "forumTagChanges",
  "guildExpressionAudit",
  "guildExpressionChanges",
  "guildIncidentAudit",
  "guildIncidentChanges",
  "guildProfileAudit",
  "guildProfileChanges",
  "guildScaffolds",
  "guildSettingsAudit",
  "guildSettingsChanges",
  "guildTemplateAudit",
  "guildTemplateChanges",
  "integrationAudit",
  "integrationDeletions",
  "interactions",
  "inviteAudit",
  "inviteCreation",
  "inviteDeletions",
  "memberDirectory",
  "nicknameChanges",
  "otherMemberNicknameChanges",
  "memberRoleChanges",
  "memberVoiceAudit",
  "memberVoiceChanges",
  "messageForwarding",
  "crossGuildMessageForwarding",
  "nativeCommandChanges",
  "nativeInteractions",
  "onboardingAudit",
  "onboardingChanges",
  "pinManagement",
  "permissionOverwrites",
  "pollAudit",
  "pollCreation",
  "pollEnding",
  "pollVoterAudit",
  "reactionModeration",
  "reactionUserAudit",
  "roleCreation",
  "roleConfiguration",
  "roleDeletionAudit",
  "roleDeletions",
  "roleOrderingAudit",
  "roleOrderingChanges",
  "scheduledEventAudit",
  "scheduledEventUserAudit",
  "scheduledEventChanges",
  "soundboardAudit",
  "soundboardChanges",
  "stageInstanceAudit",
  "stageInstanceChanges",
  "stageStartNotifications",
  "threadCreation",
  "threadAudit",
  "threadChanges",
  "welcomeScreenAudit",
  "welcomeScreenChanges",
  "webhookAudit",
  "webhookChanges",
  "webhookCreation",
  "webhookDeletions",
  "widgetPublicExposure",
  "widgetSettingsAudit",
  "widgetSettingsChanges",
] as const)

export const CONFIG_SCOPE_NAMES = Object.freeze([
  "adminGuildIds",
  "announcementCrosspostChannelIds",
  "announcementSubscriptionSourceChannelIds",
  "announcementSubscriptionTargetChannelIds",
  "attachmentChannelIds",
  "automodAlertChannelIds",
  "automodGuildIds",
  "banAuditGuildIds",
  "channelCreationGuildIds",
  "channelDeletionIds",
  "channelCloneGuildIds",
  "channelCloneSourceIds",
  "channelMetadataIds",
  "channelOrderingGuildIds",
  "deleteChannelIds",
  "forumPostChannelIds",
  "forumTagChannelIds",
  "guildScaffoldGuildIds",
  "guildExpressionGuildIds",
  "guildIncidentGuildIds",
  "guildProfileGuildIds",
  "guildSettingsGuildIds",
  "guildTemplateGuildIds",
  "integrationGuildIds",
  "integrationIds",
  "interactionChannelIds",
  "inviteCreationChannelIds",
  "inviteGuildIds",
  "mentionUserIds",
  "memberDirectoryGuildIds",
  "nicknameGuildIds",
  "memberRoleGuildIds",
  "memberRoleIds",
  "memberVoiceChannelIds",
  "memberVoiceGuildIds",
  "messageForwardSourceChannelIds",
  "messageForwardTargetChannelIds",
  "nativeInteractionChannelIds",
  "nativeInteractionGuildIds",
  "nativeInteractionUserIds",
  "onboardingGuildIds",
  "protectedUserIds",
  "pinChannelIds",
  "pollChannelIds",
  "reactionChannelIds",
  "permissionOverwriteChannelIds",
  "roleCreationGuildIds",
  "roleConfigurationIds",
  "roleDeletionIds",
  "roleOrderingGuildIds",
  "scheduledEventGuildIds",
  "soundboardGuildIds",
  "stageChannelIds",
  "threadParentIds",
  "threadGuildIds",
  "threadIds",
  "threadMemberUserIds",
  "welcomeScreenGuildIds",
  "webhookChannelIds",
  "widgetSettingsGuildIds",
] as const)

export const CONFIG_LIMIT_NAMES = Object.freeze([
  "attachmentMaxBytes",
  "interactionMaxWritesPerMinute",
  "interactionMinWriteIntervalMs",
  "nativeInteractionMaxPending",
  "nativeInteractionTtlSeconds",
] as const)

export const CONFIG_STORAGE_NAMES = Object.freeze([
  "applicationEmojiRoots",
  "attachmentRoots",
  "auditFile",
  "guildExpressionRoots",
  "inviteCapabilityRoots",
  "scheduledEventRoots",
  "soundboardRoots",
] as const)

export const CONFIG_RUNTIME_NAMES = Object.freeze([
  "nativeCommandName",
] as const)

export type ConnectorConfigCapabilityName = (typeof CONFIG_CAPABILITY_NAMES)[number]
export type ConnectorConfigLimitName = (typeof CONFIG_LIMIT_NAMES)[number]
export type ConnectorConfigRuntimeName = (typeof CONFIG_RUNTIME_NAMES)[number]
export type ConnectorConfigScopeName = (typeof CONFIG_SCOPE_NAMES)[number]

export interface ConnectorConfigDocumentStorage {
  applicationEmojiRoots?: readonly string[]
  attachmentRoots?: readonly string[]
  auditFile?: string
  guildExpressionRoots?: readonly string[]
  inviteCapabilityRoots?: readonly string[]
  scheduledEventRoots?: readonly string[]
  soundboardRoots?: readonly string[]
}

function canonicalArray<T extends string>(
  values: readonly T[],
  order?: readonly T[],
): boolean {
  const canonical = order
    ? order.filter((entry) => values.includes(entry))
    : [...values].sort()
  return new Set(values).size === values.length
    && canonical.every((entry, index) => entry === values[index])
}

const snowflakeSchema = z.string()
  .regex(DISCORD_SNOWFLAKE_PATTERN, "must be a Discord snowflake")

const absolutePathSchema = z.string()
  .min(1)
  .max(CONFIG_STRING_CHARACTERS)
  .refine(
    (value) => (
      value.trim() === value
      && !/[\u0000-\u001F\u007F]/u.test(value)
      && isAbsolute(value)
      && resolve(value) === value
    ),
    "must be an absolute canonical path",
  )

function snowflakeArraySchema(minimum: number, maximum: number): z.ZodType<string[]> {
  return z.array(snowflakeSchema)
    .min(minimum)
    .max(maximum)
    .refine((values) => canonicalArray(values), "must contain unique sorted Discord snowflakes")
}

const rootArraySchema = z.array(absolutePathSchema)
  .max(CONFIG_ROOT_ENTRIES)
  .refine((values) => canonicalArray(values), "must contain unique sorted paths")

const configNameSchema = z.string()
  .regex(CONFIG_NAME_PATTERN, "must be a bounded lowercase filename-safe identifier")
  .refine((value) => !WINDOWS_DEVICE_NAME_PATTERN.test(value), "must not be a reserved filename")

const tokenReferenceSchema = z.strictObject({
  provider: z.literal("environment"),
  variable: z.string()
    .max(128)
    .regex(DISCORD_TOKEN_ENVIRONMENT_PATTERN, "must name an uppercase Discord token environment variable"),
})

const credentialFileReferenceSchema = z.strictObject({
  path: absolutePathSchema.refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "must not contain control characters",
  ).describe("Absolute canonical path to a bounded externally managed Discord token file"),
  provider: z.literal("file"),
})

const credentialReferenceSchema = z.discriminatedUnion("provider", [
  tokenReferenceSchema,
  credentialFileReferenceSchema,
]).describe("Environment or bounded file reference for the Discord bot token")

const headerReferenceSchema = z.strictObject({
  provider: z.literal("environment"),
  variable: z.string()
    .max(128)
    .regex(HEADER_ENVIRONMENT_PATTERN, "must name an uppercase header environment variable"),
}).describe("Environment reference for an OTLP header string")

const CHANNEL_METADATA_CAPABILITY_DESCRIPTION = "Enable reviewed channel metadata and exact ordinary voice-channel status policy"
const CHANNEL_METADATA_SCOPE_DESCRIPTION = "Exact Discord ID allowlist for reviewed channel metadata and ordinary voice-channel status"
const INVITE_CREATION_CAPABILITY_DESCRIPTION = "Enable reviewed finite invite creation with private-file capability delivery"
const INVITE_CREATION_SCOPE_DESCRIPTION = "Exact direct guild-channel ID allowlist for reviewed finite invite creation"
const INVITE_CAPABILITY_ROOT_DESCRIPTION = "Canonical process-owned roots for exclusive private invite capability files"

function capabilityDescription(documentKey: string): string {
  if (documentKey === "channelMetadataChanges") {
    return CHANNEL_METADATA_CAPABILITY_DESCRIPTION
  }
  if (documentKey === "inviteCreation") {
    return INVITE_CREATION_CAPABILITY_DESCRIPTION
  }
  return `Enable ${humanizeConfigKey(documentKey)} policy`
}

function scopeDescription(documentKey: string): string {
  if (documentKey === "channelMetadataIds") {
    return CHANNEL_METADATA_SCOPE_DESCRIPTION
  }
  if (documentKey === "inviteCreationChannelIds") {
    return INVITE_CREATION_SCOPE_DESCRIPTION
  }
  return `Exact Discord ID allowlist for ${humanizeConfigKey(documentKey)}`
}

function storageDescription(documentKey: string): string {
  if (documentKey === "guildExpressionRoots") {
    return "Owned local roots shared by guild-expression creation and reviewed role-icon images"
  }
  if (documentKey === "inviteCapabilityRoots") {
    return INVITE_CAPABILITY_ROOT_DESCRIPTION
  }
  return `Owned local roots for ${humanizeConfigKey(documentKey)}`
}

const capabilityShape = Object.fromEntries(
  CONFIG_CAPABILITY_NAMES.map((name) => [
    name,
    z.boolean()
      .describe(capabilityDescription(name))
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodBoolean>>

const scopeShape = Object.fromEntries(
  CONFIG_SCOPE_NAMES.map((name) => [
    name,
    snowflakeArraySchema(0, CONFIG_SCOPE_ENTRIES)
      .describe(scopeDescription(name))
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodType<string[]>>>

const limitShape = Object.fromEntries(
  CONFIG_LIMIT_NAMES.map((name) => [
    name,
    z.number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .describe(`Numeric policy limit for ${humanizeConfigKey(name)}`)
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodNumber>>

const storageShape = Object.fromEntries(
  CONFIG_STORAGE_NAMES.map((name) => [
    name,
    name === "auditFile"
      ? absolutePathSchema
        .describe("Absolute path for the content-free activity log")
        .optional()
      : rootArraySchema
        .describe(storageDescription(name))
        .optional(),
  ]),
) as Record<string, z.ZodType>

const runtimeShape = Object.fromEntries(
  CONFIG_RUNTIME_NAMES.map((name) => [
    name,
    z.string()
      .min(1)
      .max(CONFIG_STRING_CHARACTERS)
      .describe(`Runtime setting for ${humanizeConfigKey(name)}`)
      .optional(),
  ]),
) as Record<string, z.ZodOptional<z.ZodString>>

const observabilitySignalSchema = z.strictObject({
  compression: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
    .describe("OTLP compression mode")
    .optional(),
  endpoint: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
    .describe("Credential-free absolute OTLP endpoint")
    .optional(),
  headers: headerReferenceSchema.optional(),
  protocol: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
    .describe("OTLP transport protocol")
    .optional(),
  timeoutMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
    .describe("OTLP request timeout in milliseconds")
    .optional(),
})

export const CONNECTOR_CONFIG_DOCUMENT_SCHEMA = z.strictObject({
  $schema: z.literal(CONFIG_DOCUMENT_SCHEMA_ID)
    .describe("Editor schema identifier for this configuration format")
    .optional(),
  capabilities: z.strictObject(capabilityShape)
    .describe("Explicit capability gates; omitted gates remain disabled")
    .default({}),
  credential: credentialReferenceSchema,
  gateway: z.strictObject({
    enabled: z.boolean().describe("Enable the optional privacy-safe Discord Gateway client"),
    eventBufferSize: z.number().int().min(1).max(CONNECTOR_LIMITS.gatewayEventBufferSize)
      .describe("Maximum bounded Gateway event buffer size"),
  }).describe("Optional Discord Gateway policy"),
  identity: z.strictObject({
    applicationId: snowflakeSchema.describe("Expected Discord application identity"),
    botId: snowflakeSchema.describe("Expected Discord bot user identity"),
  }).describe("Pinned Discord application and bot identity"),
  limits: z.strictObject(limitShape)
    .describe("Optional numeric policy limits")
    .default({}),
  name: configNameSchema.describe("Bounded lowercase identifier for this policy"),
  observability: z.strictObject({
    compression: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Common OTLP compression mode")
      .optional(),
    endpoint: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Common credential-free absolute OTLP endpoint")
      .optional(),
    exportEnabled: z.boolean().describe("Enable OTLP export").optional(),
    headers: headerReferenceSchema.optional(),
    jsonLogsEnabled: z.boolean().describe("Enable content-free JSON operational logs").optional(),
    metrics: observabilitySignalSchema.optional(),
    protocol: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Common OTLP transport protocol")
      .optional(),
    serviceName: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Bounded non-identifying telemetry service name")
      .optional(),
    timeoutMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
      .describe("Common OTLP request timeout in milliseconds")
      .optional(),
    traceSampleRatio: z.number().min(0).max(1)
      .describe("Trace sampling ratio")
      .optional(),
    traceSampler: z.string().min(1).max(CONFIG_STRING_CHARACTERS)
      .describe("Trace sampler name")
      .optional(),
    traces: observabilitySignalSchema.optional(),
  }).describe("Optional content-free local and OTLP observability policy").default({}),
  readScope: z.strictObject({
    channelIds: snowflakeArraySchema(0, DISCORD_LIMITS.searchChannelIds)
      .describe("Optional exact channel allowlist inside the guild boundary"),
    guildIds: snowflakeArraySchema(1, DISCORD_LIMITS.currentUserGuilds)
      .describe("Exact guild allowlist forming the outer read boundary"),
  }).describe("Required outer Discord read boundary"),
  runtime: z.strictObject(runtimeShape)
    .describe("Optional non-secret runtime settings")
    .default({}),
  schemaVersion: z.literal(CONFIG_DOCUMENT_SCHEMA_VERSION)
    .describe("Configuration format version"),
  scopes: z.strictObject(scopeShape)
    .describe("Exact per-feature Discord ID allowlists")
    .default({}),
  storage: z.strictObject(storageShape)
    .describe("Local content-free activity and owned-file paths")
    .default({}),
  tools: z.strictObject({
    surface: z.enum(MCP_TOOL_SURFACES).describe("MCP tool discovery surface"),
    toolsets: z.array(z.enum(MCP_TOOLSET_NAMES))
      .min(1)
      .max(MCP_TOOLSET_NAMES.length)
      .refine(
        (values) => canonicalArray(values, MCP_TOOLSET_NAMES),
        "must contain unique toolsets in canonical order",
      )
      .describe("Canonical MCP toolset selection"),
  }).describe("Advertised MCP tool surface"),
}).meta({
  description: "Strict non-secret configuration for discord-mcp",
  id: CONFIG_DOCUMENT_SCHEMA_ID,
  title: "discord-mcp configuration",
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "$"
  return path.reduce<string>((result, entry) => (
    typeof entry === "number"
      ? `${result}[${entry}]`
      : `${result}.${String(entry)}`
  ), "$")
}

function schemaError(
  error: z.ZodError,
  prefix: readonly PropertyKey[] = [],
): ConfigDocumentError {
  const issue = error.issues[0]
  if (!issue) return new ConfigDocumentError("Configuration document is invalid")
  return new ConfigDocumentError(
    `Configuration document ${issuePath([...prefix, ...issue.path])} ${issue.message}`,
    { cause: error },
  )
}

function parseConnectorCredentialReference(
  value: unknown,
): ConnectorCredentialReference {
  const result = credentialReferenceSchema.safeParse(value)
  if (!result.success) throw schemaError(result.error, ["credential"])
  return result.data
}

export function normalizeConfigName(value: string): string {
  const result = configNameSchema.safeParse(value.trim())
  if (!result.success) throw schemaError(result.error)
  return result.data
}

function environmentSecretReferences(document: ConnectorConfigDocument): readonly {
  path: string
  reference: EnvironmentSecretReference
}[] {
  const result: {
    path: string
    reference: EnvironmentSecretReference
  }[] = []
  if (document.credential.provider === "environment") result.push({
    path: "$.credential",
    reference: document.credential,
  })
  const common = document.observability.headers
  const traces = document.observability.traces?.headers
  const metrics = document.observability.metrics?.headers
  if (common) result.push({
    path: "$.observability.headers",
    reference: common,
  })
  if (traces) result.push({
    path: "$.observability.traces.headers",
    reference: traces,
  })
  if (metrics) result.push({
    path: "$.observability.metrics.headers",
    reference: metrics,
  })
  return result
}

export function connectorConfigSecretEnvironmentNames(
  document: ConnectorConfigDocument,
): readonly string[] {
  return Object.freeze([
    ...new Set(environmentSecretReferences(parseConnectorConfigDocument(document))
      .map((entry) => entry.reference.variable)),
  ])
}

export function connectorConfigSecretFilePaths(
  document: ConnectorConfigDocument,
): readonly string[] {
  const parsed = parseConnectorConfigDocument(document)
  return Object.freeze(parsed.credential.provider === "file"
    ? [parsed.credential.path]
    : [])
}

export function parseConnectorConfigDocument(
  value: unknown,
  expectedName?: string,
): ConnectorConfigDocument {
  if (isRecord(value) && value.schemaVersion !== CONFIG_DOCUMENT_SCHEMA_VERSION) {
    throw new ConfigDocumentError(
      `Unsupported configuration schema version: ${String(value.schemaVersion)}`,
    )
  }
  const result = CONNECTOR_CONFIG_DOCUMENT_SCHEMA.safeParse(value)
  if (!result.success) throw schemaError(result.error)
  const document = result.data as ConnectorConfigDocument
  if (expectedName !== undefined && document.name !== normalizeConfigName(expectedName)) {
    throw new ConfigDocumentError("Configuration name does not match its filename")
  }
  return document
}

export function createConnectorConfigDocument(options: {
  applicationId: string
  botId: string
  capabilities?: ConnectorConfigDocument["capabilities"]
  channelIds?: readonly string[]
  credentialFile?: string
  credentialVariable?: string
  gatewayEnabled?: boolean
  gatewayEventBufferSize?: number
  guildIds: readonly string[]
  limits?: ConnectorConfigDocument["limits"]
  name: string
  observability?: ConnectorConfigDocumentObservability
  runtime?: ConnectorConfigDocument["runtime"]
  scopes?: ConnectorConfigDocument["scopes"]
  storage?: ConnectorConfigDocumentStorage
  toolsets: readonly McpToolsetName[]
  toolSurface: McpToolSurface
}): ConnectorConfigDocument {
  if (options.credentialFile !== undefined && options.credentialVariable !== undefined) {
    throw new ConfigDocumentError(
      "Configuration credential file and environment variable are mutually exclusive",
    )
  }
  return parseConnectorConfigDocument({
    $schema: CONFIG_DOCUMENT_SCHEMA_ID,
    capabilities: options.capabilities ?? {},
    credential: options.credentialFile === undefined
      ? {
          provider: "environment",
          variable: options.credentialVariable ?? DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
        }
      : {
          path: options.credentialFile,
          provider: "file",
        },
    gateway: {
      enabled: options.gatewayEnabled ?? false,
      eventBufferSize: options.gatewayEventBufferSize ?? GATEWAY_DEFAULTS.eventBufferSize,
    },
    identity: {
      applicationId: options.applicationId,
      botId: options.botId,
    },
    limits: options.limits ?? {},
    name: options.name,
    observability: options.observability ?? {},
    readScope: {
      channelIds: [...(options.channelIds ?? [])].sort(),
      guildIds: [...options.guildIds].sort(),
    },
    runtime: options.runtime ?? {},
    schemaVersion: CONFIG_DOCUMENT_SCHEMA_VERSION,
    scopes: options.scopes ?? {},
    storage: options.storage ?? {},
    tools: {
      surface: options.toolSurface,
      toolsets: MCP_TOOLSET_NAMES.filter((entry) => options.toolsets.includes(entry)),
    },
  })
}

class JsonCursor {
  readonly #text: string
  #index = 0

  constructor(text: string) {
    this.#text = text
  }

  assertNoDuplicateKeys(): void {
    this.#skipWhitespace()
    this.#value(0, "$")
    this.#skipWhitespace()
    if (this.#index !== this.#text.length) this.#invalid()
  }

  #invalid(message = "Configuration file is not valid JSON"): never {
    throw new ConfigDocumentError(message)
  }

  #skipWhitespace(): void {
    while (/\s/.test(this.#text[this.#index] || "")) this.#index += 1
  }

  #string(): string {
    if (this.#text[this.#index] !== "\"") this.#invalid()
    const start = this.#index
    this.#index += 1
    let escaped = false
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index]
      this.#index += 1
      if (escaped) {
        escaped = false
        continue
      }
      if (character === "\\") {
        escaped = true
        continue
      }
      if (character === "\"") {
        const raw = this.#text.slice(start, this.#index)
        try {
          return JSON.parse(raw) as string
        } catch (error) {
          throw new ConfigDocumentError("Configuration file is not valid JSON", {
            cause: error,
          })
        }
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) this.#invalid()
    }
    this.#invalid()
  }

  #value(depth: number, path: string): void {
    if (depth > CONFIG_JSON_MAX_DEPTH) {
      this.#invalid("Configuration file exceeds the maximum JSON nesting depth")
    }
    this.#skipWhitespace()
    const character = this.#text[this.#index]
    if (character === "{") return this.#object(depth, path)
    if (character === "[") return this.#array(depth, path)
    if (character === "\"") {
      this.#string()
      return
    }
    const remainder = this.#text.slice(this.#index)
    const token = remainder.match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/)?.[0]
    if (!token) this.#invalid()
    this.#index += token.length
  }

  #object(depth: number, path: string): void {
    this.#index += 1
    this.#skipWhitespace()
    if (this.#text[this.#index] === "}") {
      this.#index += 1
      return
    }
    const keys = new Set<string>()
    while (true) {
      const key = this.#string()
      if (keys.has(key)) {
        throw new ConfigDocumentError(
          `Configuration file contains duplicate object key at ${path}.${key}`,
        )
      }
      keys.add(key)
      this.#skipWhitespace()
      if (this.#text[this.#index] !== ":") this.#invalid()
      this.#index += 1
      this.#value(depth + 1, `${path}.${key}`)
      this.#skipWhitespace()
      const separator = this.#text[this.#index]
      if (separator === "}") {
        this.#index += 1
        return
      }
      if (separator !== ",") this.#invalid()
      this.#index += 1
      this.#skipWhitespace()
    }
  }

  #array(depth: number, path: string): void {
    this.#index += 1
    this.#skipWhitespace()
    if (this.#text[this.#index] === "]") {
      this.#index += 1
      return
    }
    let index = 0
    while (true) {
      this.#value(depth + 1, `${path}[${index}]`)
      index += 1
      this.#skipWhitespace()
      const separator = this.#text[this.#index]
      if (separator === "]") {
        this.#index += 1
        return
      }
      if (separator !== ",") this.#invalid()
      this.#index += 1
      this.#skipWhitespace()
    }
  }
}

export function parseStrictConfigJson(text: string): unknown {
  if (!text.endsWith("\n") || text.includes("\0")) {
    throw new ConfigDocumentError(
      "Configuration file must contain one complete newline-terminated JSON document",
    )
  }
  new JsonCursor(text).assertNoDuplicateKeys()
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof ConfigDocumentError) throw error
    throw new ConfigDocumentError("Configuration file is not valid JSON", { cause: error })
  }
}

export function parseConnectorConfigJson(text: string): ConnectorConfigDocument {
  return parseConnectorConfigDocument(parseStrictConfigJson(text))
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

export function loadConnectorConfigDocumentFile(
  file: string,
  options: {
    platform?: NodeJS.Platform
    processUserId?: number
  } = {},
): ConnectorConfigDocument {
  const normalized = file.trim()
  if (
    !normalized
    || normalized.includes("\0")
    || !isAbsolute(normalized)
    || resolve(normalized) !== normalized
  ) {
    throw new ConfigDocumentError("Configuration file path must be absolute and canonical")
  }
  let handle: number | undefined
  try {
    handle = openSync(normalized, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const opened = fstatSync(handle)
    const linked = lstatSync(normalized)
    const canonical = realpathSync.native(normalized)
    const platform = options.platform ?? process.platform
    const processUserId = options.processUserId
      ?? (typeof process.getuid === "function" ? process.getuid() : undefined)
    if (
      !opened.isFile()
      || !linked.isFile()
      || linked.isSymbolicLink()
      || opened.dev !== linked.dev
      || opened.ino !== linked.ino
      || opened.nlink !== 1
      || opened.size < 3
      || opened.size > CONNECTOR_LIMITS.configBytes
      || canonical !== normalized
      || (
        platform !== "win32"
        && (
          processUserId === undefined
          || ![0, processUserId].includes(opened.uid)
          || (opened.mode & 0o022) !== 0
        )
      )
    ) {
      throw new ConfigDocumentError(
        "Configuration file must be a bounded canonical non-writable regular file owned by the process user or root",
      )
    }
    return parseConnectorConfigJson(readFileSync(handle, "utf8"))
  } catch (error) {
    if (error instanceof ConfigDocumentError) throw error
    const message = isNodeError(error, "ENOENT")
      ? "Configuration file was not found"
      : "Unable to inspect or read configuration file"
    throw new ConfigDocumentError(message, { cause: error })
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

function nonEmptyEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name]?.trim()
  return value ? value : undefined
}

function sameStableCredentialMetadata(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
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

function assertCredentialFileMetadata(
  metadata: BigIntStats,
  options: {
    platform: NodeJS.Platform
    processUserId: number | undefined
  },
): void {
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.nlink !== 1n
    || metadata.size < 1n
    || metadata.size > BigInt(CONNECTOR_LIMITS.credentialFileBytes)
    || (
      options.platform !== "win32"
      && (
        options.processUserId === undefined
        || ![0n, BigInt(options.processUserId)].includes(metadata.uid)
        || (metadata.mode & 0o022n) !== 0n
      )
    )
  ) {
    throw new ConfigDocumentError(
      "Configuration credential file must be a bounded regular file owned by the process user or root with one hard link and no group or world write access",
    )
  }
}

function readBoundedCredentialBytes(
  handle: number,
  expectedBytes: number,
): Buffer {
  const buffer = Buffer.allocUnsafe(
    expectedBytes + CREDENTIAL_FILE_OVERFLOW_PROBE_BYTES,
  )
  let offset = 0
  while (offset < buffer.byteLength) {
    const bytesRead = readSync(
      handle,
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    )
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

export function loadConnectorCredentialFile(
  file: string,
  options: {
    platform?: NodeJS.Platform
    processUserId?: number
  } = {},
): string {
  const reference = parseConnectorCredentialReference({ path: file, provider: "file" })
  if (reference.provider !== "file") {
    throw new ConfigDocumentError("Configuration credential file reference is invalid")
  }
  const platform = options.platform ?? process.platform
  const processUserId = options.processUserId
    ?? (typeof process.getuid === "function" ? process.getuid() : undefined)
  let handle: number | undefined
  try {
    const canonical = realpathSync.native(reference.path)
    const beforePath = lstatSync(canonical, { bigint: true })
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number"
      ? fsConstants.O_NOFOLLOW
      : 0
    handle = openSync(canonical, fsConstants.O_RDONLY | noFollow)
    const beforeRead = fstatSync(handle, { bigint: true })
    assertCredentialFileMetadata(beforePath, { platform, processUserId })
    assertCredentialFileMetadata(beforeRead, { platform, processUserId })
    if (
      beforePath.dev !== beforeRead.dev
      || beforePath.ino !== beforeRead.ino
    ) {
      throw new ConfigDocumentError(
        "Configuration credential file changed while it was opened",
      )
    }
    const bytes = readBoundedCredentialBytes(handle, Number(beforeRead.size))
    const afterRead = fstatSync(handle, { bigint: true })
    const afterPath = lstatSync(canonical, { bigint: true })
    const finalCanonical = realpathSync.native(reference.path)
    if (
      bytes.byteLength !== Number(beforeRead.size)
      || !sameStableCredentialMetadata(beforeRead, afterRead)
      || !sameStableCredentialMetadata(afterRead, afterPath)
      || finalCanonical !== canonical
    ) {
      throw new ConfigDocumentError(
        "Configuration credential file changed while it was read",
      )
    }
    let token: string
    try {
      token = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim()
    } catch (error) {
      throw new ConfigDocumentError(
        "Configuration credential file must contain valid UTF-8",
        { cause: error },
      )
    }
    if (!token || /[\u0000-\u001f\u007f]/u.test(token)) {
      throw new ConfigDocumentError(
        "Configuration credential file must contain one non-empty token without control characters",
      )
    }
    return token
  } catch (error) {
    if (error instanceof ConfigDocumentError) throw error
    const message = isNodeError(error, "ENOENT")
      ? "Configuration credential file was not found"
      : "Unable to inspect or read configuration credential file"
    throw new ConfigDocumentError(message, { cause: error })
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

export function resolveConnectorCredential(
  referenceValue: ConnectorCredentialReference,
  source: NodeJS.ProcessEnv,
): string {
  const reference = parseConnectorCredentialReference(referenceValue)
  if (reference.provider === "file") {
    return loadConnectorCredentialFile(reference.path)
  }
  const value = nonEmptyEnvironmentValue(source, reference.variable)
  if (!value) {
    throw new ConfigDocumentError(
      `Configuration document $.credential requires ${reference.variable}`,
    )
  }
  return value
}

export function connectorConfigJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(CONNECTOR_CONFIG_DOCUMENT_SCHEMA, {
    target: "draft-2020-12",
  }) as Record<string, unknown>
  return {
    ...schema,
    $id: CONFIG_DOCUMENT_SCHEMA_ID,
    description: "Strict non-secret configuration for discord-mcp",
    title: "discord-mcp configuration",
  }
}

export function connectorConfigFields(): readonly ConfigDocumentField[] {
  return Object.freeze([
    {
      defaultValue: undefined,
      description: "Editor schema identifier for this configuration format",
      kind: "string",
      path: "$.$schema",
      required: false,
    },
    {
      defaultValue: CONFIG_DOCUMENT_SCHEMA_VERSION,
      description: "Configuration format version",
      kind: "integer",
      path: "$.schemaVersion",
      required: true,
    },
    {
      defaultValue: undefined,
      description: "Bounded lowercase identifier for this policy",
      kind: "string",
      path: "$.name",
      required: true,
    },
    {
      defaultValue: undefined,
      description: "Environment or bounded file reference for the Discord bot token",
      kind: "secret-reference",
      path: "$.credential",
      required: true,
    },
    ...([
      "$.identity.applicationId",
      "$.identity.botId",
    ] as const).map((path) => ({
      defaultValue: undefined,
      description: path.endsWith("applicationId")
        ? "Expected Discord application identity"
        : "Expected Discord bot user identity",
      kind: "snowflake" as const,
      path,
      required: true,
    })),
    ...([
      ["$.readScope.guildIds", undefined],
      ["$.readScope.channelIds", []],
    ] as const).map(([path, defaultValue]) => ({
      defaultValue,
      description: path.endsWith("guildIds")
        ? "Exact guild allowlist forming the outer read boundary"
        : "Optional exact channel allowlist inside the guild boundary",
      kind: "snowflakes" as const,
      path,
      required: true,
    })),
    {
      defaultValue: "progressive",
      description: "MCP tool discovery surface",
      kind: "string",
      path: "$.tools.surface",
      required: true,
    },
    {
      defaultValue: undefined,
      description: "Canonical MCP toolset selection",
      kind: "strings",
      path: "$.tools.toolsets",
      required: true,
    },
    {
      defaultValue: false,
      description: "Enable the optional privacy-safe Discord Gateway client",
      kind: "boolean",
      path: "$.gateway.enabled",
      required: true,
    },
    {
      defaultValue: GATEWAY_DEFAULTS.eventBufferSize,
      description: "Maximum bounded Gateway event buffer size",
      kind: "integer",
      path: "$.gateway.eventBufferSize",
      required: true,
    },
    ...CONFIG_CAPABILITY_NAMES.map((name) => ({
      defaultValue: false,
      description: capabilityDescription(name),
      kind: "boolean" as const,
      path: `$.capabilities.${name}`,
      required: false,
    })),
    ...CONFIG_SCOPE_NAMES.map((name) => ({
      defaultValue: [],
      description: scopeDescription(name),
      kind: "snowflakes" as const,
      path: `$.scopes.${name}`,
      required: false,
    })),
    ...CONFIG_LIMIT_NAMES.map((name) => ({
      defaultValue: undefined,
      description: `Numeric policy limit for ${humanizeConfigKey(name)}`,
      kind: "integer" as const,
      path: `$.limits.${name}`,
      required: false,
    })),
    ...CONFIG_STORAGE_NAMES.map((name) => ({
      defaultValue: name === "auditFile" ? undefined : [],
      description: name === "auditFile"
        ? "Absolute path for the content-free activity log"
        : storageDescription(name),
      kind: (name === "auditFile" ? "path" : "paths") as "path" | "paths",
      path: `$.storage.${name}`,
      required: false,
    })),
    ...CONFIG_RUNTIME_NAMES.map((name) => ({
      defaultValue: undefined,
      description: `Runtime setting for ${humanizeConfigKey(name)}`,
      kind: "string" as const,
      path: `$.runtime.${name}`,
      required: false,
    })),
    ...([
      ["$.observability.compression", "string"],
      ["$.observability.endpoint", "string"],
      ["$.observability.exportEnabled", "boolean"],
      ["$.observability.headers", "secret-reference"],
      ["$.observability.jsonLogsEnabled", "boolean"],
      ["$.observability.metrics.compression", "string"],
      ["$.observability.metrics.endpoint", "string"],
      ["$.observability.metrics.headers", "secret-reference"],
      ["$.observability.metrics.protocol", "string"],
      ["$.observability.metrics.timeoutMs", "number"],
      ["$.observability.protocol", "string"],
      ["$.observability.serviceName", "string"],
      ["$.observability.timeoutMs", "number"],
      ["$.observability.traceSampleRatio", "number"],
      ["$.observability.traceSampler", "string"],
      ["$.observability.traces.compression", "string"],
      ["$.observability.traces.endpoint", "string"],
      ["$.observability.traces.headers", "secret-reference"],
      ["$.observability.traces.protocol", "string"],
      ["$.observability.traces.timeoutMs", "number"],
    ] as const).map(([path, kind]) => ({
      defaultValue: undefined,
      description: `Observability setting for ${humanizeConfigKey(path.split(".").at(-1) || path)}`,
      kind,
      path,
      required: false,
    })),
  ])
}
