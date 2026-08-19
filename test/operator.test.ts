import assert from "node:assert/strict"
import test from "node:test"

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
      allowedChannelIds: [CHANNEL_ID],
      allowedGuildIds: [GUILD_ID],
      deleteChannelIds: [],
      deletionsEnabled: false,
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
    deleteMessages: unexpected,
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
    readMessages: unexpected,
    searchMessages: unexpected,
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
  assert.equal(report.toolCount, 12)
  assert.deepEqual(report.destructiveTools, ["delete_messages"])
  assert.equal(report.readOnlyTools.includes("get_connector_status"), true)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN))

  await assert.rejects(
    () => smokeConnector({
      environment: environment(),
      service: toolServiceWithoutScopedGuilds(),
    }),
    /no accessible guilds/,
  )
})
