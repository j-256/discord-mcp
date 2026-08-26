import type { McpServer } from "@modelcontextprotocol/server"

export type McpToolContext = Parameters<Parameters<McpServer["registerTool"]>[2]>[1]

const MCP_TOOL_PROGRESS_TOTAL = 1
export const MCP_TOOL_PROGRESS = Object.freeze({
  finished: Object.freeze({
    message: "Discord request round finished",
    value: 1,
  }),
  started: Object.freeze({
    message: "Discord request round started",
    value: 0,
  }),
})

export async function notifyMcpToolProgress(
  context: McpToolContext,
  update: (typeof MCP_TOOL_PROGRESS)[keyof typeof MCP_TOOL_PROGRESS],
): Promise<void> {
  const progressToken = context.mcpReq._meta?.progressToken
  if (progressToken === undefined || context.mcpReq.signal.aborted) return
  try {
    await context.mcpReq.notify({
      method: "notifications/progress",
      params: {
        message: update.message,
        progress: update.value,
        progressToken,
        total: MCP_TOOL_PROGRESS_TOTAL,
      },
    })
  } catch {}
}
