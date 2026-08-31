import {
  loadConnectorConfigDocument,
  type ConfigOptions,
  type ConnectorConfig,
} from "../src/config.js"
import {
  createConnectorConfigDocument,
  type ConnectorConfigDocument,
  type ConnectorCredentialReference,
} from "../src/config-document.js"
import {
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"

const FIXTURE_APPLICATION_ID = "900000000000000001"
const FIXTURE_BOT_ID = "900000000000000002"
const FIXTURE_GUILD_ID = "100000000000000001"

export interface FixtureConfigOverrides {
  capabilities?: ConnectorConfigDocument["capabilities"]
  credential?: ConnectorCredentialReference
  gateway?: Partial<ConnectorConfigDocument["gateway"]>
  identity?: Partial<ConnectorConfigDocument["identity"]>
  limits?: ConnectorConfigDocument["limits"]
  name?: string
  notifications?: Partial<ConnectorConfigDocument["notifications"]>
  observability?: ConnectorConfigDocument["observability"]
  readScope?: Partial<ConnectorConfigDocument["readScope"]>
  runtime?: ConnectorConfigDocument["runtime"]
  scopes?: ConnectorConfigDocument["scopes"]
  secretEnvironment?: NodeJS.ProcessEnv
  stateHome?: string
  storage?: ConnectorConfigDocument["storage"]
  threads?: Partial<ConnectorConfigDocument["threads"]>
  token?: string
  tools?: Partial<ConnectorConfigDocument["tools"]>
}

export interface FixtureConfigInput {
  document: ConnectorConfigDocument
  environment: NodeJS.ProcessEnv
}

export function fixtureConfigInput(
  overrides: FixtureConfigOverrides = {},
): FixtureConfigInput {
  const credential = overrides.credential ?? {
    provider: "environment",
    variable: DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
  }
  const document = createConnectorConfigDocument({
    applicationId: overrides.identity?.applicationId ?? FIXTURE_APPLICATION_ID,
    botId: overrides.identity?.botId ?? FIXTURE_BOT_ID,
    ...(overrides.capabilities === undefined
      ? {}
      : { capabilities: overrides.capabilities }),
    channelIds: overrides.readScope?.channelIds ?? [],
    ...(overrides.readScope?.channelMode === undefined
      ? {}
      : { readChannelMode: overrides.readScope.channelMode }),
    ...(credential.provider === "file"
      ? { credentialFile: credential.path }
      : { credentialVariable: credential.variable }),
    ...(overrides.gateway?.enabled === undefined
      ? {}
      : { gatewayEnabled: overrides.gateway.enabled }),
    ...(overrides.gateway?.eventBufferSize === undefined
      ? {}
      : { gatewayEventBufferSize: overrides.gateway.eventBufferSize }),
    guildIds: overrides.readScope?.guildIds ?? [FIXTURE_GUILD_ID],
    ...(overrides.readScope?.guildMode === undefined
      ? {}
      : { readGuildMode: overrides.readScope.guildMode }),
    ...(overrides.limits === undefined ? {} : { limits: overrides.limits }),
    name: overrides.name ?? "test-policy",
    ...(overrides.observability === undefined
      ? {}
      : { observability: overrides.observability }),
    ...(overrides.runtime === undefined ? {} : { runtime: overrides.runtime }),
    ...(overrides.scopes === undefined ? {} : { scopes: overrides.scopes }),
    ...(overrides.storage === undefined ? {} : { storage: overrides.storage }),
    ...(overrides.threads?.messageWrites === undefined
      ? {}
      : { threadMessageWriteMode: overrides.threads.messageWrites }),
    ...(overrides.threads?.reads === undefined
      ? {}
      : { threadReadMode: overrides.threads.reads }),
    toolsets: overrides.tools?.toolsets ?? MCP_TOOLSET_NAMES,
    toolSurface: overrides.tools?.surface ?? "full",
    ...(overrides.notifications?.userMentions === undefined
      ? {}
      : { userMentionMode: overrides.notifications.userMentions }),
  })
  const environment: NodeJS.ProcessEnv = {
    ...(credential.provider === "environment" && overrides.token !== undefined
      ? { [credential.variable]: overrides.token }
      : {}),
    ...(overrides.stateHome === undefined
      ? {}
      : { XDG_STATE_HOME: overrides.stateHome }),
    ...overrides.secretEnvironment,
  }
  return { document, environment }
}

export function loadFixtureConfig(
  overrides: FixtureConfigOverrides = {},
  options: ConfigOptions = {},
): ConnectorConfig {
  const fixture = fixtureConfigInput(overrides)
  return loadConnectorConfigDocument(
    fixture.document,
    fixture.environment,
    options,
  )
}
