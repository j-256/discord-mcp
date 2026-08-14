import assert from "node:assert/strict"
import process from "node:process"
import test, { type TestContext } from "node:test"

import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

import {
  createDiscordMcpServer,
  runDiscordMcpServer,
  type DiscordToolService,
} from "../src/mcp.js"

const TOKEN = "test-discord-token"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const MESSAGE_ID = "300000000000000001"
const DIGEST = `hmac-sha256:${"a".repeat(64)}`
const DIFFERENT_DIGEST = `hmac-sha256:${"b".repeat(64)}`

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

function serviceFixture(overrides: {
  activityError?: Error
  messageContent?: string
  planDigest?: string
} = {}) {
  const calls = {
    delete: 0,
    plan: 0,
  }
  const service: DiscordToolService = {
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
    async getMessage() {
      return {
        channel: {
          guildId: GUILD_ID,
          id: CHANNEL_ID,
          lastMessageId: MESSAGE_ID,
          name: "general",
          nsfw: false,
          parentId: null,
          position: 1,
          thread: null,
          topic: null,
          type: 0,
          typeName: "guild-text",
        },
        guildId: GUILD_ID,
        message: {
          attachments: [],
          author: {
            bot: false,
            globalName: null,
            id: "400000000000000001",
            username: "member",
          },
          channelId: CHANNEL_ID,
          components: [],
          content: overrides.messageContent ?? "hello",
          editedTimestamp: null,
          embeds: [],
          flags: 0,
          guildId: GUILD_ID,
          id: MESSAGE_ID,
          mentionEveryone: false,
          mentionRoleIds: [],
          mentions: [],
          messageReference: null,
          pinned: false,
          reactions: [],
          referencedMessageId: null,
          timestamp: "2026-08-14T00:00:00.000Z",
          tts: false,
          type: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getStatus() {
      return {
        application: { id: "500000000000000001", name: "Connector" },
        auditFile: "/memory/activity.jsonl",
        bot: { id: "600000000000000001", username: "bot" },
        guildPage: { accessible: 1, inScope: 1 },
        policy: {
          allowedChannelIds: [],
          allowedGuildIds: [],
          deleteChannelIds: [],
          deletionsEnabled: false,
          readChannelScope: "all-visible",
          readGuildScope: "all-visible",
        },
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
    async readMessages() {
      return {
        channel: {
          guildId: GUILD_ID,
          id: CHANNEL_ID,
          lastMessageId: MESSAGE_ID,
          name: "general",
          nsfw: false,
          parentId: null,
          position: 1,
          thread: null,
          topic: null,
          type: 0,
          typeName: "guild-text",
        },
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
      "read_messages",
      "get_message",
      "plan_message_deletion",
      "delete_messages",
      "list_activity",
    ],
  )
  const deletion = result.tools.find((tool) => tool.name === "delete_messages")
  assert.deepEqual(deletion?.annotations, {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const activity = result.tools.find((tool) => tool.name === "list_activity")
  assert.equal(activity?.annotations?.openWorldHint, false)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
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

test("MCP stdio entrypoint negotiates without stdout noise", async (context) => {
  const transport = new StdioClientTransport({
    args: ["--import", "tsx", "src/mcp.ts"],
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
  const result = await client.listTools()

  assert.equal(result.tools.length, 8)
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
