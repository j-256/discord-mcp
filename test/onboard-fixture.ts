import {
  createBotInstallPlan,
  type BotInstallPlan,
} from "../src/bot-install.js"
import { createConnectorConfigDocument } from "../src/config-document.js"
import {
  CONNECTOR_NPX_ARGUMENTS,
  CONNECTOR_NPX_COMMAND,
  CONNECTOR_VERSION,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
} from "../src/constants.js"
import {
  createHostActivationPlan,
  type HostActivationPlan,
} from "../src/host-activation.js"
import type { OnboardCredentialAccess } from "../src/onboard.js"
import {
  createStdioLaunchDescriptor,
  OPERATOR_REPORT_SCHEMA_VERSION,
  type SetupReport,
  type SmokeReport,
} from "../src/operator.js"
import { getSetupPreset } from "../src/setup-presets.js"

export const ONBOARD_APPLICATION_ID = "100000000000000001"
export const ONBOARD_BOT_ID = "200000000000000001"
export const ONBOARD_GUILD_ID = "300000000000000001"
export const ONBOARD_TOKEN = "onboard-fixture-secret-token"

export interface OnboardFixture {
  readonly activation: HostActivationPlan
  readonly configFile: string
  readonly credentialAccess: OnboardCredentialAccess
  readonly document: ReturnType<typeof createConnectorConfigDocument>
  readonly install: BotInstallPlan
  readonly policyDisposition: "created"
  readonly setup: SetupReport
  readonly smoke: SmokeReport
}

export function onboardFixture(
  configFile = "/private/guildcontrol.json",
  credentialFile?: string,
): OnboardFixture {
  const preset = getSetupPreset("server-observer")
  const document = createConnectorConfigDocument({
    applicationId: ONBOARD_APPLICATION_ID,
    botId: ONBOARD_BOT_ID,
    ...(credentialFile
      ? { credentialFile }
      : { credentialVariable: DEFAULT_TOKEN_ENVIRONMENT_VARIABLE }),
    gatewayEnabled: false,
    guildIds: [ONBOARD_GUILD_ID],
    name: "guildcontrol",
    toolsets: preset.toolsets,
    toolSurface: preset.toolSurface,
  })
  const launch = createStdioLaunchDescriptor({
    applicationId: ONBOARD_APPLICATION_ID,
    args: [...CONNECTOR_NPX_ARGUMENTS, "serve"],
    botId: ONBOARD_BOT_ID,
    command: CONNECTOR_NPX_COMMAND,
    config: { document, file: configFile },
  })
  const setup: SetupReport = {
    applicationId: ONBOARD_APPLICATION_ID,
    botId: ONBOARD_BOT_ID,
    configBackupFile: null,
    configFile,
    configuredGuildCount: 1,
    credential: document.credential,
    installedGuildCount: 1,
    installedInScopeGuildCount: 1,
    launch,
    preset,
    profile: null,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: launch.serverName,
    status: "ok",
    toolsets: [...preset.toolsets],
    toolSurface: preset.toolSurface,
    unexpectedGuildCount: 0,
    warnings: [],
  }
  const smoke: SmokeReport = {
    applicationId: ONBOARD_APPLICATION_ID,
    botId: ONBOARD_BOT_ID,
    configuredGuildCount: 1,
    destructiveTools: [],
    installedGuildCount: 1,
    installedInScopeGuildCount: 1,
    missingConfiguredGuildCount: 0,
    promptNames: [],
    protocolVersion: "2026-07-28",
    readOnlyTools: [...preset.toolNames],
    resourceTemplateUris: [],
    resourceUris: [],
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: "guildcontrol",
    serverVersion: CONNECTOR_VERSION,
    status: "ok",
    toolCount: preset.toolNames.length,
    toolsets: [...preset.toolsets],
    toolSurface: preset.toolSurface,
    transport: "stdio",
    unexpectedGuildCount: 0,
    writeCapableTools: [],
  }
  const activation = createHostActivationPlan({
    document,
    launch,
    source: { file: configFile, kind: "config" },
  })
  return {
    activation,
    configFile,
    credentialAccess: credentialFile
      ? "protected-file"
      : "existing-environment",
    document,
    install: createBotInstallPlan({
      applicationId: ONBOARD_APPLICATION_ID,
      guildId: ONBOARD_GUILD_ID,
      preset: "server-observer",
    }),
    policyDisposition: "created",
    setup,
    smoke,
  }
}
