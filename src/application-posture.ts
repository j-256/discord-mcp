import {
  DISCORD_APPLICATION_FLAGS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import { ApplicationPostureEvidenceError } from "./errors.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_PERMISSIONS,
  DISCORD_PERMISSION_NAMES,
  type DiscordPermissionName,
} from "./permissions.js"
import type { DiscordApplication } from "./types.js"

const APPLICATION_KEYS = [
  "approximate_guild_count",
  "approximate_user_authorization_count",
  "approximate_user_install_count",
  "bot",
  "bot_public",
  "bot_require_code_grant",
  "cover_image",
  "custom_install_url",
  "description",
  "event_webhooks_status",
  "event_webhooks_types",
  "event_webhooks_url",
  "flags",
  "flags_new",
  "guild",
  "guild_id",
  "icon",
  "id",
  "install_params",
  "integration_types_config",
  "interactions_endpoint_url",
  "name",
  "owner",
  "primary_sku_id",
  "privacy_policy_url",
  "redirect_uris",
  "role_connections_verification_url",
  "rpc_origins",
  "slug",
  "tags",
  "team",
  "terms_of_service_url",
  "verify_key",
] as const
const INTEGRATION_CONFIGURATION_KEYS = ["oauth2_install_params"] as const
const INSTALL_PARAM_KEYS = ["permissions", "scopes"] as const
const GUILD_INSTALL_TYPE = "0"
const USER_INSTALL_TYPE = "1"
const APPLICATION_COMMANDS_SCOPE = "applications.commands"
const BOT_SCOPE = "bot"
const MAX_COLLECTION_ITEMS = 100
const MAX_SCOPE_CHARACTERS = 256
const MAX_URL_CHARACTERS = 2_048
const MAX_PERMISSION_DIGITS = 256
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u
const KNOWN_APPLICATION_FLAG_BITS = Object.values(DISCORD_APPLICATION_FLAGS).reduce(
  (mask, value) => mask | value,
  0n,
)

export type ApplicationIntentStatus = "disabled" | "enabled" | "unknown"
export type ApplicationFlagEvidenceSource = "flags" | "flags-new"

export interface ApplicationFlagEvidence {
  source: ApplicationFlagEvidenceSource
  value: bigint
}
export type ApplicationConnectorFit =
  | "blocked"
  | "compatible"
  | "degraded"
  | "not-required"
  | "unknown"
  | "unnecessary"
export type ApplicationMessageContentRequirement =
  | "not-required"
  | "recommended"
  | "required"
export type ApplicationPostureFindingSeverity = "blocker" | "warning"
export type ApplicationPostureFindingCode =
  | "administrator-default-permissions"
  | "bot-public"
  | "custom-install-url"
  | "event-webhooks-enabled"
  | "guild-install-unsupported"
  | "interaction-delivery-conflict"
  | "oauth-code-grant-required"
  | "presence-intent-enabled"
  | "recommended-message-content-intent-disabled"
  | "required-guild-members-intent-disabled"
  | "required-message-content-intent-disabled"
  | "unknown-install-contexts"
  | "unknown-install-permissions"
  | "unknown-required-intent-state"

export interface ApplicationPostureRequirements {
  guildMembersIntentRequired: boolean
  messageContentIntent: ApplicationMessageContentRequirement
  nativeInteractionIngressRequired: boolean
}

export interface ApplicationInstallDefaults {
  administrator: boolean
  applicationCommandsScope: boolean
  botScope: boolean
  permissionNames: DiscordPermissionName[]
  unknownFieldCount: number
  unknownPermissionBitCount: number
  unknownScopeCount: number
}

export interface ApplicationInstallContextPosture {
  defaultAuthorization: ApplicationInstallDefaults | null
  supported: boolean | null
  unknownFieldCount: number
}

export interface ApplicationPostureFinding {
  action: string
  code: ApplicationPostureFindingCode
  severity: ApplicationPostureFindingSeverity
  summary: string
}

export interface ApplicationPostureResult {
  access: {
    botPublic: boolean
    botRequiresCodeGrant: boolean
  }
  applicationFlags: {
    unknownBitCount: number | null
    verificationPendingGuildLimit: boolean | null
  }
  applicationId: string
  botId: string
  connectorFit: {
    callbackFreeGuildInstall: ApplicationConnectorFit
    guildMembersIntent: ApplicationConnectorFit
    messageContentIntent: ApplicationConnectorFit
    nativeInteractionIngress: ApplicationConnectorFit
    presenceIntent: ApplicationConnectorFit
  }
  eventWebhooks: {
    endpointConfigured: boolean
    status: "disabled" | "disabled-by-discord" | "enabled" | "not-reported" | "unknown"
    subscriptionTypeCount: number | null
  }
  findingCounts: {
    blockers: number
    warnings: number
  }
  findings: ApplicationPostureFinding[]
  installation: {
    contextsReported: boolean
    customInstallUrlConfigured: boolean
    guild: ApplicationInstallContextPosture
    legacyDefaults: ApplicationInstallDefaults | null
    redirectUriCount: number | null
    rpcOriginCount: number | null
    unknownContextCount: number
    user: ApplicationInstallContextPosture
  }
  interactions: {
    delivery: "gateway" | "outgoing-webhook"
    endpointConfigured: boolean
  }
  privacy: {
    omitted: readonly string[]
    persistence: "none"
    rawPayloads: "omitted"
    text: "fixed-derived-only"
    unknownFields: "counts-only"
  }
  privilegedIntents: {
    guildMembers: ApplicationIntentStatus
    messageContent: ApplicationIntentStatus
    presence: ApplicationIntentStatus
  }
  roleConnections: {
    verificationEndpointConfigured: boolean
  }
  schemaVersion: number
  status: "ok"
  unknownEnumCount: number
  unknownFieldCount: number
}

interface ProjectedInstallConfiguration {
  context: ApplicationInstallContextPosture
  unknownFieldCount: number
}

function evidenceError(): ApplicationPostureEvidenceError {
  return new ApplicationPostureEvidenceError(
    "Discord returned invalid current-application posture evidence",
  )
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError()
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length > MAX_COLLECTION_ITEMS) throw evidenceError()
  return record
}

function unknownFieldCount(
  record: Record<string, unknown>,
  known: readonly string[],
): number {
  return Object.keys(record).filter((key) => !known.includes(key)).length
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertOptionalPresenceString(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_URL_CHARACTERS
    || CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError()
  return true
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function boundedStringArray(
  value: unknown,
  maximumCharacters: number,
): string[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    throw evidenceError()
  }
  const seen = new Set<string>()
  for (const entry of value) {
    if (
      typeof entry !== "string"
      || entry.length === 0
      || entry.length > maximumCharacters
      || CONTROL_PATTERN.test(entry)
      || !validUnicode(entry)
      || seen.has(entry)
    ) throw evidenceError()
    seen.add(entry)
  }
  return [...seen]
}

function bitCount(value: bigint): number {
  let remaining = value
  let count = 0
  while (remaining > 0n) {
    count += Number(remaining & 1n)
    remaining >>= 1n
  }
  return count
}

export function projectApplicationFlagEvidence(
  application: DiscordApplication,
): ApplicationFlagEvidence | null {
  const record = recordValue(application)
  if (record.flags_new !== undefined) {
    if (
      typeof record.flags_new !== "string"
      || record.flags_new.length > MAX_PERMISSION_DIGITS
      || !DECIMAL_PATTERN.test(record.flags_new)
    ) return null
    return {
      source: "flags-new",
      value: BigInt(record.flags_new),
    }
  }
  if (
    record.flags === undefined
    || !Number.isSafeInteger(record.flags)
    || (record.flags as number) < 0
  ) return null
  return {
    source: "flags",
    value: BigInt(record.flags as number),
  }
}

function intentStatus(
  flags: bigint | null,
  bits: bigint,
): ApplicationIntentStatus {
  if (flags === null) return "unknown"
  return (flags & bits) !== 0n ? "enabled" : "disabled"
}

export function projectApplicationPrivilegedIntents(
  application: DiscordApplication,
): ApplicationPostureResult["privilegedIntents"] {
  const flags = projectApplicationFlagEvidence(application)?.value ?? null
  return {
    guildMembers: intentStatus(
      flags,
      DISCORD_APPLICATION_FLAGS.gatewayGuildMembers
        | DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited,
    ),
    messageContent: intentStatus(
      flags,
      DISCORD_APPLICATION_FLAGS.gatewayMessageContent
        | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited,
    ),
    presence: intentStatus(
      flags,
      DISCORD_APPLICATION_FLAGS.gatewayPresence
        | DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited,
    ),
  }
}

function projectInstallDefaults(value: unknown): ApplicationInstallDefaults {
  const record = recordValue(value)
  const scopes = boundedStringArray(record.scopes, MAX_SCOPE_CHARACTERS)
  if (
    scopes === null
    || typeof record.permissions !== "string"
    || record.permissions.length > MAX_PERMISSION_DIGITS
    || !DECIMAL_PATTERN.test(record.permissions)
  ) throw evidenceError()
  const permissions = BigInt(record.permissions)
  const permissionNames = DISCORD_PERMISSION_NAMES.filter((name) => (
    (permissions & DISCORD_PERMISSIONS[name]) !== 0n
  ))
  return {
    administrator: permissionNames.includes("ADMINISTRATOR"),
    applicationCommandsScope: scopes.includes(APPLICATION_COMMANDS_SCOPE),
    botScope: scopes.includes(BOT_SCOPE),
    permissionNames,
    unknownFieldCount: unknownFieldCount(record, INSTALL_PARAM_KEYS),
    unknownPermissionBitCount: bitCount(permissions & ~ALL_KNOWN_PERMISSION_BITS),
    unknownScopeCount: scopes.filter((scope) => (
      scope !== APPLICATION_COMMANDS_SCOPE && scope !== BOT_SCOPE
    )).length,
  }
}

function projectInstallConfiguration(
  value: unknown,
): ProjectedInstallConfiguration {
  const record = recordValue(value)
  const nestedUnknownFieldCount = unknownFieldCount(
    record,
    INTEGRATION_CONFIGURATION_KEYS,
  )
  const defaultAuthorization = record.oauth2_install_params === undefined
    ? null
    : projectInstallDefaults(record.oauth2_install_params)
  return {
    context: {
      defaultAuthorization,
      supported: true,
      unknownFieldCount: nestedUnknownFieldCount
        + (defaultAuthorization?.unknownFieldCount ?? 0),
    },
    unknownFieldCount: nestedUnknownFieldCount
      + (defaultAuthorization?.unknownFieldCount ?? 0),
  }
}

function missingInstallContext(
  contextsReported: boolean,
): ApplicationInstallContextPosture {
  return {
    defaultAuthorization: null,
    supported: contextsReported ? false : null,
    unknownFieldCount: 0,
  }
}

function fitRequiredIntent(
  status: ApplicationIntentStatus,
  required: boolean,
): ApplicationConnectorFit {
  if (!required) return "not-required"
  if (status === "enabled") return "compatible"
  if (status === "disabled") return "blocked"
  return "unknown"
}

function fitMessageContentIntent(
  status: ApplicationIntentStatus,
  requirement: ApplicationMessageContentRequirement,
): ApplicationConnectorFit {
  if (requirement === "not-required") return "not-required"
  if (status === "enabled") return "compatible"
  if (status === "unknown") return "unknown"
  return requirement === "required" ? "blocked" : "degraded"
}

function finding(
  code: ApplicationPostureFindingCode,
  severity: ApplicationPostureFindingSeverity,
  summary: string,
  action: string,
): ApplicationPostureFinding {
  return { action, code, severity, summary }
}

function postureFindings(result: Omit<
  ApplicationPostureResult,
  "findingCounts" | "findings"
>): ApplicationPostureFinding[] {
  const findings: ApplicationPostureFinding[] = []
  if (result.installation.guild.supported === false) {
    findings.push(finding(
      "guild-install-unsupported",
      "blocker",
      "The application does not advertise guild installation support",
      "Enable Guild Install in the Discord Developer Portal before installing the connector",
    ))
  }
  if (result.access.botRequiresCodeGrant) {
    findings.push(finding(
      "oauth-code-grant-required",
      "blocker",
      "The bot requires a full OAuth2 code grant",
      "Disable the bot code-grant requirement to use the connector's callback-free install plan",
    ))
  }
  if (result.connectorFit.nativeInteractionIngress === "blocked") {
    findings.push(finding(
      "interaction-delivery-conflict",
      "blocker",
      "Outgoing-webhook Interaction delivery blocks Gateway Interaction ingress",
      "Remove the Interactions endpoint URL or disable native Interaction ingress in the selected policy",
    ))
  }
  if (result.connectorFit.guildMembersIntent === "blocked") {
    findings.push(finding(
      "required-guild-members-intent-disabled",
      "blocker",
      "Configured member-directory reads require Guild Members intent",
      "Enable Guild Members intent in the Discord Developer Portal or disable member-directory reads",
    ))
  }
  if (result.connectorFit.messageContentIntent === "blocked") {
    findings.push(finding(
      "required-message-content-intent-disabled",
      "blocker",
      "Configured content-dependent writes require Message Content intent",
      "Enable Message Content intent in the Discord Developer Portal or disable the dependent writes",
    ))
  }
  if (
    result.connectorFit.guildMembersIntent === "unknown"
    || result.connectorFit.messageContentIntent === "unknown"
  ) {
    findings.push(finding(
      "unknown-required-intent-state",
      "warning",
      "Discord did not provide valid flags for every required or recommended privileged intent",
      "Verify the privileged intent settings in the Discord Developer Portal",
    ))
  }
  const installDefaults = [
    result.installation.guild.defaultAuthorization,
    result.installation.legacyDefaults,
    result.installation.user.defaultAuthorization,
  ].filter((value): value is ApplicationInstallDefaults => value !== null)
  if (installDefaults.some(({ administrator }) => administrator)) {
    findings.push(finding(
      "administrator-default-permissions",
      "warning",
      "A default install configuration requests Administrator",
      "Replace Administrator with the connector's preset-derived least-privilege permission grant",
    ))
  }
  if (result.access.botPublic) {
    findings.push(finding(
      "bot-public",
      "warning",
      "Users other than the application owner can add the bot to guilds",
      "Keep the bot private unless third-party installation is intentional and separately operated",
    ))
  }
  if (result.installation.customInstallUrlConfigured) {
    findings.push(finding(
      "custom-install-url",
      "warning",
      "The application profile uses a custom install URL",
      "Review the custom authorization flow separately and prefer the connector's guild-locked install plan",
    ))
  }
  if (result.eventWebhooks.status === "enabled") {
    findings.push(finding(
      "event-webhooks-enabled",
      "warning",
      "Application event webhooks are enabled outside this local connector",
      "Confirm the external event receiver is intentional and independently secured",
    ))
  }
  if (result.connectorFit.presenceIntent === "unnecessary") {
    findings.push(finding(
      "presence-intent-enabled",
      "warning",
      "Presence intent is enabled but unused by this connector",
      "Disable Presence intent unless another application workload requires it",
    ))
  }
  if (result.connectorFit.messageContentIntent === "degraded") {
    findings.push(finding(
      "recommended-message-content-intent-disabled",
      "warning",
      "Native message search may be unavailable without Message Content intent",
      "Enable Message Content intent if native search is required",
    ))
  }
  if (
    !result.installation.contextsReported
    || result.installation.unknownContextCount > 0
  ) {
    findings.push(finding(
      "unknown-install-contexts",
      "warning",
      "Discord installation-context evidence is incomplete or contains unknown context types",
      "Review supported installation contexts in the Discord Developer Portal",
    ))
  }
  if (installDefaults.some((defaults) => (
    defaults.unknownPermissionBitCount > 0 || defaults.unknownScopeCount > 0
  ))) {
    findings.push(finding(
      "unknown-install-permissions",
      "warning",
      "A default install configuration contains unknown scopes or permission bits",
      "Replace the defaults with documented scopes and the connector's known least-privilege permissions",
    ))
  }
  return findings
}

export function projectApplicationPosture(
  application: DiscordApplication,
  botId: string,
  requirements: ApplicationPostureRequirements,
): ApplicationPostureResult {
  const record = recordValue(application)
  if (
    !validSnowflake(record.id)
    || !validSnowflake(botId)
    || typeof record.bot_public !== "boolean"
    || typeof record.bot_require_code_grant !== "boolean"
  ) throw evidenceError()

  const flags = projectApplicationFlagEvidence(application)?.value ?? null
  const privilegedIntents = projectApplicationPrivilegedIntents(application)

  const contextsReported = record.integration_types_config !== undefined
  let guild = missingInstallContext(contextsReported)
  let user = missingInstallContext(contextsReported)
  let unknownContextCount = 0
  let nestedUnknownFieldCount = 0
  if (contextsReported) {
    const configurations = recordValue(record.integration_types_config)
    for (const [type, value] of Object.entries(configurations)) {
      if (type !== GUILD_INSTALL_TYPE && type !== USER_INSTALL_TYPE) {
        const unknownConfiguration = recordValue(value)
        nestedUnknownFieldCount += Object.keys(unknownConfiguration).length
        unknownContextCount += 1
        continue
      }
      const projected = projectInstallConfiguration(value)
      nestedUnknownFieldCount += projected.unknownFieldCount
      if (type === GUILD_INSTALL_TYPE) guild = projected.context
      else user = projected.context
    }
  }

  const legacyDefaults = record.install_params === undefined
    ? null
    : projectInstallDefaults(record.install_params)
  nestedUnknownFieldCount += legacyDefaults?.unknownFieldCount ?? 0
  const redirectUris = boundedStringArray(record.redirect_uris, MAX_URL_CHARACTERS)
  const rpcOrigins = boundedStringArray(record.rpc_origins, MAX_URL_CHARACTERS)
  const eventTypes = boundedStringArray(
    record.event_webhooks_types,
    MAX_SCOPE_CHARACTERS,
  )
  const interactionsEndpointConfigured = assertOptionalPresenceString(
    record.interactions_endpoint_url,
  )
  const eventWebhookEndpointConfigured = assertOptionalPresenceString(
    record.event_webhooks_url,
  )
  const customInstallUrlConfigured = assertOptionalPresenceString(
    record.custom_install_url,
  )
  const roleConnectionEndpointConfigured = assertOptionalPresenceString(
    record.role_connections_verification_url,
  )

  let eventWebhookStatus: ApplicationPostureResult["eventWebhooks"]["status"]
  let unknownEnumCount = unknownContextCount
  if (record.event_webhooks_status === undefined) eventWebhookStatus = "not-reported"
  else if (record.event_webhooks_status === 1) eventWebhookStatus = "disabled"
  else if (record.event_webhooks_status === 2) eventWebhookStatus = "enabled"
  else if (record.event_webhooks_status === 3) eventWebhookStatus = "disabled-by-discord"
  else if (Number.isSafeInteger(record.event_webhooks_status)) {
    eventWebhookStatus = "unknown"
    unknownEnumCount += 1
  } else throw evidenceError()

  const callbackFreeGuildInstall: ApplicationConnectorFit =
    record.bot_require_code_grant || guild.supported === false
      ? "blocked"
      : guild.supported === true
        ? "compatible"
        : "unknown"
  const connectorFit = {
    callbackFreeGuildInstall,
    guildMembersIntent: fitRequiredIntent(
      privilegedIntents.guildMembers,
      requirements.guildMembersIntentRequired,
    ),
    messageContentIntent: fitMessageContentIntent(
      privilegedIntents.messageContent,
      requirements.messageContentIntent,
    ),
    nativeInteractionIngress: requirements.nativeInteractionIngressRequired
      ? interactionsEndpointConfigured ? "blocked" as const : "compatible" as const
      : "not-required" as const,
    presenceIntent: privilegedIntents.presence === "enabled"
      ? "unnecessary" as const
      : privilegedIntents.presence === "disabled"
        ? "not-required" as const
        : "unknown" as const,
  }
  const baseResult: Omit<ApplicationPostureResult, "findingCounts" | "findings"> = {
    access: {
      botPublic: record.bot_public,
      botRequiresCodeGrant: record.bot_require_code_grant,
    },
    applicationFlags: {
      unknownBitCount: flags === null
        ? null
        : bitCount(flags & ~KNOWN_APPLICATION_FLAG_BITS),
      verificationPendingGuildLimit: flags === null
        ? null
        : (flags & DISCORD_APPLICATION_FLAGS.verificationPendingGuildLimit) !== 0n,
    },
    applicationId: record.id,
    botId,
    connectorFit,
    eventWebhooks: {
      endpointConfigured: eventWebhookEndpointConfigured,
      status: eventWebhookStatus,
      subscriptionTypeCount: eventTypes?.length ?? null,
    },
    installation: {
      contextsReported,
      customInstallUrlConfigured,
      guild,
      legacyDefaults,
      redirectUriCount: redirectUris?.length ?? null,
      rpcOriginCount: rpcOrigins?.length ?? null,
      unknownContextCount,
      user,
    },
    interactions: {
      delivery: interactionsEndpointConfigured ? "outgoing-webhook" : "gateway",
      endpointConfigured: interactionsEndpointConfigured,
    },
    privacy: {
      omitted: Object.freeze([
        "application-and-bot-profile-text",
        "media-and-verification-data",
        "owner-team-and-guild-identities",
        "raw-flags-permissions-and-unknown-fields",
        "urls-redirect-targets-and-event-type-names",
      ]),
      persistence: "none",
      rawPayloads: "omitted",
      text: "fixed-derived-only",
      unknownFields: "counts-only",
    },
    privilegedIntents,
    roleConnections: {
      verificationEndpointConfigured: roleConnectionEndpointConfigured,
    },
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    unknownEnumCount,
    unknownFieldCount: unknownFieldCount(record, APPLICATION_KEYS)
      + nestedUnknownFieldCount,
  }
  const findings = postureFindings(baseResult)
  return {
    ...baseResult,
    findingCounts: {
      blockers: findings.filter(({ severity }) => severity === "blocker").length,
      warnings: findings.filter(({ severity }) => severity === "warning").length,
    },
    findings,
  }
}
