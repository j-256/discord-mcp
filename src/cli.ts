#!/usr/bin/env node

import { resolve } from "node:path"

import {
  checkDiscordCatalog,
  runDiscordMcpCatalog,
  type DiscordCatalogCheckReport,
} from "./catalog.js"
import {
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
  ENVIRONMENT_NAMES,
} from "./constants.js"
import { resolveConnectorAuditFile } from "./config.js"
import {
  explainConnectorConfig,
  initializeConnectorConfigFile,
  migrateConnectorConfigFile,
  showConnectorConfigFile,
  validateConnectorConfigFile,
  type ConfigExplainReport,
  type ConfigInitOptions,
  type ConfigMigrateOptions,
  type ConfigShowReport,
  type ConfigValidationReport,
  type ConfigWriteReport,
} from "./config-operator.js"
import { ConfigurationError, redactText } from "./errors.js"
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
  "catalog",
  "config",
  "coordination",
  "doctor",
  "help",
  "preset",
  "profile",
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
  | { check: boolean; command: "catalog"; json: boolean }
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
    credentialVariable?: string
    file: string
    guildIds: string[]
    json: boolean
    name: string
    overwrite: boolean
    preset?: string
  }
  | {
    action: "migrate"
    command: "config"
    credentialVariable?: string
    file: string
    json: boolean
    name?: string
    overwrite: boolean
    profileName?: string
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
    json: boolean
  }
  | {
    action: "resolve"
    claimId: string
    command: "coordination"
    confirmation: string
    json: boolean
  }
  | { command: "doctor"; configFile?: string; json: boolean; online: boolean; profileName?: string }
  | { command: "help"; topic: CliCommand | undefined }
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
  | { command: "serve"; configFile?: string; profileName?: string }
  | {
    command: "setup"
    configFile?: string
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
  catalog(options: {
    stderr: Pick<NodeJS.WriteStream, "write">
  }): unknown
  checkCatalog(): Promise<DiscordCatalogCheckReport>
  diagnose(options: DoctorOptions): Promise<DoctorReport>
  explainConfig(path?: string): ConfigExplainReport
  initializeConfig(options: ConfigInitOptions): Promise<ConfigWriteReport>
  listCoordination(environment: NodeJS.ProcessEnv): Promise<WriteCoordinationList>
  listProfiles(options: ProfileLocationOptions): Promise<ConnectorProfile[]>
  loadProfile(name: string, options: ProfileLocationOptions): Promise<ConnectorProfile>
  migrateConfig(options: ConfigMigrateOptions): Promise<ConfigWriteReport>
  prepareSetup(options: SetupOptions): Promise<SetupReport>
  resolveCoordination(
    environment: NodeJS.ProcessEnv,
    claimId: string,
    confirmation: string,
  ): Promise<WriteCoordinationResolution>
  restoreProfile(name: string, options: ProfileLocationOptions): Promise<TrashedProfile>
  serve(options: {
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
  catalog: runDiscordMcpCatalog,
  checkCatalog: checkDiscordCatalog,
  diagnose: diagnoseConnector,
  explainConfig: explainConnectorConfig,
  initializeConfig: initializeConnectorConfigFile,
  listCoordination: async (environment) => {
    const auditFile = resolveConnectorAuditFile(environment)
    return new FileWriteCoordinator(
      writeCoordinationDirectory(auditFile),
      new FileOperationStore(operationReceiptDirectory(auditFile)),
    ).list()
  },
  listProfiles,
  loadProfile,
  migrateConfig: migrateConnectorConfigFile,
  prepareSetup,
  resolveCoordination: async (environment, claimId, confirmation) => {
    const auditFile = resolveConnectorAuditFile(environment)
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
    if (argument === "--token-env") credentialVariable = value
  }
  if (configFile && profileName) {
    throw new ConfigurationError("Options --config and --profile are mutually exclusive")
  }
  if (
    !configFile
    && !profileName
    && (
      credentialVariable !== undefined
      || overwrite
      || presetName !== undefined
      || guildIds.length > 0
      || channelIds.length > 0
    )
  ) {
    throw new ConfigurationError(
      "--token-env, --force, --preset, --guild-id, and --channel-id require --config or --profile",
    )
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
  if (!action || !["explain", "init", "migrate", "show", "validate"].includes(action)) {
    throw new ConfigurationError(
      "config requires explain, init, migrate, show, or validate",
    )
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
  let credentialVariable: string | undefined
  const guildIds: string[] = []
  let json = false
  let name: string | undefined
  let overwrite = false
  let preset: string | undefined
  let profileName: string | undefined
  const seen = new Set<string>()
  const allowed = action === "init"
    ? new Set([
      "--application-id",
      "--bot-id",
      "--channel-id",
      "--guild-id",
      "--name",
      "--preset",
      "--token-env",
    ])
    : new Set(["--name", "--profile", "--token-env"])
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument?.startsWith("--")) {
      throw new ConfigurationError(`Unexpected config ${action} argument ${argument || ""}`)
    }
    const repeatable = action === "init"
      && (argument === "--channel-id" || argument === "--guild-id")
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
    if (argument === "--profile") profileName = value
    if (argument === "--token-env") credentialVariable = value
  }

  if (action === "init") {
    if (!applicationId || !botId || !name || guildIds.length === 0) {
      throw new ConfigurationError(
        "config init requires --name, --application-id, --bot-id, and at least one --guild-id",
      )
    }
    return {
      action,
      applicationId,
      botId,
      channelIds,
      command: "config",
      ...(credentialVariable ? { credentialVariable } : {}),
      file,
      guildIds,
      json,
      name,
      overwrite,
      ...(preset ? { preset } : {}),
    }
  }

  if (profileName && (name || credentialVariable)) {
    throw new ConfigurationError(
      "config migrate --profile is mutually exclusive with --name and --token-env",
    )
  }
  if (!profileName && !name) {
    throw new ConfigurationError(
      "config migrate requires --name for environment migration or --profile",
    )
  }
  return {
    action: "migrate",
    command: "config",
    ...(credentialVariable ? { credentialVariable } : {}),
    file,
    json,
    ...(name ? { name } : {}),
    overwrite,
    ...(profileName ? { profileName } : {}),
  }
}

function parsePresetCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "preset" }> {
  const action = args[0]
  if (!action || !["list", "show"].includes(action)) {
    throw new ConfigurationError("preset requires list or show")
  }
  if (action === "list") {
    const options = parseBooleanOptions(args.slice(1), new Set(["--json"]))
    return { action, command: "preset", json: options.has("--json") }
  }
  const name = args[1]
  if (!name || name.startsWith("--")) {
    throw new ConfigurationError("preset show requires a preset name")
  }
  const options = parseBooleanOptions(args.slice(2), new Set(["--json"]))
  return {
    action: "show",
    command: "preset",
    json: options.has("--json"),
    name,
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

function parseCoordinationCommand(
  args: readonly string[],
): Extract<ParsedCliArguments, { command: "coordination" }> {
  const action = args[0]
  if (!action || !["list", "resolve"].includes(action)) {
    throw new ConfigurationError("coordination requires list or resolve")
  }
  if (action === "list") {
    const options = parseBooleanOptions(args.slice(1), new Set(["--json"]))
    return { action, command: "coordination", json: options.has("--json") }
  }
  const claimId = args[1]
  if (!claimId || claimId.startsWith("--")) {
    throw new ConfigurationError("coordination resolve requires a claim ID")
  }
  let confirmation: string | undefined
  let json = false
  const seen = new Set<string>()
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index]
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
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError("Option --confirm requires a value")
    }
    confirmation = value
    index += 1
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
    confirmation,
    json,
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
  if (command === "catalog") {
    const options = parseBooleanOptions(rest, new Set(["--check", "--json"]))
    const check = options.has("--check")
    const json = options.has("--json")
    if (json && !check) {
      throw new ConfigurationError("catalog --json requires --check")
    }
    return { check, command, json }
  }
  if (command === "config") return parseConfigCommand(rest)
  if (command === "coordination") return parseCoordinationCommand(rest)
  if (command === "setup") return parseSetupOptions(rest)
  if (command === "preset") return parsePresetCommand(rest)
  if (command === "profile") return parseProfileCommand(rest)
  const options = parseRuntimeSelectionOptions(rest, new Set(["--json"]))
  return {
    command: "smoke",
    ...(options.configFile ? { configFile: options.configFile } : {}),
    json: options.present.has("--json"),
    ...(options.profileName ? { profileName: options.profileName } : {}),
  }
}

function helpText(topic: CliCommand | undefined): string {
  if (topic === "catalog") {
    return "Usage: discord-mcp catalog [--check] [--json]\n\nAdvertise the exact production MCP catalog without credentials or execution. Add --check to verify and fingerprint the packaged contract; --json emits deterministic evidence and requires --check."
  }
  if (topic === "config") {
    return [
      "Usage: discord-mcp config <action> [options]",
      "",
      "Actions:",
      "  init FILE --name NAME --application-id ID --bot-id ID --guild-id ID... [--preset PRESET] [--channel-id ID...] [--token-env VARIABLE] [--force] [--json]",
      "  migrate FILE (--name NAME [--token-env VARIABLE] | --profile NAME) [--force] [--json]",
      "  validate FILE [--json]",
      "  show FILE [--json]",
      "  explain [PATH] [--json]",
      "",
      "Create, migrate, validate, and inspect strict non-secret configuration files. Validation does not read secret values or contact Discord. Replacement preserves a recoverable backup and cannot change the pinned Discord identity.",
    ].join("\n")
  }
  if (topic === "doctor") {
    return "Usage: discord-mcp doctor [--config FILE | --profile NAME] [--online] [--json]\n\nValidate the selected configuration and policy. Add --online to verify Discord identity and scoped guild access. Every warning or failure includes a next action and documentation reference. Exit status is 0 for clean, 1 for warnings, and 2 for failures."
  }
  if (topic === "coordination") {
    return [
      "Usage: discord-mcp coordination <action> [options]",
      "",
      "Actions:",
      "  list [--json]",
      "  resolve CLAIM_ID --confirm CLAIM_ID [--json]",
      "",
      "Inspect content-free reviewed-write claims without credentials or Discord access. Stop the owning process and inspect Discord before resolving a claim that requires review.",
    ].join("\n")
  }
  if (topic === "setup") {
    return "Usage: discord-mcp setup [--config FILE | --profile NAME] [--preset PRESET --guild-id ID... [--channel-id ID...]] [--token-env VARIABLE] [--force] [--name NAME] [--command COMMAND] [--json]\n\nVerify the bot, optionally apply an exact-scope read-only preset, save a standalone non-secret configuration or managed profile, and print a credential-free portable stdio launch descriptor."
  }
  if (topic === "smoke") {
    return "Usage: discord-mcp smoke [--config FILE | --profile NAME] [--json]\n\nNegotiate through the MCP adapter, validate tool, resource, and prompt contracts, and call only the read-only connector status tool."
  }
  if (topic === "serve") {
    return "Usage: discord-mcp serve [--config FILE | --profile NAME]\n\nRun the local stdio MCP server. This is also the default command."
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
      "",
      "Inspect deterministic least-privilege setup presets without credentials or Discord access.",
    ].join("\n")
  }
  if (topic === "version") return "Usage: discord-mcp version\n\nPrint the package version."
  return [
    `Usage: ${CONNECTOR_NAME} <command> [options]`,
    "",
    "Commands:",
    "  catalog  Inspect or verify the credential-free, execution-disabled MCP contract",
    "  config   Create, migrate, validate, and inspect one non-secret policy file",
    "  coordination  Inspect or resolve durable reviewed-write claims",
    "  serve    Run the stdio MCP server (default)",
    "  setup    Verify the bot and generate safe client configuration",
    "  preset   Inspect deterministic least-privilege setup presets",
    "  profile  Inspect, recoverably remove, or restore non-secret profiles",
    "  doctor   Diagnose environment, policy, and optional Discord access",
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
    lines.push(`Saved profile: ${report.profile.name}`)
  }
  if (report.configFile) {
    lines.push(`Saved configuration: ${report.configFile}`)
  }
  if (report.configBackupFile) {
    lines.push(`Previous configuration backup: ${report.configBackupFile}`)
  }
  if (report.profile || report.configFile) {
    lines.push(`Credential variable: ${report.credentialVariable}`)
  }
  for (const warning of report.warnings) lines.push(`WARNING: ${warning}`)
  lines.push(
    "",
    "Portable stdio launch descriptor:",
    "",
    JSON.stringify(report.launch, null, 2),
    "",
    `${report.credentialVariable} is named for secret forwarding and its value is not included`,
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
  return [
    `${preset.name}${preset.recommended ? " (recommended)" : ""}`,
    `  ${preset.description}`,
    `  Scope: guild IDs ${preset.requirements.guildIds}; channel IDs ${preset.requirements.channelIds}`,
    `  Thread scope: ${preset.requirements.threadScope}`,
    `  Message Content intent: ${preset.requirements.messageContentIntent}`,
    `  Tool surface: ${preset.toolSurface}`,
    `  Toolsets: ${preset.toolsets.join(", ")}`,
    `  Tools (${preset.toolNames.length}): ${preset.toolNames.join(", ")}`,
    `  Risk classes: ${preset.riskClasses.join(", ")}`,
    "  Writes: disabled",
    "  Gateway: disabled",
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

interface ProfileSummary {
  applicationId: string
  botId: string
  channelCount: number
  credentialVariable: string
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
    credentialVariable: profile.credential.variable,
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
    `${profile.name}: application ${profile.applicationId}, bot ${profile.botId}, ${profile.guildCount} guilds, ${profile.channelCount} channels, ${profile.toolSurface} tools, Gateway ${profile.gatewayEnabled ? "enabled" : "disabled"}, credential ${profile.credentialVariable}`
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
    "The credential environment variable and Discord token were not modified or revoked.",
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
    `Enabled capabilities: ${summary.capabilitiesEnabled.join(", ") || "none"}`,
    `Configured feature scopes: ${configuredScopes}`,
    `Referenced secret variables: ${summary.credentialVariables.join(", ")}`,
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
    "",
    ...report.fields.flatMap((field, index) => [
      ...(index > 0 ? [""] : []),
      field.path,
      `  ${field.description}`,
      `  Type: ${field.kind}`,
      `  Required: ${field.required ? "yes" : "no"}`,
      `  Default: ${field.defaultValue === undefined ? "none" : JSON.stringify(field.defaultValue)}`,
      `  Legacy environment: ${field.environmentVariable ?? "none"}`,
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
    .filter(([name]) => /^DISCORD_(?:[A-Z0-9]+_)*TOKEN$/.test(name))
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
  const ambient = environment[ENVIRONMENT_NAMES.configFile]?.trim()
  if (ambient && ambient !== selected) {
    throw new ConfigurationError(
      `Option --config conflicts with ${ENVIRONMENT_NAMES.configFile}`,
    )
  }
  return {
    ...environment,
    [ENVIRONMENT_NAMES.configFile]: selected,
  }
}

async function runtimeSelectionEnvironment(
  selection: { configFile?: string; profileName?: string },
  environment: NodeJS.ProcessEnv,
  dependencies: CliDependencies,
): Promise<NodeJS.ProcessEnv> {
  if (selection.profileName) {
    return (await dependencies.activateProfile(selection.profileName, { environment })).environment
  }
  return configSelectionEnvironment(selection.configFile, environment)
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
      case "catalog": {
        if (!parsed.check) {
          dependencies.catalog({ stderr })
          return CLI_EXIT_CODES.success
        }
        const report = await dependencies.checkCatalog()
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderCatalog(report), environment)
        return CLI_EXIT_CODES.success
      }
      case "doctor": {
        const runtimeEnvironment = await runtimeSelectionEnvironment(
          parsed,
          environment,
          dependencies,
        )
        const report = await dependencies.diagnose({
          environment: runtimeEnvironment,
          ...(options.nodeVersion ? { nodeVersion: options.nodeVersion } : {}),
          online: parsed.online,
        })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderDoctor(report),
          runtimeEnvironment,
        )
        if (report.status === "error") return CLI_EXIT_CODES.failure
        if (report.status === "warning") return CLI_EXIT_CODES.warning
        return CLI_EXIT_CODES.success
      }
      case "config": {
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
        if (parsed.action !== "init" && parsed.action !== "migrate") {
          throw new ConfigurationError("Unsupported config action")
        }
        const report = parsed.action === "init"
          ? await dependencies.initializeConfig({
            applicationId: parsed.applicationId,
            botId: parsed.botId,
            channelIds: parsed.channelIds,
            ...(parsed.credentialVariable
              ? { credentialVariable: parsed.credentialVariable }
              : {}),
            file: parsed.file,
            guildIds: parsed.guildIds,
            name: parsed.name,
            overwrite: parsed.overwrite,
            ...(parsed.preset ? { preset: parsed.preset } : {}),
          })
          : await dependencies.migrateConfig({
            ...(parsed.credentialVariable
              ? { credentialVariable: parsed.credentialVariable }
              : {}),
            environment,
            file: parsed.file,
            ...(parsed.name ? { name: parsed.name } : {}),
            overwrite: parsed.overwrite,
            ...(parsed.profileName ? { profileName: parsed.profileName } : {}),
          })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderConfigWrite(report),
          environment,
        )
        return CLI_EXIT_CODES.success
      }
      case "coordination": {
        const report = parsed.action === "list"
          ? await dependencies.listCoordination(environment)
          : await dependencies.resolveCoordination(
            environment,
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
      case "serve":
        dependencies.serve({
          environment: await runtimeSelectionEnvironment(parsed, environment, dependencies),
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
        const runtimeEnvironment = await runtimeSelectionEnvironment(
          parsed,
          environment,
          dependencies,
        )
        const report = await dependencies.smoke({ environment: runtimeEnvironment })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderSmoke(report),
          runtimeEnvironment,
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
