import {
  expandedConnectorReadScope,
  expandedConnectorScope,
  type ConnectorConfigDocument,
  type ConnectorConfigScopeName,
} from "./config-document.js"
import { CONNECTOR_CLI_COMMAND } from "./constants.js"
import type {
  ConfigRecipeName,
  ConfigRecipeScopeKind,
} from "./config-recipes.js"

export interface ConfigRecipeDependencyGuidance {
  readonly command: string
  readonly recipe: ConfigRecipeName
}

interface ConfigRecipeDependencyRule {
  readonly matches: (document: ConnectorConfigDocument, message: string) => boolean
  readonly recipe: ConfigRecipeName
  readonly scopeKind: ConfigRecipeScopeKind
  readonly scopeNames: readonly ConnectorConfigScopeName[]
}

const CONFIG_RECIPE_DEPENDENCY_RULES = Object.freeze([
  {
    matches: (_document, message) => message.includes(
      "$.capabilities.applicationCommandChanges requires $.scopes.applicationCommandGuildIds",
    ),
    recipe: "guild-command-manager",
    scopeKind: "guild",
    scopeNames: ["applicationCommandGuildIds"],
  },
  {
    matches: (_document, message) => message.includes("Direct-message capabilities"),
    recipe: "direct-messenger",
    scopeKind: "user",
    scopeNames: ["directMessageUserIds"],
  },
  {
    matches: (_document, message) => message.includes("embedMessageChannelIds"),
    recipe: "channel-publisher",
    scopeKind: "channel",
    scopeNames: ["embedMessageChannelIds"],
  },
  {
    matches: (_document, message) => (
      message.includes("$.capabilities.guildIncident")
      && message.includes(" requires ")
    ),
    recipe: "incident-response",
    scopeKind: "guild",
    scopeNames: ["guildIncidentGuildIds"],
  },
  {
    matches: (_document, message) => (
      message.includes("$.capabilities.scheduledEvent")
      && message.includes(" requires ")
    ),
    recipe: "scheduled-event-manager",
    scopeKind: "guild",
    scopeNames: ["scheduledEventGuildIds"],
  },
  {
    matches: (document, message) => (
      message.includes("requires $.capabilities.webhookAudit")
      && document.capabilities.webhookCreation !== true
      && document.capabilities.webhookMessageAudit !== true
      && document.capabilities.webhookMessageChanges !== true
      && document.capabilities.webhookMessageDeletions !== true
      && document.capabilities.webhookMessageDelivery !== true
    ),
    recipe: "webhook-administrator",
    scopeKind: "channel",
    scopeNames: ["webhookChannelIds"],
  },
] as const satisfies readonly ConfigRecipeDependencyRule[])

function shellArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function fallbackScopeIds(
  document: ConnectorConfigDocument,
  kind: ConfigRecipeScopeKind,
): readonly string[] {
  if (kind === "user") return ["USER_ID"]
  const readScope = expandedConnectorReadScope(document)
  const ids = kind === "guild" ? readScope.guildIds : readScope.channelIds
  if (ids.length > 0) return ids
  return [kind === "guild" ? "GUILD_ID" : "CHANNEL_ID"]
}

function guidanceScopeIds(
  document: ConnectorConfigDocument,
  rule: ConfigRecipeDependencyRule,
): readonly string[] {
  const configured = [...new Set(rule.scopeNames.flatMap((name) => (
    expandedConnectorScope(document, name)
  )))].sort()
  return configured.length > 0
    ? configured
    : fallbackScopeIds(document, rule.scopeKind)
}

export function configRecipeDependencyGuidance(
  document: ConnectorConfigDocument,
  message: string,
  file: string,
): ConfigRecipeDependencyGuidance | undefined {
  const rule = CONFIG_RECIPE_DEPENDENCY_RULES.find((entry) => (
    entry.matches(document, message)
  ))
  if (!rule) return undefined
  const scopeOption = rule.scopeKind === "guild"
    ? "--guild-id"
    : rule.scopeKind === "channel"
      ? "--channel-id"
      : "--user-id"
  const args = [
    CONNECTOR_CLI_COMMAND,
    "recipe",
    "plan",
    rule.recipe,
    file,
    ...guidanceScopeIds(document, rule).flatMap((id) => [scopeOption, id]),
  ]
  return Object.freeze({
    command: args.map(shellArgument).join(" "),
    recipe: rule.recipe,
  })
}

export function appendConfigRecipeDependencyGuidance(
  document: ConnectorConfigDocument,
  message: string,
  file: string | undefined,
): string {
  if (file === undefined) return message
  const guidance = configRecipeDependencyGuidance(document, message, file)
  if (!guidance) return message
  return `${message}. Preferred recipe: ${guidance.recipe}. Review the complete additive fix with: ${guidance.command}`
}
