import type { ConnectorConfig } from "./config.js"
import {
  DISCORD_CHANNEL_TYPES,
  GATEWAY_DEFAULTS,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { PolicyError } from "./errors.js"
import type { DiscordChannel, DiscordGuild } from "./types.js"

export interface PolicyDescription {
  administrationEnabled: boolean
  administrationGuildIds: string[]
  allowedChannelIds: string[]
  allowedGuildIds: string[]
  attachmentChannelIds: string[]
  attachmentMaxBytes: number
  attachmentRootCount: number
  attachmentsEnabled: boolean
  automodAlertChannelIds: string[]
  automodAuditEnabled: boolean
  automodChangesEnabled: boolean
  automodGuildIds: string[]
  banAuditEnabled: boolean
  banAuditGuildIds: string[]
  channelCreationEnabled: boolean
  channelCreationGuildIds: string[]
  channelMetadataChangesEnabled: boolean
  channelMetadataIds: string[]
  deleteChannelIds: string[]
  deletionsEnabled: boolean
  forumPostChannelIds: string[]
  forumPostsEnabled: boolean
  gatewayEnabled: boolean
  gatewayEventBufferSize: number
  guildScaffoldGuildIds: string[]
  guildScaffoldsEnabled: boolean
  guildExpressionAuditEnabled: boolean
  guildExpressionChangesEnabled: boolean
  guildExpressionCreationEnabled: boolean
  guildExpressionGuildIds: string[]
  guildExpressionRootCount: number
  interactionChannelIds: string[]
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  interactionsEnabled: boolean
  inviteAuditEnabled: boolean
  inviteDeletionsEnabled: boolean
  inviteGuildIds: string[]
  memberDirectoryEnabled: boolean
  memberDirectoryGuildIds: string[]
  memberRoleChangesEnabled: boolean
  memberRoleGuildIds: string[]
  memberRoleCount: number
  mentionUserCount: number
  mcpToolsets: McpToolsetName[]
  mcpToolSurface: McpToolSurface
  onboardingAuditEnabled: boolean
  onboardingChangesEnabled: boolean
  onboardingGuildIds: string[]
  permissionOverwriteChannelIds: string[]
  permissionOverwritesEnabled: boolean
  protectedUserCount: number
  pinChannelIds: string[]
  pinManagementEnabled: boolean
  readChannelScope: "all-visible" | "allowlist"
  readGuildScope: "all-visible" | "allowlist"
  roleCreationEnabled: boolean
  roleCreationGuildIds: string[]
  roleConfigurationEnabled: boolean
  roleConfigurationIds: string[]
  scheduledEventAuditEnabled: boolean
  scheduledEventChangesEnabled: boolean
  scheduledEventCoverChangesEnabled: boolean
  scheduledEventGuildIds: string[]
  scheduledEventRootCount: number
  webhookAuditEnabled: boolean
  webhookChannelIds: string[]
  webhookDeletionsEnabled: boolean
}

const WEBHOOK_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])

export class ScopePolicy {
  readonly #adminGuildIds: ReadonlySet<string>
  readonly #allowedChannelIds: ReadonlySet<string>
  readonly #allowedGuildIds: ReadonlySet<string>
  readonly #allowAdministration: boolean
  readonly #allowAttachments: boolean
  readonly #allowAutomodAudit: boolean
  readonly #allowAutomodChanges: boolean
  readonly #allowBanAudit: boolean
  readonly #allowChannelCreation: boolean
  readonly #allowChannelMetadataChanges: boolean
  readonly #allowDeletions: boolean
  readonly #allowInteractions: boolean
  readonly #allowInviteAudit: boolean
  readonly #allowInviteDeletions: boolean
  readonly #allowMemberDirectory: boolean
  readonly #allowMemberRoleChanges: boolean
  readonly #allowOnboardingAudit: boolean
  readonly #allowOnboardingChanges: boolean
  readonly #allowPermissionOverwrites: boolean
  readonly #allowPinManagement: boolean
  readonly #allowGateway: boolean
  readonly #allowGuildExpressionAudit: boolean
  readonly #allowGuildExpressionChanges: boolean
  readonly #allowGuildScaffolds: boolean
  readonly #allowForumPosts: boolean
  readonly #allowRoleCreation: boolean
  readonly #allowRoleConfiguration: boolean
  readonly #allowScheduledEventAudit: boolean
  readonly #allowScheduledEventChanges: boolean
  readonly #allowWebhookAudit: boolean
  readonly #allowWebhookDeletions: boolean
  readonly #deleteChannelIds: ReadonlySet<string>
  readonly #attachmentChannelIds: ReadonlySet<string>
  readonly #attachmentMaxBytes: number
  readonly #attachmentRoots: readonly string[]
  readonly #automodAlertChannelIds: ReadonlySet<string>
  readonly #automodGuildIds: ReadonlySet<string>
  readonly #banAuditGuildIds: ReadonlySet<string>
  readonly #channelCreationGuildIds: ReadonlySet<string>
  readonly #channelMetadataIds: ReadonlySet<string>
  readonly #interactionChannelIds: ReadonlySet<string>
  readonly #interactionMaxWritesPerMinute: number
  readonly #interactionMinWriteIntervalMs: number
  readonly #inviteGuildIds: ReadonlySet<string>
  readonly #gatewayEventBufferSize: number
  readonly #guildScaffoldGuildIds: ReadonlySet<string>
  readonly #guildExpressionGuildIds: ReadonlySet<string>
  readonly #guildExpressionRoots: readonly string[]
  readonly #forumPostChannelIds: ReadonlySet<string>
  readonly #mentionUserIds: ReadonlySet<string>
  readonly #memberDirectoryGuildIds: ReadonlySet<string>
  readonly #memberRoleGuildIds: ReadonlySet<string>
  readonly #memberRoleIds: ReadonlySet<string>
  readonly #mcpToolsets: ReadonlySet<McpToolsetName>
  readonly #mcpToolSurface: McpToolSurface
  readonly #onboardingGuildIds: ReadonlySet<string>
  readonly #permissionOverwriteChannelIds: ReadonlySet<string>
  readonly #protectedUserIds: ReadonlySet<string>
  readonly #pinChannelIds: ReadonlySet<string>
  readonly #roleCreationGuildIds: ReadonlySet<string>
  readonly #roleConfigurationIds: ReadonlySet<string>
  readonly #scheduledEventGuildIds: ReadonlySet<string>
  readonly #scheduledEventRoots: readonly string[]
  readonly #webhookChannelIds: ReadonlySet<string>

  constructor(config: Pick<
    ConnectorConfig,
    | "adminGuildIds"
    | "allowedChannelIds"
    | "allowedGuildIds"
    | "allowAdministration"
    | "allowDeletions"
    | "allowInteractions"
    | "deleteChannelIds"
    | "interactionChannelIds"
    | "interactionMaxWritesPerMinute"
    | "interactionMinWriteIntervalMs"
    | "mentionUserIds"
    | "protectedUserIds"
  > & Partial<Pick<
    ConnectorConfig,
    | "allowAttachments"
    | "allowAutomodAudit"
    | "allowAutomodChanges"
    | "allowBanAudit"
    | "allowChannelMetadataChanges"
    | "allowGateway"
    | "allowGuildExpressionAudit"
    | "allowGuildExpressionChanges"
    | "allowInviteAudit"
    | "allowInviteDeletions"
    | "allowMemberDirectory"
    | "allowMemberRoleChanges"
    | "allowOnboardingAudit"
    | "allowOnboardingChanges"
    | "allowGuildScaffolds"
    | "allowPermissionOverwrites"
    | "allowPinManagement"
    | "allowForumPosts"
    | "allowChannelCreation"
    | "allowRoleCreation"
    | "allowRoleConfiguration"
    | "allowScheduledEventAudit"
    | "allowScheduledEventChanges"
    | "allowWebhookAudit"
    | "allowWebhookDeletions"
    | "channelCreationGuildIds"
    | "channelMetadataIds"
    | "attachmentChannelIds"
    | "attachmentMaxBytes"
    | "attachmentRoots"
    | "automodAlertChannelIds"
    | "automodGuildIds"
    | "banAuditGuildIds"
    | "gatewayEventBufferSize"
    | "guildScaffoldGuildIds"
    | "guildExpressionGuildIds"
    | "guildExpressionRoots"
    | "inviteGuildIds"
    | "memberDirectoryGuildIds"
    | "memberRoleGuildIds"
    | "memberRoleIds"
    | "forumPostChannelIds"
    | "mcpToolsets"
    | "mcpToolSurface"
    | "onboardingGuildIds"
    | "permissionOverwriteChannelIds"
    | "pinChannelIds"
    | "roleCreationGuildIds"
    | "roleConfigurationIds"
    | "scheduledEventGuildIds"
    | "scheduledEventRoots"
    | "webhookChannelIds"
  >>) {
    this.#adminGuildIds = config.adminGuildIds
    this.#allowedChannelIds = config.allowedChannelIds
    this.#allowedGuildIds = config.allowedGuildIds
    this.#allowAdministration = config.allowAdministration
    this.#allowAttachments = config.allowAttachments ?? false
    this.#allowAutomodAudit = config.allowAutomodAudit ?? false
    this.#allowAutomodChanges = config.allowAutomodChanges ?? false
    this.#allowBanAudit = config.allowBanAudit ?? false
    this.#allowChannelCreation = config.allowChannelCreation ?? false
    this.#allowChannelMetadataChanges = config.allowChannelMetadataChanges ?? false
    this.#allowDeletions = config.allowDeletions
    this.#allowInteractions = config.allowInteractions
    this.#allowInviteAudit = config.allowInviteAudit ?? false
    this.#allowInviteDeletions = config.allowInviteDeletions ?? false
    this.#allowMemberDirectory = config.allowMemberDirectory ?? false
    this.#allowMemberRoleChanges = config.allowMemberRoleChanges ?? false
    this.#allowOnboardingAudit = config.allowOnboardingAudit ?? false
    this.#allowOnboardingChanges = config.allowOnboardingChanges ?? false
    this.#allowPermissionOverwrites = config.allowPermissionOverwrites ?? false
    this.#allowPinManagement = config.allowPinManagement ?? false
    this.#allowGateway = config.allowGateway ?? false
    this.#allowGuildExpressionAudit = config.allowGuildExpressionAudit ?? false
    this.#allowGuildExpressionChanges = config.allowGuildExpressionChanges ?? false
    this.#allowGuildScaffolds = config.allowGuildScaffolds ?? false
    this.#allowForumPosts = config.allowForumPosts ?? false
    this.#allowRoleCreation = config.allowRoleCreation ?? false
    this.#allowRoleConfiguration = config.allowRoleConfiguration ?? false
    this.#allowScheduledEventAudit = config.allowScheduledEventAudit ?? false
    this.#allowScheduledEventChanges = config.allowScheduledEventChanges ?? false
    this.#allowWebhookAudit = config.allowWebhookAudit ?? false
    this.#allowWebhookDeletions = config.allowWebhookDeletions ?? false
    this.#deleteChannelIds = config.deleteChannelIds
    this.#attachmentChannelIds = config.attachmentChannelIds ?? new Set()
    this.#attachmentMaxBytes = config.attachmentMaxBytes ?? 0
    this.#attachmentRoots = config.attachmentRoots ?? []
    this.#automodAlertChannelIds = config.automodAlertChannelIds ?? new Set()
    this.#automodGuildIds = config.automodGuildIds ?? new Set()
    this.#banAuditGuildIds = config.banAuditGuildIds ?? new Set()
    this.#channelCreationGuildIds = config.channelCreationGuildIds ?? new Set()
    this.#channelMetadataIds = config.channelMetadataIds ?? new Set()
    this.#interactionChannelIds = config.interactionChannelIds
    this.#interactionMaxWritesPerMinute = config.interactionMaxWritesPerMinute
    this.#interactionMinWriteIntervalMs = config.interactionMinWriteIntervalMs
    this.#inviteGuildIds = config.inviteGuildIds ?? new Set()
    this.#gatewayEventBufferSize = config.gatewayEventBufferSize
      ?? GATEWAY_DEFAULTS.eventBufferSize
    this.#guildScaffoldGuildIds = config.guildScaffoldGuildIds ?? new Set()
    this.#guildExpressionGuildIds = config.guildExpressionGuildIds ?? new Set()
    this.#guildExpressionRoots = config.guildExpressionRoots ?? []
    this.#forumPostChannelIds = config.forumPostChannelIds ?? new Set()
    this.#mentionUserIds = config.mentionUserIds
    this.#memberDirectoryGuildIds = config.memberDirectoryGuildIds ?? new Set()
    this.#memberRoleGuildIds = config.memberRoleGuildIds ?? new Set()
    this.#memberRoleIds = config.memberRoleIds ?? new Set()
    this.#mcpToolsets = config.mcpToolsets ?? new Set(MCP_TOOLSET_NAMES)
    this.#mcpToolSurface = config.mcpToolSurface ?? "full"
    this.#onboardingGuildIds = config.onboardingGuildIds ?? new Set()
    this.#permissionOverwriteChannelIds = config.permissionOverwriteChannelIds ?? new Set()
    this.#protectedUserIds = config.protectedUserIds
    this.#pinChannelIds = config.pinChannelIds ?? new Set()
    this.#roleCreationGuildIds = config.roleCreationGuildIds ?? new Set()
    this.#roleConfigurationIds = config.roleConfigurationIds ?? new Set()
    this.#scheduledEventGuildIds = config.scheduledEventGuildIds ?? new Set()
    this.#scheduledEventRoots = config.scheduledEventRoots ?? []
    this.#webhookChannelIds = config.webhookChannelIds ?? new Set()
  }

  describe(): PolicyDescription {
    return {
      administrationEnabled: this.#allowAdministration && this.#adminGuildIds.size > 0,
      administrationGuildIds: [...this.#adminGuildIds].sort(),
      allowedChannelIds: [...this.#allowedChannelIds].sort(),
      allowedGuildIds: [...this.#allowedGuildIds].sort(),
      attachmentChannelIds: [...this.#attachmentChannelIds].sort(),
      attachmentMaxBytes: this.#attachmentMaxBytes,
      attachmentRootCount: this.#attachmentRoots.length,
      attachmentsEnabled: this.#allowAttachments
        && this.#attachmentChannelIds.size > 0
        && this.#attachmentRoots.length > 0,
      automodAlertChannelIds: [...this.#automodAlertChannelIds].sort(),
      automodAuditEnabled: this.#allowAutomodAudit
        && this.#automodGuildIds.size > 0,
      automodChangesEnabled: this.#allowAutomodAudit
        && this.#allowAutomodChanges
        && this.#automodGuildIds.size > 0,
      automodGuildIds: [...this.#automodGuildIds].sort(),
      banAuditEnabled: this.#allowBanAudit && this.#banAuditGuildIds.size > 0,
      banAuditGuildIds: [...this.#banAuditGuildIds].sort(),
      channelCreationEnabled: this.#allowChannelCreation
        && this.#channelCreationGuildIds.size > 0,
      channelCreationGuildIds: [...this.#channelCreationGuildIds].sort(),
      channelMetadataChangesEnabled: this.#allowChannelMetadataChanges
        && this.#channelMetadataIds.size > 0,
      channelMetadataIds: [...this.#channelMetadataIds].sort(),
      deleteChannelIds: [...this.#deleteChannelIds].sort(),
      deletionsEnabled: this.#allowDeletions && this.#deleteChannelIds.size > 0,
      gatewayEnabled: this.#allowGateway,
      gatewayEventBufferSize: this.#gatewayEventBufferSize,
      guildScaffoldGuildIds: [...this.#guildScaffoldGuildIds].sort(),
      guildScaffoldsEnabled: this.#allowGuildScaffolds
        && this.#guildScaffoldGuildIds.size > 0,
      guildExpressionAuditEnabled: this.#allowGuildExpressionAudit
        && this.#guildExpressionGuildIds.size > 0,
      guildExpressionChangesEnabled: this.#allowGuildExpressionAudit
        && this.#allowGuildExpressionChanges
        && this.#guildExpressionGuildIds.size > 0,
      guildExpressionCreationEnabled: this.#allowGuildExpressionAudit
        && this.#allowGuildExpressionChanges
        && this.#guildExpressionGuildIds.size > 0
        && this.#guildExpressionRoots.length > 0,
      guildExpressionGuildIds: [...this.#guildExpressionGuildIds].sort(),
      guildExpressionRootCount: this.#guildExpressionRoots.length,
      forumPostChannelIds: [...this.#forumPostChannelIds].sort(),
      forumPostsEnabled: this.#allowForumPosts && this.#forumPostChannelIds.size > 0,
      interactionChannelIds: [...this.#interactionChannelIds].sort(),
      interactionMaxWritesPerMinute: this.#interactionMaxWritesPerMinute,
      interactionMinWriteIntervalMs: this.#interactionMinWriteIntervalMs,
      interactionsEnabled: this.#allowInteractions && this.#interactionChannelIds.size > 0,
      inviteAuditEnabled: this.#allowInviteAudit && this.#inviteGuildIds.size > 0,
      inviteDeletionsEnabled: this.#allowInviteAudit
        && this.#allowInviteDeletions
        && this.#inviteGuildIds.size > 0,
      inviteGuildIds: [...this.#inviteGuildIds].sort(),
      memberDirectoryEnabled: this.#allowMemberDirectory
        && this.#memberDirectoryGuildIds.size > 0,
      memberDirectoryGuildIds: [...this.#memberDirectoryGuildIds].sort(),
      memberRoleChangesEnabled: this.#allowMemberRoleChanges
        && this.#memberRoleGuildIds.size > 0
        && this.#memberRoleIds.size > 0,
      memberRoleGuildIds: [...this.#memberRoleGuildIds].sort(),
      memberRoleCount: this.#memberRoleIds.size,
      mentionUserCount: this.#mentionUserIds.size,
      mcpToolsets: MCP_TOOLSET_NAMES.filter((name) => this.#mcpToolsets.has(name)),
      mcpToolSurface: this.#mcpToolSurface,
      onboardingAuditEnabled: this.#allowOnboardingAudit
        && this.#onboardingGuildIds.size > 0,
      onboardingChangesEnabled: this.#allowOnboardingAudit
        && this.#allowOnboardingChanges
        && this.#onboardingGuildIds.size > 0,
      onboardingGuildIds: [...this.#onboardingGuildIds].sort(),
      permissionOverwriteChannelIds: [...this.#permissionOverwriteChannelIds].sort(),
      permissionOverwritesEnabled: this.#allowPermissionOverwrites
        && this.#permissionOverwriteChannelIds.size > 0,
      protectedUserCount: this.#protectedUserIds.size,
      pinChannelIds: [...this.#pinChannelIds].sort(),
      pinManagementEnabled: this.#allowPinManagement && this.#pinChannelIds.size > 0,
      readChannelScope: this.#allowedChannelIds.size > 0 ? "allowlist" : "all-visible",
      readGuildScope: this.#allowedGuildIds.size > 0 ? "allowlist" : "all-visible",
      roleCreationEnabled: this.#allowRoleCreation
        && this.#roleCreationGuildIds.size > 0,
      roleCreationGuildIds: [...this.#roleCreationGuildIds].sort(),
      roleConfigurationEnabled: this.#allowRoleConfiguration
        && this.#roleConfigurationIds.size > 0,
      roleConfigurationIds: [...this.#roleConfigurationIds].sort(),
      scheduledEventAuditEnabled: this.#allowScheduledEventAudit
        && this.#scheduledEventGuildIds.size > 0,
      scheduledEventChangesEnabled: this.#allowScheduledEventAudit
        && this.#allowScheduledEventChanges
        && this.#scheduledEventGuildIds.size > 0,
      scheduledEventCoverChangesEnabled: this.#allowScheduledEventAudit
        && this.#allowScheduledEventChanges
        && this.#scheduledEventGuildIds.size > 0
        && this.#scheduledEventRoots.length > 0,
      scheduledEventGuildIds: [...this.#scheduledEventGuildIds].sort(),
      scheduledEventRootCount: this.#scheduledEventRoots.length,
      webhookAuditEnabled: this.#allowWebhookAudit
        && this.#webhookChannelIds.size > 0,
      webhookChannelIds: [...this.#webhookChannelIds].sort(),
      webhookDeletionsEnabled: this.#allowWebhookAudit
        && this.#allowWebhookDeletions
        && this.#webhookChannelIds.size > 0,
    }
  }

  filterGuilds(guilds: readonly DiscordGuild[]): DiscordGuild[] {
    return guilds.filter((guild) => this.guildAllowed(guild.id))
  }

  filterChannels(channels: readonly DiscordChannel[]): DiscordChannel[] {
    return channels.filter((channel) => this.channelIdReadable(
      channel.id,
      channel.parent_id,
    ))
  }

  guildAllowed(guildId: string): boolean {
    return this.#allowedGuildIds.size === 0 || this.#allowedGuildIds.has(guildId)
  }

  assertGuildAllowed(guildId: string): void {
    if (!this.guildAllowed(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the configured read scope`)
    }
  }

  assertMemberDirectoryAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowMemberDirectory) {
      throw new PolicyError("Discord member directory is disabled by connector configuration")
    }
    if (this.#memberDirectoryGuildIds.size === 0) {
      throw new PolicyError("Discord member directory requires an explicit guild allowlist")
    }
    if (!this.#memberDirectoryGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the member-directory scope`)
    }
  }

  assertBanAuditAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowBanAudit) {
      throw new PolicyError("Discord ban audit is disabled by connector configuration")
    }
    if (this.#banAuditGuildIds.size === 0) {
      throw new PolicyError("Discord ban audit requires an explicit guild allowlist")
    }
    if (!this.#banAuditGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the ban-audit scope`)
    }
  }

  assertGuildInviteAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowInviteAudit) {
      throw new PolicyError("Discord invite audit is disabled by connector configuration")
    }
    if (this.#inviteGuildIds.size === 0) {
      throw new PolicyError("Discord invite audit requires an explicit guild allowlist")
    }
    if (!this.#inviteGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the invite-audit scope`)
    }
  }

  assertGuildInviteDeletable(guildId: string): void {
    this.assertGuildInviteAuditable(guildId)
    if (!this.#allowInviteDeletions) {
      throw new PolicyError("Discord invite deletion is disabled by connector configuration")
    }
  }

  assertGuildOnboardingAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowOnboardingAudit) {
      throw new PolicyError("Discord onboarding audit is disabled by connector configuration")
    }
    if (this.#onboardingGuildIds.size === 0) {
      throw new PolicyError("Discord onboarding audit requires an explicit guild allowlist")
    }
    if (!this.#onboardingGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the onboarding-audit scope`)
    }
  }

  assertGuildOnboardingChangeable(guildId: string): void {
    this.assertGuildOnboardingAuditable(guildId)
    if (!this.#allowOnboardingChanges) {
      throw new PolicyError("Discord onboarding changes are disabled by connector configuration")
    }
  }

  assertMemberAdministrationAllowed(guildId: string, userId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowAdministration) {
      throw new PolicyError("Discord administration is disabled by connector configuration")
    }
    if (this.#adminGuildIds.size === 0) {
      throw new PolicyError("Discord administration requires an explicit guild allowlist")
    }
    if (!this.#adminGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the administration scope`)
    }
    this.assertUserNotProtected(userId)
  }

  assertMemberRoleChangeAllowed(
    guildId: string,
    userId: string,
    roleId: string,
  ): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowMemberRoleChanges) {
      throw new PolicyError("Discord member-role changes are disabled by connector configuration")
    }
    if (this.#memberRoleGuildIds.size === 0) {
      throw new PolicyError("Discord member-role changes require an explicit guild allowlist")
    }
    if (!this.#memberRoleGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the member-role scope`)
    }
    if (this.#memberRoleIds.size === 0) {
      throw new PolicyError("Discord member-role changes require an exact role allowlist")
    }
    if (!this.#memberRoleIds.has(roleId)) {
      throw new PolicyError(`Discord role ${roleId} is outside the member-role scope`)
    }
    this.assertUserNotProtected(userId)
  }

  assertUserNotProtected(userId: string): void {
    if (this.#protectedUserIds.has(userId)) {
      throw new PolicyError(`Discord user ${userId} is protected from administration`)
    }
  }

  assertChannelCreationAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowChannelCreation) {
      throw new PolicyError("Discord channel creation is disabled by connector configuration")
    }
    if (this.#channelCreationGuildIds.size === 0) {
      throw new PolicyError("Discord channel creation requires an explicit guild allowlist")
    }
    if (!this.#channelCreationGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the channel creation scope`)
    }
  }

  assertRoleCreationAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowRoleCreation) {
      throw new PolicyError("Discord role creation is disabled by connector configuration")
    }
    if (this.#roleCreationGuildIds.size === 0) {
      throw new PolicyError("Discord role creation requires an explicit guild allowlist")
    }
    if (!this.#roleCreationGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the role creation scope`)
    }
  }

  assertRoleConfigurationAllowed(guildId: string, roleId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowRoleConfiguration) {
      throw new PolicyError("Discord role configuration is disabled by connector configuration")
    }
    if (this.#roleConfigurationIds.size === 0) {
      throw new PolicyError("Discord role configuration requires an explicit role allowlist")
    }
    if (!this.#roleConfigurationIds.has(roleId)) {
      throw new PolicyError(`Discord role ${roleId} is outside the role-configuration scope`)
    }
  }

  assertGuildScaffoldAllowed(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildScaffolds) {
      throw new PolicyError("Discord guild scaffolds are disabled by connector configuration")
    }
    if (this.#guildScaffoldGuildIds.size === 0) {
      throw new PolicyError("Discord guild scaffolds require an explicit guild allowlist")
    }
    if (!this.#guildScaffoldGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild scaffold scope`)
    }
  }

  assertGuildExpressionAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowGuildExpressionAudit) {
      throw new PolicyError("Discord guild expression audit is disabled by connector configuration")
    }
    if (this.#guildExpressionGuildIds.size === 0) {
      throw new PolicyError("Discord guild expression audit requires an explicit guild allowlist")
    }
    if (!this.#guildExpressionGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the guild expression scope`)
    }
  }

  assertGuildExpressionChangeAllowed(guildId: string): void {
    this.assertGuildExpressionAuditable(guildId)
    if (!this.#allowGuildExpressionChanges) {
      throw new PolicyError("Discord guild expression changes are disabled by connector configuration")
    }
  }

  assertAutomodAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowAutomodAudit) {
      throw new PolicyError("Discord AutoMod audit is disabled by connector configuration")
    }
    if (this.#automodGuildIds.size === 0) {
      throw new PolicyError("Discord AutoMod audit requires an explicit guild allowlist")
    }
    if (!this.#automodGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the AutoMod scope`)
    }
  }

  assertAutomodChangeAllowed(guildId: string): void {
    this.assertAutomodAuditable(guildId)
    if (!this.#allowAutomodChanges) {
      throw new PolicyError("Discord AutoMod changes are disabled by connector configuration")
    }
  }

  automodAlertChannelAllowed(channelId: string): boolean {
    return this.channelIdReadable(channelId)
      && this.#automodAlertChannelIds.has(channelId)
  }

  assertAutomodAlertChannelAllowed(channelId: string): void {
    if (this.#automodAlertChannelIds.size === 0) {
      throw new PolicyError("Discord AutoMod alerts require an explicit channel allowlist")
    }
    if (!this.automodAlertChannelAllowed(channelId)) {
      throw new PolicyError(`Discord channel ${channelId} is outside the AutoMod alert scope`)
    }
  }

  assertScheduledEventAuditable(guildId: string): void {
    this.assertGuildAllowed(guildId)
    if (!this.#allowScheduledEventAudit) {
      throw new PolicyError("Discord scheduled event audit is disabled by connector configuration")
    }
    if (this.#scheduledEventGuildIds.size === 0) {
      throw new PolicyError("Discord scheduled event audit requires an explicit guild allowlist")
    }
    if (!this.#scheduledEventGuildIds.has(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the scheduled event scope`)
    }
  }

  assertScheduledEventChangeAllowed(guildId: string): void {
    this.assertScheduledEventAuditable(guildId)
    if (!this.#allowScheduledEventChanges) {
      throw new PolicyError("Discord scheduled event changes are disabled by connector configuration")
    }
  }

  channelIdReadable(channelId: string, parentId?: string | null): boolean {
    return this.#allowedChannelIds.size === 0
      || this.#allowedChannelIds.has(channelId)
      || Boolean(parentId && this.#allowedChannelIds.has(parentId))
  }

  constrainSearchChannelIds(
    requestedChannelIds: readonly string[] | undefined,
    maximum: number,
  ): string[] | undefined {
    if (this.#allowedChannelIds.size === 0) {
      return requestedChannelIds ? [...requestedChannelIds] : undefined
    }
    if (requestedChannelIds) {
      for (const channelId of requestedChannelIds) {
        if (!this.#allowedChannelIds.has(channelId)) {
          throw new PolicyError(
            `Discord channel ${channelId} is outside the exact configured search scope`,
          )
        }
      }
      return [...requestedChannelIds]
    }
    if (this.#allowedChannelIds.size > maximum) {
      throw new PolicyError(
        `Configured channel scope exceeds Discord's ${maximum}-channel search filter; provide an exact subset`,
      )
    }
    return [...this.#allowedChannelIds].sort()
  }

  assertChannelReadable(channel: DiscordChannel): string {
    const guildId = channel.guild_id
    if (!guildId) throw new PolicyError("Direct-message channels are outside connector scope")
    this.assertGuildAllowed(guildId)
    if (!this.channelIdReadable(channel.id, channel.parent_id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the configured read scope`)
    }
    return guildId
  }

  assertChannelDeletable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowDeletions) {
      throw new PolicyError("Discord deletion is disabled by connector configuration")
    }
    if (this.#deleteChannelIds.size === 0) {
      throw new PolicyError("Discord deletion requires an explicit deletion-channel allowlist")
    }
    if (!this.#deleteChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the deletion scope`)
    }
    return guildId
  }

  assertChannelMetadataChangeAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowChannelMetadataChanges) {
      throw new PolicyError("Discord channel-metadata changes are disabled by connector configuration")
    }
    if (this.#channelMetadataIds.size === 0) {
      throw new PolicyError("Discord channel-metadata changes require an explicit channel allowlist")
    }
    if (!this.#channelMetadataIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the channel-metadata scope`)
    }
    return guildId
  }

  assertChannelAttachmentAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowAttachments) {
      throw new PolicyError("Discord attachment messages are disabled by connector configuration")
    }
    if (this.#attachmentChannelIds.size === 0) {
      throw new PolicyError(
        "Discord attachment messages require an explicit attachment-channel allowlist",
      )
    }
    if (!this.#attachmentChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the attachment scope`)
    }
    return guildId
  }

  assertChannelInteractable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowInteractions) {
      throw new PolicyError("Discord interactions are disabled by connector configuration")
    }
    if (this.#interactionChannelIds.size === 0) {
      throw new PolicyError("Discord interactions require an explicit interaction-channel allowlist")
    }
    if (!this.#interactionChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the interaction scope`)
    }
    return guildId
  }

  assertChannelPinManageable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowPinManagement) {
      throw new PolicyError("Discord pin management is disabled by connector configuration")
    }
    if (this.#pinChannelIds.size === 0) {
      throw new PolicyError("Discord pin management requires an explicit pin-channel allowlist")
    }
    if (!this.#pinChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the pin-management scope`)
    }
    return guildId
  }

  assertChannelWebhookAuditable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!WEBHOOK_CHANNEL_TYPES.has(channel.type)) {
      throw new PolicyError("Discord channel type does not support webhook inventory")
    }
    if (!this.#allowWebhookAudit) {
      throw new PolicyError("Discord webhook audit is disabled by connector configuration")
    }
    if (this.#webhookChannelIds.size === 0) {
      throw new PolicyError("Discord webhook audit requires an explicit channel allowlist")
    }
    if (!this.#webhookChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the webhook scope`)
    }
    return guildId
  }

  assertChannelWebhookDeletable(channel: DiscordChannel): string {
    const guildId = this.assertChannelWebhookAuditable(channel)
    if (!this.#allowWebhookDeletions) {
      throw new PolicyError("Discord webhook deletion is disabled by connector configuration")
    }
    return guildId
  }

  assertChannelPermissionOverwriteAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowPermissionOverwrites) {
      throw new PolicyError("Discord permission-overwrite changes are disabled by connector configuration")
    }
    if (this.#permissionOverwriteChannelIds.size === 0) {
      throw new PolicyError("Discord permission-overwrite changes require an explicit channel allowlist")
    }
    if (!this.#permissionOverwriteChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the permission-overwrite scope`)
    }
    return guildId
  }

  assertForumPostAllowed(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowForumPosts) {
      throw new PolicyError("Discord forum posts are disabled by connector configuration")
    }
    if (this.#forumPostChannelIds.size === 0) {
      throw new PolicyError("Discord forum posts require an explicit forum-channel allowlist")
    }
    if (!this.#forumPostChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the forum-post scope`)
    }
    return guildId
  }

  assertNotificationUsers(userIds: readonly string[]): void {
    for (const userId of userIds) {
      if (!this.#mentionUserIds.has(userId)) {
        throw new PolicyError(`Discord user ${userId} is outside the notification scope`)
      }
    }
  }
}
