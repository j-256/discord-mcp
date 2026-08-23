import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import {
  basename,
  extname,
} from "node:path"

import type { ConnectorConfig } from "./config.js"
import { loadConnectorConfig } from "./config.js"
import {
  CONFIG_DOCUMENT_SCHEMA_VERSION,
  configDocumentPolicyFromEnvironment,
  connectorConfigSecretEnvironmentNames,
  createConnectorConfigDocument,
  normalizeConfigName,
  parseConnectorConfigDocument,
  type ConnectorConfigDocument,
} from "./config-document.js"
import {
  resolveConnectorConfigFile,
  writeConnectorConfigDocumentFile,
} from "./config-operator.js"
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
import { guildChannelLayoutGuildIds } from "./guild-channel-evidence.js"
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
  normalizeCredentialEnvironmentName,
  normalizeProfileName,
  parseConnectorProfile,
  PROFILE_MANAGED_ENVIRONMENT_NAMES,
  saveProfile,
  type ConnectorProfile,
} from "./profile.js"
import { ConnectorService } from "./service.js"
import {
  applySetupPreset,
  type SetupPresetDescriptor,
  type SetupPresetSelection,
} from "./setup-presets.js"

export const OPERATOR_REPORT_SCHEMA_VERSION = 19
export const SUPPORTED_NODE_MAJOR = 22

export const DOCTOR_CHECK_IDS = Object.freeze({
  administrationPolicy: "administration-policy",
  announcementCrosspostPolicy: "announcement-crosspost-policy",
  announcementSubscriptionAuditPolicy: "announcement-subscription-audit-policy",
  announcementSubscriptionChangePolicy: "announcement-subscription-change-policy",
  applicationEmojiAuditPolicy: "application-emoji-audit-policy",
  applicationEmojiChangePolicy: "application-emoji-change-policy",
  applicationIdentity: "application-identity",
  attachmentPolicy: "attachment-policy",
  automodAuditPolicy: "automod-audit-policy",
  automodChangePolicy: "automod-change-policy",
  banAuditPolicy: "ban-audit-policy",
  botIdentity: "bot-identity",
  channelCloneAuditPolicy: "channel-clone-audit-policy",
  channelCloneChangePolicy: "channel-clone-change-policy",
  channelCreationPolicy: "channel-creation-policy",
  channelMetadataPolicy: "channel-metadata-policy",
  channelScope: "channel-scope",
  configuration: "configuration",
  deletionPolicy: "deletion-policy",
  forumPostPolicy: "forum-post-policy",
  forumTagAuditPolicy: "forum-tag-audit-policy",
  forumTagChangePolicy: "forum-tag-change-policy",
  guildAccess: "guild-access",
  guildMembersIntent: "guild-members-intent",
  guildScope: "guild-scope",
  guildExpressionAuditPolicy: "guild-expression-audit-policy",
  guildExpressionChangePolicy: "guild-expression-change-policy",
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
  inviteDeletionPolicy: "invite-deletion-policy",
  memberDirectoryPolicy: "member-directory-policy",
  memberNicknamePolicy: "member-nickname-policy",
  otherMemberNicknamePolicy: "other-member-nickname-policy",
  memberRolePolicy: "member-role-policy",
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
  guildSettingsAuditPolicy: "guild-settings-audit-policy",
  guildSettingsChangePolicy: "guild-settings-change-policy",
  observability: "observability",
  permissionOverwritePolicy: "permission-overwrite-policy",
  pollAuditPolicy: "poll-audit-policy",
  pollCreationPolicy: "poll-creation-policy",
  pollEndPolicy: "poll-end-policy",
  pollVoterAuditPolicy: "poll-voter-audit-policy",
  reactionModerationPolicy: "reaction-moderation-policy",
  reactionUserAuditPolicy: "reaction-user-audit-policy",
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
  stageInstanceAuditPolicy: "stage-instance-audit-policy",
  stageInstanceChangePolicy: "stage-instance-change-policy",
  stageStartNotificationPolicy: "stage-start-notification-policy",
  token: "token",
  toolSurface: "tool-surface",
  threadAuditPolicy: "thread-audit-policy",
  threadChangePolicy: "thread-change-policy",
  threadCreationPolicy: "thread-creation-policy",
  webhookAuditPolicy: "webhook-audit-policy",
  webhookChangePolicy: "webhook-change-policy",
  webhookCreationPolicy: "webhook-creation-policy",
  webhookDeletionPolicy: "webhook-deletion-policy",
})

const DEFAULT_CLI_COMMAND = "discord-mcp"
const DEFAULT_MCP_SERVER_NAME = "discord"
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const STARTUP_TIMEOUT_SECONDS = 30
const TOOL_TIMEOUT_SECONDS = 180
const PROFILE_ENVIRONMENT_FORWARDING = Object.freeze({
  credentialOnly: "credential-only",
  includePolicy: "include-policy",
} as const)
type ProfileEnvironmentForwarding = typeof PROFILE_ENVIRONMENT_FORWARDING[
  keyof typeof PROFILE_ENVIRONMENT_FORWARDING
]

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
  configBackupFile: string | null
  configFile: string | null
  credentialVariable: string
  guildsAccessibleOnFirstPage: number
  guildsInScopeOnFirstPage: number
  launch: StdioLaunchDescriptor
  preset: SetupPresetDescriptor | null
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
  configFile?: string
  credentialVariable?: string
  environment?: NodeJS.ProcessEnv
  overwriteConfig?: boolean
  overwriteProfile?: boolean
  profileDirectory?: string
  profileName?: string
  preset?: SetupPresetSelection
  serverName?: string
  service?: StatusProvider
}

export interface SmokeOptions {
  environment?: NodeJS.ProcessEnv
  service?: DiscordToolService
}

const DOCTOR_REFERENCES = Object.freeze({
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

const DOCTOR_SCOPE_CHECK_IDS = new Set<string>([
  DOCTOR_CHECK_IDS.channelScope,
  DOCTOR_CHECK_IDS.guildScope,
])

const DOCTOR_INTENT_CHECK_IDS = new Set<string>([
  DOCTOR_CHECK_IDS.guildMembersIntent,
  DOCTOR_CHECK_IDS.messageContentIntent,
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
      action: `Set ${ENVIRONMENT_NAMES.token} in the current process or activate a profile whose credential variable is present, then rerun doctor.`,
      reference: DOCTOR_REFERENCES.botSetup,
    }
  }
  if (id === DOCTOR_CHECK_IDS.configuration) {
    return {
      action: "Correct the reported environment or profile value, then rerun doctor before starting the server.",
      reference: DOCTOR_REFERENCES.configuration,
    }
  }
  if (DOCTOR_IDENTITY_CHECK_IDS.has(id)) {
    return {
      action: "Create or refresh a profile with setup so the verified application and bot identities are pinned.",
      reference: DOCTOR_REFERENCES.operatorCli,
    }
  }
  if (DOCTOR_SCOPE_CHECK_IDS.has(id)) {
    return {
      action: "Create a least-privilege profile with an exact guild and, when message access is needed, channel scope.",
      reference: DOCTOR_REFERENCES.operatorCli,
    }
  }
  if (DOCTOR_INTENT_CHECK_IDS.has(id)) {
    return {
      action: "Enable only the required privileged intent in the Discord Developer Portal, or disable the connector feature that needs it, then rerun doctor --online.",
      reference: DOCTOR_REFERENCES.botSetup,
    }
  }
  if (id === DOCTOR_CHECK_IDS.guildAccess) {
    return {
      action: "Install the verified bot in every intended guild and align the exact local guild scope, then rerun doctor --online.",
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
  if (config.allowMemberDirectory && config.memberDirectoryGuildIds.size === 0) {
    warnings.push("The member-directory toggle is enabled but member lookup remains blocked because an exact guild allowlist is required")
  }
  if (config.allowBanAudit && config.banAuditGuildIds.size === 0) {
    warnings.push("The ban-audit toggle is enabled but ban inspection remains blocked because an exact guild allowlist is required")
  }
  if (config.allowInviteAudit && config.inviteGuildIds.size === 0) {
    warnings.push("The invite-audit toggle is enabled but inventory remains blocked because an exact guild allowlist is required")
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
  if (config.allowWebhookAudit && config.webhookChannelIds.size === 0) {
    warnings.push("The webhook-audit toggle is enabled but inventory remains blocked because an exact channel allowlist is required")
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
  for (const [enabled, toolset, capability] of [
    [config.allowAdministration, "moderation", "Member administration"],
    [
      config.allowApplicationEmojiAudit || config.allowApplicationEmojiChanges,
      "application-emojis",
      "Application emoji audit and reviewed changes",
    ],
    [config.allowAttachments, "attachments", "Attachment messages"],
    [
      config.allowAutomodAudit || config.allowAutomodChanges,
      "automod",
      "AutoMod audit and changes",
    ],
    [config.allowChannelCreation, "channel-creation", "Channel creation"],
    [config.allowChannelMetadataChanges, "channel-metadata", "Channel metadata changes"],
    [config.allowDeletions, "deletion", "Message deletion"],
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
    [config.allowGuildScaffolds, "guild-scaffolds", "Guild scaffolds"],
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
      "Native Interaction command management and ingress",
    ],
    [
      config.allowInviteAudit || config.allowInviteDeletions,
      "invites",
      "Invite audit and reviewed revocation",
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
      config.allowGuildProfileAudit || config.allowGuildProfileChanges,
      "guild-profile",
      "Guild profile audit and reviewed text changes",
    ],
    [config.allowMemberDirectory, "members", "Member directory"],
    [config.allowBanAudit, "bans", "Guild ban audit"],
    [config.allowNicknameChanges, "member-nicknames", "Reviewed member nickname changes"],
    [config.allowMemberRoleChanges, "member-roles", "Member role changes"],
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
      config.allowSoundboardAudit || config.allowSoundboardChanges,
      "soundboard",
      "Soundboard audit and reviewed changes",
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
        "Reviewed channel-order changes are disabled",
      ))
    } else if (config.channelOrderingGuildIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingChangePolicy,
        "warn",
        "Channel-order changes are enabled, but the required exact guild allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.channelOrderingChangePolicy,
        "pass",
        `Reviewed channel-order changes are constrained to ${config.channelOrderingGuildIds.size} exact guilds with signed approval, one-shot execution, durable channel-collection coordination, and newer complete Gateway verification`,
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
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.roleConfigurationPolicy,
        "pass",
        `Reviewed role configuration is constrained to ${config.roleConfigurationIds.size} exact roles with partial updates, one-shot execution, and complete readback`,
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
        "Message interactions and reviewed static component messages are disabled",
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
        `Message interactions and reviewed static component messages are constrained to ${config.interactionChannelIds.size} channels with ${config.mentionUserIds.size} notification users and a shared ${config.interactionMaxWritesPerMinute}-write rolling budget`,
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
    } else if (config.webhookChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookAuditPolicy,
        "warn",
        "Webhook-audit toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookAuditPolicy,
        "pass",
        `Credential-redacted webhook inventory is constrained to ${config.webhookChannelIds.size} exact channels`,
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
    } else if (config.webhookChannelIds.size === 0) {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookCreationPolicy,
        "warn",
        "Webhook-creation toggle is enabled, but the required exact channel allowlist is empty",
      ))
    } else {
      checks.push(check(
        DOCTOR_CHECK_IDS.webhookCreationPolicy,
        "pass",
        `Reviewed Incoming-webhook creation is constrained to ${config.webhookChannelIds.size} exact channels with credential projection, one-shot execution, and complete inventory readback`,
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
    checks.push(config.allowGateway
      ? check(
          DOCTOR_CHECK_IDS.gatewayPolicy,
          "pass",
          `Discord Gateway events are enabled with a ${config.gatewayEventBufferSize}-event content-free buffer, ${layoutGuildCount} exact layout guilds, and only nonprivileged intents`,
        )
      : layoutGuildCount > 0
        ? check(
            DOCTOR_CHECK_IDS.gatewayPolicy,
            "pass",
            `Discord Gateway events are disabled; a GUILDS-only channel-layout connection covers ${layoutGuildCount} exact guilds for continuity-safe metadata evidence`,
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
        `Native Interaction ingress accepts /${config.nativeCommandName} only in ${config.nativeInteractionGuildIds.size} guilds, ${config.nativeInteractionChannelIds.size} channels, and from ${config.nativeInteractionUserIds.size} users; the private queue holds at most ${config.nativeInteractionMaxPending} requests for ${config.nativeInteractionTtlSeconds} seconds and uses ${config.allowGateway ? "the separately enabled nonprivileged event-feed intents" : "an intents-free Gateway connection"} with startup endpoint and command verification`,
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
        const announcementCrosspostsConfigured = config.allowAnnouncementCrossposts
          && config.announcementCrosspostChannelIds.size > 0
        const componentMessagesConfigured = config.allowInteractions
          && config.interactionChannelIds.size > 0
        const messageForwardingConfigured = config.allowMessageForwarding
          && config.messageForwardSourceChannelIds.size > 0
          && config.messageForwardTargetChannelIds.size > 0
        const contentDependentWrites = [
          ...(announcementCrosspostsConfigured ? ["announcement crossposts"] : []),
          ...(componentMessagesConfigured ? ["static component messages"] : []),
          ...(messageForwardingConfigured ? ["message forwarding"] : []),
        ]
        checks.push(status.application.messageContentIntent === "enabled"
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
              : status.application.messageContentIntent === "disabled"
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
  config?: {
    document: ConnectorConfigDocument
    file: string
  }
  profile?: ConnectorProfile
  profileEnvironmentForwarding?: ProfileEnvironmentForwarding
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
  const profileEnvironmentForwarding = options.profileEnvironmentForwarding
    ?? PROFILE_ENVIRONMENT_FORWARDING.includePolicy
  if (
    profileEnvironmentForwarding !== PROFILE_ENVIRONMENT_FORWARDING.credentialOnly
    && profileEnvironmentForwarding !== PROFILE_ENVIRONMENT_FORWARDING.includePolicy
  ) {
    throw new ConfigurationError("Profile environment forwarding mode is invalid")
  }
  if (
    !profile
    && profileEnvironmentForwarding === PROFILE_ENVIRONMENT_FORWARDING.credentialOnly
  ) {
    throw new ConfigurationError(
      "Credential-only environment forwarding requires a profile",
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
  let environmentVariables: string[] = [
    ENVIRONMENT_NAMES.token,
    ENVIRONMENT_NAMES.allowedGuildIds,
    ENVIRONMENT_NAMES.allowedChannelIds,
    ENVIRONMENT_NAMES.allowAttachments,
    ENVIRONMENT_NAMES.attachmentChannelIds,
    ENVIRONMENT_NAMES.attachmentMaxBytes,
    ENVIRONMENT_NAMES.attachmentRoots,
    ENVIRONMENT_NAMES.allowAutomodAudit,
    ENVIRONMENT_NAMES.allowAutomodChanges,
    ENVIRONMENT_NAMES.automodGuildIds,
    ENVIRONMENT_NAMES.automodAlertChannelIds,
    ENVIRONMENT_NAMES.allowAdministration,
    ENVIRONMENT_NAMES.adminGuildIds,
    ENVIRONMENT_NAMES.protectedUserIds,
    ENVIRONMENT_NAMES.allowChannelCreation,
    ENVIRONMENT_NAMES.channelCreationGuildIds,
    ENVIRONMENT_NAMES.allowChannelDeletionAudit,
    ENVIRONMENT_NAMES.allowChannelDeletions,
    ENVIRONMENT_NAMES.channelDeletionIds,
    ENVIRONMENT_NAMES.allowChannelCloneAudit,
    ENVIRONMENT_NAMES.allowChannelCloning,
    ENVIRONMENT_NAMES.channelCloneGuildIds,
    ENVIRONMENT_NAMES.channelCloneSourceIds,
    ENVIRONMENT_NAMES.allowChannelMetadataChanges,
    ENVIRONMENT_NAMES.channelMetadataIds,
    ENVIRONMENT_NAMES.allowChannelOrderingAudit,
    ENVIRONMENT_NAMES.allowChannelOrderingChanges,
    ENVIRONMENT_NAMES.channelOrderingGuildIds,
    ENVIRONMENT_NAMES.allowRoleCreation,
    ENVIRONMENT_NAMES.roleCreationGuildIds,
    ENVIRONMENT_NAMES.allowRoleConfiguration,
    ENVIRONMENT_NAMES.roleConfigurationIds,
    ENVIRONMENT_NAMES.allowRoleDeletionAudit,
    ENVIRONMENT_NAMES.allowRoleDeletions,
    ENVIRONMENT_NAMES.roleDeletionIds,
    ENVIRONMENT_NAMES.allowRoleOrderingAudit,
    ENVIRONMENT_NAMES.allowRoleOrderingChanges,
    ENVIRONMENT_NAMES.roleOrderingGuildIds,
    ENVIRONMENT_NAMES.allowGuildScaffolds,
    ENVIRONMENT_NAMES.guildScaffoldGuildIds,
    ENVIRONMENT_NAMES.allowGuildTemplateAudit,
    ENVIRONMENT_NAMES.allowGuildTemplateChanges,
    ENVIRONMENT_NAMES.guildTemplateGuildIds,
    ENVIRONMENT_NAMES.allowGuildExpressionAudit,
    ENVIRONMENT_NAMES.allowGuildExpressionChanges,
    ENVIRONMENT_NAMES.guildExpressionGuildIds,
    ENVIRONMENT_NAMES.guildExpressionRoots,
    ENVIRONMENT_NAMES.allowApplicationEmojiAudit,
    ENVIRONMENT_NAMES.allowApplicationEmojiChanges,
    ENVIRONMENT_NAMES.applicationEmojiRoots,
    ENVIRONMENT_NAMES.allowScheduledEventAudit,
    ENVIRONMENT_NAMES.allowScheduledEventChanges,
    ENVIRONMENT_NAMES.allowScheduledEventUserAudit,
    ENVIRONMENT_NAMES.scheduledEventGuildIds,
    ENVIRONMENT_NAMES.scheduledEventRoots,
    ENVIRONMENT_NAMES.allowSoundboardAudit,
    ENVIRONMENT_NAMES.allowSoundboardChanges,
    ENVIRONMENT_NAMES.soundboardGuildIds,
    ENVIRONMENT_NAMES.soundboardRoots,
    ENVIRONMENT_NAMES.allowStageInstanceAudit,
    ENVIRONMENT_NAMES.allowStageInstanceChanges,
    ENVIRONMENT_NAMES.allowStageStartNotifications,
    ENVIRONMENT_NAMES.stageChannelIds,
    ENVIRONMENT_NAMES.allowDeletions,
    ENVIRONMENT_NAMES.deleteChannelIds,
    ENVIRONMENT_NAMES.allowPinManagement,
    ENVIRONMENT_NAMES.pinChannelIds,
    ENVIRONMENT_NAMES.allowAnnouncementCrossposts,
    ENVIRONMENT_NAMES.announcementCrosspostChannelIds,
    ENVIRONMENT_NAMES.allowMessageForwarding,
    ENVIRONMENT_NAMES.allowCrossGuildMessageForwarding,
    ENVIRONMENT_NAMES.messageForwardSourceChannelIds,
    ENVIRONMENT_NAMES.messageForwardTargetChannelIds,
    ENVIRONMENT_NAMES.allowAnnouncementSubscriptionAudit,
    ENVIRONMENT_NAMES.allowAnnouncementSubscriptionChanges,
    ENVIRONMENT_NAMES.announcementSubscriptionSourceChannelIds,
    ENVIRONMENT_NAMES.announcementSubscriptionTargetChannelIds,
    ENVIRONMENT_NAMES.allowPollAudit,
    ENVIRONMENT_NAMES.allowPollVoterAudit,
    ENVIRONMENT_NAMES.allowPollCreation,
    ENVIRONMENT_NAMES.allowPollEnding,
    ENVIRONMENT_NAMES.pollChannelIds,
    ENVIRONMENT_NAMES.allowReactionUserAudit,
    ENVIRONMENT_NAMES.allowReactionModeration,
    ENVIRONMENT_NAMES.reactionChannelIds,
    ENVIRONMENT_NAMES.allowPermissionOverwrites,
    ENVIRONMENT_NAMES.permissionOverwriteChannelIds,
    ENVIRONMENT_NAMES.allowForumPosts,
    ENVIRONMENT_NAMES.forumPostChannelIds,
    ENVIRONMENT_NAMES.allowForumTagAudit,
    ENVIRONMENT_NAMES.allowForumTagChanges,
    ENVIRONMENT_NAMES.forumTagChannelIds,
    ENVIRONMENT_NAMES.allowThreadCreation,
    ENVIRONMENT_NAMES.threadParentIds,
    ENVIRONMENT_NAMES.allowThreadAudit,
    ENVIRONMENT_NAMES.allowThreadChanges,
    ENVIRONMENT_NAMES.threadGuildIds,
    ENVIRONMENT_NAMES.threadIds,
    ENVIRONMENT_NAMES.threadMemberUserIds,
    ENVIRONMENT_NAMES.allowInteractions,
    ENVIRONMENT_NAMES.interactionChannelIds,
    ENVIRONMENT_NAMES.mentionUserIds,
    ENVIRONMENT_NAMES.interactionMaxWritesPerMinute,
    ENVIRONMENT_NAMES.interactionMinWriteIntervalMs,
    ENVIRONMENT_NAMES.allowInviteAudit,
    ENVIRONMENT_NAMES.allowInviteDeletions,
    ENVIRONMENT_NAMES.inviteGuildIds,
    ENVIRONMENT_NAMES.allowOnboardingAudit,
    ENVIRONMENT_NAMES.allowOnboardingChanges,
    ENVIRONMENT_NAMES.onboardingGuildIds,
    ENVIRONMENT_NAMES.allowWelcomeScreenAudit,
    ENVIRONMENT_NAMES.allowWelcomeScreenChanges,
    ENVIRONMENT_NAMES.welcomeScreenGuildIds,
    ENVIRONMENT_NAMES.allowWidgetSettingsAudit,
    ENVIRONMENT_NAMES.allowWidgetSettingsChanges,
    ENVIRONMENT_NAMES.allowWidgetPublicExposure,
    ENVIRONMENT_NAMES.widgetSettingsGuildIds,
    ENVIRONMENT_NAMES.allowGuildSettingsAudit,
    ENVIRONMENT_NAMES.allowGuildSettingsChanges,
    ENVIRONMENT_NAMES.guildSettingsGuildIds,
    ENVIRONMENT_NAMES.allowGuildProfileAudit,
    ENVIRONMENT_NAMES.allowGuildProfileChanges,
    ENVIRONMENT_NAMES.guildProfileGuildIds,
    ENVIRONMENT_NAMES.allowMemberDirectory,
    ENVIRONMENT_NAMES.memberDirectoryGuildIds,
    ENVIRONMENT_NAMES.allowBanAudit,
    ENVIRONMENT_NAMES.banAuditGuildIds,
    ENVIRONMENT_NAMES.allowNicknameChanges,
    ENVIRONMENT_NAMES.allowOtherMemberNicknameChanges,
    ENVIRONMENT_NAMES.nicknameGuildIds,
    ENVIRONMENT_NAMES.allowMemberRoleChanges,
    ENVIRONMENT_NAMES.memberRoleGuildIds,
    ENVIRONMENT_NAMES.memberRoleIds,
    ENVIRONMENT_NAMES.allowMemberVoiceAudit,
    ENVIRONMENT_NAMES.allowMemberVoiceChanges,
    ENVIRONMENT_NAMES.memberVoiceGuildIds,
    ENVIRONMENT_NAMES.memberVoiceChannelIds,
    ENVIRONMENT_NAMES.allowWebhookAudit,
    ENVIRONMENT_NAMES.allowWebhookChanges,
    ENVIRONMENT_NAMES.allowWebhookCreation,
    ENVIRONMENT_NAMES.allowWebhookDeletions,
    ENVIRONMENT_NAMES.webhookChannelIds,
    ENVIRONMENT_NAMES.allowIntegrationAudit,
    ENVIRONMENT_NAMES.allowIntegrationDeletions,
    ENVIRONMENT_NAMES.integrationGuildIds,
    ENVIRONMENT_NAMES.integrationIds,
    ENVIRONMENT_NAMES.allowGateway,
    ENVIRONMENT_NAMES.gatewayEventBufferSize,
    ENVIRONMENT_NAMES.allowNativeCommandChanges,
    ENVIRONMENT_NAMES.allowNativeInteractions,
    ENVIRONMENT_NAMES.nativeCommandName,
    ENVIRONMENT_NAMES.nativeInteractionGuildIds,
    ENVIRONMENT_NAMES.nativeInteractionChannelIds,
    ENVIRONMENT_NAMES.nativeInteractionUserIds,
    ENVIRONMENT_NAMES.nativeInteractionMaxPending,
    ENVIRONMENT_NAMES.nativeInteractionTtlSeconds,
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
    if (profile.schemaVersion === CONFIG_DOCUMENT_SCHEMA_VERSION) {
      environmentVariables = [...connectorConfigSecretEnvironmentNames(profile)]
    } else {
      const managed = new Set<string>(PROFILE_MANAGED_ENVIRONMENT_NAMES)
      environmentVariables = profileEnvironmentForwarding
        === PROFILE_ENVIRONMENT_FORWARDING.credentialOnly
        ? [profile.credential.variable]
        : [
            profile.credential.variable,
            ...environmentVariables.filter((name) => (
              name !== ENVIRONMENT_NAMES.token
              && !managed.has(name)
            )),
          ]
    }
  }
  if (config) {
    environmentVariables = [...connectorConfigSecretEnvironmentNames(config.document)]
  }
  return {
    args,
    command,
    environment: {
      forward: environmentVariables,
      set: profile || config
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
  if (options.configFile !== undefined && options.profileName !== undefined) {
    throw new ConfigurationError(
      "Setup configuration file and profile are mutually exclusive",
    )
  }
  const hasPersistentConfig = options.configFile !== undefined
    || options.profileName !== undefined
  if (
    !hasPersistentConfig
    && (
      options.credentialVariable !== undefined
      || options.overwriteConfig
      || options.overwriteProfile
      || options.profileDirectory !== undefined
      || options.preset !== undefined
    )
  ) {
    throw new ConfigurationError(
      "Credential aliases, replacement, presets, and scoped setup require a configuration file or profile",
    )
  }
  if (options.configFile !== undefined && options.profileDirectory !== undefined) {
    throw new ConfigurationError("Profile storage cannot be used with a configuration file")
  }
  if (options.configFile === undefined && options.overwriteConfig) {
    throw new ConfigurationError("Configuration replacement requires a configuration file")
  }
  if (options.profileName === undefined && options.overwriteProfile) {
    throw new ConfigurationError("Profile replacement requires a profile name")
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
  const credentialVariable = normalizeCredentialEnvironmentName(
    options.credentialVariable ?? ENVIRONMENT_NAMES.token,
  )
  const credentialEnvironment = hasPersistentConfig
    ? activateCredentialEnvironment(credentialVariable, environment)
    : environment
  const appliedPreset = options.preset
    ? applySetupPreset({
      ...(options.preset.channelIds
        ? { channelIds: options.preset.channelIds }
        : {}),
      environment: credentialEnvironment,
      guildIds: options.preset.guildIds,
      name: options.preset.name,
    })
    : null
  const runtimeEnvironment = appliedPreset?.environment ?? credentialEnvironment
  const config = loadConnectorConfig(runtimeEnvironment)
  if (configName && config.allowedGuildIds.size === 0) {
    throw new ConfigurationError(
      `Persistent setup requires ${ENVIRONMENT_NAMES.allowedGuildIds}`,
    )
  }
  const service = options.service || new ConnectorService({ config })
  const status = await service.getStatus()
  if (status.guildPage.inScope < 1) {
    throw new ConfigurationError("Discord bot has no accessible guilds inside the configured local scope")
  }
  if (
    appliedPreset
    && status.guildPage.inScope !== config.allowedGuildIds.size
  ) {
    throw new ConfigurationError(
      `Discord bot can access ${status.guildPage.inScope} of ${config.allowedGuildIds.size} exact preset guilds on the first membership page`,
    )
  }
  const portableConfig = configName
    ? createConnectorConfigDocument({
      applicationId: status.application.id,
      botId: status.bot.id,
      channelIds: [...config.allowedChannelIds],
      ...configDocumentPolicyFromEnvironment(runtimeEnvironment),
      credentialVariable,
      gatewayEnabled: config.allowGateway,
      gatewayEventBufferSize: config.gatewayEventBufferSize,
      guildIds: [...config.allowedGuildIds],
      name: configName,
      toolsets: selectedMcpToolsets(config.mcpToolsets),
      toolSurface: config.mcpToolSurface,
    })
    : null
  const profile = profileName ? portableConfig : null
  const launch = createStdioLaunchDescriptor({
    applicationId: status.application.id,
    botId: status.bot.id,
    ...(options.args ? { args: options.args } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(configFile && portableConfig
      ? {
          config: {
            document: portableConfig,
            file: configFile,
          },
        }
      : {}),
    ...(profile ? { profile } : {}),
    ...(appliedPreset && profile
      ? {
          profileEnvironmentForwarding:
            PROFILE_ENVIRONMENT_FORWARDING.credentialOnly,
        }
      : {}),
    ...(options.serverName !== undefined ? { serverName: options.serverName } : {}),
  })
  if (profile) {
    await saveProfile(profile, {
      environment,
      overwrite: options.overwriteProfile ?? false,
      ...(options.profileDirectory ? { directory: options.profileDirectory } : {}),
    })
  }
  const configWrite = configFile && portableConfig
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
      ? ["static component messages"]
      : []),
  ]
  return {
    applicationId: status.application.id,
    botId: status.bot.id,
    configBackupFile: configWrite?.backupFile ?? null,
    configFile: configWrite?.file ?? null,
    credentialVariable,
    launch,
    preset: appliedPreset?.preset ?? null,
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
      ["send_message", false],
      ["add_reaction", false],
      ["edit_own_message", true],
      ["remove_own_reaction", true],
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
