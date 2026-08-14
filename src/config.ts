import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import {
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"

export interface ConnectorConfig {
  allowedChannelIds: ReadonlySet<string>
  allowedGuildIds: ReadonlySet<string>
  allowDeletions: boolean
  auditFile: string
  deleteChannelIds: ReadonlySet<string>
  expectedApplicationId: string | undefined
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

function parseIdSet(value: string | undefined, name: string): ReadonlySet<string> {
  if (!value?.trim()) return new Set()
  const values = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => parseId(entry, name))
  return new Set(values)
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value.trim() === "") return false
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  throw new ConfigurationError(`${name} must be true or false`)
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
  const deleteChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.deleteChannelIds],
    ENVIRONMENT_NAMES.deleteChannelIds,
  )

  for (const channelId of deleteChannelIds) {
    if (allowedChannelIds.size > 0 && !allowedChannelIds.has(channelId)) {
      throw new ConfigurationError(
        `${ENVIRONMENT_NAMES.deleteChannelIds} must be a subset of ${ENVIRONMENT_NAMES.allowedChannelIds}`,
      )
    }
  }

  const applicationIdValue = environment[ENVIRONMENT_NAMES.applicationId]
  const expectedApplicationId = applicationIdValue?.trim()
    ? parseId(applicationIdValue, ENVIRONMENT_NAMES.applicationId)
    : undefined

  return {
    allowedChannelIds,
    allowedGuildIds,
    allowDeletions: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowDeletions],
      ENVIRONMENT_NAMES.allowDeletions,
    ),
    auditFile: auditFile(
      environment[ENVIRONMENT_NAMES.auditFile],
      environment,
      options.homeDirectory || homedir(),
    ),
    deleteChannelIds,
    expectedApplicationId,
    token,
  }
}
