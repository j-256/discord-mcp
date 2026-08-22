import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"

import {
  Client,
  InMemoryTransport,
  type ResourceUpdatedNotification,
} from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

import { GatewayEventStore } from "../src/gateway-events.js"
import { registerDiscordGatewayMcp } from "../src/mcp-gateway.js"
import {
  MCP_RESOURCE_NAMES,
  MCP_RESOURCE_URIS,
} from "../src/mcp-guidance-catalog.js"
import type {
  NativeInteractionChangeKind,
  NativeInteractionChangeListener,
  NativeInteractionSource,
} from "../src/native-interaction-broker.js"

const TOKEN = "test-discord-token"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const MESSAGE_ID = "300000000000000001"

class NativeInteractionFeed implements NativeInteractionSource {
  readonly enabled = true
  readonly #listeners = new Set<NativeInteractionChangeListener>()

  getStatus(): ReturnType<NativeInteractionSource["getStatus"]> {
    throw new Error("Status read is outside this notification test")
  }

  async listPending(): ReturnType<NativeInteractionSource["listPending"]> {
    throw new Error("Pending read is outside this notification test")
  }

  async respond(): ReturnType<NativeInteractionSource["respond"]> {
    throw new Error("Response is outside this notification test")
  }

  subscribe(listener: NativeInteractionChangeListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  emit(kind: NativeInteractionChangeKind): void {
    for (const listener of this.#listeners) listener(kind)
  }
}

function feed(enabled = true): GatewayEventStore {
  return new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    clock: () => new Date("2026-08-19T00:00:00.000Z"),
    cursorNamespace: "mcpnotify12",
    enabled,
  })
}

function createServer(
  gateway: GatewayEventStore,
  notificationDelayMs = 10,
  nativeInteractions?: NativeInteractionSource,
): McpServer {
  const server = new McpServer(
    { name: "gateway-mcp-test", version: "1.0.0" },
    {
      capabilities: {
        resources: gateway.enabled || nativeInteractions?.enabled
          ? { subscribe: true }
          : {},
      },
    },
  )
  registerDiscordGatewayMcp(server, {
    gateway,
    ...(nativeInteractions ? { nativeInteractions } : {}),
    notificationDelayMs,
    secrets: [TOKEN],
  })
  return server
}

async function readJson(client: Client, uri: string): Promise<Record<string, unknown>> {
  const result = await client.readResource({ uri })
  const content = result.contents[0]
  assert.ok(content && "text" in content)
  if (!(content && "text" in content)) throw new Error("Expected text resource")
  assert.equal(content.mimeType, "application/json")
  return JSON.parse(content.text) as Record<string, unknown>
}

function notificationPromise(client: Client) {
  let resolveNotification: (value: ResourceUpdatedNotification) => void
  const promise = new Promise<ResourceUpdatedNotification>((resolve) => {
    resolveNotification = resolve
  })
  client.setNotificationHandler("notifications/resources/updated", (notification) => {
    resolveNotification(notification)
  })
  return promise
}

async function legacyFixture(context: TestContext, enabled = true) {
  const gateway = feed(enabled)
  const server = createServer(gateway)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client(
    { name: "gateway-legacy-client", version: "1.0.0" },
    { capabilities: {} },
  )
  await client.connect(clientTransport)
  context.after(async () => {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  })
  return { client, gateway, server }
}

test("Gateway MCP resources are listed, readable, bounded, and content-free", async (context) => {
  const { client, gateway } = await legacyFixture(context)
  gateway.transition("connecting")
  gateway.transition("ready")
  gateway.ingestDispatch("MESSAGE_CREATE", {
    author: { username: TOKEN },
    channel_id: CHANNEL_ID,
    content: TOKEN,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })

  const listed = await client.listResources()
  assert.deepEqual(
    listed.resources.map(({ name, uri }) => ({ name, uri })).sort((a, b) => a.uri.localeCompare(b.uri)),
    [
      {
        name: MCP_RESOURCE_NAMES.gatewayEvents,
        uri: MCP_RESOURCE_URIS.gatewayEvents,
      },
      {
        name: MCP_RESOURCE_NAMES.gatewayStatus,
        uri: MCP_RESOURCE_URIS.gatewayStatus,
      },
    ].sort((a, b) => a.uri.localeCompare(b.uri)),
  )
  const events = await readJson(client, MCP_RESOURCE_URIS.gatewayEvents)
  const status = await readJson(client, MCP_RESOURCE_URIS.gatewayStatus)
  assert.equal(
    (events.trust as Record<string, unknown>).classification,
    "untrusted-external-data",
  )
  assert.equal(
    (status.trust as Record<string, unknown>).classification,
    "trusted-local-metadata",
  )
  assert.doesNotMatch(JSON.stringify({ events, status }), new RegExp(TOKEN))
  assert.doesNotMatch(JSON.stringify(events), /author|attachment|embed|component|emoji|userId/)
})

test("Legacy Gateway subscriptions are exact, coalesced, and removable", async (context) => {
  const { client, gateway } = await legacyFixture(context)
  const firstNotification = notificationPromise(client)
  await client.subscribeResource({ uri: MCP_RESOURCE_URIS.gatewayEvents })
  await assert.rejects(
    () => client.subscribeResource({ uri: "discord://gateway/unknown" }),
    /does not support subscriptions/,
  )

  gateway.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })
  const first = await firstNotification
  assert.equal(first.params.uri, MCP_RESOURCE_URIS.gatewayEvents)

  await client.unsubscribeResource({ uri: MCP_RESOURCE_URIS.gatewayEvents })
  let notifications = 0
  client.setNotificationHandler("notifications/resources/updated", () => {
    notifications += 1
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  notifications = 0
  gateway.ingestDispatch("MESSAGE_DELETE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(notifications, 0)
})

test("Disabled Gateway resources stay readable without advertising subscriptions", async (context) => {
  const { client } = await legacyFixture(context, false)
  const status = await readJson(client, MCP_RESOURCE_URIS.gatewayStatus)
  assert.equal(
    ((status.data as Record<string, unknown>).connection as Record<string, unknown>).state,
    "disabled",
  )
  assert.equal(client.getServerCapabilities()?.resources?.subscribe, undefined)
  await assert.rejects(
    () => client.subscribeResource({ uri: MCP_RESOURCE_URIS.gatewayEvents }),
    /Method not found/,
  )
})

test("Modern subscriptions/listen receives only matching Gateway resource updates", async (context) => {
  const gateway = feed()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const handle = serveStdio(() => createServer(gateway), {
    transport: serverTransport,
  })
  const client = new Client(
    { name: "gateway-modern-client", version: "1.0.0" },
    {
      capabilities: {},
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    await client.close().catch(() => undefined)
    await handle.close().catch(() => undefined)
  })
  const nextNotification = notificationPromise(client)
  await client.connect(clientTransport)
  const subscription = await client.listen({
    resourceSubscriptions: [MCP_RESOURCE_URIS.gatewayEvents],
  })
  context.after(async () => {
    await subscription.close().catch(() => undefined)
  })

  gateway.transition("connecting")
  gateway.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })
  const notification = await nextNotification
  assert.equal(notification.params.uri, MCP_RESOURCE_URIS.gatewayEvents)
})

test("Native Interaction subscriptions work without the content-free Gateway feed", async (context) => {
  const gateway = feed(false)
  const interactions = new NativeInteractionFeed()
  const server = createServer(gateway, 10, interactions)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client(
    { name: "native-interaction-client", version: "1.0.0" },
    { capabilities: {} },
  )
  await client.connect(clientTransport)
  context.after(async () => {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  })

  assert.equal(client.getServerCapabilities()?.resources?.subscribe, true)
  const pendingNotification = notificationPromise(client)
  await client.subscribeResource({
    uri: MCP_RESOURCE_URIS.nativeInteractionPending,
  })
  await assert.rejects(
    () => client.subscribeResource({ uri: MCP_RESOURCE_URIS.gatewayEvents }),
    /does not support subscriptions/,
  )

  interactions.emit("status")
  interactions.emit("pending")
  const notification = await pendingNotification
  assert.equal(
    notification.params.uri,
    MCP_RESOURCE_URIS.nativeInteractionPending,
  )
})
