import { createHash } from "node:crypto"

import {
  CONNECTOR_DESCRIPTION,
  CONNECTOR_VERSION,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  verifyHostActivationPlan,
  type HostActivationPlan,
} from "./host-activation.js"
import { stableString } from "./normalize.js"

export const HOST_ADAPTER_CATALOG_FORMAT = "guildcontrol.host-adapters.v1"
export const HOST_ADAPTER_CATALOG_SCHEMA_VERSION = 1
export const HOST_ADAPTER_IDS = Object.freeze([
  "claude-code",
  "codex",
  "cursor",
  "vscode",
  "gemini-extension",
  "mcp-json",
] as const)

export type HostAdapterId = typeof HOST_ADAPTER_IDS[number]
export type HostAdapterSecretStrategy =
  | "credential-file"
  | "environment-interpolation"
  | "forwarded-environment"
  | "inherited-environment"
  | "secure-input"
  | "system-keychain"

export interface HostAdapter {
  readonly activationDigest: string
  readonly adapterDigest: string
  readonly configuration: Readonly<Record<string, unknown>>
  readonly content: string
  readonly destinations: readonly string[]
  readonly format: "json" | "toml"
  readonly hostServerName: string
  readonly id: HostAdapterId
  readonly installUri?: string
  readonly instructions: readonly string[]
  readonly limitations: readonly string[]
  readonly requirements: HostActivationPlan["launch"]["requirements"] & {
    readonly timeouts: HostActivationPlan["launch"]["timeouts"]
  }
  readonly secret: {
    readonly environmentVariables: readonly string[]
    readonly strategy: HostAdapterSecretStrategy
  }
  readonly specification: {
    readonly title: string
    readonly url: string
  }
  readonly title: string
}

export interface HostAdapterCatalog {
  readonly activationDigest: string
  readonly adapters: readonly HostAdapter[]
  readonly format: typeof HOST_ADAPTER_CATALOG_FORMAT
  readonly schemaVersion: typeof HOST_ADAPTER_CATALOG_SCHEMA_VERSION
  readonly status: "ok"
}

interface HostAdapterBase extends Omit<HostAdapter, "adapterDigest"> {}

const HOST_ADAPTER_DIGEST_DOMAIN = "guildcontrol-host-adapter-v1\0"
const CURSOR_INSTALL_URI_PREFIX = "cursor://anysphere.cursor-deeplink/mcp/install"
const GEMINI_EXTENSION_DIGEST_LENGTH = 12
const JSON_INDENT = 2

const HOST_ADAPTER_SPECIFICATIONS = Object.freeze({
  claudeCode: Object.freeze({
    title: "Claude Code MCP configuration",
    url: "https://code.claude.com/docs/en/mcp",
  }),
  codex: Object.freeze({
    title: "Codex MCP configuration",
    url: "https://developers.openai.com/codex/mcp/",
  }),
  cursor: Object.freeze({
    title: "Cursor MCP install links",
    url: "https://cursor.com/docs/mcp/install-links",
  }),
  geminiExtension: Object.freeze({
    title: "Gemini CLI extension reference",
    url: "https://geminicli.com/docs/extensions/reference/",
  }),
  mcpJson: Object.freeze({
    title: "Model Context Protocol local server guide",
    url: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
  }),
  vscode: Object.freeze({
    title: "VS Code MCP configuration reference",
    url: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
  }),
})

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function jsonContent(configuration: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(configuration, null, JSON_INDENT)}\n`
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`
}

function adapterDigest(adapter: HostAdapterBase): string {
  return `sha256:${createHash("sha256")
    .update(HOST_ADAPTER_DIGEST_DOMAIN)
    .update(adapter.id)
    .update("\0")
    .update(stableString(adapter))
    .digest("hex")}`
}

function exactRequirements(plan: HostActivationPlan): HostAdapter["requirements"] {
  return deepFreeze({
    ...plan.launch.requirements,
    timeouts: { ...plan.launch.timeouts },
  })
}

function secretStrategy(
  plan: HostActivationPlan,
  environmentStrategy: Exclude<HostAdapterSecretStrategy, "credential-file">,
): HostAdapterSecretStrategy {
  return plan.launch.secrets.environmentVariables.length === 0
    ? "credential-file"
    : environmentStrategy
}

function commonRequirements(plan: HostActivationPlan): readonly string[] {
  return Object.freeze([
    "Treat startup failure as a failed integration instead of silently omitting this required server",
    "Require host approval for every write-capable or destructive tool",
    "Use read and plan tools only when the host cannot complete MCP elicitation for reviewed writes",
    `Allow ${plan.launch.timeouts.startupSeconds} seconds for startup and ${plan.launch.timeouts.toolSeconds} seconds per tool call`,
  ])
}

function fileCredentialInstruction(plan: HostActivationPlan): string {
  return `Keep the configured private credential file available at its exact path: ${plan.launch.secrets.files.join(", ")}`
}

function finalizeAdapter(adapter: HostAdapterBase): HostAdapter {
  const frozenBase = deepFreeze(adapter)
  return deepFreeze({
    ...frozenBase,
    adapterDigest: adapterDigest(frozenBase),
  })
}

function serverConfiguration(plan: HostActivationPlan): Readonly<Record<string, unknown>> {
  return deepFreeze({
    args: [...plan.launch.args],
    command: plan.launch.command,
  })
}

function claudeCodeEnvironment(
  environmentVariables: readonly string[],
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(environmentVariables.map((name) => [
    name,
    `\${${name}}`,
  ])))
}

function claudeCodeAdapter(plan: HostActivationPlan): HostAdapter {
  const environmentVariables = plan.launch.secrets.environmentVariables
  const server = deepFreeze({
    ...serverConfiguration(plan),
    ...(environmentVariables.length > 0
      ? { env: claudeCodeEnvironment(environmentVariables) }
      : {}),
    type: "stdio",
  })
  const configuration = deepFreeze({
    mcpServers: {
      [plan.launch.serverName]: server,
    },
  })
  const instructions = [
    `Merge only the ${plan.launch.serverName} entry into one Claude Code .mcp.json scope; preserve unrelated servers`,
    ...(environmentVariables.length > 0
      ? [`Keep ${environmentVariables.join(", ")} in protected process state; Claude Code expands the generated environment references at launch`]
      : [fileCredentialInstruction(plan)]),
    ...commonRequirements(plan),
  ]
  return finalizeAdapter({
    activationDigest: plan.activationDigest,
    configuration,
    content: jsonContent(configuration),
    destinations: Object.freeze([
      "Project .mcp.json",
      "Claude Code local or user scope managed through its MCP configuration commands",
    ]),
    format: "json",
    hostServerName: plan.launch.serverName,
    id: "claude-code",
    instructions: Object.freeze(instructions),
    limitations: Object.freeze([
      "This projection does not select a Claude Code scope or edit a host configuration",
      environmentVariables.length > 0
        ? "Environment expansion does not prove secret availability, write approval, elicitation support, startup, or Discord access"
        : "Protected credential-file availability does not prove write approval, elicitation support, startup, or Discord access",
    ]),
    requirements: exactRequirements(plan),
    secret: deepFreeze({
      environmentVariables: [...environmentVariables],
      strategy: secretStrategy(plan, "environment-interpolation"),
    }),
    specification: HOST_ADAPTER_SPECIFICATIONS.claudeCode,
    title: "Claude Code",
  })
}

function codexContent(
  plan: HostActivationPlan,
  environmentVariables: readonly string[],
): string {
  return [
    `[mcp_servers.${plan.launch.serverName}]`,
    `command = ${tomlString(plan.launch.command)}`,
    `args = ${tomlStringArray(plan.launch.args)}`,
    ...(environmentVariables.length > 0
      ? [`env_vars = ${tomlStringArray(environmentVariables)}`]
      : []),
    `startup_timeout_sec = ${plan.launch.timeouts.startupSeconds}`,
    `tool_timeout_sec = ${plan.launch.timeouts.toolSeconds}`,
    "required = true",
    'default_tools_approval_mode = "writes"',
    "",
  ].join("\n")
}

function codexAdapter(plan: HostActivationPlan): HostAdapter {
  const environmentVariables = plan.launch.secrets.environmentVariables
  const server = deepFreeze({
    args: [...plan.launch.args],
    command: plan.launch.command,
    default_tools_approval_mode: "writes",
    ...(environmentVariables.length > 0
      ? { env_vars: [...environmentVariables] }
      : {}),
    required: true,
    startup_timeout_sec: plan.launch.timeouts.startupSeconds,
    tool_timeout_sec: plan.launch.timeouts.toolSeconds,
  })
  const configuration = deepFreeze({
    mcp_servers: {
      [plan.launch.serverName]: server,
    },
  })
  const instructions = [
    `Merge only the ${plan.launch.serverName} table into one Codex config.toml scope; preserve unrelated configuration`,
    ...(environmentVariables.length > 0
      ? [`Keep ${environmentVariables.join(", ")} in protected process state; Codex forwards only the generated env_vars names`]
      : [fileCredentialInstruction(plan)]),
    ...commonRequirements(plan),
  ]
  return finalizeAdapter({
    activationDigest: plan.activationDigest,
    configuration,
    content: codexContent(plan, environmentVariables),
    destinations: Object.freeze([
      "User ~/.codex/config.toml",
      "Trusted project .codex/config.toml",
    ]),
    format: "toml",
    hostServerName: plan.launch.serverName,
    id: "codex",
    instructions: Object.freeze(instructions),
    limitations: Object.freeze([
      "The reviewed JSON host installer and inspector cannot merge or inspect TOML; merge this exact table manually",
      environmentVariables.length > 0
        ? "Named environment forwarding does not prove secret availability, write approval, elicitation support, startup, or Discord access"
        : "Protected credential-file availability does not prove write approval, elicitation support, startup, or Discord access",
    ]),
    requirements: exactRequirements(plan),
    secret: deepFreeze({
      environmentVariables: [...environmentVariables],
      strategy: secretStrategy(plan, "forwarded-environment"),
    }),
    specification: HOST_ADAPTER_SPECIFICATIONS.codex,
    title: "Codex",
  })
}

function mcpJsonAdapter(plan: HostActivationPlan): HostAdapter {
  const configuration = deepFreeze({
    mcpServers: {
      [plan.launch.serverName]: serverConfiguration(plan),
    },
  })
  const environmentVariables = plan.launch.secrets.environmentVariables
  const instructions = [
    `Merge only the ${plan.launch.serverName} entry into a compatible MCP JSON file; preserve unrelated servers`,
    ...(environmentVariables.length > 0
      ? [`Start the host from protected process state that already defines ${environmentVariables.join(", ")}; this portable document omits non-portable secret interpolation`]
      : [fileCredentialInstruction(plan)]),
    ...commonRequirements(plan),
  ]
  return finalizeAdapter({
    activationDigest: plan.activationDigest,
    configuration,
    content: jsonContent(configuration),
    destinations: Object.freeze([
      "A user-level or project-level MCP file that accepts the top-level mcpServers convention",
    ]),
    format: "json",
    hostServerName: plan.launch.serverName,
    id: "mcp-json",
    instructions: Object.freeze(instructions),
    limitations: Object.freeze([
      "The mcpServers shape is a common client convention, not a complete cross-host standard",
      "This projection cannot prove the installed host's schema, secret availability, approval UI, elicitation support, startup, or Discord access",
    ]),
    requirements: exactRequirements(plan),
    secret: deepFreeze({
      environmentVariables: [...environmentVariables],
      strategy: secretStrategy(plan, "inherited-environment"),
    }),
    specification: HOST_ADAPTER_SPECIFICATIONS.mcpJson,
    title: "Common MCP JSON",
  })
}

function cursorEnvironment(
  environmentVariables: readonly string[],
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(environmentVariables.map((name) => [
    name,
    `\${env:${name}}`,
  ])))
}

function cursorAdapter(plan: HostActivationPlan): HostAdapter {
  const environmentVariables = plan.launch.secrets.environmentVariables
  const server = deepFreeze({
    ...serverConfiguration(plan),
    ...(environmentVariables.length > 0
      ? { env: cursorEnvironment(environmentVariables) }
      : {}),
    type: "stdio",
  })
  const configuration = deepFreeze({
    mcpServers: {
      [plan.launch.serverName]: server,
    },
  })
  const installUri = `${CURSOR_INSTALL_URI_PREFIX}?name=${encodeURIComponent(plan.launch.serverName)}&config=${encodeURIComponent(Buffer.from(JSON.stringify(server)).toString("base64"))}`
  const instructions = [
    "Review the exact JSON before merging it into one Cursor MCP location or using the install URI",
    ...(environmentVariables.length > 0
      ? [`Keep ${environmentVariables.join(", ")} in protected process state; Cursor resolves the generated environment references at launch`]
      : [fileCredentialInstruction(plan)]),
    "Keep automatic execution disabled for write-capable tools",
    ...commonRequirements(plan),
  ]
  return finalizeAdapter({
    activationDigest: plan.activationDigest,
    configuration,
    content: jsonContent(configuration),
    destinations: Object.freeze([
      "Global ~/.cursor/mcp.json",
      "Project .cursor/mcp.json",
      "Cursor's MCP install URI flow",
    ]),
    format: "json",
    hostServerName: plan.launch.serverName,
    id: "cursor",
    installUri,
    instructions: Object.freeze(instructions),
    limitations: Object.freeze([
      "The private install URI encodes this policy's local command arguments and must not be shared",
      "The generated URI starts an install review; it does not prove installation, approval controls, elicitation, startup, or Discord access",
    ]),
    requirements: exactRequirements(plan),
    secret: deepFreeze({
      environmentVariables: [...environmentVariables],
      strategy: secretStrategy(plan, "environment-interpolation"),
    }),
    specification: HOST_ADAPTER_SPECIFICATIONS.cursor,
    title: "Cursor",
  })
}

function vscodeInputId(index: number): string {
  return `guildcontrol-credential-${index + 1}`
}

function vscodeAdapter(plan: HostActivationPlan): HostAdapter {
  const environmentVariables = plan.launch.secrets.environmentVariables
  const inputs = environmentVariables.map((name, index) => ({
    description: `Discord bot credential for ${name}`,
    id: vscodeInputId(index),
    password: true,
    type: "promptString",
  }))
  const env = Object.fromEntries(environmentVariables.map((name, index) => [
    name,
    `\${input:${vscodeInputId(index)}}`,
  ]))
  const server = deepFreeze({
    args: [...plan.launch.args],
    command: plan.launch.command,
    ...(environmentVariables.length > 0 ? { env } : {}),
    type: "stdio",
  })
  const configuration = deepFreeze({
    ...(inputs.length > 0 ? { inputs } : {}),
    servers: {
      [plan.launch.serverName]: server,
    },
  })
  const instructions = [
    environmentVariables.length > 0
      ? `Merge the ${plan.launch.serverName} server and its generated inputs into exactly one VS Code mcp.json file`
      : `Merge only the ${plan.launch.serverName} server into exactly one VS Code mcp.json file`,
    ...(environmentVariables.length > 0
      ? ["Enter the Discord bot credential only in VS Code's password-masked input prompt; do not replace an input reference with a literal"]
      : [fileCredentialInstruction(plan)]),
    "Leave MCP sandboxing disabled because VS Code auto-approves tools for sandboxed servers",
    ...commonRequirements(plan),
  ]
  return finalizeAdapter({
    activationDigest: plan.activationDigest,
    configuration,
    content: jsonContent(configuration),
    destinations: Object.freeze([
      "Workspace .vscode/mcp.json",
      "VS Code user-profile mcp.json",
    ]),
    format: "json",
    hostServerName: plan.launch.serverName,
    id: "vscode",
    instructions: Object.freeze(instructions),
    limitations: Object.freeze(environmentVariables.length > 0
      ? [
          "VS Code does not forward servers with interactive input variables to Agent Host sessions",
          "Secure input storage does not prove write approval, elicitation support, startup, or Discord access",
        ]
      : [
          "The static projection contains no interactive secret input; the launched connector resolves its policy-selected credential file",
          "Protected credential-file availability does not prove write approval, elicitation support, startup, or Discord access",
        ]),
    requirements: exactRequirements(plan),
    secret: deepFreeze({
      environmentVariables: [...environmentVariables],
      strategy: secretStrategy(plan, "secure-input"),
    }),
    specification: HOST_ADAPTER_SPECIFICATIONS.vscode,
    title: "Visual Studio Code",
  })
}

function geminiExtensionName(plan: HostActivationPlan): string {
  return `guildcontrol-${plan.activationDigest.slice("sha256:".length, "sha256:".length + GEMINI_EXTENSION_DIGEST_LENGTH)}`
}

function geminiAdapter(plan: HostActivationPlan): HostAdapter {
  const environmentVariables = plan.launch.secrets.environmentVariables
  const hostServerName = geminiExtensionName(plan)
  const settings = environmentVariables.map((name) => ({
    description: `Discord bot credential exposed only as ${name}`,
    envVar: name,
    name: `Discord credential (${name})`,
    sensitive: true,
  }))
  const env = Object.fromEntries(environmentVariables.map((name) => [
    name,
    `\${${name}}`,
  ]))
  const configuration = deepFreeze({
    description: CONNECTOR_DESCRIPTION,
    mcpServers: {
      [hostServerName]: {
        args: [...plan.launch.args],
        command: plan.launch.command,
        ...(environmentVariables.length > 0 ? { env } : {}),
      },
    },
    name: hostServerName,
    ...(settings.length > 0 ? { settings } : {}),
    version: CONNECTOR_VERSION,
  })
  const instructions = [
    `Create a private local extension directory named ${hostServerName} and save this content as gemini-extension.json`,
    ...(environmentVariables.length > 0
      ? ["Install or link the local extension, then enter the credential only through each sensitive Gemini CLI extension setting"]
      : [fileCredentialInstruction(plan)]),
    "Restart Gemini CLI after installation and keep automatic approval disabled for write-capable tools",
    ...commonRequirements(plan),
  ]
  return finalizeAdapter({
    activationDigest: plan.activationDigest,
    configuration,
    content: jsonContent(configuration),
    destinations: Object.freeze([
      `Private local Gemini CLI extension directory named ${hostServerName}`,
    ]),
    format: "json",
    hostServerName,
    id: "gemini-extension",
    instructions: Object.freeze(instructions),
    limitations: Object.freeze([
      `Gemini CLI uses the policy-specific alias ${hostServerName} instead of the portable label ${plan.launch.serverName} to avoid unsafe underscore parsing and extension-name collisions`,
      "This generated local manifest is not a signed or published extension bundle and does not prove installation, approval controls, elicitation, startup, or Discord access",
    ]),
    requirements: exactRequirements(plan),
    secret: deepFreeze({
      environmentVariables: [...environmentVariables],
      strategy: secretStrategy(plan, "system-keychain"),
    }),
    specification: HOST_ADAPTER_SPECIFICATIONS.geminiExtension,
    title: "Gemini CLI extension",
  })
}

export function isHostAdapterId(value: string): value is HostAdapterId {
  return HOST_ADAPTER_IDS.some((id) => id === value)
}

export function createHostAdapterCatalog(plan: HostActivationPlan): HostAdapterCatalog {
  if (!verifyHostActivationPlan(plan)) {
    throw new ConfigurationError("Host adapters require an exact credential-free activation plan")
  }
  return deepFreeze({
    activationDigest: plan.activationDigest,
    adapters: [
      claudeCodeAdapter(plan),
      codexAdapter(plan),
      cursorAdapter(plan),
      vscodeAdapter(plan),
      geminiAdapter(plan),
      mcpJsonAdapter(plan),
    ],
    format: HOST_ADAPTER_CATALOG_FORMAT,
    schemaVersion: HOST_ADAPTER_CATALOG_SCHEMA_VERSION,
    status: "ok",
  })
}

export function findHostAdapter(
  catalog: HostAdapterCatalog,
  id: HostAdapterId,
): HostAdapter {
  const adapter = catalog.adapters.find((entry) => entry.id === id)
  if (!adapter) throw new ConfigurationError(`Host adapter ${id} is unavailable`)
  return adapter
}

export function verifyHostAdapterCatalog(
  plan: HostActivationPlan,
  value: unknown,
): value is HostAdapterCatalog {
  if (!verifyHostActivationPlan(plan)) return false
  try {
    return stableString(value) === stableString(createHostAdapterCatalog(plan))
  } catch {
    return false
  }
}
