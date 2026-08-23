import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
  type McpToolsetName,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  selectedCanonicalMcpToolNames,
  selectedMcpToolsets,
} from "./mcp-tool-catalog.js"
import {
  MCP_TOOL_RISK_CLASSES,
  type McpToolName,
  type McpToolRiskClass,
} from "./observability-catalog.js"
import {
  DISCORD_PERMISSIONS,
  DISCORD_PERMISSION_NAMES,
  type DiscordPermissionName,
} from "./permissions.js"

export const SETUP_PRESET_NAMES = Object.freeze([
  "server-observer",
  "channel-reader",
] as const)

export type SetupPresetName = typeof SETUP_PRESET_NAMES[number]
export type SetupPresetChannelScope = "optional" | "required"
export type SetupPresetMessageContentIntent = "not-required" | "recommended"

export interface SetupPresetPrivilegedIntent {
  readonly name: "MESSAGE_CONTENT"
  readonly status: "recommended"
}

const READ_ONLY_RISK_CLASSES = Object.freeze([
  "discord-read",
  "local-read",
] as const satisfies readonly McpToolRiskClass[])

interface SetupPresetSource {
  botPermissions: readonly DiscordPermissionName[]
  channelScope: SetupPresetChannelScope
  description: string
  messageContentIntent: SetupPresetMessageContentIntent
  name: SetupPresetName
  recommended: boolean
  toolsets: readonly McpToolsetName[]
}

export interface SetupPresetDescriptor {
  readonly description: string
  readonly gatewayEnabled: false
  readonly name: SetupPresetName
  readonly recommended: boolean
  readonly requirements: {
    readonly botPermissionBitfield: string
    readonly botPermissions: readonly DiscordPermissionName[]
    readonly channelIds: SetupPresetChannelScope
    readonly guildIds: "required"
    readonly messageContentIntent: SetupPresetMessageContentIntent
    readonly privilegedIntents: readonly SetupPresetPrivilegedIntent[]
    readonly threadScope: "inherits-allowlisted-parent"
  }
  readonly riskClasses: readonly McpToolRiskClass[]
  readonly toolNames: readonly McpToolName[]
  readonly toolsets: readonly McpToolsetName[]
  readonly toolSurface: "full"
  readonly writeCapable: false
}

export interface AppliedSetupPreset {
  readonly environment: NodeJS.ProcessEnv
  readonly preset: SetupPresetDescriptor
}

export interface SetupPresetSelection {
  channelIds?: readonly string[]
  guildIds: readonly string[]
  name: string
}

export interface ApplySetupPresetOptions extends SetupPresetSelection {
  environment?: NodeJS.ProcessEnv
}

const PRESET_SOURCES = Object.freeze([
  {
    botPermissions: ["VIEW_CHANNEL"],
    channelScope: "optional",
    description: "Inspect guild metadata, roles, permissions, connector health, observability state, and content-free activity within exact guild scope.",
    messageContentIntent: "not-required",
    name: "server-observer",
    recommended: true,
    toolsets: [
      "activity",
      "connector",
      "guilds",
      "observability",
      "permissions",
      "roles",
    ],
  },
  {
    botPermissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
    channelScope: "required",
    description: "Read and search messages within exact channel scope, including documented child-thread inheritance, while retaining bounded guild, role, permission, connector, observability, and content-free activity inspection.",
    messageContentIntent: "recommended",
    name: "channel-reader",
    recommended: false,
    toolsets: [
      "activity",
      "connector",
      "guilds",
      "messages",
      "observability",
      "permissions",
      "roles",
    ],
  },
] as const satisfies readonly SetupPresetSource[])

const PRESERVED_PRESET_ENVIRONMENT_NAMES = new Set<string>([
  ENVIRONMENT_NAMES.applicationId,
  ENVIRONMENT_NAMES.botId,
  ENVIRONMENT_NAMES.token,
])
const CONNECTOR_ENVIRONMENT_NAMES = new Set<string>(
  Object.values(ENVIRONMENT_NAMES),
)

function isConnectorEnvironmentName(name: string): boolean {
  return name.startsWith("DISCORD_MCP_") || name.startsWith("OTEL_")
}

function createSetupPresetDescriptor(
  source: SetupPresetSource,
): SetupPresetDescriptor {
  const botPermissions = [...source.botPermissions]
  if (new Set(botPermissions).size !== botPermissions.length) {
    throw new Error(`Setup preset ${source.name} includes duplicate bot permissions`)
  }
  const canonicalBotPermissions = DISCORD_PERMISSION_NAMES.filter((name) => (
    botPermissions.includes(name)
  ))
  if (
    canonicalBotPermissions.length !== botPermissions.length
    || canonicalBotPermissions.some((name, index) => name !== botPermissions[index])
  ) {
    throw new Error(`Setup preset ${source.name} must use canonical bot permissions`)
  }
  if (botPermissions.includes("ADMINISTRATOR")) {
    throw new Error(`Setup preset ${source.name} cannot request Administrator`)
  }
  const botPermissionBitfield = botPermissions.reduce(
    (permissions, name) => permissions | DISCORD_PERMISSIONS[name],
    0n,
  ).toString()
  const privilegedIntents = source.messageContentIntent === "recommended"
    ? [Object.freeze({
        name: "MESSAGE_CONTENT" as const,
        status: "recommended" as const,
      })]
    : []
  const toolsets = selectedMcpToolsets(new Set(source.toolsets))
  if (
    toolsets.length !== source.toolsets.length
    || toolsets.some((toolset, index) => toolset !== source.toolsets[index])
  ) {
    throw new Error(`Setup preset ${source.name} must use unique canonical toolsets`)
  }
  const toolNames = [
    MCP_DISCOVERY_TOOL_NAME,
    ...selectedCanonicalMcpToolNames(new Set(toolsets)),
  ].sort() as McpToolName[]
  if (new Set(toolNames).size !== toolNames.length) {
    throw new Error(`Setup preset ${source.name} includes duplicate tools`)
  }
  const emptyToolset = toolsets.find((toolset) => (
    selectedCanonicalMcpToolNames(new Set([toolset])).length === 0
  ))
  if (emptyToolset) {
    throw new Error(
      `Setup preset ${source.name} includes empty toolset ${emptyToolset}`,
    )
  }
  const unsafeTool = toolNames.find((name) => (
    !READ_ONLY_RISK_CLASSES.some((risk) => risk === MCP_TOOL_RISK_CLASSES[name])
  ))
  if (unsafeTool) {
    throw new Error(
      `Setup preset ${source.name} includes non-read-only tool ${unsafeTool}`,
    )
  }
  return Object.freeze({
    description: source.description,
    gatewayEnabled: false,
    name: source.name,
    recommended: source.recommended,
    requirements: Object.freeze({
      botPermissionBitfield,
      botPermissions: Object.freeze(botPermissions),
      channelIds: source.channelScope,
      guildIds: "required" as const,
      messageContentIntent: source.messageContentIntent,
      privilegedIntents: Object.freeze(privilegedIntents),
      threadScope: "inherits-allowlisted-parent" as const,
    }),
    riskClasses: READ_ONLY_RISK_CLASSES,
    toolNames: Object.freeze(toolNames),
    toolsets: Object.freeze(toolsets),
    toolSurface: "full" as const,
    writeCapable: false,
  })
}

export const SETUP_PRESETS = Object.freeze(
  PRESET_SOURCES.map(createSetupPresetDescriptor),
)

export function normalizeSetupPresetName(value: string): SetupPresetName {
  if (typeof value !== "string") {
    throw new ConfigurationError("Setup preset name must be a string")
  }
  const normalized = value.trim().toLowerCase()
  if (!(SETUP_PRESET_NAMES as readonly string[]).includes(normalized)) {
    throw new ConfigurationError(
      `Setup preset must be one of: ${SETUP_PRESET_NAMES.join(", ")}`,
    )
  }
  return normalized as SetupPresetName
}

export function getSetupPreset(value: string): SetupPresetDescriptor {
  const name = normalizeSetupPresetName(value)
  return SETUP_PRESETS.find((preset) => preset.name === name) as SetupPresetDescriptor
}

function exactSnowflakes(
  values: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string[] {
  if (
    !Array.isArray(values)
    || values.length < minimum
    || values.length > maximum
  ) {
    throw new ConfigurationError(
      `${label} must contain ${minimum}-${maximum} Discord snowflakes`,
    )
  }
  const normalized = values.map((value) => (
    typeof value === "string" ? value.trim() : ""
  ))
  if (normalized.some((value) => !DISCORD_SNOWFLAKE_PATTERN.test(value))) {
    throw new ConfigurationError(`${label} must contain Discord snowflakes`)
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new ConfigurationError(`${label} must contain unique Discord snowflakes`)
  }
  return normalized.sort()
}

export function applySetupPreset(
  options: ApplySetupPresetOptions,
): AppliedSetupPreset {
  const preset = getSetupPreset(options.name)
  const guildIds = exactSnowflakes(
    options.guildIds,
    "Setup preset guild scope",
    1,
    DISCORD_LIMITS.currentUserGuilds,
  )
  const channelIds = exactSnowflakes(
    options.channelIds ?? [],
    "Setup preset channel scope",
    preset.requirements.channelIds === "required" ? 1 : 0,
    DISCORD_LIMITS.searchChannelIds,
  )
  const environment = { ...(options.environment || process.env) }
  for (const name of Object.keys(environment)) {
    if (
      !PRESERVED_PRESET_ENVIRONMENT_NAMES.has(name)
      && (CONNECTOR_ENVIRONMENT_NAMES.has(name) || isConnectorEnvironmentName(name))
    ) {
      delete environment[name]
    }
  }
  environment[ENVIRONMENT_NAMES.allowedGuildIds] = guildIds.join(",")
  environment[ENVIRONMENT_NAMES.allowedChannelIds] = channelIds.join(",")
  environment[ENVIRONMENT_NAMES.allowGateway] = "false"
  environment[ENVIRONMENT_NAMES.toolSurface] = preset.toolSurface
  environment[ENVIRONMENT_NAMES.toolsets] = preset.toolsets.join(",")
  return { environment, preset }
}
