import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"

import type { ConnectorConfig } from "./config.js"
import { loadConnectorConfig } from "./config.js"
import {
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
} from "./constants.js"
import { ConfigurationError, errorMessage, redactText } from "./errors.js"
import {
  createDiscordMcpServer,
  type DiscordToolService,
} from "./mcp.js"
import { ConnectorService } from "./service.js"

export const OPERATOR_REPORT_SCHEMA_VERSION = 1
export const SUPPORTED_NODE_MAJOR = 22

export const DOCTOR_CHECK_IDS = Object.freeze({
  applicationIdentity: "application-identity",
  channelScope: "channel-scope",
  configuration: "configuration",
  deletionPolicy: "deletion-policy",
  guildAccess: "guild-access",
  guildScope: "guild-scope",
  messageContentIntent: "message-content-intent",
  nodeVersion: "node-version",
  token: "token",
})

const DEFAULT_CLI_COMMAND = "discord-mcp"
const DEFAULT_MCP_SERVER_NAME = "discord"
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const STARTUP_TIMEOUT_SECONDS = 30
const TOOL_TIMEOUT_SECONDS = 180

export type DoctorCheckStatus = "fail" | "pass" | "warn"
export type OperatorReportStatus = "error" | "ok" | "warning"

export interface DoctorCheck {
  id: string
  status: DoctorCheckStatus
  summary: string
}

export interface IdentitySummary {
  applicationId: string
  botId: string
  guildsAccessibleOnFirstPage: number
  guildsInScopeOnFirstPage: number
}

export interface DoctorReport {
  checks: DoctorCheck[]
  identity: IdentitySummary | null
  online: boolean
  schemaVersion: number
  status: OperatorReportStatus
}

export interface SetupReport {
  applicationId: string
  botId: string
  client: "host"
  hostConfig: string
  guildsAccessibleOnFirstPage: number
  guildsInScopeOnFirstPage: number
  schemaVersion: number
  serverName: string
  status: "ok"
  warnings: string[]
}

export interface SmokeReport extends IdentitySummary {
  destructiveTools: string[]
  readOnlyTools: string[]
  schemaVersion: number
  status: "ok"
  toolCount: number
}

type ConnectorStatus = Awaited<ReturnType<ConnectorService["getStatus"]>>

export interface StatusProvider {
  getStatus(): Promise<ConnectorStatus>
}

export interface DoctorOptions {
  environment?: NodeJS.ProcessEnv
  nodeVersion?: string
  online?: boolean
  service?: StatusProvider
}

export interface SetupOptions {
  args?: readonly string[]
  command?: string
  environment?: NodeJS.ProcessEnv
  serverName?: string
  service?: StatusProvider
}

export interface SmokeOptions {
  environment?: NodeJS.ProcessEnv
  service?: DiscordToolService
}

function check(
  id: string,
  status: DoctorCheckStatus,
  summary: string,
): DoctorCheck {
  return { id, status, summary }
}

function reportStatus(checks: readonly DoctorCheck[]): OperatorReportStatus {
  if (checks.some((entry) => entry.status === "fail")) return "error"
  if (checks.some((entry) => entry.status === "warn")) return "warning"
  return "ok"
}

function identitySummary(status: ConnectorStatus): IdentitySummary {
  return {
    applicationId: status.application.id,
    botId: status.bot.id,
    guildsAccessibleOnFirstPage: status.guildPage.accessible,
    guildsInScopeOnFirstPage: status.guildPage.inScope,
  }
}

function policyWarnings(config: ConnectorConfig): string[] {
  const warnings: string[] = []
  if (config.allowedGuildIds.size === 0) {
    warnings.push("Guild reads rely only on Discord permissions because no local guild allowlist is configured")
  }
  if (config.allowedChannelIds.size === 0) {
    warnings.push("Channel reads rely only on Discord permissions because no local channel allowlist is configured")
  }
  if (config.allowDeletions && config.deleteChannelIds.size === 0) {
    warnings.push("The deletion toggle is enabled but deletion remains blocked because no deletion-channel allowlist is configured")
  }
  return warnings
}

function redactedError(error: unknown, environment: NodeJS.ProcessEnv): string {
  const token = environment[ENVIRONMENT_NAMES.token]
  return redactText(errorMessage(error), [token, token?.trim()])
}

export async function diagnoseConnector(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const environment = options.environment || process.env
  const nodeVersion = options.nodeVersion || process.versions.node
  const online = options.online || false
  const checks: DoctorCheck[] = []
  const nodeMajor = Number(nodeVersion.split(".")[0])
  checks.push(Number.isInteger(nodeMajor) && nodeMajor >= SUPPORTED_NODE_MAJOR
    ? check(
      DOCTOR_CHECK_IDS.nodeVersion,
      "pass",
      `Node.js ${nodeVersion} satisfies the Node.js ${SUPPORTED_NODE_MAJOR}+ requirement`,
    )
    : check(
      DOCTOR_CHECK_IDS.nodeVersion,
      "fail",
      `Node.js ${nodeVersion} does not satisfy the Node.js ${SUPPORTED_NODE_MAJOR}+ requirement`,
    ))

  const token = environment[ENVIRONMENT_NAMES.token]?.trim()
  checks.push(token
    ? check(
      DOCTOR_CHECK_IDS.token,
      "pass",
      `${ENVIRONMENT_NAMES.token} is present`,
    )
    : check(
      DOCTOR_CHECK_IDS.token,
      "fail",
      `${ENVIRONMENT_NAMES.token} is missing`,
    ))

  let config: ConnectorConfig | undefined
  try {
    config = loadConnectorConfig(environment)
    checks.push(check(
      DOCTOR_CHECK_IDS.configuration,
      "pass",
      "Connector configuration is valid",
    ))
  } catch (error) {
    checks.push(check(
      DOCTOR_CHECK_IDS.configuration,
      "fail",
      redactedError(error, environment),
    ))
  }

  if (config) {
    checks.push(config.expectedApplicationId
      ? check(
        DOCTOR_CHECK_IDS.applicationIdentity,
        "pass",
        `Expected Discord application is pinned to ${config.expectedApplicationId}`,
      )
      : check(
        DOCTOR_CHECK_IDS.applicationIdentity,
        "warn",
        `${ENVIRONMENT_NAMES.applicationId} is not set, so token identity is not pinned locally`,
      ))
    checks.push(config.allowedGuildIds.size > 0
      ? check(
        DOCTOR_CHECK_IDS.guildScope,
        "pass",
        `Local guild allowlist contains ${config.allowedGuildIds.size} entries`,
      )
      : check(
        DOCTOR_CHECK_IDS.guildScope,
        "warn",
        "Local guild allowlist is open; Discord permissions are the guild boundary",
      ))
    checks.push(config.allowedChannelIds.size > 0
      ? check(
        DOCTOR_CHECK_IDS.channelScope,
        "pass",
        `Local channel allowlist contains ${config.allowedChannelIds.size} entries`,
      )
      : check(
        DOCTOR_CHECK_IDS.channelScope,
        "warn",
        "Local channel allowlist is open; Discord permissions are the channel boundary",
      ))
    if (!config.allowDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.deletionPolicy,
        "pass",
        "Message deletion is disabled",
      ))
    } else if (config.deleteChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.deletionPolicy,
        "warn",
        "Deletion toggle is enabled, but the required deletion-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.deletionPolicy,
        "pass",
        `Message deletion is constrained to ${config.deleteChannelIds.size} channels`,
      ))
    }
  }

  let identity: IdentitySummary | null = null
  if (online) {
    if (!config) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildAccess,
        "fail",
        "Online verification requires valid connector configuration",
      ))
    } else {
      try {
        const service = options.service || new ConnectorService({ config })
        const status = await service.getStatus()
        identity = identitySummary(status)
        checks.push(check(
          DOCTOR_CHECK_IDS.guildAccess,
          status.guildPage.inScope > 0 ? "pass" : "fail",
          status.guildPage.inScope > 0
            ? `Verified application ${status.application.id}, bot ${status.bot.id}, and ${status.guildPage.inScope} in-scope guilds on the first page`
            : `Verified application ${status.application.id} and bot ${status.bot.id}, but no accessible guilds are in local scope`,
        ))
        checks.push(status.application.messageContentIntent === "enabled"
          ? check(
            DOCTOR_CHECK_IDS.messageContentIntent,
            "pass",
            "Discord application advertises Message Content intent for native search",
          )
          : check(
            DOCTOR_CHECK_IDS.messageContentIntent,
            "warn",
            status.application.messageContentIntent === "disabled"
              ? "Discord application does not advertise Message Content intent; native message search may be unavailable"
              : "Discord application did not expose enough flags to diagnose Message Content intent",
          ))
      } catch (error) {
        checks.push(check(
          DOCTOR_CHECK_IDS.guildAccess,
          "fail",
          redactedError(error, environment),
        ))
      }
    }
  }

  return {
    checks,
    identity,
    online,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: reportStatus(checks),
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

export function renderHostConfiguration(options: {
  applicationId: string
  args?: readonly string[]
  command?: string
  serverName?: string
}): string {
  const applicationId = options.applicationId.trim()
  if (!DISCORD_SNOWFLAKE_PATTERN.test(applicationId)) {
    throw new ConfigurationError("Verified Discord application ID must be a snowflake")
  }
  const serverName = options.serverName?.trim() || DEFAULT_MCP_SERVER_NAME
  if (!MCP_SERVER_NAME_PATTERN.test(serverName)) {
    throw new ConfigurationError("MCP server name may contain only letters, numbers, underscores, and hyphens")
  }
  const command = options.command?.trim() || DEFAULT_CLI_COMMAND
  if (!command) throw new ConfigurationError("MCP server command must not be empty")
  const args = options.args || ["serve"]
  const environmentVariables = [
    ENVIRONMENT_NAMES.token,
    ENVIRONMENT_NAMES.allowedGuildIds,
    ENVIRONMENT_NAMES.allowedChannelIds,
    ENVIRONMENT_NAMES.allowDeletions,
    ENVIRONMENT_NAMES.deleteChannelIds,
    ENVIRONMENT_NAMES.auditFile,
  ]
  const environmentLines = environmentVariables.map((name, index) => (
    `  ${tomlString(name)}${index < environmentVariables.length - 1 ? "," : ""}`
  ))
  return [
    `[mcp_servers.${serverName}]`,
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    "required = true",
    `startup_timeout_sec = ${STARTUP_TIMEOUT_SECONDS}`,
    `tool_timeout_sec = ${TOOL_TIMEOUT_SECONDS}`,
    "default_tools_approval_mode = \"writes\"",
    "env_vars = [",
    ...environmentLines,
    "]",
    "",
    `[mcp_servers.${serverName}.env]`,
    `${ENVIRONMENT_NAMES.applicationId} = ${tomlString(applicationId)}`,
  ].join("\n")
}

export async function prepareSetup(
  options: SetupOptions = {},
): Promise<SetupReport> {
  const environment = options.environment || process.env
  const config = loadConnectorConfig(environment)
  const service = options.service || new ConnectorService({ config })
  const status = await service.getStatus()
  if (status.guildPage.inScope < 1) {
    throw new ConfigurationError("Discord bot has no accessible guilds inside the configured local scope")
  }
  const serverName = options.serverName?.trim() || DEFAULT_MCP_SERVER_NAME
  return {
    applicationId: status.application.id,
    botId: status.bot.id,
    client: "host",
    hostConfig: renderHostConfiguration({
      applicationId: status.application.id,
      ...(options.args ? { args: options.args } : {}),
      ...(options.command ? { command: options.command } : {}),
      serverName,
    }),
    guildsAccessibleOnFirstPage: status.guildPage.accessible,
    guildsInScopeOnFirstPage: status.guildPage.inScope,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName,
    status: "ok",
    warnings: [
      ...policyWarnings(config),
      ...(status.application.messageContentIntent === "enabled"
        ? []
        : ["Discord application does not advertise confirmed Message Content intent, so native search may be unavailable"]),
    ],
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringProperty(value: unknown, property: string): string | undefined {
  const record = objectValue(value)
  return typeof record?.[property] === "string" ? record[property] : undefined
}

function numberProperty(value: unknown, property: string): number | undefined {
  const record = objectValue(value)
  return typeof record?.[property] === "number" ? record[property] : undefined
}

export async function smokeConnector(
  options: SmokeOptions = {},
): Promise<SmokeReport> {
  const environment = options.environment || process.env
  const server = createDiscordMcpServer({
    environment,
    ...(options.service ? { service: options.service } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: `${CONNECTOR_NAME}-smoke`, version: CONNECTOR_VERSION },
    { capabilities: {} },
  )

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const listed = await client.listTools()
    if (listed.tools.some((tool) => (
      typeof tool.annotations?.destructiveHint !== "boolean"
      || typeof tool.annotations.idempotentHint !== "boolean"
      || typeof tool.annotations.openWorldHint !== "boolean"
      || typeof tool.annotations.readOnlyHint !== "boolean"
    ))) {
      throw new Error("MCP smoke check found a tool without complete risk annotations")
    }
    const deletion = listed.tools.find((tool) => tool.name === "delete_messages")
    if (
      !deletion
      || deletion.annotations?.destructiveHint !== true
      || deletion.annotations.idempotentHint !== true
      || deletion.annotations.openWorldHint !== true
      || deletion.annotations.readOnlyHint !== false
    ) {
      throw new Error("MCP smoke check found invalid delete_messages annotations")
    }
    const result = await client.callTool({
      arguments: {},
      name: "get_connector_status",
    })
    const structured = objectValue(result.structuredContent)
    if (result.isError || structured?.status !== "ok") {
      throw new Error("MCP get_connector_status smoke call failed")
    }
    const applicationId = stringProperty(structured.application, "id")
    const botId = stringProperty(structured.bot, "id")
    const guildsAccessible = numberProperty(structured.guildPage, "accessible")
    const guildsInScope = numberProperty(structured.guildPage, "inScope")
    if (
      !applicationId
      || !botId
      || guildsAccessible === undefined
      || guildsInScope === undefined
    ) {
      throw new Error("MCP get_connector_status returned an invalid identity report")
    }
    if (guildsInScope < 1) {
      throw new Error("MCP get_connector_status found no accessible guilds inside local scope")
    }
    return {
      applicationId,
      botId,
      destructiveTools: listed.tools
        .filter((tool) => tool.annotations?.destructiveHint === true)
        .map((tool) => tool.name)
        .sort(),
      guildsAccessibleOnFirstPage: guildsAccessible,
      guildsInScopeOnFirstPage: guildsInScope,
      readOnlyTools: listed.tools
        .filter((tool) => tool.annotations?.readOnlyHint === true)
        .map((tool) => tool.name)
        .sort(),
      schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
      status: "ok",
      toolCount: listed.tools.length,
    }
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}
