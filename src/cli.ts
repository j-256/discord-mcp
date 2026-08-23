#!/usr/bin/env node

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
import { ConfigurationError, errorMessage, redactText } from "./errors.js"
import { isMainModule } from "./entrypoint.js"
import { runDiscordMcpServer } from "./mcp.js"
import {
  FileOperationStore,
  operationReceiptDirectory,
} from "./operation-store.js"
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

const CLI_COMMANDS = Object.freeze([
  "catalog",
  "coordination",
  "doctor",
  "help",
  "profile",
  "serve",
  "setup",
  "smoke",
  "version",
] as const)

type CliCommand = typeof CLI_COMMANDS[number]

export type ParsedCliArguments =
  | { check: boolean; command: "catalog"; json: boolean }
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
  | { command: "doctor"; json: boolean; online: boolean; profileName?: string }
  | { command: "help"; topic: CliCommand | undefined }
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
  | { command: "serve"; profileName?: string }
  | {
    command: "setup"
    credentialVariable?: string
    json: boolean
    launcherCommand: string | undefined
    overwriteProfile: boolean
    profileName?: string
    serverName: string | undefined
  }
  | { command: "smoke"; json: boolean; profileName?: string }
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
  listCoordination(environment: NodeJS.ProcessEnv): Promise<WriteCoordinationList>
  listProfiles(options: ProfileLocationOptions): Promise<ConnectorProfile[]>
  loadProfile(name: string, options: ProfileLocationOptions): Promise<ConnectorProfile>
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
  trashProfile(name: string, options: ProfileLocationOptions): Promise<TrashedProfile>
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

const DEFAULT_DEPENDENCIES: CliDependencies = {
  activateProfile,
  catalog: runDiscordMcpCatalog,
  checkCatalog: checkDiscordCatalog,
  diagnose: diagnoseConnector,
  listCoordination: async (environment) => {
    const auditFile = resolveConnectorAuditFile(environment)
    return new FileWriteCoordinator(
      writeCoordinationDirectory(auditFile),
      new FileOperationStore(operationReceiptDirectory(auditFile)),
    ).list()
  },
  listProfiles,
  loadProfile,
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
  trashProfile,
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
  let credentialVariable: string | undefined
  let json = false
  let launcherCommand: string | undefined
  let overwriteProfile = false
  let profileName: string | undefined
  let serverName: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument?.startsWith("--")) {
      throw new ConfigurationError(`Unexpected setup argument ${argument || ""}`)
    }
    if (seen.has(argument)) {
      throw new ConfigurationError(`Option ${argument} may be provided only once`)
    }
    seen.add(argument)
    if (argument === "--json") {
      json = true
      continue
    }
    if (argument === "--force") {
      overwriteProfile = true
      continue
    }
    if (!["--command", "--name", "--profile", "--token-env"].includes(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    index += 1
    if (argument === "--command") launcherCommand = value
    if (argument === "--name") serverName = value
    if (argument === "--profile") profileName = value
    if (argument === "--token-env") credentialVariable = value
  }
  if (!profileName && (credentialVariable !== undefined || overwriteProfile)) {
    throw new ConfigurationError("--token-env and --force require --profile")
  }
  return {
    command: "setup",
    ...(credentialVariable ? { credentialVariable } : {}),
    json,
    launcherCommand,
    overwriteProfile,
    ...(profileName ? { profileName } : {}),
    serverName,
  }
}

function parseProfileSelectionOptions(
  args: readonly string[],
  booleanOptions: ReadonlySet<string>,
): { present: ReadonlySet<string>; profileName?: string } {
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
    if (argument === "--profile") {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new ConfigurationError("Option --profile requires a value")
      }
      profileName = value
      index += 1
      continue
    }
    if (!booleanOptions.has(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
  }
  return {
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
    const options = parseProfileSelectionOptions(rest, new Set())
    return {
      command,
      ...(options.profileName ? { profileName: options.profileName } : {}),
    }
  }
  if (command === "doctor") {
    const options = parseProfileSelectionOptions(rest, new Set(["--json", "--online"]))
    return {
      command,
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
  if (command === "coordination") return parseCoordinationCommand(rest)
  if (command === "setup") return parseSetupOptions(rest)
  if (command === "profile") return parseProfileCommand(rest)
  const options = parseProfileSelectionOptions(rest, new Set(["--json"]))
  return {
    command: "smoke",
    json: options.present.has("--json"),
    ...(options.profileName ? { profileName: options.profileName } : {}),
  }
}

function helpText(topic: CliCommand | undefined): string {
  if (topic === "catalog") {
    return "Usage: discord-mcp catalog [--check] [--json]\n\nAdvertise the exact production MCP catalog without credentials or execution. Add --check to verify and fingerprint the packaged contract; --json emits deterministic evidence and requires --check."
  }
  if (topic === "doctor") {
    return "Usage: discord-mcp doctor [--profile NAME] [--online] [--json]\n\nValidate the local environment and policy. Add --online to verify Discord identity and scoped guild access."
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
    return "Usage: discord-mcp setup [--profile NAME [--token-env VARIABLE] [--force]] [--name NAME] [--command COMMAND] [--json]\n\nVerify the bot, optionally save a non-secret profile, and print a credential-free portable stdio launch descriptor."
  }
  if (topic === "smoke") {
    return "Usage: discord-mcp smoke [--profile NAME] [--json]\n\nNegotiate through the MCP adapter, validate tool, resource, and prompt contracts, and call only the read-only connector status tool."
  }
  if (topic === "serve") {
    return "Usage: discord-mcp serve [--profile NAME]\n\nRun the local stdio MCP server. This is also the default command."
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
  if (topic === "version") return "Usage: discord-mcp version\n\nPrint the package version."
  return [
    `Usage: ${CONNECTOR_NAME} <command> [options]`,
    "",
    "Commands:",
    "  catalog  Inspect or verify the credential-free, execution-disabled MCP contract",
    "  coordination  Inspect or resolve durable reviewed-write claims",
    "  serve    Run the stdio MCP server (default)",
    "  setup    Verify the bot and generate safe client configuration",
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
  }
  return lines.join("\n")
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
  if (report.profile) {
    lines.push(
      `Saved profile: ${report.profile.name}`,
      `Credential variable: ${report.profile.credential.variable}`,
    )
  }
  for (const warning of report.warnings) lines.push(`WARNING: ${warning}`)
  lines.push(
    "",
    "Portable stdio launch descriptor:",
    "",
    JSON.stringify(report.launch, null, 2),
    "",
    `${report.profile?.credential.variable ?? ENVIRONMENT_NAMES.token} is named for secret forwarding and its value is not included`,
    "Translate the requirements into the MCP host's required-server, write-approval, elicitation, and timeout settings.",
  )
  return lines.join("\n")
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
    toolsets: profile.tools.toolsets,
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

export async function runCli(options: CliOptions = {}): Promise<number> {
  const args = options.args || process.argv.slice(2)
  const environment = options.environment || process.env
  const stdout = options.stdout || process.stdout
  const stderr = options.stderr || process.stderr
  const dependencies = options.dependencies || DEFAULT_DEPENDENCIES
  try {
    const parsed = parseCliArguments(args)
    switch (parsed.command) {
      case "catalog": {
        if (!parsed.check) {
          dependencies.catalog({ stderr })
          return 0
        }
        const report = await dependencies.checkCatalog()
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderCatalog(report), environment)
        return 0
      }
      case "doctor": {
        const runtimeEnvironment = parsed.profileName
          ? (await dependencies.activateProfile(parsed.profileName, { environment })).environment
          : environment
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
        return report.status === "error" ? 1 : 0
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
        return 0
      }
      case "help":
        safeWrite(stdout, helpText(parsed.topic), environment)
        return 0
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
          return 0
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
          return 0
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
        return 0
      }
      case "serve":
        dependencies.serve({
          environment: parsed.profileName
            ? (await dependencies.activateProfile(parsed.profileName, { environment })).environment
            : environment,
          stderr,
        })
        return 0
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
          ...(parsed.credentialVariable
            ? { credentialVariable: parsed.credentialVariable }
            : {}),
          environment,
          overwriteProfile: parsed.overwriteProfile,
          ...(parsed.profileName ? { profileName: parsed.profileName } : {}),
          ...(parsed.serverName ? { serverName: parsed.serverName } : {}),
        })
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderSetup(report), environment)
        return 0
      }
      case "smoke": {
        const runtimeEnvironment = parsed.profileName
          ? (await dependencies.activateProfile(parsed.profileName, { environment })).environment
          : environment
        const report = await dependencies.smoke({ environment: runtimeEnvironment })
        safeWrite(
          stdout,
          parsed.json ? jsonReport(report) : renderSmoke(report),
          runtimeEnvironment,
        )
        return 0
      }
      case "version":
        safeWrite(stdout, CONNECTOR_VERSION, environment)
        return 0
    }
  } catch (error) {
    safeWrite(
      stderr,
      `${CONNECTOR_NAME}: ${errorMessage(error)}`,
      environment,
    )
    return 1
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runCli()
}
