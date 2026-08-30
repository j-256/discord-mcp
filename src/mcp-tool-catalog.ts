import type {
  RegisteredTool,
  ToolAnnotations,
} from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  CONNECTOR_LIMITS,
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
  MCP_TOOL_SURFACES,
  SCHEMA_VERSION,
  type McpToolsetName,
  type McpToolSurface,
} from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  MCP_TOOL_RISK_CLASSES,
  type McpToolName,
  type McpToolRiskClass,
} from "./observability-catalog.js"
import {
  MCP_TOOL_AUTH_CLASSES,
  MCP_TOOL_PERMISSION_MODES,
  MCP_TOOL_TARGET_SCOPES,
  mcpToolStaticRequirements,
  type McpToolAuthClass,
  type McpToolPermissionMode,
  type McpToolStaticRequirements,
  type McpToolTargetScope,
} from "./mcp-tool-readiness.js"

export type CanonicalMcpToolName = Exclude<
  McpToolName,
  typeof MCP_DISCOVERY_TOOL_NAME
>

export const MCP_DISCOVERY_RISKS = [
  "destructive",
  "external-read",
  "local-read",
  "write",
] as const

export type McpDiscoveryRisk = typeof MCP_DISCOVERY_RISKS[number]

const MCP_DISCOVERY_DETAILS = [
  "compact",
  "full",
] as const

type McpDiscoveryDetail = typeof MCP_DISCOVERY_DETAILS[number]
export type McpToolWorkflow =
  | "announcement-crosspost"
  | "announcement-subscription"
  | "application-emoji-change"
  | "application-entitlement-consumption"
  | "application-intent-enablement"
  | "application-role-connection-metadata-change"
  | "application-test-entitlement-change"
  | "attachment-message"
  | "automod-change"
  | "bot-profile-change"
  | "bulk-guild-ban"
  | "bulk-member-role-change"
  | "channel-cloning"
  | "channel-creation"
  | "channel-deletion"
  | "channel-metadata-change"
  | "voice-channel-status-change"
  | "channel-ordering"
  | "channel-permission-overwrite"
  | "channel-permission-sync"
  | "component-message"
  | "embed-message"
  | "direct-message-change"
  | "forum-post"
  | "forum-tag-change"
  | "guild-blueprint"
  | "guild-community-change"
  | "guild-application-command-change"
  | "global-application-command-change"
  | "guild-scaffold"
  | "guild-expression-change"
  | "guild-incident-action-change"
  | "guild-profile-change"
  | "guild-prune"
  | "guild-soundboard-change"
  | "guild-settings-change"
  | "guild-template-change"
  | "integration-deletion"
  | "guild-departure"
  | "invite-creation"
  | "invite-deletion"
  | "onboarding-change"
  | "poll-creation"
  | "poll-end"
  | "reaction-moderation"
  | "member-moderation"
  | "member-nickname-change"
  | "member-role-change"
  | "member-verification-change"
  | "member-voice-change"
  | "message-deletion"
  | "message-forward"
  | "message-pin"
  | "native-interaction-command"
  | "role-creation"
  | "role-configuration"
  | "role-deletion"
  | "role-ordering"
  | "scheduled-event-change"
  | "stage-instance-change"
  | "thread-creation"
  | "thread-governance-change"
  | "webhook-deletion"
  | "webhook-message-deletion"
  | "webhook-change"
  | "webhook-creation"
  | "welcome-screen-change"
  | "widget-settings-change"

interface ToolCatalogMetadata {
  keywords: readonly string[]
  toolset: McpToolsetName
  workflow?: McpToolWorkflow
}

interface CompleteToolAnnotations {
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
  readOnlyHint: boolean
}

export const MCP_TOOL_ACCESS_STAGES = Object.freeze([
  "guarded-write",
  "live-read",
  "local",
  "receipt-verify",
  "review-execute",
  "review-plan",
] as const)

export type McpToolAccessStage = typeof MCP_TOOL_ACCESS_STAGES[number]

export const MCP_TOOL_ACCESS_MANIFEST_FORMAT =
  "discord-mcp.tool-access-manifest.v2"

export const MCP_TOOL_ACCESS_INDEX_FORMAT =
  "discord-mcp.tool-access-index.v2"

export const MCP_TOOL_ACCESS_DOCUMENT_FORMAT =
  "discord-mcp.tool-access-document.v1"

export interface McpToolAccessContract {
  approval:
    | "host-write-and-signed-interactive"
    | "host-write-approval"
    | "none"
  authorizationEvidence:
    | "fresh-plan-recheck"
    | "none"
    | "operation-runtime"
    | "receipt-and-readback"
    | "target-bound-plan"
  companions: McpToolWorkflowCompanions
  discordRequest: "none" | "read" | "write"
  readiness: "not-applicable" | "target-specific"
  requirements: McpToolStaticRequirements
  stage: McpToolAccessStage
}

export interface McpToolWorkflowCompanions {
  execute: readonly CanonicalMcpToolName[]
  plan: readonly CanonicalMcpToolName[]
  verify: readonly CanonicalMcpToolName[]
}

export type McpToolAccessStageContract = Omit<
  McpToolAccessContract,
  "companions" | "requirements" | "stage"
>

export interface McpToolAccessEntry extends McpToolAccessContract {
  name: McpToolName
  riskClass: McpToolRiskClass
  toolset: McpToolsetName
  workflow: McpToolWorkflow | null
}

export interface McpToolAccessManifestEntry {
  name: McpToolName
  requirements: McpToolStaticRequirements
  stage: McpToolAccessStage
  toolset: McpToolsetName
  workflow: McpToolWorkflow | null
}

export interface McpToolAccessManifest {
  authorityGranted: false
  credentialsRequired: false
  discordContacted: false
  entries: readonly McpToolAccessManifestEntry[]
  format: typeof MCP_TOOL_ACCESS_MANIFEST_FORMAT
  readiness: "target-specific"
  requirementCoverage: {
    authenticationCounts: Record<McpToolAuthClass, number>
    complete: true
    exactToolEntries: number
    permissionModeCounts: Record<McpToolPermissionMode, number>
    targetAccessProven: false
    targetScopeCounts: Record<McpToolTargetScope, number>
    toolsetEntries: number
    unknownEntries: 0
  }
  schemaVersion: number
  stageContracts: Record<McpToolAccessStage, McpToolAccessStageContract>
  stageCounts: Record<McpToolAccessStage, number>
  status: "ok"
  toolsetNames: readonly McpToolsetName[]
  warnings: readonly string[]
  workflows: Partial<Record<McpToolWorkflow, McpToolWorkflowCompanions>>
}

export interface McpToolAccessIndexEntry {
  name: McpToolName
  stage: McpToolAccessStage
  toolset: McpToolsetName
  workflow: McpToolWorkflow | null
}

export interface McpToolAccessIndex extends Omit<
  McpToolAccessManifest,
  "entries" | "format"
> {
  entries: readonly McpToolAccessIndexEntry[]
  exactRequirementToolNames: readonly McpToolName[]
  format: typeof MCP_TOOL_ACCESS_INDEX_FORMAT
  requirementsResource: {
    uriTemplate: string
    variable: "toolName"
  }
}

export interface McpToolAccessDocument {
  authorityGranted: false
  credentialsRequired: false
  discordContacted: false
  entry: McpToolAccessEntry
  format: typeof MCP_TOOL_ACCESS_DOCUMENT_FORMAT
  readiness: McpToolAccessContract["readiness"]
  status: "ok"
  warnings: readonly string[]
}

export const MCP_TOOL_ACCESS_NAMES = Object.freeze(
  Object.keys(MCP_TOOL_RISK_CLASSES).sort() as McpToolName[],
)

const MCP_TOOL_ACCESS_NAME_SET: ReadonlySet<string> = new Set(
  MCP_TOOL_ACCESS_NAMES,
)

export function isMcpToolName(value: string): value is McpToolName {
  return MCP_TOOL_ACCESS_NAME_SET.has(value)
}

export const MCP_TOOL_CATALOG = Object.freeze({
  check_soundboard_playback: {
    keywords: ["audio", "check", "permission", "play", "readiness", "sound", "soundboard", "voice"],
    toolset: "soundboard",
  },
  add_reaction: {
    keywords: ["emoji", "react", "reaction"],
    toolset: "interactions",
  },
  add_reactions: {
    keywords: ["acknowledgement", "emoji", "menu", "multiple", "react", "reaction", "set", "status"],
    toolset: "interactions",
  },
  analyze_community_activity: {
    keywords: ["activity", "analytics", "community", "concentration", "participation", "reciprocity", "reply", "response time"],
    toolset: "messages",
  },
  audit_application_commands: {
    keywords: ["application", "audit", "command", "context", "exposure", "install", "permission", "security", "slash"],
    toolset: "connector",
  },
  audit_bot_installations: {
    keywords: ["audit", "bot", "drift", "guild", "install", "scope", "server", "unexpected"],
    toolset: "connector",
  },
  audit_application_entitlements: {
    keywords: ["access", "application", "audit", "beneficiary", "entitlement", "monetization", "sku"],
    toolset: "application-monetization",
  },
  audit_application_posture: {
    keywords: ["application", "audit", "bot", "install", "intent", "security", "setup"],
    toolset: "connector",
  },
  audit_application_role_connection_metadata: {
    keywords: ["application", "audit", "comparison", "linked", "metadata", "role", "schema", "security", "verification"],
    toolset: "connector",
  },
  audit_application_skus: {
    keywords: ["application", "audit", "availability", "catalog", "monetization", "offering", "product", "sku", "subscription"],
    toolset: "connector",
  },
  audit_application_subscriptions: {
    keywords: ["application", "audit", "lifecycle", "monetization", "renewal", "sku", "subscription"],
    toolset: "application-monetization",
  },
  get_application_entitlement: {
    keywords: ["access", "application", "beneficiary", "entitlement", "exact", "monetization", "sku"],
    toolset: "application-monetization",
  },
  audit_guild_webhooks: {
    keywords: ["application", "audit", "bearer", "credential", "exposure", "guild", "security", "webhook"],
    toolset: "webhooks",
  },
  audit_forum_tags: {
    keywords: ["audit", "forum", "tag"],
    toolset: "forum-tags",
  },
  audit_channel_role_access: {
    keywords: ["access", "audit", "channel", "matrix", "permissions", "role"],
    toolset: "permissions",
  },
  audit_channel_order: {
    keywords: ["above", "audit", "channel", "layout", "obfuscated", "order", "position"],
    toolset: "channel-ordering",
  },
  audit_role_order: {
    keywords: ["audit", "hierarchy", "holder", "order", "permission", "position", "role"],
    toolset: "role-ordering",
  },
  audit_role_deletion: {
    keywords: ["audit", "blocker", "dependency", "delete", "retire", "role"],
    toolset: "role-deletion",
  },
  capture_guild_blueprint: {
    keywords: ["backup", "blueprint", "capture", "export", "guild", "onboarding", "profile", "recovery", "roles", "settings", "snapshot", "welcome"],
    toolset: "guild-blueprints",
    workflow: "guild-blueprint",
  },
  compile_component_template: {
    keywords: ["announcement", "button", "card", "component", "cta", "incident", "layout", "link", "local", "poll", "release", "template", "welcome", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  compile_guild_blueprint_starter: {
    keywords: ["blueprint", "community", "compile", "creator", "design", "guild", "layout", "local", "project", "starter", "support", "template"],
    toolset: "guild-blueprints",
    workflow: "guild-blueprint",
  },
  create_coordination_address: {
    keywords: ["address", "agent", "coordination", "directed", "issue", "local", "routing"],
    toolset: "coordination",
  },
  preview_guild_blueprint: {
    keywords: ["blueprint", "dependency", "dry run", "guild", "intent", "local", "manifest", "normalize", "preview", "reference", "review", "sequence"],
    toolset: "guild-blueprints",
    workflow: "guild-blueprint",
  },
  delete_messages: {
    keywords: ["bulk", "delete", "exact ids", "remove"],
    toolset: "deletion",
    workflow: "message-deletion",
  },
  edit_own_message: {
    keywords: ["edit", "message", "own", "update"],
    toolset: "message-writes",
  },
  edit_webhook_message: {
    keywords: ["credential", "edit", "incoming", "message", "update", "webhook"],
    toolset: "webhooks",
  },
  execute_attachment_message: {
    keywords: ["attachment", "execute", "file", "message", "send", "upload"],
    toolset: "attachments",
    workflow: "attachment-message",
  },
  execute_component_message: {
    keywords: ["button", "component", "create", "edit", "execute", "layout", "link", "message", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  execute_embed_message: {
    keywords: ["create", "edit", "embed", "execute", "field", "message", "rich"],
    toolset: "embed-messages",
    workflow: "embed-message",
  },
  execute_direct_message_change: {
    keywords: ["attachment", "component", "components v2", "delete", "direct message", "dm", "edit", "execute", "file", "private", "reply", "send", "static", "upload"],
    toolset: "direct-messages",
    workflow: "direct-message-change",
  },
  execute_automod_change: {
    keywords: ["automod", "configure automod", "create", "delete", "disable", "enable", "execute", "moderation", "policy", "rule", "spam rule", "update"],
    toolset: "automod",
    workflow: "automod-change",
  },
  execute_announcement_crosspost: {
    keywords: ["announcement", "crosspost", "execute", "message", "publish"],
    toolset: "announcement-crossposts",
    workflow: "announcement-crosspost",
  },
  execute_announcement_subscription: {
    keywords: ["announcement", "execute", "follow", "subscribe", "unsubscribe", "webhook"],
    toolset: "announcement-subscriptions",
    workflow: "announcement-subscription",
  },
  execute_application_emoji_change: {
    keywords: ["application", "create", "delete", "emoji", "execute", "rename"],
    toolset: "application-emojis",
    workflow: "application-emoji-change",
  },
  execute_application_entitlement_consumption: {
    keywords: ["application", "consume", "consumable", "entitlement", "execute", "fulfillment", "monetization", "purchase", "sku"],
    toolset: "application-entitlement-changes",
    workflow: "application-entitlement-consumption",
  },
  execute_application_intent_enablement: {
    keywords: ["application", "enable", "execute", "guild members", "intent", "message content", "privileged"],
    toolset: "application-security",
    workflow: "application-intent-enablement",
  },
  execute_application_role_connection_metadata_change: {
    keywords: ["application", "clear", "execute", "linked", "metadata", "replace", "role", "schema"],
    toolset: "linked-roles",
    workflow: "application-role-connection-metadata-change",
  },
  execute_application_test_entitlement_change: {
    keywords: ["application", "create", "delete", "entitlement", "execute", "monetization", "sku", "subscription", "test"],
    toolset: "application-entitlement-changes",
    workflow: "application-test-entitlement-change",
  },
  execute_bot_profile_change: {
    keywords: ["application", "avatar", "banner", "bot", "execute", "profile", "username"],
    toolset: "bot-profile",
    workflow: "bot-profile-change",
  },
  execute_message_forward: {
    keywords: ["copy", "execute", "forward", "message", "snapshot"],
    toolset: "message-forwarding",
    workflow: "message-forward",
  },
  execute_channel_creation: {
    keywords: ["category", "channel", "create", "execute", "forum", "text"],
    toolset: "channel-creation",
    workflow: "channel-creation",
  },
  execute_channel_deletion: {
    keywords: ["channel", "delete", "execute", "irreversible", "retire"],
    toolset: "channel-deletion",
    workflow: "channel-deletion",
  },
  execute_role_deletion: {
    keywords: ["delete", "execute", "irreversible", "retire", "role"],
    toolset: "role-deletion",
    workflow: "role-deletion",
  },
  execute_channel_clone: {
    keywords: ["channel", "clone", "copy", "execute", "forum", "media", "stage", "voice"],
    toolset: "channel-cloning",
    workflow: "channel-cloning",
  },
  execute_channel_metadata_change: {
    keywords: ["bitrate", "channel", "configure", "execute", "metadata", "name", "nsfw", "region", "slowmode", "topic", "user limit", "video", "voice"],
    toolset: "channel-metadata",
    workflow: "channel-metadata-change",
  },
  execute_voice_channel_status_change: {
    keywords: ["channel", "ephemeral", "execute", "status", "voice"],
    toolset: "channel-metadata",
    workflow: "voice-channel-status-change",
  },
  execute_channel_order: {
    keywords: ["above", "below", "category", "channel", "execute", "layout", "move", "order", "parent", "position", "reparent"],
    toolset: "channel-ordering",
    workflow: "channel-ordering",
  },
  execute_channel_permission_overwrite: {
    keywords: ["access", "channel", "execute", "member", "overwrite", "permission", "role"],
    toolset: "permission-overwrites",
    workflow: "channel-permission-overwrite",
  },
  execute_channel_permission_sync: {
    keywords: ["category", "channel", "execute", "inherit", "overwrite", "parent", "permission", "propagate", "sync"],
    toolset: "permission-sync",
    workflow: "channel-permission-sync",
  },
  execute_forum_post: {
    keywords: ["create", "execute", "forum", "post", "thread"],
    toolset: "forum-posts",
    workflow: "forum-post",
  },
  execute_forum_tag_change: {
    keywords: ["create", "delete", "execute", "forum", "metadata", "tag", "update"],
    toolset: "forum-tags",
    workflow: "forum-tag-change",
  },
  execute_thread_creation: {
    keywords: ["create", "execute", "private", "public", "thread"],
    toolset: "threads",
    workflow: "thread-creation",
  },
  execute_thread_change: {
    keywords: ["add", "archive", "execute", "invite", "lock", "member", "remove", "rename", "slowmode", "thread"],
    toolset: "thread-governance",
    workflow: "thread-governance-change",
  },
  execute_guild_blueprint: {
    keywords: ["blueprint", "build", "components", "configure", "execute", "guild", "message", "onboarding", "profile", "publication", "scaffold", "screen", "settings", "welcome"],
    toolset: "guild-blueprints",
    workflow: "guild-blueprint",
  },
  execute_guild_scaffold: {
    keywords: ["blueprint", "category", "channel", "create", "guild", "role", "scaffold"],
    toolset: "guild-scaffolds",
    workflow: "guild-scaffold",
  },
  execute_guild_expression_change: {
    keywords: ["create", "delete", "emoji", "execute", "expression", "sticker", "update"],
    toolset: "guild-expressions",
    workflow: "guild-expression-change",
  },
  execute_guild_soundboard_change: {
    keywords: ["audio", "create", "delete", "emoji", "execute", "sound", "soundboard", "update"],
    toolset: "soundboard",
    workflow: "guild-soundboard-change",
  },
  execute_guild_template_change: {
    keywords: ["capability", "delete", "execute", "guild", "metadata", "snapshot", "sync", "template"],
    toolset: "guild-templates",
    workflow: "guild-template-change",
  },
  execute_guild_integration_deletion: {
    keywords: ["bot", "cleanup", "delete", "execute", "guild", "integration", "webhook"],
    toolset: "integrations",
    workflow: "integration-deletion",
  },
  execute_guild_departure: {
    keywords: ["bot", "connector", "departure", "execute", "guild", "leave", "remove"],
    toolset: "guild-departure",
    workflow: "guild-departure",
  },
  execute_invite_creation: {
    keywords: ["capability", "create", "execute", "finite", "invite", "private"],
    toolset: "invites",
    workflow: "invite-creation",
  },
  execute_invite_deletion: {
    keywords: ["delete", "execute", "invite", "revoke"],
    toolset: "invites",
    workflow: "invite-deletion",
  },
  execute_onboarding_change: {
    keywords: ["configure", "execute", "join", "onboarding", "prompt", "role"],
    toolset: "onboarding",
    workflow: "onboarding-change",
  },
  execute_guild_welcome_screen_change: {
    keywords: ["channel", "configure", "execute", "join", "welcome"],
    toolset: "welcome-screen",
    workflow: "welcome-screen-change",
  },
  execute_guild_widget_settings_change: {
    keywords: ["channel", "configure", "execute", "exposure", "invite", "profile", "widget"],
    toolset: "widget-settings",
    workflow: "widget-settings-change",
  },
  execute_guild_settings_change: {
    keywords: ["afk", "configure", "execute", "guild", "notifications", "safety", "settings"],
    toolset: "guild-settings",
    workflow: "guild-settings-change",
  },
  execute_guild_community_change: {
    keywords: ["community", "configure", "enable", "execute", "guild", "routing"],
    toolset: "guild-community",
    workflow: "guild-community-change",
  },
  execute_guild_incident_action_change: {
    keywords: ["direct message", "disable", "execute", "guild", "incident", "invite", "lockdown"],
    toolset: "guild-incidents",
    workflow: "guild-incident-action-change",
  },
  execute_guild_profile_change: {
    keywords: ["description", "execute", "guild", "identity", "name", "profile"],
    toolset: "guild-profile",
    workflow: "guild-profile-change",
  },
  execute_poll_creation: {
    keywords: ["create", "execute", "poll", "question", "vote"],
    toolset: "polls",
    workflow: "poll-creation",
  },
  execute_poll_end: {
    keywords: ["close", "end", "execute", "expire", "poll"],
    toolset: "polls",
    workflow: "poll-end",
  },
  execute_reaction_moderation: {
    keywords: ["emoji", "execute", "message", "moderate", "reaction", "remove"],
    toolset: "interactions",
    workflow: "reaction-moderation",
  },
  execute_member_moderation: {
    keywords: ["ban", "execute", "kick", "moderate", "one member", "timeout", "unban"],
    toolset: "moderation",
    workflow: "member-moderation",
  },
  execute_bulk_guild_ban: {
    keywords: ["ban", "ban members", "batch", "bulk", "execute", "guild", "many members", "moderate", "users"],
    toolset: "bulk-bans",
    workflow: "bulk-guild-ban",
  },
  execute_bulk_member_role_change: {
    keywords: ["add", "assign", "batch", "bulk", "execute", "members", "remove", "role"],
    toolset: "member-roles",
    workflow: "bulk-member-role-change",
  },
  execute_guild_prune: {
    keywords: ["cohort", "execute", "guild", "inactive", "inactive members", "members", "prune"],
    toolset: "guild-prunes",
    workflow: "guild-prune",
  },
  execute_member_nickname_change: {
    keywords: ["change", "clear", "execute", "member", "nick", "nickname", "profile"],
    toolset: "member-nicknames",
    workflow: "member-nickname-change",
  },
  execute_member_verification_change: {
    keywords: ["bypass", "execute", "member", "membership screening", "verification", "verify"],
    toolset: "member-verification",
    workflow: "member-verification-change",
  },
  execute_member_role_change: {
    keywords: ["add", "assign", "assign role", "execute", "member", "permission", "remove", "role"],
    toolset: "member-roles",
    workflow: "member-role-change",
  },
  execute_member_voice_change: {
    keywords: ["deafen", "disconnect", "execute", "member", "move", "move member", "mute", "voice"],
    toolset: "voice-moderation",
    workflow: "member-voice-change",
  },
  execute_message_pin: {
    keywords: ["execute", "message", "pin", "state", "unpin"],
    toolset: "pins",
    workflow: "message-pin",
  },
  execute_native_interaction_command: {
    keywords: ["application", "command", "execute", "install", "interaction", "remove", "slash"],
    toolset: "native-interactions",
    workflow: "native-interaction-command",
  },
  execute_guild_application_command_change: {
    keywords: ["application", "command", "create", "delete", "execute", "localization", "permission", "slash", "update"],
    toolset: "application-commands",
    workflow: "guild-application-command-change",
  },
  execute_global_application_command_change: {
    keywords: ["application", "command", "context", "create", "delete", "execute", "global", "install", "localization", "permission", "primary entry point", "slash", "update"],
    toolset: "application-commands",
    workflow: "global-application-command-change",
  },
  execute_role_creation: {
    keywords: ["create", "execute", "permission", "role"],
    toolset: "role-creation",
    workflow: "role-creation",
  },
  execute_role_configuration: {
    keywords: ["color", "configure", "emoji", "execute", "hoist", "icon", "image", "mentionable", "name", "permission", "role", "role permission"],
    toolset: "role-configuration",
    workflow: "role-configuration",
  },
  execute_role_order: {
    keywords: ["above", "below", "execute", "hierarchy", "order", "position", "role"],
    toolset: "role-ordering",
    workflow: "role-ordering",
  },
  execute_scheduled_event_change: {
    keywords: ["calendar", "cancel", "complete", "create", "event", "execute", "guild event", "schedule", "schedule event", "transition", "update"],
    toolset: "scheduled-events",
    workflow: "scheduled-event-change",
  },
  execute_stage_instance_change: {
    keywords: ["end", "execute", "live", "stage", "start", "topic", "update"],
    toolset: "stage-instances",
    workflow: "stage-instance-change",
  },
  execute_webhook_deletion: {
    keywords: ["cleanup", "delete", "execute", "integration", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-deletion",
  },
  execute_webhook_message_deletion: {
    keywords: ["delete", "execute", "incoming", "message", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-message-deletion",
  },
  execute_webhook_change: {
    keywords: ["channel", "execute", "move", "name", "rename", "update", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-change",
  },
  execute_webhook_creation: {
    keywords: ["create", "credential", "execute", "incoming", "integration", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-creation",
  },
  explain_channel_access: {
    keywords: ["access", "permissions", "read", "view", "view channel"],
    toolset: "guilds",
  },
  explain_principal_permissions: {
    keywords: ["action", "effective", "hierarchy", "member", "permissions", "role"],
    toolset: "permissions",
  },
  get_guild_audit_entry: {
    keywords: ["audit", "entry", "exact", "guild", "history", "moderation"],
    toolset: "audit-logs",
  },
  get_guild_ban: {
    keywords: ["audit", "ban", "exact", "guild", "moderation", "user", "user ban"],
    toolset: "bans",
  },
  get_guild_invite: {
    keywords: ["audit", "exact", "invite", "lookup", "reference"],
    toolset: "invites",
  },
  get_guild_vanity_url: {
    keywords: ["audit", "code", "guild", "invite", "uses", "vanity"],
    toolset: "invites",
  },
  get_guild_onboarding: {
    keywords: ["audit", "guild", "join", "onboarding", "prompt", "read"],
    toolset: "onboarding",
  },
  get_guild_welcome_screen: {
    keywords: ["audit", "channel", "guild", "join", "read", "welcome"],
    toolset: "welcome-screen",
  },
  get_guild_widget_settings: {
    keywords: ["audit", "channel", "exposure", "guild", "invite", "profile", "widget"],
    toolset: "widget-settings",
  },
  get_guild_settings: {
    keywords: ["afk", "audit", "content filter", "guild", "notifications", "safety", "settings"],
    toolset: "guild-settings",
  },
  audit_guild_community: {
    keywords: ["audit", "community", "guild", "routing", "rules", "safety"],
    toolset: "guild-community",
  },
  get_guild_incident_actions: {
    keywords: ["audit", "direct message", "guild", "incident", "invite", "lockdown", "raid"],
    toolset: "guild-incidents",
  },
  get_guild_profile: {
    keywords: ["audit", "description", "guild", "identity", "name", "profile"],
    toolset: "guild-profile",
  },
  get_automod_rule: {
    keywords: ["automod", "exact", "moderation", "policy", "rule"],
    toolset: "automod",
  },
  get_guild_member: {
    keywords: ["directory", "exact", "member", "profile", "user"],
    toolset: "members",
  },
  get_member_voice_state: {
    keywords: ["audit", "exact", "member", "state", "voice"],
    toolset: "voice-moderation",
  },
  get_thread_membership: {
    keywords: ["audit", "exact", "member", "membership", "thread"],
    toolset: "thread-governance",
  },
  get_thread_state: {
    keywords: ["archive", "audit", "exact", "invitable", "lock", "metadata", "state", "thread"],
    toolset: "thread-governance",
  },
  get_guild_emoji: {
    keywords: ["emoji", "exact", "expression", "guild", "lookup"],
    toolset: "guild-expressions",
  },
  get_guild_sticker: {
    keywords: ["exact", "expression", "guild", "lookup", "sticker"],
    toolset: "guild-expressions",
  },
  get_guild_soundboard_sound: {
    keywords: ["audio", "exact", "guild", "lookup", "sound", "soundboard"],
    toolset: "soundboard",
  },
  get_connector_status: {
    keywords: ["application", "bot", "identity", "scope", "status"],
    toolset: "connector",
  },
  get_direct_message: {
    keywords: ["attachment", "component", "components v2", "direct message", "dm", "exact", "file", "get", "private", "read", "static"],
    toolset: "direct-messages",
    workflow: "direct-message-change",
  },
  get_gateway_events: {
    keywords: ["cursor", "event", "realtime", "subscription"],
    toolset: "gateway",
  },
  get_gateway_status: {
    keywords: ["connection", "gateway", "health", "realtime", "status"],
    toolset: "gateway",
  },
  get_message: {
    keywords: ["exact", "fetch", "message", "read"],
    toolset: "messages",
  },
  read_message_attachment: {
    keywords: ["attachment", "audio", "download", "exact", "file", "image", "media", "message", "native", "read"],
    toolset: "messages",
  },
  get_application_emoji: {
    keywords: ["application", "emoji", "exact", "get", "lookup"],
    toolset: "application-emojis",
  },
  get_current_bot_profile: {
    keywords: ["application", "avatar", "banner", "bot", "current", "profile", "username"],
    toolset: "bot-profile",
  },
  inspect_application_activity_instance: {
    keywords: ["activity", "application", "instance", "participant", "session", "verify"],
    toolset: "connector",
  },
  get_observability_status: {
    keywords: ["health", "invalid-request", "metrics", "observability", "rate-limit", "telemetry", "traces"],
    toolset: "observability",
  },
  get_poll: {
    keywords: ["answer", "count", "exact", "poll", "result", "vote"],
    toolset: "polls",
  },
  get_role: {
    keywords: ["exact", "permission", "read", "role"],
    toolset: "roles",
  },
  get_scheduled_event: {
    keywords: ["calendar", "event", "exact", "guild", "schedule"],
    toolset: "scheduled-events",
  },
  get_stage_instance: {
    keywords: ["active", "exact", "live", "stage", "topic"],
    toolset: "stage-instances",
  },
  get_channel_webhook: {
    keywords: ["audit", "exact", "integration", "lookup", "webhook"],
    toolset: "webhooks",
  },
  get_webhook_message: {
    keywords: ["audit", "credential", "exact", "incoming", "message", "webhook"],
    toolset: "webhooks",
  },
  get_channel: {
    keywords: ["channel", "exact", "metadata", "name", "nsfw", "read", "slowmode", "topic"],
    toolset: "guilds",
  },
  get_voice_channel_status: {
    keywords: ["channel", "ephemeral", "exact", "get", "status", "voice"],
    toolset: "channel-metadata",
  },
  list_active_threads: {
    keywords: ["active", "forum", "list", "thread"],
    toolset: "threads",
  },
  list_application_emojis: {
    keywords: ["application", "emoji", "inventory", "list"],
    toolset: "application-emojis",
  },
  list_automod_rules: {
    keywords: ["automod", "inventory", "list", "moderation", "policy", "rule"],
    toolset: "automod",
  },
  list_activity: {
    keywords: ["activity", "audit", "history", "outcome", "write"],
    toolset: "activity",
  },
  list_archived_threads: {
    keywords: ["archive", "forum", "list", "thread"],
    toolset: "threads",
  },
  list_channels: {
    keywords: ["channel", "guild", "list", "server"],
    toolset: "guilds",
  },
  list_channel_permission_overwrites: {
    keywords: ["access", "allow", "channel", "deny", "inherit", "list", "overwrite", "permission"],
    toolset: "permission-overwrites",
  },
  list_guilds: {
    keywords: ["guild", "list", "server"],
    toolset: "guilds",
  },
  list_message_pins: {
    keywords: ["list", "message", "paginated", "pin", "pinned"],
    toolset: "pins",
  },
  list_discord_interaction_continuations: {
    keywords: ["continuation", "discord", "followup", "interaction", "list", "private"],
    toolset: "native-interactions",
  },
  list_pending_discord_interactions: {
    keywords: ["discord", "interaction", "pending", "private", "queue", "request"],
    toolset: "native-interactions",
  },
  list_poll_answer_voters: {
    keywords: ["answer", "list", "poll", "user", "vote", "voter"],
    toolset: "polls",
  },
  list_message_reactions: {
    keywords: ["aggregate", "count", "emoji", "list", "message", "reaction"],
    toolset: "interactions",
  },
  list_coordination_addresses: {
    keywords: ["address", "agent", "coordination", "directory", "discover", "list", "routing"],
    toolset: "coordination",
  },
  list_coordination_notes: {
    keywords: ["address", "agent", "coordination", "directed", "handoff", "list", "note", "routing", "task"],
    toolset: "coordination",
  },
  list_message_replies: {
    keywords: ["agent", "claim", "coordination", "handoff", "list", "message", "replies", "response", "task"],
    toolset: "messages",
  },
  list_reaction_users: {
    keywords: ["emoji", "identity", "list", "reaction", "user"],
    toolset: "interactions",
  },
  list_guild_audit_entries: {
    keywords: ["action", "actor", "audit", "guild", "history", "moderation"],
    toolset: "audit-logs",
  },
  list_guild_bans: {
    keywords: ["audit", "ban", "cursor", "guild", "list", "moderation"],
    toolset: "bans",
  },
  list_guild_invites: {
    keywords: ["audit", "credential", "guild", "inventory", "invite", "list"],
    toolset: "invites",
  },
  list_guild_voice_regions: {
    keywords: ["available", "guild", "region", "rtc", "stage", "voice"],
    toolset: "channel-metadata",
  },
  list_guild_integrations: {
    keywords: ["audit", "bot", "guild", "integration", "inventory", "oauth", "webhook"],
    toolset: "integrations",
  },
  list_guild_members: {
    keywords: ["cursor", "directory", "guild", "list", "member", "user"],
    toolset: "members",
  },
  list_guild_emojis: {
    keywords: ["emoji", "expression", "guild", "inventory", "list"],
    toolset: "guild-expressions",
  },
  list_guild_stickers: {
    keywords: ["expression", "guild", "inventory", "list", "sticker"],
    toolset: "guild-expressions",
  },
  list_default_soundboard_sounds: {
    keywords: ["audio", "default", "inventory", "list", "sound", "soundboard"],
    toolset: "soundboard",
  },
  list_direct_messages: {
    keywords: ["attachment", "component", "components v2", "direct message", "dm", "file", "history", "list", "private", "read", "static"],
    toolset: "direct-messages",
    workflow: "direct-message-change",
  },
  list_guild_soundboard_sounds: {
    keywords: ["audio", "guild", "inventory", "list", "sound", "soundboard"],
    toolset: "soundboard",
  },
  list_guild_templates: {
    keywords: ["audit", "blueprint", "capability", "guild", "snapshot", "template"],
    toolset: "guild-templates",
  },
  list_roles: {
    keywords: ["guild", "hierarchy", "list", "permission", "role"],
    toolset: "roles",
  },
  list_scheduled_events: {
    keywords: ["calendar", "event", "guild", "inventory", "list", "schedule", "subscriber"],
    toolset: "scheduled-events",
  },
  list_scheduled_event_users: {
    keywords: ["attendance", "event", "list", "rsvp", "subscriber", "user"],
    toolset: "scheduled-events",
  },
  list_stage_instances: {
    keywords: ["active", "configured", "inventory", "list", "live", "stage"],
    toolset: "stage-instances",
  },
  list_voice_regions: {
    keywords: ["global", "region", "rtc", "stage", "voice"],
    toolset: "channel-metadata",
  },
  list_channel_webhooks: {
    keywords: ["audit", "channel", "integration", "inventory", "list", "webhook"],
    toolset: "webhooks",
  },
  list_announcement_subscriptions: {
    keywords: ["announcement", "audit", "follow", "inventory", "list", "subscription"],
    toolset: "announcement-subscriptions",
  },
  plan_member_moderation: {
    keywords: ["ban", "kick", "moderate", "one member", "plan", "review", "timeout", "unban"],
    toolset: "moderation",
    workflow: "member-moderation",
  },
  plan_bulk_guild_ban: {
    keywords: ["ban", "ban members", "batch", "bulk", "guild", "many members", "plan", "review", "users"],
    toolset: "bulk-bans",
    workflow: "bulk-guild-ban",
  },
  plan_bulk_member_role_change: {
    keywords: ["add", "assign", "batch", "bulk", "members", "plan", "remove", "review", "role"],
    toolset: "member-roles",
    workflow: "bulk-member-role-change",
  },
  plan_guild_prune: {
    keywords: ["cohort", "estimate", "guild", "inactive", "inactive members", "members", "plan", "prune", "review"],
    toolset: "guild-prunes",
    workflow: "guild-prune",
  },
  plan_member_nickname_change: {
    keywords: ["change", "clear", "member", "nick", "nickname", "plan", "profile", "review"],
    toolset: "member-nicknames",
    workflow: "member-nickname-change",
  },
  plan_member_verification_change: {
    keywords: ["bypass", "member", "membership screening", "plan", "review", "verification", "verify"],
    toolset: "member-verification",
    workflow: "member-verification-change",
  },
  plan_member_role_change: {
    keywords: ["add", "assign", "assign role", "member", "permission", "plan", "remove", "review", "role"],
    toolset: "member-roles",
    workflow: "member-role-change",
  },
  plan_member_voice_change: {
    keywords: ["deafen", "disconnect", "member", "move", "move member", "mute", "plan", "review", "voice"],
    toolset: "voice-moderation",
    workflow: "member-voice-change",
  },
  plan_automod_change: {
    keywords: ["automod", "configure automod", "create", "delete", "disable", "enable", "moderation", "plan", "policy", "review", "rule", "spam rule", "update"],
    toolset: "automod",
    workflow: "automod-change",
  },
  plan_announcement_crosspost: {
    keywords: ["announcement", "crosspost", "message", "plan", "publish", "review"],
    toolset: "announcement-crossposts",
    workflow: "announcement-crosspost",
  },
  plan_announcement_subscription: {
    keywords: ["announcement", "follow", "plan", "review", "subscribe", "unsubscribe", "webhook"],
    toolset: "announcement-subscriptions",
    workflow: "announcement-subscription",
  },
  plan_message_forward: {
    keywords: ["copy", "forward", "message", "plan", "review", "snapshot"],
    toolset: "message-forwarding",
    workflow: "message-forward",
  },
  plan_attachment_message: {
    keywords: ["attachment", "file", "message", "plan", "review", "upload"],
    toolset: "attachments",
    workflow: "attachment-message",
  },
  plan_component_message: {
    keywords: ["button", "component", "create", "edit", "layout", "link", "message", "plan", "review", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  plan_embed_message: {
    keywords: ["create", "edit", "embed", "field", "message", "plan", "review", "rich"],
    toolset: "embed-messages",
    workflow: "embed-message",
  },
  plan_direct_message_change: {
    keywords: ["attachment", "component", "components v2", "delete", "direct message", "dm", "edit", "file", "plan", "private", "reply", "review", "send", "static", "upload"],
    toolset: "direct-messages",
    workflow: "direct-message-change",
  },
  plan_channel_creation: {
    keywords: ["category", "channel", "create", "forum", "plan", "review", "text"],
    toolset: "channel-creation",
    workflow: "channel-creation",
  },
  plan_channel_deletion: {
    keywords: ["channel", "delete", "dependency", "plan", "retire", "review"],
    toolset: "channel-deletion",
    workflow: "channel-deletion",
  },
  plan_role_deletion: {
    keywords: ["blocker", "delete", "dependency", "plan", "retire", "review", "role"],
    toolset: "role-deletion",
    workflow: "role-deletion",
  },
  plan_channel_clone: {
    keywords: ["channel", "clone", "copy", "forum", "media", "plan", "review", "stage", "voice"],
    toolset: "channel-cloning",
    workflow: "channel-cloning",
  },
  plan_channel_metadata_change: {
    keywords: ["bitrate", "channel", "configure", "metadata", "name", "nsfw", "plan", "region", "review", "slowmode", "topic", "user limit", "video", "voice"],
    toolset: "channel-metadata",
    workflow: "channel-metadata-change",
  },
  plan_voice_channel_status_change: {
    keywords: ["channel", "ephemeral", "plan", "review", "status", "voice"],
    toolset: "channel-metadata",
    workflow: "voice-channel-status-change",
  },
  plan_channel_order: {
    keywords: ["above", "below", "category", "channel", "layout", "move", "order", "parent", "plan", "position", "reparent", "review"],
    toolset: "channel-ordering",
    workflow: "channel-ordering",
  },
  plan_channel_permission_overwrite: {
    keywords: ["access", "channel", "member", "overwrite", "permission", "plan", "review", "role"],
    toolset: "permission-overwrites",
    workflow: "channel-permission-overwrite",
  },
  plan_channel_permission_sync: {
    keywords: ["category", "channel", "inherit", "overwrite", "parent", "permission", "plan", "propagate", "review", "sync"],
    toolset: "permission-sync",
    workflow: "channel-permission-sync",
  },
  plan_application_emoji_change: {
    keywords: ["application", "create", "delete", "emoji", "plan", "rename", "review"],
    toolset: "application-emojis",
    workflow: "application-emoji-change",
  },
  plan_application_entitlement_consumption: {
    keywords: ["application", "consume", "consumable", "entitlement", "fulfillment", "monetization", "plan", "purchase", "review", "sku"],
    toolset: "application-entitlement-changes",
    workflow: "application-entitlement-consumption",
  },
  plan_application_intent_enablement: {
    keywords: ["application", "enable", "guild members", "intent", "message content", "plan", "privileged", "review"],
    toolset: "application-security",
    workflow: "application-intent-enablement",
  },
  plan_application_role_connection_metadata_change: {
    keywords: ["application", "clear", "linked", "metadata", "plan", "replace", "review", "role", "schema"],
    toolset: "linked-roles",
    workflow: "application-role-connection-metadata-change",
  },
  plan_application_test_entitlement_change: {
    keywords: ["application", "create", "delete", "entitlement", "monetization", "plan", "review", "sku", "subscription", "test"],
    toolset: "application-entitlement-changes",
    workflow: "application-test-entitlement-change",
  },
  plan_bot_profile_change: {
    keywords: ["application", "avatar", "banner", "bot", "plan", "profile", "review", "username"],
    toolset: "bot-profile",
    workflow: "bot-profile-change",
  },
  plan_forum_post: {
    keywords: ["create", "forum", "plan", "post", "review", "thread"],
    toolset: "forum-posts",
    workflow: "forum-post",
  },
  plan_forum_tag_change: {
    keywords: ["create", "delete", "forum", "metadata", "plan", "review", "tag", "update"],
    toolset: "forum-tags",
    workflow: "forum-tag-change",
  },
  plan_thread_creation: {
    keywords: ["create", "plan", "private", "public", "review", "thread"],
    toolset: "threads",
    workflow: "thread-creation",
  },
  plan_thread_change: {
    keywords: ["add", "archive", "invite", "lock", "member", "plan", "remove", "rename", "review", "slowmode", "thread"],
    toolset: "thread-governance",
    workflow: "thread-governance-change",
  },
  plan_guild_blueprint: {
    keywords: ["blueprint", "build", "components", "configure", "guild", "message", "onboarding", "plan", "profile", "publication", "review", "scaffold", "screen", "settings", "welcome"],
    toolset: "guild-blueprints",
    workflow: "guild-blueprint",
  },
  verify_guild_blueprint: {
    keywords: ["blueprint", "completion", "components", "evidence", "guild", "message", "onboarding", "profile", "publication", "receipt", "scaffold", "screen", "settings", "verify", "welcome"],
    toolset: "guild-blueprints",
    workflow: "guild-blueprint",
  },
  plan_guild_scaffold: {
    keywords: ["blueprint", "category", "channel", "guild", "plan", "review", "role", "scaffold"],
    toolset: "guild-scaffolds",
    workflow: "guild-scaffold",
  },
  verify_guild_scaffold: {
    keywords: ["blueprint", "checkpoint", "completion", "evidence", "guild", "scaffold", "verify"],
    toolset: "guild-scaffolds",
    workflow: "guild-scaffold",
  },
  plan_guild_expression_change: {
    keywords: ["create", "delete", "emoji", "expression", "plan", "review", "sticker", "update"],
    toolset: "guild-expressions",
    workflow: "guild-expression-change",
  },
  plan_guild_soundboard_change: {
    keywords: ["audio", "create", "delete", "emoji", "plan", "review", "sound", "soundboard", "update"],
    toolset: "soundboard",
    workflow: "guild-soundboard-change",
  },
  play_soundboard_sound: {
    keywords: ["audio", "play", "sound", "soundboard", "voice"],
    toolset: "soundboard",
  },
  plan_guild_template_change: {
    keywords: ["create", "delete", "guild", "metadata", "plan", "snapshot", "sync", "template"],
    toolset: "guild-templates",
    workflow: "guild-template-change",
  },
  plan_guild_integration_deletion: {
    keywords: ["bot", "cleanup", "delete", "guild", "integration", "plan", "review", "webhook"],
    toolset: "integrations",
    workflow: "integration-deletion",
  },
  plan_guild_departure: {
    keywords: ["bot", "connector", "departure", "guild", "leave", "plan", "remove", "review"],
    toolset: "guild-departure",
    workflow: "guild-departure",
  },
  plan_invite_deletion: {
    keywords: ["delete", "invite", "plan", "review", "revoke"],
    toolset: "invites",
    workflow: "invite-deletion",
  },
  plan_invite_creation: {
    keywords: ["capability", "create", "finite", "invite", "plan", "private", "review"],
    toolset: "invites",
    workflow: "invite-creation",
  },
  plan_onboarding_change: {
    keywords: ["configure", "join", "onboarding", "plan", "prompt", "review", "role"],
    toolset: "onboarding",
    workflow: "onboarding-change",
  },
  plan_guild_welcome_screen_change: {
    keywords: ["channel", "configure", "join", "plan", "review", "welcome"],
    toolset: "welcome-screen",
    workflow: "welcome-screen-change",
  },
  plan_guild_widget_settings_change: {
    keywords: ["channel", "configure", "exposure", "invite", "plan", "profile", "review", "widget"],
    toolset: "widget-settings",
    workflow: "widget-settings-change",
  },
  plan_guild_settings_change: {
    keywords: ["afk", "configure", "guild", "notifications", "plan", "review", "safety", "settings"],
    toolset: "guild-settings",
    workflow: "guild-settings-change",
  },
  plan_guild_community_change: {
    keywords: ["community", "configure", "enable", "guild", "plan", "review", "routing"],
    toolset: "guild-community",
    workflow: "guild-community-change",
  },
  plan_guild_incident_action_change: {
    keywords: ["direct message", "disable", "guild", "incident", "invite", "lockdown", "plan", "review"],
    toolset: "guild-incidents",
    workflow: "guild-incident-action-change",
  },
  plan_guild_profile_change: {
    keywords: ["description", "guild", "identity", "name", "plan", "profile", "review"],
    toolset: "guild-profile",
    workflow: "guild-profile-change",
  },
  plan_poll_creation: {
    keywords: ["create", "plan", "poll", "question", "vote"],
    toolset: "polls",
    workflow: "poll-creation",
  },
  plan_poll_end: {
    keywords: ["close", "end", "expire", "plan", "poll"],
    toolset: "polls",
    workflow: "poll-end",
  },
  plan_reaction_moderation: {
    keywords: ["emoji", "message", "moderate", "plan", "reaction", "remove", "review"],
    toolset: "interactions",
    workflow: "reaction-moderation",
  },
  plan_message_deletion: {
    keywords: ["delete", "exact ids", "plan", "remove", "review"],
    toolset: "deletion",
    workflow: "message-deletion",
  },
  plan_message_pin: {
    keywords: ["message", "pin", "plan", "review", "state", "unpin"],
    toolset: "pins",
    workflow: "message-pin",
  },
  plan_native_interaction_command: {
    keywords: ["application", "command", "install", "interaction", "plan", "remove", "slash"],
    toolset: "native-interactions",
    workflow: "native-interaction-command",
  },
  plan_guild_application_command_change: {
    keywords: ["application", "command", "create", "delete", "localization", "permission", "plan", "review", "slash", "update"],
    toolset: "application-commands",
    workflow: "guild-application-command-change",
  },
  plan_global_application_command_change: {
    keywords: ["application", "command", "context", "create", "delete", "global", "install", "localization", "permission", "plan", "primary entry point", "review", "slash", "update"],
    toolset: "application-commands",
    workflow: "global-application-command-change",
  },
  plan_role_creation: {
    keywords: ["create", "permission", "plan", "review", "role"],
    toolset: "role-creation",
    workflow: "role-creation",
  },
  plan_role_configuration: {
    keywords: ["color", "configure", "emoji", "hoist", "icon", "image", "mentionable", "name", "permission", "plan", "review", "role", "role permission"],
    toolset: "role-configuration",
    workflow: "role-configuration",
  },
  plan_role_order: {
    keywords: ["above", "below", "hierarchy", "order", "plan", "position", "review", "role"],
    toolset: "role-ordering",
    workflow: "role-ordering",
  },
  plan_scheduled_event_change: {
    keywords: ["calendar", "cancel", "complete", "create", "event", "guild event", "plan", "review", "schedule", "schedule event", "transition", "update"],
    toolset: "scheduled-events",
    workflow: "scheduled-event-change",
  },
  plan_stage_instance_change: {
    keywords: ["end", "live", "plan", "review", "stage", "start", "topic", "update"],
    toolset: "stage-instances",
    workflow: "stage-instance-change",
  },
  plan_webhook_deletion: {
    keywords: ["cleanup", "delete", "integration", "plan", "review", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-deletion",
  },
  plan_webhook_message_deletion: {
    keywords: ["delete", "incoming", "message", "plan", "review", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-message-deletion",
  },
  plan_webhook_change: {
    keywords: ["channel", "move", "name", "plan", "rename", "review", "update", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-change",
  },
  plan_webhook_creation: {
    keywords: ["create", "credential", "incoming", "integration", "plan", "review", "webhook"],
    toolset: "webhooks",
    workflow: "webhook-creation",
  },
  parse_discord_reference: {
    keywords: ["copy", "exact id", "jump link", "link", "mention", "parse", "reference", "resolve", "target"],
    toolset: "connector",
  },
  preview_component_layout: {
    keywords: ["button", "component", "layout", "link", "local", "message", "preview", "validate", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  preview_embed_message: {
    keywords: ["embed", "field", "layout", "local", "message", "preview", "rich", "validate"],
    toolset: "embed-messages",
    workflow: "embed-message",
  },
  catch_up_messages: {
    keywords: ["catch up", "cursor", "inbox", "multi-channel", "new messages", "since", "unread"],
    toolset: "messages",
  },
  verify_component_message: {
    keywords: ["component", "drift", "message", "receipt", "recover", "verify", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  verify_embed_message: {
    keywords: ["drift", "embed", "message", "receipt", "recover", "rich", "verify"],
    toolset: "embed-messages",
    workflow: "embed-message",
  },
  verify_direct_message_change: {
    keywords: ["attachment", "component", "components v2", "direct message", "dm", "drift", "file", "private", "receipt", "recover", "static", "verify"],
    toolset: "direct-messages",
    workflow: "direct-message-change",
  },
  verify_automod_change: {
    keywords: ["automod", "drift", "moderation", "receipt", "recover", "rule", "verify"],
    toolset: "automod",
    workflow: "automod-change",
  },
  read_messages: {
    keywords: ["context", "around", "channel", "history", "list", "message", "read", "recent", "summarize", "surrounding", "window"],
    toolset: "messages",
  },
  recall_conversation: {
    keywords: ["conversation", "lost", "memory", "recall", "remember", "search", "vague"],
    toolset: "messages",
  },
  remove_own_reaction: {
    keywords: ["emoji", "own", "reaction", "remove", "undo"],
    toolset: "interactions",
  },
  search_messages: {
    keywords: ["author", "content", "filter", "guild", "guild message", "message", "search"],
    toolset: "messages",
  },
  search_guild_members: {
    keywords: ["directory", "member", "nickname", "prefix", "search", "username"],
    toolset: "members",
  },
  send_message: {
    keywords: ["create", "message", "reply", "send", "write"],
    toolset: "message-writes",
  },
  send_coordination_note: {
    keywords: ["address", "agent", "coordination", "directed", "handoff", "note", "route", "send", "task"],
    toolset: "coordination",
  },
  signal_command_processing: {
    keywords: ["command", "indicator", "processing", "response", "signal", "typing", "working"],
    toolset: "message-writes",
  },
  send_webhook_message: {
    keywords: ["credential", "incoming", "message", "send", "webhook", "write"],
    toolset: "webhooks",
  },
  respond_to_discord_interaction: {
    keywords: ["continue", "discord", "interaction", "private", "reply", "respond"],
    toolset: "native-interactions",
  },
  send_discord_interaction_followup: {
    keywords: ["continue", "discord", "followup", "interaction", "private", "respond", "send"],
    toolset: "native-interactions",
  },
} satisfies Record<CanonicalMcpToolName, ToolCatalogMetadata>)

const RECEIPT_VERIFY_TOOL_PREFIX = "verify_"

function accessStage(
  name: McpToolName,
  riskClass: McpToolRiskClass,
  workflow: McpToolWorkflow | null,
): McpToolAccessStage {
  if (riskClass === "local-read") return "local"
  if (name.startsWith(REVIEWED_PLAN_TOOL_PREFIX)) return "review-plan"
  if (name.startsWith(RECEIPT_VERIFY_TOOL_PREFIX)) return "receipt-verify"
  if (riskClass === "discord-read") return "live-read"
  if (workflow !== null) return "review-execute"
  return "guarded-write"
}

function accessMetadata(name: McpToolName): {
  riskClass: McpToolRiskClass
  toolset: McpToolsetName
  workflow: McpToolWorkflow | null
} {
  const riskClass = MCP_TOOL_RISK_CLASSES[name]
  if (name === MCP_DISCOVERY_TOOL_NAME) {
    return { riskClass, toolset: "connector", workflow: null }
  }
  const metadata: ToolCatalogMetadata = MCP_TOOL_CATALOG[name]
  return {
    riskClass,
    toolset: metadata.toolset,
    workflow: metadata.workflow ?? null,
  }
}

function workflowCompanions(
  workflow: McpToolWorkflow | null,
): McpToolWorkflowCompanions {
  const members = workflow === null
    ? []
    : (Object.keys(MCP_TOOL_CATALOG) as CanonicalMcpToolName[])
        .filter((name) => {
          const metadata: ToolCatalogMetadata = MCP_TOOL_CATALOG[name]
          return metadata.workflow === workflow
        })
  const byStage = (stage: McpToolAccessStage) => members
    .filter((name) => {
      const metadata = accessMetadata(name)
      return accessStage(name, metadata.riskClass, metadata.workflow) === stage
    })
    .sort()
  return {
    execute: byStage("review-execute"),
    plan: byStage("review-plan"),
    verify: byStage("receipt-verify"),
  }
}

function accessStageContract(
  stage: McpToolAccessStage,
): McpToolAccessStageContract {
  const approval = stage === "review-execute"
    ? "host-write-and-signed-interactive"
    : stage === "guarded-write"
      ? "host-write-approval"
      : "none"
  const authorizationEvidence = stage === "local"
    ? "none"
    : stage === "review-plan"
      ? "target-bound-plan"
      : stage === "review-execute"
        ? "fresh-plan-recheck"
        : stage === "receipt-verify"
          ? "receipt-and-readback"
          : "operation-runtime"
  return {
    approval,
    authorizationEvidence,
    discordRequest: stage === "local"
      ? "none"
      : stage === "review-execute" || stage === "guarded-write"
        ? "write"
        : "read",
    readiness: stage === "local" ? "not-applicable" : "target-specific",
  }
}

export function mcpToolAccessContract(
  name: McpToolName,
): McpToolAccessContract {
  const metadata = accessMetadata(name)
  const stage = accessStage(name, metadata.riskClass, metadata.workflow)
  return {
    ...accessStageContract(stage),
    companions: workflowCompanions(metadata.workflow),
    requirements: mcpToolStaticRequirements(name, metadata.toolset),
    stage,
  }
}

export function mcpToolAccessEntry(name: McpToolName): McpToolAccessEntry {
  const metadata = accessMetadata(name)
  return {
    ...mcpToolAccessContract(name),
    name,
    riskClass: metadata.riskClass,
    toolset: metadata.toolset,
    workflow: metadata.workflow,
  }
}

function assertAccessTopology(entry: McpToolAccessEntry): void {
  if (
    entry.workflow === null
    && (
      entry.companions.execute.length !== 0
      || entry.companions.plan.length !== 0
      || entry.companions.verify.length !== 0
    )
  ) {
    throw new Error(
      `MCP access contract ${entry.name} cannot identify companions without a workflow`,
    )
  }
  if (
    entry.workflow !== null
    && (
      entry.companions.execute.length !== 1
      || entry.companions.plan.length !== 1
    )
  ) {
    throw new Error(
      `MCP access contract ${entry.name} must identify one reviewed plan and execution companion`,
    )
  }
  if (
    entry.stage === "receipt-verify"
    && entry.companions.verify.length !== 1
  ) {
    throw new Error(
      `MCP access contract ${entry.name} must identify one receipt-verification companion`,
    )
  }
}

export function createMcpToolAccessManifest(
  toolsets: ReadonlySet<McpToolsetName> = new Set(MCP_TOOLSET_NAMES),
): McpToolAccessManifest {
  const selectedToolsets = selectedMcpToolsets(toolsets)
  const names = [
    MCP_DISCOVERY_TOOL_NAME,
    ...selectedCanonicalMcpToolNames(new Set(selectedToolsets)),
  ].sort() as McpToolName[]
  const expandedEntries = names.map(mcpToolAccessEntry)
  for (const entry of expandedEntries) assertAccessTopology(entry)
  const entries = expandedEntries.map((entry): McpToolAccessManifestEntry => ({
    name: entry.name,
    requirements: entry.requirements,
    stage: entry.stage,
    toolset: entry.toolset,
    workflow: entry.workflow,
  }))
  const stageContracts = Object.fromEntries(
    MCP_TOOL_ACCESS_STAGES.map((stage) => [stage, accessStageContract(stage)]),
  ) as Record<McpToolAccessStage, McpToolAccessStageContract>
  const stageCounts = Object.fromEntries(
    MCP_TOOL_ACCESS_STAGES.map((stage) => [stage, 0]),
  ) as Record<McpToolAccessStage, number>
  for (const entry of entries) stageCounts[entry.stage] += 1
  const workflows: Partial<
    Record<McpToolWorkflow, McpToolWorkflowCompanions>
  > = {}
  for (const entry of expandedEntries) {
    if (entry.workflow !== null && workflows[entry.workflow] === undefined) {
      workflows[entry.workflow] = entry.companions
    }
  }
  const authenticationCounts = Object.fromEntries(
    MCP_TOOL_AUTH_CLASSES.map((name) => [name, 0]),
  ) as Record<McpToolAuthClass, number>
  const permissionModeCounts = Object.fromEntries(
    MCP_TOOL_PERMISSION_MODES.map((name) => [name, 0]),
  ) as Record<McpToolPermissionMode, number>
  const targetScopeCounts = Object.fromEntries(
    MCP_TOOL_TARGET_SCOPES.map((name) => [name, 0]),
  ) as Record<McpToolTargetScope, number>
  for (const { requirements } of entries) {
    authenticationCounts[requirements.authentication] += 1
    permissionModeCounts[requirements.discord.permissionMode] += 1
    targetScopeCounts[requirements.targetScope] += 1
  }
  return {
    authorityGranted: false,
    credentialsRequired: false,
    discordContacted: false,
    entries,
    format: MCP_TOOL_ACCESS_MANIFEST_FORMAT,
    readiness: "target-specific",
    requirementCoverage: {
      authenticationCounts,
      complete: true,
      exactToolEntries: entries.filter(({ requirements }) => (
        requirements.source === "exact-tool"
      )).length,
      permissionModeCounts,
      targetAccessProven: false,
      targetScopeCounts,
      toolsetEntries: entries.filter(({ requirements }) => (
        requirements.source === "toolset"
      )).length,
      unknownEntries: 0,
    },
    schemaVersion: SCHEMA_VERSION,
    stageContracts,
    stageCounts,
    status: "ok",
    toolsetNames: selectedToolsets,
    warnings: [
      "Static access contracts classify authorization and never prove target access",
      "Static requirements cover every selected tool but remain setup guidance rather than authority",
      "Toolset-sourced requirements are conservative setup envelopes; exact tool and target resolution remains runtime",
      "Presets declare setup permissions; every tool or plan checks exact operation evidence",
      "Every write still enforces policy, target, approval, freshness, rate, recovery, and verification",
    ],
    workflows,
  }
}

export function createMcpToolAccessIndex(
  requirementsUriTemplate: string,
  toolsets: ReadonlySet<McpToolsetName> = new Set(MCP_TOOLSET_NAMES),
): McpToolAccessIndex {
  const manifest = createMcpToolAccessManifest(toolsets)
  const {
    entries,
    format: _format,
    ...shared
  } = manifest
  return {
    ...shared,
    entries: entries.map(({ name, stage, toolset, workflow }) => ({
      name,
      stage,
      toolset,
      workflow,
    })),
    exactRequirementToolNames: entries
      .filter(({ requirements }) => requirements.source === "exact-tool")
      .map(({ name }) => name),
    format: MCP_TOOL_ACCESS_INDEX_FORMAT,
    requirementsResource: {
      uriTemplate: requirementsUriTemplate,
      variable: "toolName",
    },
    warnings: [
      ...manifest.warnings,
      "Read the exact per-tool resource for the complete static setup and access contract",
    ],
  }
}

export function createMcpToolAccessDocument(
  name: McpToolName,
): McpToolAccessDocument {
  const entry = mcpToolAccessEntry(name)
  assertAccessTopology(entry)
  return {
    authorityGranted: false,
    credentialsRequired: false,
    discordContacted: false,
    entry,
    format: MCP_TOOL_ACCESS_DOCUMENT_FORMAT,
    readiness: entry.readiness,
    status: "ok",
    warnings: [
      "Static requirements are setup guidance and do not prove access to any target",
      "The operation runtime remains authoritative for policy, permission, hierarchy, intent, freshness, and approval checks",
    ],
  }
}

export const discoverDiscordToolsInputSchema = z.strictObject({
  detail: z.enum(MCP_DISCOVERY_DETAILS)
    .default("compact")
    .describe("Compact match cards or full exact input contracts"),
  limit: z.number()
    .int()
    .min(1)
    .max(CONNECTOR_LIMITS.toolDiscoveryMatches)
    .default(5)
    .describe("Maximum direct matches to return"),
  query: z.string()
    .min(1)
    .max(CONNECTOR_LIMITS.toolDiscoveryQueryCharacters)
    .refine((value) => value.trim().length > 0, "query must not be blank")
    .optional()
    .describe("Capability or exact canonical tool name to find"),
  risk: z.enum(MCP_DISCOVERY_RISKS)
    .optional()
    .describe("Optional exact MCP risk class"),
  toolset: z.enum(MCP_TOOLSET_NAMES)
    .optional()
    .describe("Optional exact configured toolset"),
})

export type DiscoverDiscordToolsInput = z.infer<
  typeof discoverDiscordToolsInputSchema
>

export interface TrackedMcpTool {
  handle: RegisteredTool
  inputSchema: Record<string, unknown>
  name: CanonicalMcpToolName
}

interface SearchableMcpTool extends TrackedMcpTool {
  access: McpToolAccessContract
  annotations: CompleteToolAnnotations
  description: string
  keywords: readonly string[]
  normalizedDescription: string
  normalizedKeywordGroups: ReadonlyArray<readonly string[]>
  normalizedName: string
  normalizedTitle: string
  normalizedToolset: string
  risk: McpDiscoveryRisk
  summary: string
  title: string
  toolset: McpToolsetName
  workflow?: McpToolWorkflow
}

export interface DiscordToolDiscoveryCatalog {
  entries: readonly SearchableMcpTool[]
  surface: McpToolSurface
}

const SEARCH_EXACT_SCORE = 10_000
const SEARCH_NAME_PREFIX_SCORE = 500
const SEARCH_TITLE_PREFIX_SCORE = 300
const SEARCH_MATCHED_TERM_BONUS = 25
const SEARCH_MULTI_TERM_MIN_SCORE = 150
const SEARCH_STEM_MIN_CHARACTERS = 4
const REVIEWED_PLAN_TOOL_PREFIX = "plan_"
const SEARCH_RESULT_PRIORITIES = Object.freeze({
  mutation: 0,
  readOnly: 1,
  reviewedPlan: 2,
})

const SEARCH_FIELD_WEIGHTS = Object.freeze({
  description: Object.freeze({ phrase: 60, term: 10 }),
  keywords: Object.freeze({ phrase: 150, term: 40 }),
  name: Object.freeze({ phrase: 200, term: 100 }),
  title: Object.freeze({ phrase: 150, term: 60 }),
  toolset: Object.freeze({ phrase: 100, term: 30 }),
})

const SEARCH_CHANGE_VARIANTS = Object.freeze([
  "configur",
  "edit",
  "modify",
  "set",
  "update",
])
const SEARCH_CONFIGURE_VARIANTS = Object.freeze([
  "change",
  "edit",
  "modify",
  "set",
  "update",
])
const SEARCH_FIND_VARIANTS = Object.freeze(["lookup", "search"])
const SEARCH_SEMANTIC_VARIANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  change: SEARCH_CHANGE_VARIANTS,
  changed: SEARCH_CHANGE_VARIANTS,
  changing: SEARCH_CHANGE_VARIANTS,
  configuration: SEARCH_CONFIGURE_VARIANTS,
  configure: SEARCH_CONFIGURE_VARIANTS,
  configured: SEARCH_CONFIGURE_VARIANTS,
  configuring: SEARCH_CONFIGURE_VARIANTS,
  find: SEARCH_FIND_VARIANTS,
  finding: SEARCH_FIND_VARIANTS,
  found: SEARCH_FIND_VARIANTS,
  look: SEARCH_FIND_VARIANTS,
  lookup: SEARCH_FIND_VARIANTS,
  many: ["bulk"],
  multiple: ["bulk"],
  reorder: ["order"],
  reordered: ["order"],
  reordering: ["order"],
  view: ["access"],
  viewed: ["access"],
  viewing: ["access"],
})

const SEARCH_STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "at",
  "by",
  "can",
  "could",
  "discord",
  "do",
  "does",
  "during",
  "for",
  "from",
  "i",
  "in",
  "into",
  "is",
  "it",
  "may",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "tool",
  "using",
  "want",
  "what",
  "which",
  "who",
  "why",
  "with",
  "without",
  "would",
  "you",
  "your",
])

interface SearchTerm {
  variants: readonly string[]
}

interface SearchScore {
  matchedTerms: number
  score: number
  totalTerms: number
}

interface WeightedSearchField {
  phraseWeight: number
  termWeight: number
  tokens: readonly string[]
}

interface RankedSearchTool {
  entry: SearchableMcpTool
  result: SearchScore
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function toolSummary(description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim()
  if (normalized.length <= CONNECTOR_LIMITS.toolDiscoverySummaryCharacters) {
    return normalized
  }
  return `${normalized.slice(0, CONNECTOR_LIMITS.toolDiscoverySummaryCharacters - 3).trimEnd()}...`
}

function completeAnnotations(
  annotations: ToolAnnotations | undefined,
  name: string,
): CompleteToolAnnotations {
  if (
    typeof annotations?.destructiveHint !== "boolean"
    || typeof annotations.idempotentHint !== "boolean"
    || typeof annotations.openWorldHint !== "boolean"
    || typeof annotations.readOnlyHint !== "boolean"
  ) {
    throw new Error(`MCP tool ${name} must have complete risk annotations`)
  }
  return {
    destructiveHint: annotations.destructiveHint,
    idempotentHint: annotations.idempotentHint,
    openWorldHint: annotations.openWorldHint,
    readOnlyHint: annotations.readOnlyHint,
  }
}

function discoveryRisk(
  annotations: CompleteToolAnnotations,
): McpDiscoveryRisk {
  if (annotations.destructiveHint) return "destructive"
  if (!annotations.readOnlyHint) return "write"
  return annotations.openWorldHint ? "external-read" : "local-read"
}

export function parseMcpToolSurface(
  value: string | undefined,
  name: string,
): McpToolSurface {
  if (value === undefined || value.trim() === "") return "full"
  const normalized = value.trim().toLowerCase()
  if ((MCP_TOOL_SURFACES as readonly string[]).includes(normalized)) {
    return normalized as McpToolSurface
  }
  throw new ConfigurationError(
    `${name} must be one of: ${MCP_TOOL_SURFACES.join(", ")}`,
  )
}

export function parseMcpToolsets(
  value: string | undefined,
  name: string,
): ReadonlySet<McpToolsetName> {
  if (value === undefined || value.trim() === "") {
    return new Set(MCP_TOOLSET_NAMES)
  }
  const selected = [...new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )]
  if (selected.length === 0) {
    throw new ConfigurationError(`${name} must select all or at least one toolset`)
  }
  if (selected.includes("all")) {
    if (selected.length !== 1) {
      throw new ConfigurationError(`${name} cannot combine all with named toolsets`)
    }
    return new Set(MCP_TOOLSET_NAMES)
  }
  const unknown = selected.filter((entry) => (
    !(MCP_TOOLSET_NAMES as readonly string[]).includes(entry)
  ))
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `${name} contains unknown toolsets: ${unknown.join(", ")}. Known: ${MCP_TOOLSET_NAMES.join(", ")}`,
    )
  }
  return new Set(selected as McpToolsetName[])
}

export function selectedMcpToolsets(
  toolsets: ReadonlySet<McpToolsetName>,
): McpToolsetName[] {
  return MCP_TOOLSET_NAMES.filter((name) => toolsets.has(name))
}

export function mcpToolSelected(
  name: CanonicalMcpToolName,
  toolsets: ReadonlySet<McpToolsetName>,
): boolean {
  return toolsets.has(MCP_TOOL_CATALOG[name].toolset)
}

export function selectedCanonicalMcpToolNames(
  toolsets: ReadonlySet<McpToolsetName>,
): CanonicalMcpToolName[] {
  return (Object.keys(MCP_TOOL_CATALOG) as CanonicalMcpToolName[])
    .filter((name) => mcpToolSelected(name, toolsets))
}

export function createDiscordToolDiscoveryCatalog(
  tools: readonly TrackedMcpTool[],
  surface: McpToolSurface,
): DiscordToolDiscoveryCatalog {
  const seen = new Set<CanonicalMcpToolName>()
  const entries = tools.map((tool): SearchableMcpTool => {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tracked MCP tool ${tool.name}`)
    }
    seen.add(tool.name)
    const metadata: ToolCatalogMetadata = MCP_TOOL_CATALOG[tool.name]
    const annotations = completeAnnotations(tool.handle.annotations, tool.name)
    const description = tool.handle.description || ""
    const title = tool.handle.title || tool.name
    return {
      ...tool,
      access: mcpToolAccessContract(tool.name),
      annotations,
      description,
      keywords: metadata.keywords,
      normalizedDescription: normalize(description),
      normalizedKeywordGroups: metadata.keywords.map((keyword) => (
        normalize(keyword).split(" ").filter(Boolean)
      )),
      normalizedName: normalize(tool.name),
      normalizedTitle: normalize(title),
      normalizedToolset: normalize(metadata.toolset),
      risk: discoveryRisk(annotations),
      summary: toolSummary(description),
      title,
      toolset: metadata.toolset,
      ...(metadata.workflow ? { workflow: metadata.workflow } : {}),
    }
  })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  if (surface === "progressive") {
    for (const entry of entries) entry.handle.disable()
  }
  return { entries, surface }
}

function searchTermVariants(term: string): string[] {
  const variants = new Set([term])
  if (term.endsWith("ies") && term.length > 4) {
    variants.add(`${term.slice(0, -3)}y`)
  } else if (term.endsWith("s") && term.length > 3 && !term.endsWith("ss")) {
    variants.add(term.slice(0, -1))
  }
  if (term.endsWith("ed") && term.length > 4) {
    const base = term.slice(0, -2)
    variants.add(base)
    if (base.at(-1) === base.at(-2)) variants.add(base.slice(0, -1))
  }
  if (term.endsWith("ing") && term.length > 5) {
    const base = term.slice(0, -3)
    variants.add(base)
    if (base.at(-1) === base.at(-2)) variants.add(base.slice(0, -1))
  }
  for (const variant of [...variants]) {
    for (const semantic of SEARCH_SEMANTIC_VARIANTS[variant] || []) {
      variants.add(semantic)
    }
  }
  return [...variants]
}

function meaningfulSearchTerms(query: string): SearchTerm[] {
  return [...new Set(
    query
      .split(" ")
      .filter((term) => term && !SEARCH_STOP_WORDS.has(term)),
  )].map((term) => ({ variants: searchTermVariants(term) }))
}

function searchTokenMatches(
  token: string,
  variants: readonly string[],
): boolean {
  return variants.some((variant) => (
    token === variant
    || (variant.length >= SEARCH_STEM_MIN_CHARACTERS && token.startsWith(variant))
  ))
}

function searchFieldMatchesTerm(
  field: WeightedSearchField,
  term: SearchTerm,
): boolean {
  return field.tokens.some((token) => searchTokenMatches(token, term.variants))
}

function searchFieldMatchesPhrase(
  field: WeightedSearchField,
  left: SearchTerm,
  right: SearchTerm,
): boolean {
  for (let index = 0; index < field.tokens.length - 1; index += 1) {
    const leftToken = field.tokens[index]
    const rightToken = field.tokens[index + 1]
    if (
      leftToken !== undefined
      && rightToken !== undefined
      && searchTokenMatches(leftToken, left.variants)
      && searchTokenMatches(rightToken, right.variants)
    ) return true
  }
  return false
}

function weightedSearchFields(entry: SearchableMcpTool): WeightedSearchField[] {
  return [
    {
      phraseWeight: SEARCH_FIELD_WEIGHTS.name.phrase,
      termWeight: SEARCH_FIELD_WEIGHTS.name.term,
      tokens: entry.normalizedName.split(" "),
    },
    {
      phraseWeight: SEARCH_FIELD_WEIGHTS.title.phrase,
      termWeight: SEARCH_FIELD_WEIGHTS.title.term,
      tokens: entry.normalizedTitle.split(" "),
    },
    {
      phraseWeight: SEARCH_FIELD_WEIGHTS.toolset.phrase,
      termWeight: SEARCH_FIELD_WEIGHTS.toolset.term,
      tokens: entry.normalizedToolset.split(" "),
    },
    ...entry.normalizedKeywordGroups.map((tokens) => ({
      phraseWeight: SEARCH_FIELD_WEIGHTS.keywords.phrase,
      termWeight: SEARCH_FIELD_WEIGHTS.keywords.term,
      tokens,
    })),
    {
      phraseWeight: SEARCH_FIELD_WEIGHTS.description.phrase,
      termWeight: SEARCH_FIELD_WEIGHTS.description.term,
      tokens: entry.normalizedDescription.split(" "),
    },
  ]
}

function scoreTool(
  entry: SearchableMcpTool,
  query: string,
  terms: readonly SearchTerm[],
): SearchScore {
  if (query === "") return { matchedTerms: 0, score: 1, totalTerms: 0 }
  if (entry.normalizedName === query) {
    return {
      matchedTerms: terms.length,
      score: SEARCH_EXACT_SCORE,
      totalTerms: terms.length,
    }
  }
  const fields = weightedSearchFields(entry)
  let score = 0
  let matchedTerms = 0
  if (entry.normalizedName.startsWith(query)) score += SEARCH_NAME_PREFIX_SCORE
  if (entry.normalizedTitle.startsWith(query)) score += SEARCH_TITLE_PREFIX_SCORE
  for (const term of terms) {
    const termScore = Math.max(
      0,
      ...fields.map((field) => (
        searchFieldMatchesTerm(field, term) ? field.termWeight : 0
      )),
    )
    if (termScore > 0) {
      matchedTerms += 1
      score += termScore
    }
  }
  for (let index = 0; index < terms.length - 1; index += 1) {
    const left = terms[index]
    const right = terms[index + 1]
    if (left === undefined || right === undefined) continue
    score += Math.max(
      0,
      ...fields.map((field) => (
        searchFieldMatchesPhrase(field, left, right) ? field.phraseWeight : 0
      )),
    )
  }
  score += matchedTerms * SEARCH_MATCHED_TERM_BONUS
  return { matchedTerms, score, totalTerms: terms.length }
}

function qualifiesSearchScore(result: SearchScore): boolean {
  if (result.score <= 0) return false
  if (result.totalTerms <= 1) return true
  return result.matchedTerms >= Math.ceil(result.totalTerms / 2)
    && result.score >= SEARCH_MULTI_TERM_MIN_SCORE
}

function searchResultPriority(entry: SearchableMcpTool): number {
  if (entry.name.startsWith(REVIEWED_PLAN_TOOL_PREFIX)) {
    return SEARCH_RESULT_PRIORITIES.reviewedPlan
  }
  return entry.annotations.readOnlyHint
    ? SEARCH_RESULT_PRIORITIES.readOnly
    : SEARCH_RESULT_PRIORITIES.mutation
}

function promoteReviewedPlans(
  eligibleEntries: readonly SearchableMcpTool[],
  ranked: readonly RankedSearchTool[],
): RankedSearchTool[] {
  const planners = new Map<McpToolWorkflow, SearchableMcpTool>()
  for (const entry of eligibleEntries) {
    if (
      entry.workflow
      && entry.name.startsWith(REVIEWED_PLAN_TOOL_PREFIX)
      && !planners.has(entry.workflow)
    ) planners.set(entry.workflow, entry)
  }
  const promoted = new Map(ranked.map((candidate) => [candidate.entry.name, candidate]))
  for (const candidate of ranked) {
    if (candidate.entry.annotations.readOnlyHint || !candidate.entry.workflow) continue
    const planner = planners.get(candidate.entry.workflow)
    if (!planner) continue
    const existing = promoted.get(planner.name)
    if (!existing || existing.result.score < candidate.result.score) {
      promoted.set(planner.name, { entry: planner, result: candidate.result })
    }
  }
  return [...promoted.values()]
}

function toolsetSummaries(entries: readonly SearchableMcpTool[]) {
  return MCP_TOOLSET_NAMES
    .map((name) => {
      const tools = entries.filter((entry) => entry.toolset === name)
      return {
        availableTools: tools.length,
        enabledTools: tools.filter((entry) => entry.handle.enabled).length,
        name,
      }
    })
    .filter(({ availableTools }) => availableTools > 0)
}

const NATIVE_INTERACTION_RESPONSE_COMPANIONS: ReadonlySet<CanonicalMcpToolName> = new Set([
  "list_discord_interaction_continuations",
  "list_pending_discord_interactions",
  "respond_to_discord_interaction",
  "send_discord_interaction_followup",
])

function workflowNames(
  entries: readonly SearchableMcpTool[],
  matches: readonly SearchableMcpTool[],
): CanonicalMcpToolName[] {
  const names = new Set(matches.map(({ name }) => name))
  const workflows = new Set(
    matches
      .map(({ workflow }) => workflow)
      .filter((workflow): workflow is McpToolWorkflow => workflow !== undefined),
  )
  for (const entry of entries) {
    if (entry.workflow && workflows.has(entry.workflow)) names.add(entry.name)
  }
  if ([...names].some((name) => NATIVE_INTERACTION_RESPONSE_COMPANIONS.has(name))) {
    for (const name of NATIVE_INTERACTION_RESPONSE_COMPANIONS) names.add(name)
  }
  return [...names].sort()
}

function matchResult(
  entry: SearchableMcpTool,
  includeContract: boolean,
) {
  return {
    access: entry.access,
    enabled: entry.handle.enabled,
    name: entry.name,
    risk: entry.risk,
    summary: entry.summary,
    title: entry.title,
    toolset: entry.toolset,
    ...(entry.workflow ? { workflow: entry.workflow } : {}),
    ...(includeContract
      ? {
          annotations: entry.annotations,
          description: entry.description,
          inputSchema: entry.inputSchema,
        }
      : {}),
  }
}

export function discoverDiscordTools(
  input: DiscoverDiscordToolsInput,
  catalog: DiscordToolDiscoveryCatalog,
) {
  const query = normalize(input.query || "")
  const terms = meaningfulSearchTerms(query)
  const hasFilters = Boolean(input.query || input.risk || input.toolset)
  const eligibleEntries = catalog.entries
    .filter((entry) => !input.toolset || entry.toolset === input.toolset)
    .filter((entry) => !input.risk || entry.risk === input.risk)
  const exactEntry = query === ""
    ? undefined
    : eligibleEntries.find((entry) => (
        entry.normalizedName === query
      ))
  const directRanked: RankedSearchTool[] = hasFilters
    ? eligibleEntries
        .map((entry) => ({ entry, result: scoreTool(entry, query, terms) }))
        .filter(({ result }) => qualifiesSearchScore(result))
    : []
  const ranked = (query === ""
    ? directRanked
    : promoteReviewedPlans(eligibleEntries, directRanked)
  ).sort((left, right) => {
    const scoreDifference = right.result.score - left.result.score
    if (scoreDifference !== 0) return scoreDifference
    if (query !== "") {
      const priorityDifference = searchResultPriority(right.entry)
        - searchResultPriority(left.entry)
      if (priorityDifference !== 0) return priorityDifference
    }
    return left.entry.name.localeCompare(right.entry.name)
  })
  const selected = exactEntry
    ? [exactEntry]
    : ranked.slice(0, input.limit).map(({ entry }) => entry)
  const exact = exactEntry !== undefined
  const activationNames = workflowNames(catalog.entries, selected)
  const newlyEnabledToolNames: CanonicalMcpToolName[] = []
  if (catalog.surface === "progressive") {
    for (const name of activationNames) {
      const entry = catalog.entries.find((candidate) => candidate.name === name)
      if (!entry || entry.handle.enabled) continue
      entry.handle.enable()
      newlyEnabledToolNames.push(name)
    }
  }
  const includeAllContracts = input.detail === "full" || exact
  return {
    detail: input.detail as McpDiscoveryDetail,
    matches: selected.map((entry) => matchResult(entry, includeAllContracts)),
    newlyEnabledToolNames,
    refreshToolsList: newlyEnabledToolNames.length > 0,
    schemaVersion: SCHEMA_VERSION,
    status: "ok" as const,
    surface: catalog.surface,
    toolsets: toolsetSummaries(catalog.entries),
    totalMatches: exact ? 1 : ranked.length,
  }
}
