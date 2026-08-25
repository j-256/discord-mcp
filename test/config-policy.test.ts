import assert from "node:assert/strict"
import {
  chmod,
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
      {
        stateHome: "relative-state",
      },
      { homeDirectory: "/test/home" },
    ),
    "/test/home/.local/state/discord-mcp/activity.jsonl",
  )
  assert.equal(
    loadConnectorConfig({
      token: TOKEN,
      storage: {
        auditFile: "/test/shared/activity.jsonl",
      },
    }).auditFile,
    "/test/shared/activity.jsonl",
  )
})

test("configuration parses bounded scope and deletion controls", () => {
  const config = loadConnectorConfig({
    token: `  ${TOKEN}  `,
    stateHome: "/test/state",
    capabilities: {
      administration: true,
      announcementCrossposts: true,
      banAudit: true,
      deletions: true,
      interactions: true,
      memberDirectory: true,
      permissionOverwrites: true,
      pinManagement: true,
    },
    identity: {
      applicationId: "300000000000000001",
      botId: "300000000000000002",
    },
    limits: {
      interactionMaxWritesPerMinute: 12,
      interactionMinWriteIntervalMs: 750,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      adminGuildIds: [GUILD_ID],
      announcementCrosspostChannelIds: [CHANNEL_ID],
      banAuditGuildIds: [GUILD_ID],
      deleteChannelIds: [CHANNEL_ID],
      interactionChannelIds: [OTHER_CHANNEL_ID],
      mentionUserIds: [USER_ID],
      memberDirectoryGuildIds: [GUILD_ID],
      permissionOverwriteChannelIds: [CHANNEL_ID],
      pinChannelIds: [CHANNEL_ID],
      protectedUserIds: [USER_ID],
    },
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
    token: TOKEN,
    tools: {
      toolsets: ["messages", "connector"],
      surface: "progressive",
    },
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
    applicationIntentChangesEnabled: false,
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
    bulkBanAuditEnabled: false,
    bulkBanGuildIds: [],
    bulkBansEnabled: false,
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
    guildIncidentAuditEnabled: false,
    guildIncidentChangesEnabled: false,
    guildIncidentGuildIds: [],
    guildProfileAuditEnabled: false,
    guildProfileChangesEnabled: false,
    guildProfileGuildIds: [],
    guildPruneAuditEnabled: false,
    guildPruneGuildIds: [],
    guildPruneIncludeRoleIds: [],
    guildPruneMaxMembers: 25,
    guildPrunesEnabled: false,
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
    inviteCapabilityRootCount: 0,
    inviteCreationChannelIds: [],
    inviteCreationEnabled: false,
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
    {
      tools: {
        surface: "hidden" as never,
      },
    },
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        ...environment,
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  }
})

test("configuration keeps Gateway disabled and requires pinned bounded scope when enabled", () => {
  const enabled = loadConnectorConfig({
    token: TOKEN,
    gateway: {
      enabled: true,
      eventBufferSize: 250,
    },
    identity: {
      applicationId: "300000000000000001",
      botId: "300000000000000002",
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" })
  assert.equal(enabled.allowGateway, true)
  assert.equal(enabled.gatewayEventBufferSize, 250)

  for (const value of ["0", "1001", "1.5"]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        gateway: {
          eventBufferSize: Number(value),
        },
      }, { homeDirectory: "/test/home" }),
      /expected number to be|expected int|must be an integer between 1 and 1000/,
    )
  }
})

test("configuration and policy isolate native Interaction ingress and command changes", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      nativeCommandChanges: true,
      nativeInteractions: true,
    },
    identity: {
      applicationId: "300000000000000001",
      botId: "300000000000000002",
    },
    limits: {
      nativeInteractionMaxPending: 12,
      nativeInteractionTtlSeconds: 300,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    runtime: {
      nativeCommandName: "private-request",
    },
    scopes: {
      nativeInteractionChannelIds: [CHANNEL_ID],
      nativeInteractionGuildIds: [GUILD_ID],
      nativeInteractionUserIds: [USER_ID],
    },
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
      capabilities: {
        nativeCommandChanges: true,
      },
      identity: {
        applicationId: "300000000000000001",
        botId: "300000000000000002",
      },
    },
    {
      capabilities: {
        nativeInteractions: true,
      },
      identity: {
        applicationId: "300000000000000001",
        botId: "300000000000000002",
      },
      scopes: {
        nativeInteractionGuildIds: [GUILD_ID],
      },
    },
    {
      runtime: {
        nativeCommandName: "Not Valid",
      },
    },
    {
      limits: {
        nativeInteractionTtlSeconds: 29,
      },
    },
    {
      limits: {
        nativeInteractionTtlSeconds: 841,
      },
    },
    {
      limits: {
        nativeInteractionMaxPending: 101,
      },
    },
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        ...environment,
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  }

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        nativeInteractionChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
})

test("configuration rejects deletion channels outside a read channel allowlist", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        deleteChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    ConfigurationError,
  )
})

test("configuration and policy isolate webhook audit and administration authority", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      webhookAudit: true,
      webhookChanges: true,
      webhookCreation: true,
      webhookDeletions: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      webhookChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    scopes: {
      webhookChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelWebhookAuditable(channel()),
    /webhook audit is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      webhookAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertChannelWebhookAuditable(channel()),
    /requires an explicit channel allowlist/,
  )

  const deletionDisabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      webhookAudit: true,
    },
    scopes: {
      webhookChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      capabilities: {
        webhookDeletions: true,
      },
      scopes: {
        webhookChannelIds: [CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.webhookAudit/,
  )
  for (const capability of [
    "webhookChanges",
    "webhookCreation",
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        capabilities: {
          [capability]: true,
        },
        scopes: {
          webhookChannelIds: [CHANNEL_ID],
        },
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.webhookAudit/,
    )
  }
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        webhookChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.webhookChannelIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        webhookAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate integration audit and exact-ID deletion", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
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
    token: TOKEN,
    scopes: {
      integrationGuildIds: [GUILD_ID],
      integrationIds: [INTEGRATION_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildIntegrationAuditable(GUILD_ID),
    /integration audit is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      integrationAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildIntegrationAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  const deletionDisabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      integrationAudit: true,
    },
    scopes: {
      integrationGuildIds: [GUILD_ID],
      integrationIds: [INTEGRATION_ID],
    },
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
      token: TOKEN,
      capabilities: {
        integrationDeletions: true,
      },
      scopes: {
        integrationGuildIds: [GUILD_ID],
        integrationIds: [INTEGRATION_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.integrationAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        integrationGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.integrationGuildIds must be a subset/,
  )
})

test("configuration and policy require an exact administration guild and protect exact users", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        adminGuildIds: ["999999999999999999"],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      adminGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberAdministrationAllowed(GUILD_ID, USER_ID),
    /administration is disabled/,
  )

  const policy = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      administration: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      adminGuildIds: [GUILD_ID],
      protectedUserIds: [USER_ID],
    },
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
    applicationIntentChangesEnabled: false,
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
    bulkBanAuditEnabled: false,
    bulkBanGuildIds: [],
    bulkBansEnabled: false,
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
    guildIncidentAuditEnabled: false,
    guildIncidentChangesEnabled: false,
    guildIncidentGuildIds: [],
    guildProfileAuditEnabled: false,
    guildProfileChangesEnabled: false,
    guildProfileGuildIds: [],
    guildPruneAuditEnabled: false,
    guildPruneGuildIds: [],
    guildPruneIncludeRoleIds: [],
    guildPruneMaxMembers: 25,
    guildPrunesEnabled: false,
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
    inviteCapabilityRootCount: 0,
    inviteCreationChannelIds: [],
    inviteCreationEnabled: false,
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
    token: TOKEN,
    capabilities: {
      memberDirectory: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      memberDirectoryGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberDirectoryAllowed(GUILD_ID),
    /member directory is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      memberDirectory: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertMemberDirectoryAllowed(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberDirectoryGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberDirectoryGuildIds must be a subset/,
  )
})

test("configuration and policy require an opt-in exact ban-audit guild scope", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      banAudit: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      banAuditGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertBanAuditAllowed(GUILD_ID),
    /ban audit is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      banAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertBanAuditAllowed(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        banAuditGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.banAuditGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        banAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate reviewed bulk guild bans", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      bulkBanAudit: true,
      bulkBans: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      bulkBanGuildIds: [GUILD_ID],
      protectedUserIds: [USER_ID],
    },
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowBulkBanAudit, true)
  assert.equal(config.allowBulkBans, true)
  assert.deepEqual([...config.bulkBanGuildIds], [GUILD_ID])
  assert.equal(policy.describe().bulkBanAuditEnabled, true)
  assert.equal(policy.describe().bulkBansEnabled, true)
  assert.deepEqual(policy.describe().bulkBanGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertBulkBanAuditAllowed(GUILD_ID))
  assert.doesNotThrow(() => policy.assertBulkBanExecutionAllowed(GUILD_ID))
  assert.throws(
    () => policy.assertBulkBanAuditAllowed(OTHER_GUILD_ID),
    /outside the bulk-ban scope/,
  )
  assert.throws(
    () => policy.assertUserNotProtected(USER_ID),
    /protected from administration/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      bulkBanAudit: true,
    },
    scopes: {
      bulkBanGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertBulkBanAuditAllowed(GUILD_ID))
  assert.throws(
    () => auditOnly.assertBulkBanExecutionAllowed(GUILD_ID),
    /bulk bans are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        bulkBans: true,
      },
      scopes: {
        bulkBanGuildIds: [GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.capabilities\.bulkBans requires \$\.capabilities\.bulkBanAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        bulkBanAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.capabilities\.bulkBanAudit requires \$\.scopes\.bulkBanGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        bulkBanGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.bulkBanGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        bulkBanAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate bounded reviewed guild prunes", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildPruneAudit: true,
      guildPrunes: true,
    },
    limits: {
      guildPruneMaxMembers: 12,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      guildPruneGuildIds: [GUILD_ID],
      guildPruneIncludeRoleIds: [ROLE_ID],
      protectedUserIds: [USER_ID],
    },
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowGuildPruneAudit, true)
  assert.equal(config.allowGuildPrunes, true)
  assert.deepEqual([...config.guildPruneGuildIds], [GUILD_ID])
  assert.deepEqual([...config.guildPruneIncludeRoleIds], [ROLE_ID])
  assert.equal(config.guildPruneMaxMembers, 12)
  assert.equal(policy.describe().guildPruneAuditEnabled, true)
  assert.equal(policy.describe().guildPrunesEnabled, true)
  assert.deepEqual(policy.describe().guildPruneGuildIds, [GUILD_ID])
  assert.deepEqual(policy.describe().guildPruneIncludeRoleIds, [ROLE_ID])
  assert.equal(policy.describe().guildPruneMaxMembers, 12)
  assert.doesNotThrow(() => policy.assertGuildPruneAuditAllowed(GUILD_ID, [ROLE_ID]))
  assert.doesNotThrow(() => policy.assertGuildPruneExecutionAllowed(GUILD_ID, [ROLE_ID]))
  assert.throws(
    () => policy.assertGuildPruneAuditAllowed(OTHER_GUILD_ID, [ROLE_ID]),
    /outside the guild prune scope/,
  )
  assert.throws(
    () => policy.assertGuildPruneAuditAllowed(GUILD_ID, [OTHER_ROLE_ID]),
    /outside the guild prune include-role scope/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildPruneAudit: true,
    },
    scopes: {
      guildPruneGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildPruneAuditAllowed(GUILD_ID, []))
  assert.throws(
    () => auditOnly.assertGuildPruneExecutionAllowed(GUILD_ID, []),
    /guild prunes are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildPrunes: true,
      },
      scopes: {
        guildPruneGuildIds: [GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.capabilities\.guildPrunes requires \$\.capabilities\.guildPruneAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildPruneAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.capabilities\.guildPruneAudit requires \$\.scopes\.guildPruneGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildPruneGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildPruneGuildIds must be a subset/,
  )
  for (const guildPruneMaxMembers of [0, 251]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        limits: { guildPruneMaxMembers },
      }, { homeDirectory: "/test/home" }),
      /\$\.limits\.guildPruneMaxMembers/,
    )
  }
  const excessiveRoleIds = Array.from(
    { length: CONNECTOR_LIMITS.guildPruneRoleAllowlist + 1 },
    (_, index) => (300_000_000_000_001_000n + BigInt(index)).toString(),
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        guildPruneIncludeRoleIds: excessiveRoleIds,
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildPruneIncludeRoleIds/,
  )
})

test("configuration and policy isolate capability-safe invite audit and revocation", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      inviteAudit: true,
      inviteDeletions: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      inviteGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildInviteAuditable(GUILD_ID),
    /invite audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      inviteAudit: true,
    },
    scopes: {
      inviteGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildInviteAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildInviteDeletable(GUILD_ID),
    /invite deletion is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      inviteAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildInviteAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        inviteGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.inviteGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        inviteDeletions: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.inviteAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        inviteAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate finite private-file invite creation", async (context) => {
  const capabilityRoot = await realpath(
    await mkdtemp(join(tmpdir(), "discord-mcp-invite-policy-")),
  )
  context.after(() => rm(capabilityRoot, { recursive: true, force: true }))
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      inviteCreation: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      inviteCreationChannelIds: [CHANNEL_ID],
    },
    storage: {
      inviteCapabilityRoots: [capabilityRoot],
    },
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowInviteCreation, true)
  assert.deepEqual([...config.inviteCreationChannelIds], [CHANNEL_ID])
  assert.deepEqual(config.inviteCapabilityRoots, [capabilityRoot])
  assert.equal(policy.describe().inviteCreationEnabled, true)
  assert.deepEqual(policy.describe().inviteCreationChannelIds, [CHANNEL_ID])
  assert.equal(policy.describe().inviteCapabilityRootCount, 1)
  assert.doesNotThrow(() => policy.assertGuildInviteCreatable(GUILD_ID, CHANNEL_ID))
  assert.throws(
    () => policy.assertGuildInviteCreatable(GUILD_ID, OTHER_CHANNEL_ID),
    /outside the invite-creation scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildInviteCreatable(GUILD_ID, CHANNEL_ID),
    /invite creation is disabled/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: { inviteCreation: true },
      storage: { inviteCapabilityRoots: [capabilityRoot] },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.inviteCreationChannelIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: { inviteCreation: true },
      scopes: { inviteCreationChannelIds: [CHANNEL_ID] },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.storage\.inviteCapabilityRoots/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: { channelIds: [CHANNEL_ID] },
      scopes: { inviteCreationChannelIds: [OTHER_CHANNEL_ID] },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.inviteCreationChannelIds must be a subset/,
  )
  await chmod(capabilityRoot, 0o777)
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: { inviteCreation: true },
      scopes: { inviteCreationChannelIds: [CHANNEL_ID] },
      storage: { inviteCapabilityRoots: [capabilityRoot] },
    }, { homeDirectory: "/test/home" }),
    /not group or world writable/,
  )
  await chmod(capabilityRoot, 0o700)
})

test("configuration and policy isolate reviewed guild onboarding", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      onboardingAudit: true,
      onboardingChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      onboardingGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildOnboardingAuditable(GUILD_ID),
    /onboarding audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      onboardingAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      onboardingGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildOnboardingAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildOnboardingChangeable(GUILD_ID),
    /onboarding changes are disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      onboardingAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildOnboardingAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        onboardingGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.onboardingGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        onboardingChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.onboardingAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        onboardingAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate reviewed guild Welcome Screens", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      welcomeScreenAudit: true,
      welcomeScreenChanges: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      welcomeScreenGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildWelcomeScreenAuditable(GUILD_ID),
    /Welcome Screen audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      welcomeScreenAudit: true,
    },
    scopes: {
      welcomeScreenGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildWelcomeScreenAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildWelcomeScreenChangeable(GUILD_ID),
    /Welcome Screen changes are disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      welcomeScreenAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildWelcomeScreenAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        welcomeScreenGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.welcomeScreenGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        welcomeScreenChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.welcomeScreenAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        welcomeScreenAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate reviewed authenticated widget settings", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      widgetPublicExposure: true,
      widgetSettingsAudit: true,
      widgetSettingsChanges: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      widgetSettingsGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildWidgetSettingsAuditable(GUILD_ID),
    /widget-settings audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      widgetSettingsAudit: true,
    },
    scopes: {
      widgetSettingsGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildWidgetSettingsAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildWidgetSettingsChangeable(GUILD_ID),
    /widget-settings changes are disabled/,
  )

  const changesOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      widgetSettingsAudit: true,
      widgetSettingsChanges: true,
    },
    scopes: {
      widgetSettingsGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => changesOnly.assertGuildWidgetSettingsChangeable(GUILD_ID))
  assert.throws(
    () => changesOnly.assertGuildWidgetPublicExposureChangeable(GUILD_ID),
    /widget public exposure is disabled/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      widgetSettingsAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildWidgetSettingsAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        widgetSettingsGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.widgetSettingsGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        widgetSettingsChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.widgetSettingsAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        widgetPublicExposure: true,
        widgetSettingsAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.widgetSettingsChanges/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        widgetSettingsAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        widgetSettingsGuildIds: Array.from(
          { length: 101 },
          (_, index) => (500_000_000_000_000_000n + BigInt(index)).toString(),
        ),
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed guild settings", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildSettingsAudit: true,
      guildSettingsChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      guildSettingsGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildSettingsAuditable(GUILD_ID),
    /guild-settings audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildSettingsAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      guildSettingsGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildSettingsAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildSettingsChangeable(GUILD_ID),
    /guild-settings changes are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildSettingsChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildSettingsAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildSettingsAudit: true,
      },
      identity: {
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.guildSettingsGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildSettingsGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildSettingsGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        guildSettingsGuildIds: Array.from(
          { length: 101 },
          (_, index) => (510_000_000_000_000_000n + BigInt(index)).toString(),
        ),
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed guild incident actions", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildIncidentAudit: true,
      guildIncidentChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      guildIncidentGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(config)

  assert.equal(config.allowGuildIncidentAudit, true)
  assert.equal(config.allowGuildIncidentChanges, true)
  assert.deepEqual([...config.guildIncidentGuildIds], [GUILD_ID])
  assert.equal(policy.describe().guildIncidentAuditEnabled, true)
  assert.equal(policy.describe().guildIncidentChangesEnabled, true)
  assert.deepEqual(policy.describe().guildIncidentGuildIds, [GUILD_ID])
  assert.doesNotThrow(() => policy.assertGuildIncidentAuditable(GUILD_ID))
  assert.doesNotThrow(() => policy.assertGuildIncidentChangeable(GUILD_ID))
  assert.throws(
    () => policy.assertGuildIncidentAuditable(OTHER_GUILD_ID),
    /outside the guild incident-action scope/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildIncidentAuditable(GUILD_ID),
    /guild incident-action audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildIncidentAudit: true,
    },
    scopes: {
      guildIncidentGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildIncidentAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildIncidentChangeable(GUILD_ID),
    /guild incident-action changes are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildIncidentChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildIncidentAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildIncidentAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.guildIncidentGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildIncidentGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildIncidentGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        guildIncidentGuildIds: Array.from(
          { length: 101 },
          (_, index) => (520_000_000_000_000_000n + BigInt(index)).toString(),
        ),
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed guild profile text", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildProfileAudit: true,
      guildProfileChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      guildProfileGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildProfileAuditable(GUILD_ID),
    /guild profile audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildProfileAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      guildProfileGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.doesNotThrow(() => auditOnly.assertGuildProfileAuditable(GUILD_ID))
  assert.throws(
    () => auditOnly.assertGuildProfileChangeable(GUILD_ID),
    /guild profile changes are disabled/,
  )

  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildProfileChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildProfileAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildProfileAudit: true,
      },
      identity: {
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.guildProfileGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildProfileGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.guildProfileGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildProfileAudit: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        guildProfileGuildIds: Array.from(
          { length: 101 },
          (_, index) => (530_000_000_000_000_000n + BigInt(index)).toString(),
        ),
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration and policy isolate reviewed member nickname authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        nicknameGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.nicknameGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        otherMemberNicknameChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.capabilities\.otherMemberNicknameChanges requires \$\.capabilities\.nicknameChanges/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      nicknameGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertNicknameChangeAllowed(GUILD_ID),
    /nickname changes are disabled/,
  )

  const missingGuilds = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      nicknameChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => missingGuilds.assertNicknameChangeAllowed(GUILD_ID),
    /require an explicit guild allowlist/,
  )

  const selfOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      nicknameChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      nicknameGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
    capabilities: {
      nicknameChanges: true,
      otherMemberNicknameChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      nicknameGuildIds: [GUILD_ID],
      protectedUserIds: [USER_ID],
    },
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
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        nicknameGuildIds: excessiveGuilds,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy isolate exact member-role authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberRoleGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberRoleGuildIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      memberRoleGuildIds: [GUILD_ID],
      memberRoleIds: [ROLE_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /member-role changes are disabled/,
  )

  const missingGuilds = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      memberRoleChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      memberRoleIds: [ROLE_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => missingGuilds.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /require an explicit guild allowlist/,
  )

  const missingRoles = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      memberRoleChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      memberRoleGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => missingRoles.assertMemberRoleChangeAllowed(GUILD_ID, USER_ID, ROLE_ID),
    /require an exact role allowlist/,
  )

  const policy = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      memberRoleChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      memberRoleGuildIds: [GUILD_ID],
      memberRoleIds: [ROLE_ID, OTHER_ROLE_ID],
      protectedUserIds: [USER_ID],
    },
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
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        memberRoleIds: excessiveRoles,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy isolate exact member voice audit and changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        memberVoiceGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberVoiceGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        memberVoiceChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.memberVoiceChannelIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      memberVoiceChannelIds: [CHANNEL_ID],
      memberVoiceGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertMemberVoiceAuditable(GUILD_ID),
    /member voice audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      memberVoiceAudit: true,
    },
    scopes: {
      memberVoiceChannelIds: [CHANNEL_ID],
      memberVoiceGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
    capabilities: {
      memberVoiceAudit: true,
      memberVoiceChanges: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      memberVoiceChannelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      memberVoiceGuildIds: [GUILD_ID],
      protectedUserIds: [USER_ID],
    },
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
    token: TOKEN,
    capabilities: {
      memberVoiceAudit: true,
    },
    scopes: {
      memberVoiceGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => emptyChannels.assertMemberVoiceAuditable(GUILD_ID),
    /requires an exact channel allowlist/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        memberVoiceChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.memberVoiceAudit/,
  )
})

test("configuration and policy isolate exact channel creation authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelCreationGuildIds: ["999999999999999999"],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      channelCreationGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelCreationAllowed(GUILD_ID),
    /creation is disabled/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      channelCreation: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      channelCreationGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  enabled.assertChannelCreationAllowed(GUILD_ID)
  assert.throws(
    () => enabled.assertChannelCreationAllowed(OTHER_GUILD_ID),
    /outside the channel creation scope/,
  )
  assert.equal(enabled.describe().channelCreationEnabled, true)
  assert.deepEqual(enabled.describe().channelCreationGuildIds, [GUILD_ID])

  const moderationOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      administration: true,
    },
    scopes: {
      adminGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => moderationOnly.assertChannelCreationAllowed(GUILD_ID),
    /creation is disabled/,
  )
})

test("configuration and policy isolate reviewed metadata changes to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        channelMetadataIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.channelMetadataIds must be a subset/,
  )

  const disabledConfig = loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      channelMetadataIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" })
  const disabled = new ScopePolicy(disabledConfig)
  assert.equal(disabledConfig.allowChannelMetadataChanges, false)
  assert.throws(
    () => disabled.assertChannelMetadataChangeAllowed(channel()),
    /channel-metadata changes are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      channelMetadataChanges: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      channelMetadataIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      channelMetadataChanges: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertChannelMetadataChangeAllowed(channel()),
    /require an explicit channel allowlist/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelMetadataChanges: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
})

test("configuration and policy isolate exact role creation authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        roleCreationGuildIds: ["999999999999999999"],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      roleCreationGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertRoleCreationAllowed(GUILD_ID),
    /role creation is disabled/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      roleCreation: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      roleCreationGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
    scopes: {
      roleConfigurationIds: [ROLE_ID],
    },
  }, { homeDirectory: "/test/home" })
  const disabled = new ScopePolicy(disabledConfig)
  assert.equal(disabledConfig.allowRoleConfiguration, false)
  assert.throws(
    () => disabled.assertRoleConfigurationAllowed(GUILD_ID, ROLE_ID),
    /role configuration is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      roleConfiguration: true,
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
    scopes: {
      roleConfigurationIds: [ROLE_ID],
    },
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
    token: TOKEN,
    capabilities: {
      roleConfiguration: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertRoleConfigurationAllowed(GUILD_ID, ROLE_ID),
    /requires an explicit role allowlist/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        roleConfiguration: "sometimes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
  const excessiveRoleIds = Array.from(
    { length: CONNECTOR_LIMITS.roleConfigurationAllowlist + 1 },
    (_, index) => (500_000_000_000_000_000n + BigInt(index)).toString(),
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        roleConfigurationIds: excessiveRoleIds,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate role-order audit from exact-guild changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        roleOrderingChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.roleOrderingAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        roleOrderingGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      roleOrderingAudit: true,
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
    scopes: {
      roleOrderingGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
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
  }, { homeDirectory: "/test/home" })
  const changes = new ScopePolicy(changesConfig)
  changes.assertRoleOrderingChangeable(GUILD_ID)
  assert.equal(changes.describe().roleOrderingChangesEnabled, true)
  assert.throws(
    () => changes.assertRoleOrderingAuditable(OTHER_GUILD_ID),
    /configured read scope/,
  )

  const empty = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      roleOrderingAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertRoleOrderingAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )

  const excessiveGuildIds = Array.from(
    { length: CONNECTOR_LIMITS.roleOrderingGuildAllowlist + 1 },
    (_, index) => (600_000_000_000_000_000n + BigInt(index)).toString(),
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        roleOrderingGuildIds: excessiveGuildIds,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate channel-clone audit from exact-source changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelCloning: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.channelCloneAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelCloneAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.channelCloneGuildIds and \$\.scopes\.channelCloneSourceIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelCloneGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        channelCloneSourceIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      channelCloneAudit: true,
    },
    identity: {
      applicationId: ROLE_ID,
      botId: USER_ID,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      channelCloneGuildIds: [GUILD_ID],
      channelCloneSourceIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      channelCloneAudit: true,
      channelCloning: true,
    },
    identity: {
      applicationId: ROLE_ID,
      botId: USER_ID,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      channelCloneGuildIds: [GUILD_ID],
      channelCloneSourceIds: [CHANNEL_ID],
    },
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
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        channelCloneSourceIds: excessiveSources,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate channel-order audit from exact-guild changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelOrderingChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.channelOrderingAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelOrderingAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.channelOrderingGuildIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelOrderingGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      channelOrderingAudit: true,
    },
    identity: {
      applicationId: ROLE_ID,
      botId: USER_ID,
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
    scopes: {
      channelOrderingGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
    capabilities: {
      channelOrderingAudit: true,
      channelOrderingChanges: true,
    },
    identity: {
      applicationId: ROLE_ID,
      botId: USER_ID,
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
    scopes: {
      channelOrderingGuildIds: [GUILD_ID],
    },
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
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        channelOrderingGuildIds: excessiveGuildIds,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate reviewed channel-deletion audit from execution", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelDeletions: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.channelDeletionAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelDeletionAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.channelDeletionIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        channelDeletionAudit: true,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        channelDeletionIds: [CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.gateway\.enabled/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        channelDeletionIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const auditConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      channelDeletionAudit: true,
    },
    gateway: {
      enabled: true,
    },
    identity: {
      applicationId: ROLE_ID,
      botId: USER_ID,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      channelDeletionIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      channelDeletionAudit: true,
      channelDeletions: true,
    },
    gateway: {
      enabled: true,
    },
    identity: {
      applicationId: ROLE_ID,
      botId: USER_ID,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      channelDeletionIds: [CHANNEL_ID],
    },
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
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        channelDeletionIds: excessiveIds,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy separate reviewed role-deletion audit from execution", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        roleDeletions: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.roleDeletionAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        roleDeletionAudit: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.scopes\.roleDeletionIds/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        roleDeletionAudit: true,
      },
      identity: {
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
      },
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        roleDeletionIds: [ROLE_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.gateway\.enabled/,
  )

  const auditConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      roleDeletionAudit: true,
    },
    gateway: {
      enabled: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
    scopes: {
      roleDeletionIds: [ROLE_ID],
    },
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
    token: TOKEN,
    capabilities: {
      roleDeletionAudit: true,
      roleDeletions: true,
    },
    gateway: {
      enabled: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID],
    },
    scopes: {
      roleDeletionIds: [ROLE_ID],
    },
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
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        roleDeletionIds: excessiveIds,
      },
    }, { homeDirectory: "/test/home" }),
    /must contain at most 100 unique IDs/,
  )
})

test("configuration and policy isolate exact guild scaffold authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildScaffoldGuildIds: ["999999999999999999"],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      guildScaffoldGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildScaffoldAllowed(GUILD_ID),
    /guild scaffolds are disabled/,
  )

  const enabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildScaffolds: true,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      guildScaffoldGuildIds: [GUILD_ID],
    },
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
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        guildTemplateGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        guildTemplateChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.guildTemplateAudit/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      guildTemplateGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertGuildTemplateAuditable(GUILD_ID),
    /guild-template audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildTemplateAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    scopes: {
      guildTemplateGuildIds: [GUILD_ID],
    },
  }, { homeDirectory: "/test/home" }))
  auditOnly.assertGuildTemplateAuditable(GUILD_ID)
  assert.throws(
    () => auditOnly.assertGuildTemplateChangeable(GUILD_ID),
    /guild-template changes are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      guildTemplateAudit: true,
      guildTemplateChanges: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      guildTemplateGuildIds: [GUILD_ID],
    },
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
    token: TOKEN,
    capabilities: {
      guildTemplateAudit: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertGuildTemplateAuditable(GUILD_ID),
    /requires an explicit guild allowlist/,
  )
})

test("configuration and policy isolate forum posts to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        forumPostChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      forumPostChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertForumPostAllowed(channel()),
    /forum posts are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      forumPosts: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      forumPostChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        forumTagChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        forumTagChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.forumTagAudit/,
  )

  const forum = channel({ type: DISCORD_CHANNEL_TYPES.forum })
  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    scopes: {
      forumTagChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertForumTagAuditable(forum),
    /forum-tag audit is disabled/,
  )

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      forumTagAudit: true,
    },
    scopes: {
      forumTagChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      forumTagAudit: true,
      forumTagChanges: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      forumTagChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      forumTagAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => empty.assertForumTagAuditable(forum),
    /requires an explicit channel allowlist/,
  )
})

test("configuration and policy isolate thread creation to exact readable parents", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        threadParentIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.threadParentIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      threadParentIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertThreadCreatable(channel()),
    /thread creation is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      threadCreation: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      threadParentIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      capabilities: {
        threadChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.threadAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        threadGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.threadGuildIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        threadIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.threadIds must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      threadGuildIds: [GUILD_ID],
      threadIds: [CHANNEL_ID],
      threadMemberUserIds: [USER_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertThreadAuditable(GUILD_ID, CHANNEL_ID),
    /thread audit is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      threadAudit: true,
      threadChanges: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      threadGuildIds: [GUILD_ID],
      threadIds: [CHANNEL_ID],
      threadMemberUserIds: [USER_ID],
    },
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
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        pinChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      pinChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelPinManageable(channel()),
    /pin management is disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      pinManagement: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      pinChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        announcementCrosspostChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      announcementCrosspostChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelAnnouncementCrosspostable(channel({
      type: DISCORD_CHANNEL_TYPES.announcement,
    })),
    /announcement crossposts are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      announcementCrossposts: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      announcementCrosspostChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        messageForwardSourceChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        messageForwarding: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires exact source and target channel allowlists/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        crossGuildMessageForwarding: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.messageForwarding/,
  )

  const environment = {
    token: TOKEN,
    capabilities: {
      messageForwarding: true,
    },
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    },
    scopes: {
      messageForwardSourceChannelIds: [CHANNEL_ID],
      messageForwardTargetChannelIds: [OTHER_CHANNEL_ID],
    },
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
    capabilities: {
      ...environment.capabilities,
      crossGuildMessageForwarding: true,
    },
  }, { homeDirectory: "/test/home" }))
  crossGuild.assertMessageForwardGuildBoundary(GUILD_ID, OTHER_GUILD_ID)
  assert.equal(crossGuild.describe().crossGuildMessageForwardingEnabled, true)
})

test("configuration and policy independently scope announcement subscription audit and changes", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        announcementSubscriptionSourceChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.announcementSubscriptionSourceChannelIds must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        announcementSubscriptionChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.announcementSubscriptionAudit/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      announcementSubscriptionAudit: true,
      announcementSubscriptionChanges: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      announcementSubscriptionSourceChannelIds: [OTHER_CHANNEL_ID],
      announcementSubscriptionTargetChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      announcementSubscriptionAudit: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      announcementSubscriptionTargetChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.equal(auditOnly.assertAnnouncementSubscriptionTargetAuditable(target), GUILD_ID)
  assert.throws(
    () => auditOnly.assertAnnouncementSubscriptionTargetChangeable(target),
    /changes are disabled/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertAnnouncementSubscriptionTargetIdAuditable(CHANNEL_ID),
    /audit is disabled/,
  )
})

test("configuration and policy separate poll audit, voter, creation, and ending authority", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        pollChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.pollChannelIds must be a subset/,
  )
  for (const capability of [
    "pollCreation",
    "pollEnding",
    "pollVoterAudit",
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        capabilities: {
          [capability]: true,
        },
      }, { homeDirectory: "/test/home" }),
      /require \$\.capabilities\.pollAudit/,
    )
  }

  const auditOnly = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      pollAudit: true,
    },
    scopes: {
      pollChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.equal(auditOnly.assertPollAuditable(channel()), GUILD_ID)
  assert.throws(() => auditOnly.assertPollVotersAuditable(channel()), /voter audit is disabled/)
  assert.throws(() => auditOnly.assertPollCreatable(channel()), /creation is disabled/)
  assert.throws(() => auditOnly.assertPollEndable(channel()), /ending is disabled/)

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      pollAudit: true,
      pollCreation: true,
      pollEnding: true,
      pollVoterAudit: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      pollChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      pollAudit: true,
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(() => empty.assertPollAuditable(channel()), /requires an explicit channel allowlist/)
})

test("configuration and policy isolate permission overwrites to exact readable channels", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        permissionOverwriteChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      permissionOverwriteChannelIds: [CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  assert.throws(
    () => disabled.assertChannelPermissionOverwriteAllowed(channel()),
    /permission-overwrite changes are disabled/,
  )

  const enabledConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      permissionOverwrites: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      permissionOverwriteChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        interactionChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  const invalidLimits = [
    { interactionMaxWritesPerMinute: 0 },
    { interactionMaxWritesPerMinute: 1.5 },
    { interactionMinWriteIntervalMs: 60_001 },
  ]
  for (const limits of invalidLimits) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        limits,
      }, { homeDirectory: "/test/home" }),
      /expected int|must be an integer between/,
    )
  }
  const tooManyMentionUsers = Array.from(
    { length: 101 },
    (_value, index) => String(500000000000000000n + BigInt(index)),
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        mentionUserIds: tooManyMentionUsers,
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        protectedUserIds: tooManyMentionUsers,
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})

test("configuration rejects ambiguous deletion toggles and malformed IDs", () => {
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        deletions: "yes" as never,
      },
    }, { homeDirectory: "/test/home" }),
    /expected boolean/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      identity: {
        applicationId: "not-an-id",
      },
    }, { homeDirectory: "/test/home" }),
    /must be a Discord snowflake/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      identity: {
        botId: "not-an-id",
      },
    }, { homeDirectory: "/test/home" }),
    /must be a Discord snowflake/,
  )
})

test("scope policy allows visible reads by default but rejects direct messages", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
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
    token: TOKEN,
    capabilities: {
      deletions: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      deleteChannelIds: [CHANNEL_ID],
    },
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
    applicationIntentChangesEnabled: false,
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
    bulkBanAuditEnabled: false,
    bulkBanGuildIds: [],
    bulkBansEnabled: false,
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
    guildIncidentAuditEnabled: false,
    guildIncidentChangesEnabled: false,
    guildIncidentGuildIds: [],
    guildProfileAuditEnabled: false,
    guildProfileChangesEnabled: false,
    guildProfileGuildIds: [],
    guildPruneAuditEnabled: false,
    guildPruneGuildIds: [],
    guildPruneIncludeRoleIds: [],
    guildPruneMaxMembers: 25,
    guildPrunesEnabled: false,
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
    inviteCapabilityRootCount: 0,
    inviteCreationChannelIds: [],
    inviteCreationEnabled: false,
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
    token: TOKEN,
    capabilities: {
      automodAudit: true,
      automodChanges: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      automodAlertChannelIds: [CHANNEL_ID],
      automodGuildIds: [GUILD_ID],
    },
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
      token: TOKEN,
      capabilities: {
        automodChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.automodAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        guildIds: [GUILD_ID],
      },
      scopes: {
        automodGuildIds: [OTHER_GUILD_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        automodAlertChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
})

test("configuration and policy isolate guild expression audit, changes, and local creation roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-expression-"))
  const root = await realpath(temporary)
  try {
    const config = loadConnectorConfig({
      token: TOKEN,
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
      storage: {
        guildExpressionRoots: [root],
      },
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
        token: TOKEN,
        capabilities: {
          guildExpressionChanges: true,
        },
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.guildExpressionAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        readScope: {
          guildIds: [GUILD_ID],
        },
        scopes: {
          guildExpressionGuildIds: [OTHER_GUILD_ID],
        },
      }, { homeDirectory: "/test/home" }),
      /must be a subset/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        storage: {
          guildExpressionRoots: ["relative/path"],
        },
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
      token: TOKEN,
      capabilities: {
        applicationEmojiAudit: true,
        applicationEmojiChanges: true,
      },
      identity: {
        applicationId: "900000000000000001",
        botId: "900000000000000002",
      },
      storage: {
        applicationEmojiRoots: [root],
      },
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
        token: TOKEN,
        capabilities: {
          applicationEmojiChanges: true,
        },
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.applicationEmojiAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        storage: {
          applicationEmojiRoots: ["relative/path"],
        },
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration and policy isolate additive application intent changes", () => {
  const enabled = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      applicationIntentChanges: true,
    },
  }, { homeDirectory: "/test/home" })
  const policy = new ScopePolicy(enabled)

  assert.equal(enabled.allowApplicationIntentChanges, true)
  assert.equal(policy.describe().applicationIntentChangesEnabled, true)
  assert.doesNotThrow(() => policy.assertApplicationIntentChangeAllowed())

  const disabled = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
  assert.equal(disabled.describe().applicationIntentChangesEnabled, false)
  assert.throws(
    () => disabled.assertApplicationIntentChangeAllowed(),
    /privileged-intent changes are disabled/,
  )
})

test("configuration and policy isolate soundboard audit, changes, and local audio roots", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-soundboard-"))
  const root = await realpath(temporary)
  try {
    const config = loadConnectorConfig({
      token: TOKEN,
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
      storage: {
        soundboardRoots: [root],
      },
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
        token: TOKEN,
        capabilities: {
          soundboardChanges: true,
        },
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.soundboardAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        readScope: {
          guildIds: [GUILD_ID],
        },
        scopes: {
          soundboardGuildIds: [OTHER_GUILD_ID],
        },
      }, { homeDirectory: "/test/home" }),
      /must be a subset/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        storage: {
          soundboardRoots: ["relative/path"],
        },
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
      token: TOKEN,
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
      storage: {
        scheduledEventRoots: [root],
      },
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
        token: TOKEN,
        capabilities: {
          scheduledEventChanges: true,
        },
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.scheduledEventAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        capabilities: {
          scheduledEventUserAudit: true,
        },
      }, { homeDirectory: "/test/home" }),
      /requires \$\.capabilities\.scheduledEventAudit/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        readScope: {
          guildIds: [GUILD_ID],
        },
        scopes: {
          scheduledEventGuildIds: [OTHER_GUILD_ID],
        },
      }, { homeDirectory: "/test/home" }),
      /must be a subset/,
    )
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        storage: {
          scheduledEventRoots: ["relative/path"],
        },
      }, { homeDirectory: "/test/home" }),
      ConfigurationError,
    )
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration and policy isolate Stage instances to exact channels", () => {
  const config = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      stageInstanceAudit: true,
      stageInstanceChanges: true,
      stageStartNotifications: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      stageChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      capabilities: {
        stageInstanceChanges: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.stageInstanceAudit/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      capabilities: {
        stageInstanceAudit: true,
        stageStartNotifications: true,
      },
    }, { homeDirectory: "/test/home" }),
    /requires \$\.capabilities\.stageInstanceChanges/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        stageChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /must be a subset/,
  )
  assert.throws(
    () => loadConnectorConfig({
      token: TOKEN,
      scopes: {
        stageChannelIds: Array.from(
          { length: CONNECTOR_LIMITS.stageInstanceChannels + 1 },
          (_, index) => String(500000000000000000n + BigInt(index)),
        ),
      },
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
      token: TOKEN,
      capabilities: {
        attachments: true,
      },
      limits: {
        attachmentMaxBytes: 2048,
      },
      readScope: {
        channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
        guildIds: [GUILD_ID],
      },
      scopes: {
        attachmentChannelIds: [CHANNEL_ID],
      },
      storage: {
        attachmentRoots: [root],
      },
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
      {
        scopes: {
          attachmentChannelIds: ["999999999999999999"],
        },
      },
      {
        limits: {
          attachmentMaxBytes: 10 * 1_024 * 1_024 + 1,
        },
      },
      {
        storage: {
          attachmentRoots: ["relative/path"],
        },
      },
      {
        storage: {
          attachmentRoots: ["[not-json"],
        },
      },
      {
        storage: {
          attachmentRoots: [root, root],
        },
      },
      {
        storage: {
          attachmentRoots: [linkedRoot],
        },
      },
      {
        storage: {
          attachmentRoots: [`${root}/`],
        },
      },
      {
        storage: {
          attachmentRoots: ["/"],
        },
      },
    ]) {
      assert.throws(
        () => loadConnectorConfig({
          token: TOKEN,
          ...environment,
          readScope: {
            channelIds: [CHANNEL_ID],
          },
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
    token: TOKEN,
    capabilities: {
      interactions: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      interactionChannelIds: [OTHER_CHANNEL_ID],
      mentionUserIds: [USER_ID],
    },
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
    token: TOKEN,
    capabilities: {
      deletions: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
    },
    scopes: {
      deleteChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    readScope: {
      channelIds: [OTHER_CHANNEL_ID, CHANNEL_ID],
    },
  }, { homeDirectory: "/test/home" }))
  const open = new ScopePolicy(loadConnectorConfig({
    token: TOKEN,
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
      token: TOKEN,
      readScope: {
        channelIds: [CHANNEL_ID],
      },
      scopes: {
        reactionChannelIds: [OTHER_CHANNEL_ID],
      },
    }, { homeDirectory: "/test/home" }),
    /\$\.scopes\.reactionChannelIds must be a subset/,
  )
  for (const capability of [
    "reactionUserAudit",
    "reactionModeration",
  ]) {
    assert.throws(
      () => loadConnectorConfig({
        token: TOKEN,
        capabilities: {
          [capability]: true,
        },
      }, { homeDirectory: "/test/home" }),
      /exact reaction-channel allowlist/,
    )
  }

  const auditConfig = loadConnectorConfig({
    token: TOKEN,
    capabilities: {
      reactionUserAudit: true,
    },
    readScope: {
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    },
    scopes: {
      reactionChannelIds: [CHANNEL_ID],
    },
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
    token: TOKEN,
    capabilities: {
      reactionModeration: true,
    },
    identity: {
      applicationId: "300000000000000001",
      botId: "300000000000000002",
    },
    readScope: {
      channelIds: [CHANNEL_ID],
    },
    scopes: {
      reactionChannelIds: [CHANNEL_ID],
    },
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
      token: TOKEN,
      scopes: {
        reactionChannelIds: Array.from(
          { length: CONNECTOR_LIMITS.reactionChannelAllowlist + 1 },
          (_, index) => String(600000000000000000n + BigInt(index)),
        ),
      },
    }, { homeDirectory: "/test/home" }),
    /at most 100 unique IDs/,
  )
})
