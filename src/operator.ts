import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio"
import { existsSync } from "node:fs"
import {
  basename,
  extname,
} from "node:path"

import type { ConnectorConfig } from "./config.js"
import {
  loadConnectorConfig,
  loadConnectorConfigDocument,
} from "./config.js"
import {
  connectorConfigSecretEnvironmentNames,
  connectorConfigSecretFilePaths,
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
  normalizeConfigName,
  parseConnectorConfigDocument,
  resolveConnectorCredential,
  type ConnectorCredentialReference,
  type ConnectorConfigDocument,
} from "./config-document.js"
import {
  resolveConnectorConfigFile,
  resolveConnectorSecretFile,
  writeConnectorConfigDocumentFile,
} from "./config-operator.js"
import {
  CONNECTOR_DESCRIPTION,
  CONNECTOR_CLI_COMMAND,
  CONNECTOR_ICON_MIME_TYPE,
  CONNECTOR_ICON_SIZES,
  CONNECTOR_ICON_URL,
  CONNECTOR_LIMITS,
  CONNECTOR_NAME,
  CONNECTOR_TITLE,
  CONNECTOR_VERSION,
  CONNECTOR_WEBSITE_URL,
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_TOKEN_ENVIRONMENT_PATTERN,
  MCP_ALWAYS_AVAILABLE_TOOL_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import {
  BOT_INSTALLATION_AUDIT_LIMITS,
  BOT_INSTALLATION_AUDIT_PRIVACY,
  BOT_INSTALLATION_AUDIT_SCHEMA_VERSION,
} from "./bot-installation-audit-service.js"
import { DiscordClient } from "./discord-client.js"
import { DiscordGateway, type GatewayRuntime } from "./discord-gateway.js"
import {
  ConfigurationError,
  DiscordApiError,
  errorMessage,
  redactText,
} from "./errors.js"
import { guildChannelLayoutGuildIds } from "./guild-channel-evidence.js"
import { voiceChannelStatusChannelIds } from "./gateway-voice-channel-status.js"
import {
  MCP_RESOURCE_TEMPLATE_URIS,
  MCP_RESOURCE_URIS,
  selectedMcpPromptNames,
} from "./mcp-guidance.js"
import { stableString } from "./normalize.js"
import {
  createGuildControlServer,
  type DiscordToolService,
} from "./mcp.js"
import {
  createMcpToolAccessManifest,
  selectedCanonicalMcpToolNames,
  selectedMcpToolsets,
} from "./mcp-tool-catalog.js"
import {
  loadProfile,
  normalizeProfileName,
  parseConnectorProfile,
  profilePath,
  saveProfile,
  type ConnectorProfile,
} from "./profile.js"
import {
  applicationPostureRequirementsForConfig,
  CONNECTOR_STATUS_PRIVACY,
  CONNECTOR_STATUS_SCHEMA_VERSION,
  ConnectorService,
} from "./service.js"
import {
  applySetupPreset,
  type SetupPresetDescriptor,
  type SetupPresetSelection,
} from "./setup-presets.js"

export const OPERATOR_REPORT_SCHEMA_VERSION = 36
export const SUPPORTED_NODE_MAJOR = 22

const SETUP_BOOTSTRAP_APPLICATION_ID = "900000000000000001"
const SETUP_BOOTSTRAP_BOT_ID = "900000000000000002"
const DOCTOR_DIAGNOSTIC_CREDENTIAL_VARIABLE_PREFIX = "DISCORD_GUILDCONTROL_DOCTOR"
const DOCTOR_DIAGNOSTIC_CREDENTIAL_VALUE = "credential-unavailable"
const SMOKE_PROTOCOL_VERSION = "2026-07-28"
const STDIO_SMOKE_STDERR_CAPTURE_BYTES = 16 * 1024
const STDIO_SMOKE_STDERR_REPORT_BYTES = 8 * 1024
const CONNECTOR_STATUS_APPLICATION_KEYS = Object.freeze([
  "guildMembersIntent",
  "id",
  "messageContentIntent",
])
const CONNECTOR_STATUS_BOT_KEYS = Object.freeze(["id"])
const CONNECTOR_STATUS_KEYS = Object.freeze([
  "application",
  "applicationPosture",
  "bot",
  "installationAudit",
  "policy",
  "privacy",
  "schemaVersion",
  "status",
  "writeCoordination",
])
const BOT_INSTALLATION_AUDIT_KEYS = Object.freeze([
  "completeness",
  "configuredGuildIds",
  "discardedGuildFieldCount",
  "drift",
  "identity",
  "installedGuildIds",
  "installedInScopeGuildIds",
  "privacy",
  "schemaVersion",
  "status",
])
const BOT_INSTALLATION_AUDIT_COMPLETENESS_KEYS = Object.freeze([
  "complete",
  "maximumGuilds",
  "pageSize",
  "pagesRead",
])
const BOT_INSTALLATION_AUDIT_DRIFT_KEYS = Object.freeze([
  "detected",
  "missingConfiguredGuildIds",
  "unexpectedGuildIds",
])
const BOT_INSTALLATION_AUDIT_IDENTITY_KEYS = Object.freeze([
  "applicationId",
  "botId",
])

// A subclass keeps modern discovery on the observed process so startup stderr remains available
class SmokeStdioClientTransport extends StdioClientTransport {}

export const DOCTOR_CHECK_IDS = Object.freeze({
  administrationPolicy: "administration-policy",
  announcementCrosspostPolicy: "announcement-crosspost-policy",
  announcementSubscriptionAuditPolicy: "announcement-subscription-audit-policy",
  announcementSubscriptionChangePolicy: "announcement-subscription-change-policy",
  applicationEmojiAuditPolicy: "application-emoji-audit-policy",
  applicationEmojiChangePolicy: "application-emoji-change-policy",
  applicationEntitlementConsumptionPolicy:
    "application-entitlement-consumption-policy",
  applicationCommandChangePolicy: "application-command-change-policy",
  globalApplicationCommandChangePolicy: "global-application-command-change-policy",
  applicationIntentChangePolicy: "application-intent-change-policy",
  botProfileAuditPolicy: "bot-profile-audit-policy",
  botProfileChangePolicy: "bot-profile-change-policy",
  applicationMonetizationAuditPolicy: "application-monetization-audit-policy",
  applicationTestEntitlementChangePolicy:
    "application-test-entitlement-change-policy",
  applicationRoleConnectionMetadataChangePolicy:
    "application-role-connection-metadata-change-policy",
  applicationBotVisibility: "application-bot-visibility",
  applicationDefaultPermissions: "application-default-permissions",
  applicationEventWebhooks: "application-event-webhooks",
  applicationIdentity: "application-identity",
  applicationInstall: "application-install",
  applicationInteractionDelivery: "application-interaction-delivery",
  applicationPresenceIntent: "application-presence-intent",
  attachmentPolicy: "attachment-policy",
  automodAuditPolicy: "automod-audit-policy",
  automodChangePolicy: "automod-change-policy",
  banAuditPolicy: "ban-audit-policy",
  bulkBanAuditPolicy: "bulk-ban-audit-policy",
  bulkBanChangePolicy: "bulk-ban-change-policy",
  bulkMemberRolePolicy: "bulk-member-role-policy",
  guildPruneAuditPolicy: "guild-prune-audit-policy",
  guildPruneChangePolicy: "guild-prune-change-policy",
  botIdentity: "bot-identity",
  channelCloneAuditPolicy: "channel-clone-audit-policy",
  channelCloneChangePolicy: "channel-clone-change-policy",
  channelCreationPolicy: "channel-creation-policy",
  channelMetadataPolicy: "channel-metadata-policy",
  voiceChannelStatusPolicy: "voice-channel-status-policy",
  channelScope: "channel-scope",
  configuration: "configuration",
  deletionPolicy: "deletion-policy",
  directMessageAttachmentPolicy: "direct-message-attachment-policy",
  directMessageAuditPolicy: "direct-message-audit-policy",
  directMessageDeletionPolicy: "direct-message-deletion-policy",
  directMessageDeliveryPolicy: "direct-message-delivery-policy",
  directMessageEditingPolicy: "direct-message-editing-policy",
  embedMessagePolicy: "embed-message-policy",
  forumPostPolicy: "forum-post-policy",
  forumTagAuditPolicy: "forum-tag-audit-policy",
  forumTagChangePolicy: "forum-tag-change-policy",
  guildAccess: "guild-access",
  guildInstallationDrift: "guild-installation-drift",
  guildDeparturePolicy: "guild-departure-policy",
  guildMembersIntent: "guild-members-intent",
  guildScope: "guild-scope",
  guildExpressionAuditPolicy: "guild-expression-audit-policy",
  guildExpressionChangePolicy: "guild-expression-change-policy",
  guildIncidentAuditPolicy: "guild-incident-audit-policy",
  guildIncidentChangePolicy: "guild-incident-change-policy",
  guildProfileAuditPolicy: "guild-profile-audit-policy",
  guildProfileChangePolicy: "guild-profile-change-policy",
  gatewayPolicy: "gateway-policy",
  guildScaffoldPolicy: "guild-scaffold-policy",
  guildTemplateAuditPolicy: "guild-template-audit-policy",
  guildTemplateChangePolicy: "guild-template-change-policy",
  interactionPolicy: "interaction-policy",
  integrationAuditPolicy: "integration-audit-policy",
  integrationDeletionPolicy: "integration-deletion-policy",
  inviteAuditPolicy: "invite-audit-policy",
  inviteCreationPolicy: "invite-creation-policy",
  inviteDeletionPolicy: "invite-deletion-policy",
  memberDirectoryPolicy: "member-directory-policy",
  memberNicknamePolicy: "member-nickname-policy",
  otherMemberNicknamePolicy: "other-member-nickname-policy",
  memberRolePolicy: "member-role-policy",
  memberVerificationPolicy: "member-verification-policy",
  memberVoiceAuditPolicy: "member-voice-audit-policy",
  memberVoiceChangePolicy: "member-voice-change-policy",
  messageContentIntent: "message-content-intent",
  messageForwardPolicy: "message-forward-policy",
  messagePinPolicy: "message-pin-policy",
  nativeInteractionCommandPolicy: "native-interaction-command-policy",
  nativeInteractionIngressPolicy: "native-interaction-ingress-policy",
  nodeVersion: "node-version",
  onboardingAuditPolicy: "onboarding-audit-policy",
  onboardingChangePolicy: "onboarding-change-policy",
  welcomeScreenAuditPolicy: "welcome-screen-audit-policy",
  welcomeScreenChangePolicy: "welcome-screen-change-policy",
  widgetPublicExposurePolicy: "widget-public-exposure-policy",
  widgetSettingsAuditPolicy: "widget-settings-audit-policy",
  widgetSettingsChangePolicy: "widget-settings-change-policy",
  guildCommunityAuditPolicy: "guild-community-audit-policy",
  guildCommunityChangePolicy: "guild-community-change-policy",
  guildSettingsAuditPolicy: "guild-settings-audit-policy",
  guildSettingsChangePolicy: "guild-settings-change-policy",
  observability: "observability",
  permissionOverwritePolicy: "permission-overwrite-policy",
  permissionSyncPolicy: "permission-sync-policy",
  pollAuditPolicy: "poll-audit-policy",
  pollCreationPolicy: "poll-creation-policy",
  pollEndPolicy: "poll-end-policy",
  pollVoterAuditPolicy: "poll-voter-audit-policy",
  reactionModerationPolicy: "reaction-moderation-policy",
  reactionUserAuditPolicy: "reaction-user-audit-policy",
  readResponseBudget: "read-response-budget",
  roleCreationPolicy: "role-creation-policy",
  roleConfigurationPolicy: "role-configuration-policy",
  roleDeletionAuditPolicy: "role-deletion-audit-policy",
  roleDeletionChangePolicy: "role-deletion-change-policy",
  channelOrderingAuditPolicy: "channel-ordering-audit-policy",
  channelOrderingChangePolicy: "channel-ordering-change-policy",
  channelDeletionAuditPolicy: "channel-deletion-audit-policy",
  channelDeletionChangePolicy: "channel-deletion-change-policy",
  roleOrderingAuditPolicy: "role-ordering-audit-policy",
  roleOrderingChangePolicy: "role-ordering-change-policy",
  scheduledEventAuditPolicy: "scheduled-event-audit-policy",
  scheduledEventChangePolicy: "scheduled-event-change-policy",
  scheduledEventUserAuditPolicy: "scheduled-event-user-audit-policy",
  soundboardAuditPolicy: "soundboard-audit-policy",
  soundboardChangePolicy: "soundboard-change-policy",
  soundboardPlaybackPolicy: "soundboard-playback-policy",
  stageInstanceAuditPolicy: "stage-instance-audit-policy",
  stageInstanceChangePolicy: "stage-instance-change-policy",
  stageStartNotificationPolicy: "stage-start-notification-policy",
  token: "token",
  toolAccessContract: "tool-access-contract",
  toolSurface: "tool-surface",
  threadAuditPolicy: "thread-audit-policy",
  threadChangePolicy: "thread-change-policy",
  threadCreationPolicy: "thread-creation-policy",
  webhookAuditPolicy: "webhook-audit-policy",
  webhookChangePolicy: "webhook-change-policy",
  webhookCreationPolicy: "webhook-creation-policy",
  webhookDeletionPolicy: "webhook-deletion-policy",
  webhookMessageAuditPolicy: "webhook-message-audit-policy",
  webhookMessageChangePolicy: "webhook-message-change-policy",
  webhookMessageDeletionPolicy: "webhook-message-deletion-policy",
  webhookMessageDeliveryPolicy: "webhook-message-delivery-policy",
})

const DEFAULT_CLI_COMMAND = CONNECTOR_CLI_COMMAND
const DEFAULT_MCP_SERVER_NAME = "discord"
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const STARTUP_TIMEOUT_SECONDS = 30
const TOOL_TIMEOUT_SECONDS = 180
export type DoctorCheckStatus = "fail" | "pass" | "warn"
export type OperatorReportStatus = "error" | "ok" | "warning"

export interface DoctorCheck {
  action?: string
  id: string
  reference?: string
  status: DoctorCheckStatus
  summary: string
}

export interface IdentitySummary {
  applicationId: string
  botId: string
  configuredGuildCount: number
  installedGuildCount: number
  installedInScopeGuildCount: number
  missingConfiguredGuildCount: number
  unexpectedGuildCount: number
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
  configBackupFile: string | null
  configFile: string | null
  credential: ConnectorCredentialReference
  configuredGuildCount: number
  installedGuildCount: number
  installedInScopeGuildCount: number
  launch: StdioLaunchDescriptor
  preset: SetupPresetDescriptor | null
  profile: ConnectorProfile | null
  schemaVersion: number
  serverName: string
  status: "ok"
  toolsets: McpToolsetName[]
  toolSurface: McpToolSurface
  unexpectedGuildCount: number
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
  secrets: {
    environmentVariables: string[]
    files: string[]
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
  protocolVersion: string
  readOnlyTools: string[]
  resourceTemplateUris: string[]
  resourceUris: string[]
  schemaVersion: number
  serverName: string
  serverVersion: string
  status: "ok"
  toolCount: number
  toolsets: McpToolsetName[]
  toolSurface: McpToolSurface
  transport: "in-memory" | "stdio"
  writeCapableTools: string[]
}

type ConnectorStatus = Awaited<ReturnType<ConnectorService["getStatus"]>>

export interface StatusProvider {
  getStatus(): Promise<ConnectorStatus>
}

export interface DoctorOptions {
  config?: ConnectorConfig
  document?: ConnectorConfigDocument
  environment?: NodeJS.ProcessEnv
  nodeVersion?: string
  online?: boolean
  selectionFailure?: unknown
  service?: StatusProvider
}

export interface SetupOptions {
  args?: readonly string[]
  command?: string
  configFile?: string
  credentialFile?: string
  credentialVariable?: string
  environment?: NodeJS.ProcessEnv
  expectedApplicationId?: string
  overwriteConfig?: boolean
  overwriteProfile?: boolean
  profileDirectory?: string
  profileName?: string
  reuseExistingConfig?: boolean
  preset?: SetupPresetSelection
  serverName?: string
  service?: StatusProvider
}

export interface SmokeOptions {
  config?: ConnectorConfig
  environment?: NodeJS.ProcessEnv
  launch?: {
    args: readonly string[]
    command: string
  }
  service?: DiscordToolService
}

const DOCTOR_REFERENCES = Object.freeze({
  applicationPosture: "docs/reference.md#application-security-posture",
  botSetup: "docs/reference.md#discord-bot-setup",
  configuration: "docs/reference.md#configuration",
  operatorCli: "docs/reference.md#operator-cli",
  requirements: "docs/reference.md#requirements",
  verification: "docs/reference.md#verification",
})

const DOCTOR_IDENTITY_CHECK_IDS = new Set<string>([
  DOCTOR_CHECK_IDS.applicationIdentity,
  DOCTOR_CHECK_IDS.botIdentity,
])

const DOCTOR_INTENT_CHECK_IDS = new Set<string>([
  DOCTOR_CHECK_IDS.guildMembersIntent,
  DOCTOR_CHECK_IDS.messageContentIntent,
])

const DOCTOR_APPLICATION_POSTURE_CHECK_IDS = new Set<string>([
  DOCTOR_CHECK_IDS.applicationBotVisibility,
  DOCTOR_CHECK_IDS.applicationDefaultPermissions,
  DOCTOR_CHECK_IDS.applicationEventWebhooks,
  DOCTOR_CHECK_IDS.applicationInstall,
  DOCTOR_CHECK_IDS.applicationInteractionDelivery,
  DOCTOR_CHECK_IDS.applicationPresenceIntent,
])

function doctorGuidance(
  id: string,
): Pick<DoctorCheck, "action" | "reference"> {
  if (id === DOCTOR_CHECK_IDS.nodeVersion) {
    return {
      action: `Install Node.js ${SUPPORTED_NODE_MAJOR} or newer, then rerun doctor.`,
      reference: DOCTOR_REFERENCES.requirements,
    }
  }
  if (id === DOCTOR_CHECK_IDS.token) {
    return {
      action: "Make the environment variable or file referenced by credential available to the connector process, then rerun doctor with the same selected policy.",
      reference: DOCTOR_REFERENCES.botSetup,
    }
  }
  if (id === DOCTOR_CHECK_IDS.configuration) {
    return {
      action: "Correct the selected configuration or referenced secret, then rerun doctor before starting the server.",
      reference: DOCTOR_REFERENCES.configuration,
    }
  }
  if (DOCTOR_IDENTITY_CHECK_IDS.has(id)) {
    return {
      action: "Create or refresh the selected policy with setup so the verified application and bot identities are pinned.",
      reference: DOCTOR_REFERENCES.operatorCli,
    }
  }
  if (id === DOCTOR_CHECK_IDS.guildScope) {
    return {
      action: "Set an exact nonempty readScope.guildIds boundary in the selected policy, then rerun doctor.",
      reference: DOCTOR_REFERENCES.operatorCli,
    }
  }
  if (id === DOCTOR_CHECK_IDS.channelScope) {
    return {
      action: "Add exact IDs to readScope.channelIds when access should be narrower, or retain an empty list only when every Discord-visible channel inside the configured guild boundary is intended.",
      reference: DOCTOR_REFERENCES.operatorCli,
    }
  }
  if (DOCTOR_INTENT_CHECK_IDS.has(id)) {
    return {
      action: "Enable only the required privileged intent in the Discord Developer Portal, or disable the connector feature that needs it, then rerun doctor --online.",
      reference: DOCTOR_REFERENCES.botSetup,
    }
  }
  if (DOCTOR_APPLICATION_POSTURE_CHECK_IDS.has(id)) {
    return {
      action: "Review the verified current application settings in the Discord Developer Portal, correct only the reported boundary, then rerun doctor --online.",
      reference: DOCTOR_REFERENCES.applicationPosture,
    }
  }
  if (id === DOCTOR_CHECK_IDS.guildAccess) {
    return {
      action: "Install the verified bot in every intended guild and align the exact local guild scope, then rerun doctor --online.",
      reference: DOCTOR_REFERENCES.botSetup,
    }
  }
  if (id === DOCTOR_CHECK_IDS.guildInstallationDrift) {
    return {
      action: "Remove the verified bot from every unintended guild or add an exact guild to local scope only when that installation is deliberate, then rerun doctor --online.",
      reference: DOCTOR_REFERENCES.botSetup,
    }
  }
  if (id === DOCTOR_CHECK_IDS.observability) {
    return {
      action: "Disable export or correct the loopback collector configuration, then rerun doctor.",
      reference: DOCTOR_REFERENCES.configuration,
    }
  }
  if (id.endsWith("-policy")) {
    return {
      action: "Review this feature's toggle and exact allowlists; keep it disabled unless the capability is intended, then rerun doctor.",
      reference: DOCTOR_REFERENCES.configuration,
    }
  }
  return {
    action: "Review the reported boundary, correct only the intended configuration, and rerun doctor before proceeding.",
    reference: DOCTOR_REFERENCES.verification,
  }
}

function check(
  id: string,
  status: DoctorCheckStatus,
  summary: string,
): DoctorCheck {
  if (status === "pass") return { id, status, summary }
  const guidance = doctorGuidance(id)
  return { ...guidance, id, status, summary }
}

function reportStatus(checks: readonly DoctorCheck[]): OperatorReportStatus {
  if (checks.some((entry) => entry.status === "fail")) return "error"
  if (checks.some((entry) => entry.status === "warn")) return "warning"
  return "ok"
}

function identitySummary(status: ConnectorStatus): IdentitySummary {
  const audit = status.installationAudit
  return {
    applicationId: status.application.id,
    botId: status.bot.id,
    configuredGuildCount: audit.configuredGuildIds.length,
    installedGuildCount: audit.installedGuildIds.length,
    installedInScopeGuildCount: audit.installedInScopeGuildIds.length,
    missingConfiguredGuildCount: audit.drift.missingConfiguredGuildIds.length,
    unexpectedGuildCount: audit.drift.unexpectedGuildIds.length,
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
  if (
    config.allowAnnouncementCrossposts
    && config.announcementCrosspostChannelIds.size === 0
  ) {
    warnings.push("The announcement-crosspost toggle is enabled but crossposting remains blocked because no exact announcement-channel allowlist is configured")
  }
  if (
    config.allowAnnouncementSubscriptionAudit
    && config.announcementSubscriptionTargetChannelIds.size === 0
  ) {
    warnings.push("The announcement-subscription audit toggle is enabled but audit remains blocked because no exact target-channel allowlist is configured")
  }
  if (
    config.allowAnnouncementSubscriptionChanges
    && config.announcementSubscriptionSourceChannelIds.size === 0
  ) {
    warnings.push("Announcement-subscription changes are enabled without a source-channel allowlist, so exact-ID unsubscription remains available but new subscriptions are blocked")
  }
  if (config.allowPinManagement && config.pinChannelIds.size === 0) {
    warnings.push("The message-pin toggle is enabled but pin management remains blocked because no pin-channel allowlist is configured")
  }
  if (config.allowPollAudit && config.pollChannelIds.size === 0) {
    warnings.push("The poll-audit toggle is enabled but poll reads remain blocked because no exact poll-channel allowlist is configured")
  }
  if (config.allowPollCreation && config.pollChannelIds.size === 0) {
    warnings.push("The poll-creation toggle is enabled but creation remains blocked because no exact poll-channel allowlist is configured")
  }
  if (config.allowPollEnding && config.pollChannelIds.size === 0) {
    warnings.push("The poll-ending toggle is enabled but ending remains blocked because no exact poll-channel allowlist is configured")
  }
  if (config.allowPollVoterAudit && config.pollChannelIds.size === 0) {
    warnings.push("The poll-voter-audit toggle is enabled but voter inspection remains blocked because no exact poll-channel allowlist is configured")
  }
  if (config.allowReactionUserAudit && config.reactionChannelIds.size === 0) {
    warnings.push("The reaction-user-audit toggle is enabled but identity inspection remains blocked because no exact reaction-channel allowlist is configured")
  }
  if (config.allowReactionModeration && config.reactionChannelIds.size === 0) {
    warnings.push("The reaction-moderation toggle is enabled but moderation remains blocked because no exact reaction-channel allowlist is configured")
  }
  if (
    config.allowPermissionOverwrites
    && config.permissionOverwriteChannelIds.size === 0
  ) {
    warnings.push("The permission-overwrite toggle is enabled but channel permission changes remain blocked because an exact channel allowlist is required")
  }
  if (config.allowPermissionSyncs && config.permissionSyncChannelIds.size === 0) {
    warnings.push("The parent-category permission-sync toggle is enabled but synchronization remains blocked because an exact direct child-channel allowlist is required")
  }
  if (config.allowForumPosts && config.forumPostChannelIds.size === 0) {
    warnings.push("The forum-post toggle is enabled but forum-post creation remains blocked because no forum-channel allowlist is configured")
  }
  if (config.allowForumTagAudit && config.forumTagChannelIds.size === 0) {
    warnings.push("The forum-tag audit toggle is enabled but inventory remains blocked because no exact stable-forum allowlist is configured")
  }
  if (config.allowForumTagChanges && config.forumTagChannelIds.size === 0) {
    warnings.push("The forum-tag change toggle is enabled but changes remain blocked because no exact stable-forum allowlist is configured")
  }
  if (config.allowThreadCreation && config.threadParentIds.size === 0) {
    warnings.push("The thread-creation toggle is enabled but creation remains blocked because no exact parent-channel allowlist is configured")
  }
  if (
    config.allowThreadAudit
    && (config.threadGuildIds.size === 0 || config.threadIds.size === 0)
  ) {
    warnings.push("The thread-audit toggle is enabled but inspection remains blocked because exact guild and thread allowlists are both required")
  }
  if (
    config.allowThreadChanges
    && (config.threadGuildIds.size === 0 || config.threadIds.size === 0)
  ) {
    warnings.push("The thread-change toggle is enabled but changes remain blocked because exact guild and thread allowlists are both required")
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
  if (config.allowBulkBanAudit && config.bulkBanGuildIds.size === 0) {
    warnings.push("The bulk-ban audit toggle is enabled but planning remains blocked because no exact bulk-ban guild allowlist is configured")
  }
  if (config.allowBulkBans && !config.allowBulkBanAudit) {
    warnings.push("The bulk-ban change toggle is enabled but execution remains blocked because reviewed bulk-ban audit is disabled")
  }
  if (config.allowGuildPruneAudit && config.guildPruneGuildIds.size === 0) {
    warnings.push("The guild-prune audit toggle is enabled but planning remains blocked because no exact guild-prune guild allowlist is configured")
  }
  if (config.allowGuildPrunes && !config.allowGuildPruneAudit) {
    warnings.push("The guild-prune change toggle is enabled but execution remains blocked because reviewed guild-prune audit is disabled")
  }
  if (config.allowChannelCreation && config.channelCreationGuildIds.size === 0) {
    warnings.push("The channel-creation toggle is enabled but channel creation remains blocked because no channel-creation guild allowlist is configured")
  }
  if (
    config.allowChannelCloneAudit
    && (config.channelCloneGuildIds.size === 0 || config.channelCloneSourceIds.size === 0)
  ) {
    warnings.push("The channel-clone audit toggle is enabled but planning remains blocked because exact guild and source-channel allowlists are both required")
  }
  if (
    config.allowChannelCloning
    && (config.channelCloneGuildIds.size === 0 || config.channelCloneSourceIds.size === 0)
  ) {
    warnings.push("The channel-clone change toggle is enabled but cloning remains blocked because exact guild and source-channel allowlists are both required")
  }
  if (config.allowChannelMetadataChanges && config.channelMetadataIds.size === 0) {
    warnings.push("The channel-metadata toggle is enabled but metadata changes remain blocked because an exact channel allowlist is required")
  }
  if (config.allowChannelOrderingAudit && config.channelOrderingGuildIds.size === 0) {
    warnings.push("The channel-ordering audit toggle is enabled but layout inspection remains blocked because no exact guild allowlist is configured")
  }
  if (config.allowChannelOrderingChanges && config.channelOrderingGuildIds.size === 0) {
    warnings.push("The channel-ordering change toggle is enabled but layout changes remain blocked because no exact guild allowlist is configured")
  }
  if (config.allowChannelDeletionAudit && config.channelDeletionIds.size === 0) {
    warnings.push("The channel-deletion audit toggle is enabled but readiness inspection remains blocked because no exact channel allowlist is configured")
  }
  if (config.allowChannelDeletions && config.channelDeletionIds.size === 0) {
    warnings.push("The channel-deletion change toggle is enabled but deletion remains blocked because no exact channel allowlist is configured")
  }
  if (config.allowRoleCreation && config.roleCreationGuildIds.size === 0) {
    warnings.push("The role-creation toggle is enabled but role creation remains blocked because no role-creation guild allowlist is configured")
  }
  if (config.allowRoleConfiguration && config.roleConfigurationIds.size === 0) {
    warnings.push("The role-configuration toggle is enabled but role changes remain blocked because no exact role allowlist is configured")
  }
  if (
    config.allowRoleConfiguration
    && config.roleConfigurationIds.size > 0
    && config.guildExpressionRoots.length === 0
  ) {
    warnings.push("Reviewed role configuration is enabled, but local-image role icons remain blocked because no canonical expression roots are configured")
  }
  if (config.allowRoleDeletionAudit && config.roleDeletionIds.size === 0) {
    warnings.push("The role-deletion audit toggle is enabled but readiness inspection remains blocked because no exact role allowlist is configured")
  }
  if (config.allowRoleDeletions && config.roleDeletionIds.size === 0) {
    warnings.push("The role-deletion change toggle is enabled but deletion remains blocked because no exact role allowlist is configured")
  }
  if (config.allowRoleOrderingAudit && config.roleOrderingGuildIds.size === 0) {
    warnings.push("The role-ordering audit toggle is enabled but hierarchy inspection remains blocked because no exact guild allowlist is configured")
  }
  if (config.allowRoleOrderingChanges && config.roleOrderingGuildIds.size === 0) {
    warnings.push("The role-ordering change toggle is enabled but hierarchy changes remain blocked because no exact guild allowlist is configured")
  }
  if (config.allowGuildScaffolds && config.guildScaffoldGuildIds.size === 0) {
    warnings.push("The guild-scaffold toggle is enabled but scaffold execution remains blocked because no guild-scaffold allowlist is configured")
  }
  if (config.allowGuildTemplateAudit && config.guildTemplateGuildIds.size === 0) {
    warnings.push("The Guild Template audit toggle is enabled but inventory remains blocked because no exact guild allowlist is configured")
  }
  if (config.allowGuildTemplateChanges && config.guildTemplateGuildIds.size === 0) {
    warnings.push("The Guild Template change toggle is enabled but changes remain blocked because no exact guild allowlist is configured")
  }
  if (config.allowInteractions && config.interactionChannelIds.size === 0) {
    warnings.push("The interaction toggle is enabled but interactions remain blocked because no interaction-channel allowlist is configured")
  }
  if (config.allowEmbedMessages && config.embedMessageChannelIds.size === 0) {
    warnings.push("The embed-message capability is enabled but static rich-embed messages remain blocked because no exact channel allowlist is configured")
  }
  if (config.allowMemberDirectory && config.memberDirectoryGuildIds.size === 0) {
    warnings.push("The member-directory toggle is enabled but member lookup remains blocked because an exact guild allowlist is required")
  }
  if (config.allowBanAudit && config.banAuditGuildIds.size === 0) {
    warnings.push("The ban-audit toggle is enabled but ban inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowInviteAudit && config.inviteGuildIds.size === 0) {
    warnings.push("The invite-audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
  }
  if (config.allowInviteCreation && config.inviteCreationChannelIds.size === 0) {
    warnings.push("The invite-creation toggle is enabled but creation remains blocked because an exact channel allowlist is required")
  }
  if (config.allowInviteCreation && config.inviteCapabilityRoots.length === 0) {
    warnings.push("The invite-creation toggle is enabled but capability delivery remains blocked because a canonical private-file root is required")
  }
  if (config.allowInviteDeletions && config.inviteGuildIds.size === 0) {
    warnings.push("The invite-deletion toggle is enabled but deletion remains blocked because an exact guild allowlist is required")
  }
  if (config.allowIntegrationAudit && config.integrationGuildIds.size === 0) {
    warnings.push("The integration-audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
  }
  if (
    config.allowIntegrationDeletions
    && (config.integrationGuildIds.size === 0 || config.integrationIds.size === 0)
  ) {
    warnings.push("The integration-deletion toggle is enabled but deletion remains blocked because exact guild and integration allowlists are both required")
  }
  if (config.allowGuildDepartures && config.guildDepartureGuildIds.size === 0) {
    warnings.push("The guild-departure toggle is enabled but departure remains blocked because an exact guild allowlist is required")
  }
  if (config.allowOnboardingAudit && config.onboardingGuildIds.size === 0) {
    warnings.push("The onboarding-audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowOnboardingChanges && config.onboardingGuildIds.size === 0) {
    warnings.push("The onboarding-change toggle is enabled but replacement remains blocked because an exact guild allowlist is required")
  }
  if (config.allowWelcomeScreenAudit && config.welcomeScreenGuildIds.size === 0) {
    warnings.push("The Welcome Screen audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowWelcomeScreenChanges && config.welcomeScreenGuildIds.size === 0) {
    warnings.push("The Welcome Screen change toggle is enabled but replacement remains blocked because an exact guild allowlist is required")
  }
  if (config.allowWidgetSettingsAudit && config.widgetSettingsGuildIds.size === 0) {
    warnings.push("The authenticated widget-settings audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowWidgetSettingsChanges && config.widgetSettingsGuildIds.size === 0) {
    warnings.push("The authenticated widget-settings change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildSettingsAudit && config.guildSettingsGuildIds.size === 0) {
    warnings.push("The guild-settings audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildSettingsChanges && config.guildSettingsGuildIds.size === 0) {
    warnings.push("The guild-settings change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildCommunityAudit && config.guildCommunityGuildIds.size === 0) {
    warnings.push("The guild Community audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildCommunityChanges && config.guildCommunityGuildIds.size === 0) {
    warnings.push("The guild Community change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildIncidentAudit && config.guildIncidentGuildIds.size === 0) {
    warnings.push("The guild incident-action audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildIncidentChanges && config.guildIncidentGuildIds.size === 0) {
    warnings.push("The guild incident-action change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildProfileAudit && config.guildProfileGuildIds.size === 0) {
    warnings.push("The guild profile audit toggle is enabled but inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildProfileChanges && config.guildProfileGuildIds.size === 0) {
    warnings.push("The guild profile change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowWidgetPublicExposure && config.widgetSettingsGuildIds.size === 0) {
    warnings.push("The widget public-exposure toggle is enabled but exposure-changing writes remain blocked because an exact guild allowlist is required")
  }
  if (
    config.allowNicknameChanges
    && config.nicknameGuildIds.size === 0
  ) {
    warnings.push("The nickname-change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (
    config.allowMemberRoleChanges
    && (config.memberRoleGuildIds.size === 0 || config.memberRoleIds.size === 0)
  ) {
    warnings.push("The member-role toggle is enabled but changes remain blocked because exact guild and role allowlists are both required")
  }
  if (
    config.allowMemberVerificationChanges
    && config.memberVerificationGuildIds.size === 0
  ) {
    warnings.push("The member verification-change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (
    config.allowBulkMemberRoleChanges
    && (
      config.bulkMemberRoleGuildIds.size === 0
      || config.bulkMemberRoleIds.size === 0
    )
  ) {
    warnings.push("The bulk member-role toggle is enabled but changes remain blocked because independent exact guild and role allowlists are both required")
  }
  if (
    config.allowMemberVoiceAudit
    && (config.memberVoiceGuildIds.size === 0 || config.memberVoiceChannelIds.size === 0)
  ) {
    warnings.push("The member voice-audit toggle is enabled but inspection remains blocked because exact guild and voice-channel allowlists are both required")
  }
  if (
    config.allowMemberVoiceChanges
    && (config.memberVoiceGuildIds.size === 0 || config.memberVoiceChannelIds.size === 0)
  ) {
    warnings.push("The member voice-change toggle is enabled but changes remain blocked because exact guild and voice-channel allowlists are both required")
  }
  if (config.allowAutomodAudit && config.automodGuildIds.size === 0) {
    warnings.push("The AutoMod audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
  }
  if (config.allowAutomodChanges && config.automodGuildIds.size === 0) {
    warnings.push("The AutoMod change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (
    config.allowWebhookAudit
    && config.webhookChannelIds.size === 0
    && config.webhookGuildIds.size === 0
  ) {
    warnings.push("The webhook-audit toggle is enabled but inventory remains blocked because an exact channel or guild allowlist is required")
  }
  if (config.allowWebhookChanges && config.webhookChannelIds.size === 0) {
    warnings.push("The webhook-change toggle is enabled but changes remain blocked because an exact channel allowlist is required")
  }
  if (config.allowWebhookCreation && config.webhookChannelIds.size === 0) {
    warnings.push("The webhook-creation toggle is enabled but creation remains blocked because an exact channel allowlist is required")
  }
  if (config.allowWebhookDeletions && config.webhookChannelIds.size === 0) {
    warnings.push("The webhook-deletion toggle is enabled but deletion remains blocked because an exact channel allowlist is required")
  }
  if (config.allowWebhookMessageAudit && config.webhookMessageChannelIds.size === 0) {
    warnings.push("The webhook-message-audit toggle is enabled but exact lookup remains blocked because an exact channel allowlist is required")
  }
  if (config.allowWebhookMessageDelivery && config.webhookMessageChannelIds.size === 0) {
    warnings.push("The webhook-message-delivery toggle is enabled but delivery remains blocked because an exact channel allowlist is required")
  }
  if (config.allowWebhookMessageChanges && config.webhookMessageChannelIds.size === 0) {
    warnings.push("The webhook-message-change toggle is enabled but edits remain blocked because an exact channel allowlist is required")
  }
  if (config.allowWebhookMessageDeletions && config.webhookMessageChannelIds.size === 0) {
    warnings.push("The webhook-message-deletion toggle is enabled but deletion remains blocked because an exact channel allowlist is required")
  }
  if (config.allowGuildExpressionAudit && config.guildExpressionGuildIds.size === 0) {
    warnings.push("The guild-expression audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
  }
  if (config.allowGuildExpressionChanges && config.guildExpressionGuildIds.size === 0) {
    warnings.push("The guild-expression change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (
    config.allowGuildExpressionChanges
    && config.guildExpressionGuildIds.size > 0
    && config.guildExpressionRoots.length === 0
  ) {
    warnings.push("Guild-expression updates and deletions are enabled, but creation remains blocked because no canonical local roots are configured")
  }
  if (
    config.allowApplicationEmojiChanges
    && config.applicationEmojiRoots.length === 0
  ) {
    warnings.push("Application-emoji rename and deletion are enabled, but creation remains blocked because no canonical local roots are configured")
  }
  if (config.allowBotProfileChanges && config.botProfileRoots.length === 0) {
    warnings.push("Bot-profile username changes and image clearance are enabled, but image replacement remains blocked because no canonical local roots are configured")
  }
  if (config.allowScheduledEventAudit && config.scheduledEventGuildIds.size === 0) {
    warnings.push("The scheduled-event audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
  }
  if (config.allowScheduledEventChanges && config.scheduledEventGuildIds.size === 0) {
    warnings.push("The scheduled-event change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowScheduledEventUserAudit && config.scheduledEventGuildIds.size === 0) {
    warnings.push("The scheduled-event user-audit toggle is enabled but identity inspection remains blocked because an exact guild allowlist is required")
  }
  if (
    config.allowScheduledEventChanges
    && config.scheduledEventGuildIds.size > 0
    && config.scheduledEventRoots.length === 0
  ) {
    warnings.push("Scheduled-event changes are enabled, but cover updates remain blocked because no canonical local roots are configured")
  }
  if (config.allowSoundboardAudit && config.soundboardGuildIds.size === 0) {
    warnings.push("The soundboard-audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
  }
  if (config.allowSoundboardChanges && config.soundboardGuildIds.size === 0) {
    warnings.push("The soundboard-change toggle is enabled but changes remain blocked because an exact guild allowlist is required")
  }
  if (config.allowSoundboardPlayback && config.soundboardPlaybackChannelIds.size === 0) {
    warnings.push("The soundboard-playback toggle is enabled but playback remains blocked because an exact ordinary voice-channel allowlist is required")
  }
  if (
    config.allowSoundboardChanges
    && config.soundboardGuildIds.size > 0
    && config.soundboardRoots.length === 0
  ) {
    warnings.push("Soundboard updates and deletions are enabled, but creation remains blocked because no canonical local roots are configured")
  }
  if (config.allowStageInstanceAudit && config.stageChannelIds.size === 0) {
    warnings.push("The Stage-instance audit toggle is enabled but inventory remains blocked because an exact Stage-channel allowlist is required")
  }
  if (config.allowStageInstanceChanges && config.stageChannelIds.size === 0) {
    warnings.push("The Stage-instance change toggle is enabled but changes remain blocked because an exact Stage-channel allowlist is required")
  }
  const applicationIntentRequirements = applicationPostureRequirementsForConfig(config)
  if (
    config.allowApplicationIntentChanges
    && !applicationIntentRequirements.guildMembersIntentRequired
    && applicationIntentRequirements.messageContentIntent === "not-required"
  ) {
    warnings.push("Application privileged-intent enablement is enabled, but no configured capability requires or recommends an eligible intent")
  }
  for (const [enabled, toolset, capability] of [
    [config.allowAdministration, "moderation", "Member administration"],
    [
      config.allowBulkBanAudit || config.allowBulkBans,
      "bulk-bans",
      "Reviewed bulk guild bans",
    ],
    [
      config.allowGuildPruneAudit || config.allowGuildPrunes,
      "guild-prunes",
      "Reviewed bounded guild pruning",
    ],
    [
      config.allowApplicationEmojiAudit || config.allowApplicationEmojiChanges,
      "application-emojis",
      "Application emoji audit and reviewed changes",
    ],
    [
      config.allowApplicationCommandChanges,
      "application-commands",
      "Reviewed guild application-command changes",
    ],
    [
      config.allowGlobalApplicationCommandChanges,
      "application-commands",
      "Reviewed global application-command changes",
    ],
    [
      config.allowApplicationIntentChanges,
      "application-security",
      "Reviewed application privileged-intent enablement",
    ],
    [
      config.allowBotProfileAudit || config.allowBotProfileChanges,
      "bot-profile",
      "Current-bot profile audit and reviewed changes",
    ],
    [
      config.allowApplicationMonetizationAudit,
      "application-monetization",
      "Exact-beneficiary application monetization audit",
    ],
    [
      config.allowApplicationEntitlementConsumption
        || config.allowApplicationTestEntitlementChanges,
      "application-entitlement-changes",
      "Reviewed application entitlement lifecycle changes",
    ],
    [
      config.allowApplicationRoleConnectionMetadataChanges,
      "linked-roles",
      "Reviewed application linked-role metadata changes",
    ],
    [config.allowAttachments, "attachments", "Attachment messages"],
    [config.allowEmbedMessages, "embed-messages", "Static rich-embed messages"],
    [
      config.allowAutomodAudit || config.allowAutomodChanges,
      "automod",
      "AutoMod audit and changes",
    ],
    [config.allowChannelCreation, "channel-creation", "Channel creation"],
    [config.allowChannelMetadataChanges, "channel-metadata", "Channel metadata changes"],
    [config.allowDeletions, "deletion", "Message deletion"],
    [
      config.allowDirectMessageAudit
        || config.allowDirectMessageAttachments
        || config.allowDirectMessageDeletion
        || config.allowDirectMessageDelivery
        || config.allowDirectMessageEditing,
      "direct-messages",
      "Exact-user private messages",
    ],
    [config.allowForumPosts, "forum-posts", "Forum-post creation"],
    [
      config.allowForumTagAudit || config.allowForumTagChanges,
      "forum-tags",
      "Forum-tag audit and reviewed changes",
    ],
    [config.allowThreadCreation, "threads", "Reviewed thread creation"],
    [
      config.allowThreadAudit || config.allowThreadChanges,
      "thread-governance",
      "Thread governance audit and reviewed changes",
    ],
    [config.allowGateway, "gateway", "Gateway events"],
    [
      config.allowGuildScaffolds
        && (config.allowGuildProfileChanges || config.allowGuildSettingsChanges),
      "guild-blueprints",
      "Guild blueprints",
    ],
    [config.allowGuildScaffolds, "guild-scaffolds", "Guild scaffolds"],
    [config.allowGuildDepartures, "guild-departure", "Reviewed guild departure"],
    [
      config.allowGuildTemplateAudit || config.allowGuildTemplateChanges,
      "guild-templates",
      "Guild Template audit and reviewed changes",
    ],
    [
      config.allowGuildExpressionAudit || config.allowGuildExpressionChanges,
      "guild-expressions",
      "Guild expression audit and changes",
    ],
    [
      config.allowInteractions
        || config.allowReactionUserAudit
        || config.allowReactionModeration,
      "interactions",
      "Message interactions and reaction lifecycle",
    ],
    [
      config.allowIntegrationAudit || config.allowIntegrationDeletions,
      "integrations",
      "Integration audit and reviewed deletion",
    ],
    [
      config.allowNativeCommandChanges || config.allowNativeInteractions,
      "native-interactions",
      "Native Interaction command, ingress, response, and continuation lifecycle",
    ],
    [
      config.allowInviteAudit || config.allowInviteCreation || config.allowInviteDeletions,
      "invites",
      "Invite creation, audit, and reviewed revocation",
    ],
    [
      config.allowOnboardingAudit || config.allowOnboardingChanges,
      "onboarding",
      "Onboarding audit and reviewed replacement",
    ],
    [
      config.allowWelcomeScreenAudit || config.allowWelcomeScreenChanges,
      "welcome-screen",
      "Welcome Screen audit and reviewed replacement",
    ],
    [
      config.allowWidgetSettingsAudit
        || config.allowWidgetSettingsChanges
        || config.allowWidgetPublicExposure,
      "widget-settings",
      "Authenticated widget-settings audit and reviewed changes",
    ],
    [
      config.allowGuildSettingsAudit || config.allowGuildSettingsChanges,
      "guild-settings",
      "Guild-settings audit and reviewed changes",
    ],
    [
      config.allowGuildCommunityAudit || config.allowGuildCommunityChanges,
      "guild-community",
      "Guild Community audit and reviewed monotonic changes",
    ],
    [
      config.allowGuildIncidentAudit || config.allowGuildIncidentChanges,
      "guild-incidents",
      "Guild incident-action audit and reviewed changes",
    ],
    [
      config.allowGuildProfileAudit || config.allowGuildProfileChanges,
      "guild-profile",
      "Guild profile audit and reviewed text changes",
    ],
    [config.allowMemberDirectory, "members", "Member directory"],
    [config.allowBanAudit, "bans", "Guild ban audit"],
    [config.allowNicknameChanges, "member-nicknames", "Reviewed member nickname changes"],
    [
      config.allowMemberVerificationChanges,
      "member-verification",
      "Reviewed member verification-bypass changes",
    ],
    [
      config.allowMemberRoleChanges || config.allowBulkMemberRoleChanges,
      "member-roles",
      "Single-member and reviewed bulk member-role changes",
    ],
    [
      config.allowMemberVoiceAudit || config.allowMemberVoiceChanges,
      "voice-moderation",
      "Member voice audit and reviewed changes",
    ],
    [config.allowPinManagement, "pins", "Message pin management"],
    [config.allowMessageForwarding, "message-forwarding", "Reviewed message forwarding"],
    [
      config.allowAnnouncementCrossposts,
      "announcement-crossposts",
      "Announcement crossposts",
    ],
    [
      config.allowAnnouncementSubscriptionAudit
        || config.allowAnnouncementSubscriptionChanges,
      "announcement-subscriptions",
      "Announcement-subscription audit and reviewed changes",
    ],
    [
      config.allowPollAudit
        || config.allowPollCreation
        || config.allowPollEnding
        || config.allowPollVoterAudit,
      "polls",
      "Native poll audit and reviewed changes",
    ],
    [config.allowPermissionOverwrites, "permission-overwrites", "Channel permission overwrites"],
    [config.allowPermissionSyncs, "permission-sync", "Parent-category permission synchronization"],
    [config.allowRoleCreation, "role-creation", "Role creation"],
    [config.allowRoleConfiguration, "role-configuration", "Role configuration"],
    [
      config.allowChannelCloneAudit || config.allowChannelCloning,
      "channel-cloning",
      "Channel-clone audit and reviewed changes",
    ],
    [
      config.allowChannelOrderingAudit || config.allowChannelOrderingChanges,
      "channel-ordering",
      "Channel-order audit and reviewed changes",
    ],
    [
      config.allowChannelDeletionAudit || config.allowChannelDeletions,
      "channel-deletion",
      "Channel-deletion readiness and reviewed execution",
    ],
    [
      config.allowRoleDeletionAudit || config.allowRoleDeletions,
      "role-deletion",
      "Role-deletion readiness and reviewed execution",
    ],
    [
      config.allowRoleOrderingAudit || config.allowRoleOrderingChanges,
      "role-ordering",
      "Role-order audit and reviewed changes",
    ],
    [
      config.allowScheduledEventAudit || config.allowScheduledEventChanges,
      "scheduled-events",
      "Scheduled event audit and changes",
    ],
    [
      config.allowSoundboardAudit
        || config.allowSoundboardChanges
        || config.allowSoundboardPlayback,
      "soundboard",
      "Soundboard audit, guarded playback, and reviewed changes",
    ],
    [
      config.allowStageInstanceAudit
        || config.allowStageInstanceChanges
        || config.allowStageStartNotifications,
      "stage-instances",
      "Stage instance audit and reviewed lifecycle",
    ],
    [
      config.allowWebhookAudit
        || config.allowWebhookChanges
        || config.allowWebhookCreation
        || config.allowWebhookDeletions,
      "webhooks",
      "Webhook audit and administration",
    ],
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

const SETUP_EXISTING_INTENT_FINDINGS = new Set([
  "recommended-message-content-intent-disabled",
  "required-guild-members-intent-disabled",
  "required-message-content-intent-disabled",
  "unknown-required-intent-state",
])

function applicationPostureWarnings(status: ConnectorStatus): string[] {
  return status.applicationPosture.findings
    .filter(({ code }) => !SETUP_EXISTING_INTENT_FINDINGS.has(code))
    .map(({ action, summary }) => `${summary}; ${action}`)
}

function redactedError(
  error: unknown,
  environment: NodeJS.ProcessEnv,
  resolvedToken?: string,
): string {
  const tokens = resolvedToken
    ? [resolvedToken, resolvedToken.trim()]
    : Object.entries(environment)
        .filter(([name]) => DISCORD_TOKEN_ENVIRONMENT_PATTERN.test(name))
        .flatMap(([, token]) => [token, token?.trim()])
  return redactText(errorMessage(error), tokens)
}

function redactedSetupVerificationError(
  error: unknown,
  environment: NodeJS.ProcessEnv,
  resolvedToken: string,
): Error {
  const message = `Discord setup verification failed: ${redactedError(error, environment, resolvedToken)}`
  if (error instanceof DiscordApiError) {
    return new DiscordApiError({
      ...(error.code === undefined ? {} : { code: error.code }),
      message,
      method: error.method,
      ...(error.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: error.retryAfterMs }),
      route: error.route,
      status: error.status,
    })
  }
  return new ConfigurationError(message)
}

interface DoctorConfigState {
  configurationFailure?: unknown
  credentialAvailable: boolean
  credentialFailure?: unknown
  inspectionConfig?: ConnectorConfig
  operationalConfig?: ConnectorConfig
}

function diagnosticConfigDocument(
  document: ConnectorConfigDocument,
  variable: string,
): ConnectorConfigDocument {
  return {
    ...document,
    credential: {
      provider: "environment",
      variable,
    },
  }
}

function diagnosticCredentialVariable(environment: NodeJS.ProcessEnv): string {
  let suffix = 0
  while (true) {
    const variable = suffix === 0
      ? `${DOCTOR_DIAGNOSTIC_CREDENTIAL_VARIABLE_PREFIX}_TOKEN`
      : `${DOCTOR_DIAGNOSTIC_CREDENTIAL_VARIABLE_PREFIX}_${suffix}_TOKEN`
    if (!Object.hasOwn(environment, variable)) return variable
    suffix += 1
  }
}

function doctorConfigState(
  options: DoctorOptions,
  environment: NodeJS.ProcessEnv,
): DoctorConfigState {
  if (options.selectionFailure !== undefined) {
    return {
      configurationFailure: options.selectionFailure,
      credentialAvailable: false,
    }
  }

  if (options.config) {
    if (options.config.token.trim()) {
      return {
        credentialAvailable: true,
        inspectionConfig: options.config,
        operationalConfig: options.config,
      }
    }
    return {
      credentialAvailable: false,
      credentialFailure: new ConfigurationError("Selected bot credential is missing"),
      inspectionConfig: options.config,
    }
  }

  if (options.document) {
    let document: ConnectorConfigDocument
    try {
      document = parseConnectorConfigDocument(options.document)
    } catch (error) {
      return {
        configurationFailure: error,
        credentialAvailable: false,
      }
    }

    let credentialFailure: unknown
    try {
      resolveConnectorCredential(document.credential, environment)
    } catch (error) {
      credentialFailure = error
    }

    if (credentialFailure === undefined) {
      try {
        const config = loadConnectorConfigDocument(document, environment)
        return {
          credentialAvailable: true,
          inspectionConfig: config,
          operationalConfig: config,
        }
      } catch (error) {
        return {
          configurationFailure: error,
          credentialAvailable: true,
        }
      }
    }

    try {
      const diagnosticVariable = diagnosticCredentialVariable(environment)
      const inspectionConfig = loadConnectorConfigDocument(
        diagnosticConfigDocument(document, diagnosticVariable),
        {
          ...environment,
          [diagnosticVariable]: DOCTOR_DIAGNOSTIC_CREDENTIAL_VALUE,
        },
      )
      return {
        credentialAvailable: false,
        credentialFailure,
        inspectionConfig,
      }
    } catch (error) {
      return {
        configurationFailure: error,
        credentialAvailable: false,
        credentialFailure,
      }
    }
  }

  try {
    const config = loadConnectorConfig(environment)
    return {
      credentialAvailable: true,
      inspectionConfig: config,
      operationalConfig: config,
    }
  } catch (error) {
    return {
      configurationFailure: error,
      credentialAvailable: false,
    }
  }
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

  const configState = doctorConfigState(options, environment)
  const config = configState.inspectionConfig
  const operationalConfig = configState.operationalConfig

  checks.push(configState.credentialAvailable
    ? check(
      DOCTOR_CHECK_IDS.token,
      "pass",
      "Selected bot credential is present",
    )
    : check(
      DOCTOR_CHECK_IDS.token,
      "fail",
      configState.credentialFailure === undefined
        ? configState.configurationFailure === undefined
          ? "Selected bot credential is missing"
          : "Selected bot credential could not be inspected because the selected configuration is unavailable"
        : `Selected bot credential is unavailable: ${redactedError(configState.credentialFailure, environment)}`,
    ))

  if (config) {
    checks.push(check(
      DOCTOR_CHECK_IDS.configuration,
      "pass",
      "Connector configuration is valid",
    ))
  } else {
    checks.push(check(
      DOCTOR_CHECK_IDS.configuration,
      "fail",
      redactedError(configState.configurationFailure, environment),
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
        "identity.applicationId is not set, so token identity is not pinned locally",
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
        "identity.botId is not set, so bot identity is not pinned locally",
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
    const toolAccessManifest = createMcpToolAccessManifest(config.mcpToolsets)
    const toolAccessStages = Object.entries(toolAccessManifest.stageCounts)
      .map(([stage, count]) => `${stage}=${count}`)
      .join(", ")
    checks.push(check(
      DOCTOR_CHECK_IDS.toolAccessContract,
      "pass",
      `Machine-readable access lifecycles cover local discovery plus every selected canonical tool (${toolAccessStages}); classifications grant no authority and target readiness remains operation-specific`,
    ))
    checks.push(check(
      DOCTOR_CHECK_IDS.readResponseBudget,
      "pass",
      `Complete redacted MCP read results are limited to ${config.mcpReadResponseMaxBytes} UTF-8 bytes; oversized reads fail whole without truncation and final mutation outcomes are preserved`,
    ))
    if (!config.allowDirectMessageAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageAuditPolicy,
        "pass",
        "Exact-user private-message reads are disabled",
      ))
    } else if (config.directMessageUserIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageAuditPolicy,
        "warn",
        "Private-message audit is enabled, but the required exact user allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageAuditPolicy,
        "pass",
        `Private-message reads are constrained to ${config.directMessageUserIds.size} exact users and caller-known one-to-one channel IDs with transient plain-text, normalized static Components V2, or bounded URL-free single-attachment metadata, generated-ID omission, no DM discovery, and no persistence`,
      ))
    }
    if (!config.allowDirectMessageDelivery) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageDeliveryPolicy,
        "pass",
        "Reviewed private-message sends and replies are disabled",
      ))
    } else if (config.directMessageUserIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageDeliveryPolicy,
        "warn",
        "Private-message delivery is enabled, but the required exact user allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageDeliveryPolicy,
        "pass",
        `Private-message plain-text or static Components V2 sends and replies are constrained to ${config.directMessageUserIds.size} exact users with contact acknowledgement, complete-body-bound review, forced empty mentions, fixed anti-spam limits, request-bound schema-v2 receipts, no automatic mutation retry, and exact readback`,
      ))
    }
    if (!config.allowDirectMessageAttachments) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageAttachmentPolicy,
        "pass",
        "Reviewed private-message owned-file delivery is disabled",
      ))
    } else if (
      !config.allowDirectMessageDelivery
      || config.directMessageUserIds.size === 0
      || config.attachmentRoots.length === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageAttachmentPolicy,
        "warn",
        "Private-message owned-file delivery requires the delivery gate, an exact user allowlist, and at least one canonical attachment root",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageAttachmentPolicy,
        "pass",
        `Private-message owned-file delivery is constrained to ${config.directMessageUserIds.size} exact users and ${config.attachmentRoots.length} canonical roots with a ${config.attachmentMaxBytes}-byte ceiling, fresh byte-bound review, one non-retried multipart upload, URL-free readback, and content-free recovery`,
      ))
    }
    if (!config.allowDirectMessageEditing) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageEditingPolicy,
        "pass",
        "Reviewed private-message editing is disabled",
      ))
    } else if (config.directMessageUserIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageEditingPolicy,
        "warn",
        "Private-message editing is enabled, but the required exact user allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageEditingPolicy,
        "pass",
        `Private-message editing is constrained to exact same-format connector-authored plain-text or static Components V2 messages involving ${config.directMessageUserIds.size} configured users with signed approval and exact readback`,
      ))
    }
    if (!config.allowDirectMessageDeletion) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageDeletionPolicy,
        "pass",
        "Reviewed private-message deletion is disabled",
      ))
    } else if (config.directMessageUserIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageDeletionPolicy,
        "warn",
        "Private-message deletion is enabled, but the required exact user allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.directMessageDeletionPolicy,
        "pass",
        `Private-message deletion is constrained to exact supported connector-authored plain-text, static Components V2, or single-attachment messages involving ${config.directMessageUserIds.size} configured users with irreversible acknowledgement, signed approval, one non-retried deletion, and exact absence readback`,
      ))
    }
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
        `Member administration is constrained to ${config.adminGuildIds.size} guilds with ${config.protectedUserIds.size} protected users, durable exact-member coordination, one-shot receipt reservation, and exact fresh readback`,
      ))
    }
    if (!config.allowBulkBanAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkBanAuditPolicy,
        "pass",
        "Reviewed bulk guild-ban planning is disabled",
      ))
    } else if (config.bulkBanGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkBanAuditPolicy,
        "warn",
        "Bulk-ban audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkBanAuditPolicy,
        "pass",
        `Bulk guild-ban planning is constrained to ${config.bulkBanGuildIds.size} exact guilds with protected-user exclusion, complete BAN_MEMBERS plus MANAGE_GUILD evidence, per-target hierarchy checks, and no writes`,
      ))
    }
    if (!config.allowBulkBans) {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkBanChangePolicy,
        "pass",
        "Reviewed bulk guild-ban execution is disabled",
      ))
    } else if (!config.allowBulkBanAudit || config.bulkBanGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkBanChangePolicy,
        "warn",
        "Bulk-ban execution is enabled, but reviewed audit and a non-empty exact guild allowlist are required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkBanChangePolicy,
        "pass",
        `Bulk guild-ban execution is constrained to ${config.bulkBanGuildIds.size} exact guilds with complete-set durable member claims, signed approval, one non-retried native batch request, explicit partial outcomes, and exact per-target readback`,
      ))
    }
    if (!config.allowGuildPruneAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildPruneAuditPolicy,
        "pass",
        "Reviewed bounded guild-prune planning is disabled",
      ))
    } else if (config.guildPruneGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildPruneAuditPolicy,
        "warn",
        "Guild-prune audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildPruneAuditPolicy,
        "pass",
        `Guild-prune planning is constrained to ${config.guildPruneGuildIds.size} exact guilds, ${config.guildPruneIncludeRoleIds.size} optional include roles, a ${config.guildPruneMaxMembers}-member policy ceiling, protected-identity role shields, complete KICK_MEMBERS plus MANAGE_GUILD evidence, and no writes`,
      ))
    }
    if (!config.allowGuildPrunes) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildPruneChangePolicy,
        "pass",
        "Reviewed bounded guild-prune execution is disabled",
      ))
    } else if (!config.allowGuildPruneAudit || config.guildPruneGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildPruneChangePolicy,
        "warn",
        "Guild-prune execution is enabled, but reviewed audit and a non-empty exact guild allowlist are required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildPruneChangePolicy,
        "pass",
        `Guild-prune execution is constrained to ${config.guildPruneGuildIds.size} exact guilds with two pre-dispatch count ceilings, signed approval, durable member-collection and exact-role claims, one non-retried request, returned-count settlement, and no exact-member or rollback claim`,
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
    if (!config.allowChannelCloneAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCloneAuditPolicy,
        "pass",
        "Channel-clone audit is disabled",
      ))
    } else if (
      config.channelCloneGuildIds.size === 0
      || config.channelCloneSourceIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCloneAuditPolicy,
        "warn",
        "Channel-clone audit is enabled, but exact guild and source-channel allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCloneAuditPolicy,
        "pass",
        `Channel-clone audit is constrained to ${config.channelCloneSourceIds.size} exact sources across ${config.channelCloneGuildIds.size} exact guilds with complete obfuscation-safe topology, strict source evidence, capacity, and authority checks`,
      ))
    }
    if (!config.allowChannelCloning) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCloneChangePolicy,
        "pass",
        "Reviewed channel cloning is disabled",
      ))
    } else if (
      config.channelCloneGuildIds.size === 0
      || config.channelCloneSourceIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCloneChangePolicy,
        "warn",
        "Channel cloning is enabled, but exact guild and source-channel allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelCloneChangePolicy,
        "pass",
        `Reviewed channel cloning is constrained to ${config.channelCloneSourceIds.size} exact sources across ${config.channelCloneGuildIds.size} exact guilds with signed approval, atomic one-shot creation, content-free auditing, and newer complete Gateway verification`,
      ))
    }
    if (!config.allowChannelMetadataChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelMetadataPolicy,
        "pass",
        "Reviewed channel metadata changes are disabled",
      ))
    } else if (config.channelMetadataIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelMetadataPolicy,
        "warn",
        "Channel-metadata toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelMetadataPolicy,
        "pass",
        `Reviewed channel metadata changes are constrained to ${config.channelMetadataIds.size} exact channels with partial one-shot execution and complete response plus fresh readback verification`,
      ))
    }
    if (!config.allowChannelMetadataChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.voiceChannelStatusPolicy,
        "pass",
        "Voice channel status reads and changes are disabled with channel metadata changes",
      ))
    } else if (config.channelMetadataIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.voiceChannelStatusPolicy,
        "warn",
        "Voice channel status is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.voiceChannelStatusPolicy,
        "pass",
        `Voice channel status is constrained to ${config.channelMetadataIds.size} exact metadata-scope candidates, enforces ordinary voice type at read time, requires connection-sensitive permission proof, and uses privacy-minimized GUILDS-only Gateway channel-info evidence`,
      ))
    }
    if (!config.allowChannelOrderingAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingAuditPolicy,
        "pass",
        "Channel-order audit is disabled",
      ))
    } else if (config.channelOrderingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingAuditPolicy,
        "warn",
        "Channel-order audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingAuditPolicy,
        "pass",
        `Channel-order audit is constrained to ${config.channelOrderingGuildIds.size} exact guilds with a complete obfuscation-safe Gateway layout, bounded HTTP evidence, and MANAGE_CHANNELS authority`,
      ))
    }
    if (!config.allowChannelOrderingChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingChangePolicy,
        "pass",
        "Reviewed channel-placement changes are disabled",
      ))
    } else if (config.channelOrderingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingChangePolicy,
        "warn",
        "Channel-placement changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingChangePolicy,
        "pass",
        `Reviewed channel-placement changes are constrained to ${config.channelOrderingGuildIds.size} exact guilds with signed approval, exact cross-parent authority and overwrite preservation, one-shot execution, durable channel-collection coordination, and complete Gateway plus HTTP verification`,
      ))
    }
    if (!config.allowChannelDeletionAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelDeletionAuditPolicy,
        "pass",
        "Channel-deletion readiness audit is disabled",
      ))
    } else if (config.channelDeletionIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelDeletionAuditPolicy,
        "warn",
        "Channel-deletion audit is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelDeletionAuditPolicy,
        "pass",
        `Channel-deletion readiness is constrained to ${config.channelDeletionIds.size} exact channels with complete topology, dependency, permission, and privacy-safe evidence`,
      ))
    }
    if (!config.allowChannelDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelDeletionChangePolicy,
        "pass",
        "Reviewed channel deletion is disabled",
      ))
    } else if (config.channelDeletionIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelDeletionChangePolicy,
        "warn",
        "Channel deletion is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelDeletionChangePolicy,
        "pass",
        `Reviewed channel deletion is constrained to ${config.channelDeletionIds.size} exact channels with irreversible acknowledgement, signed approval, one-shot execution, content-free auditing, durable guild-channel coordination, and newer Gateway absence verification`,
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
        `Message deletion is constrained to ${config.deleteChannelIds.size} exact channels with durable per-message coordination, one-shot execution, and exact absence readback`,
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
    if (!config.allowForumTagAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumTagAuditPolicy,
        "pass",
        "Exact stable-forum tag audit is disabled",
      ))
    } else if (config.forumTagChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumTagAuditPolicy,
        "warn",
        "Forum-tag audit is enabled, but the required exact stable-forum allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumTagAuditPolicy,
        "pass",
        `Forum-tag audit is constrained to ${config.forumTagChannelIds.size} exact stable forums with complete transient ordered inventory and no post enumeration`,
      ))
    }
    if (!config.allowForumTagChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumTagChangePolicy,
        "pass",
        "Reviewed forum-tag changes are disabled",
      ))
    } else if (config.forumTagChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumTagChangePolicy,
        "warn",
        "Forum-tag changes are enabled, but the required exact stable-forum allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.forumTagChangePolicy,
        "pass",
        `Reviewed forum-tag changes are constrained to ${config.forumTagChannelIds.size} exact stable forums with full-inventory planning, one non-retried replacement, and complete response plus fresh readback verification`,
      ))
    }
    if (!config.allowThreadCreation) {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadCreationPolicy,
        "pass",
        "Reviewed thread creation is disabled",
      ))
    } else if (config.threadParentIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadCreationPolicy,
        "warn",
        "Thread-creation toggle is enabled, but the required exact parent-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadCreationPolicy,
        "pass",
        `Reviewed thread creation is constrained to ${config.threadParentIds.size} exact parents with signed approval, one-shot execution, anchored recovery, and exact readback`,
      ))
    }
    if (!config.allowThreadAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadAuditPolicy,
        "pass",
        "Exact thread-governance audit is disabled",
      ))
    } else if (config.threadGuildIds.size === 0 || config.threadIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadAuditPolicy,
        "warn",
        "Thread-audit toggle is enabled, but exact guild and thread allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadAuditPolicy,
        "pass",
        `Thread audit is constrained to ${config.threadIds.size} exact threads in ${config.threadGuildIds.size} exact guilds without member enumeration or persistence`,
      ))
    }
    if (!config.allowThreadChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadChangePolicy,
        "pass",
        "Reviewed thread-governance changes are disabled",
      ))
    } else if (config.threadGuildIds.size === 0 || config.threadIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadChangePolicy,
        "warn",
        "Thread-change toggle is enabled, but exact guild and thread allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.threadChangePolicy,
        "pass",
        `Reviewed thread changes are constrained to ${config.threadIds.size} exact threads with signed approval, one-shot execution, exact readback, and uncertainty quarantine`,
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
    if (!config.allowAnnouncementCrossposts) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementCrosspostPolicy,
        "pass",
        "Reviewed announcement crossposts are disabled",
      ))
    } else if (config.announcementCrosspostChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementCrosspostPolicy,
        "warn",
        "Announcement-crosspost toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementCrosspostPolicy,
        "pass",
        `Reviewed announcement crossposts are constrained to ${config.announcementCrosspostChannelIds.size} exact channels with authorship-sensitive permission proof, one-shot execution, and strict response plus readback verification`,
      ))
    }
    if (!config.allowMessageForwarding) {
      checks.push(check(
        DOCTOR_CHECK_IDS.messageForwardPolicy,
        "pass",
        "Reviewed message forwarding is disabled",
      ))
    } else if (
      config.messageForwardSourceChannelIds.size === 0
      || config.messageForwardTargetChannelIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.messageForwardPolicy,
        "warn",
        "Message forwarding is enabled, but exact source and target channel allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.messageForwardPolicy,
        "pass",
        `Reviewed message forwarding is constrained to ${config.messageForwardSourceChannelIds.size} exact source channels and ${config.messageForwardTargetChannelIds.size} exact target channels with ${config.allowCrossGuildMessageForwarding ? "explicit cross-guild authorization" : "same-guild enforcement"}, age-restriction downgrade prevention, complete permission evidence including unknown bits, forced empty mentions, suppressed notifications, one-shot execution, immutable-snapshot validation, and exact readback`,
      ))
    }
    if (!config.allowAnnouncementSubscriptionAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionAuditPolicy,
        "pass",
        "Announcement-subscription audit is disabled",
      ))
    } else if (config.announcementSubscriptionTargetChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionAuditPolicy,
        "warn",
        "Announcement-subscription audit is enabled, but the required exact target-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionAuditPolicy,
        "pass",
        `Announcement-subscription audit is constrained to ${config.announcementSubscriptionTargetChannelIds.size} exact target channels with aggregate capacity, exact Channel Follower subscriptions, source IDs only when available inside local read scope, unrelated webhook IDs omitted, complete VIEW_CHANNEL and MANAGE_WEBHOOKS evidence, and no message access`,
      ))
    }
    if (!config.allowAnnouncementSubscriptionChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionChangePolicy,
        "pass",
        "Reviewed announcement-subscription changes are disabled",
      ))
    } else if (config.announcementSubscriptionTargetChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionChangePolicy,
        "warn",
        "Announcement-subscription changes are enabled, but the required exact target-channel allowlist is empty",
      ))
    } else if (config.announcementSubscriptionSourceChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionChangePolicy,
        "warn",
        `Exact-ID unsubscription is constrained to ${config.announcementSubscriptionTargetChannelIds.size} target channels, but new subscriptions remain blocked because the source-channel allowlist is empty`,
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.announcementSubscriptionChangePolicy,
        "pass",
        `Reviewed subscription changes are constrained to ${config.announcementSubscriptionSourceChannelIds.size} exact announcement sources and ${config.announcementSubscriptionTargetChannelIds.size} exact text targets with duplicate and capacity checks, signed approval, one non-retried mutation, exact inventory readback, and uncertainty quarantine`,
      ))
    }
    if (!config.allowPollAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollAuditPolicy,
        "pass",
        "Native poll audit is disabled",
      ))
    } else if (config.pollChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollAuditPolicy,
        "warn",
        "Poll-audit toggle is enabled, but the required exact poll-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollAuditPolicy,
        "pass",
        `Native poll audit is constrained to ${config.pollChannelIds.size} exact channels with bounded transient aggregate results and no persistence`,
      ))
    }
    if (!config.allowPollVoterAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollVoterAuditPolicy,
        "pass",
        "Poll voter audit is disabled",
      ))
    } else if (config.pollChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollVoterAuditPolicy,
        "warn",
        "Poll-voter-audit toggle is enabled, but the required exact poll-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollVoterAuditPolicy,
        "pass",
        `Poll voter audit is constrained to ${config.pollChannelIds.size} exact channels with bounded ID-only pages and no profile persistence`,
      ))
    }
    if (!config.allowPollCreation) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollCreationPolicy,
        "pass",
        "Reviewed native poll creation is disabled",
      ))
    } else if (config.pollChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollCreationPolicy,
        "warn",
        "Poll-creation toggle is enabled, but the required exact poll-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollCreationPolicy,
        "pass",
        `Reviewed native poll creation is constrained to ${config.pollChannelIds.size} exact channels with signed approval, nonce-bound one-shot execution, and exact readback`,
      ))
    }
    if (!config.allowPollEnding) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollEndPolicy,
        "pass",
        "Reviewed native poll ending is disabled",
      ))
    } else if (config.pollChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollEndPolicy,
        "warn",
        "Poll-ending toggle is enabled, but the required exact poll-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.pollEndPolicy,
        "pass",
        `Reviewed native poll ending is constrained to ${config.pollChannelIds.size} exact channels with live-count-bound approval, one-shot execution, and finalization-aware readback`,
      ))
    }
    if (!config.allowReactionUserAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.reactionUserAuditPolicy,
        "pass",
        "Reaction user audit is disabled; aggregate reaction reads remain available through ordinary read scope",
      ))
    } else if (config.reactionChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.reactionUserAuditPolicy,
        "warn",
        "Reaction-user-audit toggle is enabled, but the required exact reaction-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.reactionUserAuditPolicy,
        "pass",
        `Reaction user audit is constrained to ${config.reactionChannelIds.size} exact channels with bounded ID-and-bot-only pages and no profile persistence`,
      ))
    }
    if (!config.allowReactionModeration) {
      checks.push(check(
        DOCTOR_CHECK_IDS.reactionModerationPolicy,
        "pass",
        "Reviewed reaction moderation is disabled",
      ))
    } else if (config.reactionChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.reactionModerationPolicy,
        "warn",
        "Reaction-moderation toggle is enabled, but the required exact reaction-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.reactionModerationPolicy,
        "pass",
        `Reviewed reaction moderation is constrained to ${config.reactionChannelIds.size} exact channels with complete permission proof, exact-message coordination, signed approval, one-shot non-retried execution, content-free audit, and target-absence readback`,
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
    if (!config.allowPermissionSyncs) {
      checks.push(check(
        DOCTOR_CHECK_IDS.permissionSyncPolicy,
        "pass",
        "Reviewed parent-category permission synchronization is disabled",
      ))
    } else if (config.permissionSyncChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.permissionSyncPolicy,
        "warn",
        "Parent-category permission synchronization is enabled, but the required exact direct child-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.permissionSyncPolicy,
        "pass",
        `Reviewed parent-category permission synchronization is constrained to ${config.permissionSyncChannelIds.size} exact direct child channels with complete child and parent overwrite review, protected-member checks, connector continuity proof, signed approval, one-shot non-retried replacement, and exact synchronized-state readback`,
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
    if (!config.allowRoleConfiguration) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleConfigurationPolicy,
        "pass",
        "Reviewed role configuration is disabled",
      ))
    } else if (config.roleConfigurationIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleConfigurationPolicy,
        "warn",
        "Role-configuration toggle is enabled, but the required exact role allowlist is empty",
      ))
    } else if (config.guildExpressionRoots.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleConfigurationPolicy,
        "warn",
        `Reviewed role configuration is constrained to ${config.roleConfigurationIds.size} exact roles, but local-image role icons are blocked because canonical expression roots are empty`,
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleConfigurationPolicy,
        "pass",
        `Reviewed role configuration is constrained to ${config.roleConfigurationIds.size} exact roles and ${config.guildExpressionRoots.length} canonical local-image roots with partial updates, one-shot execution, and exact or response-bound complete readback`,
      ))
    }
    if (!config.allowRoleDeletionAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleDeletionAuditPolicy,
        "pass",
        "Role-deletion readiness audit is disabled",
      ))
    } else if (config.roleDeletionIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleDeletionAuditPolicy,
        "warn",
        "Role-deletion audit is enabled, but the required exact role allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleDeletionAuditPolicy,
        "pass",
        `Role-deletion readiness is constrained to ${config.roleDeletionIds.size} exact roles with complete holder, hierarchy, dependency, permission, and privacy-safe evidence`,
      ))
    }
    if (!config.allowRoleDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleDeletionChangePolicy,
        "pass",
        "Reviewed role deletion is disabled",
      ))
    } else if (config.roleDeletionIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleDeletionChangePolicy,
        "warn",
        "Role deletion is enabled, but the required exact role allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleDeletionChangePolicy,
        "pass",
        `Reviewed role deletion is constrained to ${config.roleDeletionIds.size} exact roles with irreversible acknowledgement, signed approval, one-shot execution, content-free auditing, durable guild-wide coordination, and fresh absence verification`,
      ))
    }
    if (!config.allowRoleOrderingAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleOrderingAuditPolicy,
        "pass",
        "Role-order audit is disabled",
      ))
    } else if (config.roleOrderingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleOrderingAuditPolicy,
        "warn",
        "Role-order audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleOrderingAuditPolicy,
        "pass",
        `Role-order audit is constrained to ${config.roleOrderingGuildIds.size} exact guilds with complete hierarchy, authority, and aggregate holder evidence`,
      ))
    }
    if (!config.allowRoleOrderingChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleOrderingChangePolicy,
        "pass",
        "Reviewed role-order changes are disabled",
      ))
    } else if (config.roleOrderingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleOrderingChangePolicy,
        "warn",
        "Role-order changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleOrderingChangePolicy,
        "pass",
        `Reviewed role-order changes are constrained to ${config.roleOrderingGuildIds.size} exact guilds with signed approval, one-shot execution, durable collection coordination, and complete readback`,
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
    if (!config.allowGuildTemplateAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildTemplateAuditPolicy,
        "pass",
        "Capability-safe Guild Template audit is disabled",
      ))
    } else if (config.guildTemplateGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildTemplateAuditPolicy,
        "warn",
        "Guild Template audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildTemplateAuditPolicy,
        "pass",
        `Capability-safe Guild Template audit is constrained to ${config.guildTemplateGuildIds.size} guilds with opaque process-local references and count-only snapshot evidence`,
      ))
    }
    if (!config.allowGuildTemplateChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildTemplateChangePolicy,
        "pass",
        "Reviewed Guild Template changes are disabled",
      ))
    } else if (config.guildTemplateGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildTemplateChangePolicy,
        "warn",
        "Guild Template changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildTemplateChangePolicy,
        "pass",
        `Reviewed Guild Template changes are constrained to ${config.guildTemplateGuildIds.size} guilds with full private-inventory planning, one-shot execution, and exact readback`,
      ))
    }
    if (!config.allowInteractions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.interactionPolicy,
        "pass",
        "Message interactions and reviewed component messages are disabled",
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
        `Message interactions and reviewed component messages are constrained to ${config.interactionChannelIds.size} channels with ${config.mentionUserIds.size} notification users, ${config.componentLinkOrigins.size} exact link origins, and a shared ${config.interactionMaxWritesPerMinute}-write rolling budget`,
      ))
    }
    if (!config.allowEmbedMessages) {
      checks.push(check(
        DOCTOR_CHECK_IDS.embedMessagePolicy,
        "pass",
        "Reviewed static rich-embed messages are disabled",
      ))
    } else if (config.embedMessageChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.embedMessagePolicy,
        "warn",
        "Embed-message capability is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.embedMessagePolicy,
        "pass",
        `Reviewed static rich-embed messages are constrained to ${config.embedMessageChannelIds.size} channels with ${config.mentionUserIds.size} notification users and the shared ${config.interactionMaxWritesPerMinute}-write rolling budget`,
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
    if (!config.allowBanAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.banAuditPolicy,
        "pass",
        "Privacy-safe guild ban audit is disabled",
      ))
    } else if (config.banAuditGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.banAuditPolicy,
        "warn",
        "Ban-audit toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.banAuditPolicy,
        "pass",
        `Guild ban audit is constrained to ${config.banAuditGuildIds.size} exact guilds with minimized profiles, default-redacted reasons, and complete BAN_MEMBERS evidence`,
      ))
    }
    if (!config.allowInviteAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteAuditPolicy,
        "pass",
        "Capability-safe guild invite audit is disabled",
      ))
    } else if (config.inviteGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteAuditPolicy,
        "warn",
        "Invite-audit toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteAuditPolicy,
        "pass",
        `Guild invite audit is constrained to ${config.inviteGuildIds.size} exact guilds with opaque references, capability-redacted inventory, and complete MANAGE_GUILD evidence`,
      ))
    }
    if (!config.allowInviteDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteDeletionPolicy,
        "pass",
        "Reviewed invite revocation is disabled",
      ))
    } else if (config.inviteGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteDeletionPolicy,
        "warn",
        "Invite-deletion toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteDeletionPolicy,
        "pass",
        `Reviewed invite revocation is constrained to ${config.inviteGuildIds.size} exact guilds with one-shot execution and full-inventory absence readback`,
      ))
    }
    if (!config.allowInviteCreation) {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteCreationPolicy,
        "pass",
        "Capability-safe invite creation is disabled",
      ))
    } else if (
      config.inviteCreationChannelIds.size === 0
      || config.inviteCapabilityRoots.length === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteCreationPolicy,
        "warn",
        "Invite-creation toggle is enabled, but exact channel scope and a canonical private-file root are both required",
      ))
    } else {
      const roleAssignmentSummary = config.allowInviteRoleAssignment
        ? ` Persistent role assignment is constrained to ${config.inviteRoleIds.size} exact roles with complete Gateway channel evidence, MANAGE_ROLES, strict hierarchy, permission-subset checks, minimum new-member impact review, selected-role coordination, and explicit persistence acknowledgement.`
        : " Persistent role assignment is disabled."
      checks.push(check(
        DOCTOR_CHECK_IDS.inviteCreationPolicy,
        "pass",
        `Invite creation is constrained to ${config.inviteCreationChannelIds.size} exact channels and ${config.inviteCapabilityRoots.length} private-file roots with complete VIEW_CHANNEL and CREATE_INSTANT_INVITE evidence, conditional MANAGE_GUILD for exact-user acceptance, explicit finite acceptance, exclusive 0600 delivery after verification, and no invite capability in MCP results or lifecycle records.${roleAssignmentSummary}`,
      ))
    }
    if (!config.allowOnboardingAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.onboardingAuditPolicy,
        "pass",
        "Privacy-safe guild onboarding audit is disabled",
      ))
    } else if (config.onboardingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.onboardingAuditPolicy,
        "warn",
        "Onboarding-audit toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.onboardingAuditPolicy,
        "pass",
        `Guild onboarding audit is constrained to ${config.onboardingGuildIds.size} exact guilds with default text omission, bounded complete evidence, and future-field counts only`,
      ))
    }
    if (!config.allowOnboardingChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.onboardingChangePolicy,
        "pass",
        "Reviewed guild onboarding replacement is disabled",
      ))
    } else if (config.onboardingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.onboardingChangePolicy,
        "warn",
        "Onboarding changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.onboardingChangePolicy,
        "pass",
        `Reviewed guild onboarding replacement is constrained to ${config.onboardingGuildIds.size} exact guilds with complete-state review, signed approval, one-shot execution, and authoritative response plus API readback`,
      ))
    }
    if (!config.allowWelcomeScreenAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.welcomeScreenAuditPolicy,
        "pass",
        "Privacy-safe guild Welcome Screen audit is disabled",
      ))
    } else if (config.welcomeScreenGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.welcomeScreenAuditPolicy,
        "warn",
        "Welcome Screen audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.welcomeScreenAuditPolicy,
        "pass",
        `Guild Welcome Screen audit is constrained to ${config.welcomeScreenGuildIds.size} exact guilds with default text omission, bounded complete evidence, and future-field counts only`,
      ))
    }
    if (!config.allowWelcomeScreenChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.welcomeScreenChangePolicy,
        "pass",
        "Reviewed guild Welcome Screen replacement is disabled",
      ))
    } else if (config.welcomeScreenGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.welcomeScreenChangePolicy,
        "warn",
        "Welcome Screen changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.welcomeScreenChangePolicy,
        "pass",
        `Reviewed guild Welcome Screen replacement is constrained to ${config.welcomeScreenGuildIds.size} exact guilds with complete-state review, signed approval, one-shot execution, and authoritative response plus API readback`,
      ))
    }
    if (!config.allowWidgetSettingsAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetSettingsAuditPolicy,
        "pass",
        "Authenticated guild widget-settings audit is disabled",
      ))
    } else if (config.widgetSettingsGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetSettingsAuditPolicy,
        "warn",
        "Authenticated widget-settings audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetSettingsAuditPolicy,
        "pass",
        `Authenticated widget-settings audit is constrained to ${config.widgetSettingsGuildIds.size} exact guilds with bounded permission and channel evidence, unknown-field counts only, and no anonymous endpoint calls`,
      ))
    }
    if (!config.allowWidgetSettingsChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetSettingsChangePolicy,
        "pass",
        "Reviewed authenticated widget-settings changes are disabled",
      ))
    } else if (config.widgetSettingsGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetSettingsChangePolicy,
        "warn",
        "Authenticated widget-settings changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetSettingsChangePolicy,
        "pass",
        `Reviewed authenticated widget-settings changes are constrained to ${config.widgetSettingsGuildIds.size} exact guilds with complete-state review, signed approval, one-shot execution, and authoritative response plus API readback`,
      ))
    }
    if (!config.allowWidgetPublicExposure) {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetPublicExposurePolicy,
        "pass",
        "Widget public-exposure authorization is disabled",
      ))
    } else if (config.widgetSettingsGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetPublicExposurePolicy,
        "warn",
        "Widget public-exposure authorization is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.widgetPublicExposurePolicy,
        "pass",
        `Widget public-exposure authorization is constrained to ${config.widgetSettingsGuildIds.size} exact guilds and is required only for enabling the widget or selecting a different non-null channel`,
      ))
    }
    if (!config.allowGuildSettingsAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildSettingsAuditPolicy,
        "pass",
        "Guild-settings audit is disabled",
      ))
    } else if (config.guildSettingsGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildSettingsAuditPolicy,
        "warn",
        "Guild-settings audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildSettingsAuditPolicy,
        "pass",
        `Guild-settings audit is constrained to ${config.guildSettingsGuildIds.size} exact guilds with complete permission and continuity-safe channel evidence plus named privacy-minimized state`,
      ))
    }
    if (!config.allowGuildSettingsChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildSettingsChangePolicy,
        "pass",
        "Reviewed guild-settings changes are disabled",
      ))
    } else if (config.guildSettingsGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildSettingsChangePolicy,
        "warn",
        "Guild-settings changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildSettingsChangePolicy,
        "pass",
        `Reviewed guild-settings changes are constrained to ${config.guildSettingsGuildIds.size} exact guilds with sparse named-field review, signed approval, one-shot execution, and authoritative response plus API readback`,
      ))
    }
    if (!config.allowGuildCommunityAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildCommunityAuditPolicy,
        "pass",
        "Privacy-minimized guild Community audit is disabled",
      ))
    } else if (config.guildCommunityGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildCommunityAuditPolicy,
        "warn",
        "Guild Community audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildCommunityAuditPolicy,
        "pass",
        `Guild Community audit is constrained to ${config.guildCommunityGuildIds.size} exact guilds with verified identity, complete permission and continuity-safe channel evidence, content-free feature digests, and exact routing IDs`,
      ))
    }
    if (!config.allowGuildCommunityChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildCommunityChangePolicy,
        "pass",
        "Reviewed guild Community changes are disabled",
      ))
    } else if (config.guildCommunityGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildCommunityChangePolicy,
        "warn",
        "Guild Community changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildCommunityChangePolicy,
        "pass",
        `Reviewed guild Community changes are constrained to ${config.guildCommunityGuildIds.size} exact guilds with monotonic feature preservation, dynamic ADMINISTRATOR or MANAGE_GUILD authority, signed approval, one-shot execution, and authoritative response plus API readback`,
      ))
    }
    if (!config.allowGuildIncidentAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildIncidentAuditPolicy,
        "pass",
        "Privacy-minimized guild incident-action audit is disabled",
      ))
    } else if (config.guildIncidentGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildIncidentAuditPolicy,
        "warn",
        "Guild incident-action audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildIncidentAuditPolicy,
        "pass",
        `Guild incident-action audit is constrained to ${config.guildIncidentGuildIds.size} exact guilds with boolean-only detection evidence, unknown-field counts, and complete known owner or MANAGE_GUILD authority`,
      ))
    }
    if (!config.allowGuildIncidentChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildIncidentChangePolicy,
        "pass",
        "Reviewed guild incident-action changes are disabled",
      ))
    } else if (config.guildIncidentGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildIncidentChangePolicy,
        "warn",
        "Guild incident-action changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildIncidentChangePolicy,
        "pass",
        `Reviewed guild incident-action changes are constrained to ${config.guildIncidentGuildIds.size} exact guilds with sparse 24-hour review, local-only reason binding, signed approval, non-retried one-shot execution, and strict response plus fresh readback`,
      ))
    }
    if (!config.allowGuildProfileAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildProfileAuditPolicy,
        "pass",
        "Guild profile audit is disabled",
      ))
    } else if (config.guildProfileGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildProfileAuditPolicy,
        "warn",
        "Guild profile audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildProfileAuditPolicy,
        "pass",
        `Guild profile audit is constrained to ${config.guildProfileGuildIds.size} exact guilds with transient text, presence-only media, and complete permission evidence`,
      ))
    }
    if (!config.allowGuildProfileChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildProfileChangePolicy,
        "pass",
        "Reviewed guild profile changes are disabled",
      ))
    } else if (config.guildProfileGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildProfileChangePolicy,
        "warn",
        "Guild profile changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildProfileChangePolicy,
        "pass",
        `Reviewed guild profile changes are constrained to ${config.guildProfileGuildIds.size} exact guilds with sparse text-field review, signed approval, one-shot execution, and exact readback`,
      ))
    }
    if (!config.allowMemberRoleChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberRolePolicy,
        "pass",
        "Reviewed member-role changes are disabled",
      ))
    } else if (
      config.memberRoleGuildIds.size === 0
      || config.memberRoleIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberRolePolicy,
        "warn",
        "Member-role changes are enabled, but exact guild and role allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberRolePolicy,
        "pass",
        `Reviewed member-role changes are constrained to ${config.memberRoleGuildIds.size} exact guilds and ${config.memberRoleIds.size} exact roles with bounded permission-impact review and one-shot execution`,
      ))
    }
    if (!config.allowBulkMemberRoleChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkMemberRolePolicy,
        "pass",
        "Reviewed bulk member-role changes are disabled",
      ))
    } else if (
      config.bulkMemberRoleGuildIds.size === 0
      || config.bulkMemberRoleIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkMemberRolePolicy,
        "warn",
        "Bulk member-role changes are enabled, but independent exact guild and role allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.bulkMemberRolePolicy,
        "pass",
        `Reviewed bulk member-role changes are constrained to ${config.bulkMemberRoleGuildIds.size} exact guilds and ${config.bulkMemberRoleIds.size} exact roles with complete per-target permission review, signed frontier approval, sequential non-retried writes, and restart-safe verified checkpoints`,
      ))
    }
    if (!config.allowNicknameChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberNicknamePolicy,
        "pass",
        "Reviewed member nickname changes are disabled",
      ))
    } else if (config.nicknameGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberNicknamePolicy,
        "warn",
        "Member nickname changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberNicknamePolicy,
        "pass",
        `Reviewed current-bot nickname changes are constrained to ${config.nicknameGuildIds.size} exact guilds with CHANGE_NICKNAME evidence, signed approval, one-shot execution, and exact readback`,
      ))
    }
    checks.push(check(
      DOCTOR_CHECK_IDS.otherMemberNicknamePolicy,
      "pass",
      config.allowOtherMemberNicknameChanges
        ? "Other-member nickname changes are enabled behind the base gate with protected-user, owner, pending-member, administrator, MANAGE_NICKNAMES, and strict hierarchy checks"
        : "Other-member nickname changes are disabled; the narrower current-bot route remains independently available",
    ))
    if (!config.allowMemberVerificationChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVerificationPolicy,
        "pass",
        "Reviewed member verification-bypass changes are disabled",
      ))
    } else if (config.memberVerificationGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVerificationPolicy,
        "warn",
        "Member verification-bypass changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVerificationPolicy,
        "pass",
        `Reviewed member verification-bypass changes are constrained to ${config.memberVerificationGuildIds.size} exact guilds with named-bit preservation, documented alternative permission evidence, protected and special-member exclusions, strict hierarchy, signed approval, one-shot execution, and exact readback`,
      ))
    }
    if (!config.allowMemberVoiceAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVoiceAuditPolicy,
        "pass",
        "Privacy-safe exact member voice-state audit is disabled",
      ))
    } else if (
      config.memberVoiceGuildIds.size === 0
      || config.memberVoiceChannelIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVoiceAuditPolicy,
        "warn",
        "Member voice-state audit is enabled, but exact guild and voice-channel allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVoiceAuditPolicy,
        "pass",
        `Member voice-state audit is constrained to ${config.memberVoiceGuildIds.size} exact guilds and ${config.memberVoiceChannelIds.size} exact voice-scope channels without occupant enumeration or state persistence`,
      ))
    }
    if (!config.allowMemberVoiceChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVoiceChangePolicy,
        "pass",
        "Reviewed member voice changes are disabled",
      ))
    } else if (
      config.memberVoiceGuildIds.size === 0
      || config.memberVoiceChannelIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVoiceChangePolicy,
        "warn",
        "Member voice changes are enabled, but exact guild and voice-channel allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.memberVoiceChangePolicy,
        "pass",
        `Reviewed member voice changes are constrained to ${config.memberVoiceGuildIds.size} exact guilds and ${config.memberVoiceChannelIds.size} exact voice-scope channels with complete permission and hierarchy review, signed approval, and one-shot execution`,
      ))
    }
    if (!config.allowWebhookAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookAuditPolicy,
        "pass",
        "Credential-redacted webhook inventory is disabled",
      ))
    } else if (
      config.webhookChannelIds.size === 0
      && config.webhookGuildIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookAuditPolicy,
        "warn",
        "Webhook-audit toggle is enabled, but the required exact channel and guild allowlists are empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookAuditPolicy,
        "pass",
        `Credential-redacted webhook inventory is constrained to ${config.webhookChannelIds.size} exact channels and ${config.webhookGuildIds.size} exact guilds`,
      ))
    }
    if (!config.allowWebhookDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookDeletionPolicy,
        "pass",
        "Reviewed webhook deletion is disabled",
      ))
    } else if (config.webhookChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookDeletionPolicy,
        "warn",
        "Webhook-deletion toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookDeletionPolicy,
        "pass",
        `Reviewed Incoming-webhook deletion is constrained to ${config.webhookChannelIds.size} exact channels with one-shot execution and absence readback`,
      ))
    }
    if (!config.allowWebhookCreation) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookCreationPolicy,
        "pass",
        "Reviewed Incoming-webhook creation is disabled",
      ))
    } else if (
      config.webhookChannelIds.size === 0
      || config.webhookCredentialRoot === null
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookCreationPolicy,
        "warn",
        "Webhook creation is enabled, but exact channel scope and one canonical private credential root are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookCreationPolicy,
        "pass",
        `Reviewed Incoming-webhook creation is constrained to ${config.webhookChannelIds.size} exact channels with exclusive private credential custody, one-shot execution, and complete inventory readback`,
      ))
    }
    if (!config.allowWebhookChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookChangePolicy,
        "pass",
        "Reviewed Incoming-webhook metadata changes are disabled",
      ))
    } else if (config.webhookChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookChangePolicy,
        "warn",
        "Webhook-change toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookChangePolicy,
        "pass",
        `Reviewed Incoming-webhook rename and same-guild move operations are constrained to ${config.webhookChannelIds.size} exact channels with one-shot execution and complete inventory readback`,
      ))
    }
    if (!config.allowWebhookMessageAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageAuditPolicy,
        "pass",
        "Credential-safe webhook message lookup is disabled",
      ))
    } else if (
      config.webhookMessageChannelIds.size === 0
      || config.webhookCredentialRoot === null
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageAuditPolicy,
        "warn",
        "Webhook message lookup is enabled, but exact channel scope and one canonical private credential root are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageAuditPolicy,
        "pass",
        `Exact webhook message lookup is constrained to ${config.webhookMessageChannelIds.size} direct channels with private credential custody, bounded projections, and no content persistence`,
      ))
    }
    if (!config.allowWebhookMessageDelivery) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageDeliveryPolicy,
        "pass",
        "Credential-safe webhook message delivery is disabled",
      ))
    } else if (
      config.webhookMessageChannelIds.size === 0
      || config.webhookCredentialRoot === null
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageDeliveryPolicy,
        "warn",
        "Webhook message delivery is enabled, but exact channel scope and one canonical private credential root are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageDeliveryPolicy,
        "pass",
        `Webhook message delivery is constrained to ${config.webhookMessageChannelIds.size} direct channels and ${config.mentionUserIds.size} exact notification users with mention containment, a shared ${config.interactionMaxWritesPerMinute}-write rolling budget, durable one-shot keys, and no content persistence`,
      ))
    }
    if (!config.allowWebhookMessageChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageChangePolicy,
        "pass",
        "Credential-safe webhook message edits are disabled",
      ))
    } else if (
      config.webhookMessageChannelIds.size === 0
      || config.webhookCredentialRoot === null
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageChangePolicy,
        "warn",
        "Webhook message edits are enabled, but exact channel scope and one canonical private credential root are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageChangePolicy,
        "pass",
        `Exact webhook message edits are constrained to ${config.webhookMessageChannelIds.size} direct channels with mention containment, durable one-shot keys, exact readback, and no content persistence`,
      ))
    }
    if (!config.allowWebhookMessageDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageDeletionPolicy,
        "pass",
        "Reviewed webhook message deletion is disabled",
      ))
    } else if (
      config.webhookMessageChannelIds.size === 0
      || config.webhookCredentialRoot === null
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageDeletionPolicy,
        "warn",
        "Webhook message deletion is enabled, but exact channel scope and one canonical private credential root are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookMessageDeletionPolicy,
        "pass",
        `Reviewed webhook message deletion is constrained to ${config.webhookMessageChannelIds.size} direct channels with transient content-bound planning, signed approval, one non-retried mutation, exact absence readback, and content-free durable records`,
      ))
    }
    if (!config.allowIntegrationAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.integrationAuditPolicy,
        "pass",
        "Privacy-safe guild integration inventory is disabled",
      ))
    } else if (config.integrationGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.integrationAuditPolicy,
        "warn",
        "Integration-audit toggle is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.integrationAuditPolicy,
        "pass",
        `Privacy-safe integration inventory is constrained to ${config.integrationGuildIds.size} exact guilds with complete MANAGE_GUILD evidence`,
      ))
    }
    if (!config.allowIntegrationDeletions) {
      checks.push(check(
        DOCTOR_CHECK_IDS.integrationDeletionPolicy,
        "pass",
        "Reviewed guild integration deletion is disabled",
      ))
    } else if (
      config.integrationGuildIds.size === 0
      || config.integrationIds.size === 0
    ) {
      checks.push(check(
        DOCTOR_CHECK_IDS.integrationDeletionPolicy,
        "warn",
        "Integration deletion is enabled, but exact guild and integration allowlists are both required",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.integrationDeletionPolicy,
        "pass",
        `Reviewed integration deletion is constrained to ${config.integrationGuildIds.size} exact guilds and ${config.integrationIds.size} exact integrations with explicit side-effect acknowledgments, one-shot execution, and full-inventory readback`,
      ))
    }
    if (!config.allowGuildDepartures) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildDeparturePolicy,
        "pass",
        "Reviewed guild departure is disabled",
      ))
    } else if (config.guildDepartureGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildDeparturePolicy,
        "warn",
        "Guild departure is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildDeparturePolicy,
        "pass",
        `Reviewed guild departure is constrained to ${config.guildDepartureGuildIds.size} exact guilds with complete membership and non-owner evidence, explicit access-loss, re-entry, and quiescence acknowledgments, one-shot execution, and complete absence readback`,
      ))
    }
    if (!config.allowGuildExpressionAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionAuditPolicy,
        "pass",
        "Privacy-safe guild emoji and sticker inventory is disabled",
      ))
    } else if (config.guildExpressionGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionAuditPolicy,
        "warn",
        "Guild-expression audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionAuditPolicy,
        "pass",
        `Privacy-safe guild emoji and sticker inventory is constrained to ${config.guildExpressionGuildIds.size} exact guilds`,
      ))
    }
    if (!config.allowApplicationEmojiAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationEmojiAuditPolicy,
        "pass",
        "Privacy-safe application emoji inventory is disabled",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationEmojiAuditPolicy,
        "pass",
        "Privacy-safe application emoji inventory is bound to the verified pinned current application",
      ))
    }
    if (!config.allowApplicationEmojiChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationEmojiChangePolicy,
        "pass",
        "Reviewed application emoji changes are disabled",
      ))
    } else if (config.applicationEmojiRoots.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationEmojiChangePolicy,
        "warn",
        "Reviewed application emoji rename and deletion are enabled, but creation is blocked because canonical local roots are empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationEmojiChangePolicy,
        "pass",
        `Reviewed application emoji changes are bound to the verified pinned current application and ${config.applicationEmojiRoots.length} canonical creation roots with application-wide coordination, one-shot execution, and exact metadata or absence readback`,
      ))
    }
    if (!config.allowBotProfileAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.botProfileAuditPolicy,
        "pass",
        "Privacy-bounded current-bot profile inspection is disabled",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.botProfileAuditPolicy,
        "pass",
        "Privacy-bounded current-bot profile inspection is bound to the verified pinned application and bot identities with transient username and media-presence projection",
      ))
    }
    if (!config.allowBotProfileChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.botProfileChangePolicy,
        "pass",
        "Reviewed application-wide bot-profile changes are disabled",
      ))
    } else if (config.botProfileRoots.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.botProfileChangePolicy,
        "warn",
        "Reviewed bot-profile username changes and image clearance are enabled, but image replacement is blocked because canonical local roots are empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.botProfileChangePolicy,
        "pass",
        `Reviewed bot-profile changes are bound to the verified pinned application and bot identities plus ${config.botProfileRoots.length} canonical image roots with fresh file evidence, signed approval, application-wide one-shot coordination, and independent exact editable-state readback`,
      ))
    }
    checks.push(config.allowApplicationMonetizationAudit
      ? check(
        DOCTOR_CHECK_IDS.applicationMonetizationAuditPolicy,
        "pass",
        `Read-only application monetization audit is constrained to ${config.applicationMonetizationSkuIds.size} exact current-application SKUs, ${config.applicationEntitlementGuildIds.size} exact entitlement guild beneficiaries, ${config.applicationEntitlementUserIds.size} exact entitlement user beneficiaries, and ${config.applicationSubscriptionUserIds.size} exact subscription users with bounded projections, entitlement-only access authority, no persistence, and no monetization mutations`,
      )
      : check(
        DOCTOR_CHECK_IDS.applicationMonetizationAuditPolicy,
        "pass",
        "Exact-beneficiary application monetization audit is disabled",
      ))
    checks.push(config.allowApplicationTestEntitlementChanges
      ? check(
        DOCTOR_CHECK_IDS.applicationTestEntitlementChangePolicy,
        "pass",
        `Reviewed test-entitlement changes are constrained to ${config.applicationTestEntitlementSkuIds.size} exact current-application subscription SKUs, ${config.applicationTestEntitlementGuildIds.size} exact guild beneficiaries, and ${config.applicationTestEntitlementUserIds.size} exact user beneficiaries with receipt-proven deletion, signed approval, application-wide coordination, one non-retried mutation, content-free checkpoints, and exact readback`,
      )
      : check(
        DOCTOR_CHECK_IDS.applicationTestEntitlementChangePolicy,
        "pass",
        "Reviewed application test-entitlement changes are disabled",
      ))
    checks.push(config.allowApplicationEntitlementConsumption
      ? check(
        DOCTOR_CHECK_IDS.applicationEntitlementConsumptionPolicy,
        "pass",
        `Reviewed consumable-entitlement consumption is constrained to ${config.applicationConsumableEntitlementSkuIds.size} exact current-application consumable SKUs and ${config.applicationConsumableEntitlementUserIds.size} exact users with external-fulfillment acknowledgement, hashed fulfillment references, signed approval, application-wide coordination, one non-retried mutation, content-free checkpoints, and exact consumed-state readback`,
      )
      : check(
        DOCTOR_CHECK_IDS.applicationEntitlementConsumptionPolicy,
        "pass",
        "Reviewed application entitlement consumption is disabled",
      ))
    checks.push(config.allowApplicationCommandChanges
      ? check(
        DOCTOR_CHECK_IDS.applicationCommandChangePolicy,
        "pass",
        `Reviewed guild application-command changes are constrained to ${config.applicationCommandGuildIds.size} exact guilds with complete typed definitions, full-localization and permission-inventory review, signed approval, durable collection coordination, one non-retried write, and exact survivor readback`,
      )
      : check(
        DOCTOR_CHECK_IDS.applicationCommandChangePolicy,
        "pass",
        "Reviewed guild application-command changes are disabled",
      ))
    checks.push(config.allowGlobalApplicationCommandChanges
      ? check(
        DOCTOR_CHECK_IDS.globalApplicationCommandChangePolicy,
        "pass",
        "Reviewed global application-command changes are bound to the verified pinned current application with explicit installation contexts, complete localized inventory review, signed approval, application-wide coordination, one non-retried write, and exact survivor readback",
      )
      : check(
        DOCTOR_CHECK_IDS.globalApplicationCommandChangePolicy,
        "pass",
        "Reviewed global application-command changes are disabled",
      ))
    const applicationIntentRequirements = applicationPostureRequirementsForConfig(config)
    const applicationIntentTargets = [
      ...(applicationIntentRequirements.guildMembersIntentRequired
        ? ["Guild Members"]
        : []),
      ...(applicationIntentRequirements.messageContentIntent === "not-required"
        ? []
        : [`Message Content (${applicationIntentRequirements.messageContentIntent})`]),
    ]
    if (!config.allowApplicationIntentChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationIntentChangePolicy,
        "pass",
        "Reviewed application privileged-intent enablement is disabled",
      ))
    } else if (applicationIntentTargets.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationIntentChangePolicy,
        "warn",
        "Application privileged-intent enablement is enabled, but strict policy does not require or recommend Guild Members or Message Content",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.applicationIntentChangePolicy,
        "pass",
        `Reviewed application privileged-intent enablement is limited to ${applicationIntentTargets.join(" and ")}, additive-only, policy-justified, application-wide coordinated, one-shot, content-free audited, and exact-readback verified`,
      ))
    }
    checks.push(config.allowApplicationRoleConnectionMetadataChanges
      ? check(
        DOCTOR_CHECK_IDS.applicationRoleConnectionMetadataChangePolicy,
        "pass",
        "Reviewed linked-role metadata changes are bound to the verified pinned current application, strict complete maximum-five-record schemas, explicit global replacement or clearance acknowledgement, label-free signed approval state, application-wide coordination, one non-retried PUT, content-free lifecycle records, and exact response plus independent readback verification",
      )
      : check(
        DOCTOR_CHECK_IDS.applicationRoleConnectionMetadataChangePolicy,
        "pass",
        "Reviewed application linked-role metadata changes are disabled",
      ))
    if (!config.allowGuildExpressionChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
        "pass",
        "Reviewed guild emoji and sticker changes are disabled",
      ))
    } else if (config.guildExpressionGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
        "warn",
        "Guild-expression changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else if (config.guildExpressionRoots.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
        "warn",
        `Reviewed guild-expression updates and deletions are constrained to ${config.guildExpressionGuildIds.size} exact guilds, but creation is blocked because canonical local roots are empty`,
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
        "pass",
        `Reviewed guild-expression changes are constrained to ${config.guildExpressionGuildIds.size} exact guilds and ${config.guildExpressionRoots.length} canonical creation roots with one-shot execution and exact metadata or absence readback`,
      ))
    }
    if (!config.allowAutomodAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.automodAuditPolicy,
        "pass",
        "Privacy-safe AutoMod inventory is disabled",
      ))
    } else if (config.automodGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.automodAuditPolicy,
        "warn",
        "AutoMod audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.automodAuditPolicy,
        "pass",
        `Privacy-safe AutoMod inventory is constrained to ${config.automodGuildIds.size} exact guilds`,
      ))
    }
    if (!config.allowAutomodChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.automodChangePolicy,
        "pass",
        "Reviewed AutoMod rule changes are disabled",
      ))
    } else if (config.automodGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.automodChangePolicy,
        "warn",
        "AutoMod changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.automodChangePolicy,
        "pass",
        `Reviewed AutoMod changes are constrained to ${config.automodGuildIds.size} exact guilds and ${config.automodAlertChannelIds.size} exact alert channels with one-shot execution and exact state or absence readback`,
      ))
    }
    if (!config.allowScheduledEventAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventAuditPolicy,
        "pass",
        "Privacy-safe scheduled event inventory is disabled",
      ))
    } else if (config.scheduledEventGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventAuditPolicy,
        "warn",
        "Scheduled-event audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventAuditPolicy,
        "pass",
        `Privacy-safe scheduled event inventory is constrained to ${config.scheduledEventGuildIds.size} exact guilds`,
      ))
    }
    if (!config.allowScheduledEventChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
        "pass",
        "Reviewed scheduled event changes are disabled",
      ))
    } else if (config.scheduledEventGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
        "warn",
        "Scheduled-event changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else if (config.scheduledEventRoots.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
        "warn",
        `Reviewed scheduled-event changes are constrained to ${config.scheduledEventGuildIds.size} exact guilds, but cover updates are blocked because canonical local roots are empty`,
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
        "pass",
        `Reviewed scheduled-event changes are constrained to ${config.scheduledEventGuildIds.size} exact guilds and ${config.scheduledEventRoots.length} canonical cover roots with one-shot execution and exact state or absence readback`,
      ))
    }
    if (!config.allowScheduledEventUserAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventUserAuditPolicy,
        "pass",
        "Scheduled-event user audit is disabled",
      ))
    } else if (config.scheduledEventGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventUserAuditPolicy,
        "warn",
        "Scheduled-event user audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.scheduledEventUserAuditPolicy,
        "pass",
        `Scheduled-event user audit is constrained to ${config.scheduledEventGuildIds.size} exact guilds with bounded ID-and-bot-only pages, member expansion disabled, and no persistence`,
      ))
    }
    if (!config.allowSoundboardAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardAuditPolicy,
        "pass",
        "Privacy-safe soundboard inventory is disabled",
      ))
    } else if (config.soundboardGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardAuditPolicy,
        "warn",
        "Soundboard audit is enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardAuditPolicy,
        "pass",
        `Privacy-safe default and guild soundboard inventory is constrained to ${config.soundboardGuildIds.size} exact guilds`,
      ))
    }
    if (!config.allowSoundboardChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardChangePolicy,
        "pass",
        "Reviewed soundboard changes are disabled",
      ))
    } else if (config.soundboardGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardChangePolicy,
        "warn",
        "Soundboard changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else if (config.soundboardRoots.length === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardChangePolicy,
        "warn",
        `Reviewed soundboard updates and deletions are constrained to ${config.soundboardGuildIds.size} exact guilds, but creation is blocked because canonical local roots are empty`,
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardChangePolicy,
        "pass",
        `Reviewed soundboard changes are constrained to ${config.soundboardGuildIds.size} exact guilds and ${config.soundboardRoots.length} canonical creation roots with one-shot execution and exact metadata or absence readback`,
      ))
    }
    if (!config.allowSoundboardPlayback) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardPlaybackPolicy,
        "pass",
        "Guarded soundboard playback is disabled",
      ))
    } else if (config.soundboardPlaybackChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardPlaybackPolicy,
        "warn",
        "Soundboard playback is enabled, but the required exact ordinary voice-channel allowlist is empty",
      ))
    } else {
      const sourceScope = config.soundboardPlaybackSourceGuildIds.size === 0
        ? "Discord default sounds only"
        : `${config.soundboardPlaybackSourceGuildIds.size} exact custom-sound source guilds plus Discord defaults`
      checks.push(check(
        DOCTOR_CHECK_IDS.soundboardPlaybackPolicy,
        "pass",
        `Guarded soundboard playback is constrained to ${config.soundboardPlaybackChannelIds.size} exact ordinary voice channels and ${sourceScope}, with fresh permission, voice-state, and availability proof; host write approval; durable request-bound replay; cross-process channel coordination; shared anti-spam limits; one non-retried request; content-free records; and optional exact Gateway corroboration using GUILDS plus GUILD_VOICE_STATES`,
      ))
    }
    if (!config.allowStageInstanceAudit) {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageInstanceAuditPolicy,
        "pass",
        "Privacy-safe Stage-instance inventory is disabled",
      ))
    } else if (config.stageChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageInstanceAuditPolicy,
        "warn",
        "Stage-instance audit is enabled, but the required exact Stage-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageInstanceAuditPolicy,
        "pass",
        `Privacy-safe Stage-instance inventory is constrained to ${config.stageChannelIds.size} exact Stage channels`,
      ))
    }
    if (!config.allowStageInstanceChanges) {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageInstanceChangePolicy,
        "pass",
        "Reviewed Stage-instance changes are disabled",
      ))
    } else if (config.stageChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageInstanceChangePolicy,
        "warn",
        "Stage-instance changes are enabled, but the required exact Stage-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageInstanceChangePolicy,
        "pass",
        `Reviewed Stage-instance start, topic update, and end are constrained to ${config.stageChannelIds.size} exact Stage channels with signed approval, one-shot execution, exact readback, and ambiguity quarantine`,
      ))
    }
    if (!config.allowStageStartNotifications) {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageStartNotificationPolicy,
        "pass",
        "Stage start notifications are disabled",
      ))
    } else if (config.stageChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageStartNotificationPolicy,
        "warn",
        "Stage start notifications are enabled, but the required exact Stage-channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.stageStartNotificationPolicy,
        "pass",
        `Stage start notifications are constrained to ${config.stageChannelIds.size} exact Stage channels and require fresh Mention Everyone permission evidence`,
      ))
    }
    const layoutGuildCount = guildChannelLayoutGuildIds(config).size
    const voiceChannelStatusCount = config.allowChannelMetadataChanges
      ? config.channelMetadataIds.size
      : 0
    checks.push(config.allowGateway
      ? check(
          DOCTOR_CHECK_IDS.gatewayPolicy,
          "pass",
          `Discord Gateway events are enabled with authenticated exact-route sparse sharding and shared session-start preflight, a ${config.gatewayEventBufferSize}-event content-free buffer, ${layoutGuildCount} exact layout guilds, ${voiceChannelStatusCount} exact voice-status candidates, and only nonprivileged intents`,
        )
      : layoutGuildCount > 0 || voiceChannelStatusCount > 0
        ? check(
            DOCTOR_CHECK_IDS.gatewayPolicy,
            "pass",
            `Discord Gateway events are disabled; an authenticated-preflight GUILDS-only evidence connection covers ${layoutGuildCount} exact layout guilds and ${voiceChannelStatusCount} exact voice-status candidates`,
          )
        : check(
            DOCTOR_CHECK_IDS.gatewayPolicy,
            "pass",
            "Discord Gateway events and channel-layout evidence are disabled",
          ))
    checks.push(config.allowNativeCommandChanges
      ? check(
        DOCTOR_CHECK_IDS.nativeInteractionCommandPolicy,
        "pass",
        `Reviewed native Interaction command changes manage /${config.nativeCommandName} in ${config.nativeInteractionGuildIds.size} exact guilds with signed approval, one-shot mutation, and full-inventory readback`,
      )
      : check(
        DOCTOR_CHECK_IDS.nativeInteractionCommandPolicy,
        "pass",
        "Native Interaction command changes are disabled",
      ))
    checks.push(config.allowNativeInteractions
      ? check(
        DOCTOR_CHECK_IDS.nativeInteractionIngressPolicy,
        "pass",
        `Native Interaction ingress accepts /${config.nativeCommandName} only in ${config.nativeInteractionGuildIds.size} guilds, ${config.nativeInteractionChannelIds.size} channels, and from ${config.nativeInteractionUserIds.size} users; the private queue holds at most ${config.nativeInteractionMaxPending} requests for ${config.nativeInteractionTtlSeconds} seconds and uses ${config.allowGateway ? "the separately enabled nonprivileged event-feed intents" : "an intents-free Gateway connection"} with application endpoint and command verification plus authenticated exact-route sparse sharding and shared session-start preflight; response tokens stay broker-private, initial replies close by default, and explicit rotating one-shot continuations share the same capacity`,
      )
      : check(
        DOCTOR_CHECK_IDS.nativeInteractionIngressPolicy,
        "pass",
        "Native Interaction ingress is disabled",
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
    if (!config || !operationalConfig) {
      checks.push(check(
        DOCTOR_CHECK_IDS.guildAccess,
        "fail",
        config
          ? "Online verification was skipped because the selected bot credential is unavailable"
          : "Online verification requires valid connector configuration",
      ))
      checks.push(check(
        DOCTOR_CHECK_IDS.guildInstallationDrift,
        "fail",
        "Complete bot installation drift verification requires valid connector configuration and the selected bot credential",
      ))
    } else {
      try {
        const service = options.service || new ConnectorService({ config: operationalConfig })
        const status = await service.getStatus()
        identity = identitySummary(status)
        const installationAudit = status.installationAudit
        const missingGuilds = installationAudit.drift.missingConfiguredGuildIds.length
        const unexpectedGuilds = installationAudit.drift.unexpectedGuildIds.length
        checks.push(check(
          DOCTOR_CHECK_IDS.guildAccess,
          missingGuilds === 0 && installationAudit.installedInScopeGuildIds.length > 0
            ? "pass"
            : "fail",
          missingGuilds === 0 && installationAudit.installedInScopeGuildIds.length > 0
            ? `Verified application ${status.application.id}, bot ${status.bot.id}, and all ${installationAudit.configuredGuildIds.length} configured guild installations through a complete inventory`
            : `Verified application ${status.application.id} and bot ${status.bot.id}, but ${missingGuilds} configured guild installations are missing`,
        ))
        checks.push(check(
          DOCTOR_CHECK_IDS.guildInstallationDrift,
          missingGuilds > 0 ? "fail" : unexpectedGuilds > 0 ? "warn" : "pass",
          missingGuilds > 0 || unexpectedGuilds > 0
            ? `Complete ID-only inventory found ${missingGuilds} missing configured guilds and ${unexpectedGuilds} unexpected installations`
            : `Complete ID-only inventory exactly matches all ${installationAudit.configuredGuildIds.length} configured guild installations`,
        ))
        const posture = status.applicationPosture
        const guildInstallSupported = posture.installation.guild.supported
        checks.push(posture.access.botRequiresCodeGrant || guildInstallSupported === false
          ? check(
            DOCTOR_CHECK_IDS.applicationInstall,
            "fail",
            posture.access.botRequiresCodeGrant
              ? "The Discord application requires a full OAuth2 code grant, so callback-free bot installation is blocked"
              : "The Discord application does not advertise Guild Install support",
          )
          : guildInstallSupported === null
            ? check(
              DOCTOR_CHECK_IDS.applicationInstall,
              "warn",
              "Discord did not report supported installation contexts, so callback-free guild installation compatibility is unknown",
            )
            : check(
              DOCTOR_CHECK_IDS.applicationInstall,
              "pass",
              "Discord application supports callback-free guild installation",
            ))
        checks.push(posture.access.botPublic
          ? check(
            DOCTOR_CHECK_IDS.applicationBotVisibility,
            "warn",
            "Users other than the application owner can add the bot to guilds",
          )
          : check(
            DOCTOR_CHECK_IDS.applicationBotVisibility,
            "pass",
            "Only the application owner can add the bot to guilds",
          ))
        const installDefaults = [
          posture.installation.guild.defaultAuthorization,
          posture.installation.legacyDefaults,
          posture.installation.user.defaultAuthorization,
        ].filter((value) => value !== null)
        const administratorDefault = installDefaults.some((defaults) => (
          defaults.administrator
        ))
        const unknownDefaultAuthority = installDefaults.some((defaults) => (
          defaults.unknownPermissionBitCount > 0 || defaults.unknownScopeCount > 0
        ))
        checks.push(administratorDefault
          ? check(
            DOCTOR_CHECK_IDS.applicationDefaultPermissions,
            "warn",
            "A Discord default install configuration requests Administrator",
          )
          : unknownDefaultAuthority
            ? check(
              DOCTOR_CHECK_IDS.applicationDefaultPermissions,
              "warn",
              "A Discord default install configuration contains unknown scopes or permission bits",
            )
            : check(
              DOCTOR_CHECK_IDS.applicationDefaultPermissions,
              "pass",
              "Discord default install configuration contains no Administrator or unknown authority",
            ))
        checks.push(!config.allowNativeInteractions
          ? check(
            DOCTOR_CHECK_IDS.applicationInteractionDelivery,
            "pass",
            "Native Interaction ingress is disabled, so application Interaction delivery does not constrain the connector",
          )
          : posture.interactions.endpointConfigured
            ? check(
              DOCTOR_CHECK_IDS.applicationInteractionDelivery,
              "fail",
              "A configured Interactions endpoint routes delivery away from the connector's Gateway ingress",
            )
            : check(
              DOCTOR_CHECK_IDS.applicationInteractionDelivery,
              "pass",
              "Application Interaction delivery is compatible with the connector's Gateway ingress",
            ))
        checks.push(posture.privilegedIntents.presence === "enabled"
          ? check(
            DOCTOR_CHECK_IDS.applicationPresenceIntent,
            "warn",
            "Discord application advertises Presence intent, which this connector does not use",
          )
          : posture.privilegedIntents.presence === "unknown"
            ? check(
              DOCTOR_CHECK_IDS.applicationPresenceIntent,
              "warn",
              "Discord application did not expose enough flags to diagnose unused Presence intent",
            )
            : check(
              DOCTOR_CHECK_IDS.applicationPresenceIntent,
              "pass",
              "Discord application does not advertise unused Presence intent",
            ))
        checks.push(posture.eventWebhooks.status === "enabled"
          ? check(
            DOCTOR_CHECK_IDS.applicationEventWebhooks,
            "warn",
            "Application event webhooks are enabled for an external receiver outside this connector",
          )
          : posture.eventWebhooks.status === "unknown"
            || posture.eventWebhooks.status === "disabled-by-discord"
            || (
              posture.eventWebhooks.status === "not-reported"
              && posture.eventWebhooks.endpointConfigured
            )
            ? check(
              DOCTOR_CHECK_IDS.applicationEventWebhooks,
              "warn",
              "Discord application event-webhook evidence requires Developer Portal review",
            )
            : check(
              DOCTOR_CHECK_IDS.applicationEventWebhooks,
              "pass",
              posture.eventWebhooks.status === "not-reported"
                ? "Discord did not report event-webhook status and no event-webhook endpoint is configured"
                : "Discord application event webhooks are disabled",
            ))
        const announcementCrosspostsConfigured = config.allowAnnouncementCrossposts
          && config.announcementCrosspostChannelIds.size > 0
        const componentMessagesConfigured = config.allowInteractions
          && config.interactionChannelIds.size > 0
        const embedMessagesConfigured = config.allowEmbedMessages
          && config.embedMessageChannelIds.size > 0
        const messageForwardingConfigured = config.allowMessageForwarding
          && config.messageForwardSourceChannelIds.size > 0
          && config.messageForwardTargetChannelIds.size > 0
        const contentDependentWrites = [
          ...(announcementCrosspostsConfigured ? ["announcement crossposts"] : []),
          ...(componentMessagesConfigured ? ["component messages"] : []),
          ...(embedMessagesConfigured ? ["static rich-embed messages"] : []),
          ...(messageForwardingConfigured ? ["message forwarding"] : []),
        ]
        checks.push(posture.privilegedIntents.messageContent === "enabled"
          ? check(
            DOCTOR_CHECK_IDS.messageContentIntent,
            "pass",
            "Discord application advertises Message Content intent for native search and configured content-dependent reviewed writes",
          )
          : check(
            DOCTOR_CHECK_IDS.messageContentIntent,
            contentDependentWrites.length > 0 ? "fail" : "warn",
            contentDependentWrites.length > 0
              ? `Discord application lacks confirmed Message Content intent, so configured ${contentDependentWrites.join(" and ")} are blocked`
              : posture.privilegedIntents.messageContent === "disabled"
                ? "Discord application does not advertise Message Content intent; native message search may be unavailable"
                : "Discord application did not expose enough flags to diagnose Message Content intent",
          ))
        if (!config.allowMemberDirectory || config.memberDirectoryGuildIds.size === 0) {
          checks.push(check(
            DOCTOR_CHECK_IDS.guildMembersIntent,
            "pass",
            "Member directory is disabled, so Guild Members privileged intent is not required for it",
          ))
        } else if (posture.privilegedIntents.guildMembers === "enabled") {
          checks.push(check(
            DOCTOR_CHECK_IDS.guildMembersIntent,
            "pass",
            "Discord application advertises Guild Members intent required for member-directory listing",
          ))
        } else {
          checks.push(check(
            DOCTOR_CHECK_IDS.guildMembersIntent,
            posture.privilegedIntents.guildMembers === "disabled" ? "fail" : "warn",
            posture.privilegedIntents.guildMembers === "disabled"
              ? "Discord application does not advertise Guild Members intent; configured member listing will fail"
              : "Discord application did not expose enough flags to diagnose Guild Members intent",
          ))
        }
      } catch (error) {
        checks.push(check(
          DOCTOR_CHECK_IDS.guildAccess,
          "fail",
          redactedError(error, environment, operationalConfig.token),
        ))
        checks.push(check(
          DOCTOR_CHECK_IDS.guildInstallationDrift,
          "fail",
          "Complete bot installation drift verification failed",
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
  config?: {
    document: ConnectorConfigDocument
    file: string
  }
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
  const config = options.config === undefined
    ? undefined
    : {
      document: parseConnectorConfigDocument(options.config.document),
      file: resolveConnectorConfigFile(options.config.file),
    }
  if (config && profile) {
    throw new ConfigurationError(
      "Portable launch configuration and profile are mutually exclusive",
    )
  }
  if (!config && !profile) {
    throw new ConfigurationError(
      "Portable launch descriptors require a schema-v2 configuration or profile",
    )
  }
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
  if (
    config
    && (
      config.document.identity.applicationId !== applicationId
      || config.document.identity.botId !== botId
    )
  ) {
    throw new ConfigurationError(
      "Portable launch configuration does not match the verified Discord identity",
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
  if (profile || config) {
    if (args.includes("--profile") || args.includes("--config")) {
      throw new ConfigurationError("MCP server arguments already select a configuration")
    }
    if (profile) args.push("--profile", profile.name)
    if (config) args.push("--config", config.file)
  }
  const policy = config?.document || profile
  if (!policy) {
    throw new ConfigurationError(
      "Portable launch descriptors require a schema-v2 configuration or profile",
    )
  }
  const environmentVariables = [...connectorConfigSecretEnvironmentNames(policy)]
  const secretFiles = [...connectorConfigSecretFilePaths(policy)]
  return {
    args,
    command,
    environment: {
      forward: environmentVariables,
      set: {},
    },
    requirements: {
      elicitation: "required-for-reviewed-writes",
      requiredServer: true,
      toolApproval: "writes",
    },
    secrets: {
      environmentVariables,
      files: secretFiles,
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
  if (options.configFile !== undefined && options.profileName !== undefined) {
    throw new ConfigurationError(
      "Setup configuration file and profile are mutually exclusive",
    )
  }
  if (options.configFile === undefined && options.profileName === undefined) {
    throw new ConfigurationError(
      "Setup requires a configuration file or profile",
    )
  }
  if (options.configFile !== undefined && options.profileDirectory !== undefined) {
    throw new ConfigurationError("Profile storage cannot be used with a configuration file")
  }
  if (options.configFile === undefined && options.overwriteConfig) {
    throw new ConfigurationError("Configuration replacement requires a configuration file")
  }
  if (options.reuseExistingConfig && (
    options.configFile === undefined
    || options.profileName !== undefined
    || options.preset === undefined
  )) {
    throw new ConfigurationError(
      "Existing preset reuse requires one configuration file and one exact preset",
    )
  }
  if (options.reuseExistingConfig && options.overwriteConfig) {
    throw new ConfigurationError(
      "Existing preset reuse and configuration replacement are mutually exclusive",
    )
  }
  if (options.profileName === undefined && options.overwriteProfile) {
    throw new ConfigurationError("Profile replacement requires a profile name")
  }
  if (options.credentialFile !== undefined && options.credentialVariable !== undefined) {
    throw new ConfigurationError("Options --token-file and --token-env are mutually exclusive")
  }
  if (options.reuseExistingConfig && (
    options.credentialFile !== undefined
    || options.credentialVariable !== undefined
  )) {
    throw new ConfigurationError(
      "An existing reusable policy owns its credential reference",
    )
  }
  const expectedApplicationId = options.expectedApplicationId?.trim()
  if (expectedApplicationId !== undefined && (
    !DISCORD_SNOWFLAKE_PATTERN.test(expectedApplicationId)
    || BigInt(expectedApplicationId) < 1n
    || BigInt(expectedApplicationId) > DISCORD_SNOWFLAKE_MAX
  )) {
    throw new ConfigurationError("Expected Discord application ID must be a snowflake")
  }
  if (expectedApplicationId !== undefined && !options.preset) {
    throw new ConfigurationError(
      "Expected Discord application binding is available only while creating a preset policy",
    )
  }
  const configFile = options.configFile === undefined
    ? undefined
    : resolveConnectorConfigFile(options.configFile)
  const profileName = options.profileName === undefined
    ? undefined
    : normalizeProfileName(options.profileName)
  const configName = configFile
    ? normalizeConfigName(basename(configFile, extname(configFile)))
    : profileName
  if (!configName) throw new ConfigurationError("Setup could not resolve a policy name")
  if (configFile) {
    const ambientConfigFile = environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
    if (ambientConfigFile && resolveConnectorConfigFile(ambientConfigFile) !== configFile) {
      throw new ConfigurationError(
        `Setup configuration conflicts with ${CONFIG_FILE_ENVIRONMENT_VARIABLE}`,
      )
    }
  }
  if (profileName && environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()) {
    throw new ConfigurationError(
      `Setup profile ${profileName} conflicts with ${CONFIG_FILE_ENVIRONMENT_VARIABLE}`,
    )
  }
  const profileLocation = {
    environment,
    ...(options.profileDirectory ? { directory: options.profileDirectory } : {}),
  }
  const targetExists = configFile
    ? existsSync(configFile)
    : existsSync(profilePath(profileName || configName, profileLocation))
  const overwriteTarget = configFile
    ? options.overwriteConfig
    : options.overwriteProfile
  if (options.reuseExistingConfig && !targetExists) {
    throw new ConfigurationError("Existing preset reuse target was not found")
  }
  if (
    options.preset
    && targetExists
    && !overwriteTarget
    && !options.reuseExistingConfig
  ) {
    throw new ConfigurationError(
      "Setup target already exists; rerun without --preset to verify it or add --force after review",
    )
  }
  if (!options.preset && !targetExists) {
    throw new ConfigurationError(
      "Setup target was not found; create it with --preset or guildctl config init",
    )
  }
  if (
    !options.preset
    && (
      options.credentialFile !== undefined
      || options.credentialVariable !== undefined
      || options.overwriteConfig
      || options.overwriteProfile
    )
  ) {
    throw new ConfigurationError(
      "--token-env, --token-file, and --force require --preset because an existing policy owns its credential reference and content",
    )
  }

  let appliedPreset: ReturnType<typeof applySetupPreset> | null = null
  let credential: ConnectorCredentialReference
  let portableConfig: ConnectorConfigDocument | undefined
  let profile: ConnectorProfile | null = null
  let config: ConnectorConfig
  if (options.preset) {
    appliedPreset = applySetupPreset({
      ...(options.preset.channelIds
        ? { channelIds: options.preset.channelIds }
        : {}),
      guildIds: options.preset.guildIds,
      name: options.preset.name,
    })
    if (options.reuseExistingConfig && configFile) {
      portableConfig = loadConnectorConfigDocumentFile(configFile)
      credential = portableConfig.credential
      config = loadConnectorConfigDocument(portableConfig, environment)
    } else {
      credential = options.credentialFile === undefined
        ? {
            provider: "environment",
            variable: (options.credentialVariable ?? DEFAULT_TOKEN_ENVIRONMENT_VARIABLE).trim(),
          }
        : {
            path: resolveConnectorSecretFile(options.credentialFile),
            provider: "file",
          }
      const bootstrapDocument = createConnectorConfigDocument({
        applicationId: SETUP_BOOTSTRAP_APPLICATION_ID,
        botId: SETUP_BOOTSTRAP_BOT_ID,
        channelIds: appliedPreset.policy.channelIds,
        ...(credential.provider === "environment"
          ? { credentialVariable: credential.variable }
          : { credentialFile: credential.path }),
        gatewayEnabled: appliedPreset.policy.gatewayEnabled,
        guildIds: appliedPreset.policy.guildIds,
        name: configName,
        toolsets: appliedPreset.policy.toolsets,
        toolSurface: appliedPreset.policy.toolSurface,
      })
      config = {
        ...loadConnectorConfigDocument(bootstrapDocument, environment),
        expectedApplicationId,
        expectedBotId: undefined,
      }
    }
  } else if (configFile) {
    portableConfig = loadConnectorConfigDocumentFile(configFile)
    credential = portableConfig.credential
    config = loadConnectorConfigDocument(portableConfig, environment)
  } else {
    const loadedProfile = await loadProfile(profileName || configName, profileLocation)
    portableConfig = loadedProfile
    profile = loadedProfile
    credential = loadedProfile.credential
    config = loadConnectorConfigDocument(loadedProfile, environment)
  }
  const service = options.service || new ConnectorService({ config })
  let status: ConnectorStatus
  try {
    status = await service.getStatus()
  } catch (error) {
    throw redactedSetupVerificationError(error, environment, config.token)
  }
  if (
    expectedApplicationId !== undefined
    && status.application.id !== expectedApplicationId
  ) {
    throw new ConfigurationError(
      `Discord token belongs to application ${status.application.id}, expected ${expectedApplicationId}`,
    )
  }
  if (status.installationAudit.drift.missingConfiguredGuildIds.length > 0) {
    throw new ConfigurationError(
      `Discord bot is missing ${status.installationAudit.drift.missingConfiguredGuildIds.length} of ${config.allowedGuildIds.size} exact configured guild installations`,
    )
  }
  if (status.installationAudit.installedInScopeGuildIds.length < 1) {
    throw new ConfigurationError("Discord bot has no accessible guilds inside the configured local scope")
  }
  if (appliedPreset) {
    const expectedPresetConfig = createConnectorConfigDocument({
      applicationId: status.application.id,
      botId: status.bot.id,
      channelIds: appliedPreset.policy.channelIds,
      ...(credential.provider === "environment"
        ? { credentialVariable: credential.variable }
        : { credentialFile: credential.path }),
      gatewayEnabled: appliedPreset.policy.gatewayEnabled,
      guildIds: appliedPreset.policy.guildIds,
      name: configName,
      toolsets: appliedPreset.policy.toolsets,
      toolSurface: appliedPreset.policy.toolSurface,
    })
    if (
      options.reuseExistingConfig
      && stableString(portableConfig) !== stableString(expectedPresetConfig)
    ) {
      throw new ConfigurationError(
        "Existing policy does not exactly match the requested application, guild, read-only preset, identity, and credential custody",
      )
    }
    portableConfig = expectedPresetConfig
    config = loadConnectorConfigDocument(portableConfig, environment)
    profile = profileName ? portableConfig : null
  }
  if (!portableConfig) {
    throw new ConfigurationError("Setup could not resolve a schema-v2 policy")
  }
  const launch = createStdioLaunchDescriptor({
    applicationId: status.application.id,
    botId: status.bot.id,
    ...(options.args ? { args: options.args } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(configFile
      ? {
          config: {
            document: portableConfig,
            file: configFile,
          },
        }
      : {}),
    ...(profile ? { profile } : {}),
    ...(options.serverName !== undefined ? { serverName: options.serverName } : {}),
  })
  if (appliedPreset && profile) {
    await saveProfile(profile, {
      environment,
      overwrite: options.overwriteProfile ?? false,
      ...(options.profileDirectory ? { directory: options.profileDirectory } : {}),
    })
  }
  const configWrite = appliedPreset && configFile && !options.reuseExistingConfig
    ? await writeConnectorConfigDocumentFile(configFile, portableConfig, {
      overwrite: options.overwriteConfig ?? false,
    })
    : null
  const contentDependentWrites = [
    ...(config.allowAnnouncementCrossposts
      && config.announcementCrosspostChannelIds.size > 0
      && config.mcpToolsets.has("announcement-crossposts")
      ? ["announcement crossposts"]
      : []),
    ...(config.allowMessageForwarding
      && config.messageForwardSourceChannelIds.size > 0
      && config.messageForwardTargetChannelIds.size > 0
      && config.mcpToolsets.has("message-forwarding")
      ? ["message forwarding"]
      : []),
    ...(config.allowInteractions
      && config.interactionChannelIds.size > 0
      && config.mcpToolsets.has("interactions")
      ? ["component messages"]
      : []),
    ...(config.allowEmbedMessages
      && config.embedMessageChannelIds.size > 0
      && config.mcpToolsets.has("embed-messages")
      ? ["static rich-embed messages"]
      : []),
  ]
  return {
    applicationId: status.application.id,
    botId: status.bot.id,
    configBackupFile: configWrite?.backupFile ?? null,
    configFile: configFile ?? null,
    credential,
    launch,
    preset: appliedPreset?.preset ?? null,
    profile,
    configuredGuildCount: status.installationAudit.configuredGuildIds.length,
    installedGuildCount: status.installationAudit.installedGuildIds.length,
    installedInScopeGuildCount:
      status.installationAudit.installedInScopeGuildIds.length,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: launch.serverName,
    status: "ok",
    toolsets: selectedMcpToolsets(config.mcpToolsets),
    toolSurface: config.mcpToolSurface,
    unexpectedGuildCount: status.installationAudit.drift.unexpectedGuildIds.length,
    warnings: [
      ...policyWarnings(config),
      ...applicationPostureWarnings(status),
      ...(status.installationAudit.drift.unexpectedGuildIds.length > 0
        ? [`Verified bot has ${status.installationAudit.drift.unexpectedGuildIds.length} installations outside the exact configured guild scope`]
        : []),
      ...(status.applicationPosture.privilegedIntents.messageContent === "enabled"
        ? []
        : [
            ...(contentDependentWrites.length > 0
              ? [
                  `Discord application does not advertise confirmed Message Content intent, so configured ${contentDependentWrites.join(" and ")} are blocked`,
                ]
              : []),
            ...(config.mcpToolsets.has("messages")
              ? [
                  "Discord application does not advertise confirmed Message Content intent, so native search may be unavailable",
                ]
              : []),
          ]),
      ...(config.allowMemberDirectory
        && config.memberDirectoryGuildIds.size > 0
        && status.applicationPosture.privilegedIntents.guildMembers !== "enabled"
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

function canonicalSnowflakeArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return undefined
  }
  const snowflakes = value as string[]
  let previous = 0n
  for (const snowflake of snowflakes) {
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(snowflake)
      || BigInt(snowflake) < 1n
      || BigInt(snowflake) > DISCORD_SNOWFLAKE_MAX
      || BigInt(snowflake).toString() !== snowflake
      || BigInt(snowflake) <= previous
    ) return undefined
    previous = BigInt(snowflake)
  }
  return snowflakes
}

function safeIntegerProperty(value: unknown, property: string): number | undefined {
  const record = objectValue(value)
  const propertyValue = record?.[property]
  return Number.isSafeInteger(propertyValue) ? propertyValue as number : undefined
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function matchesExactStringRecord(
  value: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  const record = objectValue(value)
  const entries = Object.entries(expected)
  return record !== undefined
    && Object.keys(record).length === entries.length
    && entries.every(([key, expectedValue]) => record[key] === expectedValue)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return Object.keys(value).length === expected.length
    && expected.every((key) => key in value)
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

function smokeGateway(config: ConnectorConfig): GatewayRuntime | undefined {
  if (voiceChannelStatusChannelIds(config).size === 0) return undefined
  if (!config.expectedApplicationId || !config.expectedBotId) {
    throw new ConfigurationError(
      "Voice-channel status smoke validation requires pinned application and bot IDs",
    )
  }
  const client = new DiscordClient({ token: config.token })
  return new DiscordGateway({
    applicationId: config.expectedApplicationId,
    config,
    discoverGateway(signal) {
      return client.getGatewayBot({ signal })
    },
    discoverGatewayChannel(channelId, signal) {
      return client.getGatewayChannelRoute(channelId, { signal })
    },
    interactionHandler: { ingestInteraction() {} },
  })
}

function createSmokeClient(pinModern = false): Client {
  return new Client(
    { name: `${CONNECTOR_NAME}-smoke`, version: CONNECTOR_VERSION },
    {
      capabilities: {},
      ...(pinModern
        ? { versionNegotiation: { mode: { pin: SMOKE_PROTOCOL_VERSION } } }
        : {}),
    },
  )
}

async function inspectSmokeClient(
  client: Client,
  config: ConnectorConfig,
  service: DiscordToolService,
  transport: SmokeReport["transport"],
): Promise<SmokeReport> {
  const selectedToolNames = selectedCanonicalMcpToolNames(config.mcpToolsets)
  const expectedToolNames = [
    ...selectedToolNames,
    ...MCP_ALWAYS_AVAILABLE_TOOL_NAMES,
  ]
  const protocolVersion = client.getNegotiatedProtocolVersion()
  const server = client.getServerVersion()
  const icon = server?.icons?.[0]
  if (
    !protocolVersion
    || server?.description !== CONNECTOR_DESCRIPTION
    || server.icons?.length !== 1
    || icon?.mimeType !== CONNECTOR_ICON_MIME_TYPE
    || JSON.stringify(icon.sizes) !== JSON.stringify(CONNECTOR_ICON_SIZES)
    || icon.src !== CONNECTOR_ICON_URL
    || server.name !== CONNECTOR_NAME
    || server.title !== CONNECTOR_TITLE
    || server.version !== CONNECTOR_VERSION
    || server.websiteUrl !== CONNECTOR_WEBSITE_URL
  ) {
    throw new Error("MCP smoke check found an invalid negotiated server identity")
  }
  let listed = await client.listTools()
  if (config.mcpToolSurface === "progressive") {
    assertExactCatalog(
      listed.tools.map(({ name }) => name),
      MCP_ALWAYS_AVAILABLE_TOOL_NAMES,
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
  if (listed.tools.some((tool) => (
    tool.annotations?.destructiveHint === true
    && tool.annotations.readOnlyHint === true
  ))) {
    throw new Error("MCP smoke check found contradictory tool risk annotations")
  }
  for (const name of [
    "delete_messages",
    "execute_bulk_guild_ban",
    "execute_bulk_member_role_change",
    "execute_member_moderation",
    "execute_poll_end",
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
  if (selectedToolNames.includes("execute_component_message")) {
    const tool = listed.tools.find((entry) => (
      entry.name === "execute_component_message"
    ))
    if (
      !tool
      || tool.annotations?.destructiveHint !== true
      || tool.annotations.idempotentHint !== false
      || tool.annotations.openWorldHint !== true
      || tool.annotations.readOnlyHint !== false
    ) {
      throw new Error("MCP smoke check found invalid execute_component_message annotations")
    }
  }
  if (selectedToolNames.includes("execute_embed_message")) {
    const tool = listed.tools.find((entry) => (
      entry.name === "execute_embed_message"
    ))
    if (
      !tool
      || tool.annotations?.destructiveHint !== true
      || tool.annotations.idempotentHint !== false
      || tool.annotations.openWorldHint !== true
      || tool.annotations.readOnlyHint !== false
    ) {
      throw new Error("MCP smoke check found invalid execute_embed_message annotations")
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
  if (selectedToolNames.includes("execute_thread_creation")) {
    const tool = listed.tools.find((entry) => (
      entry.name === "execute_thread_creation"
    ))
    if (
      !tool
      || tool.annotations?.destructiveHint !== false
      || tool.annotations.idempotentHint !== false
      || tool.annotations.openWorldHint !== true
      || tool.annotations.readOnlyHint !== false
    ) {
      throw new Error("MCP smoke check found invalid execute_thread_creation annotations")
    }
  }
  if (selectedToolNames.includes("execute_poll_creation")) {
    const tool = listed.tools.find((entry) => (
      entry.name === "execute_poll_creation"
    ))
    if (
      !tool
      || tool.annotations?.destructiveHint !== false
      || tool.annotations.idempotentHint !== false
      || tool.annotations.openWorldHint !== true
      || tool.annotations.readOnlyHint !== false
    ) {
      throw new Error("MCP smoke check found invalid execute_poll_creation annotations")
    }
  }
  const interactionAnnotations = [
    ["send_message", false, true],
    ["signal_command_processing", false, false],
    ["add_reaction", false, true],
    ["add_reactions", false, true],
    ["edit_own_message", true, true],
    ["remove_own_reaction", true, true],
  ] as const
  for (const [name, destructiveHint, idempotentHint] of interactionAnnotations) {
    if (!selectedToolNames.includes(name)) continue
    const tool = listed.tools.find((entry) => entry.name === name)
    if (
      !tool
      || tool.annotations?.destructiveHint !== destructiveHint
      || tool.annotations.idempotentHint !== idempotentHint
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
      throw new Error("GuildControl identity smoke call failed")
    }
  }
  const application = objectValue(structured.application)
  const bot = objectValue(structured.bot)
  const installationAudit = objectValue(structured.installationAudit)
  const completeness = objectValue(installationAudit?.completeness)
  const drift = objectValue(installationAudit?.drift)
  const installationIdentity = objectValue(installationAudit?.identity)
  const applicationId = stringProperty(application, "id")
  const botId = stringProperty(bot, "id")
  const configuredGuildIds = canonicalSnowflakeArray(installationAudit?.configuredGuildIds)
  const installedGuildIds = canonicalSnowflakeArray(installationAudit?.installedGuildIds)
  const installedInScopeGuildIds = canonicalSnowflakeArray(
    installationAudit?.installedInScopeGuildIds,
  )
  const missingConfiguredGuildIds = canonicalSnowflakeArray(
    drift?.missingConfiguredGuildIds,
  )
  const unexpectedGuildIds = canonicalSnowflakeArray(drift?.unexpectedGuildIds)
  const discardedGuildFieldCount = safeIntegerProperty(
    installationAudit,
    "discardedGuildFieldCount",
  )
  const maximumGuilds = safeIntegerProperty(completeness, "maximumGuilds")
  const pageSize = safeIntegerProperty(completeness, "pageSize")
  const pagesRead = safeIntegerProperty(completeness, "pagesRead")
  if (
    !application
    || !bot
    || !installationAudit
    || !completeness
    || !drift
    || !installationIdentity
    || !applicationId
    || !botId
    || !configuredGuildIds
    || !installedGuildIds
    || !installedInScopeGuildIds
    || !missingConfiguredGuildIds
    || !unexpectedGuildIds
    || discardedGuildFieldCount === undefined
    || maximumGuilds === undefined
    || pageSize === undefined
    || pagesRead === undefined
  ) {
    throw new Error("MCP get_connector_status returned an invalid identity report")
  }
  const expectedConfiguredGuildIds = [...config.allowedGuildIds]
    .sort((left, right) => {
      const leftId = BigInt(left)
      const rightId = BigInt(right)
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
    })
  const installed = new Set(installedGuildIds)
  const configured = new Set(expectedConfiguredGuildIds)
  const expectedInstalledInScopeGuildIds = installedGuildIds
    .filter((guildId) => configured.has(guildId))
  const expectedMissingConfiguredGuildIds = expectedConfiguredGuildIds
    .filter((guildId) => !installed.has(guildId))
  const expectedUnexpectedGuildIds = installedGuildIds
    .filter((guildId) => !configured.has(guildId))
  if (
    structured.schemaVersion !== CONNECTOR_STATUS_SCHEMA_VERSION
    || !hasExactKeys(structured, CONNECTOR_STATUS_KEYS)
    || !hasExactKeys(application, CONNECTOR_STATUS_APPLICATION_KEYS)
    || !hasExactKeys(bot, CONNECTOR_STATUS_BOT_KEYS)
    || !hasExactKeys(installationAudit, BOT_INSTALLATION_AUDIT_KEYS)
    || !hasExactKeys(completeness, BOT_INSTALLATION_AUDIT_COMPLETENESS_KEYS)
    || !hasExactKeys(drift, BOT_INSTALLATION_AUDIT_DRIFT_KEYS)
    || !hasExactKeys(installationIdentity, BOT_INSTALLATION_AUDIT_IDENTITY_KEYS)
    || installationAudit.schemaVersion !== BOT_INSTALLATION_AUDIT_SCHEMA_VERSION
    || installationAudit.status !== "complete"
    || completeness.complete !== true
    || maximumGuilds !== BOT_INSTALLATION_AUDIT_LIMITS.maximumGuilds
    || pageSize !== BOT_INSTALLATION_AUDIT_LIMITS.pageSize
    || pagesRead !== Math.floor(installedGuildIds.length / pageSize) + 1
    || installedGuildIds.length > maximumGuilds
    || discardedGuildFieldCount < 0
    || drift.detected !== (
      missingConfiguredGuildIds.length > 0 || unexpectedGuildIds.length > 0
    )
    || applicationId !== config.expectedApplicationId
    || botId !== config.expectedBotId
    || installationIdentity.applicationId !== applicationId
    || installationIdentity.botId !== botId
    || !sameStrings(configuredGuildIds, expectedConfiguredGuildIds)
    || !sameStrings(installedInScopeGuildIds, expectedInstalledInScopeGuildIds)
    || !sameStrings(missingConfiguredGuildIds, expectedMissingConfiguredGuildIds)
    || !sameStrings(unexpectedGuildIds, expectedUnexpectedGuildIds)
    || !matchesExactStringRecord(
      installationAudit.privacy,
      BOT_INSTALLATION_AUDIT_PRIVACY,
    )
    || !matchesExactStringRecord(structured.privacy, CONNECTOR_STATUS_PRIVACY)
  ) {
    throw new Error("MCP get_connector_status returned an invalid privacy report")
  }
  if (installedInScopeGuildIds.length < 1 || missingConfiguredGuildIds.length > 0) {
    throw new Error("MCP get_connector_status found incomplete configured guild installations")
  }
  return {
    applicationId,
    botId,
    configuredGuildCount: configuredGuildIds.length,
    destructiveTools: listed.tools
      .filter((tool) => tool.annotations?.destructiveHint === true)
      .map((tool) => tool.name)
      .sort(),
    installedGuildCount: installedGuildIds.length,
    installedInScopeGuildCount: installedInScopeGuildIds.length,
    missingConfiguredGuildCount: missingConfiguredGuildIds.length,
    promptNames: promptNames.sort(),
    protocolVersion,
    readOnlyTools: listed.tools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name)
      .sort(),
    resourceTemplateUris: resourceTemplateUris.sort(),
    resourceUris: resourceUris.sort(),
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: server.name,
    serverVersion: server.version,
    status: "ok",
    toolCount: listed.tools.length,
    toolsets: selectedMcpToolsets(config.mcpToolsets),
    toolSurface: config.mcpToolSurface,
    transport,
    unexpectedGuildCount: unexpectedGuildIds.length,
    writeCapableTools: listed.tools
      .filter((tool) => tool.annotations?.readOnlyHint === false)
      .map((tool) => tool.name)
      .sort(),
  }
}

function stdioSmokeEnvironment(
  config: ConnectorConfig,
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const child = getDefaultEnvironment()
  const configFile = environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]
  if (configFile !== undefined) {
    child[CONFIG_FILE_ENVIRONMENT_VARIABLE] = configFile
  }
  for (const name of config.secretEnvironmentVariables) {
    const value = environment[name]
    if (value !== undefined) child[name] = value
  }
  return child
}

function appendStdioSmokeStderr(
  current: Buffer<ArrayBufferLike>,
  chunk: unknown,
): Buffer<ArrayBufferLike> {
  const addition = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), "utf8")
  const retainedAddition = addition.length > STDIO_SMOKE_STDERR_CAPTURE_BYTES
    ? addition.subarray(addition.length - STDIO_SMOKE_STDERR_CAPTURE_BYTES)
    : addition
  const remaining = STDIO_SMOKE_STDERR_CAPTURE_BYTES - retainedAddition.length
  const retainedCurrent = current.length > remaining
    ? current.subarray(current.length - remaining)
    : current
  return Buffer.concat([retainedCurrent, retainedAddition])
}

function safeStdioSmokeDiagnostic(
  value: string,
  secrets: readonly string[],
): string {
  return redactText(value, secrets)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "?")
    .trim()
    .slice(-STDIO_SMOKE_STDERR_REPORT_BYTES)
}

function stdioSmokeFailure(
  error: unknown,
  stderr: Buffer<ArrayBufferLike>,
  config: ConnectorConfig,
  environment: NodeJS.ProcessEnv,
): ConfigurationError {
  const secrets = [
    config.token,
    ...[...config.secretEnvironmentVariables]
      .map((name) => environment[name])
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ]
  const primary = safeStdioSmokeDiagnostic(errorMessage(error), secrets)
  const child = safeStdioSmokeDiagnostic(stderr.toString("utf8"), secrets)
  return new ConfigurationError(
    `Spawned stdio MCP smoke failed: ${primary || "Unknown child failure"}`
    + (child ? `; child diagnostics: ${child}` : ""),
    { cause: error },
  )
}

async function closeStdioSmoke(
  client: Client,
  transport: StdioClientTransport,
): Promise<void> {
  try {
    await client.close()
  } catch (error) {
    try {
      await transport.close()
    } catch (transportError) {
      throw new AggregateError(
        [error, transportError],
        "Unable to close the spawned stdio MCP smoke process",
      )
    }
  }
}

async function smokeLinkedConnector(
  config: ConnectorConfig,
  environment: NodeJS.ProcessEnv,
  service: DiscordToolService,
): Promise<SmokeReport> {
  const gateway = smokeGateway(config)
  const server = createGuildControlServer({
    config,
    environment,
    ...(gateway ? { gateway } : {}),
    service,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = createSmokeClient()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport, {
      timeout: STARTUP_TIMEOUT_SECONDS * 1_000,
    })
    return await inspectSmokeClient(client, config, service, "in-memory")
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

async function smokeStdioConnector(
  config: ConnectorConfig,
  environment: NodeJS.ProcessEnv,
  service: DiscordToolService,
  launch: NonNullable<SmokeOptions["launch"]>,
): Promise<SmokeReport> {
  const command = launch.command.trim()
  if (!command || command.includes("\0")) {
    throw new ConfigurationError("Spawned stdio MCP smoke command is invalid")
  }
  const args = [...launch.args]
  if (args.some((argument) => !argument.trim() || argument.includes("\0"))) {
    throw new ConfigurationError("Spawned stdio MCP smoke arguments are invalid")
  }
  const transport = new SmokeStdioClientTransport({
    args,
    command,
    env: stdioSmokeEnvironment(config, environment),
    stderr: "pipe",
  })
  const client = createSmokeClient(true)
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  transport.stderr?.on("data", (chunk) => {
    stderr = appendStdioSmokeStderr(stderr, chunk)
  })

  let report: SmokeReport
  try {
    await client.connect(transport, {
      timeout: STARTUP_TIMEOUT_SECONDS * 1_000,
    })
    report = await inspectSmokeClient(client, config, service, "stdio")
  } catch (error) {
    await closeStdioSmoke(client, transport).catch(() => undefined)
    await new Promise<void>((resolve) => setImmediate(resolve))
    throw stdioSmokeFailure(error, stderr, config, environment)
  }
  try {
    await closeStdioSmoke(client, transport)
  } catch (error) {
    throw stdioSmokeFailure(error, stderr, config, environment)
  }
  return report
}

export async function smokeConnector(
  options: SmokeOptions = {},
): Promise<SmokeReport> {
  const environment = options.environment || process.env
  const config = options.config || loadConnectorConfig(environment)
  const service = options.service || new ConnectorService({ config })
  return options.launch
    ? smokeStdioConnector(config, environment, service, options.launch)
    : smokeLinkedConnector(config, environment, service)
}
