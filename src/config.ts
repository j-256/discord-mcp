import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import {
  CONNECTOR_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
  GATEWAY_DEFAULTS,
  INTERACTION_DEFAULTS,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  parseMcpToolsets,
  parseMcpToolSurface,
} from "./mcp-tool-catalog.js"
import {
  loadObservabilityConfig,
  type ObservabilityConfig,
} from "./observability-config.js"

export interface ConnectorConfig {
  adminGuildIds: ReadonlySet<string>
  allowedChannelIds: ReadonlySet<string>
  allowedGuildIds: ReadonlySet<string>
  allowAdministration: boolean
  allowChannelCreation: boolean
  allowDeletions: boolean
  allowGateway: boolean
  allowInteractions: boolean
  auditFile: string
  channelCreationGuildIds: ReadonlySet<string>
  deleteChannelIds: ReadonlySet<string>
  expectedApplicationId: string | undefined
  gatewayEventBufferSize: number
  interactionChannelIds: ReadonlySet<string>
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  mentionUserIds: ReadonlySet<string>
  mcpToolsets: ReadonlySet<McpToolsetName>
  mcpToolSurface: McpToolSurface
  observability: ObservabilityConfig
  protectedUserIds: ReadonlySet<string>
  token: string
}

export interface ConfigOptions {
  homeDirectory?: string
}

function parseId(value: string, name: string): string {
  const normalized = value.trim()
  if (!DISCORD_SNOWFLAKE_PATTERN.test(normalized)) {
    throw new ConfigurationError(`${name} must contain Discord snowflake IDs`)
  }
  return normalized
}

function parseIdSet(
  value: string | undefined,
  name: string,
  maximum?: number,
): ReadonlySet<string> {
  if (!value?.trim()) return new Set()
  const values = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => parseId(entry, name))
  const result = new Set(values)
  if (maximum !== undefined && result.size > maximum) {
    throw new ConfigurationError(`${name} must contain at most ${maximum} unique IDs`)
  }
  return result
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value.trim() === "") return false
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  throw new ConfigurationError(`${name} must be true or false`)
}

function parseInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return defaultValue
  const normalized = value.trim()
  if (!/^[0-9]+$/.test(normalized)) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  const result = Number(normalized)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return result
}

function defaultAuditFile(environment: NodeJS.ProcessEnv, homeDirectory: string): string {
  const stateRoot = environment.XDG_STATE_HOME?.trim()
  return join(stateRoot || join(homeDirectory, ".local", "state"), "discord-mcp", "activity.jsonl")
}

function auditFile(value: string | undefined, environment: NodeJS.ProcessEnv, homeDirectory: string): string {
  if (!value?.trim()) return defaultAuditFile(environment, homeDirectory)
  const normalized = value.trim()
  return isAbsolute(normalized) ? normalized : resolve(normalized)
}

export function loadConnectorConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: ConfigOptions = {},
): ConnectorConfig {
  const rawToken = environment[ENVIRONMENT_NAMES.token]
  const token = rawToken?.trim()
  if (!token) {
    throw new ConfigurationError(`${ENVIRONMENT_NAMES.token} is required`)
  }

  const allowedChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.allowedChannelIds],
    ENVIRONMENT_NAMES.allowedChannelIds,
  )
  const allowedGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.allowedGuildIds],
    ENVIRONMENT_NAMES.allowedGuildIds,
  )
  const adminGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.adminGuildIds],
    ENVIRONMENT_NAMES.adminGuildIds,
  )
  const channelCreationGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.channelCreationGuildIds],
    ENVIRONMENT_NAMES.channelCreationGuildIds,
  )
  const deleteChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.deleteChannelIds],
    ENVIRONMENT_NAMES.deleteChannelIds,
  )
  const interactionChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.interactionChannelIds],
    ENVIRONMENT_NAMES.interactionChannelIds,
  )
  const mentionUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.mentionUserIds],
    ENVIRONMENT_NAMES.mentionUserIds,
    CONNECTOR_LIMITS.mentionUserAllowlist,
  )
  const protectedUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.protectedUserIds],
    ENVIRONMENT_NAMES.protectedUserIds,
    CONNECTOR_LIMITS.protectedUserAllowlist,
  )

  for (const [name, guildIds] of [
    [ENVIRONMENT_NAMES.adminGuildIds, adminGuildIds],
    [ENVIRONMENT_NAMES.channelCreationGuildIds, channelCreationGuildIds],
  ] as const) {
    for (const guildId of guildIds) {
      if (allowedGuildIds.size === 0 || allowedGuildIds.has(guildId)) continue
      throw new ConfigurationError(
        `${name} must be a subset of ${ENVIRONMENT_NAMES.allowedGuildIds}`,
      )
    }
  }

  for (const [name, channelIds] of [
    [ENVIRONMENT_NAMES.deleteChannelIds, deleteChannelIds],
    [ENVIRONMENT_NAMES.interactionChannelIds, interactionChannelIds],
  ] as const) {
    for (const channelId of channelIds) {
      if (allowedChannelIds.size === 0 || allowedChannelIds.has(channelId)) continue
      throw new ConfigurationError(
        `${name} must be a subset of ${ENVIRONMENT_NAMES.allowedChannelIds}`,
      )
    }
  }

  const applicationIdValue = environment[ENVIRONMENT_NAMES.applicationId]
  const expectedApplicationId = applicationIdValue?.trim()
    ? parseId(applicationIdValue, ENVIRONMENT_NAMES.applicationId)
    : undefined
  const allowGateway = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGateway],
    ENVIRONMENT_NAMES.allowGateway,
  )
  if (allowGateway && !expectedApplicationId) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGateway} requires ${ENVIRONMENT_NAMES.applicationId}`,
    )
  }
  if (allowGateway && allowedGuildIds.size === 0 && allowedChannelIds.size === 0) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGateway} requires an exact guild or channel read allowlist`,
    )
  }

  return {
    adminGuildIds,
    allowedChannelIds,
    allowedGuildIds,
    allowAdministration: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowAdministration],
      ENVIRONMENT_NAMES.allowAdministration,
    ),
    allowChannelCreation: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowChannelCreation],
      ENVIRONMENT_NAMES.allowChannelCreation,
    ),
    allowDeletions: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowDeletions],
      ENVIRONMENT_NAMES.allowDeletions,
    ),
    allowGateway,
    allowInteractions: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowInteractions],
      ENVIRONMENT_NAMES.allowInteractions,
    ),
    auditFile: auditFile(
      environment[ENVIRONMENT_NAMES.auditFile],
      environment,
      options.homeDirectory || homedir(),
    ),
    channelCreationGuildIds,
    deleteChannelIds,
    expectedApplicationId,
    gatewayEventBufferSize: parseInteger(
      environment[ENVIRONMENT_NAMES.gatewayEventBufferSize],
      ENVIRONMENT_NAMES.gatewayEventBufferSize,
      GATEWAY_DEFAULTS.eventBufferSize,
      1,
      CONNECTOR_LIMITS.gatewayEventBufferSize,
    ),
    interactionChannelIds,
    interactionMaxWritesPerMinute: parseInteger(
      environment[ENVIRONMENT_NAMES.interactionMaxWritesPerMinute],
      ENVIRONMENT_NAMES.interactionMaxWritesPerMinute,
      INTERACTION_DEFAULTS.maxWritesPerMinute,
      1,
      CONNECTOR_LIMITS.interactionMaxWritesPerMinute,
    ),
    interactionMinWriteIntervalMs: parseInteger(
      environment[ENVIRONMENT_NAMES.interactionMinWriteIntervalMs],
      ENVIRONMENT_NAMES.interactionMinWriteIntervalMs,
      INTERACTION_DEFAULTS.minWriteIntervalMs,
      0,
      CONNECTOR_LIMITS.interactionMinWriteIntervalMs,
    ),
    mentionUserIds,
    mcpToolsets: parseMcpToolsets(
      environment[ENVIRONMENT_NAMES.toolsets],
      ENVIRONMENT_NAMES.toolsets,
    ),
    mcpToolSurface: parseMcpToolSurface(
      environment[ENVIRONMENT_NAMES.toolSurface],
      ENVIRONMENT_NAMES.toolSurface,
    ),
    observability: loadObservabilityConfig(environment, [rawToken || "", token]),
    protectedUserIds,
    token,
  }
}
