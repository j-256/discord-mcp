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
  channelCreationEnabled: boolean
  channelCreationGuildIds: string[]
  deleteChannelIds: string[]
  deletionsEnabled: boolean
  forumPostChannelIds: string[]
  forumPostsEnabled: boolean
  gatewayEnabled: boolean
  gatewayEventBufferSize: number
  guildScaffoldGuildIds: string[]
  guildScaffoldsEnabled: boolean
  interactionChannelIds: string[]
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  interactionsEnabled: boolean
  memberDirectoryEnabled: boolean
  memberDirectoryGuildIds: string[]
  mentionUserCount: number
  mcpToolsets: McpToolsetName[]
  mcpToolSurface: McpToolSurface
  permissionOverwriteChannelIds: string[]
  permissionOverwritesEnabled: boolean
  protectedUserCount: number
  pinChannelIds: string[]
  pinManagementEnabled: boolean
  readChannelScope: "all-visible" | "allowlist"
  readGuildScope: "all-visible" | "allowlist"
  roleCreationEnabled: boolean
  roleCreationGuildIds: string[]
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
  readonly #allowChannelCreation: boolean
  readonly #allowDeletions: boolean
  readonly #allowInteractions: boolean
  readonly #allowMemberDirectory: boolean
  readonly #allowPermissionOverwrites: boolean
  readonly #allowPinManagement: boolean
  readonly #allowGateway: boolean
  readonly #allowGuildScaffolds: boolean
  readonly #allowForumPosts: boolean
  readonly #allowRoleCreation: boolean
  readonly #allowWebhookAudit: boolean
  readonly #allowWebhookDeletions: boolean
  readonly #deleteChannelIds: ReadonlySet<string>
  readonly #attachmentChannelIds: ReadonlySet<string>
  readonly #attachmentMaxBytes: number
  readonly #attachmentRoots: readonly string[]
  readonly #channelCreationGuildIds: ReadonlySet<string>
  readonly #interactionChannelIds: ReadonlySet<string>
  readonly #interactionMaxWritesPerMinute: number
  readonly #interactionMinWriteIntervalMs: number
  readonly #gatewayEventBufferSize: number
  readonly #guildScaffoldGuildIds: ReadonlySet<string>
  readonly #forumPostChannelIds: ReadonlySet<string>
  readonly #mentionUserIds: ReadonlySet<string>
  readonly #memberDirectoryGuildIds: ReadonlySet<string>
  readonly #mcpToolsets: ReadonlySet<McpToolsetName>
  readonly #mcpToolSurface: McpToolSurface
  readonly #permissionOverwriteChannelIds: ReadonlySet<string>
  readonly #protectedUserIds: ReadonlySet<string>
  readonly #pinChannelIds: ReadonlySet<string>
  readonly #roleCreationGuildIds: ReadonlySet<string>
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
    | "allowGateway"
    | "allowMemberDirectory"
    | "allowGuildScaffolds"
    | "allowPermissionOverwrites"
    | "allowPinManagement"
    | "allowForumPosts"
    | "allowChannelCreation"
    | "allowRoleCreation"
    | "allowWebhookAudit"
    | "allowWebhookDeletions"
    | "channelCreationGuildIds"
    | "attachmentChannelIds"
    | "attachmentMaxBytes"
    | "attachmentRoots"
    | "gatewayEventBufferSize"
    | "guildScaffoldGuildIds"
    | "memberDirectoryGuildIds"
    | "forumPostChannelIds"
    | "mcpToolsets"
    | "mcpToolSurface"
    | "permissionOverwriteChannelIds"
    | "pinChannelIds"
    | "roleCreationGuildIds"
    | "webhookChannelIds"
  >>) {
    this.#adminGuildIds = config.adminGuildIds
    this.#allowedChannelIds = config.allowedChannelIds
    this.#allowedGuildIds = config.allowedGuildIds
    this.#allowAdministration = config.allowAdministration
    this.#allowAttachments = config.allowAttachments ?? false
    this.#allowChannelCreation = config.allowChannelCreation ?? false
    this.#allowDeletions = config.allowDeletions
    this.#allowInteractions = config.allowInteractions
    this.#allowMemberDirectory = config.allowMemberDirectory ?? false
    this.#allowPermissionOverwrites = config.allowPermissionOverwrites ?? false
    this.#allowPinManagement = config.allowPinManagement ?? false
    this.#allowGateway = config.allowGateway ?? false
    this.#allowGuildScaffolds = config.allowGuildScaffolds ?? false
    this.#allowForumPosts = config.allowForumPosts ?? false
    this.#allowRoleCreation = config.allowRoleCreation ?? false
    this.#allowWebhookAudit = config.allowWebhookAudit ?? false
    this.#allowWebhookDeletions = config.allowWebhookDeletions ?? false
    this.#deleteChannelIds = config.deleteChannelIds
    this.#attachmentChannelIds = config.attachmentChannelIds ?? new Set()
    this.#attachmentMaxBytes = config.attachmentMaxBytes ?? 0
    this.#attachmentRoots = config.attachmentRoots ?? []
    this.#channelCreationGuildIds = config.channelCreationGuildIds ?? new Set()
    this.#interactionChannelIds = config.interactionChannelIds
    this.#interactionMaxWritesPerMinute = config.interactionMaxWritesPerMinute
    this.#interactionMinWriteIntervalMs = config.interactionMinWriteIntervalMs
    this.#gatewayEventBufferSize = config.gatewayEventBufferSize
      ?? GATEWAY_DEFAULTS.eventBufferSize
    this.#guildScaffoldGuildIds = config.guildScaffoldGuildIds ?? new Set()
    this.#forumPostChannelIds = config.forumPostChannelIds ?? new Set()
    this.#mentionUserIds = config.mentionUserIds
    this.#memberDirectoryGuildIds = config.memberDirectoryGuildIds ?? new Set()
    this.#mcpToolsets = config.mcpToolsets ?? new Set(MCP_TOOLSET_NAMES)
    this.#mcpToolSurface = config.mcpToolSurface ?? "full"
    this.#permissionOverwriteChannelIds = config.permissionOverwriteChannelIds ?? new Set()
    this.#protectedUserIds = config.protectedUserIds
    this.#pinChannelIds = config.pinChannelIds ?? new Set()
    this.#roleCreationGuildIds = config.roleCreationGuildIds ?? new Set()
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
      channelCreationEnabled: this.#allowChannelCreation
        && this.#channelCreationGuildIds.size > 0,
      channelCreationGuildIds: [...this.#channelCreationGuildIds].sort(),
      deleteChannelIds: [...this.#deleteChannelIds].sort(),
      deletionsEnabled: this.#allowDeletions && this.#deleteChannelIds.size > 0,
      gatewayEnabled: this.#allowGateway,
      gatewayEventBufferSize: this.#gatewayEventBufferSize,
      guildScaffoldGuildIds: [...this.#guildScaffoldGuildIds].sort(),
      guildScaffoldsEnabled: this.#allowGuildScaffolds
        && this.#guildScaffoldGuildIds.size > 0,
      forumPostChannelIds: [...this.#forumPostChannelIds].sort(),
      forumPostsEnabled: this.#allowForumPosts && this.#forumPostChannelIds.size > 0,
      interactionChannelIds: [...this.#interactionChannelIds].sort(),
      interactionMaxWritesPerMinute: this.#interactionMaxWritesPerMinute,
      interactionMinWriteIntervalMs: this.#interactionMinWriteIntervalMs,
      interactionsEnabled: this.#allowInteractions && this.#interactionChannelIds.size > 0,
      memberDirectoryEnabled: this.#allowMemberDirectory
        && this.#memberDirectoryGuildIds.size > 0,
      memberDirectoryGuildIds: [...this.#memberDirectoryGuildIds].sort(),
      mentionUserCount: this.#mentionUserIds.size,
      mcpToolsets: MCP_TOOLSET_NAMES.filter((name) => this.#mcpToolsets.has(name)),
      mcpToolSurface: this.#mcpToolSurface,
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
