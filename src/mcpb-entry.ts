import {
  loadConnectorConfigDocumentFile,
  type ConnectorConfigDocument,
} from "./config-document.js"
import {
  loadConnectorConfigDocument,
  type ConnectorConfig,
} from "./config.js"
import { ConfigurationError, redactText } from "./errors.js"
import {
  runGuildControlServer,
  type GuildControlRunOptions,
} from "./mcp.js"

export const MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE = "MCPB_DISCORD_BOT_SECRET"

const MCPB_ARGUMENT_COUNT = 3
const MCPB_FAILURE_EXIT_CODE = 2

export interface McpbEnvironmentPreparation {
  configFile: string
  credentialVariable: string
  document: ConnectorConfigDocument
  environment: NodeJS.ProcessEnv
}

export interface McpbServerOptions {
  args?: readonly string[]
  environment?: NodeJS.ProcessEnv
  loadConfig?: (
    document: ConnectorConfigDocument,
    environment: NodeJS.ProcessEnv,
  ) => ConnectorConfig
  loadConfigDocument?: (file: string) => ConnectorConfigDocument
  serve?: (options: GuildControlRunOptions) => unknown
  stderr?: Pick<NodeJS.WriteStream, "write">
}

function selectedConfigFile(args: readonly string[]): string {
  if (
    args.length !== MCPB_ARGUMENT_COUNT
    || args[0] !== "serve"
    || args[1] !== "--config"
    || !args[2]?.trim()
  ) {
    throw new ConfigurationError(
      "The MCPB launcher requires exactly `serve --config FILE`",
    )
  }
  return args[2]
}

export function prepareMcpbEnvironment(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  loadConfigDocument: (file: string) => ConnectorConfigDocument = loadConnectorConfigDocumentFile,
): McpbEnvironmentPreparation {
  const configFile = selectedConfigFile(args)
  const document = loadConfigDocument(configFile)
  if (document.credential.provider !== "environment") {
    throw new ConfigurationError(
      "The one-click MCPB requires an environment-backed credential reference in the selected configuration",
    )
  }
  const token = environment[MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]
  if (!token?.trim()) {
    throw new ConfigurationError(
      "The MCPB host did not supply the required sensitive Discord bot token",
    )
  }
  const prepared = {
    ...environment,
    [document.credential.variable]: token,
  }
  delete prepared[MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]
  return {
    configFile,
    credentialVariable: document.credential.variable,
    document,
    environment: prepared,
  }
}

export async function runMcpbServer(options: McpbServerOptions = {}): Promise<number> {
  const args = options.args || process.argv.slice(2)
  const environment = options.environment || process.env
  const stderr = options.stderr || process.stderr
  try {
    const preparation = prepareMcpbEnvironment(
      args,
      environment,
      options.loadConfigDocument,
    )
    const config = (options.loadConfig || loadConnectorConfigDocument)(
      preparation.document,
      preparation.environment,
    )
    const serve = options.serve || runGuildControlServer
    serve({
      config,
      environment: preparation.environment,
      stderr,
    })
    return 0
  } catch (error) {
    const token = environment[MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]
    const secrets = token ? [token, token.trim()] : []
    const message = error instanceof Error
      ? redactText(error.message, secrets)
      : "The MCPB launcher could not prepare the server environment"
    stderr.write(`[guildcontrol] ${message}\n`)
    return MCPB_FAILURE_EXIT_CODE
  }
}
