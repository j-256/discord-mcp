import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_GATEWAY_INTENT_MASK,
  DISCORD_GATEWAY_INTENTS,
} from "../src/constants.js"
import {
  DiscordGateway,
  normalizeGatewayResumeUrl,
  type GatewayScheduler,
  type GatewaySocket,
} from "../src/discord-gateway.js"
import type { GatewayBotDiscovery } from "../src/gateway-discovery.js"
import { GatewayEventStore } from "../src/gateway-events.js"
import {
  calculateGatewayShardId,
  type GatewayChannelRoute,
} from "../src/gateway-topology.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "100000000000000002"
const GUILD_ID = "200000000000000001"
const ORDERING_GUILD_ID = "200000000000000002"
const MEMBER_ROLE_GUILD_ID = "200000000000000003"
const ONBOARDING_GUILD_ID = "200000000000000004"
const TEMPLATE_GUILD_ID = "200000000000000005"
const CLONE_GUILD_ID = "200000000000000006"
const SETTINGS_GUILD_ID = "200000000000000007"
const CHANNEL_ID = "300000000000000001"
const SECOND_CHANNEL_ID = "300000000000000002"
const MESSAGE_ID = "400000000000000001"
const TOKEN = "test-discord-token"
const DISCOVERED_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
const GATEWAY_DISCOVERY = Object.freeze({
  sessionStartLimit: {
    maxConcurrency: 1,
    remaining: 999,
    resetAfterMs: 14_400_000,
    total: 1_000,
  },
  shards: 1,
  url: DISCOVERED_GATEWAY_URL,
})

async function discoverGateway() {
  return GATEWAY_DISCOVERY
}

async function discoverGatewayChannel(channelId: string) {
  return { channelId, guildId: GUILD_ID }
}

class FakeScheduler implements GatewayScheduler {
  #nextId = 1
  readonly jobs = new Map<number, { at: number; handler: () => void }>()
  now = 0

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.jobs.delete(handle)
  }

  setTimeout(handler: () => void, milliseconds: number): unknown {
    const id = this.#nextId
    this.#nextId += 1
    this.jobs.set(id, { at: this.now + milliseconds, handler })
    return id
  }

  runNext(): number {
    const next = [...this.jobs.entries()].sort((left, right) => (
      left[1].at - right[1].at || left[0] - right[0]
    ))[0]
    if (!next) throw new Error("No scheduled Gateway task")
    const [id, job] = next
    this.jobs.delete(id)
    this.now = job.at
    job.handler()
    return this.now
  }
}

class FakeSocket implements GatewaySocket {
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  readonly sent: string[] = []

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  rawMessage(data: unknown): void {
    this.onmessage?.({ data })
  }

  serverClose(code: number): void {
    this.readyState = 3
    this.onclose?.({ code })
  }

  error(): void {
    this.onerror?.()
  }

  close(code = 1_000): void {
    this.serverClose(code)
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("Socket is not open")
    this.sent.push(data)
  }
}

function payloads(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent.map((value) => JSON.parse(value) as Record<string, unknown>)
}

function fixture(options: {
  discovery?: (signal: AbortSignal) => Promise<GatewayBotDiscovery>
  random?: number
  routeDiscovery?: (
    channelId: string,
    signal: AbortSignal,
  ) => Promise<{ channelId: string; guildId: string }>
} = {}) {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const logs: string[] = []
  const eventStore = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    bufferSize: 10,
    clock: () => new Date(scheduler.now),
    cursorNamespace: "gatewaytest1",
    enabled: true,
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: new Set([CHANNEL_ID]),
      allowedGuildIds: new Set([GUILD_ID]),
      allowGateway: true,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway: options.discovery || discoverGateway,
    discoverGatewayChannel: options.routeDiscovery || discoverGatewayChannel,
    eventStore,
    logger(message) {
      logs.push(message)
    },
    random: () => options.random ?? 0,
    scheduler,
    webSocketFactory(url) {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  return { eventStore, gateway, logs, scheduler, sockets, urls }
}

function hello(socket: FakeSocket, heartbeatInterval = 45_000): void {
  socket.open()
  socket.message({
    d: { heartbeat_interval: heartbeatInterval },
    op: 10,
    s: null,
    t: null,
  })
}

function ready(socket: FakeSocket, overrides: Record<string, unknown> = {}): void {
  socket.message({
    d: {
      application: { id: APPLICATION_ID },
      resume_gateway_url: "wss://gateway-us-east1-b.discord.gg",
      session_id: "private-session-id",
      shard: [0, 1],
      user: { bot: true, id: BOT_ID },
      ...overrides,
    },
    op: 0,
    s: 1,
    t: "READY",
  })
}

function guildIdForShard(shardId: number, shardCount: number, nonce = 1): string {
  const shifted = (
    (BigInt(10_000_000 + nonce) * BigInt(shardCount))
    + BigInt(shardId)
  ) << 22n
  return (shifted + 1n).toString()
}

function shardedFixture(options: {
  channelRoutes?: ReadonlyMap<string, string>
  guildIds?: readonly string[]
  maxConcurrency?: number
  random?: number
  remaining?: number
  routeDiscovery?: (
    channelId: string,
    signal: AbortSignal,
  ) => Promise<GatewayChannelRoute>
  shards: number
}) {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const logs: string[] = []
  const allowedChannelIds = new Set(options.channelRoutes?.keys() ?? [])
  const allowedGuildIds = new Set(options.guildIds ?? [])
  const eventStore = new GatewayEventStore({
    allowedChannelIds,
    allowedGuildIds,
    bufferSize: 10,
    clock: () => new Date(scheduler.now),
    cursorNamespace: "shardedgateway1",
    enabled: true,
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds,
      allowedGuildIds,
      allowGateway: true,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway: async () => ({
      sessionStartLimit: {
        maxConcurrency: options.maxConcurrency ?? 1,
        remaining: options.remaining ?? 999,
        resetAfterMs: 14_400_000,
        total: 1_000,
      },
      shards: options.shards,
      url: DISCOVERED_GATEWAY_URL,
    }),
    discoverGatewayChannel: options.routeDiscovery || (async (channelId) => {
      const guildId = options.channelRoutes?.get(channelId)
      if (!guildId) throw new Error("Missing test route")
      return { channelId, guildId }
    }),
    eventStore,
    logger(message) {
      logs.push(message)
    },
    random: () => options.random ?? 0,
    scheduler,
    webSocketFactory(url) {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  return { eventStore, gateway, logs, scheduler, sockets, urls }
}

test("Gateway construction independently enforces scope and enabled-state invariants", () => {
  assert.throws(
    () => new DiscordGateway({
      applicationId: APPLICATION_ID,
      config: {
        allowedChannelIds: new Set([CHANNEL_ID]),
        allowedGuildIds: new Set([GUILD_ID]),
        allowGateway: true,
        expectedBotId: undefined,
        gatewayEventBufferSize: 10,
        token: TOKEN,
      },
      discoverGateway,
      discoverGatewayChannel,
    }),
    /bot ID must be a Discord snowflake/,
  )
  assert.throws(
    () => new DiscordGateway({
      applicationId: APPLICATION_ID,
      config: {
        allowedChannelIds: new Set(),
        allowedGuildIds: new Set(),
        allowGateway: true,
        expectedBotId: BOT_ID,
        gatewayEventBufferSize: 10,
        token: TOKEN,
      },
      discoverGateway,
      discoverGatewayChannel,
    }),
    /exact guild or channel scope/,
  )

  const disabledStore = new GatewayEventStore({
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(),
    enabled: false,
  })
  assert.throws(
    () => new DiscordGateway({
      applicationId: APPLICATION_ID,
      config: {
        allowedChannelIds: new Set([CHANNEL_ID]),
        allowedGuildIds: new Set(),
        allowGateway: true,
        expectedBotId: BOT_ID,
        gatewayEventBufferSize: 10,
        token: TOKEN,
      },
      discoverGateway,
      discoverGatewayChannel,
      eventStore: disabledStore,
    }),
    /enabled states must match/,
  )

  const channelOnlyGateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    config: {
      allowedChannelIds: new Set([CHANNEL_ID]),
      allowedGuildIds: new Set(),
      allowGateway: true,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway,
    discoverGatewayChannel,
  })
  assert.equal(channelOnlyGateway.enabled, true)
  assert.equal(channelOnlyGateway.getStatus().feedEnabled, true)
  assert.equal(channelOnlyGateway.layoutEnabled, false)
})

test("Gateway startup awaits authenticated discovery and exposes only safe limit metadata", async () => {
  let resolveDiscovery: ((value: GatewayBotDiscovery) => void) | undefined
  const pending = new Promise<GatewayBotDiscovery>((resolve) => {
    resolveDiscovery = resolve
  })
  const discovered = {
    ...GATEWAY_DISCOVERY,
    url: "wss://gateway-eu-west.discord.gg/?v=10&encoding=json",
  }
  const { gateway, sockets, urls } = fixture({
    discovery: async () => pending,
  })

  const starting = gateway.start()
  assert.equal(gateway.getStatus().connection.state, "discovering")
  assert.deepEqual(gateway.getStatus().discovery, {
    checkedAt: null,
    recommendedShards: null,
    sessionStartLimit: null,
    topology: null,
  })
  assert.deepEqual(sockets, [])

  resolveDiscovery?.(discovered)
  await starting

  assert.deepEqual(urls, [discovered.url])
  assert.deepEqual(gateway.getStatus().discovery, {
    checkedAt: "1970-01-01T00:00:00.000Z",
    recommendedShards: 1,
    sessionStartLimit: {
      localStartsSinceCheck: 0,
      maxConcurrency: 1,
      remainingAtCheck: 999,
      resetAfterMs: 14_400_000,
      total: 1_000,
    },
    topology: {
      activeShards: 1,
      resolvedChannels: 0,
      scopedGuilds: 1,
    },
  })
  const rendered = JSON.stringify(gateway.getStatus())
  assert.doesNotMatch(rendered, /gateway-eu-west|discord\.gg|wss:/)
  assert.doesNotMatch(rendered, new RegExp(TOKEN))
  await gateway.stop()
})

test("Gateway discovery failures and exhausted sessions fail closed", async () => {
  const cases: Array<{
    category: string
    discovery: (signal: AbortSignal) => Promise<GatewayBotDiscovery>
  }> = [
    {
      category: "gateway-discovery-failed",
      discovery: async () => {
        throw new Error(`private ${TOKEN}`)
      },
    },
    {
      category: "invalid-gateway-discovery",
      discovery: async () => ({
        ...GATEWAY_DISCOVERY,
        url: `wss://${TOKEN}@gateway.discord.gg/`,
      }),
    },
    {
      category: "session-start-limit-exhausted",
      discovery: async () => ({
        ...GATEWAY_DISCOVERY,
        sessionStartLimit: {
          ...GATEWAY_DISCOVERY.sessionStartLimit,
          remaining: 0,
        },
      }),
    },
  ]

  for (const item of cases) {
    const { gateway, logs, sockets } = fixture({ discovery: item.discovery })
    await gateway.start()
    assert.equal(gateway.getStatus().connection.state, "failed")
    assert.equal(gateway.getStatus().connection.lastError?.category, item.category)
    assert.deepEqual(logs, [`[gateway] stopped: ${item.category}`])
    assert.deepEqual(sockets, [])
    assert.doesNotMatch(JSON.stringify({ logs, status: gateway.getStatus() }), new RegExp(TOKEN))
    await gateway.stop()
  }
})

test("Gateway stop aborts pending discovery and ignores its late completion", async () => {
  let discoverySignal: AbortSignal | undefined
  let resolveDiscovery: ((value: GatewayBotDiscovery) => void) | undefined
  const pending = new Promise<GatewayBotDiscovery>((resolve) => {
    resolveDiscovery = resolve
  })
  const { gateway, sockets } = fixture({
    discovery: async (signal) => {
      discoverySignal = signal
      return pending
    },
  })

  const starting = gateway.start()
  await gateway.stop()
  assert.equal(discoverySignal?.aborted, true)
  resolveDiscovery?.(GATEWAY_DISCOVERY)
  await starting

  assert.deepEqual(sockets, [])
  assert.equal(gateway.getStatus().connection.state, "stopped")
})

test("Gateway resolves exact channel routes with bounded concurrency before opening sockets", async () => {
  const channelIds = [
    CHANNEL_ID,
    SECOND_CHANNEL_ID,
    "300000000000000003",
    "300000000000000004",
    "300000000000000005",
  ]
  const routes = new Map(channelIds.map((channelId) => [channelId, GUILD_ID]))
  const resolvers = new Map<
    string,
    (route: GatewayChannelRoute) => void
  >()
  const calls: string[] = []
  let active = 0
  let maximumActive = 0
  const { gateway, sockets } = shardedFixture({
    channelRoutes: routes,
    routeDiscovery: (channelId, signal) => new Promise((resolve, reject) => {
      calls.push(channelId)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      const onAbort = () => reject(new Error("aborted"))
      signal.addEventListener("abort", onAbort, { once: true })
      resolvers.set(channelId, (route) => {
        signal.removeEventListener("abort", onAbort)
        active -= 1
        resolve(route)
      })
    }),
    shards: 4,
  })

  const starting = gateway.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(gateway.getStatus().connection.state, "resolving-scope")
  assert.deepEqual(calls, channelIds.slice(0, 4))
  assert.equal(maximumActive, 4)
  assert.deepEqual(sockets, [])

  resolvers.get(channelIds[0]!)?.({ channelId: channelIds[0]!, guildId: GUILD_ID })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, channelIds)
  assert.equal(maximumActive, 4)
  assert.deepEqual(sockets, [])
  for (const channelId of channelIds.slice(1)) {
    resolvers.get(channelId)?.({ channelId, guildId: GUILD_ID })
  }
  await starting

  assert.equal(sockets.length, 1)
  assert.deepEqual(gateway.getStatus().discovery.topology, {
    activeShards: 1,
    resolvedChannels: 5,
    scopedGuilds: 1,
  })
  const rendered = JSON.stringify(gateway.getStatus())
  for (const channelId of channelIds) assert.doesNotMatch(rendered, new RegExp(channelId))
  assert.doesNotMatch(rendered, new RegExp(GUILD_ID))
  await gateway.stop()
})

test("Gateway route discovery classifies failures without reflecting private causes", async () => {
  const cases: Array<{
    category: string
    discover: (channelId: string, signal: AbortSignal) => Promise<GatewayChannelRoute>
  }> = [
    {
      category: "gateway-scope-discovery-failed",
      discover: async () => {
        throw new Error(`private ${TOKEN}`)
      },
    },
    {
      category: "invalid-gateway-scope-evidence",
      discover: async () => ({ channelId: SECOND_CHANNEL_ID, guildId: GUILD_ID }),
    },
  ]
  for (const item of cases) {
    const { gateway, logs, sockets } = shardedFixture({
      channelRoutes: new Map([[CHANNEL_ID, GUILD_ID]]),
      routeDiscovery: item.discover,
      shards: 4,
    })
    await gateway.start()
    assert.equal(gateway.getStatus().connection.state, "failed")
    assert.equal(gateway.getStatus().connection.lastError?.category, item.category)
    assert.deepEqual(logs, [`[gateway] stopped: ${item.category}`])
    assert.deepEqual(sockets, [])
    assert.doesNotMatch(JSON.stringify({ logs, status: gateway.getStatus() }), new RegExp(TOKEN))
    await gateway.stop()
  }
})

test("Gateway stop aborts pending route discovery and ignores late evidence", async () => {
  let routeSignal: AbortSignal | undefined
  let resolveRoute: ((route: GatewayChannelRoute) => void) | undefined
  const { gateway, sockets } = shardedFixture({
    channelRoutes: new Map([[CHANNEL_ID, GUILD_ID]]),
    routeDiscovery: (_channelId, signal) => {
      routeSignal = signal
      return new Promise((resolve) => {
        resolveRoute = resolve
      })
    },
    shards: 4,
  })

  const starting = gateway.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(gateway.getStatus().connection.state, "resolving-scope")
  await gateway.stop()
  assert.equal(routeSignal?.aborted, true)
  resolveRoute?.({ channelId: CHANNEL_ID, guildId: GUILD_ID })
  await starting

  assert.deepEqual(sockets, [])
  assert.equal(gateway.getStatus().connection.state, "stopped")
})

test("Gateway rejects insufficient shared session allowance before opening a shard", async () => {
  const guild1 = guildIdForShard(1, 4)
  const guild3 = guildIdForShard(3, 4)
  const { gateway, logs, sockets } = shardedFixture({
    guildIds: [guild1, guild3],
    remaining: 1,
    shards: 4,
  })

  await gateway.start()
  assert.equal(gateway.getStatus().connection.state, "failed")
  assert.equal(
    gateway.getStatus().connection.lastError?.category,
    "session-start-limit-insufficient",
  )
  assert.deepEqual(gateway.getStatus().discovery.topology, {
    activeShards: 2,
    resolvedChannels: 0,
    scopedGuilds: 2,
  })
  const rendered = JSON.stringify(gateway.getStatus())
  assert.doesNotMatch(rendered, new RegExp(guild1))
  assert.doesNotMatch(rendered, new RegExp(guild3))
  assert.doesNotMatch(rendered, /gateway\.discord\.gg|wss:/)
  assert.deepEqual(sockets, [])
  assert.deepEqual(logs, ["[gateway] stopped: session-start-limit-insufficient"])
  await gateway.stop()
})

test("Gateway selects sparse shards, requires complete readiness, and routes dispatches exactly", async () => {
  const guild1 = guildIdForShard(1, 4)
  const guild3 = guildIdForShard(3, 4)
  const { eventStore, gateway, scheduler, sockets } = shardedFixture({
    guildIds: [guild1, guild3],
    maxConcurrency: 4,
    random: 0.5,
    shards: 4,
  })

  await gateway.start()
  assert.equal(sockets.length, 2)
  const shard1 = sockets[0]
  const shard3 = sockets[1]
  assert.ok(shard1)
  assert.ok(shard3)
  hello(shard1)
  hello(shard3)
  assert.deepEqual(
    [payloads(shard1)[0]?.d, payloads(shard3)[0]?.d].map((value) => (
      (value as Record<string, unknown>).shard
    )),
    [[1, 4], [3, 4]],
  )
  assert.deepEqual(gateway.getStatus().discovery.topology, {
    activeShards: 2,
    resolvedChannels: 0,
    scopedGuilds: 2,
  })

  ready(shard1, { shard: [1, 4] })
  assert.equal(gateway.getStatus().connection.state, "authenticating")
  ready(shard3, { shard: [3, 4] })
  assert.equal(gateway.getStatus().connection.state, "ready")

  shard3.message({
    d: {
      channel_id: CHANNEL_ID,
      guild_id: guild3,
      id: MESSAGE_ID,
    },
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  })
  assert.equal(eventStore.listEvents().events[0]?.guildId, guild3)

  shard1.serverClose(1_006)
  assert.equal(gateway.getStatus().connection.state, "reconnecting")
  assert.equal(scheduler.runNext(), 1_000)
  const resumedShard1 = sockets[2]
  assert.ok(resumedShard1)
  hello(resumedShard1)
  assert.equal(payloads(resumedShard1)[0]?.op, 6)
  resumedShard1.message({ d: null, op: 0, s: 2, t: "RESUMED" })
  assert.equal(gateway.getStatus().connection.state, "ready")
  assert.equal(gateway.getStatus().connection.identifies, 2)

  resumedShard1.message({
    d: {
      channel_id: CHANNEL_ID,
      guild_id: guild3,
      id: MESSAGE_ID,
    },
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  })
  assert.equal(gateway.getStatus().connection.state, "failed")
  assert.equal(gateway.getStatus().connection.lastError?.category, "invalid-shard-routing")
  assert.equal(shard3.readyState, 3)
  await gateway.stop()
})

test("Gateway Identify coordination preserves selected order within one concurrency key", async () => {
  const guild0 = guildIdForShard(0, 4)
  const guild2 = guildIdForShard(2, 4)
  const { gateway, scheduler, sockets } = shardedFixture({
    guildIds: [guild0, guild2],
    maxConcurrency: 2,
    random: 1,
    shards: 4,
  })

  await gateway.start()
  const shard0 = sockets[0]
  const shard2 = sockets[1]
  assert.ok(shard0)
  assert.ok(shard2)
  hello(shard2)
  assert.deepEqual(payloads(shard2), [])
  hello(shard0)
  assert.deepEqual((payloads(shard0)[0]?.d as Record<string, unknown>).shard, [0, 4])
  assert.deepEqual(payloads(shard2), [])
  assert.equal(scheduler.runNext(), 5_000)
  assert.deepEqual((payloads(shard2)[0]?.d as Record<string, unknown>).shard, [2, 4])
  assert.equal(gateway.getStatus().connection.identifies, 2)
  await gateway.stop()
})

test("Gateway identifies with fixed nonprivileged intents and exposes no session material", async () => {
  const { gateway, logs, sockets, urls } = fixture()
  await gateway.start()
  assert.deepEqual(urls, [DISCOVERED_GATEWAY_URL])
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)

  const identify = payloads(socket)[0]
  assert.equal(identify?.op, 2)
  assert.equal(
    gateway.getStatus().discovery.sessionStartLimit?.localStartsSinceCheck,
    1,
  )
  const data = identify?.d as Record<string, unknown>
  assert.equal(data.intents, DISCORD_GATEWAY_INTENT_MASK)
  assert.equal((Number(data.intents) & (1 << 24)) !== 0, true)
  assert.equal((Number(data.intents) & (1 << 15)) === 0, true)
  assert.equal((Number(data.intents) & (1 << 1)) === 0, true)
  assert.equal((Number(data.intents) & (1 << 8)) === 0, true)
  assert.equal(Object.hasOwn(data, "capabilities"), false)
  assert.deepEqual(data.properties, {
    browser: "discord-mcp",
    device: "discord-mcp",
    os: process.platform,
  })
  assert.deepEqual(data.shard, [0, 1])
  ready(socket)

  const status = gateway.getStatus()
  assert.equal(status.connection.state, "ready")
  assert.equal(status.connection.identifies, 1)
  assert.equal(status.privacy.privilegedIntentsRequested, false)
  const rendered = JSON.stringify(status)
  assert.doesNotMatch(rendered, new RegExp(TOKEN))
  assert.doesNotMatch(rendered, /private-session-id|gateway-us-east/)
  assert.deepEqual(logs, [])
  await gateway.stop()
})

test("Interaction-only Gateway uses zero intents and routes payloads outside the event feed", async () => {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const handled: unknown[] = []
  const interactionGuildId = guildIdForShard(3, 4)
  const eventStore = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([interactionGuildId]),
    bufferSize: 10,
    clock: () => new Date(scheduler.now),
    cursorNamespace: "interaction1",
    enabled: true,
    eventFeedEnabled: false,
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: new Set([CHANNEL_ID]),
      allowedGuildIds: new Set([interactionGuildId]),
      allowGateway: false,
      allowNativeInteractions: true,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      nativeInteractionGuildIds: new Set([interactionGuildId]),
      token: TOKEN,
    },
    discoverGateway: async () => ({ ...GATEWAY_DISCOVERY, shards: 4 }),
    discoverGatewayChannel,
    eventStore,
    interactionHandler: {
      async ingestInteraction(payload) {
        handled.push(payload)
      },
    },
    random: () => 0,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })

  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  const identify = payloads(socket)[0]
  assert.equal((identify?.d as Record<string, unknown>).intents, 0)
  assert.deepEqual((identify?.d as Record<string, unknown>).shard, [3, 4])
  ready(socket, { shard: [3, 4] })
  const interactionPayload = {
    application_id: APPLICATION_ID,
    guild_id: interactionGuildId,
    id: "500000000000000001",
    token: TOKEN,
    type: 2,
  }
  socket.message({ d: interactionPayload, op: 0, s: 2, t: "INTERACTION_CREATE" })
  socket.message({
    d: {
      channel_id: CHANNEL_ID,
      content: TOKEN,
      guild_id: interactionGuildId,
      id: MESSAGE_ID,
    },
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  })
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.deepEqual(handled, [interactionPayload])
  assert.equal(gateway.getStatus().feedEnabled, false)
  assert.deepEqual(gateway.getStatus().intents, [])
  assert.deepEqual(gateway.listEvents().events, [])
  assert.equal(JSON.stringify(gateway.getStatus()).includes(TOKEN), false)
  await gateway.stop()
})

test("Layout-only Gateway requests only GUILDS and ingests a content-free seed", async () => {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const eventStore = new GatewayEventStore({
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    bufferSize: 10,
    clock: () => new Date(scheduler.now),
    cursorNamespace: "layoutgateway1",
    enabled: true,
    eventFeedEnabled: false,
    layoutGuildIds: new Set([GUILD_ID]),
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: new Set(),
      allowedGuildIds: new Set([GUILD_ID]),
      allowChannelOrderingAudit: true,
      allowGateway: false,
      channelOrderingGuildIds: new Set([GUILD_ID]),
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway,
    discoverGatewayChannel,
    eventStore,
    random: () => 0,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })

  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  const identify = payloads(socket)[0]
  const data = identify?.d as Record<string, unknown>
  assert.equal(data.intents, DISCORD_GATEWAY_INTENTS.guilds)
  assert.equal(Object.hasOwn(data, "capabilities"), false)
  ready(socket)
  socket.message({
    d: {
      channels: [{
        flags: DISCORD_CHANNEL_FLAGS.channelObfuscated,
        id: CHANNEL_ID,
        name: TOKEN,
        parent_id: null,
        position: 0,
        topic: TOKEN,
        type: DISCORD_CHANNEL_TYPES.text,
      }],
      id: GUILD_ID,
    },
    op: 0,
    s: 2,
    t: "GUILD_CREATE",
  })
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "ready")
  assert.equal(gateway.getChannelLayout(GUILD_ID).channels[0]?.obfuscated, true)
  assert.deepEqual(gateway.listEvents().events, [])
  assert.doesNotMatch(JSON.stringify(gateway.getChannelLayout(GUILD_ID)), new RegExp(TOKEN))
  await gateway.stop()
})

test("Voice-status-only Gateway serializes exact guild queries and discards non-target text", async () => {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const statusIds = new Set([CHANNEL_ID, SECOND_CHANNEL_ID])
  const eventStore = new GatewayEventStore({
    allowedChannelIds: statusIds,
    allowedGuildIds: new Set([GUILD_ID]),
    bufferSize: 10,
    clock: () => new Date(scheduler.now),
    cursorNamespace: "voicestatus1",
    enabled: true,
    eventFeedEnabled: false,
    voiceChannelStatusChannelCount: statusIds.size,
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: statusIds,
      allowedGuildIds: new Set([GUILD_ID]),
      allowChannelMetadataChanges: true,
      allowGateway: false,
      channelMetadataIds: statusIds,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway,
    discoverGatewayChannel,
    eventStore,
    random: () => 0,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })

  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  assert.equal(
    ((payloads(socket)[0]?.d as Record<string, unknown>).intents),
    DISCORD_GATEWAY_INTENTS.guilds,
  )
  ready(socket)
  assert.equal(gateway.voiceChannelStatusEnabled, true)
  assert.deepEqual(gateway.getStatus().projections.voiceChannelStatus, {
    enabled: true,
    scopedChannels: 2,
  })

  const first = gateway.getVoiceChannelStatus(GUILD_ID, CHANNEL_ID)
  const second = gateway.getVoiceChannelStatus(GUILD_ID, SECOND_CHANNEL_ID)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(payloads(socket).filter(({ op }) => op === 43), [{
    d: { fields: ["status"], guild_id: GUILD_ID },
    op: 43,
  }])
  socket.message({
    d: {
      channels: [
        { id: CHANNEL_ID, status: "Office hours" },
        { id: SECOND_CHANNEL_ID, status: TOKEN },
      ],
      guild_id: GUILD_ID,
    },
    op: 0,
    s: 2,
    t: "CHANNEL_INFO",
  })
  const firstResult = await first
  assert.equal(firstResult.status, "Office hours")
  assert.doesNotMatch(JSON.stringify(firstResult), new RegExp(TOKEN))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(payloads(socket).filter(({ op }) => op === 43).length, 2)
  socket.message({
    d: {
      channels: [
        { id: CHANNEL_ID, status: TOKEN },
        { id: SECOND_CHANNEL_ID, status: "Planning" },
      ],
      guild_id: GUILD_ID,
    },
    op: 0,
    s: 3,
    t: "CHANNEL_INFO",
  })
  assert.equal((await second).status, "Planning")

  const update = gateway.waitForVoiceChannelStatusUpdate(GUILD_ID, CHANNEL_ID)
  socket.message({
    d: { guild_id: GUILD_ID, id: CHANNEL_ID, status: null },
    op: 0,
    s: 4,
    t: "VOICE_CHANNEL_STATUS_UPDATE",
  })
  assert.equal((await update).status, null)
  assert.deepEqual(gateway.listEvents().events, [])
  assert.throws(
    () => gateway.getVoiceChannelStatus(GUILD_ID, "300000000000000099"),
    /outside the exact Gateway voice channel status scope/,
  )
  assert.throws(
    () => gateway.getVoiceChannelStatus(GUILD_ID, 42 as unknown as string),
    /target IDs must be positive snowflakes/,
  )
  await gateway.stop()
})

test("Gateway routes voice evidence through the exact resolved shard", async () => {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const guild1 = guildIdForShard(1, 4)
  const guild3 = guildIdForShard(3, 4)
  const statusIds = new Set([CHANNEL_ID, SECOND_CHANNEL_ID])
  const routes = new Map([
    [CHANNEL_ID, guild1],
    [SECOND_CHANNEL_ID, guild3],
  ])
  const eventStore = new GatewayEventStore({
    allowedChannelIds: statusIds,
    allowedGuildIds: new Set([guild1, guild3]),
    bufferSize: 10,
    clock: () => new Date(scheduler.now),
    cursorNamespace: "voicerouting1",
    enabled: true,
    eventFeedEnabled: false,
    voiceChannelStatusChannelCount: statusIds.size,
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: statusIds,
      allowedGuildIds: new Set([guild1, guild3]),
      allowChannelMetadataChanges: true,
      allowGateway: false,
      channelMetadataIds: statusIds,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway: async () => ({
      ...GATEWAY_DISCOVERY,
      sessionStartLimit: {
        ...GATEWAY_DISCOVERY.sessionStartLimit,
        maxConcurrency: 4,
      },
      shards: 4,
    }),
    discoverGatewayChannel: async (channelId) => {
      const guildId = routes.get(channelId)
      if (!guildId) throw new Error("Missing test route")
      return { channelId, guildId }
    },
    eventStore,
    random: () => 0,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })

  await gateway.start()
  const shard1 = sockets[0]
  const shard3 = sockets[1]
  assert.ok(shard1)
  assert.ok(shard3)
  hello(shard1)
  hello(shard3)
  ready(shard1, { shard: [1, 4] })
  ready(shard3, { shard: [3, 4] })
  assert.deepEqual(gateway.getStatus().discovery.topology, {
    activeShards: 2,
    resolvedChannels: 2,
    scopedGuilds: 2,
  })

  const evidence = gateway.getVoiceChannelStatus(guild3, SECOND_CHANNEL_ID)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(payloads(shard1).filter(({ op }) => op === 43), [])
  assert.deepEqual(payloads(shard3).filter(({ op }) => op === 43), [{
    d: { fields: ["status"], guild_id: guild3 },
    op: 43,
  }])
  shard3.message({
    d: {
      channels: [{ id: SECOND_CHANNEL_ID, status: "Planning" }],
      guild_id: guild3,
    },
    op: 0,
    s: 2,
    t: "CHANNEL_INFO",
  })
  assert.equal((await evidence).status, "Planning")
  await assert.rejects(
    gateway.getVoiceChannelStatus(guild1, SECOND_CHANNEL_ID),
    /does not match its exact guild route/,
  )
  await gateway.stop()
})

test("Gateway voice status evidence rejects cancellation, timeout, and continuity loss", async () => {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const eventStore = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    clock: () => new Date(scheduler.now),
    cursorNamespace: "voicestatus2",
    enabled: true,
    eventFeedEnabled: false,
    voiceChannelStatusChannelCount: 1,
  })
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: new Set([CHANNEL_ID]),
      allowedGuildIds: new Set([GUILD_ID]),
      allowChannelMetadataChanges: true,
      allowGateway: false,
      channelMetadataIds: new Set([CHANNEL_ID]),
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
    discoverGateway,
    discoverGatewayChannel,
    eventStore,
    random: () => 0,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)

  const controller = new AbortController()
  const cancelled = gateway.getVoiceChannelStatus(GUILD_ID, CHANNEL_ID, {
    signal: controller.signal,
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(cancelled, /was cancelled/)

  const timedOut = gateway.getVoiceChannelStatus(GUILD_ID, CHANNEL_ID)
  await new Promise<void>((resolve) => setImmediate(resolve))
  scheduler.runNext()
  socket.message({ d: null, op: 11, s: null, t: null })
  assert.equal(scheduler.runNext(), 10_000)
  await assert.rejects(timedOut, /timed out/)

  const disconnected = gateway.getVoiceChannelStatus(GUILD_ID, CHANNEL_ID)
  await new Promise<void>((resolve) => setImmediate(resolve))
  socket.serverClose(1_006)
  await assert.rejects(disconnected, /continuity changed/)
  await gateway.stop()
})

test("Gateway layout scope unions every enabled channel-completeness feature", async () => {
  const scheduler = new FakeScheduler()
  const sockets: FakeSocket[] = []
  const layoutGuildIds = [
    GUILD_ID,
    CLONE_GUILD_ID,
    ORDERING_GUILD_ID,
    MEMBER_ROLE_GUILD_ID,
    ONBOARDING_GUILD_ID,
    SETTINGS_GUILD_ID,
    TEMPLATE_GUILD_ID,
  ]
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    clock: () => scheduler.now,
    config: {
      allowedChannelIds: new Set(),
      allowedGuildIds: new Set([GUILD_ID]),
      allowChannelCloneAudit: true,
      allowChannelOrderingAudit: true,
      allowGateway: true,
      allowGuildSettingsAudit: true,
      allowGuildTemplateAudit: true,
      allowMemberRoleChanges: true,
      allowOnboardingAudit: true,
      channelCloneGuildIds: new Set([CLONE_GUILD_ID]),
      channelOrderingGuildIds: new Set([ORDERING_GUILD_ID]),
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      guildSettingsGuildIds: new Set([SETTINGS_GUILD_ID]),
      guildTemplateGuildIds: new Set([TEMPLATE_GUILD_ID]),
      memberRoleGuildIds: new Set([MEMBER_ROLE_GUILD_ID]),
      onboardingGuildIds: new Set([ONBOARDING_GUILD_ID]),
      token: TOKEN,
    },
    discoverGateway: async () => ({
      ...GATEWAY_DISCOVERY,
      sessionStartLimit: {
        ...GATEWAY_DISCOVERY.sessionStartLimit,
        maxConcurrency: 8,
      },
      shards: 8,
    }),
    discoverGatewayChannel,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })

  assert.equal(gateway.getChannelLayoutStatus().guilds.scoped, 7)
  assert.equal(gateway.getChannelLayout(CLONE_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(ORDERING_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(MEMBER_ROLE_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(ONBOARDING_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(SETTINGS_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(TEMPLATE_GUILD_ID).state, "pending")
  await gateway.start()
  const activeShardCount = new Set(
    layoutGuildIds.map((guildId) => calculateGatewayShardId(guildId, 8)),
  ).size
  assert.deepEqual(gateway.getStatus().discovery.topology, {
    activeShards: activeShardCount,
    resolvedChannels: 0,
    scopedGuilds: layoutGuildIds.length,
  })
  assert.equal(sockets.length, activeShardCount)
  await gateway.stop()
})

test("Gateway accepts events only after READY identity validation and drops content", async () => {
  const { gateway, sockets } = fixture()
  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  socket.message({
    d: {
      channel_id: CHANNEL_ID,
      content: TOKEN,
      guild_id: GUILD_ID,
      id: MESSAGE_ID,
    },
    op: 0,
    s: 1,
    t: "MESSAGE_CREATE",
  })
  assert.equal(gateway.listEvents().events.length, 0)
  ready(socket)
  socket.message({
    d: {
      author: { username: TOKEN },
      channel_id: CHANNEL_ID,
      content: TOKEN,
      guild_id: GUILD_ID,
      id: MESSAGE_ID,
    },
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  })

  assert.deepEqual(gateway.listEvents().events[0], {
    channelId: CHANNEL_ID,
    cursor: "gw1.gatewaytest1.0.1",
    guildId: GUILD_ID,
    kind: "message-created",
    messageId: MESSAGE_ID,
    receivedAt: "1970-01-01T00:00:00.000Z",
  })
  assert.doesNotMatch(JSON.stringify(gateway.listEvents()), new RegExp(TOKEN))
  await gateway.stop()
})

test("Gateway heartbeats with the latest sequence and reconnects on a missing ACK", async () => {
  const { gateway, scheduler, sockets } = fixture()
  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)

  assert.equal(scheduler.runNext(), 0)
  assert.deepEqual(payloads(socket).at(-1), { d: 1, op: 1 })
  assert.equal(scheduler.runNext(), 45_000)
  assert.equal(gateway.getStatus().connection.state, "reconnecting")
  assert.equal(gateway.getStatus().connection.lastError?.category, "heartbeat-timeout")
  assert.equal(scheduler.runNext(), 45_800)
  assert.equal(sockets.length, 2)
  await gateway.stop()
})

test("Gateway heartbeat ACKs keep the connection alive", async () => {
  const { gateway, scheduler, sockets } = fixture()
  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)

  scheduler.runNext()
  socket.message({ d: null, op: 11, s: null, t: null })
  scheduler.runNext()
  assert.equal(payloads(socket).filter((payload) => payload.op === 1).length, 2)
  assert.equal(gateway.getStatus().connection.state, "ready")
  await gateway.stop()
})

test("Gateway reconnects after bounded connection and authentication deadlines", async () => {
  const discoveredUrl = "wss://gateway-eu-west.discord.gg/?v=10&encoding=json"
  const connecting = fixture({
    discovery: async () => ({ ...GATEWAY_DISCOVERY, url: discoveredUrl }),
  })
  await connecting.gateway.start()
  assert.deepEqual(connecting.urls, [discoveredUrl])
  assert.equal(connecting.scheduler.runNext(), 30_000)
  assert.equal(connecting.gateway.getStatus().connection.state, "reconnecting")
  assert.equal(
    connecting.gateway.getStatus().connection.lastError?.category,
    "connection-timeout",
  )
  assert.equal(connecting.scheduler.runNext(), 30_800)
  assert.deepEqual(connecting.urls, [discoveredUrl, discoveredUrl])

  const authenticating = fixture({ random: 1 })
  await authenticating.gateway.start()
  const socket = authenticating.sockets[0]
  assert.ok(socket)
  hello(socket)
  assert.equal(authenticating.scheduler.runNext(), 30_000)
  assert.equal(authenticating.gateway.getStatus().connection.state, "reconnecting")
  assert.equal(
    authenticating.gateway.getStatus().connection.lastError?.category,
    "authentication-timeout",
  )

  await connecting.gateway.stop()
  await authenticating.gateway.stop()
})

test("Gateway resumes with only vetted Discord origins", async () => {
  const { gateway, scheduler, sockets, urls } = fixture()
  await gateway.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first)
  ready(first)
  first.message({
    d: {
      channels: [{
        flags: DISCORD_CHANNEL_FLAGS.channelObfuscated,
        id: CHANNEL_ID,
        parent_id: null,
        position: 0,
        type: DISCORD_CHANNEL_TYPES.text,
      }],
      id: GUILD_ID,
    },
    op: 0,
    s: 2,
    t: "GUILD_CREATE",
  })
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "ready")
  first.serverClose(1_006)
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "resuming")
  assert.equal(gateway.getChannelLayout(GUILD_ID).complete, false)
  assert.deepEqual(gateway.getChannelLayout(GUILD_ID).channels, [])
  assert.equal(gateway.getStatus().layout.channels.retained, 1)
  assert.equal(gateway.getStatus().layout.guilds.resuming, 1)

  assert.equal(scheduler.runNext(), 800)
  const second = sockets[1]
  assert.ok(second)
  assert.equal(urls[1], "wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json")
  hello(second)
  const resume = payloads(second)[0]
  assert.equal(resume?.op, 6)
  assert.deepEqual(resume?.d, {
    seq: 2,
    session_id: "private-session-id",
    token: TOKEN,
  })
  second.message({
    d: {
      flags: 0,
      guild_id: GUILD_ID,
      id: CHANNEL_ID,
      parent_id: null,
      position: 2,
      type: DISCORD_CHANNEL_TYPES.text,
    },
    op: 0,
    s: 3,
    t: "CHANNEL_UPDATE",
  })
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "resuming")
  assert.deepEqual(gateway.getChannelLayout(GUILD_ID).channels, [])
  second.message({
    d: {
      channel_id: CHANNEL_ID,
      guild_id: GUILD_ID,
      id: MESSAGE_ID,
    },
    op: 0,
    s: 4,
    t: "MESSAGE_DELETE",
  })
  second.message({ d: {}, op: 0, s: 5, t: "RESUMED" })
  assert.equal(gateway.getStatus().connection.state, "ready")
  assert.equal(gateway.getStatus().connection.identifies, 1)
  assert.equal(gateway.getStatus().connection.resumes, 1)
  assert.equal(gateway.getStatus().buffer.continuityGaps, 0)
  assert.equal(gateway.listEvents().events.at(-1)?.messageId, MESSAGE_ID)
  const layout = gateway.getChannelLayout(GUILD_ID)
  assert.equal(layout.state, "ready")
  assert.equal(layout.revision, 4)
  assert.equal(layout.channels[0]?.position, 2)
  await gateway.stop()
})

test("Gateway rejects READY during Resume instead of hiding a continuity gap", async () => {
  const { gateway, scheduler, sockets } = fixture()
  await gateway.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first)
  ready(first)
  first.serverClose(1_006)

  scheduler.runNext()
  const second = sockets[1]
  assert.ok(second)
  hello(second)
  ready(second)

  assert.equal(gateway.getStatus().connection.state, "failed")
  assert.equal(gateway.getStatus().connection.lastError?.category, "protocol-error")
  assert.equal(gateway.getStatus().buffer.continuityGaps, 1)
  await gateway.stop()
})

test("Gateway invalid sessions re-identify only after Discord's delay and local spacing", async () => {
  const { gateway, scheduler, sockets, urls } = fixture()
  await gateway.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first)
  ready(first)
  first.message({
    d: {
      channels: [{
        id: CHANNEL_ID,
        parent_id: null,
        position: 0,
        type: DISCORD_CHANNEL_TYPES.text,
      }],
      id: GUILD_ID,
    },
    op: 0,
    s: 2,
    t: "GUILD_CREATE",
  })
  first.message({ d: false, op: 9, s: null, t: null })
  assert.equal(gateway.getStatus().buffer.continuityGaps, 1)
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "invalidated")
  assert.equal(gateway.getChannelLayout(GUILD_ID).reason, "connection-gap")

  assert.equal(scheduler.runNext(), 1_000)
  const second = sockets[1]
  assert.ok(second)
  assert.equal(urls[1], DISCOVERED_GATEWAY_URL)
  hello(second)
  assert.equal(scheduler.runNext(), 1_000)
  assert.deepEqual(payloads(second)[0], { d: null, op: 1 })
  second.message({ d: null, op: 11, s: null, t: null })
  assert.equal(scheduler.runNext(), 5_000)
  assert.equal(payloads(second)[1]?.op, 2)
  assert.equal(gateway.getStatus().connection.identifies, 2)
  await gateway.stop()
})

test("Gateway never exceeds the discovered remaining fresh-session budget", async () => {
  const { gateway, scheduler, sockets } = fixture({
    discovery: async () => ({
      ...GATEWAY_DISCOVERY,
      sessionStartLimit: {
        ...GATEWAY_DISCOVERY.sessionStartLimit,
        remaining: 1,
      },
    }),
    random: 1,
  })
  await gateway.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first)
  assert.equal(gateway.getStatus().connection.identifies, 1)

  first.message({ d: false, op: 9, s: null, t: null })
  assert.equal(scheduler.runNext(), 5_000)
  const second = sockets[1]
  assert.ok(second)
  hello(second)

  assert.equal(gateway.getStatus().connection.identifies, 1)
  assert.equal(
    gateway.getStatus().discovery.sessionStartLimit?.localStartsSinceCheck,
    1,
  )
  assert.equal(gateway.getStatus().connection.state, "failed")
  assert.equal(
    gateway.getStatus().connection.lastError?.category,
    "session-start-limit-exhausted",
  )
  await gateway.stop()
})

test("Gateway rejects wrong READY identities and untrusted resume origins", async () => {
  for (const [overrides, category] of [
    [{ application: { id: "100000000000000099" } }, "invalid-ready-identity"],
    [{ user: { bot: true, id: "100000000000000099" } }, "invalid-ready-identity"],
    [{ user: { bot: false, id: BOT_ID } }, "invalid-ready-identity"],
    [{ user: { bot: true, id: "not-a-snowflake" } }, "invalid-ready-identity"],
    [{ resume_gateway_url: "wss://gateway.discord.gg.evil.example" }, "invalid-resume-origin"],
  ] as const) {
    const { gateway, logs, scheduler, sockets } = fixture()
    await gateway.start()
    const socket = sockets[0]
    assert.ok(socket)
    hello(socket)
    ready(socket, overrides)
    assert.equal(gateway.getStatus().connection.state, "failed")
    assert.equal(gateway.getStatus().connection.lastError?.category, category)
    assert.equal(scheduler.jobs.size, 0)
    assert.deepEqual(logs, [`[gateway] stopped: ${category}`])
    assert.doesNotMatch(JSON.stringify({ logs, status: gateway.getStatus() }), new RegExp(TOKEN))
    await gateway.stop()
  }
})

test("Gateway fatal close codes stop reconnect loops while recoverable codes back off", async () => {
  const fatal = fixture()
  await fatal.gateway.start()
  const fatalSocket = fatal.sockets[0]
  assert.ok(fatalSocket)
  fatalSocket.serverClose(4_014)
  assert.equal(fatal.gateway.getStatus().connection.state, "failed")
  assert.equal(fatal.gateway.getStatus().connection.lastError?.category, "disallowed-intents")
  assert.equal(fatal.scheduler.jobs.size, 0)

  const recoverable = fixture()
  await recoverable.gateway.start()
  const recoverableSocket = recoverable.sockets[0]
  assert.ok(recoverableSocket)
  recoverableSocket.serverClose(4_008)
  assert.equal(recoverable.gateway.getStatus().connection.state, "reconnecting")
  assert.equal(recoverable.gateway.getStatus().connection.lastError?.category, "rate-limited")
  assert.equal(recoverable.scheduler.runNext(), 800)
  assert.equal(recoverable.sockets.length, 2)

  await fatal.gateway.stop()
  await recoverable.gateway.stop()
})

test("Gateway Identify budget terminates repeated invalid-session loops", async () => {
  const { gateway, scheduler, sockets } = fixture({ random: 1 })
  await gateway.start()
  let socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  for (let identify = 1; identify <= 10; identify += 1) {
    assert.equal(payloads(socket).at(-1)?.op, 2)
    socket.message({ d: false, op: 9, s: null, t: null })
    assert.equal(scheduler.runNext(), identify * 5_000)
    socket = sockets[identify]
    assert.ok(socket)
    hello(socket)
  }

  assert.equal(gateway.getStatus().connection.identifies, 10)
  assert.equal(gateway.getStatus().connection.state, "failed")
  assert.equal(
    gateway.getStatus().connection.lastError?.category,
    "identify-budget-exhausted",
  )
  assert.equal(scheduler.jobs.size, 0)
  await gateway.stop()
})

test("Gateway rejects malformed or oversized payloads without reflecting them", async () => {
  for (const value of ["not-json", "x".repeat(1_048_577)]) {
    const { gateway, logs, scheduler, sockets } = fixture()
    await gateway.start()
    const socket = sockets[0]
    assert.ok(socket)
    socket.open()
    socket.rawMessage(value)
    assert.equal(gateway.getStatus().connection.state, "failed")
    assert.equal(gateway.getStatus().connection.lastError?.category, "invalid-gateway-payload")
    assert.equal(scheduler.jobs.size, 0)
    assert.deepEqual(logs, ["[gateway] stopped: invalid-gateway-payload"])
    await gateway.stop()
  }
})

test("Gateway stop closes the socket, cancels timers, and prevents reconnection", async () => {
  const { gateway, scheduler, sockets } = fixture()
  await gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)
  await gateway.stop()

  assert.equal(gateway.getStatus().connection.state, "stopped")
  assert.equal(scheduler.jobs.size, 0)
  assert.equal(sockets.length, 1)

  await gateway.start()
  const restarted = sockets[1]
  assert.ok(restarted)
  hello(restarted)
  assert.deepEqual(payloads(restarted).map((payload) => payload.op), [2])
  await gateway.stop()
})

test("Gateway resume URL validation accepts only credential-free Discord WSS hosts", () => {
  assert.equal(
    normalizeGatewayResumeUrl("wss://gateway.discord.gg/custom?bad=true"),
    "wss://gateway.discord.gg/?v=10&encoding=json",
  )
  assert.equal(
    normalizeGatewayResumeUrl("wss://gateway-eu-west.discord.gg"),
    "wss://gateway-eu-west.discord.gg/?v=10&encoding=json",
  )
  for (const value of [
    "https://gateway.discord.gg",
    "wss://token@gateway.discord.gg",
    "wss://gateway.discord.gg:444",
    "wss://api.discord.gg",
    "wss://discord.gg.evil.example",
    "wss://notgateway.discord.gg",
    "not-a-url",
  ]) {
    assert.equal(normalizeGatewayResumeUrl(value), undefined)
  }
})
