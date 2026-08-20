import assert from "node:assert/strict"
import test from "node:test"

import { loadConnectorConfig } from "../src/config.js"
import { MCP_TOOLSET_NAMES } from "../src/constants.js"
import { ConfigurationError, PolicyError } from "../src/errors.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordChannel } from "../src/types.js"

const TOKEN = "test-discord-token"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const USER_ID = "400000000000000001"

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
    DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
    DISCORD_MCP_ALLOW_DELETIONS: "TRUE",
    DISCORD_MCP_ALLOW_INTERACTIONS: "true",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_DELETE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_INTERACTION_CHANNEL_IDS: OTHER_CHANNEL_ID,
    DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE: "12",
    DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "750",
    DISCORD_MCP_MENTION_USER_IDS: USER_ID,
    DISCORD_MCP_PROTECTED_USER_IDS: USER_ID,
    XDG_STATE_HOME: "/test/state",
  }, { homeDirectory: "/test/home" })

  assert.equal(config.token, TOKEN)
  assert.deepEqual([...config.allowedChannelIds], [CHANNEL_ID, OTHER_CHANNEL_ID])
  assert.deepEqual([...config.allowedGuildIds], [GUILD_ID])
  assert.deepEqual([...config.adminGuildIds], [GUILD_ID])
  assert.deepEqual([...config.deleteChannelIds], [CHANNEL_ID])
  assert.deepEqual([...config.interactionChannelIds], [OTHER_CHANNEL_ID])
  assert.deepEqual([...config.mentionUserIds], [USER_ID])
  assert.deepEqual([...config.protectedUserIds], [USER_ID])
  assert.equal(config.allowAdministration, true)
  assert.equal(config.allowDeletions, true)
  assert.equal(config.allowGateway, false)
  assert.equal(config.allowInteractions, true)
  assert.equal(config.interactionMaxWritesPerMinute, 12)
  assert.equal(config.interactionMinWriteIntervalMs, 750)
  assert.equal(config.expectedApplicationId, "300000000000000001")
  assert.equal(config.gatewayEventBufferSize, 100)
  assert.equal(config.mcpToolSurface, "full")
  assert.deepEqual([...config.mcpToolsets], MCP_TOOLSET_NAMES)
  assert.deepEqual(config.observability, {
    export: undefined,
    exportEnabled: false,
    jsonLogsEnabled: false,
  })
  assert.equal(config.auditFile, "/test/state/discord-mcp/activity.jsonl")
})

test("configuration strictly parses the MCP tool surface and risk-separated toolsets", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_TOOLSETS: " Messages,connector,messages ",
    DISCORD_MCP_TOOL_SURFACE: " PROGRESSIVE ",
  }, { homeDirectory: "/test/home" })

  assert.equal(config.mcpToolSurface, "progressive")
  assert.deepEqual([...config.mcpToolsets].sort(), ["connector", "messages"])
  assert.deepEqual(new ScopePolicy(config).describe(), {
    administrationEnabled: false,
    administrationGuildIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    mentionUserCount: 0,
    mcpToolsets: ["connector", "messages"],
    mcpToolSurface: "progressive",
    protectedUserCount: 0,
    readChannelScope: "all-visible",
    readGuildScope: "all-visible",
  })

  for (const environment of [
    { DISCORD_MCP_TOOL_SURFACE: "hidden" },
    { DISCORD_MCP_TOOLSETS: "messages,all" },
    { DISCORD_MCP_TOOLSETS: "messages,unknown" },
    { DISCORD_MCP_TOOLSETS: ",,," },
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        ...environment,
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  }
})

test("configuration keeps Gateway disabled and requires pinned bounded scope when enabled", () => {
  const enabled = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE: "250",
  }, { homeDirectory: "/test/home" })
  assert.equal(enabled.allowGateway, true)
  assert.equal(enabled.gatewayEventBufferSize, 250)

  for (const environment of [
    {
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GATEWAY: "true",
    },
    {
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GATEWAY: "true",
      DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    },
  ]) {
    assert.throws(
      () => loadConnectorConfig(environment, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  }
  for (const value of ["0", "1001", "1.5"]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE: value,
      }, { homeDirectory: "/test/home" }),
      /must be an integer between 1 and 1000/,
    )
  }
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

test("configuration and policy require an exact administration guild and protect exact users", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ADMIN_GUILD_IDS: "999999999999999999",
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberAdministrationAllowed(GUILD_ID, USER_ID),
    /administration is disabled/,
  )

  const policy = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
    DISCORD_MCP_PROTECTED_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => policy.assertMemberAdministrationAllowed(GUILD_ID, USER_ID),
    /protected from administration/,
  )
  policy.assertMemberAdministrationAllowed(GUILD_ID, "400000000000000002")
  assert.throws(
    () => policy.assertMemberAdministrationAllowed(
      "999999999999999999",
      "400000000000000002",
    ),
    /outside the administration scope/,
  )
  assert.deepEqual(policy.describe(), {
    administrationEnabled: true,
    administrationGuildIds: [GUILD_ID],
    allowedChannelIds: [],
    allowedGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    protectedUserCount: 1,
    readChannelScope: "all-visible",
    readGuildScope: "all-visible",
  })
})

test("configuration rejects interaction channels outside exact read scope and invalid guard limits", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_INTERACTION_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  const invalidLimits: Array<[string, string]> = [
    ["DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE", "0"],
    ["DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE", "1.5"],
    ["DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS", "60001"],
  ]
  for (const [name, value] of invalidLimits) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        [name]: value,
      }, { homeDirectory: "/test/home" }),
      /must be an integer between/,
    )
  }
  const tooManyMentionUsers = Array.from(
    { length: 101 },
    (_value, index) => String(500000000000000000n + BigInt(index)),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_MENTION_USER_IDS: tooManyMentionUsers,
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_PROTECTED_USER_IDS: tooManyMentionUsers,
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
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
    administrationEnabled: false,
    administrationGuildIds: [],
    allowedChannelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    allowedGuildIds: [GUILD_ID],
    deleteChannelIds: [CHANNEL_ID],
    deletionsEnabled: true,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    protectedUserCount: 0,
    readChannelScope: "allowlist",
    readGuildScope: "allowlist",
  })
})

test("scope policy requires exact interaction channels and exact notification users", () => {
  const policy = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_INTERACTIONS: "true",
    DISCORD_MCP_INTERACTION_CHANNEL_IDS: OTHER_CHANNEL_ID,
    DISCORD_MCP_MENTION_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" }))

  assert.equal(policy.assertChannelInteractable(channel({ id: OTHER_CHANNEL_ID })), GUILD_ID)
  assert.throws(
    () => policy.assertChannelInteractable(channel()),
    /outside the interaction scope/,
  )
  policy.assertNotificationUsers([USER_ID])
  assert.throws(
    () => policy.assertNotificationUsers(["400000000000000002"]),
    /outside the notification scope/,
  )
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
