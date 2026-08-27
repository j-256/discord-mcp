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
import type { ConnectorConfig } from "../src/config.js"
import {
  loadFixtureConfig as loadConnectorConfig,
  type FixtureConfigOverrides,
} from "./config-fixture.js"
import {
  DISCORD_APPLICATION_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_GUILD_MEMBER_FLAGS,
  DISCORD_MESSAGE_FLAGS,
} from "../src/constants.js"
import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  DISCORD_SCHEDULED_EVENT_ENTITY_TYPES,
  DISCORD_SCHEDULED_EVENT_STATUSES,
  DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS,
  type DiscordAutoModerationRuleSummary,
  type DiscordApplicationEmojiSummary,
  type DiscordChannelMetadata,
  type DiscordGuildIntegrationSummary,
  type DiscordGuildTemplateSummary,
  type DiscordScheduledEventSummary,
  type DiscordSoundboardSoundSummary,
  type DiscordStageInstanceSummary,
  type DiscordThreadStateSummary,
  type DiscordVoiceRegion,
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
import {
  guildBlueprintPublicationOperationKey,
  guildBlueprintStepOperationKey,
} from "../src/guild-blueprint-service.js"
import { GatewayChannelLayoutStore } from "../src/gateway-channel-layout.js"
import type {
  GatewayVoiceChannelStatusSnapshot,
  GatewayVoiceChannelStatusUpdate,
} from "../src/gateway-voice-channel-status.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  ApplicationEntitlementOperationReceipt,
  ApplicationOperationReceipt,
  ApplicationOperationReservation,
  ApplicationOperationStore,
  OperationReceipt,
  OperationStore,
} from "../src/operation-store.js"
import { operationKeyHash } from "../src/operation-store.js"
import {
  CONNECTOR_STATUS_PRIVACY,
  CONNECTOR_STATUS_SCHEMA_VERSION,
  ConnectorService,
  type ConnectorServiceOptions,
  type DiscordServiceClient,
} from "../src/service.js"
import type {
  DiscordApplication,
  DiscordApplicationRoleConnectionMetadata,
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
const APPLICATION_SKU_ID = "610000000000000001"
const APPLICATION_ENTITLEMENT_ID = "620000000000000001"
const APPLICATION_SUBSCRIPTION_ID = "630000000000000001"
const WEBHOOK_ID = "900000000000000001"
const FOLLOWER_WEBHOOK_ID = "900000000000000002"
const INTEGRATION_ID = "905000000000000001"
const INTEGRATION_APPLICATION_ID = "905000000000000002"
const INTEGRATION_BOT_ID = "905000000000000003"
const AUTOMOD_RULE_ID = "910000000000000001"
const SCHEDULED_EVENT_ID = "930000000000000001"
const SOUNDBOARD_SOUND_ID = "935000000000000001"
const STAGE_INSTANCE_ID = "940000000000000001"
const PRIVATE_APPLICATION_PROFILE_TEXT = "private-application-profile"
const PRIVATE_BOT_PROFILE_TEXT = "private-bot-profile"
const PRIVATE_ACTIVITY_FILE = "/private/connector/activity.jsonl"

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

class KeyedMemoryOperationStore implements OperationStore {
  receipt: OperationReceipt | undefined
  readonly receipts = new Map<string, OperationReceipt>()

  async finish(receipt: OperationReceipt): Promise<void> {
    this.receipt = receipt
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(kind: OperationReceipt["kind"], operationKeyHash: string) {
    return this.receipts.get(`${kind}:${operationKeyHash}`)
  }

  async reserve(receipt: OperationReceipt) {
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipt = receipt
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

class MemoryApplicationOperationStore
  extends MemoryOperationStore
  implements ApplicationOperationStore {
  applicationReceipt: ApplicationOperationReceipt | undefined

  async checkpointApplicationEntitlement(
    receipt: ApplicationEntitlementOperationReceipt,
  ): Promise<void> {
    this.applicationReceipt = receipt
  }

  async finishApplication(receipt: ApplicationOperationReceipt): Promise<void> {
    this.applicationReceipt = receipt
  }

  async getApplication(): Promise<ApplicationOperationReceipt | undefined> {
    return this.applicationReceipt
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    if (this.applicationReceipt) {
      return { created: false, receipt: this.applicationReceipt }
    }
    this.applicationReceipt = receipt
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
    bot_public: false,
    bot_require_code_grant: false,
    description: "",
    flags: Number(1n << 18n),
    id,
    integration_types_config: {
      "0": {},
    },
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

function completeChannelGateway(
  channels: readonly DiscordChannel[] = [channel()],
): GatewayChannelLayoutStore {
  const gateway = new GatewayChannelLayoutStore({
    enabled: true,
    guildIds: new Set([GUILD_ID]),
  })
  assert.equal(gateway.ingestDispatch("GUILD_CREATE", {
    channels,
    id: GUILD_ID,
  }), true)
  return gateway
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
  applicationEmojiOptions?: ConnectorServiceOptions["applicationEmojiOptions"]
  applicationEntitlementOptions?: ConnectorServiceOptions["applicationEntitlementOptions"]
  applicationIntentOptions?: ConnectorServiceOptions["applicationIntentOptions"]
  applicationRoleConnectionMetadataOptions?:
    ConnectorServiceOptions["applicationRoleConnectionMetadataOptions"]
  attachmentMessageOptions?: ConnectorServiceOptions["attachmentMessageOptions"]
  automodOptions?: ConnectorServiceOptions["automodOptions"]
  channelAdministrationOptions?: ConnectorServiceOptions["channelAdministrationOptions"]
  channelCloneOptions?: ConnectorServiceOptions["channelCloneOptions"]
  channelMetadataOptions?: ConnectorServiceOptions["channelMetadataOptions"]
  channelOrderingOptions?: ConnectorServiceOptions["channelOrderingOptions"]
  config?: ConnectorConfig
  configOverrides?: FixtureConfigOverrides
  componentMessageOptions?: ConnectorServiceOptions["componentMessageOptions"]
  embedMessageOptions?: ConnectorServiceOptions["embedMessageOptions"]
  channel?: DiscordChannel
  client?: Partial<DiscordServiceClient>
  currentUser?: DiscordUser
  forumPostOptions?: ConnectorServiceOptions["forumPostOptions"]
  forumTagOptions?: ConnectorServiceOptions["forumTagOptions"]
  guildExpressionOptions?: ConnectorServiceOptions["guildExpressionOptions"]
  guildBlueprintOptions?: ConnectorServiceOptions["guildBlueprintOptions"]
  guildCommunityOptions?: ConnectorServiceOptions["guildCommunityOptions"]
  guildIncidentOptions?: ConnectorServiceOptions["guildIncidentOptions"]
  guildProfileOptions?: ConnectorServiceOptions["guildProfileOptions"]
  guildScaffoldOptions?: ConnectorServiceOptions["guildScaffoldOptions"]
  guildSettingsOptions?: ConnectorServiceOptions["guildSettingsOptions"]
  guildTemplateOptions?: ConnectorServiceOptions["guildTemplateOptions"]
  gateway?: ConnectorServiceOptions["gateway"]
  integrationOptions?: ConnectorServiceOptions["integrationOptions"]
  interactionOptions?: ConnectorServiceOptions["interactionOptions"]
  inviteOptions?: ConnectorServiceOptions["inviteOptions"]
  memberNicknameOptions?: ConnectorServiceOptions["memberNicknameOptions"]
  memberRoleOptions?: ConnectorServiceOptions["memberRoleOptions"]
  memberVerificationOptions?: ConnectorServiceOptions["memberVerificationOptions"]
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
  voiceChannelStatusOptions?: ConnectorServiceOptions["voiceChannelStatusOptions"]
  threadCreationOptions?: ConnectorServiceOptions["threadCreationOptions"]
  threadGovernanceOptions?: ConnectorServiceOptions["threadGovernanceOptions"]
  webhookOptions?: ConnectorServiceOptions["webhookOptions"]
  webhookMessageOptions?: ConnectorServiceOptions["webhookMessageOptions"]
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
    createEmbedMessage: 0,
    createForumPost: 0,
    createMessage: 0,
    createRole: 0,
    editMessage: 0,
    editComponentMessage: 0,
    editEmbedMessage: 0,
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
    async bulkGuildBan() {
      throw new Error("Unexpected bulk guild ban")
    },
    async beginGuildPrune() {
      throw new Error("Unexpected guild prune")
    },
    async consumeApplicationEntitlement() {
      throw new Error("Unexpected application entitlement consumption")
    },
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
    async createGlobalApplicationCommand() {
      throw new Error("Unexpected global application-command creation")
    },
    async createApplicationEmoji() {
      throw new Error("Unexpected application emoji creation")
    },
    async createApplicationTestEntitlement() {
      throw new Error("Unexpected application test entitlement creation")
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
    async createEmbedMessage() {
      calls.createEmbedMessage += 1
      throw new Error("Unexpected embed-message creation")
    },
    async createChannelInvite() {
      throw new Error("Unexpected invite creation")
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
    async deleteGlobalApplicationCommand() {
      throw new Error("Unexpected global application-command deletion")
    },
    async editGuildApplicationCommand() {
      throw new Error("Unexpected application-command update")
    },
    async editGlobalApplicationCommand() {
      throw new Error("Unexpected global application-command update")
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
    async createMessageForward() {
      throw new Error("Unexpected message-forward creation")
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
    async deleteApplicationEmoji() {
      throw new Error("Unexpected application emoji deletion")
    },
    async deleteApplicationTestEntitlement() {
      throw new Error("Unexpected application test entitlement deletion")
    },
    async deleteChannelPermissionOverwrite() {},
    async deleteGuildChannel() {
      throw new Error("Unexpected guild channel deletion")
    },
    async deleteGuildRole() {
      throw new Error("Unexpected guild role deletion")
    },
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
    async deleteWebhookMessage() {
      throw new Error("Unexpected webhook message deletion")
    },
    async editChannelPermissionOverwrite() {},
    async editComponentMessage() {
      calls.editComponentMessage += 1
      throw new Error("Unexpected component-message edit")
    },
    async editEmbedMessage() {
      calls.editEmbedMessage += 1
      throw new Error("Unexpected embed-message edit")
    },
    async editMessage(_channelId, _messageId, input) {
      calls.editMessage += 1
      return message({
        author: bot(),
        content: input.content,
      })
    },
    async executeWebhookMessage() {
      throw new Error("Unexpected webhook message delivery")
    },
    async endPoll() {
      throw new Error("Unexpected poll ending")
    },
    async getChannel() {
      return overrides.channel || channel()
    },
    async getWebhookMessage() {
      throw new Error("Unexpected webhook message lookup")
    },
    async getWebhookWithToken() {
      throw new Error("Unexpected webhook credential lookup")
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
    async getCurrentUserVoiceState() {
      throw new Error("Unexpected current-user voice lookup")
    },
    async getApplicationEmoji() {
      throw new Error("Unexpected application emoji lookup")
    },
    async getCurrentUser() {
      calls.user += 1
      return overrides.currentUser || bot()
    },
    async getGuild() {
      return {
        ...guild(),
        features: [],
        owner_id: "700000000000000001",
        premium_tier: 0,
      }
    },
    async getInvite() {
      throw new Error("Unexpected exact invite lookup")
    },
    async getInviteTargetUserIds() {
      throw new Error("Unexpected invite target-user lookup")
    },
    async getInviteTargetUsersJobStatus() {
      throw new Error("Unexpected invite target-user job lookup")
    },
    async getGuildIncidentActions() {
      throw new Error("Unexpected guild incident-action lookup")
    },
    async getGuildProfile() {
      throw new Error("Unexpected guild profile lookup")
    },
    async getGuildPruneCount() {
      throw new Error("Unexpected guild prune count")
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
    async listGlobalApplicationCommands() {
      throw new Error("Unexpected global application-command listing")
    },
    async listGlobalApplicationCommandsWithLocalizations() {
      throw new Error("Unexpected localized global application-command listing")
    },
    async listGuildApplicationCommands() {
      throw new Error("Unexpected application-command listing")
    },
    async listGuildApplicationCommandsWithLocalizations() {
      throw new Error("Unexpected localized application-command listing")
    },
    async listGuildApplicationCommandPermissions() {
      throw new Error("Unexpected application-command permission listing")
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
    async listGuildVoiceRegions() {
      return []
    },
    async listGuildScheduledEvents() {
      return []
    },
    async listGuildScheduledEventUsers() {
      throw new Error("Unexpected scheduled-event user listing")
    },
    async listGuildSoundboardSounds() {
      return []
    },
    async listGuildEmojis() {
      return []
    },
    async listApplicationEmojis() {
      throw new Error("Unexpected application emoji inventory")
    },
    async listApplicationRoleConnectionMetadata() {
      return []
    },
    async replaceApplicationRoleConnectionMetadata() {
      throw new Error("Unexpected linked-role metadata replacement")
    },
    async listApplicationSkus() {
      return []
    },
    async listApplicationEntitlements() {
      throw new Error("Unexpected application entitlement inventory")
    },
    async getApplicationEntitlement() {
      throw new Error("Unexpected application entitlement lookup")
    },
    async listApplicationSubscriptions() {
      throw new Error("Unexpected application subscription inventory")
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
    async modifyGuildCommunity() {
      throw new Error("Unexpected guild Community change")
    },
    async modifyGuildSettings() {
      throw new Error("Unexpected guild-settings change")
    },
    async modifyGuildIncidentActions() {
      throw new Error("Unexpected guild incident-action change")
    },
    async modifyGuildProfile() {
      throw new Error("Unexpected guild profile change")
    },
    async modifyWebhook() {
      throw new Error("Unexpected webhook modification")
    },
    async modifyWebhookMessage() {
      throw new Error("Unexpected webhook message modification")
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
    async listGuildWebhooks() {
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
    async listVoiceRegions() {
      return []
    },
    async modifyGuildMemberTimeout(_guildId, userId, input) {
      return {
        communication_disabled_until: input.communicationDisabledUntil,
        roles: [],
        user: { id: userId, username: "target" },
      }
    },
    async modifyCurrentMemberNickname() {
      throw new Error("Unexpected current-member nickname change")
    },
    async modifyGuildMemberNickname() {
      throw new Error("Unexpected member nickname change")
    },
    async modifyGuildMemberVerificationBypass() {
      throw new Error("Unexpected member verification change")
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
    async modifyApplicationEmoji() {
      throw new Error("Unexpected application emoji modification")
    },
    async modifyCurrentApplicationFlags() {
      throw new Error("Unexpected current-application flag modification")
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
    async setVoiceChannelStatus() {
      throw new Error("Unexpected voice channel status change")
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
  const config = overrides.config || loadConnectorConfig({
    token: TOKEN,
    ...overrides.configOverrides,
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      ...overrides.configOverrides?.identity,
    },
    readScope: {
      guildIds: [GUILD_ID],
      ...overrides.configOverrides?.readScope,
    },
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
      ...(overrides.channelCloneOptions
        ? { channelCloneOptions: overrides.channelCloneOptions }
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
      ...(overrides.embedMessageOptions
        ? { embedMessageOptions: overrides.embedMessageOptions }
        : {}),
      ...(overrides.attachmentMessageOptions
        ? { attachmentMessageOptions: overrides.attachmentMessageOptions }
        : {}),
      ...(overrides.applicationEmojiOptions
        ? { applicationEmojiOptions: overrides.applicationEmojiOptions }
        : {}),
      ...(overrides.applicationEntitlementOptions
        ? { applicationEntitlementOptions: overrides.applicationEntitlementOptions }
        : {}),
      ...(overrides.applicationIntentOptions
        ? { applicationIntentOptions: overrides.applicationIntentOptions }
        : {}),
      ...(overrides.applicationRoleConnectionMetadataOptions
        ? {
            applicationRoleConnectionMetadataOptions:
              overrides.applicationRoleConnectionMetadataOptions,
          }
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
      ...(overrides.memberNicknameOptions
        ? { memberNicknameOptions: overrides.memberNicknameOptions }
        : {}),
      ...(overrides.memberVerificationOptions
        ? { memberVerificationOptions: overrides.memberVerificationOptions }
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
      ...(overrides.guildBlueprintOptions
        ? { guildBlueprintOptions: overrides.guildBlueprintOptions }
        : {}),
      ...(overrides.guildSettingsOptions
        ? { guildSettingsOptions: overrides.guildSettingsOptions }
        : {}),
      ...(overrides.guildCommunityOptions
        ? { guildCommunityOptions: overrides.guildCommunityOptions }
        : {}),
      ...(overrides.guildIncidentOptions
        ? { guildIncidentOptions: overrides.guildIncidentOptions }
        : {}),
      ...(overrides.guildProfileOptions
        ? { guildProfileOptions: overrides.guildProfileOptions }
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
      ...(overrides.voiceChannelStatusOptions
        ? { voiceChannelStatusOptions: overrides.voiceChannelStatusOptions }
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
      ...(overrides.webhookMessageOptions
        ? { webhookMessageOptions: overrides.webhookMessageOptions }
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

test("service pins complete application-command audits to verified identity and scope", async () => {
  const globalCommandId = "310000000000000001"
  const guildCommandId = "310000000000000002"
  const controller = new AbortController()
  const reads: Array<{
    applicationId?: string
    guildId?: string
    operation: string
    signal: AbortSignal | undefined
  }> = []
  const { calls, service } = serviceFixture({
    client: {
      async getCurrentApplication(options) {
        calls.application += 1
        reads.push({ operation: "application", signal: options?.signal })
        return application()
      },
      async getCurrentUser(options) {
        calls.user += 1
        reads.push({ operation: "bot", signal: options?.signal })
        return bot()
      },
      async getGuild(guildId, options) {
        reads.push({ guildId, operation: "guild", signal: options?.signal })
        return guild()
      },
      async listGlobalApplicationCommands(applicationId, options) {
        reads.push({
          applicationId,
          operation: "global-commands",
          signal: options?.signal,
        })
        return [{
          application_id: APPLICATION_ID,
          contexts: [0, 1],
          default_member_permissions: null,
          description: "Review the connector",
          id: globalCommandId,
          integration_types: [0],
          name: "review",
          type: 1,
          version: "310000000000000003",
        }]
      },
      async listGuildApplicationCommands(applicationId, guildId, options) {
        reads.push({
          applicationId,
          guildId,
          operation: "guild-commands",
          signal: options?.signal,
        })
        return [{
          application_id: APPLICATION_ID,
          contexts: [0],
          default_member_permissions: "0",
          description: "",
          guild_id: GUILD_ID,
          id: guildCommandId,
          integration_types: [0],
          name: "Inspect member",
          type: 2,
          version: "310000000000000004",
        }]
      },
      async listGuildApplicationCommandPermissions(applicationId, guildId, options) {
        reads.push({
          applicationId,
          guildId,
          operation: "permissions",
          signal: options?.signal,
        })
        return [{
          applicationId: APPLICATION_ID,
          commandId: globalCommandId,
          guildId: GUILD_ID,
          permissions: [{
            allowed: false,
            id: MEMBER_USER_ID,
            type: 2,
            unknownFieldCount: 0,
          }],
          unknownFieldCount: 0,
        }]
      },
    },
  })

  const result = await service.auditApplicationCommands(GUILD_ID, {
    signal: controller.signal,
  })

  assert.deepEqual(result.application, {
    botId: BOT_ID,
    id: APPLICATION_ID,
    installationTypes: {
      complete: true,
      reported: true,
      unknownValues: 0,
      values: ["guild-install"],
    },
  })
  assert.deepEqual(result.inventory, {
    completeness: "complete-current-application",
    global: 1,
    guild: 1,
    permissions: 1,
    total: 2,
  })
  assert.deepEqual(result.commands.map(({ id, permissionSource, scope }) => ({
    id,
    permissionSource,
    scope,
  })), [{
    id: globalCommandId,
    permissionSource: "command-specific",
    scope: "global",
  }, {
    id: guildCommandId,
    permissionSource: "discord-default",
    scope: "guild",
  }])
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(reads.map((read) => read.operation), [
    "application",
    "bot",
    "guild",
    "global-commands",
    "guild-commands",
    "permissions",
  ])
  assert.ok(reads.every(({ signal }) => signal === controller.signal))
  assert.ok(reads.slice(2).every(({ applicationId }) => (
    applicationId === undefined || applicationId === APPLICATION_ID
  )))
  assert.ok(reads.slice(2).every(({ guildId }) => (
    guildId === undefined || guildId === GUILD_ID
  )))
})

test("service rejects application-command scope before identity access", async () => {
  const { calls, service } = serviceFixture()

  await assert.rejects(
    () => service.auditApplicationCommands(OTHER_GUILD_ID),
    PolicyError,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service pins linked-role metadata audits to verified current application identity", async () => {
  const controller = new AbortController()
  const reads: Array<{
    applicationId?: string
    operation: string
    signal: AbortSignal | undefined
  }> = []
  const { calls, service } = serviceFixture({
    client: {
      async getCurrentApplication(options) {
        calls.application += 1
        reads.push({ operation: "application", signal: options?.signal })
        return {
          ...application(),
          role_connections_verification_url: "https://private.example.test/linked-role",
        }
      },
      async getCurrentUser(options) {
        calls.user += 1
        reads.push({ operation: "bot", signal: options?.signal })
        return bot()
      },
      async listApplicationRoleConnectionMetadata(applicationId, options) {
        reads.push({
          applicationId,
          operation: "metadata",
          signal: options?.signal,
        })
        return [{
          description: "Minimum review level",
          key: "review_level",
          name: "Review level",
          type: 2,
        }]
      },
    },
  })

  const result = await service.auditApplicationRoleConnectionMetadata({
    signal: controller.signal,
  })

  assert.deepEqual(result.application, {
    botId: BOT_ID,
    id: APPLICATION_ID,
    verificationEndpointConfigured: true,
  })
  assert.equal(result.inventory.count, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(reads.map((read) => read.operation), [
    "application",
    "bot",
    "metadata",
  ])
  assert.ok(reads.every(({ signal }) => signal === controller.signal))
  assert.equal(reads[2]?.applicationId, APPLICATION_ID)
  assert.doesNotMatch(JSON.stringify(result), /private\.example/u)
})

test("service pins SKU audits to verified current application identity", async () => {
  const controller = new AbortController()
  const reads: Array<{
    applicationId?: string
    operation: string
    signal: AbortSignal | undefined
  }> = []
  const { calls, service } = serviceFixture({
    client: {
      async getCurrentApplication(options) {
        calls.application += 1
        reads.push({ operation: "application", signal: options?.signal })
        return application()
      },
      async getCurrentUser(options) {
        calls.user += 1
        reads.push({ operation: "bot", signal: options?.signal })
        return bot()
      },
      async listApplicationSkus(applicationId, options) {
        reads.push({
          applicationId,
          operation: "skus",
          signal: options?.signal,
        })
        return [{
          application_id: APPLICATION_ID,
          flags: 4,
          id: "610000000000000001",
          name: "Supporter",
          slug: "supporter",
          type: 2,
        }]
      },
    },
  })

  const result = await service.auditApplicationSkus({
    signal: controller.signal,
  })

  assert.deepEqual(result.application, {
    botId: BOT_ID,
    id: APPLICATION_ID,
  })
  assert.equal(result.inventory.count, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(reads.map((read) => read.operation), [
    "application",
    "bot",
    "skus",
  ])
  assert.ok(reads.every(({ signal }) => signal === controller.signal))
  assert.equal(reads[2]?.applicationId, APPLICATION_ID)
})

test("service audits one exact guild beneficiary across configured current-application SKUs", async () => {
  const controller = new AbortController()
  const cursor = "620000000000000000"
  const reads: string[] = []
  const { service } = serviceFixture({
    configOverrides: {
      capabilities: { applicationMonetizationAudit: true },
      scopes: {
        applicationEntitlementGuildIds: [GUILD_ID],
        applicationMonetizationSkuIds: [APPLICATION_SKU_ID],
      },
    },
    client: {
      async listApplicationSkus(applicationId, options) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.equal(options?.signal, controller.signal)
        reads.push("skus")
        return [{
          application_id: APPLICATION_ID,
          flags: 132,
          id: APPLICATION_SKU_ID,
          name: "Private supporter name",
          slug: "private-supporter-slug",
          type: 5,
        }]
      },
      async listApplicationEntitlements(applicationId, beneficiary, skuIds, options) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.deepEqual(beneficiary, { guildId: GUILD_ID, type: "guild" })
        assert.deepEqual(skuIds, [APPLICATION_SKU_ID])
        assert.deepEqual(options, {
          after: cursor,
          limit: 2,
          signal: controller.signal,
        })
        reads.push("entitlements")
        return [{
          application_id: APPLICATION_ID,
          consumed: false,
          deleted: false,
          guild_id: GUILD_ID,
          id: APPLICATION_ENTITLEMENT_ID,
          sku_id: APPLICATION_SKU_ID,
          type: 8,
          user_id: MEMBER_USER_ID,
        }]
      },
    },
  })

  const result = await service.auditApplicationEntitlements(
    { guildId: GUILD_ID, type: "guild" },
    [APPLICATION_SKU_ID],
    { after: cursor, limit: 2, signal: controller.signal },
  )

  assert.deepEqual(reads, ["skus", "entitlements"])
  assert.deepEqual(result.application, { botId: BOT_ID, id: APPLICATION_ID })
  assert.deepEqual(result.beneficiary, { id: GUILD_ID, type: "guild" })
  assert.deepEqual(result.inventory.skuIds, [APPLICATION_SKU_ID])
  assert.deepEqual(result.records, [{
    consumed: false,
    endsAt: null,
    id: APPLICATION_ENTITLEMENT_ID,
    skuId: APPLICATION_SKU_ID,
    startsAt: null,
    type: "application-subscription",
    unknownFieldCount: 0,
  }])
  assert.equal(JSON.stringify(result).includes(MEMBER_USER_ID), false)
  assert.equal(JSON.stringify(result).includes("Private supporter"), false)
})

test("service inspects one preauthorized exact entitlement after identity and SKU verification", async () => {
  const controller = new AbortController()
  const reads: string[] = []
  const { service } = serviceFixture({
    configOverrides: {
      capabilities: { applicationMonetizationAudit: true },
      scopes: {
        applicationEntitlementGuildIds: [GUILD_ID],
        applicationMonetizationSkuIds: [APPLICATION_SKU_ID],
      },
    },
    client: {
      async listApplicationSkus(applicationId, options) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.equal(options?.signal, controller.signal)
        reads.push("skus")
        return [{
          application_id: APPLICATION_ID,
          flags: 132,
          id: APPLICATION_SKU_ID,
          name: "Private supporter name",
          slug: "private-supporter-slug",
          type: 5,
        }]
      },
      async getApplicationEntitlement(applicationId, entitlementId, options) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.equal(entitlementId, APPLICATION_ENTITLEMENT_ID)
        assert.equal(options?.signal, controller.signal)
        reads.push("entitlement")
        return {
          application_id: APPLICATION_ID,
          consumed: false,
          deleted: false,
          guild_id: GUILD_ID,
          id: APPLICATION_ENTITLEMENT_ID,
          sku_id: APPLICATION_SKU_ID,
          type: 8,
          user_id: MEMBER_USER_ID,
        }
      },
    },
  })

  const result = await service.getApplicationEntitlement(
    { guildId: GUILD_ID, type: "guild" },
    APPLICATION_ENTITLEMENT_ID,
    APPLICATION_SKU_ID,
    { signal: controller.signal },
  )

  assert.deepEqual(reads, ["skus", "entitlement"])
  assert.deepEqual(result.application, { botId: BOT_ID, id: APPLICATION_ID })
  assert.deepEqual(result.beneficiary, { id: GUILD_ID, type: "guild" })
  assert.equal(result.entitlement.id, APPLICATION_ENTITLEMENT_ID)
  assert.equal(result.sku.id, APPLICATION_SKU_ID)
  assert.equal(JSON.stringify(result).includes(MEMBER_USER_ID), false)
  assert.equal(JSON.stringify(result).includes("Private supporter"), false)
})

test("service rejects an unscoped exact entitlement before Discord access", async () => {
  const { calls, service } = serviceFixture({
    configOverrides: {
      capabilities: { applicationMonetizationAudit: true },
      scopes: {
        applicationEntitlementGuildIds: [GUILD_ID],
        applicationMonetizationSkuIds: [APPLICATION_SKU_ID],
      },
    },
  })

  await assert.rejects(
    service.getApplicationEntitlement(
      { type: "user", userId: MEMBER_USER_ID },
      APPLICATION_ENTITLEMENT_ID,
      APPLICATION_SKU_ID,
    ),
    /outside the application entitlement scope/u,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service treats exact-user subscription state as lifecycle evidence only", async () => {
  const controller = new AbortController()
  const reads: string[] = []
  const { calls, service } = serviceFixture({
    configOverrides: {
      capabilities: { applicationMonetizationAudit: true },
      scopes: {
        applicationMonetizationSkuIds: [APPLICATION_SKU_ID],
        applicationSubscriptionUserIds: [MEMBER_USER_ID],
      },
    },
    client: {
      async listApplicationSkus() {
        reads.push("skus")
        return [{
          application_id: APPLICATION_ID,
          flags: 260,
          id: APPLICATION_SKU_ID,
          name: "Private subscriber name",
          slug: "private-subscriber-slug",
          type: 5,
        }]
      },
      async listApplicationSubscriptions(skuId, userId, options) {
        assert.equal(skuId, APPLICATION_SKU_ID)
        assert.equal(userId, MEMBER_USER_ID)
        assert.deepEqual(options, { limit: 1, signal: controller.signal })
        reads.push("subscriptions")
        return [{
          canceled_at: null,
          country: "US",
          current_period_end: "2026-09-01T00:00:00Z",
          current_period_start: "2026-08-01T00:00:00Z",
          entitlement_ids: [APPLICATION_ENTITLEMENT_ID],
          id: APPLICATION_SUBSCRIPTION_ID,
          renewal_sku_ids: [APPLICATION_SKU_ID],
          sku_ids: [APPLICATION_SKU_ID],
          status: 0,
          user_id: MEMBER_USER_ID,
        }]
      },
    },
  })

  const result = await service.auditApplicationSubscriptions(
    MEMBER_USER_ID,
    APPLICATION_SKU_ID,
    { limit: 1, signal: controller.signal },
  )

  assert.deepEqual(reads, ["skus", "subscriptions"])
  assert.equal(result.inventory.accessAuthority, "entitlements-only")
  assert.equal(result.inventory.userId, MEMBER_USER_ID)
  assert.equal(result.records[0]?.status, "active")
  assert.equal(result.records[0]?.entitlementCount, 1)
  assert.equal(JSON.stringify(result).includes("US"), false)
  assert.equal(JSON.stringify(result).includes("Private subscriber"), false)

  await assert.rejects(
    () => service.auditApplicationSubscriptions(
      "600000000000000002",
      APPLICATION_SKU_ID,
    ),
    PolicyError,
  )
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
})

test("service pins guild webhook audits to verified connector identity and exact scope", async () => {
  const controller = new AbortController()
  const reads: Array<{
    operation: string
    signal: AbortSignal | undefined
  }> = []
  const { calls, service } = serviceFixture({
    client: {
      async getGuild(guildId, options) {
        assert.equal(guildId, GUILD_ID)
        reads.push({ operation: "guild", signal: options?.signal })
        return { ...guild(), owner_id: MEMBER_USER_ID }
      },
      async getGuildChannels(guildId, options) {
        assert.equal(guildId, GUILD_ID)
        reads.push({ operation: "channels", signal: options?.signal })
        return [channel({
          name: "private-channel-name",
          topic: "private-channel-topic",
        })]
      },
      async getGuildMember(guildId, userId, options) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(userId, BOT_ID)
        reads.push({ operation: "member", signal: options?.signal })
        return { roles: [], user: bot() }
      },
      async getGuildRoles(guildId, options) {
        assert.equal(guildId, GUILD_ID)
        reads.push({ operation: "roles", signal: options?.signal })
        return [role(GUILD_ID, DISCORD_PERMISSIONS.MANAGE_WEBHOOKS, "@everyone")]
      },
      async listGuildWebhooks(guildId, options) {
        assert.equal(guildId, GUILD_ID)
        reads.push({ operation: "webhooks", signal: options?.signal })
        return [{
          applicationId: APPLICATION_ID,
          channelId: CHANNEL_ID,
          creatorUserId: BOT_ID,
          guildId: GUILD_ID,
          id: WEBHOOK_ID,
          name: "private-webhook-name",
          sourceChannelId: null,
          sourceGuildId: null,
          type: 1,
        }]
      },
    },
    configOverrides: {
      capabilities: { webhookAudit: true },
      readScope: { guildIds: [GUILD_ID] },
      scopes: { webhookGuildIds: [GUILD_ID] },
    },
  })

  const result = await service.auditGuildWebhooks(GUILD_ID, {
    signal: controller.signal,
  })

  assert.equal(result.application.id, APPLICATION_ID)
  assert.equal(result.application.botId, BOT_ID)
  assert.equal(result.guildId, GUILD_ID)
  assert.equal(result.inventory.count, 1)
  assert.equal(result.access.manageWebhooks, true)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(new Set(reads.map(({ operation }) => operation)), new Set([
    "channels",
    "guild",
    "member",
    "roles",
    "webhooks",
  ]))
  assert.equal(reads.every(({ signal }) => signal === controller.signal), true)
  assert.doesNotMatch(JSON.stringify(result), /private-channel/u)
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

test("service rejects channel-clone scope before identity access", async () => {
  const { calls, service } = serviceFixture()

  await assert.rejects(
    () => service.planChannelClone({
      auditReason: "reviewed",
      guildId: GUILD_ID,
      operationKey: "channel-clone-preflight-0001",
      sourceChannelId: CHANNEL_ID,
    }),
    /channel-clone audit is disabled/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service rejects application intent policy before identity access", async () => {
  const disabled = serviceFixture()
  const request = {
    acknowledgePrivilegeExpansion: true as const,
    intent: "guild-members" as const,
    operationKey: "application-intent-preflight-0001",
    reviewReason: "Enable the configured member directory",
  }
  await assert.rejects(
    () => disabled.service.planApplicationIntentEnablement(request),
    /privileged-intent changes are disabled/,
  )
  assert.equal(disabled.calls.application, 0)
  assert.equal(disabled.calls.user, 0)

  const unjustified = serviceFixture({
    configOverrides: {
      capabilities: {
        applicationIntentChanges: true,
      },
    },
  })
  await assert.rejects(
    () => unjustified.service.planApplicationIntentEnablement(request),
    /requires member-directory policy/,
  )
  assert.equal(unjustified.calls.application, 0)
  assert.equal(unjustified.calls.user, 0)
})

test("service rejects application entitlement write policy before identity or SKU access", async () => {
  const testRequest = {
    action: "create" as const,
    auditReason: "Reviewed test access",
    beneficiary: { guildId: GUILD_ID, type: "guild" as const },
    operationKey: "application-test-entitlement-preflight-0001",
    skuId: APPLICATION_SKU_ID,
  }
  const consumptionRequest = {
    acknowledgeExternalFulfillment: true as const,
    auditReason: "Reviewed fulfilled purchase",
    entitlementId: APPLICATION_ENTITLEMENT_ID,
    fulfillmentReference: "fulfilled-order-preflight-0001",
    operationKey: "application-entitlement-consume-preflight-0001",
    skuId: APPLICATION_SKU_ID,
    userId: MEMBER_USER_ID,
  }
  const disabled = serviceFixture()
  await assert.rejects(
    () => disabled.service.planApplicationTestEntitlementChange(testRequest),
    /test entitlement changes are disabled/u,
  )
  await assert.rejects(
    () => disabled.service.planApplicationEntitlementConsumption(
      consumptionRequest,
    ),
    /entitlement consumption is disabled/u,
  )
  assert.equal(disabled.calls.application, 0)
  assert.equal(disabled.calls.user, 0)

  const outsideScope = serviceFixture({
    client: {
      async listApplicationSkus() {
        throw new Error("SKU access must follow policy")
      },
    },
    configOverrides: {
      capabilities: {
        applicationEntitlementConsumption: true,
        applicationTestEntitlementChanges: true,
      },
      scopes: {
        applicationConsumableEntitlementSkuIds: [APPLICATION_SUBSCRIPTION_ID],
        applicationConsumableEntitlementUserIds: [MEMBER_USER_ID],
        applicationMonetizationSkuIds: [
          APPLICATION_SKU_ID,
          APPLICATION_SUBSCRIPTION_ID,
        ],
        applicationTestEntitlementGuildIds: [GUILD_ID],
        applicationTestEntitlementSkuIds: [APPLICATION_SUBSCRIPTION_ID],
      },
    },
  })
  await assert.rejects(
    () => outsideScope.service.planApplicationTestEntitlementChange(testRequest),
    /outside the application test entitlement scope/u,
  )
  await assert.rejects(
    () => outsideScope.service.planApplicationEntitlementConsumption(
      consumptionRequest,
    ),
    /outside the application entitlement consumption scope/u,
  )
  assert.equal(outsideScope.calls.application, 0)
  assert.equal(outsideScope.calls.user, 0)
})

test("service requires private attachment client support only when its gate is enabled", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-private-attachment-client-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const directClient: Partial<DiscordServiceClient> = {
    async createDirectAttachmentMessage() {
      throw new Error("Unexpected direct-message attachment creation")
    },
    async createDirectComponentMessage() {
      throw new Error("Unexpected direct-message component creation")
    },
    async createDirectMessage() {
      throw new Error("Unexpected direct-message creation")
    },
    async createDirectMessageChannel() {
      throw new Error("Unexpected direct-message channel creation")
    },
    async deleteDirectMessage() {
      throw new Error("Unexpected direct-message deletion")
    },
    async editDirectComponentMessage() {
      throw new Error("Unexpected direct-message component edit")
    },
    async editDirectMessage() {
      throw new Error("Unexpected direct-message edit")
    },
    async getDirectMessage() {
      throw new Error("Unexpected direct-message read")
    },
    async getDirectMessageChannel() {
      throw new Error("Unexpected direct-message channel read")
    },
    async getDirectMessageUser() {
      throw new Error("Unexpected direct-message user read")
    },
    async listDirectMessages() {
      throw new Error("Unexpected direct-message listing")
    },
  }
  const {
    createDirectAttachmentMessage: _createDirectAttachmentMessage,
    ...withoutAttachment
  } = directClient
  const deliveryConfig = {
    capabilities: { directMessageDelivery: true },
    scopes: { directMessageUserIds: [MEMBER_USER_ID] },
  }
  assert.doesNotThrow(() => serviceFixture({
    client: withoutAttachment,
    configOverrides: deliveryConfig,
  }))

  const attachmentConfig = {
    capabilities: {
      directMessageAttachments: true,
      directMessageDelivery: true,
    },
    scopes: { directMessageUserIds: [MEMBER_USER_ID] },
    storage: { attachmentRoots: [root] },
  }
  assert.throws(
    () => serviceFixture({
      client: withoutAttachment,
      configOverrides: attachmentConfig,
    }),
    ConfigurationError,
  )
  assert.doesNotThrow(() => serviceFixture({
    client: directClient,
    configOverrides: attachmentConfig,
  }))
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
    () => service.auditGuildWebhooks(GUILD_ID),
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
  await assert.rejects(
    () => service.getWebhookMessage({
      messageId: MESSAGE_ID,
      webhookId: WEBHOOK_ID,
    }),
    /webhook message audit is disabled/,
  )
  await assert.rejects(
    () => service.sendWebhookMessage({
      content: "reviewed",
      operationKey: "webhook-message-send-preflight-0001",
      webhookId: WEBHOOK_ID,
    }),
    /webhook message delivery is disabled/,
  )
  await assert.rejects(
    () => service.editWebhookMessage({
      content: "reviewed",
      messageId: MESSAGE_ID,
      operationKey: "webhook-message-edit-preflight-0001",
      webhookId: WEBHOOK_ID,
    }),
    /webhook message audit is disabled/,
  )
  await assert.rejects(
    () => service.planWebhookMessageDeletion({
      messageId: MESSAGE_ID,
      operationKey: "webhook-message-delete-preflight-0001",
      reviewReason: "reviewed",
      webhookId: WEBHOOK_ID,
    }),
    /webhook message audit is disabled/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service rejects message-forward input and scope before identity access", async () => {
  const { calls, service } = serviceFixture()
  const request = {
    operationKey: "message-forward-preflight-0001",
    sourceChannelId: CHANNEL_ID,
    sourceMessageId: MESSAGE_ID,
    targetChannelId: OTHER_CHANNEL_ID,
  }

  await assert.rejects(
    () => service.planMessageForward(request),
    /message forwarding is disabled/,
  )
  await assert.rejects(
    () => service.executeMessageForward(
      request,
      `hmac-sha256:${"a".repeat(64)}`,
    ),
    /message forwarding is disabled/,
  )
  await assert.rejects(
    () => service.planMessageForward({ ...request, sourceMessageId: "bad" }),
    /source message ID/,
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
    configOverrides: {
      capabilities: {
        reactionModeration: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        protectedUserIds: [MEMBER_USER_ID],
        reactionChannelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      capabilities: {
        reactionModeration: true,
        reactionUserAudit: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        reactionChannelIds: [CHANNEL_ID],
      },
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

test("service coordinates every receipt-backed single-step workflow by shared targets", async (context) => {
  const writeCoordinator = new CapturingWriteCoordinator()
  const webhookCredentialTemporary = await mkdtemp(join(tmpdir(), "discord-mcp-webhook-coordination-"))
  context.after(() => rm(webhookCredentialTemporary, { force: true, recursive: true }))
  const webhookCredentialRoot = await realpath(webhookCredentialTemporary)
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
          premium_tier: 0,
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
          [CREATED_ROLE_ID]: 0,
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
      async listGuildApplicationCommandPermissions() {
        return []
      },
      async listGuildApplicationCommandsWithLocalizations() {
        return []
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
    configOverrides: {
      capabilities: {
        applicationCommandChanges: true,
        forumTagAudit: true,
        forumTagChanges: true,
        deletions: true,
        announcementSubscriptionAudit: true,
        announcementSubscriptionChanges: true,
        applicationEmojiAudit: true,
        applicationEmojiChanges: true,
        messageForwarding: true,
        interactions: true,
        integrationAudit: true,
        integrationDeletions: true,
        guildCommunityAudit: true,
        guildCommunityChanges: true,
        inviteCreation: true,
        inviteRoleAssignment: true,
        roleDeletionAudit: true,
        roleDeletions: true,
        roleOrderingAudit: true,
        roleOrderingChanges: true,
        channelOrderingAudit: true,
        channelOrderingChanges: true,
        channelCloneAudit: true,
        channelCloning: true,
        webhookAudit: true,
        webhookChanges: true,
        webhookCreation: true,
        webhookDeletions: true,
        webhookMessageAudit: true,
        webhookMessageChanges: true,
        webhookMessageDeletions: true,
        webhookMessageDelivery: true,
      },
      gateway: {
        enabled: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        applicationCommandGuildIds: [GUILD_ID],
        forumTagChannelIds: [CHANNEL_ID],
        channelCloneGuildIds: [GUILD_ID],
        channelCloneSourceIds: [CHANNEL_ID],
        channelOrderingGuildIds: [GUILD_ID],
        integrationGuildIds: [GUILD_ID],
        integrationIds: [INTEGRATION_ID],
        guildCommunityGuildIds: [GUILD_ID],
        interactionChannelIds: [CHANNEL_ID],
        inviteCreationChannelIds: [CHANNEL_ID],
        inviteRoleIds: [CREATED_ROLE_ID],
        roleDeletionIds: [CREATED_ROLE_ID],
        roleOrderingGuildIds: [GUILD_ID],
        announcementSubscriptionTargetChannelIds: [CHANNEL_ID],
        messageForwardSourceChannelIds: [CHANNEL_ID],
        messageForwardTargetChannelIds: [OTHER_CHANNEL_ID],
        deleteChannelIds: [CHANNEL_ID],
        webhookChannelIds: [CHANNEL_ID],
        webhookMessageChannelIds: [CHANNEL_ID],
      },
      storage: {
        inviteCapabilityRoots: [process.cwd()],
        webhookCredentialRoot,
      },
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
  const channelCloneRequest = {
    auditReason: "reviewed",
    guildId: GUILD_ID,
    name: "reviewed-clone",
    operationKey,
    sourceChannelId: CHANNEL_ID,
  }
  const channelClonePlan = await service.planChannelClone(channelCloneRequest)
  await captured(() => service.executeChannelClone(
    channelCloneRequest,
    channelClonePlan.digest,
  ))
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
  await captured(() => service.executeApplicationEmojiChange({
    acknowledgeGlobalImpact: true,
    action: "delete",
    emojiId: AUTOMOD_RULE_ID,
    operationKey,
  }, digest))
  const guildApplicationCommandRequest = {
    action: "create" as const,
    definition: {
      defaultMemberPermissions: ["MANAGE_GUILD" as const],
      name: "inspect_member",
      nameLocalizations: [],
      nsfw: false,
      type: "user" as const,
    },
    guildId: GUILD_ID,
    operationKey,
  }
  const guildApplicationCommandPlan = await service.planGuildApplicationCommandChange(
    guildApplicationCommandRequest,
  )
  await captured(() => service.executeGuildApplicationCommandChange(
    guildApplicationCommandRequest,
    guildApplicationCommandPlan.digest,
  ))
  await captured(() => service.executeGuildProfileChange({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    name: "Reviewed Guild Name",
    operationKey,
  }, digest))
  await captured(() => service.executeGuildSettingsChange({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    verificationLevel: "high",
  }, digest))
  await captured(() => service.executeGuildCommunityChange({
    acknowledgeCommunityEnablement: true,
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    publicUpdatesChannelId: OTHER_CHANNEL_ID,
    rulesChannelId: CHANNEL_ID,
    safetyAlertsChannelId: null,
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
  await captured(() => service.executeInviteCreation({
    acceptance: { kind: "bearer" },
    acknowledgeBearerCapability: true,
    auditReason: "reviewed",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    maxAgeSeconds: 3_600,
    maxUses: 1,
    operationKey,
    outputFile: join(process.cwd(), "coordination-invite-capability.json"),
    roleAssignment: {
      acknowledgePersistentGrants: true,
      kind: "grant",
      roleIds: [CREATED_ROLE_ID],
    },
    temporaryMembership: false,
  }, digest))
  await captured(() => service.executeMemberNicknameChange({
    auditReason: "reviewed",
    guildId: GUILD_ID,
    nickname: "reviewed nickname",
    operationKey,
    target: { kind: "member", userId: MEMBER_USER_ID },
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
  await captured(() => service.executeMessageForward({
    operationKey,
    sourceChannelId: CHANNEL_ID,
    sourceMessageId: MESSAGE_ID,
    targetChannelId: OTHER_CHANNEL_ID,
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
  const roleDeletionRequest = {
    acknowledgeIrreversibleRoleLoss: true as const,
    auditReason: "reviewed",
    guildId: GUILD_ID,
    operationKey,
    roleId: CREATED_ROLE_ID,
  }
  const roleDeletionPlan = await service.planRoleDeletion(roleDeletionRequest)
  await captured(() => service.executeRoleDeletion(
    roleDeletionRequest,
    roleDeletionPlan.digest,
  ))
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
  await captured(() => service.sendWebhookMessage({
    content: "reviewed webhook message",
    operationKey,
    webhookId: WEBHOOK_ID,
  }))
  await captured(() => service.editWebhookMessage({
    content: "reviewed webhook message replacement",
    messageId: MESSAGE_ID,
    operationKey,
    webhookId: WEBHOOK_ID,
  }))
  await captured(() => service.executeWebhookMessageDeletion({
    messageId: MESSAGE_ID,
    operationKey,
    reviewReason: "reviewed",
    webhookId: WEBHOOK_ID,
  }, digest))
  await captured(() => service.executeWidgetSettingsChange({
    auditReason: "reviewed",
    channelId: null,
    enabled: false,
    guildId: GUILD_ID,
    operationKey,
  }, digest))

  const byKind = new Map(writeCoordinator.intents.map((entry) => [entry.kind, entry]))
  assert.equal(byKind.size, 48)
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
      "application-emoji-change": [{
        applicationId: APPLICATION_ID,
        collection: "emojis",
        kind: "application-collection",
      }],
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
      "channel-clone": [
        { id: CHANNEL_ID, kind: "channel" },
        { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
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
      "guild-application-command-change": [{
        collection: "application-commands",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "guild-soundboard-change": [{
        collection: "soundboard",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "guild-profile-change": [{
        collection: "guild-settings",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "guild-community-change": [{
        collection: "community",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "guild-settings-change": [{
        collection: "guild-settings",
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
        { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "webhooks", guildId: GUILD_ID, kind: "guild-collection" },
        { id: INTEGRATION_BOT_ID, kind: "member" },
      ],
      "invite-deletion": [{
        collection: "invites",
        guildId: GUILD_ID,
        kind: "guild-collection",
      }],
      "invite-creation": [
        { id: CHANNEL_ID, kind: "channel" },
        { collection: "invites", guildId: GUILD_ID, kind: "guild-collection" },
        { id: CREATED_ROLE_ID, kind: "role" },
      ],
      "member-nickname-change": [
        { id: MEMBER_USER_ID, kind: "member" },
        { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "member-role-change": [
        { id: MEMBER_USER_ID, kind: "member" },
        { id: CREATED_ROLE_ID, kind: "role" },
        { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "member-voice-change": [
        { id: MEMBER_USER_ID, kind: "member" },
        { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
      ],
      "message-deletion": [{ id: MESSAGE_ID, kind: "message" }],
      "message-forward": [
        { id: MESSAGE_ID, kind: "message" },
        { id: OTHER_CHANNEL_ID, kind: "channel" },
      ],
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
      "role-deletion": [
        { id: CREATED_ROLE_ID, kind: "role" },
        { collection: "roles", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "invites", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "emojis", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "onboarding", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "automod", guildId: GUILD_ID, kind: "guild-collection" },
        { collection: "integrations", guildId: GUILD_ID, kind: "guild-collection" },
        {
          collection: "application-commands",
          guildId: GUILD_ID,
          kind: "guild-collection",
        },
        { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
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
        { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
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
      "webhook-message-deletion": [
        { id: MESSAGE_ID, kind: "message" },
        { id: WEBHOOK_ID, kind: "webhook" },
      ],
      "webhook-message-edit": [
        { id: MESSAGE_ID, kind: "message" },
        { id: WEBHOOK_ID, kind: "webhook" },
      ],
      "webhook-message-send": [{ id: WEBHOOK_ID, kind: "webhook" }],
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
            : entry.kind === "role-deletion"
              ? roleDeletionPlan.digest
            : entry.kind === "role-ordering"
              ? roleOrderPlan.digest
              : entry.kind === "channel-clone"
                ? channelClonePlan.digest
              : entry.kind === "channel-ordering"
                ? channelOrderPlan.digest
                : entry.kind === "guild-application-command-change"
                  ? guildApplicationCommandPlan.digest
                : digest
    if (["webhook-message-edit", "webhook-message-send"].includes(entry.kind)) {
      assert.match(entry.planDigest, /^hmac-sha256:[a-f0-9]{64}$/)
    } else {
      assert.equal(entry.planDigest, expectedDigest)
    }
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
  assert.equal(writeCoordinator.intents.length, 48)
})

test("service coordinates global application commands by the exact application-wide collection", async () => {
  const writeCoordinator = new CapturingWriteCoordinator()
  const { service } = serviceFixture({
    client: {
      async listGlobalApplicationCommandsWithLocalizations() {
        return []
      },
    },
    configOverrides: {
      capabilities: { globalApplicationCommandChanges: true },
    },
    writeCoordinator,
  })
  const request = {
    acknowledgeGlobalExposure: true as const,
    action: "create" as const,
    definition: {
      contexts: ["guild" as const],
      defaultMemberPermissions: ["MANAGE_GUILD" as const],
      description: "Deploy one reviewed global release",
      descriptionLocalizations: [],
      integrationTypes: ["guild-install" as const],
      name: "deploy-global",
      nameLocalizations: [],
      nsfw: false,
      options: [],
      type: "chat-input" as const,
    },
    operationKey: "global-command-coordination-0001",
  }

  const plan = await service.planGlobalApplicationCommandChange(request)
  assert.equal(plan.effect, "change")
  assert.deepEqual(plan.application.installationTypes, ["guild-install"])
  await assert.rejects(
    service.executeGlobalApplicationCommandChange(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )
  assert.equal(writeCoordinator.intents.length, 1)
  assert.deepEqual(writeCoordinator.intents[0], {
    kind: "global-application-command-change",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [{
      applicationId: APPLICATION_ID,
      collection: "global-application-commands",
      kind: "application-collection",
    }],
  })
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
    configOverrides: {
      capabilities: {
        channelCreation: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelCreationGuildIds: [GUILD_ID],
      },
      storage: {
        auditFile: auditFile,
      },
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
    configOverrides: {
      capabilities: {
        guildScaffolds: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: [GUILD_ID],
      },
      storage: {
        auditFile: auditFile,
      },
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
    configOverrides: {
      capabilities: {
        interactions: true,
      },
      limits: {
        interactionMinWriteIntervalMs: 0,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        interactionChannelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      capabilities: {
        webhookAudit: true,
        webhookDeletions: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        webhookChannelIds: [CHANNEL_ID],
      },
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

test("service keeps webhook credentials private across exact message lifecycle operations", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-webhook-message-service-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const credentialRoot = await realpath(temporary)
  const credential = "private-webhook-token.canary"
  await writeFile(join(credentialRoot, `${WEBHOOK_ID}.token`), `${credential}\n`, {
    mode: 0o600,
  })
  const operationStore = new KeyedMemoryOperationStore()
  let content = "Initial webhook notice"
  let deleted = false
  let deleteCalls = 0
  let deliveryCalls = 0
  let editCalls = 0
  let messageReads = 0
  let mentionedUserIds: readonly string[] = []
  let webhookReads = 0
  const webhookMessage = () => message({
    author: {
      bot: true,
      id: WEBHOOK_ID,
      username: "private-webhook-name",
    },
    content,
    flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
    mentions: mentionedUserIds.map((id) => ({ id, username: "notified-user" })),
    webhook_id: WEBHOOK_ID,
  })
  const { calls, service } = serviceFixture({
    client: {
      async deleteWebhookMessage(webhookId, token, messageId) {
        assert.equal(webhookId, WEBHOOK_ID)
        assert.equal(token, credential)
        assert.equal(messageId, MESSAGE_ID)
        deleteCalls += 1
        deleted = true
      },
      async executeWebhookMessage(webhookId, token, input) {
        assert.equal(webhookId, WEBHOOK_ID)
        assert.equal(token, credential)
        deliveryCalls += 1
        content = input.content
        mentionedUserIds = "users" in input.allowedMentions
          ? input.allowedMentions.users
          : []
        deleted = false
        return webhookMessage()
      },
      async getWebhookMessage(webhookId, token, messageId) {
        assert.equal(webhookId, WEBHOOK_ID)
        assert.equal(token, credential)
        assert.equal(messageId, MESSAGE_ID)
        messageReads += 1
        if (deleted) {
          throw new DiscordApiError({
            message: "Discord webhook message not found",
            method: "GET",
            route: "/webhooks/:webhookId/:token/messages/:messageId",
            status: 404,
          })
        }
        return webhookMessage()
      },
      async getWebhookWithToken(webhookId, token) {
        assert.equal(webhookId, WEBHOOK_ID)
        assert.equal(token, credential)
        webhookReads += 1
        return {
          applicationId: APPLICATION_ID,
          channelId: CHANNEL_ID,
          creatorUserId: MEMBER_USER_ID,
          guildId: GUILD_ID,
          id: WEBHOOK_ID,
          name: "private-webhook-name",
          sourceChannelId: null,
          sourceGuildId: null,
          type: 1,
        }
      },
      async modifyWebhookMessage(webhookId, token, messageId, input) {
        assert.equal(webhookId, WEBHOOK_ID)
        assert.equal(token, credential)
        assert.equal(messageId, MESSAGE_ID)
        editCalls += 1
        content = input.content
        mentionedUserIds = "users" in input.allowedMentions
          ? input.allowedMentions.users
          : []
        return webhookMessage()
      },
    },
    configOverrides: {
      capabilities: {
        webhookMessageAudit: true,
        webhookMessageChanges: true,
        webhookMessageDeletions: true,
        webhookMessageDelivery: true,
      },
      limits: {
        interactionMinWriteIntervalMs: 0,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        mentionUserIds: [MEMBER_USER_ID],
        webhookMessageChannelIds: [CHANNEL_ID],
      },
      storage: {
        webhookCredentialRoot: credentialRoot,
      },
    },
    operationStore,
    webhookMessageOptions: {
      clock: () => new Date("2026-08-23T00:00:00.000Z"),
      intentKey: new Uint8Array(32).fill(23),
      planKey: new Uint8Array(32).fill(24),
      randomId: (() => {
        let index = 0
        return () => `activity-webhook-message-${++index}`
      })(),
    },
  })

  const lookup = await service.getWebhookMessage({
    messageId: MESSAGE_ID,
    webhookId: WEBHOOK_ID,
  })
  const sent = await service.sendWebhookMessage({
    content: `Delivered webhook notice for <@${MEMBER_USER_ID}>`,
    notifyUserIds: [MEMBER_USER_ID],
    operationKey: "webhook-message-send-service-0001",
    webhookId: WEBHOOK_ID,
  })
  const edited = await service.editWebhookMessage({
    content: "Edited webhook notice",
    messageId: MESSAGE_ID,
    operationKey: "webhook-message-edit-service-0001",
    webhookId: WEBHOOK_ID,
  })
  const deletionRequest = {
    messageId: MESSAGE_ID,
    operationKey: "webhook-message-delete-service-0001",
    reviewReason: "Remove the superseded webhook notice",
    webhookId: WEBHOOK_ID,
  }
  const plan = await service.planWebhookMessageDeletion(deletionRequest)
  const result = await service.executeWebhookMessageDeletion(
    deletionRequest,
    plan.digest,
  )

  assert.equal(lookup.message.content, "Initial webhook notice")
  assert.equal(sent.status, "completed")
  assert.equal(edited.status, "completed")
  assert.equal(plan.target.content, "Edited webhook notice")
  assert.equal(plan.reviewReason, deletionRequest.reviewReason)
  assert.equal(result.status, "completed")
  assert.equal(result.readbackMatched, true)
  assert.equal(deliveryCalls, 1)
  assert.equal(editCalls, 1)
  assert.equal(deleteCalls, 1)
  assert.equal(messageReads, 7)
  assert.equal(webhookReads, 7)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 6)
  const durableRecords = JSON.stringify({
    activity: calls.activityEntries,
    receipts: [...operationStore.receipts.values()],
  })
  assert.doesNotMatch(durableRecords, /Initial webhook notice/)
  assert.doesNotMatch(durableRecords, /Delivered webhook notice/)
  assert.doesNotMatch(durableRecords, /Edited webhook notice/)
  assert.doesNotMatch(durableRecords, /Remove the superseded webhook notice/)
  assert.doesNotMatch(durableRecords, new RegExp(credential.replace(/[.]/g, "\\.")))
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
    configOverrides: {
      capabilities: {
        integrationAudit: true,
        integrationDeletions: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        integrationGuildIds: [GUILD_ID],
        integrationIds: [INTEGRATION_ID],
      },
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
          roleIds: [],
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
    configOverrides: {
      capabilities: {
        inviteAudit: true,
        inviteDeletions: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        inviteGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        guildTemplateAudit: true,
        guildTemplateChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildTemplateGuildIds: [GUILD_ID],
      },
    },
    gateway: completeChannelGateway(),
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
    configOverrides: {
      capabilities: {
        onboardingAudit: true,
        onboardingChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        onboardingGuildIds: [GUILD_ID],
      },
    },
    gateway: completeChannelGateway(),
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
    configOverrides: {
      capabilities: {
        welcomeScreenAudit: true,
        welcomeScreenChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        welcomeScreenGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        widgetSettingsAudit: true,
        widgetSettingsChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        widgetSettingsGuildIds: [GUILD_ID],
      },
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

test("service pins identity through reviewed guild settings", async () => {
  const operationStore = new MemoryOperationStore()
  let guildSettingsReads = 0
  let guildSettingsWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        guildSettingsReads += 1
        return {
          afk_channel_id: null,
          afk_timeout: 300,
          default_message_notifications: 1,
          explicit_content_filter: 2,
          features: [],
          id: GUILD_ID,
          name: "Private Guild",
          owner_id: "700000000000000001",
          premium_progress_bar_enabled: false,
          system_channel_flags: 0,
          system_channel_id: CHANNEL_ID,
          verification_level: 3,
        }
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildChannels() {
        return [channel({ parent_id: null })]
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD,
          "@everyone",
        )]
      },
      async modifyGuildSettings() {
        guildSettingsWrites += 1
        throw new Error("Unexpected guild-settings change")
      },
    },
    configOverrides: {
      capabilities: {
        guildSettingsAudit: true,
        guildSettingsChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildSettingsGuildIds: [GUILD_ID],
      },
    },
    gateway: completeChannelGateway([channel({ parent_id: null })]),
    guildSettingsOptions: {
      clock: () => new Date("2026-08-23T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(53),
      randomId: () => "activity-guild-settings",
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed guild defaults",
    defaultMessageNotifications: "only-mentions" as const,
    explicitContentFilter: "all-members" as const,
    guildId: GUILD_ID,
    operationKey: "guild-settings-service-attempt-0001",
    verificationLevel: "high" as const,
  }

  await assert.rejects(
    () => service.getGuildSettings("bad"),
    /guild-settings guild ID/,
  )
  await assert.rejects(
    () => service.planGuildSettingsChange({ ...request, guildId: "bad" }),
    /guild-settings guild ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildSettings(GUILD_ID)
  const plan = await service.planGuildSettingsChange(request)
  const result = await service.executeGuildSettingsChange(request, plan.digest)

  assert.equal(audit.privacy.guildPresentation, "omitted")
  assert.equal(audit.configuration.verificationLevel, "high")
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(guildSettingsReads, 3)
  assert.equal(guildSettingsWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through reviewed guild Community state", async () => {
  const operationStore = new MemoryOperationStore()
  let communityReads = 0
  let communityWrites = 0
  const rulesChannel = channel({
    id: CHANNEL_ID,
    parent_id: null,
    permission_overwrites: [],
  })
  const updatesChannel = channel({
    id: OTHER_CHANNEL_ID,
    parent_id: null,
    permission_overwrites: [],
  })
  const communityGuild = {
    features: ["COMMUNITY", "NEWS"],
    id: GUILD_ID,
    name: "Private Community Guild",
    owner_id: "700000000000000001",
    public_updates_channel_id: OTHER_CHANNEL_ID,
    rules_channel_id: CHANNEL_ID,
    safety_alerts_channel_id: null,
  }
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        communityReads += 1
        return communityGuild
      },
      async getGuildMember() {
        return { pending: false, roles: [], user: bot() }
      },
      async getGuildChannels() {
        return [rulesChannel, updatesChannel]
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD
            | DISCORD_PERMISSIONS.SEND_MESSAGES
            | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
      async modifyGuildCommunity() {
        communityWrites += 1
        throw new Error("Unexpected guild Community change")
      },
    },
    configOverrides: {
      capabilities: {
        guildCommunityAudit: true,
        guildCommunityChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildCommunityGuildIds: [GUILD_ID],
      },
    },
    gateway: completeChannelGateway([rulesChannel, updatesChannel]),
    guildCommunityOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(59),
      randomId: () => "activity-guild-community",
    },
    operationStore,
  })
  const request = {
    acknowledgeCommunityEnablement: true as const,
    auditReason: "Reviewed Community routing",
    guildId: GUILD_ID,
    operationKey: "guild-community-service-attempt-0001",
    publicUpdatesChannelId: OTHER_CHANNEL_ID,
    rulesChannelId: CHANNEL_ID,
    safetyAlertsChannelId: null,
  }

  await assert.rejects(
    () => service.getGuildCommunity("bad"),
    /guild Community guild ID/u,
  )
  await assert.rejects(
    () => service.planGuildCommunityChange({ ...request, guildId: "bad" }),
    /guild Community guild ID/u,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildCommunity(GUILD_ID)
  const plan = await service.planGuildCommunityChange(request)
  const result = await service.executeGuildCommunityChange(request, plan.digest)

  assert.equal(audit.configuration.communityEnabled, true)
  assert.equal(audit.configuration.featureCount, 2)
  assert.match(audit.configuration.featureDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.equal("features" in audit.configuration, false)
  assert.equal(audit.privacy.featureValues, "digests-only")
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(plan.requiredPermission, "MANAGE_GUILD")
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(communityReads, 3)
  assert.equal(communityWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through reviewed guild incident actions", async () => {
  const operationStore = new MemoryOperationStore()
  let incidentReads = 0
  let incidentWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildIncidentActions(guildId) {
        assert.equal(guildId, GUILD_ID)
        incidentReads += 1
        return {
          directMessagesDisabledUntil: null,
          dmSpamDetected: false,
          guildId,
          invitesDisabledUntil: null,
          ownerId: "700000000000000001",
          raidDetected: false,
          sourceAvailable: true,
          unknownFieldCount: 0,
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
      async modifyGuildIncidentActions() {
        incidentWrites += 1
        throw new Error("Unexpected guild incident-action change")
      },
    },
    configOverrides: {
      capabilities: {
        guildIncidentAudit: true,
        guildIncidentChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildIncidentGuildIds: [GUILD_ID],
      },
    },
    guildIncidentOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(61),
      randomId: () => "activity-guild-incident",
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed incident state",
    directMessagesDisabledUntil: null,
    guildId: GUILD_ID,
    invitesDisabledUntil: null,
    operationKey: "guild-incident-service-attempt-0001",
  }

  await assert.rejects(
    () => service.getGuildIncidentActions("bad"),
    /guild incident-action guild ID/,
  )
  await assert.rejects(
    () => service.planGuildIncidentActionChange({ ...request, guildId: "bad" }),
    /guild incident-action guild ID/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildIncidentActions(GUILD_ID)
  const plan = await service.planGuildIncidentActionChange(request)
  const result = await service.executeGuildIncidentActionChange(
    request,
    plan.digest,
  )

  assert.equal(audit.privacy.detectionTimestamps, "boolean-presence-only")
  assert.equal(audit.actions.sourceAvailable, true)
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(incidentReads, 3)
  assert.equal(incidentWrites, 0)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service pins identity through transient reviewed guild profile text", async () => {
  const operationStore = new MemoryOperationStore()
  let guildProfileReads = 0
  let guildProfileWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildProfile(guildId) {
        assert.equal(guildId, GUILD_ID)
        guildProfileReads += 1
        return {
          description: "Private profile description",
          id: GUILD_ID,
          mediaPresence: {
            banner: false,
            discoverySplash: true,
            icon: true,
            inviteSplash: false,
          },
          name: "Private Guild Profile",
          ownerId: "700000000000000003",
        }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD,
          "@everyone",
        )]
      },
      async modifyGuildProfile() {
        guildProfileWrites += 1
        throw new Error("Unexpected guild profile change")
      },
    },
    configOverrides: {
      capabilities: {
        guildProfileAudit: true,
        guildProfileChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildProfileGuildIds: [GUILD_ID],
      },
    },
    guildProfileOptions: {
      clock: () => new Date("2026-08-23T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(59),
      randomId: () => "activity-guild-profile",
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed guild presentation",
    description: "Private profile description",
    guildId: GUILD_ID,
    name: "Private Guild Profile",
    operationKey: "guild-profile-service-attempt-0001",
  }

  await assert.rejects(
    () => service.getGuildProfile("bad"),
    /guild profile guild ID/,
  )
  await assert.rejects(
    () => service.planGuildProfileChange({ ...request, name: "x" }),
    /guild name/,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)

  const audit = await service.getGuildProfile(GUILD_ID)
  const plan = await service.planGuildProfileChange(request)
  const result = await service.executeGuildProfileChange(request, plan.digest)

  assert.equal(audit.privacy.profileText, "transient-untrusted")
  assert.equal(audit.privacy.mediaHashes, "presence-only")
  assert.equal(audit.profile.name, "Private Guild Profile")
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(guildProfileReads, 3)
  assert.equal(guildProfileWrites, 0)
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
          bitrate: null,
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
          rtcRegion: null,
          topic: "Private guild topic",
          type: 0,
          unknownFieldCount: 0,
          userLimit: null,
          videoQualityMode: null,
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
    configOverrides: {
      capabilities: {
        channelMetadataChanges: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelMetadataIds: [CHANNEL_ID],
      },
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

test("service reads and executes record-free voice channel status no-ops", async () => {
  const privateStatus = "Private incident room"
  const operationStore = new MemoryOperationStore()
  let gatewayReads = 0
  let statusWrites = 0
  let coordinationRuns = 0
  const layout = completeChannelGateway([channel({
    name: "Private voice channel",
    type: DISCORD_CHANNEL_TYPES.voice,
  })])
  const gateway = Object.assign(layout, {
    voiceChannelStatusEnabled: true,
    async getVoiceChannelStatus(): Promise<GatewayVoiceChannelStatusSnapshot> {
      gatewayReads += 1
      return {
        channelId: CHANNEL_ID,
        evidence: {
          discardedChannelEntries: 0,
          responseUnknownFieldCount: 0,
          returnedChannelEntries: 1,
          statusRepresentation: "value",
          targetUnknownFieldCount: 0,
        },
        freshness: {
          gatewaySequence: gatewayReads,
          observedAt: "2026-08-24T12:00:01.000Z",
          requestedAt: "2026-08-24T12:00:00.000Z",
          source: "gateway-request-channel-info",
        },
        guildId: GUILD_ID,
        privacy: {
          nonTargetStatusText: "discarded-before-projection",
          persistence: "none",
          rawPayloads: "omitted",
          text: "transient-untrusted",
        },
        schemaVersion: 1,
        status: privateStatus,
      }
    },
    async waitForVoiceChannelStatusUpdate(): Promise<GatewayVoiceChannelStatusUpdate> {
      throw new Error("Unexpected voice status settlement subscription")
    },
  })
  const voiceMetadata: DiscordChannelMetadata = {
    bitrate: 96_000,
    defaultAutoArchiveDuration: null,
    defaultThreadRateLimitPerUser: null,
    guildId: GUILD_ID,
    id: CHANNEL_ID,
    name: "Private voice channel",
    nsfw: false,
    parentId: null,
    permissionOverwrites: [],
    position: 1,
    rateLimitPerUser: 0,
    rtcRegion: null,
    topic: null,
    type: DISCORD_CHANNEL_TYPES.voice,
    unknownFieldCount: 0,
    userLimit: 0,
    videoQualityMode: 1,
  }
  const writeCoordinator: WriteCoordinator = {
    run() {
      coordinationRuns += 1
      throw new Error("Unexpected write coordination for a no-op")
    },
  }
  const { calls, service } = serviceFixture({
    client: {
      async getCurrentUserVoiceState() {
        return {
          channelId: CHANNEL_ID,
          deaf: false,
          guildId: GUILD_ID,
          mute: false,
          unknownFieldCount: 0,
          userId: BOT_ID,
        }
      },
      async getGuildChannelMetadata() {
        return voiceMetadata
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.SET_VOICE_CHANNEL_STATUS,
          "@everyone",
        )]
      },
      async setVoiceChannelStatus() {
        statusWrites += 1
      },
    },
    configOverrides: {
      capabilities: {
        channelMetadataChanges: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelMetadataIds: [CHANNEL_ID],
      },
    },
    gateway,
    operationStore,
    voiceChannelStatusOptions: {
      clock: () => new Date("2026-08-24T12:00:00.000Z"),
      planKey: new Uint8Array(32).fill(61),
      randomId: () => "activity-voice-status",
    },
    writeCoordinator,
  })
  const change = {
    auditReason: "Reviewed private status",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: "voice-status-service-noop-0001",
    status: privateStatus,
  }

  const read = await service.getVoiceChannelStatus(GUILD_ID, CHANNEL_ID)
  const plan = await service.planVoiceChannelStatusChange(change)
  const result = await service.executeVoiceChannelStatusChange(change, plan.digest)

  assert.equal(read.current.status, privateStatus)
  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(statusWrites, 0)
  assert.equal(coordinationRuns, 0)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service coordinates exact voice channel status writes before final execution", async () => {
  const oldStatus = "Private old voice status"
  const desiredStatus = "Private desired voice status"
  const auditReason = "Reviewed private voice status"
  const operationStore = new MemoryOperationStore()
  let currentStatus = oldStatus
  let gatewaySequence = 1
  let waiter: ((update: GatewayVoiceChannelStatusUpdate) => void) | undefined
  let statusWrites = 0
  const intents: WriteCoordinationIntent[] = []
  const layout = completeChannelGateway([channel({
    name: "Private voice channel",
    type: DISCORD_CHANNEL_TYPES.voice,
  })])
  const gateway = Object.assign(layout, {
    voiceChannelStatusEnabled: true,
    async getVoiceChannelStatus(): Promise<GatewayVoiceChannelStatusSnapshot> {
      return {
        channelId: CHANNEL_ID,
        evidence: {
          discardedChannelEntries: 0,
          responseUnknownFieldCount: 0,
          returnedChannelEntries: 1,
          statusRepresentation: currentStatus === null ? "null" : "value",
          targetUnknownFieldCount: 0,
        },
        freshness: {
          gatewaySequence: gatewaySequence++,
          observedAt: "2026-08-24T12:00:01.000Z",
          requestedAt: "2026-08-24T12:00:00.000Z",
          source: "gateway-request-channel-info",
        },
        guildId: GUILD_ID,
        privacy: {
          nonTargetStatusText: "discarded-before-projection",
          persistence: "none",
          rawPayloads: "omitted",
          text: "transient-untrusted",
        },
        schemaVersion: 1,
        status: currentStatus,
      }
    },
    waitForVoiceChannelStatusUpdate(): Promise<GatewayVoiceChannelStatusUpdate> {
      return new Promise((resolve) => {
        waiter = resolve
      })
    },
  })
  const voiceMetadata: DiscordChannelMetadata = {
    bitrate: 96_000,
    defaultAutoArchiveDuration: null,
    defaultThreadRateLimitPerUser: null,
    guildId: GUILD_ID,
    id: CHANNEL_ID,
    name: "Private voice channel",
    nsfw: false,
    parentId: null,
    permissionOverwrites: [],
    position: 1,
    rateLimitPerUser: 0,
    rtcRegion: null,
    topic: null,
    type: DISCORD_CHANNEL_TYPES.voice,
    unknownFieldCount: 0,
    userLimit: 0,
    videoQualityMode: 1,
  }
  const writeCoordinator: WriteCoordinator = {
    run(intent, operation) {
      intents.push(intent)
      return operation()
    },
  }
  const { calls, service } = serviceFixture({
    client: {
      async getCurrentUserVoiceState() {
        return {
          channelId: CHANNEL_ID,
          deaf: false,
          guildId: GUILD_ID,
          mute: false,
          unknownFieldCount: 0,
          userId: BOT_ID,
        }
      },
      async getGuildChannelMetadata() {
        return voiceMetadata
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.SET_VOICE_CHANNEL_STATUS,
          "@everyone",
        )]
      },
      async setVoiceChannelStatus(channelId, status, reason) {
        statusWrites += 1
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(status, desiredStatus)
        assert.equal(reason, auditReason)
        currentStatus = status
        waiter?.({
          channelId: CHANNEL_ID,
          freshness: {
            gatewaySequence: gatewaySequence++,
            observedAt: "2026-08-24T12:00:02.000Z",
            source: "gateway-voice-channel-status-update",
          },
          guildId: GUILD_ID,
          status,
          unknownFieldCount: 0,
        })
      },
    },
    configOverrides: {
      capabilities: {
        channelMetadataChanges: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelMetadataIds: [CHANNEL_ID],
      },
    },
    gateway,
    operationStore,
    voiceChannelStatusOptions: {
      clock: () => new Date("2026-08-24T12:00:00.000Z"),
      planKey: new Uint8Array(32).fill(62),
      randomId: () => "activity-voice-status",
    },
    writeCoordinator,
  })
  const change = {
    auditReason,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: "voice-status-service-write-0001",
    status: desiredStatus,
  }

  const plan = await service.planVoiceChannelStatusChange(change)
  const result = await service.executeVoiceChannelStatusChange(change, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(statusWrites, 1)
  assert.equal(intents.length, 1)
  assert.equal(intents[0]?.kind, "voice-channel-status-change")
  assert.deepEqual(intents[0]?.targets, [
    { id: CHANNEL_ID, kind: "channel" },
    { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
  ])
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "voice-channel-status-change")
  const durable = JSON.stringify({
    activity: calls.activityEntries,
    receipt: operationStore.receipt,
  })
  for (const privateText of [oldStatus, desiredStatus, auditReason]) {
    assert.equal(durable.includes(privateText), false)
  }
})

test("service pins identity through global and guild voice-region inventories", async () => {
  let globalCalls = 0
  let guildCalls = 0
  const regions: DiscordVoiceRegion[] = [{
    custom: false,
    deprecated: false,
    id: "us-central",
    name: "US Central",
    optimal: true,
    unknownFieldCount: 1,
  }]
  const { calls, service } = serviceFixture({
    client: {
      async listGuildVoiceRegions(guildId) {
        guildCalls += 1
        assert.equal(guildId, GUILD_ID)
        return structuredClone(regions)
      },
      async listVoiceRegions() {
        globalCalls += 1
        return structuredClone(regions)
      },
    },
    configOverrides: {
      readScope: {
        guildIds: [GUILD_ID],
      },
    },
  })

  const global = await service.listVoiceRegions()
  const guild = await service.listGuildVoiceRegions(GUILD_ID)

  assert.deepEqual(global.scope, { guildId: null, kind: "global" })
  assert.deepEqual(guild.scope, { guildId: GUILD_ID, kind: "guild" })
  assert.deepEqual(global.regions, regions)
  assert.deepEqual(guild.regions, regions)
  assert.equal(globalCalls, 1)
  assert.equal(guildCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)

  let deniedCalls = 0
  const denied = serviceFixture({
    client: {
      async listGuildVoiceRegions() {
        deniedCalls += 1
        return []
      },
    },
    configOverrides: {
      readScope: {
        guildIds: [GUILD_ID],
      },
    },
  })
  await assert.rejects(
    () => denied.service.listGuildVoiceRegions(OTHER_GUILD_ID),
    PolicyError,
  )
  assert.equal(deniedCalls, 0)
  assert.equal(denied.calls.application, 1)
  assert.equal(denied.calls.user, 1)
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
    configOverrides: {
      capabilities: {
        guildExpressionAudit: true,
        guildExpressionChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildExpressionGuildIds: [GUILD_ID],
      },
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

test("service pins application emoji scope to verified identity and coordinates reviewed changes", async () => {
  const emojiId = "915000000000000001"
  const operationStore = new MemoryApplicationOperationStore()
  let inventory: DiscordApplicationEmojiSummary[] = [{
    animated: false,
    available: true,
    id: emojiId,
    managed: false,
    name: "wave",
    requiresColons: true,
    unknownFieldCount: 0,
    uploaderProjectedOut: true,
  }]
  let getCalls = 0
  let inventoryCalls = 0
  let renameCalls = 0
  const { calls, service } = serviceFixture({
    applicationEmojiOptions: {
      clock: () => new Date("2026-08-23T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(31),
      randomId: () => "activity-application-emoji-change",
    },
    client: {
      async getApplicationEmoji(applicationId, requestedEmojiId) {
        assert.equal(applicationId, APPLICATION_ID)
        getCalls += 1
        const found = inventory.find((entry) => entry.id === requestedEmojiId)
        if (!found) throw new Error("Unexpected missing application emoji")
        return found
      },
      async listApplicationEmojis(applicationId) {
        assert.equal(applicationId, APPLICATION_ID)
        inventoryCalls += 1
        return { items: inventory, unknownFieldCount: 0 }
      },
      async modifyApplicationEmoji(applicationId, requestedEmojiId, input) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.equal(requestedEmojiId, emojiId)
        renameCalls += 1
        inventory = inventory.map((entry) => entry.id === requestedEmojiId
          ? { ...entry, name: input.name }
          : entry)
        return inventory[0]!
      },
    },
    configOverrides: {
      capabilities: {
        applicationEmojiAudit: true,
        applicationEmojiChanges: true,
      },
    },
    operationStore,
  })
  const request = {
    action: "rename" as const,
    emojiId,
    name: "hello",
    operationKey: "application-emoji-service-attempt-0001",
  }

  const listed = await service.listApplicationEmojis()
  const exact = await service.getApplicationEmoji(emojiId)
  const plan = await service.planApplicationEmojiChange(request)
  const result = await service.executeApplicationEmojiChange(request, plan.digest)

  assert.equal(listed.applicationId, APPLICATION_ID)
  assert.equal(exact.emoji.emojiId, emojiId)
  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "hello")
  assert.equal(inventoryCalls, 3)
  assert.equal(getCalls, 2)
  assert.equal(renameCalls, 1)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.applicationReceipt?.kind, "application-emoji-change")
  assert.equal(operationStore.applicationReceipt?.applicationId, APPLICATION_ID)
  assert.equal(operationStore.applicationReceipt?.resourceId, emojiId)
})

test("service refreshes exact SKU and entitlement evidence and coordinates consumption application-wide", async () => {
  const operationStore = new MemoryApplicationOperationStore()
  const coordinationIntents: WriteCoordinationIntent[] = []
  let consumed = false
  let consumeCalls = 0
  let entitlementReads = 0
  let skuReads = 0
  let skuReadsWhenClaimed = -1
  const writeCoordinator: WriteCoordinator = {
    run(intent, operation) {
      coordinationIntents.push(intent)
      skuReadsWhenClaimed = skuReads
      return operation()
    },
  }
  const { calls, service } = serviceFixture({
    applicationEntitlementOptions: {
      clock: () => new Date("2026-08-27T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(61),
      randomId: () => "activity-application-entitlement-consume",
    },
    client: {
      async consumeApplicationEntitlement(applicationId, entitlementId) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.equal(entitlementId, APPLICATION_ENTITLEMENT_ID)
        consumeCalls += 1
        consumed = true
      },
      async getApplicationEntitlement(applicationId, entitlementId) {
        assert.equal(applicationId, APPLICATION_ID)
        assert.equal(entitlementId, APPLICATION_ENTITLEMENT_ID)
        entitlementReads += 1
        return {
          application_id: APPLICATION_ID,
          consumed,
          deleted: false,
          ends_at: null,
          guild_id: null,
          id: APPLICATION_ENTITLEMENT_ID,
          sku_id: APPLICATION_SKU_ID,
          starts_at: null,
          type: 1,
          user_id: MEMBER_USER_ID,
        }
      },
      async listApplicationSkus(applicationId) {
        assert.equal(applicationId, APPLICATION_ID)
        skuReads += 1
        return [{
          application_id: APPLICATION_ID,
          flags: 1 << 2,
          id: APPLICATION_SKU_ID,
          name: "Private fulfilled consumable",
          slug: "private-fulfilled-consumable",
          type: 3,
        }]
      },
    },
    configOverrides: {
      capabilities: {
        applicationEntitlementConsumption: true,
      },
      scopes: {
        applicationConsumableEntitlementSkuIds: [APPLICATION_SKU_ID],
        applicationConsumableEntitlementUserIds: [MEMBER_USER_ID],
        applicationMonetizationSkuIds: [APPLICATION_SKU_ID],
      },
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    acknowledgeExternalFulfillment: true as const,
    auditReason: "Private reviewed fulfillment reason",
    entitlementId: APPLICATION_ENTITLEMENT_ID,
    fulfillmentReference: "private-fulfilled-order-0001",
    operationKey: "application-entitlement-consume-service-0001",
    skuId: APPLICATION_SKU_ID,
    userId: MEMBER_USER_ID,
  }

  const plan = await service.planApplicationEntitlementConsumption(request)
  const result = await service.executeApplicationEntitlementConsumption(
    request,
    plan.digest,
  )

  assert.equal(plan.status, "planned")
  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.current.consumed, false)
  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(consumeCalls, 1)
  assert.equal(skuReads, 2)
  assert.equal(skuReadsWhenClaimed, 1)
  assert.equal(entitlementReads, 3)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(coordinationIntents, [{
    kind: "application-entitlement-change",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [{
      applicationId: APPLICATION_ID,
      collection: "entitlements",
      kind: "application-collection",
    }],
  }])
  assert.equal(calls.activityEntries.length, 2)
  assert.doesNotMatch(
    JSON.stringify(calls.activityEntries),
    /Private|private-fulfilled|consumable|service-0001/u,
  )
  assert.equal(
    operationStore.applicationReceipt?.kind,
    "application-entitlement-change",
  )
  assert.equal(operationStore.applicationReceipt?.resourceId, APPLICATION_ENTITLEMENT_ID)
})

test("service coordinates reviewed complete linked-role metadata replacement", async () => {
  const operationStore = new MemoryApplicationOperationStore()
  const coordinationIntents: WriteCoordinationIntent[] = []
  const writeCoordinator: WriteCoordinator = {
    run(intent, operation) {
      coordinationIntents.push(intent)
      return operation()
    },
  }
  let metadata: DiscordApplicationRoleConnectionMetadata[] = [{
    description: "Private current trust description",
    description_localizations: null,
    key: "trust_level",
    name: "Private current trust name",
    name_localizations: null,
    type: 2,
  }]
  let inventoryCalls = 0
  let replacementCalls = 0
  const { calls, service } = serviceFixture({
    application: {
      ...application(),
      role_connections_verification_url:
        "https://private.example.test/linked-role-verification",
    },
    applicationRoleConnectionMetadataOptions: {
      clock: () => new Date("2026-08-25T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(51),
      randomId: () => "activity-application-role-connection-metadata",
    },
    client: {
      async listApplicationRoleConnectionMetadata(applicationId) {
        assert.equal(applicationId, APPLICATION_ID)
        inventoryCalls += 1
        return structuredClone(metadata)
      },
      async replaceApplicationRoleConnectionMetadata(applicationId, input) {
        assert.equal(applicationId, APPLICATION_ID)
        replacementCalls += 1
        metadata = input.map((record) => structuredClone(record))
        return structuredClone(metadata)
      },
    },
    configOverrides: {
      capabilities: {
        applicationRoleConnectionMetadataChanges: true,
      },
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    acknowledgeGlobalReplacement: true as const,
    action: "replace" as const,
    operationKey: "linked-role-metadata-service-attempt-0001",
    records: [{
      description: "Private desired trust description",
      descriptionLocalizations: [{
        locale: "de" as const,
        value: "Private lokalisierte Beschreibung",
      }],
      key: "trust_level",
      name: "Private desired trust name",
      nameLocalizations: [{
        locale: "de" as const,
        value: "Private Vertrauensstufe",
      }],
      type: "integer-greater-than-or-equal" as const,
    }],
  }

  const plan = await service.planApplicationRoleConnectionMetadataChange(request)
  const result = await service.executeApplicationRoleConnectionMetadataChange(
    request,
    plan.digest,
  )

  assert.equal(plan.status, "planned")
  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.verificationEndpointConfigured, true)
  assert.deepEqual(plan.diff, {
    added: 0,
    changed: 1,
    removed: 0,
    reordered: false,
    unchanged: 0,
  })
  assert.equal(result.status, "completed")
  assert.deepEqual(result.observed, request.records)
  assert.equal(replacementCalls, 1)
  assert.equal(inventoryCalls, 3)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(coordinationIntents, [{
    kind: "application-role-connection-metadata-change",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [{
      applicationId: APPLICATION_ID,
      collection: "role-connection-metadata",
      kind: "application-collection",
    }],
  }])
  assert.equal(calls.activityEntries.length, 2)
  assert.doesNotMatch(
    JSON.stringify(calls.activityEntries),
    /Private|trust_level|lokalisierte|Vertrauensstufe/,
  )
  assert.equal(
    operationStore.applicationReceipt?.kind,
    "application-role-connection-metadata-change",
  )
  assert.equal(operationStore.applicationReceipt?.resourceId, APPLICATION_ID)
})

test("service coordinates reviewed application intents and invalidates changed identity evidence", async () => {
  const operationStore = new MemoryApplicationOperationStore()
  const coordinationIntents: WriteCoordinationIntent[] = []
  const writeCoordinator: WriteCoordinator = {
    run(intent, operation) {
      coordinationIntents.push(intent)
      return operation()
    },
  }
  const unknownFlag = 1n << 40n
  let currentFlags = unknownFlag
    | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited
  let identityReads = 0
  let mutationCalls = 0
  let outgoingFlags: number | null = null
  const currentApplication = (): DiscordApplication => ({
    ...application(),
    description: "private application text",
    flags_new: currentFlags.toString(10),
    name: "private application name",
  })
  const { calls, service } = serviceFixture({
    applicationIntentOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(41),
      randomId: () => "activity-application-intent",
    },
    client: {
      async getCurrentApplication() {
        identityReads += 1
        return currentApplication()
      },
      async modifyCurrentApplicationFlags(input) {
        mutationCalls += 1
        outgoingFlags = input.flags
        currentFlags |= BigInt(input.flags)
        return currentApplication()
      },
    },
    configOverrides: {
      capabilities: {
        applicationIntentChanges: true,
        memberDirectory: true,
      },
      scopes: {
        memberDirectoryGuildIds: [GUILD_ID],
      },
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    acknowledgePrivilegeExpansion: true as const,
    intent: "guild-members" as const,
    operationKey: "application-intent-service-attempt-0001",
    reviewReason: "Enable the schema-v2 member directory",
  }

  const plan = await service.planApplicationIntentEnablement(request)
  const result = await service.executeApplicationIntentEnablement(
    request,
    plan.digest,
  )
  const status = await service.getStatus()

  assert.equal(plan.status, "planned")
  assert.equal(plan.policyRequirement, "required")
  assert.equal(result.status, "completed")
  assert.equal(result.observed.enabled, true)
  assert.equal(result.observed.limitedToggle, true)
  assert.equal(status.application.id, APPLICATION_ID)
  assert.equal(mutationCalls, 1)
  assert.equal(
    outgoingFlags,
    Number(
      DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited
      | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited,
    ),
  )
  assert.equal(identityReads, 5)
  assert.equal(calls.user, 2)
  assert.deepEqual(coordinationIntents, [{
    kind: "application-intent-enablement",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [{
      applicationId: APPLICATION_ID,
      collection: "privileged-intents",
      kind: "application-collection",
    }],
  }])
  assert.equal(calls.activityEntries.length, 2)
  assert.doesNotMatch(
    JSON.stringify(calls.activityEntries),
    /private application|Enable the schema-v2|1099511627776/,
  )
  assert.equal(
    operationStore.applicationReceipt?.kind,
    "application-intent-enablement",
  )
  assert.equal(operationStore.applicationReceipt?.resourceId, APPLICATION_ID)
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
    configOverrides: {
      capabilities: {
        automodAudit: true,
        automodChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        automodGuildIds: [GUILD_ID],
      },
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
  const verification = await service.verifyAutoModerationChange(request)

  assert.equal(listed.rules.length, 1)
  assert.equal(JSON.stringify(listed).includes("private blocked phrase"), false)
  assert.equal(JSON.stringify(exact).includes("private blocked phrase"), true)
  assert.equal(plan.existing?.ruleId, AUTOMOD_RULE_ID)
  assert.deepEqual(plan.permission.requiredPermissions, ["MANAGE_GUILD"])
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "Updated keyword policy")
  assert.equal(verification.status, "verified")
  assert.equal(verification.ruleId, AUTOMOD_RULE_ID)
  assert.equal(inventoryReads, 1)
  assert.equal(exactReads, 5)
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
  let userReads = 0
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
      async listGuildScheduledEventUsers(guildId, eventId, options) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(eventId, SCHEDULED_EVENT_ID)
        assert.equal(options?.limit, 25)
        userReads += 1
        return [{ bot: false, eventId, userId: MEMBER_USER_ID }]
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
    configOverrides: {
      capabilities: {
        scheduledEventAudit: true,
        scheduledEventChanges: true,
        scheduledEventUserAudit: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        scheduledEventGuildIds: [GUILD_ID],
      },
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
  const users = await service.listScheduledEventUsers(GUILD_ID, SCHEDULED_EVENT_ID)
  const plan = await service.planScheduledEventChange(request)
  const result = await service.executeScheduledEventChange(request, plan.digest)

  assert.equal(listed.events[0]?.event.subscriberCount, 4)
  assert.equal(exact.event.subscriberCount, null)
  assert.deepEqual(users.users, [{ bot: false, id: MEMBER_USER_ID }])
  assert.equal(plan.existing?.eventId, SCHEDULED_EVENT_ID)
  assert.deepEqual(plan.permission.current.requiredPermissions, [
    "MANAGE_EVENTS",
    "VIEW_CHANNEL",
    "CONNECT",
  ])
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "Release planning call")
  assert.equal(inventoryReads, 1)
  assert.equal(exactReads, 5)
  assert.equal(userReads, 1)
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
    configOverrides: {
      capabilities: {
        soundboardAudit: true,
        soundboardChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        soundboardGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        stageInstanceAudit: true,
        stageInstanceChanges: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        stageChannelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      capabilities: {
        permissionOverwrites: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        permissionOverwriteChannelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      capabilities: {
        attachments: true,
        interactions: true,
      },
      limits: {
        attachmentMaxBytes: 1024,
        interactionMinWriteIntervalMs: 1000,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        attachmentChannelIds: [CHANNEL_ID],
        interactionChannelIds: [CHANNEL_ID],
      },
      storage: {
        attachmentRoots: [root],
      },
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
  const configOverrides = {
    capabilities: {
      interactions: true,
    },
    limits: {
      interactionMaxWritesPerMinute: 1,
      interactionMinWriteIntervalMs: 0,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      interactionChannelIds: [CHANNEL_ID],
    },
  }
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
    configOverrides,
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

  const restarted = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(
          GUILD_ID,
          DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          "@everyone",
        )]
      },
      async getMessage() {
        assert.ok(created)
        return created
      },
    },
    configOverrides,
    operationStore,
  })
  const verification = await restarted.service.verifyComponentMessage(request)
  assert.equal(verification.status, "verified")
  assert.equal(verification.messageId, MESSAGE_ID)
  assert.equal(restarted.calls.activityAppends, 0)
  assert.equal(restarted.calls.createComponentMessage, 0)
  assert.equal(restarted.calls.editComponentMessage, 0)
})

test("service verifies static embed messages and shares the interaction limiter", async () => {
  const operationStore = new MemoryOperationStore()
  let created: DiscordMessage | undefined
  const configOverrides = {
    capabilities: {
      embedMessages: true,
      interactions: true,
    },
    limits: {
      interactionMaxWritesPerMinute: 1,
      interactionMinWriteIntervalMs: 0,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      embedMessageChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
    },
  }
  const permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.EMBED_LINKS
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  const { calls, service } = serviceFixture({
    client: {
      async createEmbedMessage(channelId, input) {
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(input.content, "Reviewed release")
        assert.deepEqual(input.embeds, [{
          color: 0x58_65_F2,
          description: "Production deployment is ready",
          fields: [{ inline: true, name: "Status", value: "Ready" }],
          title: "Release",
        }])
        calls.createEmbedMessage += 1
        created = message({
          attachments: [],
          author: bot(),
          channel_id: CHANNEL_ID,
          components: [],
          content: input.content ?? "",
          edited_timestamp: null,
          embeds: input.embeds.map((embed) => ({ ...embed, type: "rich" })),
          flags: 0,
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
        return [role(GUILD_ID, permissions, "@everyone")]
      },
      async getMessage() {
        assert.ok(created)
        return created
      },
    },
    configOverrides,
    embedMessageOptions: {
      clock: () => new Date("2026-08-26T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(14),
      randomId: () => "activity-embed-create",
    },
    operationStore,
  })
  const request = {
    action: "create" as const,
    channelId: CHANNEL_ID,
    content: "Reviewed release",
    embeds: [{
      color: 0x58_65_F2,
      description: "Production deployment is ready",
      fields: [{ inline: true, name: "Status", value: "Ready" }],
      title: "Release",
    }],
    operationKey: "embed-service-attempt-0001",
  }

  const plan = await service.planEmbedMessage(request)
  const result = await service.executeEmbedMessage(request, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.messageId, MESSAGE_ID)
  assert.equal(calls.createEmbedMessage, 1)
  assert.equal(operationStore.receipt?.kind, "embed-message")
  assert.equal(operationStore.receipt?.status, "completed")
  await assert.rejects(
    service.sendMessage({
      channelId: CHANNEL_ID,
      content: "Should share the embed-message limiter",
      idempotencyKey: "shared-embed-limit-attempt-0001",
    }),
    InteractionRateLimitError,
  )
  assert.equal(calls.createMessage, 0)
  const persisted = JSON.stringify(operationStore.receipt)
  assert.equal(persisted.includes(request.operationKey), false)
  assert.equal(persisted.includes("Reviewed release"), false)
  assert.equal(persisted.includes("Production deployment is ready"), false)

  const restarted = serviceFixture({
    client: {
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [role(GUILD_ID, permissions, "@everyone")]
      },
      async getMessage() {
        assert.ok(created)
        return created
      },
    },
    configOverrides,
    operationStore,
  })
  const verification = await restarted.service.verifyEmbedMessage(request)
  assert.equal(verification.status, "verified")
  assert.equal(verification.messageId, MESSAGE_ID)
  assert.equal(restarted.calls.activityAppends, 0)
  assert.equal(restarted.calls.createEmbedMessage, 0)
  assert.equal(restarted.calls.editEmbedMessage, 0)
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
    configOverrides: {
      capabilities: {
        interactions: true,
      },
      limits: {
        interactionMinWriteIntervalMs: 0,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        interactionChannelIds: [CHANNEL_ID],
      },
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

test("service coordinates exact member moderation after verifying identity", async () => {
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
    configOverrides: {
      capabilities: {
        administration: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        adminGuildIds: [GUILD_ID],
      },
    },
    writeCoordinator,
  })
  const request = {
    action: "kick" as const,
    auditReason: "Reviewed safety incident 42",
    guildId: GUILD_ID,
    operationKey: "member-moderation-attempt-0001",
    userId: targetId,
  }

  const plan = await service.planMemberModeration(request)
  await assert.rejects(
    () => service.executeMemberModeration(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  assert.equal(plan.target.id, targetId)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.removeMember, 0)
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "member-moderation",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [
      { id: targetId, kind: "member" },
      { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
    ],
  }])
})

test("service coordinates one reviewed bulk guild ban over every exact member target", async () => {
  const targetA = "700000000000000011"
  const targetB = "700000000000000012"
  const botRoleId = "800000000000000011"
  const targetRoleId = "800000000000000012"
  const writeCoordinator = new CapturingWriteCoordinator()
  const operationStore = new KeyedMemoryOperationStore()
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildBan(guildId, userId) {
        throw new DiscordApiError({
          message: "Discord ban not found",
          method: "GET",
          route: `/guilds/${guildId}/bans/${userId}`,
          status: 404,
        })
      },
      async getGuildMember(guildId, userId) {
        if (userId === BOT_ID) return { roles: [botRoleId], user: bot() }
        if (userId === targetA) {
          return {
            roles: [targetRoleId],
            user: { id: targetA, username: "target-a" },
          }
        }
        throw new DiscordApiError({
          message: "Discord member not found",
          method: "GET",
          route: `/guilds/${guildId}/members/${userId}`,
          status: 404,
        })
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          {
            ...role(
              botRoleId,
              DISCORD_PERMISSIONS.BAN_MEMBERS | DISCORD_PERMISSIONS.MANAGE_GUILD,
              "bot-role",
            ),
            position: 10,
          },
          { ...role(targetRoleId, 0n, "target-role"), position: 1 },
        ]
      },
      async getUser(userId) {
        return { id: userId, username: "target-b" }
      },
    },
    configOverrides: {
      capabilities: {
        bulkBanAudit: true,
        bulkBans: true,
      },
      scopes: {
        bulkBanGuildIds: [GUILD_ID],
      },
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    auditReason: "Reviewed safety incident 43",
    deleteMessageSeconds: 0,
    guildId: GUILD_ID,
    operationKey: "bulk-guild-ban-attempt-0001",
    userIds: [targetB, targetA],
  }

  const plan = await service.planBulkGuildBan(request)
  await assert.rejects(
    () => service.executeBulkGuildBan(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  assert.deepEqual(plan.targets.map((target) => target.id), [targetA, targetB])
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "bulk-guild-ban",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [
      { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
      { id: targetA, kind: "member" },
      { id: targetB, kind: "member" },
    ],
  }])
})

test("service coordinates one reviewed bulk member-role frontier over every exact target", async () => {
  const targetA = "700000000000000021"
  const targetB = "700000000000000022"
  const botRoleId = "800000000000000021"
  const selectedRoleId = "800000000000000022"
  const writeCoordinator = new CapturingWriteCoordinator()
  const operationStore = new KeyedMemoryOperationStore()
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildChannels() {
        return [channel()]
      },
      async getGuildMember(_guildId, userId) {
        if (userId === BOT_ID) return { roles: [botRoleId], user: bot() }
        return {
          pending: false,
          roles: [],
          user: {
            id: userId,
            username: userId === targetA ? "target-a" : "target-b",
          },
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
            ...role(
              selectedRoleId,
              DISCORD_PERMISSIONS.SEND_MESSAGES,
              "reviewer",
            ),
            position: 2,
          },
        ]
      },
    },
    configOverrides: {
      capabilities: {
        bulkMemberRoleChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        bulkMemberRoleGuildIds: [GUILD_ID],
        bulkMemberRoleIds: [selectedRoleId],
      },
    },
    gateway: completeChannelGateway(),
    operationStore,
    writeCoordinator,
  })
  const request = {
    action: "add" as const,
    auditReason: "Reviewed exact batch role assignment",
    guildId: GUILD_ID,
    operationKey: "bulk-member-role-attempt-0001",
    roleId: selectedRoleId,
    userIds: [targetB, targetA],
  }

  const plan = await service.planBulkMemberRoleChange(request)
  await assert.rejects(
    () => service.executeBulkMemberRoleChange(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  assert.deepEqual(plan.targets.map((target) => target.userId), [targetA, targetB])
  assert.equal(plan.status, "planned")
  assert.notEqual(plan.operation.requestDigest, plan.digest)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "bulk-member-role-change",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.operation.requestDigest,
    targets: [
      { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
      { id: selectedRoleId, kind: "role" },
      { id: targetA, kind: "member" },
      { id: targetB, kind: "member" },
    ],
  }])
  assert.deepEqual(writeCoordinator.options, [{
    releasePendingOnVerifiedPause: true,
  }])
})

test("service coordinates one reviewed guild prune across member and exact role domains", async () => {
  const includeRoleId = "700000000000000021"
  const shieldRoleId = "700000000000000022"
  const botRoleId = "700000000000000023"
  const protectedUserId = "700000000000000024"
  const writeCoordinator = new CapturingWriteCoordinator()
  let estimate = 2
  const { service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000025" }
      },
      async getGuildMember(_guildId, userId) {
        if (userId === BOT_ID) {
          return { roles: [botRoleId], user: bot() }
        }
        assert.equal(userId, protectedUserId)
        return {
          roles: [shieldRoleId],
          user: { id: protectedUserId, username: "protected" },
        }
      },
      async getGuildPruneCount() {
        return { pruned: estimate }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          { ...role(includeRoleId, 0n, "cohort"), position: 1 },
          { ...role(shieldRoleId, 0n, "shield"), position: 2 },
          {
            ...role(
              botRoleId,
              DISCORD_PERMISSIONS.KICK_MEMBERS | DISCORD_PERMISSIONS.MANAGE_GUILD,
              "connector",
            ),
            position: 10,
          },
        ]
      },
    },
    configOverrides: {
      capabilities: {
        guildPruneAudit: true,
        guildPrunes: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildPruneGuildIds: [GUILD_ID],
        guildPruneIncludeRoleIds: [includeRoleId],
        protectedUserIds: [protectedUserId],
      },
    },
    writeCoordinator,
  })
  const request = {
    acknowledgeNonExactMemberSet: true as const,
    auditReason: "Reviewed inactive-member cleanup",
    days: 14,
    guildId: GUILD_ID,
    includeRoleIds: [includeRoleId],
    maximumEstimatedMemberCount: 10,
    operationKey: "guild-prune-attempt-0001",
  }

  const plan = await service.planGuildPrune(request)
  await assert.rejects(
    () => service.executeGuildPrune(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  assert.equal(plan.estimatedMemberCount, 2)
  assert.equal(plan.cohort.exactMemberIdsAvailable, false)
  assert.deepEqual(writeCoordinator.intents, [{
    kind: "guild-prune",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [
      { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
      { id: GUILD_ID, kind: "role" },
      { id: includeRoleId, kind: "role" },
    ],
  }])

  estimate = 0
  const noOpRequest = {
    ...request,
    operationKey: "guild-prune-attempt-0002",
  }
  const noOpPlan = await service.planGuildPrune(noOpRequest)
  const noOpResult = await service.executeGuildPrune(noOpRequest, noOpPlan.digest)
  assert.equal(noOpResult.status, "noop")
  assert.equal(writeCoordinator.intents.length, 1)
})

test("service pins identity through the narrow reviewed current-bot nickname route", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "800000000000000001"
  let nickname: string | null = "Old private nickname"
  let nicknameWrites = 0
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildMember(_guildId, userId) {
        assert.equal(userId, BOT_ID)
        return {
          nick: nickname,
          pending: false,
          roles: [botRoleId],
          user: bot(),
        }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          {
            ...role(
              botRoleId,
              DISCORD_PERMISSIONS.CHANGE_NICKNAME,
              "connector",
            ),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
        ]
      },
      async modifyCurrentMemberNickname(
        guildId,
        expectedBotId,
        desiredNickname,
        auditReason,
      ) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(expectedBotId, BOT_ID)
        assert.equal(desiredNickname, "Reviewed bot nickname")
        assert.equal(auditReason, "Reviewed current-bot nickname")
        nicknameWrites += 1
        nickname = desiredNickname
        return { nickname, userId: BOT_ID }
      },
    },
    configOverrides: {
      capabilities: {
        nicknameChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        nicknameGuildIds: [GUILD_ID],
      },
    },
    memberNicknameOptions: {
      clock: () => new Date("2026-08-23T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(6),
      randomId: () => "activity-member-nickname",
    },
    operationStore,
  })
  const request = {
    auditReason: "Reviewed current-bot nickname",
    guildId: GUILD_ID,
    nickname: "Reviewed bot nickname",
    operationKey: "member-nickname-attempt-0001",
    target: { kind: "current-bot" as const },
  }

  const plan = await service.planMemberNicknameChange(request)
  const result = await service.executeMemberNicknameChange(request, plan.digest)

  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.target.id, BOT_ID)
  assert.equal(plan.target.kind, "current-bot")
  assert.equal(plan.permission.requiredPermission, "CHANGE_NICKNAME")
  assert.equal(plan.hierarchy, null)
  assert.equal(result.status, "completed")
  assert.equal(result.observedNickname, "Reviewed bot nickname")
  assert.equal(result.userId, BOT_ID)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(nicknameWrites, 1)
  assert.equal(operationStore.receipt?.kind, "member-nickname-change")
  assert.equal(operationStore.receipt?.resourceId, BOT_ID)
  assert.equal(operationStore.receipt?.status, "completed")
  assert.equal(calls.activityEntries.length, 2)
  assert.doesNotMatch(
    JSON.stringify({
      activity: calls.activityEntries,
      receipt: operationStore.receipt,
    }),
    /member-nickname-attempt|Old private|Reviewed bot nickname|Reviewed current-bot/,
  )
})

test("service pins identity and coordinates reviewed member verification changes", async () => {
  const operationStore = new MemoryOperationStore()
  const botRoleId = "800000000000000001"
  const targetRoleId = "800000000000000002"
  const targetId = "700000000000000002"
  const unrelatedFlag = 1 << 3
  let targetFlags = unrelatedFlag
  let verificationWrites = 0
  const intents: WriteCoordinationIntent[] = []
  const writeCoordinator: WriteCoordinator = {
    run(intent, operation) {
      intents.push(intent)
      return operation()
    },
  }
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return { ...guild(), owner_id: "700000000000000001" }
      },
      async getGuildMember(_guildId, userId) {
        return userId === BOT_ID
          ? {
              flags: 0,
              pending: false,
              roles: [botRoleId],
              user: bot(),
            }
          : {
              flags: targetFlags,
              pending: true,
              roles: [targetRoleId],
              user: { id: targetId, username: "private-target-name" },
            }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, 0n, "@everyone"),
          {
            ...role(botRoleId, DISCORD_PERMISSIONS.MANAGE_GUILD, "connector"),
            managed: true,
            position: 10,
            tags: { bot_id: BOT_ID },
          },
          {
            ...role(targetRoleId, 0n, "private-target-role"),
            position: 1,
          },
        ]
      },
      async modifyGuildMemberVerificationBypass(
        guildId,
        userId,
        flags,
        auditReason,
      ) {
        assert.equal(guildId, GUILD_ID)
        assert.equal(userId, targetId)
        assert.equal(
          flags,
          unrelatedFlag | DISCORD_GUILD_MEMBER_FLAGS.bypassesVerification,
        )
        assert.equal(auditReason, "Reviewed Membership Screening bypass")
        verificationWrites += 1
        targetFlags = flags
        return {
          bypassesVerification: true,
          flags,
          userId,
        }
      },
    },
    configOverrides: {
      capabilities: {
        memberVerificationChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberVerificationGuildIds: [GUILD_ID],
      },
    },
    memberVerificationOptions: {
      clock: () => new Date("2026-08-27T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(28),
      randomId: () => "activity-member-verification",
    },
    operationStore,
    writeCoordinator,
  })
  const request = {
    auditReason: "Reviewed Membership Screening bypass",
    bypassesVerification: true,
    guildId: GUILD_ID,
    operationKey: "member-verification-attempt-0001",
    userId: targetId,
  }

  const plan = await service.planMemberVerificationChange(request)
  const result = await service.executeMemberVerificationChange(request, plan.digest)

  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.target.id, targetId)
  assert.equal(plan.target.currentBypassesVerification, false)
  assert.equal(plan.target.pending, true)
  assert.equal(plan.desiredBypassesVerification, true)
  assert.equal(plan.permission.authorizationPath, "manage-guild")
  assert.equal(plan.hierarchy.targetBelowBot, true)
  assert.equal(result.status, "completed")
  assert.equal(result.observedBypassesVerification, true)
  assert.equal(result.userId, targetId)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(verificationWrites, 1)
  assert.deepEqual(intents, [{
    kind: "member-verification-change",
    operationKeyHash: operationKeyHash(request.operationKey),
    planDigest: plan.digest,
    targets: [
      { id: targetId, kind: "member" },
      { collection: "members", guildId: GUILD_ID, kind: "guild-collection" },
    ],
  }])
  assert.equal(operationStore.receipt?.kind, "member-verification-change")
  assert.equal(operationStore.receipt?.resourceId, targetId)
  assert.equal(operationStore.receipt?.status, "completed")
  assert.equal(calls.activityEntries.length, 2)
  assert.doesNotMatch(
    JSON.stringify({
      activity: calls.activityEntries,
      receipt: operationStore.receipt,
    }),
    /member-verification-attempt|private-target-name|private-target-role|Reviewed Membership Screening bypass|"flags"/,
  )
  assert.doesNotMatch(JSON.stringify({ plan, result }), /"flags"/)
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
    configOverrides: {
      capabilities: {
        memberRoleChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberRoleGuildIds: [GUILD_ID],
        memberRoleIds: [selectedRoleId],
      },
    },
    gateway: completeChannelGateway(),
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
    configOverrides: {
      capabilities: {
        memberVoiceAudit: true,
        memberVoiceChanges: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberVoiceChannelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
        memberVoiceGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        threadAudit: true,
        threadChanges: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID, THREAD_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        threadGuildIds: [GUILD_ID],
        threadIds: [THREAD_ID],
      },
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
    configOverrides: {
      capabilities: {
        channelCreation: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelCreationGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        guildScaffolds: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        guildScaffolds: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: [GUILD_ID],
      },
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
    releasePendingOnVerifiedPause: true,
  }])
  assert.notEqual(plan.operation.requestDigest, plan.digest)
  assert.equal(calls.createChannel, 0)
  assert.equal(calls.createRole, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service captures a two-pass guild-blueprint draft under verified identity", async () => {
  const reads = {
    autoModerationRules: 0,
    channels: 0,
    guild: 0,
    member: 0,
    onboarding: 0,
    profile: 0,
    roles: 0,
    welcomeScreen: 0,
  }
  const capturedChannel = channel({
    default_auto_archive_duration: 1_440,
    nsfw: false,
    parent_id: null,
    rate_limit_per_user: 0,
    topic: "General discussion",
  })
  const capturedGuild = {
    ...guild(),
    afk_channel_id: null,
    afk_timeout: 300,
    banner: null,
    default_message_notifications: 1,
    description: "Private guild description",
    discovery_splash: null,
    explicit_content_filter: 2,
    features: ["WELCOME_SCREEN_ENABLED"],
    icon: null,
    owner_id: "700000000000000009",
    premium_progress_bar_enabled: false,
    public_updates_channel_id: null,
    rules_channel_id: null,
    safety_alerts_channel_id: null,
    splash: null,
    system_channel_flags: 0,
    system_channel_id: CHANNEL_ID,
    verification_level: 2,
  }
  const capturedOnboarding = {
    defaultChannelIds: [CHANNEL_ID],
    enabled: false,
    guildId: GUILD_ID,
    mode: 1,
    prompts: [],
    unknownEnumCount: 0,
    unknownFieldCount: 0,
  }
  const capturedProfile = {
    description: "Private guild description",
    id: GUILD_ID,
    mediaPresence: {
      banner: false,
      discoverySplash: false,
      icon: false,
      inviteSplash: false,
    },
    name: "Captured Guild",
    ownerId: "700000000000000009",
  }
  const capturedRoles = [{
    ...role(CREATED_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "Members"),
    position: 1,
  }, role(GUILD_ID, 0n, "@everyone")]
  const capturedWelcomeScreen = {
    description: "Welcome",
    unknownFieldCount: 0,
    welcomeChannels: [{
      channelId: CHANNEL_ID,
      description: "Start here",
      emojiId: null,
      emojiName: "👋",
      unknownFieldCount: 0,
    }],
  }
  const config = loadConnectorConfig({
    capabilities: {
      automodAudit: true,
      guildCommunityAudit: true,
      guildProfileAudit: true,
      guildSettingsAudit: true,
      onboardingAudit: true,
      welcomeScreenAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    name: "guild-blueprint-capture-test",
    readScope: {
      channelIds: [],
      guildIds: [GUILD_ID],
    },
    scopes: {
      automodGuildIds: [GUILD_ID],
      guildCommunityGuildIds: [GUILD_ID],
      guildProfileGuildIds: [GUILD_ID],
      guildSettingsGuildIds: [GUILD_ID],
      onboardingGuildIds: [GUILD_ID],
      welcomeScreenGuildIds: [GUILD_ID],
    },
    token: TOKEN,
    tools: {
      surface: "full",
      toolsets: ["guild-blueprints"],
    },
  }, { homeDirectory: "/test/home" })
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        reads.guild += 1
        return structuredClone(capturedGuild)
      },
      async getGuildChannels() {
        reads.channels += 1
        return structuredClone([capturedChannel])
      },
      async getGuildOnboarding() {
        reads.onboarding += 1
        return structuredClone(capturedOnboarding)
      },
      async getGuildMember() {
        reads.member += 1
        return { roles: [], user: bot() }
      },
      async getGuildProfile() {
        reads.profile += 1
        return structuredClone(capturedProfile)
      },
      async getGuildRoles() {
        reads.roles += 1
        return structuredClone(capturedRoles)
      },
      async getGuildWelcomeScreen() {
        reads.welcomeScreen += 1
        return structuredClone(capturedWelcomeScreen)
      },
      async listGuildAutoModerationRules() {
        reads.autoModerationRules += 1
        return []
      },
    },
    config,
    gateway: completeChannelGateway([capturedChannel]),
  })
  const result = await service.captureGuildBlueprint({
    auditReason: "Retain a reviewed live guild draft",
    guildId: GUILD_ID,
    operationKey: "guild-blueprint-capture-service-0001",
  })

  assert.equal(result.status, "ready")
  assert.equal(result.applicationId, APPLICATION_ID)
  assert.equal(result.botId, BOT_ID)
  assert.equal(result.blueprint?.guildId, GUILD_ID)
  assert.deepEqual(reads, {
    autoModerationRules: 2,
    channels: 4,
    guild: 4,
    member: 2,
    onboarding: 2,
    profile: 0,
    roles: 4,
    welcomeScreen: 2,
  })
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityAppends, 0)
  assert.equal(calls.listMessages, 0)
  assert.equal(calls.createChannel, 0)
  assert.equal(calls.createRole, 0)
})

test("service rejects guild-blueprint capture policy before identity access", async () => {
  const { calls, service } = serviceFixture()
  const request = {
    auditReason: "Retain a reviewed live guild draft",
    guildId: GUILD_ID,
    operationKey: "guild-blueprint-capture-service-0001",
  }

  await assert.rejects(
    service.captureGuildBlueprint(request),
    /guild profile audit is disabled/iu,
  )
  await assert.rejects(
    service.captureGuildBlueprint({ ...request, operationKey: "short" }),
    /operation key/iu,
  )
  assert.equal(calls.application, 0)
  assert.equal(calls.user, 0)
})

test("service dispatches one guild-blueprint frontier through existing durable coordination", async () => {
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
    configOverrides: {
      capabilities: {
        guildScaffolds: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: [GUILD_ID],
      },
    },
    guildBlueprintOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-blueprint-scaffold",
    },
    operationStore,
    writeCoordinator,
  })
  const operationKey = "guild-blueprint-attempt-0001"
  const request = {
    auditReason: "Reviewed coordinated guild build",
    guildId: GUILD_ID,
    operationKey,
    profile: { name: "Coordinated Guild" },
    scaffold: {
      channels: [{ key: "support-category", kind: "category" as const, name: "Support" }],
      roles: [{ key: "support-role", name: "Support" }],
    },
  }
  const plan = await service.planGuildBlueprint(request)

  assert.equal(plan.status, "planned")
  assert.equal(plan.frontier?.kind, "structure")
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.state]), [
    ["structure", "ready"],
    ["profile", "waiting"],
  ])
  await assert.rejects(
    () => service.executeGuildBlueprint(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  const nestedOperationKey = guildBlueprintStepOperationKey(operationKey, "structure")
  assert.equal(writeCoordinator.intents.length, 1)
  assert.equal(writeCoordinator.intents[0]?.kind, "guild-scaffold")
  assert.equal(
    writeCoordinator.intents[0]?.operationKeyHash,
    operationKeyHash(nestedOperationKey),
  )
  assert.equal(calls.createChannel, 0)
  assert.equal(calls.createRole, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service dispatches a guild-blueprint Welcome Screen frontier through its domain coordinator", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_GUILD
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: ["COMMUNITY"],
          owner_id: "700000000000000009",
          public_updates_channel_id: OTHER_CHANNEL_ID,
          rules_channel_id: CHANNEL_ID,
          safety_alerts_channel_id: null,
        }
      },
      async getGuildChannels() {
        return [
          channel({
            default_auto_archive_duration: 1_440,
            name: "welcome",
            nsfw: false,
            parent_id: null,
            rate_limit_per_user: 0,
            topic: null,
          }),
          channel({
            id: OTHER_CHANNEL_ID,
            name: "community-updates",
            parent_id: null,
            position: 2,
          }),
        ]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, permissions, "@everyone"),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
      async getGuildWelcomeScreen() {
        return {
          description: null,
          unknownFieldCount: 0,
          welcomeChannels: [],
        }
      },
      async listGuildEmojis() {
        return []
      },
    },
    configOverrides: {
      capabilities: {
        guildCommunityAudit: true,
        guildScaffolds: true,
        welcomeScreenAudit: true,
        welcomeScreenChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildCommunityGuildIds: [GUILD_ID],
        guildScaffoldGuildIds: [GUILD_ID],
        welcomeScreenGuildIds: [GUILD_ID],
      },
    },
    guildBlueprintOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
    },
    gateway: completeChannelGateway([
      channel({ parent_id: null }),
      channel({
        id: OTHER_CHANNEL_ID,
        parent_id: null,
        position: 2,
      }),
    ]),
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-blueprint-scaffold",
    },
    operationStore,
    welcomeScreenOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(7),
      randomId: () => "activity-guild-blueprint-welcome-screen",
    },
    writeCoordinator,
  })
  const operationKey = "guild-blueprint-welcome-screen-attempt-0001"
  const request = {
    auditReason: "Reviewed coordinated Welcome Screen",
    guildId: GUILD_ID,
    operationKey,
    scaffold: {
      channels: [{ key: "welcome-channel", kind: "text" as const, name: "welcome" }],
      roles: [{ key: "support-role", name: "Support" }],
    },
    welcomeScreen: {
      channels: [{
        channel: { key: "welcome-channel", kind: "scaffold" as const },
        description: "Read the community guide",
        emoji: { kind: "unicode" as const, unicode: "👋" },
      }],
      description: "Welcome to the community",
      enabled: true,
    },
  }
  const plan = await service.planGuildBlueprint(request)

  assert.equal(plan.frontier?.kind, "welcome-screen")
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.state]), [
    ["structure", "satisfied"],
    ["welcome-screen", "ready"],
  ])
  await assert.rejects(
    () => service.executeGuildBlueprint(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  const nestedOperationKey = guildBlueprintStepOperationKey(
    operationKey,
    "welcome-screen",
  )
  assert.equal(writeCoordinator.intents.length, 1)
  assert.equal(writeCoordinator.intents[0]?.kind, "welcome-screen-change")
  assert.equal(
    writeCoordinator.intents[0]?.operationKeyHash,
    operationKeyHash(nestedOperationKey),
  )
  assert.deepEqual(writeCoordinator.intents[0]?.targets, [{
    collection: "welcome-screen",
    guildId: GUILD_ID,
    kind: "guild-collection",
  }])
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service dispatches a guild-blueprint Community frontier through its domain coordinator", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_GUILD
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const rulesChannel = channel({
    default_auto_archive_duration: 1_440,
    name: "rules",
    nsfw: false,
    parent_id: null,
    rate_limit_per_user: 0,
    topic: null,
  })
  const updatesChannel = channel({
    id: OTHER_CHANNEL_ID,
    name: "community-updates",
    parent_id: null,
    position: 2,
  })
  const { service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: ["COMMUNITY"],
          owner_id: "700000000000000009",
          public_updates_channel_id: OTHER_CHANNEL_ID,
          rules_channel_id: CHANNEL_ID,
          safety_alerts_channel_id: null,
        }
      },
      async getGuildChannels() {
        return [rulesChannel, updatesChannel]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, permissions, "@everyone"),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
    },
    configOverrides: {
      capabilities: {
        guildCommunityAudit: true,
        guildCommunityChanges: true,
        guildScaffolds: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildCommunityGuildIds: [GUILD_ID],
        guildScaffoldGuildIds: [GUILD_ID],
      },
    },
    gateway: completeChannelGateway([rulesChannel, updatesChannel]),
    guildBlueprintOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
    },
    guildCommunityOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(59),
      randomId: () => "activity-guild-blueprint-community",
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-blueprint-scaffold",
    },
    operationStore,
    writeCoordinator,
  })
  const operationKey = "guild-blueprint-community-attempt-0001"
  const request = {
    auditReason: "Reviewed coordinated Community routing",
    community: {
      acknowledgeCommunityEnablement: true as const,
      publicUpdatesChannel: {
        channelId: OTHER_CHANNEL_ID,
        kind: "exact" as const,
      },
      rulesChannel: { key: "rules-channel", kind: "scaffold" as const },
      safetyAlertsChannel: {
        channelId: OTHER_CHANNEL_ID,
        kind: "exact" as const,
      },
    },
    guildId: GUILD_ID,
    operationKey,
    scaffold: {
      channels: [{ key: "rules-channel", kind: "text" as const, name: "rules" }],
      roles: [{ key: "support-role", name: "Support" }],
    },
  }
  const plan = await service.planGuildBlueprint(request)

  assert.equal(plan.frontier?.kind, "community")
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.state]), [
    ["structure", "satisfied"],
    ["community", "ready"],
  ])
  await assert.rejects(
    () => service.executeGuildBlueprint(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  const nestedOperationKey = guildBlueprintStepOperationKey(
    operationKey,
    "community",
  )
  assert.equal(writeCoordinator.intents.length, 1)
  assert.equal(writeCoordinator.intents[0]?.kind, "guild-community-change")
  assert.equal(
    writeCoordinator.intents[0]?.operationKeyHash,
    operationKeyHash(nestedOperationKey),
  )
  assert.deepEqual(writeCoordinator.intents[0]?.targets, [{
    collection: "community",
    guildId: GUILD_ID,
    kind: "guild-collection",
  }])
})

test("service dispatches a guild-blueprint onboarding frontier through its domain coordinator", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_GUILD
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const onboardingChannel = channel({
    default_auto_archive_duration: 1_440,
    name: "welcome",
    nsfw: false,
    parent_id: null,
    rate_limit_per_user: 0,
    topic: null,
  })
  const { calls, service } = serviceFixture({
    client: {
      async getGuild() {
        return {
          ...guild(),
          features: ["COMMUNITY"],
          owner_id: BOT_ID,
        }
      },
      async getGuildChannels() {
        return [onboardingChannel]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildOnboarding() {
        return {
          defaultChannelIds: [],
          enabled: false,
          guildId: GUILD_ID,
          mode: 0,
          prompts: [],
          unknownEnumCount: 0,
          unknownFieldCount: 0,
        }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, permissions, "@everyone"),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
      async listGuildEmojis() {
        return []
      },
    },
    configOverrides: {
      capabilities: {
        guildScaffolds: true,
        onboardingAudit: true,
        onboardingChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: [GUILD_ID],
        onboardingGuildIds: [GUILD_ID],
      },
    },
    gateway: completeChannelGateway([onboardingChannel]),
    guildBlueprintOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-blueprint-scaffold",
    },
    onboardingOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(6),
      randomId: () => "activity-guild-blueprint-onboarding",
    },
    operationStore,
    writeCoordinator,
  })
  const operationKey = "guild-blueprint-onboarding-attempt-0001"
  const request = {
    auditReason: "Reviewed coordinated onboarding",
    guildId: GUILD_ID,
    onboarding: {
      defaultChannels: [{ key: "welcome-channel", kind: "scaffold" as const }],
      enabled: false,
      mode: "advanced" as const,
      prompts: [{
        inOnboarding: true,
        options: [{
          channels: [{ key: "welcome-channel", kind: "scaffold" as const }],
          description: "Read the community guide",
          emoji: { kind: "unicode" as const, unicode: "👋" },
          roles: [],
          title: "Start here",
        }],
        required: false,
        singleSelect: true,
        title: "Choose your first stop",
        type: "multiple-choice" as const,
      }],
    },
    operationKey,
    scaffold: {
      channels: [{ key: "welcome-channel", kind: "text" as const, name: "welcome" }],
      roles: [{ key: "support-role", name: "Support" }],
    },
  }
  const plan = await service.planGuildBlueprint(request)

  assert.equal(plan.frontier?.kind, "onboarding")
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.state]), [
    ["structure", "satisfied"],
    ["onboarding", "ready"],
  ])
  await assert.rejects(
    () => service.executeGuildBlueprint(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  const nestedOperationKey = guildBlueprintStepOperationKey(
    operationKey,
    "onboarding",
  )
  assert.equal(writeCoordinator.intents.length, 1)
  assert.equal(writeCoordinator.intents[0]?.kind, "onboarding-change")
  assert.equal(
    writeCoordinator.intents[0]?.operationKeyHash,
    operationKeyHash(nestedOperationKey),
  )
  assert.deepEqual(writeCoordinator.intents[0]?.targets, [{
    collection: "onboarding",
    guildId: GUILD_ID,
    kind: "guild-collection",
  }])
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service dispatches one guild-blueprint publication through component coordination", async () => {
  const operationStore = new MemoryOperationStore()
  const writeCoordinator = new CapturingWriteCoordinator()
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.SEND_MESSAGES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const publicationChannel = channel({
    default_auto_archive_duration: 1_440,
    name: "announcements",
    nsfw: false,
    parent_id: null,
    rate_limit_per_user: 0,
    topic: null,
  })
  const { calls, service } = serviceFixture({
    client: {
      async getGuildChannels() {
        return [publicationChannel]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, permissions, "@everyone"),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
    },
    componentMessageOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(10),
      randomId: () => "activity-guild-blueprint-publication",
    },
    configOverrides: {
      capabilities: {
        guildScaffolds: true,
        interactions: true,
      },
      limits: {
        interactionMinWriteIntervalMs: 0,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: [GUILD_ID],
        interactionChannelIds: [CHANNEL_ID],
      },
    },
    guildBlueprintOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-blueprint-scaffold",
    },
    operationStore,
    writeCoordinator,
  })
  const operationKey = "guild-blueprint-publication-attempt-0001"
  const publicationKey = "launch-message"
  const request = {
    auditReason: "Reviewed coordinated publication",
    guildId: GUILD_ID,
    operationKey,
    publications: [{
      action: "create" as const,
      channel: { key: "announcements", kind: "scaffold" as const },
      components: [{ content: "Reviewed launch", kind: "text" as const }],
      key: publicationKey,
    }],
    scaffold: {
      channels: [{ key: "announcements", kind: "text" as const, name: "announcements" }],
      roles: [{ key: "support-role", name: "Support" }],
    },
  }
  const plan = await service.planGuildBlueprint(request)

  assert.equal(plan.frontier?.kind, "publication")
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.state]), [
    ["structure", "satisfied"],
    ["publication", "ready"],
  ])
  if (plan.frontier?.kind !== "publication") {
    throw new Error("Expected a component publication frontier")
  }
  const nestedOperationKey = guildBlueprintPublicationOperationKey(
    operationKey,
    publicationKey,
  )
  assert.equal(
    plan.frontier.plan.operationKeyHash,
    operationKeyHash(nestedOperationKey),
  )
  await assert.rejects(
    () => service.executeGuildBlueprint(request, plan.digest),
    (error: unknown) => error === writeCoordinator.stop,
  )

  assert.deepEqual(writeCoordinator.intents, [{
    kind: "component-message",
    operationKeyHash: operationKeyHash(nestedOperationKey),
    planDigest: plan.frontier.plan.digest,
    targets: [{ id: CHANNEL_ID, kind: "channel" }],
  }])
  assert.equal(calls.createComponentMessage, 0)
  assert.equal(calls.activityEntries.length, 0)
  assert.equal(operationStore.receipt, undefined)
})

test("service verifies a completed guild-blueprint publication after restart", async () => {
  const operationStore = new KeyedMemoryOperationStore()
  let created: DiscordMessage | undefined
  let createCalls = 0
  const initialPermissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.SEND_MESSAGES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const publicationChannel = channel({
    default_auto_archive_duration: 1_440,
    name: "announcements",
    nsfw: false,
    parent_id: null,
    rate_limit_per_user: 0,
    topic: null,
  })
  const configOverrides = {
    capabilities: {
      guildScaffolds: true,
      interactions: true,
    },
    limits: {
      interactionMinWriteIntervalMs: 0,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      guildScaffoldGuildIds: [GUILD_ID],
      interactionChannelIds: [CHANNEL_ID],
    },
  }
  const serviceOptions = {
    client: {
      async createComponentMessage(_channelId: string, input: {
        nonce: string
      }) {
        createCalls += 1
        created = message({
          attachments: [],
          author: bot(),
          channel_id: CHANNEL_ID,
          components: [{ content: "Reviewed launch", id: 1, type: 10 }],
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
      async getGuildChannels() {
        return [publicationChannel]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(GUILD_ID, initialPermissions, "@everyone"),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
      async getMessage() {
        assert.ok(created)
        return created
      },
    },
    componentMessageOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(10),
      randomId: () => "activity-guild-blueprint-publication",
    },
    configOverrides,
    guildBlueprintOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(9),
    },
    guildScaffoldOptions: {
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      planKey: new Uint8Array(32).fill(8),
      randomId: () => "activity-guild-blueprint-scaffold",
    },
    operationStore,
  }
  const first = serviceFixture(serviceOptions)
  const operationKey = "guild-blueprint-restart-publication-0001"
  const request = {
    auditReason: "Reviewed restart-safe publication",
    guildId: GUILD_ID,
    operationKey,
    publications: [{
      action: "create" as const,
      channel: { key: "announcements", kind: "scaffold" as const },
      components: [{ content: "Reviewed launch", kind: "text" as const }],
      key: "launch-message",
    }],
    scaffold: {
      channels: [{ key: "announcements", kind: "text" as const, name: "announcements" }],
      roles: [{ key: "support-role", name: "Support" }],
    },
  }
  const plan = await first.service.planGuildBlueprint(request)
  const result = await first.service.executeGuildBlueprint(request, plan.digest)

  assert.equal(result.status, "frontier-executed")
  assert.equal(result.executedPhase, "publication")
  assert.equal(createCalls, 1)
  assert.equal(operationStore.receipt?.kind, "component-message")
  assert.equal(operationStore.receipt?.status, "completed")

  const restarted = serviceFixture({
    ...serviceOptions,
    client: {
      async createComponentMessage() {
        throw new Error("Restart verification must not create a message")
      },
      async getGuildChannels() {
        return [publicationChannel]
      },
      async getGuildMember() {
        return { roles: [], user: bot() }
      },
      async getGuildRoles() {
        return [
          role(
            GUILD_ID,
            initialPermissions & ~DISCORD_PERMISSIONS.SEND_MESSAGES,
            "@everyone",
          ),
          role(CREATED_ROLE_ID, 0n, "Support"),
        ]
      },
      async getMessage() {
        assert.ok(created)
        return created
      },
    },
  })
  const verification = await restarted.service.verifyGuildBlueprint(request)

  assert.equal(verification.status, "verified")
  assert.equal(verification.steps.at(-1)?.verificationStatus, "verified")
  assert.equal(verification.steps.at(-1)?.messageId, MESSAGE_ID)
  assert.equal(createCalls, 1)
  const persisted = JSON.stringify(operationStore.receipt)
  assert.equal(persisted.includes("Reviewed launch"), false)
  assert.equal(persisted.includes(operationKey), false)
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
    configOverrides: {
      capabilities: {
        pollAudit: true,
        pollCreation: true,
        pollVoterAudit: true,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        pollChannelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      capabilities: {
        forumPosts: true,
      },
      limits: {
        interactionMinWriteIntervalMs: 0,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        forumPostChannelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      capabilities: {
        threadCreation: true,
      },
      limits: {
        interactionMinWriteIntervalMs: 0,
      },
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        threadParentIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      readScope: {
        guildIds: [GUILD_ID],
      },
    },
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
    configOverrides: {
      readScope: {
        guildIds: [GUILD_ID],
      },
    },
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
    configOverrides: {
      readScope: {
        guildIds: [GUILD_ID],
      },
    },
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
    configOverrides: {
      capabilities: {
        roleCreation: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        roleCreationGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        roleConfiguration: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        roleConfigurationIds: [CREATED_ROLE_ID],
      },
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
    configOverrides: {
      capabilities: {
        roleOrderingAudit: true,
        roleOrderingChanges: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        roleOrderingGuildIds: [GUILD_ID],
      },
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
  const privateApplication = application()
  privateApplication.name = PRIVATE_APPLICATION_PROFILE_TEXT
  privateApplication.description = PRIVATE_APPLICATION_PROFILE_TEXT
  if (privateApplication.bot) {
    privateApplication.bot.username = PRIVATE_BOT_PROFILE_TEXT
  }
  const { calls, service } = serviceFixture({
    application: privateApplication,
    currentUser: {
      ...bot(),
      username: PRIVATE_BOT_PROFILE_TEXT,
    },
    configOverrides: {
      storage: { auditFile: PRIVATE_ACTIVITY_FILE },
    },
  })

  const status = await service.getStatus()
  const posture = await service.getApplicationPosture()
  const guilds = await service.listGuilds({ limit: 10 })

  assert.deepEqual(status.application, {
    guildMembersIntent: "disabled",
    id: APPLICATION_ID,
    messageContentIntent: "enabled",
  })
  assert.deepEqual(status.applicationPosture, posture)
  assert.deepEqual(posture.findingCounts, { blockers: 0, warnings: 0 })
  assert.equal(posture.installation.guild.supported, true)
  assert.deepEqual(status.bot, { id: BOT_ID })
  assert.equal(status.guildPage.accessible, 1)
  assert.deepEqual(status.privacy, CONNECTOR_STATUS_PRIVACY)
  assert.equal(status.schemaVersion, CONNECTOR_STATUS_SCHEMA_VERSION)
  assert.equal("auditFile" in status, false)
  assert.equal("name" in status.application, false)
  assert.equal("username" in status.bot, false)
  const serializedStatus = JSON.stringify(status)
  assert.equal(serializedStatus.includes(PRIVATE_APPLICATION_PROFILE_TEXT), false)
  assert.equal(serializedStatus.includes(PRIVATE_BOT_PROFILE_TEXT), false)
  assert.equal(serializedStatus.includes(PRIVATE_ACTIVITY_FILE), false)
  assert.deepEqual(status.writeCoordination, {
    coverage: "receipt-backed-reviewed-writes",
    excludedWorkflows: ["ordinary-message-interactions"],
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

test("service assesses current application posture against effective policy", async () => {
  const configured = application()
  configured.bot_public = true
  configured.flags = 0
  configured.flags_new = "0"
  configured.interactions_endpoint_url = "https://interactions.invalid/private"
  const { calls, service } = serviceFixture({
    application: configured,
    configOverrides: {
      capabilities: {
        interactions: true,
        memberDirectory: true,
        nativeInteractions: true,
      },
      scopes: {
        interactionChannelIds: [CHANNEL_ID],
        memberDirectoryGuildIds: [GUILD_ID],
        nativeInteractionChannelIds: [CHANNEL_ID],
        nativeInteractionGuildIds: [GUILD_ID],
        nativeInteractionUserIds: [BOT_ID],
      },
    },
  })

  const posture = await service.getApplicationPosture()

  assert.deepEqual(posture.connectorFit, {
    callbackFreeGuildInstall: "compatible",
    guildMembersIntent: "blocked",
    messageContentIntent: "blocked",
    nativeInteractionIngress: "blocked",
    presenceIntent: "not-required",
  })
  assert.deepEqual(posture.findings.map(({ code }) => code), [
    "interaction-delivery-conflict",
    "required-guild-members-intent-disabled",
    "required-message-content-intent-disabled",
    "bot-public",
  ])
  assert.deepEqual(posture.findingCounts, { blockers: 3, warnings: 1 })
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.guilds, 0)
  assert.doesNotMatch(JSON.stringify(posture), /https:\/\//u)
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
    configOverrides: {
      capabilities: {
        memberDirectory: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberDirectoryGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      capabilities: {
        banAudit: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        banAuditGuildIds: [GUILD_ID],
      },
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
    configOverrides: {
      readScope: {
        channelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      readScope: {
        channelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      readScope: {
        channelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      readScope: {
        channelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      readScope: {
        channelIds: [CHANNEL_ID],
      },
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
    configOverrides: {
      readScope: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
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
