import { loadConnectorConfigDocument } from "../../src/config.js"
import { createConnectorConfigDocument } from "../../src/config-document.js"
import { runDiscordMcpServer } from "../../src/mcp.js"
import {
  BOT_INSTALLATION_AUDIT_PRIVACY,
  BOT_INSTALLATION_AUDIT_SCHEMA_VERSION,
} from "../../src/bot-installation-audit-service.js"
import {
  CONNECTOR_STATUS_PRIVACY,
  CONNECTOR_STATUS_SCHEMA_VERSION,
  ConnectorService,
} from "../../src/service.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const TOKEN_VARIABLE = "DISCORD_SMOKE_TOKEN"

if (process.env.UNRELATED_PRIVATE_VALUE !== undefined) {
  throw new Error("Spawned smoke received an unrelated environment value")
}
if (!process.env[TOKEN_VARIABLE]) {
  throw new Error("Spawned smoke did not receive its declared credential")
}

const document = createConnectorConfigDocument({
  applicationId: APPLICATION_ID,
  botId: BOT_ID,
  credentialVariable: TOKEN_VARIABLE,
  guildIds: [GUILD_ID],
  name: "spawned-smoke",
  toolsets: ["connector"],
  toolSurface: "full",
})
const config = loadConnectorConfigDocument(document, process.env)
if (config.token === "spawned-stdio-private-token") {
  process.stderr.write("x".repeat(20_000) + config.token)
  throw new Error("Synthetic spawned smoke startup failure")
}
const service = new ConnectorService({ config })
service.getStatus = async () => {
  return {
    application: {
      guildMembersIntent: "enabled",
      id: APPLICATION_ID,
      messageContentIntent: "enabled",
    },
    applicationPosture: {},
    bot: { id: BOT_ID },
    installationAudit: {
      completeness: {
        complete: true,
        maximumGuilds: 400,
        pageSize: 200,
        pagesRead: 1,
      },
      configuredGuildIds: [GUILD_ID],
      discardedGuildFieldCount: 2,
      drift: {
        detected: false,
        missingConfiguredGuildIds: [],
        unexpectedGuildIds: [],
      },
      identity: {
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
      },
      installedGuildIds: [GUILD_ID],
      installedInScopeGuildIds: [GUILD_ID],
      privacy: BOT_INSTALLATION_AUDIT_PRIVACY,
      schemaVersion: BOT_INSTALLATION_AUDIT_SCHEMA_VERSION,
      status: "complete",
    },
    policy: {},
    privacy: CONNECTOR_STATUS_PRIVACY,
    schemaVersion: CONNECTOR_STATUS_SCHEMA_VERSION,
    status: "ok",
    writeCoordination: {},
  } as unknown as Awaited<ReturnType<ConnectorService["getStatus"]>>
}

runDiscordMcpServer({
  config,
  environment: process.env,
  service,
})
