import assert from "node:assert/strict"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  DISCORD_APPLICATION_FLAGS,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import {
  projectApplicationPosture,
  type ApplicationPostureResult,
} from "../src/application-posture.js"
import {
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
} from "../src/config-document.js"
import { writeConnectorConfigDocumentFile } from "../src/config-operator.js"
import type { DiscordToolService } from "../src/mcp.js"
import { MCP_TOOL_CATALOG } from "../src/mcp-tool-catalog.js"
import {
  diagnoseConnector as diagnoseNativeConnector,
  DOCTOR_CHECK_IDS,
  createStdioLaunchDescriptor,
  OPERATOR_REPORT_SCHEMA_VERSION,
  prepareSetup as prepareConfigSetup,
  smokeConnector as smokeNativeConnector,
  type SetupOptions,
  type SetupReport,
  type StatusProvider,
} from "../src/operator.js"
import {
  createConnectorProfile,
  loadProfile,
} from "../src/profile.js"
import { getSetupPreset } from "../src/setup-presets.js"
import type { ConnectorService } from "../src/service.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import {
  fixtureConfigInput,
  loadFixtureConfig,
} from "./config-fixture.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const SOURCE_CHANNEL_ID = "400000000000000002"
const ROLE_ID = "500000000000000001"
const INTEGRATION_ID = "600000000000000001"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"

const FIXTURE_ENVIRONMENT_NAMES = Object.freeze({
  allowDeletions: "DISCORD_MCP_ALLOW_DELETIONS",
  allowGateway: "DISCORD_MCP_ALLOW_GATEWAY",
  allowGuildProfileAudit: "DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT",
  allowGuildProfileChanges: "DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES",
  allowGuildSettingsAudit: "DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT",
  allowGuildSettingsChanges: "DISCORD_MCP_ALLOW_GUILD_SETTINGS_CHANGES",
  allowIntegrationAudit: "DISCORD_MCP_ALLOW_INTEGRATION_AUDIT",
  allowIntegrationDeletions: "DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS",
  allowObservabilityExport: "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT",
  allowWidgetPublicExposure: "DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE",
  allowWidgetSettingsAudit: "DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT",
  allowWidgetSettingsChanges: "DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES",
  allowedChannelIds: "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  allowedGuildIds: "DISCORD_MCP_ALLOWED_GUILD_IDS",
  auditFile: "DISCORD_MCP_AUDIT_FILE",
  configFile: CONFIG_FILE_ENVIRONMENT_VARIABLE,
  deleteChannelIds: "DISCORD_MCP_DELETE_CHANNEL_IDS",
  gatewayEventBufferSize: "DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE",
  guildProfileGuildIds: "DISCORD_MCP_GUILD_PROFILE_GUILD_IDS",
  guildSettingsGuildIds: "DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS",
  integrationGuildIds: "DISCORD_MCP_INTEGRATION_GUILD_IDS",
  integrationIds: "DISCORD_MCP_INTEGRATION_IDS",
  otelEndpoint: "OTEL_EXPORTER_OTLP_ENDPOINT",
  token: DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  toolSurface: "DISCORD_MCP_TOOL_SURFACE",
  toolsets: "DISCORD_MCP_TOOLSETS",
  widgetSettingsGuildIds: "DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS",
})

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

async function prepareSetup(options: SetupOptions): Promise<SetupReport> {
  if (options.configFile || options.profileName) return prepareConfigSetup(options)
  const source = options.environment || process.env
  const fixture = fixtureConfigInput(source)
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-operator-policy-"))
  const configFile = join(await realpath(temporary), "discord-mcp.json")
  try {
    await writeConnectorConfigDocumentFile(configFile, fixture.document)
    return await prepareConfigSetup({
      ...options,
      configFile,
      environment: fixture.environment,
    })
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
}

function diagnoseConnector(
  options: Parameters<typeof diagnoseNativeConnector>[0] = {},
) {
  const source = options.environment || process.env
  if (
    options.config
    || source[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
    || !source[DEFAULT_TOKEN_ENVIRONMENT_VARIABLE]?.trim()
  ) {
    return diagnoseNativeConnector(options)
  }
  return diagnoseNativeConnector({
    ...options,
    config: loadFixtureConfig(source),
  })
}

function smokeConnector(
  options: Parameters<typeof smokeNativeConnector>[0] = {},
) {
  const source = options.environment || process.env
  if (
    options.config
    || source[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
    || !source[DEFAULT_TOKEN_ENVIRONMENT_VARIABLE]?.trim()
  ) {
    return smokeNativeConnector(options)
  }
  return smokeNativeConnector({
    ...options,
    config: loadFixtureConfig(source),
  })
}

function status(
  inScope = 1,
  messageContentIntent: "disabled" | "enabled" | "unknown" = "enabled",
  guildMembersIntent: "disabled" | "enabled" | "unknown" = "enabled",
  posture?: ApplicationPostureResult,
): Awaited<ReturnType<ConnectorService["getStatus"]>> {
  const projectedPosture = projectApplicationPosture({
    bot_public: false,
    bot_require_code_grant: false,
    description: "",
    flags: 0,
    id: APPLICATION_ID,
    integration_types_config: { "0": {} },
    name: "Connector",
  }, BOT_ID, {
    guildMembersIntentRequired: false,
    messageContentIntent: "not-required",
    nativeInteractionIngressRequired: false,
  })
  const applicationPosture = posture ?? {
    ...projectedPosture,
    privilegedIntents: {
      guildMembers: guildMembersIntent,
      messageContent: messageContentIntent,
      presence: "disabled" as const,
    },
  }
  return {
    application: {
      guildMembersIntent,
      id: APPLICATION_ID,
      messageContentIntent,
      name: "Connector",
    },
    applicationPosture,
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
      guildTemplateAuditEnabled: false,
      guildTemplateChangesEnabled: false,
      guildTemplateGuildIds: [],
      integrationAuditEnabled: false,
      integrationDeletionsEnabled: false,
      integrationGuildIds: [],
      integrationIds: [],
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
      onboardingAuditEnabled: false,
      onboardingChangesEnabled: false,
      onboardingGuildIds: [],
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
      welcomeScreenAuditEnabled: false,
      welcomeScreenChangesEnabled: false,
      welcomeScreenGuildIds: [],
      widgetPublicExposureEnabled: false,
      widgetSettingsAuditEnabled: false,
      widgetSettingsChangesEnabled: false,
      widgetSettingsGuildIds: [],
    },
    schemaVersion: 1,
    status: "ok",
    writeCoordination: {
      coverage: "receipt-backed-reviewed-writes",
      excludedWorkflows: [
        "legacy-member-moderation",
        "ordinary-message-interactions",
      ],
      localFilesystemRequired: true,
      mode: "durable-exact-target",
      resumableWorkflows: ["guild-scaffold"],
      sharedStateRootRequired: true,
    },
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
    getApplicationPosture: unexpected,
    auditChannelDeletion: unexpected,
    auditRoleDeletion: unexpected,
    auditChannelOrder: unexpected,
    auditForumTags: unexpected,
    auditRoleOrder: unexpected,
    executeAnnouncementCrosspost: unexpected,
    executeAnnouncementSubscription: unexpected,
    executeApplicationEmojiChange: unexpected,
    executeMessageForward: unexpected,
    executeNativeInteractionCommand: unexpected,
    executeRoleOrder: unexpected,
    executeMemberNicknameChange: unexpected,
    executeMemberRoleChange: unexpected,
    executeMemberVoiceChange: unexpected,
    executeThreadChange: unexpected,
    executeAutoModerationChange: unexpected,
    executeGuildExpressionChange: unexpected,
    executeGuildTemplateChange: unexpected,
    executeGuildIntegrationDeletion: unexpected,
    executeForumTagChange: unexpected,
    executeSoundboardChange: unexpected,
    executeInviteDeletion: unexpected,
    executeOnboardingChange: unexpected,
    executeWelcomeScreenChange: unexpected,
    executeWidgetSettingsChange: unexpected,
    executeGuildSettingsChange: unexpected,
    executeGuildProfileChange: unexpected,
    executePollCreation: unexpected,
    executePollEnd: unexpected,
    executeReactionModeration: unexpected,
    executeScheduledEventChange: unexpected,
    executeStageInstanceChange: unexpected,
    executeWebhookChange: unexpected,
    executeWebhookCreation: unexpected,
    executeWebhookDeletion: unexpected,
    planAnnouncementCrosspost: unexpected,
    planAnnouncementSubscription: unexpected,
    planMessageForward: unexpected,
    planNativeInteractionCommand: unexpected,
    getThreadMembership: unexpected,
    getThreadState: unexpected,
    planThreadChange: unexpected,
    planForumTagChange: unexpected,
    getGuildExpression: unexpected,
    getApplicationEmoji: unexpected,
    getGuildSoundboardSound: unexpected,
    listGuildTemplates: unexpected,
    listGuildIntegrations: unexpected,
    listGuildVoiceRegions: unexpected,
    getAutoModerationRule: unexpected,
    getScheduledEvent: unexpected,
    getStageInstance: unexpected,
    getChannelWebhook: unexpected,
    getPoll: unexpected,
    getGuildInvite: unexpected,
    getGuildOnboarding: unexpected,
    getGuildWelcomeScreen: unexpected,
    getGuildWidgetSettings: unexpected,
    getGuildSettings: unexpected,
    getGuildProfile: unexpected,
    listChannelWebhooks: unexpected,
    listAnnouncementSubscriptions: unexpected,
    listGuildInvites: unexpected,
    listGuildExpressions: unexpected,
    listApplicationEmojis: unexpected,
    listDefaultSoundboardSounds: unexpected,
    listGuildSoundboardSounds: unexpected,
    listAutoModerationRules: unexpected,
    listScheduledEvents: unexpected,
    listScheduledEventUsers: unexpected,
    listStageInstances: unexpected,
    listVoiceRegions: unexpected,
    planWebhookChange: unexpected,
    planWebhookCreation: unexpected,
    planWebhookDeletion: unexpected,
    previewComponentLayout() {
      throw new Error("Unexpected smoke service call")
    },
    planInviteDeletion: unexpected,
    planOnboardingChange: unexpected,
    planWelcomeScreenChange: unexpected,
    planWidgetSettingsChange: unexpected,
    planGuildSettingsChange: unexpected,
    planGuildProfileChange: unexpected,
    planGuildExpressionChange: unexpected,
    planApplicationEmojiChange: unexpected,
    planGuildTemplateChange: unexpected,
    planGuildIntegrationDeletion: unexpected,
    planSoundboardChange: unexpected,
    planAutoModerationChange: unexpected,
    planMemberNicknameChange: unexpected,
    planMemberRoleChange: unexpected,
    planMemberVoiceChange: unexpected,
    planScheduledEventChange: unexpected,
    planStageInstanceChange: unexpected,
    auditChannelRoleAccess: unexpected,
    deleteMessages: unexpected,
    describePolicy() {
      return status().policy
    },
    editOwnMessage: unexpected,
    executeAttachmentMessage: unexpected,
    executeComponentMessage: unexpected,
    executeChannelCreation: unexpected,
    executeChannelDeletion: unexpected,
    executeChannelClone: unexpected,
    executeChannelOrder: unexpected,
    executeChannelMetadataChange: unexpected,
    executeVoiceChannelStatusChange: unexpected,
    executeChannelPermissionOverwrite: unexpected,
    executeForumPost: unexpected,
    executeThreadCreation: unexpected,
    executeGuildBlueprint: unexpected,
    executeGuildScaffold: unexpected,
    executeMemberModeration: unexpected,
    executeMessagePin: unexpected,
    executeRoleCreation: unexpected,
    executeRoleConfiguration: unexpected,
    executeRoleDeletion: unexpected,
    explainChannelAccess: unexpected,
    explainPrincipalPermissions: unexpected,
    getGuildAuditEntry: unexpected,
    getChannel: unexpected,
    getVoiceChannelStatus: unexpected,
    getGuildBan: unexpected,
    getGuildMember: unexpected,
    getMemberVoiceState: unexpected,
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
    listPollAnswerVoters: unexpected,
    listMessageReactions: unexpected,
    listReactionUsers: unexpected,
    listRoles: unexpected,
    planMessageDeletion: unexpected,
    planMessagePin: unexpected,
    planPollCreation: unexpected,
    planPollEnd: unexpected,
    planReactionModeration: unexpected,
    planAttachmentMessage: unexpected,
    planComponentMessage: unexpected,
    planChannelCreation: unexpected,
    planChannelDeletion: unexpected,
    planChannelClone: unexpected,
    planChannelMetadataChange: unexpected,
    planVoiceChannelStatusChange: unexpected,
    planChannelOrder: unexpected,
    planChannelPermissionOverwrite: unexpected,
    planForumPost: unexpected,
    planThreadCreation: unexpected,
    planGuildBlueprint: unexpected,
    verifyGuildBlueprint: unexpected,
    planGuildScaffold: unexpected,
    verifyGuildScaffold: unexpected,
    planMemberModeration: unexpected,
    planRoleCreation: unexpected,
    planRoleConfiguration: unexpected,
    planRoleDeletion: unexpected,
    planRoleOrder: unexpected,
    readMessages: unexpected,
    removeOwnReaction: unexpected,
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
  for (const entry of report.checks.filter((candidate) => candidate.status !== "pass")) {
    assert.ok(entry.action)
    assert.ok(entry.reference)
  }
  const runtime = report.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.nodeVersion,
  )
  assert.match(runtime?.action || "", /Install Node\.js 22 or newer/)
  assert.equal(runtime?.reference, "docs/reference.md#requirements")
  const token = report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.token)
  assert.match(token?.action || "", /environment variable or file referenced by credential/)
  assert.equal(token?.reference, "docs/reference.md#discord-bot-setup")
})

test("doctor resolves the credential variable referenced by a selected configuration", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-doctor-policy-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const configFile = join(await realpath(temporary), "discord-mcp.json")
  await writeConnectorConfigDocumentFile(
    configFile,
    createConnectorConfigDocument({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      channelIds: [CHANNEL_ID],
      credentialVariable: TOKEN_ALIAS,
      guildIds: [GUILD_ID],
      name: "doctor-policy",
      toolsets: MCP_TOOLSET_NAMES,
      toolSurface: "full",
    }),
  )

  const report = await diagnoseConnector({
    environment: {
      [FIXTURE_ENVIRONMENT_NAMES.configFile]: configFile,
      [TOKEN_ALIAS]: TOKEN,
    },
    nodeVersion: "22.14.0",
  })

  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.token)?.status,
    "pass",
  )
  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.configuration)?.status,
    "pass",
  )
})

test("doctor resolves file-backed credentials and redacts downstream failures", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-doctor-file-secret-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const configFile = join(root, "discord-mcp.json")
  const credentialFile = join(root, "discord-token")
  await writeFile(credentialFile, `${TOKEN}\n`, { mode: 0o600 })
  await writeConnectorConfigDocumentFile(
    configFile,
    createConnectorConfigDocument({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      credentialFile,
      guildIds: [GUILD_ID],
      name: "doctor-file-secret",
      toolsets: ["connector"],
      toolSurface: "full",
    }),
  )

  const report = await diagnoseConnector({
    environment: { [FIXTURE_ENVIRONMENT_NAMES.configFile]: configFile },
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        throw new Error(`Credential ${TOKEN} rejected`)
      },
    },
  })

  assert.equal(
    report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.token)?.status,
    "pass",
  )
  const access = report.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.guildAccess)
  assert.equal(access?.status, "fail")
  assert.match(access?.summary || "", /Credential \[redacted\] rejected/)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))
})

test("doctor distinguishes complete scope from a missing channel boundary", async () => {
  const scoped = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const guildOnly = await diagnoseConnector({
    environment: {
      DISCORD_BOT_TOKEN: TOKEN,
    },
    nodeVersion: "22.14.0",
  })

  assert.equal(scoped.status, "ok")
  assert.equal(scoped.checks.every((entry) => entry.status === "pass"), true)
  assert.equal(scoped.checks.every((entry) => !("action" in entry)), true)
  assert.equal(scoped.checks.every((entry) => !("reference" in entry)), true)
  assert.equal(guildOnly.status, "warning")
  assert.equal(
    guildOnly.checks.find((entry) => entry.id === DOCTOR_CHECK_IDS.channelScope)?.status,
    "warn",
  )
  for (const entry of guildOnly.checks.filter((candidate) => candidate.status !== "pass")) {
    assert.ok(entry.action)
    assert.equal(entry.reference, "docs/reference.md#operator-cli")
  }
})

test("doctor gives feature-policy warnings a safe default recovery path", async () => {
  const report = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_DELETIONS: "true",
    }),
    nodeVersion: "22.14.0",
  })
  const deletion = report.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.deletionPolicy,
  )

  assert.equal(report.status, "warning")
  assert.equal(deletion?.status, "warn")
  assert.match(deletion?.action || "", /toggle and exact allowlists/)
  assert.equal(deletion?.reference, "docs/reference.md#configuration")
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
  assert.match(toolSurface?.summary || "", /5 canonical tools/)
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
  const missingIntent = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        return status(1, "disabled")
      },
    },
  })
  const missingIntentSetup = await prepareSetup({
    environment: enabledEnvironment,
    service: {
      async getStatus() {
        return status(1, "unknown")
      },
    },
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
  assert.equal(
    missingIntent.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.messageContentIntent,
    )?.status,
    "fail",
  )
  assert.match(missingIntentSetup.warnings.join("\n"), /component messages are blocked/)
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

test("doctor and setup explain exact forum-tag scope without Discord writes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT: "true",
    DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES: "true",
    DISCORD_MCP_FORUM_TAG_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT: "true",
    DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES: "true",
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
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.forumTagAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.forumTagChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact stable forums/)
  assert.match(audit?.summary || "", /no post enumeration/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /one non-retried replacement/)
  assert.match(change?.summary || "", /fresh readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.forumTagAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.forumTagChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /stable-forum allowlist/)
  assert.match(omitted.warnings.join("\n"), /forum-tags toolset/)
})

test("doctor and setup explain reviewed thread-creation scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_THREAD_CREATION: "true",
      DISCORD_MCP_THREAD_PARENT_IDS: CHANNEL_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_THREAD_CREATION: "true",
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
      DISCORD_MCP_ALLOW_THREAD_CREATION: "true",
      DISCORD_MCP_THREAD_PARENT_IDS: CHANNEL_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const threadCreation = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.threadCreationPolicy,
  )
  assert.equal(threadCreation?.status, "pass")
  assert.match(threadCreation?.summary || "", /1 exact parents/)
  assert.match(threadCreation?.summary || "", /anchored recovery/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.threadCreationPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /parent-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /threads toolset/)
})

test("doctor and setup explain privacy-safe reviewed thread governance", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_THREAD_AUDIT: "true",
    DISCORD_MCP_ALLOW_THREAD_CHANGES: "true",
    DISCORD_MCP_THREAD_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_THREAD_IDS: CHANNEL_ID,
    DISCORD_MCP_THREAD_MEMBER_USER_IDS: BOT_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_THREAD_AUDIT: "true",
    DISCORD_MCP_ALLOW_THREAD_CHANGES: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.threadAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.threadChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /without member enumeration or persistence/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /uncertainty quarantine/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.threadAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.threadChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /exact guild and thread allowlists/)
  assert.match(omitted.warnings.join("\n"), /thread-governance toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_THREAD_AUDIT",
    "DISCORD_MCP_ALLOW_THREAD_CHANGES",
    "DISCORD_MCP_THREAD_GUILD_IDS",
    "DISCORD_MCP_THREAD_IDS",
    "DISCORD_MCP_THREAD_MEMBER_USER_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
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

test("doctor and setup explain privacy-safe reaction audit and moderation", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_REACTION_MODERATION: "true",
    DISCORD_MCP_ALLOW_REACTION_USER_AUDIT: "true",
    DISCORD_MCP_REACTION_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const disabled = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const userAudit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.reactionUserAuditPolicy,
  )
  const moderation = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.reactionModerationPolicy,
  )
  assert.equal(userAudit?.status, "pass")
  assert.match(userAudit?.summary || "", /bounded ID-and-bot-only pages/)
  assert.equal(moderation?.status, "pass")
  assert.match(moderation?.summary || "", /exact-message coordination/)
  assert.match(moderation?.summary || "", /target-absence readback/)
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.reactionUserAuditPolicy,
    )?.summary || "",
    /aggregate reaction reads remain available/,
  )
  assert.match(omitted.warnings.join("\n"), /interactions toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_REACTION_MODERATION",
    "DISCORD_MCP_ALLOW_REACTION_USER_AUDIT",
    "DISCORD_MCP_REACTION_CHANNEL_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup enforce reviewed announcement-crosspost prerequisites", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS: "true",
    DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS: "true",
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
  const omittedMissingIntent = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: {
      async getStatus() {
        return status(1, "disabled")
      },
    },
  })
  const missingIntent = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        return status(1, "unknown")
      },
    },
  })
  const missingIntentSetup = await prepareSetup({
    environment: enabledEnvironment,
    service: {
      async getStatus() {
        return status(1, "disabled")
      },
    },
  })

  const policy = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.announcementCrosspostPolicy,
  )
  assert.equal(policy?.status, "pass")
  assert.match(policy?.summary || "", /authorship-sensitive permission proof/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.announcementCrosspostPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /announcement-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /announcement-crossposts toolset/)
  assert.doesNotMatch(
    omittedMissingIntent.warnings.join("\n"),
    /Message Content intent/,
  )
  assert.equal(
    missingIntent.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.messageContentIntent,
    )?.status,
    "fail",
  )
  assert.equal(missingIntent.status, "error")
  assert.match(missingIntentSetup.warnings.join("\n"), /crossposts are blocked/)
  assert.match(missingIntentSetup.warnings.join("\n"), /native search may be unavailable/)
  for (const name of [
    "DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS",
    "DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain reviewed message-forward scope and intent gates", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${SOURCE_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_MESSAGE_FORWARDING: "true",
    DISCORD_MCP_MESSAGE_FORWARD_SOURCE_CHANNEL_IDS: SOURCE_CHANNEL_ID,
    DISCORD_MCP_MESSAGE_FORWARD_TARGET_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })
  const missingIntent = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
    online: true,
    service: {
      async getStatus() {
        return status(1, "disabled")
      },
    },
  })
  const missingIntentSetup = await prepareSetup({
    environment: enabledEnvironment,
    service: {
      async getStatus() {
        return status(1, "unknown")
      },
    },
  })

  const policy = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.messageForwardPolicy,
  )
  assert.equal(policy?.status, "pass")
  assert.match(policy?.summary || "", /forced empty mentions/)
  assert.match(policy?.summary || "", /age-restriction downgrade prevention/)
  assert.match(policy?.summary || "", /immutable-snapshot validation/)
  assert.match(omitted.warnings.join("\n"), /message-forwarding toolset/)
  assert.equal(
    missingIntent.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.messageContentIntent,
    )?.status,
    "fail",
  )
  assert.match(missingIntentSetup.warnings.join("\n"), /message forwarding.*blocked/)
  for (const name of [
    "DISCORD_MCP_ALLOW_MESSAGE_FORWARDING",
    "DISCORD_MCP_ALLOW_CROSS_GUILD_MESSAGE_FORWARDING",
    "DISCORD_MCP_MESSAGE_FORWARD_SOURCE_CHANNEL_IDS",
    "DISCORD_MCP_MESSAGE_FORWARD_TARGET_CHANNEL_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain announcement-subscription scope and review gates", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: `${CHANNEL_ID},${SOURCE_CHANNEL_ID}`,
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT: "true",
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES: "true",
    DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_SOURCE_CHANNEL_IDS: SOURCE_CHANNEL_ID,
    DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const auditWarning = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT: "true",
    }),
    nodeVersion: "22.14.0",
  })
  const changeWarningEnvironment = environment({
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT: "true",
    DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES: "true",
    DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS: CHANNEL_ID,
  })
  const changeWarning = await diagnoseConnector({
    environment: changeWarningEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: changeWarningEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.announcementSubscriptionAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.announcementSubscriptionChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /unrelated webhook IDs omitted/)
  assert.match(audit?.summary || "", /no message access/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /duplicate and capacity checks/)
  assert.match(changes?.summary || "", /one non-retried mutation/)
  assert.equal(
    auditWarning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.announcementSubscriptionAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    changeWarning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.announcementSubscriptionChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /source-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /announcement-subscriptions toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT",
    "DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES",
    "DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_SOURCE_CHANNEL_IDS",
    "DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain native poll privacy and reviewed write scope", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_POLL_AUDIT: "true",
    DISCORD_MCP_ALLOW_POLL_CREATION: "true",
    DISCORD_MCP_ALLOW_POLL_ENDING: "true",
    DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT: "true",
    DISCORD_MCP_POLL_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_POLL_AUDIT: "true",
    DISCORD_MCP_ALLOW_POLL_CREATION: "true",
    DISCORD_MCP_ALLOW_POLL_ENDING: "true",
    DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT: "true",
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

  const expected = [
    [DOCTOR_CHECK_IDS.pollAuditPolicy, /bounded transient aggregate results/],
    [DOCTOR_CHECK_IDS.pollVoterAuditPolicy, /bounded ID-only pages/],
    [DOCTOR_CHECK_IDS.pollCreationPolicy, /nonce-bound one-shot execution/],
    [DOCTOR_CHECK_IDS.pollEndPolicy, /live-count-bound approval/],
  ] as const
  for (const [id, summary] of expected) {
    const entry = enabled.checks.find((check) => check.id === id)
    assert.equal(entry?.status, "pass")
    assert.match(entry?.summary || "", summary)
    assert.equal(
      warning.checks.find((check) => check.id === id)?.status,
      "warn",
    )
  }
  assert.match(setup.warnings.join("\n"), /poll-channel allowlist/)
  assert.match(omitted.warnings.join("\n"), /polls toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_POLL_AUDIT",
    "DISCORD_MCP_ALLOW_POLL_CREATION",
    "DISCORD_MCP_ALLOW_POLL_ENDING",
    "DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT",
    "DISCORD_MCP_POLL_CHANNEL_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain credential-safe reviewed webhook administration", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_CHANGES: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_CREATION: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS: "true",
    DISCORD_MCP_WEBHOOK_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_WEBHOOK_AUDIT: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_CHANGES: "true",
    DISCORD_MCP_ALLOW_WEBHOOK_CREATION: "true",
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
  const creation = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.webhookCreationPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.webhookChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /credential-redacted webhook inventory/i)
  assert.match(audit?.summary || "", /1 exact channels/)
  assert.equal(deletion?.status, "pass")
  assert.match(deletion?.summary || "", /Incoming-webhook deletion/)
  assert.match(deletion?.summary || "", /one-shot execution and absence readback/)
  assert.equal(creation?.status, "pass")
  assert.match(creation?.summary || "", /Incoming-webhook creation/)
  assert.match(creation?.summary || "", /credential projection/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /rename and same-guild move/)
  assert.match(change?.summary || "", /complete inventory readback/)
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
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.webhookCreationPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.webhookChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /webhook-audit toggle/)
  assert.match(setup.warnings.join("\n"), /webhook-change toggle/)
  assert.match(setup.warnings.join("\n"), /webhook-creation toggle/)
  assert.match(setup.warnings.join("\n"), /webhook-deletion toggle/)
  assert.match(omitted.warnings.join("\n"), /webhooks toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_WEBHOOK_AUDIT",
    "DISCORD_MCP_ALLOW_WEBHOOK_CHANGES",
    "DISCORD_MCP_ALLOW_WEBHOOK_CREATION",
    "DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS",
    "DISCORD_MCP_WEBHOOK_CHANNEL_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain privacy-safe integration audit and deletion", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
    DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS: "true",
    DISCORD_MCP_INTEGRATION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_INTEGRATION_IDS: INTEGRATION_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_INTEGRATION_AUDIT: "true",
    DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.integrationAuditPolicy,
  )
  const deletion = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.integrationDeletionPolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe integration inventory/i)
  assert.match(audit?.summary || "", /MANAGE_GUILD/)
  assert.equal(deletion?.status, "pass")
  assert.match(deletion?.summary || "", /1 exact integrations/)
  assert.match(deletion?.summary || "", /side-effect acknowledgments/)
  assert.match(deletion?.summary || "", /full-inventory readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.integrationAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.integrationDeletionPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /integration-audit toggle/)
  assert.match(setup.warnings.join("\n"), /integration-deletion toggle/)
  assert.match(omitted.warnings.join("\n"), /integrations toolset/)
  for (const name of [
    FIXTURE_ENVIRONMENT_NAMES.allowIntegrationAudit,
    FIXTURE_ENVIRONMENT_NAMES.allowIntegrationDeletions,
    FIXTURE_ENVIRONMENT_NAMES.integrationGuildIds,
    FIXTURE_ENVIRONMENT_NAMES.integrationIds,
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
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

test("doctor and setup explain privacy-safe reviewed onboarding", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "true",
    DISCORD_MCP_ALLOW_ONBOARDING_CHANGES: "true",
    DISCORD_MCP_ONBOARDING_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ONBOARDING_AUDIT: "true",
    DISCORD_MCP_ALLOW_ONBOARDING_CHANGES: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.onboardingAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.onboardingChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /default text omission/)
  assert.match(audit?.summary || "", /future-field counts only/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /complete-state review/)
  assert.match(change?.summary || "", /signed approval/)
  assert.match(change?.summary || "", /authoritative response plus API readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.onboardingAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.onboardingChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /onboarding-audit toggle/)
  assert.match(setup.warnings.join("\n"), /onboarding-change toggle/)
  assert.match(omitted.warnings.join("\n"), /onboarding toolset/)
})

test("doctor and setup explain privacy-safe reviewed Welcome Screens", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "true",
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES: "true",
    DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT: "true",
    DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.welcomeScreenAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.welcomeScreenChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /default text omission/)
  assert.match(audit?.summary || "", /future-field counts only/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /complete-state review/)
  assert.match(change?.summary || "", /signed approval/)
  assert.match(change?.summary || "", /authoritative response plus API readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.welcomeScreenAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.welcomeScreenChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /Welcome Screen audit toggle/)
  assert.match(setup.warnings.join("\n"), /Welcome Screen change toggle/)
  assert.match(omitted.warnings.join("\n"), /welcome-screen toolset/)
})

test("doctor and setup explain authenticated reviewed widget settings", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES: "true",
    DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT: "true",
    DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.widgetSettingsAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.widgetSettingsChangePolicy,
  )
  const exposure = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.widgetPublicExposurePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /no anonymous endpoint calls/)
  assert.match(audit?.summary || "", /unknown-field counts only/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /complete-state review/)
  assert.match(change?.summary || "", /signed approval/)
  assert.match(change?.summary || "", /authoritative response plus API readback/)
  assert.equal(exposure?.status, "pass")
  assert.match(exposure?.summary || "", /enabling the widget/)
  assert.match(exposure?.summary || "", /different non-null channel/)
  for (const id of [
    DOCTOR_CHECK_IDS.widgetSettingsAuditPolicy,
    DOCTOR_CHECK_IDS.widgetSettingsChangePolicy,
    DOCTOR_CHECK_IDS.widgetPublicExposurePolicy,
  ]) {
    assert.equal(
      warning.checks.find((entry) => entry.id === id)?.status,
      "warn",
    )
  }
  assert.match(setup.warnings.join("\n"), /widget-settings audit toggle/)
  assert.match(setup.warnings.join("\n"), /widget-settings change toggle/)
  assert.match(setup.warnings.join("\n"), /widget public-exposure toggle/)
  assert.match(omitted.warnings.join("\n"), /widget-settings toolset/)
  for (const name of [
    FIXTURE_ENVIRONMENT_NAMES.allowWidgetSettingsAudit,
    FIXTURE_ENVIRONMENT_NAMES.allowWidgetSettingsChanges,
    FIXTURE_ENVIRONMENT_NAMES.allowWidgetPublicExposure,
    FIXTURE_ENVIRONMENT_NAMES.widgetSettingsGuildIds,
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
  assert.doesNotMatch(JSON.stringify(enabled), /private-channel|audit reason/u)
})

test("doctor and setup explain privacy-minimized reviewed guild settings", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_SETTINGS_CHANGES: "true",
    DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const disabled = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildSettingsAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildSettingsChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /continuity-safe channel evidence/)
  assert.match(audit?.summary || "", /named privacy-minimized state/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /sparse named-field review/)
  assert.match(change?.summary || "", /signed approval/)
  assert.match(change?.summary || "", /authoritative response plus API readback/)
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildSettingsAuditPolicy,
    )?.summary || "",
    /audit is disabled/,
  )
  assert.match(omitted.warnings.join("\n"), /guild-settings toolset/)
  for (const name of [
    FIXTURE_ENVIRONMENT_NAMES.allowGuildSettingsAudit,
    FIXTURE_ENVIRONMENT_NAMES.allowGuildSettingsChanges,
    FIXTURE_ENVIRONMENT_NAMES.guildSettingsGuildIds,
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
  assert.doesNotMatch(JSON.stringify(enabled), /guild name|channel name|audit reason/u)
})

test("doctor and setup explain transient reviewed guild profile text", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES: "true",
    DISCORD_MCP_GUILD_PROFILE_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const disabled = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildProfileAuditPolicy,
  )
  const change = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildProfileChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /transient text/)
  assert.match(audit?.summary || "", /presence-only media/)
  assert.match(audit?.summary || "", /complete permission evidence/)
  assert.equal(change?.status, "pass")
  assert.match(change?.summary || "", /sparse text-field review/)
  assert.match(change?.summary || "", /signed approval/)
  assert.match(change?.summary || "", /exact readback/)
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildProfileAuditPolicy,
    )?.summary || "",
    /audit is disabled/,
  )
  assert.match(omitted.warnings.join("\n"), /guild-profile toolset/)
  for (const name of [
    FIXTURE_ENVIRONMENT_NAMES.allowGuildProfileAudit,
    FIXTURE_ENVIRONMENT_NAMES.allowGuildProfileChanges,
    FIXTURE_ENVIRONMENT_NAMES.guildProfileGuildIds,
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
  assert.doesNotMatch(
    JSON.stringify(enabled),
    /guild profile text|guild name|description value|audit reason/u,
  )
})

test("doctor and setup explain reviewed exact-channel metadata changes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "true",
    DISCORD_MCP_CHANNEL_METADATA_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "true",
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

  const policy = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelMetadataPolicy,
  )
  assert.equal(policy?.status, "pass")
  assert.match(policy?.summary || "", /1 exact channels/)
  assert.match(policy?.summary || "", /partial one-shot execution/)
  assert.match(policy?.summary || "", /complete response plus fresh readback/)
  const voiceStatus = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.voiceChannelStatusPolicy,
  )
  assert.equal(voiceStatus?.status, "pass")
  assert.match(voiceStatus?.summary || "", /1 exact metadata-scope candidates/)
  assert.match(voiceStatus?.summary || "", /ordinary voice type at read time/)
  assert.match(voiceStatus?.summary || "", /connection-sensitive permission proof/)
  assert.match(voiceStatus?.summary || "", /GUILDS-only Gateway channel-info evidence/)
  const gateway = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.gatewayPolicy,
  )
  assert.match(gateway?.summary || "", /1 exact voice-status candidates/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.channelMetadataPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.voiceChannelStatusPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /channel-metadata toggle/)
  assert.match(omitted.warnings.join("\n"), /channel-metadata toolset/)
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

test("doctor and setup explain identity-bound reviewed application emoji scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-application-emojis-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const canonicalRoot = await realpath(root)
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_APPLICATION_EMOJI_AUDIT: "true",
    DISCORD_MCP_ALLOW_APPLICATION_EMOJI_CHANGES: "true",
    DISCORD_MCP_APPLICATION_EMOJI_ROOTS: canonicalRoot,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingRootEnvironment = environment({
    DISCORD_MCP_ALLOW_APPLICATION_EMOJI_AUDIT: "true",
    DISCORD_MCP_ALLOW_APPLICATION_EMOJI_CHANGES: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.applicationEmojiAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.applicationEmojiChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /verified pinned current application/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /application-wide coordination/)
  assert.match(changes?.summary || "", /1 canonical creation roots/)
  assert.equal(
    missingRoot.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.applicationEmojiChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /creation remains blocked/)
  assert.match(omitted.warnings.join("\n"), /application-emojis toolset/)
})

test("doctor and setup explain privacy-safe reviewed scheduled event scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-events-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const canonicalRoot = await realpath(root)
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT: "true",
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
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT: "true",
  })
  const missingGuild = await diagnoseConnector({
    environment: missingGuildEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingRootEnvironment = environment({
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES: "true",
    DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT: "true",
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
  const missingGuildSetup = await prepareSetup({
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventChangePolicy,
  )
  const users = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventUserAuditPolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe scheduled event inventory/i)
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /1 canonical cover roots/)
  assert.match(changes?.summary || "", /exact state or absence readback/)
  assert.equal(users?.status, "pass")
  assert.match(users?.summary || "", /ID-and-bot-only pages/)
  assert.match(users?.summary || "", /member expansion disabled/)
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
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.scheduledEventUserAuditPolicy,
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
  assert.match(missingGuildSetup.warnings.join("\n"), /user-audit toggle/)
  assert.match(omitted.warnings.join("\n"), /scheduled-events toolset/)
})

test("doctor and setup explain privacy-safe reviewed soundboard scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-soundboard-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const canonicalRoot = await realpath(root)
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT: "true",
    DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES: "true",
    DISCORD_MCP_SOUNDBOARD_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_SOUNDBOARD_ROOTS: canonicalRoot,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingGuildEnvironment = environment({
    DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT: "true",
    DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES: "true",
  })
  const missingGuild = await diagnoseConnector({
    environment: missingGuildEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingRootEnvironment = environment({
    DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT: "true",
    DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES: "true",
    DISCORD_MCP_SOUNDBOARD_GUILD_IDS: GUILD_ID,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.soundboardAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.soundboardChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe default and guild soundboard inventory/i)
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /1 canonical creation roots/)
  assert.match(changes?.summary || "", /exact metadata or absence readback/)
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.soundboardAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingGuild.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.soundboardChangePolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    missingRoot.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.soundboardChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /creation remains blocked/)
  assert.match(omitted.warnings.join("\n"), /soundboard toolset/)
})

test("doctor and setup explain reviewed Stage-instance scope", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT: "true",
    DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES: "true",
    DISCORD_MCP_ALLOW_STAGE_START_NOTIFICATIONS: "true",
    DISCORD_MCP_STAGE_CHANNEL_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const missingChannelEnvironment = environment({
    DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT: "true",
    DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES: "true",
    DISCORD_MCP_ALLOW_STAGE_START_NOTIFICATIONS: "true",
  })
  const missingChannel = await diagnoseConnector({
    environment: missingChannelEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: missingChannelEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.stageInstanceAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.stageInstanceChangePolicy,
  )
  const notifications = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.stageStartNotificationPolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /privacy-safe Stage-instance inventory/i)
  assert.match(audit?.summary || "", /1 exact Stage channels/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /signed approval/)
  assert.match(changes?.summary || "", /ambiguity quarantine/)
  assert.equal(notifications?.status, "pass")
  assert.match(notifications?.summary || "", /Mention Everyone permission evidence/)
  for (const checkId of [
    DOCTOR_CHECK_IDS.stageInstanceAuditPolicy,
    DOCTOR_CHECK_IDS.stageInstanceChangePolicy,
    DOCTOR_CHECK_IDS.stageStartNotificationPolicy,
  ]) {
    assert.equal(
      missingChannel.checks.find((entry) => entry.id === checkId)?.status,
      "warn",
    )
  }
  assert.match(setup.warnings.join("\n"), /Stage-instance audit toggle/)
  assert.match(setup.warnings.join("\n"), /Stage-instance change toggle/)
  assert.match(omitted.warnings.join("\n"), /stage-instances toolset/)
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

test("doctor and setup explain exact reviewed role-configuration scope", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
      DISCORD_MCP_GUILD_EXPRESSION_ROOTS: process.cwd(),
      DISCORD_MCP_ROLE_CONFIGURATION_IDS: ROLE_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
  })
  const warning = await diagnoseConnector({
    environment: warningEnvironment,
    nodeVersion: "22.14.0",
  })
  const imageWarning = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
      DISCORD_MCP_ROLE_CONFIGURATION_IDS: ROLE_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: warningEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_ROLE_CONFIGURATION: "true",
      DISCORD_MCP_ROLE_CONFIGURATION_IDS: ROLE_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const configuration = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.roleConfigurationPolicy,
  )
  assert.equal(configuration?.status, "pass")
  assert.match(configuration?.summary || "", /1 exact roles/)
  assert.match(configuration?.summary || "", /complete readback/)
  assert.match(configuration?.summary || "", /1 canonical local-image roots/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.roleConfigurationPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    imageWarning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.roleConfigurationPolicy,
    )?.status,
    "warn",
  )
  assert.match(
    imageWarning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.roleConfigurationPolicy,
    )?.summary || "",
    /local-image role icons are blocked/,
  )
  assert.match(setup.warnings.join("\n"), /exact role allowlist/)
  assert.match(omitted.warnings.join("\n"), /role-configuration toolset/)
})

test("doctor and setup separate role-order audit from reviewed changes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
    DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES: "true",
    DISCORD_MCP_ROLE_ORDERING_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT: "true",
    DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.roleOrderingAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.roleOrderingChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.match(audit?.summary || "", /aggregate holder evidence/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /signed approval/)
  assert.match(changes?.summary || "", /durable collection coordination/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.roleOrderingAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.roleOrderingChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /role-ordering audit toggle/)
  assert.match(setup.warnings.join("\n"), /role-ordering change toggle/)
  assert.match(omitted.warnings.join("\n"), /role-ordering toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT",
    "DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES",
    "DISCORD_MCP_ROLE_ORDERING_GUILD_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain exact reviewed channel cloning", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_CLONING: "true",
    DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelCloneAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelCloneChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact sources across 1 exact guilds/)
  assert.match(audit?.summary || "", /obfuscation-safe topology/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /signed approval/)
  assert.match(changes?.summary || "", /atomic one-shot creation/)
  assert.match(changes?.summary || "", /content-free auditing/)
  assert.match(omitted.warnings.join("\n"), /channel-cloning toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT",
    "DISCORD_MCP_ALLOW_CHANNEL_CLONING",
    "DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS",
    "DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup separate channel-order audit from reviewed changes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES: "true",
    DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelOrderingAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelOrderingChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact guilds/)
  assert.match(audit?.summary || "", /obfuscation-safe Gateway layout/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /signed approval/)
  assert.match(changes?.summary || "", /newer complete Gateway verification/)
  assert.match(omitted.warnings.join("\n"), /channel-ordering toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT",
    "DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES",
    "DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain reviewed exact channel deletion", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT: "true",
    DISCORD_MCP_ALLOW_CHANNEL_DELETIONS: "true",
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_CHANNEL_DELETION_IDS: CHANNEL_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelDeletionAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.channelDeletionChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact channels/)
  assert.match(audit?.summary || "", /complete topology, dependency, permission, and privacy-safe evidence/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /irreversible acknowledgement/)
  assert.match(changes?.summary || "", /newer Gateway absence verification/)
  assert.match(omitted.warnings.join("\n"), /channel-deletion toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT",
    "DISCORD_MCP_ALLOW_CHANNEL_DELETIONS",
    "DISCORD_MCP_CHANNEL_DELETION_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain reviewed exact role deletion", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_GATEWAY: "true",
    DISCORD_MCP_ALLOW_ROLE_DELETIONS: "true",
    DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT: "true",
    DISCORD_MCP_ROLE_DELETION_IDS: ROLE_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const setup = await prepareSetup({
    environment: enabledEnvironment,
    service: statusProvider(),
  })
  const omitted = await prepareSetup({
    environment: {
      ...enabledEnvironment,
      DISCORD_MCP_TOOLSETS: "connector,gateway",
    },
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.roleDeletionAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.roleDeletionChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact roles/)
  assert.match(audit?.summary || "", /holder, hierarchy, dependency, permission/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /irreversible acknowledgement/)
  assert.match(changes?.summary || "", /fresh absence verification/)
  assert.match(omitted.warnings.join("\n"), /role-deletion toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT",
    "DISCORD_MCP_ALLOW_ROLE_DELETIONS",
    "DISCORD_MCP_ROLE_DELETION_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
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

test("doctor and setup explain reviewed member nickname scope without Discord writes", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_NICKNAME_CHANGES: "true",
    DISCORD_MCP_ALLOW_OTHER_MEMBER_NICKNAME_CHANGES: "true",
    DISCORD_MCP_NICKNAME_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_NICKNAME_CHANGES: "true",
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

  const currentBot = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.memberNicknamePolicy,
  )
  const otherMember = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.otherMemberNicknamePolicy,
  )
  assert.equal(currentBot?.status, "pass")
  assert.match(currentBot?.summary || "", /1 exact guilds/)
  assert.match(currentBot?.summary || "", /CHANGE_NICKNAME evidence/)
  assert.match(currentBot?.summary || "", /signed approval, one-shot execution, and exact readback/)
  assert.equal(otherMember?.status, "pass")
  assert.match(otherMember?.summary || "", /protected-user/)
  assert.match(otherMember?.summary || "", /MANAGE_NICKNAMES/)
  assert.match(otherMember?.summary || "", /strict hierarchy checks/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.memberNicknamePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /exact guild allowlist/)
  assert.match(omitted.warnings.join("\n"), /member-nicknames toolset/)
  for (const name of [
    "DISCORD_MCP_ALLOW_NICKNAME_CHANGES",
    "DISCORD_MCP_ALLOW_OTHER_MEMBER_NICKNAME_CHANGES",
    "DISCORD_MCP_NICKNAME_GUILD_IDS",
  ]) {
    assert.equal(setup.launch.environment.forward.includes(name), false)
  }
})

test("doctor and setup explain privacy-safe reviewed member voice scope", async () => {
  const enabledEnvironment = environment({
    DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT: "true",
    DISCORD_MCP_ALLOW_MEMBER_VOICE_CHANGES: "true",
    DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_MEMBER_VOICE_GUILD_IDS: GUILD_ID,
  })
  const enabled = await diagnoseConnector({
    environment: enabledEnvironment,
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT: "true",
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
    (entry) => entry.id === DOCTOR_CHECK_IDS.memberVoiceAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.memberVoiceChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /1 exact guilds and 1 exact voice-scope channels/)
  assert.match(audit?.summary || "", /without occupant enumeration or state persistence/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /permission and hierarchy review/)
  assert.match(changes?.summary || "", /signed approval, and one-shot execution/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.memberVoiceAuditPolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /exact guild and voice-channel allowlists/)
  assert.match(omitted.warnings.join("\n"), /voice-moderation toolset/)
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
  const blueprintOmitted = await prepareSetup({
    environment: environment({
      DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT: "true",
      DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES: "true",
      DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS: "true",
      DISCORD_MCP_GUILD_PROFILE_GUILD_IDS: GUILD_ID,
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
  assert.match(blueprintOmitted.warnings.join("\n"), /guild-blueprints toolset/)
})

test("doctor and setup explain capability-safe Guild Template scope without Discord writes", async () => {
  const enabled = await diagnoseConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES: "true",
      DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: GUILD_ID,
    }),
    nodeVersion: "22.14.0",
  })
  const warningEnvironment = environment({
    DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
    DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES: "true",
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
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT: "true",
      DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES: "true",
      DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS: GUILD_ID,
      DISCORD_MCP_TOOLSETS: "connector",
    }),
    service: statusProvider(),
  })

  const audit = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildTemplateAuditPolicy,
  )
  const changes = enabled.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.guildTemplateChangePolicy,
  )
  assert.equal(audit?.status, "pass")
  assert.match(audit?.summary || "", /opaque process-local references/)
  assert.match(audit?.summary || "", /count-only snapshot evidence/)
  assert.equal(changes?.status, "pass")
  assert.match(changes?.summary || "", /full private-inventory planning/)
  assert.match(changes?.summary || "", /one-shot execution, and exact readback/)
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildTemplateAuditPolicy,
    )?.status,
    "warn",
  )
  assert.equal(
    warning.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.guildTemplateChangePolicy,
    )?.status,
    "warn",
  )
  assert.match(setup.warnings.join("\n"), /Guild Template audit toggle/)
  assert.match(setup.warnings.join("\n"), /Guild Template change toggle/)
  assert.match(omitted.warnings.join("\n"), /guild-templates toolset/)
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

test("doctor and setup explain native Interaction ingress and command boundaries", async () => {
  const configuredEnvironment = environment({
    DISCORD_MCP_ALLOW_NATIVE_COMMAND_CHANGES: "true",
    DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS: "true",
    DISCORD_MCP_NATIVE_COMMAND_NAME: "ask",
    DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_NATIVE_INTERACTION_MAX_PENDING: "7",
    DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS: "180",
    DISCORD_MCP_NATIVE_INTERACTION_USER_IDS: BOT_ID,
  })
  const report = await diagnoseConnector({
    environment: configuredEnvironment,
    nodeVersion: "22.14.0",
  })
  const disabled = await diagnoseConnector({
    environment: environment(),
    nodeVersion: "22.14.0",
  })
  const omitted = await prepareSetup({
    environment: {
      ...configuredEnvironment,
      DISCORD_MCP_TOOLSETS: "connector",
    },
    service: statusProvider(),
  })

  const command = report.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.nativeInteractionCommandPolicy,
  )
  const ingress = report.checks.find(
    (entry) => entry.id === DOCTOR_CHECK_IDS.nativeInteractionIngressPolicy,
  )
  assert.equal(command?.status, "pass")
  assert.match(command?.summary || "", /\/ask in 1 exact guilds/)
  assert.match(command?.summary || "", /full-inventory readback/)
  assert.equal(ingress?.status, "pass")
  assert.match(ingress?.summary || "", /at most 7 requests for 180 seconds/)
  assert.match(ingress?.summary || "", /intents-free Gateway connection/)
  assert.match(ingress?.summary || "", /endpoint and command verification/)
  assert.match(omitted.warnings.join("\n"), /native-interactions toolset/)
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.nativeInteractionCommandPolicy,
    )?.summary || "",
    /disabled/,
  )
  assert.match(
    disabled.checks.find(
      (entry) => entry.id === DOCTOR_CHECK_IDS.nativeInteractionIngressPolicy,
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

test("doctor and setup turn current application posture into actionable findings", async () => {
  const defaultPermissions = DISCORD_PERMISSIONS.ADMINISTRATOR | (1n << 90n)
  const posture = projectApplicationPosture({
    bot_public: true,
    bot_require_code_grant: true,
    custom_install_url: "https://install.invalid/private",
    description: "private application description",
    event_webhooks_status: 2,
    event_webhooks_url: "https://events.invalid/private",
    flags_new: DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited.toString(),
    id: APPLICATION_ID,
    integration_types_config: {
      "0": {
        oauth2_install_params: {
          permissions: defaultPermissions.toString(),
          scopes: ["bot", "future.scope"],
        },
      },
    },
    interactions_endpoint_url: "https://interactions.invalid/private",
    name: "private application name",
  }, BOT_ID, {
    guildMembersIntentRequired: false,
    messageContentIntent: "not-required",
    nativeInteractionIngressRequired: true,
  })
  const configuredEnvironment = environment({
    DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS: "true",
    DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_NATIVE_INTERACTION_USER_IDS: BOT_ID,
    DISCORD_MCP_TOOLSETS: "connector,native-interactions",
  })
  const provider = {
    async getStatus() {
      return status(1, "disabled", "disabled", posture)
    },
  }

  const report = await diagnoseConnector({
    environment: configuredEnvironment,
    nodeVersion: "22.14.0",
    online: true,
    service: provider,
  })
  const setup = await prepareSetup({
    environment: configuredEnvironment,
    service: provider,
  })

  const expected = [
    [DOCTOR_CHECK_IDS.applicationInstall, "fail"],
    [DOCTOR_CHECK_IDS.applicationBotVisibility, "warn"],
    [DOCTOR_CHECK_IDS.applicationDefaultPermissions, "warn"],
    [DOCTOR_CHECK_IDS.applicationInteractionDelivery, "fail"],
    [DOCTOR_CHECK_IDS.applicationPresenceIntent, "warn"],
    [DOCTOR_CHECK_IDS.applicationEventWebhooks, "warn"],
  ] as const
  for (const [id, expectedStatus] of expected) {
    const entry = report.checks.find((check) => check.id === id)
    assert.equal(entry?.status, expectedStatus, id)
    assert.equal(entry?.reference, "docs/reference.md#application-security-posture")
    assert.match(entry?.action || "", /Developer Portal/)
  }
  assert.equal(report.status, "error")
  assert.match(setup.warnings.join("\n"), /full OAuth2 code grant/)
  assert.match(setup.warnings.join("\n"), /requests Administrator/)
  assert.match(setup.warnings.join("\n"), /other than the application owner/)
  assert.match(setup.warnings.join("\n"), /event webhooks are enabled/)
  assert.doesNotMatch(JSON.stringify({ report, setup }), /https:\/\//u)
  assert.doesNotMatch(JSON.stringify({ report, setup }), /private application/u)
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
  const withoutMessages = await prepareSetup({
    environment: environment({
      [FIXTURE_ENVIRONMENT_NAMES.toolsets]: "connector",
    }),
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
  assert.doesNotMatch(withoutMessages.warnings.join("\n"), /Message Content intent/)
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

test("stdio launch descriptor requires one policy and forwards only its secrets", () => {
  const file = "/configuration/discord.json"
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: FIXTURE_ENVIRONMENT_NAMES.token,
    guildIds: [GUILD_ID],
    name: "team-discord",
    toolsets: ["connector"],
    toolSurface: "full",
  })
  const config = { document, file }
  const result = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    command: "/opt/Discord MCP/bin/discord-mcp",
    config,
    serverName: "team-discord",
  })

  assert.deepEqual(result, {
    args: ["serve", "--config", file],
    command: "/opt/Discord MCP/bin/discord-mcp",
    environment: {
      forward: [FIXTURE_ENVIRONMENT_NAMES.token],
      set: {},
    },
    requirements: {
      elicitation: "required-for-reviewed-writes",
      requiredServer: true,
      toolApproval: "writes",
    },
    secrets: {
      environmentVariables: [FIXTURE_ENVIRONMENT_NAMES.token],
      files: [],
    },
    serverName: "team-discord",
    timeouts: {
      startupSeconds: 30,
      toolSeconds: 180,
    },
    transport: "stdio",
  })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    }),
    /require a schema-v2 configuration or profile/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      config,
      serverName: "bad.name",
    }),
    /MCP server name/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: "not-a-snowflake",
      botId: BOT_ID,
      config,
    }),
    /snowflake/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: "not-a-snowflake",
      config,
    }),
    /bot ID must be a snowflake/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      command: " ",
      config,
    }),
    /command must not be empty/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      args: ["serve", ""],
      botId: BOT_ID,
      config,
    }),
    /arguments must be non-empty strings/,
  )
})

test("stdio launch descriptor makes a saved profile the complete non-overridable policy", () => {
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
  assert.equal(result.environment.forward.includes(FIXTURE_ENVIRONMENT_NAMES.token), false)
  for (const variable of [
    FIXTURE_ENVIRONMENT_NAMES.allowedChannelIds,
    FIXTURE_ENVIRONMENT_NAMES.allowedGuildIds,
    FIXTURE_ENVIRONMENT_NAMES.allowGateway,
    FIXTURE_ENVIRONMENT_NAMES.gatewayEventBufferSize,
    FIXTURE_ENVIRONMENT_NAMES.toolSurface,
    FIXTURE_ENVIRONMENT_NAMES.toolsets,
  ]) {
    assert.equal(result.environment.forward.includes(variable), false)
  }
  assert.equal(
    result.environment.forward.includes(FIXTURE_ENVIRONMENT_NAMES.allowDeletions),
    false,
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
    /already select a configuration/,
  )
})

test("stdio launch descriptor makes a standalone configuration the only policy input", () => {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
  const file = "/configuration/discord.json"
  const result = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["serve"],
    botId: BOT_ID,
    config: { document, file },
  })

  assert.deepEqual(result.args, ["serve", "--config", file])
  assert.deepEqual(result.environment, {
    forward: [TOKEN_ALIAS],
    set: {},
  })
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      config: { document, file },
      profile: document,
    }),
    /mutually exclusive/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: "999999999999999999",
      botId: BOT_ID,
      config: { document, file },
    }),
    /does not match the verified Discord identity/,
  )
  assert.throws(
    () => createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      args: ["serve", "--config", file],
      botId: BOT_ID,
      config: { document, file },
    }),
    /already select a configuration/,
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
  assert.deepEqual(report.launch.args, [
    "/srv/discord-mcp/dist/cli.js",
    "serve",
    "--config",
    report.configFile,
  ])
  assert.equal(report.launch.command, "/usr/bin/node")
  assert.equal(report.launch.serverName, "discord-safe")
  assert.deepEqual(report.launch.environment, {
    forward: [FIXTURE_ENVIRONMENT_NAMES.token],
    set: {},
  })
  assert.equal(report.preset, null)
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

test("preset setup saves resolved read-only authority and forwards only its credential", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-setup-preset-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const profileDirectory = join(await realpath(temporary), "profiles")
  const source = { [TOKEN_ALIAS]: TOKEN }
  const before = { ...source }

  const observer = await prepareSetup({
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    profileDirectory,
    profileName: "observer",
    preset: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    service: {
      async getStatus() {
        return status(1, "disabled")
      },
    },
  })

  assert.deepEqual(source, before)
  assert.deepEqual(observer.preset, getSetupPreset("server-observer"))
  assert.deepEqual(observer.profile?.readScope, {
    channelIds: [CHANNEL_ID],
    guildIds: [GUILD_ID],
  })
  assert.deepEqual(observer.profile?.tools, {
    surface: "full",
    toolsets: [...getSetupPreset("server-observer").toolsets],
  })
  assert.equal(observer.profile?.gateway.enabled, false)
  assert.deepEqual(observer.launch.environment.forward, [TOKEN_ALIAS])
  assert.deepEqual(observer.launch.environment.set, {})
  assert.doesNotMatch(observer.warnings.join("\n"), /Message Content intent/)
  assert.doesNotMatch(JSON.stringify(observer), new RegExp(TOKEN))
  assert.deepEqual(
    await loadProfile("observer", { directory: profileDirectory }),
    observer.profile,
  )

  const reader = await prepareSetup({
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    profileDirectory,
    profileName: "reader",
    preset: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
      name: "channel-reader",
    },
    service: {
      async getStatus() {
        return status(1, "unknown")
      },
    },
  })
  assert.deepEqual(reader.preset, getSetupPreset("channel-reader"))
  assert.match(reader.warnings.join("\n"), /Message Content intent/)
  assert.deepEqual(reader.launch.environment.forward, [TOKEN_ALIAS])

  await assert.rejects(
    () => prepareSetup({
      credentialVariable: TOKEN_ALIAS,
      environment: source,
      profileDirectory,
      profileName: "partial-scope",
      preset: {
        guildIds: [GUILD_ID, "300000000000000002"],
        name: "server-observer",
      },
      service: statusProvider(1),
    }),
    /access 1 of 2 exact preset guilds/,
  )
})

test("setup creates and verifies a preset-backed profile without persisting or reporting its credential", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-setup-profile-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const profileDirectory = join(await realpath(temporary), "profiles")
  const source = { [TOKEN_ALIAS]: TOKEN }
  const before = { ...source }

  const report = await prepareSetup({
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    profileDirectory,
    profileName: "support-bot",
    preset: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
      name: "channel-reader",
    },
    service: statusProvider(),
  })

  assert.deepEqual(source, before)
  assert.equal(report.schemaVersion, OPERATOR_REPORT_SCHEMA_VERSION)
  assert.equal(report.profile?.name, "support-bot")
  assert.deepEqual(report.profile?.credential, {
    provider: "environment",
    variable: TOKEN_ALIAS,
  })
  assert.equal(report.profile?.identity.applicationId, APPLICATION_ID)
  assert.equal(report.profile?.identity.botId, BOT_ID)
  assert.deepEqual(report.profile?.readScope, {
    channelIds: [CHANNEL_ID],
    guildIds: [GUILD_ID],
  })
  assert.deepEqual(report.profile?.tools, {
    surface: "full",
    toolsets: [...getSetupPreset("channel-reader").toolsets],
  })
  assert.deepEqual(report.profile?.gateway, {
    enabled: false,
    eventBufferSize: 100,
  })
  assert.equal(
    report.profile?.schemaVersion === 2
      ? report.profile.capabilities.deletions
      : undefined,
    undefined,
  )
  assert.deepEqual(
    report.profile?.schemaVersion === 2
      ? report.profile.scopes.deleteChannelIds
      : undefined,
    undefined,
  )
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
  assert.deepEqual(report.launch.environment.forward, [TOKEN_ALIAS])
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => prepareSetup({
      credentialVariable: TOKEN_ALIAS,
      environment: source,
      profileDirectory,
      profileName: "support-bot",
      preset: {
        channelIds: [CHANNEL_ID],
        guildIds: [GUILD_ID],
        name: "channel-reader",
      },
      service: statusProvider(),
    }),
    /already exists/,
  )
  const saved = await readFile(join(profileDirectory, "support-bot.json"), "utf8")
  const verified = await prepareSetup({
    environment: { [TOKEN_ALIAS]: TOKEN },
    profileDirectory,
    profileName: "support-bot",
    service: statusProvider(),
  })
  assert.deepEqual(verified.profile, report.profile)
  assert.equal(
    await readFile(join(profileDirectory, "support-bot.json"), "utf8"),
    saved,
  )
  await assert.rejects(
    () => prepareSetup({
      environment: { [TOKEN_ALIAS]: TOKEN },
      overwriteProfile: true,
      profileDirectory,
      profileName: "support-bot",
      service: statusProvider(),
    }),
    /require --preset/,
  )
})

test("setup creates and verifies a preset-backed configuration with recoverable replacement", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-setup-config-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const configFile = join(await realpath(temporary), "discord.json")
  const source = { [TOKEN_ALIAS]: TOKEN }
  const before = { ...source }

  const report = await prepareSetup({
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    configFile,
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    preset: {
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    service: statusProvider(),
  })

  assert.deepEqual(source, before)
  assert.equal(report.configBackupFile, null)
  assert.equal(report.configFile, configFile)
  assert.deepEqual(report.credential, {
    provider: "environment",
    variable: TOKEN_ALIAS,
  })
  assert.equal(report.profile, null)
  assert.deepEqual(report.launch.args, [
    "/srv/discord-mcp/dist/cli.js",
    "serve",
    "--config",
    configFile,
  ])
  assert.deepEqual(report.launch.environment, {
    forward: [TOKEN_ALIAS],
    set: {},
  })
  const initial = loadConnectorConfigDocumentFile(configFile)
  assert.equal(initial.name, "discord")
  assert.deepEqual(initial.credential, {
    provider: "environment",
    variable: TOKEN_ALIAS,
  })
  assert.equal(initial.gateway.enabled, false)
  assert.deepEqual(initial.tools.toolsets, getSetupPreset("server-observer").toolsets)
  assert.doesNotMatch(await readFile(configFile, "utf8"), new RegExp(TOKEN))
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => prepareSetup({
      configFile,
      credentialVariable: TOKEN_ALIAS,
      environment: source,
      preset: {
        guildIds: [GUILD_ID],
        name: "server-observer",
      },
      service: statusProvider(),
    }),
    /already exists/,
  )

  const saved = await readFile(configFile, "utf8")
  const verified = await prepareSetup({
    configFile,
    environment: { [TOKEN_ALIAS]: TOKEN },
    service: statusProvider(),
  })
  assert.equal(verified.configBackupFile, null)
  assert.equal(await readFile(configFile, "utf8"), saved)

  const replacement = await prepareSetup({
    configFile,
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    overwriteConfig: true,
    preset: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
      name: "channel-reader",
    },
    service: statusProvider(),
  })
  assert.ok(replacement.configBackupFile)
  assert.deepEqual(
    loadConnectorConfigDocumentFile(replacement.configBackupFile),
    initial,
  )
  assert.deepEqual(
    loadConnectorConfigDocumentFile(configFile).tools.toolsets,
    getSetupPreset("channel-reader").toolsets,
  )

  const changedIdentity = status()
  changedIdentity.application.id = "100000000000000002"
  await assert.rejects(
    () => prepareSetup({
      configFile,
      credentialVariable: TOKEN_ALIAS,
      environment: source,
      overwriteConfig: true,
      preset: {
        guildIds: [GUILD_ID],
        name: "server-observer",
      },
      service: {
        async getStatus() {
          return changedIdentity
        },
      },
    }),
    /locked to its existing Discord identity/,
  )
})

test("setup records and verifies a file-backed credential without forwarding an environment secret", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-setup-file-secret-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const configFile = join(root, "discord.json")
  const credentialFile = join(root, "discord-token")
  await writeFile(credentialFile, `${TOKEN}\n`, { mode: 0o600 })

  const report = await prepareSetup({
    configFile,
    credentialFile,
    environment: { PATH: "/usr/bin" },
    preset: {
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    service: statusProvider(),
  })

  assert.deepEqual(report.credential, {
    path: credentialFile,
    provider: "file",
  })
  assert.deepEqual(report.launch.environment, { forward: [], set: {} })
  assert.deepEqual(report.launch.secrets, {
    environmentVariables: [],
    files: [credentialFile],
  })
  assert.deepEqual(loadConnectorConfigDocumentFile(configFile).credential, {
    path: credentialFile,
    provider: "file",
  })
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))
  assert.deepEqual(
    (await prepareSetup({
      configFile,
      environment: { PATH: "/usr/bin" },
      service: statusProvider(),
    })).credential,
    report.credential,
  )

  await assert.rejects(
    () => prepareSetup({
      configFile: join(root, "redaction.json"),
      credentialFile,
      environment: { PATH: "/usr/bin" },
      preset: {
        guildIds: [GUILD_ID],
        name: "server-observer",
      },
      service: {
        async getStatus() {
          throw new Error(`Credential ${TOKEN} rejected`)
        },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Credential \[redacted\] rejected/)
      assert.doesNotMatch(error.message, new RegExp(TOKEN))
      return true
    },
  )
})

test("setup requires one schema-v2 target and rejects ambient policy or implicit replacement", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-setup-selection-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const configFile = join(root, "discord.json")
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "discord",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })

  await assert.rejects(
    () => prepareConfigSetup({
      environment: { [TOKEN_ALIAS]: TOKEN },
      service: statusProvider(),
    }),
    /requires a configuration file or profile/,
  )
  await assert.rejects(
    () => prepareConfigSetup({
      configFile,
      environment: { [TOKEN_ALIAS]: TOKEN },
      service: statusProvider(),
    }),
    /target was not found/,
  )
  await writeConnectorConfigDocumentFile(configFile, document)
  await assert.rejects(
    () => prepareConfigSetup({
      configFile,
      credentialVariable: TOKEN_ALIAS,
      environment: { [TOKEN_ALIAS]: TOKEN },
      service: statusProvider(),
    }),
    /require --preset/,
  )
  await assert.rejects(
    () => prepareConfigSetup({
      configFile,
      environment: {
        [TOKEN_ALIAS]: TOKEN,
        [FIXTURE_ENVIRONMENT_NAMES.allowDeletions]: "true",
      },
      service: statusProvider(),
    }),
    /conflicts with undeclared environment variables/,
  )
  await assert.rejects(
    () => prepareConfigSetup({
      configFile,
      environment: {
        [FIXTURE_ENVIRONMENT_NAMES.configFile]: join(root, "other.json"),
        [TOKEN_ALIAS]: TOKEN,
      },
      service: statusProvider(),
    }),
    new RegExp(`conflicts with ${FIXTURE_ENVIRONMENT_NAMES.configFile}`),
  )
  const profileDirectory = join(root, "profiles")
  await prepareConfigSetup({
    credentialVariable: TOKEN_ALIAS,
    environment: { [TOKEN_ALIAS]: TOKEN },
    preset: {
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    profileDirectory,
    profileName: "observer",
    service: statusProvider(),
  })
  await assert.rejects(
    () => prepareConfigSetup({
      environment: {
        [FIXTURE_ENVIRONMENT_NAMES.configFile]: configFile,
        [TOKEN_ALIAS]: TOKEN,
      },
      profileDirectory,
      profileName: "observer",
      service: statusProvider(),
    }),
    new RegExp(`conflicts with ${FIXTURE_ENVIRONMENT_NAMES.configFile}`),
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
    "review_announcement_crosspost",
    "review_announcement_subscription",
    "review_application_emoji_change",
    "review_attachment_message",
    "review_automod_change",
    "review_channel_clone",
    "review_channel_creation",
    "review_channel_deletion",
    "review_channel_metadata_change",
    "review_channel_order",
    "review_channel_permission_overwrite",
    "review_forum_post",
    "review_forum_tag_change",
    "review_guild_blueprint",
    "review_guild_expression_change",
    "review_guild_integration_deletion",
    "review_guild_profile_change",
    "review_guild_scaffold",
    "review_guild_settings_change",
    "review_guild_template_change",
    "review_invite_deletion",
    "review_member_moderation",
    "review_member_nickname_change",
    "review_member_role_change",
    "review_member_voice_change",
    "review_message_deletion",
    "review_message_forward",
    "review_message_pin",
    "review_onboarding_change",
    "review_pending_native_interactions",
    "review_reaction_moderation",
    "review_role_configuration",
    "review_role_creation",
    "review_role_deletion",
    "review_role_order",
    "review_scheduled_event_change",
    "review_soundboard_change",
    "review_stage_instance_change",
    "review_thread_change",
    "review_voice_channel_status_change",
    "review_webhook_change",
    "review_webhook_creation",
    "review_webhook_deletion",
    "review_welcome_screen_change",
    "review_widget_settings_change",
    "search_guild_messages",
    "summarize_channel",
  ])
  assert.deepEqual(report.resourceUris, [
    "discord://application/emojis",
    "discord://application/posture",
    "discord://connector/activity",
    "discord://connector/observability",
    "discord://connector/policy",
    "discord://connector/safety",
    "discord://gateway/events",
    "discord://gateway/status",
    "discord://guilds",
    "discord://interactions/pending",
    "discord://interactions/status",
    "discord://soundboard/defaults",
    "discord://voice/regions",
  ])
  assert.deepEqual(report.resourceTemplateUris, [
    "discord://channels/{channelId}",
    "discord://channels/{channelId}/access",
    "discord://channels/{channelId}/announcement-subscriptions",
    "discord://channels/{channelId}/forum-tags",
    "discord://channels/{channelId}/messages/{messageId}",
    "discord://channels/{channelId}/messages/{messageId}/reactions",
    "discord://channels/{channelId}/permission-overwrites",
    "discord://channels/{channelId}/webhooks",
    "discord://guilds/{guildId}/automod-rules",
    "discord://guilds/{guildId}/bans/{userId}",
    "discord://guilds/{guildId}/channel-order",
    "discord://guilds/{guildId}/channels",
    "discord://guilds/{guildId}/channels/{channelId}/deletion-readiness",
    "discord://guilds/{guildId}/channels/{channelId}/stage-instance",
    "discord://guilds/{guildId}/channels/{channelId}/voice-status",
    "discord://guilds/{guildId}/emojis",
    "discord://guilds/{guildId}/integrations",
    "discord://guilds/{guildId}/invites/{inviteRef}",
    "discord://guilds/{guildId}/members/{userId}",
    "discord://guilds/{guildId}/members/{userId}/voice-state",
    "discord://guilds/{guildId}/onboarding",
    "discord://guilds/{guildId}/profile",
    "discord://guilds/{guildId}/role-order",
    "discord://guilds/{guildId}/roles",
    "discord://guilds/{guildId}/roles/{roleId}",
    "discord://guilds/{guildId}/roles/{roleId}/deletion-readiness",
    "discord://guilds/{guildId}/scheduled-events",
    "discord://guilds/{guildId}/settings",
    "discord://guilds/{guildId}/soundboard",
    "discord://guilds/{guildId}/soundboard/{soundId}",
    "discord://guilds/{guildId}/stickers",
    "discord://guilds/{guildId}/templates",
    "discord://guilds/{guildId}/threads/{threadId}",
    "discord://guilds/{guildId}/threads/{threadId}/members/{userId}",
    "discord://guilds/{guildId}/voice-regions",
    "discord://guilds/{guildId}/welcome-screen",
    "discord://guilds/{guildId}/widget-settings",
  ])
  assert.deepEqual(report.destructiveTools, [
    "delete_messages",
    "edit_own_message",
    "execute_announcement_crosspost",
    "execute_announcement_subscription",
    "execute_application_emoji_change",
    "execute_automod_change",
    "execute_channel_clone",
    "execute_channel_deletion",
    "execute_channel_metadata_change",
    "execute_channel_order",
    "execute_channel_permission_overwrite",
    "execute_component_message",
    "execute_forum_tag_change",
    "execute_guild_blueprint",
    "execute_guild_expression_change",
    "execute_guild_integration_deletion",
    "execute_guild_profile_change",
    "execute_guild_settings_change",
    "execute_guild_soundboard_change",
    "execute_guild_template_change",
    "execute_guild_welcome_screen_change",
    "execute_guild_widget_settings_change",
    "execute_invite_deletion",
    "execute_member_moderation",
    "execute_member_nickname_change",
    "execute_member_role_change",
    "execute_member_voice_change",
    "execute_message_forward",
    "execute_message_pin",
    "execute_native_interaction_command",
    "execute_onboarding_change",
    "execute_poll_end",
    "execute_reaction_moderation",
    "execute_role_configuration",
    "execute_role_deletion",
    "execute_role_order",
    "execute_scheduled_event_change",
    "execute_stage_instance_change",
    "execute_thread_change",
    "execute_voice_channel_status_change",
    "execute_webhook_change",
    "execute_webhook_creation",
    "execute_webhook_deletion",
    "remove_own_reaction",
  ])
  assert.equal(report.readOnlyTools.includes("get_connector_status"), true)
  assert.equal(report.readOnlyTools.includes("get_observability_status"), true)
  assert.equal(report.readOnlyTools.includes("discover_discord_tools"), true)
  assert.equal(report.readOnlyTools.includes("plan_channel_creation"), true)
  assert.equal(report.readOnlyTools.includes("audit_channel_order"), true)
  assert.equal(report.readOnlyTools.includes("plan_channel_clone"), true)
  assert.equal(report.readOnlyTools.includes("plan_channel_order"), true)
  assert.equal(report.readOnlyTools.includes("get_voice_channel_status"), true)
  assert.equal(report.readOnlyTools.includes("plan_voice_channel_status_change"), true)
  assert.equal(report.readOnlyTools.includes("plan_forum_post"), true)
  assert.equal(report.readOnlyTools.includes("audit_forum_tags"), true)
  assert.equal(report.readOnlyTools.includes("plan_forum_tag_change"), true)
  assert.equal(report.readOnlyTools.includes("plan_guild_blueprint"), true)
  assert.equal(report.readOnlyTools.includes("verify_guild_blueprint"), true)
  assert.equal(report.readOnlyTools.includes("plan_attachment_message"), true)
  assert.equal(report.readOnlyTools.includes("preview_component_layout"), true)
  assert.equal(report.readOnlyTools.includes("plan_component_message"), true)
  assert.equal(report.readOnlyTools.includes("plan_member_role_change"), true)
  assert.equal(report.readOnlyTools.includes("get_member_voice_state"), true)
  assert.equal(report.readOnlyTools.includes("plan_member_voice_change"), true)
  assert.equal(report.readOnlyTools.includes("get_thread_state"), true)
  assert.equal(report.readOnlyTools.includes("get_thread_membership"), true)
  assert.equal(report.readOnlyTools.includes("plan_thread_change"), true)
  assert.equal(report.readOnlyTools.includes("plan_message_forward"), true)
  assert.equal(report.readOnlyTools.includes("plan_role_creation"), true)
  assert.equal(report.readOnlyTools.includes("plan_role_configuration"), true)
  assert.equal(report.readOnlyTools.includes("plan_poll_creation"), true)
  assert.equal(report.readOnlyTools.includes("plan_poll_end"), true)
  assert.equal(report.destructiveTools.includes("execute_channel_creation"), false)
  assert.equal(report.destructiveTools.includes("execute_role_creation"), false)
  assert.equal(report.destructiveTools.includes("execute_attachment_message"), false)
  assert.equal(report.destructiveTools.includes("execute_forum_post"), false)
  assert.equal(report.destructiveTools.includes("execute_poll_creation"), false)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => smokeConnector({
      environment: environment(),
      service: toolServiceWithoutScopedGuilds(),
    }),
    /no accessible guilds/,
  )
})

test("MCP smoke validates voice-channel status policy without opening its Gateway", async () => {
  const report = await smokeConnector({
    environment: environment({
      DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES: "true",
      DISCORD_MCP_CHANNEL_METADATA_IDS: CHANNEL_ID,
    }),
    service: toolService(),
  })

  assert.equal(report.status, "ok")
  assert.equal(report.readOnlyTools.includes("get_voice_channel_status"), true)
  assert.equal(report.readOnlyTools.includes("plan_voice_channel_status_change"), true)
  assert.equal(
    report.promptNames.includes("review_voice_channel_status_change"),
    true,
  )
  assert.equal(
    report.resourceTemplateUris.includes(
      "discord://guilds/{guildId}/channels/{channelId}/voice-status",
    ),
    true,
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
