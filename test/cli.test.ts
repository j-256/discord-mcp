import assert from "node:assert/strict"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  parseCliArguments,
  runCli,
  type CliDependencies,
} from "../src/cli.js"
import { createBotInstallPlan } from "../src/bot-install.js"
import type { DiscordCatalogCheckReport } from "../src/catalog.js"
import {
  CATALOG_HTML_FORMAT,
  type DiscordCatalogHtmlExportReport,
} from "../src/catalog-html.js"
import {
  CONFIG_OPERATOR_REPORT_SCHEMA_VERSION,
  explainConnectorConfig,
  summarizeConnectorConfigDocument,
  writeConnectorConfigDocumentFile,
  type ConfigShowReport,
  type ConfigValidationReport,
  type ConfigWriteReport,
} from "../src/config-operator.js"
import {
  CONFIG_RECIPE_REPORT_SCHEMA_VERSION,
  CONFIG_RECIPES,
  applyConfigRecipe,
  getConfigRecipe,
  planConfigRecipe,
} from "../src/config-recipes.js"
import {
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
} from "../src/config-document.js"
import { loadConnectorConfigDocument } from "../src/config.js"
import {
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
} from "../src/constants.js"
import {
  ConfigDocumentError,
  ConfigurationError,
  DiscordApiError,
  ProfileError,
} from "../src/errors.js"
import {
  OPERATOR_REPORT_SCHEMA_VERSION,
  type DoctorReport,
  type SetupReport,
  type SmokeReport,
} from "../src/operator.js"
import {
  createConnectorProfile,
  type ConnectorProfile,
} from "../src/profile.js"
import { getSetupPreset } from "../src/setup-presets.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const CONFIG_FILE = "/configuration/discord-mcp.json"

function outputStream() {
  let output = ""
  return {
    stream: {
      write(value: string | Uint8Array) {
        output += String(value)
        return true
      },
    },
    value() {
      return output
    },
  }
}

function doctorReport(status: DoctorReport["status"] = "ok"): DoctorReport {
  const checkStatus = status === "error"
    ? "fail"
    : status === "warning"
      ? "warn"
      : "pass"
  return {
    checks: [{
      ...(checkStatus === "pass"
        ? {}
        : {
          action: "Correct the diagnostic boundary.",
          reference: "docs/reference.md#verification",
        }),
      id: "configuration",
      status: checkStatus,
      summary: status === "error"
        ? `Rejected ${TOKEN}`
        : status === "warning"
          ? "Configuration needs review"
          : "Configuration is valid",
    }],
    identity: null,
    online: false,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status,
  }
}

function setupReport(): SetupReport {
  const configFile = "/configuration/discord-mcp.json"
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    configBackupFile: null,
    configFile,
    credential: {
      provider: "environment",
      variable: DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
    },
    guildsAccessibleOnFirstPage: 1,
    guildsInScopeOnFirstPage: 1,
    launch: {
      args: ["serve", "--config", configFile],
      command: "discord-mcp",
      environment: {
        forward: ["DISCORD_BOT_TOKEN"],
        set: {},
      },
      requirements: {
        elicitation: "required-for-reviewed-writes",
        requiredServer: true,
        toolApproval: "writes",
      },
      secrets: {
        environmentVariables: ["DISCORD_BOT_TOKEN"],
        files: [],
      },
      serverName: "discord",
      timeouts: {
        startupSeconds: 30,
        toolSeconds: 180,
      },
      transport: "stdio",
    },
    preset: null,
    profile: null,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: "discord",
    status: "ok",
    toolsets: ["connector", "messages"],
    toolSurface: "full",
    warnings: [],
  }
}

function smokeReport(): SmokeReport {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    destructiveTools: ["delete_messages"],
    guildsAccessibleOnFirstPage: 1,
    guildsInScopeOnFirstPage: 1,
    promptNames: ["summarize_channel"],
    readOnlyTools: ["get_connector_status"],
    resourceTemplateUris: ["discord://channels/{channelId}/access"],
    resourceUris: ["discord://connector/safety"],
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
    toolCount: 12,
    toolsets: ["connector", "messages"],
    toolSurface: "full",
  }
}

function catalogReport(): DiscordCatalogCheckReport {
  return {
    activityRecordsCreated: false,
    contractDigest: `sha256:${"a".repeat(64)}`,
    credentialsRequired: false,
    discordExecution: "disabled",
    evidenceFormat: "discord-mcp.catalog-evidence.v1",
    executionGuard: "CATALOG_ONLY",
    gateway: "disabled",
    observabilityExport: "disabled",
    promptCount: 2,
    promptNames: ["review_change", "summarize_channel"],
    resourceCount: 2,
    resourceTemplateCount: 1,
    resourceTemplateUris: ["discord://channels/{channelId}"],
    resourceUris: ["discord://connector/policy", "discord://connector/safety"],
    restMethodCounts: {
      DELETE: 1,
      GET: 2,
      PATCH: 1,
      POST: 1,
      PUT: 1,
    },
    restOperationCount: 6,
    riskClassCounts: {
      "administrative-write": 0,
      "destructive-write": 1,
      "discord-read": 1,
      "interaction-write": 0,
      "local-read": 1,
    },
    safetyResourceDigest: `sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    serverName: "discord-mcp",
    serverVersion: "0.1.0",
    status: "ok",
    toolCount: 3,
    toolNames: ["delete_messages", "discover_discord_tools", "read_messages"],
    toolsetNames: ["deletion", "messages"],
  }
}

function catalogHtmlReport(file = "/output/discord-mcp-catalog.html"): DiscordCatalogHtmlExportReport {
  return {
    activityRecordsCreated: false,
    bytes: 12345,
    contractDigest: `sha256:${"a".repeat(64)}`,
    credentialsRequired: false,
    discordExecution: "disabled",
    file,
    format: CATALOG_HTML_FORMAT,
    schemaVersion: 1,
    status: "ok",
    toolCount: 3,
  }
}

function connectorProfile(options: { auditFile?: string } = {}): ConnectorProfile {
  return createConnectorProfile({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "support-bot",
    ...(options.auditFile ? { storage: { auditFile: options.auditFile } } : {}),
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
}

function configValidationReport(
  profile: ConnectorProfile = connectorProfile(),
): ConfigValidationReport {
  if (profile.schemaVersion !== 2) throw new Error("Expected schema-v2 profile")
  return {
    file: "/configuration/discord-mcp.json",
    schemaVersion: CONFIG_OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
    summary: summarizeConnectorConfigDocument(profile),
    validation: {
      crossFieldPolicy: true,
      discordContacted: false,
      secretValuesRead: false,
    },
  }
}

function configShowReport(
  profile: ConnectorProfile = connectorProfile(),
): ConfigShowReport {
  if (profile.schemaVersion !== 2) throw new Error("Expected schema-v2 profile")
  return {
    ...configValidationReport(profile),
    document: profile,
  }
}

function configWriteReport(): ConfigWriteReport {
  return {
    ...configShowReport(),
    action: "init",
    created: true,
    source: "new",
  }
}

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  const profile = connectorProfile()
  return {
    async activateProfile(_name, options) {
      return {
        config: loadConnectorConfigDocument(profile, {
          ...options.environment,
          [TOKEN_ALIAS]: TOKEN,
        }),
        profile,
      }
    },
    applyRecipe: applyConfigRecipe,
    catalog() {},
    async checkCatalog() {
      return catalogReport()
    },
    async exportCatalogHtml(file) {
      return catalogHtmlReport(file)
    },
    async diagnose() {
      return doctorReport()
    },
    explainConfig(path) {
      return explainConnectorConfig(path)
    },
    async initializeConfig() {
      return configWriteReport()
    },
    async listCoordination() {
      return { claims: [], schemaVersion: 1, status: "ok" }
    },
    async listProfiles() {
      return [profile]
    },
    loadConfig(environment) {
      const credentialVariable = environment[TOKEN_ALIAS]
        ? TOKEN_ALIAS
        : DEFAULT_TOKEN_ENVIRONMENT_VARIABLE
      const source = {
        ...environment,
        [credentialVariable]: environment[credentialVariable] || TOKEN,
      }
      return loadConnectorConfigDocument({
        ...profile,
        credential: {
          provider: "environment",
          variable: credentialVariable,
        },
      }, source)
    },
    loadConfigDocument() {
      return profile
    },
    async loadProfile() {
      return profile
    },
    async prepareSetup() {
      return setupReport()
    },
    planRecipe: planConfigRecipe,
    async resolveCoordination(_environment, claimId) {
      return {
        claimId,
        releasedTargetCount: 1,
        schemaVersion: 1,
        status: "resolved",
      }
    },
    async restoreProfile(name) {
      return { name, trashId: "0000000000000-restored" }
    },
    serve() {},
    async smoke() {
      return smokeReport()
    },
    showConfig() {
      return configShowReport()
    },
    async trashProfile(name) {
      return { name, trashId: "0000000000000-removed" }
    },
    validateConfig() {
      return configValidationReport()
    },
    ...overrides,
  }
}

test("CLI parser defaults to serve and strictly parses operator commands", () => {
  assert.deepEqual(parseCliArguments([]), { command: "serve" })
  assert.deepEqual(parseCliArguments(["catalog"]), {
    check: false,
    command: "catalog",
    json: false,
  })
  assert.deepEqual(parseCliArguments(["catalog", "--check", "--json"]), {
    check: true,
    command: "catalog",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["catalog", "--html", "./catalog.html"]), {
    check: false,
    command: "catalog",
    htmlFile: "./catalog.html",
    json: false,
  })
  assert.deepEqual(parseCliArguments(["catalog", "--html", "./catalog.html", "--check"]), {
    check: true,
    command: "catalog",
    htmlFile: "./catalog.html",
    json: false,
  })
  assert.deepEqual(parseCliArguments([
    "coordination",
    "list",
    "--config",
    "/configuration/discord.json",
    "--json",
  ]), {
    action: "list",
    command: "coordination",
    configFile: "/configuration/discord.json",
    json: true,
  })
  assert.deepEqual(parseCliArguments([
    "coordination",
    "resolve",
    `claim_${"a".repeat(32)}`,
    "--confirm",
    `claim_${"a".repeat(32)}`,
    "--profile",
    "support-bot",
  ]), {
    action: "resolve",
    claimId: `claim_${"a".repeat(32)}`,
    command: "coordination",
    confirmation: `claim_${"a".repeat(32)}`,
    json: false,
    profileName: "support-bot",
  })
  assert.deepEqual(parseCliArguments(["doctor", "--online", "--json"]), {
    command: "doctor",
    json: true,
    online: true,
  })
  assert.deepEqual(parseCliArguments(["doctor", "--profile", "support-bot"]), {
    command: "doctor",
    json: false,
    online: false,
    profileName: "support-bot",
  })
  assert.deepEqual(parseCliArguments(["serve", "--profile", "support-bot"]), {
    command: "serve",
    profileName: "support-bot",
  })
  assert.deepEqual(parseCliArguments(["serve", "--config", "/configuration/discord.json"]), {
    command: "serve",
    configFile: "/configuration/discord.json",
  })
  assert.deepEqual(parseCliArguments([
    "config",
    "init",
    "/configuration/discord.json",
    "--name",
    "support-bot",
    "--application-id",
    APPLICATION_ID,
    "--bot-id",
    BOT_ID,
    "--guild-id",
    GUILD_ID,
    "--channel-id",
    CHANNEL_ID,
    "--preset",
    "channel-reader",
    "--token-env",
    TOKEN_ALIAS,
    "--json",
  ]), {
    action: "init",
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    command: "config",
    credentialVariable: TOKEN_ALIAS,
    file: "/configuration/discord.json",
    guildIds: [GUILD_ID],
    json: true,
    name: "support-bot",
    overwrite: false,
    preset: "channel-reader",
  })
  assert.deepEqual(parseCliArguments([
    "config",
    "init",
    "/configuration/discord.json",
    "--name",
    "support-bot",
    "--application-id",
    APPLICATION_ID,
    "--bot-id",
    BOT_ID,
    "--guild-id",
    GUILD_ID,
    "--token-file",
    "/run/secrets/discord_bot_token",
  ]), {
    action: "init",
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [],
    command: "config",
    credentialFile: "/run/secrets/discord_bot_token",
    file: "/configuration/discord.json",
    guildIds: [GUILD_ID],
    json: false,
    name: "support-bot",
    overwrite: false,
  })
  assert.deepEqual(parseCliArguments([
    "config",
    "validate",
    "/configuration/discord.json",
  ]), {
    action: "validate",
    command: "config",
    file: "/configuration/discord.json",
    json: false,
  })
  assert.deepEqual(parseCliArguments([
    "config",
    "explain",
    "capabilities.deletions",
    "--json",
  ]), {
    action: "explain",
    command: "config",
    json: true,
    path: "capabilities.deletions",
  })
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--name",
      "team-discord",
      "--command",
      "/usr/local/bin/discord-mcp",
    ]),
    /requires --config FILE or --profile NAME/,
  )
  assert.deepEqual(parseCliArguments([
    "setup",
    "--profile",
    "support-bot",
    "--preset",
    "server-observer",
    "--guild-id",
    GUILD_ID,
    "--token-env",
    TOKEN_ALIAS,
    "--force",
    "--json",
  ]), {
    command: "setup",
    credentialVariable: TOKEN_ALIAS,
    json: true,
    launcherCommand: undefined,
    overwrite: true,
    preset: {
      channelIds: [],
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    profileName: "support-bot",
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments([
    "setup",
    "--config",
    "/configuration/discord.json",
    "--preset",
    "server-observer",
    "--guild-id",
    GUILD_ID,
    "--token-env",
    TOKEN_ALIAS,
    "--force",
  ]), {
    command: "setup",
    configFile: "/configuration/discord.json",
    credentialVariable: TOKEN_ALIAS,
    json: false,
    launcherCommand: undefined,
    overwrite: true,
    preset: {
      channelIds: [],
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments([
    "setup",
    "--profile",
    "reader",
    "--preset",
    "CHANNEL-READER",
    "--guild-id",
    GUILD_ID,
    "--guild-id",
    "300000000000000002",
    "--channel-id",
    CHANNEL_ID,
    "--channel-id",
    "400000000000000002",
  ]), {
    command: "setup",
    json: false,
    launcherCommand: undefined,
    overwrite: false,
    preset: {
      channelIds: [CHANNEL_ID, "400000000000000002"],
      guildIds: [GUILD_ID, "300000000000000002"],
      name: "channel-reader",
    },
    profileName: "reader",
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments(["preset", "list", "--json"]), {
    action: "list",
    command: "preset",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["preset", "show", "server-observer"]), {
    action: "show",
    command: "preset",
    json: false,
    name: "server-observer",
  })
  assert.deepEqual(parseCliArguments([
    "preset",
    "install",
    "CHANNEL-READER",
    "--application-id",
    APPLICATION_ID,
    "--guild-id",
    GUILD_ID,
    "--json",
  ]), {
    action: "install",
    applicationId: APPLICATION_ID,
    command: "preset",
    guildId: GUILD_ID,
    json: true,
    name: "channel-reader",
  })
  assert.deepEqual(parseCliArguments(["recipe", "list", "--json"]), {
    action: "list",
    command: "recipe",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["recipe", "show", "GUILD-BUILDER"]), {
    action: "show",
    command: "recipe",
    json: false,
    name: "guild-builder",
  })
  assert.deepEqual(parseCliArguments([
    "recipe",
    "plan",
    "guild-builder",
    "/configuration/discord.json",
    "--guild-id",
    GUILD_ID,
    "--json",
  ]), {
    action: "plan",
    channelIds: [],
    command: "recipe",
    file: "/configuration/discord.json",
    guildIds: [GUILD_ID],
    json: true,
    name: "guild-builder",
  })
  const recipeDigest = `sha256:${"a".repeat(64)}`
  assert.deepEqual(parseCliArguments([
    "recipe",
    "apply",
    "CHANNEL-PUBLISHER",
    "/configuration/discord.json",
    "--channel-id",
    CHANNEL_ID,
    "--plan-digest",
    recipeDigest,
    "--confirm",
    "channel-publisher",
  ]), {
    action: "apply",
    channelIds: [CHANNEL_ID],
    command: "recipe",
    confirmation: "channel-publisher",
    file: "/configuration/discord.json",
    guildIds: [],
    json: false,
    name: "channel-publisher",
    planDigest: recipeDigest,
  })
  assert.deepEqual(parseCliArguments(["profile", "list", "--json"]), {
    action: "list",
    command: "profile",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["profile", "show", "support-bot"]), {
    action: "show",
    command: "profile",
    json: false,
    name: "support-bot",
  })
  assert.deepEqual(parseCliArguments([
    "profile",
    "remove",
    "support-bot",
    "--confirm",
    "support-bot",
  ]), {
    action: "remove",
    command: "profile",
    confirmation: "support-bot",
    json: false,
    name: "support-bot",
  })
  assert.deepEqual(parseCliArguments(["smoke", "--help"]), {
    command: "help",
    topic: "smoke",
  })
  assert.throws(() => parseCliArguments(["unknown"]), /Unknown command/)
  assert.throws(() => parseCliArguments(["doctor", "--online", "--online"]), /only once/)
  assert.throws(
    () => parseCliArguments([
      "serve",
      "--config",
      "/configuration/discord.json",
      "--profile",
      "support-bot",
    ]),
    /mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments(["config", "migrate", "/configuration/discord.json"]),
    /config requires explain, init, show, or validate/,
  )
  assert.throws(
    () => parseCliArguments(["setup", "--client", "legacy"]),
    /Unknown option --client/,
  )
  assert.throws(() => parseCliArguments(["setup", "--name"]), /requires a value/)
  assert.throws(
    () => parseCliArguments(["setup", "--token-env", TOKEN_ALIAS]),
    /requires --config FILE or --profile NAME/,
  )
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--config",
      "/configuration/discord.json",
      "--preset",
      "server-observer",
      "--guild-id",
      GUILD_ID,
      "--token-env",
      TOKEN_ALIAS,
      "--token-file",
      "/run/secrets/discord_bot_token",
    ]),
    /--token-file and --token-env are mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--config",
      "/configuration/discord.json",
      "--profile",
      "support-bot",
    ]),
    /mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--profile",
      "reader",
      "--guild-id",
      GUILD_ID,
    ]),
    /require --preset/,
  )
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--config",
      "/configuration/discord.json",
      "--force",
    ]),
    /require --preset/,
  )
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--profile",
      "reader",
      "--preset",
      "channel-reader",
      "--guild-id",
      GUILD_ID,
    ]),
    /requires at least one --channel-id/,
  )
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--profile",
      "reader",
      "--preset",
      "unknown",
      "--guild-id",
      GUILD_ID,
    ]),
    /Setup preset must be one of/,
  )
  assert.throws(() => parseCliArguments(["preset"]), /requires install, list, or show/)
  assert.throws(() => parseCliArguments(["recipe"]), /requires apply, list, plan, or show/)
  assert.throws(
    () => parseCliArguments([
      "recipe",
      "plan",
      "guild-builder",
      "/configuration/discord.json",
      "--channel-id",
      CHANNEL_ID,
    ]),
    /accepts --guild-id, not --channel-id/,
  )
  assert.throws(
    () => parseCliArguments([
      "recipe",
      "apply",
      "channel-publisher",
      "/configuration/discord.json",
      "--channel-id",
      CHANNEL_ID,
      "--confirm",
      "channel-publisher",
    ]),
    /requires --plan-digest/,
  )
  assert.throws(
    () => parseCliArguments([
      "recipe",
      "plan",
      "channel-publisher",
      "/configuration/discord.json",
      "--channel-id",
      CHANNEL_ID,
      "--confirm",
      "channel-publisher",
    ]),
    /Unknown option --confirm/,
  )
  assert.throws(
    () => parseCliArguments(["preset", "install", "server-observer"]),
    /requires --application-id/,
  )
  assert.throws(
    () => parseCliArguments([
      "preset",
      "install",
      "server-observer",
      "--application-id",
      APPLICATION_ID,
    ]),
    /requires --guild-id/,
  )
  assert.throws(
    () => parseCliArguments([
      "preset",
      "install",
      "server-observer",
      "--application-id",
      "0",
      "--guild-id",
      GUILD_ID,
    ]),
    /Application ID must be a Discord snowflake/,
  )
  assert.throws(
    () => parseCliArguments([
      "preset",
      "install",
      "server-observer",
      "--application-id",
      APPLICATION_ID,
      "--application-id",
      APPLICATION_ID,
      "--guild-id",
      GUILD_ID,
    ]),
    /Option --application-id may be provided only once/,
  )
  assert.throws(
    () => parseCliArguments(["profile", "remove", "support-bot"]),
    /requires --confirm/,
  )
  assert.throws(
    () => parseCliArguments(["serve", "--profile"]),
    /requires a value/,
  )
  assert.throws(() => parseCliArguments(["smoke", "--other"]), /Unknown option/)
  assert.throws(() => parseCliArguments(["catalog", "--json"]), /requires --check/)
  assert.throws(() => parseCliArguments(["catalog", "--check", "--check"]), /only once/)
  assert.throws(() => parseCliArguments(["catalog", "--html"]), /requires a file path/)
  assert.throws(
    () => parseCliArguments(["catalog", "--html", "catalog.html", "--json"]),
    /mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments(["config", "explain", "--migration"]),
    /Unknown option --migration/,
  )
  assert.throws(() => parseCliArguments(["coordination"]), /requires list or resolve/)
  assert.throws(
    () => parseCliArguments(["coordination", "resolve", `claim_${"a".repeat(32)}`]),
    /requires --confirm/,
  )
})

test("CLI defaults to the stdio server through the selected config without writing normal output", async () => {
  let serves = 0
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: [],
    dependencies: dependencies({
      serve() {
        serves += 1
      },
    }),
    environment: {
      [CONFIG_FILE_ENVIRONMENT_VARIABLE]: CONFIG_FILE,
      DISCORD_BOT_TOKEN: `  ${TOKEN}  `,
    },
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(serves, 1)
  assert.equal(stdout.value(), "")
  assert.equal(stderr.value(), "")
})

test("CLI rejects operational commands without a config or schema-v2 profile", async () => {
  const stderr = outputStream()
  const stdout = outputStream()
  let serves = 0
  const exitCode = await runCli({
    args: [],
    dependencies: dependencies({
      serve() {
        serves += 1
      },
    }),
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 1)
  assert.equal(serves, 0)
  assert.match(stderr.value(), /Operational commands require --config FILE/)
  assert.doesNotMatch(stderr.value(), /config migrate/)
  assert.doesNotMatch(stderr.value(), new RegExp(TOKEN))

  assert.equal(await runCli({
    args: ["doctor", "--json"],
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: stdout.stream,
  }), 2)
  const report = JSON.parse(stdout.value())
  assert.equal(report.error.category, "configuration")
  assert.match(report.error.recovery.action, /config init/)
  assert.doesNotMatch(report.error.recovery.action, /config migrate/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI starts the credential-free catalog without normal output or configuration", async () => {
  let catalogs = 0
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["catalog"],
    dependencies: dependencies({
      catalog() {
        catalogs += 1
      },
    }),
    environment: {},
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(catalogs, 1)
  assert.equal(stdout.value(), "")
  assert.equal(stderr.value(), "")
})

test("CLI renders credential-free catalog checks as exact text and JSON", async () => {
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const htmlOutput = outputStream()
  const htmlFile = "/output/release-contract.html"

  assert.equal(await runCli({
    args: ["catalog", "--check"],
    dependencies: dependencies(),
    environment: {},
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["catalog", "--check", "--json"],
    dependencies: dependencies(),
    environment: {},
    stdout: jsonOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["catalog", "--html", htmlFile],
    dependencies: dependencies({
      async exportCatalogHtml(file) {
        assert.equal(file, htmlFile)
        return catalogHtmlReport(file)
      },
    }),
    environment: {},
    stdout: htmlOutput.stream,
  }), 0)

  assert.match(textOutput.value(), /Discord MCP catalog: ok/)
  assert.match(textOutput.value(), /Contract digest: sha256:[a-f0-9]{64}/)
  assert.match(textOutput.value(), /Risk classes: administrative-write=0/)
  assert.match(textOutput.value(), /Discord REST operations: 6/)
  assert.match(textOutput.value(), /Execution guard: CATALOG_ONLY/)
  assert.match(textOutput.value(), /Credentials required: no/)
  assert.deepEqual(JSON.parse(jsonOutput.value()), catalogReport())
  assert.match(htmlOutput.value(), /Discord MCP catalog HTML: ok/)
  assert.match(htmlOutput.value(), new RegExp(htmlFile))
  assert.match(htmlOutput.value(), new RegExp(CATALOG_HTML_FORMAT))
  assert.match(htmlOutput.value(), /Credentials required: no/)
  assert.match(htmlOutput.value(), /Discord execution: disabled/)
})

test("CLI inspects and resolves coordination without credentials or Discord access", async () => {
  const claimId = `claim_${"a".repeat(32)}`
  const activityFile = "/test/discord-mcp-cli-activity.jsonl"
  const environment = {}
  const events: string[] = []
  const listOutput = outputStream()
  const resolveOutput = outputStream()
  const coordinationDependencies = dependencies({
    async listCoordination(receivedActivityFile) {
      assert.equal(receivedActivityFile, activityFile)
      events.push("list")
      return {
        claims: [{
          claimId,
          createdAt: "2026-08-22T00:00:00.000Z",
          kind: "channel-metadata-change",
          operationKeyHash: `sha256:${"b".repeat(64)}`,
          ownerPid: 1234,
          ownerState: "dead",
          planDigest: `hmac-sha256:${"c".repeat(64)}`,
          publishedTargetCount: 1,
          receiptState: "pending",
          schemaVersion: 1,
          state: "review-required",
          targets: [{ id: CHANNEL_ID, kind: "channel" }],
        }],
        schemaVersion: 1,
        status: "ok",
      }
    },
    async resolveCoordination(receivedActivityFile, receivedClaimId, confirmation) {
      assert.equal(receivedActivityFile, activityFile)
      assert.equal(receivedClaimId, claimId)
      assert.equal(confirmation, claimId)
      events.push("resolve")
      return {
        claimId,
        releasedTargetCount: 1,
        schemaVersion: 1,
        status: "resolved",
      }
    },
    showConfig() {
      return configShowReport(connectorProfile({ auditFile: activityFile }))
    },
  })

  assert.equal(await runCli({
    args: ["coordination", "list", "--config", CONFIG_FILE],
    dependencies: coordinationDependencies,
    environment,
    stdout: listOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [
      "coordination",
      "resolve",
      claimId,
      "--confirm",
      claimId,
      "--config",
      CONFIG_FILE,
      "--json",
    ],
    dependencies: coordinationDependencies,
    environment,
    stdout: resolveOutput.stream,
  }), 0)

  assert.match(listOutput.value(), new RegExp(`${claimId}: review-required`))
  assert.match(listOutput.value(), /Receipt: pending/)
  assert.deepEqual(JSON.parse(resolveOutput.value()), {
    claimId,
    releasedTargetCount: 1,
    schemaVersion: 1,
    status: "resolved",
  })
  assert.deepEqual(events, ["list", "resolve"])
})

test("CLI coordination inspection uses selected policy without resolving credentials", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-cli-coordination-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const stdout = outputStream()
  const stderr = outputStream()
  const claimId = `claim_${"f".repeat(32)}`
  const activityFile = join(root, "activity.jsonl")
  const configFile = join(root, "discord-mcp.json")
  const profile = connectorProfile({ auditFile: activityFile })
  assert.equal(profile.schemaVersion, 2)
  await writeConnectorConfigDocumentFile(configFile, profile)

  assert.equal(await runCli({
    args: ["coordination", "list", "--config", configFile, "--json"],
    environment: {},
    stdout: stdout.stream,
  }), 0)
  assert.deepEqual(JSON.parse(stdout.value()), {
    claims: [],
    schemaVersion: 1,
    status: "ok",
  })
  assert.equal(await runCli({
    args: [
      "coordination",
      "resolve",
      claimId,
      "--confirm",
      claimId,
      "--config",
      configFile,
    ],
    environment: {},
    stderr: stderr.stream,
  }), 2)
  assert.match(stderr.value(), /Discord write claim was not found/)
  assert.doesNotMatch(stderr.value(), new RegExp(TOKEN))
})

test("CLI returns diagnostic failure while preserving secret-free JSON", async () => {
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["doctor", "--json"],
    dependencies: dependencies({
      async diagnose() {
        return doctorReport("error")
      },
    }),
    environment: {
      [CONFIG_FILE_ENVIRONMENT_VARIABLE]: CONFIG_FILE,
      DISCORD_BOT_TOKEN: `  ${TOKEN}  `,
    },
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 2)
  assert.match(stdout.value(), /\[redacted\]/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.equal(stderr.value(), "")
})

test("CLI doctor reports an unavailable selected credential without aborting diagnostics", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-cli-doctor-missing-secret-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const configFile = join(root, "discord-mcp.json")
  await writeConnectorConfigDocumentFile(
    configFile,
    createConnectorConfigDocument({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      credentialVariable: TOKEN_ALIAS,
      guildIds: [GUILD_ID],
      name: "doctor-missing-secret",
      toolsets: ["connector", "guilds"],
      toolSurface: "full",
    }),
  )
  const stdout = outputStream()
  const stderr = outputStream()

  assert.equal(await runCli({
    args: ["doctor", "--config", configFile, "--json"],
    environment: {},
    nodeVersion: "22.14.0",
    stderr: stderr.stream,
    stdout: stdout.stream,
  }), 2)

  const report = JSON.parse(stdout.value()) as DoctorReport
  assert.equal(stderr.value(), "")
  assert.equal(report.status, "error")
  assert.equal(
    report.checks.find((entry) => entry.id === "token")?.status,
    "fail",
  )
  assert.equal(
    report.checks.find((entry) => entry.id === "configuration")?.status,
    "pass",
  )
  assert.equal("error" in report, false)
  assert.doesNotMatch(stdout.value(), /DISCORD_MCP_DOCTOR_TOKEN|credential-unavailable/)
})

test("CLI doctor turns an unreadable selected document into a diagnostic report", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-cli-doctor-invalid-config-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const configFile = join(root, "discord-mcp.json")
  await writeFile(configFile, "{invalid-json}\n")
  const stdout = outputStream()
  const stderr = outputStream()

  assert.equal(await runCli({
    args: ["doctor", "--config", configFile, "--json"],
    environment: {},
    nodeVersion: "22.14.0",
    stderr: stderr.stream,
    stdout: stdout.stream,
  }), 2)

  const report = JSON.parse(stdout.value()) as DoctorReport
  assert.equal(stderr.value(), "")
  assert.equal(report.status, "error")
  assert.equal(
    report.checks.find((entry) => entry.id === "token")?.status,
    "fail",
  )
  assert.match(
    report.checks.find((entry) => entry.id === "token")?.summary || "",
    /could not be inspected/,
  )
  assert.equal(
    report.checks.find((entry) => entry.id === "configuration")?.status,
    "fail",
  )
  assert.equal("error" in report, false)
  assert.match(
    report.checks.find((entry) => entry.id === "configuration")?.summary || "",
    /valid JSON/,
  )
})

test("CLI distinguishes doctor warnings and renders their recovery guidance", async () => {
  const stdout = outputStream()
  const exitCode = await runCli({
    args: ["doctor"],
    dependencies: dependencies({
      async diagnose() {
        return doctorReport("warning")
      },
    }),
    environment: { [CONFIG_FILE_ENVIRONMENT_VARIABLE]: CONFIG_FILE },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 1)
  assert.match(stdout.value(), /WARN configuration: Configuration needs review/)
  assert.match(stdout.value(), /Next: Correct the diagnostic boundary/)
  assert.match(stdout.value(), /See: docs\/reference\.md#verification/)
})

test("CLI emits a redacted structured failure when JSON was requested", async () => {
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["smoke", "--json"],
    dependencies: dependencies({
      async smoke() {
        throw new ConfigurationError(`Configuration exposed ${TOKEN}`)
      },
    }),
    environment: {
      [CONFIG_FILE_ENVIRONMENT_VARIABLE]: CONFIG_FILE,
      DISCORD_BOT_TOKEN: TOKEN,
    },
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  const report = JSON.parse(stdout.value())
  assert.equal(exitCode, 2)
  assert.equal(stderr.value(), "")
  assert.equal(report.status, "error")
  assert.equal(report.schemaVersion, OPERATOR_REPORT_SCHEMA_VERSION)
  assert.equal(report.error.category, "configuration")
  assert.equal(report.error.message, "Configuration exposed [redacted]")
  assert.equal(report.error.recovery.retry, "after-correction")
  assert.equal(report.error.recovery.reference, "docs/reference.md#configuration")
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI keeps JSON usage and profile failures machine-readable", async () => {
  const usageOutput = outputStream()
  const usageError = outputStream()
  const credentialOutput = outputStream()
  const credentialError = outputStream()
  const profileOutput = outputStream()
  const profileError = outputStream()

  assert.equal(await runCli({
    args: ["catalog", "--json"],
    stderr: usageError.stream,
    stdout: usageOutput.stream,
  }), 2)
  const usage = JSON.parse(usageOutput.value())
  assert.equal(usage.error.category, "usage")
  assert.equal(usage.error.recovery.retry, "after-correction")
  assert.match(usage.error.recovery.action, /discord-mcp help catalog/)
  assert.equal(usageError.value(), "")

  assert.equal(await runCli({
    args: ["setup", "--profile", "support-bot", "--json"],
    dependencies: dependencies({
      async prepareSetup() {
        throw new ConfigDocumentError("DISCORD_SUPPORT_BOT_TOKEN is required")
      },
    }),
    stderr: credentialError.stream,
    stdout: credentialOutput.stream,
  }), 2)
  const credential = JSON.parse(credentialOutput.value())
  assert.equal(credential.error.category, "configuration")
  assert.equal(credential.error.recovery.retry, "after-correction")
  assert.match(credential.error.recovery.action, /intended --config or --profile/)
  assert.equal(credentialError.value(), "")

  assert.equal(await runCli({
    args: ["profile", "show", "missing", "--json"],
    dependencies: dependencies({
      async loadProfile() {
        throw new ProfileError("Profile not found")
      },
    }),
    stderr: profileError.stream,
    stdout: profileOutput.stream,
  }), 2)
  const profile = JSON.parse(profileOutput.value())
  assert.equal(profile.error.category, "profile")
  assert.equal(profile.error.recovery.retry, "after-inspection")
  assert.equal(profileError.value(), "")
})

test("CLI exposes only bounded retry evidence for Discord rate limits", async () => {
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["smoke", "--config", CONFIG_FILE, "--json"],
    dependencies: dependencies({
      async smoke() {
        throw new DiscordApiError({
          message: "Discord rate limited the request",
          method: "GET",
          retryAfterMs: 1_250,
          route: `/channels/${CHANNEL_ID}`,
          status: 429,
        })
      },
    }),
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  const report = JSON.parse(stdout.value())
  assert.equal(exitCode, 2)
  assert.equal(report.error.category, "discord-rate-limit")
  assert.equal(report.error.retryAfterMs, 1_250)
  assert.equal(report.error.recovery.retry, "after-delay")
  assert.equal(stderr.value(), "")
  assert.doesNotMatch(stdout.value(), new RegExp(CHANNEL_ID))
  assert.doesNotMatch(stdout.value(), /channels/)
})

test("CLI preserves long-running startup failure status with recovery text", async () => {
  const stderr = outputStream()
  const exitCode = await runCli({
    args: [],
    dependencies: dependencies({
      serve() {
        throw new Error("stdio startup failed")
      },
    }),
    environment: { [CONFIG_FILE_ENVIRONMENT_VARIABLE]: CONFIG_FILE },
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 1)
  assert.match(stderr.value(), /Operator command failed/)
  assert.match(stderr.value(), /Next: Run discord-mcp doctor/)
  assert.match(stderr.value(), /See: docs\/reference\.md#verification/)
})

test("CLI redacts setup output and forwards setup options", async () => {
  const stdout = outputStream()
  let received: unknown
  const exitCode = await runCli({
    args: [
      "setup",
      "--config",
      CONFIG_FILE,
      "--json",
      "--name",
      "team-discord",
      "--command",
      "/bin/discord-mcp",
    ],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          warnings: [`Rejected ${TOKEN}`],
        }
      },
    }),
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 1)
  assert.deepEqual(received, {
    args: ["serve"],
    command: "/bin/discord-mcp",
    configFile: CONFIG_FILE,
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    overwriteConfig: false,
    serverName: "team-discord",
  })
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.match(stdout.value(), /\[redacted\]/)
})

test("CLI setup pins the running Node.js executable and built entrypoint by default", async () => {
  let received: unknown
  const stdout = outputStream()
  const exitCode = await runCli({
    args: ["setup", "--config", CONFIG_FILE],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return setupReport()
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    configFile: CONFIG_FILE,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    overwriteConfig: false,
  })
  assert.match(stdout.value(), /Portable stdio launch descriptor/)
  assert.match(stdout.value(), /required-server, write-approval, elicitation, and timeout settings/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI forwards profile setup intent and redacts custom credential aliases", async () => {
  let received: unknown
  const stdout = outputStream()
  const source = { [TOKEN_ALIAS]: TOKEN }
  const exitCode = await runCli({
    args: [
      "setup",
      "--profile",
      "support-bot",
      "--preset",
      "server-observer",
      "--guild-id",
      GUILD_ID,
      "--token-env",
      TOKEN_ALIAS,
      "--force",
      "--json",
    ],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          profile: connectorProfile(),
          warnings: [`Credential ${TOKEN}`],
        }
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 1)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    overwriteProfile: true,
    preset: {
      channelIds: [],
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
    profileName: "support-bot",
  })
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.match(stdout.value(), /\[redacted\]/)
})

test("CLI forwards standalone configuration setup and renders recoverable replacement", async () => {
  let received: unknown
  const stdout = outputStream()
  const source = { [TOKEN_ALIAS]: TOKEN }
  const exitCode = await runCli({
    args: [
      "setup",
      "--config",
      "/configuration/discord.json",
      "--preset",
      "server-observer",
      "--guild-id",
      GUILD_ID,
      "--token-env",
      TOKEN_ALIAS,
      "--force",
    ],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          configBackupFile: "/configuration/.discord.json.backup",
          configFile: "/configuration/discord.json",
          credential: {
            provider: "environment",
            variable: TOKEN_ALIAS,
          },
          launch: {
            ...setupReport().launch,
            args: ["serve", "--config", "/configuration/discord.json"],
            environment: {
              forward: [TOKEN_ALIAS],
              set: {},
            },
            secrets: {
              environmentVariables: [TOKEN_ALIAS],
              files: [],
            },
          },
        }
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    configFile: "/configuration/discord.json",
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    overwriteConfig: true,
    preset: {
      channelIds: [],
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
  })
  assert.match(stdout.value(), /Configuration: \/configuration\/discord\.json/)
  assert.match(stdout.value(), /Previous configuration backup:/)
  assert.match(
    stdout.value(),
    new RegExp(`Credential environment variable: ${TOKEN_ALIAS}`),
  )
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI forwards and renders a file-backed setup credential", async () => {
  const credentialFile = "/run/secrets/discord_bot_token"
  let received: unknown
  const stdout = outputStream()
  const source = { PATH: "/usr/bin" }
  const exitCode = await runCli({
    args: [
      "setup",
      "--config",
      "/configuration/discord.json",
      "--preset",
      "server-observer",
      "--guild-id",
      GUILD_ID,
      "--token-file",
      credentialFile,
    ],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          credential: { path: credentialFile, provider: "file" },
          launch: {
            ...setupReport().launch,
            environment: { forward: [], set: {} },
            secrets: {
              environmentVariables: [],
              files: [credentialFile],
            },
          },
        }
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    configFile: "/configuration/discord.json",
    credentialFile,
    environment: source,
    overwriteConfig: false,
    preset: {
      channelIds: [],
      guildIds: [GUILD_ID],
      name: "server-observer",
    },
  })
  assert.match(stdout.value(), /Credential file: \/run\/secrets\/discord_bot_token/)
  assert.match(stdout.value(), /"environmentVariables": \[\]/)
  assert.match(stdout.value(), /"files": \[/)
})

test("CLI forwards exact preset setup intent and renders its read-only boundary", async () => {
  let received: unknown
  const stdout = outputStream()
  const source = { [TOKEN_ALIAS]: TOKEN }
  const preset = getSetupPreset("channel-reader")
  const exitCode = await runCli({
    args: [
      "setup",
      "--profile",
      "reader",
      "--preset",
      "channel-reader",
      "--guild-id",
      GUILD_ID,
      "--channel-id",
      CHANNEL_ID,
      "--token-env",
      TOKEN_ALIAS,
    ],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          preset,
          profile: connectorProfile(),
          toolsets: [...preset.toolsets],
        }
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    overwriteProfile: false,
    preset: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID],
      name: "channel-reader",
    },
    profileName: "reader",
  })
  assert.match(stdout.value(), /Preset: channel-reader/)
  assert.match(stdout.value(), /Preset tools: [0-9]+ read-only/)
  assert.match(stdout.value(), /Preset Gateway: disabled/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI inspects presets without credentials or dependency activity", async () => {
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const unavailable = dependencies({
    async prepareSetup() {
      throw new Error("Preset inspection must not run setup")
    },
  })

  assert.equal(await runCli({
    args: ["preset", "list"],
    dependencies: unavailable,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["preset", "show", "channel-reader", "--json"],
    dependencies: unavailable,
    environment: {},
    stdout: jsonOutput.stream,
  }), 0)

  assert.match(textOutput.value(), /server-observer \(recommended\)/)
  assert.match(textOutput.value(), /Writes: disabled/)
  assert.match(textOutput.value(), /Gateway: disabled/)
  assert.match(textOutput.value(), /Bot permissions: VIEW_CHANNEL \(1024\)/)
  assert.doesNotMatch(textOutput.value(), new RegExp(TOKEN))
  assert.deepEqual(JSON.parse(jsonOutput.value()), {
    preset: getSetupPreset("channel-reader"),
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
  })
})

test("CLI inspects additive recipes without credentials or file access", async () => {
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const unavailable = dependencies({
    async applyRecipe() {
      throw new Error("Recipe inspection must not apply a configuration")
    },
    planRecipe() {
      throw new Error("Recipe inspection must not read a configuration")
    },
  })

  assert.equal(await runCli({
    args: ["recipe", "list"],
    dependencies: unavailable,
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["recipe", "show", "channel-publisher", "--json"],
    dependencies: unavailable,
    environment: {},
    stdout: jsonOutput.stream,
  }), 0)

  assert.match(textOutput.value(), /Discord MCP additive configuration recipes/)
  assert.match(textOutput.value(), /guild-builder/)
  assert.match(textOutput.value(), /channel-publisher/)
  assert.match(textOutput.value(), /incident-response/)
  assert.match(textOutput.value(), /Gateway evidence: guild-layout with GUILDS; event-feed policy unchanged/)
  assert.match(textOutput.value(), /Gateway evidence: none; event-feed policy unchanged/)
  assert.match(textOutput.value(), /Writes: enabled only through the underlying reviewed workflow gates/)
  assert.doesNotMatch(textOutput.value(), new RegExp(TOKEN))
  assert.deepEqual(JSON.parse(jsonOutput.value()), {
    recipe: getConfigRecipe("channel-publisher"),
    schemaVersion: CONFIG_RECIPE_REPORT_SCHEMA_VERSION,
    status: "ok",
  })
  assert.equal(CONFIG_RECIPES.length, 3)
})

test("CLI plans and applies an exact recipe without resolving its credential", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-cli-recipe-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const file = join(root, "discord-mcp.json")
  await writeConnectorConfigDocumentFile(file, connectorProfile())
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const applyOutput = outputStream()
  const args = [
    "recipe",
    "plan",
    "channel-publisher",
    file,
    "--channel-id",
    CHANNEL_ID,
  ]
  const recipeDependencies = dependencies()

  assert.equal(await runCli({
    args,
    dependencies: recipeDependencies,
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [...args, "--json"],
    dependencies: recipeDependencies,
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: jsonOutput.stream,
  }), 0)
  const plan = JSON.parse(jsonOutput.value())
  assert.equal(plan.action, "plan")
  assert.equal(plan.status, "planned")
  assert.equal(plan.execution.secretValuesRead, false)
  assert.equal(plan.execution.discordContacted, false)
  assert.match(textOutput.value(), /Complete proposed non-secret configuration/)
  assert.match(textOutput.value(), /Configuration written: no/)
  assert.match(textOutput.value(), /No secret value was read and Discord was not contacted/)
  assert.doesNotMatch(textOutput.value(), new RegExp(TOKEN))

  assert.equal(await runCli({
    args: [
      "recipe",
      "apply",
      "channel-publisher",
      file,
      "--channel-id",
      CHANNEL_ID,
      "--plan-digest",
      plan.planDigest,
      "--confirm",
      "channel-publisher",
      "--json",
    ],
    dependencies: recipeDependencies,
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: applyOutput.stream,
  }), 0)
  const applied = JSON.parse(applyOutput.value())
  assert.equal(applied.action, "apply")
  assert.equal(applied.status, "applied")
  assert.equal(applied.execution.configurationWritten, true)
  assert.equal(typeof applied.backupFile, "string")
  const stored = loadConnectorConfigDocumentFile(file)
  assert.equal(stored.capabilities.interactions, true)
  assert.deepEqual(stored.scopes.interactionChannelIds, [CHANNEL_ID])
  assert.equal(JSON.stringify(applied).includes(TOKEN), false)
})

test("CLI generates human and JSON bot installation plans without dependencies", async () => {
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const unavailable = dependencies({
    async prepareSetup() {
      throw new Error("Bot installation planning must not run setup")
    },
  })
  const args = [
    "preset",
    "install",
    "channel-reader",
    "--application-id",
    APPLICATION_ID,
    "--guild-id",
    GUILD_ID,
  ]

  assert.equal(await runCli({
    args,
    dependencies: unavailable,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [...args, "--json"],
    dependencies: unavailable,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: jsonOutput.stream,
  }), 0)

  assert.match(textOutput.value(), /Discord MCP bot install plan: channel-reader/)
  assert.match(textOutput.value(), /VIEW_CHANNEL, READ_MESSAGE_HISTORY \(66560\)/)
  assert.match(textOutput.value(), /Administrator: not requested/)
  assert.match(textOutput.value(), /MESSAGE_CONTENT \(recommended\)/)
  assert.match(textOutput.value(), /guild-locked/)
  assert.match(textOutput.value(), /Discord was not contacted and no browser was opened/)
  assert.doesNotMatch(textOutput.value(), new RegExp(TOKEN))
  assert.deepEqual(
    JSON.parse(jsonOutput.value()),
    createBotInstallPlan({
      applicationId: APPLICATION_ID,
      guildId: GUILD_ID,
      preset: "channel-reader",
    }),
  )
})

test("CLI inspects profiles without activation for doctor while serve and smoke activate", async () => {
  const source = { [TOKEN_ALIAS]: TOKEN, KEEP: "value" }
  const before = { ...source }
  const profile = connectorProfile()
  const config = loadConnectorConfigDocument(profile, source)
  const events: string[] = []
  const profiledDependencies = dependencies({
    async activateProfile(name, options) {
      events.push(`activate:${name}`)
      assert.equal(options.environment, source)
      return { config, profile }
    },
    async diagnose(options) {
      events.push("doctor")
      assert.equal(options.environment, source)
      assert.equal(options.config, undefined)
      assert.equal(options.document, profile)
      return doctorReport()
    },
    async loadProfile(name, options) {
      events.push(`load:${name}`)
      assert.equal(options.environment, source)
      return profile
    },
    serve(options) {
      events.push("serve")
      assert.equal(options.environment, source)
      assert.equal(options.config, config)
    },
    async smoke(options) {
      events.push("smoke")
      assert.equal(options.environment, source)
      assert.equal(options.config, config)
      return smokeReport()
    },
  })

  assert.equal(await runCli({
    args: ["serve", "--profile", "support-bot"],
    dependencies: profiledDependencies,
    environment: source,
  }), 0)
  assert.equal(await runCli({
    args: ["doctor", "--profile", "support-bot"],
    dependencies: profiledDependencies,
    environment: source,
    stdout: outputStream().stream,
  }), 0)
  assert.equal(await runCli({
    args: ["smoke", "--profile", "support-bot"],
    dependencies: profiledDependencies,
    environment: source,
    stdout: outputStream().stream,
  }), 0)

  assert.deepEqual(source, before)
  assert.deepEqual(events, [
    "activate:support-bot",
    "serve",
    "load:support-bot",
    "doctor",
    "activate:support-bot",
    "smoke",
  ])
})

test("CLI selects one explicit configuration file before serve, doctor, and smoke", async () => {
  const file = "/configuration/discord-mcp.json"
  const source = { KEEP: "value" }
  const before = { ...source }
  const events: string[] = []
  const configDependencies = dependencies({
    async activateProfile() {
      throw new Error("Config selection must not activate a profile")
    },
    async diagnose(options) {
      events.push("doctor")
      assert.equal(options.environment?.[CONFIG_FILE_ENVIRONMENT_VARIABLE], file)
      assert.deepEqual(options.document, connectorProfile())
      return doctorReport()
    },
    loadConfigDocument(selected) {
      events.push(`load-document:${selected}`)
      return connectorProfile()
    },
    serve(options) {
      events.push("serve")
      assert.equal(options.environment[CONFIG_FILE_ENVIRONMENT_VARIABLE], file)
    },
    async smoke(options) {
      events.push("smoke")
      assert.equal(options.environment?.[CONFIG_FILE_ENVIRONMENT_VARIABLE], file)
      return smokeReport()
    },
  })

  assert.equal(await runCli({
    args: ["serve", "--config", file],
    dependencies: configDependencies,
    environment: source,
  }), 0)
  assert.equal(await runCli({
    args: ["doctor", "--config", file],
    dependencies: configDependencies,
    environment: source,
    stdout: outputStream().stream,
  }), 0)
  assert.equal(await runCli({
    args: ["smoke", "--config", file],
    dependencies: configDependencies,
    environment: source,
    stdout: outputStream().stream,
  }), 0)

  assert.deepEqual(source, before)
  assert.deepEqual(events, ["serve", `load-document:${file}`, "doctor", "smoke"])
})

test("CLI routes config lifecycle commands without exposing credential values", async () => {
  const events: string[] = []
  const environment = { [TOKEN_ALIAS]: TOKEN }
  const output = outputStream()
  const configDependencies = dependencies({
    explainConfig(path) {
      events.push(`explain:${path}`)
      return explainConnectorConfig(path)
    },
    async initializeConfig(options) {
      events.push(`init:${options.file}:${options.name}`)
      return configWriteReport()
    },
    showConfig(file) {
      events.push(`show:${file}`)
      return configShowReport()
    },
    validateConfig(file) {
      events.push(`validate:${file}`)
      return configValidationReport()
    },
  })

  assert.equal(await runCli({
    args: ["config", "validate", "/configuration/discord-mcp.json"],
    dependencies: configDependencies,
    environment,
    stdout: output.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["config", "show", "/configuration/discord-mcp.json", "--json"],
    dependencies: configDependencies,
    environment,
    stdout: output.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["config", "explain", "capabilities.deletions"],
    dependencies: configDependencies,
    environment,
    stdout: output.stream,
  }), 0)
  assert.equal(await runCli({
    args: [
      "config",
      "init",
      "/configuration/new.json",
      "--name",
      "new",
      "--application-id",
      APPLICATION_ID,
      "--bot-id",
      BOT_ID,
      "--guild-id",
      GUILD_ID,
    ],
    dependencies: configDependencies,
    environment,
    stdout: output.stream,
  }), 0)
  assert.deepEqual(events, [
    "validate:/configuration/discord-mcp.json",
    "show:/configuration/discord-mcp.json",
    "explain:capabilities.deletions",
    "init:/configuration/new.json:new",
  ])
  assert.equal(output.value().includes(TOKEN), false)
  assert.match(output.value(), /secret values, and did not contact Discord/)
})

test("CLI explains only the typed configuration contract", async () => {
  const output = outputStream()

  assert.equal(await runCli({
    args: ["config", "explain", "capabilities.deletions", "--json"],
    dependencies: dependencies(),
    stdout: output.stream,
  }), 0)

  assert.doesNotMatch(output.value(), /DISCORD_MCP_ALLOW_DELETIONS/)
  assert.doesNotMatch(output.value(), /"environmentVariable"/)
  assert.doesNotMatch(output.value(), /migration/i)
})

test("CLI profile lifecycle is credential-free, recoverable, and exactly confirmed", async () => {
  const events: string[] = []
  let activations = 0
  const lifecycleDependencies = dependencies({
    async activateProfile() {
      activations += 1
      throw new Error("Profiles must not activate for lifecycle inspection")
    },
    async listProfiles() {
      events.push("list")
      return [connectorProfile()]
    },
    async loadProfile(name) {
      events.push(`load:${name}`)
      return connectorProfile()
    },
    async restoreProfile(name) {
      events.push(`restore:${name}`)
      return { name, trashId: "restored" }
    },
    async trashProfile(name) {
      events.push(`remove:${name}`)
      return { name, trashId: "removed" }
    },
  })
  const listOutput = outputStream()
  const showOutput = outputStream()
  const removeOutput = outputStream()
  const restoreOutput = outputStream()
  const mismatchError = outputStream()
  const environment = { [TOKEN_ALIAS]: TOKEN }

  assert.equal(await runCli({
    args: ["profile", "list", "--json"],
    dependencies: lifecycleDependencies,
    environment,
    stdout: listOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["profile", "show", "support-bot"],
    dependencies: lifecycleDependencies,
    environment,
    stdout: showOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["profile", "remove", "support-bot", "--confirm", "wrong"],
    dependencies: lifecycleDependencies,
    environment,
    stderr: mismatchError.stream,
  }), 2)
  assert.equal(await runCli({
    args: [
      "profile",
      "remove",
      "support-bot",
      "--confirm",
      "support-bot",
    ],
    dependencies: lifecycleDependencies,
    environment,
    stdout: removeOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [
      "profile",
      "restore",
      "support-bot",
      "--confirm",
      "support-bot",
      "--json",
    ],
    dependencies: lifecycleDependencies,
    environment,
    stdout: restoreOutput.stream,
  }), 0)

  const listReport = JSON.parse(listOutput.value()) as {
    profiles: Array<{
      credentialProvider: string
      credentialReference: string
      name: string
    }>
    schemaVersion: number
  }
  assert.equal(listReport.schemaVersion, OPERATOR_REPORT_SCHEMA_VERSION)
  assert.deepEqual(listReport.profiles.map((profile) => profile.name), ["support-bot"])
  assert.equal(listReport.profiles[0]?.credentialProvider, "environment")
  assert.equal(listReport.profiles[0]?.credentialReference, TOKEN_ALIAS)
  assert.match(showOutput.value(), /Discord MCP profile: support-bot/)
  assert.match(mismatchError.value(), /Confirmation must exactly match/)
  assert.match(removeOutput.value(), /moved to recoverable trash/)
  assert.deepEqual(JSON.parse(restoreOutput.value()), {
    action: "restore",
    credentialUnaffected: true,
    name: "support-bot",
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
  })
  assert.equal(activations, 0)
  assert.deepEqual(events, [
    "list",
    "load:support-bot",
    "remove:support-bot",
    "restore:support-bot",
  ])
  for (const output of [
    listOutput.value(),
    showOutput.value(),
    removeOutput.value(),
    restoreOutput.value(),
    mismatchError.value(),
  ]) {
    assert.doesNotMatch(output, new RegExp(TOKEN))
  }
})

test("CLI renders smoke, help, and version output", async () => {
  const smokeOutput = outputStream()
  const helpOutput = outputStream()
  const catalogHelpOutput = outputStream()
  const configHelpOutput = outputStream()
  const recipeHelpOutput = outputStream()
  const versionOutput = outputStream()

  assert.equal(await runCli({
    args: ["smoke", "--config", CONFIG_FILE],
    dependencies: dependencies(),
    stdout: smokeOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["help", "doctor"],
    dependencies: dependencies(),
    stdout: helpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["catalog", "--help"],
    dependencies: dependencies(),
    stdout: catalogHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["config", "--help"],
    dependencies: dependencies(),
    stdout: configHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["recipe", "--help"],
    dependencies: dependencies(),
    stdout: recipeHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["--version"],
    dependencies: dependencies(),
    stdout: versionOutput.stream,
  }), 0)

  assert.match(smokeOutput.value(), /Discord MCP smoke: ok/)
  assert.match(smokeOutput.value(), /Resources: discord:\/\/connector\/safety/)
  assert.match(smokeOutput.value(), /Prompts: summarize_channel/)
  assert.match(helpOutput.value(), /doctor \(--config FILE \| --profile NAME\)/)
  assert.match(catalogHelpOutput.value(), /catalog \[--check\] \[--json\] \[--html FILE\]/)
  assert.match(catalogHelpOutput.value(), /without replacing an existing file/)
  assert.doesNotMatch(configHelpOutput.value(), /migrate FILE/)
  assert.match(configHelpOutput.value(), /explain \[PATH\] \[--json\]/)
  assert.match(configHelpOutput.value(), /--token-file FILE/)
  assert.match(configHelpOutput.value(), /one strict non-secret configuration file/)
  assert.match(recipeHelpOutput.value(), /plan NAME FILE/)
  assert.match(recipeHelpOutput.value(), /--plan-digest DIGEST --confirm NAME/)
  assert.match(recipeHelpOutput.value(), /do not resolve secrets or contact Discord/)
  assert.match(versionOutput.value(), /0\.1\.0/)
})

test("CLI converts unknown failures into bounded diagnostics", async () => {
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["smoke", "--config", CONFIG_FILE],
    dependencies: dependencies({
      async smoke() {
        throw new Error(`Transport exposed ${TOKEN}`)
      },
    }),
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 2)
  assert.match(stderr.value(), /discord-mcp: Operator command failed/)
  assert.match(stderr.value(), /Next: Run discord-mcp doctor/)
  assert.match(stderr.value(), /See: docs\/reference\.md#verification/)
  assert.doesNotMatch(stderr.value(), new RegExp(TOKEN))
})

test("CLI redacts a custom profile credential when activation fails", async () => {
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["smoke", "--profile", "support-bot"],
    dependencies: dependencies({
      async activateProfile() {
        throw new Error(`Activation exposed ${TOKEN}`)
      },
    }),
    environment: { [TOKEN_ALIAS]: ` ${TOKEN} ` },
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 2)
  assert.match(stderr.value(), /discord-mcp: Operator command failed/)
  assert.match(stderr.value(), /Next: Run discord-mcp doctor/)
  assert.doesNotMatch(stderr.value(), new RegExp(TOKEN))
})
