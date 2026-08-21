import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"

import type { ConnectorConfig } from "./config.js"
import { loadConnectorConfig } from "./config.js"
import {
  CONNECTOR_LIMITS,
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { ConfigurationError, errorMessage, redactText } from "./errors.js"
import {
  MCP_RESOURCE_TEMPLATE_URIS,
  MCP_RESOURCE_URIS,
  selectedMcpPromptNames,
} from "./mcp-guidance.js"
import {
  createDiscordMcpServer,
  type DiscordToolService,
} from "./mcp.js"
import {
  selectedCanonicalMcpToolNames,
  selectedMcpToolsets,
} from "./mcp-tool-catalog.js"
import {
  activateCredentialEnvironment,
  createConnectorProfile,
  normalizeCredentialEnvironmentName,
  normalizeProfileName,
  parseConnectorProfile,
  PROFILE_MANAGED_ENVIRONMENT_NAMES,
  saveProfile,
  type ConnectorProfile,
} from "./profile.js"
import { ConnectorService } from "./service.js"

export const OPERATOR_REPORT_SCHEMA_VERSION = 4
export const SUPPORTED_NODE_MAJOR = 22

export const DOCTOR_CHECK_IDS = Object.freeze({
  administrationPolicy: "administration-policy",
  applicationIdentity: "application-identity",
  attachmentPolicy: "attachment-policy",
  botIdentity: "bot-identity",
  channelCreationPolicy: "channel-creation-policy",
  channelScope: "channel-scope",
  configuration: "configuration",
  deletionPolicy: "deletion-policy",
  forumPostPolicy: "forum-post-policy",
  guildAccess: "guild-access",
  guildMembersIntent: "guild-members-intent",
  guildScope: "guild-scope",
  gatewayPolicy: "gateway-policy",
  guildScaffoldPolicy: "guild-scaffold-policy",
  interactionPolicy: "interaction-policy",
  memberDirectoryPolicy: "member-directory-policy",
  messageContentIntent: "message-content-intent",
  messagePinPolicy: "message-pin-policy",
  nodeVersion: "node-version",
  observability: "observability",
  permissionOverwritePolicy: "permission-overwrite-policy",
  roleCreationPolicy: "role-creation-policy",
  token: "token",
  toolSurface: "tool-surface",
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
  guildsAccessibleOnFirstPage: number
  guildsInScopeOnFirstPage: number
  launch: StdioLaunchDescriptor
  profile: ConnectorProfile | null
  schemaVersion: number
  serverName: string
  status: "ok"
  toolsets: McpToolsetName[]
  toolSurface: McpToolSurface
  warnings: string[]
}

export interface StdioLaunchDescriptor {
  args: string[]
  command: string
  environment: {
    forward: string[]
    set: Record<string, string>
  }
  requirements: {
    elicitation: "required-for-reviewed-writes"
    requiredServer: true
    toolApproval: "writes"
  }
  serverName: string
  timeouts: {
    startupSeconds: number
    toolSeconds: number
  }
  transport: "stdio"
}

export interface SmokeReport extends IdentitySummary {
  destructiveTools: string[]
  promptNames: string[]
  readOnlyTools: string[]
  resourceTemplateUris: string[]
  resourceUris: string[]
  schemaVersion: number
  status: "ok"
  toolCount: number
  toolsets: McpToolsetName[]
  toolSurface: McpToolSurface
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
  credentialVariable?: string
  environment?: NodeJS.ProcessEnv
  overwriteProfile?: boolean
  profileDirectory?: string
  profileName?: string
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
  if (config.allowPinManagement && config.pinChannelIds.size === 0) {
    warnings.push("The message-pin toggle is enabled but pin management remains blocked because no pin-channel allowlist is configured")
  }
  if (
    config.allowPermissionOverwrites
    && config.permissionOverwriteChannelIds.size === 0
  ) {
    warnings.push("The permission-overwrite toggle is enabled but channel permission changes remain blocked because an exact channel allowlist is required")
  }
  if (config.allowForumPosts && config.forumPostChannelIds.size === 0) {
    warnings.push("The forum-post toggle is enabled but forum-post creation remains blocked because no forum-channel allowlist is configured")
  }
  if (
    config.allowAttachments
    && (config.attachmentChannelIds.size === 0 || config.attachmentRoots.length === 0)
  ) {
    warnings.push("The attachment toggle is enabled but attachment messages remain blocked because an attachment-channel allowlist and canonical attachment roots are both required")
  }
  if (config.allowAdministration && config.adminGuildIds.size === 0) {
    warnings.push("The administration toggle is enabled but administration remains blocked because no administration-guild allowlist is configured")
  }
  if (config.allowChannelCreation && config.channelCreationGuildIds.size === 0) {
    warnings.push("The channel-creation toggle is enabled but channel creation remains blocked because no channel-creation guild allowlist is configured")
  }
  if (config.allowRoleCreation && config.roleCreationGuildIds.size === 0) {
    warnings.push("The role-creation toggle is enabled but role creation remains blocked because no role-creation guild allowlist is configured")
  }
  if (config.allowGuildScaffolds && config.guildScaffoldGuildIds.size === 0) {
    warnings.push("The guild-scaffold toggle is enabled but scaffold execution remains blocked because no guild-scaffold allowlist is configured")
  }
  if (config.allowInteractions && config.interactionChannelIds.size === 0) {
    warnings.push("The interaction toggle is enabled but interactions remain blocked because no interaction-channel allowlist is configured")
  }
  if (config.allowMemberDirectory && config.memberDirectoryGuildIds.size === 0) {
    warnings.push("The member-directory toggle is enabled but member lookup remains blocked because an exact guild allowlist is required")
  }
  for (const [enabled, toolset, capability] of [
    [config.allowAdministration, "moderation", "Member administration"],
    [config.allowAttachments, "attachments", "Attachment messages"],
    [config.allowChannelCreation, "channel-creation", "Channel creation"],
    [config.allowDeletions, "deletion", "Message deletion"],
    [config.allowForumPosts, "forum-posts", "Forum-post creation"],
    [config.allowGateway, "gateway", "Gateway events"],
    [config.allowGuildScaffolds, "guild-scaffolds", "Guild scaffolds"],
    [config.allowInteractions, "interactions", "Message interactions"],
    [config.allowMemberDirectory, "members", "Member directory"],
    [config.allowPinManagement, "pins", "Message pin management"],
    [config.allowPermissionOverwrites, "permission-overwrites", "Channel permission overwrites"],
    [config.allowRoleCreation, "role-creation", "Role creation"],
  ] as const) {
    if (enabled && !config.mcpToolsets.has(toolset)) {
      warnings.push(`${capability} is enabled by policy but omitted from the MCP ${toolset} toolset`)
    }
  }
  if (
    config.observability.exportEnabled
    && !config.observability.export?.endpointConfigured
  ) {
    warnings.push("OTLP export uses the default loopback collector because no endpoint is explicitly configured")
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
    checks.push(config.expectedBotId
      ? check(
        DOCTOR_CHECK_IDS.botIdentity,
        "pass",
        `Expected Discord bot is pinned to ${config.expectedBotId}`,
      )
      : check(
        DOCTOR_CHECK_IDS.botIdentity,
        "warn",
        `${ENVIRONMENT_NAMES.botId} is not set, so bot identity is not pinned locally`,
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
    checks.push(check(
      DOCTOR_CHECK_IDS.toolSurface,
      "pass",
      `MCP tool surface is ${config.mcpToolSurface} with ${config.mcpToolsets.size} of ${MCP_TOOLSET_NAMES.length} risk-separated toolsets and ${selectedCanonicalMcpToolNames(config.mcpToolsets).length} canonical tools`,
    ))
    if (!config.allowAttachments) {
      checks.push(check(
        DOCTOR_CHECK_IDS.attachmentPolicy,
        "pass",
        "Reviewed attachment messages are disabled",
      ))
    } else if (
      config.attachmentChannelIds.size === 0
      || config.attachmentRoots.length === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.attachmentPolicy,
        "warn",
        "Attachment toggle is enabled, but an attachment-channel allowlist and canonical attachment roots are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.attachmentPolicy,
        "pass",
        `Reviewed attachment messages are constrained to ${config.attachmentChannelIds.size} channels and ${config.attachmentRoots.length} canonical roots with a ${config.attachmentMaxBytes}-byte ceiling and one-shot execution`,
      ))
    }
    if (!config.allowAdministration) {
      checks.push(check(
        DOCTOR_CHECK_IDS.administrationPolicy,
        "pass",
        "Member administration is disabled",
      ))
    } else if (config.adminGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.administrationPolicy,
        "warn",
        "Administration toggle is enabled, but the required administration-guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.administrationPolicy,
        "pass",
        `Member administration is constrained to ${config.adminGuildIds.size} guilds with ${config.protectedUserIds.size} protected users`,
      ))
    }
    if (!config.allowChannelCreation) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCreationPolicy,
        "pass",
        "Additive channel creation is disabled",
      ))
    } else if (config.channelCreationGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCreationPolicy,
        "warn",
        "Channel-creation toggle is enabled, but the required channel-creation guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCreationPolicy,
        "pass",
        `Additive channel creation is constrained to ${config.channelCreationGuildIds.size} guilds with reviewed one-shot execution`,
      ))
    }
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
    if (!config.allowForumPosts) {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumPostPolicy,
        "pass",
        "Reviewed forum-post creation is disabled",
      ))
    } else if (config.forumPostChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumPostPolicy,
        "warn",
        "Forum-post toggle is enabled, but the required forum-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumPostPolicy,
        "pass",
        `Reviewed forum-post creation is constrained to ${config.forumPostChannelIds.size} exact channels with one-shot execution and exact readback`,
      ))
    }
    if (!config.allowPinManagement) {
      checks.push(check(
        DOCTOR_CHECK_IDS.messagePinPolicy,
        "pass",
        "Reviewed message pin management is disabled",
      ))
    } else if (config.pinChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.messagePinPolicy,
        "warn",
        "Message-pin toggle is enabled, but the required pin-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.messagePinPolicy,
        "pass",
        `Reviewed message pin management is constrained to ${config.pinChannelIds.size} exact channels with one-shot execution and exact state plus review-snapshot readback`,
      ))
    }
    if (!config.allowPermissionOverwrites) {
      checks.push(check(
        DOCTOR_CHECK_IDS.permissionOverwritePolicy,
        "pass",
        "Reviewed channel permission-overwrite changes are disabled",
      ))
    } else if (config.permissionOverwriteChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.permissionOverwritePolicy,
        "warn",
        "Permission-overwrite toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.permissionOverwritePolicy,
        "pass",
        `Reviewed channel permission-overwrite changes are constrained to ${config.permissionOverwriteChannelIds.size} exact channels with named deltas, one-shot execution, and full-set readback`,
      ))
    }
    if (!config.allowRoleCreation) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleCreationPolicy,
        "pass",
        "Additive role creation is disabled",
      ))
    } else if (config.roleCreationGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleCreationPolicy,
        "warn",
        "Role-creation toggle is enabled, but the required role-creation guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleCreationPolicy,
        "pass",
        `Additive role creation is constrained to ${config.roleCreationGuildIds.size} guilds with reviewed one-shot execution`,
      ))
    }
    if (!config.allowGuildScaffolds) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildScaffoldPolicy,
        "pass",
        "Reviewed additive guild scaffolds are disabled",
      ))
    } else if (config.guildScaffoldGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildScaffoldPolicy,
        "warn",
        "Guild-scaffold toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildScaffoldPolicy,
        "pass",
        `Reviewed additive guild scaffolds are constrained to ${config.guildScaffoldGuildIds.size} guilds with durable bounded resumption`,
      ))
    }
    if (!config.allowInteractions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.interactionPolicy,
        "pass",
        "Message interactions are disabled",
      ))
    } else if (config.interactionChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.interactionPolicy,
        "warn",
        "Interaction toggle is enabled, but the required interaction-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.interactionPolicy,
        "pass",
        `Message interactions are constrained to ${config.interactionChannelIds.size} channels with ${config.mentionUserIds.size} notification users and a ${config.interactionMaxWritesPerMinute}-write rolling budget`,
      ))
    }
    if (!config.allowMemberDirectory) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberDirectoryPolicy,
        "pass",
        "Member-directory reads are disabled",
      ))
    } else if (config.memberDirectoryGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberDirectoryPolicy,
        "warn",
        "Member-directory toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberDirectoryPolicy,
        "pass",
        `Member-directory reads are constrained to ${config.memberDirectoryGuildIds.size} exact guilds with bounded privacy-minimized pages`,
      ))
    }
    checks.push(config.allowGateway
      ? check(
        DOCTOR_CHECK_IDS.gatewayPolicy,
        "pass",
        `Discord Gateway events are enabled with a ${config.gatewayEventBufferSize}-event content-free buffer and only nonprivileged intents`,
      )
      : check(
        DOCTOR_CHECK_IDS.gatewayPolicy,
        "pass",
        "Discord Gateway events are disabled",
      ))
    const exporter = config.observability.export
    const exporterSummary = config.observability.exportEnabled
      ? `OTLP/HTTP protobuf export is enabled with ${exporter?.endpointConfigured ? "explicit collector endpoints" : "the default loopback collector"} and ${exporter?.headersConfigured ? "configured authentication headers" : "no authentication headers"}`
      : "OTLP export is disabled; process-local aggregates remain available"
    checks.push(check(
      DOCTOR_CHECK_IDS.observability,
      "pass",
      `${exporterSummary}; structured stderr logs are ${config.observability.jsonLogsEnabled ? "enabled" : "disabled"}`,
    ))
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
        if (!config.allowMemberDirectory || config.memberDirectoryGuildIds.size === 0) {
          checks.push(check(
            DOCTOR_CHECK_IDS.guildMembersIntent,
            "pass",
            "Member directory is disabled, so Guild Members privileged intent is not required for it",
          ))
        } else if (status.application.guildMembersIntent === "enabled") {
          checks.push(check(
            DOCTOR_CHECK_IDS.guildMembersIntent,
            "pass",
            "Discord application advertises Guild Members intent required for member-directory listing",
          ))
        } else {
          checks.push(check(
            DOCTOR_CHECK_IDS.guildMembersIntent,
            status.application.guildMembersIntent === "disabled" ? "fail" : "warn",
            status.application.guildMembersIntent === "disabled"
              ? "Discord application does not advertise Guild Members intent; configured member listing will fail"
              : "Discord application did not expose enough flags to diagnose Guild Members intent",
          ))
        }
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

export function createStdioLaunchDescriptor(options: {
  applicationId: string
  args?: readonly string[]
  botId: string
  command?: string
  profile?: ConnectorProfile
  serverName?: string
}): StdioLaunchDescriptor {
  const applicationId = options.applicationId.trim()
  if (!DISCORD_SNOWFLAKE_PATTERN.test(applicationId)) {
    throw new ConfigurationError("Verified Discord application ID must be a snowflake")
  }
  const botId = options.botId.trim()
  if (!DISCORD_SNOWFLAKE_PATTERN.test(botId)) {
    throw new ConfigurationError("Verified Discord bot ID must be a snowflake")
  }
  const profile = options.profile === undefined
    ? undefined
    : parseConnectorProfile(options.profile)
  if (
    profile
    && (
      profile.identity.applicationId !== applicationId
      || profile.identity.botId !== botId
    )
  ) {
    throw new ConfigurationError(
      "Portable launch profile does not match the verified Discord identity",
    )
  }
  const serverName = options.serverName === undefined
    ? DEFAULT_MCP_SERVER_NAME
    : options.serverName.trim()
  if (!MCP_SERVER_NAME_PATTERN.test(serverName)) {
    throw new ConfigurationError("MCP server name may contain only letters, numbers, underscores, and hyphens")
  }
  const command = options.command === undefined
    ? DEFAULT_CLI_COMMAND
    : options.command.trim()
  if (!command) throw new ConfigurationError("MCP server command must not be empty")
  const args = [...(options.args || ["serve"])]
  if (args.some((argument) => typeof argument !== "string" || !argument.trim())) {
    throw new ConfigurationError("MCP server arguments must be non-empty strings")
  }
  if (profile) {
    if (args.includes("--profile")) {
      throw new ConfigurationError("MCP server arguments already select a profile")
    }
    args.push("--profile", profile.name)
  }
  let environmentVariables: string[] = [
    ENVIRONMENT_NAMES.token,
    ENVIRONMENT_NAMES.allowedGuildIds,
    ENVIRONMENT_NAMES.allowedChannelIds,
    ENVIRONMENT_NAMES.allowAttachments,
    ENVIRONMENT_NAMES.attachmentChannelIds,
    ENVIRONMENT_NAMES.attachmentMaxBytes,
    ENVIRONMENT_NAMES.attachmentRoots,
    ENVIRONMENT_NAMES.allowAdministration,
    ENVIRONMENT_NAMES.adminGuildIds,
    ENVIRONMENT_NAMES.protectedUserIds,
    ENVIRONMENT_NAMES.allowChannelCreation,
    ENVIRONMENT_NAMES.channelCreationGuildIds,
    ENVIRONMENT_NAMES.allowRoleCreation,
    ENVIRONMENT_NAMES.roleCreationGuildIds,
    ENVIRONMENT_NAMES.allowGuildScaffolds,
    ENVIRONMENT_NAMES.guildScaffoldGuildIds,
    ENVIRONMENT_NAMES.allowDeletions,
    ENVIRONMENT_NAMES.deleteChannelIds,
    ENVIRONMENT_NAMES.allowPinManagement,
    ENVIRONMENT_NAMES.pinChannelIds,
    ENVIRONMENT_NAMES.allowPermissionOverwrites,
    ENVIRONMENT_NAMES.permissionOverwriteChannelIds,
    ENVIRONMENT_NAMES.allowForumPosts,
    ENVIRONMENT_NAMES.forumPostChannelIds,
    ENVIRONMENT_NAMES.allowInteractions,
    ENVIRONMENT_NAMES.interactionChannelIds,
    ENVIRONMENT_NAMES.mentionUserIds,
    ENVIRONMENT_NAMES.interactionMaxWritesPerMinute,
    ENVIRONMENT_NAMES.interactionMinWriteIntervalMs,
    ENVIRONMENT_NAMES.allowMemberDirectory,
    ENVIRONMENT_NAMES.memberDirectoryGuildIds,
    ENVIRONMENT_NAMES.allowGateway,
    ENVIRONMENT_NAMES.gatewayEventBufferSize,
    ENVIRONMENT_NAMES.allowObservabilityExport,
    ENVIRONMENT_NAMES.observabilityLogs,
    ENVIRONMENT_NAMES.otelEndpoint,
    ENVIRONMENT_NAMES.otelTraceEndpoint,
    ENVIRONMENT_NAMES.otelMetricsEndpoint,
    ENVIRONMENT_NAMES.otelHeaders,
    ENVIRONMENT_NAMES.otelTraceHeaders,
    ENVIRONMENT_NAMES.otelMetricsHeaders,
    ENVIRONMENT_NAMES.otelProtocol,
    ENVIRONMENT_NAMES.otelTraceProtocol,
    ENVIRONMENT_NAMES.otelMetricsProtocol,
    ENVIRONMENT_NAMES.otelCompression,
    ENVIRONMENT_NAMES.otelTraceCompression,
    ENVIRONMENT_NAMES.otelMetricsCompression,
    ENVIRONMENT_NAMES.otelTimeout,
    ENVIRONMENT_NAMES.otelTraceTimeout,
    ENVIRONMENT_NAMES.otelMetricsTimeout,
    ENVIRONMENT_NAMES.otelServiceName,
    ENVIRONMENT_NAMES.otelTracesSampler,
    ENVIRONMENT_NAMES.otelTracesSamplerArg,
    ENVIRONMENT_NAMES.toolSurface,
    ENVIRONMENT_NAMES.toolsets,
    ENVIRONMENT_NAMES.auditFile,
  ]
  if (profile) {
    const managed = new Set<string>(PROFILE_MANAGED_ENVIRONMENT_NAMES)
    environmentVariables = [
      profile.credential.variable,
      ...environmentVariables.filter((name) => (
        name !== ENVIRONMENT_NAMES.token
        && !managed.has(name)
      )),
    ]
  }
  return {
    args,
    command,
    environment: {
      forward: environmentVariables,
      set: profile
        ? {}
        : {
          [ENVIRONMENT_NAMES.applicationId]: applicationId,
          [ENVIRONMENT_NAMES.botId]: botId,
        },
    },
    requirements: {
      elicitation: "required-for-reviewed-writes",
      requiredServer: true,
      toolApproval: "writes",
    },
    serverName,
    timeouts: {
      startupSeconds: STARTUP_TIMEOUT_SECONDS,
      toolSeconds: TOOL_TIMEOUT_SECONDS,
    },
    transport: "stdio",
  }
}

export async function prepareSetup(
  options: SetupOptions = {},
): Promise<SetupReport> {
  const environment = options.environment || process.env
  if (
    !options.profileName
    && (
      options.credentialVariable !== undefined
      || options.overwriteProfile
      || options.profileDirectory !== undefined
    )
  ) {
    throw new ConfigurationError(
      "Credential aliases, profile replacement, and profile storage require a profile name",
    )
  }
  const profileName = options.profileName === undefined
    ? undefined
    : normalizeProfileName(options.profileName)
  const credentialVariable = normalizeCredentialEnvironmentName(
    options.credentialVariable ?? ENVIRONMENT_NAMES.token,
  )
  const runtimeEnvironment = profileName
    ? activateCredentialEnvironment(credentialVariable, environment)
    : environment
  const config = loadConnectorConfig(runtimeEnvironment)
  if (profileName && config.allowedGuildIds.size === 0) {
    throw new ConfigurationError(
      `Profile setup requires ${ENVIRONMENT_NAMES.allowedGuildIds}`,
    )
  }
  const service = options.service || new ConnectorService({ config })
  const status = await service.getStatus()
  if (status.guildPage.inScope < 1) {
    throw new ConfigurationError("Discord bot has no accessible guilds inside the configured local scope")
  }
  const profile = profileName
    ? createConnectorProfile({
      applicationId: status.application.id,
      botId: status.bot.id,
      channelIds: [...config.allowedChannelIds],
      credentialVariable,
      gatewayEnabled: config.allowGateway,
      gatewayEventBufferSize: config.gatewayEventBufferSize,
      guildIds: [...config.allowedGuildIds],
      name: profileName,
      toolsets: selectedMcpToolsets(config.mcpToolsets),
      toolSurface: config.mcpToolSurface,
    })
    : null
  const launch = createStdioLaunchDescriptor({
    applicationId: status.application.id,
    botId: status.bot.id,
    ...(options.args ? { args: options.args } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(profile ? { profile } : {}),
    ...(options.serverName !== undefined ? { serverName: options.serverName } : {}),
  })
  if (profile) {
    await saveProfile(profile, {
      environment,
      overwrite: options.overwriteProfile ?? false,
      ...(options.profileDirectory ? { directory: options.profileDirectory } : {}),
    })
  }
  return {
    applicationId: status.application.id,
    botId: status.bot.id,
    launch,
    profile,
    guildsAccessibleOnFirstPage: status.guildPage.accessible,
    guildsInScopeOnFirstPage: status.guildPage.inScope,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: launch.serverName,
    status: "ok",
    toolsets: selectedMcpToolsets(config.mcpToolsets),
    toolSurface: config.mcpToolSurface,
    warnings: [
      ...policyWarnings(config),
      ...(status.application.messageContentIntent === "enabled"
        ? []
        : ["Discord application does not advertise confirmed Message Content intent, so native search may be unavailable"]),
      ...(config.allowMemberDirectory
        && config.memberDirectoryGuildIds.size > 0
        && status.application.guildMembersIntent !== "enabled"
        ? ["Discord application does not advertise confirmed Guild Members intent, so configured member listing may be unavailable"]
        : []),
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

function assertExactCatalog(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const normalizedActual = [...new Set(actual)].sort()
  const normalizedExpected = [...new Set(expected)].sort()
  if (
    normalizedActual.length !== actual.length
    || JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)
  ) {
    throw new Error(`MCP smoke check found an invalid ${label} catalog`)
  }
}

export async function smokeConnector(
  options: SmokeOptions = {},
): Promise<SmokeReport> {
  const environment = options.environment || process.env
  const config = loadConnectorConfig(environment)
  const service = options.service || new ConnectorService({ config })
  const selectedToolNames = selectedCanonicalMcpToolNames(config.mcpToolsets)
  const expectedToolNames = [...selectedToolNames, MCP_DISCOVERY_TOOL_NAME]
  const server = createDiscordMcpServer({
    environment,
    service,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: `${CONNECTOR_NAME}-smoke`, version: CONNECTOR_VERSION },
    { capabilities: {} },
  )

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    let listed = await client.listTools()
    if (config.mcpToolSurface === "progressive") {
      assertExactCatalog(
        listed.tools.map(({ name }) => name),
        [MCP_DISCOVERY_TOOL_NAME],
        "initial progressive tool",
      )
    }
    const discoveryProbe = await client.callTool({
      arguments: {},
      name: MCP_DISCOVERY_TOOL_NAME,
    })
    const discoveryProbeContent = objectValue(discoveryProbe.structuredContent)
    if (discoveryProbe.isError || discoveryProbeContent?.status !== "ok") {
      throw new Error("MCP tool discovery smoke call failed")
    }
    if (config.mcpToolSurface === "progressive") {
      for (const toolset of selectedMcpToolsets(config.mcpToolsets)) {
        const discovered = await client.callTool({
          arguments: {
            detail: "full",
            limit: CONNECTOR_LIMITS.toolDiscoveryMatches,
            toolset,
          },
          name: MCP_DISCOVERY_TOOL_NAME,
        })
        const discoveredContent = objectValue(discovered.structuredContent)
        if (discovered.isError || discoveredContent?.status !== "ok") {
          throw new Error(`MCP ${toolset} toolset discovery smoke call failed`)
        }
      }
      listed = await client.listTools()
    }
    assertExactCatalog(
      listed.tools.map(({ name }) => name),
      expectedToolNames,
      "tool",
    )
    const [listedPrompts, listedResources, listedTemplates] = await Promise.all([
      client.listPrompts(),
      client.listResources(),
      client.listResourceTemplates(),
    ])
    const promptNames = listedPrompts.prompts.map((prompt) => prompt.name)
    const resourceUris = listedResources.resources.map((resource) => resource.uri)
    const resourceTemplateUris = listedTemplates.resourceTemplates
      .map((template) => template.uriTemplate)
    assertExactCatalog(
      promptNames,
      selectedMcpPromptNames(config.mcpToolsets),
      "prompt",
    )
    assertExactCatalog(resourceUris, Object.values(MCP_RESOURCE_URIS), "resource")
    assertExactCatalog(
      resourceTemplateUris,
      Object.values(MCP_RESOURCE_TEMPLATE_URIS),
      "resource-template",
    )
    if (listed.tools.some((tool) => (
      typeof tool.annotations?.destructiveHint !== "boolean"
      || typeof tool.annotations.idempotentHint !== "boolean"
      || typeof tool.annotations.openWorldHint !== "boolean"
      || typeof tool.annotations.readOnlyHint !== "boolean"
    ))) {
      throw new Error("MCP smoke check found a tool without complete risk annotations")
    }
    for (const name of [
      "delete_messages",
      "execute_member_moderation",
    ] as const) {
      if (!selectedToolNames.includes(name)) continue
      const tool = listed.tools.find((entry) => entry.name === name)
      if (
        !tool
        || tool.annotations?.destructiveHint !== true
        || tool.annotations.idempotentHint !== true
        || tool.annotations.openWorldHint !== true
        || tool.annotations.readOnlyHint !== false
      ) {
        throw new Error(`MCP smoke check found invalid ${name} annotations`)
      }
    }
    if (selectedToolNames.includes("execute_channel_creation")) {
      const tool = listed.tools.find((entry) => (
        entry.name === "execute_channel_creation"
      ))
      if (
        !tool
        || tool.annotations?.destructiveHint !== false
        || tool.annotations.idempotentHint !== true
        || tool.annotations.openWorldHint !== true
        || tool.annotations.readOnlyHint !== false
      ) {
        throw new Error("MCP smoke check found invalid execute_channel_creation annotations")
      }
    }
    if (selectedToolNames.includes("execute_role_creation")) {
      const tool = listed.tools.find((entry) => (
        entry.name === "execute_role_creation"
      ))
      if (
        !tool
        || tool.annotations?.destructiveHint !== false
        || tool.annotations.idempotentHint !== false
        || tool.annotations.openWorldHint !== true
        || tool.annotations.readOnlyHint !== false
      ) {
        throw new Error("MCP smoke check found invalid execute_role_creation annotations")
      }
    }
    if (selectedToolNames.includes("execute_attachment_message")) {
      const tool = listed.tools.find((entry) => (
        entry.name === "execute_attachment_message"
      ))
      if (
        !tool
        || tool.annotations?.destructiveHint !== false
        || tool.annotations.idempotentHint !== false
        || tool.annotations.openWorldHint !== true
        || tool.annotations.readOnlyHint !== false
      ) {
        throw new Error("MCP smoke check found invalid execute_attachment_message annotations")
      }
    }
    if (selectedToolNames.includes("execute_forum_post")) {
      const tool = listed.tools.find((entry) => (
        entry.name === "execute_forum_post"
      ))
      if (
        !tool
        || tool.annotations?.destructiveHint !== false
        || tool.annotations.idempotentHint !== false
        || tool.annotations.openWorldHint !== true
        || tool.annotations.readOnlyHint !== false
      ) {
        throw new Error("MCP smoke check found invalid execute_forum_post annotations")
      }
    }
    const interactionAnnotations = [
      ["send_message", false],
      ["add_reaction", false],
      ["edit_own_message", true],
    ] as const
    for (const [name, destructiveHint] of interactionAnnotations) {
      if (!selectedToolNames.includes(name)) continue
      const tool = listed.tools.find((entry) => entry.name === name)
      if (
        !tool
        || tool.annotations?.destructiveHint !== destructiveHint
        || tool.annotations.idempotentHint !== true
        || tool.annotations.openWorldHint !== true
        || tool.annotations.readOnlyHint !== false
      ) {
        throw new Error(`MCP smoke check found invalid ${name} annotations`)
      }
    }
    let structured: Record<string, unknown> | undefined
    if (config.mcpToolsets.has("connector")) {
      const result = await client.callTool({
        arguments: {},
        name: "get_connector_status",
      })
      structured = objectValue(result.structuredContent)
      if (result.isError || structured?.status !== "ok") {
        throw new Error("MCP get_connector_status smoke call failed")
      }
    } else {
      structured = objectValue(await service.getStatus())
      if (structured?.status !== "ok") {
        throw new Error("Discord connector identity smoke call failed")
      }
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
      promptNames: promptNames.sort(),
      readOnlyTools: listed.tools
        .filter((tool) => tool.annotations?.readOnlyHint === true)
        .map((tool) => tool.name)
        .sort(),
      resourceTemplateUris: resourceTemplateUris.sort(),
      resourceUris: resourceUris.sort(),
      schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
      status: "ok",
      toolCount: listed.tools.length,
      toolsets: selectedMcpToolsets(config.mcpToolsets),
      toolSurface: config.mcpToolSurface,
    }
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}
