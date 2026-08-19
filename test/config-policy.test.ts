import assert from "node:assert/strict"
import test from "node:test"

import { loadConnectorConfig } from "../src/config.js"
import { ConfigurationError, PolicyError } from "../src/errors.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordChannel } from "../src/types.js"

const TOKEN = "test-discord-token"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "general",
    type: 0,
    ...overrides,
  }
}

test("configuration requires the dedicated Discord bot token", () => {
  assert.throws(
    () => loadConnectorConfig({}, { homeDirectory: "/test/home" }),
    (error: unknown) => (
      error instanceof ConfigurationError
      && /DISCORD_BOT_TOKEN is required/.test(error.message)
    ),
  )
})

test("configuration parses bounded scope and deletion controls", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: `  ${TOKEN}  `,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID}, ${OTHER_CHANNEL_ID} ${CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_DELETIONS: "TRUE",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_DELETE_CHANNEL_IDS: CHANNEL_ID,
    XDG_STATE_HOME: "/test/state",
  }, { homeDirectory: "/test/home" })

  assert.equal(config.token, TOKEN)
  assert.deepEqual([...config.allowedChannelIds], [CHANNEL_ID, OTHER_CHANNEL_ID])
  assert.deepEqual([...config.allowedGuildIds], [GUILD_ID])
  assert.deepEqual([...config.deleteChannelIds], [CHANNEL_ID])
  assert.equal(config.allowDeletions, true)
  assert.equal(config.expectedApplicationId, "300000000000000001")
  assert.equal(config.auditFile, "/test/state/discord-mcp/activity.jsonl")
})

test("configuration rejects deletion channels outside a read channel allowlist", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_DELETE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    ConfigurationError,
  )
})

test("configuration rejects ambiguous deletion toggles and malformed IDs", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_DELETIONS: "yes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_APPLICATION_ID: "not-an-id",
    }, { homeDirectory: "/test/home" }),
    /must contain Discord snowflake IDs/,
  )
})

test("scope policy allows visible reads by default but rejects direct messages", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)
  const directMessage = channel()
  delete directMessage.guild_id

  assert.equal(policy.assertChannelReadable(channel()), GUILD_ID)
  assert.throws(
    () => policy.assertChannelReadable(directMessage),
    PolicyError,
  )
  assert.throws(
    () => policy.assertChannelDeletable(channel()),
    /deletion is disabled/,
  )
})

test("scope policy enforces guild, read channel, and deletion channel allowlists", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_DELETIONS: "true",
    DISCORD_MCP_DELETE_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(policy.assertChannelDeletable(channel()), GUILD_ID)
  assert.throws(
    () => policy.assertChannelDeletable(channel({ id: OTHER_CHANNEL_ID })),
    /outside the deletion scope/,
  )
  assert.throws(
    () => policy.assertChannelReadable(channel({ guild_id: "999999999999999999" })),
    /outside the configured read scope/,
  )
  assert.deepEqual(policy.describe(), {
    allowedChannelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    allowedGuildIds: [GUILD_ID],
    deleteChannelIds: [CHANNEL_ID],
    deletionsEnabled: true,
    readChannelScope: "allowlist",
    readGuildScope: "allowlist",
  })
})

test("scope policy inherits parent read scope for threads but keeps deletion exact-ID gated", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_DELETIONS: "true",
    DISCORD_MCP_DELETE_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)
  const thread = channel({
    id: OTHER_CHANNEL_ID,
    parent_id: CHANNEL_ID,
    type: 11,
  })

  assert.equal(policy.assertChannelReadable(thread), GUILD_ID)
  assert.deepEqual(policy.filterChannels([channel(), thread]), [channel(), thread])
  assert.throws(
    () => policy.assertChannelDeletable(thread),
    /outside the deletion scope/,
  )
})

test("scope policy attenuates native search to exact configured channel IDs", () => {
  const thirdChannelId = "200000000000000003"
  const scoped = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${OTHER_CHANNEL_ID},${CHANNEL_ID}`,
  }, { homeDirectory: "/test/home" }))
  const open = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))

  assert.deepEqual(
    scoped.constrainSearchChannelIds(undefined, 500),
    [CHANNEL_ID, OTHER_CHANNEL_ID],
  )
  assert.deepEqual(
    scoped.constrainSearchChannelIds([OTHER_CHANNEL_ID], 500),
    [OTHER_CHANNEL_ID],
  )
  assert.throws(
    () => scoped.constrainSearchChannelIds([thirdChannelId], 500),
    /outside the exact configured search scope/,
  )
  assert.throws(
    () => scoped.constrainSearchChannelIds(undefined, 1),
    /provide an exact subset/,
  )
  assert.equal(open.constrainSearchChannelIds(undefined, 500), undefined)
  assert.deepEqual(
    open.constrainSearchChannelIds([thirdChannelId], 500),
    [thirdChannelId],
  )
})
