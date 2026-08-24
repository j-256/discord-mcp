#!/usr/bin/env node

import { resolve } from "node:path"

import {
  exportDiscordActivityHtml,
  type DiscordActivityHtmlExportReport,
} from "./activity-html.js"
import {
  reviewDiscordActivity,
  type DiscordActivityReviewReport,
} from "./activity-review.js"
import {
  checkDiscordCatalog,
  runDiscordMcpCatalog,
  type DiscordCatalogCheckReport,
} from "./catalog.js"
import {
  exportDiscordCatalogHtml,
  type DiscordCatalogHtmlExportReport,
} from "./catalog-html.js"
import {
  createBotInstallPlan,
  type BotInstallPlan,
} from "./bot-install.js"
import {
  exportDiscordOnboardingHtml,
  type DiscordOnboardingHtmlExportReport,
} from "./onboarding-html.js"
import {
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  CONNECTOR_LIMITS,
  DISCORD_TOKEN_ENVIRONMENT_PATTERN,
} from "./constants.js"
import {
  loadConnectorConfig,
  resolveConnectorConfigDocumentAuditFile,
  type ConnectorConfig,
} from "./config.js"
import {
  applyConfigChange,
  planConfigChange,
  type ConfigChangeApplyOptions,
  type ConfigChangeApplyReport,
  type ConfigChangePlanOptions,
  type ConfigChangePlanReport,
} from "./config-review.js"
import {
  loadConnectorConfigDocumentFile,
  type ConnectorConfigDocument,
} from "./config-document.js"
import {
  explainConnectorConfig,
  initializeConnectorConfigFile,
  showConnectorConfigFile,
  validateConnectorConfigFile,
  type ConfigExplainReport,
  type ConfigInitOptions,
  type ConfigShowReport,
  type ConfigValidationReport,
  type ConfigWriteReport,
} from "./config-operator.js"
import {
  CONFIG_RECIPE_REPORT_SCHEMA_VERSION,
  CONFIG_RECIPES,
  applyConfigRecipe,
  getConfigRecipe,
  normalizeConfigRecipeRequest,
  planConfigRecipe,
  type ConfigRecipeApplyOptions,
  type ConfigRecipeApplyReport,
  type ConfigRecipeDescriptor,
  type ConfigRecipePlanOptions,
  type ConfigRecipePlanReport,
} from "./config-recipes.js"
import {
  ConfigurationError,
  redactText,
  RuntimeConfigurationRequiredError,
} from "./errors.js"
import { isMainModule } from "./entrypoint.js"
import { runDiscordMcpServer } from "./mcp.js"
import {
  FileOperationStore,
  operationReceiptDirectory,
} from "./operation-store.js"
import {
  classifyCliFailure,
  safeCliFailureMessage,
  type CliFailureCategory,
  type CliFailureGuidance,
  type OperatorRecovery,
} from "./operator-recovery.js"
import {
  diagnoseConnector,
  OPERATOR_REPORT_SCHEMA_VERSION,
  prepareSetup,
  smokeConnector,
  type DoctorOptions,
  type DoctorReport,
  type SetupOptions,
  type SetupReport,
  type SmokeOptions,
  type SmokeReport,
} from "./operator.js"
import {
  activateProfile,
  listProfiles,
  loadProfile,
  normalizeProfileName,
  restoreProfile,
  trashProfile,
  type ActivatedProfile,
  type ConnectorProfile,
  type ProfileLocationOptions,
  type TrashedProfile,
} from "./profile.js"
import {
  FileWriteCoordinator,
  writeCoordinationDirectory,
  type WriteCoordinationList,
  type WriteCoordinationResolution,
} from "./write-coordination.js"
import {
  getSetupPreset,
  SETUP_PRESETS,
  type SetupPresetDescriptor,
  type SetupPresetSelection,
} from "./setup-presets.js"

const CLI_COMMANDS = Object.freeze([
  "activity",
  "catalog",
  "config",
  "coordination",
  "doctor",
  "help",
  "preset",
  "profile",
  "recipe",
  "serve",
  "setup",
  "smoke",
  "version",
] as const)

const CLI_EXIT_CODES = Object.freeze({
  failure: 2,
  success: 0,
  warning: 1,
} as const)

type CliCommand = typeof CLI_COMMANDS[number]

export type ParsedCliArguments =
  | {
    command: "activity"
    configFile?: string
    htmlFile?: string
    json: boolean
    limit: number
    profileName?: string
  }
  | { check: boolean; command: "catalog"; htmlFile?: string; json: boolean }
  | {
    action: "apply"
    candidateFile: string
    command: "config"
    confirmation: string
    file: string
    json: boolean
    planDigest: string
  }
  | {
    action: "explain"
    command: "config"
    json: boolean
    path?: string
  }
  | {
    action: "init"
    applicationId: string
    botId: string
    channelIds: string[]
    command: "config"
    credentialFile?: string
    credentialVariable?: string
    file: string
    guildIds: string[]
    json: boolean
    name: string
    overwrite: boolean
    preset?: string
  }
  | {
    action: "plan"
    candidateFile: string
    command: "config"
    file: string
    json: boolean
  }
  | {
    action: "show" | "validate"
    command: "config"
    file: string
    json: boolean
  }
  | {
    action: "list"
    command: "coordination"
    configFile?: string
    json: boolean
    profileName?: string
  }
  | {
    action: "resolve"
    claimId: string
    command: "coordination"
    configFile?: string
    confirmation: string
    json: boolean
    profileName?: string
  }
  | { command: "doctor"; configFile?: string; json: boolean; online: boolean; profileName?: string }
  | { command: "help"; topic: CliCommand | undefined }
  | {
    action: "install"
    applicationId: string
    command: "preset"
    guildId: string
    htmlFile?: string
    json: boolean
    name: string
  }
  | {
    action: "list"
    command: "preset"
    json: boolean
  }
  | {
    action: "show"
    command: "preset"
    json: boolean
    name: string
  }
  | {
    action: "list"
    command: "profile"
    json: boolean
  }
  | {
    action: "show"
    command: "profile"
    json: boolean
    name: string
  }
  | {
    action: "remove" | "restore"
    command: "profile"
    confirmation: string
    json: boolean
    name: string
  }
  | {
    action: "list"
    command: "recipe"
    json: boolean
  }
  | {
    action: "show"
    command: "recipe"
    json: boolean
    name: string
  }
  | {
    action: "plan"
    channelIds: string[]
    command: "recipe"
    file: string
    guildIds: string[]
    json: boolean
    name: string
  }
  | {
    action: "apply"
    channelIds: string[]
    command: "recipe"
    confirmation: string
    file: string
    guildIds: string[]
    json: boolean
    name: string
    planDigest: string
  }
  | { command: "serve"; configFile?: string; profileName?: string }
  | {
    command: "setup"
    configFile?: string
    credentialFile?: string
    credentialVariable?: string
    json: boolean
    launcherCommand: string | undefined
    overwrite: boolean
    preset?: SetupPresetSelection
    profileName?: string
    serverName: string | undefined
  }
  | { command: "smoke"; configFile?: string; json: boolean; profileName?: string }
  | { command: "version" }

export interface CliDependencies {
  activateProfile(
    name: string,
    options: ProfileLocationOptions,
  ): Promise<ActivatedProfile>
  applyConfigChange(options: ConfigChangeApplyOptions): Promise<ConfigChangeApplyReport>
  catalog(options: {
    stderr: Pick<NodeJS.WriteStream, "write">
  }): unknown
  checkCatalog(): Promise<DiscordCatalogCheckReport>
  exportActivityHtml(
    file: string,
    report: DiscordActivityReviewReport,
  ): Promise<DiscordActivityHtmlExportReport>
  exportCatalogHtml(file: string): Promise<DiscordCatalogHtmlExportReport>
  exportOnboardingHtml(
    file: string,
    plan: BotInstallPlan,
  ): Promise<DiscordOnboardingHtmlExportReport>
  diagnose(options: DoctorOptions): Promise<DoctorReport>
  explainConfig(path?: string): ConfigExplainReport
  initializeConfig(options: ConfigInitOptions): Promise<ConfigWriteReport>
  listCoordination(activityFile: string): Promise<WriteCoordinationList>
  listProfiles(options: ProfileLocationOptions): Promise<ConnectorProfile[]>
  loadConfig(environment: NodeJS.ProcessEnv): ConnectorConfig
  loadConfigDocument(file: string): ConnectorConfigDocument
  loadProfile(name: string, options: ProfileLocationOptions): Promise<ConnectorProfile>
  prepareSetup(options: SetupOptions): Promise<SetupReport>
  reviewActivity(
    activityFile: string,
    limit: number,
  ): Promise<DiscordActivityReviewReport>
  applyRecipe(options: ConfigRecipeApplyOptions): Promise<ConfigRecipeApplyReport>
  planRecipe(options: ConfigRecipePlanOptions): ConfigRecipePlanReport
  planConfigChange(options: ConfigChangePlanOptions): ConfigChangePlanReport
  resolveCoordination(
    activityFile: string,
    claimId: string,
    confirmation: string,
  ): Promise<WriteCoordinationResolution>
  restoreProfile(name: string, options: ProfileLocationOptions): Promise<TrashedProfile>
  serve(options: {
    config: ConnectorConfig
    environment: NodeJS.ProcessEnv
    stderr: Pick<NodeJS.WriteStream, "write">
  }): unknown
  smoke(options: SmokeOptions): Promise<SmokeReport>
  showConfig(file: string): ConfigShowReport
  trashProfile(name: string, options: ProfileLocationOptions): Promise<TrashedProfile>
  validateConfig(file: string): ConfigValidationReport
}

export interface CliOptions {
  args?: readonly string[]
  dependencies?: CliDependencies
  entrypointPath?: string
  environment?: NodeJS.ProcessEnv
  executablePath?: string
  nodeVersion?: string
  stderr?: Pick<NodeJS.WriteStream, "write">
  stdout?: Pick<NodeJS.WriteStream, "write">
}

export interface CliErrorReport {
  error: {
    category: CliFailureCategory
    message: string
    recovery: OperatorRecovery
    retryAfterMs?: number
  }
  schemaVersion: number
  status: "error"
}

const DEFAULT_DEPENDENCIES: CliDependencies = {
  activateProfile,
  applyConfigChange,
  applyRecipe: applyConfigRecipe,
  catalog: runDiscordMcpCatalog,
  checkCatalog: checkDiscordCatalog,
  diagnose: diagnoseConnector,
  exportActivityHtml: exportDiscordActivityHtml,
  exportCatalogHtml: exportDiscordCatalogHtml,
  exportOnboardingHtml: exportDiscordOnboardingHtml,
  explainConfig: explainConnectorConfig,
  initializeConfig: initializeConnectorConfigFile,
  listCoordination: async (auditFile) => {
    return new FileWriteCoordinator(
      writeCoordinationDirectory(auditFile),
      new FileOperationStore(operationReceiptDirectory(auditFile)),
    ).list()
  },
  listProfiles,
  loadConfig: loadConnectorConfig,
  loadConfigDocument: loadConnectorConfigDocumentFile,
  loadProfile,
  prepareSetup,
  planConfigChange,
  planRecipe: planConfigRecipe,
  reviewActivity: reviewDiscordActivity,
  resolveCoordination: async (auditFile, claimId, confirmation) => {
    return new FileWriteCoordinator(
      writeCoordinationDirectory(auditFile),
      new FileOperationStore(operationReceiptDirectory(auditFile)),
    ).resolve(claimId, confirmation)
  },
  restoreProfile,
  serve: runDiscordMcpServer,
  smoke: smokeConnector,
  showConfig: showConnectorConfigFile,
  trashProfile,
  validateConfig: validateConnectorConfigFile,
}

function isCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value)
}

function parseBooleanOptions(
  args: readonly string[],
  allowed: ReadonlySet<string>,
): ReadonlySet<string> {
  const present = new Set<string>()
  for (const argument of args) {
    if (!allowed.has(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
    if (present.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    present.add(argument)
  }
  return present
}

function parseSetupOptions(args: readonly string[]): Extract<ParsedCliArguments, { command: "setup" }> {
  const channelIds: string[] = []
  let configFile: string | undefined
  let credentialFile: string | undefined
  let credentialVariable: string | undefined
  const guildIds: string[] = []
  let json = false
  let launcherCommand: string | undefined
  let overwrite = false
  let presetName: string | undefined
  let profileName: string | undefined
  let serverName: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument?.startsWith("--")) {
      throw new ConfigurationError(`Unexpected setup argument ${argument || ""}`)
    }
    const repeatable = argument === "--channel-id" || argument === "--guild-id"
    if (!repeatable && seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    if (!repeatable) seen.add(argument)
    if (argument === "--json") {
      json = true
      continue
    }
    if (argument === "--force") {
      overwrite = true
      continue
    }
    if (![
      "--channel-id",
      "--command",
      "--config",
      "--guild-id",
      "--name",
      "--preset",
      "--profile",
      "--token-file",
      "--token-env",
    ].includes(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    index += 1
    if (argument === "--channel-id") channelIds.push(value)
    if (argument === "--command") launcherCommand = value
    if (argument === "--config") configFile = value
    if (argument === "--guild-id") guildIds.push(value)
    if (argument === "--name") serverName = value
    if (argument === "--preset") presetName = value
    if (argument === "--profile") profileName = value
    if (argument === "--token-file") credentialFile = value
    if (argument === "--token-env") credentialVariable = value
  }
  if (configFile && profileName) {
    throw new ConfigurationError("Options --config and --profile are mutually exclusive")
  }
  if (!configFile && !profileName) {
    throw new ConfigurationError("Setup requires --config FILE or --profile NAME")
  }
  if (credentialFile !== undefined && credentialVariable !== undefined) {
    throw new ConfigurationError("Options --token-file and --token-env are mutually exclusive")
  }
  if (!presetName && (
    credentialFile !== undefined
    || credentialVariable !== undefined
    || overwrite
  )) {
    throw new ConfigurationError("--token-env, --token-file, and --force require --preset")
  }
  if (!presetName && (guildIds.length > 0 || channelIds.length > 0)) {
    throw new ConfigurationError("--guild-id and --channel-id require --preset")
  }
  if (presetName && guildIds.length === 0) {
    throw new ConfigurationError("--preset requires at least one --guild-id")
  }
  const preset = presetName ? getSetupPreset(presetName) : undefined
  if (
    preset?.requirements.channelIds === "required"
    && channelIds.length === 0
  ) {
    throw new ConfigurationError(
      `Setup preset ${preset.name} requires at least one --channel-id`,
    )
  }
  return {
    command: "setup",
    ...(configFile ? { configFile } : {}),
    ...(credentialFile ? { credentialFile } : {}),
    ...(credentialVariable ? { credentialVariable } : {}),
    json,
    launcherCommand,
    overwrite,
    ...(preset
      ? {
          preset: {
            channelIds,
            guildIds,
            name: preset.name,
          },
        }
      : {}),
    ...(profileName ? { profileName } : {}),
    serverName,
  }
}

function parseConfigCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "config" }> {
  const action = args[0]
  if (!action || !["apply", "explain", "init", "plan", "show", "validate"].includes(action)) {
    throw new ConfigurationError(
      "config requires apply, explain, init, plan, show, or validate",
    )
  }
  if (action === "plan" || action === "apply") {
    const file = args[1]
    const candidateFile = args[2]
    if (!file || file.startsWith("--")) {
      throw new ConfigurationError(`config ${action} requires an active file path`)
    }
    if (!candidateFile || candidateFile.startsWith("--")) {
      throw new ConfigurationError(`config ${action} requires a candidate file path`)
    }
    if (action === "plan") {
      const options = parseBooleanOptions(args.slice(3), new Set(["--json"]))
      return {
        action,
        candidateFile,
        command: "config",
        file,
        json: options.has("--json"),
      }
    }
    let confirmation: string | undefined
    let json = false
    let planDigest: string | undefined
    const seen = new Set<string>()
    for (let index = 3; index < args.length; index += 1) {
      const argument = args[index]
      if (!argument || !["--confirm", "--json", "--plan-digest"].includes(argument)) {
        throw new ConfigurationError(`Unknown option ${argument || ""}`)
      }
      if (seen.has(argument)) {
        throw new ConfigurationError(`Option ${argument} may be provided only once`)
      }
      seen.add(argument)
      if (argument === "--json") {
        json = true
        continue
      }
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new ConfigurationError(`Option ${argument} requires a value`)
      }
      index += 1
      if (argument === "--confirm") confirmation = value
      if (argument === "--plan-digest") planDigest = value
    }
    if (!planDigest) {
      throw new ConfigurationError("config apply requires --plan-digest")
    }
    if (!confirmation) {
      throw new ConfigurationError("config apply requires --confirm")
    }
    return {
      action,
      candidateFile,
      command: "config",
      confirmation,
      file,
      json,
      planDigest,
    }
  }
  if (action === "explain") {
    const path = args[1]?.startsWith("--") ? undefined : args[1]
    const options = parseBooleanOptions(
      args.slice(path ? 2 : 1),
      new Set(["--json"]),
    )
    return {
      action,
      command: "config",
      json: options.has("--json"),
      ...(path ? { path } : {}),
    }
  }

  const file = args[1]
  if (!file || file.startsWith("--")) {
    throw new ConfigurationError(`config ${action} requires a file path`)
  }
  if (action === "show" || action === "validate") {
    const options = parseBooleanOptions(args.slice(2), new Set(["--json"]))
    return {
      action,
      command: "config",
      file,
      json: options.has("--json"),
    }
  }

  let applicationId: string | undefined
  let botId: string | undefined
  const channelIds: string[] = []
  let credentialFile: string | undefined
  let credentialVariable: string | undefined
  const guildIds: string[] = []
  let json = false
  let name: string | undefined
  let overwrite = false
  let preset: string | undefined
  const seen = new Set<string>()
  const allowed = new Set([
    "--application-id",
    "--bot-id",
    "--channel-id",
    "--guild-id",
    "--name",
    "--preset",
    "--token-env",
    "--token-file",
  ])
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument?.startsWith("--")) {
      throw new ConfigurationError(`Unexpected config ${action} argument ${argument || ""}`)
    }
    const repeatable = argument === "--channel-id" || argument === "--guild-id"
    if (!repeatable && seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    if (!repeatable) seen.add(argument)
    if (argument === "--force") {
      overwrite = true
      continue
    }
    if (argument === "--json") {
      json = true
      continue
    }
    if (!allowed.has(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    index += 1
    if (argument === "--application-id") applicationId = value
    if (argument === "--bot-id") botId = value
    if (argument === "--channel-id") channelIds.push(value)
    if (argument === "--guild-id") guildIds.push(value)
    if (argument === "--name") name = value
    if (argument === "--preset") preset = value
    if (argument === "--token-file") credentialFile = value
    if (argument === "--token-env") credentialVariable = value
  }

  if (credentialFile !== undefined && credentialVariable !== undefined) {
    throw new ConfigurationError("Options --token-file and --token-env are mutually exclusive")
  }
  if (!applicationId || !botId || !name || guildIds.length === 0) {
    throw new ConfigurationError(
      "config init requires --name, --application-id, --bot-id, and at least one --guild-id",
    )
  }
  return {
    action: "init",
    applicationId,
    botId,
    channelIds,
    command: "config",
    ...(credentialFile ? { credentialFile } : {}),
    ...(credentialVariable ? { credentialVariable } : {}),
    file,
    guildIds,
    json,
    name,
    overwrite,
    ...(preset ? { preset } : {}),
  }
}

function parsePresetCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "preset" }> {
  const action = args[0]
  if (!action || !["install", "list", "show"].includes(action)) {
    throw new ConfigurationError("preset requires install, list, or show")
  }
  if (action === "list") {
    const options = parseBooleanOptions(args.slice(1), new Set(["--json"]))
    return { action, command: "preset", json: options.has("--json") }
  }
  const name = args[1]
  if (!name || name.startsWith("--")) {
    throw new ConfigurationError(`preset ${action} requires a preset name`)
  }
  if (action === "install") {
    let applicationId: string | undefined
    let guildId: string | undefined
    let htmlFile: string | undefined
    let json = false
    const seen = new Set<string>()
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]
      if (!argument || !["--application-id", "--guild-id", "--html", "--json"].includes(argument)) {
        throw new ConfigurationError(`Unknown option ${argument || ""}`)
      }
      if (seen.has(argument)) {
        throw new ConfigurationError(`Option ${argument} may be provided only once`)
      }
      seen.add(argument)
      if (argument === "--json") {
        json = true
        continue
      }
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new ConfigurationError(`Option ${argument} requires a value`)
      }
      index += 1
      if (argument === "--application-id") applicationId = value
      if (argument === "--guild-id") guildId = value
      if (argument === "--html") htmlFile = value
    }
    if (!applicationId) {
      throw new ConfigurationError("preset install requires --application-id")
    }
    if (!guildId) {
      throw new ConfigurationError("preset install requires --guild-id")
    }
    const plan = createBotInstallPlan({ applicationId, guildId, preset: name })
    return {
      action: "install",
      applicationId: plan.applicationId,
      command: "preset",
      guildId: plan.guildId,
      ...(htmlFile ? { htmlFile } : {}),
      json,
      name: plan.preset.name,
    }
  }
  const options = parseBooleanOptions(args.slice(2), new Set(["--json"]))
  return {
    action: "show",
    command: "preset",
    json: options.has("--json"),
    name,
  }
}

function parseRecipeCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "recipe" }> {
  const action = args[0]
  if (!action || !["apply", "list", "plan", "show"].includes(action)) {
    throw new ConfigurationError("recipe requires apply, list, plan, or show")
  }
  if (action === "list") {
    const options = parseBooleanOptions(args.slice(1), new Set(["--json"]))
    return { action, command: "recipe", json: options.has("--json") }
  }

  const name = args[1]
  if (!name || name.startsWith("--")) {
    throw new ConfigurationError(`recipe ${action} requires a recipe name`)
  }
  if (action === "show") {
    const options = parseBooleanOptions(args.slice(2), new Set(["--json"]))
    return {
      action,
      command: "recipe",
      json: options.has("--json"),
      name: getConfigRecipe(name).name,
    }
  }

  const file = args[2]
  if (!file || file.startsWith("--")) {
    throw new ConfigurationError(`recipe ${action} requires a file path`)
  }
  const channelIds: string[] = []
  let confirmation: string | undefined
  const guildIds: string[] = []
  let json = false
  let planDigest: string | undefined
  const seen = new Set<string>()
  const allowed = new Set([
    "--channel-id",
    "--guild-id",
    "--json",
    ...(action === "apply" ? ["--confirm", "--plan-digest"] : []),
  ])
  for (let index = 3; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument || !allowed.has(argument)) {
      throw new ConfigurationError(`Unknown option ${argument || ""}`)
    }
    const repeatable = argument === "--channel-id" || argument === "--guild-id"
    if (!repeatable && seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    if (!repeatable) seen.add(argument)
    if (argument === "--json") {
      json = true
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    index += 1
    if (argument === "--channel-id") channelIds.push(value)
    if (argument === "--confirm") confirmation = value
    if (argument === "--guild-id") guildIds.push(value)
    if (argument === "--plan-digest") planDigest = value
  }
  const request = normalizeConfigRecipeRequest({ channelIds, guildIds, name })
  const selection = {
    channelIds: request.scope.kind === "channel" ? [...request.scope.ids] : [],
    file,
    guildIds: request.scope.kind === "guild" ? [...request.scope.ids] : [],
    json,
    name: request.name,
  }
  if (action === "plan") {
    return { action, command: "recipe", ...selection }
  }
  if (planDigest === undefined) {
    throw new ConfigurationError("recipe apply requires --plan-digest DIGEST")
  }
  if (confirmation === undefined) {
    throw new ConfigurationError("recipe apply requires --confirm NAME")
  }
  return {
    action: "apply",
    command: "recipe",
    confirmation,
    planDigest,
    ...selection,
  }
}

function parseRuntimeSelectionOptions(
  args: readonly string[],
  booleanOptions: ReadonlySet<string>,
): { configFile?: string; present: ReadonlySet<string>; profileName?: string } {
  let configFile: string | undefined
  const present = new Set<string>()
  let profileName: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument?.startsWith("--")) {
      throw new ConfigurationError(`Unexpected argument ${argument || ""}`)
    }
    if (present.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    present.add(argument)
    if (argument === "--config" || argument === "--profile") {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new ConfigurationError(`Option ${argument} requires a value`)
      }
      if (argument === "--config") configFile = value
      if (argument === "--profile") profileName = value
      index += 1
      continue
    }
    if (!booleanOptions.has(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
  }
  if (configFile && profileName) {
    throw new ConfigurationError("Options --config and --profile are mutually exclusive")
  }
  return {
    ...(configFile ? { configFile } : {}),
    present,
    ...(profileName ? { profileName } : {}),
  }
}

function parseProfileCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "profile" }> {
  const action = args[0]
  if (!action || !["list", "show", "remove", "restore"].includes(action)) {
    throw new ConfigurationError("profile requires list, show, remove, or restore")
  }
  if (action === "list") {
    const options = parseBooleanOptions(args.slice(1), new Set(["--json"]))
    return { action, command: "profile", json: options.has("--json") }
  }
  const name = args[1]
  if (!name || name.startsWith("--")) {
    throw new ConfigurationError(`profile ${action} requires a profile name`)
  }
  if (action === "show") {
    const options = parseBooleanOptions(args.slice(2), new Set(["--json"]))
    return { action, command: "profile", json: options.has("--json"), name }
  }
  let confirmation: string | undefined
  let json = false
  const seen = new Set<string>()
  const options = args.slice(2)
  for (let index = 0; index < options.length; index += 1) {
    const argument = options[index]
    if (argument !== "--confirm" && argument !== "--json") {
      throw new ConfigurationError(`Unknown option ${argument || ""}`)
    }
    if (seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    seen.add(argument)
    if (argument === "--json") {
      json = true
      continue
    }
    const value = options[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError("Option --confirm requires a value")
    }
    confirmation = value
    index += 1
  }
  if (confirmation === undefined) {
    throw new ConfigurationError(`profile ${action} requires --confirm NAME`)
  }
  return {
    action: action as "remove" | "restore",
    command: "profile",
    confirmation,
    json,
    name,
  }
}

function parseActivityCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "activity" }> {
  let configFile: string | undefined
  let htmlFile: string | undefined
  let json = false
  let limit: number = CONNECTOR_LIMITS.activityPageDefault
  let profileName: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (
      argument !== "--config"
      && argument !== "--html"
      && argument !== "--json"
      && argument !== "--limit"
      && argument !== "--profile"
    ) {
      throw new ConfigurationError(`Unknown option ${argument || ""}`)
    }
    if (seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    seen.add(argument)
    if (argument === "--json") {
      json = true
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    if (argument === "--config") configFile = value
    if (argument === "--html") htmlFile = value
    if (argument === "--profile") profileName = value
    if (argument === "--limit") {
      if (!/^[1-9][0-9]*$/.test(value)) {
        throw new ConfigurationError(
          `Option --limit must be an integer between 1 and ${CONNECTOR_LIMITS.activityEntries}`,
        )
      }
      limit = Number(value)
      if (limit > CONNECTOR_LIMITS.activityEntries) {
        throw new ConfigurationError(
          `Option --limit must be an integer between 1 and ${CONNECTOR_LIMITS.activityEntries}`,
        )
      }
    }
    index += 1
  }
  if (configFile && profileName) {
    throw new ConfigurationError("Options --config and --profile are mutually exclusive")
  }
  return {
    command: "activity",
    ...(configFile ? { configFile } : {}),
    ...(htmlFile ? { htmlFile } : {}),
    json,
    limit,
    ...(profileName ? { profileName } : {}),
  }
}

function parseCoordinationCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "coordination" }> {
  const action = args[0]
  if (!action || !["list", "resolve"].includes(action)) {
    throw new ConfigurationError("coordination requires list or resolve")
  }
  if (action === "list") {
    const options = parseRuntimeSelectionOptions(args.slice(1), new Set(["--json"]))
    return {
      action,
      command: "coordination",
      ...(options.configFile ? { configFile: options.configFile } : {}),
      json: options.present.has("--json"),
      ...(options.profileName ? { profileName: options.profileName } : {}),
    }
  }
  const claimId = args[1]
  if (!claimId || claimId.startsWith("--")) {
    throw new ConfigurationError("coordination resolve requires a claim ID")
  }
  let confirmation: string | undefined
  let configFile: string | undefined
  let json = false
  let profileName: string | undefined
  const seen = new Set<string>()
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index]
    if (
      argument !== "--config"
      && argument !== "--confirm"
      && argument !== "--json"
      && argument !== "--profile"
    ) {
      throw new ConfigurationError(`Unknown option ${argument || ""}`)
    }
    if (seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    seen.add(argument)
    if (argument === "--json") {
      json = true
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    if (argument === "--config") configFile = value
    if (argument === "--confirm") confirmation = value
    if (argument === "--profile") profileName = value
    index += 1
  }
  if (configFile && profileName) {
    throw new ConfigurationError("Options --config and --profile are mutually exclusive")
  }
  if (confirmation === undefined) {
    throw new ConfigurationError(
      "coordination resolve requires --confirm CLAIM_ID",
    )
  }
  return {
    action: "resolve",
    claimId,
    command: "coordination",
    ...(configFile ? { configFile } : {}),
    confirmation,
    json,
    ...(profileName ? { profileName } : {}),
  }
}

export function parseCliArguments(args: readonly string[]): ParsedCliArguments {
  if (args.length === 0) return { command: "serve" }
  const command = args[0]
  const rest = args.slice(1)
  if (command === "--help" || command === "-h") {
    if (rest.length > 0) throw new ConfigurationError(`${command} does not accept arguments`)
    return { command: "help", topic: undefined }
  }
  if (command === "--version" || command === "-v") {
    if (rest.length > 0) throw new ConfigurationError(`${command} does not accept arguments`)
    return { command: "version" }
  }
  if (!command || !isCommand(command)) {
    throw new ConfigurationError(`Unknown command ${command || ""}`)
  }
  if (command === "help") {
    const topic = rest[0]
    if (rest.length > 1 || (topic && !isCommand(topic))) {
      throw new ConfigurationError("help accepts at most one command name")
    }
    return { command: "help", topic: topic as CliCommand | undefined }
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    if (rest.length > 1) throw new ConfigurationError("--help must be used alone")
    return { command: "help", topic: command }
  }
  if (command === "version") {
    if (rest.length > 0) throw new ConfigurationError(`${command} does not accept options`)
    return { command }
  }
  if (command === "serve") {
    const options = parseRuntimeSelectionOptions(rest, new Set())
    return {
      command,
      ...(options.configFile ? { configFile: options.configFile } : {}),
      ...(options.profileName ? { profileName: options.profileName } : {}),
    }
  }
  if (command === "doctor") {
    const options = parseRuntimeSelectionOptions(rest, new Set(["--json", "--online"]))
    return {
      command,
      ...(options.configFile ? { configFile: options.configFile } : {}),
      json: options.present.has("--json"),
      online: options.present.has("--online"),
      ...(options.profileName ? { profileName: options.profileName } : {}),
    }
  }
  if (command === "activity") return parseActivityCommand(rest)
  if (command === "catalog") {
    let check = false
    let htmlFile: string | undefined
    let json = false
    const seen = new Set<string>()
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index]
      if (!argument || !["--check", "--html", "--json"].includes(argument)) {
        throw new ConfigurationError(`Unknown option ${argument || ""}`)
      }
      if (seen.has(argument)) {
        throw new ConfigurationError(`Option ${argument} may be provided only once`)
      }
      seen.add(argument)
      if (argument === "--check") check = true
      if (argument === "--json") json = true
      if (argument === "--html") {
        const value = rest[index + 1]
        if (!value || value.startsWith("--")) {
          throw new ConfigurationError("Option --html requires a file path")
        }
        htmlFile = value
        index += 1
      }
    }
    if (htmlFile && json) {
      throw new ConfigurationError("Catalog options --html and --json are mutually exclusive")
    }
    if (json && !check) {
      throw new ConfigurationError("catalog --json requires --check")
    }
    return { check, command, ...(htmlFile ? { htmlFile } : {}), json }
  }
  if (command === "config") return parseConfigCommand(rest)
  if (command === "coordination") return parseCoordinationCommand(rest)
  if (command === "setup") return parseSetupOptions(rest)
  if (command === "preset") return parsePresetCommand(rest)
  if (command === "profile") return parseProfileCommand(rest)
  if (command === "recipe") return parseRecipeCommand(rest)
  const options = parseRuntimeSelectionOptions(rest, new Set(["--json"]))
  return {
    command: "smoke",
    ...(options.configFile ? { configFile: options.configFile } : {}),
    json: options.present.has("--json"),
    ...(options.profileName ? { profileName: options.profileName } : {}),
  }
}

function helpText(topic: CliCommand | undefined): string {
  if (topic === "activity") {
    return "Usage: discord-mcp activity [--config FILE | --profile NAME] [--limit N] [--html FILE] [--json]\n\nReview bounded recent content-free write lifecycles together with durable coordination claims. The command resolves no credential, contacts no network or Discord endpoint, changes no activity or coordination state, and omits the local activity-file path. Optional HTML exclusively creates the requested private output file from the exact digest-bound report. Exit status is 0 when clear, 1 when evidence needs attention, and 2 on command failure."
  }
  if (topic === "catalog") {
    return "Usage: discord-mcp catalog [--check] [--json] [--html FILE]\n\nAdvertise the exact production MCP catalog without credentials or execution. Add --check to verify and fingerprint the packaged contract; --json emits deterministic evidence and requires --check. Add --html FILE to perform the same check and exclusively write a standalone interactive contract explorer without replacing an existing file."
  }
  if (topic === "config") {
    return [
      "Usage: discord-mcp config <action> [options]",
      "",
      "Actions:",
      "  init FILE --name NAME --application-id ID --bot-id ID --guild-id ID... [--preset PRESET] [--channel-id ID...] [--token-env VARIABLE | --token-file FILE] [--force] [--json]",
      "  validate FILE [--json]",
      "  show FILE [--json]",
      "  explain [PATH] [--json]",
      "  plan ACTIVE_FILE CANDIDATE_FILE [--json]",
      "  apply ACTIVE_FILE CANDIDATE_FILE --plan-digest DIGEST --confirm ACTIVE_NAME [--json]",
      "",
      "Normal operation uses one strict non-secret configuration file plus only the environment or file secrets it references. Validation and change planning do not read secret values or contact Discord. Applying a reviewed change fresh-checks both files, preserves a recoverable backup, and cannot change the pinned Discord identity.",
    ].join("\n")
  }
  if (topic === "doctor") {
    return "Usage: discord-mcp doctor (--config FILE | --profile NAME) [--online] [--json]\n\nValidate the selected configuration and policy even when its referenced bot credential is unavailable. Credential availability is reported as its own check instead of aborting offline diagnostics. Add --online to verify Discord identity and scoped guild access; Discord is not contacted when the credential is unavailable. Pass --config for normal operation; the non-secret DISCORD_MCP_CONFIG_FILE selector is available for hosts that cannot supply arguments. Every warning or failure includes a next action and documentation reference. Exit status is 0 for clean, 1 for warnings, and 2 for failures."
  }
  if (topic === "coordination") {
    return [
      "Usage: discord-mcp coordination <action> [options]",
      "",
      "Actions:",
      "  list [--config FILE | --profile NAME] [--json]",
      "  resolve CLAIM_ID --confirm CLAIM_ID [--config FILE | --profile NAME] [--json]",
      "",
      "Inspect content-free reviewed-write claims for one selected policy without resolving credentials or contacting Discord. Stop the owning process and inspect Discord before resolving a claim that requires review.",
    ].join("\n")
  }
  if (topic === "setup") {
    return "Usage: discord-mcp setup (--config FILE | --profile NAME) [--preset PRESET --guild-id ID... [--channel-id ID...] [--token-env VARIABLE | --token-file FILE] [--force]] [--name NAME] [--command COMMAND] [--json]\n\nVerify one schema-v2 policy, optionally create it from an exact-scope read-only preset, and print a credential-free portable stdio launch descriptor."
  }
  if (topic === "smoke") {
    return "Usage: discord-mcp smoke (--config FILE | --profile NAME) [--json]\n\nNegotiate through the MCP adapter, validate tool, resource, and prompt contracts, and call only the read-only connector status tool. Pass --config for normal operation; the non-secret DISCORD_MCP_CONFIG_FILE selector is available for hosts that cannot supply arguments."
  }
  if (topic === "serve") {
    return "Usage: discord-mcp serve (--config FILE | --profile NAME)\n\nRun the local stdio MCP server. This is also the default command. Pass --config for normal operation; the non-secret DISCORD_MCP_CONFIG_FILE selector is available for hosts that cannot supply arguments."
  }
  if (topic === "profile") {
    return [
      "Usage: discord-mcp profile <action> [options]",
      "",
      "Actions:",
      "  list [--json]",
      "  show NAME [--json]",
      "  remove NAME --confirm NAME [--json]",
      "  restore NAME --confirm NAME [--json]",
      "",
      "Inspect profiles without credentials or Discord access. Removal is recoverable and never revokes the external credential.",
    ].join("\n")
  }
  if (topic === "preset") {
    return [
      "Usage: discord-mcp preset <action> [options]",
      "",
      "Actions:",
      "  list [--json]",
      "  show NAME [--json]",
      "  install NAME --application-id ID --guild-id ID [--html FILE] [--json]",
      "",
      "Inspect deterministic least-privilege setup presets or generate a callback-free, guild-locked bot installation plan without credentials or Discord access.",
    ].join("\n")
  }
  if (topic === "recipe") {
    return [
      "Usage: discord-mcp recipe <action> [options]",
      "",
      "Actions:",
      "  list [--json]",
      "  show NAME [--json]",
      "  plan NAME FILE (--guild-id ID... | --channel-id ID...) [--json]",
      "  apply NAME FILE (--guild-id ID... | --channel-id ID...) --plan-digest DIGEST --confirm NAME [--json]",
      "",
      "Review and add one bounded write workflow to an existing strict policy. Planning and application do not resolve secrets or contact Discord. Application recomputes the exact plan, rejects concurrent source changes, and preserves a recoverable backup.",
    ].join("\n")
  }
  if (topic === "version") return "Usage: discord-mcp version\n\nPrint the package version."
  return [
    `Usage: ${CONNECTOR_NAME} <command> [options]`,
    "",
    "Commands:",
    "  activity  Review content-free write outcomes and durable claims",
    "  catalog  Inspect or verify the credential-free, execution-disabled MCP contract",
    "  config   Create, validate, inspect, and review one non-secret policy file",
    "  coordination  Inspect or resolve one policy's durable reviewed-write claims",
    "  serve    Run the stdio MCP server with a selected policy (default)",
    "  setup    Create or verify a policy and generate safe client configuration",
    "  preset   Inspect presets or generate an exact bot installation plan",
    "  profile  Inspect, recoverably remove, or restore non-secret profiles",
    "  recipe   Review and add a bounded workflow to an existing policy",
    "  doctor   Diagnose a selected policy and optional Discord access",
    "  smoke    Verify the read-only MCP path end to end",
    "  version  Print the package version",
    "  help     Show command help",
  ].join("\n")
}

function renderCatalog(report: DiscordCatalogCheckReport): string {
  const riskClasses = Object.entries(report.riskClassCounts)
    .map(([risk, count]) => `${risk}=${count}`)
    .join(", ")
  const restMethods = Object.entries(report.restMethodCounts)
    .map(([method, count]) => `${method}=${count}`)
    .join(", ")
  return [
    "Discord MCP catalog: ok",
    `Server: ${report.serverName}@${report.serverVersion}`,
    `Evidence format: ${report.evidenceFormat}`,
    `Contract digest: ${report.contractDigest}`,
    `Safety resource digest: ${report.safetyResourceDigest}`,
    `Plan review app HTML digest: ${report.planReviewApp.htmlDigest}`,
    `Plan review app resource digest: ${report.planReviewApp.resourceDigest}`,
    `Plan review app linkage: ${report.planReviewApp.linkedToolCount} model-visible plan tools`,
    "Plan review app authority: display-only, no external network, permissions, or server tools",
    `Tools: ${report.toolCount}`,
    `Toolsets: ${report.toolsetNames.length}`,
    `Risk classes: ${riskClasses}`,
    `Prompts: ${report.promptCount}`,
    `Resources: ${report.resourceCount}`,
    `Resource templates: ${report.resourceTemplateCount}`,
    `Discord REST operations: ${report.restOperationCount} (${restMethods})`,
    `Execution guard: ${report.executionGuard}`,
    "Credentials required: no",
    "Discord execution: disabled",
    "Gateway: disabled",
    "Observability export: disabled",
    "Activity records created: no",
  ].join("\n")
}

function renderCatalogHtmlExport(report: DiscordCatalogHtmlExportReport): string {
  return [
    "Discord MCP catalog HTML: ok",
    `File: ${report.file}`,
    `Format: ${report.format}`,
    `Contract digest: ${report.contractDigest}`,
    `Tools: ${report.toolCount}`,
    `Bytes: ${report.bytes}`,
    "Credentials required: no",
    "Discord execution: disabled",
    "Activity records created: no",
  ].join("\n")
}

function renderActivityReview(report: DiscordActivityReviewReport): string {
  const lines = [
    `Discord MCP activity review: ${report.outcome}`,
    `Report digest: ${report.reportDigest}`,
    `Recent records: ${report.summary.records} (limit ${report.limit})`,
    `Current activities: ${report.summary.currentActivities}`,
    `Activities needing attention: ${report.summary.attentionActivities}`,
    `Durable claims: ${report.claims.length} (${report.summary.reviewRequiredClaims} review required, ${report.summary.unmatchedClaims} without recent activity)`,
    `Skipped recent lines: ${report.skippedLines}`,
    `Snapshot consistency: ${report.snapshotConsistency}`,
    "Credentials read: no",
    "Discord contacted: no",
    "Activity/coordination state changed: no",
    "Activity-file path exposed: no",
  ]
  if (report.records.length === 0) {
    lines.push("", "No content-free write activity exists in this recent window.")
  } else {
    lines.push("", "Recent activity lifecycles (newest first):")
    for (const record of report.records) {
      lines.push(
        `${record.current ? "CURRENT" : "HISTORY"} ${record.entry.timestamp} ${record.entry.kind}/${record.entry.status} [${record.disposition}]`,
        `  Activity: ${record.entry.id}`,
        `  Claims: ${record.claimIds.length > 0 ? record.claimIds.join(", ") : "none in recent correlation"}`,
        `  Next: ${record.guidance}`,
        `  Evidence: ${JSON.stringify(record.entry)}`,
      )
    }
  }
  if (report.claims.length === 0) {
    lines.push("", "Durable claims: none")
  } else {
    lines.push("", "Durable claims:")
    for (const claim of report.claims) {
      lines.push(
        `${claim.state.toUpperCase()} ${claim.claimId} ${claim.kind}`,
        `  Owner: ${claim.ownerState} / PID ${claim.ownerPid}`,
        `  Receipt: ${claim.receiptState}`,
        `  Targets: ${JSON.stringify(claim.targets)}`,
        `  Recent activity correlation: ${report.unmatchedClaimIds.includes(claim.claimId) ? "none in bounded window" : "matched by operation-key hash and plan digest"}`,
        `  Next: ${claim.state === "review-required" ? "Stop the owner, inspect exact Discord state and audit log, then use coordination resolve with exact confirmation" : claim.state === "active" ? "Do not interfere with or retry the active operation" : "A later writer may reclaim only through existing safe receipt evidence"}`,
      )
    }
  }
  if (report.skippedLines > 0) {
    lines.push(
      "",
      "WARNING: Recent non-empty journal lines failed the strict content-free schema. Treat this review as incomplete.",
    )
  }
  return lines.join("\n")
}

function renderActivityHtmlExport(
  report: DiscordActivityHtmlExportReport,
): string {
  return [
    "Discord MCP activity HTML: ok",
    `File: ${report.file}`,
    `Format: ${report.format}`,
    `Review digest: ${report.reportDigest}`,
    `HTML digest: ${report.htmlDigest}`,
    `Bytes: ${report.bytes}`,
    "Output file created: yes",
    "Credentials embedded: no",
    "Automatic network: disabled",
    "Browser opened: no",
    "Activity state changed: no",
    "State persistence: disabled",
  ].join("\n")
}

function renderDoctor(report: DoctorReport): string {
  const lines = [`Discord MCP doctor: ${report.status}`]
  for (const entry of report.checks) {
    lines.push(`${entry.status.toUpperCase()} ${entry.id}: ${entry.summary}`)
    if (entry.action) lines.push(`  Next: ${entry.action}`)
    if (entry.reference) lines.push(`  See: ${entry.reference}`)
  }
  return lines.join("\n")
}

function cliErrorReport(
  message: string,
  guidance: CliFailureGuidance,
): CliErrorReport {
  return {
    error: {
      category: guidance.category,
      message,
      recovery: guidance.recovery,
      ...(guidance.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: guidance.retryAfterMs }),
    },
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: "error",
  }
}

function renderCliFailure(
  message: string,
  guidance: CliFailureGuidance,
): string {
  return [
    `${CONNECTOR_NAME}: ${message}`,
    `Next: ${guidance.recovery.action}`,
    `See: ${guidance.recovery.reference}`,
  ].join("\n")
}

function requestsJson(
  args: readonly string[],
  parsed: ParsedCliArguments | undefined,
): boolean {
  if (parsed) return "json" in parsed && parsed.json
  return args.includes("--json")
}

function failureExitCode(
  parsed: ParsedCliArguments | undefined,
): typeof CLI_EXIT_CODES.failure | typeof CLI_EXIT_CODES.warning {
  if (parsed?.command === "serve") return CLI_EXIT_CODES.warning
  if (parsed?.command === "catalog" && !parsed.check) return CLI_EXIT_CODES.warning
  return CLI_EXIT_CODES.failure
}

function renderCoordinationList(report: WriteCoordinationList): string {
  if (report.claims.length === 0) {
    return "No active Discord write coordination claims"
  }
  return report.claims.map((claim) => [
    `${claim.claimId}: ${claim.state}`,
    `  Operation: ${claim.kind}`,
    `  Owner: PID ${claim.ownerPid} (${claim.ownerState})`,
    `  Receipt: ${claim.receiptState}`,
    `  Created: ${claim.createdAt}`,
    `  Targets: ${JSON.stringify(claim.targets)}`,
  ].join("\n")).join("\n")
}

function renderCoordinationResolution(report: WriteCoordinationResolution): string {
  const result = report.status === "resolved"
    ? `Resolved Discord write claim ${report.claimId}`
    : `Discord write claim ${report.claimId} was already resolved`
  return [
    result,
    `Released targets: ${report.releasedTargetCount}`,
    "The immutable operation receipt and operation-key reservation were not removed.",
  ].join("\n")
}

function renderSetup(report: SetupReport): string {
  const lines = [
    `Discord MCP setup verified application ${report.applicationId} and bot ${report.botId}`,
    `Accessible guilds on first page: ${report.guildsAccessibleOnFirstPage}`,
    `In-scope guilds on first page: ${report.guildsInScopeOnFirstPage}`,
    `Tool surface: ${report.toolSurface}`,
    `Toolsets: ${report.toolsets.join(", ")}`,
  ]
  if (report.preset) {
    lines.push(
      `Preset: ${report.preset.name}`,
      `Preset tools: ${report.preset.toolNames.length} read-only`,
      "Preset Gateway: disabled",
    )
  }
  if (report.profile) {
    lines.push(`Profile: ${report.profile.name}`)
  }
  if (report.configFile) {
    lines.push(`Configuration: ${report.configFile}`)
  }
  if (report.configBackupFile) {
    lines.push(`Previous configuration backup: ${report.configBackupFile}`)
  }
  if (report.profile || report.configFile) {
    lines.push(report.credential.provider === "environment"
      ? `Credential environment variable: ${report.credential.variable}`
      : `Credential file: ${report.credential.path}`)
  }
  for (const warning of report.warnings) lines.push(`WARNING: ${warning}`)
  lines.push(
    "",
    "Portable stdio launch descriptor:",
    "",
    JSON.stringify(report.launch, null, 2),
    "",
    "The descriptor names exact secret inputs but includes no secret value",
    "Translate the requirements into the MCP host's required-server, write-approval, elicitation, and timeout settings.",
  )
  return lines.join("\n")
}

interface PresetListReport {
  presets: readonly SetupPresetDescriptor[]
  schemaVersion: number
  status: "ok"
}

interface PresetShowReport {
  preset: SetupPresetDescriptor
  schemaVersion: number
  status: "ok"
}

function renderPreset(preset: SetupPresetDescriptor): string {
  const privilegedIntents = preset.requirements.privilegedIntents.length === 0
    ? "none"
    : preset.requirements.privilegedIntents
      .map((intent) => `${intent.name} (${intent.status})`)
      .join(", ")
  return [
    `${preset.name}${preset.recommended ? " (recommended)" : ""}`,
    `  ${preset.description}`,
    `  Scope: guild IDs ${preset.requirements.guildIds}; channel IDs ${preset.requirements.channelIds}`,
    `  Thread scope: ${preset.requirements.threadScope}`,
    `  Message Content intent: ${preset.requirements.messageContentIntent}`,
    `  Bot permissions: ${preset.requirements.botPermissions.join(", ")} (${preset.requirements.botPermissionBitfield})`,
    `  Privileged intents: ${privilegedIntents}`,
    `  Tool surface: ${preset.toolSurface}`,
    `  Toolsets: ${preset.toolsets.join(", ")}`,
    `  Tools (${preset.toolNames.length}): ${preset.toolNames.join(", ")}`,
    `  Risk classes: ${preset.riskClasses.join(", ")}`,
    "  Writes: disabled",
    "  Gateway: disabled",
  ].join("\n")
}

function renderBotInstallPlan(report: BotInstallPlan): string {
  const intents = report.privilegedIntents.length === 0
    ? "none required for this preset"
    : report.privilegedIntents
      .map((intent) => `${intent.name} (${intent.status})`)
      .join(", ")
  const [setup, validate, doctor, smoke] = report.postInstall.commands
  return [
    `Discord MCP bot install plan: ${report.preset.name}`,
    `Application: ${report.applicationId}`,
    `Guild: ${report.guildId} (selection locked)`,
    `Bot permissions: ${report.permissions.names.join(", ")} (${report.permissions.bitfield})`,
    "Administrator: not requested",
    `Privileged intents: ${intents}`,
    "Authorization: guild install, bot scope only, no callback or user token",
    "",
    "1. In the Discord Developer Portal, enable Guild Install and keep Public Bot disabled unless you intend to share this application.",
    `2. Review privileged intents: ${intents}.`,
    "3. Open this callback-free, guild-locked URL and approve only the permissions listed above:",
    report.installUrl,
    `4. Store the bot token as ${report.postInstall.credentialVariable} in a secret-capable MCP host setting. Never put its value in the config file or command line.`,
    `5. ${report.preset.name === "channel-reader" ? "Replace CHANNEL_ID, then run" : "Run"} verified setup to create the strict non-secret policy file:`,
    `   ${setup}`,
    "6. Validate the file, verify Discord identity and access, then exercise the read-only MCP path:",
    `   ${validate}`,
    `   ${doctor}`,
    `   ${smoke}`,
    "",
    "Discord was not contacted and no browser was opened. Guild roles and channel overrides determine effective access; online doctor is the post-install authority.",
  ].join("\n")
}

function renderOnboardingHtmlExport(
  report: DiscordOnboardingHtmlExportReport,
): string {
  return [
    "Discord MCP onboarding HTML: ok",
    `File: ${report.file}`,
    `Format: ${report.format}`,
    `Plan digest: ${report.planDigest}`,
    `HTML digest: ${report.htmlDigest}`,
    `Bytes: ${report.bytes}`,
    "Credentials embedded: no",
    "Automatic network: disabled",
    "Browser opened: no",
    "State persistence: disabled",
  ].join("\n")
}

function renderPresetList(report: PresetListReport): string {
  return [
    "Discord MCP least-privilege setup presets",
    "",
    ...report.presets.flatMap((preset, index) => [
      ...(index > 0 ? [""] : []),
      renderPreset(preset),
    ]),
  ].join("\n")
}

interface RecipeListReport {
  recipes: readonly ConfigRecipeDescriptor[]
  schemaVersion: number
  status: "ok"
}

interface RecipeShowReport {
  recipe: ConfigRecipeDescriptor
  schemaVersion: number
  status: "ok"
}

function renderRecipe(recipe: ConfigRecipeDescriptor): string {
  const privilegedIntents = recipe.requirements.privilegedIntents.length === 0
    ? "none"
    : recipe.requirements.privilegedIntents
      .map((intent) => `${intent.name} (${intent.status})`)
      .join(", ")
  const gatewayEvidence = recipe.requirements.gateway.evidenceConnection === "none"
    ? `none; event-feed policy ${recipe.requirements.gateway.eventFeedPolicy}`
    : `${recipe.requirements.gateway.evidenceConnection} with ${recipe.requirements.gateway.intents.join(", ")}; event-feed policy ${recipe.requirements.gateway.eventFeedPolicy}`
  return [
    recipe.name,
    `  ${recipe.description}`,
    `  Scope input: ${recipe.requirements.scope.option} (${recipe.requirements.scope.minimum}-${recipe.requirements.scope.maximum})`,
    `  Outer boundary: ${recipe.requirements.scope.outerBoundary}`,
    `  Added scopes: ${recipe.requirements.scope.targets.join(", ")}`,
    `  Bot permissions: ${recipe.requirements.botPermissions.join(", ")} (${recipe.requirements.botPermissionBitfield})`,
    `  Privileged intents: ${privilegedIntents}`,
    `  Gateway evidence: ${gatewayEvidence}`,
    `  Toolsets: ${recipe.toolsets.join(", ")}`,
    `  Tools (${recipe.toolNames.length}): ${recipe.toolNames.join(", ")}`,
    `  Risk classes: ${recipe.riskClasses.join(", ")}`,
    "  Writes: enabled only through the underlying reviewed workflow gates",
    "  Risks:",
    ...recipe.risks.map((risk) => `    - ${risk}`),
    "  Warnings:",
    ...recipe.warnings.map((warning) => `    - ${warning}`),
  ].join("\n")
}

function renderRecipeList(report: RecipeListReport): string {
  return [
    "Discord MCP additive configuration recipes",
    "",
    ...report.recipes.flatMap((recipe, index) => [
      ...(index > 0 ? [""] : []),
      renderRecipe(recipe),
    ]),
  ].join("\n")
}

function renderRecipePlan(
  report: ConfigRecipePlanReport | ConfigRecipeApplyReport,
): string {
  const scope = report.request.scope
  const changes = report.changes.length === 0
    ? ["  none"]
    : report.changes.map((change) => (
        `  ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
      ))
  const nextChecks = report.nextChecks.map((next) => (
    `  ${JSON.stringify({ args: next.args, command: next.command })}`
  ))
  const applied = report.action === "apply" ? report : undefined
  return [
    `Discord MCP configuration recipe ${report.action}: ${report.recipe.name} (${report.status})`,
    `File: ${report.file}`,
    `Exact ${scope.kind} scope: ${scope.ids.join(", ")}`,
    `Current document digest: ${report.currentDocumentDigest}`,
    `Proposed document digest: ${report.proposedDocumentDigest}`,
    `Recipe contract digest: ${report.recipeContractDigest}`,
    `Plan digest: ${report.planDigest}`,
    `Required confirmation: ${report.confirmation.requiredValue}`,
    `Configuration written: ${report.execution.configurationWritten ? "yes" : "no"}`,
    ...(applied?.backupFile
      ? [`Recoverable prior version: ${applied.backupFile}`]
      : []),
    `Bot permissions: ${report.recipe.requirements.botPermissions.join(", ")} (${report.recipe.requirements.botPermissionBitfield})`,
    `Privileged intents: ${report.recipe.requirements.privilegedIntents.length === 0
      ? "none"
      : report.recipe.requirements.privilegedIntents
        .map((intent) => `${intent.name} (${intent.status})`)
        .join(", ")}`,
    `Gateway evidence: ${report.recipe.requirements.gateway.evidenceConnection === "none"
      ? `none; event-feed policy ${report.recipe.requirements.gateway.eventFeedPolicy}`
      : `${report.recipe.requirements.gateway.evidenceConnection} with ${report.recipe.requirements.gateway.intents.join(", ")}; event-feed policy ${report.recipe.requirements.gateway.eventFeedPolicy}`}`,
    "Changes:",
    ...changes,
    "Risks:",
    ...report.risks.map((risk) => `  - ${risk}`),
    "Warnings:",
    ...report.warnings.map((warning) => `  - ${warning}`),
    "",
    "Complete proposed non-secret configuration:",
    JSON.stringify(report.proposedDocument, null, 2),
    "",
    "Post-application checks as structured commands:",
    ...nextChecks,
    "",
    "No secret value was read and Discord was not contacted.",
  ].join("\n")
}

interface ProfileSummary {
  applicationId: string
  botId: string
  channelCount: number
  credentialProvider: "environment" | "file"
  credentialReference: string
  gatewayEnabled: boolean
  guildCount: number
  name: string
  toolsets: string[]
  toolSurface: string
}

interface ProfileListReport {
  profiles: ProfileSummary[]
  schemaVersion: number
  status: "ok"
}

interface ProfileShowReport {
  profile: ConnectorProfile
  schemaVersion: number
  status: "ok"
}

interface ProfileActionReport {
  action: "remove" | "restore"
  credentialUnaffected: true
  name: string
  recoverable?: true
  schemaVersion: number
  status: "ok"
}

function profileSummary(profile: ConnectorProfile): ProfileSummary {
  return {
    applicationId: profile.identity.applicationId,
    botId: profile.identity.botId,
    channelCount: profile.readScope.channelIds.length,
    credentialProvider: profile.credential.provider,
    credentialReference: profile.credential.provider === "environment"
      ? profile.credential.variable
      : profile.credential.path,
    gatewayEnabled: profile.gateway.enabled,
    guildCount: profile.readScope.guildIds.length,
    name: profile.name,
    toolsets: [...profile.tools.toolsets],
    toolSurface: profile.tools.surface,
  }
}

function renderProfileList(report: ProfileListReport): string {
  if (report.profiles.length === 0) return "No saved Discord MCP profiles"
  return report.profiles.map((profile) => (
    `${profile.name}: application ${profile.applicationId}, bot ${profile.botId}, ${profile.guildCount} guilds, ${profile.channelCount} channels, ${profile.toolSurface} tools, Gateway ${profile.gatewayEnabled ? "enabled" : "disabled"}, credential ${profile.credentialProvider} ${profile.credentialReference}`
  )).join("\n")
}

function renderProfileShow(report: ProfileShowReport): string {
  return [
    `Discord MCP profile: ${report.profile.name}`,
    JSON.stringify(report.profile, null, 2),
  ].join("\n\n")
}

function renderProfileAction(report: ProfileActionReport): string {
  const lifecycle = report.action === "remove"
    ? `Profile ${report.name} moved to recoverable trash`
    : `Profile ${report.name} restored from recoverable trash`
  return [
    lifecycle,
    "The referenced external credential and Discord token were not modified or revoked.",
  ].join("\n")
}

function renderConfigSummary(report: ConfigValidationReport): string {
  const summary = report.summary
  const configuredScopes = summary.scopesConfigured.length > 0
    ? summary.scopesConfigured
      .map((entry) => `${entry.name}=${entry.count}`)
      .join(", ")
    : "none"
  return [
    `Configuration: ${summary.name}`,
    `File: ${report.file}`,
    `Document schema: ${summary.configSchemaVersion}`,
    `Application: ${summary.identity.applicationId}`,
    `Bot: ${summary.identity.botId}`,
    `Guild scope: ${summary.readScope.guildIds.join(", ")}`,
    `Channel scope: ${summary.readScope.channelIds.join(", ") || "all visible channels in scope"}`,
    `Tool surface: ${summary.tools.surface}`,
    `Toolsets: ${summary.tools.toolsets.join(", ")}`,
    `Gateway: ${summary.gateway.enabled ? "enabled" : "disabled"}`,
    `Credential: ${summary.credential.provider} ${summary.credential.provider === "environment" ? summary.credential.variable : summary.credential.path}`,
    `Enabled capabilities: ${summary.capabilitiesEnabled.join(", ") || "none"}`,
    `Configured feature scopes: ${configuredScopes}`,
    `Referenced secret environment variables: ${summary.secretEnvironmentVariables.join(", ") || "none"}`,
    `Referenced secret files: ${summary.secretFilePaths.join(", ") || "none"}`,
  ].join("\n")
}

function renderConfigValidation(report: ConfigValidationReport): string {
  return [
    "Discord MCP configuration: valid",
    renderConfigSummary(report),
    "Validation used placeholders, read no secret values, and did not contact Discord.",
  ].join("\n")
}

function renderConfigShow(report: ConfigShowReport): string {
  return [
    renderConfigValidation(report),
    "",
    JSON.stringify(report.document, null, 2),
  ].join("\n")
}

function renderConfigExplain(report: ConfigExplainReport): string {
  return [
    `Discord MCP configuration fields: ${report.query}`,
    `Schema: ${report.schemaId}`,
    "Operational policy source: one selected schema-v2 configuration document",
    "Secret values: external references only; never stored in the policy document",
    "",
    ...report.fields.flatMap((field, index) => [
      ...(index > 0 ? [""] : []),
      field.path,
      `  ${field.description}`,
      `  Type: ${field.kind}`,
      `  Required: ${field.required ? "yes" : "no"}`,
      `  Default: ${field.defaultValue === undefined ? "none" : JSON.stringify(field.defaultValue)}`,
    ]),
  ].join("\n")
}

function renderConfigWrite(report: ConfigWriteReport): string {
  const result = report.created ? "created" : "replaced"
  return [
    `Discord MCP configuration ${result}: ${report.file}`,
    `Source: ${report.source}`,
    ...(report.backupFile
      ? [`Recoverable prior version: ${report.backupFile}`]
      : []),
    renderConfigSummary(report),
    "",
    "Next: Run discord-mcp doctor --config with the file path shown above.",
  ].join("\n")
}

function renderConfigChange(
  report: ConfigChangePlanReport | ConfigChangeApplyReport,
): string {
  const changes = report.changes.length === 0
    ? ["  none"]
    : report.changes.flatMap((change) => [
        `  ${change.path} [${change.category}; ${change.impact}]`,
        `    Before: ${JSON.stringify(change.before)}`,
        `    After: ${JSON.stringify(change.after)}`,
      ])
  const addedTools = report.tools.added.length > 0
    ? report.tools.added.join(", ")
    : "none"
  const removedTools = report.tools.removed.length > 0
    ? report.tools.removed.join(", ")
    : "none"
  return [
    `Discord MCP configuration change ${report.action}: ${report.status}`,
    `Active file: ${report.file}`,
    `Candidate file: ${report.candidateFile}`,
    `Current document digest: ${report.currentDocumentDigest}`,
    `Candidate document digest: ${report.candidateDocumentDigest}`,
    `Plan digest: ${report.planDigest}`,
    `Required confirmation: ${report.confirmation.requiredValue}`,
    `Configuration written: ${report.execution.configurationWritten ? "yes" : "no"}`,
    ...(report.action === "apply" && report.backupFile
      ? [`Recoverable prior version: ${report.backupFile}`]
      : []),
    `Impact: expansions=${report.impact.authorityExpansions}, reductions=${report.impact.authorityReductions}, redistributions=${report.impact.authorityRedistributions}, operational=${report.impact.operationalChanges}, metadata=${report.impact.metadataOnly}`,
    `Canonical tools added: ${addedTools}`,
    `Canonical tools removed: ${removedTools}`,
    "Changes:",
    ...changes,
    "Warnings:",
    ...report.warnings.map((warning) => `  - ${warning}`),
    "",
    "Complete candidate non-secret configuration:",
    JSON.stringify(report.candidateDocument, null, 2),
    "",
    "Post-application checks as structured commands:",
    ...report.nextChecks.map((next) => (
      `  ${JSON.stringify({ args: next.args, command: next.command })}`
    )),
    "",
    "No secret value was read and Discord was not contacted.",
  ].join("\n")
}

function renderSmoke(report: SmokeReport): string {
  return [
    "Discord MCP smoke: ok",
    `Application: ${report.applicationId}`,
    `Bot: ${report.botId}`,
    `Tool surface: ${report.toolSurface}`,
    `Toolsets: ${report.toolsets.join(", ")}`,
    `Tools: ${report.toolCount}`,
    `Read-only tools: ${report.readOnlyTools.join(", ")}`,
    `Destructive tools: ${report.destructiveTools.join(", ")}`,
    `Resources: ${report.resourceUris.join(", ")}`,
    `Resource templates: ${report.resourceTemplateUris.join(", ")}`,
    `Prompts: ${report.promptNames.join(", ")}`,
  ].join("\n")
}

function safeWrite(
  stream: Pick<NodeJS.WriteStream, "write">,
  value: string,
  environment: NodeJS.ProcessEnv,
): void {
  const secrets = Object.entries(environment)
    .filter(([name]) => DISCORD_TOKEN_ENVIRONMENT_PATTERN.test(name))
    .flatMap(([, token]) => [token, token?.trim()])
  stream.write(`${redactText(value, secrets)}\n`)
}

function jsonReport(value: object): string {
  return JSON.stringify(value, null, 2)
}

function configSelectionEnvironment(
  file: string | undefined,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!file) return environment
  if (!file.trim() || file.includes("\0")) {
    throw new ConfigurationError("Option --config requires a valid file path")
  }
  const selected = resolve(file)
  const ambient = environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
  if (ambient && resolve(ambient) !== selected) {
    throw new ConfigurationError(
      `Option --config conflicts with ${CONFIG_FILE_ENVIRONMENT_VARIABLE}`,
    )
  }
  return {
    ...environment,
    [CONFIG_FILE_ENVIRONMENT_VARIABLE]: selected,
  }
}

const CONFIG_SELECTION_REQUIRED_MESSAGE =
  "Operational commands require --config FILE, --profile NAME, or DISCORD_MCP_CONFIG_FILE; create a policy with discord-mcp config init or setup --preset"

interface RuntimeSelection {
  config: ConnectorConfig
  environment: NodeJS.ProcessEnv
}

interface DoctorSelection {
  document?: ConnectorConfigDocument
  environment: NodeJS.ProcessEnv
  selectionFailure?: unknown
}

async function runtimeSelection(
  selection: { configFile?: string; profileName?: string },
  environment: NodeJS.ProcessEnv,
  dependencies: CliDependencies,
): Promise<RuntimeSelection> {
  if (selection.profileName) {
    const activated = await dependencies.activateProfile(selection.profileName, { environment })
    return { config: activated.config, environment }
  }
  const selected = configSelectionEnvironment(selection.configFile, environment)
  if (!selected[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()) {
    throw new RuntimeConfigurationRequiredError(CONFIG_SELECTION_REQUIRED_MESSAGE)
  }
  return {
    config: dependencies.loadConfig(selected),
    environment: selected,
  }
}

async function doctorSelection(
  selection: { configFile?: string; profileName?: string },
  environment: NodeJS.ProcessEnv,
  dependencies: CliDependencies,
): Promise<DoctorSelection> {
  if (selection.profileName) {
    if (environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()) {
      throw new ConfigurationError(
        `Option --profile conflicts with ${CONFIG_FILE_ENVIRONMENT_VARIABLE}`,
      )
    }
    try {
      return {
        document: await dependencies.loadProfile(selection.profileName, { environment }),
        environment,
      }
    } catch (error) {
      return { environment, selectionFailure: error }
    }
  }
  const selected = configSelectionEnvironment(selection.configFile, environment)
  const file = selected[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
  if (!file) throw new RuntimeConfigurationRequiredError(CONFIG_SELECTION_REQUIRED_MESSAGE)
  try {
    return {
      document: dependencies.loadConfigDocument(file),
      environment: selected,
    }
  } catch (error) {
    return { environment: selected, selectionFailure: error }
  }
}

async function selectedActivityFile(
  selection: { configFile?: string; profileName?: string },
  environment: NodeJS.ProcessEnv,
  dependencies: CliDependencies,
): Promise<string> {
  let document: ConnectorConfigDocument
  if (selection.profileName) {
    if (environment[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()) {
      throw new ConfigurationError(
        `Option --profile conflicts with ${CONFIG_FILE_ENVIRONMENT_VARIABLE}`,
      )
    }
    const profile = await dependencies.loadProfile(selection.profileName, { environment })
    document = profile
  } else {
    const selected = configSelectionEnvironment(selection.configFile, environment)
    const file = selected[CONFIG_FILE_ENVIRONMENT_VARIABLE]?.trim()
    if (!file) throw new RuntimeConfigurationRequiredError(CONFIG_SELECTION_REQUIRED_MESSAGE)
    document = dependencies.showConfig(file).document
  }
  return resolveConnectorConfigDocumentAuditFile(document, environment)
}

export async function runCli(options: CliOptions = {}): Promise<number> {
  const args = options.args || process.argv.slice(2)
  const environment = options.environment || process.env
  const stdout = options.stdout || process.stdout
  const stderr = options.stderr || process.stderr
  const dependencies = options.dependencies || DEFAULT_DEPENDENCIES
  let parsed: ParsedCliArguments | undefined
  try {
    parsed = parseCliArguments(args)
    switch (parsed.command) {
      case "activity": {
        const activityFile = await selectedActivityFile(
          parsed,
          environment,
          dependencies,
        )
        const report = await dependencies.reviewActivity(
          activityFile,
          parsed.limit,
        )
        const html = parsed.htmlFile
          ? await dependencies.exportActivityHtml(parsed.htmlFile, report)
          : undefined
        safeWrite(
          stdout,
          parsed.json
            ? jsonReport({ ...report, ...(html ? { html } : {}) })
            : [
                renderActivityReview(report),
                ...(html ? [renderActivityHtmlExport(html)] : []),
              ].join("\n\n"),
          environment,
        )
        return report.outcome === "attention"
          ? CLI_EXIT_CODES.warning
          : CLI_EXIT_CODES.success
      }
      case "catalog": {
        if (parsed.htmlFile) {
          const report = await dependencies.exportCatalogHtml(parsed.htmlFile)
          safeWrite(stdout, renderCatalogHtmlExport(report), environment)
          return CLI_EXIT_CODES.success
        }
        if (!parsed.check) {
          dependencies.catalog({ stderr })
          return CLI_EXIT_CODES.success
        }
        const report = await dependencies.checkCatalog()
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderCatalog(report), environment)
        return CLI_EXIT_CODES.success
      }
      case "doctor": {
        const diagnostic = await doctorSelection(
          parsed,
          environment,
          dependencies,
        )
        const report = await dependencies.diagnose({
          ...(diagnostic.document ? { document: diagnostic.document } : {}),
          environment: diagnostic.environment,
          ...(options.nodeVersion ? { nodeVersion: options.nodeVersion } : {}),
          online: parsed.online,
          ...(diagnostic.selectionFailure === undefined
            ? {}
            : { selectionFailure: diagnostic.selectionFailure }),
        })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderDoctor(report),
          diagnostic.environment,
        )
        if (report.status === "error") return CLI_EXIT_CODES.failure
        if (report.status === "warning") return CLI_EXIT_CODES.warning
        return CLI_EXIT_CODES.success
      }
      case "config": {
        if (parsed.action === "plan") {
          const report = dependencies.planConfigChange({
            candidateFile: parsed.candidateFile,
            file: parsed.file,
          })
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderConfigChange(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action === "apply") {
          const report = await dependencies.applyConfigChange({
            candidateFile: parsed.candidateFile,
            confirmation: parsed.confirmation,
            file: parsed.file,
            planDigest: parsed.planDigest,
          })
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderConfigChange(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action === "explain") {
          const report = dependencies.explainConfig(parsed.path)
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderConfigExplain(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action === "validate") {
          const report = dependencies.validateConfig(parsed.file)
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderConfigValidation(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action === "show") {
          const report = dependencies.showConfig(parsed.file)
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderConfigShow(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action !== "init") {
          throw new ConfigurationError("Unsupported config action")
        }
        const report = await dependencies.initializeConfig({
          applicationId: parsed.applicationId,
          botId: parsed.botId,
          channelIds: parsed.channelIds,
          ...(parsed.credentialFile
            ? { credentialFile: parsed.credentialFile }
            : {}),
          ...(parsed.credentialVariable
            ? { credentialVariable: parsed.credentialVariable }
            : {}),
          file: parsed.file,
          guildIds: parsed.guildIds,
          name: parsed.name,
          overwrite: parsed.overwrite,
          ...(parsed.preset ? { preset: parsed.preset } : {}),
        })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderConfigWrite(report),
          environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "coordination": {
        const activityFile = await selectedActivityFile(
          parsed,
          environment,
          dependencies,
        )
        const report = parsed.action === "list"
          ? await dependencies.listCoordination(activityFile)
          : await dependencies.resolveCoordination(
            activityFile,
            parsed.claimId,
            parsed.confirmation,
          )
        safeWrite(
          stdout,
          parsed.json
            ? jsonReport(report)
            : parsed.action === "list"
              ? renderCoordinationList(report as WriteCoordinationList)
              : renderCoordinationResolution(report as WriteCoordinationResolution),
          environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "help":
        safeWrite(stdout, helpText(parsed.topic), environment)
        return CLI_EXIT_CODES.success
      case "profile": {
        const location = { environment }
        if (parsed.action === "list") {
          const profiles = await dependencies.listProfiles(location)
          const report: ProfileListReport = {
            profiles: profiles.map(profileSummary),
            schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
            status: "ok",
          }
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderProfileList(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        const name = normalizeProfileName(parsed.name)
        if (parsed.action === "show") {
          const profile = await dependencies.loadProfile(name, location)
          const report: ProfileShowReport = {
            profile,
            schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
            status: "ok",
          }
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderProfileShow(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.confirmation !== name) {
          throw new ConfigurationError(
            `Confirmation must exactly match profile ${name}`,
          )
        }
        if (parsed.action === "remove") {
          await dependencies.trashProfile(name, location)
        } else {
          await dependencies.restoreProfile(name, location)
        }
        const report: ProfileActionReport = {
          action: parsed.action,
          credentialUnaffected: true,
          name,
          ...(parsed.action === "remove" ? { recoverable: true as const } : {}),
          schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
          status: "ok",
        }
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderProfileAction(report),
          environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "preset": {
        if (parsed.action === "install") {
          const report = createBotInstallPlan({
            applicationId: parsed.applicationId,
            guildId: parsed.guildId,
            preset: parsed.name,
          })
          const guide = parsed.htmlFile
            ? await dependencies.exportOnboardingHtml(parsed.htmlFile, report)
            : undefined
          safeWrite(
            stdout,
            parsed.json
              ? jsonReport({ ...report, ...(guide ? { guide } : {}) })
              : [
                  renderBotInstallPlan(report),
                  ...(guide ? [renderOnboardingHtmlExport(guide)] : []),
                ].join("\n\n"),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action === "list") {
          const report: PresetListReport = {
            presets: SETUP_PRESETS,
            schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
            status: "ok",
          }
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderPresetList(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        const report: PresetShowReport = {
          preset: getSetupPreset(parsed.name),
          schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
          status: "ok",
        }
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderPreset(report.preset),
          environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "recipe": {
        if (parsed.action === "list") {
          const report: RecipeListReport = {
            recipes: CONFIG_RECIPES,
            schemaVersion: CONFIG_RECIPE_REPORT_SCHEMA_VERSION,
            status: "ok",
          }
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderRecipeList(report),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        if (parsed.action === "show") {
          const report: RecipeShowReport = {
            recipe: getConfigRecipe(parsed.name),
            schemaVersion: CONFIG_RECIPE_REPORT_SCHEMA_VERSION,
            status: "ok",
          }
          safeWrite(
            stdout,
            parsed.json ? jsonReport(report) : renderRecipe(report.recipe),
            environment,
          )
          return CLI_EXIT_CODES.success
        }
        const selection = {
          channelIds: parsed.channelIds,
          file: parsed.file,
          guildIds: parsed.guildIds,
          name: parsed.name,
        }
        const report = parsed.action === "plan"
          ? dependencies.planRecipe(selection)
          : await dependencies.applyRecipe({
              ...selection,
              confirmation: parsed.confirmation,
              planDigest: parsed.planDigest,
            })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderRecipePlan(report),
          environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "serve":
        const runtime = await runtimeSelection(parsed, environment, dependencies)
        dependencies.serve({
          config: runtime.config,
          environment: runtime.environment,
          stderr,
        })
        return CLI_EXIT_CODES.success
      case "setup": {
        const entrypointPath = options.entrypointPath || process.argv[1]
        const defaultLauncher = entrypointPath
          ? {
            args: [entrypointPath, "serve"],
            command: options.executablePath || process.execPath,
          }
          : {
            args: ["serve"],
            command: CONNECTOR_NAME,
          }
        const report = await dependencies.prepareSetup({
          args: parsed.launcherCommand ? ["serve"] : defaultLauncher.args,
          command: parsed.launcherCommand || defaultLauncher.command,
          ...(parsed.configFile
            ? {
                configFile: parsed.configFile,
                overwriteConfig: parsed.overwrite,
              }
            : { overwriteProfile: parsed.overwrite }),
          ...(parsed.credentialVariable
            ? { credentialVariable: parsed.credentialVariable }
            : {}),
          ...(parsed.credentialFile
            ? { credentialFile: parsed.credentialFile }
            : {}),
          environment,
          ...(parsed.preset ? { preset: parsed.preset } : {}),
          ...(parsed.profileName ? { profileName: parsed.profileName } : {}),
          ...(parsed.serverName ? { serverName: parsed.serverName } : {}),
        })
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderSetup(report), environment)
        return report.warnings.length > 0
          ? CLI_EXIT_CODES.warning
          : CLI_EXIT_CODES.success
      }
      case "smoke": {
        const runtime = await runtimeSelection(
          parsed,
          environment,
          dependencies,
        )
        const report = await dependencies.smoke({
          config: runtime.config,
          environment: runtime.environment,
        })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderSmoke(report),
          runtime.environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "version":
        safeWrite(stdout, CONNECTOR_VERSION, environment)
        return CLI_EXIT_CODES.success
    }
  } catch (error) {
    const helpTopic = args[0] && isCommand(args[0]) ? args[0] : undefined
    const context = {
      ...(helpTopic ? { helpTopic } : {}),
      usage: parsed === undefined,
    }
    const guidance = classifyCliFailure(error, context)
    const message = safeCliFailureMessage(error, context)
    if (requestsJson(args, parsed)) {
      safeWrite(stdout, jsonReport(cliErrorReport(message, guidance)), environment)
    } else {
      safeWrite(stderr, renderCliFailure(message, guidance), environment)
    }
    return failureExitCode(parsed)
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runCli()
}
