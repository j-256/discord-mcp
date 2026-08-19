import assert from "node:assert/strict"
import process from "node:process"
import test, { type TestContext } from "node:test"

import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

import {
  AdministrationExecutionError,
  DiscordApiError,
  InteractionExecutionError,
  InteractionRateLimitError,
} from "../src/errors.js"
import {
  createDiscordMcpServer,
  runDiscordMcpServer,
  type DiscordToolService,
} from "../src/mcp.js"
import { normalizeChannel, normalizeMessage } from "../src/normalize.js"
import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
} from "../src/permissions.js"
import type { PolicyDescription } from "../src/policy.js"
import type { DiscordChannel, DiscordMessage } from "../src/types.js"

const TOKEN = "test-discord-token"
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000
const STATIC_RESOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const MESSAGE_ID = "300000000000000001"
const USER_ID = "400000000000000001"
const AUDIT_REASON = "Reviewed safety incident 42"
const DIGEST = `hmac-sha256:${"a".repeat(64)}`
const DIFFERENT_DIGEST = `hmac-sha256:${"b".repeat(64)}`

function rawChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    last_message_id: MESSAGE_ID,
    name: "general",
    nsfw: false,
    parent_id: null,
    permission_overwrites: [],
    position: 1,
    type: 0,
    ...overrides,
  }
}

function rawMessage(content = "hello"): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: false,
      global_name: null,
      id: "400000000000000001",
      username: "member",
    },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    edited_timestamp: null,
    embeds: [],
    flags: 0,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    reactions: [],
    timestamp: "2026-08-14T00:00:00.000Z",
    tts: false,
    type: 0,
  }
}

function plan(digest = DIGEST) {
  return {
    channelId: CHANNEL_ID,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guildId: GUILD_ID,
    messageIds: [MESSAGE_ID],
    messages: [{
      attachmentFilenames: [],
      author: {
        bot: false,
        globalName: null,
        id: "400000000000000001",
        username: "member",
      },
      contentLength: 5,
      contentPreview: "hello",
      editedTimestamp: null,
      id: MESSAGE_ID,
      timestamp: "2026-08-14T00:00:00.000Z",
      truncated: false,
    }],
    operations: [{
      kind: "individual" as const,
      messageIds: [MESSAGE_ID],
    }],
    schemaVersion: 1,
    status: "planned" as const,
  }
}

function moderationPlan(digest = DIGEST) {
  return {
    action: "kick" as const,
    auditReason: AUDIT_REASON,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guildId: GUILD_ID,
    parameters: {
      deleteMessageSeconds: null,
      durationMinutes: null,
      estimatedTimeoutUntil: null,
    },
    permission: {
      botAdministrator: false,
      botHighestRolePosition: 2,
      required: "KICK_MEMBERS" as const,
      targetAdministrator: false,
      targetHighestRolePosition: 1,
    },
    schemaVersion: 1,
    status: "planned" as const,
    target: {
      banState: "not-banned" as const,
      bot: false,
      currentTimeoutUntil: null,
      globalName: null,
      id: USER_ID,
      membership: "member" as const,
      nickname: null,
      username: "member",
    },
  }
}

function fixturePolicy(): PolicyDescription {
  return {
    administrationEnabled: false,
    administrationGuildIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    mentionUserCount: 0,
    protectedUserCount: 0,
    readChannelScope: "all-visible",
    readGuildScope: "all-visible",
  }
}

function serviceFixture(overrides: {
  administrationError?: Error
  activityError?: Error
  interactionError?: Error
  messageContent?: string
  planDigest?: string
} = {}) {
  const calls = {
    active: 0,
    addReaction: 0,
    archived: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    delete: 0,
    edit: 0,
    explain: 0,
    plan: 0,
    search: 0,
    send: 0,
  }
  const service: DiscordToolService = {
    async addReaction(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.addReaction += 1
      return {
        activityId: "activity-reaction",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async deleteMessages(channelId, messageIds, planDigest) {
      calls.delete += 1
      return {
        activityId: "activity-one",
        channelId,
        deletedMessageIds: [...messageIds],
        guildId: GUILD_ID,
        planDigest,
        schemaVersion: 1,
        status: "completed",
      }
    },
    describePolicy: fixturePolicy,
    async executeMemberModeration(request, planDigest) {
      if (overrides.administrationError) throw overrides.administrationError
      calls.administrationExecute += 1
      return {
        action: request.action,
        activityId: "activity-moderation",
        guildId: request.guildId,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        timeoutUntil: null,
        userId: request.userId,
      }
    },
    async explainChannelAccess(channelId) {
      calls.explain += 1
      const discordChannel = rawChannel({ id: channelId })
      return {
        botId: "600000000000000001",
        channel: normalizeChannel(discordChannel),
        guildId: GUILD_ID,
        permissions: evaluateBotChannelPermissions({
          botId: "600000000000000001",
          channel: discordChannel,
          guildId: GUILD_ID,
          member: { roles: [] },
          permissionChannel: discordChannel,
          roles: [{
            id: GUILD_ID,
            managed: false,
            name: "@everyone",
            permissions: (
              DISCORD_PERMISSIONS.VIEW_CHANNEL
              | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            ).toString(),
            position: 0,
          }],
        }),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async editOwnMessage(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.edit += 1
      return {
        activityId: "activity-edit",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async getMessage() {
      return {
        channel: normalizeChannel(rawChannel()),
        guildId: GUILD_ID,
        message: normalizeMessage(rawMessage(overrides.messageContent), GUILD_ID),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getStatus() {
      return {
        application: {
          id: "500000000000000001",
          messageContentIntent: "enabled" as const,
          name: "Connector",
        },
        auditFile: "/memory/activity.jsonl",
        bot: { id: "600000000000000001", username: "bot" },
        guildPage: { accessible: 1, inScope: 1 },
        policy: fixturePolicy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listActivity() {
      if (overrides.activityError) throw overrides.activityError
      return {
        entries: [],
        file: "/memory/activity.jsonl",
        skippedLines: 0,
      }
    },
    async listActiveThreads(guildId, options) {
      calls.active += 1
      return {
        guildId,
        page: {
          requestedLimit: options?.limit ?? 50,
          returned: 0,
          totalVisible: 0,
          truncated: false,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
      }
    },
    async listArchivedThreads(channelId, options) {
      calls.archived += 1
      const visibility = options?.visibility ?? "public"
      return {
        channel: normalizeChannel(rawChannel({ id: channelId })),
        guildId: GUILD_ID,
        page: {
          hasMore: false,
          nextCursor: null,
          requestedLimit: options?.limit ?? null,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
        visibility,
      }
    },
    async listChannels(guildId) {
      return {
        channels: [],
        guildId,
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuilds() {
      return {
        guilds: [],
        page: {
          after: null,
          before: null,
          requestedLimit: 200,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async planMessageDeletion() {
      calls.plan += 1
      return plan(overrides.planDigest)
    },
    async planMemberModeration() {
      calls.administrationPlan += 1
      return moderationPlan(overrides.planDigest || DIGEST)
    },
    async readMessages() {
      return {
        channel: normalizeChannel(rawChannel()),
        guildId: GUILD_ID,
        messages: [],
        page: {
          after: null,
          around: null,
          before: null,
          requestedLimit: 50,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async searchMessages(guildId, options) {
      calls.search += 1
      return {
        documentsIndexed: null,
        doingDeepHistoricalIndex: false,
        guildId,
        messages: [],
        page: {
          nextOffset: null,
          offset: options?.offset ?? 0,
          requestedLimit: options?.limit ?? 25,
          returned: 0,
          totalResultsEstimate: 0,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
      }
    },
    async sendMessage(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.send += 1
      return {
        activityId: "activity-send",
        channelId: input.channelId,
        guildId: GUILD_ID,
        localReplay: false,
        messageId: MESSAGE_ID,
        nonce: "stable-nonce",
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${MESSAGE_ID}`,
      }
    },
  }
  return { calls, service }
}

async function connectedFixture(
  context: TestContext,
  options: {
    elicitationHandler?: (request: {
      params: {
        message: string
        requestedSchema: {
          properties: Record<string, unknown>
          required?: string[]
        }
      }
    }) => Promise<{
      action: "accept" | "cancel" | "decline"
      content?: { approve: boolean }
    }>
    serviceOverrides?: Parameters<typeof serviceFixture>[0]
  } = {},
) {
  const serviceData = serviceFixture(options.serviceOverrides)
  const server = createDiscordMcpServer({
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    requestStateKey: new Uint8Array(32).fill(9),
    service: serviceData.service,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client(
    { name: "discord-mcp-test", version: "1.0.0" },
    { capabilities: { elicitation: {} } },
  )
  if (options.elicitationHandler) {
    client.setRequestHandler(
      "elicitation/create",
      options.elicitationHandler as never,
    )
  }
  await client.connect(clientTransport)
  context.after(async () => {
    try {
      await client.close()
    } catch {}
    try {
      await server.close()
    } catch {}
  })
  return {
    client,
    ...serviceData,
  }
}

function structuredContent(result: { structuredContent?: unknown }): Record<string, unknown> {
  assert.ok(result.structuredContent)
  return result.structuredContent as Record<string, unknown>
}

test("MCP server advertises bounded tools with accurate write annotations", async (context) => {
  const { client } = await connectedFixture(context)

  const result = await client.listTools()

  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    [
      "get_connector_status",
      "list_guilds",
      "list_channels",
      "list_active_threads",
      "list_archived_threads",
      "explain_channel_access",
      "read_messages",
      "search_messages",
      "get_message",
      "send_message",
      "edit_own_message",
      "add_reaction",
      "plan_message_deletion",
      "delete_messages",
      "plan_member_moderation",
      "execute_member_moderation",
      "list_activity",
    ],
  )
  const deletion = result.tools.find((tool) => tool.name === "delete_messages")
  const administration = result.tools.find((tool) => (
    tool.name === "execute_member_moderation"
  ))
  for (const tool of [deletion, administration]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
  const administrationPlan = result.tools.find((tool) => (
    tool.name === "plan_member_moderation"
  ))
  assert.deepEqual(administrationPlan?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const send = result.tools.find((tool) => tool.name === "send_message")
  const reaction = result.tools.find((tool) => tool.name === "add_reaction")
  for (const tool of [send, reaction]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
  const edit = result.tools.find((tool) => tool.name === "edit_own_message")
  assert.deepEqual(edit?.annotations, {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const activity = result.tools.find((tool) => tool.name === "list_activity")
  assert.equal(activity?.annotations?.openWorldHint, false)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("MCP message search requires a substantive filter and forwards bounded input", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const valid = await client.callTool({
    arguments: {
      content: "deploy",
      guildId: GUILD_ID,
      limit: 12,
      sortBy: "timestamp",
    },
    name: "search_messages",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "search_messages",
  })

  assert.equal(structuredContent(valid).status, "ok")
  assert.equal(calls.search, 1)
  assert.equal(invalid.isError, true)
  assert.equal(calls.search, 1)
})

test("MCP thread and permission tools validate cursors and invoke read-only services", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const active = await client.callTool({
    arguments: {
      guildId: GUILD_ID,
      limit: 3,
      parentChannelId: CHANNEL_ID,
    },
    name: "list_active_threads",
  })
  const archived = await client.callTool({
    arguments: {
      beforeTimestamp: "2026-08-14T00:00:00.000Z",
      channelId: CHANNEL_ID,
      limit: 4,
      visibility: "public",
    },
    name: "list_archived_threads",
  })
  const invalidCursor = await client.callTool({
    arguments: {
      beforeTimestamp: "not-an-iso-timestamp",
      channelId: CHANNEL_ID,
      visibility: "public",
    },
    name: "list_archived_threads",
  })
  const access = await client.callTool({
    arguments: { channelId: CHANNEL_ID },
    name: "explain_channel_access",
  })

  assert.equal(structuredContent(active).status, "ok")
  assert.equal(structuredContent(archived).status, "ok")
  assert.equal(invalidCursor.isError, true)
  assert.equal(structuredContent(access).status, "ok")
  assert.deepEqual(calls, {
    active: 1,
    addReaction: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    archived: 1,
    delete: 0,
    edit: 0,
    explain: 1,
    plan: 0,
    search: 0,
    send: 0,
  })
})

test("MCP interaction tools enforce bounded schemas and invoke idempotent services", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const sent = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const edited = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "replacement",
      messageId: MESSAGE_ID,
    },
    name: "edit_own_message",
  })
  const reacted = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    },
    name: "add_reaction",
  })
  const invalid = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "unsafe retry key",
      idempotencyKey: "short",
    },
    name: "send_message",
  })

  assert.equal(structuredContent(sent).status, "completed")
  assert.equal(structuredContent(edited).status, "completed")
  assert.equal(structuredContent(reacted).status, "completed")
  assert.equal(invalid.isError, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.edit, 1)
  assert.equal(calls.addReaction, 1)
})

test("MCP interaction errors expose local retry timing without secrets", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionRateLimitError(750),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const structured = structuredContent(result)

  assert.equal(result.isError, true)
  assert.equal(structured.status, "rate-limited")
  assert.equal((structured.error as Record<string, unknown>).retryAfterMs, 750)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("MCP interaction errors preserve Discord rate-limit timing", async (context) => {
  const discordError = new DiscordApiError({
    message: "Discord rate limit",
    method: "POST",
    retryAfterMs: 1_250,
    route: `/channels/${CHANNEL_ID}/messages`,
    status: 429,
  })
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionExecutionError(
        "Discord interaction did not complete with a verified outcome",
        {
          activityId: "activity-rate-limit",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          messageId: null,
          retryAfterMs: 1_250,
          schemaVersion: 1,
          status: "failed",
        },
        { cause: discordError },
      ),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const structured = structuredContent(result)

  assert.equal(result.isError, true)
  assert.equal(structured.status, "rate-limited")
  assert.equal((structured.error as Record<string, unknown>).retryAfterMs, 1_250)
})

test("MCP interaction errors distinguish uncertain external outcomes", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionExecutionError(
        "Discord interaction outcome is uncertain",
        {
          activityId: "activity-uncertain",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          messageId: null,
          retryAfterMs: null,
          schemaVersion: 1,
          status: "uncertain",
        },
      ),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })

  assert.equal(result.isError, true)
  assert.equal(structuredContent(result).status, "outcome-uncertain")
})

test("MCP deletion elicits exact confirmation before invoking the write service", async (context) => {
  let confirmationMessage = ""
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.plan, 1)
  assert.equal(calls.delete, 1)
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Content: "hello"/)
  assert.match(confirmationMessage, new RegExp(DIGEST))
})

test("MCP deletion stops without writing when confirmation is declined", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "confirmation-declined")
  assert.equal(calls.delete, 0)
})

test("MCP deletion rejects an accepted confirmation without approval", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(calls.delete, 0)
})

test("MCP deletion refuses a changed plan before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { planDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.delete, 0)
})

test("MCP member moderation plans exact targets and enforces action-specific schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })
  const invalid = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      deleteMessageSeconds: 0,
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })
  const oversizedReason = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: "é".repeat(200),
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(calls.administrationPlan, 1)
  assert.equal(invalid.isError, true)
  assert.equal(oversizedReason.isError, true)
  assert.equal(calls.administrationPlan, 1)
})

test("MCP member moderation binds signed confirmation to target, action, reason, and digest", async (context) => {
  let confirmationMessage = ""
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
  })

  const result = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.administrationPlan, 1)
  assert.equal(calls.administrationExecute, 1)
  assert.match(confirmationMessage, /Action: kick/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
})

test("MCP member moderation declines or rejects approval without invoking execution", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.administrationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.administrationExecute, 0)
})

test("MCP member moderation refuses a changed plan before eliciting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { planDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.administrationExecute, 0)
})

test("MCP member moderation reports uncertain and rate-limited execution outcomes", async (context) => {
  const uncertain = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: true },
    }),
    serviceOverrides: {
      administrationError: new AdministrationExecutionError(
        "Discord moderation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "DELETE",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/members/${USER_ID}`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: true },
    }),
    serviceOverrides: {
      administrationError: new AdministrationExecutionError(
        "Discord moderation was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  const limitedStructured = structuredContent(limitedResult)
  assert.equal(limitedStructured.status, "rate-limited")
  assert.equal(
    (limitedStructured.error as Record<string, unknown>).retryAfterMs,
    2_500,
  )
})

test("MCP tool errors redact the Discord token", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      activityError: new Error(`activity failed with ${TOKEN}`),
    },
  })

  const result = await client.callTool({
    arguments: {},
    name: "list_activity",
  })

  assert.equal(result.isError, true)
  assert.equal(structuredContent(result).status, "error")
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.match(JSON.stringify(result), /\[redacted\]/)
})

test("MCP tool results redact the Discord token if Discord returns it as data", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      messageContent: `message containing ${TOKEN}`,
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    },
    name: "get_message",
  })

  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.match(JSON.stringify(result), /\[redacted\]/)
})

test("MCP stdio entrypoint negotiates modern catalogs without stdout noise", async (context) => {
  const transport = new StdioClientTransport({
    args: ["--import", "tsx", "src/cli.ts", "serve"],
    command: process.execPath,
    cwd: process.cwd(),
    env: {
      DISCORD_BOT_TOKEN: TOKEN,
      PATH: process.env.PATH || "",
    },
    stderr: "pipe",
  })
  let diagnostics = ""
  transport.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk)
  })
  const client = new Client(
    { name: "discord-mcp-stdio-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    try {
      await client.close()
    } catch {}
  })

  await client.connect(transport)
  const [tools, prompts, resources, templates, safety] = await Promise.all([
    client.listTools(),
    client.listPrompts(),
    client.listResources(),
    client.listResourceTemplates(),
    client.readResource({ uri: "discord://connector/safety" }),
  ])

  assert.equal(tools.tools.length, 17)
  assert.equal(prompts.prompts.length, 4)
  assert.equal(resources.resources.length, 4)
  assert.equal(templates.resourceTemplates.length, 3)
  for (const catalog of [tools, prompts, resources, templates]) {
    assert.equal(catalog.cacheScope, "public")
    assert.equal(catalog.ttlMs, CATALOG_CACHE_TTL_MS)
  }
  assert.equal(safety.cacheScope, "public")
  assert.equal(safety.ttlMs, STATIC_RESOURCE_CACHE_TTL_MS)
  assert.match(diagnostics, /stdio server ready/)
  assert.doesNotMatch(diagnostics, new RegExp(TOKEN))
})

test("MCP stdio startup fails before reporting ready when the token is absent", () => {
  let diagnostics = ""

  assert.throws(
    () => runDiscordMcpServer({
      environment: {},
      stderr: {
        write(value) {
          diagnostics += String(value)
          return true
        },
      },
    }),
    /DISCORD_BOT_TOKEN is required/,
  )
  assert.equal(diagnostics, "")
})
