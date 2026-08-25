import type { McpServer } from "@modelcontextprotocol/server"

import type { McpToolsetName } from "./constants.js"
import { registerDiscordPrompts } from "./mcp-prompts.js"
import { registerDiscordResources } from "./mcp-resources.js"
import type { PolicyDescription } from "./policy.js"
import type { ConnectorService } from "./service.js"

export * from "./mcp-guidance-catalog.js"

export type DiscordGuidanceService = Pick<
  ConnectorService,
  | "auditApplicationCommands"
  | "auditApplicationRoleConnectionMetadata"
  | "auditForumTags"
  | "auditChannelDeletion"
  | "auditRoleDeletion"
  | "auditChannelOrder"
  | "auditRoleOrder"
  | "explainChannelAccess"
  | "getChannel"
  | "getVoiceChannelStatus"
  | "getApplicationEmoji"
  | "getApplicationPosture"
  | "getGuildMember"
  | "getMemberVoiceState"
  | "getGuildBan"
  | "getGuildInvite"
  | "getGuildOnboarding"
  | "getGuildWelcomeScreen"
  | "getGuildWidgetSettings"
  | "getGuildSettings"
  | "getGuildIncidentActions"
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
  | "listGuildVoiceRegions"
  | "listDefaultSoundboardSounds"
  | "listGuildSoundboardSounds"
  | "listGuildTemplates"
  | "listScheduledEvents"
  | "listVoiceRegions"
  | "listRoles"
>

export interface DiscordGuidanceOptions {
  completionPolicy?: PolicyDescription
  mcpReadResponseMaxBytes: number
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
  registerDiscordPrompts(server, options)
}
