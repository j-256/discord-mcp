import assert from "node:assert/strict"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  ENVIRONMENT_NAMES,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import type { DiscordToolService } from "../src/mcp.js"
import { MCP_TOOL_CATALOG } from "../src/mcp-tool-catalog.js"
import {
  diagnoseConnector,
  DOCTOR_CHECK_IDS,
  createStdioLaunchDescriptor,
  OPERATOR_REPORT_SCHEMA_VERSION,
  prepareSetup,
  smokeConnector,
  type StatusProvider,
} from "../src/operator.js"
import {
  createConnectorProfile,
  loadProfile,
} from "../src/profile.js"
import type { ConnectorService } from "../src/service.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const ROLE_ID = "500000000000000001"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    ...overrides,
  }
}

function status(
  inScope = 1,
  messageContentIntent: "disabled" | "enabled" | "unknown" = "enabled",
  guildMembersIntent: "disabled" | "enabled" | "unknown" = "enabled",
): Awaited<ReturnType<ConnectorService["getStatus"]>> {
  return {
    application: {
      guildMembersIntent,
      id: APPLICATION_ID,
      messageContentIntent,
      name: "Connector",
    },
    auditFile: "/test/activity.jsonl",
    bot: {
      id: BOT_ID,
      username: "connector-bot",
    },
    guildPage: {
      accessible: 2,
      inScope,
    },
    policy: {
      administrationEnabled: false,
      administrationGuildIds: [],
      allowedChannelIds: [CHANNEL_ID],
      allowedGuildIds: [GUILD_ID],
      attachmentChannelIds: [],
      attachmentMaxBytes: 0,
      attachmentRootCount: 0,
      attachmentsEnabled: false,
      automodAlertChannelIds: [],
      automodAuditEnabled: false,
      automodChangesEnabled: false,
      automodGuildIds: [],
      banAuditEnabled: false,
      banAuditGuildIds: [],
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
      inviteAuditEnabled: false,
      inviteDeletionsEnabled: false,
      inviteGuildIds: [],
      memberDirectoryEnabled: false,
      memberDirectoryGuildIds: [],
      memberRoleChangesEnabled: false,
      memberRoleGuildIds: [],
      memberRoleCount: 0,
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
    },
    schemaVersion: 1,
    status: "ok",
  }
}

function statusProvider(inScope = 1): StatusProvider {
  return {
    async getStatus() {
      return status(inScope)
    },
  }
}

function toolService(): DiscordToolService {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected smoke service call")
  }
  return {
    addReaction: unexpected,
    executeMemberRoleChange: unexpected,
    executeAutoModerationChange: unexpected,
    executeGuildExpressionChange: unexpected,
    executeInviteDeletion: unexpected,
    executeScheduledEventChange: unexpected,
    executeWebhookDeletion: unexpected,
    getGuildExpression: unexpected,
    getAutoModerationRule: unexpected,
    getScheduledEvent: unexpected,
    getChannelWebhook: unexpected,
    getGuildInvite: unexpected,
    listChannelWebhooks: unexpected,
    listGuildInvites: unexpected,
    listGuildExpressions: unexpected,
    listAutoModerationRules: unexpected,
    listScheduledEvents: unexpected,
    planWebhookDeletion: unexpected,
    planInviteDeletion: unexpected,
    planGuildExpressionChange: unexpected,
    planAutoModerationChange: unexpected,
    planMemberRoleChange: unexpected,
    planScheduledEventChange: unexpected,
    auditChannelRoleAccess: unexpected,
    deleteMessages: unexpected,
    describePolicy() {
      return status().policy
    },
    editOwnMessage: unexpected,
    executeAttachmentMessage: unexpected,
    executeChannelCreation: unexpected,
    executeChannelPermissionOverwrite: unexpected,
    executeForumPost: unexpected,
    executeGuildScaffold: unexpected,
    executeMemberModeration: unexpected,
    executeMessagePin: unexpected,
    executeRoleCreation: unexpected,
    explainChannelAccess: unexpected,
    explainPrincipalPermissions: unexpected,
    getGuildAuditEntry: unexpected,
    getGuildBan: unexpected,
    getGuildMember: unexpected,
    getMessage: unexpected,
    getRole: unexpected,
    async getStatus() {
      return status()
    },
    listActivity: unexpected,
    listActiveThreads: unexpected,
    listArchivedThreads: unexpected,
    listChannels: unexpected,
    listChannelPermissionOverwrites: unexpected,
    listGuilds: unexpected,
    listGuildAuditEntries: unexpected,
    listGuildBans: unexpected,
    listGuildMembers: unexpected,
    listMessagePins: unexpected,
    listRoles: unexpected,
    planMessageDeletion: unexpected,
    planMessagePin: unexpected,
    planAttachmentMessage: unexpected,
    planChannelCreation: unexpected,
    planChannelPermissionOverwrite: unexpected,
    planForumPost: unexpected,
    planGuildScaffold: unexpected,
    planMemberModeration: unexpected,
    planRoleCreation: unexpected,
    readMessages: unexpected,
    searchMessages: unexpected,
    searchGuildMembers: unexpected,
    sendMessage: unexpected,
  }
}

function toolServiceWithoutScopedGuilds(): DiscordToolService {
  return {
    ...toolService(),
    async getStatus() {
      return status(0)
    },
  }
}

test("doctor reports unsupported runtime and missing configuration without throwing", async () => {
  const report = await diagnoseConnector({
    environment: {},
    nodeVersion: "20.18.0",
  })

  assert.equal(report.status, "error")
  assert.equal(report.identity, null)
  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.nodeVersion)?.status,
    "fail",
  )
  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.token)?.status,
    "fail",
  )
  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.configuration)?.status,
    "fail",
  )
})

test("doctor distinguishes valid scoped configuration from safe warnings", async () => {
  const scoped = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const open = await diagnoseConnector({
    environment: {
      DISCORD_BOT_TOKEN: TOKEN,
    },
    nodeVersion: "22.14.0",
  })

  assert.equal(scoped.status, "ok")
  assert.equal(scoped.checks.every((entry) => entry.status === "pass"), true)
  assert.equal(open.status, "warning")
  assert.equal(
    open.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.applicationIdentity)?.status,
    "warn",
  )
  assert.equal(
    open.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.guildScope)?.status,
    "warn",
  )
  assert.equal(
    open.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.channelScope)?.status,
    "warn",
  )
})

test("doctor and setup explain progressive risk-separated MCP toolsets", async () => {
  const configuredEnvironment = environment({
    DISCORD_MCP_ALLOW_INTERACTIONS: "true",
    DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_TOOLSETS: "connector,messages",
    DISCORD_MCP_TOOL_SURFACE: "progressive",
  })
  const doctor = await diagnoseConnector({
    environment: configuredEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: configuredEnvironment,
    service: statusProvider(),
  })

  const toolSurface = doctor.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.toolSurface,
  )
  assert.equal(toolSurface?.status, "pass")
  assert.match(toolSurface?.summary || "", /progressive/)
  assert.match(
    toolSurface?.summary || "",
    new RegExp(`2 of ${MCP_TOOLSET_NAMES.length}`),
  )
  assert.match(toolSurface?.summary || "", /4 canonical tools/)
  assert.equal(setup.toolSurface, "progressive")
  assert.deepEqual(setup.toolsets, ["connector", "messages"])
  assert.match(setup.warnings.join("\n"), /interactions toolset/)
})

test("doctor and setup explain effective interaction policy without Discord writes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_INTERACTIONS: "true",
    DISCORD_MCP_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE: "12",
  })
  const report = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warning = await diagnoseConnector({
    environment: environment({ DISCORD_MCP_ALLOW_INTERACTIONS: "true" }),
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: environment({ DISCORD_MCP_ALLOW_INTERACTIONS: "true" }),
    service: statusProvider(),
  })

  const interaction = report.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.interactionPolicy,
  )
  assert.equal(interaction?.status, "pass")
  assert.match(interaction?.summary || "", /12-write rolling budget/)
  assert.equal(
    warning.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.interactionPolicy)?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /interaction-channel allowlist/)
})

test("doctor and setup explain reviewed attachment scope without reading files or writing to Discord", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-operator-attachment-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_ATTACHMENTS: "true",
      DISCORD_MCP_ATTACHMENT_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ATTACHMENT_MAX_BYTES: "4096",
      DISCORD_MCP_ATTACHMENT_ROOTS: root,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ATTACHMENTS: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_ATTACHMENTS: "true",
      DISCORD_MCP_ATTACHMENT_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_ATTACHMENT_ROOTS: root,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const attachment = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.attachmentPolicy,
  )
  assert.equal(attachment?.status, "pass")
  assert.match(attachment?.summary || "", /1 channels and 1 canonical roots/)
  assert.match(attachment?.summary || "", /4096-byte ceiling/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.attachmentPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /attachment-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /attachments toolset/)
})

test("doctor and setup explain exact administration scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ADMIN_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
      DISCORD_MCP_PROTECTED_USER_IDS: "400000000000000001",
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ADMINISTRATION: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })

  const administration = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.administrationPolicy,
  )
  assert.equal(administration?.status, "pass")
  assert.match(administration?.summary || "", /1 guilds with 1 protected users/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.administrationPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /administration-guild allowlist/)
})

test("doctor and setup explain reviewed channel-creation scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
      DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_CHANNEL_CREATION: "true",
      DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const creation = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelCreationPolicy,
  )
  assert.equal(creation?.status, "pass")
  assert.match(creation?.summary || "", /1 guilds with reviewed one-shot execution/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.channelCreationPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /channel-creation guild allowlist/)
  assert.match(omitted.warnings.join("\n"), /channel-creation toolset/)
})

test("doctor and setup explain reviewed forum-post scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_FORUM_POSTS: "true",
      DISCORD_MCP_FORUM_POST_CHANNEL_IDS: CHANNEL_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_FORUM_POSTS: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_FORUM_POSTS: "true",
      DISCORD_MCP_FORUM_POST_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const forumPost = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.forumPostPolicy,
  )
  assert.equal(forumPost?.status, "pass")
  assert.match(forumPost?.summary || "", /1 exact channels/)
  assert.match(forumPost?.summary || "", /exact readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.forumPostPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /forum-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /forum-posts toolset/)
})

test("doctor and setup explain reviewed message-pin scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_PIN_MANAGEMENT: "true",
      DISCORD_MCP_PIN_CHANNEL_IDS: CHANNEL_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_PIN_MANAGEMENT: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_PIN_MANAGEMENT: "true",
      DISCORD_MCP_PIN_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const messagePin = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.messagePinPolicy,
  )
  assert.equal(messagePin?.status, "pass")
  assert.match(messagePin?.summary || "", /1 exact channels/)
  assert.match(messagePin?.summary || "", /exact state plus review-snapshot readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.messagePinPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /pin-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /pins toolset/)
})

test("doctor and setup explain credential-redacted webhook audit and cleanup", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
    DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.webhookAuditPolicy,
  )
  const deletion = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.webhookDeletionPolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /credential-redacted webhook inventory/i)
  assert.match(audit?.summary || "", /1 exact channels/)
  assert.equal(deletion?.status, "pass")
  assert.match(deletion?.summary || "", /Incoming-webhook deletion/)
  assert.match(deletion?.summary || "", /one-shot execution and absence readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.webhookAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.webhookDeletionPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /webhook-audit toggle/)
  assert.match(setup.warnings.join("\n"), /webhook-deletion toggle/)
  assert.match(omitted.warnings.join("\n"), /webhooks toolset/)
})

test("doctor and setup explain capability-safe invite audit and revocation", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_INVITE_AUDIT: "true",
    DISCORD_MCP_ALLOW_INVITE_DELETIONS: "true",
    DISCORD_MCP_INVITE_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_INVITE_AUDIT: "true",
    DISCORD_MCP_ALLOW_INVITE_DELETIONS: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.inviteAuditPolicy,
  )
  const deletion = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.inviteDeletionPolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /opaque references/)
  assert.match(audit?.summary || "", /MANAGE_GUILD/)
  assert.equal(deletion?.status, "pass")
  assert.match(deletion?.summary || "", /one-shot execution/)
  assert.match(deletion?.summary || "", /full-inventory absence readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.inviteAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.inviteDeletionPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /invite-audit toggle/)
  assert.match(setup.warnings.join("\n"), /invite-deletion toggle/)
  assert.match(omitted.warnings.join("\n"), /invites toolset/)
})

test("doctor and setup explain privacy-safe reviewed guild expression scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-expressions-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const canonicalRoot = await realpath(root)
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES: "true",
    DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_GUILD_EXPRESSION_ROOTS: canonicalRoot,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingGuildEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES: "true",
  })
  const missingGuild = await diagnoseConnector({
    environment: missingGuildEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingRootEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES: "true",
    DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS: GUILD_ID,
  })
  const missingRoot = await diagnoseConnector({
    environment: missingRootEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: missingRootEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildExpressionAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe guild emoji and sticker inventory/i)
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /1 canonical creation roots/)
  assert.match(changes?.summary || "", /exact metadata or absence readback/)
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildExpressionAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingRoot.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildExpressionChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /creation remains blocked/)
  assert.match(omitted.warnings.join("\n"), /guild-expressions toolset/)
})

test("doctor and setup explain privacy-safe reviewed scheduled event scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-events-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const canonicalRoot = await realpath(root)
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
    DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_SCHEDULED_EVENT_ROOTS: canonicalRoot,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingGuildEnvironment = environment({
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
  })
  const missingGuild = await diagnoseConnector({
    environment: missingGuildEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingRootEnvironment = environment({
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
    DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS: GUILD_ID,
  })
  const missingRoot = await diagnoseConnector({
    environment: missingRootEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: missingRootEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe scheduled event inventory/i)
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /1 canonical cover roots/)
  assert.match(changes?.summary || "", /exact state or absence readback/)
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingRoot.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /cover updates remain blocked/)
  assert.match(omitted.warnings.join("\n"), /scheduled-events toolset/)
})

test("doctor and setup explain privacy-safe reviewed AutoMod scope", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_AUTOMOD_AUDIT: "true",
    DISCORD_MCP_ALLOW_AUTOMOD_CHANGES: "true",
    DISCORD_MCP_AUTOMOD_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingGuildEnvironment = environment({
    DISCORD_MCP_ALLOW_AUTOMOD_AUDIT: "true",
    DISCORD_MCP_ALLOW_AUTOMOD_CHANGES: "true",
  })
  const missingGuild = await diagnoseConnector({
    environment: missingGuildEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: missingGuildEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.automodAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.automodChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe AutoMod inventory/i)
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /1 exact alert channels/)
  assert.match(changes?.summary || "", /exact state or absence readback/)
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.automodAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.automodChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /AutoMod audit toggle/)
  assert.match(setup.warnings.join("\n"), /AutoMod change toggle/)
  assert.match(omitted.warnings.join("\n"), /automod toolset/)
})

test("doctor and setup explain reviewed permission-overwrite scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
      DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: CHANNEL_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES: "true",
      DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS: CHANNEL_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const overwrite = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.permissionOverwritePolicy,
  )
  assert.equal(overwrite?.status, "pass")
  assert.match(overwrite?.summary || "", /1 exact channels/)
  assert.match(overwrite?.summary || "", /named deltas/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.permissionOverwritePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /exact channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /permission-overwrites toolset/)
})

test("doctor and setup explain reviewed role-creation scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_ROLE_CREATION: "true",
      DISCORD_MCP_ROLE_CREATION_GUILD_IDS: GUILD_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ROLE_CREATION: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_ROLE_CREATION: "true",
      DISCORD_MCP_ROLE_CREATION_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const creation = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.roleCreationPolicy,
  )
  assert.equal(creation?.status, "pass")
  assert.match(creation?.summary || "", /1 guilds with reviewed one-shot execution/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.roleCreationPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /role-creation guild allowlist/)
  assert.match(omitted.warnings.join("\n"), /role-creation toolset/)
})

test("doctor and setup explain reviewed member-role scope without Discord writes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES: "true",
    DISCORD_MCP_MEMBER_ROLE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_MEMBER_ROLE_IDS: ROLE_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const memberRole = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.memberRolePolicy,
  )
  assert.equal(memberRole?.status, "pass")
  assert.match(memberRole?.summary || "", /1 exact guilds and 1 exact roles/)
  assert.match(memberRole?.summary || "", /permission-impact review and one-shot execution/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.memberRolePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /exact guild and role allowlists/)
  assert.match(omitted.warnings.join("\n"), /member-roles toolset/)
})

test("doctor and setup explain resumable guild-scaffold scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
      DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
      DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const scaffold = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildScaffoldPolicy,
  )
  assert.equal(scaffold?.status, "pass")
  assert.match(scaffold?.summary || "", /1 guilds with durable bounded resumption/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildScaffoldPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /guild-scaffold allowlist/)
  assert.match(omitted.warnings.join("\n"), /guild-scaffolds toolset/)
})

test("doctor reports the privacy-safe Gateway policy without opening a connection", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_GATEWAY: "true",
      DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE: "250",
    }),
    nodeVersion: "22.14.0",
  })
  const disabled = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })

  const enabledCheck = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.gatewayPolicy,
  )
  assert.equal(enabledCheck?.status, "pass")
  assert.match(enabledCheck?.summary || "", /250-event content-free buffer/)
  assert.match(enabledCheck?.summary || "", /nonprivileged intents/)
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.gatewayPolicy,
    )?.summary || "",
    /disabled/,
  )
})

test("doctor and setup report observability without opening collectors or exposing headers", async () => {
  const collectorHeader = "Bearer private-collector-credential"
  const configuredEnvironment = environment({
    DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    DISCORD_MCP_OBSERVABILITY_LOGS: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test/otlp",
    OTEL_EXPORTER_OTLP_HEADERS: `authorization=${encodeURIComponent(collectorHeader)}`,
  })
  const enabled = await diagnoseConnector({
    environment: configuredEnvironment,
    nodeVersion: "22.14.0",
  })
  const disabled = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const defaultCollector = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    }),
    service: statusProvider(),
  })

  const enabledCheck = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.observability,
  )
  assert.equal(enabledCheck?.status, "pass")
  assert.match(enabledCheck?.summary || "", /OTLP\/HTTP protobuf export is enabled/)
  assert.match(enabledCheck?.summary || "", /explicit collector endpoints/)
  assert.match(enabledCheck?.summary || "", /configured authentication headers/)
  assert.match(enabledCheck?.summary || "", /structured stderr logs are enabled/)
  assert.equal(JSON.stringify(enabled).includes("collector.example.test"), false)
  assert.equal(JSON.stringify(enabled).includes(collectorHeader), false)
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.observability,
    )?.summary || "",
    /OTLP export is disabled/,
  )
  assert.match(defaultCollector.warnings.join("\n"), /default loopback collector/)
})

test("doctor verifies identity online and redacts online failures", async () => {
  let calls = 0
  const verified = await diagnoseConnector({
    environment: environment({ DISCORD_BOT_TOKEN: `  ${TOKEN}  ` }),
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        calls += 1
        return status()
      },
    },
  })
  const failed = await diagnoseConnector({
    environment: environment({ DISCORD_BOT_TOKEN: `  ${TOKEN}  ` }),
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        throw new Error(`Discord rejected ${TOKEN}`)
      },
    },
  })

  assert.equal(calls, 1)
  assert.deepEqual(verified.identity, {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    guildsAccessibleOnFirstPage: 2,
    guildsInScopeOnFirstPage: 1,
  })
  assert.equal(verified.status, "ok")
  assert.equal(failed.status, "error")
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(TOKEN))
  assert.match(JSON.stringify(failed), /\[redacted\]/)
})

test("doctor and setup report Message Content intent needed by native search", async () => {
  const report = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        return status(1, "disabled")
      },
    },
  })
  const setup = await prepareSetup({
    environment: environment(),
    service: {
      async getStatus() {
        return status(1, "unknown")
      },
    },
  })

  assert.equal(report.status, "warning")
  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.messageContentIntent)?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /Message Content intent/)
})

test("doctor and setup diagnose the separately gated Guild Members intent", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
    DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS: GUILD_ID,
  })
  const offline = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const empty = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
    }),
    nodeVersion: "22.14.0",
  })
  const disabledIntent = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        return status(1, "enabled", "disabled")
      },
    },
  })
  const unknownIntentSetup = await prepareSetup({
    environment: enabledEnvironment,
    service: {
      async getStatus() {
        return status(1, "enabled", "unknown")
      },
    },
  })
  const disabledDirectory = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        return status(1, "enabled", "disabled")
      },
    },
  })
  const omittedToolset = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_MEMBER_DIRECTORY: "true",
      DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  assert.equal(
    offline.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.memberDirectoryPolicy)?.status,
    "pass",
  )
  assert.match(
    offline.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.memberDirectoryPolicy)?.summary || "",
    /privacy-minimized pages/,
  )
  assert.equal(
    empty.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.memberDirectoryPolicy)?.status,
    "warn",
  )
  assert.equal(
    disabledIntent.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.guildMembersIntent)?.status,
    "fail",
  )
  assert.equal(disabledIntent.status, "error")
  assert.match(unknownIntentSetup.warnings.join("\n"), /Guild Members intent/)
  assert.equal(
    disabledDirectory.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.guildMembersIntent)?.status,
    "pass",
  )
  assert.match(omittedToolset.warnings.join("\n"), /members toolset/)
})

test("doctor and setup explain privacy-safe ban audit without privileged intent", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_BAN_AUDIT: "true",
    DISCORD_MCP_BAN_AUDIT_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const empty = await diagnoseConnector({
    environment: environment({ DISCORD_MCP_ALLOW_BAN_AUDIT: "true" }),
    nodeVersion: "22.14.0",
  })
  const omittedToolset = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_BAN_AUDIT: "true",
      DISCORD_MCP_BAN_AUDIT_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
    service: {
      async getStatus() {
        return status(1, "enabled", "disabled")
      },
    },
  })

  const policy = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.banAuditPolicy,
  )
  assert.equal(policy?.status, "pass")
  assert.match(policy?.summary || "", /BAN_MEMBERS/)
  assert.match(policy?.summary || "", /default-redacted reasons/)
  assert.equal(
    empty.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.banAuditPolicy)?.status,
    "warn",
  )
  assert.match(omittedToolset.warnings.join("\n"), /bans toolset/)
  assert.doesNotMatch(setup.warnings.join("\n"), /Guild Members intent/)
})

test("doctor fails online verification when local scope contains no accessible guild", async () => {
  const report = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
    online: true,
    service: statusProvider(0),
  })

  assert.equal(report.status, "error")
  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.guildAccess)?.status,
    "fail",
  )
})

test("stdio launch descriptor is portable, complete, and credential-free", () => {
  const result = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    command: "/opt/Discord MCP/bin/discord-mcp",
    serverName: "team-discord",
  })

  assert.deepEqual(result, {
    args: ["serve"],
    command: "/opt/Discord MCP/bin/discord-mcp",
    environment: {
      forward: result.environment.forward,
      set: {
        DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
        DISCORD_MCP_BOT_ID: BOT_ID,
      },
    },
    requirements: {
      elicitation: "required-for-reviewed-writes",
      requiredServer: true,
      toolApproval: "writes",
    },
    serverName: "team-discord",
    timeouts: {
      startupSeconds: 30,
      toolSeconds: 180,
    },
    transport: "stdio",
  })
  assert.equal(new Set(result.environment.forward).size, result.environment.forward.length)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.allowMemberDirectory), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.memberDirectoryGuildIds), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.allowBanAudit), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.banAuditGuildIds), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.allowInviteAudit), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.allowInviteDeletions), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.inviteGuildIds), true)
  assert.deepEqual(
    [...result.environment.forward].sort(),
    Object.values(ENVIRONMENT_NAMES)
      .filter((name) => (
        name !== ENVIRONMENT_NAMES.applicationId
        && name !== ENVIRONMENT_NAMES.botId
      ))
      .sort(),
  )
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      serverName: "bad.name",
    }),
    /MCP server name/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: "not-a-snowflake",
      botId: BOT_ID,
    }),
    /snowflake/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: "not-a-snowflake",
    }),
    /bot ID must be a snowflake/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      command: " ",
    }),
    /command must not be empty/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      args: ["serve", ""],
      botId: BOT_ID,
    }),
    /arguments must be non-empty strings/,
  )
})

test("stdio launch descriptor makes a saved profile the non-overridable read boundary", () => {
  const profile = createConnectorProfile({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    gatewayEnabled: true,
    gatewayEventBufferSize: 250,
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
  const result = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    botId: BOT_ID,
    command: "/usr/bin/node",
    profile,
  })

  assert.deepEqual(result.args, [
    "/srv/discord-mcp/dist/cli.js",
    "serve",
    "--profile",
    "support-bot",
  ])
  assert.deepEqual(result.environment.set, {})
  assert.equal(result.environment.forward.includes(TOKEN_ALIAS), true)
  assert.equal(result.environment.forward.includes(ENVIRONMENT_NAMES.token), false)
  for (const variable of [
    ENVIRONMENT_NAMES.allowedChannelIds,
    ENVIRONMENT_NAMES.allowedGuildIds,
    ENVIRONMENT_NAMES.allowGateway,
    ENVIRONMENT_NAMES.gatewayEventBufferSize,
    ENVIRONMENT_NAMES.toolSurface,
    ENVIRONMENT_NAMES.toolsets,
  ]) {
    assert.equal(result.environment.forward.includes(variable), false)
  }
  assert.equal(
    result.environment.forward.includes(ENVIRONMENT_NAMES.allowDeletions),
    true,
  )
  assert.equal(new Set(result.environment.forward).size, result.environment.forward.length)
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: "999999999999999999",
      botId: BOT_ID,
      profile,
    }),
    /does not match the verified Discord identity/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      args: ["serve", "--profile", "other"],
      botId: BOT_ID,
      profile,
    }),
    /already select a profile/,
  )
})

test("setup verifies in-scope access and emits a credential-free report", async () => {
  const report = await prepareSetup({
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    environment: environment(),
    serverName: "discord-safe",
    service: statusProvider(),
  })

  assert.equal(report.status, "ok")
  assert.equal(report.schemaVersion, OPERATOR_REPORT_SCHEMA_VERSION)
  assert.equal(report.applicationId, APPLICATION_ID)
  assert.equal(report.botId, BOT_ID)
  assert.equal(report.serverName, "discord-safe")
  assert.equal(report.toolSurface, "full")
  assert.deepEqual(report.toolsets, MCP_TOOLSET_NAMES)
  assert.deepEqual(report.launch.args, ["/srv/discord-mcp/dist/cli.js", "serve"])
  assert.equal(report.launch.command, "/usr/bin/node")
  assert.equal(report.launch.serverName, "discord-safe")
  assert.equal(report.profile, null)
  assert.deepEqual(report.warnings, [])
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => prepareSetup({
      environment: environment(),
      service: statusProvider(0),
    }),
    /no accessible guilds/,
  )
})

test("setup verifies and saves a profile without persisting or reporting its credential", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-setup-profile-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const profileDirectory = join(await realpath(temporary), "profiles")
  const source = environment({
    [ENVIRONMENT_NAMES.token]: undefined,
    [TOKEN_ALIAS]: TOKEN,
    [ENVIRONMENT_NAMES.allowGateway]: "true",
    [ENVIRONMENT_NAMES.gatewayEventBufferSize]: "250",
    [ENVIRONMENT_NAMES.toolSurface]: "progressive",
    [ENVIRONMENT_NAMES.toolsets]: "connector,messages",
  })
  const before = { ...source }

  const report = await prepareSetup({
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    profileDirectory,
    profileName: "support-bot",
    service: statusProvider(),
  })

  assert.deepEqual(source, before)
  assert.equal(report.schemaVersion, OPERATOR_REPORT_SCHEMA_VERSION)
  assert.equal(report.profile?.name, "support-bot")
  assert.equal(report.profile?.credential.variable, TOKEN_ALIAS)
  assert.equal(report.profile?.identity.applicationId, APPLICATION_ID)
  assert.equal(report.profile?.identity.botId, BOT_ID)
  assert.deepEqual(report.profile?.readScope, {
    channelIds: [CHANNEL_ID],
    guildIds: [GUILD_ID],
  })
  assert.deepEqual(report.profile?.tools, {
    surface: "progressive",
    toolsets: ["connector", "messages"],
  })
  assert.deepEqual(report.profile?.gateway, {
    enabled: true,
    eventBufferSize: 250,
  })
  assert.deepEqual(
    await loadProfile("support-bot", { directory: profileDirectory }),
    report.profile,
  )
  assert.deepEqual(report.launch.args, [
    "/srv/discord-mcp/dist/cli.js",
    "serve",
    "--profile",
    "support-bot",
  ])
  assert.deepEqual(report.launch.environment.set, {})
  assert.equal(report.launch.environment.forward.includes(TOKEN_ALIAS), true)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => prepareSetup({
      credentialVariable: TOKEN_ALIAS,
      environment: source,
      profileDirectory,
      profileName: "support-bot",
      service: statusProvider(),
    }),
    /already exists/,
  )
  await prepareSetup({
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    overwriteProfile: true,
    profileDirectory,
    profileName: "support-bot",
    service: statusProvider(),
  })
})

test("profile setup rejects ambient scope and profile-only options fail closed", async () => {
  await assert.rejects(
    () => prepareSetup({
      environment: environment({
        [ENVIRONMENT_NAMES.allowedGuildIds]: undefined,
      }),
      profileName: "open-scope",
      service: statusProvider(),
    }),
    new RegExp(ENVIRONMENT_NAMES.allowedGuildIds),
  )
  await assert.rejects(
    () => prepareSetup({
      credentialVariable: TOKEN_ALIAS,
      environment: environment(),
      service: statusProvider(),
    }),
    /require a profile name/,
  )
  await assert.rejects(
    () => prepareSetup({
      environment: environment({
        [TOKEN_ALIAS]: "different-token",
      }),
      profileName: "conflict",
      credentialVariable: TOKEN_ALIAS,
      service: statusProvider(),
    }),
    /conflicts with DISCORD_BOT_TOKEN/,
  )
})

test("MCP smoke negotiates the adapter, validates risk annotations, and calls status only", async () => {
  const report = await smokeConnector({
    environment: environment(),
    service: toolService(),
  })

  assert.equal(report.status, "ok")
  assert.equal(report.applicationId, APPLICATION_ID)
  assert.equal(report.botId, BOT_ID)
  assert.equal(report.toolCount, Object.keys(MCP_TOOL_CATALOG).length + 1)
  assert.equal(report.toolSurface, "full")
  assert.deepEqual(report.toolsets, MCP_TOOLSET_NAMES)
  assert.deepEqual(report.promptNames, [
    "find_guild_members",
    "inspect_guild_ban",
    "review_attachment_message",
    "review_automod_change",
    "review_channel_creation",
    "review_channel_permission_overwrite",
    "review_forum_post",
    "review_guild_expression_change",
    "review_guild_scaffold",
    "review_invite_deletion",
    "review_member_moderation",
    "review_member_role_change",
    "review_message_deletion",
    "review_message_pin",
    "review_role_creation",
    "review_scheduled_event_change",
    "review_webhook_deletion",
    "search_guild_messages",
    "summarize_channel",
  ])
  assert.deepEqual(report.resourceUris, [
    "discord://connector/activity",
    "discord://connector/observability",
    "discord://connector/policy",
    "discord://connector/safety",
    "discord://gateway/events",
    "discord://gateway/status",
    "discord://guilds",
  ])
  assert.deepEqual(report.resourceTemplateUris, [
    "discord://channels/{channelId}/access",
    "discord://channels/{channelId}/messages/{messageId}",
    "discord://channels/{channelId}/permission-overwrites",
    "discord://channels/{channelId}/webhooks",
    "discord://guilds/{guildId}/automod-rules",
    "discord://guilds/{guildId}/bans/{userId}",
    "discord://guilds/{guildId}/channels",
    "discord://guilds/{guildId}/emojis",
    "discord://guilds/{guildId}/invites/{inviteRef}",
    "discord://guilds/{guildId}/members/{userId}",
    "discord://guilds/{guildId}/roles",
    "discord://guilds/{guildId}/roles/{roleId}",
    "discord://guilds/{guildId}/scheduled-events",
    "discord://guilds/{guildId}/stickers",
  ])
  assert.deepEqual(report.destructiveTools, [
    "delete_messages",
    "edit_own_message",
    "execute_automod_change",
    "execute_channel_permission_overwrite",
    "execute_guild_expression_change",
    "execute_invite_deletion",
    "execute_member_moderation",
    "execute_member_role_change",
    "execute_message_pin",
    "execute_scheduled_event_change",
    "execute_webhook_deletion",
  ])
  assert.equal(report.readOnlyTools.includes("get_connector_status"), true)
  assert.equal(report.readOnlyTools.includes("get_observability_status"), true)
  assert.equal(report.readOnlyTools.includes("discover_discord_tools"), true)
  assert.equal(report.readOnlyTools.includes("plan_channel_creation"), true)
  assert.equal(report.readOnlyTools.includes("plan_forum_post"), true)
  assert.equal(report.readOnlyTools.includes("plan_attachment_message"), true)
  assert.equal(report.readOnlyTools.includes("plan_member_role_change"), true)
  assert.equal(report.readOnlyTools.includes("plan_role_creation"), true)
  assert.equal(report.destructiveTools.includes("execute_channel_creation"), false)
  assert.equal(report.destructiveTools.includes("execute_role_creation"), false)
  assert.equal(report.destructiveTools.includes("execute_attachment_message"), false)
  assert.equal(report.destructiveTools.includes("execute_forum_post"), false)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => smokeConnector({
      environment: environment(),
      service: toolServiceWithoutScopedGuilds(),
    }),
    /no accessible guilds/,
  )
})

test("MCP smoke expands a progressive subset without broadening configured toolsets", async () => {
  const report = await smokeConnector({
    environment: environment({
      DISCORD_MCP_TOOLSETS: "messages,activity",
      DISCORD_MCP_TOOL_SURFACE: "progressive",
    }),
    service: toolService(),
  })

  assert.equal(report.status, "ok")
  assert.equal(report.toolSurface, "progressive")
  assert.deepEqual(report.toolsets, ["activity", "messages"])
  assert.equal(report.toolCount, 5)
  assert.deepEqual(report.destructiveTools, [])
  assert.deepEqual(report.promptNames, [
    "search_guild_messages",
    "summarize_channel",
  ])
  assert.deepEqual(report.readOnlyTools, [
    "discover_discord_tools",
    "get_message",
    "list_activity",
    "read_messages",
    "search_messages",
  ])
})
