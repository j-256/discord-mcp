import type { McpServer } from "@modelcontextprotocol/server"

import { registerDiscordPrompts } from "./mcp-prompts.js"
import { registerDiscordResources } from "./mcp-resources.js"
import type { PolicyDescription } from "./policy.js"
import type { ConnectorService } from "./service.js"

export * from "./mcp-guidance-catalog.js"

export type DiscordGuidanceService = Pick<
  ConnectorService,
  | "explainChannelAccess"
  | "getMessage"
  | "listActivity"
  | "listChannels"
  | "listGuilds"
>

export interface DiscordGuidanceOptions {
  policy: PolicyDescription
  secrets: readonly (string | undefined)[]
  service: DiscordGuidanceService
}

export function registerDiscordGuidance(
  server: McpServer,
  options: DiscordGuidanceOptions,
): void {
  registerDiscordResources(server, options)
  registerDiscordPrompts(server, options.secrets)
}
