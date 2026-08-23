import type { McpServer } from "@modelcontextprotocol/server"

import type { McpToolsetName } from "./constants.js"
import { registerDiscordPrompts } from "./mcp-prompts.js"
import { registerDiscordResources } from "./mcp-resources.js"
import type { PolicyDescription } from "./policy.js"
import type { ConnectorService } from "./service.js"

export * from "./mcp-guidance-catalog.js"

export type DiscordGuidanceService = Pick<
  ConnectorService,
  | "auditForumTags"
  | "auditChannelOrder"
  | "auditRoleOrder"
  | "explainChannelAccess"
  | "getChannel"
  | "getApplicationEmoji"
  | "getGuildMember"
  | "getMemberVoiceState"
  | "getGuildBan"
  | "getGuildInvite"
  | "getGuildOnboarding"
  | "getGuildWelcomeScreen"
  | "getGuildWidgetSettings"
  | "getGuildSettings"
  | "getGuildProfile"
  | "getGuildSoundboardSound"
  | "getMessage"
  | "getRole"
  | "getStageInstance"
  | "getThreadMembership"
  | "getThreadState"
  | "listActivity"
  | "listApplicationEmojis"
  | "listAutoModerationRules"
  | "listChannels"
  | "listChannelPermissionOverwrites"
  | "listChannelWebhooks"
  | "listAnnouncementSubscriptions"
  | "listGuilds"
  | "listMessageReactions"
  | "listGuildExpressions"
  | "listGuildIntegrations"
  | "listDefaultSoundboardSounds"
  | "listGuildSoundboardSounds"
  | "listGuildTemplates"
  | "listScheduledEvents"
  | "listRoles"
>

export interface DiscordGuidanceOptions {
  policy: PolicyDescription
  secrets: readonly (string | undefined)[]
  service: DiscordGuidanceService
  toolsets: ReadonlySet<McpToolsetName>
}

export function registerDiscordGuidance(
  server: McpServer,
  options: DiscordGuidanceOptions,
): void {
  registerDiscordResources(server, options)
  registerDiscordPrompts(server, options.secrets, options.toolsets)
}
