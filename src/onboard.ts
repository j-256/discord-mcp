import { createHash } from "node:crypto"
import {
  basename,
  dirname,
  extname,
  join,
} from "node:path"

import {
  createBotInstallPlan,
  type BotInstallPlan,
} from "./bot-install.js"
import {
  CONNECTOR_NPX_ARGUMENTS,
  CONNECTOR_NPX_COMMAND,
  CONNECTOR_VERSION,
} from "./constants.js"
import {
  createConnectorConfigDocument,
  normalizeConfigName,
  type ConnectorConfigDocument,
} from "./config-document.js"
import { ConfigurationError } from "./errors.js"
import {
  verifyHostActivationPlan,
  type HostActivationPlan,
} from "./host-activation.js"
import {
  HOST_ADAPTER_IDS,
  createHostAdapterCatalog,
  findHostAdapter,
  type HostAdapter,
  type HostAdapterId,
  type HostAdapterSecretStrategy,
} from "./host-adapters.js"
import { stableString } from "./normalize.js"
import type {
  SetupReport,
  SmokeReport,
} from "./operator.js"
import {
  resolveProfileDirectory,
  type ProfileLocationOptions,
} from "./profile.js"
import { getSetupPreset } from "./setup-presets.js"

export const ONBOARD_REPORT_FORMAT = "guildcontrol.onboard.v1"
export const ONBOARD_REPORT_SCHEMA_VERSION = 1
export const ONBOARD_HOST_IDS = Object.freeze([
  "claude-desktop",
  ...HOST_ADAPTER_IDS,
] as const)

export type OnboardHostId = typeof ONBOARD_HOST_IDS[number]
export type DetectableOnboardHostId = Exclude<OnboardHostId, "mcp-json">
export const ONBOARD_DETECTABLE_HOST_IDS: readonly DetectableOnboardHostId[] =
  Object.freeze(ONBOARD_HOST_IDS.filter(
    (id): id is DetectableOnboardHostId => id !== "mcp-json",
  ))

export interface OnboardHostDescriptor {
  readonly id: OnboardHostId
  readonly title: string
}

export interface OnboardMcpbRoute {
  readonly archiveName: string
  readonly downloadUrl: string
  readonly instructions: readonly string[]
  readonly kind: "mcpb"
  readonly limitations: readonly string[]
}

export interface OnboardAdapterRoute {
  readonly adapter: HostAdapter
  readonly kind: "adapter"
}

export type OnboardHostRoute = OnboardAdapterRoute | OnboardMcpbRoute

export type OnboardCredentialAccess =
  | "existing-environment"
  | "one-time-prompt"
  | "protected-file"

export type OnboardPolicyDisposition = "created" | "reused"

export interface OnboardCredentialHandoff {
  readonly additionalTokenEntry: "not-required" | "not-required-if-inherited" | "required"
  readonly details: readonly string[]
  readonly hostAction: "enter-in-host" | "inherit-environment" | "reuse-protected-file"
  readonly setupAccess: OnboardCredentialAccess
  readonly summary: string
}

export interface OnboardReport {
  readonly activation: HostActivationPlan
  readonly configFile: string
  readonly credentialHandoff: OnboardCredentialHandoff
  readonly firstRead: BotInstallPlan["postInstall"]["firstRead"]
  readonly format: typeof ONBOARD_REPORT_FORMAT
  readonly host: OnboardHostDescriptor & {
    readonly route: OnboardHostRoute
  }
  readonly install: BotInstallPlan
  readonly onboardDigest: string
  readonly policyDisposition: OnboardPolicyDisposition
  readonly privacy: {
    readonly credentialValuesEmbedded: false
    readonly hostConfigurationChanged: false
    readonly messageContentRead: false
    readonly writeCapable: false
  }
  readonly schemaVersion: typeof ONBOARD_REPORT_SCHEMA_VERSION
  readonly setup: SetupReport
  readonly smoke: SmokeReport
  readonly status: "ok"
}

export interface CreateOnboardReportOptions {
  readonly activation: HostActivationPlan
  readonly configFile: string
  readonly credentialAccess: OnboardCredentialAccess
  readonly hostId: OnboardHostId
  readonly install: BotInstallPlan
  readonly policyDisposition: OnboardPolicyDisposition
  readonly setup: SetupReport
  readonly smoke: SmokeReport
}

const ONBOARD_DIGEST_DOMAIN = "guildcontrol-onboard-v1\0"
const DEFAULT_CONFIG_FILE_NAME = "guildcontrol.json"
const DEFAULT_GUIDE_FILE_NAME = "guildcontrol-onboarding.html"
const DEFAULT_GUIDE_FILE_STEM = "guildcontrol-onboarding"
const DEFAULT_GUIDE_FILE_LIMIT = 100
const REUSABLE_POLICY_MISMATCH_MESSAGE =
  "Existing onboarding policy does not exactly match the requested application, guild, read-only preset, identity, and credential custody; choose a different --config path or review the existing policy"
const REUSABLE_ENVIRONMENT_STRATEGIES = new Set<HostAdapterSecretStrategy>([
  "environment-interpolation",
  "forwarded-environment",
  "inherited-environment",
])

const HOST_TITLES: Readonly<Record<OnboardHostId, string>> = Object.freeze({
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  "gemini-extension": "Gemini CLI extension",
  "mcp-json": "Common mcp.json host",
  vscode: "Visual Studio Code",
})

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function exactArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(ONBOARD_DIGEST_DOMAIN)
    .update(stableString(value))
    .digest("hex")}`
}

function exactInstallPlan(plan: BotInstallPlan): BotInstallPlan {
  const canonical = createBotInstallPlan({
    applicationId: plan.applicationId,
    guildId: plan.guildId,
    preset: plan.preset.name,
  })
  if (stableString(canonical) !== stableString(plan)) {
    throw new ConfigurationError("Onboarding requires an exact bot installation plan")
  }
  return canonical
}

function mcpbRoute(): OnboardMcpbRoute {
  const archiveName = `guildcontrol-${CONNECTOR_VERSION}.mcpb`
  return deepFreeze({
    archiveName,
    downloadUrl: `https://github.com/j-256/guildcontrol/releases/download/v${CONNECTOR_VERSION}/${archiveName}`,
    instructions: [
      `Download and import ${archiveName} in Claude Desktop`,
      "Select the exact GuildControl policy file created by onboarding",
      "Enter the bot token only through the host's protected sensitive-input prompt",
      "Keep write-tool approval enabled and treat GuildControl as a required local server",
      "Run the first read-only request after the host reports that the server is connected",
    ],
    kind: "mcpb" as const,
    limitations: [
      "Claude Desktop must support MCPB manifest 0.3, local file selection, sensitive string input, and the declared Node.js runtime",
      "Import does not prove secret retention, write approval, elicitation, startup, or Discord access",
    ],
  })
}

function hostRoute(
  hostId: OnboardHostId,
  activation: HostActivationPlan,
): OnboardHostRoute {
  if (hostId === "claude-desktop") return mcpbRoute()
  const catalog = createHostAdapterCatalog(activation)
  return deepFreeze({
    adapter: findHostAdapter(catalog, hostId as HostAdapterId),
    kind: "adapter" as const,
  })
}

function credentialHandoff(
  access: OnboardCredentialAccess,
  host: OnboardReport["host"],
  setup: SetupReport,
): OnboardCredentialHandoff {
  const credential = setup.credential
  if (access === "protected-file") {
    if (credential.provider !== "file" || !onboardHostSupportsCredentialFile(host.id)) {
      throw new ConfigurationError("Protected-file onboarding evidence does not match the selected host and policy")
    }
    return deepFreeze({
      additionalTokenEntry: "not-required" as const,
      details: [
        "The connector resolves the same external protected file when the MCP host starts it",
        "Keep that file available at its exact policy-selected path and never copy its token into host configuration",
        "No second token entry is needed",
      ],
      hostAction: "reuse-protected-file" as const,
      setupAccess: access,
      summary: "Reuse the policy's protected credential file",
    })
  }
  if (credential.provider !== "environment") {
    throw new ConfigurationError("Environment onboarding evidence does not match the selected policy")
  }
  const adapterStrategy = host.route.kind === "adapter"
    ? host.route.adapter.secret.strategy
    : "secure-input"
  const canInherit = access === "existing-environment"
    && REUSABLE_ENVIRONMENT_STRATEGIES.has(adapterStrategy)
  if (canInherit) {
    return deepFreeze({
      additionalTokenEntry: "not-required-if-inherited" as const,
      details: [
        `The token was already available through ${credential.variable} during onboarding`,
        `Start or restart ${host.title} from protected process state that provides the same named variable`,
        "No second token entry is needed after confirming that the host inherits or resolves that variable",
      ],
      hostAction: "inherit-environment" as const,
      setupAccess: access,
      summary: `Reuse ${credential.variable} through ${host.title}`,
    })
  }
  const hostInstruction = host.route.kind === "mcpb"
    ? `Enter the token only through ${host.title}'s protected sensitive-input prompt`
    : adapterStrategy === "secure-input"
      ? `Enter the token only through ${host.title}'s password-masked input prompt`
      : adapterStrategy === "system-keychain"
        ? `Enter the token only through ${host.title}'s sensitive extension setting`
        : `Provide ${credential.variable} through ${host.title}'s protected environment or launcher`
  return deepFreeze({
    additionalTokenEntry: "required" as const,
    details: [
      access === "one-time-prompt"
        ? "The one-time setup value was cleared after the verified smoke test"
        : `The setup process cannot transfer ${credential.variable} into ${host.title}'s protected secret custody`,
      hostInstruction,
      "GuildControl cannot perform this handoff without persisting the token or exposing it across a trust boundary",
    ],
    hostAction: "enter-in-host" as const,
    setupAccess: access,
    summary: `Complete ${host.title}'s protected credential entry`,
  })
}

function assertMatchingEvidence(options: CreateOnboardReportOptions): void {
  const { activation, install, setup, smoke } = options
  const expectedPreset = getSetupPreset("server-observer")
  const credentialLaunchMatches = setup.credential.provider === "environment"
    ? exactArray(setup.launch.environment.forward, [setup.credential.variable])
      && exactArray(setup.launch.secrets.environmentVariables, [setup.credential.variable])
      && setup.launch.secrets.files.length === 0
    : setup.launch.environment.forward.length === 0
      && setup.launch.secrets.environmentVariables.length === 0
      && exactArray(setup.launch.secrets.files, [setup.credential.path])
  if (!verifyHostActivationPlan(activation)) {
    throw new ConfigurationError("Onboarding requires an exact host activation plan")
  }
  if (
    setup.status !== "ok"
    || setup.configFile !== options.configFile
    || setup.configBackupFile !== null
    || setup.profile !== null
    || setup.applicationId !== install.applicationId
    || setup.botId !== activation.policy.identity.botId
    || stableString(setup.preset) !== stableString(expectedPreset)
    || setup.configuredGuildCount !== 1
    || setup.installedInScopeGuildCount !== 1
    || setup.installedGuildCount !== setup.unexpectedGuildCount + 1
    || setup.toolSurface !== activation.policy.tools.surface
    || !exactArray(setup.toolsets, activation.policy.tools.toolsets)
    || !credentialLaunchMatches
    || Object.keys(setup.launch.environment.set).length !== 0
    || setup.launch.command !== CONNECTOR_NPX_COMMAND
    || !exactArray(setup.launch.args, [
      ...CONNECTOR_NPX_ARGUMENTS,
      "serve",
      "--config",
      options.configFile,
    ])
  ) {
    throw new ConfigurationError("Onboarding setup evidence does not match the install and activation plans")
  }
  if (
    activation.policy.identity.applicationId !== install.applicationId
    || activation.policy.source.kind !== "config"
    || activation.policy.source.file !== options.configFile
    || !exactArray(activation.policy.readScope.guildIds, [install.guildId])
    || activation.policy.readScope.channelIds.length !== 0
    || stableString(activation.launch) !== stableString(setup.launch)
  ) {
    throw new ConfigurationError("Onboarding activation does not match the exact installed guild policy")
  }
  if (
    smoke.status !== "ok"
    || smoke.transport !== "stdio"
    || smoke.applicationId !== setup.applicationId
    || smoke.botId !== setup.botId
    || smoke.serverVersion !== CONNECTOR_VERSION
    || smoke.configuredGuildCount !== 1
    || smoke.installedInScopeGuildCount !== 1
    || smoke.missingConfiguredGuildCount !== 0
    || smoke.installedGuildCount !== smoke.unexpectedGuildCount + 1
    || smoke.toolSurface !== setup.toolSurface
    || !exactArray(smoke.toolsets, setup.toolsets)
    || smoke.destructiveTools.length !== 0
    || smoke.writeCapableTools.length !== 0
  ) {
    throw new ConfigurationError("Onboarding smoke evidence does not match the verified setup")
  }
}

export function isOnboardHostId(value: string): value is OnboardHostId {
  return (ONBOARD_HOST_IDS as readonly string[]).includes(value)
}

export function isDetectableOnboardHostId(
  value: string,
): value is DetectableOnboardHostId {
  return (ONBOARD_DETECTABLE_HOST_IDS as readonly string[]).includes(value)
}

export function onboardHostDescriptor(id: OnboardHostId): OnboardHostDescriptor {
  return Object.freeze({ id, title: HOST_TITLES[id] })
}

export function onboardHostSupportsCredentialFile(id: OnboardHostId): boolean {
  return id !== "claude-desktop"
}

export function resolveDefaultOnboardConfigFile(
  options: ProfileLocationOptions = {},
): string {
  return join(dirname(resolveProfileDirectory(options)), DEFAULT_CONFIG_FILE_NAME)
}

export function assertReusableOnboardPolicy(
  document: ConnectorConfigDocument,
  configFile: string,
  install: BotInstallPlan,
): void {
  const preset = getSetupPreset("server-observer")
  const expected = createConnectorConfigDocument({
    applicationId: install.applicationId,
    botId: document.identity.botId,
    channelIds: [],
    ...(document.credential.provider === "environment"
      ? { credentialVariable: document.credential.variable }
      : { credentialFile: document.credential.path }),
    gatewayEnabled: preset.gatewayEnabled,
    guildIds: [install.guildId],
    name: normalizeConfigName(basename(configFile, extname(configFile))),
    toolsets: preset.toolsets,
    toolSurface: preset.toolSurface,
  })
  if (stableString(document) !== stableString(expected)) {
    throw new ConfigurationError(REUSABLE_POLICY_MISMATCH_MESSAGE)
  }
}

export function reusableOnboardInstallPlan(
  document: ConnectorConfigDocument,
  configFile: string,
): BotInstallPlan {
  const [guildId, ...additionalGuildIds] = document.readScope.guildIds
  if (!guildId || additionalGuildIds.length > 0) {
    throw new ConfigurationError(REUSABLE_POLICY_MISMATCH_MESSAGE)
  }
  const install = createBotInstallPlan({
    applicationId: document.identity.applicationId,
    guildId,
    preset: "server-observer",
  })
  assertReusableOnboardPolicy(document, configFile, install)
  return install
}

export function resolveAvailableOnboardHtmlFile(
  configFile: string,
  exists: (file: string) => boolean,
): string {
  const directory = dirname(configFile)
  for (let index = 1; index <= DEFAULT_GUIDE_FILE_LIMIT; index += 1) {
    const name = index === 1
      ? DEFAULT_GUIDE_FILE_NAME
      : `${DEFAULT_GUIDE_FILE_STEM}-${index}.html`
    const candidate = join(directory, name)
    if (!exists(candidate)) return candidate
  }
  throw new ConfigurationError(
    "No default onboarding guide filename is available; choose an explicit --html path",
  )
}

export function createOnboardReport(
  options: CreateOnboardReportOptions,
): OnboardReport {
  if (!["created", "reused"].includes(options.policyDisposition)) {
    throw new ConfigurationError("Onboarding requires an exact policy disposition")
  }
  const install = exactInstallPlan(options.install)
  assertMatchingEvidence({ ...options, install })
  const host = deepFreeze({
    ...onboardHostDescriptor(options.hostId),
    route: hostRoute(options.hostId, options.activation),
  })
  const base: Omit<OnboardReport, "onboardDigest"> = deepFreeze({
    activation: options.activation,
    configFile: options.configFile,
    credentialHandoff: credentialHandoff(
      options.credentialAccess,
      host,
      options.setup,
    ),
    firstRead: install.postInstall.firstRead,
    format: ONBOARD_REPORT_FORMAT,
    host,
    install,
    policyDisposition: options.policyDisposition,
    privacy: {
      credentialValuesEmbedded: false as const,
      hostConfigurationChanged: false as const,
      messageContentRead: false as const,
      writeCapable: false as const,
    },
    schemaVersion: ONBOARD_REPORT_SCHEMA_VERSION,
    setup: options.setup,
    smoke: options.smoke,
    status: "ok" as const,
  })
  return deepFreeze({
    ...base,
    onboardDigest: digest(base),
  })
}

export function verifyOnboardReport(value: unknown): value is OnboardReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const report = value as OnboardReport
  if (!isOnboardHostId(report.host?.id || "")) return false
  try {
    return stableString(report) === stableString(createOnboardReport({
      activation: report.activation,
      configFile: report.configFile,
      credentialAccess: report.credentialHandoff.setupAccess,
      hostId: report.host.id,
      install: report.install,
      policyDisposition: report.policyDisposition,
      setup: report.setup,
      smoke: report.smoke,
    }))
  } catch {
    return false
  }
}
