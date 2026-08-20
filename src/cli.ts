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
import { ConfigurationError, errorMessage, redactText } from "./errors.js"
import { isMainModule } from "./entrypoint.js"
import { runDiscordMcpServer } from "./mcp.js"
import {
  diagnoseConnector,
  prepareSetup,
  smokeConnector,
  type DoctorOptions,
  type DoctorReport,
  type SetupOptions,
  type SetupReport,
  type SmokeOptions,
  type SmokeReport,
} from "./operator.js"

const CLI_COMMANDS = Object.freeze([
  "catalog",
  "doctor",
  "help",
  "serve",
  "setup",
  "smoke",
  "version",
] as const)

type CliCommand = typeof CLI_COMMANDS[number]

export type ParsedCliArguments =
  | { check: boolean; command: "catalog"; json: boolean }
  | { command: "doctor"; json: boolean; online: boolean }
  | { command: "help"; topic: CliCommand | undefined }
  | { command: "serve" }
  | {
    command: "setup"
    json: boolean
    launcherCommand: string | undefined
    serverName: string | undefined
  }
  | { command: "smoke"; json: boolean }
  | { command: "version" }

export interface CliDependencies {
  catalog(options: {
    stderr: Pick<NodeJS.WriteStream, "write">
  }): unknown
  checkCatalog(): Promise<DiscordCatalogCheckReport>
  diagnose(options: DoctorOptions): Promise<DoctorReport>
  prepareSetup(options: SetupOptions): Promise<SetupReport>
  serve(options: {
    environment: NodeJS.ProcessEnv
    stderr: Pick<NodeJS.WriteStream, "write">
  }): unknown
  smoke(options: SmokeOptions): Promise<SmokeReport>
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
  catalog: runDiscordMcpCatalog,
  checkCatalog: checkDiscordCatalog,
  diagnose: diagnoseConnector,
  prepareSetup,
  serve: runDiscordMcpServer,
  smoke: smokeConnector,
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
  let json = false
  let launcherCommand: string | undefined
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
    if (!["--command", "--name"].includes(argument)) {
      throw new ConfigurationError(`Unknown option ${argument}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${argument} requires a value`)
    }
    index += 1
    if (argument === "--command") launcherCommand = value
    if (argument === "--name") serverName = value
  }
  return {
    command: "setup",
    json,
    launcherCommand,
    serverName,
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
  if (command === "serve" || command === "version") {
    if (rest.length > 0) throw new ConfigurationError(`${command} does not accept options`)
    return { command }
  }
  if (command === "doctor") {
    const options = parseBooleanOptions(rest, new Set(["--json", "--online"]))
    return {
      command,
      json: options.has("--json"),
      online: options.has("--online"),
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
  if (command === "setup") return parseSetupOptions(rest)
  const options = parseBooleanOptions(rest, new Set(["--json"]))
  return { command: "smoke", json: options.has("--json") }
}

function helpText(topic: CliCommand | undefined): string {
  if (topic === "catalog") {
    return "Usage: discord-mcp catalog [--check] [--json]\n\nAdvertise the exact production MCP catalog without credentials or execution. Add --check to verify the packaged contract; --json requires --check."
  }
  if (topic === "doctor") {
    return "Usage: discord-mcp doctor [--online] [--json]\n\nValidate the local environment and policy. Add --online to verify Discord identity and scoped guild access."
  }
  if (topic === "setup") {
    return "Usage: discord-mcp setup [--name NAME] [--command COMMAND] [--json]\n\nVerify the bot and print a credential-free portable stdio launch descriptor."
  }
  if (topic === "smoke") {
    return "Usage: discord-mcp smoke [--json]\n\nNegotiate through the MCP adapter, validate tool, resource, and prompt contracts, and call only the read-only connector status tool."
  }
  if (topic === "serve") {
    return "Usage: discord-mcp serve\n\nRun the local stdio MCP server. This is also the default command."
  }
  if (topic === "version") return "Usage: discord-mcp version\n\nPrint the package version."
  return [
    `Usage: ${CONNECTOR_NAME} <command> [options]`,
    "",
    "Commands:",
    "  catalog  Inspect or verify the credential-free, execution-disabled MCP contract",
    "  serve    Run the stdio MCP server (default)",
    "  setup    Verify the bot and generate safe client configuration",
    "  doctor   Diagnose environment, policy, and optional Discord access",
    "  smoke    Verify the read-only MCP path end to end",
    "  version  Print the package version",
    "  help     Show command help",
  ].join("\n")
}

function renderCatalog(report: DiscordCatalogCheckReport): string {
  return [
    "Discord MCP catalog: ok",
    `Server: ${report.serverName}@${report.serverVersion}`,
    `Tools: ${report.toolCount}`,
    `Prompts: ${report.promptCount}`,
    `Resources: ${report.resourceCount}`,
    `Resource templates: ${report.resourceTemplateCount}`,
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

function renderSetup(report: SetupReport): string {
  const lines = [
    `Discord MCP setup verified application ${report.applicationId} and bot ${report.botId}`,
    `Accessible guilds on first page: ${report.guildsAccessibleOnFirstPage}`,
    `In-scope guilds on first page: ${report.guildsInScopeOnFirstPage}`,
    `Tool surface: ${report.toolSurface}`,
    `Toolsets: ${report.toolsets.join(", ")}`,
  ]
  for (const warning of report.warnings) lines.push(`WARNING: ${warning}`)
  lines.push(
    "",
    "Portable stdio launch descriptor:",
    "",
    JSON.stringify(report.launch, null, 2),
    "",
    `${ENVIRONMENT_NAMES.token} is named for secret forwarding and its value is not included`,
    "Translate the requirements into the MCP host's required-server, write-approval, elicitation, and timeout settings.",
  )
  return lines.join("\n")
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
  const token = environment[ENVIRONMENT_NAMES.token]
  stream.write(`${redactText(value, [token, token?.trim()])}\n`)
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
        const report = await dependencies.diagnose({
          environment,
          ...(options.nodeVersion ? { nodeVersion: options.nodeVersion } : {}),
          online: parsed.online,
        })
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderDoctor(report), environment)
        return report.status === "error" ? 1 : 0
      }
      case "help":
        safeWrite(stdout, helpText(parsed.topic), environment)
        return 0
      case "serve":
        dependencies.serve({ environment, stderr })
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
          environment,
          ...(parsed.serverName ? { serverName: parsed.serverName } : {}),
        })
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderSetup(report), environment)
        return 0
      }
      case "smoke": {
        const report = await dependencies.smoke({ environment })
        safeWrite(stdout, parsed.json ? jsonReport(report) : renderSmoke(report), environment)
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
