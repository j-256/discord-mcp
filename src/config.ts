import {
  lstatSync,
  realpathSync,
} from "node:fs"
import { homedir } from "node:os"
import {
  isAbsolute,
  join,
  parse,
  resolve,
} from "node:path"

import {
  CONNECTOR_LIMITS,
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  DISCORD_LIMITS,
  DISCORD_TOKEN_ENVIRONMENT_PATTERN,
  GUILD_PRUNE_DEFAULTS,
  INTERACTION_DEFAULTS,
  MCP_READ_RESPONSE_DEFAULTS,
  MCP_READ_RESPONSE_LIMITS,
  NATIVE_INTERACTION_COMMAND_NAME_PATTERN,
  NATIVE_INTERACTION_DEFAULTS,
  NATIVE_INTERACTION_LIMITS,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import {
  connectorConfigSecretEnvironmentNames,
  loadConnectorConfigDocumentFile,
  parseConnectorConfigDocument,
  resolveConnectorCredential,
  type ConnectorConfigCapabilityName,
  type ConnectorConfigDocument,
  type ConnectorConfigLimitName,
  type ConnectorConfigScopeName,
} from "./config-document.js"
import { ConfigurationError } from "./errors.js"
import {
  loadObservabilityDocumentConfig,
  type ObservabilityConfig,
} from "./observability-config.js"

export interface ConnectorConfig {
  adminGuildIds: ReadonlySet<string>
  announcementCrosspostChannelIds: ReadonlySet<string>
  announcementSubscriptionSourceChannelIds: ReadonlySet<string>
  announcementSubscriptionTargetChannelIds: ReadonlySet<string>
  allowedChannelIds: ReadonlySet<string>
  allowedGuildIds: ReadonlySet<string>
  allowAdministration: boolean
  allowApplicationCommandChanges: boolean
  allowApplicationEmojiAudit: boolean
  allowApplicationEmojiChanges: boolean
  allowApplicationIntentChanges: boolean
  allowApplicationRoleConnectionMetadataChanges: boolean
  allowAnnouncementCrossposts: boolean
  allowAnnouncementSubscriptionAudit: boolean
  allowAnnouncementSubscriptionChanges: boolean
  allowAttachments: boolean
  allowAutomodAudit: boolean
  allowAutomodChanges: boolean
  allowBanAudit: boolean
  allowBulkBanAudit: boolean
  allowBulkBans: boolean
  allowChannelCloneAudit: boolean
  allowChannelCloning: boolean
  allowChannelCreation: boolean
  allowChannelDeletionAudit: boolean
  allowChannelDeletions: boolean
  allowChannelMetadataChanges: boolean
  allowChannelOrderingAudit: boolean
  allowChannelOrderingChanges: boolean
  allowDeletions: boolean
  allowDirectMessageAudit: boolean
  allowDirectMessageAttachments: boolean
  allowDirectMessageDeletion: boolean
  allowDirectMessageDelivery: boolean
  allowDirectMessageEditing: boolean
  allowEmbedMessages: boolean
  allowForumPosts: boolean
  allowForumTagAudit: boolean
  allowForumTagChanges: boolean
  allowGateway: boolean
  allowGuildExpressionAudit: boolean
  allowGuildExpressionChanges: boolean
  allowGuildIncidentAudit: boolean
  allowGuildIncidentChanges: boolean
  allowGuildProfileAudit: boolean
  allowGuildProfileChanges: boolean
  allowGuildPruneAudit: boolean
  allowGuildPrunes: boolean
  allowGuildScaffolds: boolean
  allowGuildSettingsAudit: boolean
  allowGuildSettingsChanges: boolean
  allowGuildTemplateAudit: boolean
  allowGuildTemplateChanges: boolean
  allowIntegrationAudit: boolean
  allowIntegrationDeletions: boolean
  allowInteractions: boolean
  allowInviteAudit: boolean
  allowInviteCreation: boolean
  allowInviteRoleAssignment: boolean
  allowInviteDeletions: boolean
  allowMemberDirectory: boolean
  allowNicknameChanges: boolean
  allowOtherMemberNicknameChanges: boolean
  allowMemberRoleChanges: boolean
  allowMemberVoiceAudit: boolean
  allowMemberVoiceChanges: boolean
  allowCrossGuildMessageForwarding: boolean
  allowMessageForwarding: boolean
  allowNativeCommandChanges: boolean
  allowNativeInteractions: boolean
  allowOnboardingAudit: boolean
  allowOnboardingChanges: boolean
  allowPermissionOverwrites: boolean
  allowPinManagement: boolean
  allowPollAudit: boolean
  allowPollCreation: boolean
  allowPollEnding: boolean
  allowPollVoterAudit: boolean
  allowReactionModeration: boolean
  allowReactionUserAudit: boolean
  allowRoleCreation: boolean
  allowRoleConfiguration: boolean
  allowRoleDeletionAudit: boolean
  allowRoleDeletions: boolean
  allowRoleOrderingAudit: boolean
  allowRoleOrderingChanges: boolean
  allowScheduledEventAudit: boolean
  allowScheduledEventChanges: boolean
  allowScheduledEventUserAudit: boolean
  allowSoundboardAudit: boolean
  allowSoundboardChanges: boolean
  allowStageInstanceAudit: boolean
  allowStageInstanceChanges: boolean
  allowStageStartNotifications: boolean
  allowThreadCreation: boolean
  allowThreadAudit: boolean
  allowThreadChanges: boolean
  allowWelcomeScreenAudit: boolean
  allowWelcomeScreenChanges: boolean
  allowWebhookAudit: boolean
  allowWebhookChanges: boolean
  allowWebhookCreation: boolean
  allowWebhookDeletions: boolean
  allowWebhookMessageAudit: boolean
  allowWebhookMessageChanges: boolean
  allowWebhookMessageDeletions: boolean
  allowWebhookMessageDelivery: boolean
  allowWidgetPublicExposure: boolean
  allowWidgetSettingsAudit: boolean
  allowWidgetSettingsChanges: boolean
  applicationEmojiRoots: readonly string[]
  applicationCommandGuildIds: ReadonlySet<string>
  auditFile: string
  attachmentChannelIds: ReadonlySet<string>
  attachmentMaxBytes: number
  attachmentRoots: readonly string[]
  automodAlertChannelIds: ReadonlySet<string>
  automodGuildIds: ReadonlySet<string>
  banAuditGuildIds: ReadonlySet<string>
  bulkBanGuildIds: ReadonlySet<string>
  channelCloneGuildIds: ReadonlySet<string>
  channelCloneSourceIds: ReadonlySet<string>
  channelCreationGuildIds: ReadonlySet<string>
  channelDeletionIds: ReadonlySet<string>
  channelMetadataIds: ReadonlySet<string>
  channelOrderingGuildIds: ReadonlySet<string>
  deleteChannelIds: ReadonlySet<string>
  directMessageUserIds: ReadonlySet<string>
  embedMessageChannelIds: ReadonlySet<string>
  expectedApplicationId: string | undefined
  expectedBotId: string | undefined
  forumPostChannelIds: ReadonlySet<string>
  forumTagChannelIds: ReadonlySet<string>
  gatewayEventBufferSize: number
  guildScaffoldGuildIds: ReadonlySet<string>
  guildExpressionGuildIds: ReadonlySet<string>
  guildExpressionRoots: readonly string[]
  guildIncidentGuildIds: ReadonlySet<string>
  guildProfileGuildIds: ReadonlySet<string>
  guildPruneGuildIds: ReadonlySet<string>
  guildPruneIncludeRoleIds: ReadonlySet<string>
  guildPruneMaxMembers: number
  guildSettingsGuildIds: ReadonlySet<string>
  guildTemplateGuildIds: ReadonlySet<string>
  integrationGuildIds: ReadonlySet<string>
  integrationIds: ReadonlySet<string>
  interactionChannelIds: ReadonlySet<string>
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  inviteCapabilityRoots: readonly string[]
  mcpReadResponseMaxBytes: number
  inviteCreationChannelIds: ReadonlySet<string>
  inviteRoleIds: ReadonlySet<string>
  inviteGuildIds: ReadonlySet<string>
  mentionUserIds: ReadonlySet<string>
  memberDirectoryGuildIds: ReadonlySet<string>
  nicknameGuildIds: ReadonlySet<string>
  memberRoleGuildIds: ReadonlySet<string>
  memberRoleIds: ReadonlySet<string>
  memberVoiceChannelIds: ReadonlySet<string>
  memberVoiceGuildIds: ReadonlySet<string>
  messageForwardSourceChannelIds: ReadonlySet<string>
  messageForwardTargetChannelIds: ReadonlySet<string>
  nativeCommandName: string
  nativeInteractionChannelIds: ReadonlySet<string>
  nativeInteractionGuildIds: ReadonlySet<string>
  nativeInteractionMaxPending: number
  nativeInteractionTtlSeconds: number
  nativeInteractionUserIds: ReadonlySet<string>
  mcpToolsets: ReadonlySet<McpToolsetName>
  mcpToolSurface: McpToolSurface
  observability: ObservabilityConfig
  onboardingGuildIds: ReadonlySet<string>
  permissionOverwriteChannelIds: ReadonlySet<string>
  protectedUserIds: ReadonlySet<string>
  pinChannelIds: ReadonlySet<string>
  pollChannelIds: ReadonlySet<string>
  reactionChannelIds: ReadonlySet<string>
  roleCreationGuildIds: ReadonlySet<string>
  roleConfigurationIds: ReadonlySet<string>
  roleDeletionIds: ReadonlySet<string>
  roleOrderingGuildIds: ReadonlySet<string>
  scheduledEventGuildIds: ReadonlySet<string>
  scheduledEventRoots: readonly string[]
  secretEnvironmentVariables: ReadonlySet<string>
  soundboardGuildIds: ReadonlySet<string>
  soundboardRoots: readonly string[]
  stageChannelIds: ReadonlySet<string>
  token: string
  threadParentIds: ReadonlySet<string>
  threadGuildIds: ReadonlySet<string>
  threadIds: ReadonlySet<string>
  threadMemberUserIds: ReadonlySet<string>
  welcomeScreenGuildIds: ReadonlySet<string>
  webhookChannelIds: ReadonlySet<string>
  webhookCredentialRoot: string | null
  webhookGuildIds: ReadonlySet<string>
  webhookMessageChannelIds: ReadonlySet<string>
  widgetSettingsGuildIds: ReadonlySet<string>
}

export interface ConfigOptions {
  homeDirectory?: string
}

function configPolicyPath(name: string): string {
  if (name === "allowedChannelIds") return "$.readScope.channelIds"
  if (name === "allowedGuildIds") return "$.readScope.guildIds"
  if (name === "applicationId") return "$.identity.applicationId"
  if (name === "botId") return "$.identity.botId"
  if (name === "allowGateway") return "$.gateway.enabled"
  if (name === "nativeCommandName") return "$.runtime.nativeCommandName"
  if (name.startsWith("allow")) {
    return `$.capabilities.${name.slice(5, 6).toLowerCase()}${name.slice(6)}`
  }
  return `$.scopes.${name}`
}

function assertNoAmbientPolicyEnvironment(
  document: ConnectorConfigDocument,
  environment: NodeJS.ProcessEnv,
): void {
  const permitted = new Set([
    CONFIG_FILE_ENVIRONMENT_VARIABLE,
    ...connectorConfigSecretEnvironmentNames(document),
  ])
  const conflicts = Object.keys(environment)
    .filter((name) => (
      !permitted.has(name)
      && (
        name.startsWith("DISCORD_MCP_")
        || name.startsWith("OTEL_")
        || DISCORD_TOKEN_ENVIRONMENT_PATTERN.test(name)
      )
      && environment[name]?.trim()
    ))
    .sort()
  if (conflicts.length > 0) {
    throw new ConfigurationError(
      `Selected configuration conflicts with undeclared environment variables: ${conflicts.join(", ")}`,
    )
  }
}

function configScope(
  document: ConnectorConfigDocument,
  name: ConnectorConfigScopeName,
  maximum?: number,
): ReadonlySet<string> {
  const result = new Set(document.scopes[name] ?? [])
  if (maximum !== undefined && result.size > maximum) {
    throw new ConfigurationError(
      `$.scopes.${name} must contain at most ${maximum} unique IDs`,
    )
  }
  return result
}

function configCapability(
  document: ConnectorConfigDocument,
  name: ConnectorConfigCapabilityName,
): boolean {
  return document.capabilities[name] ?? false
}

function configLimit(
  document: ConnectorConfigDocument,
  name: ConnectorConfigLimitName,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const result = document.limits[name] ?? defaultValue
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new ConfigurationError(
      `$.limits.${name} must be an integer between ${minimum} and ${maximum}`,
    )
  }
  return result
}

function parseOwnedRoots(
  value: readonly string[] | undefined,
  name: string,
  requirePrivate = false,
  requireExclusive = false,
): readonly string[] {
  if (!value || value.length === 0) return []
  if (typeof process.getuid !== "function") {
    throw new ConfigurationError(
      `${name} requires numeric process ownership evidence on this runtime`,
    )
  }
  const processUserId = process.getuid()
  const roots = value.map((entry) => {
    const candidate = entry
    if (
      candidate.trim() !== candidate
      || !isAbsolute(candidate)
      || /[\u0000-\u001F\u007F]/u.test(candidate)
      || resolve(candidate) !== candidate
    ) {
      throw new ConfigurationError(`${name} entries must be absolute directory paths`)
    }
    let root: string
    let metadata
    try {
      metadata = lstatSync(candidate)
      root = realpathSync.native(candidate)
    } catch (error) {
      throw new ConfigurationError(`${name} entries must be existing directories`, {
        cause: error,
      })
    }
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || root !== candidate
      || root === parse(root).root
      || metadata.uid !== processUserId
      || (requireExclusive && (metadata.mode & 0o777) !== 0o700)
      || (requirePrivate && (metadata.mode & 0o022) !== 0)
    ) {
      throw new ConfigurationError(
        requireExclusive
          ? `${name} entries must be owned, canonical 0700 directories below the filesystem root`
          : requirePrivate
            ? `${name} entries must be owned, canonical directories below the filesystem root and not group or world writable`
          : `${name} entries must be owned, canonical directories below the filesystem root`,
      )
    }
    return root
  })
  const unique = [...new Set(roots)].sort()
  if (unique.length !== roots.length) {
    throw new ConfigurationError(`${name} must not contain duplicate directories`)
  }
  return unique
}

function parseOwnedRoot(
  value: string | undefined,
  name: string,
  requirePrivate = false,
  requireExclusive = false,
): string | null {
  return parseOwnedRoots(
    value === undefined ? undefined : [value],
    name,
    requirePrivate,
    requireExclusive,
  )[0] ?? null
}

function defaultAuditFile(environment: NodeJS.ProcessEnv, homeDirectory: string): string {
  const stateRoot = environment.XDG_STATE_HOME?.trim()
  const root = stateRoot && isAbsolute(stateRoot)
    ? stateRoot
    : join(homeDirectory, ".local", "state")
  return join(root, "discord-mcp", "activity.jsonl")
}

function auditFile(value: string | undefined, environment: NodeJS.ProcessEnv, homeDirectory: string): string {
  const selected = value?.trim() || defaultAuditFile(environment, homeDirectory)
  return resolve(selected)
}

export function resolveConnectorConfigDocumentAuditFile(
  documentValue: ConnectorConfigDocument,
  environment: NodeJS.ProcessEnv = process.env,
  options: ConfigOptions = {},
): string {
  const document = parseConnectorConfigDocument(documentValue)
  const configured = document.storage.auditFile
  return auditFile(
    typeof configured === "string" ? configured : undefined,
    environment,
    options.homeDirectory || homedir(),
  )
}

export function loadConnectorConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: ConfigOptions = {},
): ConnectorConfig {
  const file = environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
  if (!file) {
    throw new ConfigurationError(
      `${CONFIG_FILE_ENVIRONMENT_VARIABLE} is required to select a configuration document`,
    )
  }
  return loadConnectorConfigDocument(
    loadConnectorConfigDocumentFile(file),
    environment,
    options,
  )
}

export function loadConnectorConfigDocument(
  documentValue: ConnectorConfigDocument,
  environment: NodeJS.ProcessEnv,
  options: ConfigOptions = {},
): ConnectorConfig {
  const document = parseConnectorConfigDocument(documentValue)
  assertNoAmbientPolicyEnvironment(document, environment)

  const allowedChannelIds = new Set(document.readScope.channelIds)
  const allowedGuildIds = new Set(document.readScope.guildIds)
  const automodGuildIds = configScope(document, "automodGuildIds")
  const applicationCommandGuildIds = configScope(
    document,
    "applicationCommandGuildIds",
    CONNECTOR_LIMITS.applicationCommandGuildAllowlist,
  )
  const banAuditGuildIds = configScope(document, "banAuditGuildIds")
  const bulkBanGuildIds = configScope(document, "bulkBanGuildIds")
  const guildPruneGuildIds = configScope(document, "guildPruneGuildIds")
  const guildPruneIncludeRoleIds = configScope(
    document,
    "guildPruneIncludeRoleIds",
    CONNECTOR_LIMITS.guildPruneRoleAllowlist,
  )
  const adminGuildIds = configScope(document, "adminGuildIds")
  const channelCreationGuildIds = configScope(document, "channelCreationGuildIds")
  const channelCloneGuildIds = configScope(
    document,
    "channelCloneGuildIds",
    CONNECTOR_LIMITS.channelCloneGuildAllowlist,
  )
  const channelCloneSourceIds = configScope(
    document,
    "channelCloneSourceIds",
    CONNECTOR_LIMITS.channelCloneSourceAllowlist,
  )
  const channelMetadataIds = configScope(document, "channelMetadataIds")
  const channelDeletionIds = configScope(document, "channelDeletionIds", CONNECTOR_LIMITS.channelDeletionAllowlist)
  const channelOrderingGuildIds = configScope(
    document,
    "channelOrderingGuildIds",
    CONNECTOR_LIMITS.channelOrderingGuildAllowlist,
  )
  const attachmentChannelIds = configScope(document, "attachmentChannelIds")
  const announcementCrosspostChannelIds = configScope(document, "announcementCrosspostChannelIds")
  const messageForwardSourceChannelIds = configScope(
    document,
    "messageForwardSourceChannelIds",
    CONNECTOR_LIMITS.messageForwardChannelAllowlist,
  )
  const messageForwardTargetChannelIds = configScope(
    document,
    "messageForwardTargetChannelIds",
    CONNECTOR_LIMITS.messageForwardChannelAllowlist,
  )
  const announcementSubscriptionSourceChannelIds = configScope(document, "announcementSubscriptionSourceChannelIds")
  const announcementSubscriptionTargetChannelIds = configScope(document, "announcementSubscriptionTargetChannelIds")
  const automodAlertChannelIds = configScope(document, "automodAlertChannelIds")
  const deleteChannelIds = configScope(document, "deleteChannelIds")
  const directMessageUserIds = configScope(
    document,
    "directMessageUserIds",
    CONNECTOR_LIMITS.directMessageUserAllowlist,
  )
  const embedMessageChannelIds = configScope(document, "embedMessageChannelIds")
  const interactionChannelIds = configScope(document, "interactionChannelIds")
  const inviteCreationChannelIds = configScope(document, "inviteCreationChannelIds")
  const inviteRoleIds = configScope(document, "inviteRoleIds")
  const pinChannelIds = configScope(document, "pinChannelIds")
  const permissionOverwriteChannelIds = configScope(document, "permissionOverwriteChannelIds")
  const pollChannelIds = configScope(document, "pollChannelIds")
  const reactionChannelIds = configScope(document, "reactionChannelIds", CONNECTOR_LIMITS.reactionChannelAllowlist)
  const forumPostChannelIds = configScope(document, "forumPostChannelIds")
  const forumTagChannelIds = configScope(document, "forumTagChannelIds")
  const threadParentIds = configScope(document, "threadParentIds")
  const threadGuildIds = configScope(document, "threadGuildIds", CONNECTOR_LIMITS.threadGovernanceGuildAllowlist)
  const threadIds = configScope(document, "threadIds", CONNECTOR_LIMITS.threadGovernanceThreadAllowlist)
  const threadMemberUserIds = configScope(
    document,
    "threadMemberUserIds",
    CONNECTOR_LIMITS.threadGovernanceUserAllowlist,
  )
  const stageChannelIds = configScope(document, "stageChannelIds", CONNECTOR_LIMITS.stageInstanceChannels)
  const mentionUserIds = configScope(document, "mentionUserIds", CONNECTOR_LIMITS.mentionUserAllowlist)
  const memberDirectoryGuildIds = configScope(document, "memberDirectoryGuildIds")
  const nicknameGuildIds = configScope(document, "nicknameGuildIds", CONNECTOR_LIMITS.memberNicknameGuildAllowlist)
  const memberRoleGuildIds = configScope(document, "memberRoleGuildIds")
  const memberRoleIds = configScope(document, "memberRoleIds", CONNECTOR_LIMITS.memberRoleAllowlist)
  const memberVoiceChannelIds = configScope(
    document,
    "memberVoiceChannelIds",
    CONNECTOR_LIMITS.memberVoiceChannelAllowlist,
  )
  const memberVoiceGuildIds = configScope(document, "memberVoiceGuildIds", CONNECTOR_LIMITS.memberVoiceGuildAllowlist)
  const nativeInteractionGuildIds = configScope(
    document,
    "nativeInteractionGuildIds",
    CONNECTOR_LIMITS.nativeInteractionGuildAllowlist,
  )
  const nativeInteractionChannelIds = configScope(
    document,
    "nativeInteractionChannelIds",
    CONNECTOR_LIMITS.nativeInteractionChannelAllowlist,
  )
  const nativeInteractionUserIds = configScope(
    document,
    "nativeInteractionUserIds",
    CONNECTOR_LIMITS.nativeInteractionUserAllowlist,
  )
  const protectedUserIds = configScope(document, "protectedUserIds", CONNECTOR_LIMITS.protectedUserAllowlist)
  const roleCreationGuildIds = configScope(document, "roleCreationGuildIds")
  const roleConfigurationIds = configScope(
    document,
    "roleConfigurationIds",
    CONNECTOR_LIMITS.roleConfigurationAllowlist,
  )
  const roleDeletionIds = configScope(document, "roleDeletionIds", CONNECTOR_LIMITS.roleDeletionAllowlist)
  const roleOrderingGuildIds = configScope(
    document,
    "roleOrderingGuildIds",
    CONNECTOR_LIMITS.roleOrderingGuildAllowlist,
  )
  const guildScaffoldGuildIds = configScope(document, "guildScaffoldGuildIds")
  const guildExpressionGuildIds = configScope(document, "guildExpressionGuildIds")
  const guildIncidentGuildIds = configScope(
    document,
    "guildIncidentGuildIds",
    CONNECTOR_LIMITS.guildIncidentGuildAllowlist,
  )
  const guildSettingsGuildIds = configScope(
    document,
    "guildSettingsGuildIds",
    CONNECTOR_LIMITS.guildSettingsGuildAllowlist,
  )
  const guildProfileGuildIds = configScope(
    document,
    "guildProfileGuildIds",
    CONNECTOR_LIMITS.guildProfileGuildAllowlist,
  )
  const guildTemplateGuildIds = configScope(document, "guildTemplateGuildIds")
  const integrationGuildIds = configScope(document, "integrationGuildIds", CONNECTOR_LIMITS.integrationGuildAllowlist)
  const integrationIds = configScope(document, "integrationIds", CONNECTOR_LIMITS.integrationIdAllowlist)
  const scheduledEventGuildIds = configScope(document, "scheduledEventGuildIds")
  const soundboardGuildIds = configScope(document, "soundboardGuildIds", CONNECTOR_LIMITS.soundboardGuildAllowlist)
  const welcomeScreenGuildIds = configScope(
    document,
    "welcomeScreenGuildIds",
    CONNECTOR_LIMITS.welcomeScreenGuildAllowlist,
  )
  const widgetSettingsGuildIds = configScope(
    document,
    "widgetSettingsGuildIds",
    CONNECTOR_LIMITS.widgetSettingsGuildAllowlist,
  )
  const webhookChannelIds = configScope(document, "webhookChannelIds")
  const webhookGuildIds = configScope(document, "webhookGuildIds")
  const webhookMessageChannelIds = configScope(document, "webhookMessageChannelIds")
  const inviteGuildIds = configScope(document, "inviteGuildIds")
  const onboardingGuildIds = configScope(document, "onboardingGuildIds")

  for (const [name, guildIds] of [
    [configPolicyPath("adminGuildIds"), adminGuildIds],
    [configPolicyPath("applicationCommandGuildIds"), applicationCommandGuildIds],
    [configPolicyPath("automodGuildIds"), automodGuildIds],
    [configPolicyPath("banAuditGuildIds"), banAuditGuildIds],
    [configPolicyPath("bulkBanGuildIds"), bulkBanGuildIds],
    [configPolicyPath("guildPruneGuildIds"), guildPruneGuildIds],
    [configPolicyPath("channelCreationGuildIds"), channelCreationGuildIds],
    [configPolicyPath("channelCloneGuildIds"), channelCloneGuildIds],
    [configPolicyPath("channelOrderingGuildIds"), channelOrderingGuildIds],
    [configPolicyPath("guildScaffoldGuildIds"), guildScaffoldGuildIds],
    [configPolicyPath("guildExpressionGuildIds"), guildExpressionGuildIds],
    [configPolicyPath("guildIncidentGuildIds"), guildIncidentGuildIds],
    [configPolicyPath("guildProfileGuildIds"), guildProfileGuildIds],
    [configPolicyPath("guildSettingsGuildIds"), guildSettingsGuildIds],
    [configPolicyPath("guildTemplateGuildIds"), guildTemplateGuildIds],
    [configPolicyPath("integrationGuildIds"), integrationGuildIds],
    [configPolicyPath("inviteGuildIds"), inviteGuildIds],
    [configPolicyPath("onboardingGuildIds"), onboardingGuildIds],
    [configPolicyPath("memberDirectoryGuildIds"), memberDirectoryGuildIds],
    [configPolicyPath("nicknameGuildIds"), nicknameGuildIds],
    [configPolicyPath("memberRoleGuildIds"), memberRoleGuildIds],
    [configPolicyPath("memberVoiceGuildIds"), memberVoiceGuildIds],
    [configPolicyPath("nativeInteractionGuildIds"), nativeInteractionGuildIds],
    [configPolicyPath("threadGuildIds"), threadGuildIds],
    [configPolicyPath("roleCreationGuildIds"), roleCreationGuildIds],
    [configPolicyPath("roleOrderingGuildIds"), roleOrderingGuildIds],
    [configPolicyPath("scheduledEventGuildIds"), scheduledEventGuildIds],
    [configPolicyPath("soundboardGuildIds"), soundboardGuildIds],
    [configPolicyPath("welcomeScreenGuildIds"), welcomeScreenGuildIds],
    [configPolicyPath("widgetSettingsGuildIds"), widgetSettingsGuildIds],
    [configPolicyPath("webhookGuildIds"), webhookGuildIds],
  ] as const) {
    for (const guildId of guildIds) {
      if (allowedGuildIds.has(guildId)) continue
      throw new ConfigurationError(
        `${name} must be a subset of ${configPolicyPath("allowedGuildIds")}`,
      )
    }
  }

  for (const [name, channelIds] of [
    [configPolicyPath("announcementCrosspostChannelIds"), announcementCrosspostChannelIds],
    [configPolicyPath("attachmentChannelIds"), attachmentChannelIds],
    [configPolicyPath("automodAlertChannelIds"), automodAlertChannelIds],
    [configPolicyPath("channelMetadataIds"), channelMetadataIds],
    [configPolicyPath("channelDeletionIds"), channelDeletionIds],
    [configPolicyPath("channelCloneSourceIds"), channelCloneSourceIds],
    [configPolicyPath("deleteChannelIds"), deleteChannelIds],
    [configPolicyPath("embedMessageChannelIds"), embedMessageChannelIds],
    [configPolicyPath("forumPostChannelIds"), forumPostChannelIds],
    [configPolicyPath("forumTagChannelIds"), forumTagChannelIds],
    [configPolicyPath("interactionChannelIds"), interactionChannelIds],
    [configPolicyPath("inviteCreationChannelIds"), inviteCreationChannelIds],
    [configPolicyPath("messageForwardSourceChannelIds"), messageForwardSourceChannelIds],
    [configPolicyPath("messageForwardTargetChannelIds"), messageForwardTargetChannelIds],
    [configPolicyPath("memberVoiceChannelIds"), memberVoiceChannelIds],
    [configPolicyPath("nativeInteractionChannelIds"), nativeInteractionChannelIds],
    [configPolicyPath("permissionOverwriteChannelIds"), permissionOverwriteChannelIds],
    [configPolicyPath("pinChannelIds"), pinChannelIds],
    [configPolicyPath("pollChannelIds"), pollChannelIds],
    [configPolicyPath("reactionChannelIds"), reactionChannelIds],
    [
      configPolicyPath("announcementSubscriptionSourceChannelIds"),
      announcementSubscriptionSourceChannelIds,
    ],
    [
      configPolicyPath("announcementSubscriptionTargetChannelIds"),
      announcementSubscriptionTargetChannelIds,
    ],
    [configPolicyPath("stageChannelIds"), stageChannelIds],
    [configPolicyPath("threadParentIds"), threadParentIds],
    [configPolicyPath("threadIds"), threadIds],
    [configPolicyPath("webhookChannelIds"), webhookChannelIds],
    [configPolicyPath("webhookMessageChannelIds"), webhookMessageChannelIds],
  ] as const) {
    for (const channelId of channelIds) {
      if (allowedChannelIds.size === 0 || allowedChannelIds.has(channelId)) continue
      throw new ConfigurationError(
        `${name} must be a subset of ${configPolicyPath("allowedChannelIds")}`,
      )
    }
  }

  const expectedApplicationId = document.identity.applicationId
  const expectedBotId = document.identity.botId
  const allowApplicationCommandChanges = configCapability(
    document,
    "applicationCommandChanges",
  )
  if (allowApplicationCommandChanges && applicationCommandGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowApplicationCommandChanges")} requires ${configPolicyPath("applicationCommandGuildIds")}`,
    )
  }
  const allowDirectMessageAudit = configCapability(document, "directMessageAudit")
  const allowDirectMessageAttachments = configCapability(
    document,
    "directMessageAttachments",
  )
  const allowDirectMessageDeletion = configCapability(document, "directMessageDeletion")
  const allowDirectMessageDelivery = configCapability(document, "directMessageDelivery")
  const allowDirectMessageEditing = configCapability(document, "directMessageEditing")
  if (
    (
      allowDirectMessageAudit
      || allowDirectMessageAttachments
      || allowDirectMessageDeletion
      || allowDirectMessageDelivery
      || allowDirectMessageEditing
    )
    && directMessageUserIds.size === 0
  ) {
    throw new ConfigurationError(
      "Direct-message capabilities require an exact direct-message user allowlist",
    )
  }
  if (allowDirectMessageAttachments && !allowDirectMessageDelivery) {
    throw new ConfigurationError(
      `${configPolicyPath("allowDirectMessageAttachments")} requires ${configPolicyPath("allowDirectMessageDelivery")}`,
    )
  }
  const allowEmbedMessages = configCapability(document, "embedMessages")
  if (allowEmbedMessages && embedMessageChannelIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowEmbedMessages")} requires ${configPolicyPath("embedMessageChannelIds")}`,
    )
  }
  if (
    allowDirectMessageAttachments
    && (document.storage.attachmentRoots?.length ?? 0) === 0
  ) {
    throw new ConfigurationError(
      `${configPolicyPath("allowDirectMessageAttachments")} requires $.storage.attachmentRoots`,
    )
  }
  const allowMessageForwarding = configCapability(document, "messageForwarding")
  const allowCrossGuildMessageForwarding = configCapability(document, "crossGuildMessageForwarding")
  if (allowCrossGuildMessageForwarding && !allowMessageForwarding) {
    throw new ConfigurationError(
      `${configPolicyPath("allowCrossGuildMessageForwarding")} requires ${configPolicyPath("allowMessageForwarding")}`,
    )
  }
  const allowBulkBanAudit = configCapability(document, "bulkBanAudit")
  const allowBulkBans = configCapability(document, "bulkBans")
  if (allowBulkBans && !allowBulkBanAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowBulkBans")} requires ${configPolicyPath("allowBulkBanAudit")}`,
    )
  }
  if (allowBulkBanAudit && bulkBanGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowBulkBanAudit")} requires ${configPolicyPath("bulkBanGuildIds")}`,
    )
  }
  const allowGuildPruneAudit = configCapability(document, "guildPruneAudit")
  const allowGuildPrunes = configCapability(document, "guildPrunes")
  if (allowGuildPrunes && !allowGuildPruneAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildPrunes")} requires ${configPolicyPath("allowGuildPruneAudit")}`,
    )
  }
  if (allowGuildPruneAudit && guildPruneGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildPruneAudit")} requires ${configPolicyPath("guildPruneGuildIds")}`,
    )
  }
  if (
    allowMessageForwarding
    && (
      messageForwardSourceChannelIds.size === 0
      || messageForwardTargetChannelIds.size === 0
    )
  ) {
    throw new ConfigurationError(
      `${configPolicyPath("allowMessageForwarding")} requires exact source and target channel allowlists`,
    )
  }
  const allowReactionModeration = configCapability(document, "reactionModeration")
  const allowReactionUserAudit = configCapability(document, "reactionUserAudit")
  if ((allowReactionModeration || allowReactionUserAudit) && reactionChannelIds.size === 0) {
    throw new ConfigurationError(
      "Reaction audit and moderation require an exact reaction-channel allowlist",
    )
  }
  const allowGateway = document.gateway.enabled
  const allowChannelCloneAudit = configCapability(document, "channelCloneAudit")
  const allowChannelCloning = configCapability(document, "channelCloning")
  if (allowChannelCloning && !allowChannelCloneAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelCloning")} requires ${configPolicyPath("allowChannelCloneAudit")}`,
    )
  }
  if (
    allowChannelCloneAudit
    && (channelCloneGuildIds.size === 0 || channelCloneSourceIds.size === 0)
  ) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelCloneAudit")} requires `
      + `${configPolicyPath("channelCloneGuildIds")} and `
      + configPolicyPath("channelCloneSourceIds"),
    )
  }
  const allowChannelOrderingAudit = configCapability(document, "channelOrderingAudit")
  const allowChannelOrderingChanges = configCapability(document, "channelOrderingChanges")
  if (allowChannelOrderingChanges && !allowChannelOrderingAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelOrderingChanges")} requires ${configPolicyPath("allowChannelOrderingAudit")}`,
    )
  }
  if (allowChannelOrderingAudit && channelOrderingGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelOrderingAudit")} requires ${configPolicyPath("channelOrderingGuildIds")}`,
    )
  }
  const allowChannelDeletionAudit = configCapability(document, "channelDeletionAudit")
  const allowChannelDeletions = configCapability(document, "channelDeletions")
  if (allowChannelDeletions && !allowChannelDeletionAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelDeletions")} requires ${configPolicyPath("allowChannelDeletionAudit")}`,
    )
  }
  if (allowChannelDeletionAudit && channelDeletionIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelDeletionAudit")} requires ${configPolicyPath("channelDeletionIds")}`,
    )
  }
  if (allowChannelDeletionAudit && !allowGateway) {
    throw new ConfigurationError(
      `${configPolicyPath("allowChannelDeletionAudit")} requires ${configPolicyPath("allowGateway")}`,
    )
  }
  const allowNativeCommandChanges = configCapability(document, "nativeCommandChanges")
  const allowNativeInteractions = configCapability(document, "nativeInteractions")
  if (
    allowNativeCommandChanges
    && nativeInteractionGuildIds.size === 0
  ) {
    throw new ConfigurationError(
      `${configPolicyPath("allowNativeCommandChanges")} requires ${configPolicyPath("nativeInteractionGuildIds")}`,
    )
  }
  if (allowNativeInteractions && (
    nativeInteractionGuildIds.size === 0
    || nativeInteractionChannelIds.size === 0
    || nativeInteractionUserIds.size === 0
  )) {
    throw new ConfigurationError(
      `${configPolicyPath("allowNativeInteractions")} requires exact native Interaction `
      + "guild, channel, and user allowlists",
    )
  }
  const nativeCommandName = document.runtime.nativeCommandName?.trim()
    || NATIVE_INTERACTION_DEFAULTS.commandName
  if (!NATIVE_INTERACTION_COMMAND_NAME_PATTERN.test(nativeCommandName)) {
    throw new ConfigurationError(
      `${configPolicyPath("nativeCommandName")} must be `
      + `1-${NATIVE_INTERACTION_LIMITS.commandNameCharacters} lowercase ASCII letters, `
      + "digits, hyphens, or underscores",
    )
  }
  const allowAutomodAudit = configCapability(document, "automodAudit")
  const allowAutomodChanges = configCapability(document, "automodChanges")
  if (allowAutomodChanges && !allowAutomodAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowAutomodChanges")} requires ${configPolicyPath("allowAutomodAudit")}`,
    )
  }
  const allowWebhookAudit = configCapability(document, "webhookAudit")
  const allowWebhookChanges = configCapability(document, "webhookChanges")
  const allowWebhookCreation = configCapability(document, "webhookCreation")
  const allowWebhookDeletions = configCapability(document, "webhookDeletions")
  if (
    (allowWebhookChanges || allowWebhookCreation || allowWebhookDeletions)
    && !allowWebhookAudit
  ) {
    throw new ConfigurationError(
      `Enabling webhook creation, changes, or deletion requires ${configPolicyPath("allowWebhookAudit")}`,
    )
  }
  const allowWebhookMessageAudit = configCapability(document, "webhookMessageAudit")
  const allowWebhookMessageChanges = configCapability(document, "webhookMessageChanges")
  const allowWebhookMessageDeletions = configCapability(document, "webhookMessageDeletions")
  const allowWebhookMessageDelivery = configCapability(document, "webhookMessageDelivery")
  if (
    (allowWebhookMessageChanges || allowWebhookMessageDeletions)
    && !allowWebhookMessageAudit
  ) {
    throw new ConfigurationError(
      `Webhook message changes and deletion require ${configPolicyPath("allowWebhookMessageAudit")}`,
    )
  }
  const webhookCredentialRoot = parseOwnedRoot(
    document.storage.webhookCredentialRoot,
    "$.storage.webhookCredentialRoot",
    true,
    true,
  )
  if (
    (
      allowWebhookCreation
      || allowWebhookMessageAudit
      || allowWebhookMessageChanges
      || allowWebhookMessageDeletions
      || allowWebhookMessageDelivery
    )
    && webhookCredentialRoot === null
  ) {
    throw new ConfigurationError(
      "Webhook creation and webhook message capabilities require $.storage.webhookCredentialRoot",
    )
  }
  const allowAnnouncementSubscriptionAudit = configCapability(document, "announcementSubscriptionAudit")
  const allowAnnouncementSubscriptionChanges = configCapability(document, "announcementSubscriptionChanges")
  if (allowAnnouncementSubscriptionChanges && !allowAnnouncementSubscriptionAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowAnnouncementSubscriptionChanges")} requires `
      + configPolicyPath("allowAnnouncementSubscriptionAudit"),
    )
  }
  const allowRoleOrderingAudit = configCapability(document, "roleOrderingAudit")
  const allowRoleOrderingChanges = configCapability(document, "roleOrderingChanges")
  if (allowRoleOrderingChanges && !allowRoleOrderingAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowRoleOrderingChanges")} requires ${configPolicyPath("allowRoleOrderingAudit")}`,
    )
  }
  const allowRoleDeletionAudit = configCapability(document, "roleDeletionAudit")
  const allowRoleDeletions = configCapability(document, "roleDeletions")
  if (allowRoleDeletions && !allowRoleDeletionAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowRoleDeletions")} requires ${configPolicyPath("allowRoleDeletionAudit")}`,
    )
  }
  if (allowRoleDeletionAudit && roleDeletionIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowRoleDeletionAudit")} requires ${configPolicyPath("roleDeletionIds")}`,
    )
  }
  if (allowRoleDeletionAudit && !allowGateway) {
    throw new ConfigurationError(
      `${configPolicyPath("allowRoleDeletionAudit")} requires ${configPolicyPath("allowGateway")}`,
    )
  }
  const allowInviteAudit = configCapability(document, "inviteAudit")
  const allowInviteCreation = configCapability(document, "inviteCreation")
  const allowInviteRoleAssignment = configCapability(document, "inviteRoleAssignment")
  const allowInviteDeletions = configCapability(document, "inviteDeletions")
  if (allowInviteDeletions && !allowInviteAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowInviteDeletions")} requires ${configPolicyPath("allowInviteAudit")}`,
    )
  }
  if (allowInviteCreation && inviteCreationChannelIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowInviteCreation")} requires ${configPolicyPath("inviteCreationChannelIds")}`,
    )
  }
  if (allowInviteRoleAssignment && !allowInviteCreation) {
    throw new ConfigurationError(
      `${configPolicyPath("allowInviteRoleAssignment")} requires ${configPolicyPath("allowInviteCreation")}`,
    )
  }
  if (allowInviteRoleAssignment && inviteRoleIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowInviteRoleAssignment")} requires ${configPolicyPath("inviteRoleIds")}`,
    )
  }
  if (allowInviteRoleAssignment && !allowGateway) {
    throw new ConfigurationError(
      `${configPolicyPath("allowInviteRoleAssignment")} requires ${configPolicyPath("allowGateway")}`,
    )
  }
  if (
    allowInviteCreation
    && (document.storage.inviteCapabilityRoots?.length ?? 0) === 0
  ) {
    throw new ConfigurationError(
      `${configPolicyPath("allowInviteCreation")} requires $.storage.inviteCapabilityRoots`,
    )
  }
  const allowOnboardingAudit = configCapability(document, "onboardingAudit")
  const allowOnboardingChanges = configCapability(document, "onboardingChanges")
  if (allowOnboardingChanges && !allowOnboardingAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowOnboardingChanges")} requires ${configPolicyPath("allowOnboardingAudit")}`,
    )
  }
  const allowMemberRoleChanges = configCapability(document, "memberRoleChanges")
  const allowNicknameChanges = configCapability(document, "nicknameChanges")
  const allowOtherMemberNicknameChanges = configCapability(document, "otherMemberNicknameChanges")
  if (allowOtherMemberNicknameChanges && !allowNicknameChanges) {
    throw new ConfigurationError(
      `${configPolicyPath("allowOtherMemberNicknameChanges")} requires ${configPolicyPath("allowNicknameChanges")}`,
    )
  }
  const allowGuildExpressionAudit = configCapability(document, "guildExpressionAudit")
  const allowGuildExpressionChanges = configCapability(document, "guildExpressionChanges")
  if (allowGuildExpressionChanges && !allowGuildExpressionAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildExpressionChanges")} requires ${configPolicyPath("allowGuildExpressionAudit")}`,
    )
  }
  const allowApplicationEmojiAudit = configCapability(document, "applicationEmojiAudit")
  const allowApplicationEmojiChanges = configCapability(document, "applicationEmojiChanges")
  const allowApplicationIntentChanges = configCapability(document, "applicationIntentChanges")
  const allowApplicationRoleConnectionMetadataChanges = configCapability(
    document,
    "applicationRoleConnectionMetadataChanges",
  )
  if (allowApplicationEmojiChanges && !allowApplicationEmojiAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowApplicationEmojiChanges")} requires ${configPolicyPath("allowApplicationEmojiAudit")}`,
    )
  }
  const allowGuildTemplateAudit = configCapability(document, "guildTemplateAudit")
  const allowGuildTemplateChanges = configCapability(document, "guildTemplateChanges")
  if (allowGuildTemplateChanges && !allowGuildTemplateAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildTemplateChanges")} requires ${configPolicyPath("allowGuildTemplateAudit")}`,
    )
  }
  const allowGuildSettingsAudit = configCapability(document, "guildSettingsAudit")
  const allowGuildSettingsChanges = configCapability(document, "guildSettingsChanges")
  if (allowGuildSettingsChanges && !allowGuildSettingsAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildSettingsChanges")} requires ${configPolicyPath("allowGuildSettingsAudit")}`,
    )
  }
  if (allowGuildSettingsAudit && guildSettingsGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildSettingsAudit")} requires ${configPolicyPath("guildSettingsGuildIds")}`,
    )
  }
  const allowGuildIncidentAudit = configCapability(document, "guildIncidentAudit")
  const allowGuildIncidentChanges = configCapability(document, "guildIncidentChanges")
  if (allowGuildIncidentChanges && !allowGuildIncidentAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildIncidentChanges")} requires ${configPolicyPath("allowGuildIncidentAudit")}`,
    )
  }
  if (allowGuildIncidentAudit && guildIncidentGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildIncidentAudit")} requires ${configPolicyPath("guildIncidentGuildIds")}`,
    )
  }
  const allowGuildProfileAudit = configCapability(document, "guildProfileAudit")
  const allowGuildProfileChanges = configCapability(document, "guildProfileChanges")
  if (allowGuildProfileChanges && !allowGuildProfileAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildProfileChanges")} requires ${configPolicyPath("allowGuildProfileAudit")}`,
    )
  }
  if (allowGuildProfileAudit && guildProfileGuildIds.size === 0) {
    throw new ConfigurationError(
      `${configPolicyPath("allowGuildProfileAudit")} requires ${configPolicyPath("guildProfileGuildIds")}`,
    )
  }
  const allowIntegrationAudit = configCapability(document, "integrationAudit")
  const allowIntegrationDeletions = configCapability(document, "integrationDeletions")
  if (allowIntegrationDeletions && !allowIntegrationAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowIntegrationDeletions")} requires ${configPolicyPath("allowIntegrationAudit")}`,
    )
  }
  const allowForumTagAudit = configCapability(document, "forumTagAudit")
  const allowForumTagChanges = configCapability(document, "forumTagChanges")
  if (allowForumTagChanges && !allowForumTagAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowForumTagChanges")} requires ${configPolicyPath("allowForumTagAudit")}`,
    )
  }
  const allowScheduledEventAudit = configCapability(document, "scheduledEventAudit")
  const allowScheduledEventChanges = configCapability(document, "scheduledEventChanges")
  const allowScheduledEventUserAudit = configCapability(document, "scheduledEventUserAudit")
  if (allowScheduledEventChanges && !allowScheduledEventAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowScheduledEventChanges")} requires ${configPolicyPath("allowScheduledEventAudit")}`,
    )
  }
  if (allowScheduledEventUserAudit && !allowScheduledEventAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowScheduledEventUserAudit")} requires ${configPolicyPath("allowScheduledEventAudit")}`,
    )
  }
  const allowSoundboardAudit = configCapability(document, "soundboardAudit")
  const allowSoundboardChanges = configCapability(document, "soundboardChanges")
  if (allowSoundboardChanges && !allowSoundboardAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowSoundboardChanges")} requires ${configPolicyPath("allowSoundboardAudit")}`,
    )
  }
  const allowWelcomeScreenAudit = configCapability(document, "welcomeScreenAudit")
  const allowWelcomeScreenChanges = configCapability(document, "welcomeScreenChanges")
  if (allowWelcomeScreenChanges && !allowWelcomeScreenAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowWelcomeScreenChanges")} requires ${configPolicyPath("allowWelcomeScreenAudit")}`,
    )
  }
  const allowWidgetSettingsAudit = configCapability(document, "widgetSettingsAudit")
  const allowWidgetSettingsChanges = configCapability(document, "widgetSettingsChanges")
  if (allowWidgetSettingsChanges && !allowWidgetSettingsAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowWidgetSettingsChanges")} requires ${configPolicyPath("allowWidgetSettingsAudit")}`,
    )
  }
  const allowWidgetPublicExposure = configCapability(document, "widgetPublicExposure")
  if (allowWidgetPublicExposure && !allowWidgetSettingsChanges) {
    throw new ConfigurationError(
      `${configPolicyPath("allowWidgetPublicExposure")} requires ${configPolicyPath("allowWidgetSettingsChanges")}`,
    )
  }
  const allowMemberVoiceAudit = configCapability(document, "memberVoiceAudit")
  const allowMemberVoiceChanges = configCapability(document, "memberVoiceChanges")
  if (allowMemberVoiceChanges && !allowMemberVoiceAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowMemberVoiceChanges")} requires ${configPolicyPath("allowMemberVoiceAudit")}`,
    )
  }
  const allowStageInstanceAudit = configCapability(document, "stageInstanceAudit")
  const allowStageInstanceChanges = configCapability(document, "stageInstanceChanges")
  if (allowStageInstanceChanges && !allowStageInstanceAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowStageInstanceChanges")} requires ${configPolicyPath("allowStageInstanceAudit")}`,
    )
  }
  const allowStageStartNotifications = configCapability(document, "stageStartNotifications")
  if (allowStageStartNotifications && !allowStageInstanceChanges) {
    throw new ConfigurationError(
      `${configPolicyPath("allowStageStartNotifications")} requires ${configPolicyPath("allowStageInstanceChanges")}`,
    )
  }
  const allowThreadAudit = configCapability(document, "threadAudit")
  const allowThreadChanges = configCapability(document, "threadChanges")
  if (allowThreadChanges && !allowThreadAudit) {
    throw new ConfigurationError(
      `${configPolicyPath("allowThreadChanges")} requires ${configPolicyPath("allowThreadAudit")}`,
    )
  }
  const allowPollAudit = configCapability(document, "pollAudit")
  const allowPollCreation = configCapability(document, "pollCreation")
  const allowPollEnding = configCapability(document, "pollEnding")
  const allowPollVoterAudit = configCapability(document, "pollVoterAudit")
  if ((allowPollCreation || allowPollEnding || allowPollVoterAudit) && !allowPollAudit) {
    throw new ConfigurationError(
      `Poll creation, ending, and voter audit require ${configPolicyPath("allowPollAudit")}`,
    )
  }
  const token = resolveConnectorCredential(document.credential, environment)

  return {
    adminGuildIds,
    allowApplicationCommandChanges,
    allowApplicationEmojiAudit,
    allowApplicationEmojiChanges,
    allowApplicationIntentChanges,
    allowApplicationRoleConnectionMetadataChanges,
    announcementCrosspostChannelIds,
    announcementSubscriptionSourceChannelIds,
    announcementSubscriptionTargetChannelIds,
    allowedChannelIds,
    allowedGuildIds,
    allowAdministration: configCapability(document, "administration"),
    allowCrossGuildMessageForwarding,
    allowAnnouncementCrossposts: configCapability(document, "announcementCrossposts"),
    allowAnnouncementSubscriptionAudit,
    allowAnnouncementSubscriptionChanges,
    allowAttachments: configCapability(document, "attachments"),
    allowAutomodAudit,
    allowAutomodChanges,
    allowBanAudit: configCapability(document, "banAudit"),
    allowBulkBanAudit,
    allowBulkBans,
    allowChannelCloneAudit,
    allowChannelCloning,
    allowChannelCreation: configCapability(document, "channelCreation"),
    allowChannelDeletionAudit,
    allowChannelDeletions,
    allowChannelMetadataChanges: configCapability(document, "channelMetadataChanges"),
    allowChannelOrderingAudit,
    allowChannelOrderingChanges,
    allowDeletions: configCapability(document, "deletions"),
    allowDirectMessageAudit,
    allowDirectMessageAttachments,
    allowDirectMessageDeletion,
    allowDirectMessageDelivery,
    allowDirectMessageEditing,
    allowEmbedMessages,
    allowGateway,
    allowGuildExpressionAudit,
    allowGuildExpressionChanges,
    allowGuildIncidentAudit,
    allowGuildIncidentChanges,
    allowGuildProfileAudit,
    allowGuildProfileChanges,
    allowGuildPruneAudit,
    allowGuildPrunes,
    allowGuildScaffolds: configCapability(document, "guildScaffolds"),
    allowGuildSettingsAudit,
    allowGuildSettingsChanges,
    allowGuildTemplateAudit,
    allowGuildTemplateChanges,
    allowIntegrationAudit,
    allowIntegrationDeletions,
    allowForumPosts: configCapability(document, "forumPosts"),
    allowForumTagAudit,
    allowForumTagChanges,
    allowInteractions: configCapability(document, "interactions"),
    allowInviteAudit,
    allowInviteCreation,
    allowInviteRoleAssignment,
    allowInviteDeletions,
    allowMemberDirectory: configCapability(document, "memberDirectory"),
    allowNicknameChanges,
    allowOtherMemberNicknameChanges,
    allowMemberRoleChanges,
    allowNativeCommandChanges,
    allowNativeInteractions,
    allowMemberVoiceAudit,
    allowMemberVoiceChanges,
    allowMessageForwarding,
    allowOnboardingAudit,
    allowOnboardingChanges,
    allowPermissionOverwrites: configCapability(document, "permissionOverwrites"),
    allowPinManagement: configCapability(document, "pinManagement"),
    allowPollAudit,
    allowPollCreation,
    allowPollEnding,
    allowPollVoterAudit,
    allowReactionModeration,
    allowReactionUserAudit,
    allowRoleCreation: configCapability(document, "roleCreation"),
    allowRoleConfiguration: configCapability(document, "roleConfiguration"),
    allowRoleDeletionAudit,
    allowRoleDeletions,
    allowRoleOrderingAudit,
    allowRoleOrderingChanges,
    allowScheduledEventAudit,
    allowScheduledEventChanges,
    allowScheduledEventUserAudit,
    allowSoundboardAudit,
    allowSoundboardChanges,
    allowStageInstanceAudit,
    allowStageInstanceChanges,
    allowStageStartNotifications,
    allowThreadCreation: configCapability(document, "threadCreation"),
    allowThreadAudit,
    allowThreadChanges,
    allowWelcomeScreenAudit,
    allowWelcomeScreenChanges,
    allowWebhookAudit,
    allowWebhookChanges,
    allowWebhookCreation,
    allowWebhookDeletions,
    allowWebhookMessageAudit,
    allowWebhookMessageChanges,
    allowWebhookMessageDeletions,
    allowWebhookMessageDelivery,
    allowWidgetPublicExposure,
    allowWidgetSettingsAudit,
    allowWidgetSettingsChanges,
    applicationEmojiRoots: parseOwnedRoots(
      document.storage.applicationEmojiRoots,
      "$.storage.applicationEmojiRoots",
    ),
    applicationCommandGuildIds,
    auditFile: resolveConnectorConfigDocumentAuditFile(document, environment, options),
    attachmentChannelIds,
    attachmentMaxBytes: configLimit(
      document,
      "attachmentMaxBytes",
      DISCORD_LIMITS.attachmentBytes,
      1,
      DISCORD_LIMITS.attachmentBytes,
    ),
    attachmentRoots: parseOwnedRoots(
      document.storage.attachmentRoots,
      "$.storage.attachmentRoots",
    ),
    automodAlertChannelIds,
    automodGuildIds,
    banAuditGuildIds,
    bulkBanGuildIds,
    channelCloneGuildIds,
    channelCloneSourceIds,
    channelCreationGuildIds,
    channelDeletionIds,
    channelMetadataIds,
    channelOrderingGuildIds,
    deleteChannelIds,
    directMessageUserIds,
    embedMessageChannelIds,
    expectedApplicationId,
    expectedBotId,
    forumPostChannelIds,
    forumTagChannelIds,
    gatewayEventBufferSize: document.gateway.eventBufferSize,
    guildScaffoldGuildIds,
    guildExpressionGuildIds,
    guildExpressionRoots: parseOwnedRoots(
      document.storage.guildExpressionRoots,
      "$.storage.guildExpressionRoots",
    ),
    guildIncidentGuildIds,
    guildProfileGuildIds,
    guildPruneGuildIds,
    guildPruneIncludeRoleIds,
    guildPruneMaxMembers: configLimit(
      document,
      "guildPruneMaxMembers",
      GUILD_PRUNE_DEFAULTS.maximumMemberCount,
      1,
      CONNECTOR_LIMITS.guildPruneMaximumMembers,
    ),
    guildSettingsGuildIds,
    guildTemplateGuildIds,
    integrationGuildIds,
    integrationIds,
    interactionChannelIds,
    interactionMaxWritesPerMinute: configLimit(
      document,
      "interactionMaxWritesPerMinute",
      INTERACTION_DEFAULTS.maxWritesPerMinute,
      1,
      CONNECTOR_LIMITS.interactionMaxWritesPerMinute,
    ),
    interactionMinWriteIntervalMs: configLimit(
      document,
      "interactionMinWriteIntervalMs",
      INTERACTION_DEFAULTS.minWriteIntervalMs,
      0,
      CONNECTOR_LIMITS.interactionMinWriteIntervalMs,
    ),
    inviteCapabilityRoots: parseOwnedRoots(
      document.storage.inviteCapabilityRoots,
      "$.storage.inviteCapabilityRoots",
      true,
    ),
    inviteCreationChannelIds,
    inviteRoleIds,
    inviteGuildIds,
    mentionUserIds,
    memberDirectoryGuildIds,
    nicknameGuildIds,
    memberRoleGuildIds,
    memberRoleIds,
    memberVoiceChannelIds,
    memberVoiceGuildIds,
    messageForwardSourceChannelIds,
    messageForwardTargetChannelIds,
    nativeCommandName,
    nativeInteractionChannelIds,
    nativeInteractionGuildIds,
    nativeInteractionMaxPending: configLimit(
      document,
      "nativeInteractionMaxPending",
      NATIVE_INTERACTION_DEFAULTS.maximumPending,
      1,
      CONNECTOR_LIMITS.nativeInteractionMaxPending,
    ),
    nativeInteractionTtlSeconds: configLimit(
      document,
      "nativeInteractionTtlSeconds",
      NATIVE_INTERACTION_DEFAULTS.ttlSeconds,
      NATIVE_INTERACTION_LIMITS.minimumTtlSeconds,
      NATIVE_INTERACTION_LIMITS.maximumTtlSeconds,
    ),
    nativeInteractionUserIds,
    mcpToolsets: new Set(document.tools.toolsets),
    mcpToolSurface: document.tools.surface,
    mcpReadResponseMaxBytes: configLimit(
      document,
      "mcpReadResponseMaxBytes",
      MCP_READ_RESPONSE_DEFAULTS.maxBytes,
      MCP_READ_RESPONSE_LIMITS.minimumBytes,
      MCP_READ_RESPONSE_LIMITS.maximumBytes,
    ),
    observability: loadObservabilityDocumentConfig(
      document.observability,
      environment,
      [token],
    ),
    onboardingGuildIds,
    permissionOverwriteChannelIds,
    protectedUserIds,
    pinChannelIds,
    pollChannelIds,
    reactionChannelIds,
    roleCreationGuildIds,
    roleConfigurationIds,
    roleDeletionIds,
    roleOrderingGuildIds,
    scheduledEventGuildIds,
    scheduledEventRoots: parseOwnedRoots(
      document.storage.scheduledEventRoots,
      "$.storage.scheduledEventRoots",
    ),
    secretEnvironmentVariables: new Set(
      connectorConfigSecretEnvironmentNames(document),
    ),
    soundboardGuildIds,
    soundboardRoots: parseOwnedRoots(
      document.storage.soundboardRoots,
      "$.storage.soundboardRoots",
    ),
    stageChannelIds,
    token,
    threadParentIds,
    threadGuildIds,
    threadIds,
    threadMemberUserIds,
    welcomeScreenGuildIds,
    webhookChannelIds,
    webhookCredentialRoot,
    webhookGuildIds,
    webhookMessageChannelIds,
    widgetSettingsGuildIds,
  }
}
