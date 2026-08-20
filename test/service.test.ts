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

import type { ActivityStore } from "../src/activity-log.js"
import { loadConnectorConfig } from "../src/config.js"
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
const CHANNEL_ID = "400000000000000001"
const OTHER_CHANNEL_ID = "400000000000000002"
const THREAD_ID = "400000000000000003"
const SECOND_THREAD_ID = "400000000000000004"
const MESSAGE_ID = "500000000000000001"
const CREATED_CHANNEL_ID = "400000000000000005"
const CREATED_ROLE_ID = "700000000000000001"

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

function bot(): DiscordUser {
  return {
    bot: true,
    id: BOT_ID,
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
  channelAdministrationOptions?: ConnectorServiceOptions["channelAdministrationOptions"]
  channel?: DiscordChannel
  client?: Partial<DiscordServiceClient>
  environment?: NodeJS.ProcessEnv
  interactionOptions?: ConnectorServiceOptions["interactionOptions"]
  operationStore?: OperationStore
  roleAdministrationOptions?: ConnectorServiceOptions["roleAdministrationOptions"]
} = {}) {
  const calls = {
    addReaction: 0,
    application: 0,
    createAttachment: 0,
    createChannel: 0,
    createMessage: 0,
    createRole: 0,
    editMessage: 0,
    getRole: 0,
    guilds: 0,
    listMessages: 0,
    removeMember: 0,
    user: 0,
  }
  const client: DiscordServiceClient = {
    async addOwnReaction() {
      calls.addReaction += 1
    },
    async bulkDeleteMessages() {},
    async createGuildBan() {},
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
    async createGuildRole() {
      calls.createRole += 1
      return role(CREATED_ROLE_ID, 0n, "created")
    },
    async createMessage(_channelId, input) {
      calls.createMessage += 1
      return message({
        author: bot(),
        content: input.content,
        nonce: input.nonce,
      })
    },
    async deleteMessage() {},
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
    async getGuildBan(_guildId, userId) {
      return { user: { id: userId, username: "target" } }
    },
    async getGuildChannels() {
      return [channel()]
    },
    async getGuildMember(): Promise<DiscordGuildMember> {
      return { roles: [] }
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
    async getMessage() {
      return message()
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
    async listJoinedPrivateArchivedThreads() {
      return { has_more: false, threads: [] }
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
    async removeGuildBan() {},
    async removeGuildMember() {
      calls.removeMember += 1
    },
    async searchGuildMessages() {
      return {
        doing_deep_historical_index: false,
        messages: [],
        total_results: 0,
      }
    },
  }
  Object.assign(client, overrides.client)
  const activityStore: ActivityStore = {
    async append() {},
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
      ...(overrides.operationStore ? { operationStore: overrides.operationStore } : {}),
      ...(overrides.interactionOptions
        ? { interactionOptions: overrides.interactionOptions }
        : {}),
      ...(overrides.roleAdministrationOptions
        ? { roleAdministrationOptions: overrides.roleAdministrationOptions }
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
