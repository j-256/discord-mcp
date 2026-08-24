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

import {
  resolveConnectorConfigDocumentAuditFile,
} from "../src/config.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import {
  ConfigDocumentError,
  ConfigurationError,
  PolicyError,
} from "../src/errors.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordChannel } from "../src/types.js"
import {
  fixtureConfigInput,
  loadFixtureConfig as loadConnectorConfig,
} from "./config-fixture.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "900000000000000001"
const BOT_ID = "900000000000000002"
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const ROLE_ID = "300000000000000001"
const OTHER_ROLE_ID = "300000000000000002"
const USER_ID = "400000000000000001"
const INTEGRATION_ID = "500000000000000001"
const OTHER_INTEGRATION_ID = "500000000000000002"

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
      error instanceof ConfigDocumentError
      && /\.credential requires DISCORD_BOT_TOKEN/.test(error.message)
    ),
  )
})

test("credential-free activity-state resolution is absolute and lexical-canonical", () => {
  const fixture = fixtureConfigInput({})
  assert.equal(
    resolveConnectorConfigDocumentAuditFile(
      fixture.document,
      { XDG_STATE_HOME: "relative-state" },
      { homeDirectory: "/test/home" },
    ),
    "/test/home/.local/state/discord-mcp/activity.jsonl",
  )
  assert.equal(
    loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_AUDIT_FILE: "/test/shared/activity.jsonl",
    }).auditFile,
    "/test/shared/activity.jsonl",
  )
})

test("configuration parses bounded scope and deletion controls", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: `  ${TOKEN}  `,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID}, ${OTHER_CHANNEL_ID} ${CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS: "true",
    DISCORD_MCP_ALLOW_BAN_AUDIT: "true",
    DISCORD_MCP_ALLOW_DELETIONS: "TRUE",
    DISCORD_MCP_ALLOW_INTERACTIONS: "true",
    DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
    DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
    DISCORD_MCP_ALLOW_PIN_MANAGEMENT: "true",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_BAN_AUDIT_GUILD_IDS: GUILD_ID,
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
  assert.equal(config.allowAnnouncementCrossposts, true)
  assert.deepEqual([...config.announcementCrosspostChannelIds], [CHANNEL_ID])
  assert.equal(config.allowAttachments, false)
  assert.equal(config.allowBanAudit, true)
  assert.deepEqual([...config.banAuditGuildIds], [GUILD_ID])
  assert.deepEqual([...config.attachmentChannelIds], [])
  assert.deepEqual(config.attachmentRoots, [])
  assert.equal(config.allowDeletions, true)
  assert.equal(config.allowForumPosts, false)
  assert.deepEqual([...config.forumPostChannelIds], [])
  assert.equal(config.allowGateway, false)
  assert.equal(config.allowInteractions, true)
  assert.equal(config.allowMemberDirectory, true)
  assert.deepEqual([...config.memberDirectoryGuildIds], [GUILD_ID])
  assert.equal(config.allowNicknameChanges, false)
  assert.equal(config.allowOtherMemberNicknameChanges, false)
  assert.deepEqual([...config.nicknameGuildIds], [])
  assert.equal(config.allowMemberRoleChanges, false)
  assert.deepEqual([...config.memberRoleGuildIds], [])
  assert.deepEqual([...config.memberRoleIds], [])
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
    applicationEmojiAuditEnabled: false,
    applicationEmojiChangesEnabled: false,
    applicationEmojiCreationEnabled: false,
    applicationEmojiRootCount: 0,
    announcementCrosspostChannelIds: [],
    announcementCrosspostsEnabled: false,
    announcementSubscriptionAuditEnabled: false,
    announcementSubscriptionChangesEnabled: false,
    announcementSubscriptionSourceChannelIds: [],
    announcementSubscriptionTargetChannelIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [GUILD_ID],
    attachmentChannelIds: [],
    attachmentMaxBytes: 10 * 1_024 * 1_024,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    automodAlertChannelIds: [],
    automodAuditEnabled: false,
    automodChangesEnabled: false,
    automodGuildIds: [],
    banAuditEnabled: false,
    banAuditGuildIds: [],
    channelCloneAuditEnabled: false,
    channelCloneGuildIds: [],
    channelCloneSourceIds: [],
    channelCloningEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    channelDeletionAuditEnabled: false,
    channelDeletionIds: [],
    channelDeletionsEnabled: false,
    channelMetadataChangesEnabled: false,
    channelMetadataIds: [],
    channelOrderingAuditEnabled: false,
    channelOrderingChangesEnabled: false,
    channelOrderingGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    forumTagAuditEnabled: false,
    forumTagChangesEnabled: false,
    forumTagChannelIds: [],
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildTemplateAuditEnabled: false,
    guildTemplateChangesEnabled: false,
    guildTemplateGuildIds: [],
    integrationAuditEnabled: false,
    integrationDeletionsEnabled: false,
    integrationGuildIds: [],
    integrationIds: [],
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    guildProfileAuditEnabled: false,
    guildProfileChangesEnabled: false,
    guildProfileGuildIds: [],
    guildSettingsAuditEnabled: false,
    guildSettingsChangesEnabled: false,
    guildSettingsGuildIds: [],
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    scheduledEventUserAuditEnabled: false,
    soundboardAuditEnabled: false,
    soundboardChangesEnabled: false,
    soundboardCreationEnabled: false,
    soundboardGuildIds: [],
    soundboardRootCount: 0,
    stageChannelIds: [],
    stageInstanceAuditEnabled: false,
    stageInstanceChangesEnabled: false,
    stageStartNotificationsEnabled: false,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    inviteAuditEnabled: false,
    inviteDeletionsEnabled: false,
    inviteGuildIds: [],
    onboardingAuditEnabled: false,
    onboardingChangesEnabled: false,
    onboardingGuildIds: [],
    welcomeScreenAuditEnabled: false,
    welcomeScreenChangesEnabled: false,
    welcomeScreenGuildIds: [],
    widgetPublicExposureEnabled: false,
    widgetSettingsAuditEnabled: false,
    widgetSettingsChangesEnabled: false,
    widgetSettingsGuildIds: [],
    memberDirectoryEnabled: false,
    memberDirectoryGuildIds: [],
    nicknameChangesEnabled: false,
    nicknameGuildIds: [],
    otherMemberNicknameChangesEnabled: false,
    memberRoleChangesEnabled: false,
    memberRoleGuildIds: [],
    memberRoleCount: 0,
    memberVoiceAuditEnabled: false,
    memberVoiceChangesEnabled: false,
    memberVoiceChannelIds: [],
    memberVoiceGuildIds: [],
    crossGuildMessageForwardingEnabled: false,
    messageForwardingEnabled: false,
    messageForwardSourceChannelIds: [],
    messageForwardTargetChannelIds: [],
    nativeCommandChangesEnabled: false,
    nativeCommandName: "discord-mcp",
    nativeInteractionChannelIds: [],
    nativeInteractionGuildIds: [],
    nativeInteractionMaxPending: 25,
    nativeInteractionsEnabled: false,
    nativeInteractionTtlSeconds: 600,
    nativeInteractionUserIds: [],
    mentionUserCount: 0,
    mcpToolsets: ["connector", "messages"],
    mcpToolSurface: "progressive",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 0,
    pinChannelIds: [],
    pinManagementEnabled: false,
    pollAuditEnabled: false,
    pollChannelIds: [],
    pollCreationEnabled: false,
    pollEndingEnabled: false,
    pollVoterAuditEnabled: false,
    reactionChannelIds: [],
    reactionModerationEnabled: false,
    reactionUserAuditEnabled: false,
    readChannelScope: "all-visible",
    readGuildScope: "allowlist",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    roleConfigurationEnabled: false,
    roleConfigurationIds: [],
    roleDeletionAuditEnabled: false,
    roleDeletionIds: [],
    roleDeletionsEnabled: false,
    roleOrderingAuditEnabled: false,
    roleOrderingChangesEnabled: false,
    roleOrderingGuildIds: [],
    threadCreationEnabled: false,
    threadAuditEnabled: false,
    threadChangesEnabled: false,
    threadGuildIds: [],
    threadIds: [],
    threadMemberUserIds: [],
    threadParentIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookChangesEnabled: false,
    webhookCreationEnabled: false,
    webhookDeletionsEnabled: false,
  })

  for (const environment of [
    { DISCORD_MCP_TOOL_SURFACE: "hidden" },
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

  for (const value of ["0", "1001", "1.5"]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE: value,
      }, { homeDirectory: "/test/home" }),
      /expected number to be|expected int|must be an integer between 1 and 1000/,
    )
  }
})

test("configuration and policy isolate native Interaction ingress and command changes", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_NATIVE_COMMAND_CHANGES: "true",
    DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS: "true",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_BOT_ID: "300000000000000002",
    DISCORD_MCP_NATIVE_COMMAND_NAME: "private-request",
    DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_NATIVE_INTERACTION_MAX_PENDING: "12",
    DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS: "300",
    DISCORD_MCP_NATIVE_INTERACTION_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(config)

  assert.equal(config.allowNativeCommandChanges, true)
  assert.equal(config.allowNativeInteractions, true)
  assert.equal(config.nativeCommandName, "private-request")
  assert.deepEqual([...config.nativeInteractionGuildIds], [GUILD_ID])
  assert.deepEqual([...config.nativeInteractionChannelIds], [CHANNEL_ID])
  assert.deepEqual([...config.nativeInteractionUserIds], [USER_ID])
  assert.equal(config.nativeInteractionMaxPending, 12)
  assert.equal(config.nativeInteractionTtlSeconds, 300)
  enabled.assertNativeCommandChangeAllowed(GUILD_ID)
  enabled.assertNativeInteractionAllowed(GUILD_ID, CHANNEL_ID, USER_ID)
  assert.throws(
    () => enabled.assertNativeCommandChangeAllowed(OTHER_GUILD_ID),
    /configured read scope/,
  )
  assert.throws(
    () => enabled.assertNativeInteractionAllowed(GUILD_ID, OTHER_CHANNEL_ID, USER_ID),
    /outside the native Interaction scope/,
  )
  assert.throws(
    () => enabled.assertNativeInteractionAllowed(GUILD_ID, CHANNEL_ID, "400000000000000002"),
    /outside the native Interaction scope/,
  )
  assert.deepEqual(enabled.describe().nativeInteractionGuildIds, [GUILD_ID])
  assert.deepEqual(enabled.describe().nativeInteractionChannelIds, [CHANNEL_ID])
  assert.deepEqual(enabled.describe().nativeInteractionUserIds, [USER_ID])
  assert.equal(enabled.describe().nativeCommandChangesEnabled, true)
  assert.equal(enabled.describe().nativeInteractionsEnabled, true)

  for (const environment of [
    {
      DISCORD_MCP_ALLOW_NATIVE_COMMAND_CHANGES: "true",
      DISCORD_MCP_APPLICATION_ID: "300000000000000001",
      DISCORD_MCP_BOT_ID: "300000000000000002",
    },
    {
      DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS: "true",
      DISCORD_MCP_APPLICATION_ID: "300000000000000001",
      DISCORD_MCP_BOT_ID: "300000000000000002",
      DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS: GUILD_ID,
    },
    {
      DISCORD_MCP_NATIVE_COMMAND_NAME: "Not Valid",
    },
    {
      DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS: "29",
    },
    {
      DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS: "841",
    },
    {
      DISCORD_MCP_NATIVE_INTERACTION_MAX_PENDING: "101",
    },
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        ...environment,
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  }

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
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

test("configuration and policy isolate webhook audit and administration authority", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_CHANGES: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_CREATION: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
    DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(config)

  assert.equal(config.allowWebhookAudit, true)
  assert.equal(config.allowWebhookChanges, true)
  assert.equal(config.allowWebhookCreation, true)
  assert.equal(config.allowWebhookDeletions, true)
  assert.deepEqual([...config.webhookChannelIds], [CHANNEL_ID])
  assert.equal(enabled.assertChannelWebhookAuditable(channel()), GUILD_ID)
  assert.equal(enabled.assertChannelWebhookChangeable(channel()), GUILD_ID)
  assert.equal(enabled.assertChannelWebhookCreatable(channel()), GUILD_ID)
  assert.equal(enabled.assertChannelWebhookDeletable(channel()), GUILD_ID)
  assert.deepEqual(
    {
      webhookAuditEnabled: enabled.describe().webhookAuditEnabled,
      webhookChannelIds: enabled.describe().webhookChannelIds,
      webhookChangesEnabled: enabled.describe().webhookChangesEnabled,
      webhookCreationEnabled: enabled.describe().webhookCreationEnabled,
      webhookDeletionsEnabled: enabled.describe().webhookDeletionsEnabled,
    },
    {
      webhookAuditEnabled: true,
      webhookChannelIds: [CHANNEL_ID],
      webhookChangesEnabled: true,
      webhookCreationEnabled: true,
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
    () => deletionDisabled.assertChannelWebhookChangeable(channel()),
    /webhook changes are disabled/,
  )
  assert.throws(
    () => deletionDisabled.assertChannelWebhookCreatable(channel()),
    /webhook creation is disabled/,
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
    /requires \$\.capabilities\.webhookAudit/,
  )
  for (const toggle of [
    "DISCORD_MCP_ALLOW_WEBHOOK_CHANGES",
    "DISCORD_MCP_ALLOW_WEBHOOK_CREATION",
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        [toggle]: "true",
        DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.webhookAudit/,
    )
  }
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_WEBHOOK_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.webhookChannelIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
})

test("configuration and policy isolate integration audit and exact-ID deletion", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
    DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS: "true",
    DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(config)

  assert.equal(config.allowIntegrationAudit, true)
  assert.equal(config.allowIntegrationDeletions, true)
  assert.deepEqual([...config.integrationGuildIds], [GUILD_ID])
  assert.deepEqual([...config.integrationIds], [INTEGRATION_ID])
  enabled.assertGuildIntegrationAuditable(GUILD_ID)
  enabled.assertGuildIntegrationDeletable(GUILD_ID, INTEGRATION_ID)
  assert.deepEqual(
    {
      integrationAuditEnabled: enabled.describe().integrationAuditEnabled,
      integrationDeletionsEnabled: enabled.describe().integrationDeletionsEnabled,
      integrationGuildIds: enabled.describe().integrationGuildIds,
      integrationIds: enabled.describe().integrationIds,
    },
    {
      integrationAuditEnabled: true,
      integrationDeletionsEnabled: true,
      integrationGuildIds: [GUILD_ID],
      integrationIds: [INTEGRATION_ID],
    },
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildIntegrationAuditable(GUILD_ID),
    /integration audit is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildIntegrationAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  const deletionDisabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
    DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => deletionDisabled.assertGuildIntegrationDeletable(GUILD_ID, INTEGRATION_ID),
    /integration deletion is disabled/,
  )
  assert.throws(
    () => enabled.assertGuildIntegrationAuditable(OTHER_GUILD_ID),
    /outside the configured read scope/,
  )
  assert.throws(
    () => enabled.assertGuildIntegrationDeletable(GUILD_ID, OTHER_INTEGRATION_ID),
    /outside the integration deletion scope/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS: "true",
      DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.integrationAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_INTEGRATION_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.integrationGuildIds must be a subset/,
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
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
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
      OTHER_GUILD_ID,
      "400000000000000002",
    ),
    /outside the administration scope/,
  )
  assert.deepEqual(policy.describe(), {
    administrationEnabled: true,
    administrationGuildIds: [GUILD_ID],
    applicationEmojiAuditEnabled: false,
    applicationEmojiChangesEnabled: false,
    applicationEmojiCreationEnabled: false,
    applicationEmojiRootCount: 0,
    announcementCrosspostChannelIds: [],
    announcementCrosspostsEnabled: false,
    announcementSubscriptionAuditEnabled: false,
    announcementSubscriptionChangesEnabled: false,
    announcementSubscriptionSourceChannelIds: [],
    announcementSubscriptionTargetChannelIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [GUILD_ID, OTHER_GUILD_ID],
    attachmentChannelIds: [],
    attachmentMaxBytes: 10 * 1_024 * 1_024,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    automodAlertChannelIds: [],
    automodAuditEnabled: false,
    automodChangesEnabled: false,
    automodGuildIds: [],
    banAuditEnabled: false,
    banAuditGuildIds: [],
    channelCloneAuditEnabled: false,
    channelCloneGuildIds: [],
    channelCloneSourceIds: [],
    channelCloningEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    channelDeletionAuditEnabled: false,
    channelDeletionIds: [],
    channelDeletionsEnabled: false,
    channelMetadataChangesEnabled: false,
    channelMetadataIds: [],
    channelOrderingAuditEnabled: false,
    channelOrderingChangesEnabled: false,
    channelOrderingGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    forumTagAuditEnabled: false,
    forumTagChangesEnabled: false,
    forumTagChannelIds: [],
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildTemplateAuditEnabled: false,
    guildTemplateChangesEnabled: false,
    guildTemplateGuildIds: [],
    integrationAuditEnabled: false,
    integrationDeletionsEnabled: false,
    integrationGuildIds: [],
    integrationIds: [],
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    guildProfileAuditEnabled: false,
    guildProfileChangesEnabled: false,
    guildProfileGuildIds: [],
    guildSettingsAuditEnabled: false,
    guildSettingsChangesEnabled: false,
    guildSettingsGuildIds: [],
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    scheduledEventUserAuditEnabled: false,
    soundboardAuditEnabled: false,
    soundboardChangesEnabled: false,
    soundboardCreationEnabled: false,
    soundboardGuildIds: [],
    soundboardRootCount: 0,
    stageChannelIds: [],
    stageInstanceAuditEnabled: false,
    stageInstanceChangesEnabled: false,
    stageStartNotificationsEnabled: false,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    inviteAuditEnabled: false,
    inviteDeletionsEnabled: false,
    inviteGuildIds: [],
    onboardingAuditEnabled: false,
    onboardingChangesEnabled: false,
    onboardingGuildIds: [],
    welcomeScreenAuditEnabled: false,
    welcomeScreenChangesEnabled: false,
    welcomeScreenGuildIds: [],
    widgetPublicExposureEnabled: false,
    widgetSettingsAuditEnabled: false,
    widgetSettingsChangesEnabled: false,
    widgetSettingsGuildIds: [],
    memberDirectoryEnabled: false,
    memberDirectoryGuildIds: [],
    nicknameChangesEnabled: false,
    nicknameGuildIds: [],
    otherMemberNicknameChangesEnabled: false,
    memberRoleChangesEnabled: false,
    memberRoleGuildIds: [],
    memberRoleCount: 0,
    memberVoiceAuditEnabled: false,
    memberVoiceChangesEnabled: false,
    memberVoiceChannelIds: [],
    memberVoiceGuildIds: [],
    crossGuildMessageForwardingEnabled: false,
    messageForwardingEnabled: false,
    messageForwardSourceChannelIds: [],
    messageForwardTargetChannelIds: [],
    nativeCommandChangesEnabled: false,
    nativeCommandName: "discord-mcp",
    nativeInteractionChannelIds: [],
    nativeInteractionGuildIds: [],
    nativeInteractionMaxPending: 25,
    nativeInteractionsEnabled: false,
    nativeInteractionTtlSeconds: 600,
    nativeInteractionUserIds: [],
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 1,
    pinChannelIds: [],
    pinManagementEnabled: false,
    pollAuditEnabled: false,
    pollChannelIds: [],
    pollCreationEnabled: false,
    pollEndingEnabled: false,
    pollVoterAuditEnabled: false,
    reactionChannelIds: [],
    reactionModerationEnabled: false,
    reactionUserAuditEnabled: false,
    readChannelScope: "all-visible",
    readGuildScope: "allowlist",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    roleConfigurationEnabled: false,
    roleConfigurationIds: [],
    roleDeletionAuditEnabled: false,
    roleDeletionIds: [],
    roleDeletionsEnabled: false,
    roleOrderingAuditEnabled: false,
    roleOrderingChangesEnabled: false,
    roleOrderingGuildIds: [],
    threadCreationEnabled: false,
    threadAuditEnabled: false,
    threadChangesEnabled: false,
    threadGuildIds: [],
    threadIds: [],
    threadMemberUserIds: [],
    threadParentIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookChangesEnabled: false,
    webhookCreationEnabled: false,
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
    /\$\.scopes\.memberDirectoryGuildIds must be a subset/,
  )
})

test("configuration and policy require an opt-in exact ban-audit guild scope", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_BAN_AUDIT: "true",
    DISCORD_MCP_BAN_AUDIT_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(policy.describe().banAuditEnabled, true)
  assert.deepEqual(policy.describe().banAuditGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertBanAuditAllowed(GUILD_ID))
  assert.throws(
    () => policy.assertBanAuditAllowed(OTHER_GUILD_ID),
    /outside the ban-audit scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertBanAuditAllowed(GUILD_ID),
    /ban audit is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_BAN_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertBanAuditAllowed(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_BAN_AUDIT_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.banAuditGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_BAN_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
})

test("configuration and policy isolate capability-safe invite audit and revocation", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_INVITE_AUDIT: "true",
    DISCORD_MCP_ALLOW_INVITE_DELETIONS: "true",
    DISCORD_MCP_INVITE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowInviteAudit, true)
  assert.equal(config.allowInviteDeletions, true)
  assert.deepEqual([...config.inviteGuildIds], [GUILD_ID])
  assert.equal(policy.describe().inviteAuditEnabled, true)
  assert.equal(policy.describe().inviteDeletionsEnabled, true)
  assert.deepEqual(policy.describe().inviteGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertGuildInviteAuditable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildInviteDeletable(GUILD_ID))
  assert.throws(
    () => policy.assertGuildInviteAuditable(OTHER_GUILD_ID),
    /outside the invite-audit scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildInviteAuditable(GUILD_ID),
    /invite audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_INVITE_AUDIT: "true",
    DISCORD_MCP_INVITE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildInviteAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildInviteDeletable(GUILD_ID),
    /invite deletion is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_INVITE_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildInviteAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_INVITE_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.inviteGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_INVITE_DELETIONS: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.inviteAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_INVITE_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
})

test("configuration and policy isolate reviewed guild onboarding", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "true",
    DISCORD_MCP_ALLOW_ONBOARDING_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_ONBOARDING_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowOnboardingAudit, true)
  assert.equal(config.allowOnboardingChanges, true)
  assert.deepEqual([...config.onboardingGuildIds], [GUILD_ID])
  assert.equal(policy.describe().onboardingAuditEnabled, true)
  assert.equal(policy.describe().onboardingChangesEnabled, true)
  assert.deepEqual(policy.describe().onboardingGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertGuildOnboardingAuditable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildOnboardingChangeable(GUILD_ID))
  assert.throws(
    () => policy.assertGuildOnboardingAuditable(OTHER_GUILD_ID),
    /outside the onboarding-audit scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildOnboardingAuditable(GUILD_ID),
    /onboarding audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_ONBOARDING_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildOnboardingAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildOnboardingChangeable(GUILD_ID),
    /onboarding changes are disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildOnboardingAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ONBOARDING_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.onboardingGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ONBOARDING_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.onboardingAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
})

test("configuration and policy isolate reviewed guild Welcome Screens", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "true",
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES: "true",
    DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowWelcomeScreenAudit, true)
  assert.equal(config.allowWelcomeScreenChanges, true)
  assert.deepEqual([...config.welcomeScreenGuildIds], [GUILD_ID])
  assert.equal(policy.describe().welcomeScreenAuditEnabled, true)
  assert.equal(policy.describe().welcomeScreenChangesEnabled, true)
  assert.deepEqual(policy.describe().welcomeScreenGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertGuildWelcomeScreenAuditable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildWelcomeScreenChangeable(GUILD_ID))
  assert.throws(
    () => policy.assertGuildWelcomeScreenAuditable(OTHER_GUILD_ID),
    /outside the Welcome Screen audit scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildWelcomeScreenAuditable(GUILD_ID),
    /Welcome Screen audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "true",
    DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildWelcomeScreenAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildWelcomeScreenChangeable(GUILD_ID),
    /Welcome Screen changes are disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildWelcomeScreenAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.welcomeScreenGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.welcomeScreenAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
})

test("configuration and policy isolate reviewed authenticated widget settings", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES: "true",
    DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowWidgetSettingsAudit, true)
  assert.equal(config.allowWidgetSettingsChanges, true)
  assert.equal(config.allowWidgetPublicExposure, true)
  assert.deepEqual([...config.widgetSettingsGuildIds], [GUILD_ID])
  assert.equal(policy.describe().widgetSettingsAuditEnabled, true)
  assert.equal(policy.describe().widgetSettingsChangesEnabled, true)
  assert.equal(policy.describe().widgetPublicExposureEnabled, true)
  assert.deepEqual(policy.describe().widgetSettingsGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertGuildWidgetSettingsAuditable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildWidgetSettingsChangeable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildWidgetPublicExposureChangeable(GUILD_ID))
  assert.throws(
    () => policy.assertGuildWidgetSettingsAuditable(OTHER_GUILD_ID),
    /outside the widget-settings audit scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildWidgetSettingsAuditable(GUILD_ID),
    /widget-settings audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
    DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildWidgetSettingsAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildWidgetSettingsChangeable(GUILD_ID),
    /widget-settings changes are disabled/,
  )

  const changesOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES: "true",
    DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => changesOnly.assertGuildWidgetSettingsChangeable(GUILD_ID))
  assert.throws(
    () => changesOnly.assertGuildWidgetPublicExposureChangeable(GUILD_ID),
    /widget public exposure is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildWidgetSettingsAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.widgetSettingsGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.widgetSettingsAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE: "true",
      DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.widgetSettingsChanges/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: Array.from(
        { length: 101 },
        (_, index) => String(index + 1),
      ).join(","),
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed guild settings", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_SETTINGS_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowGuildSettingsAudit, true)
  assert.equal(config.allowGuildSettingsChanges, true)
  assert.deepEqual([...config.guildSettingsGuildIds], [GUILD_ID])
  assert.equal(policy.describe().guildSettingsAuditEnabled, true)
  assert.equal(policy.describe().guildSettingsChangesEnabled, true)
  assert.deepEqual(policy.describe().guildSettingsGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertGuildSettingsAuditable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildSettingsChangeable(GUILD_ID))
  assert.throws(
    () => policy.assertGuildSettingsAuditable(OTHER_GUILD_ID),
    /outside the guild-settings scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildSettingsAuditable(GUILD_ID),
    /guild-settings audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildSettingsAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildSettingsChangeable(GUILD_ID),
    /guild-settings changes are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GUILD_SETTINGS_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildSettingsAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT: "true",
      DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
      DISCORD_MCP_BOT_ID: BOT_ID,
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.guildSettingsGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildSettingsGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS: Array.from(
        { length: 101 },
        (_, index) => String(index + 1),
      ).join(","),
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed guild profile text", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_GUILD_PROFILE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(config)

  assert.equal(config.allowGuildProfileAudit, true)
  assert.equal(config.allowGuildProfileChanges, true)
  assert.deepEqual([...config.guildProfileGuildIds], [GUILD_ID])
  assert.equal(enabled.describe().guildProfileAuditEnabled, true)
  assert.equal(enabled.describe().guildProfileChangesEnabled, true)
  assert.deepEqual(enabled.describe().guildProfileGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => enabled.assertGuildProfileAuditable(GUILD_ID))
  assert.doesNotThrow(() => enabled.assertGuildProfileChangeable(GUILD_ID))
  assert.throws(
    () => enabled.assertGuildProfileAuditable(OTHER_GUILD_ID),
    /outside the guild profile scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildProfileAuditable(GUILD_ID),
    /guild profile audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_GUILD_PROFILE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildProfileAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildProfileChangeable(GUILD_ID),
    /guild profile changes are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildProfileAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT: "true",
      DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
      DISCORD_MCP_BOT_ID: BOT_ID,
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.guildProfileGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_GUILD_PROFILE_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildProfileGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_GUILD_PROFILE_GUILD_IDS: Array.from(
        { length: 101 },
        (_, index) => String(index + 1),
      ).join(","),
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed member nickname authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_NICKNAME_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.nicknameGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_OTHER_MEMBER_NICKNAME_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /\$\.capabilities\.otherMemberNicknameChanges requires \$\.capabilities\.nicknameChanges/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_NICKNAME_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertNicknameChangeAllowed(GUILD_ID),
    /nickname changes are disabled/,
  )

  const missingGuilds = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_NICKNAME_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => missingGuilds.assertNicknameChangeAllowed(GUILD_ID),
    /require an explicit guild allowlist/,
  )

  const selfOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_NICKNAME_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_NICKNAME_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  selfOnly.assertNicknameChangeAllowed(GUILD_ID)
  assert.throws(
    () => selfOnly.assertNicknameChangeAllowed(OTHER_GUILD_ID),
    /outside the nickname-change scope/,
  )
  assert.throws(
    () => selfOnly.assertOtherMemberNicknameChangeAllowed(GUILD_ID, USER_ID),
    /other-member nickname changes are disabled/,
  )
  assert.deepEqual(selfOnly.describe().nicknameGuildIds, [GUILD_ID])
  assert.equal(selfOnly.describe().nicknameChangesEnabled, true)
  assert.equal(selfOnly.describe().otherMemberNicknameChangesEnabled, false)

  const otherMembers = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_NICKNAME_CHANGES: "true",
    DISCORD_MCP_ALLOW_OTHER_MEMBER_NICKNAME_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_NICKNAME_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_PROTECTED_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" }))
  otherMembers.assertOtherMemberNicknameChangeAllowed(
    GUILD_ID,
    "400000000000000002",
  )
  assert.throws(
    () => otherMembers.assertOtherMemberNicknameChangeAllowed(GUILD_ID, USER_ID),
    /protected from administration/,
  )
  assert.equal(otherMembers.describe().otherMemberNicknameChangesEnabled, true)

  const excessiveGuilds = Array.from(
    { length: CONNECTOR_LIMITS.memberNicknameGuildAllowlist + 1 },
    (_, index) => (600_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_NICKNAME_GUILD_IDS: excessiveGuilds,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy isolate exact member-role authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_MEMBER_ROLE_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberRoleGuildIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_MEMBER_ROLE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_MEMBER_ROLE_IDS: ROLE_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /member-role changes are disabled/,
  )

  const missingGuilds = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_MEMBER_ROLE_IDS: ROLE_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => missingGuilds.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /require an explicit guild allowlist/,
  )

  const missingRoles = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_MEMBER_ROLE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => missingRoles.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /require an exact role allowlist/,
  )

  const policy = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_MEMBER_ROLE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_MEMBER_ROLE_IDS: `${ROLE_ID},${OTHER_ROLE_ID}`,
    DISCORD_MCP_PROTECTED_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" }))
  policy.assertMemberRoleChangeAllowed(
    GUILD_ID,
    "400000000000000002",
    ROLE_ID,
  )
  assert.throws(
    () => policy.assertMemberRoleChangeAllowed(OTHER_GUILD_ID, "400000000000000002", ROLE_ID),
    /outside the member-role scope/,
  )
  assert.throws(
    () => policy.assertMemberRoleChangeAllowed(GUILD_ID, "400000000000000002", "300000000000000003"),
    /outside the member-role scope/,
  )
  assert.throws(
    () => policy.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /protected from administration/,
  )
  assert.equal(policy.describe().memberRoleChangesEnabled, true)
  assert.deepEqual(policy.describe().memberRoleGuildIds, [GUILD_ID])
  assert.equal(policy.describe().memberRoleCount, 2)

  const excessiveRoles = Array.from(
    { length: 101 },
    (_, index) => (500_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_MEMBER_ROLE_IDS: excessiveRoles,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy isolate exact member voice audit and changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberVoiceGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberVoiceChannelIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberVoiceAuditable(GUILD_ID),
    /member voice audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT: "true",
    DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertMemberVoiceAuditable(GUILD_ID))
  assert.doesNotThrow(() => auditOnly.assertMemberVoiceChannelAllowed(CHANNEL_ID))
  assert.throws(
    () => auditOnly.assertMemberVoiceChangeable(GUILD_ID, USER_ID),
    /member voice changes are disabled/,
  )
  assert.throws(
    () => auditOnly.assertMemberVoiceChannelAllowed(OTHER_CHANNEL_ID),
    /outside the configured channel scope/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT: "true",
    DISCORD_MCP_ALLOW_MEMBER_VOICE_CHANGES: "true",
    DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_PROTECTED_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertMemberVoiceChangeable(GUILD_ID, "400000000000000002")
  assert.throws(
    () => enabled.assertMemberVoiceChangeable(GUILD_ID, USER_ID),
    /protected from administration/,
  )
  assert.throws(
    () => enabled.assertMemberVoiceAuditable(OTHER_GUILD_ID),
    /outside the member voice scope/,
  )
  assert.equal(enabled.describe().memberVoiceAuditEnabled, true)
  assert.equal(enabled.describe().memberVoiceChangesEnabled, true)
  assert.deepEqual(enabled.describe().memberVoiceChannelIds, [CHANNEL_ID, OTHER_CHANNEL_ID])
  assert.deepEqual(enabled.describe().memberVoiceGuildIds, [GUILD_ID])

  const emptyChannels = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT: "true",
    DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => emptyChannels.assertMemberVoiceAuditable(GUILD_ID),
    /requires an exact channel allowlist/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_MEMBER_VOICE_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.memberVoiceAudit/,
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
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
    DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertChannelCreationAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertChannelCreationAllowed(OTHER_GUILD_ID),
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

test("configuration and policy isolate reviewed metadata changes to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_CHANNEL_METADATA_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.channelMetadataIds must be a subset/,
  )

  const disabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_CHANNEL_METADATA_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const disabled = new ScopePolicy(disabledConfig)
  assert.equal(disabledConfig.allowChannelMetadataChanges, false)
  assert.throws(
    () => disabled.assertChannelMetadataChangeAllowed(channel()),
    /channel-metadata changes are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "true",
    DISCORD_MCP_CHANNEL_METADATA_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabledConfig.allowChannelMetadataChanges, true)
  assert.deepEqual([...enabledConfig.channelMetadataIds], [CHANNEL_ID])
  assert.equal(enabled.assertChannelMetadataChangeAllowed(channel()), GUILD_ID)
  assert.throws(
    () => enabled.assertChannelMetadataChangeAllowed(channel({ id: OTHER_CHANNEL_ID })),
    /outside the channel-metadata scope/,
  )
  assert.equal(enabled.describe().channelMetadataChangesEnabled, true)
  assert.deepEqual(enabled.describe().channelMetadataIds, [CHANNEL_ID])

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertChannelMetadataChangeAllowed(channel()),
    /require an explicit channel allowlist/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
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
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_ROLE_CREATION: "true",
    DISCORD_MCP_ROLE_CREATION_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertRoleCreationAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertRoleCreationAllowed(OTHER_GUILD_ID),
    /outside the role creation scope/,
  )
  assert.equal(enabled.describe().roleCreationEnabled, true)
  assert.deepEqual(enabled.describe().roleCreationGuildIds, [GUILD_ID])
})

test("configuration and policy isolate reviewed role configuration to exact roles", () => {
  const disabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ROLE_CONFIGURATION_IDS: ROLE_ID,
  }, { homeDirectory: "/test/home" })
  const disabled = new ScopePolicy(disabledConfig)
  assert.equal(disabledConfig.allowRoleConfiguration, false)
  assert.throws(
    () => disabled.assertRoleConfigurationAllowed(GUILD_ID, ROLE_ID),
    /role configuration is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
    DISCORD_MCP_ROLE_CONFIGURATION_IDS: ROLE_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabledConfig.allowRoleConfiguration, true)
  assert.deepEqual([...enabledConfig.roleConfigurationIds], [ROLE_ID])
  enabled.assertRoleConfigurationAllowed(GUILD_ID, ROLE_ID)
  assert.throws(
    () => enabled.assertRoleConfigurationAllowed(GUILD_ID, "999999999999999999"),
    /outside the role-configuration scope/,
  )
  assert.throws(
    () => enabled.assertRoleConfigurationAllowed(OTHER_GUILD_ID, ROLE_ID),
    /configured read scope/,
  )
  assert.equal(enabled.describe().roleConfigurationEnabled, true)
  assert.deepEqual(enabled.describe().roleConfigurationIds, [ROLE_ID])

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertRoleConfigurationAllowed(GUILD_ID, ROLE_ID),
    /requires an explicit role allowlist/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "sometimes",
    }, { homeDirectory: "/test/home" }),
    /must be true or false/,
  )
  const excessiveRoleIds = Array.from(
    { length: CONNECTOR_LIMITS.roleConfigurationAllowlist + 1 },
    (_, index) => (500_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ROLE_CONFIGURATION_IDS: excessiveRoleIds,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate role-order audit from exact-guild changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.roleOrderingAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
    DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const audit = new ScopePolicy(auditConfig)
  audit.assertRoleOrderingAuditable(GUILD_ID)
  assert.throws(
    () => audit.assertRoleOrderingChangeable(GUILD_ID),
    /changes are disabled/,
  )
  assert.deepEqual(audit.describe().roleOrderingGuildIds, [GUILD_ID])
  assert.equal(audit.describe().roleOrderingAuditEnabled, true)
  assert.equal(audit.describe().roleOrderingChangesEnabled, false)

  const changesConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
    DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES: "true",
    DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const changes = new ScopePolicy(changesConfig)
  changes.assertRoleOrderingChangeable(GUILD_ID)
  assert.equal(changes.describe().roleOrderingChangesEnabled, true)
  assert.throws(
    () => changes.assertRoleOrderingAuditable(OTHER_GUILD_ID),
    /configured read scope/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertRoleOrderingAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  const excessiveGuildIds = Array.from(
    { length: CONNECTOR_LIMITS.roleOrderingGuildAllowlist + 1 },
    (_, index) => (600_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: excessiveGuildIds,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate channel-clone audit from exact-source changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_CLONING: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.channelCloneAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.channelCloneGuildIds and \$\.scopes\.channelCloneSourceIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: ROLE_ID,
    DISCORD_MCP_BOT_ID: USER_ID,
    DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const audit = new ScopePolicy(auditConfig)
  audit.assertChannelCloneAuditable(GUILD_ID, CHANNEL_ID)
  assert.throws(
    () => audit.assertChannelCloneable(GUILD_ID, CHANNEL_ID),
    /cloning is disabled/,
  )
  assert.deepEqual(audit.describe().channelCloneGuildIds, [GUILD_ID])
  assert.deepEqual(audit.describe().channelCloneSourceIds, [CHANNEL_ID])
  assert.equal(audit.describe().channelCloneAuditEnabled, true)
  assert.equal(audit.describe().channelCloningEnabled, false)

  const changesConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_CLONING: "true",
    DISCORD_MCP_APPLICATION_ID: ROLE_ID,
    DISCORD_MCP_BOT_ID: USER_ID,
    DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const changes = new ScopePolicy(changesConfig)
  changes.assertChannelCloneable(GUILD_ID, CHANNEL_ID)
  assert.equal(changes.describe().channelCloningEnabled, true)
  assert.throws(
    () => changes.assertChannelCloneAuditable(GUILD_ID, OTHER_CHANNEL_ID),
    /source scope/,
  )

  const excessiveSources = Array.from(
    { length: CONNECTOR_LIMITS.channelCloneSourceAllowlist + 1 },
    (_, index) => (620_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS: excessiveSources,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate channel-order audit from exact-guild changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.channelOrderingAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.channelOrderingGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: ROLE_ID,
    DISCORD_MCP_BOT_ID: USER_ID,
    DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const audit = new ScopePolicy(auditConfig)
  audit.assertChannelOrderingAuditable(GUILD_ID)
  assert.throws(
    () => audit.assertChannelOrderingChangeable(GUILD_ID),
    /changes are disabled/,
  )
  assert.deepEqual(audit.describe().channelOrderingGuildIds, [GUILD_ID])
  assert.equal(audit.describe().channelOrderingAuditEnabled, true)
  assert.equal(audit.describe().channelOrderingChangesEnabled, false)

  const changesConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: ROLE_ID,
    DISCORD_MCP_BOT_ID: USER_ID,
    DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const changes = new ScopePolicy(changesConfig)
  changes.assertChannelOrderingChangeable(GUILD_ID)
  assert.equal(changes.describe().channelOrderingChangesEnabled, true)
  assert.throws(
    () => changes.assertChannelOrderingAuditable(OTHER_GUILD_ID),
    /configured read scope/,
  )

  const excessiveGuildIds = Array.from(
    { length: CONNECTOR_LIMITS.channelOrderingGuildAllowlist + 1 },
    (_, index) => (610_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: excessiveGuildIds,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate reviewed channel-deletion audit from execution", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_DELETIONS: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.channelDeletionAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.channelDeletionIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT: "true",
      DISCORD_MCP_CHANNEL_DELETION_IDS: CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /requires \$\.gateway\.enabled/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_CHANNEL_DELETION_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT: "true",
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_APPLICATION_ID: ROLE_ID,
    DISCORD_MCP_BOT_ID: USER_ID,
    DISCORD_MCP_CHANNEL_DELETION_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const audit = new ScopePolicy(auditConfig)
  audit.assertChannelDeletionAuditable(GUILD_ID, CHANNEL_ID)
  assert.throws(
    () => audit.assertChannelDeletionAllowed(GUILD_ID, CHANNEL_ID),
    /deletion is disabled/,
  )
  assert.equal(audit.describe().channelDeletionAuditEnabled, true)
  assert.deepEqual(audit.describe().channelDeletionIds, [CHANNEL_ID])
  assert.equal(audit.describe().channelDeletionsEnabled, false)

  const changesConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_DELETIONS: "true",
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_APPLICATION_ID: ROLE_ID,
    DISCORD_MCP_BOT_ID: USER_ID,
    DISCORD_MCP_CHANNEL_DELETION_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const changes = new ScopePolicy(changesConfig)
  changes.assertChannelDeletionAllowed(GUILD_ID, CHANNEL_ID)
  assert.equal(changes.describe().channelDeletionsEnabled, true)
  assert.throws(
    () => changes.assertChannelDeletionAuditable(GUILD_ID, OTHER_CHANNEL_ID),
    /channel-deletion scope/,
  )

  const excessiveIds = Array.from(
    { length: CONNECTOR_LIMITS.channelDeletionAllowlist + 1 },
    (_, index) => (630_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_CHANNEL_DELETION_IDS: excessiveIds,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate reviewed role-deletion audit from execution", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ROLE_DELETIONS: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.roleDeletionAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.roleDeletionIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT: "true",
      DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
      DISCORD_MCP_BOT_ID: BOT_ID,
      DISCORD_MCP_ROLE_DELETION_IDS: ROLE_ID,
    }, { homeDirectory: "/test/home" }),
    /requires \$\.gateway\.enabled/,
  )

  const auditConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_ROLE_DELETION_IDS: ROLE_ID,
  }, { homeDirectory: "/test/home" })
  const audit = new ScopePolicy(auditConfig)
  audit.assertRoleDeletionAuditable(GUILD_ID, ROLE_ID)
  assert.throws(
    () => audit.assertRoleDeletionAllowed(GUILD_ID, ROLE_ID),
    /role deletion is disabled/,
  )
  assert.equal(audit.describe().roleDeletionAuditEnabled, true)
  assert.deepEqual(audit.describe().roleDeletionIds, [ROLE_ID])
  assert.equal(audit.describe().roleDeletionsEnabled, false)

  const changesConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT: "true",
    DISCORD_MCP_ALLOW_ROLE_DELETIONS: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_ROLE_DELETION_IDS: ROLE_ID,
  }, { homeDirectory: "/test/home" })
  const changes = new ScopePolicy(changesConfig)
  changes.assertRoleDeletionAllowed(GUILD_ID, ROLE_ID)
  assert.equal(changes.describe().roleDeletionsEnabled, true)
  assert.throws(
    () => changes.assertRoleDeletionAuditable(GUILD_ID, OTHER_ROLE_ID),
    /role-deletion scope/,
  )
  assert.throws(
    () => changes.assertRoleDeletionAuditable(OTHER_GUILD_ID, ROLE_ID),
    /configured read scope/,
  )

  const excessiveIds = Array.from(
    { length: CONNECTOR_LIMITS.roleDeletionAllowlist + 1 },
    (_, index) => (640_000_000_000_000_000n + BigInt(index)).toString(),
  ).join(",")
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ROLE_DELETION_IDS: excessiveIds,
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
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
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
    DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  enabled.assertGuildScaffoldAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertGuildScaffoldAllowed(OTHER_GUILD_ID),
    /outside the guild scaffold scope/,
  )
  assert.equal(enabled.describe().guildScaffoldsEnabled, true)
  assert.deepEqual(enabled.describe().guildScaffoldGuildIds, [GUILD_ID])
})

test("configuration and policy separate capability-safe Guild Template audit from changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildTemplateAudit/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildTemplateAuditable(GUILD_ID),
    /guild-template audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" }))
  auditOnly.assertGuildTemplateAuditable(GUILD_ID)
  assert.throws(
    () => auditOnly.assertGuildTemplateChangeable(GUILD_ID),
    /guild-template changes are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  enabled.assertGuildTemplateAuditable(GUILD_ID)
  enabled.assertGuildTemplateChangeable(GUILD_ID)
  assert.throws(
    () => enabled.assertGuildTemplateAuditable(OTHER_GUILD_ID),
    /outside the guild-template scope/,
  )
  assert.equal(enabled.describe().guildTemplateAuditEnabled, true)
  assert.equal(enabled.describe().guildTemplateChangesEnabled, true)
  assert.deepEqual(enabled.describe().guildTemplateGuildIds, [GUILD_ID])

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildTemplateAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )
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

test("configuration and policy separate exact stable-forum tag audit from changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_FORUM_TAG_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.forumTagAudit/,
  )

  const forum = channel({ type: DISCORD_CHANNEL_TYPES.forum })
  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_FORUM_TAG_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertForumTagAuditable(forum),
    /forum-tag audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT: "true",
    DISCORD_MCP_FORUM_TAG_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.equal(auditOnly.assertForumTagAuditable(forum), GUILD_ID)
  assert.throws(
    () => auditOnly.assertForumTagChangeable(forum),
    /forum-tag changes are disabled/,
  )
  assert.throws(
    () => auditOnly.assertForumTagAuditable(channel({ type: 16 })),
    /requires an exact forum channel/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT: "true",
    DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES: "true",
    DISCORD_MCP_FORUM_TAG_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabled.assertForumTagAuditable(forum), GUILD_ID)
  assert.equal(enabled.assertForumTagChangeable(forum), GUILD_ID)
  assert.throws(
    () => enabled.assertForumTagAuditable(channel({
      id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.forum,
    })),
    /outside the forum-tag scope/,
  )
  assert.equal(enabled.describe().forumTagAuditEnabled, true)
  assert.equal(enabled.describe().forumTagChangesEnabled, true)
  assert.deepEqual(enabled.describe().forumTagChannelIds, [CHANNEL_ID])

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertForumTagAuditable(forum),
    /requires an explicit channel allowlist/,
  )
})

test("configuration and policy isolate thread creation to exact readable parents", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_THREAD_PARENT_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.threadParentIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_THREAD_PARENT_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertThreadCreatable(channel()),
    /thread creation is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_THREAD_CREATION: "true",
    DISCORD_MCP_THREAD_PARENT_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabledConfig.allowThreadCreation, true)
  assert.deepEqual([...enabledConfig.threadParentIds], [CHANNEL_ID])
  assert.equal(enabled.assertThreadCreatable(channel()), GUILD_ID)
  assert.throws(
    () => enabled.assertThreadCreatable(channel({ id: OTHER_CHANNEL_ID })),
    /outside the thread-creation scope/,
  )
  assert.equal(enabled.describe().threadCreationEnabled, true)
  assert.deepEqual(enabled.describe().threadParentIds, [CHANNEL_ID])
})

test("configuration and policy isolate exact thread governance and membership", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_THREAD_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.threadAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_THREAD_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.threadGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_THREAD_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.threadIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_THREAD_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_THREAD_IDS: CHANNEL_ID,
    DISCORD_MCP_THREAD_MEMBER_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertThreadAuditable(GUILD_ID, CHANNEL_ID),
    /thread audit is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_THREAD_AUDIT: "true",
    DISCORD_MCP_ALLOW_THREAD_CHANGES: "true",
    DISCORD_MCP_THREAD_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_THREAD_IDS: CHANNEL_ID,
    DISCORD_MCP_THREAD_MEMBER_USER_IDS: USER_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  enabled.assertThreadAuditable(GUILD_ID, CHANNEL_ID)
  enabled.assertThreadChangeAllowed(GUILD_ID, CHANNEL_ID)
  enabled.assertThreadMemberUserAllowed(USER_ID)
  assert.throws(
    () => enabled.assertThreadAuditable(GUILD_ID, OTHER_CHANNEL_ID),
    /outside the thread-governance scope/,
  )
  assert.throws(
    () => enabled.assertThreadAuditable(OTHER_GUILD_ID, CHANNEL_ID),
    /outside the configured read scope/,
  )
  assert.throws(
    () => enabled.assertThreadMemberUserAllowed("400000000000000002"),
    /outside the thread-membership scope/,
  )
  assert.equal(enabled.describe().threadAuditEnabled, true)
  assert.equal(enabled.describe().threadChangesEnabled, true)
  assert.deepEqual(enabled.describe().threadGuildIds, [GUILD_ID])
  assert.deepEqual(enabled.describe().threadIds, [CHANNEL_ID])
  assert.deepEqual(enabled.describe().threadMemberUserIds, [USER_ID])
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

test("configuration and policy isolate announcement crossposts to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelAnnouncementCrosspostable(channel({
      type: DISCORD_CHANNEL_TYPES.announcement,
    })),
    /announcement crossposts are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS: "true",
    DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  const announcement = channel({ type: DISCORD_CHANNEL_TYPES.announcement })
  assert.equal(enabledConfig.allowAnnouncementCrossposts, true)
  assert.deepEqual(
    [...enabledConfig.announcementCrosspostChannelIds],
    [CHANNEL_ID],
  )
  assert.equal(
    enabled.assertChannelAnnouncementCrosspostable(announcement),
    GUILD_ID,
  )
  assert.throws(
    () => enabled.assertChannelAnnouncementCrosspostable(channel({
      id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.announcement,
    })),
    /outside the announcement-crosspost scope/,
  )
  assert.equal(enabled.describe().announcementCrosspostsEnabled, true)
  assert.deepEqual(
    enabled.describe().announcementCrosspostChannelIds,
    [CHANNEL_ID],
  )
})

test("configuration and policy require exact dual scopes and separate cross-guild message-forward authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_MESSAGE_FORWARD_SOURCE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_MESSAGE_FORWARDING: "true",
    }, { homeDirectory: "/test/home" }),
    /requires exact source and target channel allowlists/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_CROSS_GUILD_MESSAGE_FORWARDING: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.messageForwarding/,
  )

  const environment = {
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: `${GUILD_ID},${OTHER_GUILD_ID}`,
    DISCORD_MCP_ALLOW_MESSAGE_FORWARDING: "true",
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    DISCORD_MCP_MESSAGE_FORWARD_SOURCE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_MESSAGE_FORWARD_TARGET_CHANNEL_IDS: OTHER_CHANNEL_ID,
  }
  const sameGuildConfig = loadConnectorConfig(environment, {
    homeDirectory: "/test/home",
  })
  const sameGuild = new ScopePolicy(sameGuildConfig)
  assert.equal(sameGuildConfig.allowMessageForwarding, true)
  assert.equal(sameGuildConfig.allowCrossGuildMessageForwarding, false)
  assert.deepEqual([...sameGuildConfig.messageForwardSourceChannelIds], [CHANNEL_ID])
  assert.deepEqual([...sameGuildConfig.messageForwardTargetChannelIds], [OTHER_CHANNEL_ID])
  assert.equal(sameGuild.assertMessageForwardSource(channel()), GUILD_ID)
  assert.equal(
    sameGuild.assertMessageForwardTarget(channel({ id: OTHER_CHANNEL_ID })),
    GUILD_ID,
  )
  assert.throws(
    () => sameGuild.assertMessageForwardSource(channel({ id: OTHER_CHANNEL_ID })),
    /outside the message-forward source scope/,
  )
  assert.throws(
    () => sameGuild.assertMessageForwardTarget(channel({
      id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.publicThread,
    })),
    /direct text and announcement targets only/,
  )
  assert.throws(
    () => sameGuild.assertMessageForwardGuildBoundary(GUILD_ID, OTHER_GUILD_ID),
    /Cross-guild Discord message forwarding is disabled/,
  )
  assert.deepEqual(
    {
      crossGuild: sameGuild.describe().crossGuildMessageForwardingEnabled,
      enabled: sameGuild.describe().messageForwardingEnabled,
      sources: sameGuild.describe().messageForwardSourceChannelIds,
      targets: sameGuild.describe().messageForwardTargetChannelIds,
    },
    {
      crossGuild: false,
      enabled: true,
      sources: [CHANNEL_ID],
      targets: [OTHER_CHANNEL_ID],
    },
  )

  const crossGuild = new ScopePolicy(loadConnectorConfig({
    ...environment,
    DISCORD_MCP_ALLOW_CROSS_GUILD_MESSAGE_FORWARDING: "true",
  }, { homeDirectory: "/test/home" }))
  crossGuild.assertMessageForwardGuildBoundary(GUILD_ID, OTHER_GUILD_ID)
  assert.equal(crossGuild.describe().crossGuildMessageForwardingEnabled, true)
})

test("configuration and policy independently scope announcement subscription audit and changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_SOURCE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.announcementSubscriptionSourceChannelIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.announcementSubscriptionAudit/,
  )

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT: "true",
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES: "true",
    DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_SOURCE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  const source = channel({
    id: OTHER_CHANNEL_ID,
    type: DISCORD_CHANNEL_TYPES.announcement,
  })
  const target = channel({ type: DISCORD_CHANNEL_TYPES.text })

  assert.equal(enabledConfig.allowAnnouncementSubscriptionAudit, true)
  assert.equal(enabledConfig.allowAnnouncementSubscriptionChanges, true)
  assert.deepEqual(
    [...enabledConfig.announcementSubscriptionSourceChannelIds],
    [OTHER_CHANNEL_ID],
  )
  assert.deepEqual(
    [...enabledConfig.announcementSubscriptionTargetChannelIds],
    [CHANNEL_ID],
  )
  assert.equal(enabled.assertAnnouncementSubscriptionTargetAuditable(target), GUILD_ID)
  assert.equal(enabled.assertAnnouncementSubscriptionTargetChangeable(target), GUILD_ID)
  assert.equal(enabled.assertAnnouncementSubscriptionSourceChangeable(source), GUILD_ID)
  assert.deepEqual({
    audit: enabled.describe().announcementSubscriptionAuditEnabled,
    changes: enabled.describe().announcementSubscriptionChangesEnabled,
    sources: enabled.describe().announcementSubscriptionSourceChannelIds,
    targets: enabled.describe().announcementSubscriptionTargetChannelIds,
  }, {
    audit: true,
    changes: true,
    sources: [OTHER_CHANNEL_ID],
    targets: [CHANNEL_ID],
  })

  assert.throws(
    () => enabled.assertAnnouncementSubscriptionTargetAuditable(channel({
      id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.text,
    })),
    /outside the announcement-subscription target scope/,
  )
  assert.throws(
    () => enabled.assertAnnouncementSubscriptionTargetAuditable(channel({
      type: DISCORD_CHANNEL_TYPES.announcement,
    })),
    /targets must be direct guild text channels/,
  )
  assert.throws(
    () => enabled.assertAnnouncementSubscriptionSourceChangeable(channel({
      id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.text,
    })),
    /sources must be direct guild announcement channels/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT: "true",
    DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.equal(auditOnly.assertAnnouncementSubscriptionTargetAuditable(target), GUILD_ID)
  assert.throws(
    () => auditOnly.assertAnnouncementSubscriptionTargetChangeable(target),
    /changes are disabled/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertAnnouncementSubscriptionTargetIdAuditable(CHANNEL_ID),
    /audit is disabled/,
  )
})

test("configuration and policy separate poll audit, voter, creation, and ending authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_POLL_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.pollChannelIds must be a subset/,
  )
  for (const environmentName of [
    "DISCORD_MCP_ALLOW_POLL_CREATION",
    "DISCORD_MCP_ALLOW_POLL_ENDING",
    "DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT",
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        [environmentName]: "true",
      }, { homeDirectory: "/test/home" }),
      /require \$\.capabilities\.pollAudit/,
    )
  }

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_POLL_AUDIT: "true",
    DISCORD_MCP_POLL_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" }))
  assert.equal(auditOnly.assertPollAuditable(channel()), GUILD_ID)
  assert.throws(() => auditOnly.assertPollVotersAuditable(channel()), /voter audit is disabled/)
  assert.throws(() => auditOnly.assertPollCreatable(channel()), /creation is disabled/)
  assert.throws(() => auditOnly.assertPollEndable(channel()), /ending is disabled/)

  const enabledConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_POLL_AUDIT: "true",
    DISCORD_MCP_ALLOW_POLL_CREATION: "true",
    DISCORD_MCP_ALLOW_POLL_ENDING: "true",
    DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT: "true",
    DISCORD_MCP_POLL_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const enabled = new ScopePolicy(enabledConfig)
  assert.equal(enabled.assertPollAuditable(channel()), GUILD_ID)
  assert.equal(enabled.assertPollVotersAuditable(channel()), GUILD_ID)
  assert.equal(enabled.assertPollCreatable(channel()), GUILD_ID)
  assert.equal(enabled.assertPollEndable(channel()), GUILD_ID)
  assert.throws(
    () => enabled.assertPollAuditable(channel({ id: OTHER_CHANNEL_ID })),
    /outside the poll scope/,
  )
  assert.equal(enabled.describe().pollAuditEnabled, true)
  assert.deepEqual(enabled.describe().pollChannelIds, [CHANNEL_ID])
  assert.equal(enabled.describe().pollCreationEnabled, true)
  assert.equal(enabled.describe().pollEndingEnabled, true)
  assert.equal(enabled.describe().pollVoterAuditEnabled, true)

  const empty = new ScopePolicy(loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOW_POLL_AUDIT: "true",
  }, { homeDirectory: "/test/home" }))
  assert.throws(() => empty.assertPollAuditable(channel()), /requires an explicit channel allowlist/)
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
      /expected int|must be an integer between/,
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
    /must be a Discord snowflake/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_BOT_ID: "not-an-id",
    }, { homeDirectory: "/test/home" }),
    /must be a Discord snowflake/,
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
    applicationEmojiAuditEnabled: false,
    applicationEmojiChangesEnabled: false,
    applicationEmojiCreationEnabled: false,
    applicationEmojiRootCount: 0,
    announcementCrosspostChannelIds: [],
    announcementCrosspostsEnabled: false,
    announcementSubscriptionAuditEnabled: false,
    announcementSubscriptionChangesEnabled: false,
    announcementSubscriptionSourceChannelIds: [],
    announcementSubscriptionTargetChannelIds: [],
    allowedChannelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    allowedGuildIds: [GUILD_ID],
    attachmentChannelIds: [],
    attachmentMaxBytes: 10 * 1_024 * 1_024,
    attachmentRootCount: 0,
    attachmentsEnabled: false,
    automodAlertChannelIds: [],
    automodAuditEnabled: false,
    automodChangesEnabled: false,
    automodGuildIds: [],
    banAuditEnabled: false,
    banAuditGuildIds: [],
    channelCloneAuditEnabled: false,
    channelCloneGuildIds: [],
    channelCloneSourceIds: [],
    channelCloningEnabled: false,
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    channelDeletionAuditEnabled: false,
    channelDeletionIds: [],
    channelDeletionsEnabled: false,
    channelMetadataChangesEnabled: false,
    channelMetadataIds: [],
    channelOrderingAuditEnabled: false,
    channelOrderingChangesEnabled: false,
    channelOrderingGuildIds: [],
    deleteChannelIds: [CHANNEL_ID],
    deletionsEnabled: true,
    forumPostChannelIds: [],
    forumPostsEnabled: false,
    forumTagAuditEnabled: false,
    forumTagChangesEnabled: false,
    forumTagChannelIds: [],
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    guildScaffoldGuildIds: [],
    guildScaffoldsEnabled: false,
    guildTemplateAuditEnabled: false,
    guildTemplateChangesEnabled: false,
    guildTemplateGuildIds: [],
    integrationAuditEnabled: false,
    integrationDeletionsEnabled: false,
    integrationGuildIds: [],
    integrationIds: [],
    guildExpressionAuditEnabled: false,
    guildExpressionChangesEnabled: false,
    guildExpressionCreationEnabled: false,
    guildExpressionGuildIds: [],
    guildExpressionRootCount: 0,
    guildProfileAuditEnabled: false,
    guildProfileChangesEnabled: false,
    guildProfileGuildIds: [],
    guildSettingsAuditEnabled: false,
    guildSettingsChangesEnabled: false,
    guildSettingsGuildIds: [],
    scheduledEventAuditEnabled: false,
    scheduledEventChangesEnabled: false,
    scheduledEventCoverChangesEnabled: false,
    scheduledEventGuildIds: [],
    scheduledEventRootCount: 0,
    scheduledEventUserAuditEnabled: false,
    soundboardAuditEnabled: false,
    soundboardChangesEnabled: false,
    soundboardCreationEnabled: false,
    soundboardGuildIds: [],
    soundboardRootCount: 0,
    stageChannelIds: [],
    stageInstanceAuditEnabled: false,
    stageInstanceChangesEnabled: false,
    stageStartNotificationsEnabled: false,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    inviteAuditEnabled: false,
    inviteDeletionsEnabled: false,
    inviteGuildIds: [],
    onboardingAuditEnabled: false,
    onboardingChangesEnabled: false,
    onboardingGuildIds: [],
    welcomeScreenAuditEnabled: false,
    welcomeScreenChangesEnabled: false,
    welcomeScreenGuildIds: [],
    widgetPublicExposureEnabled: false,
    widgetSettingsAuditEnabled: false,
    widgetSettingsChangesEnabled: false,
    widgetSettingsGuildIds: [],
    memberDirectoryEnabled: false,
    memberDirectoryGuildIds: [],
    nicknameChangesEnabled: false,
    nicknameGuildIds: [],
    otherMemberNicknameChangesEnabled: false,
    memberRoleChangesEnabled: false,
    memberRoleGuildIds: [],
    memberRoleCount: 0,
    memberVoiceAuditEnabled: false,
    memberVoiceChangesEnabled: false,
    memberVoiceChannelIds: [],
    memberVoiceGuildIds: [],
    crossGuildMessageForwardingEnabled: false,
    messageForwardingEnabled: false,
    messageForwardSourceChannelIds: [],
    messageForwardTargetChannelIds: [],
    nativeCommandChangesEnabled: false,
    nativeCommandName: "discord-mcp",
    nativeInteractionChannelIds: [],
    nativeInteractionGuildIds: [],
    nativeInteractionMaxPending: 25,
    nativeInteractionsEnabled: false,
    nativeInteractionTtlSeconds: 600,
    nativeInteractionUserIds: [],
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    permissionOverwriteChannelIds: [],
    permissionOverwritesEnabled: false,
    protectedUserCount: 0,
    pinChannelIds: [],
    pinManagementEnabled: false,
    pollAuditEnabled: false,
    pollChannelIds: [],
    pollCreationEnabled: false,
    pollEndingEnabled: false,
    pollVoterAuditEnabled: false,
    reactionChannelIds: [],
    reactionModerationEnabled: false,
    reactionUserAuditEnabled: false,
    readChannelScope: "allowlist",
    readGuildScope: "allowlist",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    roleConfigurationEnabled: false,
    roleConfigurationIds: [],
    roleDeletionAuditEnabled: false,
    roleDeletionIds: [],
    roleDeletionsEnabled: false,
    roleOrderingAuditEnabled: false,
    roleOrderingChangesEnabled: false,
    roleOrderingGuildIds: [],
    threadCreationEnabled: false,
    threadAuditEnabled: false,
    threadChangesEnabled: false,
    threadGuildIds: [],
    threadIds: [],
    threadMemberUserIds: [],
    threadParentIds: [],
    webhookAuditEnabled: false,
    webhookChannelIds: [],
    webhookChangesEnabled: false,
    webhookCreationEnabled: false,
    webhookDeletionsEnabled: false,
  })
})

test("configuration and policy isolate AutoMod audit, changes, and alert channels", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_AUTOMOD_AUDIT: "true",
    DISCORD_MCP_ALLOW_AUTOMOD_CHANGES: "true",
    DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_AUTOMOD_GUILD_IDS: GUILD_ID,
  }, { homeDirectory: "/test/home" })
  const scoped = new ScopePolicy(config)

  assert.equal(config.allowAutomodAudit, true)
  assert.equal(config.allowAutomodChanges, true)
  assert.deepEqual([...config.automodGuildIds], [GUILD_ID])
  assert.deepEqual([...config.automodAlertChannelIds], [CHANNEL_ID])
  scoped.assertAutomodAuditable(GUILD_ID)
  scoped.assertAutomodChangeAllowed(GUILD_ID)
  scoped.assertAutomodAlertChannelAllowed(CHANNEL_ID)
  assert.equal(scoped.automodAlertChannelAllowed(CHANNEL_ID), true)
  assert.equal(scoped.automodAlertChannelAllowed(OTHER_CHANNEL_ID), false)
  assert.throws(
    () => scoped.assertAutomodAuditable(OTHER_GUILD_ID),
    /configured read scope/,
  )
  assert.throws(
    () => scoped.assertAutomodAlertChannelAllowed(OTHER_CHANNEL_ID),
    /outside the AutoMod alert scope/,
  )
  const description = scoped.describe()
  assert.equal(description.automodAuditEnabled, true)
  assert.equal(description.automodChangesEnabled, true)
  assert.deepEqual(description.automodGuildIds, [GUILD_ID])
  assert.deepEqual(description.automodAlertChannelIds, [CHANNEL_ID])

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_AUTOMOD_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.automodAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_AUTOMOD_GUILD_IDS: OTHER_GUILD_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
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
      /requires \$\.capabilities\.guildExpressionAudit/,
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

test("configuration and policy bind application emojis to pinned identity and local roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-application-emoji-"))
  const root = await realpath(temporary)
  try {
    const config = loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_APPLICATION_ID: "900000000000000001",
      DISCORD_MCP_BOT_ID: "900000000000000002",
      DISCORD_MCP_ALLOW_APPLICATION_EMOJI_AUDIT: "true",
      DISCORD_MCP_ALLOW_APPLICATION_EMOJI_CHANGES: "true",
      DISCORD_MCP_APPLICATION_EMOJI_ROOTS: JSON.stringify([root]),
    }, { homeDirectory: "/test/home" })
    const scoped = new ScopePolicy(config)

    assert.equal(config.allowApplicationEmojiAudit, true)
    assert.equal(config.allowApplicationEmojiChanges, true)
    assert.deepEqual(config.applicationEmojiRoots, [root])
    scoped.assertApplicationEmojiAuditable()
    scoped.assertApplicationEmojiChangeAllowed()
    const description = scoped.describe()
    assert.equal(description.applicationEmojiAuditEnabled, true)
    assert.equal(description.applicationEmojiChangesEnabled, true)
    assert.equal(description.applicationEmojiCreationEnabled, true)
    assert.equal(description.applicationEmojiRootCount, 1)
    assert.equal(JSON.stringify(description).includes(root), false)

    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOW_APPLICATION_EMOJI_CHANGES: "true",
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.applicationEmojiAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_APPLICATION_EMOJI_ROOTS: "relative/path",
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration and policy isolate soundboard audit, changes, and local audio roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-soundboard-"))
  const root = await realpath(temporary)
  try {
    const config = loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT: "true",
      DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES: "true",
      DISCORD_MCP_SOUNDBOARD_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_SOUNDBOARD_ROOTS: JSON.stringify([root]),
    }, { homeDirectory: "/test/home" })
    const scoped = new ScopePolicy(config)

    assert.equal(config.allowSoundboardAudit, true)
    assert.equal(config.allowSoundboardChanges, true)
    assert.deepEqual([...config.soundboardGuildIds], [GUILD_ID])
    assert.deepEqual(config.soundboardRoots, [root])
    scoped.assertSoundboardAuditEnabled()
    scoped.assertSoundboardAuditable(GUILD_ID)
    scoped.assertSoundboardChangeAllowed(GUILD_ID)
    assert.throws(
      () => scoped.assertSoundboardAuditable(OTHER_GUILD_ID),
      /configured read scope/,
    )
    const description = scoped.describe()
    assert.equal(description.soundboardAuditEnabled, true)
    assert.equal(description.soundboardChangesEnabled, true)
    assert.equal(description.soundboardCreationEnabled, true)
    assert.equal(description.soundboardRootCount, 1)
    assert.equal(JSON.stringify(description).includes(root), false)

    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES: "true",
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.soundboardAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
        DISCORD_MCP_SOUNDBOARD_GUILD_IDS: OTHER_GUILD_ID,
      }, { homeDirectory: "/test/home" }),
      /must be a subset/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_SOUNDBOARD_ROOTS: "relative/path",
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
      DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT: "true",
      DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_SCHEDULED_EVENT_ROOTS: JSON.stringify([root]),
    }, { homeDirectory: "/test/home" })
    const scoped = new ScopePolicy(config)

    assert.equal(config.allowScheduledEventAudit, true)
    assert.equal(config.allowScheduledEventChanges, true)
    assert.equal(config.allowScheduledEventUserAudit, true)
    assert.deepEqual([...config.scheduledEventGuildIds], [GUILD_ID])
    assert.deepEqual(config.scheduledEventRoots, [root])
    scoped.assertScheduledEventAuditable(GUILD_ID)
    scoped.assertScheduledEventChangeAllowed(GUILD_ID)
    scoped.assertScheduledEventUsersAuditable(GUILD_ID)
    assert.throws(
      () => scoped.assertScheduledEventAuditable(OTHER_GUILD_ID),
      /configured read scope/,
    )
    const description = scoped.describe()
    assert.equal(description.scheduledEventAuditEnabled, true)
    assert.equal(description.scheduledEventChangesEnabled, true)
    assert.equal(description.scheduledEventCoverChangesEnabled, true)
    assert.equal(description.scheduledEventRootCount, 1)
    assert.equal(description.scheduledEventUserAuditEnabled, true)
    assert.equal(JSON.stringify(description).includes(root), false)

    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.scheduledEventAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT: "true",
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.scheduledEventAudit/,
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

test("configuration and policy isolate Stage instances to exact channels", () => {
  const config = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT: "true",
    DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES: "true",
    DISCORD_MCP_ALLOW_STAGE_START_NOTIFICATIONS: "true",
    DISCORD_MCP_STAGE_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)
  const stageChannel = channel({ type: DISCORD_CHANNEL_TYPES.stageVoice })

  assert.equal(config.allowStageInstanceAudit, true)
  assert.equal(config.allowStageInstanceChanges, true)
  assert.equal(config.allowStageStartNotifications, true)
  assert.deepEqual([...config.stageChannelIds], [CHANNEL_ID])
  assert.deepEqual(policy.stageInstanceAuditChannelIds(), [CHANNEL_ID])
  assert.equal(policy.assertStageInstanceAuditable(stageChannel), GUILD_ID)
  assert.equal(policy.assertStageInstanceChangeAllowed(stageChannel, true), GUILD_ID)
  assert.throws(
    () => policy.assertStageInstanceAuditable(channel()),
    /requires an exact Stage channel/,
  )
  assert.throws(
    () => policy.assertStageInstanceAuditable(channel({
      id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.stageVoice,
    })),
    /outside the Stage-instance scope/,
  )
  const description = policy.describe()
  assert.deepEqual(description.stageChannelIds, [CHANNEL_ID])
  assert.equal(description.stageInstanceAuditEnabled, true)
  assert.equal(description.stageInstanceChangesEnabled, true)
  assert.equal(description.stageStartNotificationsEnabled, true)

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.stageInstanceAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT: "true",
      DISCORD_MCP_ALLOW_STAGE_START_NOTIFICATIONS: "true",
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.stageInstanceChanges/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_STAGE_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_STAGE_CHANNEL_IDS: Array.from(
        { length: CONNECTOR_LIMITS.stageInstanceChannels + 1 },
        (_, index) => String(500000000000000000n + BigInt(index)),
      ).join(","),
    }, { homeDirectory: "/test/home" }),
    /at most 25 unique IDs/,
  )
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

test("configuration and policy isolate reaction identities and moderation to exact channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_REACTION_CHANNEL_IDS: OTHER_CHANNEL_ID,
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.reactionChannelIds must be a subset/,
  )
  for (const enabled of [
    "DISCORD_MCP_ALLOW_REACTION_USER_AUDIT",
    "DISCORD_MCP_ALLOW_REACTION_MODERATION",
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        DISCORD_BOT_TOKEN: TOKEN,
        [enabled]: "true",
      }, { homeDirectory: "/test/home" }),
      /exact reaction-channel allowlist/,
    )
  }

  const auditConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${OTHER_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_REACTION_USER_AUDIT: "true",
    DISCORD_MCP_REACTION_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const auditPolicy = new ScopePolicy(auditConfig)
  assert.equal(auditPolicy.assertChannelReactionAuditable(channel()), GUILD_ID)
  assert.throws(
    () => auditPolicy.assertChannelReactionAuditable(channel({ id: OTHER_CHANNEL_ID })),
    /outside the reaction scope/,
  )
  assert.throws(
    () => auditPolicy.assertChannelReactionModeratable(channel()),
    /reaction moderation is disabled/,
  )
  assert.equal(auditPolicy.describe().reactionUserAuditEnabled, true)
  assert.equal(auditPolicy.describe().reactionModerationEnabled, false)

  const moderationConfig = loadConnectorConfig({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOW_REACTION_MODERATION: "true",
    DISCORD_MCP_APPLICATION_ID: "300000000000000001",
    DISCORD_MCP_BOT_ID: "300000000000000002",
    DISCORD_MCP_REACTION_CHANNEL_IDS: CHANNEL_ID,
  }, { homeDirectory: "/test/home" })
  const moderationPolicy = new ScopePolicy(moderationConfig)
  assert.equal(
    moderationPolicy.assertChannelReactionModeratable(channel()),
    GUILD_ID,
  )
  assert.equal(moderationPolicy.describe().reactionModerationEnabled, true)
  assert.equal(moderationPolicy.describe().reactionUserAuditEnabled, false)
  assert.deepEqual(moderationPolicy.describe().reactionChannelIds, [CHANNEL_ID])

  assert.throws(
    () => loadConnectorConfig({
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_REACTION_CHANNEL_IDS: Array.from(
        { length: CONNECTOR_LIMITS.reactionChannelAllowlist + 1 },
        (_, index) => String(600000000000000000n + BigInt(index)),
      ).join(","),
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})
