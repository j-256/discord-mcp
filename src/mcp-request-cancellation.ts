import type { McpServer, RequestId } from "@modelcontextprotocol/server"

type RequestCancellationInternals = {
  readonly _requestHandlerAbortControllers?: Map<RequestId, AbortController>
}

const CANCELLATION_NOTIFICATION_METHOD = "notifications/cancelled"

export function installMcpRequestCancellation(server: McpServer): void {
  const internals = server.server as unknown as RequestCancellationInternals
  const requestControllers = internals._requestHandlerAbortControllers
  if (!(requestControllers instanceof Map)) {
    throw new Error("Pinned MCP SDK request-cancellation registry is unavailable")
  }
  // The pinned SDK drops legal JSON-RPC ID 0 because its built-in cancellation guard uses truthiness
  server.server.setNotificationHandler(
    CANCELLATION_NOTIFICATION_METHOD,
    (notification) => {
      const requestId = notification.params.requestId
      if (requestId === undefined) return
      requestControllers.get(requestId)?.abort(notification.params.reason)
    },
  )
}
