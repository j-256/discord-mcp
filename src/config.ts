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
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  ENVIRONMENT_NAMES,
  GATEWAY_DEFAULTS,
  INTERACTION_DEFAULTS,
  NATIVE_INTERACTION_COMMAND_NAME_PATTERN,
  NATIVE_INTERACTION_DEFAULTS,
  NATIVE_INTERACTION_LIMITS,
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
  announcementCrosspostChannelIds: ReadonlySet<string>
  announcementSubscriptionSourceChannelIds: ReadonlySet<string>
  announcementSubscriptionTargetChannelIds: ReadonlySet<string>
  allowedChannelIds: ReadonlySet<string>
  allowedGuildIds: ReadonlySet<string>
  allowAdministration: boolean
  allowAnnouncementCrossposts: boolean
  allowAnnouncementSubscriptionAudit: boolean
  allowAnnouncementSubscriptionChanges: boolean
  allowAttachments: boolean
  allowAutomodAudit: boolean
  allowAutomodChanges: boolean
  allowBanAudit: boolean
  allowChannelCloneAudit: boolean
  allowChannelCloning: boolean
  allowChannelCreation: boolean
  allowChannelMetadataChanges: boolean
  allowChannelOrderingAudit: boolean
  allowChannelOrderingChanges: boolean
  allowDeletions: boolean
  allowForumPosts: boolean
  allowForumTagAudit: boolean
  allowForumTagChanges: boolean
  allowGateway: boolean
  allowGuildExpressionAudit: boolean
  allowGuildExpressionChanges: boolean
  allowGuildScaffolds: boolean
  allowGuildSettingsAudit: boolean
  allowGuildSettingsChanges: boolean
  allowGuildTemplateAudit: boolean
  allowGuildTemplateChanges: boolean
  allowIntegrationAudit: boolean
  allowIntegrationDeletions: boolean
  allowInteractions: boolean
  allowInviteAudit: boolean
  allowInviteDeletions: boolean
  allowMemberDirectory: boolean
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
  allowWidgetPublicExposure: boolean
  allowWidgetSettingsAudit: boolean
  allowWidgetSettingsChanges: boolean
  auditFile: string
  attachmentChannelIds: ReadonlySet<string>
  attachmentMaxBytes: number
  attachmentRoots: readonly string[]
  automodAlertChannelIds: ReadonlySet<string>
  automodGuildIds: ReadonlySet<string>
  banAuditGuildIds: ReadonlySet<string>
  channelCloneGuildIds: ReadonlySet<string>
  channelCloneSourceIds: ReadonlySet<string>
  channelCreationGuildIds: ReadonlySet<string>
  channelMetadataIds: ReadonlySet<string>
  channelOrderingGuildIds: ReadonlySet<string>
  deleteChannelIds: ReadonlySet<string>
  expectedApplicationId: string | undefined
  expectedBotId: string | undefined
  forumPostChannelIds: ReadonlySet<string>
  forumTagChannelIds: ReadonlySet<string>
  gatewayEventBufferSize: number
  guildScaffoldGuildIds: ReadonlySet<string>
  guildExpressionGuildIds: ReadonlySet<string>
  guildExpressionRoots: readonly string[]
  guildSettingsGuildIds: ReadonlySet<string>
  guildTemplateGuildIds: ReadonlySet<string>
  integrationGuildIds: ReadonlySet<string>
  integrationIds: ReadonlySet<string>
  interactionChannelIds: ReadonlySet<string>
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  inviteGuildIds: ReadonlySet<string>
  mentionUserIds: ReadonlySet<string>
  memberDirectoryGuildIds: ReadonlySet<string>
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
  roleOrderingGuildIds: ReadonlySet<string>
  scheduledEventGuildIds: ReadonlySet<string>
  scheduledEventRoots: readonly string[]
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
  widgetSettingsGuildIds: ReadonlySet<string>
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

function parseOwnedRoots(
  value: string | undefined,
  name: string,
): readonly string[] {
  if (!value?.trim()) return []
  const normalized = value.trim()
  let entries: unknown
  try {
    entries = normalized.startsWith("[")
      ? JSON.parse(normalized)
      : [normalized]
  } catch (error) {
    throw new ConfigurationError(
      `${name} must be one absolute directory or a JSON array of absolute directories`,
      { cause: error },
    )
  }
  if (
    !Array.isArray(entries)
    || entries.length < 1
    || entries.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new ConfigurationError(
      `${name} must be one absolute directory or a JSON array of absolute directories`,
    )
  }
  if (typeof process.getuid !== "function") {
    throw new ConfigurationError(
      `${name} requires numeric process ownership evidence on this runtime`,
    )
  }
  const processUserId = process.getuid()
  const roots = entries.map((entry) => {
    const candidate = (entry as string).trim()
    if (
      !isAbsolute(candidate)
      || candidate.includes("\0")
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
    ) {
      throw new ConfigurationError(
        `${name} entries must be owned, canonical directories below the filesystem root`,
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

export function resolveConnectorAuditFile(
  environment: NodeJS.ProcessEnv = process.env,
  options: ConfigOptions = {},
): string {
  return auditFile(
    environment[ENVIRONMENT_NAMES.auditFile],
    environment,
    options.homeDirectory || homedir(),
  )
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
  const automodGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.automodGuildIds],
    ENVIRONMENT_NAMES.automodGuildIds,
  )
  const banAuditGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.banAuditGuildIds],
    ENVIRONMENT_NAMES.banAuditGuildIds,
  )
  const adminGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.adminGuildIds],
    ENVIRONMENT_NAMES.adminGuildIds,
  )
  const channelCreationGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.channelCreationGuildIds],
    ENVIRONMENT_NAMES.channelCreationGuildIds,
  )
  const channelCloneGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.channelCloneGuildIds],
    ENVIRONMENT_NAMES.channelCloneGuildIds,
    CONNECTOR_LIMITS.channelCloneGuildAllowlist,
  )
  const channelCloneSourceIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.channelCloneSourceIds],
    ENVIRONMENT_NAMES.channelCloneSourceIds,
    CONNECTOR_LIMITS.channelCloneSourceAllowlist,
  )
  const channelMetadataIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.channelMetadataIds],
    ENVIRONMENT_NAMES.channelMetadataIds,
  )
  const channelOrderingGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.channelOrderingGuildIds],
    ENVIRONMENT_NAMES.channelOrderingGuildIds,
    CONNECTOR_LIMITS.channelOrderingGuildAllowlist,
  )
  const attachmentChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.attachmentChannelIds],
    ENVIRONMENT_NAMES.attachmentChannelIds,
  )
  const announcementCrosspostChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.announcementCrosspostChannelIds],
    ENVIRONMENT_NAMES.announcementCrosspostChannelIds,
  )
  const messageForwardSourceChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.messageForwardSourceChannelIds],
    ENVIRONMENT_NAMES.messageForwardSourceChannelIds,
    CONNECTOR_LIMITS.messageForwardChannelAllowlist,
  )
  const messageForwardTargetChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.messageForwardTargetChannelIds],
    ENVIRONMENT_NAMES.messageForwardTargetChannelIds,
    CONNECTOR_LIMITS.messageForwardChannelAllowlist,
  )
  const announcementSubscriptionSourceChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.announcementSubscriptionSourceChannelIds],
    ENVIRONMENT_NAMES.announcementSubscriptionSourceChannelIds,
  )
  const announcementSubscriptionTargetChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.announcementSubscriptionTargetChannelIds],
    ENVIRONMENT_NAMES.announcementSubscriptionTargetChannelIds,
  )
  const automodAlertChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.automodAlertChannelIds],
    ENVIRONMENT_NAMES.automodAlertChannelIds,
  )
  const deleteChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.deleteChannelIds],
    ENVIRONMENT_NAMES.deleteChannelIds,
  )
  const interactionChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.interactionChannelIds],
    ENVIRONMENT_NAMES.interactionChannelIds,
  )
  const pinChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.pinChannelIds],
    ENVIRONMENT_NAMES.pinChannelIds,
  )
  const permissionOverwriteChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.permissionOverwriteChannelIds],
    ENVIRONMENT_NAMES.permissionOverwriteChannelIds,
  )
  const pollChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.pollChannelIds],
    ENVIRONMENT_NAMES.pollChannelIds,
  )
  const reactionChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.reactionChannelIds],
    ENVIRONMENT_NAMES.reactionChannelIds,
    CONNECTOR_LIMITS.reactionChannelAllowlist,
  )
  const forumPostChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.forumPostChannelIds],
    ENVIRONMENT_NAMES.forumPostChannelIds,
  )
  const forumTagChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.forumTagChannelIds],
    ENVIRONMENT_NAMES.forumTagChannelIds,
  )
  const threadParentIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.threadParentIds],
    ENVIRONMENT_NAMES.threadParentIds,
  )
  const threadGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.threadGuildIds],
    ENVIRONMENT_NAMES.threadGuildIds,
    CONNECTOR_LIMITS.threadGovernanceGuildAllowlist,
  )
  const threadIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.threadIds],
    ENVIRONMENT_NAMES.threadIds,
    CONNECTOR_LIMITS.threadGovernanceThreadAllowlist,
  )
  const threadMemberUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.threadMemberUserIds],
    ENVIRONMENT_NAMES.threadMemberUserIds,
    CONNECTOR_LIMITS.threadGovernanceUserAllowlist,
  )
  const stageChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.stageChannelIds],
    ENVIRONMENT_NAMES.stageChannelIds,
    CONNECTOR_LIMITS.stageInstanceChannels,
  )
  const mentionUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.mentionUserIds],
    ENVIRONMENT_NAMES.mentionUserIds,
    CONNECTOR_LIMITS.mentionUserAllowlist,
  )
  const memberDirectoryGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.memberDirectoryGuildIds],
    ENVIRONMENT_NAMES.memberDirectoryGuildIds,
  )
  const memberRoleGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.memberRoleGuildIds],
    ENVIRONMENT_NAMES.memberRoleGuildIds,
  )
  const memberRoleIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.memberRoleIds],
    ENVIRONMENT_NAMES.memberRoleIds,
    CONNECTOR_LIMITS.memberRoleAllowlist,
  )
  const memberVoiceChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.memberVoiceChannelIds],
    ENVIRONMENT_NAMES.memberVoiceChannelIds,
    CONNECTOR_LIMITS.memberVoiceChannelAllowlist,
  )
  const memberVoiceGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.memberVoiceGuildIds],
    ENVIRONMENT_NAMES.memberVoiceGuildIds,
    CONNECTOR_LIMITS.memberVoiceGuildAllowlist,
  )
  const nativeInteractionGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.nativeInteractionGuildIds],
    ENVIRONMENT_NAMES.nativeInteractionGuildIds,
    CONNECTOR_LIMITS.nativeInteractionGuildAllowlist,
  )
  const nativeInteractionChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.nativeInteractionChannelIds],
    ENVIRONMENT_NAMES.nativeInteractionChannelIds,
    CONNECTOR_LIMITS.nativeInteractionChannelAllowlist,
  )
  const nativeInteractionUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.nativeInteractionUserIds],
    ENVIRONMENT_NAMES.nativeInteractionUserIds,
    CONNECTOR_LIMITS.nativeInteractionUserAllowlist,
  )
  const protectedUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.protectedUserIds],
    ENVIRONMENT_NAMES.protectedUserIds,
    CONNECTOR_LIMITS.protectedUserAllowlist,
  )
  const roleCreationGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.roleCreationGuildIds],
    ENVIRONMENT_NAMES.roleCreationGuildIds,
  )
  const roleConfigurationIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.roleConfigurationIds],
    ENVIRONMENT_NAMES.roleConfigurationIds,
    CONNECTOR_LIMITS.roleConfigurationAllowlist,
  )
  const roleOrderingGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.roleOrderingGuildIds],
    ENVIRONMENT_NAMES.roleOrderingGuildIds,
    CONNECTOR_LIMITS.roleOrderingGuildAllowlist,
  )
  const guildScaffoldGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.guildScaffoldGuildIds],
    ENVIRONMENT_NAMES.guildScaffoldGuildIds,
  )
  const guildExpressionGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.guildExpressionGuildIds],
    ENVIRONMENT_NAMES.guildExpressionGuildIds,
  )
  const guildSettingsGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.guildSettingsGuildIds],
    ENVIRONMENT_NAMES.guildSettingsGuildIds,
    CONNECTOR_LIMITS.guildSettingsGuildAllowlist,
  )
  const guildTemplateGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.guildTemplateGuildIds],
    ENVIRONMENT_NAMES.guildTemplateGuildIds,
  )
  const integrationGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.integrationGuildIds],
    ENVIRONMENT_NAMES.integrationGuildIds,
    CONNECTOR_LIMITS.integrationGuildAllowlist,
  )
  const integrationIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.integrationIds],
    ENVIRONMENT_NAMES.integrationIds,
    CONNECTOR_LIMITS.integrationIdAllowlist,
  )
  const scheduledEventGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.scheduledEventGuildIds],
    ENVIRONMENT_NAMES.scheduledEventGuildIds,
  )
  const soundboardGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.soundboardGuildIds],
    ENVIRONMENT_NAMES.soundboardGuildIds,
    CONNECTOR_LIMITS.soundboardGuildAllowlist,
  )
  const welcomeScreenGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.welcomeScreenGuildIds],
    ENVIRONMENT_NAMES.welcomeScreenGuildIds,
    CONNECTOR_LIMITS.welcomeScreenGuildAllowlist,
  )
  const widgetSettingsGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.widgetSettingsGuildIds],
    ENVIRONMENT_NAMES.widgetSettingsGuildIds,
    CONNECTOR_LIMITS.widgetSettingsGuildAllowlist,
  )
  const webhookChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.webhookChannelIds],
    ENVIRONMENT_NAMES.webhookChannelIds,
  )
  const inviteGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.inviteGuildIds],
    ENVIRONMENT_NAMES.inviteGuildIds,
  )
  const onboardingGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.onboardingGuildIds],
    ENVIRONMENT_NAMES.onboardingGuildIds,
  )

  for (const [name, guildIds] of [
    [ENVIRONMENT_NAMES.adminGuildIds, adminGuildIds],
    [ENVIRONMENT_NAMES.automodGuildIds, automodGuildIds],
    [ENVIRONMENT_NAMES.banAuditGuildIds, banAuditGuildIds],
    [ENVIRONMENT_NAMES.channelCreationGuildIds, channelCreationGuildIds],
    [ENVIRONMENT_NAMES.channelCloneGuildIds, channelCloneGuildIds],
    [ENVIRONMENT_NAMES.channelOrderingGuildIds, channelOrderingGuildIds],
    [ENVIRONMENT_NAMES.guildScaffoldGuildIds, guildScaffoldGuildIds],
    [ENVIRONMENT_NAMES.guildExpressionGuildIds, guildExpressionGuildIds],
    [ENVIRONMENT_NAMES.guildSettingsGuildIds, guildSettingsGuildIds],
    [ENVIRONMENT_NAMES.guildTemplateGuildIds, guildTemplateGuildIds],
    [ENVIRONMENT_NAMES.integrationGuildIds, integrationGuildIds],
    [ENVIRONMENT_NAMES.inviteGuildIds, inviteGuildIds],
    [ENVIRONMENT_NAMES.onboardingGuildIds, onboardingGuildIds],
    [ENVIRONMENT_NAMES.memberDirectoryGuildIds, memberDirectoryGuildIds],
    [ENVIRONMENT_NAMES.memberRoleGuildIds, memberRoleGuildIds],
    [ENVIRONMENT_NAMES.memberVoiceGuildIds, memberVoiceGuildIds],
    [ENVIRONMENT_NAMES.nativeInteractionGuildIds, nativeInteractionGuildIds],
    [ENVIRONMENT_NAMES.threadGuildIds, threadGuildIds],
    [ENVIRONMENT_NAMES.roleCreationGuildIds, roleCreationGuildIds],
    [ENVIRONMENT_NAMES.roleOrderingGuildIds, roleOrderingGuildIds],
    [ENVIRONMENT_NAMES.scheduledEventGuildIds, scheduledEventGuildIds],
    [ENVIRONMENT_NAMES.soundboardGuildIds, soundboardGuildIds],
    [ENVIRONMENT_NAMES.welcomeScreenGuildIds, welcomeScreenGuildIds],
    [ENVIRONMENT_NAMES.widgetSettingsGuildIds, widgetSettingsGuildIds],
  ] as const) {
    for (const guildId of guildIds) {
      if (allowedGuildIds.size === 0 || allowedGuildIds.has(guildId)) continue
      throw new ConfigurationError(
        `${name} must be a subset of ${ENVIRONMENT_NAMES.allowedGuildIds}`,
      )
    }
  }

  for (const [name, channelIds] of [
    [ENVIRONMENT_NAMES.announcementCrosspostChannelIds, announcementCrosspostChannelIds],
    [ENVIRONMENT_NAMES.attachmentChannelIds, attachmentChannelIds],
    [ENVIRONMENT_NAMES.automodAlertChannelIds, automodAlertChannelIds],
    [ENVIRONMENT_NAMES.channelMetadataIds, channelMetadataIds],
    [ENVIRONMENT_NAMES.channelCloneSourceIds, channelCloneSourceIds],
    [ENVIRONMENT_NAMES.deleteChannelIds, deleteChannelIds],
    [ENVIRONMENT_NAMES.forumPostChannelIds, forumPostChannelIds],
    [ENVIRONMENT_NAMES.forumTagChannelIds, forumTagChannelIds],
    [ENVIRONMENT_NAMES.interactionChannelIds, interactionChannelIds],
    [ENVIRONMENT_NAMES.messageForwardSourceChannelIds, messageForwardSourceChannelIds],
    [ENVIRONMENT_NAMES.messageForwardTargetChannelIds, messageForwardTargetChannelIds],
    [ENVIRONMENT_NAMES.memberVoiceChannelIds, memberVoiceChannelIds],
    [ENVIRONMENT_NAMES.nativeInteractionChannelIds, nativeInteractionChannelIds],
    [ENVIRONMENT_NAMES.permissionOverwriteChannelIds, permissionOverwriteChannelIds],
    [ENVIRONMENT_NAMES.pinChannelIds, pinChannelIds],
    [ENVIRONMENT_NAMES.pollChannelIds, pollChannelIds],
    [ENVIRONMENT_NAMES.reactionChannelIds, reactionChannelIds],
    [
      ENVIRONMENT_NAMES.announcementSubscriptionSourceChannelIds,
      announcementSubscriptionSourceChannelIds,
    ],
    [
      ENVIRONMENT_NAMES.announcementSubscriptionTargetChannelIds,
      announcementSubscriptionTargetChannelIds,
    ],
    [ENVIRONMENT_NAMES.stageChannelIds, stageChannelIds],
    [ENVIRONMENT_NAMES.threadParentIds, threadParentIds],
    [ENVIRONMENT_NAMES.threadIds, threadIds],
    [ENVIRONMENT_NAMES.webhookChannelIds, webhookChannelIds],
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
  const botIdValue = environment[ENVIRONMENT_NAMES.botId]
  const expectedBotId = botIdValue?.trim()
    ? parseId(botIdValue, ENVIRONMENT_NAMES.botId)
    : undefined
  const allowMessageForwarding = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowMessageForwarding],
    ENVIRONMENT_NAMES.allowMessageForwarding,
  )
  const allowCrossGuildMessageForwarding = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowCrossGuildMessageForwarding],
    ENVIRONMENT_NAMES.allowCrossGuildMessageForwarding,
  )
  if (allowCrossGuildMessageForwarding && !allowMessageForwarding) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowCrossGuildMessageForwarding} requires ${ENVIRONMENT_NAMES.allowMessageForwarding}`,
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
      `${ENVIRONMENT_NAMES.allowMessageForwarding} requires exact source and target channel allowlists`,
    )
  }
  if (allowMessageForwarding && (!expectedApplicationId || !expectedBotId)) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowMessageForwarding} requires ${ENVIRONMENT_NAMES.applicationId} and ${ENVIRONMENT_NAMES.botId}`,
    )
  }
  const allowReactionModeration = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowReactionModeration],
    ENVIRONMENT_NAMES.allowReactionModeration,
  )
  const allowReactionUserAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowReactionUserAudit],
    ENVIRONMENT_NAMES.allowReactionUserAudit,
  )
  if ((allowReactionModeration || allowReactionUserAudit) && reactionChannelIds.size === 0) {
    throw new ConfigurationError(
      "Reaction audit and moderation require an exact reaction-channel allowlist",
    )
  }
  if (allowReactionModeration && (!expectedApplicationId || !expectedBotId)) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowReactionModeration} requires ${ENVIRONMENT_NAMES.applicationId} and ${ENVIRONMENT_NAMES.botId}`,
    )
  }
  const allowGateway = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGateway],
    ENVIRONMENT_NAMES.allowGateway,
  )
  const allowChannelCloneAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowChannelCloneAudit],
    ENVIRONMENT_NAMES.allowChannelCloneAudit,
  )
  const allowChannelCloning = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowChannelCloning],
    ENVIRONMENT_NAMES.allowChannelCloning,
  )
  if (allowChannelCloning && !allowChannelCloneAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowChannelCloning} requires ${ENVIRONMENT_NAMES.allowChannelCloneAudit}`,
    )
  }
  if (
    allowChannelCloneAudit
    && (channelCloneGuildIds.size === 0 || channelCloneSourceIds.size === 0)
  ) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowChannelCloneAudit} requires ${ENVIRONMENT_NAMES.channelCloneGuildIds} and ${ENVIRONMENT_NAMES.channelCloneSourceIds}`,
    )
  }
  const allowChannelOrderingAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowChannelOrderingAudit],
    ENVIRONMENT_NAMES.allowChannelOrderingAudit,
  )
  const allowChannelOrderingChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowChannelOrderingChanges],
    ENVIRONMENT_NAMES.allowChannelOrderingChanges,
  )
  if (allowChannelOrderingChanges && !allowChannelOrderingAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowChannelOrderingChanges} requires ${ENVIRONMENT_NAMES.allowChannelOrderingAudit}`,
    )
  }
  if (allowChannelOrderingAudit && channelOrderingGuildIds.size === 0) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowChannelOrderingAudit} requires ${ENVIRONMENT_NAMES.channelOrderingGuildIds}`,
    )
  }
  const allowNativeCommandChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowNativeCommandChanges],
    ENVIRONMENT_NAMES.allowNativeCommandChanges,
  )
  const allowNativeInteractions = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowNativeInteractions],
    ENVIRONMENT_NAMES.allowNativeInteractions,
  )
  if (
    (
      allowGateway
      || allowChannelCloneAudit
      || allowChannelOrderingAudit
      || allowNativeCommandChanges
      || allowNativeInteractions
    )
    && (!expectedApplicationId || !expectedBotId)
  ) {
    throw new ConfigurationError(
      `Gateway-backed and native Interaction features require ${ENVIRONMENT_NAMES.applicationId} and ${ENVIRONMENT_NAMES.botId}`,
    )
  }
  if (allowGateway && allowedGuildIds.size === 0 && allowedChannelIds.size === 0) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGateway} requires an exact guild or channel read allowlist`,
    )
  }
  if (
    allowNativeCommandChanges
    && nativeInteractionGuildIds.size === 0
  ) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowNativeCommandChanges} requires ${ENVIRONMENT_NAMES.nativeInteractionGuildIds}`,
    )
  }
  if (allowNativeInteractions && (
    nativeInteractionGuildIds.size === 0
    || nativeInteractionChannelIds.size === 0
    || nativeInteractionUserIds.size === 0
  )) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowNativeInteractions} requires exact native Interaction guild, channel, and user allowlists`,
    )
  }
  const nativeCommandName = environment[ENVIRONMENT_NAMES.nativeCommandName]?.trim()
    || NATIVE_INTERACTION_DEFAULTS.commandName
  if (!NATIVE_INTERACTION_COMMAND_NAME_PATTERN.test(nativeCommandName)) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.nativeCommandName} must be 1-${NATIVE_INTERACTION_LIMITS.commandNameCharacters} lowercase ASCII letters, digits, hyphens, or underscores`,
    )
  }
  const allowAutomodAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowAutomodAudit],
    ENVIRONMENT_NAMES.allowAutomodAudit,
  )
  const allowAutomodChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowAutomodChanges],
    ENVIRONMENT_NAMES.allowAutomodChanges,
  )
  if (allowAutomodChanges && !allowAutomodAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowAutomodChanges} requires ${ENVIRONMENT_NAMES.allowAutomodAudit}`,
    )
  }
  const allowWebhookAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWebhookAudit],
    ENVIRONMENT_NAMES.allowWebhookAudit,
  )
  const allowWebhookChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWebhookChanges],
    ENVIRONMENT_NAMES.allowWebhookChanges,
  )
  const allowWebhookCreation = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWebhookCreation],
    ENVIRONMENT_NAMES.allowWebhookCreation,
  )
  const allowWebhookDeletions = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWebhookDeletions],
    ENVIRONMENT_NAMES.allowWebhookDeletions,
  )
  if (
    (allowWebhookChanges || allowWebhookCreation || allowWebhookDeletions)
    && !allowWebhookAudit
  ) {
    throw new ConfigurationError(
      `Enabling webhook creation, changes, or deletion requires ${ENVIRONMENT_NAMES.allowWebhookAudit}`,
    )
  }
  const allowAnnouncementSubscriptionAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowAnnouncementSubscriptionAudit],
    ENVIRONMENT_NAMES.allowAnnouncementSubscriptionAudit,
  )
  const allowAnnouncementSubscriptionChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowAnnouncementSubscriptionChanges],
    ENVIRONMENT_NAMES.allowAnnouncementSubscriptionChanges,
  )
  if (allowAnnouncementSubscriptionChanges && !allowAnnouncementSubscriptionAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowAnnouncementSubscriptionChanges} requires ${ENVIRONMENT_NAMES.allowAnnouncementSubscriptionAudit}`,
    )
  }
  const allowRoleOrderingAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowRoleOrderingAudit],
    ENVIRONMENT_NAMES.allowRoleOrderingAudit,
  )
  const allowRoleOrderingChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowRoleOrderingChanges],
    ENVIRONMENT_NAMES.allowRoleOrderingChanges,
  )
  if (allowRoleOrderingChanges && !allowRoleOrderingAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowRoleOrderingChanges} requires ${ENVIRONMENT_NAMES.allowRoleOrderingAudit}`,
    )
  }
  const allowInviteAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowInviteAudit],
    ENVIRONMENT_NAMES.allowInviteAudit,
  )
  const allowInviteDeletions = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowInviteDeletions],
    ENVIRONMENT_NAMES.allowInviteDeletions,
  )
  if (allowInviteDeletions && !allowInviteAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowInviteDeletions} requires ${ENVIRONMENT_NAMES.allowInviteAudit}`,
    )
  }
  const allowOnboardingAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowOnboardingAudit],
    ENVIRONMENT_NAMES.allowOnboardingAudit,
  )
  const allowOnboardingChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowOnboardingChanges],
    ENVIRONMENT_NAMES.allowOnboardingChanges,
  )
  if (allowOnboardingChanges && !allowOnboardingAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowOnboardingChanges} requires ${ENVIRONMENT_NAMES.allowOnboardingAudit}`,
    )
  }
  const allowMemberRoleChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowMemberRoleChanges],
    ENVIRONMENT_NAMES.allowMemberRoleChanges,
  )
  const allowGuildExpressionAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGuildExpressionAudit],
    ENVIRONMENT_NAMES.allowGuildExpressionAudit,
  )
  const allowGuildExpressionChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGuildExpressionChanges],
    ENVIRONMENT_NAMES.allowGuildExpressionChanges,
  )
  if (allowGuildExpressionChanges && !allowGuildExpressionAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGuildExpressionChanges} requires ${ENVIRONMENT_NAMES.allowGuildExpressionAudit}`,
    )
  }
  const allowGuildTemplateAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGuildTemplateAudit],
    ENVIRONMENT_NAMES.allowGuildTemplateAudit,
  )
  const allowGuildTemplateChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGuildTemplateChanges],
    ENVIRONMENT_NAMES.allowGuildTemplateChanges,
  )
  if (allowGuildTemplateChanges && !allowGuildTemplateAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGuildTemplateChanges} requires ${ENVIRONMENT_NAMES.allowGuildTemplateAudit}`,
    )
  }
  const allowGuildSettingsAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGuildSettingsAudit],
    ENVIRONMENT_NAMES.allowGuildSettingsAudit,
  )
  const allowGuildSettingsChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGuildSettingsChanges],
    ENVIRONMENT_NAMES.allowGuildSettingsChanges,
  )
  if (allowGuildSettingsChanges && !allowGuildSettingsAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGuildSettingsChanges} requires ${ENVIRONMENT_NAMES.allowGuildSettingsAudit}`,
    )
  }
  if (allowGuildSettingsAudit && guildSettingsGuildIds.size === 0) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGuildSettingsAudit} requires ${ENVIRONMENT_NAMES.guildSettingsGuildIds}`,
    )
  }
  if (
    (
      allowGuildSettingsAudit
      || allowGuildTemplateAudit
      || allowMemberRoleChanges
      || allowOnboardingAudit
    )
    && (!expectedApplicationId || !expectedBotId)
  ) {
    throw new ConfigurationError(
      `Channel-completeness features require ${ENVIRONMENT_NAMES.applicationId} and ${ENVIRONMENT_NAMES.botId}`,
    )
  }
  const allowIntegrationAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowIntegrationAudit],
    ENVIRONMENT_NAMES.allowIntegrationAudit,
  )
  const allowIntegrationDeletions = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowIntegrationDeletions],
    ENVIRONMENT_NAMES.allowIntegrationDeletions,
  )
  if (allowIntegrationDeletions && !allowIntegrationAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowIntegrationDeletions} requires ${ENVIRONMENT_NAMES.allowIntegrationAudit}`,
    )
  }
  const allowForumTagAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowForumTagAudit],
    ENVIRONMENT_NAMES.allowForumTagAudit,
  )
  const allowForumTagChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowForumTagChanges],
    ENVIRONMENT_NAMES.allowForumTagChanges,
  )
  if (allowForumTagChanges && !allowForumTagAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowForumTagChanges} requires ${ENVIRONMENT_NAMES.allowForumTagAudit}`,
    )
  }
  const allowScheduledEventAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowScheduledEventAudit],
    ENVIRONMENT_NAMES.allowScheduledEventAudit,
  )
  const allowScheduledEventChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowScheduledEventChanges],
    ENVIRONMENT_NAMES.allowScheduledEventChanges,
  )
  const allowScheduledEventUserAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowScheduledEventUserAudit],
    ENVIRONMENT_NAMES.allowScheduledEventUserAudit,
  )
  if (allowScheduledEventChanges && !allowScheduledEventAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowScheduledEventChanges} requires ${ENVIRONMENT_NAMES.allowScheduledEventAudit}`,
    )
  }
  if (allowScheduledEventUserAudit && !allowScheduledEventAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowScheduledEventUserAudit} requires ${ENVIRONMENT_NAMES.allowScheduledEventAudit}`,
    )
  }
  const allowSoundboardAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowSoundboardAudit],
    ENVIRONMENT_NAMES.allowSoundboardAudit,
  )
  const allowSoundboardChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowSoundboardChanges],
    ENVIRONMENT_NAMES.allowSoundboardChanges,
  )
  if (allowSoundboardChanges && !allowSoundboardAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowSoundboardChanges} requires ${ENVIRONMENT_NAMES.allowSoundboardAudit}`,
    )
  }
  const allowWelcomeScreenAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWelcomeScreenAudit],
    ENVIRONMENT_NAMES.allowWelcomeScreenAudit,
  )
  const allowWelcomeScreenChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWelcomeScreenChanges],
    ENVIRONMENT_NAMES.allowWelcomeScreenChanges,
  )
  if (allowWelcomeScreenChanges && !allowWelcomeScreenAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowWelcomeScreenChanges} requires ${ENVIRONMENT_NAMES.allowWelcomeScreenAudit}`,
    )
  }
  const allowWidgetSettingsAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWidgetSettingsAudit],
    ENVIRONMENT_NAMES.allowWidgetSettingsAudit,
  )
  const allowWidgetSettingsChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWidgetSettingsChanges],
    ENVIRONMENT_NAMES.allowWidgetSettingsChanges,
  )
  if (allowWidgetSettingsChanges && !allowWidgetSettingsAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowWidgetSettingsChanges} requires ${ENVIRONMENT_NAMES.allowWidgetSettingsAudit}`,
    )
  }
  const allowWidgetPublicExposure = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWidgetPublicExposure],
    ENVIRONMENT_NAMES.allowWidgetPublicExposure,
  )
  if (allowWidgetPublicExposure && !allowWidgetSettingsChanges) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowWidgetPublicExposure} requires ${ENVIRONMENT_NAMES.allowWidgetSettingsChanges}`,
    )
  }
  const allowMemberVoiceAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowMemberVoiceAudit],
    ENVIRONMENT_NAMES.allowMemberVoiceAudit,
  )
  const allowMemberVoiceChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowMemberVoiceChanges],
    ENVIRONMENT_NAMES.allowMemberVoiceChanges,
  )
  if (allowMemberVoiceChanges && !allowMemberVoiceAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowMemberVoiceChanges} requires ${ENVIRONMENT_NAMES.allowMemberVoiceAudit}`,
    )
  }
  const allowStageInstanceAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowStageInstanceAudit],
    ENVIRONMENT_NAMES.allowStageInstanceAudit,
  )
  const allowStageInstanceChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowStageInstanceChanges],
    ENVIRONMENT_NAMES.allowStageInstanceChanges,
  )
  if (allowStageInstanceChanges && !allowStageInstanceAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowStageInstanceChanges} requires ${ENVIRONMENT_NAMES.allowStageInstanceAudit}`,
    )
  }
  const allowStageStartNotifications = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowStageStartNotifications],
    ENVIRONMENT_NAMES.allowStageStartNotifications,
  )
  if (allowStageStartNotifications && !allowStageInstanceChanges) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowStageStartNotifications} requires ${ENVIRONMENT_NAMES.allowStageInstanceChanges}`,
    )
  }
  const allowThreadAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowThreadAudit],
    ENVIRONMENT_NAMES.allowThreadAudit,
  )
  const allowThreadChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowThreadChanges],
    ENVIRONMENT_NAMES.allowThreadChanges,
  )
  if (allowThreadChanges && !allowThreadAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowThreadChanges} requires ${ENVIRONMENT_NAMES.allowThreadAudit}`,
    )
  }
  const allowPollAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowPollAudit],
    ENVIRONMENT_NAMES.allowPollAudit,
  )
  const allowPollCreation = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowPollCreation],
    ENVIRONMENT_NAMES.allowPollCreation,
  )
  const allowPollEnding = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowPollEnding],
    ENVIRONMENT_NAMES.allowPollEnding,
  )
  const allowPollVoterAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowPollVoterAudit],
    ENVIRONMENT_NAMES.allowPollVoterAudit,
  )
  if ((allowPollCreation || allowPollEnding || allowPollVoterAudit) && !allowPollAudit) {
    throw new ConfigurationError(
      `Poll creation, ending, and voter audit require ${ENVIRONMENT_NAMES.allowPollAudit}`,
    )
  }

  return {
    adminGuildIds,
    announcementCrosspostChannelIds,
    announcementSubscriptionSourceChannelIds,
    announcementSubscriptionTargetChannelIds,
    allowedChannelIds,
    allowedGuildIds,
    allowAdministration: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowAdministration],
      ENVIRONMENT_NAMES.allowAdministration,
    ),
    allowCrossGuildMessageForwarding,
    allowAnnouncementCrossposts: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowAnnouncementCrossposts],
      ENVIRONMENT_NAMES.allowAnnouncementCrossposts,
    ),
    allowAnnouncementSubscriptionAudit,
    allowAnnouncementSubscriptionChanges,
    allowAttachments: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowAttachments],
      ENVIRONMENT_NAMES.allowAttachments,
    ),
    allowAutomodAudit,
    allowAutomodChanges,
    allowBanAudit: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowBanAudit],
      ENVIRONMENT_NAMES.allowBanAudit,
    ),
    allowChannelCloneAudit,
    allowChannelCloning,
    allowChannelCreation: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowChannelCreation],
      ENVIRONMENT_NAMES.allowChannelCreation,
    ),
    allowChannelMetadataChanges: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowChannelMetadataChanges],
      ENVIRONMENT_NAMES.allowChannelMetadataChanges,
    ),
    allowChannelOrderingAudit,
    allowChannelOrderingChanges,
    allowDeletions: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowDeletions],
      ENVIRONMENT_NAMES.allowDeletions,
    ),
    allowGateway,
    allowGuildExpressionAudit,
    allowGuildExpressionChanges,
    allowGuildScaffolds: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowGuildScaffolds],
      ENVIRONMENT_NAMES.allowGuildScaffolds,
    ),
    allowGuildSettingsAudit,
    allowGuildSettingsChanges,
    allowGuildTemplateAudit,
    allowGuildTemplateChanges,
    allowIntegrationAudit,
    allowIntegrationDeletions,
    allowForumPosts: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowForumPosts],
      ENVIRONMENT_NAMES.allowForumPosts,
    ),
    allowForumTagAudit,
    allowForumTagChanges,
    allowInteractions: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowInteractions],
      ENVIRONMENT_NAMES.allowInteractions,
    ),
    allowInviteAudit,
    allowInviteDeletions,
    allowMemberDirectory: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowMemberDirectory],
      ENVIRONMENT_NAMES.allowMemberDirectory,
    ),
    allowMemberRoleChanges,
    allowNativeCommandChanges,
    allowNativeInteractions,
    allowMemberVoiceAudit,
    allowMemberVoiceChanges,
    allowMessageForwarding,
    allowOnboardingAudit,
    allowOnboardingChanges,
    allowPermissionOverwrites: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowPermissionOverwrites],
      ENVIRONMENT_NAMES.allowPermissionOverwrites,
    ),
    allowPinManagement: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowPinManagement],
      ENVIRONMENT_NAMES.allowPinManagement,
    ),
    allowPollAudit,
    allowPollCreation,
    allowPollEnding,
    allowPollVoterAudit,
    allowReactionModeration,
    allowReactionUserAudit,
    allowRoleCreation: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowRoleCreation],
      ENVIRONMENT_NAMES.allowRoleCreation,
    ),
    allowRoleConfiguration: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowRoleConfiguration],
      ENVIRONMENT_NAMES.allowRoleConfiguration,
    ),
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
    allowThreadCreation: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowThreadCreation],
      ENVIRONMENT_NAMES.allowThreadCreation,
    ),
    allowThreadAudit,
    allowThreadChanges,
    allowWelcomeScreenAudit,
    allowWelcomeScreenChanges,
    allowWebhookAudit,
    allowWebhookChanges,
    allowWebhookCreation,
    allowWebhookDeletions,
    allowWidgetPublicExposure,
    allowWidgetSettingsAudit,
    allowWidgetSettingsChanges,
    auditFile: resolveConnectorAuditFile(environment, options),
    attachmentChannelIds,
    attachmentMaxBytes: parseInteger(
      environment[ENVIRONMENT_NAMES.attachmentMaxBytes],
      ENVIRONMENT_NAMES.attachmentMaxBytes,
      DISCORD_LIMITS.attachmentBytes,
      1,
      DISCORD_LIMITS.attachmentBytes,
    ),
    attachmentRoots: parseOwnedRoots(
      environment[ENVIRONMENT_NAMES.attachmentRoots],
      ENVIRONMENT_NAMES.attachmentRoots,
    ),
    automodAlertChannelIds,
    automodGuildIds,
    banAuditGuildIds,
    channelCloneGuildIds,
    channelCloneSourceIds,
    channelCreationGuildIds,
    channelMetadataIds,
    channelOrderingGuildIds,
    deleteChannelIds,
    expectedApplicationId,
    expectedBotId,
    forumPostChannelIds,
    forumTagChannelIds,
    gatewayEventBufferSize: parseInteger(
      environment[ENVIRONMENT_NAMES.gatewayEventBufferSize],
      ENVIRONMENT_NAMES.gatewayEventBufferSize,
      GATEWAY_DEFAULTS.eventBufferSize,
      1,
      CONNECTOR_LIMITS.gatewayEventBufferSize,
    ),
    guildScaffoldGuildIds,
    guildExpressionGuildIds,
    guildExpressionRoots: parseOwnedRoots(
      environment[ENVIRONMENT_NAMES.guildExpressionRoots],
      ENVIRONMENT_NAMES.guildExpressionRoots,
    ),
    guildSettingsGuildIds,
    guildTemplateGuildIds,
    integrationGuildIds,
    integrationIds,
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
    inviteGuildIds,
    mentionUserIds,
    memberDirectoryGuildIds,
    memberRoleGuildIds,
    memberRoleIds,
    memberVoiceChannelIds,
    memberVoiceGuildIds,
    messageForwardSourceChannelIds,
    messageForwardTargetChannelIds,
    nativeCommandName,
    nativeInteractionChannelIds,
    nativeInteractionGuildIds,
    nativeInteractionMaxPending: parseInteger(
      environment[ENVIRONMENT_NAMES.nativeInteractionMaxPending],
      ENVIRONMENT_NAMES.nativeInteractionMaxPending,
      NATIVE_INTERACTION_DEFAULTS.maximumPending,
      1,
      CONNECTOR_LIMITS.nativeInteractionMaxPending,
    ),
    nativeInteractionTtlSeconds: parseInteger(
      environment[ENVIRONMENT_NAMES.nativeInteractionTtlSeconds],
      ENVIRONMENT_NAMES.nativeInteractionTtlSeconds,
      NATIVE_INTERACTION_DEFAULTS.ttlSeconds,
      NATIVE_INTERACTION_LIMITS.minimumTtlSeconds,
      NATIVE_INTERACTION_LIMITS.maximumTtlSeconds,
    ),
    nativeInteractionUserIds,
    mcpToolsets: parseMcpToolsets(
      environment[ENVIRONMENT_NAMES.toolsets],
      ENVIRONMENT_NAMES.toolsets,
    ),
    mcpToolSurface: parseMcpToolSurface(
      environment[ENVIRONMENT_NAMES.toolSurface],
      ENVIRONMENT_NAMES.toolSurface,
    ),
    observability: loadObservabilityConfig(environment, [rawToken || "", token]),
    onboardingGuildIds,
    permissionOverwriteChannelIds,
    protectedUserIds,
    pinChannelIds,
    pollChannelIds,
    reactionChannelIds,
    roleCreationGuildIds,
    roleConfigurationIds,
    roleOrderingGuildIds,
    scheduledEventGuildIds,
    scheduledEventRoots: parseOwnedRoots(
      environment[ENVIRONMENT_NAMES.scheduledEventRoots],
      ENVIRONMENT_NAMES.scheduledEventRoots,
    ),
    soundboardGuildIds,
    soundboardRoots: parseOwnedRoots(
      environment[ENVIRONMENT_NAMES.soundboardRoots],
      ENVIRONMENT_NAMES.soundboardRoots,
    ),
    stageChannelIds,
    token,
    threadParentIds,
    threadGuildIds,
    threadIds,
    threadMemberUserIds,
    welcomeScreenGuildIds,
    webhookChannelIds,
    widgetSettingsGuildIds,
  }
}
