import type { McpServer } from "@modelcontextprotocol/server"

import type { McpToolsetName } from "./constants.js"
import { registerDiscordPrompts } from "./mcp-prompts.js"
import { registerDiscordResources } from "./mcp-resources.js"
import type { PolicyDescription } from "./policy.js"
import type { ConnectorService } from "./service.js"

export * from "./mcp-guidance-catalog.js"

export type DiscordGuidanceService = Pick<
  ConnectorService,
  | "explainChannelAccess"
  | "getGuildMember"
  | "getMessage"
  | "getRole"
  | "listActivity"
  | "listAutoModerationRules"
  | "listChannels"
  | "listChannelPermissionOverwrites"
  | "listChannelWebhooks"
  | "listGuilds"
  | "listGuildExpressions"
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
