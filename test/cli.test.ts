import assert from "node:assert/strict"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  parseCliArguments,
  runCli,
  type CliDependencies,
} from "../src/cli.js"
import {
  ACTIVITY_HTML_FORMAT,
  ACTIVITY_HTML_SCHEMA_VERSION,
  type DiscordActivityHtmlExportReport,
} from "../src/activity-html.js"
import {
  ACTIVITY_REVIEW_FORMAT,
  ACTIVITY_REVIEW_SCHEMA_VERSION,
  type DiscordActivityReviewReport,
} from "../src/activity-review.js"
import {
  createBotInstallPlan,
  type BotInstallPlan,
} from "../src/bot-install.js"
import {
  checkDiscordCatalog,
  type DiscordCatalogCheckReport,
} from "../src/catalog.js"
import {
  CATALOG_HTML_FORMAT,
  type DiscordCatalogHtmlExportReport,
} from "../src/catalog-html.js"
import { createMcpToolAccessManifest } from "../src/mcp-tool-catalog.js"
import {
  ONBOARDING_HTML_FORMAT,
  ONBOARDING_HTML_SCHEMA_VERSION,
  type DiscordOnboardingHtmlExportReport,
} from "../src/onboarding-html.js"
import {
  HOST_ACTIVATION_HTML_FORMAT,
  HOST_ACTIVATION_HTML_SCHEMA_VERSION,
  type DiscordHostActivationHtmlExportReport,
} from "../src/host-activation-html.js"
import type { HostActivationPlan } from "../src/host-activation.js"
import {
  HOST_ADAPTER_CATALOG_FORMAT,
  HOST_ADAPTER_IDS,
  createHostAdapterCatalog,
  findHostAdapter,
  type HostAdapterId,
} from "../src/host-adapters.js"
import {
  HOST_INSPECTION_FORMAT,
  HOST_INSPECTION_SCHEMA_VERSION,
  type HostInspectionReport,
} from "../src/host-inspection.js"
import {
  applyHostAdapterFile,
  planHostAdapterFile,
} from "../src/host-installation.js"
import {
  MIGRATION_HTML_FORMAT,
  type DiscordMigrationHtmlExportReport,
} from "../src/migration-html.js"
import {
  MIGRATION_REPORT_SCHEMA_VERSION,
  createMigrationCatalog,
  createMigrationPlan,
  type MigrationPlanReport,
} from "../src/migration-planner.js"
import {
  applyConfigChange,
  planConfigChange,
} from "../src/config-review.js"
import {
  CONFIG_WORKBENCH_HTML_FORMAT,
  CONFIG_WORKBENCH_HTML_SCHEMA_VERSION,
  type DiscordConfigWorkbenchHtmlExportReport,
} from "../src/config-workbench-html.js"
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
  CONFIG_RECIPE_NAMES,
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
  CONNECTOR_NPM_PACKAGE,
  CONNECTOR_VERSION,
  DEFAULT_TOKEN_ENVIRONMENT_VARIABLE,
} from "../src/constants.js"
import {
  ConfigDocumentError,
  ConfigurationError,
  DiscordApiError,
  ProfileError,
} from "../src/errors.js"
import { lowMemoryNodeArguments } from "../src/node-runtime.js"
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
const USER_ID = "500000000000000001"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const CONFIG_FILE = "/configuration/discord-mcp.json"
const LOW_MEMORY_NODE_ARGUMENTS = lowMemoryNodeArguments(process.versions.node)

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
    configuredGuildCount: 1,
    installedGuildCount: 1,
    installedInScopeGuildCount: 1,
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
    unexpectedGuildCount: 0,
    warnings: [],
  }
}

function smokeReport(): SmokeReport {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    configuredGuildCount: 1,
    destructiveTools: ["delete_messages"],
    installedGuildCount: 1,
    installedInScopeGuildCount: 1,
    missingConfiguredGuildCount: 0,
    promptNames: ["summarize_channel"],
    protocolVersion: "2026-07-28",
    readOnlyTools: ["get_connector_status"],
    resourceTemplateUris: ["discord://channels/{channelId}/access"],
    resourceUris: ["discord://connector/safety"],
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    serverName: "discord-mcp",
    serverVersion: "0.1.2",
    status: "ok",
    toolCount: 12,
    toolsets: ["connector", "messages"],
    toolSurface: "full",
    transport: "stdio",
    unexpectedGuildCount: 0,
  }
}

function catalogReport(): DiscordCatalogCheckReport {
  return {
    accessStageCounts: {
      "guarded-write": 0,
      "live-read": 1,
      local: 1,
      "receipt-verify": 0,
      "review-execute": 1,
      "review-plan": 0,
    },
    activityRecordsCreated: false,
    completionBindingCount: 1,
    completionBindings: [{
      argument: "channelId",
      kind: "resource-template",
      policyFields: ["allowedChannelIds"],
      reference: "discord://channels/{channelId}",
    }],
    policyCompletionValuesExposed: false,
    contractDigest: `sha256:${"a".repeat(64)}`,
    credentialsRequired: false,
    discordExecution: "disabled",
    evidenceFormat: "discord-mcp.catalog-evidence.v3",
    executionGuard: "CATALOG_ONLY",
    gateway: "disabled",
    observabilityExport: "disabled",
    planReviewApp: {
      externalNetworkDomains: [],
      extensionId: "io.modelcontextprotocol/ui",
      htmlDigest: `sha256:${"c".repeat(64)}`,
      linkedToolCount: 1,
      linkedToolNames: ["plan_message_deletion"],
      mimeType: "text/html;profile=mcp-app",
      permissions: [],
      resourceDigest: `sha256:${"d".repeat(64)}`,
      resourceUri: "ui://discord-mcp/plan-review",
      serverToolAuthority: false,
      toolVisibility: ["model"],
    },
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
    serverVersion: "0.1.2",
    status: "ok",
    toolCount: 3,
    toolAccessManifest: createMcpToolAccessManifest(
      new Set(["deletion", "messages"]),
    ),
    toolAccessResourceDigest: `sha256:${"e".repeat(64)}`,
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

function onboardingHtmlReport(
  file = "/output/discord-mcp-onboarding.html",
): DiscordOnboardingHtmlExportReport {
  return {
    activityRecordsCreated: false,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: 54321,
    clientSpecificConfiguration: false,
    credentialsEmbedded: false,
    credentialsRequired: false,
    discordContacted: false,
    externalNavigationOrigins: ["https://discord.com"],
    file,
    format: ONBOARDING_HTML_FORMAT,
    htmlDigest: `sha256:${"e".repeat(64)}`,
    planDigest: `sha256:${"f".repeat(64)}`,
    schemaVersion: ONBOARDING_HTML_SCHEMA_VERSION,
    statePersistence: "disabled",
    status: "ok",
  }
}

function activityReviewReport(
  outcome: "attention" | "clear" = "clear",
): DiscordActivityReviewReport {
  return {
    activityRecordsCreated: false,
    attention: [],
    browserOpened: false,
    claims: [],
    contentExcluded: [
      "credentials",
      "message-content",
      "attachment-urls",
      "embeds",
      "components",
      "discord-names",
      "audit-reasons",
      "raw-operation-keys",
      "local-paths",
    ],
    credentialRead: false,
    credentialsRequired: false,
    discordContacted: false,
    format: ACTIVITY_REVIEW_FORMAT,
    gatewayOpened: false,
    limit: 25,
    activityFilePathExposed: false,
    outcome,
    records: [],
    reportDigest: `sha256:${"d".repeat(64)}`,
    schemaVersion: ACTIVITY_REVIEW_SCHEMA_VERSION,
    skippedLines: outcome === "attention" ? 1 : 0,
    snapshotConsistency: "independent-local-reads",
    activityStateChanged: false,
    status: "ok",
    summary: {
      attentionActivities: 0,
      currentActivities: 0,
      dispositions: [],
      kinds: [],
      records: 0,
      reviewRequiredClaims: 0,
      statuses: [],
      unmatchedClaims: 0,
    },
    telemetryStarted: false,
    unmatchedClaimIds: [],
  }
}

function activityHtmlReport(
  file = "/output/discord-mcp-activity.html",
): DiscordActivityHtmlExportReport {
  return {
    activityRecordsCreated: false,
    activityStateChanged: false,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: 65432,
    credentialsEmbedded: false,
    credentialsRequired: false,
    discordContacted: false,
    externalNavigationOrigins: [],
    file,
    format: ACTIVITY_HTML_FORMAT,
    htmlDigest: `sha256:${"e".repeat(64)}`,
    outputFileCreated: true,
    reportDigest: `sha256:${"d".repeat(64)}`,
    schemaVersion: ACTIVITY_HTML_SCHEMA_VERSION,
    statePersistence: "disabled",
    status: "ok",
  }
}

function configWorkbenchHtmlReport(
  file = "/output/discord-mcp-config-workbench.html",
): DiscordConfigWorkbenchHtmlExportReport {
  return {
    activeConfigurationWritten: false,
    activeDocumentDigest: `sha256:${"a".repeat(64)}`,
    activeFile: CONFIG_FILE,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: 76543,
    candidateAuthority: "explicit-download-only",
    candidateFilename: "discord-mcp.candidate.json",
    configurationEmbedded: true,
    credentialsEmbedded: false,
    discordContacted: false,
    externalNavigationOrigins: [],
    file,
    format: CONFIG_WORKBENCH_HTML_FORMAT,
    htmlDigest: `sha256:${"b".repeat(64)}`,
    outputFileCreated: true,
    schemaDigest: `sha256:${"c".repeat(64)}`,
    schemaVersion: CONFIG_WORKBENCH_HTML_SCHEMA_VERSION,
    secretValuesRead: false,
    statePersistence: "disabled",
    status: "ok",
  }
}

function hostActivationHtmlReport(
  file = "/output/discord-mcp-host-activation.html",
): DiscordHostActivationHtmlExportReport {
  return {
    activationDigest: `sha256:${"a".repeat(64)}`,
    adapterDigests: HOST_ADAPTER_IDS.map((_, index) => `sha256:${String(index).repeat(64)}`),
    adapterIds: [...HOST_ADAPTER_IDS],
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: 87654,
    credentialValuesEmbedded: false,
    credentialValuesRead: false,
    discordContacted: false,
    externalNavigationOrigins: [],
    file,
    format: HOST_ACTIVATION_HTML_FORMAT,
    hostConfigurationChanged: false,
    hostDiscovered: false,
    htmlDigest: `sha256:${"b".repeat(64)}`,
    identifiersEmbedded: true,
    localPathsEmbedded: true,
    outputFileCreated: true,
    processStarted: false,
    runtimeCredentialsRequired: true,
    schemaVersion: HOST_ACTIVATION_HTML_SCHEMA_VERSION,
    statePersistence: "disabled",
    status: "ok",
  }
}

function migrationHtmlReport(
  plan: MigrationPlanReport,
  file = "/output/discord-mcp-migration.html",
): DiscordMigrationHtmlExportReport {
  return {
    activityRecordsCreated: false,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: 54321,
    configurationChanged: false,
    credentialValuesEmbedded: false,
    credentialValuesRead: false,
    discordContacted: false,
    file,
    format: MIGRATION_HTML_FORMAT,
    htmlDigest: `sha256:${"f".repeat(64)}`,
    outputFileCreated: true,
    planDigest: plan.planDigest,
    schemaVersion: MIGRATION_REPORT_SCHEMA_VERSION,
    sourceId: plan.source.id,
    statePersistence: "disabled",
    status: "ok",
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

function hostInspectionReport(
  plan: HostActivationPlan,
  adapterId: HostAdapterId,
  status: HostInspectionReport["status"] = "match",
): HostInspectionReport {
  const adapter = findHostAdapter(createHostAdapterCatalog(plan), adapterId)
  const differences = status === "drift" ? ["command-mismatch" as const] : []
  return {
    adapter: {
      activationDigest: adapter.activationDigest,
      adapterDigest: adapter.adapterDigest,
      hostServerName: adapter.hostServerName,
      id: adapter.id,
      title: adapter.title,
    },
    comparison: {
      differences,
      expectedSensitiveInputCount: adapterId === "vscode" ? 1 : 0,
      matchedSensitiveInputCount: status === "match" && adapterId === "vscode" ? 1 : 0,
      serverEntry: status === "match" ? "exact" : "drifted",
      unrelatedState: adapterId === "gemini-extension" ? "not-applicable" : "ignored",
    },
    fileReview: {
      access: "owner-private",
      bounded: true,
      canonical: true,
      owner: "trusted",
      regularFile: true,
      singleLink: true,
      stableRead: true,
    },
    format: HOST_INSPECTION_FORMAT,
    inspectionDigest: `sha256:${"a".repeat(64)}`,
    limitations: ["Static file inspection does not prove MCP startup."],
    privacy: {
      activityRecordsCreated: false,
      credentialValuesReturned: false,
      discordContacted: false,
      hostConfigurationChanged: false,
      hostConfigurationRead: true,
      hostPathReturned: false,
      networkContacted: false,
      possibleCredentialMaterialRead: true,
      processStarted: false,
      rawHostConfigurationReturned: false,
      unrelatedHostStateReturned: false,
    },
    schemaVersion: HOST_INSPECTION_SCHEMA_VERSION,
    status,
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
    applyHostFile: applyHostAdapterFile,
    applyConfigChange,
    applyRecipe: applyConfigRecipe,
    catalog() {},
    async checkCatalog() {
      return catalogReport()
    },
    async exportActivityHtml(file) {
      return activityHtmlReport(file)
    },
    async exportCatalogHtml(file) {
      return catalogHtmlReport(file)
    },
    async exportConfigWorkbenchHtml(_activeFile, outputFile) {
      return configWorkbenchHtmlReport(outputFile)
    },
    async exportHostActivationHtml(file, plan) {
      return {
        ...hostActivationHtmlReport(file),
        activationDigest: plan.activationDigest,
      }
    },
    async exportMigrationHtml(file, plan) {
      return migrationHtmlReport(plan, file)
    },
    async exportOnboardingHtml(file) {
      return onboardingHtmlReport(file)
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
    inspectHostFile(plan, adapterId) {
      return hostInspectionReport(plan, adapterId)
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
    migrationCatalog: createMigrationCatalog,
    async migrationPlan(sourceId) {
      return createMigrationPlan(sourceId, {
        checkCatalog: checkDiscordCatalog,
      })
    },
    async prepareSetup() {
      return setupReport()
    },
    planConfigChange,
    planHostFile: planHostAdapterFile,
    planRecipe: planConfigRecipe,
    async reviewActivity() {
      return activityReviewReport()
    },
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
  assert.deepEqual(parseCliArguments(["activity"]), {
    command: "activity",
    json: false,
    limit: 25,
  })
  assert.deepEqual(parseCliArguments([
    "activity",
    "--profile",
    "support-bot",
    "--limit",
    "10",
    "--html",
    "./activity.html",
    "--json",
  ]), {
    command: "activity",
    htmlFile: "./activity.html",
    json: true,
    limit: 10,
    profileName: "support-bot",
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
    verbose: false,
  })
  assert.deepEqual(parseCliArguments(["doctor", "--profile", "support-bot"]), {
    command: "doctor",
    json: false,
    online: false,
    profileName: "support-bot",
    verbose: false,
  })
  assert.deepEqual(parseCliArguments(["doctor", "-v"]), {
    command: "doctor",
    json: false,
    online: false,
    verbose: true,
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
    "plan",
    "/configuration/discord.json",
    "/configuration/candidate.json",
    "--json",
  ]), {
    action: "plan",
    candidateFile: "/configuration/candidate.json",
    command: "config",
    file: "/configuration/discord.json",
    json: true,
  })
  const configChangeDigest = `sha256:${"b".repeat(64)}`
  assert.deepEqual(parseCliArguments([
    "config",
    "apply",
    "/configuration/discord.json",
    "/configuration/candidate.json",
    "--plan-digest",
    configChangeDigest,
    "--confirm",
    "support-bot",
  ]), {
    action: "apply",
    candidateFile: "/configuration/candidate.json",
    command: "config",
    confirmation: "support-bot",
    file: "/configuration/discord.json",
    json: false,
    planDigest: configChangeDigest,
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
    "--npx",
  ]), {
    command: "setup",
    configFile: "/configuration/discord.json",
    json: false,
    launcherCommand: undefined,
    overwrite: false,
    packageLaunch: true,
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments([
    "host",
    "--config",
    "/configuration/discord.json",
    "--name",
    "team-discord",
    "--command",
    "/usr/local/bin/discord-mcp",
    "--adapter",
    "vscode",
    "--inspect-host-file",
    "./mcp.json",
    "--html",
    "./host-activation.html",
    "--json",
  ]), {
    action: "generate",
    adapterId: "vscode",
    command: "host",
    configFile: "/configuration/discord.json",
    htmlFile: "./host-activation.html",
    inspectHostFile: "./mcp.json",
    json: true,
    launcherCommand: "/usr/local/bin/discord-mcp",
    serverName: "team-discord",
  })
  assert.deepEqual(parseCliArguments([
    "host",
    "--profile",
    "support-bot",
    "--npx",
  ]), {
    action: "generate",
    command: "host",
    json: false,
    launcherCommand: undefined,
    packageLaunch: true,
    profileName: "support-bot",
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments([
    "host",
    "plan",
    "--profile",
    "support-bot",
    "--adapter",
    "cursor",
    "--host-file",
    "./mcp.json",
    "--npx",
    "--json",
  ]), {
    action: "plan",
    adapterId: "cursor",
    command: "host",
    hostFile: "./mcp.json",
    json: true,
    launcherCommand: undefined,
    packageLaunch: true,
    profileName: "support-bot",
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments([
    "host",
    "apply",
    "--config",
    "/configuration/discord.json",
    "--adapter",
    "mcp-json",
    "--host-file",
    "./mcp.json",
    "--plan-digest",
    `sha256:${"a".repeat(64)}`,
    "--confirm",
    "discord",
  ]), {
    action: "apply",
    adapterId: "mcp-json",
    command: "host",
    configFile: "/configuration/discord.json",
    confirmation: "discord",
    hostFile: "./mcp.json",
    json: false,
    launcherCommand: undefined,
    planDigest: `sha256:${"a".repeat(64)}`,
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
    "--html",
    "./onboarding.html",
    "--json",
  ]), {
    action: "install",
    applicationId: APPLICATION_ID,
    command: "preset",
    guildId: GUILD_ID,
    htmlFile: "./onboarding.html",
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
    userIds: [],
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
    userIds: [],
  })
  assert.deepEqual(parseCliArguments([
    "recipe",
    "plan",
    "direct-messenger",
    "/configuration/discord.json",
    "--user-id",
    USER_ID,
  ]), {
    action: "plan",
    channelIds: [],
    command: "recipe",
    file: "/configuration/discord.json",
    guildIds: [],
    json: false,
    name: "direct-messenger",
    userIds: [USER_ID],
  })
  assert.deepEqual(parseCliArguments([
    "config",
    "workbench",
    "/configuration/discord.json",
    "--html",
    "./discord-workbench.html",
    "--json",
  ]), {
    action: "workbench",
    command: "config",
    file: "/configuration/discord.json",
    htmlFile: "./discord-workbench.html",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["migrate", "list", "--json"]), {
    action: "list",
    command: "migrate",
    json: true,
  })
  assert.deepEqual(parseCliArguments([
    "migrate",
    "plan",
    "CAPPYEO@0.25.0",
    "--html",
    "./migration.html",
    "--json",
  ]), {
    action: "plan",
    command: "migrate",
    htmlFile: "./migration.html",
    json: true,
    sourceId: "cappyeo@0.25.0",
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
  assert.throws(() => parseCliArguments(["doctor", "-v", "--verbose"]), /only once/)
  assert.throws(
    () => parseCliArguments([
      "setup",
      "--config",
      "/configuration/discord.json",
      "--npx",
      "--command",
      "/usr/local/bin/discord-mcp",
    ]),
    /--npx and --command are mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments(["host", "--json"]),
    /requires --config FILE or --profile NAME/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "--config",
      "/configuration/discord.json",
      "--profile",
      "support-bot",
    ]),
    /mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "--profile",
      "support-bot",
      "--npx",
      "--command",
      "/usr/local/bin/discord-mcp",
    ]),
    /--npx and --command are mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "--profile",
      "support-bot",
      "--html",
      "first.html",
      "--html",
      "second.html",
    ]),
    /Option --html may be provided only once/,
  )
  assert.throws(
    () => parseCliArguments(["host", "--profile"]),
    /Option --profile requires a value/,
  )
  assert.throws(
    () => parseCliArguments(["host", "--profile", "support-bot", "--client", "legacy"]),
    /Unknown option --client/,
  )
  assert.throws(
    () => parseCliArguments(["host", "--profile", "support-bot", "--adapter", "unknown"]),
    /must be one of mcp-json, cursor, vscode, gemini-extension/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "--profile",
      "support-bot",
      "--inspect-host-file",
      "./mcp.json",
    ]),
    /--inspect-host-file requires --adapter/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "plan",
      "--profile",
      "support-bot",
      "--host-file",
      "./mcp.json",
    ]),
    /Host plan requires --adapter/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "plan",
      "--profile",
      "support-bot",
      "--adapter",
      "cursor",
    ]),
    /Host plan requires --host-file/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "apply",
      "--profile",
      "support-bot",
      "--adapter",
      "cursor",
      "--host-file",
      "./mcp.json",
    ]),
    /Host apply requires --plan-digest/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "apply",
      "--profile",
      "support-bot",
      "--adapter",
      "cursor",
      "--host-file",
      "./mcp.json",
      "--plan-digest",
      `sha256:${"a".repeat(64)}`,
    ]),
    /Host apply requires --confirm/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "plan",
      "--profile",
      "support-bot",
      "--adapter",
      "cursor",
      "--host-file",
      "./mcp.json",
      "--html",
      "guide.html",
    ]),
    /Host plan does not accept --html/,
  )
  assert.throws(
    () => parseCliArguments([
      "host",
      "--profile",
      "support-bot",
      "--host-file",
      "./mcp.json",
    ]),
    /Host generation does not accept --host-file/,
  )
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
    () => parseCliArguments([
      "activity",
      "--config",
      "/configuration/discord.json",
      "--profile",
      "support-bot",
    ]),
    /mutually exclusive/,
  )
  assert.throws(
    () => parseCliArguments(["activity", "--limit", "0"]),
    /integer between 1 and 100/,
  )
  assert.throws(
    () => parseCliArguments(["activity", "--limit", "101"]),
    /integer between 1 and 100/,
  )
  assert.throws(
    () => parseCliArguments(["activity", "--limit", "1.5"]),
    /integer between 1 and 100/,
  )
  assert.throws(
    () => parseCliArguments(["activity", "--html"]),
    /Option --html requires a value/,
  )
  assert.throws(
    () => parseCliArguments([
      "activity",
      "--html",
      "first.html",
      "--html",
      "second.html",
    ]),
    /Option --html may be provided only once/,
  )
  assert.throws(
    () => parseCliArguments(["config", "migrate", "/configuration/discord.json"]),
    /config requires apply, explain, init, plan, show, validate, or workbench/,
  )
  assert.throws(
    () => parseCliArguments(["migrate"]),
    /migrate requires list or plan/,
  )
  assert.throws(
    () => parseCliArguments(["migrate", "list", "source"]),
    /Unknown option source/,
  )
  assert.throws(
    () => parseCliArguments(["migrate", "plan"]),
    /requires an exact source ID/,
  )
  assert.throws(
    () => parseCliArguments(["migrate", "plan", "cappyeo"]),
    /Migration source must be one of/,
  )
  assert.throws(
    () => parseCliArguments([
      "migrate",
      "plan",
      "cappyeo@0.25.0",
      "--html",
      "first.html",
      "--html",
      "second.html",
    ]),
    /Option --html may be provided only once/,
  )
  assert.throws(
    () => parseCliArguments(["config", "workbench", "/configuration/discord.json"]),
    /config workbench requires --html/,
  )
  assert.throws(
    () => parseCliArguments([
      "config",
      "workbench",
      "/configuration/discord.json",
      "--html",
      "first.html",
      "--html",
      "second.html",
    ]),
    /Option --html may be provided only once/,
  )
  assert.throws(
    () => parseCliArguments([
      "config",
      "apply",
      "/configuration/discord.json",
      "/configuration/candidate.json",
      "--confirm",
      "support-bot",
    ]),
    /requires --plan-digest/,
  )
  assert.throws(
    () => parseCliArguments([
      "config",
      "apply",
      "/configuration/discord.json",
      "/configuration/candidate.json",
      "--plan-digest",
      configChangeDigest,
    ]),
    /requires --confirm/,
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
    () => parseCliArguments([
      "preset",
      "install",
      "server-observer",
      "--application-id",
      APPLICATION_ID,
      "--guild-id",
      GUILD_ID,
      "--html",
    ]),
    /Option --html requires a value/,
  )
  assert.throws(
    () => parseCliArguments([
      "preset",
      "install",
      "server-observer",
      "--application-id",
      APPLICATION_ID,
      "--guild-id",
      GUILD_ID,
      "--html",
      "first.html",
      "--html",
      "second.html",
    ]),
    /Option --html may be provided only once/,
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

test("CLI parser accepts strict contextual help for every action", () => {
  const actions = [
    ["config", "init"],
    ["config", "validate"],
    ["config", "show"],
    ["config", "explain"],
    ["config", "workbench"],
    ["config", "plan"],
    ["config", "apply"],
    ["coordination", "list"],
    ["coordination", "resolve"],
    ["host", "generate"],
    ["host", "plan"],
    ["host", "apply"],
    ["migrate", "list"],
    ["migrate", "plan"],
    ["preset", "list"],
    ["preset", "show"],
    ["preset", "install"],
    ["profile", "list"],
    ["profile", "show"],
    ["profile", "remove"],
    ["profile", "restore"],
    ["recipe", "list"],
    ["recipe", "show"],
    ["recipe", "plan"],
    ["recipe", "apply"],
  ] as const

  for (const [topic, action] of actions) {
    for (const flag of ["--help", "-h"]) {
      assert.deepEqual(parseCliArguments([topic, action, flag]), {
        action,
        command: "help",
        topic,
      })
    }
    assert.deepEqual(parseCliArguments(["help", topic, action]), {
      action,
      command: "help",
      topic,
    })
  }

  assert.deepEqual(parseCliArguments(["-h"]), {
    command: "help",
    topic: undefined,
  })
  for (const flag of ["--help", "-h"]) {
    assert.deepEqual(parseCliArguments(["help", flag]), {
      command: "help",
      topic: undefined,
    })
  }
  for (const invalid of [
    ["config", "unknown", "--help"],
    ["config", "validate", "policy.json", "--help"],
    ["preset", "install", "--help", "--json"],
    ["host", "plan", "-h", "--help"],
    ["help", "config", "unknown"],
    ["help", "doctor", "online"],
    ["help", "config", "validate", "extra"],
  ]) {
    assert.throws(
      () => parseCliArguments(invalid),
      /known action|must be used alone|optional known action/u,
    )
  }
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
  assert.match(textOutput.value(), /Tool access resource digest: sha256:[a-f0-9]{64}/)
  assert.match(textOutput.value(), /Access stages: guarded-write=0/)
  assert.match(textOutput.value(), /Static requirement coverage: complete=true, unknown=0, target-access-proven=false/)
  assert.match(textOutput.value(), /Authentication classes: bot=/)
  assert.match(textOutput.value(), /Permission modes: all-listed=/)
  assert.match(textOutput.value(), /Target scopes: application=/)
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

test("CLI reviews activity and optionally exports the exact private HTML report", async () => {
  const activityFile = "/test/discord-mcp-cli-activity.jsonl"
  const htmlFile = "/output/discord-mcp-activity.html"
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const events: string[] = []
  const clear = activityReviewReport()
  const attention = activityReviewReport("attention")
  const reviewDependencies = dependencies({
    async activateProfile() {
      throw new Error("Activity review must not activate a profile")
    },
    async exportActivityHtml(file, report) {
      assert.equal(file, htmlFile)
      assert.equal(report, attention)
      events.push("html")
      return activityHtmlReport(file)
    },
    loadConfig() {
      throw new Error("Activity review must not resolve a credential")
    },
    async reviewActivity(file, limit) {
      assert.equal(file, activityFile)
      events.push(`review:${limit}`)
      return limit === 10 ? clear : attention
    },
    showConfig() {
      return configShowReport(connectorProfile({ auditFile: activityFile }))
    },
  })

  assert.equal(await runCli({
    args: ["activity", "--config", CONFIG_FILE, "--limit", "10"],
    dependencies: reviewDependencies,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [
      "activity",
      "--config",
      CONFIG_FILE,
      "--html",
      htmlFile,
      "--json",
    ],
    dependencies: reviewDependencies,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: jsonOutput.stream,
  }), 1)

  assert.match(textOutput.value(), /Discord MCP activity review: clear/)
  assert.match(textOutput.value(), /Credentials read: no/)
  assert.match(textOutput.value(), /Discord contacted: no/)
  assert.match(textOutput.value(), /Activity\/coordination state changed: no/)
  assert.match(textOutput.value(), /Activity-file path exposed: no/)
  assert.match(textOutput.value(), /Snapshot consistency: independent-local-reads/)
  assert.doesNotMatch(textOutput.value(), new RegExp(TOKEN))
  const json = JSON.parse(jsonOutput.value())
  assert.equal(json.outcome, "attention")
  assert.deepEqual(json.html, activityHtmlReport(htmlFile))
  assert.equal(JSON.stringify(json).includes(TOKEN), false)
  assert.deepEqual(events, ["review:10", "review:25", "html"])
})

test("CLI activity review uses selected policy without resolving credentials or creating state", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-cli-activity-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const activityFile = join(root, "activity.jsonl")
  const configFile = join(root, "discord-mcp.json")
  const profile = connectorProfile({ auditFile: activityFile })
  assert.equal(profile.schemaVersion, 2)
  await writeConnectorConfigDocumentFile(configFile, profile)
  const stdout = outputStream()

  assert.equal(await runCli({
    args: ["activity", "--config", configFile, "--json"],
    environment: {},
    stdout: stdout.stream,
  }), 0)

  const report = JSON.parse(stdout.value())
  assert.equal(report.format, ACTIVITY_REVIEW_FORMAT)
  assert.equal(report.outcome, "clear")
  assert.deepEqual(report.records, [])
  assert.deepEqual(report.claims, [])
  assert.equal(report.activityFilePathExposed, false)
  assert.match(report.reportDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(report).includes(root), false)
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
  assert.match(stdout.value(), /Discord MCP doctor: ready with warnings/)
  assert.match(stdout.value(), /Checks: 0 passes, 1 warning, 0 failures/)
  assert.match(stdout.value(), /WARN configuration: Configuration needs review/)
  assert.match(stdout.value(), /Next: Correct the diagnostic boundary/)
  assert.match(stdout.value(), /See: docs\/reference\.md#verification/)
  assert.match(stdout.value(), /rerun with --verbose or --json/)
})

test("CLI doctor keeps passing checks concise unless verbose or JSON evidence is requested", async () => {
  const compact = outputStream()
  const verbose = outputStream()
  const json = outputStream()
  const available = dependencies({
    async diagnose() {
      return doctorReport()
    },
  })
  const environment = { [CONFIG_FILE_ENVIRONMENT_VARIABLE]: CONFIG_FILE }

  assert.equal(await runCli({
    args: ["doctor"],
    dependencies: available,
    environment,
    stdout: compact.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["doctor", "--verbose"],
    dependencies: available,
    environment,
    stdout: verbose.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["doctor", "-v", "--json"],
    dependencies: available,
    environment,
    stdout: json.stream,
  }), 0)

  assert.match(compact.value(), /Discord MCP doctor: ready/)
  assert.match(compact.value(), /No warnings or failures/)
  assert.doesNotMatch(compact.value(), /PASS configuration/)
  assert.match(verbose.value(), /PASS configuration: Configuration is valid/)
  assert.equal(JSON.parse(json.value()).checks.length, 1)
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

test("CLI generates an exact host activation plan without reading ambient credentials", async () => {
  const stdout = outputStream()
  let loadedFile: string | undefined
  const environment = new Proxy<NodeJS.ProcessEnv>({
    [TOKEN_ALIAS]: TOKEN,
  }, {
    ownKeys() {
      throw new Error("Host activation enumerated ambient credentials")
    },
  })
  const exitCode = await runCli({
    args: ["host", "--config", CONFIG_FILE, "--json"],
    dependencies: dependencies({
      loadConfigDocument(file) {
        loadedFile = file
        return connectorProfile()
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment,
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(loadedFile, CONFIG_FILE)
  const report = JSON.parse(stdout.value())
  assert.equal(report.format, "discord-mcp.host-activation.v1")
  assert.match(report.activationDigest, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(report.policy.source, { file: CONFIG_FILE, kind: "config" })
  assert.deepEqual(report.launch, {
    args: [
      ...LOW_MEMORY_NODE_ARGUMENTS,
      "/srv/discord-mcp/dist/cli.js",
      "serve",
      "--config",
      CONFIG_FILE,
    ],
    command: "/usr/bin/node",
    environment: {
      forward: [TOKEN_ALIAS],
      set: {},
    },
    requirements: {
      elicitation: "required-for-reviewed-writes",
      requiredServer: true,
      toolApproval: "writes",
    },
    secrets: {
      environmentVariables: [TOKEN_ALIAS],
      files: [],
    },
    serverName: "discord",
    timeouts: {
      startupSeconds: 30,
      toolSeconds: 180,
    },
    transport: "stdio",
  })
  assert.equal(report.privacy.credentialValuesRead, false)
  assert.equal(report.privacy.discordContacted, false)
  assert.equal(report.privacy.hostConfigurationChanged, false)
  assert.equal(report.privacy.processStarted, false)
  assert.equal(report.adapterCatalog.format, HOST_ADAPTER_CATALOG_FORMAT)
  assert.equal(report.adapterCatalog.activationDigest, report.activationDigest)
  assert.deepEqual(
    report.adapterCatalog.adapters.map((adapter: { id: string }) => adapter.id),
    HOST_ADAPTER_IDS,
  )
  assert.match(report.adapterCatalog.adapters[0].adapterDigest, /^sha256:[a-f0-9]{64}$/)
  assert.match(report.adapterCatalog.adapters[2].content, /\$\{input:discord-mcp-credential-1\}/)
  assert.match(report.verification.prompt, new RegExp(APPLICATION_ID))
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI exports a pinned package host guide from a profile", async () => {
  const stdout = outputStream()
  const htmlFile = "/output/private-host-activation.html"
  let exportedPlan: HostActivationPlan | undefined
  let loadedProfile: string | undefined
  const exitCode = await runCli({
    args: [
      "host",
      "--profile",
      "support-bot",
      "--name",
      "team-discord",
      "--npx",
      "--html",
      htmlFile,
      "--json",
    ],
    dependencies: dependencies({
      async exportHostActivationHtml(file, plan) {
        assert.equal(file, htmlFile)
        exportedPlan = plan
        return {
          ...hostActivationHtmlReport(file),
          activationDigest: plan.activationDigest,
        }
      },
      async loadProfile(name) {
        loadedProfile = name
        return connectorProfile()
      },
    }),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(loadedProfile, "support-bot")
  const report = JSON.parse(stdout.value())
  assert.equal(report.policy.source.kind, "profile")
  assert.equal(report.launch.serverName, "team-discord")
  assert.equal(report.launch.command, "npx")
  assert.deepEqual(report.launch.args, [
    "--yes",
    `${CONNECTOR_NPM_PACKAGE}@${CONNECTOR_VERSION}`,
    "serve",
    "--profile",
    "support-bot",
  ])
  assert.equal(report.guide.file, htmlFile)
  assert.equal(report.guide.activationDigest, report.activationDigest)
  assert.equal(report.adapterCatalog.format, HOST_ADAPTER_CATALOG_FORMAT)
  assert.equal(exportedPlan?.activationDigest, report.activationDigest)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI renders custom-command host activation and private-guide boundaries", async () => {
  const stdout = outputStream()
  const exitCode = await runCli({
    args: [
      "host",
      "--config",
      CONFIG_FILE,
      "--command",
      "/usr/local/bin/discord-mcp",
      "--adapter",
      "vscode",
      "--html",
      "/output/activation.html",
    ],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.match(stdout.value(), /Discord MCP host activation: ok/)
  assert.match(stdout.value(), /"command": "\/usr\/local\/bin\/discord-mcp"/)
  assert.match(stdout.value(), /Read-only host verification request:/)
  assert.match(stdout.value(), /Verified host adapters:/)
  assert.match(stdout.value(), /Discord MCP host adapter: Visual Studio Code \(vscode\)/)
  assert.match(stdout.value(), /Secret strategy: secure-input/)
  assert.match(stdout.value(), /\$\{input:discord-mcp-credential-1\}/)
  assert.match(stdout.value(), /sandboxing disabled/)
  assert.match(stdout.value(), /Discord MCP host activation guide: ok/)
  assert.match(stdout.value(), /private mode-0600 standalone HTML/)
  assert.match(stdout.value(), /must not be shared or committed/)
  assert.match(stdout.value(), /No credential value was read/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI reports exact host inspection without returning the selected path or secret", async () => {
  const stdout = outputStream()
  const hostFile = "/private/host-config-containing-secret.json"
  let receivedFile: string | undefined
  const exitCode = await runCli({
    args: [
      "host",
      "--config",
      CONFIG_FILE,
      "--adapter",
      "vscode",
      "--inspect-host-file",
      hostFile,
      "--json",
    ],
    dependencies: dependencies({
      inspectHostFile(plan, adapterId, file) {
        receivedFile = file
        return hostInspectionReport(plan, adapterId)
      },
    }),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(receivedFile, hostFile)
  const report = JSON.parse(stdout.value())
  assert.equal(report.inspection.format, HOST_INSPECTION_FORMAT)
  assert.equal(report.inspection.status, "match")
  assert.deepEqual(report.inspection.comparison.differences, [])
  assert.equal(report.inspection.privacy.hostPathReturned, false)
  assert.equal(report.inspection.privacy.credentialValuesReturned, false)
  assert.equal(stdout.value().includes(hostFile), false)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI renders fixed host drift evidence and returns warning status", async () => {
  const stdout = outputStream()
  const exitCode = await runCli({
    args: [
      "host",
      "--profile",
      "support-bot",
      "--adapter",
      "cursor",
      "--inspect-host-file",
      "/private/stale.json",
    ],
    dependencies: dependencies({
      inspectHostFile(plan, adapterId) {
        return hostInspectionReport(plan, adapterId, "drift")
      },
    }),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 1)
  assert.match(stdout.value(), /Discord MCP host inspection: drift/)
  assert.match(stdout.value(), /- command-mismatch/)
  assert.match(stdout.value(), /merge only its owned projection/)
  assert.match(stdout.value(), /then run smoke/)
  assert.doesNotMatch(stdout.value(), /\/private\/stale\.json/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI plans and applies one exact host projection without returning private content", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-cli-host-apply-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const hostFile = join(root, "mcp.json")
  const privateHostValue = "private-host-value-that-must-not-escape"
  await writeFile(hostFile, `${JSON.stringify({
    mcpServers: {
      unrelated: {
        command: "private",
        env: { PRIVATE_HOST_VALUE: privateHostValue },
      },
    },
  }, null, 2)}\n`, { mode: 0o600 })

  const planOutput = outputStream()
  const planExit = await runCli({
    args: [
      "host",
      "plan",
      "--profile",
      "support-bot",
      "--npx",
      "--adapter",
      "cursor",
      "--host-file",
      hostFile,
      "--json",
    ],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: planOutput.stream,
  })

  assert.equal(planExit, 0)
  const plan = JSON.parse(planOutput.value()) as {
    adapter: { hostServerName: string }
    change: { operation: string; unrelatedState: string }
    planDigest: string
    privacy: { hostPathReturned: boolean; privateHostBytesHashed: boolean }
  }
  assert.equal(plan.change.operation, "update")
  assert.equal(plan.change.unrelatedState, "preserved")
  assert.equal(plan.privacy.hostPathReturned, false)
  assert.equal(plan.privacy.privateHostBytesHashed, false)
  assert.equal(planOutput.value().includes(hostFile), false)
  assert.doesNotMatch(planOutput.value(), new RegExp(privateHostValue, "u"))
  assert.doesNotMatch(planOutput.value(), new RegExp(TOKEN, "u"))

  const applyOutput = outputStream()
  const applyExit = await runCli({
    args: [
      "host",
      "apply",
      "--profile",
      "support-bot",
      "--npx",
      "--adapter",
      "cursor",
      "--host-file",
      hostFile,
      "--plan-digest",
      plan.planDigest,
      "--confirm",
      plan.adapter.hostServerName,
      "--json",
    ],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: applyOutput.stream,
  })

  assert.equal(applyExit, 0)
  const applied = JSON.parse(applyOutput.value()) as {
    backup: { created: boolean; file?: string }
    inspection: { status: string }
    privacy: { credentialValuesReturned: boolean; hostPathReturned: boolean }
    status: string
  }
  assert.equal(applied.status, "applied")
  assert.equal(applied.backup.created, true)
  assert.ok(applied.backup.file)
  assert.equal(applied.inspection.status, "match")
  assert.equal(applied.privacy.credentialValuesReturned, false)
  assert.equal(applied.privacy.hostPathReturned, true)
  assert.doesNotMatch(applyOutput.value(), new RegExp(privateHostValue, "u"))
  assert.doesNotMatch(applyOutput.value(), new RegExp(TOKEN, "u"))
  const installed = JSON.parse(await readFile(hostFile, "utf8")) as {
    mcpServers: Record<string, unknown>
  }
  assert.ok(installed.mcpServers.unrelated)
  assert.ok(installed.mcpServers[plan.adapter.hostServerName])

  const absentFile = join(root, "absent.json")
  const absentOutput = outputStream()
  const absentExit = await runCli({
    args: [
      "host",
      "plan",
      "--profile",
      "support-bot",
      "--npx",
      "--adapter",
      "mcp-json",
      "--host-file",
      absentFile,
    ],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: absentOutput.stream,
  })

  assert.equal(absentExit, 0)
  assert.match(absentOutput.value(), /selected target was absent/u)
  assert.doesNotMatch(absentOutput.value(), /Possible credential material was read/u)
  assert.equal(absentOutput.value().includes(absentFile), false)
})

test("CLI reports host parse failures without enumerating ambient credentials", async () => {
  const stdout = outputStream()
  const environment = new Proxy<NodeJS.ProcessEnv>({
    [TOKEN_ALIAS]: TOKEN,
  }, {
    ownKeys() {
      throw new Error("Host error rendering enumerated ambient credentials")
    },
  })

  const exitCode = await runCli({
    args: ["host", "--json"],
    dependencies: dependencies(),
    environment,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 2)
  const report = JSON.parse(stdout.value())
  assert.equal(report.error.category, "usage")
  assert.equal(report.error.message, "Invalid command usage")
  assert.match(report.error.recovery.action, /discord-mcp help host/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
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

  assert.equal(exitCode, 0)
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
    args: [...LOW_MEMORY_NODE_ARGUMENTS, "/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    configFile: CONFIG_FILE,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    overwriteConfig: false,
  })
  assert.match(stdout.value(), /Portable stdio launch descriptor/)
  assert.match(stdout.value(), /Discord MCP setup: ready/)
  assert.match(stdout.value(), /Ask the host to list channels/)
  assert.match(stdout.value(), /required-server, write-approval, elicitation, and timeout settings/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI setup can emit a stable pinned npx package launch", async () => {
  let received: unknown
  const stdout = outputStream()
  const packageSpec = `${CONNECTOR_NPM_PACKAGE}@${CONNECTOR_VERSION}`
  const exitCode = await runCli({
    args: ["setup", "--config", CONFIG_FILE, "--npx"],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          launch: {
            ...setupReport().launch,
            args: ["--yes", packageSpec, "serve", "--config", CONFIG_FILE],
            command: "npx",
          },
        }
      },
    }),
    entrypointPath: "/temporary/npm-cache/discord-mcp/dist/cli.js",
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["--yes", packageSpec, "serve"],
    command: "npx",
    configFile: CONFIG_FILE,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    overwriteConfig: false,
  })
  assert.match(stdout.value(), /"command": "npx"/)
  assert.match(stdout.value(), new RegExp(packageSpec.replace("/", "\\/")))
  assert.doesNotMatch(stdout.value(), /temporary\/npm-cache/)
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

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: [...LOW_MEMORY_NODE_ARGUMENTS, "/srv/discord-mcp/dist/cli.js", "serve"],
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
    args: [...LOW_MEMORY_NODE_ARGUMENTS, "/srv/discord-mcp/dist/cli.js", "serve"],
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
    args: [...LOW_MEMORY_NODE_ARGUMENTS, "/srv/discord-mcp/dist/cli.js", "serve"],
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
    args: [...LOW_MEMORY_NODE_ARGUMENTS, "/srv/discord-mcp/dist/cli.js", "serve"],
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
  assert.match(
    stdout.value(),
    /Preset: channel-reader \([0-9]+ read-only tools; Gateway disabled\)/,
  )
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
  assert.match(textOutput.value(), /guild-starter/)
  assert.match(textOutput.value(), /guild-builder/)
  assert.match(textOutput.value(), /coordination-channel/)
  assert.match(textOutput.value(), /channel-publisher/)
  assert.match(textOutput.value(), /direct-messenger/)
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
  assert.equal(CONFIG_RECIPES.length, CONFIG_RECIPE_NAMES.length)
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

test("CLI generates human and JSON bot installation plans with optional offline guides", async () => {
  const textOutput = outputStream()
  const jsonOutput = outputStream()
  const guideTextOutput = outputStream()
  const guideJsonOutput = outputStream()
  const guideFile = "/output/onboarding.html"
  const exported: BotInstallPlan[] = []
  const unavailable = dependencies({
    async exportOnboardingHtml(file, plan) {
      assert.equal(file, guideFile)
      exported.push(plan)
      return onboardingHtmlReport(file)
    },
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
  assert.equal(await runCli({
    args: [...args, "--html", guideFile],
    dependencies: unavailable,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: guideTextOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [...args, "--html", guideFile, "--json"],
    dependencies: unavailable,
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stdout: guideJsonOutput.stream,
  }), 0)

  assert.match(textOutput.value(), /Discord MCP bot install plan: channel-reader/)
  assert.match(textOutput.value(), /VIEW_CHANNEL, READ_MESSAGE_HISTORY \(66560\)/)
  assert.match(textOutput.value(), /Administrator: not requested/)
  assert.match(textOutput.value(), /MESSAGE_CONTENT \(recommended\)/)
  assert.match(textOutput.value(), /guild-locked/)
  assert.match(textOutput.value(), /available to setup as DISCORD_BOT_TOKEN/)
  assert.match(textOutput.value(), /MCP host to supply the same reference/)
  assert.match(textOutput.value(), /canonical process-owned private directory/)
  assert.match(
    textOutput.value(),
    new RegExp(`npx --yes ${CONNECTOR_NPM_PACKAGE.replace("/", "\\/")}@${CONNECTOR_VERSION.replaceAll(".", "\\.")}`),
  )
  assert.match(textOutput.value(), /setup --npx --config/)
  assert.match(textOutput.value(), /first read-only outcome/)
  assert.match(textOutput.value(), /Show me the channels in Discord server/)
  assert.match(textOutput.value(), /Required tools: list_channels/)
  assert.match(textOutput.value(), /Optional assurance or troubleshooting only/)
  assert.match(textOutput.value(), /verified setup is the post-install readiness gate/)
  assert.match(textOutput.value(), /Discord writes: disabled/)
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
  assert.equal(exported.length, 2)
  assert.deepEqual(exported[0], createBotInstallPlan({
    applicationId: APPLICATION_ID,
    guildId: GUILD_ID,
    preset: "channel-reader",
  }))
  assert.match(guideTextOutput.value(), /Discord MCP onboarding HTML: ok/)
  assert.match(guideTextOutput.value(), new RegExp(guideFile))
  assert.match(guideTextOutput.value(), /Credentials embedded: no/)
  assert.match(guideTextOutput.value(), /Automatic network: disabled/)
  assert.match(guideTextOutput.value(), /State persistence: disabled/)
  assert.doesNotMatch(guideTextOutput.value(), new RegExp(TOKEN))
  const guideJson = JSON.parse(guideJsonOutput.value())
  assert.deepEqual(guideJson.guide, onboardingHtmlReport(guideFile))
  assert.equal(guideJson.installUrl, exported[0]?.installUrl)
  assert.equal(JSON.stringify(guideJson).includes(TOKEN), false)
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
      assert.deepEqual(options.launch, {
        args: [
          ...LOW_MEMORY_NODE_ARGUMENTS,
          "/srv/discord-mcp/dist/cli.js",
          "serve",
          "--profile",
          "support-bot",
        ],
        command: "/usr/bin/node",
      })
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
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
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
      assert.deepEqual(options.launch, {
        args: [
          ...LOW_MEMORY_NODE_ARGUMENTS,
          "/srv/discord-mcp/dist/cli.js",
          "serve",
          "--config",
          file,
        ],
        command: "/usr/bin/node",
      })
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
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
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

test("CLI exports a private configuration workbench without resolving secrets", async () => {
  const active = "/configuration/discord-mcp.json"
  const html = "/output/discord-mcp-workbench.html"
  const environment = { [TOKEN_ALIAS]: TOKEN }
  const calls: Array<[string, string]> = []
  const workbenchDependencies = dependencies({
    async exportConfigWorkbenchHtml(activeFile, outputFile) {
      calls.push([activeFile, outputFile])
      return configWorkbenchHtmlReport(outputFile)
    },
  })
  const textOutput = outputStream()
  const jsonOutput = outputStream()

  assert.equal(await runCli({
    args: ["config", "workbench", active, "--html", html],
    dependencies: workbenchDependencies,
    environment,
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["config", "workbench", active, "--html", html, "--json"],
    dependencies: workbenchDependencies,
    environment,
    stdout: jsonOutput.stream,
  }), 0)

  assert.deepEqual(calls, [[active, html], [active, html]])
  assert.match(textOutput.value(), /configuration workbench:/)
  assert.match(textOutput.value(), /memory-only edits/)
  assert.match(textOutput.value(), /No secret value was read/)
  assert.match(textOutput.value(), /no browser was opened/)
  assert.doesNotMatch(textOutput.value(), new RegExp(TOKEN))
  assert.deepEqual(JSON.parse(jsonOutput.value()), configWorkbenchHtmlReport(html))
  assert.doesNotMatch(jsonOutput.value(), new RegExp(TOKEN))
})

test("CLI plans and applies one exact candidate configuration without resolving secrets", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-cli-config-review-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const file = join(root, "active.json")
  const candidateFile = join(root, "candidate.json")
  const current = connectorProfile()
  const candidate = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    capabilities: { interactions: true },
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "reviewed-bot",
    scopes: { interactionChannelIds: [CHANNEL_ID] },
    toolsets: ["connector", "interactions", "messages"],
    toolSurface: "progressive",
  })
  await writeConnectorConfigDocumentFile(file, current)
  await writeConnectorConfigDocumentFile(candidateFile, candidate)

  const planOutput = outputStream()
  assert.equal(await runCli({
    args: ["config", "plan", file, candidateFile, "--json"],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: planOutput.stream,
  }), 0)
  const plan = JSON.parse(planOutput.value())
  assert.equal(plan.action, "plan")
  assert.equal(plan.status, "planned")
  assert.equal(plan.execution.secretValuesRead, false)
  assert.equal(plan.execution.discordContacted, false)
  assert.equal(plan.candidateDocument.name, "reviewed-bot")
  assert.doesNotMatch(planOutput.value(), new RegExp(TOKEN))

  const applyOutput = outputStream()
  assert.equal(await runCli({
    args: [
      "config",
      "apply",
      file,
      candidateFile,
      "--plan-digest",
      plan.planDigest,
      "--confirm",
      "support-bot",
    ],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stdout: applyOutput.stream,
  }), 0)
  assert.deepEqual(loadConnectorConfigDocumentFile(file), candidate)
  assert.match(applyOutput.value(), /configuration change apply: applied/)
  assert.match(applyOutput.value(), /Recoverable prior version:/)
  assert.match(applyOutput.value(), /Canonical tools added:/)
  assert.match(applyOutput.value(), /No secret value was read and Discord was not contacted/)
  assert.doesNotMatch(applyOutput.value(), new RegExp(TOKEN))

  await writeFile(candidateFile, `${JSON.stringify({
    ...candidate,
    name: "next-reviewed-bot",
  }, null, 2)}\n`)
  const staleOutput = outputStream()
  const staleError = outputStream()
  assert.equal(await runCli({
    args: [
      "config",
      "apply",
      file,
      candidateFile,
      "--plan-digest",
      plan.planDigest,
      "--confirm",
      "reviewed-bot",
      "--json",
    ],
    dependencies: dependencies(),
    environment: { [TOKEN_ALIAS]: TOKEN },
    stderr: staleError.stream,
    stdout: staleOutput.stream,
  }), 2)
  const stale = JSON.parse(staleOutput.value())
  assert.equal(staleError.value(), "")
  assert.equal(stale.error.category, "configuration")
  assert.match(stale.error.message, /stale or does not match/)
  assert.match(stale.error.recovery.action, /Rerun discord-mcp config plan/)
  assert.equal(stale.error.recovery.retry, "after-correction")
  assert.doesNotMatch(staleOutput.value(), new RegExp(TOKEN))
})

test("CLI explains only the typed configuration contract", async () => {
  const output = outputStream()

  assert.equal(await runCli({
    args: ["config", "explain", "capabilities.deletions", "--json"],
    dependencies: dependencies(),
    stdout: output.stream,
  }), 0)

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

test("CLI lists release-exact migration sources and renders complete plans with optional HTML", async () => {
  const listOutput = outputStream()
  const planOutput = outputStream()
  const guideOutput = outputStream()
  const stderr = outputStream()
  const environment = { DISCORD_BOT_TOKEN: TOKEN }
  const cliDependencies = dependencies()

  assert.equal(await runCli({
    args: ["migrate", "list", "--json"],
    dependencies: cliDependencies,
    environment,
    stderr: stderr.stream,
    stdout: listOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["migrate", "plan", "hypark@0.1.1", "--json"],
    dependencies: cliDependencies,
    environment,
    stderr: stderr.stream,
    stdout: planOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [
      "migrate",
      "plan",
      "targeted-reader@1.0.0",
      "--html",
      "/output/targeted-migration.html",
    ],
    dependencies: cliDependencies,
    environment,
    stderr: stderr.stream,
    stdout: guideOutput.stream,
  }), 0)

  const catalog = JSON.parse(listOutput.value())
  const plan = JSON.parse(planOutput.value())
  assert.deepEqual(catalog.sources.map(({ id }: { id: string }) => id), [
    "cappyeo@0.25.0",
    "hypark@0.1.1",
    "jaimen-bell@0.1.1",
    "oratorian@1.1.4",
    "pasympa@2.1.1",
    "targeted-reader@1.0.0",
  ])
  assert.equal(plan.source.id, "hypark@0.1.1")
  assert.equal(plan.configurationImported, false)
  assert.equal(plan.argumentsTranslated, false)
  assert.equal(plan.mappings.flatMap(({ sourceTools }: { sourceTools: string[] }) => sourceTools).length, plan.source.sourceToolCount)
  assert.match(guideOutput.value(), /Discord MCP migration plan: targeted-reader@1\.0\.0/)
  assert.match(guideOutput.value(), /Migration catalog digest: sha256:/)
  assert.match(guideOutput.value(), /Source evidence: https:\/\/github\.com\/Targeted-Design-Agency\/mcp-discord-reader\/tree\/[0-9a-f]{40}/)
  assert.match(guideOutput.value(), /Discord MCP migration HTML: ok/)
  assert.match(guideOutput.value(), /Configuration changed: no/)
  assert.equal(stderr.value(), "")
  assert.doesNotMatch(listOutput.value(), new RegExp(TOKEN))
  assert.doesNotMatch(planOutput.value(), new RegExp(TOKEN))
  assert.doesNotMatch(guideOutput.value(), new RegExp(TOKEN))
})

test("CLI returns structured migration selection failures", async () => {
  const stdout = outputStream()
  const stderr = outputStream()

  assert.equal(await runCli({
    args: ["migrate", "plan", "cappyeo", "--json"],
    dependencies: dependencies(),
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    stderr: stderr.stream,
    stdout: stdout.stream,
  }), 2)

  const report = JSON.parse(stdout.value())
  assert.equal(report.status, "error")
  assert.equal(report.error.message, "Invalid command usage")
  assert.match(report.error.recovery.action, /discord-mcp help migrate/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.equal(stderr.value(), "")
})

test("CLI renders contextual action help without consulting dependencies or environment", async () => {
  const cases = [
    ["config", "init"],
    ["config", "validate"],
    ["config", "show"],
    ["config", "explain"],
    ["config", "workbench"],
    ["config", "plan"],
    ["config", "apply"],
    ["coordination", "list"],
    ["coordination", "resolve"],
    ["host", "generate"],
    ["host", "plan"],
    ["host", "apply"],
    ["migrate", "list"],
    ["migrate", "plan"],
    ["preset", "list"],
    ["preset", "show"],
    ["preset", "install"],
    ["profile", "list"],
    ["profile", "show"],
    ["profile", "remove"],
    ["profile", "restore"],
    ["recipe", "list"],
    ["recipe", "show"],
    ["recipe", "plan"],
    ["recipe", "apply"],
  ] as const
  const forbiddenDependencies = new Proxy(dependencies(), {
    get() {
      throw new Error("Contextual help consulted an operator dependency")
    },
  })
  const forbiddenEnvironment = new Proxy<NodeJS.ProcessEnv>({}, {
    get() {
      throw new Error("Contextual help read the environment")
    },
    ownKeys() {
      throw new Error("Contextual help enumerated the environment")
    },
  })

  for (const [index, [topic, action]] of cases.entries()) {
    const stdout = outputStream()
    const stderr = outputStream()
    const exitCode = await runCli({
      args: [topic, action, index % 2 === 0 ? "--help" : "-h"],
      dependencies: forbiddenDependencies,
      environment: forbiddenEnvironment,
      stderr: stderr.stream,
      stdout: stdout.stream,
    })

    assert.equal(exitCode, 0)
    assert.equal(
      stdout.value().startsWith(`Usage: discord-mcp ${topic} ${action}`),
      true,
    )
    assert.equal(stderr.value(), "")
    assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  }

  for (const args of [["--help"], ["doctor", "--help"], ["help", "--help"]]) {
    const stdout = outputStream()
    assert.equal(await runCli({
      args,
      dependencies: forbiddenDependencies,
      environment: forbiddenEnvironment,
      stdout: stdout.stream,
    }), 0)
    assert.match(stdout.value(), /^Usage: discord-mcp/u)
  }

  const canonical = outputStream()
  const explicit = outputStream()
  assert.equal(await runCli({
    args: ["preset", "install", "--help"],
    dependencies: forbiddenDependencies,
    environment: forbiddenEnvironment,
    stdout: canonical.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["help", "preset", "install"],
    dependencies: forbiddenDependencies,
    environment: forbiddenEnvironment,
    stdout: explicit.stream,
  }), 0)
  assert.equal(explicit.value(), canonical.value())
  assert.match(canonical.value(), /needs no bot token/u)
  assert.match(canonical.value(), /opens no browser/u)
})

test("CLI renders smoke, help, and version output", async () => {
  const smokeOutput = outputStream()
  const helpOutput = outputStream()
  const activityHelpOutput = outputStream()
  const catalogHelpOutput = outputStream()
  const configHelpOutput = outputStream()
  const hostHelpOutput = outputStream()
  const migrateHelpOutput = outputStream()
  const recipeHelpOutput = outputStream()
  const setupHelpOutput = outputStream()
  const smokeHelpOutput = outputStream()
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
    args: ["activity", "--help"],
    dependencies: dependencies(),
    stdout: activityHelpOutput.stream,
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
    args: ["host", "--help"],
    dependencies: dependencies(),
    stdout: hostHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["migrate", "--help"],
    dependencies: dependencies(),
    stdout: migrateHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["setup", "--help"],
    dependencies: dependencies(),
    stdout: setupHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["smoke", "--help"],
    dependencies: dependencies(),
    stdout: smokeHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["--version"],
    dependencies: dependencies(),
    stdout: versionOutput.stream,
  }), 0)

  assert.match(smokeOutput.value(), /Discord MCP smoke: ok/)
  assert.match(smokeOutput.value(), /Transport: stdio/)
  assert.match(smokeOutput.value(), /Protocol: 2026-07-28/)
  assert.match(smokeOutput.value(), /Server: discord-mcp 0\.1\.2/)
  assert.match(smokeOutput.value(), /Resources: discord:\/\/connector\/safety/)
  assert.match(smokeOutput.value(), /Prompts: summarize_channel/)
  assert.match(helpOutput.value(), /doctor \(--config FILE \| --profile NAME\).*--verbose/)
  assert.match(activityHelpOutput.value(), /activity \[--config FILE \| --profile NAME\]/)
  assert.match(activityHelpOutput.value(), /changes no activity or coordination state/)
  assert.match(activityHelpOutput.value(), /Exit status is 0 when clear, 1 when evidence needs attention/)
  assert.match(catalogHelpOutput.value(), /catalog \[--check\] \[--json\] \[--html FILE\]/)
  assert.match(catalogHelpOutput.value(), /without replacing an existing file/)
  assert.match(smokeHelpOutput.value(), /serve entrypoint as a child/)
  assert.match(smokeHelpOutput.value(), /stable MCP 2026-07-28 over stdio/)
  assert.match(smokeHelpOutput.value(), /Normal configured runtimes start and shut down/)
  assert.doesNotMatch(configHelpOutput.value(), /migrate FILE/)
  assert.match(configHelpOutput.value(), /explain \[PATH\] \[--json\]/)
  assert.match(configHelpOutput.value(), /workbench ACTIVE_FILE --html OUTPUT_FILE \[--json\]/)
  assert.match(configHelpOutput.value(), /plan ACTIVE_FILE CANDIDATE_FILE \[--json\]/)
  assert.match(configHelpOutput.value(), /--plan-digest DIGEST --confirm ACTIVE_NAME/)
  assert.match(configHelpOutput.value(), /--token-file FILE/)
  assert.match(configHelpOutput.value(), /one strict non-secret configuration file/)
  assert.match(recipeHelpOutput.value(), /plan NAME FILE/)
  assert.match(recipeHelpOutput.value(), /--plan-digest DIGEST --confirm NAME/)
  assert.match(recipeHelpOutput.value(), /do not resolve secrets or contact Discord/)
  assert.match(hostHelpOutput.value(), /host \[generate\] \(--config FILE \| --profile NAME\)/)
  assert.match(hostHelpOutput.value(), /host plan \(--config FILE \| --profile NAME\) --adapter ID --host-file FILE/)
  assert.match(hostHelpOutput.value(), /host apply .*--plan-digest DIGEST --confirm SERVER_NAME/)
  assert.match(hostHelpOutput.value(), /--npx \| --command COMMAND/)
  assert.match(hostHelpOutput.value(), /--adapter ID/)
  assert.match(hostHelpOutput.value(), /--inspect-host-file FILE/)
  assert.match(hostHelpOutput.value(), /mcp-json, cursor, vscode, gemini-extension/)
  assert.match(hostHelpOutput.value(), /mode-0600 interactive guide/)
  assert.match(hostHelpOutput.value(), /bounded private JSON file/)
  assert.match(hostHelpOutput.value(), /without returning its path, values, unrelated state, or a stable hash/)
  assert.match(hostHelpOutput.value(), /keeps an owner-mode recovery backup/)
  assert.match(hostHelpOutput.value(), /rolls back on failed verification/)
  assert.match(hostHelpOutput.value(), /never edits the file/)
  assert.match(hostHelpOutput.value(), /discover no host/)
  assert.match(migrateHelpOutput.value(), /migrate <action>/)
  assert.match(migrateHelpOutput.value(), /plan SOURCE \[--html FILE\] \[--json\]/)
  assert.match(migrateHelpOutput.value(), /does not rewrite prompts, arguments, configuration, credentials, or host settings/)
  assert.match(setupHelpOutput.value(), /--npx \| --command COMMAND/)
  assert.match(setupHelpOutput.value(), /stable exact-version package launch/)
  assert.match(setupHelpOutput.value(), /canonical process-owned private directory/)
  assert.match(versionOutput.value(), /0\.1\.2/)
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
