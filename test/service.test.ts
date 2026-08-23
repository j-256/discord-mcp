import assert from "node:assert/strict"
import {
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { loadConnectorConfig } from "../src/config.js"
import { DISCORD_MESSAGE_FLAGS } from "../src/constants.js"
import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  DISCORD_SCHEDULED_EVENT_ENTITY_TYPES,
  DISCORD_SCHEDULED_EVENT_STATUSES,
  DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS,
  type DiscordAutoModerationRuleSummary,
  type DiscordGuildIntegrationSummary,
  type DiscordGuildTemplateSummary,
  type DiscordScheduledEventSummary,
  type DiscordSoundboardSoundSummary,
  type DiscordStageInstanceSummary,
  type DiscordThreadStateSummary,
  type DiscordWebhookSummary,
} from "../src/discord-client.js"
import {
  ChannelCreationPlanChangedError,
  ConfigurationError,
  DiscordApiError,
  GuildScaffoldPlanChangedError,
  InteractionRateLimitError,
  PolicyError,
} from "../src/errors.js"
import { GatewayChannelLayoutStore } from "../src/gateway-channel-layout.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  OperationReceipt,
  OperationStore,
} from "../src/operation-store.js"
import { operationKeyHash } from "../src/operation-store.js"
import {
  ConnectorService,
  type ConnectorServiceOptions,
  type DiscordServiceClient,
} from "../src/service.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordUser,
} from "../src/types.js"
import type {
  WriteCoordinationIntent,
  WriteCoordinationRunOptions,
  WriteCoordinator,
} from "../src/write-coordination.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const OTHER_GUILD_ID = "300000000000000002"
const CHANNEL_ID = "400000000000000001"
const OTHER_CHANNEL_ID = "400000000000000002"
const THREAD_ID = "400000000000000003"
const SECOND_THREAD_ID = "400000000000000004"
const MESSAGE_ID = "500000000000000001"
const CREATED_CHANNEL_ID = "400000000000000005"
const CREATED_ROLE_ID = "700000000000000001"
const ANCHOR_ROLE_ID = "700000000000000002"
const FORUM_TAG_ID = "800000000000000001"
const MEMBER_USER_ID = "600000000000000001"
const WEBHOOK_ID = "900000000000000001"
const FOLLOWER_WEBHOOK_ID = "900000000000000002"
const INTEGRATION_ID = "905000000000000001"
const INTEGRATION_APPLICATION_ID = "905000000000000002"
const INTEGRATION_BOT_ID = "905000000000000003"
const AUTOMOD_RULE_ID = "910000000000000001"
const SCHEDULED_EVENT_ID = "930000000000000001"
const SOUNDBOARD_SOUND_ID = "935000000000000001"
const STAGE_INSTANCE_ID = "940000000000000001"

const PASSTHROUGH_WRITE_COORDINATOR: WriteCoordinator = {
  run(_intent, operation) {
    return operation()
  },
}

class CapturingWriteCoordinator implements WriteCoordinator {
  readonly intents: WriteCoordinationIntent[] = []
  readonly options: (WriteCoordinationRunOptions | undefined)[] = []
  readonly stop = new Error("coordination-captured")

  async run<T>(
    intent: WriteCoordinationIntent,
    _operation: () => Promise<T>,
    options?: WriteCoordinationRunOptions,
  ): Promise<T> {
    this.intents.push(intent)
    this.options.push(options)
    throw this.stop
  }
}

class MemoryOperationStore implements OperationStore {
  receipt: OperationReceipt | undefined

  async finish(receipt: OperationReceipt): Promise<void> {
    this.receipt = receipt
  }

  async get(): Promise<OperationReceipt | undefined> {
    return this.receipt
  }

  async reserve(receipt: OperationReceipt) {
    if (this.receipt) return { created: false, receipt: this.receipt }
    this.receipt = receipt
    return { created: true, receipt }
  }
}

function application(id = APPLICATION_ID): DiscordApplication {
  return {
    bot: {
      bot: true,
      id: BOT_ID,
      username: "connector-bot",
    },
    description: "",
    flags: Number(1n << 18n),
    id,
    name: "Connector",
  }
}

function bot(id = BOT_ID): DiscordUser {
  return {
    bot: true,
    id,
    username: "connector-bot",
  }
}

function guild(): DiscordGuild {
  return {
    id: GUILD_ID,
    name: "Test Guild",
    permissions: "65536",
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "general",
    permission_overwrites: [],
    position: 1,
    type: 0,
    ...overrides,
  }
}

function thread(
  id: string,
  parentId = CHANNEL_ID,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return channel({
    id,
    name: `thread-${id}`,
    parent_id: parentId,
    thread_metadata: {
      archive_timestamp: "2026-08-14T00:00:00.000Z",
      archived: false,
      auto_archive_duration: 1_440,
      locked: false,
    },
    type: 11,
    ...overrides,
  })
}

function message(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: false,
      id: "600000000000000001",
      username: "member",
    },
    channel_id: CHANNEL_ID,
    content: "hello",
    embeds: [],
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    timestamp: "2026-08-14T00:00:00.000Z",
    type: 0,
    ...overrides,
  }
}

function role(
  id: string,
  permissions: bigint,
  name = "role",
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    id,
    icon: null,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position: 0,
    unicode_emoji: null,
  }
}

function serviceFixture(overrides: {
  application?: DiscordApplication
  attachmentMessageOptions?: ConnectorServiceOptions["attachmentMessageOptions"]
  automodOptions?: ConnectorServiceOptions["automodOptions"]
  channelAdministrationOptions?: ConnectorServiceOptions["channelAdministrationOptions"]
  channelMetadataOptions?: ConnectorServiceOptions["channelMetadataOptions"]
  channelOrderingOptions?: ConnectorServiceOptions["channelOrderingOptions"]
  componentMessageOptions?: ConnectorServiceOptions["componentMessageOptions"]
  channel?: DiscordChannel
  client?: Partial<DiscordServiceClient>
  environment?: NodeJS.ProcessEnv
  forumPostOptions?: ConnectorServiceOptions["forumPostOptions"]
  forumTagOptions?: ConnectorServiceOptions["forumTagOptions"]
  guildExpressionOptions?: ConnectorServiceOptions["guildExpressionOptions"]
  guildScaffoldOptions?: ConnectorServiceOptions["guildScaffoldOptions"]
  guildTemplateOptions?: ConnectorServiceOptions["guildTemplateOptions"]
  gateway?: ConnectorServiceOptions["gateway"]
  integrationOptions?: ConnectorServiceOptions["integrationOptions"]
  interactionOptions?: ConnectorServiceOptions["interactionOptions"]
  inviteOptions?: ConnectorServiceOptions["inviteOptions"]
  memberRoleOptions?: ConnectorServiceOptions["memberRoleOptions"]
  memberVoiceOptions?: ConnectorServiceOptions["memberVoiceOptions"]
  onboardingOptions?: ConnectorServiceOptions["onboardingOptions"]
  welcomeScreenOptions?: ConnectorServiceOptions["welcomeScreenOptions"]
  widgetSettingsOptions?: ConnectorServiceOptions["widgetSettingsOptions"]
  operationStore?: OperationStore
  permissionOverwriteOptions?: ConnectorServiceOptions["permissionOverwriteOptions"]
  pollOptions?: ConnectorServiceOptions["pollOptions"]
  reactionOptions?: ConnectorServiceOptions["reactionOptions"]
  roleAdministrationOptions?: ConnectorServiceOptions["roleAdministrationOptions"]
  roleConfigurationOptions?: ConnectorServiceOptions["roleConfigurationOptions"]
  roleOrderingOptions?: ConnectorServiceOptions["roleOrderingOptions"]
  scheduledEventOptions?: ConnectorServiceOptions["scheduledEventOptions"]
  soundboardOptions?: ConnectorServiceOptions["soundboardOptions"]
  stageInstanceOptions?: ConnectorServiceOptions["stageInstanceOptions"]
  threadCreationOptions?: ConnectorServiceOptions["threadCreationOptions"]
  threadGovernanceOptions?: ConnectorServiceOptions["threadGovernanceOptions"]
  webhookOptions?: ConnectorServiceOptions["webhookOptions"]
  useDefaultWriteCoordinator?: boolean
  writeCoordinator?: WriteCoordinator
} = {}) {
  const calls = {
    activityAppends: 0,
    activityEntries: [] as ActivityEntry[],
    addReaction: 0,
    application: 0,
    createAttachment: 0,
    createChannel: 0,
    createComponentMessage: 0,
    createForumPost: 0,
    createMessage: 0,
    createRole: 0,
    editMessage: 0,
    editComponentMessage: 0,
    getRole: 0,
    guildAuditLog: 0,
    guilds: 0,
    listMessages: 0,
    removeMember: 0,
    user: 0,
  }
  let ownReaction: string | null = null
  const client: DiscordServiceClient = {
    async addThreadMember() {
      throw new Error("Unexpected thread-member add")
    },
    async addGuildMemberRole() {
      throw new Error("Unexpected member-role add")
    },
    async addOwnReaction(_channelId, _messageId, emoji) {
      calls.addReaction += 1
      ownReaction = emoji
    },
    async bulkDeleteMessages() {},
    async crosspostMessage() {
      throw new Error("unexpected")
    },
    async followAnnouncementChannel() {
      throw new Error("Unexpected announcement subscription")
    },
    async createGuildBan() {},
    async createGuildApplicationCommand() {
      throw new Error("Unexpected application-command creation")
    },
    async createForumPost() {
      calls.createForumPost += 1
      throw new Error("Unexpected forum-post creation")
    },
    async createWebhook() {
      throw new Error("Unexpected webhook creation")
    },
    async createAttachmentMessage(_channelId, input) {
      calls.createAttachment += 1
      return message({
        attachments: [{
          ...(input.description !== undefined ? { description: input.description } : {}),
          filename: input.filename,
          id: "800000000000000001",
          size: input.bytes.byteLength,
          url: "https://cdn.discord.test/private",
        }],
        author: bot(),
        content: input.content ?? "",
        nonce: input.nonce,
      })
    },
    async createComponentMessage() {
      calls.createComponentMessage += 1
      throw new Error("Unexpected component-message creation")
    },
    async createGuildChannel() {
      calls.createChannel += 1
      return channel()
    },
    async createGuildAutoModerationRule() {
      throw new Error("Unexpected AutoMod rule creation")
    },
    async createGuildEmoji(_guildId, input) {
      return {
        animated: input.format === "gif",
        available: true,
        creatorUserId: BOT_ID,
        id: "910000000000000001",
        managed: false,
        name: input.name,
        requiresColons: true,
        roleIds: [...input.roleIds],
      }
    },
    async createGuildRole() {
      calls.createRole += 1
      return role(CREATED_ROLE_ID, 0n, "created")
    },
    async createGuildScheduledEvent() {
      throw new Error("Unexpected scheduled-event creation")
    },
    async createGuildSoundboardSound() {
      throw new Error("Unexpected soundboard creation")
    },
    async createGuildSticker(_guildId, input) {
      return {
        available: true,
        creatorUserId: BOT_ID,
        description: input.description,
        formatType: 1,
        guildId: GUILD_ID,
        id: "920000000000000001",
        name: input.name,
        tags: input.tags,
        type: 2,
      }
    },
    async createGuildTemplate() {
      throw new Error("Unexpected guild-template creation")
    },
    async deleteGuildApplicationCommand() {
      throw new Error("Unexpected application-command deletion")
    },
    async deleteGuildTemplate() {
      throw new Error("Unexpected guild-template deletion")
    },
    async deleteGuildIntegration() {
      throw new Error("Unexpected integration deletion")
    },
    async createMessage(_channelId, input) {
      calls.createMessage += 1
      return message({
        author: bot(),
        content: input.content,
        nonce: input.nonce,
      })
    },
    async createPoll() {
      throw new Error("Unexpected poll creation")
    },
    async createThreadFromMessage() {
      throw new Error("Unexpected anchored thread creation")
    },
    async createThreadWithoutMessage() {
      throw new Error("Unexpected standalone thread creation")
    },
    async createStageInstance() {
      throw new Error("Unexpected Stage-instance creation")
    },
    async deleteAllMessageReactions() {
      throw new Error("Unexpected reaction moderation")
    },
    async deleteAllMessageReactionsForEmoji() {
      throw new Error("Unexpected reaction moderation")
    },
    async deleteChannelPermissionOverwrite() {},
    async deleteMessage() {},
    async deleteGuildEmoji() {},
    async deleteGuildAutoModerationRule() {},
    async deleteGuildScheduledEvent() {},
    async deleteGuildSoundboardSound() {},
    async deleteGuildSticker() {},
    async deleteStageInstance() {},
    async deleteInvite() {
      throw new Error("Unexpected invite deletion")
    },
    async deleteOwnReaction() {
      ownReaction = null
    },
    async deleteUserReaction() {
      throw new Error("Unexpected reaction moderation")
    },
    async deleteWebhook() {},
    async editChannelPermissionOverwrite() {},
    async editComponentMessage() {
      calls.editComponentMessage += 1
      throw new Error("Unexpected component-message edit")
    },
    async editMessage(_channelId, _messageId, input) {
      calls.editMessage += 1
      return message({
        author: bot(),
        content: input.content,
      })
    },
    async endPoll() {
      throw new Error("Unexpected poll ending")
    },
    async getChannel() {
      return overrides.channel || channel()
    },
    async getGuildForumTags() {
      throw new Error("Unexpected forum-tag lookup")
    },
    async getGuildChannelMetadata() {
      throw new Error("Unexpected channel metadata lookup")
    },
    async getCurrentApplication() {
      calls.application += 1
      return overrides.application || application()
    },
    async getCurrentUser() {
      calls.user += 1
      return bot()
    },
    async getGuild() {
      return { ...guild(), owner_id: "700000000000000001" }
    },
    async getGuildAuditLog() {
      calls.guildAuditLog += 1
      return { audit_log_entries: [] }
    },
    async getGuildAutoModerationRule() {
      throw new Error("Unexpected AutoMod rule lookup")
    },
    async getGuildBan(_guildId, userId) {
      return { user: { id: userId, username: "target" } }
    },
    async getGuildChannels() {
      return [channel()]
    },
    async getGuildMember(): Promise<DiscordGuildMember> {
      return { roles: [] }
    },
    async getGuildVoiceState() {
      throw new Error("Unexpected member voice lookup")
    },
    async getGuildOnboarding() {
      throw new Error("Unexpected onboarding lookup")
    },
    async getGuildWelcomeScreen() {
      throw new Error("Unexpected Welcome Screen lookup")
    },
    async getGuildWidgetSettings() {
      throw new Error("Unexpected widget-settings lookup")
    },
    async getGuildEmoji() {
      return {
        animated: false,
        available: true,
        creatorUserId: BOT_ID,
        id: "910000000000000001",
        managed: false,
        name: "wave",
        requiresColons: true,
        roleIds: [],
      }
    },
    async getGuildRole(_guildId, roleId) {
      calls.getRole += 1
      return role(roleId, 0n, "role")
    },
    async getGuildRoleMemberCounts() {
      return {}
    },
    async getGuildRoles() {
      return [role(
        GUILD_ID,
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
        "@everyone",
      )]
    },
    async getGuildScheduledEvent() {
      throw new Error("Unexpected scheduled-event lookup")
    },
    async getGuildSoundboardSound() {
      throw new Error("Unexpected soundboard lookup")
    },
    async getGuildSticker() {
      return {
        available: true,
        creatorUserId: BOT_ID,
        description: "Friendly wave",
        formatType: 1,
        guildId: GUILD_ID,
        id: "920000000000000001",
        name: "Wave Sticker",
        tags: "wave",
        type: 2,
      }
    },
    async getStageInstance() {
      throw new Error("Unexpected Stage-instance lookup")
    },
    async getMessage() {
      const customReaction = ownReaction?.includes(":") ?? false
      const [reactionName, reactionId] = customReaction
        ? ownReaction?.split(":") || []
        : [ownReaction, null]
      return message({
        reactions: ownReaction === null ? [] : [{
          burst_colors: [],
          count: 1,
          count_details: { burst: 0, normal: 1 },
          emoji: { animated: false, id: reactionId ?? null, name: reactionName ?? null },
          me: true,
          me_burst: false,
        }],
      })
    },
    async getThreadMember(threadId, userId) {
      return {
        flags: 0,
        id: threadId,
        join_timestamp: "2026-08-14T00:00:00.000Z",
        user_id: userId,
      }
    },
    async getThreadState() {
      throw new Error("Unexpected thread-state lookup")
    },
    async getUser(userId) {
      return { id: userId, username: "target" }
    },
    async listActiveGuildThreads() {
      return { threads: [] }
    },
    async listCurrentUserGuilds() {
      calls.guilds += 1
      return [guild()]
    },
    async listGuildApplicationCommands() {
      throw new Error("Unexpected application-command listing")
    },
    async listGuildMembers() {
      return []
    },
    async listGuildAutoModerationRules() {
      return []
    },
    async listGuildBans() {
      return []
    },
    async listGuildInvites() {
      return []
    },
    async listGuildIntegrations() {
      return []
    },
    async listGuildScheduledEvents() {
      return []
    },
    async listGuildSoundboardSounds() {
      return []
    },
    async listGuildEmojis() {
      return []
    },
    async listGuildStickers() {
      return []
    },
    async listGuildTemplates() {
      return []
    },
    async modifyGuildOnboarding() {
      throw new Error("Unexpected onboarding change")
    },
    async modifyGuildWelcomeScreen() {
      throw new Error("Unexpected Welcome Screen change")
    },
    async modifyGuildWidgetSettings() {
      throw new Error("Unexpected widget-settings change")
    },
    async modifyWebhook() {
      throw new Error("Unexpected webhook modification")
    },
    async listJoinedPrivateArchivedThreads() {
      return { has_more: false, threads: [] }
    },
    async listMessagePins() {
      return { has_more: false, items: [] }
    },
    async listPollAnswerVoters() {
      return { users: [] }
    },
    async listReactionUsers() {
      throw new Error("Unexpected reaction-user lookup")
    },
    async listChannelWebhooks() {
      return []
    },
    async listMessages() {
      calls.listMessages += 1
      return [message()]
    },
    async listDefaultSoundboardSounds() {
      return []
    },
    async listPrivateArchivedThreads() {
      return { has_more: false, threads: [] }
    },
    async listPublicArchivedThreads() {
      return { has_more: false, threads: [] }
    },
    async modifyGuildMemberTimeout(_guildId, userId, input) {
      return {
        communication_disabled_until: input.communicationDisabledUntil,
        roles: [],
        user: { id: userId, username: "target" },
      }
    },
    async modifyGuildMemberVoice() {
      throw new Error("Unexpected member voice change")
    },
    async modifyThreadState() {
      throw new Error("Unexpected thread-state change")
    },
    async modifyGuildForumTags() {
      throw new Error("Unexpected forum-tag change")
    },
    async modifyGuildChannelMetadata() {
      throw new Error("Unexpected channel metadata change")
    },
    async modifyGuildEmoji(_guildId, expressionId, input) {
      return {
        animated: false,
        available: true,
        creatorUserId: BOT_ID,
        id: expressionId,
        managed: false,
        name: input.name || "wave",
        requiresColons: true,
        roleIds: input.roleIds ? [...input.roleIds] : [],
      }
    },
    async modifyGuildAutoModerationRule() {
      throw new Error("Unexpected AutoMod rule modification")
    },
    async modifyGuildScheduledEvent() {
      throw new Error("Unexpected scheduled-event modification")
    },
    async modifyGuildSoundboardSound() {
      throw new Error("Unexpected soundboard modification")
    },
    async modifyGuildRole() {
      throw new Error("Unexpected role configuration")
    },
    async modifyGuildChannelPositions() {
      throw new Error("Unexpected channel ordering")
    },
    async modifyGuildRolePositions() {
      throw new Error("Unexpected role ordering")
    },
    async modifyGuildTemplate() {
      throw new Error("Unexpected guild-template metadata update")
    },
    async modifyGuildSticker(_guildId, expressionId, input) {
      return {
        available: true,
        creatorUserId: BOT_ID,
        description: input.description ?? "Friendly wave",
        formatType: 1,
        guildId: GUILD_ID,
        id: expressionId,
        name: input.name || "Wave Sticker",
        tags: input.tags || "wave",
        type: 2,
      }
    },
    async modifyStageInstance() {
      throw new Error("Unexpected Stage-instance modification")
    },
    async pinMessage() {},
    async removeGuildBan() {},
    async removeGuildMember() {
      calls.removeMember += 1
    },
    async removeGuildMemberRole() {
      throw new Error("Unexpected member-role remove")
    },
    async removeThreadMember() {
      throw new Error("Unexpected thread-member remove")
    },
    async syncGuildTemplate() {
      throw new Error("Unexpected guild-template synchronization")
    },
    async searchGuildMessages() {
      return {
        doing_deep_historical_index: false,
        messages: [],
        total_results: 0,
      }
    },
    async searchGuildMembers() {
      return []
    },
    async unpinMessage() {},
  }
  Object.assign(client, overrides.client)
  const activityStore: ActivityStore = {
    async append(entry) {
      calls.activityAppends += 1
      calls.activityEntries.push(entry)
    },
    async list() {
      return {
        entries: [],
        file: "/memory/activity.jsonl",
        skippedLines: 0,
      }
    },
  }
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    ...overrides.environment,
  }, { homeDirectory: "/test/home" })
  return {
    calls,
    service: new ConnectorService({
      activityStore,
      client,
      config,
      ...(overrides.useDefaultWriteCoordinator
        ? {}
        : { writeCoordinator: overrides.writeCoordinator || PASSTHROUGH_WRITE_COORDINATOR }),
      ...(overrides.channelAdministrationOptions
        ? { channelAdministrationOptions: overrides.channelAdministrationOptions }
        : {}),
      ...(overrides.channelMetadataOptions
        ? { channelMetadataOptions: overrides.channelMetadataOptions }
        : {}),
      ...(overrides.channelOrderingOptions
        ? { channelOrderingOptions: overrides.channelOrderingOptions }
        : {}),
      ...(overrides.componentMessageOptions
        ? { componentMessageOptions: overrides.componentMessageOptions }
        : {}),
      ...(overrides.attachmentMessageOptions
        ? { attachmentMessageOptions: overrides.attachmentMessageOptions }
        : {}),
      ...(overrides.automodOptions
        ? { automodOptions: overrides.automodOptions }
        : {}),
      ...(overrides.operationStore ? { operationStore: overrides.operationStore } : {}),
      ...(overrides.permissionOverwriteOptions
        ? { permissionOverwriteOptions: overrides.permissionOverwriteOptions }
        : {}),
      ...(overrides.pollOptions
        ? { pollOptions: overrides.pollOptions }
        : {}),
      ...(overrides.reactionOptions
        ? { reactionOptions: overrides.reactionOptions }
        : {}),
      ...(overrides.interactionOptions
        ? { interactionOptions: overrides.interactionOptions }
        : {}),
      ...(overrides.inviteOptions
        ? { inviteOptions: overrides.inviteOptions }
        : {}),
      ...(overrides.memberRoleOptions
        ? { memberRoleOptions: overrides.memberRoleOptions }
        : {}),
      ...(overrides.memberVoiceOptions
        ? { memberVoiceOptions: overrides.memberVoiceOptions }
        : {}),
      ...(overrides.onboardingOptions
        ? { onboardingOptions: overrides.onboardingOptions }
        : {}),
      ...(overrides.welcomeScreenOptions
        ? { welcomeScreenOptions: overrides.welcomeScreenOptions }
        : {}),
      ...(overrides.widgetSettingsOptions
        ? { widgetSettingsOptions: overrides.widgetSettingsOptions }
        : {}),
      ...(overrides.forumPostOptions
        ? { forumPostOptions: overrides.forumPostOptions }
        : {}),
      ...(overrides.forumTagOptions
        ? { forumTagOptions: overrides.forumTagOptions }
        : {}),
      ...(overrides.gateway ? { gateway: overrides.gateway } : {}),
      ...(overrides.guildScaffoldOptions
        ? { guildScaffoldOptions: overrides.guildScaffoldOptions }
        : {}),
      ...(overrides.guildTemplateOptions
        ? { guildTemplateOptions: overrides.guildTemplateOptions }
        : {}),
      ...(overrides.integrationOptions
        ? { integrationOptions: overrides.integrationOptions }
        : {}),
      ...(overrides.guildExpressionOptions
        ? { guildExpressionOptions: overrides.guildExpressionOptions }
        : {}),
      ...(overrides.roleAdministrationOptions
        ? { roleAdministrationOptions: overrides.roleAdministrationOptions }
        : {}),
      ...(overrides.roleConfigurationOptions
        ? { roleConfigurationOptions: overrides.roleConfigurationOptions }
        : {}),
      ...(overrides.roleOrderingOptions
        ? { roleOrderingOptions: overrides.roleOrderingOptions }
        : {}),
      ...(overrides.scheduledEventOptions
        ? { scheduledEventOptions: overrides.scheduledEventOptions }
        : {}),
      ...(overrides.soundboardOptions
        ? { soundboardOptions: overrides.soundboardOptions }
        : {}),
      ...(overrides.stageInstanceOptions
        ? { stageInstanceOptions: overrides.stageInstanceOptions }
        : {}),
      ...(overrides.threadCreationOptions
        ? { threadCreationOptions: overrides.threadCreationOptions }
        : {}),
      ...(overrides.threadGovernanceOptions
        ? { threadGovernanceOptions: overrides.threadGovernanceOptions }
        : {}),
      ...(overrides.webhookOptions
        ? { webhookOptions: overrides.webhookOptions }
        : {}),
    }),
  }
}

test("service rejects a token for the wrong Discord application before data access", async () => {
  const { calls, service } = serviceFixture({
    application: application("999999999999999999"),
  })

  await assert.rejects(
    () => service.getStatus(),
    (error: unknown) => (
      error instanceof ConfigurationError
      && /expected 100000000000000001/.test(error.message)
    ),
  )
  assert.equal(calls.guilds, 0)
})

test("service rejects a token for the wrong pinned bot before data access", async () => {
  const { calls, service } = serviceFixture({
    client: {
      async getCurrentUser() {
        calls.user += 1
        return bot("999999999999999999")
      },
    },
  })

  await assert.rejects(
    () => service.getStatus(),
    (error: unknown) => (
      error instanceof ConfigurationError
      && /expected 200000000000000001/.test(error.message)
    ),
  )
  assert.equal(calls.guilds, 0)
})

test("service rejects forum-tag scope before identity or channel access", async () => {
  const { calls, service } = serviceFixture()

  await assert.rejects(
    () => service.auditForumTags(CHANNEL_ID),
    /forum-tag audit is disabled/,
  )
  await assert.rejects(
    () => service.planForumTagChange({
      action: "delete",
      auditReason: "reviewed",
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: "forum-tag-preflight-0001",
      tagId: CREATED_ROLE_ID,
    }),
    /forum-tag audit is disabled/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service rejects integration and webhook scope before identity access", async () => {
  const { calls, service } = serviceFixture()
  const integrationRequest = {
    acknowledgeAssociatedBotKicked: true,
    acknowledgeAssociatedWebhooksRemoved: true,
    auditReason: "reviewed",
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKey: "integration-preflight-0001",
  }
  const webhookRequest = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    operationKey: "webhook-preflight-0001",
    webhookId: WEBHOOK_ID,
  }

  await assert.rejects(
    () => service.listGuildIntegrations(GUILD_ID),
    /integration audit is disabled/,
  )
  await assert.rejects(
    () => service.planGuildIntegrationDeletion(integrationRequest),
    /integration audit is disabled/,
  )
  await assert.rejects(
    () => service.listChannelWebhooks(CHANNEL_ID),
    /webhook audit is disabled/,
  )
  await assert.rejects(
    () => service.planWebhookDeletion(webhookRequest),
    /webhook audit is disabled/,
  )
  await assert.rejects(
    () => service.planWebhookCreation({
      auditReason: "reviewed",
      channelId: CHANNEL_ID,
      name: "reviewed-hook",
      operationKey: "webhook-create-preflight-0001",
    }),
    /webhook audit is disabled/,
  )
  await assert.rejects(
    () => service.planWebhookChange({
      ...webhookRequest,
      name: "renamed-hook",
    }),
    /webhook audit is disabled/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service rejects reaction identity and moderation scope before identity access", async () => {
  const { calls, service } = serviceFixture()
  const request = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: "reaction-preflight-0001",
    scope: "all" as const,
  }

  await assert.rejects(
    () => service.listReactionUsers(CHANNEL_ID, MESSAGE_ID, "👍"),
    /reaction-user audit is disabled/,
  )
  await assert.rejects(
    () => service.planReactionModeration(request),
    /reaction moderation is disabled/,
  )
  await assert.rejects(
    () => service.executeReactionModeration(
      request,
      `hmac-sha256:${"a".repeat(64)}`,
    ),
    /reaction moderation is disabled/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const protectedFixture = serviceFixture({
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_REACTION_MODERATION: "true",
      DISCORD_MCP_PROTECTED_USER_IDS: MEMBER_USER_ID,
      DISCORD_MCP_REACTION_CHANNEL_IDS: CHANNEL_ID,
    },
  })
  await assert.rejects(
    () => protectedFixture.service.planReactionModeration({
      ...request,
      emoji: "👍",
      scope: "user",
      userId: MEMBER_USER_ID,
    }),
    /protected from administration/,
  )
  assert.equal(protectedFixture.calls.application, 0)
  assert.equal(protectedFixture.calls.user, 0)
})

test("service exposes privacy-safe reaction reads and coordinates exact-message moderation", async () => {
  const writeCoordinator = new CapturingWriteCoordinator()
  const operationStore = new MemoryOperationStore()
  const reactions = [{
    burst_colors: [],
    count: 1,
    count_details: { burst: 0, normal: 1 },
    emoji: { animated: false, id: null, name: "👍" },
    me: false,
    me_burst: false,
  }]
  const { service } = serviceFixture({
    client: {
      async getGuildMember(_guildId, userId) {
        return { roles: [], user: bot(userId) }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_MESSAGES
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
      async getMessage() {
        return message({
          content: "private reaction message",
          reactions,
        })
      },
      async listReactionUsers() {
        return [{
          avatar: "private-avatar",
          id: MEMBER_USER_ID,
          username: "private-reactor",
        }]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_REACTION_MODERATION: "true",
      DISCORD_MCP_ALLOW_REACTION_USER_AUDIT: "true",
      DISCORD_MCP_REACTION_CHANNEL_IDS: CHANNEL_ID,
    },
    operationStore,
    reactionOptions: { planKey: new Uint8Array(32).fill(7) },
    writeCoordinator,
  })

  const inventory = await service.listMessageReactions(CHANNEL_ID, MESSAGE_ID)
  assert.equal(inventory.reactions.length, 1)
  assert.equal(JSON.stringify(inventory).includes("private reaction message"), false)
  const users = await service.listReactionUsers(
    CHANNEL_ID,
    MESSAGE_ID,
    "👍",
    { limit: 1 },
  )
  assert.deepEqual(users.users, [{ bot: false, id: MEMBER_USER_ID }])
  assert.equal(JSON.stringify(users).includes("private-reactor"), false)

  const moderationRequest = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: "reaction-coordination-operation-0001",
    scope: "all" as const,
  }
  const plan = await service.planReactionModeration(moderationRequest)
  await assert.rejects(
    () => service.executeReactionModeration(moderationRequest, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "reaction-moderation",
    operationKeyHash: operationKeyHash(moderationRequest.operationKey),
    planDigest: plan.digest,
    targets: [{ id: MESSAGE_ID, kind: "message" }],
  }])

  const changedReaction = reactions[0]
  assert.ok(changedReaction)
  changedReaction.count = 2
  changedReaction.count_details = { burst: 0, normal: 2 }
  await assert.rejects(
    () => service.executeReactionModeration(moderationRequest, plan.digest),
    /fresh Discord reaction snapshot/,
  )
  assert.equal(writeCoordinator.intents.length, 1)
})

test("service coordinates every receipt-backed single-step workflow by shared targets", async () => {
  const writeCoordinator = new CapturingWriteCoordinator()
  const coordinationBotRoleId = "700000000000000003"
  const orderedChannels = [
    channel({ id: CHANNEL_ID, name: "target", position: 0 }),
    channel({ id: OTHER_CHANNEL_ID, name: "anchor", position: 1 }),
  ]
  const gateway = new GatewayChannelLayoutStore({
    enabled: true,
    guildIds: new Set([GUILD_ID]),
  })
  assert.equal(gateway.ingestDispatch("GUILD_CREATE", {
    channels: orderedChannels,
    id: GUILD_ID,
  }), true)
  const { service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: [],
          owner_id: "800000000000000001",
        }
      },
      async getGuildMember(_guildId, userId) {
        return {
          roles: userId === BOT_ID ? [coordinationBotRoleId] : [],
          user: {
            bot: true,
            id: userId,
            username: userId === BOT_ID ? "connector" : "associated",
          },
        }
      },
      async getGuildRoleMemberCounts() {
        return {
          [ANCHOR_ROLE_ID]: 2,
          [coordinationBotRoleId]: 1,
          [CREATED_ROLE_ID]: 4,
        }
      },
      async getGuildChannels() {
        return orderedChannels
      },
      async getGuildRoles() {
        return [
          role(
            GUILD_ID,
            DISCORD_PERMISSIONS.MANAGE_GUILD
              | DISCORD_PERMISSIONS.MANAGE_CHANNELS
              | DISCORD_PERMISSIONS.MANAGE_MESSAGES
              | DISCORD_PERMISSIONS.MANAGE_WEBHOOKS
              | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
              | DISCORD_PERMISSIONS.SEND_MESSAGES
              | DISCORD_PERMISSIONS.VIEW_CHANNEL,
            "@everyone",
          ),
          {
            ...role(CREATED_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "target"),
            position: 1,
          },
          {
            ...role(ANCHOR_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "anchor"),
            position: 2,
          },
          {
            ...role(
              coordinationBotRoleId,
              DISCORD_PERMISSIONS.MANAGE_ROLES,
              "connector",
            ),
            managed: true,
            position: 3,
            tags: { bot_id: BOT_ID },
          },
        ]
      },
      async listChannelWebhooks(): Promise<DiscordWebhookSummary[]> {
        return [
          {
            applicationId: null,
            channelId: CHANNEL_ID,
            creatorUserId: BOT_ID,
            guildId: GUILD_ID,
            id: WEBHOOK_ID,
            name: "reviewed-hook",
            sourceChannelId: null,
            sourceGuildId: null,
            type: 1,
          },
          {
            applicationId: null,
            channelId: CHANNEL_ID,
            creatorUserId: null,
            guildId: GUILD_ID,
            id: FOLLOWER_WEBHOOK_ID,
            name: "followed-announcements",
            sourceChannelId: OTHER_CHANNEL_ID,
            sourceGuildId: OTHER_GUILD_ID,
            type: 2,
          },
        ]
      },
      async listGuildIntegrations(): Promise<DiscordGuildIntegrationSummary[]> {
        return [{
          accountPresent: true,
          applicationId: INTEGRATION_APPLICATION_ID,
          associatedBotUserId: INTEGRATION_BOT_ID,
          enableEmoticons: null,
          enabled: true,
          expireBehavior: null,
          expireGracePeriod: null,
          id: INTEGRATION_ID,
          knownScopes: ["bot"],
          linkedUserPresent: false,
          revoked: null,
          roleId: null,
          subscriberCount: null,
          syncedAt: null,
          syncing: null,
          type: "discord",
          unknownFieldCounts: {
            account: 0,
            application: 0,
            bot: 0,
            integration: 0,
            user: 0,
          },
          unknownScopeCount: 0,
        }]
      },
    },
    environment: {
      DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT: "true",
      DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES: "true",
      DISCORD_MCP_FORUM_TAG_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_DELETIONS: "true",
      DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT: "true",
      DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES: "true",
      DISCORD_MCP_ALLOW_INTERACTIONS: "true",
      DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
      DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS: "true",
      DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
      DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES: "true",
      DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT: "true",
      DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES: "true",
      DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
      DISCORD_MCP_ALLOW_WEBHOOK_CHANGES: "true",
      DISCORD_MCP_ALLOW_WEBHOOK_CREATION: "true",
      DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
      DISCORD_MCP_DELETE_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
    },
    gateway,
    writeCoordinator,
  })
  const digest = `hmac-sha256:${"a".repeat(64)}`
  const operationKey = "coordination-operation-0001"
  const captured = async (operation: () => Promise<unknown>) => {
    await assert.rejects(operation, (error: unknown) => error === writeCoordinator.stop)
  }

  await captured(() => service.executeAttachmentMessage({
    channelId: CHANNEL_ID,
    filePath: "/test/attachment.txt",
    operationKey,
  }, digest))
  const componentRequest = {
    action: "create" as const,
    channelId: CHANNEL_ID,
    components: [{ content: "Reviewed component", kind: "text" as const }],
    operationKey,
  }
  const componentPlan = await service.planComponentMessage(componentRequest)
  await captured(() => service.executeComponentMessage(
    componentRequest,
    componentPlan.digest,
  ))
  await captured(() => service.executeAutoModerationChange({
    action: "delete",
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    ruleId: AUTOMOD_RULE_ID,
  }, digest))
  await captured(() => service.executeChannelCreation({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    kind: "text",
    name: "reviewed-channel",
    operationKey,
    parentId: CHANNEL_ID,
  }, digest))
  await captured(() => service.executeChannelMetadataChange({
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    name: "reviewed-channel",
    operationKey,
  }, digest))
  const channelOrderRequest = {
    anchorChannelId: OTHER_CHANNEL_ID,
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey,
    placement: "below" as const,
  }
  const channelOrderAudit = await service.auditChannelOrder(GUILD_ID)
  assert.deepEqual(
    channelOrderAudit.groups.flatMap((group) => group.channels.map(({ id }) => id)),
    [CHANNEL_ID, OTHER_CHANNEL_ID],
  )
  const channelOrderPlan = await service.planChannelOrder(channelOrderRequest)
  await captured(() => service.executeChannelOrder(
    channelOrderRequest,
    channelOrderPlan.digest,
  ))
  await captured(() => service.executeChannelPermissionOverwrite({
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    mode: "delete",
    operationKey,
    targetId: CREATED_ROLE_ID,
    targetType: "role",
  }, digest))
  await captured(() => service.executeForumPost({
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    content: "reviewed content",
    name: "reviewed post",
    operationKey,
  }, digest))
  await captured(() => service.executeForumTagChange({
    action: "delete",
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey,
    tagId: CREATED_ROLE_ID,
  }, digest))
  await captured(() => service.executeGuildExpressionChange({
    action: "delete",
    auditReason: "reviewed",
    expressionId: AUTOMOD_RULE_ID,
    guildId: GUILD_ID,
    kind: "emoji",
    operationKey,
  }, digest))
  await captured(() => service.executeGuildTemplateChange({
    action: "delete",
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    templateRef: `tref_hmac_sha256_${"c".repeat(64)}`,
  }, digest))
  const integrationRequest = {
    acknowledgeAssociatedBotKicked: true,
    acknowledgeAssociatedWebhooksRemoved: true,
    auditReason: "reviewed",
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKey,
  }
  const integrationPlan = await service.planGuildIntegrationDeletion(
    integrationRequest,
  )
  await captured(() => service.executeGuildIntegrationDeletion(
    integrationRequest,
    integrationPlan.digest,
  ))
  await captured(() => service.executeInviteDeletion({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    inviteRef: `iref_hmac_sha256_${"b".repeat(64)}`,
    operationKey,
  }, digest))
  await captured(() => service.executeMemberRoleChange({
    action: "add",
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    roleId: CREATED_ROLE_ID,
    userId: MEMBER_USER_ID,
  }, digest))
  await captured(() => service.executeMemberVoiceChange({
    action: "move",
    auditReason: "reviewed",
    destinationChannelId: OTHER_CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey,
    userId: MEMBER_USER_ID,
  }, digest))
  await captured(() => service.executeMessagePin({
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    desiredState: "pinned",
    messageId: MESSAGE_ID,
    operationKey,
  }, digest))
  const deletionRequest = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    messageIds: [MESSAGE_ID],
    operationKey,
  }
  const deletionPlan = await service.planMessageDeletion(deletionRequest)
  await captured(() => service.deleteMessages(
    deletionRequest,
    deletionPlan.digest,
  ))
  await captured(() => service.executeAnnouncementCrosspost({
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey,
  }, digest))
  const announcementSubscriptionRequest = {
    action: "unsubscribe" as const,
    auditReason: "reviewed",
    operationKey,
    targetChannelId: CHANNEL_ID,
    webhookId: FOLLOWER_WEBHOOK_ID,
  }
  const announcementSubscriptionPlan = await service.planAnnouncementSubscription(
    announcementSubscriptionRequest,
  )
  await captured(() => service.executeAnnouncementSubscription(
    announcementSubscriptionRequest,
    announcementSubscriptionPlan.digest,
  ))
  await captured(() => service.executeOnboardingChange({
    auditReason: "reviewed",
    defaultChannelIds: [],
    enabled: false,
    guildId: GUILD_ID,
    mode: "default",
    operationKey,
    prompts: [],
  }, digest))
  await captured(() => service.executePollCreation({
    answers: [{ text: "One" }, { text: "Two" }],
    channelId: CHANNEL_ID,
    operationKey,
    question: "Reviewed?",
  }, digest))
  await captured(() => service.executePollEnd({
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey,
  }, digest))
  await captured(() => service.executeRoleCreation({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    name: "reviewed-role",
    operationKey,
  }, digest))
  await captured(() => service.executeRoleConfiguration({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    name: "reviewed-role",
    operationKey,
    roleId: CREATED_ROLE_ID,
  }, digest))
  const roleOrderRequest = {
    anchorRoleId: ANCHOR_ROLE_ID,
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    placement: "above" as const,
    roleId: CREATED_ROLE_ID,
  }
  const roleOrderPlan = await service.planRoleOrder(roleOrderRequest)
  await captured(() => service.executeRoleOrder(
    roleOrderRequest,
    roleOrderPlan.digest,
  ))
  await captured(() => service.executeScheduledEventChange({
    action: "delete",
    auditReason: "reviewed",
    eventId: SCHEDULED_EVENT_ID,
    guildId: GUILD_ID,
    operationKey,
  }, digest))
  await captured(() => service.executeSoundboardChange({
    action: "delete",
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    soundId: SOUNDBOARD_SOUND_ID,
  }, digest))
  await captured(() => service.executeStageInstanceChange({
    action: "end",
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey,
  }, digest))
  await captured(() => service.executeThreadCreation({
    auditReason: "reviewed",
    mode: "standalone-public",
    name: "reviewed-thread",
    operationKey,
    parentChannelId: CHANNEL_ID,
  }, digest))
  await captured(() => service.executeThreadChange({
    action: "add-member",
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    threadId: THREAD_ID,
    userId: MEMBER_USER_ID,
  }, digest))
  await captured(() => service.executeWelcomeScreenChange({
    auditReason: "reviewed",
    channels: [],
    description: null,
    enabled: false,
    guildId: GUILD_ID,
    operationKey,
  }, digest))
  const webhookRequest = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    operationKey,
    webhookId: WEBHOOK_ID,
  }
  const webhookPlan = await service.planWebhookDeletion(webhookRequest)
  await captured(() => service.executeWebhookDeletion(
    webhookRequest,
    webhookPlan.digest,
  ))
  const webhookCreationRequest = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    name: "reviewed-hook",
    operationKey,
  }
  const webhookCreationPlan = await service.planWebhookCreation(
    webhookCreationRequest,
  )
  await captured(() => service.executeWebhookCreation(
    webhookCreationRequest,
    webhookCreationPlan.digest,
  ))
  const webhookChangeRequest = {
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    name: "renamed-hook",
    operationKey,
    webhookId: WEBHOOK_ID,
  }
  const webhookChangePlan = await service.planWebhookChange(
    webhookChangeRequest,
  )
  await captured(() => service.executeWebhookChange(
    webhookChangeRequest,
    webhookChangePlan.digest,
  ))
  await captured(() => service.executeWidgetSettingsChange({
    auditReason: "reviewed",
    channelId: null,
    enabled: false,
    guildId: GUILD_ID,
    operationKey,
  }, digest))

  const byKind = new Map(writeCoordinator.intents.map((entry) => [entry.kind, entry]))
  assert.equal(byKind.size, 35)
  assert.deepEqual(
    Object.fromEntries([...byKind].map(([kind, entry]) => [kind, entry.targets])),
    {
      "announcement-crosspost": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: MESSAGE_ID, kind: "message" },
      ],
      "announcement-subscription": [
        { id: CHANNEL_ID, kind: "channel" },
        { collection: "webhooks", guildId: GUILD_ID, kind: "guild-collection" },
        { id: FOLLOWER_WEBHOOK_ID, kind: "webhook" },
      ],
      "attachment-message": [{ id: CHANNEL_ID, kind: "channel" }],
      "component-message": [{ id: CHANNEL_ID, kind: "channel" }],
      "automod-change": [{
        collection: "automod",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "channel-creation": [
        { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
        { id: CHANNEL_ID, kind: "channel" },
      ],
      "channel-metadata-change": [
        { id: CHANNEL_ID, kind: "channel" },
        { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "channel-ordering": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: OTHER_CHANNEL_ID, kind: "channel" },
        { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "channel-permission-overwrite": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: CREATED_ROLE_ID, kind: "role" },
      ],
      "forum-post": [{ id: CHANNEL_ID, kind: "channel" }],
      "forum-tag-change": [
        { id: CHANNEL_ID, kind: "channel" },
        { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "guild-expression-change": [{
        collection: "emojis",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "guild-soundboard-change": [{
        collection: "soundboard",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "guild-template-change": [{
        collection: "templates",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "integration-deletion": [
        { id: INTEGRATION_ID, kind: "integration" },
        { collection: "integrations", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "webhooks", guildId: GUILD_ID, kind: "guild-collection" },
        { id: INTEGRATION_BOT_ID, kind: "member" },
      ],
      "invite-deletion": [{
        collection: "invites",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "member-role-change": [
        { id: MEMBER_USER_ID, kind: "member" },
        { id: CREATED_ROLE_ID, kind: "role" },
      ],
      "member-voice-change": [{ id: MEMBER_USER_ID, kind: "member" }],
      "message-deletion": [{ id: MESSAGE_ID, kind: "message" }],
      "message-pin": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: MESSAGE_ID, kind: "message" },
      ],
      "onboarding-change": [{
        collection: "onboarding",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "poll-create": [{ id: CHANNEL_ID, kind: "channel" }],
      "poll-end": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: MESSAGE_ID, kind: "message" },
      ],
      "role-configuration": [
        { id: CREATED_ROLE_ID, kind: "role" },
        { collection: "roles", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "role-ordering": [
        { id: CREATED_ROLE_ID, kind: "role" },
        { id: ANCHOR_ROLE_ID, kind: "role" },
        { collection: "roles", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "role-creation": [{
        collection: "roles",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "scheduled-event-change": [{
        collection: "scheduled-events",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "stage-instance-change": [{ id: CHANNEL_ID, kind: "channel" }],
      "thread-create": [{ id: CHANNEL_ID, kind: "channel" }],
      "thread-governance-change": [
        { id: THREAD_ID, kind: "channel" },
        { id: MEMBER_USER_ID, kind: "member" },
      ],
      "webhook-deletion": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: WEBHOOK_ID, kind: "webhook" },
        { collection: "webhooks", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "webhook-creation": [
        { id: CHANNEL_ID, kind: "channel" },
        { collection: "webhooks", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "webhook-change": [
        { id: CHANNEL_ID, kind: "channel" },
        { id: WEBHOOK_ID, kind: "webhook" },
        { collection: "webhooks", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "welcome-screen-change": [{
        collection: "welcome-screen",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "widget-settings-change": [{
        collection: "widget-settings",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
    },
  )
  for (const entry of writeCoordinator.intents) {
    assert.equal(entry.operationKeyHash, operationKeyHash(operationKey))
    const expectedDigest = entry.kind === "integration-deletion"
      ? integrationPlan.digest
      : entry.kind === "announcement-subscription"
        ? announcementSubscriptionPlan.digest
      : entry.kind === "webhook-deletion"
        ? webhookPlan.digest
        : entry.kind === "webhook-creation"
          ? webhookCreationPlan.digest
          : entry.kind === "webhook-change"
            ? webhookChangePlan.digest
        : entry.kind === "message-deletion"
          ? deletionPlan.digest
          : entry.kind === "component-message"
            ? componentPlan.digest
            : entry.kind === "role-ordering"
              ? roleOrderPlan.digest
              : entry.kind === "channel-ordering"
                ? channelOrderPlan.digest
                : digest
    assert.equal(entry.planDigest, expectedDigest)
  }
  await assert.rejects(
    () => service.executeChannelCreation({
      auditReason: "reviewed",
      guildId: GUILD_ID,
      kind: "category",
      name: "invalid-digest",
      operationKey,
    }, "invalid"),
    /reviewed-write plan digest is invalid/,
  )
  assert.equal(writeCoordinator.intents.length, 35)
})

test("distinct connector facades coordinate through one production state root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-service-coordination-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const auditFile = join(root, "activity.jsonl")
  let created: DiscordChannel | undefined
  let createCalls = 0
  let releaseCreate: (() => void) | undefined
  let reportCreateStarted: (() => void) | undefined
  const createStarted = new Promise<void>((resolvePromise) => {
    reportCreateStarted = resolvePromise
  })
  const createRelease = new Promise<void>((resolvePromise) => {
    releaseCreate = resolvePromise
  })
  const client: Partial<DiscordServiceClient> = {
    async createGuildChannel(guildId, input) {
      assert.equal(guildId, GUILD_ID)
      createCalls += 1
      created = channel({
        id: CREATED_CHANNEL_ID,
        name: input.name,
        parent_id: null,
        permission_overwrites: [],
        type: 4,
      })
      reportCreateStarted?.()
      await createRelease
      return created
    },
    async getChannel(channelId) {
      assert.equal(channelId, CREATED_CHANNEL_ID)
      if (!created) throw new Error("created channel is unavailable")
      return created
    },
    async getGuild() {
      return { ...guild(), owner_id: "700000000000000001" }
    },
    async getGuildChannels() {
      return created ? [created] : []
    },
    async getGuildMember() {
      return { roles: [], user: bot() }
    },
    async getGuildRoles() {
      return [role(
        GUILD_ID,
        DISCORD_PERMISSIONS.MANAGE_CHANNELS | DISCORD_PERMISSIONS.VIEW_CHANNEL,
        "@everyone",
      )]
    },
  }
  const shared = {
    channelAdministrationOptions: {
      clock: () => new Date("2026-08-22T03:00:00.000Z"),
      planKey: new Uint8Array(32).fill(7),
      randomId: () => "activity-shared-channel-create",
    },
    client,
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
      DISCORD_MCP_AUDIT_FILE: auditFile,
      DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
    },
    useDefaultWriteCoordinator: true,
  } satisfies Parameters<typeof serviceFixture>[0]
  const first = serviceFixture(shared).service
  const second = serviceFixture(shared).service
  const firstRequest = {
    auditReason: "Reviewed first category",
    guildId: GUILD_ID,
    kind: "category" as const,
    name: "First category",
    operationKey: "shared-channel-create-attempt-0001",
  }
  const secondRequest = {
    auditReason: "Reviewed second category",
    guildId: GUILD_ID,
    kind: "category" as const,
    name: "Second category",
    operationKey: "shared-channel-create-attempt-0002",
  }
  const [firstPlan, secondPlan] = await Promise.all([
    first.planChannelCreation(firstRequest),
    second.planChannelCreation(secondRequest),
  ])

  const running = first.executeChannelCreation(firstRequest, firstPlan.digest)
  await Promise.race([
    createStarted,
    running.then(() => {
      throw new Error("first coordinated write completed before mutation started")
    }),
  ])
  const queued = assert.rejects(
    () => second.executeChannelCreation(secondRequest, secondPlan.digest),
    ChannelCreationPlanChangedError,
  )
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(createCalls, 1)
  releaseCreate?.()
  assert.equal((await running).status, "completed")
  await queued
  assert.equal(createCalls, 1)
  assert.deepEqual(
    await readdir(`${auditFile}.coordination/claims`),
    [],
  )
})

test("distinct connector facades serialize resumable scaffold guild collections", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-scaffold-coordination-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const auditFile = join(root, "activity.jsonl")
  const botRoleId = "700000000000000002"
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const roles = [
    role(GUILD_ID, 0n, "@everyone"),
    {
      ...role(botRoleId, permissions, "connector"),
      managed: true,
      position: 10,
      tags: { bot_id: BOT_ID },
    },
  ]
  let createCalls = 0
  let releaseCreate: (() => void) | undefined
  let reportCreateStarted: (() => void) | undefined
  const createStarted = new Promise<void>((resolvePromise) => {
    reportCreateStarted = resolvePromise
  })
  const createRelease = new Promise<void>((resolvePromise) => {
    releaseCreate = resolvePromise
  })
  const client: Partial<DiscordServiceClient> = {
    async createGuildRole(guildId, input) {
      assert.equal(guildId, GUILD_ID)
      createCalls += 1
      const created = {
        ...role(CREATED_ROLE_ID, BigInt(input.permissions), input.name),
        color: input.primaryColor,
        colors: {
          primary_color: input.primaryColor,
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: input.hoist,
        mentionable: input.mentionable,
        position: 1,
      }
      roles.push(created)
      reportCreateStarted?.()
      await createRelease
      return created
    },
    async getGuild() {
      return { ...guild(), features: [], owner_id: "800000000000000001" }
    },
    async getGuildChannels() {
      return []
    },
    async getGuildMember() {
      return { roles: [botRoleId], user: bot() }
    },
    async getGuildRole(_guildId, roleId) {
      const found = roles.find((entry) => entry.id === roleId)
      assert.ok(found)
      return found
    },
    async getGuildRoles() {
      return roles
    },
  }
  const shared = {
    client,
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
      DISCORD_MCP_AUDIT_FILE: auditFile,
      DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-22T04:00:00.000Z"),
      planKey: new Uint8Array(32).fill(11),
      randomId: () => "activity-shared-scaffold",
    },
    roleAdministrationOptions: {
      clock: () => new Date("2026-08-22T04:00:00.000Z"),
      planKey: new Uint8Array(32).fill(12),
      randomId: () => "activity-shared-scaffold-role",
    },
    useDefaultWriteCoordinator: true,
  } satisfies Parameters<typeof serviceFixture>[0]
  const first = serviceFixture(shared).service
  const second = serviceFixture(shared).service
  const request = (suffix: string) => ({
    auditReason: `Reviewed ${suffix} scaffold`,
    channels: [{
      key: `${suffix}-category`,
      kind: "category" as const,
      name: `${suffix} category`,
    }],
    guildId: GUILD_ID,
    operationKey: `shared-scaffold-attempt-${suffix}-0001`,
    roles: [{ key: `${suffix}-role`, name: `${suffix} role` }],
    stepLimit: 1,
  })
  const firstRequest = request("first")
  const secondRequest = request("second")
  const [firstPlan, secondPlan] = await Promise.all([
    first.planGuildScaffold(firstRequest),
    second.planGuildScaffold(secondRequest),
  ])

  const running = first.executeGuildScaffold(firstRequest, firstPlan.digest)
  await Promise.race([
    createStarted,
    running.then(() => {
      throw new Error("first coordinated scaffold completed before mutation started")
    }),
  ])
  const queued = assert.rejects(
    () => second.executeGuildScaffold(secondRequest, secondPlan.digest),
    GuildScaffoldPlanChangedError,
  )
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(createCalls, 1)
  releaseCreate?.()
  assert.equal((await running).status, "paused")
  await queued
  assert.equal(createCalls, 1)
  assert.deepEqual(await readdir(`${auditFile}.coordination/claims`), [])
})

test("service verifies bot identity before delegating safe message interactions", async () => {
  const writeCoordinator = new CapturingWriteCoordinator()
  const { calls, service } = serviceFixture({
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_INTERACTIONS: "true",
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "0",
    },
    writeCoordinator,
  })

  const sent = await service.sendMessage({
    channelId: CHANNEL_ID,
    content: "safe service send",
    idempotencyKey: "request-1234567890",
  })
  const reaction = await service.addReaction({
    channelId: CHANNEL_ID,
    emoji: "🔥",
    messageId: MESSAGE_ID,
  })

  assert.equal(sent.messageId, MESSAGE_ID)
  assert.equal(reaction.messageId, MESSAGE_ID)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.createMessage, 1)
  assert.equal(calls.addReaction, 1)
  assert.deepEqual(writeCoordinator.intents, [])
})

test("service verifies identity through credential-safe webhook administration", async () => {
  const operationStore = new MemoryOperationStore()
  let inventory = [{
    applicationId: APPLICATION_ID,
    channelId: CHANNEL_ID,
    creatorUserId: MEMBER_USER_ID,
    guildId: GUILD_ID,
    id: WEBHOOK_ID,
    name: "reviewed-hook",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
  }]
  let deleteCalls = 0
  let inventoryCalls = 0
  const botPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.MANAGE_WEBHOOKS
  const { calls, service } = serviceFixture({
    client: {
      async deleteWebhook(webhookId, auditReason) {
        assert.equal(webhookId, WEBHOOK_ID)
        assert.equal(auditReason, "Reviewed webhook cleanup")
        deleteCalls += 1
        inventory = inventory.filter((entry) => entry.id !== webhookId)
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, botPermissions, "@everyone")]
      },
      async listChannelWebhooks(channelId) {
        assert.equal(channelId, CHANNEL_ID)
        inventoryCalls += 1
        return inventory
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
      DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
      DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
    },
    operationStore,
    webhookOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(19),
      randomId: () => "activity-webhook-deletion",
    },
  })
  const request = {
    auditReason: "Reviewed webhook cleanup",
    channelId: CHANNEL_ID,
    operationKey: "webhook-service-attempt-0001",
    webhookId: WEBHOOK_ID,
  }

  const listed = await service.listChannelWebhooks(CHANNEL_ID)
  const exact = await service.getChannelWebhook(CHANNEL_ID, WEBHOOK_ID)
  const plan = await service.planWebhookDeletion(request)
  const result = await service.executeWebhookDeletion(request, plan.digest)

  assert.equal(listed.webhooks.length, 1)
  assert.equal(exact.webhook.webhookId, WEBHOOK_ID)
  assert.equal(plan.target.webhookId, WEBHOOK_ID)
  assert.equal(plan.privacy.credentialsProjectedOut, true)
  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.equal(deleteCalls, 1)
  assert.equal(inventoryCalls, 6)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "webhook-deletion")
  assert.equal(operationStore.receipt?.resourceId, WEBHOOK_ID)
})

test("service pins identity through privacy-safe integration audit and deletion", async () => {
  const operationStore = new MemoryOperationStore()
  let inventory: DiscordGuildIntegrationSummary[] = [{
    accountPresent: true,
    applicationId: INTEGRATION_APPLICATION_ID,
    associatedBotUserId: INTEGRATION_BOT_ID,
    enableEmoticons: null,
    enabled: true,
    expireBehavior: null,
    expireGracePeriod: null,
    id: INTEGRATION_ID,
    knownScopes: ["bot"],
    linkedUserPresent: false,
    revoked: null,
    roleId: null,
    subscriberCount: null,
    syncedAt: null,
    syncing: null,
    type: "discord",
    unknownFieldCounts: {
      account: 0,
      application: 0,
      bot: 0,
      integration: 0,
      user: 0,
    },
    unknownScopeCount: 0,
  }, {
    accountPresent: true,
    applicationId: null,
    associatedBotUserId: null,
    enableEmoticons: true,
    enabled: true,
    expireBehavior: null,
    expireGracePeriod: null,
    id: "905000000000000004",
    knownScopes: [],
    linkedUserPresent: false,
    revoked: null,
    roleId: null,
    subscriberCount: 4,
    syncedAt: "2026-08-21T00:00:00.000Z",
    syncing: false,
    type: "twitch",
    unknownFieldCounts: {
      account: 0,
      application: 0,
      bot: 0,
      integration: 0,
      user: 0,
    },
    unknownScopeCount: 0,
  }]
  let deleteCalls = 0
  let inventoryCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async deleteGuildIntegration(guildId, integrationId, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(integrationId, INTEGRATION_ID)
        assert.equal(auditReason, "Reviewed integration cleanup")
        deleteCalls += 1
        inventory = inventory.filter((entry) => entry.id !== integrationId)
      },
      async getGuildMember(_guildId, userId) {
        return {
          roles: [],
          user: {
            bot: true,
            id: userId,
            username: userId === BOT_ID ? "connector" : "private-associated-bot",
          },
        }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, "@everyone")]
      },
      async listGuildIntegrations(guildId) {
        assert.equal(guildId, GUILD_ID)
        inventoryCalls += 1
        return structuredClone(inventory)
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
      DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS: "true",
      DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
    },
    integrationOptions: {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(23),
      randomId: () => "activity-integration-deletion",
    },
    operationStore,
  })
  const request = {
    acknowledgeAssociatedBotKicked: true,
    acknowledgeAssociatedWebhooksRemoved: true,
    auditReason: "Reviewed integration cleanup",
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKey: "integration-service-attempt-0001",
  }

  const listed = await service.listGuildIntegrations(GUILD_ID)
  const plan = await service.planGuildIntegrationDeletion(request)
  const result = await service.executeGuildIntegrationDeletion(
    request,
    plan.digest,
  )

  assert.equal(listed.integrations.length, 2)
  assert.equal(listed.privacy.namesAndProfilesProjectedOut, true)
  assert.equal(plan.target.id, INTEGRATION_ID)
  assert.equal(plan.associatedBotMembership.present, true)
  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.equal(result.verifiedUnchanged, true)
  assert.equal(deleteCalls, 1)
  assert.equal(inventoryCalls, 5)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "integration-deletion")
  assert.equal(operationStore.receipt?.resourceId, INTEGRATION_ID)
  assert.doesNotMatch(
    JSON.stringify(calls.activityEntries),
    /Reviewed integration cleanup|private-associated-bot|integration-service-attempt/,
  )
})

test("service pins identity through capability-safe invite audit and revocation", async () => {
  const privateCode = "private-invite-capability"
  const operationStore = new MemoryOperationStore()
  let inventory = [{
    channelId: CHANNEL_ID,
    code: privateCode,
    createdAt: "2026-08-20T00:00:00.000Z",
    expiresAt: "2026-08-20T01:00:00.000Z",
    flags: 0,
    guildId: GUILD_ID,
    inviterUserId: MEMBER_USER_ID,
    maxAge: 3_600,
    maxUses: 5,
    roleIds: [],
    targetApplicationId: null,
    targetType: null,
    targetUserId: null,
    temporary: false,
    type: 0,
    uses: 1,
  }]
  let deleteCalls = 0
  let inventoryCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async deleteInvite(code, auditReason) {
        assert.equal(code, privateCode)
        assert.equal(auditReason, "Reviewed invite revocation")
        deleteCalls += 1
        inventory = inventory.filter((entry) => entry.code !== code)
        return {
          channelId: CHANNEL_ID,
          code,
          guildId: GUILD_ID,
          type: 0,
        }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, "@everyone")]
      },
      async listGuildInvites(guildId) {
        assert.equal(guildId, GUILD_ID)
        inventoryCalls += 1
        return inventory
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_INVITE_AUDIT: "true",
      DISCORD_MCP_ALLOW_INVITE_DELETIONS: "true",
      DISCORD_MCP_INVITE_GUILD_IDS: GUILD_ID,
    },
    inviteOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(29),
      randomId: () => "activity-invite-deletion",
    },
    operationStore,
  })

  await assert.rejects(() => service.listGuildInvites("bad"), /guild ID/)
  await assert.rejects(
    () => service.getGuildInvite(GUILD_ID, "private-invite-capability"),
    /invite reference/,
  )
  await assert.rejects(
    () => service.planInviteDeletion({
      auditReason: "Reviewed invite revocation",
      guildId: GUILD_ID,
      inviteRef: "private-invite-capability",
      operationKey: "invite-service-attempt-0001",
    }),
    /invite reference/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const listed = await service.listGuildInvites(GUILD_ID)
  const inviteRef = listed.invites[0]?.inviteRef
  assert.ok(inviteRef)
  const exact = await service.getGuildInvite(GUILD_ID, inviteRef)
  const request = {
    auditReason: "Reviewed invite revocation",
    guildId: GUILD_ID,
    inviteRef,
    operationKey: "invite-service-attempt-0001",
  }
  const plan = await service.planInviteDeletion(request)
  const result = await service.executeInviteDeletion(request, plan.digest)

  assert.equal(exact.invite.inviteRef, inviteRef)
  assert.equal(plan.target.inviteRef, inviteRef)
  assert.equal(plan.privacy.capabilitiesProjectedOut, true)
  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.equal(deleteCalls, 1)
  assert.equal(inventoryCalls, 5)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "invite-deletion")
  assert.equal(operationStore.receipt?.resourceId, inviteRef)
  assert.doesNotMatch(
    JSON.stringify([listed, exact, plan, result, calls.activityEntries, operationStore.receipt]),
    new RegExp(privateCode),
  )
})

test("service pins identity through capability-safe Guild Template audit and changes", async () => {
  const privateCode = "private-template-capability"
  const privateTemplateName = "Private template name"
  const privateTopic = "Private template topic"
  const operationStore = new MemoryOperationStore()
  let inventory: DiscordGuildTemplateSummary[] = [{
    code: privateCode,
    createdAt: "2026-08-20T00:00:00.000Z",
    creatorId: MEMBER_USER_ID,
    description: "Private description",
    isDirty: true,
    name: privateTemplateName,
    serializedSourceGuild: {
      channels: [{
        id: 1,
        name: "private-template-channel",
        parent_id: null,
        permission_overwrites: [],
        position: 1,
        topic: privateTopic,
        type: 0,
      }],
      name: "Private template guild",
      roles: [{
        color: 0,
        hoist: false,
        id: 0,
        mentionable: false,
        name: "@everyone",
        permissions: "0",
      }],
    },
    sourceGuildId: GUILD_ID,
    unknownFieldCount: 0,
    updatedAt: "2026-08-21T00:00:00.000Z",
    usageCount: 3,
  }]
  let inventoryCalls = 0
  let updateCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, "@everyone")]
      },
      async listGuildTemplates(guildId) {
        assert.equal(guildId, GUILD_ID)
        inventoryCalls += 1
        return inventory
      },
      async modifyGuildTemplate(guildId, code, input) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(code, privateCode)
        updateCalls += 1
        inventory = inventory.map((entry) => entry.code === code
          ? {
              ...entry,
              ...(input.description !== undefined
                ? { description: input.description }
                : {}),
              ...(input.name !== undefined ? { name: input.name } : {}),
            }
          : entry)
        return inventory[0] as DiscordGuildTemplateSummary
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES: "true",
      DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: GUILD_ID,
    },
    guildTemplateOptions: {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(37),
      randomId: () => "activity-guild-template-change",
    },
    operationStore,
  })

  await assert.rejects(
    () => service.planGuildTemplateChange({
      action: "create",
      auditReason: "Reviewed invalid Guild Template",
      description: null,
      guildId: "bad",
      name: "Invalid",
      operationKey: "guild-template-invalid-attempt-0001",
    }),
    /guild-template guild ID/,
  )
  await assert.rejects(
    () => service.executeGuildTemplateChange({
      action: "create",
      auditReason: "Reviewed invalid Guild Template digest",
      description: null,
      guildId: GUILD_ID,
      name: "Invalid digest",
      operationKey: "guild-template-invalid-attempt-0002",
    }, "invalid"),
    /guild-template plan digest/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const listed = await service.listGuildTemplates(GUILD_ID)
  const templateRef = listed.templates[0]?.templateRef
  assert.ok(templateRef)
  const request = {
    action: "update-metadata" as const,
    auditReason: "Reviewed Guild Template metadata",
    description: "",
    guildId: GUILD_ID,
    name: "Reviewed template",
    operationKey: "guild-template-service-attempt-0001",
    templateRef,
  }
  const plan = await service.planGuildTemplateChange(request)
  const result = await service.executeGuildTemplateChange(request, plan.digest)

  assert.deepEqual(listed.guild, { id: GUILD_ID })
  assert.equal(plan.target?.templateRef, templateRef)
  assert.equal(plan.access.manageGuild, true)
  assert.equal(result.status, "completed")
  assert.equal(result.readbackMatched, true)
  assert.equal(updateCalls, 1)
  assert.equal(inventoryCalls, 4)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "guild-template-change")
  assert.equal(operationStore.receipt?.resourceId, templateRef)
  assert.doesNotMatch(
    JSON.stringify([
      listed,
      result,
      calls.activityEntries,
      operationStore.receipt,
    ]),
    new RegExp(`${privateCode}|${privateTemplateName}|${privateTopic}`),
  )
})

test("service pins identity through privacy-safe reviewed onboarding", async () => {
  const operationStore = new MemoryOperationStore()
  let onboardingReads = 0
  let onboardingWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: ["COMMUNITY"],
          owner_id: "700000000000000001",
        }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildOnboarding(guildId) {
        assert.equal(guildId, GUILD_ID)
        onboardingReads += 1
        return {
          defaultChannelIds: [],
          enabled: false,
          guildId,
          mode: 0,
          prompts: [],
          unknownEnumCount: 0,
          unknownFieldCount: 0,
        }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD | DISCORD_PERMISSIONS.MANAGE_ROLES,
          "@everyone",
        )]
      },
      async modifyGuildOnboarding() {
        onboardingWrites += 1
        throw new Error("Unexpected onboarding write")
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "true",
      DISCORD_MCP_ALLOW_ONBOARDING_CHANGES: "true",
      DISCORD_MCP_ONBOARDING_GUILD_IDS: GUILD_ID,
    },
    onboardingOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(41),
      randomId: () => "activity-onboarding",
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed disabled onboarding",
    defaultChannelIds: [],
    enabled: false,
    guildId: GUILD_ID,
    mode: "default" as const,
    operationKey: "onboarding-service-attempt-0001",
    prompts: [],
  }

  await assert.rejects(
    () => service.getGuildOnboarding("bad"),
    /onboarding guild ID/,
  )
  await assert.rejects(
    () => service.planOnboardingChange({ ...request, guildId: "bad" }),
    /onboarding guild ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildOnboarding(GUILD_ID)
  const plan = await service.planOnboardingChange(request)
  const result = await service.executeOnboardingChange(request, plan.digest)

  assert.equal(audit.privacy.text, "omitted")
  assert.equal(audit.configuration.textIncluded, false)
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(onboardingReads, 3)
  assert.equal(onboardingWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through privacy-safe reviewed Welcome Screens", async () => {
  const operationStore = new MemoryOperationStore()
  let welcomeScreenReads = 0
  let welcomeScreenWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: ["COMMUNITY"],
          owner_id: "700000000000000001",
        }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD,
          "@everyone",
        )]
      },
      async getGuildWelcomeScreen(guildId) {
        assert.equal(guildId, GUILD_ID)
        welcomeScreenReads += 1
        return {
          description: null,
          unknownFieldCount: 0,
          welcomeChannels: [],
        }
      },
      async modifyGuildWelcomeScreen() {
        welcomeScreenWrites += 1
        throw new Error("Unexpected Welcome Screen write")
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "true",
      DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES: "true",
      DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS: GUILD_ID,
    },
    operationStore,
    welcomeScreenOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(43),
      randomId: () => "activity-welcome-screen",
    },
  })
  const request = {
    auditReason: "Reviewed disabled Welcome Screen",
    channels: [],
    description: null,
    enabled: false,
    guildId: GUILD_ID,
    operationKey: "welcome-screen-service-attempt-0001",
  }

  await assert.rejects(
    () => service.getGuildWelcomeScreen("bad"),
    /Welcome Screen guild ID/,
  )
  await assert.rejects(
    () => service.planWelcomeScreenChange({ ...request, guildId: "bad" }),
    /Welcome Screen guild ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildWelcomeScreen(GUILD_ID)
  const plan = await service.planWelcomeScreenChange(request)
  const result = await service.executeWelcomeScreenChange(request, plan.digest)

  assert.equal(audit.privacy.text, "omitted")
  assert.equal(audit.configuration.textIncluded, false)
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(welcomeScreenReads, 3)
  assert.equal(welcomeScreenWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through authenticated reviewed widget settings", async () => {
  const operationStore = new MemoryOperationStore()
  let widgetSettingsReads = 0
  let widgetSettingsWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: [],
          owner_id: "700000000000000001",
        }
      },
      async getGuildMember() {
        return { roles: [CREATED_ROLE_ID], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "@everyone"),
          role(CREATED_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, "connector-role"),
        ]
      },
      async getGuildWidgetSettings(guildId) {
        assert.equal(guildId, GUILD_ID)
        widgetSettingsReads += 1
        return {
          channelId: null,
          enabled: false,
          unknownFieldCount: 0,
        }
      },
      async modifyGuildWidgetSettings() {
        widgetSettingsWrites += 1
        throw new Error("Unexpected widget-settings change")
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
      DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES: "true",
      DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: GUILD_ID,
    },
    operationStore,
    widgetSettingsOptions: {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(47),
      randomId: () => "activity-widget-settings",
    },
  })
  const request = {
    auditReason: "Reviewed disabled widget settings",
    channelId: null,
    enabled: false,
    guildId: GUILD_ID,
    operationKey: "widget-settings-service-attempt-0001",
  }

  await assert.rejects(
    () => service.getGuildWidgetSettings("bad"),
    /widget-settings guild ID/,
  )
  await assert.rejects(
    () => service.planWidgetSettingsChange({ ...request, guildId: "bad" }),
    /widget-settings guild ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildWidgetSettings(GUILD_ID)
  const plan = await service.planWidgetSettingsChange(request)
  const result = await service.executeWidgetSettingsChange(request, plan.digest)

  assert.equal(audit.privacy.anonymousEndpoints, "not-called")
  assert.equal(audit.publicExposure.serverProfileVisibility, "not-verifiable")
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(widgetSettingsReads, 3)
  assert.equal(widgetSettingsWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through transient channel metadata reads and reviewed changes", async () => {
  const operationStore = new MemoryOperationStore()
  let metadataReads = 0
  let metadataWrites = 0
  const { calls, service } = serviceFixture({
    channelMetadataOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(47),
      randomId: () => "activity-channel-metadata",
    },
    client: {
      async getGuildChannelMetadata(channelId) {
        assert.equal(channelId, CHANNEL_ID)
        metadataReads += 1
        return {
          defaultAutoArchiveDuration: 1_440,
          defaultThreadRateLimitPerUser: 0,
          guildId: GUILD_ID,
          id: channelId,
          name: "general",
          nsfw: false,
          parentId: null,
          permissionOverwrites: [],
          position: 1,
          rateLimitPerUser: 0,
          topic: "Private guild topic",
          type: 0,
          unknownFieldCount: 0,
        }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_CHANNELS | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
      async modifyGuildChannelMetadata() {
        metadataWrites += 1
        throw new Error("Unexpected channel metadata write")
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "true",
      DISCORD_MCP_CHANNEL_METADATA_IDS: CHANNEL_ID,
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed unchanged channel metadata",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    name: "general",
    operationKey: "channel-metadata-service-attempt-0001",
  }

  await assert.rejects(
    () => service.getChannel("bad"),
    /channel metadata ID/,
  )
  await assert.rejects(
    () => service.planChannelMetadataChange({ ...request, channelId: "bad" }),
    /channel metadata ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const read = await service.getChannel(CHANNEL_ID)
  const plan = await service.planChannelMetadataChange(request)
  const result = await service.executeChannelMetadataChange(request, plan.digest)

  assert.equal(read.metadata.topic, "Private guild topic")
  assert.equal(read.privacy.persistence, "none")
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(metadataReads, 3)
  assert.equal(metadataWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through privacy-safe guild expression reads and reviewed changes", async () => {
  const expressionId = "910000000000000001"
  const operationStore = new MemoryOperationStore()
  let inventory = [{
    animated: false,
    available: true,
    creatorUserId: BOT_ID,
    id: expressionId,
    managed: false,
    name: "wave",
    requiresColons: true,
    roleIds: [],
  }]
  let inventoryCalls = 0
  let updateCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildEmoji(_guildId, requestedExpressionId) {
        const found = inventory.find((entry) => entry.id === requestedExpressionId)
        if (!found) throw new Error("Unexpected missing emoji")
        return found
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS, "@everyone")]
      },
      async listGuildEmojis(guildId) {
        assert.equal(guildId, GUILD_ID)
        inventoryCalls += 1
        return inventory
      },
      async modifyGuildEmoji(guildId, requestedExpressionId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(requestedExpressionId, expressionId)
        assert.equal(auditReason, "Reviewed expression update")
        updateCalls += 1
        inventory = inventory.map((entry) => entry.id === requestedExpressionId
          ? { ...entry, name: input.name ?? entry.name }
          : entry)
        return inventory[0]!
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT: "true",
      DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES: "true",
      DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS: GUILD_ID,
    },
    guildExpressionOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(23),
      randomId: () => "activity-guild-expression-change",
    },
    operationStore,
  })
  const request = {
    action: "update" as const,
    auditReason: "Reviewed expression update",
    expressionId,
    guildId: GUILD_ID,
    kind: "emoji" as const,
    name: "hello",
    operationKey: "guild-expression-service-attempt-0001",
  }

  const listed = await service.listGuildExpressions(GUILD_ID, "emoji")
  const exact = await service.getGuildExpression(GUILD_ID, "emoji", expressionId)
  const plan = await service.planGuildExpressionChange(request)
  const result = await service.executeGuildExpressionChange(request, plan.digest)

  assert.equal(listed.expressions.length, 1)
  assert.equal(exact.expression.expressionId, expressionId)
  assert.equal(plan.existing?.expressionId, expressionId)
  assert.equal(plan.permission.createGuildExpressions, true)
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "hello")
  assert.equal(inventoryCalls, 4)
  assert.equal(updateCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "guild-expression-change")
  assert.equal(operationStore.receipt?.resourceId, expressionId)
})

test("service pins identity through privacy-safe AutoMod reads and reviewed changes", async () => {
  const operationStore = new MemoryOperationStore()
  let rule: DiscordAutoModerationRuleSummary = {
    actions: [{
      customMessage: null,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }],
    creatorUserId: BOT_ID,
    enabled: false,
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    exemptChannelIds: [],
    exemptRoleIds: [],
    guildId: GUILD_ID,
    id: AUTOMOD_RULE_ID,
    name: "Private keyword policy",
    trigger: {
      allowList: [],
      keywordFilter: ["private blocked phrase"],
      regexPatterns: [],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    },
  }
  let exactReads = 0
  let inventoryReads = 0
  let updateCalls = 0
  const { calls, service } = serviceFixture({
    automodOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(31),
      randomId: () => "activity-automod-change",
    },
    client: {
      async getGuildAutoModerationRule(guildId, ruleId) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(ruleId, AUTOMOD_RULE_ID)
        exactReads += 1
        return rule
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, "@everyone")]
      },
      async listGuildAutoModerationRules(guildId) {
        assert.equal(guildId, GUILD_ID)
        inventoryReads += 1
        return [rule]
      },
      async modifyGuildAutoModerationRule(guildId, ruleId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(ruleId, AUTOMOD_RULE_ID)
        assert.equal(auditReason, "Reviewed AutoMod update")
        updateCalls += 1
        rule = {
          ...rule,
          name: input.name ?? rule.name,
        }
        return rule
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_AUTOMOD_AUDIT: "true",
      DISCORD_MCP_ALLOW_AUTOMOD_CHANGES: "true",
      DISCORD_MCP_AUTOMOD_GUILD_IDS: GUILD_ID,
    },
    operationStore,
  })
  const request = {
    action: "update" as const,
    auditReason: "Reviewed AutoMod update",
    guildId: GUILD_ID,
    name: "Updated keyword policy",
    operationKey: "automod-service-attempt-0001",
    ruleId: AUTOMOD_RULE_ID,
  }

  const listed = await service.listAutoModerationRules(GUILD_ID)
  const exact = await service.getAutoModerationRule(GUILD_ID, AUTOMOD_RULE_ID)
  const plan = await service.planAutoModerationChange(request)
  const result = await service.executeAutoModerationChange(request, plan.digest)

  assert.equal(listed.rules.length, 1)
  assert.equal(JSON.stringify(listed).includes("private blocked phrase"), false)
  assert.equal(JSON.stringify(exact).includes("private blocked phrase"), true)
  assert.equal(plan.existing?.ruleId, AUTOMOD_RULE_ID)
  assert.deepEqual(plan.permission.requiredPermissions, ["MANAGE_GUILD"])
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "Updated keyword policy")
  assert.equal(inventoryReads, 1)
  assert.equal(exactReads, 4)
  assert.equal(updateCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(calls.activityEntries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  assert.equal(operationStore.receipt?.kind, "automod-change")
  assert.equal(operationStore.receipt?.resourceId, AUTOMOD_RULE_ID)
})

test("service pins identity through privacy-safe scheduled event reads and reviewed changes", async () => {
  const operationStore = new MemoryOperationStore()
  let scheduledEvent: DiscordScheduledEventSummary = {
    channelId: CHANNEL_ID,
    creatorUserId: BOT_ID,
    description: "Private planning details",
    entityId: null,
    entityType: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice,
    guildId: GUILD_ID,
    hasCoverImage: false,
    id: SCHEDULED_EVENT_ID,
    location: null,
    name: "Planning call",
    privacyLevel: 2,
    recurrenceRule: null,
    scheduledEndTime: null,
    scheduledStartTime: "2026-09-01T20:00:00.000Z",
    status: DISCORD_SCHEDULED_EVENT_STATUSES.scheduled,
    subscriberCount: null,
  }
  let exactReads = 0
  let inventoryReads = 0
  let updateCalls = 0
  const botPermissions = DISCORD_PERMISSIONS.CREATE_EVENTS
    | DISCORD_PERMISSIONS.MANAGE_EVENTS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.CONNECT
  const { calls, service } = serviceFixture({
    client: {
      async getGuildChannels() {
        return [channel({ type: 2 })]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, botPermissions, "@everyone")]
      },
      async getGuildScheduledEvent(guildId, eventId, options) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(eventId, SCHEDULED_EVENT_ID)
        exactReads += 1
        return {
          ...scheduledEvent,
          subscriberCount: options?.includeSubscriberCount ? 4 : null,
        }
      },
      async listGuildScheduledEvents(guildId, options) {
        assert.equal(guildId, GUILD_ID)
        inventoryReads += 1
        return [{
          ...scheduledEvent,
          subscriberCount: options?.includeSubscriberCount ? 4 : null,
        }]
      },
      async modifyGuildScheduledEvent(guildId, eventId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(eventId, SCHEDULED_EVENT_ID)
        assert.equal(auditReason, "Reviewed event update")
        updateCalls += 1
        scheduledEvent = {
          ...scheduledEvent,
          name: input.name ?? scheduledEvent.name,
        }
        return scheduledEvent
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
      DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
      DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS: GUILD_ID,
    },
    operationStore,
    scheduledEventOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(29),
      randomId: () => "activity-scheduled-event-change",
    },
  })
  const request = {
    action: "update" as const,
    auditReason: "Reviewed event update",
    eventId: SCHEDULED_EVENT_ID,
    guildId: GUILD_ID,
    name: "Release planning call",
    operationKey: "scheduled-event-service-attempt-0001",
  }

  const listed = await service.listScheduledEvents(GUILD_ID, true)
  const exact = await service.getScheduledEvent(GUILD_ID, SCHEDULED_EVENT_ID)
  const plan = await service.planScheduledEventChange(request)
  const result = await service.executeScheduledEventChange(request, plan.digest)

  assert.equal(listed.events[0]?.event.subscriberCount, 4)
  assert.equal(exact.event.subscriberCount, null)
  assert.equal(plan.existing?.eventId, SCHEDULED_EVENT_ID)
  assert.deepEqual(plan.permission.current.requiredPermissions, [
    "MANAGE_EVENTS",
    "VIEW_CHANNEL",
    "CONNECT",
  ])
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "Release planning call")
  assert.equal(inventoryReads, 1)
  assert.equal(exactReads, 4)
  assert.equal(updateCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(calls.activityEntries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  assert.equal(operationStore.receipt?.kind, "scheduled-event-change")
  assert.equal(operationStore.receipt?.resourceId, SCHEDULED_EVENT_ID)
})

test("service pins identity through privacy-safe reviewed soundboard changes", async () => {
  const operationStore = new MemoryOperationStore()
  let sound: DiscordSoundboardSoundSummary = {
    available: true,
    creatorUserId: BOT_ID,
    emojiId: null,
    emojiName: "🎺",
    guildId: GUILD_ID,
    id: SOUNDBOARD_SOUND_ID,
    name: "launch",
    unknownFieldCount: 0,
    volume: 0.8,
  }
  let defaultReads = 0
  let exactReads = 0
  let inventoryReads = 0
  let updateCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS, "@everyone")]
      },
      async getGuildSoundboardSound(guildId, soundId) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(soundId, SOUNDBOARD_SOUND_ID)
        exactReads += 1
        return sound
      },
      async listDefaultSoundboardSounds() {
        defaultReads += 1
        return [{ ...sound, creatorUserId: null, guildId: null }]
      },
      async listGuildSoundboardSounds(guildId) {
        assert.equal(guildId, GUILD_ID)
        inventoryReads += 1
        return [sound]
      },
      async modifyGuildSoundboardSound(guildId, soundId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(soundId, SOUNDBOARD_SOUND_ID)
        assert.equal(auditReason, "Reviewed soundboard update")
        updateCalls += 1
        sound = {
          ...sound,
          name: input.name ?? sound.name,
        }
        return sound
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT: "true",
      DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES: "true",
      DISCORD_MCP_SOUNDBOARD_GUILD_IDS: GUILD_ID,
    },
    operationStore,
    soundboardOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(37),
      randomId: () => "activity-soundboard-change",
    },
  })
  const request = {
    action: "update" as const,
    auditReason: "Reviewed soundboard update",
    guildId: GUILD_ID,
    name: "arrival",
    operationKey: "soundboard-service-attempt-0001",
    soundId: SOUNDBOARD_SOUND_ID,
  }

  const defaults = await service.listDefaultSoundboardSounds()
  const listed = await service.listGuildSoundboardSounds(GUILD_ID)
  const exact = await service.getGuildSoundboardSound(GUILD_ID, SOUNDBOARD_SOUND_ID)
  const plan = await service.planSoundboardChange(request)
  const result = await service.executeSoundboardChange(request, plan.digest)

  assert.equal(defaults.sounds[0]?.guildId, null)
  assert.equal(listed.sounds.length, 1)
  assert.equal(exact.sound.soundId, SOUNDBOARD_SOUND_ID)
  assert.equal(plan.existing?.soundId, SOUNDBOARD_SOUND_ID)
  assert.equal(plan.permission.createGuildExpressions, true)
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "arrival")
  assert.equal(defaultReads, 1)
  assert.equal(inventoryReads, 4)
  assert.equal(exactReads, 2)
  assert.equal(updateCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(calls.activityEntries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  assert.equal(operationStore.receipt?.kind, "guild-soundboard-change")
  assert.equal(operationStore.receipt?.resourceId, SOUNDBOARD_SOUND_ID)
})

test("service pins identity through privacy-safe reviewed Stage-instance lifecycle", async () => {
  const operationStore = new MemoryOperationStore()
  let stageInstance: DiscordStageInstanceSummary = {
    channelId: CHANNEL_ID,
    discoverableDisabled: true,
    guildId: GUILD_ID,
    id: STAGE_INSTANCE_ID,
    privacyLevel: DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.guildOnly,
    scheduledEventId: null,
    topic: "Private planning session",
    unknownFieldCount: 0,
  }
  let exactReads = 0
  let updateCalls = 0
  const botPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.CONNECT
    | DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MUTE_MEMBERS
    | DISCORD_PERMISSIONS.MOVE_MEMBERS
  const { calls, service } = serviceFixture({
    client: {
      async getChannel() {
        return channel({ name: "Private Stage", type: 13 })
      },
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, botPermissions, "@everyone")]
      },
      async getStageInstance(channelId) {
        assert.equal(channelId, CHANNEL_ID)
        exactReads += 1
        return stageInstance
      },
      async modifyStageInstance(channelId, input, auditReason) {
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(auditReason, "Reviewed Stage topic update")
        updateCalls += 1
        stageInstance = { ...stageInstance, topic: input.topic }
        return stageInstance
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT: "true",
      DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES: "true",
      DISCORD_MCP_STAGE_CHANNEL_IDS: CHANNEL_ID,
    },
    operationStore,
    stageInstanceOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(30),
      randomId: () => "activity-stage-instance-change",
    },
  })
  const request = {
    action: "update" as const,
    auditReason: "Reviewed Stage topic update",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: "stage-instance-service-attempt-0001",
    topic: "Release planning session",
  }

  const listed = await service.listStageInstances()
  const exact = await service.getStageInstance(GUILD_ID, CHANNEL_ID)
  const plan = await service.planStageInstanceChange(request)
  const result = await service.executeStageInstanceChange(request, plan.digest)

  assert.equal(listed.entries[0]?.instance?.id, STAGE_INSTANCE_ID)
  assert.equal(exact.instance?.topic, "Private planning session")
  assert.equal(plan.existing?.id, STAGE_INSTANCE_ID)
  assert.deepEqual(plan.permission.requiredPermissions, [
    "VIEW_CHANNEL",
    "CONNECT",
    "MANAGE_CHANNELS",
    "MUTE_MEMBERS",
    "MOVE_MEMBERS",
  ])
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.topic, "Release planning session")
  assert.equal(exactReads, 5)
  assert.equal(updateCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(calls.activityEntries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  assert.equal(operationStore.receipt?.kind, "stage-instance-change")
  assert.equal(operationStore.receipt?.resourceId, STAGE_INSTANCE_ID)
  assert.doesNotMatch(
    JSON.stringify(operationStore.receipt),
    /Private planning session|Release planning session|stage-instance-service-attempt/,
  )
})

test("service verifies identity through reviewed channel permission changes", async () => {
  const operationStore = new MemoryOperationStore()
  const targetRoleId = CREATED_ROLE_ID
  let currentChannel = channel()
  let overwriteWrites = 0
  const botPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  const { calls, service } = serviceFixture({
    client: {
      async editChannelPermissionOverwrite(channelId, targetId, input) {
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(targetId, targetRoleId)
        overwriteWrites += 1
        currentChannel = channel({
          permission_overwrites: [{
            allow: input.allow,
            deny: input.deny,
            id: targetId,
            type: input.type,
          }],
        })
      },
      async getChannel() {
        return currentChannel
      },
      async getGuild() {
        return {
          ...guild(),
          owner_id: "900000000000000001",
        }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, botPermissions, "@everyone"),
          role(targetRoleId, DISCORD_PERMISSIONS.VIEW_CHANNEL, "reviewers"),
        ]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
      DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: CHANNEL_ID,
    },
    operationStore,
    permissionOverwriteOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(17),
      randomId: () => "activity-permission-overwrite",
    },
  })
  const request = {
    auditReason: "Reviewed private-channel access",
    changes: [{ permission: "SEND_MESSAGES" as const, state: "deny" as const }],
    channelId: CHANNEL_ID,
    mode: "update" as const,
    operationKey: "permission-overwrite-service-attempt-0001",
    targetId: targetRoleId,
    targetType: "role" as const,
  }

  const inventory = await service.listChannelPermissionOverwrites(CHANNEL_ID)
  const plan = await service.planChannelPermissionOverwrite(request)
  const result = await service.executeChannelPermissionOverwrite(request, plan.digest)

  assert.equal(inventory.overwrites.length, 0)
  assert.equal(plan.action, "put")
  assert.equal(result.status, "completed")
  assert.equal(result.targetMatched, true)
  assert.equal(overwriteWrites, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "channel-permission-overwrite")
  assert.equal(operationStore.receipt?.resourceId, targetRoleId)
})

test("service verifies identity before reviewed local-file attachment execution", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-service-attachment-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "report.txt")
  const fileContent = "reviewed service bytes"
  const operationKey = "attachment-service-attempt-0001"
  await writeFile(filePath, fileContent)
  const operationStore = new MemoryOperationStore()
  let uploaded: Parameters<DiscordServiceClient["createAttachmentMessage"]>[1]
    | undefined
  let uploadCalls = 0
  const { calls, service } = serviceFixture({
    attachmentMessageOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(11),
      randomId: () => "activity-attachment-send",
    },
    client: {
      async createAttachmentMessage(channelId, input) {
        assert.equal(channelId, CHANNEL_ID)
        uploaded = input
        uploadCalls += 1
        return message({
          attachments: [{
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            filename: input.filename,
            id: "800000000000000001",
            size: input.bytes.byteLength,
            url: "https://cdn.discord.test/private",
          }],
          author: bot(),
          content: input.content ?? "",
          nonce: input.nonce,
        })
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.ATTACH_FILES
            | DISCORD_PERMISSIONS.SEND_MESSAGES,
          "@everyone",
        )]
      },
      async getMessage() {
        if (!uploaded) throw new Error("Attachment upload input is missing")
        return message({
          attachments: [{
            ...(uploaded.description === undefined
              ? {}
              : { description: uploaded.description }),
            filename: uploaded.filename,
            id: "800000000000000001",
            size: uploaded.bytes.byteLength,
            url: "https://cdn.discord.test/private",
          }],
          author: bot(),
          content: uploaded.content ?? "",
          nonce: uploaded.nonce,
        })
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ATTACHMENTS: "true",
      DISCORD_MCP_ATTACHMENT_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ATTACHMENT_MAX_BYTES: "1024",
      DISCORD_MCP_ATTACHMENT_ROOTS: root,
      DISCORD_MCP_ALLOW_INTERACTIONS: "true",
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "1000",
    },
    interactionOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
    },
    operationStore,
  })
  const request = {
    channelId: CHANNEL_ID,
    content: "Reviewed report",
    description: "Accessible report",
    filePath,
    operationKey,
  }

  const plan = await service.planAttachmentMessage(request)
  const result = await service.executeAttachmentMessage(request, plan.digest)

  assert.equal(plan.file.canonicalPath, filePath)
  assert.equal(plan.file.sizeBytes, Buffer.byteLength(fileContent))
  assert.equal(result.status, "completed")
  assert.equal(result.messageId, MESSAGE_ID)
  assert.equal(uploadCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(operationStore.receipt?.kind, "attachment-message")
  assert.equal(operationStore.receipt?.status, "completed")
  await assert.rejects(
    service.sendMessage({
      channelId: CHANNEL_ID,
      content: "Should share the attachment limiter",
      idempotencyKey: "shared-limit-attempt-0001",
    }),
    InteractionRateLimitError,
  )
  assert.equal(calls.createMessage, 0)
  const persisted = JSON.stringify(operationStore.receipt)
  assert.equal(persisted.includes(operationKey), false)
  assert.equal(persisted.includes(filePath), false)
  assert.equal(persisted.includes(fileContent), false)
})

test("service verifies component messages and shares the interaction limiter", async () => {
  const operationStore = new MemoryOperationStore()
  let created: DiscordMessage | undefined
  const { calls, service } = serviceFixture({
    client: {
      async createComponentMessage(channelId, input) {
        assert.equal(channelId, CHANNEL_ID)
        calls.createComponentMessage += 1
        created = message({
          attachments: [],
          author: bot(),
          channel_id: CHANNEL_ID,
          components: [{ content: "Reviewed component", id: 1, type: 10 }],
          content: "",
          edited_timestamp: null,
          embeds: [],
          flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
          mention_everyone: false,
          mention_roles: [],
          mentions: [],
          nonce: input.nonce,
          pinned: false,
          sticker_items: [],
          tts: false,
          type: 0,
        })
        return created
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.SEND_MESSAGES
            | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
      async getMessage() {
        assert.ok(created)
        return created
      },
    },
    componentMessageOptions: {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(12),
      randomId: () => "activity-component-create",
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_INTERACTIONS: "true",
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE: "1",
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "0",
    },
    operationStore,
  })
  const request = {
    action: "create" as const,
    channelId: CHANNEL_ID,
    components: [{ content: "Reviewed component", kind: "text" as const }],
    operationKey: "component-service-attempt-0001",
  }

  const plan = await service.planComponentMessage(request)
  const result = await service.executeComponentMessage(request, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.messageId, MESSAGE_ID)
  assert.equal(calls.createComponentMessage, 1)
  assert.equal(operationStore.receipt?.kind, "component-message")
  assert.equal(operationStore.receipt?.status, "completed")
  await assert.rejects(
    service.sendMessage({
      channelId: CHANNEL_ID,
      content: "Should share the component limiter",
      idempotencyKey: "shared-component-limit-attempt-0001",
    }),
    InteractionRateLimitError,
  )
  assert.equal(calls.createMessage, 0)
  const persisted = JSON.stringify(operationStore.receipt)
  assert.equal(persisted.includes(request.operationKey), false)
  assert.equal(persisted.includes("Reviewed component"), false)
})

test("service coordinates component edits only when the exact message changes", async () => {
  const writeCoordinator = new CapturingWriteCoordinator()
  const existing = message({
    attachments: [],
    author: bot(),
    components: [{ content: "Before", id: 1, type: 10 }],
    content: "",
    edited_timestamp: null,
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    sticker_items: [],
    tts: false,
    type: 0,
  })
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.SEND_MESSAGES
            | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
      async getMessage() {
        return existing
      },
    },
    componentMessageOptions: {
      planKey: new Uint8Array(32).fill(13),
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_INTERACTIONS: "true",
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "0",
    },
    writeCoordinator,
  })
  const noOpRequest = {
    action: "edit" as const,
    channelId: CHANNEL_ID,
    components: [{ content: "Before", kind: "text" as const }],
    messageId: MESSAGE_ID,
    operationKey: "component-noop-attempt-0001",
  }

  const noOpPlan = await service.planComponentMessage(noOpRequest)
  const noOp = await service.executeComponentMessage(noOpRequest, noOpPlan.digest)

  assert.equal(noOp.status, "already-current")
  assert.equal(writeCoordinator.intents.length, 0)
  assert.equal(calls.editComponentMessage, 0)

  const editRequest = {
    ...noOpRequest,
    components: [{ content: "After", kind: "text" as const }],
    operationKey: "component-edit-attempt-0001",
  }
  const editPlan = await service.planComponentMessage(editRequest)
  await assert.rejects(
    () => service.executeComponentMessage(editRequest, editPlan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "component-message",
    operationKeyHash: operationKeyHash(editRequest.operationKey),
    planDigest: editPlan.digest,
    targets: [{ id: MESSAGE_ID, kind: "message" }],
  }])
  assert.equal(calls.editComponentMessage, 0)
})

test("service verifies identity before planning and executing exact member moderation", async () => {
  const targetId = "700000000000000002"
  const botRoleId = "800000000000000001"
  const targetRoleId = "800000000000000002"
  const writeCoordinator = new CapturingWriteCoordinator()
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildMember(_guildId, userId) {
        return userId === BOT_ID
          ? { roles: [botRoleId], user: bot() }
          : {
              roles: [targetRoleId],
              user: { id: targetId, username: "target" },
            }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          {
            ...role(botRoleId, DISCORD_PERMISSIONS.KICK_MEMBERS, "bot-role"),
            position: 10,
          },
          { ...role(targetRoleId, 0n, "target-role"), position: 1 },
        ]
      },
    },
    environment: {
      DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
    },
    writeCoordinator,
  })
  const request = {
    action: "kick" as const,
    auditReason: "Reviewed safety incident 42",
    guildId: GUILD_ID,
    userId: targetId,
  }

  const plan = await service.planMemberModeration(request)
  const result = await service.executeMemberModeration(request, plan.digest)

  assert.equal(plan.target.id, targetId)
  assert.equal(result.status, "completed")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.removeMember, 1)
  assert.deepEqual(writeCoordinator.intents, [])
})

test("service pins identity through reviewed exact member-role changes", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "800000000000000001"
  const selectedRoleId = "800000000000000002"
  const targetId = "700000000000000002"
  let targetRoleIds: string[] = []
  let roleWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async addGuildMemberRole(guildId, userId, roleId, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(userId, targetId)
        assert.equal(roleId, selectedRoleId)
        assert.equal(auditReason, "Reviewed exact role assignment")
        roleWrites += 1
        targetRoleIds = [selectedRoleId]
      },
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildChannels() {
        return [channel()]
      },
      async getGuildMember(_guildId, userId) {
        return userId === BOT_ID
          ? { roles: [botRoleId], user: bot() }
          : {
              pending: false,
              roles: [...targetRoleIds],
              user: { id: targetId, username: "target" },
            }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "@everyone"),
          {
            ...role(
              botRoleId,
              DISCORD_PERMISSIONS.MANAGE_ROLES
                | DISCORD_PERMISSIONS.VIEW_CHANNEL
                | DISCORD_PERMISSIONS.SEND_MESSAGES,
              "connector",
            ),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
          {
            ...role(selectedRoleId, DISCORD_PERMISSIONS.SEND_MESSAGES, "reviewer"),
            position: 2,
          },
        ]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES: "true",
      DISCORD_MCP_MEMBER_ROLE_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_MEMBER_ROLE_IDS: selectedRoleId,
    },
    memberRoleOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(5),
      randomId: () => "activity-member-role",
    },
    operationStore,
  })
  const request = {
    action: "add" as const,
    auditReason: "Reviewed exact role assignment",
    guildId: GUILD_ID,
    operationKey: "member-role-attempt-0001",
    roleId: selectedRoleId,
    userId: targetId,
  }

  const plan = await service.planMemberRoleChange(request)
  const result = await service.executeMemberRoleChange(request, plan.digest)

  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.action, "add")
  assert.equal(result.status, "completed")
  assert.equal(result.rolePresent, true)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(roleWrites, 1)
  assert.equal(operationStore.receipt?.kind, "member-role-change")
  assert.equal(operationStore.receipt?.status, "completed")
  assert.doesNotMatch(
    JSON.stringify(operationStore.receipt),
    /member-role-attempt|Reviewed exact|reviewer|target/,
  )
})

test("service pins identity through privacy-safe reviewed member voice changes", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "800000000000000011"
  const targetRoleId = "800000000000000012"
  const targetId = "700000000000000012"
  let voiceState = {
    channelId: CHANNEL_ID,
    deaf: false,
    guildId: GUILD_ID,
    mute: false,
    unknownFieldCount: 0,
    userId: targetId,
  }
  let voiceWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getChannel(channelId) {
        return channel({
          id: channelId,
          name: channelId === CHANNEL_ID ? "private-source" : "private-destination",
          type: 2,
        })
      },
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildMember(_guildId, userId) {
        return userId === BOT_ID
          ? { roles: [botRoleId], user: bot() }
          : {
              roles: [targetRoleId],
              user: { id: targetId, username: "target" },
            }
      },
      async getGuildRoles() {
        return [
          role(
            GUILD_ID,
            DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.CONNECT,
            "@everyone",
          ),
          {
            ...role(
              botRoleId,
              DISCORD_PERMISSIONS.MOVE_MEMBERS
                | DISCORD_PERMISSIONS.MUTE_MEMBERS
                | DISCORD_PERMISSIONS.DEAFEN_MEMBERS,
              "connector",
            ),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
          { ...role(targetRoleId, 0n, "target-role"), position: 1 },
        ]
      },
      async getGuildVoiceState(guildId, userId) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(userId, targetId)
        return voiceState
      },
      async modifyGuildMemberVoice(guildId, userId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(userId, targetId)
        assert.equal(auditReason, "Reviewed exact voice move")
        assert.deepEqual(input, { channelId: OTHER_CHANNEL_ID })
        voiceWrites += 1
        voiceState = { ...voiceState, channelId: OTHER_CHANNEL_ID }
        return {
          deaf: voiceState.deaf,
          mute: voiceState.mute,
          unknownFieldCount: 0,
          userId,
        }
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT: "true",
      DISCORD_MCP_ALLOW_MEMBER_VOICE_CHANGES: "true",
      DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
      DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: GUILD_ID,
    },
    memberVoiceOptions: {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(13),
      randomId: () => "activity-member-voice",
    },
    operationStore,
  })
  const request = {
    action: "move" as const,
    auditReason: "Reviewed exact voice move",
    destinationChannelId: OTHER_CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: "member-voice-attempt-0001",
    userId: targetId,
  }

  const audit = await service.getMemberVoiceState(GUILD_ID, targetId)
  const plan = await service.planMemberVoiceChange(request)
  const result = await service.executeMemberVoiceChange(request, plan.digest)

  assert.equal(audit.applicationId, APPLICATION_ID)
  assert.equal(audit.botId, BOT_ID)
  assert.equal(audit.privacy.enumeration, "none")
  assert.equal(plan.action, "move")
  assert.equal(plan.destination?.id, OTHER_CHANNEL_ID)
  assert.equal(result.status, "completed")
  assert.equal(result.observed.channel?.id, OTHER_CHANNEL_ID)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(voiceWrites, 1)
  assert.equal(operationStore.receipt?.kind, "member-voice-change")
  assert.equal(operationStore.receipt?.status, "completed")
  assert.doesNotMatch(
    JSON.stringify(operationStore.receipt),
    /member-voice-attempt|Reviewed exact|private-|target|channelId|mute|deaf/,
  )
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(calls.activityEntries.every((entry) => entry.kind === "member-voice-change"), true)
})

test("service pins identity through privacy-safe reviewed thread governance", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "800000000000000021"
  let threadState: DiscordThreadStateSummary = {
    archived: false,
    autoArchiveDuration: 1_440,
    guildId: GUILD_ID,
    id: THREAD_ID,
    invitable: true,
    locked: false,
    name: "private-thread-name",
    ownerId: MEMBER_USER_ID,
    parentId: CHANNEL_ID,
    rateLimitPerUser: 0,
    type: 12,
    unknownFieldCount: 0,
    unknownMetadataFieldCount: 0,
  }
  let membershipReads = 0
  let threadReads = 0
  let threadWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getChannel(channelId) {
        assert.equal(channelId, CHANNEL_ID)
        return channel({ name: "private-parent-name" })
      },
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildMember(_guildId, userId) {
        assert.equal(userId, BOT_ID)
        return { roles: [botRoleId], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(
            GUILD_ID,
            DISCORD_PERMISSIONS.VIEW_CHANNEL
              | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS,
            "@everyone",
          ),
          {
            ...role(botRoleId, DISCORD_PERMISSIONS.MANAGE_THREADS, "connector"),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
        ]
      },
      async getThreadMember(threadId, userId) {
        assert.equal(threadId, THREAD_ID)
        assert.equal(userId, BOT_ID)
        membershipReads += 1
        return {
          flags: 0,
          id: threadId,
          join_timestamp: "2026-08-21T00:00:00.000Z",
          user_id: userId,
        }
      },
      async getThreadState(threadId) {
        assert.equal(threadId, THREAD_ID)
        threadReads += 1
        return threadState
      },
      async modifyThreadState(threadId, input, auditReason) {
        assert.equal(threadId, THREAD_ID)
        assert.deepEqual(input, { name: "reviewed-thread-name" })
        assert.equal(auditReason, "Reviewed exact thread rename")
        threadWrites += 1
        threadState = { ...threadState, name: input.name }
        return threadState
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${THREAD_ID}`,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_THREAD_AUDIT: "true",
      DISCORD_MCP_ALLOW_THREAD_CHANGES: "true",
      DISCORD_MCP_THREAD_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_THREAD_IDS: THREAD_ID,
    },
    operationStore,
    threadGovernanceOptions: {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(17),
      randomId: () => "activity-thread-governance",
    },
  })
  const request = {
    action: "rename" as const,
    auditReason: "Reviewed exact thread rename",
    guildId: GUILD_ID,
    name: "reviewed-thread-name",
    operationKey: "thread-governance-attempt-0001",
    threadId: THREAD_ID,
  }

  const audit = await service.getThreadState(GUILD_ID, THREAD_ID)
  const plan = await service.planThreadChange(request)
  const result = await service.executeThreadChange(request, plan.digest)

  assert.equal(audit.applicationId, APPLICATION_ID)
  assert.equal(audit.botId, BOT_ID)
  assert.equal(audit.privacy.enumeration, "none")
  assert.equal(plan.action, "rename")
  assert.deepEqual(plan.desired, { field: "name", value: "reviewed-thread-name" })
  assert.equal(result.status, "completed")
  assert.equal(result.observedThread.name, "reviewed-thread-name")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(membershipReads, 3)
  assert.equal(threadReads, 4)
  assert.equal(threadWrites, 1)
  assert.equal(operationStore.receipt?.kind, "thread-governance-change")
  assert.equal(operationStore.receipt?.status, "completed")
  assert.doesNotMatch(
    JSON.stringify(operationStore.receipt),
    /thread-governance-attempt|Reviewed exact|private-|reviewed-thread/,
  )
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(
    calls.activityEntries.every((entry) => entry.kind === "thread-governance-change"),
    true,
  )
})

test("service verifies identity before reviewed additive channel creation", async () => {
  const operationStore = new MemoryOperationStore()
  const { calls, service } = serviceFixture({
    channelAdministrationOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(7),
      randomId: () => "activity-channel-create",
    },
    client: {
      async createGuildChannel(guildId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(auditReason, "Reviewed channel addition")
        assert.deepEqual(input, {
          defaultAutoArchiveDuration: 1_440,
          name: "launches",
          nsfw: false,
          rateLimitPerUser: 0,
          topic: null,
          type: 0,
        })
        calls.createChannel += 1
        return channel({
          default_auto_archive_duration: 1_440,
          id: CREATED_CHANNEL_ID,
          name: "launches",
          nsfw: false,
          parent_id: null,
          rate_limit_per_user: 0,
          topic: null,
        })
      },
      async getChannel(channelId) {
        assert.equal(channelId, CREATED_CHANNEL_ID)
        return channel({
          default_auto_archive_duration: 1_440,
          id: CREATED_CHANNEL_ID,
          name: "launches",
          nsfw: false,
          parent_id: null,
          rate_limit_per_user: 0,
          topic: null,
        })
      },
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildChannels() {
        return []
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_CHANNELS | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
      DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed channel addition",
    guildId: GUILD_ID,
    kind: "text" as const,
    name: "launches",
    operationKey: "channel-create-attempt-0001",
  }

  const plan = await service.planChannelCreation(request)
  const result = await service.executeChannelCreation(request, plan.digest)

  assert.equal(plan.action, "create")
  assert.equal(result.channelId, CREATED_CHANNEL_ID)
  assert.equal(result.status, "completed")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.createChannel, 1)
  assert.equal(operationStore.receipt?.status, "completed")
  assert.doesNotMatch(JSON.stringify(operationStore.receipt), /channel-create-attempt/)
})

test("service verifies identity before an exact guild-scaffold no-op", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const { calls, service } = serviceFixture({
    client: {
      async getGuildChannels() {
        return [channel({
          id: CREATED_CHANNEL_ID,
          name: "Support",
          parent_id: null,
          permission_overwrites: [],
          type: 4,
        })]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
      DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-scaffold",
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    auditReason: "Reviewed exact existing scaffold",
    channels: [{ key: "support-category", kind: "category" as const, name: "Support" }],
    guildId: GUILD_ID,
    operationKey: "guild-scaffold-attempt-0001",
    roles: [{ key: "support-role", name: "Support" }],
  }

  const verification = await service.verifyGuildScaffold(request)
  const plan = await service.planGuildScaffold(request)
  const result = await service.executeGuildScaffold(request, plan.digest)

  assert.equal(verification.status, "unrecorded")
  assert.equal(verification.operation.receiptStatus, "unreserved")
  assert.deepEqual(verification.steps.map((step) => step.state), [
    "already-current",
    "already-current",
  ])
  assert.doesNotMatch(JSON.stringify(verification), /Support|Reviewed exact/)
  assert.equal(
    JSON.stringify(verification).includes(request.operationKey),
    false,
  )
  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.createChannel, 0)
  assert.equal(calls.createRole, 0)
  assert.equal(operationStore.receipt, undefined)
  assert.deepEqual(writeCoordinator.intents, [])
})

test("service durably coordinates active guild scaffolds by request identity", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const botRoleId = "700000000000000002"
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const { calls, service } = serviceFixture({
    client: {
      async getGuildChannels() {
        return []
      },
      async getGuildMember() {
        return { roles: [botRoleId], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          {
            ...role(botRoleId, permissions, "connector"),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
        ]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
      DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-scaffold",
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    auditReason: "Reviewed additive scaffold",
    channels: [{ key: "support-category", kind: "category" as const, name: "Support" }],
    guildId: GUILD_ID,
    operationKey: "guild-scaffold-attempt-0001",
    roles: [{ key: "support-role", name: "Support" }],
  }
  const plan = await service.planGuildScaffold(request)

  await assert.rejects(
    () => service.executeGuildScaffold(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  assert.equal(plan.status, "planned")
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "guild-scaffold",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.operation.requestDigest,
    targets: [
      { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
      { collection: "roles", guildId: GUILD_ID, kind: "guild-collection" },
    ],
  }])
  assert.deepEqual(writeCoordinator.options, [{
    releasePendingScaffoldOnVerifiedPause: true,
  }])
  assert.notEqual(plan.operation.requestDigest, plan.digest)
  assert.equal(calls.createChannel, 0)
  assert.equal(calls.createRole, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through native poll audit and reviewed creation", async () => {
  const operationStore = new MemoryOperationStore()
  const question = "Which direction should we take?"
  const answers = ["Reliability", "Usability"] as const
  const pollMessage = (nonce: string): DiscordMessage => ({
    attachments: [],
    author: bot(),
    channel_id: CHANNEL_ID,
    content: "",
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    nonce,
    poll: {
      allow_multiselect: false,
      answers: [
        { answer_id: 8, poll_media: { text: answers[0] } },
        { answer_id: 2, poll_media: { text: answers[1] } },
      ],
      expiry: "2026-08-22T00:00:00.000Z",
      layout_type: 1,
      question: { text: question },
    },
    timestamp: "2026-08-21T00:00:00.000Z",
    type: 0,
  })
  let currentMessage = pollMessage("initial-poll-nonce")
  let createCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async createPoll(channelId, input) {
        assert.equal(channelId, CHANNEL_ID)
        createCalls += 1
        currentMessage = pollMessage(input.nonce)
        return structuredClone(currentMessage)
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.SEND_MESSAGES
            | DISCORD_PERMISSIONS.SEND_POLLS,
          "@everyone",
        )]
      },
      async getMessage() {
        return structuredClone(currentMessage)
      },
      async listPollAnswerVoters() {
        return {
          users: [{ id: MEMBER_USER_ID, username: "private-voter" }],
        }
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_POLL_AUDIT: "true",
      DISCORD_MCP_ALLOW_POLL_CREATION: "true",
      DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT: "true",
      DISCORD_MCP_POLL_CHANNEL_IDS: CHANNEL_ID,
    },
    operationStore,
    pollOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(53),
      randomId: () => "activity-poll-create",
    },
  })
  const request = {
    answers: answers.map((text) => ({ text })),
    channelId: CHANNEL_ID,
    operationKey: "poll-service-attempt-0001",
    question,
  }

  await assert.rejects(
    () => service.planPollCreation({ ...request, channelId: "bad" }),
    /poll channel ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const read = await service.getPoll(CHANNEL_ID, MESSAGE_ID)
  const voters = await service.listPollAnswerVoters(CHANNEL_ID, MESSAGE_ID, 8)
  const plan = await service.planPollCreation(request)
  const result = await service.executePollCreation(request, plan.digest)

  assert.equal(read.poll.question, question)
  assert.deepEqual(voters.voterUserIds, [MEMBER_USER_ID])
  assert.equal(JSON.stringify(voters).includes("private-voter"), false)
  assert.equal(plan.target.question, question)
  assert.equal(result.status, "completed")
  assert.equal(result.messageId, MESSAGE_ID)
  assert.equal(createCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(JSON.stringify(calls.activityEntries).includes(question), false)
  assert.equal(operationStore.receipt?.kind, "poll-create")
  assert.equal(operationStore.receipt?.resourceId, MESSAGE_ID)
})

test("service pins identity through reviewed forum creation without persisting intent", async () => {
  const operationStore = new MemoryOperationStore()
  const title = "Private reviewed launch title"
  const content = "Private reviewed launch content"
  const auditReason = "Private reviewed forum reason"
  const operationKey = "forum-post-service-attempt-0001"
  const forum = channel({
    available_tags: [{
      emoji_id: null,
      emoji_name: null,
      id: FORUM_TAG_ID,
      moderated: false,
      name: "Private tag name",
    }],
    default_auto_archive_duration: 1_440,
    default_thread_rate_limit_per_user: 0,
    flags: 0,
    name: "Private forum name",
    permission_overwrites: [],
    type: 15,
  })
  const createdThread = thread(THREAD_ID, CHANNEL_ID, {
    applied_tags: [FORUM_TAG_ID],
    name: title,
    owner_id: BOT_ID,
    rate_limit_per_user: 30,
  })
  const starter = message({
    attachments: [],
    author: bot(),
    channel_id: THREAD_ID,
    components: [],
    content,
    guild_id: GUILD_ID,
    id: THREAD_ID,
    type: 0,
  })
  const { calls, service } = serviceFixture({
    client: {
      async createForumPost(channelId, input, reason) {
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(reason, auditReason)
        assert.deepEqual(input, {
          allowedMentions: { parse: [], replied_user: false },
          appliedTagIds: [FORUM_TAG_ID],
          autoArchiveDuration: 1_440,
          content,
          name: title,
          rateLimitPerUser: 30,
        })
        calls.createForumPost += 1
        return { ...createdThread, message: starter }
      },
      async getChannel(channelId) {
        if (channelId === CHANNEL_ID) return forum
        assert.equal(channelId, THREAD_ID)
        return createdThread
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.SEND_MESSAGES,
          "@everyone",
        )]
      },
      async getMessage(channelId, messageId) {
        assert.equal(channelId, THREAD_ID)
        assert.equal(messageId, THREAD_ID)
        return starter
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_FORUM_POSTS: "true",
      DISCORD_MCP_FORUM_POST_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "0",
    },
    forumPostOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(13),
      randomId: () => "activity-forum-post",
    },
    operationStore,
  })
  const request = {
    appliedTagIds: [FORUM_TAG_ID],
    auditReason,
    autoArchiveDuration: 1_440,
    channelId: CHANNEL_ID,
    content,
    name: title,
    operationKey,
    rateLimitPerUser: 30,
  }

  const plan = await service.planForumPost(request)
  const result = await service.executeForumPost(request, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.threadId, THREAD_ID)
  assert.equal(result.messageId, THREAD_ID)
  assert.equal(result.verification, "match")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.createForumPost, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "forum-post")
  assert.equal(operationStore.receipt?.resourceId, THREAD_ID)
  assert.equal(operationStore.receipt?.status, "completed")
  const persisted = JSON.stringify({
    activity: calls.activityEntries,
    receipt: operationStore.receipt,
  })
  for (const privateValue of [
    title,
    content,
    auditReason,
    operationKey,
    FORUM_TAG_ID,
    "Private tag name",
    "Private forum name",
  ]) {
    assert.equal(persisted.includes(privateValue), false)
  }
})

test("service pins identity through reviewed anchored thread creation", async () => {
  const operationStore = new MemoryOperationStore()
  const name = "Private reviewed thread name"
  const auditReason = "Private reviewed thread reason"
  const operationKey = "thread-service-attempt-0001"
  const parent = channel({
    default_auto_archive_duration: 1_440,
    default_thread_rate_limit_per_user: 0,
    name: "Private parent name",
    permission_overwrites: [],
  })
  const createdThread = thread(MESSAGE_ID, CHANNEL_ID, {
    name,
    owner_id: BOT_ID,
    rate_limit_per_user: 30,
  })
  const source = message({
    attachments: [],
    content: "Private source content",
    id: MESSAGE_ID,
  })
  let created = false
  let createCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async createThreadFromMessage(channelId, messageId, input, reason) {
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(messageId, MESSAGE_ID)
        assert.equal(reason, auditReason)
        assert.deepEqual(input, {
          autoArchiveDuration: 1_440,
          name,
          rateLimitPerUser: 30,
        })
        createCalls += 1
        created = true
        return createdThread
      },
      async getChannel(channelId) {
        if (channelId === CHANNEL_ID) return parent
        assert.equal(channelId, MESSAGE_ID)
        if (created) return createdThread
        throw new DiscordApiError({
          message: "Missing channel",
          method: "GET",
          route: "/channels/:channel",
          status: 404,
        })
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.CREATE_PUBLIC_THREADS,
          "@everyone",
        )]
      },
      async getMessage(channelId, messageId) {
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(messageId, MESSAGE_ID)
        return source
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_THREAD_CREATION: "true",
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "0",
      DISCORD_MCP_THREAD_PARENT_IDS: CHANNEL_ID,
    },
    operationStore,
    threadCreationOptions: {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(29),
      randomId: () => "activity-thread-create",
    },
  })
  const request = {
    auditReason,
    autoArchiveDuration: 1_440,
    mode: "from-message" as const,
    name,
    operationKey,
    parentChannelId: CHANNEL_ID,
    rateLimitPerUser: 30,
    sourceMessageId: MESSAGE_ID,
  }

  const plan = await service.planThreadCreation(request)
  const result = await service.executeThreadCreation(request, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.threadId, MESSAGE_ID)
  assert.equal(result.verification, "match")
  assert.equal(createCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "thread-create")
  assert.equal(operationStore.receipt?.resourceId, MESSAGE_ID)
  const persisted = JSON.stringify({
    activity: calls.activityEntries,
    receipt: operationStore.receipt,
  })
  for (const privateValue of [
    name,
    auditReason,
    operationKey,
    "Private source content",
    "Private parent name",
  ]) {
    assert.equal(persisted.includes(privateValue), false)
  }
})

test("service returns bounded role inventory and one exact role", async () => {
  const supportRole: DiscordRole = {
    ...role(
      CREATED_ROLE_ID,
      DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES,
      "Support",
    ),
    color: 3_447_003,
    colors: {
      primary_color: 3_447_003,
      secondary_color: null,
      tertiary_color: null,
    },
    position: 2,
  }
  const { calls, service } = serviceFixture({
    client: {
      async getGuildRole(guildId, roleId) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(roleId, CREATED_ROLE_ID)
        calls.getRole += 1
        return supportRole
      },
      async getGuildRoles() {
        return [role(GUILD_ID, 0n, "@everyone"), supportRole]
      },
    },
    environment: { DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID },
  })

  const listed = await service.listRoles(GUILD_ID)
  const exact = await service.getRole(GUILD_ID, CREATED_ROLE_ID)
  assert.equal(listed.page.documentedLimit, 250)
  assert.equal(listed.page.returned, 2)
  assert.equal(listed.roles[0]?.id, CREATED_ROLE_ID)
  assert.deepEqual(listed.roles[0]?.permissionNames, ["VIEW_CHANNEL", "SEND_MESSAGES"])
  assert.equal(exact.role.id, CREATED_ROLE_ID)
  assert.equal(calls.getRole, 1)

  const mismatched = serviceFixture({
    client: {
      async getGuildRole() {
        return { ...supportRole, id: "999000000000000001" }
      },
    },
    environment: { DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID },
  }).service
  await assert.rejects(
    mismatched.getRole(GUILD_ID, CREATED_ROLE_ID),
    /incomplete or invalid role evidence/,
  )
})

test("service verifies identity and guild scope before privacy-safe audit-log reads", async () => {
  const entryId = "800000000000000001"
  const { calls, service } = serviceFixture({
    client: {
      async getGuildAuditLog(guildId, options) {
        assert.equal(guildId, GUILD_ID)
        calls.guildAuditLog += 1
        if (options?.after) {
          return {
            audit_log_entries: [{
              action_type: 22,
              id: entryId,
              target_id: "private-invite-code",
              user_id: BOT_ID,
            }],
          }
        }
        return { audit_log_entries: [] }
      },
    },
    environment: { DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID },
  })

  const listed = await service.listGuildAuditEntries(GUILD_ID, { limit: 1 })
  const exact = await service.getGuildAuditEntry(GUILD_ID, entryId)

  assert.equal(listed.guildId, GUILD_ID)
  assert.equal(exact.found, true)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.guildAuditLog, 2)
  assert.equal(calls.activityAppends, 0)
  assert.equal(JSON.stringify(exact).includes("private-invite-code"), false)

  await assert.rejects(
    () => service.listGuildAuditEntries(OTHER_GUILD_ID),
    PolicyError,
  )
  assert.equal(calls.guildAuditLog, 2)
})

test("service verifies identity before reviewed additive role creation", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "600000000000000001"
  const requestedPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  const created: DiscordRole = {
    ...role(CREATED_ROLE_ID, requestedPermissions, "Support"),
    color: 3_447_003,
    colors: {
      primary_color: 3_447_003,
      secondary_color: null,
      tertiary_color: null,
    },
    position: 1,
  }
  const { calls, service } = serviceFixture({
    client: {
      async createGuildRole(guildId, input, auditReason) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(auditReason, "Reviewed role addition")
        assert.deepEqual(input, {
          hoist: false,
          mentionable: false,
          name: "Support",
          permissions: requestedPermissions.toString(),
          primaryColor: 3_447_003,
        })
        calls.createRole += 1
        return created
      },
      async getGuild() {
        return { ...guild(), features: [], owner_id: "800000000000000001" }
      },
      async getGuildMember() {
        return { roles: [botRoleId], user: bot() }
      },
      async getGuildRole(guildId, roleId) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(roleId, CREATED_ROLE_ID)
        calls.getRole += 1
        return created
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          {
            ...role(
              botRoleId,
              DISCORD_PERMISSIONS.MANAGE_ROLES | requestedPermissions,
              "connector",
            ),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
        ]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ROLE_CREATION: "true",
      DISCORD_MCP_ROLE_CREATION_GUILD_IDS: GUILD_ID,
    },
    operationStore,
    roleAdministrationOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
      randomId: () => "activity-role-create",
    },
  })
  const creationRequest = {
    auditReason: "Reviewed role addition",
    guildId: GUILD_ID,
    name: "Support",
    operationKey: "role-create-attempt-0001",
    permissions: ["SEND_MESSAGES", "VIEW_CHANNEL"] as const,
    primaryColor: 3_447_003,
  }

  const plan = await service.planRoleCreation(creationRequest)
  const result = await service.executeRoleCreation(creationRequest, plan.digest)
  assert.equal(plan.action, "create")
  assert.equal(result.roleId, CREATED_ROLE_ID)
  assert.equal(result.status, "completed")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.createRole, 1)
  assert.equal(calls.getRole, 1)
  assert.equal(operationStore.receipt?.status, "completed")
  assert.doesNotMatch(JSON.stringify(operationStore.receipt), /role-create-attempt|Support/)
})

test("service pins identity through exact reviewed role configuration", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "700000000000000002"
  const target = {
    ...role(CREATED_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "Support"),
    position: 2,
  }
  const roles = [
    role(GUILD_ID, 0n, "@everyone"),
    target,
    {
      ...role(
        botRoleId,
        DISCORD_PERMISSIONS.MANAGE_ROLES | DISCORD_PERMISSIONS.VIEW_CHANNEL,
        "connector",
      ),
      managed: true,
      position: 10,
      tags: { bot_id: BOT_ID },
    },
  ]
  let memberCountReads = 0
  let roleWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), features: [], owner_id: "800000000000000001" }
      },
      async getGuildMember() {
        return { roles: [botRoleId], user: bot() }
      },
      async getGuildRole(guildId, roleId) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(roleId, CREATED_ROLE_ID)
        return target
      },
      async getGuildRoleMemberCounts() {
        memberCountReads += 1
        return {
          [CREATED_ROLE_ID]: 4,
          [botRoleId]: 1,
        }
      },
      async getGuildRoles() {
        return roles
      },
      async modifyGuildRole() {
        roleWrites += 1
        throw new Error("Unexpected role configuration write")
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
      DISCORD_MCP_ROLE_CONFIGURATION_IDS: CREATED_ROLE_ID,
    },
    operationStore,
    roleConfigurationOptions: {
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(10),
      randomId: () => "activity-role-configuration",
    },
  })
  const request = {
    auditReason: "Reviewed unchanged role configuration",
    guildId: GUILD_ID,
    name: "Support",
    operationKey: "role-configuration-attempt-0001",
    roleId: CREATED_ROLE_ID,
  }

  await assert.rejects(
    () => service.planRoleConfiguration({ ...request, roleId: "bad" }),
    /role ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const plan = await service.planRoleConfiguration(request)
  const result = await service.executeRoleConfiguration(request, plan.digest)

  assert.equal(plan.status, "already-current")
  assert.equal(plan.memberCount, 4)
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(memberCountReads, 2)
  assert.equal(roleWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through audited and reviewed role ordering", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const botRoleId = "710000000000000003"
  const targetRoleId = "710000000000000001"
  const anchorRoleId = "710000000000000002"
  const roles = [
    role(GUILD_ID, 0n, "@everyone"),
    { ...role(targetRoleId, DISCORD_PERMISSIONS.VIEW_CHANNEL, "Target"), position: 1 },
    { ...role(anchorRoleId, DISCORD_PERMISSIONS.VIEW_CHANNEL, "Anchor"), position: 2 },
    {
      ...role(
        botRoleId,
        DISCORD_PERMISSIONS.MANAGE_ROLES | DISCORD_PERMISSIONS.VIEW_CHANNEL,
        "connector",
      ),
      managed: true,
      position: 3,
      tags: { bot_id: BOT_ID },
    },
  ]
  let memberCountReads = 0
  let roleOrderWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), features: [], owner_id: "800000000000000001" }
      },
      async getGuildMember() {
        return { roles: [botRoleId], user: bot() }
      },
      async getGuildRoleMemberCounts() {
        memberCountReads += 1
        return {
          [anchorRoleId]: 2,
          [botRoleId]: 1,
          [targetRoleId]: 4,
        }
      },
      async getGuildRoles() {
        return roles
      },
      async modifyGuildRolePositions() {
        roleOrderWrites += 1
        throw new Error("Unexpected role-order write")
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
      DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES: "true",
      DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: GUILD_ID,
    },
    operationStore,
    roleOrderingOptions: {
      clock: () => new Date("2026-08-23T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(11),
      randomId: () => "activity-role-ordering",
    },
    writeCoordinator,
  })
  const request = {
    anchorRoleId,
    auditReason: "Reviewed unchanged role hierarchy",
    guildId: GUILD_ID,
    operationKey: "role-ordering-attempt-0001",
    placement: "below" as const,
    roleId: targetRoleId,
  }

  await assert.rejects(
    () => service.planRoleOrder({ ...request, roleId: "bad" }),
    /role ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.auditRoleOrder(GUILD_ID)
  const plan = await service.planRoleOrder(request)
  const result = await service.executeRoleOrder(request, plan.digest)

  assert.deepEqual(audit.order.map((entry) => entry.id), [
    GUILD_ID,
    targetRoleId,
    anchorRoleId,
    botRoleId,
  ])
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(memberCountReads, 4)
  assert.equal(roleOrderWrites, 0)
  assert.equal(writeCoordinator.intents.length, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service verifies identity once and reports scope without message reads", async () => {
  const { calls, service } = serviceFixture()

  const status = await service.getStatus()
  const guilds = await service.listGuilds({ limit: 10 })

  assert.equal(status.application.id, APPLICATION_ID)
  assert.equal(status.application.guildMembersIntent, "disabled")
  assert.equal(status.application.messageContentIntent, "enabled")
  assert.equal(status.bot.id, BOT_ID)
  assert.equal(status.guildPage.accessible, 1)
  assert.deepEqual(status.writeCoordination, {
    coverage: "receipt-backed-reviewed-writes",
    excludedWorkflows: [
      "legacy-member-moderation",
      "ordinary-message-interactions",
    ],
    localFilesystemRequired: true,
    mode: "durable-exact-target",
    resumableWorkflows: ["guild-scaffold"],
    sharedStateRootRequired: true,
  })
  assert.equal(guilds.guilds[0]?.id, GUILD_ID)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.guilds, 2)
  assert.equal(calls.listMessages, 0)
})

test("service diagnoses Message Content intent from arbitrary-width application flags", async () => {
  const flagged = application()
  flagged.flags = 0
  flagged.flags_new = (1n << 19n).toString()
  const unknown = application()
  delete unknown.flags
  unknown.flags_new = "not-a-bitfield"
  const flaggedService = serviceFixture({ application: flagged }).service
  const unknownService = serviceFixture({ application: unknown }).service

  assert.equal(
    (await flaggedService.getStatus()).application.messageContentIntent,
    "enabled",
  )
  assert.equal(
    (await unknownService.getStatus()).application.messageContentIntent,
    "unknown",
  )
})

test("service diagnoses Guild Members intent from normal and limited application flags", async () => {
  const normal = application()
  normal.flags = Number(1n << 14n)
  const limited = application()
  limited.flags = 0
  limited.flags_new = (1n << 15n).toString()
  const invalid = application()
  invalid.flags = -1

  assert.equal(
    (await serviceFixture({ application: normal }).service.getStatus())
      .application.guildMembersIntent,
    "enabled",
  )
  assert.equal(
    (await serviceFixture({ application: limited }).service.getStatus())
      .application.guildMembersIntent,
    "enabled",
  )
  assert.equal(
    (await serviceFixture({ application: invalid }).service.getStatus())
      .application.guildMembersIntent,
    "unknown",
  )
})

test("service exposes an opt-in minimized member directory through exact REST calls", async () => {
  const remoteMember = (userId: string): DiscordGuildMember => ({
    joined_at: "2026-08-01T00:00:00.000Z",
    nick: "Member",
    pending: false,
    roles: [],
    user: {
      avatar: "private-avatar",
      id: userId,
      username: "member_name",
    },
  })
  let exactCalls = 0
  let listCalls = 0
  let searchCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember(_guildId, userId) {
        exactCalls += 1
        return remoteMember(userId)
      },
      async listGuildMembers() {
        listCalls += 1
        return [remoteMember(MEMBER_USER_ID)]
      },
      async searchGuildMembers(_guildId, options) {
        searchCalls += 1
        assert.equal(options.query, "member")
        return [remoteMember(MEMBER_USER_ID)]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
      DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS: GUILD_ID,
    },
  })

  const exact = await service.getGuildMember(GUILD_ID, MEMBER_USER_ID)
  const listed = await service.listGuildMembers(GUILD_ID, { limit: 2 })
  const searched = await service.searchGuildMembers(GUILD_ID, {
    query: " member ",
  })

  assert.equal(exact.member.userId, MEMBER_USER_ID)
  assert.equal(listed.members[0]?.userId, MEMBER_USER_ID)
  assert.equal(searched.members[0]?.userId, MEMBER_USER_ID)
  assert.equal(JSON.stringify([exact, listed, searched]).includes("private-avatar"), false)
  assert.equal(exactCalls, 1)
  assert.equal(listCalls, 1)
  assert.equal(searchCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
})

test("service pins identity before privacy-safe ban audit and rejects local input first", async () => {
  const bannedUserId = MEMBER_USER_ID
  const remoteBan = {
    reason: "Private reason",
    user: {
      avatar: "private-avatar",
      discriminator: "0001",
      global_name: "Banned member",
      id: bannedUserId,
      username: "banned-member",
    },
  }
  let exactCalls = 0
  let listCalls = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, DISCORD_PERMISSIONS.BAN_MEMBERS, "@everyone")]
      },
      async getGuildBan(_guildId, userId) {
        assert.equal(userId, bannedUserId)
        exactCalls += 1
        return remoteBan
      },
      async listGuildBans(_guildId, options) {
        assert.equal(options?.limit, 3)
        listCalls += 1
        return [remoteBan]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_BAN_AUDIT: "true",
      DISCORD_MCP_BAN_AUDIT_GUILD_IDS: GUILD_ID,
    },
  })

  await assert.rejects(() => service.listGuildBans("bad"), /guild ID/)
  await assert.rejects(
    () => service.getGuildBan(GUILD_ID, "bad"),
    /user ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const listed = await service.listGuildBans(GUILD_ID, { limit: 2 })
  const exact = await service.getGuildBan(GUILD_ID, bannedUserId, {
    includeReason: true,
  })

  assert.equal(listed.bans[0]?.userId, bannedUserId)
  assert.equal("reason" in (listed.bans[0] || {}), false)
  assert.equal(exact.found, true)
  assert.equal(exact.ban?.reason, "Private reason")
  assert.doesNotMatch(
    JSON.stringify([listed, exact]),
    /private-avatar|"discriminator"/,
  )
  assert.equal(listCalls, 1)
  assert.equal(exactCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
})

test("service normalizes channel messages after enforcing guild scope", async () => {
  const { service } = serviceFixture()

  const result = await service.readMessages(CHANNEL_ID, { limit: 10 })

  assert.equal(result.guildId, GUILD_ID)
  assert.equal(result.channel.id, CHANNEL_ID)
  assert.equal(result.messages[0]?.id, MESSAGE_ID)
  assert.equal(result.messages[0]?.content, "hello")
  assert.equal(
    result.messages[0]?.jumpUrl,
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`,
  )
})

test("service rejects Discord message responses outside the exact requested route", async () => {
  const historyService = serviceFixture({
    client: {
      async listMessages() {
        return [message({ channel_id: OTHER_CHANNEL_ID })]
      },
    },
  }).service
  const messageService = serviceFixture({
    client: {
      async getMessage() {
        return message({ id: "500000000000000002" })
      },
    },
  }).service

  await assert.rejects(
    () => historyService.readMessages(CHANNEL_ID),
    /outside the requested channel/,
  )
  await assert.rejects(
    () => messageService.getMessage(CHANNEL_ID, MESSAGE_ID),
    /different message than requested/,
  )
})

test("service rejects direct-message channels before fetching their messages", async () => {
  const directMessage = channel()
  delete directMessage.guild_id
  directMessage.type = 1
  const { calls, service } = serviceFixture({ channel: directMessage })

  await assert.rejects(
    () => service.readMessages(CHANNEL_ID),
    PolicyError,
  )
  assert.equal(calls.listMessages, 0)
})

test("service attenuates native search and returns compact scope-filtered results", async () => {
  let observedGuildId = ""
  let observedOptions: Parameters<DiscordServiceClient["searchGuildMessages"]>[1]
  const attachmentUrl = "https://cdn.discord.test/private-attachment"
  const { service } = serviceFixture({
    client: {
      async searchGuildMessages(guildId, options) {
        observedGuildId = guildId
        observedOptions = options
        return {
          documents_indexed: 200,
          doing_deep_historical_index: false,
          messages: [
            [message({
              attachments: [{
                filename: "deploy.log",
                id: "700000000000000001",
                size: 42,
                url: attachmentUrl,
              }],
            })],
            [message({
              channel_id: OTHER_CHANNEL_ID,
              id: "500000000000000002",
            })],
            [message({
              channel_id: THREAD_ID,
              id: "500000000000000003",
            })],
          ],
          threads: [thread(THREAD_ID)],
          total_results: 10,
        }
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    },
  })

  const result = await service.searchMessages(GUILD_ID, {
    content: "deploy",
    limit: 2,
    offset: 5,
  })
  if (result.status !== "ok") assert.fail("Expected completed search results")

  assert.equal(observedGuildId, GUILD_ID)
  assert.deepEqual(observedOptions?.channelIds, [CHANNEL_ID])
  assert.deepEqual(
    result.messages.map((entry) => entry.id),
    [MESSAGE_ID, "500000000000000003"],
  )
  assert.equal(result.messages[0]?.attachments[0]?.filename, "deploy.log")
  assert.doesNotMatch(JSON.stringify(result), new RegExp(attachmentUrl))
  assert.equal(result.threads[0]?.id, THREAD_ID)
  assert.equal(result.page.nextOffset, 7)
  assert.equal(result.page.totalResultsEstimate, 10)
})

test("service defensively enforces caller-supplied search channels on Discord results", async () => {
  const { service } = serviceFixture({
    client: {
      async searchGuildMessages() {
        return {
          doing_deep_historical_index: false,
          messages: [
            [message()],
            [message({
              channel_id: OTHER_CHANNEL_ID,
              id: "500000000000000002",
            })],
          ],
          total_results: 2,
        }
      },
    },
  })

  const result = await service.searchMessages(GUILD_ID, {
    channelIds: [CHANNEL_ID],
  })
  if (result.status !== "ok") assert.fail("Expected completed search results")

  assert.deepEqual(result.messages.map((entry) => entry.id), [MESSAGE_ID])
})

test("service exposes Discord search indexing state and rejects filterless calls", async () => {
  let calls = 0
  const { service } = serviceFixture({
    client: {
      async searchGuildMessages() {
        calls += 1
        return {
          code: 110000,
          documents_indexed: 42,
          message: "Index not yet available",
          retry_after: 1.25,
        }
      },
    },
  })

  const result = await service.searchMessages(GUILD_ID, { content: "deploy" })

  assert.deepEqual(result, {
    documentsIndexed: 42,
    guildId: GUILD_ID,
    retryAfterMs: 1_250,
    schemaVersion: 1,
    status: "indexing",
  })
  await assert.rejects(
    () => service.searchMessages(GUILD_ID),
    /at least one substantive filter/,
  )
  assert.equal(calls, 1)
})

test("service bounds active threads after parent-aware local scope filtering", async () => {
  const { service } = serviceFixture({
    client: {
      async listActiveGuildThreads() {
        return {
          threads: [
            thread(THREAD_ID, CHANNEL_ID, {
              applied_tags: ["800000000000000001"],
            }),
            thread(SECOND_THREAD_ID),
            thread("400000000000000005", OTHER_CHANNEL_ID),
          ],
        }
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    },
  })

  const result = await service.listActiveThreads(GUILD_ID, { limit: 1 })

  assert.deepEqual(result.threads.map((entry) => entry.id), [THREAD_ID])
  assert.deepEqual(result.threads[0]?.appliedTagIds, ["800000000000000001"])
  assert.deepEqual(result.page, {
    requestedLimit: 1,
    returned: 1,
    totalVisible: 2,
    truncated: true,
  })
})

test("service rejects an active-thread parent that cannot own threads", async () => {
  let listCalls = 0
  const { service } = serviceFixture({
    client: {
      async getChannel() {
        return channel({ type: 2 })
      },
      async listActiveGuildThreads() {
        listCalls += 1
        return { threads: [] }
      },
    },
  })

  await assert.rejects(
    () => service.listActiveThreads(GUILD_ID, { parentChannelId: CHANNEL_ID }),
    /does not support threads/,
  )
  assert.equal(listCalls, 0)
})

test("service preserves forum metadata and emits a typed archived-thread cursor", async () => {
  let observedBefore = ""
  let observedLimit = 0
  const forum = channel({
    available_tags: [{
      emoji_name: "ship",
      id: "800000000000000001",
      moderated: false,
      name: "shipping",
    }],
    default_auto_archive_duration: 1_440,
    default_forum_layout: 1,
    default_reaction_emoji: { emoji_name: "ship" },
    default_sort_order: 0,
    flags: 16,
    type: 15,
  })
  const lastArchiveTimestamp = "2026-08-13T00:00:00.000Z"
  const { service } = serviceFixture({
    channel: forum,
    client: {
      async listPublicArchivedThreads(_channelId, options) {
        observedBefore = options?.before ?? ""
        observedLimit = options?.limit ?? 0
        return {
          has_more: true,
          threads: [
            thread(THREAD_ID),
            thread(SECOND_THREAD_ID, CHANNEL_ID, {
              thread_metadata: {
                archive_timestamp: lastArchiveTimestamp,
                archived: true,
                auto_archive_duration: 1_440,
                locked: false,
              },
            }),
          ],
        }
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    },
  })

  const result = await service.listArchivedThreads(CHANNEL_ID, {
    beforeTimestamp: "2026-08-15T00:00:00.000Z",
    limit: 2,
    visibility: "public",
  })

  assert.equal(observedBefore, "2026-08-15T00:00:00.000Z")
  assert.equal(observedLimit, 2)
  assert.equal(result.channel.typeName, "guild-forum")
  assert.equal(result.channel.availableTags[0]?.name, "shipping")
  assert.equal(result.channel.defaultAutoArchiveDuration, 1_440)
  assert.deepEqual(result.channel.defaultReaction, {
    emojiId: null,
    emojiName: "ship",
  })
  assert.equal(result.channel.defaultSortOrder, 0)
  assert.equal(
    result.channel.url,
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
  )
  assert.deepEqual(result.page.nextCursor, {
    value: lastArchiveTimestamp,
    visibility: "public",
  })
  assert.equal(result.page.hasMore, true)
  await assert.rejects(
    () => service.listArchivedThreads(CHANNEL_ID, { limit: 1 }),
    /between 2 and 100/,
  )
})

test("service keeps joined-private archive pagination on thread-ID cursors", async () => {
  let joinedCalls = 0
  let publicCalls = 0
  let observedBefore = ""
  const { service } = serviceFixture({
    client: {
      async listJoinedPrivateArchivedThreads(_channelId, options) {
        joinedCalls += 1
        observedBefore = options?.before ?? ""
        return {
          has_more: true,
          threads: [thread(THREAD_ID, CHANNEL_ID, {
            thread_metadata: {
              archive_timestamp: "2026-08-13T00:00:00.000Z",
              archived: true,
              auto_archive_duration: 1_440,
              locked: false,
            },
            type: 12,
          })],
        }
      },
      async listPublicArchivedThreads() {
        publicCalls += 1
        return { has_more: false, threads: [] }
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    },
  })

  const result = await service.listArchivedThreads(CHANNEL_ID, {
    beforeThreadId: SECOND_THREAD_ID,
    limit: 2,
    visibility: "joined-private",
  })

  assert.equal(observedBefore, SECOND_THREAD_ID)
  assert.deepEqual(result.page.nextCursor, {
    value: THREAD_ID,
    visibility: "joined-private",
  })
  assert.equal(joinedCalls, 1)
  assert.equal(publicCalls, 0)
  await assert.rejects(
    () => service.listArchivedThreads(CHANNEL_ID, {
      beforeTimestamp: "2026-08-14T00:00:00.000Z",
      visibility: "joined-private",
    }),
    /use beforeThreadId/,
  )
})

test("service explains current bot access using thread-parent overwrites", async () => {
  const botRoleId = "900000000000000001"
  const parent = channel({
    permission_overwrites: [{
      allow: DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY.toString(),
      deny: "0",
      id: botRoleId,
      type: 0,
    }],
  })
  const privateThread = thread(THREAD_ID, CHANNEL_ID, { type: 12 })
  const { service } = serviceFixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID ? privateThread : parent
      },
      async getGuildMember() {
        return { roles: [botRoleId] }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "@everyone"),
          role(botRoleId, 0n, "connector"),
        ]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    },
  })

  const result = await service.explainChannelAccess(THREAD_ID)

  assert.equal(result.channel.id, THREAD_ID)
  assert.equal(result.permissions.permissionSourceChannelId, CHANNEL_ID)
  assert.equal(result.permissions.privateThreadAccess, "lookup-succeeded")
  assert.equal(result.permissions.canReadMessages, true)
  assert.deepEqual(result.permissions.missingReadPermissions, [])
})

test("service verifies identity once before principal explanation and role audit", async () => {
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember(_guildId, userId) {
        return { roles: [], user: { id: userId, username: "connector-bot" } }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES,
          "@everyone",
        )]
      },
    },
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    },
  })

  const explanation = await service.explainPrincipalPermissions({
    action: "send-message",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    subjectKind: "connector",
  })
  const audit = await service.auditChannelRoleAccess({
    actions: ["view-channel"],
    channelId: CHANNEL_ID,
  })

  assert.equal(explanation.permissions.allowed, true)
  assert.equal(audit.summary["view-channel"]?.allowed, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
})
