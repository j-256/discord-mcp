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
import type { McpToolName } from "./observability-catalog.js"

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
type McpToolWorkflow =
  | "announcement-crosspost"
  | "announcement-subscription"
  | "application-emoji-change"
  | "application-intent-enablement"
  | "attachment-message"
  | "automod-change"
  | "bulk-guild-ban"
  | "channel-cloning"
  | "channel-creation"
  | "channel-deletion"
  | "channel-metadata-change"
  | "voice-channel-status-change"
  | "channel-ordering"
  | "channel-permission-overwrite"
  | "component-message"
  | "forum-post"
  | "forum-tag-change"
  | "guild-blueprint"
  | "guild-scaffold"
  | "guild-expression-change"
  | "guild-incident-action-change"
  | "guild-profile-change"
  | "guild-soundboard-change"
  | "guild-settings-change"
  | "guild-template-change"
  | "integration-deletion"
  | "invite-creation"
  | "invite-deletion"
  | "onboarding-change"
  | "poll-creation"
  | "poll-end"
  | "reaction-moderation"
  | "member-moderation"
  | "member-nickname-change"
  | "member-role-change"
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

export const MCP_TOOL_CATALOG = Object.freeze({
  add_reaction: {
    keywords: ["emoji", "react", "reaction"],
    toolset: "interactions",
  },
  audit_application_posture: {
    keywords: ["application", "audit", "bot", "install", "intent", "security", "setup"],
    toolset: "connector",
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
  delete_messages: {
    keywords: ["bulk", "delete", "exact ids", "remove"],
    toolset: "deletion",
    workflow: "message-deletion",
  },
  edit_own_message: {
    keywords: ["edit", "message", "own", "update"],
    toolset: "interactions",
  },
  execute_attachment_message: {
    keywords: ["attachment", "execute", "file", "message", "send", "upload"],
    toolset: "attachments",
    workflow: "attachment-message",
  },
  execute_component_message: {
    keywords: ["component", "create", "edit", "execute", "layout", "message", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  execute_automod_change: {
    keywords: ["automod", "create", "delete", "disable", "enable", "execute", "moderation", "policy", "rule", "update"],
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
  execute_application_intent_enablement: {
    keywords: ["application", "enable", "execute", "guild members", "intent", "message content", "privileged"],
    toolset: "application-security",
    workflow: "application-intent-enablement",
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
    keywords: ["above", "below", "channel", "execute", "layout", "order", "position"],
    toolset: "channel-ordering",
    workflow: "channel-ordering",
  },
  execute_channel_permission_overwrite: {
    keywords: ["access", "channel", "execute", "member", "overwrite", "permission", "role"],
    toolset: "permission-overwrites",
    workflow: "channel-permission-overwrite",
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
    keywords: ["ban", "execute", "kick", "moderate", "timeout", "unban"],
    toolset: "moderation",
    workflow: "member-moderation",
  },
  execute_bulk_guild_ban: {
    keywords: ["ban", "batch", "bulk", "execute", "guild", "moderate", "users"],
    toolset: "bulk-bans",
    workflow: "bulk-guild-ban",
  },
  execute_member_nickname_change: {
    keywords: ["change", "clear", "execute", "member", "nick", "nickname", "profile"],
    toolset: "member-nicknames",
    workflow: "member-nickname-change",
  },
  execute_member_role_change: {
    keywords: ["add", "assign", "execute", "member", "permission", "remove", "role"],
    toolset: "member-roles",
    workflow: "member-role-change",
  },
  execute_member_voice_change: {
    keywords: ["deafen", "disconnect", "execute", "member", "move", "mute", "voice"],
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
  execute_role_creation: {
    keywords: ["create", "execute", "permission", "role"],
    toolset: "role-creation",
    workflow: "role-creation",
  },
  execute_role_configuration: {
    keywords: ["color", "configure", "emoji", "execute", "hoist", "icon", "image", "mentionable", "name", "permission", "role"],
    toolset: "role-configuration",
    workflow: "role-configuration",
  },
  execute_role_order: {
    keywords: ["above", "below", "execute", "hierarchy", "order", "position", "role"],
    toolset: "role-ordering",
    workflow: "role-ordering",
  },
  execute_scheduled_event_change: {
    keywords: ["calendar", "cancel", "complete", "create", "event", "execute", "schedule", "transition", "update"],
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
    keywords: ["access", "permissions", "read", "view"],
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
    keywords: ["audit", "ban", "exact", "guild", "moderation", "user"],
    toolset: "bans",
  },
  get_guild_invite: {
    keywords: ["audit", "exact", "invite", "lookup", "reference"],
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
  get_application_emoji: {
    keywords: ["application", "emoji", "exact", "get", "lookup"],
    toolset: "application-emojis",
  },
  get_observability_status: {
    keywords: ["health", "metrics", "observability", "telemetry", "traces"],
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
    keywords: ["ban", "kick", "moderate", "plan", "review", "timeout", "unban"],
    toolset: "moderation",
    workflow: "member-moderation",
  },
  plan_bulk_guild_ban: {
    keywords: ["ban", "batch", "bulk", "guild", "plan", "review", "users"],
    toolset: "bulk-bans",
    workflow: "bulk-guild-ban",
  },
  plan_member_nickname_change: {
    keywords: ["change", "clear", "member", "nick", "nickname", "plan", "profile", "review"],
    toolset: "member-nicknames",
    workflow: "member-nickname-change",
  },
  plan_member_role_change: {
    keywords: ["add", "assign", "member", "permission", "plan", "remove", "review", "role"],
    toolset: "member-roles",
    workflow: "member-role-change",
  },
  plan_member_voice_change: {
    keywords: ["deafen", "disconnect", "member", "move", "mute", "plan", "review", "voice"],
    toolset: "voice-moderation",
    workflow: "member-voice-change",
  },
  plan_automod_change: {
    keywords: ["automod", "create", "delete", "disable", "enable", "moderation", "plan", "policy", "review", "rule", "update"],
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
    keywords: ["component", "create", "edit", "layout", "message", "plan", "review", "v2"],
    toolset: "interactions",
    workflow: "component-message",
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
    keywords: ["above", "below", "channel", "layout", "order", "plan", "position", "review"],
    toolset: "channel-ordering",
    workflow: "channel-ordering",
  },
  plan_channel_permission_overwrite: {
    keywords: ["access", "channel", "member", "overwrite", "permission", "plan", "review", "role"],
    toolset: "permission-overwrites",
    workflow: "channel-permission-overwrite",
  },
  plan_application_emoji_change: {
    keywords: ["application", "create", "delete", "emoji", "plan", "rename", "review"],
    toolset: "application-emojis",
    workflow: "application-emoji-change",
  },
  plan_application_intent_enablement: {
    keywords: ["application", "enable", "guild members", "intent", "message content", "plan", "privileged", "review"],
    toolset: "application-security",
    workflow: "application-intent-enablement",
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
  plan_role_creation: {
    keywords: ["create", "permission", "plan", "review", "role"],
    toolset: "role-creation",
    workflow: "role-creation",
  },
  plan_role_configuration: {
    keywords: ["color", "configure", "emoji", "hoist", "icon", "image", "mentionable", "name", "permission", "plan", "review", "role"],
    toolset: "role-configuration",
    workflow: "role-configuration",
  },
  plan_role_order: {
    keywords: ["above", "below", "hierarchy", "order", "plan", "position", "review", "role"],
    toolset: "role-ordering",
    workflow: "role-ordering",
  },
  plan_scheduled_event_change: {
    keywords: ["calendar", "cancel", "complete", "create", "event", "plan", "review", "schedule", "transition", "update"],
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
  preview_component_layout: {
    keywords: ["component", "layout", "local", "message", "preview", "validate", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  verify_component_message: {
    keywords: ["component", "drift", "message", "receipt", "recover", "verify", "v2"],
    toolset: "interactions",
    workflow: "component-message",
  },
  read_messages: {
    keywords: ["channel", "history", "list", "message", "read"],
    toolset: "messages",
  },
  remove_own_reaction: {
    keywords: ["emoji", "own", "reaction", "remove", "undo"],
    toolset: "interactions",
  },
  search_messages: {
    keywords: ["author", "content", "filter", "guild", "message", "search"],
    toolset: "messages",
  },
  search_guild_members: {
    keywords: ["directory", "member", "nickname", "prefix", "search", "username"],
    toolset: "members",
  },
  send_message: {
    keywords: ["create", "message", "reply", "send", "write"],
    toolset: "interactions",
  },
  respond_to_discord_interaction: {
    keywords: ["discord", "interaction", "private", "reply", "respond"],
    toolset: "native-interactions",
  },
} satisfies Record<CanonicalMcpToolName, ToolCatalogMetadata>)

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
  annotations: CompleteToolAnnotations
  description: string
  keywords: readonly string[]
  normalizedDescription: string
  normalizedKeywords: string
  normalizedName: string
  normalizedTitle: string
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

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "discord",
  "for",
  "in",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "tool",
])

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
      annotations,
      description,
      keywords: metadata.keywords,
      normalizedDescription: normalize(description),
      normalizedKeywords: normalize(metadata.keywords.join(" ")),
      normalizedName: normalize(tool.name),
      normalizedTitle: normalize(title),
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

function scoreTool(
  entry: SearchableMcpTool,
  query: string,
  terms: readonly string[],
): number {
  if (query === "") return 1
  if (entry.normalizedName === query) return 10_000
  let score = 0
  if (entry.normalizedName.startsWith(query)) score += 500
  if (entry.normalizedTitle.startsWith(query)) score += 300
  for (const term of terms) {
    if (entry.normalizedName.includes(term)) score += 100
    if (entry.normalizedTitle.includes(term)) score += 60
    if (normalize(entry.toolset).includes(term)) score += 30
    if (entry.normalizedKeywords.includes(term)) score += 40
    if (entry.normalizedDescription.includes(term)) score += 10
  }
  return score
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
  return [...names].sort()
}

function matchResult(
  entry: SearchableMcpTool,
  includeContract: boolean,
) {
  return {
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
  const terms = [...new Set(
    query
      .split(" ")
      .filter((term) => term && !SEARCH_STOP_WORDS.has(term)),
  )]
  const hasFilters = Boolean(input.query || input.risk || input.toolset)
  const exactEntry = query === ""
    ? undefined
    : catalog.entries.find((entry) => (
        entry.normalizedName === query
        && (!input.toolset || entry.toolset === input.toolset)
        && (!input.risk || entry.risk === input.risk)
      ))
  const ranked = hasFilters
    ? catalog.entries
        .filter((entry) => !input.toolset || entry.toolset === input.toolset)
        .filter((entry) => !input.risk || entry.risk === input.risk)
        .map((entry) => ({ entry, score: scoreTool(entry, query, terms) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => (
          right.score - left.score
          || left.entry.name.localeCompare(right.entry.name)
        ))
    : []
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
