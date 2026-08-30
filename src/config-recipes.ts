import { createHash } from "node:crypto"

import {
  CONFIG_CAPABILITY_NAMES,
  CONFIG_SCOPE_NAMES,
  loadConnectorConfigDocumentFile,
  type ConnectorConfigCapabilityName,
  type ConnectorConfigDocument,
  type ConnectorConfigScopeName,
} from "./config-document.js"
import {
  resolveConnectorConfigFile,
  summarizeConnectorConfigDocument,
  validateConnectorConfigDocumentPolicy,
  writeConnectorConfigDocumentFile,
  type ConnectorConfigSummary,
} from "./config-operator.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  selectedCanonicalMcpToolNames,
  selectedMcpToolsets,
} from "./mcp-tool-catalog.js"
import { stableString } from "./normalize.js"
import {
  MCP_TOOL_RISK_CLASSES,
  type McpToolName,
  type McpToolRiskClass,
} from "./observability-catalog.js"
import {
  DISCORD_PERMISSIONS,
  DISCORD_PERMISSION_NAMES,
  type DiscordPermissionName,
} from "./permissions.js"

export const CONFIG_RECIPE_REPORT_SCHEMA_VERSION = 1
export const CONFIG_RECIPE_PLAN_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

const CONFIG_RECIPE_PLAN_FORMAT = "discord-mcp.config-recipe-plan.v1"

export const CONFIG_RECIPE_NAMES = Object.freeze([
  "guild-starter",
  "guild-builder",
  "coordination-channel",
  "message-channel",
  "channel-publisher",
  "direct-messenger",
  "incident-response",
] as const)

export type ConfigRecipeName = typeof CONFIG_RECIPE_NAMES[number]
export type ConfigRecipeScopeKind = "channel" | "guild" | "user"

export interface ConfigRecipePrivilegedIntent {
  readonly name: "MESSAGE_CONTENT"
  readonly status: "required"
}

export interface ConfigRecipeGatewayRequirement {
  readonly evidenceConnection: "guild-layout" | "none"
  readonly eventFeedPolicy: "unchanged"
  readonly intents: readonly "GUILDS"[]
}

export interface ConfigRecipeDescriptor {
  readonly capabilities: readonly ConnectorConfigCapabilityName[]
  readonly description: string
  readonly name: ConfigRecipeName
  readonly requirements: {
    readonly botPermissionBitfield: string
    readonly botPermissions: readonly DiscordPermissionName[]
    readonly gateway: ConfigRecipeGatewayRequirement
    readonly privilegedIntents: readonly ConfigRecipePrivilegedIntent[]
    readonly scope: {
      readonly kind: ConfigRecipeScopeKind
      readonly maximum: number
      readonly minimum: 1
      readonly option: "--channel-id" | "--guild-id" | "--user-id"
      readonly outerBoundary: "$.readScope.channelIds" | "$.readScope.guildIds" | null
      readonly targets: readonly `$.scopes.${ConnectorConfigScopeName}`[]
    }
  }
  readonly riskClasses: readonly McpToolRiskClass[]
  readonly risks: readonly string[]
  readonly toolNames: readonly McpToolName[]
  readonly toolsets: readonly McpToolsetName[]
  readonly warnings: readonly string[]
  readonly writeCapable: true
}

interface ConfigRecipeSource {
  readonly botPermissions: readonly DiscordPermissionName[]
  readonly capabilities: readonly ConnectorConfigCapabilityName[]
  readonly description: string
  readonly gateway: ConfigRecipeGatewayRequirement
  readonly name: ConfigRecipeName
  readonly privilegedIntents: readonly ConfigRecipePrivilegedIntent[]
  readonly risks: readonly string[]
  readonly scope: {
    readonly kind: ConfigRecipeScopeKind
    readonly names: readonly ConnectorConfigScopeName[]
  }
  readonly toolsets: readonly McpToolsetName[]
  readonly warnings: readonly string[]
}

export interface ConfigRecipeSelection {
  readonly channelIds?: readonly string[]
  readonly guildIds?: readonly string[]
  readonly name: string
  readonly userIds?: readonly string[]
}

export interface NormalizedConfigRecipeRequest {
  readonly name: ConfigRecipeName
  readonly scope: {
    readonly ids: readonly string[]
    readonly kind: ConfigRecipeScopeKind
  }
}

export interface ConfigRecipeChange {
  readonly after: boolean | readonly string[]
  readonly before: boolean | readonly string[]
  readonly path: string
}

export interface ConfigRecipeCommand {
  readonly args: readonly string[]
  readonly command: "discord-mcp"
}

export interface ConfigRecipePlanReport {
  readonly action: "plan"
  readonly applyCommand: ConfigRecipeCommand
  readonly changes: readonly ConfigRecipeChange[]
  readonly confirmation: {
    readonly requiredValue: ConfigRecipeName
  }
  readonly currentDocumentDigest: string
  readonly currentSummary: ConnectorConfigSummary
  readonly execution: {
    readonly configurationWritten: false
    readonly discordContacted: false
    readonly secretValuesRead: false
  }
  readonly file: string
  readonly nextChecks: readonly ConfigRecipeCommand[]
  readonly planDigest: string
  readonly proposedDocument: ConnectorConfigDocument
  readonly proposedDocumentDigest: string
  readonly proposedSummary: ConnectorConfigSummary
  readonly recipe: ConfigRecipeDescriptor
  readonly recipeContractDigest: string
  readonly request: NormalizedConfigRecipeRequest
  readonly risks: readonly string[]
  readonly schemaVersion: typeof CONFIG_RECIPE_REPORT_SCHEMA_VERSION
  readonly status: "already-current" | "planned"
  readonly warnings: readonly string[]
}

export interface ConfigRecipePlanOptions extends ConfigRecipeSelection {
  readonly file: string
}

export interface ConfigRecipeApplyOptions extends ConfigRecipePlanOptions {
  readonly confirmation: string
  readonly planDigest: string
}

export interface ConfigRecipeApplyReport extends Omit<
  ConfigRecipePlanReport,
  "action" | "execution" | "status"
> {
  readonly action: "apply"
  readonly applied: boolean
  readonly backupFile?: string
  readonly execution: {
    readonly configurationWritten: boolean
    readonly discordContacted: false
    readonly secretValuesRead: false
  }
  readonly status: "already-current" | "applied"
}

const CONFIG_RECIPE_SOURCES = Object.freeze([
  {
    botPermissions: [
      "MANAGE_CHANNELS",
      "MANAGE_GUILD",
      "VIEW_CHANNEL",
    ],
    capabilities: [
      "channelOrderingAudit",
      "channelOrderingChanges",
      "guildScaffolds",
      "guildSettingsAudit",
      "guildSettingsChanges",
    ],
    description: "Add the minimum connector policy for deterministic public-only guild blueprint starters: additive structure, symbolic category and child ordering, and conservative named settings through the ordinary reviewed blueprint lifecycle while preserving the live guild name.",
    gateway: {
      evidenceConnection: "guild-layout",
      eventFeedPolicy: "unchanged",
      intents: ["GUILDS"],
    },
    name: "guild-starter",
    privilegedIntents: [],
    risks: [
      "Blueprint execution can create public categories, text channels, and forum channels in each exact selected guild",
      "Blueprint channel-order chains can reorder or explicitly reparent existing compatible channels in each exact selected guild when a separately authored manifest references them",
      "Starter settings change default notifications, explicit content filtering, and the system channel",
    ],
    scope: {
      kind: "guild",
      names: [
        "channelOrderingGuildIds",
        "guildScaffoldGuildIds",
        "guildSettingsGuildIds",
      ],
    },
    toolsets: ["guild-blueprints"],
    warnings: [
      "Every execution still requires pinned identity, exact scope, complete permissions, a fresh plan, signed approval, pending content-free evidence, one non-retried mutation, and exact readback",
      "The recipe does not request Manage Roles or Administrator, while the starter compiler creates no role and assigns no member",
      "Supplying guildName additionally requires separately reviewed guild-profile audit and change capabilities plus exact guild scope; this recipe deliberately omits that optional replacement authority",
      "Guild scaffolds are shared with custom blueprints; an existing Manage Roles grant can still satisfy a separately authored role-creation frontier, so retain the compiled request and least-privilege bot permissions",
      "Information channels remain ordinary public text channels until their proven exact IDs receive separately configured and reviewed permission overwrites",
      "The compiled starter orders categories and multi-channel parent groups without reparenting; separately authored channel-order chains share this exact-guild authority and can reparent only with explicit acknowledgement",
      "Guild-settings evidence activates a privacy-minimized GUILDS-only layout connection while the configured event-feed policy remains unchanged",
      "Community, Welcome Screen, onboarding, AutoMod, publications, existing-role configuration, role ordering, channel metadata, and permission overwrites remain disabled",
    ],
  },
  {
    botPermissions: [
      "MANAGE_CHANNELS",
      "MANAGE_GUILD",
      "VIEW_CHANNEL",
      "MANAGE_ROLES",
    ],
    capabilities: [
      "automodAudit",
      "automodChanges",
      "channelOrderingAudit",
      "channelOrderingChanges",
      "guildCommunityAudit",
      "guildCommunityChanges",
      "guildProfileAudit",
      "guildProfileChanges",
      "guildScaffolds",
      "guildSettingsAudit",
      "guildSettingsChanges",
      "onboardingAudit",
      "onboardingChanges",
      "welcomeScreenAudit",
      "welcomeScreenChanges",
    ],
    description: "Add exact-guild caller-retained blueprints for additive structure, exact or receipt-bound channel-order chains, guild profile, named settings, monotonic Community enablement and routing, complete Welcome Screen, complete onboarding, and receipt-bound staged AutoMod policy through one reviewed frontier per call. Role-order and permission-overwrite phases remain available only after their narrower standalone gates and exact scopes are added separately.",
    gateway: {
      evidenceConnection: "guild-layout",
      eventFeedPolicy: "unchanged",
      intents: ["GUILDS"],
    },
    name: "guild-builder",
    privilegedIntents: [],
    risks: [
      "Blueprint execution can create roles, channels, or disabled AutoMod rules and replace guild profile, settings, Community routing, Welcome Screen, onboarding, or exact AutoMod policy state",
      "Acknowledged channel-order chains can reorder or reparent compatible existing channels while preserving their exact permission overwrites without synchronizing them",
      "Community enablement adds a durable Discord guild feature and routes administrative, rules, and optional safety notices to selected exact channels",
      "Welcome Screen and onboarding are complete replacement surfaces, so omitted existing entries are reviewed removals",
      "AutoMod rules can block member interactions or messages, notify moderator channels, time out members, or change enforcement coverage",
    ],
    scope: {
      kind: "guild",
      names: [
        "automodGuildIds",
        "channelOrderingGuildIds",
        "guildScaffoldGuildIds",
        "guildCommunityGuildIds",
        "guildProfileGuildIds",
        "guildSettingsGuildIds",
        "onboardingGuildIds",
        "welcomeScreenGuildIds",
      ],
    },
    toolsets: ["guild-blueprints"],
    warnings: [
      "Every execution still requires the underlying exact scope, Discord permissions, fresh plan, signed approval, pending content-free evidence, one non-retried mutation, and exact readback",
      "Community routing needs Manage Guild; first-time enablement needs temporary guild ownership or complete Administrator authority, which this recipe does not grant and should be removed after the frontier",
      "AutoMod timeout actions additionally require MODERATE_MEMBERS; the recipe does not grant that conditional permission to builders that do not use timeouts",
      "New AutoMod rules are created disabled, exact existing rules never use name-based adoption, and each disable, configure, or enable stage requires a separate fresh review",
      "AutoMod alert destinations remain unavailable until their exact Discord channel IDs are separately added to scopes.automodAlertChannelIds; the recipe never infers or broadens that content-bearing scope",
      "Channel-order chains require globally unique exact or receipt-bound references; cross-parent movement additionally requires explicit per-chain acknowledgement",
      "Role-order convergence remains unavailable until roleOrderingAudit and roleOrderingChanges are enabled for the exact guild; this recipe never infers hierarchy authority from Manage Roles",
      "Permission-overwrite convergence remains unavailable until permissionOverwrites is enabled and every exact channel is added to permissionOverwriteChannelIds; the recipe cannot infer future scaffold channel IDs",
      "Guild-settings, Community, and onboarding evidence activate a privacy-minimized GUILDS-only Gateway layout connection while the configured event-feed policy remains unchanged",
      "Static Components V2 and rich-embed publications remain unavailable until exact channels are added through the channel-publisher recipe",
    ],
  },
  {
    botPermissions: [
      "VIEW_CHANNEL",
      "SEND_MESSAGES",
      "READ_MESSAGE_HISTORY",
      "SEND_MESSAGES_IN_THREADS",
    ],
    capabilities: ["interactions"],
    description: "Add authority-free directed-note reads and guarded idempotent publication for exact channels or their documented active-thread scope without enabling general message, reaction, component, or embed tools.",
    gateway: {
      evidenceConnection: "none",
      eventFeedPolicy: "unchanged",
      intents: [],
    },
    name: "coordination-channel",
    privilegedIntents: [],
    risks: [
      "Coordination-note sends and replies make visible Discord changes",
      "An optional separately allowlisted exact-user notification creates a visible Discord mention",
    ],
    scope: {
      kind: "channel",
      names: ["interactionChannelIds"],
    },
    toolsets: ["coordination"],
    warnings: [
      "Routing labels are visible, copyable, spoofable, and caller-retained; they never identify a participant, register a session, prove liveness, or grant authority",
      "Only strict messages authored by the pinned current bot are eligible, so Discord's app-authored-message exception keeps the privileged Message Content intent unnecessary",
      "Mentions remain suppressed unless exact notification users are configured separately and visibly referenced in the reviewed note",
      "The recipe creates no alias registry, persona store, listener, timer, background poller, coordination database, or execution authority",
      "Aggregate reaction status remains unavailable until the interactions toolset is selected separately; reaction-user audit and reaction moderation remain separately gated",
      "A newly scaffolded coordination channel must be added after its exact Discord ID is known",
    ],
  },
  {
    botPermissions: [
      "VIEW_CHANNEL",
      "SEND_MESSAGES",
      "READ_MESSAGE_HISTORY",
      "SEND_MESSAGES_IN_THREADS",
    ],
    capabilities: ["interactions"],
    description: "Add safe plain-text sends, replies, connector-owned edits, and bounded long-operation acknowledgement for exact channels or their documented active-thread scope without enabling message-history, reaction, component, embed, or coordination tools.",
    gateway: {
      evidenceConnection: "none",
      eventFeedPolicy: "unchanged",
      intents: [],
    },
    name: "message-channel",
    privilegedIntents: [],
    risks: [
      "Message sends and replies make visible Discord changes",
      "Message edits replace exact connector-authored plain text and can remove omitted content",
      "Typing acknowledgement briefly exposes that the connector is processing a command",
    ],
    scope: {
      kind: "channel",
      names: ["interactionChannelIds"],
    },
    toolsets: ["message-writes"],
    warnings: [
      "Mentions remain suppressed unless exact notification users are configured separately and visibly referenced in the message",
      "Discord exempts app-authored messages from Message Content restrictions, so exact connector-message readback needs no privileged intent",
      "Sends and edits retain nonce-based duplicate prevention, shared anti-spam limits, exact authorship checks, and fresh readback",
      "Typing acknowledgement is intended only for commands whose processing is expected to take several seconds and is never retried",
      "A newly scaffolded message channel must be added after its exact Discord ID is known",
    ],
  },
  {
    botPermissions: [
      "ADD_REACTIONS",
      "VIEW_CHANNEL",
      "SEND_MESSAGES",
      "EMBED_LINKS",
      "READ_MESSAGE_HISTORY",
      "SEND_MESSAGES_IN_THREADS",
    ],
    capabilities: ["embedMessages", "interactions"],
    description: "Add bounded message reads plus safe plain-text, reviewed static Components V2, and reviewed static rich-embed publication for exact channels or their documented active-thread scope.",
    gateway: {
      evidenceConnection: "none",
      eventFeedPolicy: "unchanged",
      intents: [],
    },
    name: "channel-publisher",
    privilegedIntents: [{
      name: "MESSAGE_CONTENT",
      status: "required",
    }],
    risks: [
      "Message sends, reactions, component creates, and rich-embed creates make visible Discord changes",
      "Message, component, and rich-embed edits replace exact bot-authored state and can remove omitted content",
    ],
    scope: {
      kind: "channel",
      names: ["embedMessageChannelIds", "interactionChannelIds"],
    },
    toolsets: ["embed-messages", "interactions", "message-writes", "messages"],
    warnings: [
      "Mentions remain suppressed unless exact notification users are configured separately and visibly referenced in the reviewed message",
      "Outbound link buttons remain disabled until their exact canonical HTTPS origins are separately added to scopes.componentLinkOrigins; the recipe never infers or broadens destination trust",
      "Rich embeds intentionally exclude embed URL and remote-asset fields, attachments, providers, and arbitrary embed types",
      "Plain content excludes HTTP URLs so Discord cannot append an unreviewed automatic link embed; embed text may contain ordinary markdown links",
      "A newly scaffolded publication channel must be added after its exact Discord ID is known",
    ],
  },
  {
    botPermissions: [],
    capabilities: [
      "directMessageAudit",
      "directMessageDeletion",
      "directMessageDelivery",
      "directMessageEditing",
    ],
    description: "Add exact-user one-to-one Discord private-message reads plus reviewed plain-text or static Components V2 send, reply, same-format connector-message edit, and irreversible deletion with forced mention suppression and content-free lifecycle evidence.",
    gateway: {
      evidenceConnection: "none",
      eventFeedPolicy: "unchanged",
      intents: [],
    },
    name: "direct-messenger",
    privilegedIntents: [],
    risks: [
      "Private-message sends and replies contact an exact configured person outside a guild channel",
      "Edits preserve the exact connector-authored private-message format, Components V2 cannot be removed from a message, and deletion is irreversible",
      "Exact recipient scope cannot establish consent, prior contact, or the recipient's expectations",
    ],
    scope: {
      kind: "user",
      names: ["directMessageUserIds"],
    },
    toolsets: ["direct-messages"],
    warnings: [
      "Every mutation requires a fresh complete-body-bound keyed plan, signed interactive approval, a request-bound one-shot schema-v2 receipt, pending content-free activity, no automatic mutation retry, and exact readback",
      "All mentions and reply-author notifications are forcibly suppressed, writes are globally bounded to five per minute, and each recipient has a fixed five-second minimum interval",
      "Planning a new send never opens a DM channel; approved execution may open one before sending and checkpoints its exact ID before message dispatch",
      "Discord may reject contact because of recipient privacy, relationship, or shared-server state; the connector does not discover users, enumerate DM channels, create group DMs, or consume DM Gateway events",
      "Outbound link buttons remain disabled until their exact canonical HTTPS origins are separately added to scopes.componentLinkOrigins; the recipe never infers or broadens destination trust",
      "Message text, component layouts, generated component IDs, previews, and transient review reasons never enter activity records or operation receipts",
    ],
  },
  {
    botPermissions: [
      "MANAGE_GUILD",
    ],
    capabilities: [
      "guildIncidentAudit",
      "guildIncidentChanges",
    ],
    description: "Add exact-guild privacy-minimized incident-action audit plus reviewed invite and member direct-message lockdown or early clearing.",
    gateway: {
      evidenceConnection: "none",
      eventFeedPolicy: "unchanged",
      intents: [],
    },
    name: "incident-response",
    privilegedIntents: [],
    risks: [
      "Disabling invites or member direct messages can disrupt legitimate guild activity",
      "Clearing an incident action early can re-enable an abused surface before Discord's existing deadline",
    ],
    scope: {
      kind: "guild",
      names: ["guildIncidentGuildIds"],
    },
    toolsets: ["guild-incidents"],
    warnings: [
      "Every change requires exact known owner or MANAGE_GUILD evidence, a fresh keyed plan, signed approval, pending content-free evidence, one non-retried PUT, and exact readback",
      "Discord documents a maximum 24-hour future deadline and does not document an audit-log reason header for this endpoint, so the human reason remains local review context only",
    ],
  },
] as const satisfies readonly ConfigRecipeSource[])

function canonicalPermissions(
  permissions: readonly DiscordPermissionName[],
  name: ConfigRecipeName,
): readonly DiscordPermissionName[] {
  if (new Set(permissions).size !== permissions.length) {
    throw new Error(`Configuration recipe ${name} includes duplicate bot permissions`)
  }
  if (permissions.includes("ADMINISTRATOR")) {
    throw new Error(`Configuration recipe ${name} cannot request Administrator`)
  }
  const result = DISCORD_PERMISSION_NAMES.filter((entry) => permissions.includes(entry))
  if (result.length !== permissions.length) {
    throw new Error(`Configuration recipe ${name} includes an unknown bot permission`)
  }
  return Object.freeze(result)
}

function canonicalCapabilities(
  capabilities: readonly ConnectorConfigCapabilityName[],
  name: ConfigRecipeName,
): readonly ConnectorConfigCapabilityName[] {
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error(`Configuration recipe ${name} includes duplicate capabilities`)
  }
  const result = CONFIG_CAPABILITY_NAMES.filter((entry) => capabilities.includes(entry))
  if (result.length !== capabilities.length) {
    throw new Error(`Configuration recipe ${name} includes an unknown capability`)
  }
  return Object.freeze(result)
}

function recipeScope(source: ConfigRecipeSource): ConfigRecipeDescriptor["requirements"]["scope"] {
  const names = CONFIG_SCOPE_NAMES.filter((name) => source.scope.names.includes(name))
  if (names.length !== source.scope.names.length) {
    throw new Error(`Configuration recipe ${source.name} includes duplicate or unknown scopes`)
  }
  const expectedSuffix = source.scope.kind === "guild"
    ? "GuildIds"
    : source.scope.kind === "channel"
      ? "ChannelIds"
      : "UserIds"
  if (names.some((name) => !name.endsWith(expectedSuffix))) {
    throw new Error(
      `Configuration recipe ${source.name} includes a scope outside its ${source.scope.kind} boundary`,
    )
  }
  const targets = Object.freeze(names.map((name) => (
    `$.scopes.${name}` as const
  )))
  return Object.freeze(source.scope.kind === "guild"
    ? {
        kind: "guild" as const,
        maximum: DISCORD_LIMITS.currentUserGuilds,
        minimum: 1 as const,
        option: "--guild-id" as const,
        outerBoundary: "$.readScope.guildIds" as const,
        targets,
      }
    : source.scope.kind === "channel"
      ? {
        kind: "channel" as const,
        maximum: DISCORD_LIMITS.searchChannelIds,
        minimum: 1 as const,
        option: "--channel-id" as const,
        outerBoundary: "$.readScope.channelIds" as const,
        targets,
      }
      : {
          kind: "user" as const,
          maximum: CONNECTOR_LIMITS.directMessageUserAllowlist,
          minimum: 1 as const,
          option: "--user-id" as const,
          outerBoundary: null,
          targets,
        })
}

function createRecipeDescriptor(source: ConfigRecipeSource): ConfigRecipeDescriptor {
  const capabilities = canonicalCapabilities(source.capabilities, source.name)
  const botPermissions = canonicalPermissions(source.botPermissions, source.name)
  const toolsets = Object.freeze(selectedMcpToolsets(new Set(source.toolsets)))
  if (toolsets.length !== source.toolsets.length) {
    throw new Error(`Configuration recipe ${source.name} includes duplicate or unknown toolsets`)
  }
  const toolNames = Object.freeze([
    MCP_DISCOVERY_TOOL_NAME,
    ...selectedCanonicalMcpToolNames(new Set(toolsets)),
  ].sort() as McpToolName[])
  const riskClasses = Object.freeze([
    ...new Set(toolNames.map((toolName) => MCP_TOOL_RISK_CLASSES[toolName])),
  ].sort() as McpToolRiskClass[])
  if (!riskClasses.some((risk) => risk.endsWith("write"))) {
    throw new Error(`Configuration recipe ${source.name} must expose a write workflow`)
  }
  const bitfield = botPermissions.reduce(
    (permissions, permission) => permissions | DISCORD_PERMISSIONS[permission],
    0n,
  ).toString()
  return Object.freeze({
    capabilities,
    description: source.description,
    name: source.name,
    requirements: Object.freeze({
      botPermissionBitfield: bitfield,
      botPermissions,
      gateway: Object.freeze({
        ...source.gateway,
        intents: Object.freeze([...source.gateway.intents]),
      }),
      privilegedIntents: Object.freeze(source.privilegedIntents.map((intent) => (
        Object.freeze({ ...intent })
      ))),
      scope: recipeScope(source),
    }),
    riskClasses,
    risks: Object.freeze([...source.risks]),
    toolNames,
    toolsets,
    warnings: Object.freeze([...source.warnings]),
    writeCapable: true as const,
  })
}

export const CONFIG_RECIPES = Object.freeze(
  CONFIG_RECIPE_SOURCES.map(createRecipeDescriptor),
)

export function normalizeConfigRecipeName(value: string): ConfigRecipeName {
  if (typeof value !== "string") {
    throw new ConfigurationError("Configuration recipe name must be a string")
  }
  const normalized = value.trim().toLowerCase()
  if (!(CONFIG_RECIPE_NAMES as readonly string[]).includes(normalized)) {
    throw new ConfigurationError(
      `Configuration recipe must be one of: ${CONFIG_RECIPE_NAMES.join(", ")}`,
    )
  }
  return normalized as ConfigRecipeName
}

export function getConfigRecipe(value: string): ConfigRecipeDescriptor {
  const name = normalizeConfigRecipeName(value)
  return CONFIG_RECIPES.find((recipe) => recipe.name === name) as ConfigRecipeDescriptor
}

function exactSnowflakes(
  values: readonly string[] | undefined,
  label: string,
  maximum: number,
): readonly string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) {
    throw new ConfigurationError(`${label} must contain 1-${maximum} Discord snowflakes`)
  }
  const normalized = values.map((value) => (
    typeof value === "string" ? value.trim() : ""
  ))
  if (normalized.some((value) => (
    !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ))) {
    throw new ConfigurationError(`${label} must contain Discord snowflakes`)
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new ConfigurationError(`${label} must contain unique Discord snowflakes`)
  }
  return Object.freeze(normalized.sort())
}

export function normalizeConfigRecipeRequest(
  selection: ConfigRecipeSelection,
): NormalizedConfigRecipeRequest {
  const recipe = getConfigRecipe(selection.name)
  if (recipe.requirements.scope.kind === "guild") {
    if (
      (selection.channelIds?.length ?? 0) > 0
      || (selection.userIds?.length ?? 0) > 0
    ) {
      const incompatible = (selection.userIds?.length ?? 0) > 0
        ? "--user-id"
        : "--channel-id"
      throw new ConfigurationError(
        `Configuration recipe ${recipe.name} accepts --guild-id, not ${incompatible}`,
      )
    }
    return Object.freeze({
      name: recipe.name,
      scope: Object.freeze({
        ids: exactSnowflakes(
          selection.guildIds,
          `Configuration recipe ${recipe.name} guild scope`,
          recipe.requirements.scope.maximum,
        ),
        kind: "guild" as const,
      }),
    })
  }
  if (recipe.requirements.scope.kind === "channel") {
    if (
      (selection.guildIds?.length ?? 0) > 0
      || (selection.userIds?.length ?? 0) > 0
    ) {
      const incompatible = (selection.userIds?.length ?? 0) > 0
        ? "--user-id"
        : "--guild-id"
      throw new ConfigurationError(
        `Configuration recipe ${recipe.name} accepts --channel-id, not ${incompatible}`,
      )
    }
    return Object.freeze({
      name: recipe.name,
      scope: Object.freeze({
        ids: exactSnowflakes(
          selection.channelIds,
          `Configuration recipe ${recipe.name} channel scope`,
          recipe.requirements.scope.maximum,
        ),
        kind: "channel" as const,
      }),
    })
  }
  if (
    (selection.guildIds?.length ?? 0) > 0
    || (selection.channelIds?.length ?? 0) > 0
  ) {
    throw new ConfigurationError(
      `Configuration recipe ${recipe.name} accepts --user-id only`,
    )
  }
  return Object.freeze({
    name: recipe.name,
    scope: Object.freeze({
      ids: exactSnowflakes(
        selection.userIds,
        `Configuration recipe ${recipe.name} user scope`,
        recipe.requirements.scope.maximum,
      ),
      kind: "user" as const,
    }),
  })
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableString(value)).digest("hex")}`
}

function scopeNames(recipe: ConfigRecipeDescriptor): readonly ConnectorConfigScopeName[] {
  return recipe.requirements.scope.targets.map((target) => (
    target.slice("$.scopes.".length) as ConnectorConfigScopeName
  ))
}

function assertInsideOuterBoundary(
  document: ConnectorConfigDocument,
  request: NormalizedConfigRecipeRequest,
): void {
  const outer = request.scope.kind === "guild"
    ? document.readScope.guildIds
    : request.scope.kind === "channel"
      ? document.readScope.channelIds
      : null
  if (outer === null) return
  if (request.scope.kind === "channel" && outer.length === 0) return
  const outside = request.scope.ids.filter((id) => !outer.includes(id))
  if (outside.length > 0) {
    throw new ConfigurationError(
      `Configuration recipe ${request.name} scope must remain inside ${request.scope.kind === "guild" ? "readScope.guildIds" : "readScope.channelIds"}: ${outside.join(", ")}`,
    )
  }
}

function proposedDocument(
  document: ConnectorConfigDocument,
  recipe: ConfigRecipeDescriptor,
  request: NormalizedConfigRecipeRequest,
): ConnectorConfigDocument {
  const capabilities: Partial<Record<ConnectorConfigCapabilityName, boolean>> = {
    ...document.capabilities,
  }
  for (const capability of recipe.capabilities) capabilities[capability] = true
  const scopes: Partial<Record<ConnectorConfigScopeName, readonly string[]>> = {
    ...document.scopes,
  }
  for (const targetScope of scopeNames(recipe)) {
    scopes[targetScope] = [...new Set([
      ...(document.scopes[targetScope] ?? []),
      ...request.scope.ids,
    ])].sort()
  }
  const selectedToolsets = new Set([
    ...document.tools.toolsets,
    ...recipe.toolsets,
  ])
  return validateConnectorConfigDocumentPolicy({
    ...document,
    capabilities,
    scopes,
    tools: {
      ...document.tools,
      toolsets: MCP_TOOLSET_NAMES.filter((toolset) => selectedToolsets.has(toolset)),
    },
  })
}

function configChanges(
  current: ConnectorConfigDocument,
  proposed: ConnectorConfigDocument,
  recipe: ConfigRecipeDescriptor,
): readonly ConfigRecipeChange[] {
  const changes: ConfigRecipeChange[] = []
  for (const capability of recipe.capabilities) {
    const before = current.capabilities[capability] ?? false
    const after = proposed.capabilities[capability] ?? false
    if (before !== after) {
      changes.push({
        after,
        before,
        path: `$.capabilities.${capability}`,
      })
    }
  }
  for (const targetScope of scopeNames(recipe)) {
    const beforeScope = current.scopes[targetScope] ?? []
    const afterScope = proposed.scopes[targetScope] ?? []
    if (JSON.stringify(beforeScope) !== JSON.stringify(afterScope)) {
      changes.push({
        after: Object.freeze([...afterScope]),
        before: Object.freeze([...beforeScope]),
        path: `$.scopes.${targetScope}`,
      })
    }
  }
  if (JSON.stringify(current.tools.toolsets) !== JSON.stringify(proposed.tools.toolsets)) {
    changes.push({
      after: Object.freeze([...proposed.tools.toolsets]),
      before: Object.freeze([...current.tools.toolsets]),
      path: "$.tools.toolsets",
    })
  }
  return Object.freeze(changes.sort((left, right) => left.path.localeCompare(right.path)))
}

function nextChecks(file: string): readonly ConfigRecipeCommand[] {
  return Object.freeze([
    Object.freeze({
      args: Object.freeze(["config", "validate", file]),
      command: "discord-mcp" as const,
    }),
    Object.freeze({
      args: Object.freeze(["doctor", "--config", file, "--online"]),
      command: "discord-mcp" as const,
    }),
    Object.freeze({
      args: Object.freeze(["smoke", "--config", file]),
      command: "discord-mcp" as const,
    }),
  ])
}

function recipeApplyCommand(
  file: string,
  request: NormalizedConfigRecipeRequest,
  planDigest: string,
): ConfigRecipeCommand {
  const scopeOption = request.scope.kind === "guild"
    ? "--guild-id"
    : request.scope.kind === "channel"
      ? "--channel-id"
      : "--user-id"
  return Object.freeze({
    args: Object.freeze([
      "recipe",
      "apply",
      request.name,
      file,
      ...request.scope.ids.flatMap((id) => [scopeOption, id]),
      "--plan-digest",
      planDigest,
      "--confirm",
      request.name,
    ]),
    command: "discord-mcp" as const,
  })
}

interface InternalRecipePlan {
  currentDocument: ConnectorConfigDocument
  report: ConfigRecipePlanReport
}

function createRecipePlan(options: ConfigRecipePlanOptions): InternalRecipePlan {
  const file = resolveConnectorConfigFile(options.file)
  const currentDocument = validateConnectorConfigDocumentPolicy(
    loadConnectorConfigDocumentFile(file),
  )
  const request = normalizeConfigRecipeRequest(options)
  const recipe = getConfigRecipe(request.name)
  assertInsideOuterBoundary(currentDocument, request)
  const proposed = proposedDocument(currentDocument, recipe, request)
  const changes = configChanges(currentDocument, proposed, recipe)
  const currentDocumentDigest = digest(currentDocument)
  const proposedDocumentDigest = digest(proposed)
  const recipeContractDigest = digest(recipe)
  const warnings = Object.freeze([
    ...recipe.warnings,
    ...(request.scope.kind === "channel" && currentDocument.readScope.channelIds.length === 0
      ? [
          "The empty outer channel allowlist permits all visible channels inside the configured guild boundary; offline planning cannot prove which configured guild owns each selected channel",
        ]
      : []),
  ])
  const planDigest = digest({
    changes,
    currentDocumentDigest,
    file,
    format: CONFIG_RECIPE_PLAN_FORMAT,
    proposedDocumentDigest,
    recipeContractDigest,
    request,
    warnings,
  })
  const report: ConfigRecipePlanReport = {
    action: "plan",
    applyCommand: recipeApplyCommand(file, request, planDigest),
    changes,
    confirmation: Object.freeze({ requiredValue: recipe.name }),
    currentDocumentDigest,
    currentSummary: summarizeConnectorConfigDocument(currentDocument),
    execution: Object.freeze({
      configurationWritten: false as const,
      discordContacted: false as const,
      secretValuesRead: false as const,
    }),
    file,
    nextChecks: nextChecks(file),
    planDigest,
    proposedDocument: proposed,
    proposedDocumentDigest,
    proposedSummary: summarizeConnectorConfigDocument(proposed),
    recipe,
    recipeContractDigest,
    request,
    risks: recipe.risks,
    schemaVersion: CONFIG_RECIPE_REPORT_SCHEMA_VERSION,
    status: changes.length === 0 ? "already-current" : "planned",
    warnings,
  }
  return { currentDocument, report }
}

export function planConfigRecipe(
  options: ConfigRecipePlanOptions,
): ConfigRecipePlanReport {
  return createRecipePlan(options).report
}

export async function applyConfigRecipe(
  options: ConfigRecipeApplyOptions,
): Promise<ConfigRecipeApplyReport> {
  const planned = createRecipePlan(options)
  const report = planned.report
  if (options.confirmation !== report.confirmation.requiredValue) {
    throw new ConfigurationError(
      `Configuration recipe confirmation must exactly match ${report.confirmation.requiredValue}`,
    )
  }
  if (!CONFIG_RECIPE_PLAN_DIGEST_PATTERN.test(options.planDigest)) {
    throw new ConfigurationError("Configuration recipe plan digest is invalid")
  }
  if (options.planDigest !== report.planDigest) {
    throw new ConfigurationError(
      "Configuration recipe plan is stale or does not match the exact file and scope request",
    )
  }
  if (report.status === "already-current") {
    return {
      ...report,
      action: "apply",
      applied: false,
      execution: Object.freeze({
        configurationWritten: false,
        discordContacted: false as const,
        secretValuesRead: false as const,
      }),
      status: "already-current",
    }
  }
  const outcome = await writeConnectorConfigDocumentFile(
    report.file,
    report.proposedDocument,
    {
      expectedCurrent: planned.currentDocument,
      overwrite: true,
    },
  )
  return {
    ...report,
    action: "apply",
    applied: true,
    ...(outcome.backupFile ? { backupFile: outcome.backupFile } : {}),
    execution: Object.freeze({
      configurationWritten: true,
      discordContacted: false as const,
      secretValuesRead: false as const,
    }),
    status: "applied",
  }
}
