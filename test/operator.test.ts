import assert from "node:assert/strict"
import test from "node:test"

import { MCP_TOOLSET_NAMES } from "../src/constants.js"
import type { DiscordToolService } from "../src/mcp.js"
import {
  diagnoseConnector,
  DOCTOR_CHECK_IDS,
  prepareSetup,
  renderHostConfiguration,
  smokeConnector,
  type StatusProvider,
} from "../src/operator.js"
import type { ConnectorService } from "../src/service.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_ALLOWED_CHANNEL_IDS: CHANNEL_ID,
    DISCORD_MCP_ALLOWED_GUILD_IDS: GUILD_ID,
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    ...overrides,
  }
}

function status(
  inScope = 1,
  messageContentIntent: "disabled" | "enabled" | "unknown" = "enabled",
): Awaited<ReturnType<ConnectorService["getStatus"]>> {
  return {
    application: {
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
      channelCreationEnabled: false,
      channelCreationGuildIds: [],
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
      protectedUserCount: 0,
      readChannelScope: "allowlist",
      readGuildScope: "allowlist",
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
    deleteMessages: unexpected,
    describePolicy() {
      return status().policy
    },
    editOwnMessage: unexpected,
    executeChannelCreation: unexpected,
    executeMemberModeration: unexpected,
    explainChannelAccess: unexpected,
    getMessage: unexpected,
    async getStatus() {
      return status()
    },
    listActivity: unexpected,
    listActiveThreads: unexpected,
    listArchivedThreads: unexpected,
    listChannels: unexpected,
    listGuilds: unexpected,
    planMessageDeletion: unexpected,
    planChannelCreation: unexpected,
    planMemberModeration: unexpected,
    readMessages: unexpected,
    searchMessages: unexpected,
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

test("MCP host configuration uses verified identity and environment forwarding without secrets", () => {
  const result = renderHostConfiguration({
    applicationId: APPLICATION_ID,
    command: "/opt/Discord MCP/bin/discord-mcp",
    serverName: "team-discord",
  })

  assert.match(result, /\[mcp_servers\.team-discord\]/)
  assert.match(result, /command = "\/opt\/Discord MCP\/bin\/discord-mcp"/)
  assert.match(result, /args = \["serve"\]/)
  assert.match(result, /default_tools_approval_mode = "writes"/)
  assert.match(result, /required = true/)
  assert.match(result, /DISCORD_BOT_TOKEN/)
  assert.match(result, /DISCORD_MCP_ALLOW_ADMINISTRATION/)
  assert.match(result, /DISCORD_MCP_ADMIN_GUILD_IDS/)
  assert.match(result, /DISCORD_MCP_PROTECTED_USER_IDS/)
  assert.match(result, /DISCORD_MCP_ALLOW_CHANNEL_CREATION/)
  assert.match(result, /DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS/)
  assert.match(result, /DISCORD_MCP_ALLOW_GATEWAY/)
  assert.match(result, /DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE/)
  assert.match(result, /DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT/)
  assert.match(result, /DISCORD_MCP_OBSERVABILITY_LOGS/)
  assert.match(result, /OTEL_EXPORTER_OTLP_HEADERS/)
  assert.match(result, /OTEL_EXPORTER_OTLP_TRACES_ENDPOINT/)
  assert.match(result, /OTEL_EXPORTER_OTLP_METRICS_ENDPOINT/)
  assert.match(result, /OTEL_TRACES_SAMPLER/)
  assert.match(result, /DISCORD_MCP_TOOL_SURFACE/)
  assert.match(result, /DISCORD_MCP_TOOLSETS/)
  assert.match(result, new RegExp(APPLICATION_ID))
  assert.doesNotMatch(result, new RegExp(TOKEN))
  assert.throws(
    () => renderHostConfiguration({
      applicationId: APPLICATION_ID,
      serverName: "bad.name",
    }),
    /MCP server name/,
  )
  assert.throws(
    () => renderHostConfiguration({ applicationId: "not-a-snowflake" }),
    /snowflake/,
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
  assert.equal(report.applicationId, APPLICATION_ID)
  assert.equal(report.botId, BOT_ID)
  assert.equal(report.serverName, "discord-safe")
  assert.equal(report.toolSurface, "full")
  assert.deepEqual(report.toolsets, MCP_TOOLSET_NAMES)
  assert.match(report.hostConfig, /args = \["\/srv\/discord-mcp\/dist\/cli\.js", "serve"\]/)
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

test("MCP smoke negotiates the adapter, validates risk annotations, and calls status only", async () => {
  const report = await smokeConnector({
    environment: environment(),
    service: toolService(),
  })

  assert.equal(report.status, "ok")
  assert.equal(report.applicationId, APPLICATION_ID)
  assert.equal(report.botId, BOT_ID)
  assert.equal(report.toolCount, 23)
  assert.equal(report.toolSurface, "full")
  assert.deepEqual(report.toolsets, MCP_TOOLSET_NAMES)
  assert.deepEqual(report.promptNames, [
    "review_channel_creation",
    "review_member_moderation",
    "review_message_deletion",
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
    "discord://guilds/{guildId}/channels",
  ])
  assert.deepEqual(report.destructiveTools, [
    "delete_messages",
    "edit_own_message",
    "execute_member_moderation",
  ])
  assert.equal(report.readOnlyTools.includes("get_connector_status"), true)
  assert.equal(report.readOnlyTools.includes("get_observability_status"), true)
  assert.equal(report.readOnlyTools.includes("discover_discord_tools"), true)
  assert.equal(report.readOnlyTools.includes("plan_channel_creation"), true)
  assert.equal(report.destructiveTools.includes("execute_channel_creation"), false)
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
