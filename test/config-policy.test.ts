import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { loadConnectorConfig } from "../src/config.js"
import {
  DISCORD_CHANNEL_TYPES,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import { ConfigurationError, PolicyError } from "../src/errors.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordChannel } from "../src/types.js"

const TOKEN = "test-discord-token"
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
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
    DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
    DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
    DISCORD_MCP_ALLOW_PIN_MANAGEMENT: "true",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_BOT_ID: "300000000000000002",
    DISCORD_MCP_DELETE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_INTERACTION_CHANNEL_IDS: OTHER_CHANNEL_ID,
    DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE: "12",
    DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS: "750",
    DISCORD_MCP_MENTION_USER_IDS: USER_ID,
    DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_PIN_CHANNEL_IDS: CHANNEL_ID,
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
  assert.equal(config.allowAttachments, false)
  assert.deepEqual([...config.attachmentChannelIds], [])
  assert.deepEqual(config.attachmentRoots, [])
  assert.equal(config.allowDeletions, true)
  assert.equal(config.allowForumPosts, false)
  assert.deepEqual([...config.forumPostChannelIds], [])
  assert.equal(config.allowGateway, false)
  assert.equal(config.allowInteractions, true)
  assert.equal(config.allowMemberDirectory, true)
  assert.deepEqual([...config.memberDirectoryGuildIds], [GUILD_ID])
  assert.equal(config.allowPermissionOverwrites, true)
  assert.deepEqual([...config.permissionOverwriteChannelIds], [CHANNEL_ID])
  assert.equal(config.allowPinManagement, true)
  assert.deepEqual([...config.pinChannelIds], [CHANNEL_ID])
  assert.equal(config.allowRoleCreation, false)
  assert.deepEqual([...config.roleCreationGuildIds], [])
  assert.equal(config.interactionMaxWritesPerMinute, 12)
  assert.equal(config.interactionMinWriteIntervalMs, 750)
  assert.equal(config.expectedApplicationId, "300000000000000001")
  assert.equal(config.expectedBotId, "300000000000000002")
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
    attachmentChannelIds: [],
    attachmentMaxBytes: 10 * 1_024 * 1_024,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    memberDirectoryEnabled: false,
    memberDirectoryGuildIds: [],
    mentionUserCount: 0,
    mcpToolsets: ["connector", "messages"],
    mcpToolSurface: "progressive",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 0,
    pinChannelIds: [],
    pinManagementEnabled: false,
    readChannelScope: "all-visible",
    readGuildScope: "all-visible",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookDeletionsEnabled: false,
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
    DISCORD_MCP_BOT_ID: "300000000000000002",
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
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GATEWAY: "true",
      DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    },
    {
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GATEWAY: "true",
      DISCORD_MCP_APPLICATION_ID: "300000000000000001",
      DISCORD_MCP_BOT_ID: "300000000000000002",
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

test("configuration and policy isolate webhook audit and deletion authority", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
    DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(config)

  assert.equal(config.allowWebhookAudit, true)
  assert.equal(config.allowWebhookDeletions, true)
  assert.deepEqual([...config.webhookChannelIds], [CHANNEL_ID])
  assert.equal(enabled.assertChannelWebhookAuditable(channel()), GUILD_ID)
  assert.equal(enabled.assertChannelWebhookDeletable(channel()), GUILD_ID)
  assert.deepEqual(
    {
      webhookAuditEnabled: enabled.describe().webhookAuditEnabled,
      webhookChannelIds: enabled.describe().webhookChannelIds,
      webhookDeletionsEnabled: enabled.describe().webhookDeletionsEnabled,
    },
    {
      webhookAuditEnabled: true,
      webhookChannelIds: [CHANNEL_ID],
      webhookDeletionsEnabled: true,
    },
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelWebhookAuditable(channel()),
    /webhook audit is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertChannelWebhookAuditable(channel()),
    /requires an explicit channel allowlist/,
  )

  const deletionDisabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => deletionDisabled.assertChannelWebhookDeletable(channel()),
    /webhook deletion is disabled/,
  )
  assert.throws(
    () => enabled.assertChannelWebhookAuditable(channel({ id: OTHER_CHANNEL_ID })),
    /outside the webhook scope/,
  )
  assert.throws(
    () => enabled.assertChannelWebhookAuditable(channel({
      type: DISCORD_CHANNEL_TYPES.publicThread,
    })),
    /does not support webhook inventory/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
      DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /requires DISCORD_MCP_ALLOW_WEBHOOK_AUDIT/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_WEBHOOK_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /DISCORD_MCP_WEBHOOK_CHANNEL_IDS must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
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
    attachmentChannelIds: [],
    attachmentMaxBytes: 10 * 1_024 * 1_024,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    memberDirectoryEnabled: false,
    memberDirectoryGuildIds: [],
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 1,
    pinChannelIds: [],
    pinManagementEnabled: false,
    readChannelScope: "all-visible",
    readGuildScope: "all-visible",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookDeletionsEnabled: false,
  })
})

test("configuration and policy require an opt-in exact member-directory guild scope", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
    DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(policy.describe().memberDirectoryEnabled, true)
  assert.deepEqual(policy.describe().memberDirectoryGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertMemberDirectoryAllowed(GUILD_ID))
  assert.throws(
    () => policy.assertMemberDirectoryAllowed(OTHER_GUILD_ID),
    /outside the member-directory scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberDirectoryAllowed(GUILD_ID),
    /member directory is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertMemberDirectoryAllowed(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS must be a subset/,
  )
})

test("configuration and policy isolate exact channel creation authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: "999999999999999999",
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelCreationAllowed(GUILD_ID),
    /creation is disabled/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
    DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertChannelCreationAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertChannelCreationAllowed("999999999999999999"),
    /outside the channel creation scope/,
  )
  assert.equal(enabled.describe().channelCreationEnabled, true)
  assert.deepEqual(enabled.describe().channelCreationGuildIds, [GUILD_ID])

  const moderationOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => moderationOnly.assertChannelCreationAllowed(GUILD_ID),
    /creation is disabled/,
  )
})

test("configuration and policy isolate exact role creation authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ROLE_CREATION_GUILD_IDS: "999999999999999999",
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ROLE_CREATION_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertRoleCreationAllowed(GUILD_ID),
    /role creation is disabled/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_ROLE_CREATION: "true",
    DISCORD_MCP_ROLE_CREATION_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertRoleCreationAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertRoleCreationAllowed("999999999999999999"),
    /outside the role creation scope/,
  )
  assert.equal(enabled.describe().roleCreationEnabled, true)
  assert.deepEqual(enabled.describe().roleCreationGuildIds, [GUILD_ID])
})

test("configuration and policy isolate exact guild scaffold authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: "999999999999999999",
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildScaffoldAllowed(GUILD_ID),
    /guild scaffolds are disabled/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
    DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertGuildScaffoldAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertGuildScaffoldAllowed("999999999999999999"),
    /outside the guild scaffold scope/,
  )
  assert.equal(enabled.describe().guildScaffoldsEnabled, true)
  assert.deepEqual(enabled.describe().guildScaffoldGuildIds, [GUILD_ID])
})

test("configuration and policy isolate forum posts to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_FORUM_POST_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_FORUM_POST_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertForumPostAllowed(channel()),
    /forum posts are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_FORUM_POSTS: "true",
    DISCORD_MCP_FORUM_POST_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabledConfig.allowForumPosts, true)
  assert.deepEqual([...enabledConfig.forumPostChannelIds], [CHANNEL_ID])
  assert.equal(enabled.assertForumPostAllowed(channel()), GUILD_ID)
  assert.throws(
    () => enabled.assertForumPostAllowed(channel({ id: OTHER_CHANNEL_ID })),
    /outside the forum-post scope/,
  )
  assert.equal(enabled.describe().forumPostsEnabled, true)
  assert.deepEqual(enabled.describe().forumPostChannelIds, [CHANNEL_ID])
})

test("configuration and policy isolate pin management to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_PIN_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_PIN_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelPinManageable(channel()),
    /pin management is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_PIN_MANAGEMENT: "true",
    DISCORD_MCP_PIN_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabledConfig.allowPinManagement, true)
  assert.deepEqual([...enabledConfig.pinChannelIds], [CHANNEL_ID])
  assert.equal(enabled.assertChannelPinManageable(channel()), GUILD_ID)
  assert.throws(
    () => enabled.assertChannelPinManageable(channel({ id: OTHER_CHANNEL_ID })),
    /outside the pin-management scope/,
  )
  assert.equal(enabled.describe().pinManagementEnabled, true)
  assert.deepEqual(enabled.describe().pinChannelIds, [CHANNEL_ID])
})

test("configuration and policy isolate permission overwrites to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelPermissionOverwriteAllowed(channel()),
    /permission-overwrite changes are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
    DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabledConfig.allowPermissionOverwrites, true)
  assert.deepEqual([...enabledConfig.permissionOverwriteChannelIds], [CHANNEL_ID])
  assert.equal(enabled.assertChannelPermissionOverwriteAllowed(channel()), GUILD_ID)
  assert.throws(
    () => enabled.assertChannelPermissionOverwriteAllowed(channel({ id: OTHER_CHANNEL_ID })),
    /outside the permission-overwrite scope/,
  )
  assert.equal(enabled.describe().permissionOverwritesEnabled, true)
  assert.deepEqual(enabled.describe().permissionOverwriteChannelIds, [CHANNEL_ID])
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
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_BOT_ID: "not-an-id",
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
    attachmentChannelIds: [],
    attachmentMaxBytes: 10 * 1_024 * 1_024,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    deleteChannelIds: [CHANNEL_ID],
    deletionsEnabled: true,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    memberDirectoryEnabled: false,
    memberDirectoryGuildIds: [],
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 0,
    pinChannelIds: [],
    pinManagementEnabled: false,
    readChannelScope: "allowlist",
    readGuildScope: "allowlist",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookDeletionsEnabled: false,
  })
})

test("configuration and policy isolate guild expression audit, changes, and local creation roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-expression-"))
  const root = await realpath(temporary)
  try {
    const config = loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT: "true",
      DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES: "true",
      DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_GUILD_EXPRESSION_ROOTS: JSON.stringify([root]),
    }, { homeDirectory: "/test/home" })
    const scoped = new ScopePolicy(config)

    assert.equal(config.allowGuildExpressionAudit, true)
    assert.equal(config.allowGuildExpressionChanges, true)
    assert.deepEqual([...config.guildExpressionGuildIds], [GUILD_ID])
    assert.deepEqual(config.guildExpressionRoots, [root])
    scoped.assertGuildExpressionAuditable(GUILD_ID)
    scoped.assertGuildExpressionChangeAllowed(GUILD_ID)
    assert.throws(
      () => scoped.assertGuildExpressionAuditable(OTHER_GUILD_ID),
      /configured read scope/,
    )
    const description = scoped.describe()
    assert.equal(description.guildExpressionAuditEnabled, true)
    assert.equal(description.guildExpressionChangesEnabled, true)
    assert.equal(description.guildExpressionCreationEnabled, true)
    assert.equal(description.guildExpressionRootCount, 1)
    assert.equal(JSON.stringify(description).includes(root), false)

    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES: "true",
      }, { homeDirectory: "/test/home" }),
      /requires DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
        DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS: OTHER_GUILD_ID,
      }, { homeDirectory: "/test/home" }),
      /must be a subset/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_GUILD_EXPRESSION_ROOTS: "relative/path",
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration and policy isolate scheduled event audit, changes, and cover roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-event-"))
  const root = await realpath(temporary)
  try {
    const config = loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
      DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
      DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_SCHEDULED_EVENT_ROOTS: JSON.stringify([root]),
    }, { homeDirectory: "/test/home" })
    const scoped = new ScopePolicy(config)

    assert.equal(config.allowScheduledEventAudit, true)
    assert.equal(config.allowScheduledEventChanges, true)
    assert.deepEqual([...config.scheduledEventGuildIds], [GUILD_ID])
    assert.deepEqual(config.scheduledEventRoots, [root])
    scoped.assertScheduledEventAuditable(GUILD_ID)
    scoped.assertScheduledEventChangeAllowed(GUILD_ID)
    assert.throws(
      () => scoped.assertScheduledEventAuditable(OTHER_GUILD_ID),
      /configured read scope/,
    )
    const description = scoped.describe()
    assert.equal(description.scheduledEventAuditEnabled, true)
    assert.equal(description.scheduledEventChangesEnabled, true)
    assert.equal(description.scheduledEventCoverChangesEnabled, true)
    assert.equal(description.scheduledEventRootCount, 1)
    assert.equal(JSON.stringify(description).includes(root), false)

    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
      }, { homeDirectory: "/test/home" }),
      /requires DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
        DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS: OTHER_GUILD_ID,
      }, { homeDirectory: "/test/home" }),
      /must be a subset/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_SCHEDULED_EVENT_ROOTS: "relative/path",
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration and policy isolate local attachments to exact channels and roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-attachment-"))
  const root = await realpath(temporary)
  try {
    const linkedTarget = join(root, "linked-target")
    const linkedRoot = join(root, "linked-root")
    await mkdir(linkedTarget)
    await symlink(linkedTarget, linkedRoot)
    const config = loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ATTACHMENTS: "true",
      DISCORD_MCP_ATTACHMENT_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ATTACHMENT_MAX_BYTES: "2048",
      DISCORD_MCP_ATTACHMENT_ROOTS: JSON.stringify([root]),
    }, { homeDirectory: "/test/home" })
    const policy = new ScopePolicy(config)

    assert.equal(config.allowAttachments, true)
    assert.deepEqual([...config.attachmentChannelIds], [CHANNEL_ID])
    assert.deepEqual(config.attachmentRoots, [root])
    assert.equal(config.attachmentMaxBytes, 2_048)
    assert.equal(policy.assertChannelAttachmentAllowed(channel()), GUILD_ID)
    assert.throws(
      () => policy.assertChannelAttachmentAllowed(channel({ id: OTHER_CHANNEL_ID })),
      /outside the attachment scope/,
    )
    const description = policy.describe()
    assert.equal(description.attachmentsEnabled, true)
    assert.equal(description.attachmentRootCount, 1)
    assert.equal(JSON.stringify(description).includes(root), false)

    for (const environment of [
      { DISCORD_MCP_ATTACHMENT_CHANNEL_IDS: "999999999999999999" },
      { DISCORD_MCP_ATTACHMENT_MAX_BYTES: String(10 * 1_024 * 1_024 + 1) },
      { DISCORD_MCP_ATTACHMENT_ROOTS: "relative/path" },
      { DISCORD_MCP_ATTACHMENT_ROOTS: "[not-json" },
      { DISCORD_MCP_ATTACHMENT_ROOTS: JSON.stringify([root, root]) },
      { DISCORD_MCP_ATTACHMENT_ROOTS: linkedRoot },
      { DISCORD_MCP_ATTACHMENT_ROOTS: `${root}/` },
      { DISCORD_MCP_ATTACHMENT_ROOTS: "/" },
    ]) {
      assert.throws(
        () => loadConnectorConfig({
          DISCORD_BOT_TOKEN: TOKEN,
          DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
          ...environment,
        }, { homeDirectory: "/test/home" }),
        ConfigurationError,
      )
    }
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
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
