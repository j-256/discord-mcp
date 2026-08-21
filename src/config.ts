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
  allowAttachments: boolean
  allowAutomodAudit: boolean
  allowAutomodChanges: boolean
  allowBanAudit: boolean
  allowChannelCreation: boolean
  allowDeletions: boolean
  allowForumPosts: boolean
  allowGateway: boolean
  allowGuildExpressionAudit: boolean
  allowGuildExpressionChanges: boolean
  allowGuildScaffolds: boolean
  allowInteractions: boolean
  allowInviteAudit: boolean
  allowInviteDeletions: boolean
  allowMemberDirectory: boolean
  allowMemberRoleChanges: boolean
  allowOnboardingAudit: boolean
  allowOnboardingChanges: boolean
  allowPermissionOverwrites: boolean
  allowPinManagement: boolean
  allowRoleCreation: boolean
  allowScheduledEventAudit: boolean
  allowScheduledEventChanges: boolean
  allowWebhookAudit: boolean
  allowWebhookDeletions: boolean
  auditFile: string
  attachmentChannelIds: ReadonlySet<string>
  attachmentMaxBytes: number
  attachmentRoots: readonly string[]
  automodAlertChannelIds: ReadonlySet<string>
  automodGuildIds: ReadonlySet<string>
  banAuditGuildIds: ReadonlySet<string>
  channelCreationGuildIds: ReadonlySet<string>
  deleteChannelIds: ReadonlySet<string>
  expectedApplicationId: string | undefined
  expectedBotId: string | undefined
  forumPostChannelIds: ReadonlySet<string>
  gatewayEventBufferSize: number
  guildScaffoldGuildIds: ReadonlySet<string>
  guildExpressionGuildIds: ReadonlySet<string>
  guildExpressionRoots: readonly string[]
  interactionChannelIds: ReadonlySet<string>
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  inviteGuildIds: ReadonlySet<string>
  mentionUserIds: ReadonlySet<string>
  memberDirectoryGuildIds: ReadonlySet<string>
  memberRoleGuildIds: ReadonlySet<string>
  memberRoleIds: ReadonlySet<string>
  mcpToolsets: ReadonlySet<McpToolsetName>
  mcpToolSurface: McpToolSurface
  observability: ObservabilityConfig
  onboardingGuildIds: ReadonlySet<string>
  permissionOverwriteChannelIds: ReadonlySet<string>
  protectedUserIds: ReadonlySet<string>
  pinChannelIds: ReadonlySet<string>
  roleCreationGuildIds: ReadonlySet<string>
  scheduledEventGuildIds: ReadonlySet<string>
  scheduledEventRoots: readonly string[]
  token: string
  webhookChannelIds: ReadonlySet<string>
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
  const attachmentChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.attachmentChannelIds],
    ENVIRONMENT_NAMES.attachmentChannelIds,
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
  const forumPostChannelIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.forumPostChannelIds],
    ENVIRONMENT_NAMES.forumPostChannelIds,
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
  const protectedUserIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.protectedUserIds],
    ENVIRONMENT_NAMES.protectedUserIds,
    CONNECTOR_LIMITS.protectedUserAllowlist,
  )
  const roleCreationGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.roleCreationGuildIds],
    ENVIRONMENT_NAMES.roleCreationGuildIds,
  )
  const guildScaffoldGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.guildScaffoldGuildIds],
    ENVIRONMENT_NAMES.guildScaffoldGuildIds,
  )
  const guildExpressionGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.guildExpressionGuildIds],
    ENVIRONMENT_NAMES.guildExpressionGuildIds,
  )
  const scheduledEventGuildIds = parseIdSet(
    environment[ENVIRONMENT_NAMES.scheduledEventGuildIds],
    ENVIRONMENT_NAMES.scheduledEventGuildIds,
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
    [ENVIRONMENT_NAMES.guildScaffoldGuildIds, guildScaffoldGuildIds],
    [ENVIRONMENT_NAMES.guildExpressionGuildIds, guildExpressionGuildIds],
    [ENVIRONMENT_NAMES.inviteGuildIds, inviteGuildIds],
    [ENVIRONMENT_NAMES.onboardingGuildIds, onboardingGuildIds],
    [ENVIRONMENT_NAMES.memberDirectoryGuildIds, memberDirectoryGuildIds],
    [ENVIRONMENT_NAMES.memberRoleGuildIds, memberRoleGuildIds],
    [ENVIRONMENT_NAMES.roleCreationGuildIds, roleCreationGuildIds],
    [ENVIRONMENT_NAMES.scheduledEventGuildIds, scheduledEventGuildIds],
  ] as const) {
    for (const guildId of guildIds) {
      if (allowedGuildIds.size === 0 || allowedGuildIds.has(guildId)) continue
      throw new ConfigurationError(
        `${name} must be a subset of ${ENVIRONMENT_NAMES.allowedGuildIds}`,
      )
    }
  }

  for (const [name, channelIds] of [
    [ENVIRONMENT_NAMES.attachmentChannelIds, attachmentChannelIds],
    [ENVIRONMENT_NAMES.automodAlertChannelIds, automodAlertChannelIds],
    [ENVIRONMENT_NAMES.deleteChannelIds, deleteChannelIds],
    [ENVIRONMENT_NAMES.forumPostChannelIds, forumPostChannelIds],
    [ENVIRONMENT_NAMES.interactionChannelIds, interactionChannelIds],
    [ENVIRONMENT_NAMES.permissionOverwriteChannelIds, permissionOverwriteChannelIds],
    [ENVIRONMENT_NAMES.pinChannelIds, pinChannelIds],
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
  const allowGateway = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowGateway],
    ENVIRONMENT_NAMES.allowGateway,
  )
  if (allowGateway && (!expectedApplicationId || !expectedBotId)) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGateway} requires ${ENVIRONMENT_NAMES.applicationId} and ${ENVIRONMENT_NAMES.botId}`,
    )
  }
  if (allowGateway && allowedGuildIds.size === 0 && allowedChannelIds.size === 0) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowGateway} requires an exact guild or channel read allowlist`,
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
  const allowWebhookDeletions = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowWebhookDeletions],
    ENVIRONMENT_NAMES.allowWebhookDeletions,
  )
  if (allowWebhookDeletions && !allowWebhookAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowWebhookDeletions} requires ${ENVIRONMENT_NAMES.allowWebhookAudit}`,
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
  const allowScheduledEventAudit = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowScheduledEventAudit],
    ENVIRONMENT_NAMES.allowScheduledEventAudit,
  )
  const allowScheduledEventChanges = parseBoolean(
    environment[ENVIRONMENT_NAMES.allowScheduledEventChanges],
    ENVIRONMENT_NAMES.allowScheduledEventChanges,
  )
  if (allowScheduledEventChanges && !allowScheduledEventAudit) {
    throw new ConfigurationError(
      `${ENVIRONMENT_NAMES.allowScheduledEventChanges} requires ${ENVIRONMENT_NAMES.allowScheduledEventAudit}`,
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
    allowChannelCreation: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowChannelCreation],
      ENVIRONMENT_NAMES.allowChannelCreation,
    ),
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
    allowForumPosts: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowForumPosts],
      ENVIRONMENT_NAMES.allowForumPosts,
    ),
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
    allowMemberRoleChanges: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowMemberRoleChanges],
      ENVIRONMENT_NAMES.allowMemberRoleChanges,
    ),
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
    allowRoleCreation: parseBoolean(
      environment[ENVIRONMENT_NAMES.allowRoleCreation],
      ENVIRONMENT_NAMES.allowRoleCreation,
    ),
    allowScheduledEventAudit,
    allowScheduledEventChanges,
    allowWebhookAudit,
    allowWebhookDeletions,
    auditFile: auditFile(
      environment[ENVIRONMENT_NAMES.auditFile],
      environment,
      options.homeDirectory || homedir(),
    ),
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
    channelCreationGuildIds,
    deleteChannelIds,
    expectedApplicationId,
    expectedBotId,
    forumPostChannelIds,
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
    roleCreationGuildIds,
    scheduledEventGuildIds,
    scheduledEventRoots: parseOwnedRoots(
      environment[ENVIRONMENT_NAMES.scheduledEventRoots],
      ENVIRONMENT_NAMES.scheduledEventRoots,
    ),
    token,
    webhookChannelIds,
  }
}
