import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { loadConnectorConfig } from "../src/config.js"
import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  DISCORD_SCHEDULED_EVENT_ENTITY_TYPES,
  DISCORD_SCHEDULED_EVENT_STATUSES,
  type DiscordAutoModerationRuleSummary,
  type DiscordScheduledEventSummary,
} from "../src/discord-client.js"
import {
  ConfigurationError,
  InteractionRateLimitError,
  PolicyError,
} from "../src/errors.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  OperationReceipt,
  OperationStore,
} from "../src/operation-store.js"
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
const FORUM_TAG_ID = "800000000000000001"
const MEMBER_USER_ID = "600000000000000001"
const WEBHOOK_ID = "900000000000000001"
const AUTOMOD_RULE_ID = "910000000000000001"
const SCHEDULED_EVENT_ID = "930000000000000001"

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
  channel?: DiscordChannel
  client?: Partial<DiscordServiceClient>
  environment?: NodeJS.ProcessEnv
  forumPostOptions?: ConnectorServiceOptions["forumPostOptions"]
  guildExpressionOptions?: ConnectorServiceOptions["guildExpressionOptions"]
  guildScaffoldOptions?: ConnectorServiceOptions["guildScaffoldOptions"]
  interactionOptions?: ConnectorServiceOptions["interactionOptions"]
  memberRoleOptions?: ConnectorServiceOptions["memberRoleOptions"]
  operationStore?: OperationStore
  permissionOverwriteOptions?: ConnectorServiceOptions["permissionOverwriteOptions"]
  roleAdministrationOptions?: ConnectorServiceOptions["roleAdministrationOptions"]
  scheduledEventOptions?: ConnectorServiceOptions["scheduledEventOptions"]
  webhookOptions?: ConnectorServiceOptions["webhookOptions"]
} = {}) {
  const calls = {
    activityAppends: 0,
    activityEntries: [] as ActivityEntry[],
    addReaction: 0,
    application: 0,
    createAttachment: 0,
    createChannel: 0,
    createForumPost: 0,
    createMessage: 0,
    createRole: 0,
    editMessage: 0,
    getRole: 0,
    guildAuditLog: 0,
    guilds: 0,
    listMessages: 0,
    removeMember: 0,
    user: 0,
  }
  const client: DiscordServiceClient = {
    async addGuildMemberRole() {
      throw new Error("Unexpected member-role add")
    },
    async addOwnReaction() {
      calls.addReaction += 1
    },
    async bulkDeleteMessages() {},
    async createGuildBan() {},
    async createForumPost() {
      calls.createForumPost += 1
      throw new Error("Unexpected forum-post creation")
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
    async createMessage(_channelId, input) {
      calls.createMessage += 1
      return message({
        author: bot(),
        content: input.content,
        nonce: input.nonce,
      })
    },
    async deleteChannelPermissionOverwrite() {},
    async deleteMessage() {},
    async deleteGuildEmoji() {},
    async deleteGuildAutoModerationRule() {},
    async deleteGuildScheduledEvent() {},
    async deleteGuildSticker() {},
    async deleteWebhook() {},
    async editChannelPermissionOverwrite() {},
    async editMessage(_channelId, _messageId, input) {
      calls.editMessage += 1
      return message({
        author: bot(),
        content: input.content,
      })
    },
    async getChannel() {
      return overrides.channel || channel()
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
    async getMessage() {
      return message()
    },
    async getThreadMember(threadId, userId) {
      return {
        flags: 0,
        id: threadId,
        join_timestamp: "2026-08-14T00:00:00.000Z",
        user_id: userId,
      }
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
    async listGuildMembers() {
      return []
    },
    async listGuildAutoModerationRules() {
      return []
    },
    async listGuildScheduledEvents() {
      return []
    },
    async listGuildEmojis() {
      return []
    },
    async listGuildStickers() {
      return []
    },
    async listJoinedPrivateArchivedThreads() {
      return { has_more: false, threads: [] }
    },
    async listMessagePins() {
      return { has_more: false, items: [] }
    },
    async listChannelWebhooks() {
      return []
    },
    async listMessages() {
      calls.listMessages += 1
      return [message()]
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
    async pinMessage() {},
    async removeGuildBan() {},
    async removeGuildMember() {
      calls.removeMember += 1
    },
    async removeGuildMemberRole() {
      throw new Error("Unexpected member-role remove")
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
      ...(overrides.channelAdministrationOptions
        ? { channelAdministrationOptions: overrides.channelAdministrationOptions }
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
      ...(overrides.interactionOptions
        ? { interactionOptions: overrides.interactionOptions }
        : {}),
      ...(overrides.memberRoleOptions
        ? { memberRoleOptions: overrides.memberRoleOptions }
        : {}),
      ...(overrides.forumPostOptions
        ? { forumPostOptions: overrides.forumPostOptions }
        : {}),
      ...(overrides.guildScaffoldOptions
        ? { guildScaffoldOptions: overrides.guildScaffoldOptions }
        : {}),
      ...(overrides.guildExpressionOptions
        ? { guildExpressionOptions: overrides.guildExpressionOptions }
        : {}),
      ...(overrides.roleAdministrationOptions
        ? { roleAdministrationOptions: overrides.roleAdministrationOptions }
        : {}),
      ...(overrides.scheduledEventOptions
        ? { scheduledEventOptions: overrides.scheduledEventOptions }
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

test("service verifies bot identity before delegating safe message interactions", async () => {
  const { calls, service } = serviceFixture({
    environment: {
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_INTERACTIONS: "true",
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "0",
    },
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
})

test("service verifies identity through credential-free webhook audit and cleanup", async () => {
  const operationStore = new MemoryOperationStore()
  let inventory = [{
    applicationId: APPLICATION_ID,
    channelId: CHANNEL_ID,
    creatorUserId: MEMBER_USER_ID,
    guildId: GUILD_ID,
    id: WEBHOOK_ID,
    name: "reviewed-hook",
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
  assert.equal(inventoryCalls, 5)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.activityEntries.length, 2)
  assert.equal(operationStore.receipt?.kind, "webhook-deletion")
  assert.equal(operationStore.receipt?.resourceId, WEBHOOK_ID)
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

test("service verifies identity before planning and executing exact member moderation", async () => {
  const targetId = "700000000000000002"
  const botRoleId = "800000000000000001"
  const targetRoleId = "800000000000000002"
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
  })
  const request = {
    auditReason: "Reviewed exact existing scaffold",
    channels: [{ key: "support-category", kind: "category" as const, name: "Support" }],
    guildId: GUILD_ID,
    operationKey: "guild-scaffold-attempt-0001",
    roles: [{ key: "support-role", name: "Support" }],
  }

  const plan = await service.planGuildScaffold(request)
  const result = await service.executeGuildScaffold(request, plan.digest)

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.createChannel, 0)
  assert.equal(calls.createRole, 0)
  assert.equal(operationStore.receipt, undefined)
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

test("service verifies identity once and reports scope without message reads", async () => {
  const { calls, service } = serviceFixture()

  const status = await service.getStatus()
  const guilds = await service.listGuilds({ limit: 10 })

  assert.equal(status.application.id, APPLICATION_ID)
  assert.equal(status.application.guildMembersIntent, "disabled")
  assert.equal(status.application.messageContentIntent, "enabled")
  assert.equal(status.bot.id, BOT_ID)
  assert.equal(status.guildPage.accessible, 1)
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
