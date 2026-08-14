import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityStore } from "../src/activity-log.js"
import { loadConnectorConfig } from "../src/config.js"
import { ConfigurationError, PolicyError } from "../src/errors.js"
import {
  ConnectorService,
  type DiscordServiceClient,
} from "../src/service.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordMessage,
  DiscordUser,
} from "../src/types.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const MESSAGE_ID = "500000000000000001"

function application(id = APPLICATION_ID): DiscordApplication {
  return {
    bot: {
      bot: true,
      id: BOT_ID,
      username: "connector-bot",
    },
    description: "",
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

function channel(): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "general",
    position: 1,
    type: 0,
  }
}

function message(): DiscordMessage {
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
  }
}

function serviceFixture(overrides: {
  application?: DiscordApplication
  channel?: DiscordChannel
} = {}) {
  const calls = {
    application: 0,
    guilds: 0,
    listMessages: 0,
    user: 0,
  }
  const client: DiscordServiceClient = {
    async bulkDeleteMessages() {},
    async deleteMessage() {},
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
    async getGuildChannels() {
      return [channel()]
    },
    async getMessage() {
      return message()
    },
    async listCurrentUserGuilds() {
      calls.guilds += 1
      return [guild()]
    },
    async listMessages() {
      calls.listMessages += 1
      return [message()]
    },
  }
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
  }, { homeDirectory: "/test/home" })
  return {
    calls,
    service: new ConnectorService({ activityStore, client, config }),
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

test("service verifies identity once and reports scope without message reads", async () => {
  const { calls, service } = serviceFixture()

  const status = await service.getStatus()
  const guilds = await service.listGuilds({ limit: 10 })

  assert.equal(status.application.id, APPLICATION_ID)
  assert.equal(status.bot.id, BOT_ID)
  assert.equal(status.guildPage.accessible, 1)
  assert.equal(guilds.guilds[0]?.id, GUILD_ID)
  assert.equal(calls.application, 1)
  assert.equal(calls.user, 1)
  assert.equal(calls.guilds, 2)
  assert.equal(calls.listMessages, 0)
})

test("service normalizes channel messages after enforcing guild scope", async () => {
  const { service } = serviceFixture()

  const result = await service.readMessages(CHANNEL_ID, { limit: 10 })

  assert.equal(result.guildId, GUILD_ID)
  assert.equal(result.channel.id, CHANNEL_ID)
  assert.equal(result.messages[0]?.id, MESSAGE_ID)
  assert.equal(result.messages[0]?.content, "hello")
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
