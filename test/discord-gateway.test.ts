import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_GATEWAY_INTENT_MASK,
  DISCORD_GATEWAY_INTENTS,
  DISCORD_GATEWAY_URL,
} from "../src/constants.js"
import {
  DiscordGateway,
  normalizeGatewayResumeUrl,
  type GatewayScheduler,
  type GatewaySocket,
} from "../src/discord-gateway.js"
import { GatewayEventStore } from "../src/gateway-events.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "100000000000000002"
const GUILD_ID = "200000000000000001"
const ORDERING_GUILD_ID = "200000000000000002"
const MEMBER_ROLE_GUILD_ID = "200000000000000003"
const ONBOARDING_GUILD_ID = "200000000000000004"
const TEMPLATE_GUILD_ID = "200000000000000005"
const CHANNEL_ID = "300000000000000001"
const MESSAGE_ID = "400000000000000001"
const TOKEN = "test-discord-token"

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

function fixture(options: { random?: number } = {}) {
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
      user: { bot: true, id: BOT_ID },
      ...overrides,
    },
    op: 0,
    s: 1,
    t: "READY",
  })
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
  })
  assert.equal(channelOnlyGateway.enabled, true)
  assert.equal(channelOnlyGateway.getStatus().feedEnabled, true)
  assert.equal(channelOnlyGateway.layoutEnabled, false)
})

test("Gateway identifies with fixed nonprivileged intents and exposes no session material", async () => {
  const { gateway, logs, sockets, urls } = fixture()
  gateway.start()
  assert.deepEqual(urls, [DISCORD_GATEWAY_URL])
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)

  const identify = payloads(socket)[0]
  assert.equal(identify?.op, 2)
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
  const eventStore = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
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
      allowedGuildIds: new Set([GUILD_ID]),
      allowGateway: false,
      allowNativeInteractions: true,
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      token: TOKEN,
    },
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

  gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  const identify = payloads(socket)[0]
  assert.equal((identify?.d as Record<string, unknown>).intents, 0)
  ready(socket)
  const interactionPayload = {
    application_id: APPLICATION_ID,
    id: "500000000000000001",
    token: TOKEN,
    type: 2,
  }
  socket.message({ d: interactionPayload, op: 0, s: 2, t: "INTERACTION_CREATE" })
  socket.message({
    d: {
      channel_id: CHANNEL_ID,
      content: TOKEN,
      guild_id: GUILD_ID,
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
    eventStore,
    random: () => 0,
    scheduler,
    webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })

  gateway.start()
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

test("Gateway layout scope unions every enabled channel-completeness feature", () => {
  const gateway = new DiscordGateway({
    applicationId: APPLICATION_ID,
    config: {
      allowedChannelIds: new Set(),
      allowedGuildIds: new Set([GUILD_ID]),
      allowChannelOrderingAudit: true,
      allowGateway: true,
      allowGuildTemplateAudit: true,
      allowMemberRoleChanges: true,
      allowOnboardingAudit: true,
      channelOrderingGuildIds: new Set([ORDERING_GUILD_ID]),
      expectedBotId: BOT_ID,
      gatewayEventBufferSize: 10,
      guildTemplateGuildIds: new Set([TEMPLATE_GUILD_ID]),
      memberRoleGuildIds: new Set([MEMBER_ROLE_GUILD_ID]),
      onboardingGuildIds: new Set([ONBOARDING_GUILD_ID]),
      token: TOKEN,
    },
  })

  assert.equal(gateway.getChannelLayoutStatus().guilds.scoped, 5)
  assert.equal(gateway.getChannelLayout(GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(ORDERING_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(MEMBER_ROLE_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(ONBOARDING_GUILD_ID).state, "pending")
  assert.equal(gateway.getChannelLayout(TEMPLATE_GUILD_ID).state, "pending")
})

test("Gateway accepts events only after READY identity validation and drops content", async () => {
  const { gateway, sockets } = fixture()
  gateway.start()
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
  gateway.start()
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
  gateway.start()
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
  const connecting = fixture()
  connecting.gateway.start()
  assert.equal(connecting.scheduler.runNext(), 30_000)
  assert.equal(connecting.gateway.getStatus().connection.state, "reconnecting")
  assert.equal(
    connecting.gateway.getStatus().connection.lastError?.category,
    "connection-timeout",
  )

  const authenticating = fixture({ random: 1 })
  authenticating.gateway.start()
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
  gateway.start()
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
  gateway.start()
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
  gateway.start()
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
  assert.equal(urls[1], DISCORD_GATEWAY_URL)
  hello(second)
  assert.equal(scheduler.runNext(), 1_000)
  assert.deepEqual(payloads(second)[0], { d: null, op: 1 })
  second.message({ d: null, op: 11, s: null, t: null })
  assert.equal(scheduler.runNext(), 5_000)
  assert.equal(payloads(second)[1]?.op, 2)
  assert.equal(gateway.getStatus().connection.identifies, 2)
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
    gateway.start()
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
  fatal.gateway.start()
  const fatalSocket = fatal.sockets[0]
  assert.ok(fatalSocket)
  fatalSocket.serverClose(4_014)
  assert.equal(fatal.gateway.getStatus().connection.state, "failed")
  assert.equal(fatal.gateway.getStatus().connection.lastError?.category, "disallowed-intents")
  assert.equal(fatal.scheduler.jobs.size, 0)

  const recoverable = fixture()
  recoverable.gateway.start()
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
  gateway.start()
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
    gateway.start()
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
  gateway.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)
  await gateway.stop()

  assert.equal(gateway.getStatus().connection.state, "stopped")
  assert.equal(scheduler.jobs.size, 0)
  assert.equal(sockets.length, 1)

  gateway.start()
  const restarted = sockets[1]
  assert.ok(restarted)
  hello(restarted)
  assert.deepEqual(payloads(restarted), [])
  scheduler.runNext()
  scheduler.runNext()
  assert.deepEqual(payloads(restarted).map((payload) => payload.op), [1, 2])
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
