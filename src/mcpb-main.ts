import { runMcpbServer } from "./mcpb-entry.js"

process.exitCode = await runMcpbServer()
