import { loadConnectorConfigDocument } from "../../src/config.js"
import { createConnectorConfigDocument } from "../../src/config-document.js"
import { runDiscordMcpServer } from "../../src/mcp.js"
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
    guildPage: { accessible: 1, inScope: 1 },
    policy: {},
    privacy: CONNECTOR_STATUS_PRIVACY,
    schemaVersion: CONNECTOR_STATUS_SCHEMA_VERSION,
    status: "ok",
    writeCoordination: {},
  } as Awaited<ReturnType<ConnectorService["getStatus"]>>
}

runDiscordMcpServer({
  config,
  environment: process.env,
  service,
})
