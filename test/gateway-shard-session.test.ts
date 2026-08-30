import assert from "node:assert/strict"
import test from "node:test"

import { GATEWAY_DEFAULTS } from "../src/constants.js"
import { GatewayIdentifyCoordinator } from "../src/gateway-identify-coordinator.js"
import {
  GatewayShardSession,
  type GatewayScheduler,
  type GatewayShardDispatch,
  type GatewayShardState,
  type GatewaySocket,
} from "../src/gateway-shard-session.js"
import type { GatewayErrorCategory } from "../src/gateway-events.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "100000000000000002"
const TOKEN = "test-discord-token"
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"

class FakeScheduler implements GatewayScheduler {
  #nextId = 1
  readonly jobs = new Map<number, { due: number; handler: () => void }>()
  now = 0

  clearTimeout(handle: unknown): void {
    this.jobs.delete(handle as number)
  }

  setTimeout(handler: () => void, milliseconds: number): unknown {
    const id = this.#nextId
    this.#nextId += 1
    this.jobs.set(id, { due: this.now + milliseconds, handler })
    return id
  }

  runNext(): number | undefined {
    const next = [...this.jobs].sort((left, right) => (
      left[1].due - right[1].due || left[0] - right[0]
    ))[0]
    if (!next) return undefined
    const [id, job] = next
    this.jobs.delete(id)
    const delay = job.due - this.now
    this.now = job.due
    job.handler()
    return delay
  }
}

class FakeSocket implements GatewaySocket {
  readonly closed: Array<{ code?: number; reason?: string }> = []
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  readonly sent: string[] = []

  close(code?: number, reason?: string): void {
    this.closed.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    })
    this.readyState = 3
    this.onclose?.({ code: code ?? 1_006 })
  }

  message(value: unknown): void {
    this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) })
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  send(data: string): void {
    this.sent.push(data)
  }

  serverClose(code: number): void {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

function payloads(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent.map((value) => JSON.parse(value) as Record<string, unknown>)
}

function fixture(options: {
  maxConcurrency?: number
  random?: number
  remaining?: number
  shardCount?: number
  shardId?: number
  shardIds?: readonly number[]
  token?: string
} = {}) {
  const actorScheduler = new FakeScheduler()
  const identifyScheduler = new FakeScheduler()
  const continuityGaps: number[] = []
  const dispatches: GatewayShardDispatch[] = []
  const failures: GatewayErrorCategory[] = []
  const identifies: number[] = []
  const reconnects: number[] = []
  const resumes: number[] = []
  const sockets: FakeSocket[] = []
  const states: Array<{ category?: GatewayErrorCategory; state: GatewayShardState }> = []
  const urls: string[] = []
  const shardId = options.shardId ?? 0
  const shardCount = options.shardCount ?? 1
  const coordinator = new GatewayIdentifyCoordinator({
    clock: () => identifyScheduler.now,
    maxConcurrency: options.maxConcurrency ?? 1,
    onFailure(category) {
      failures.push(category)
    },
    onIdentify() {
      identifies.push(identifyScheduler.now)
    },
    remaining: options.remaining ?? 100,
    scheduler: identifyScheduler,
    shardCount,
    shardIds: options.shardIds ?? [shardId],
  })
  const session = new GatewayShardSession({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    clock: () => actorScheduler.now,
    gatewayUrl: GATEWAY_URL,
    identifyCoordinator: coordinator,
    intents: 1,
    onContinuityGap(id) {
      continuityGaps.push(id)
    },
    onDispatch(dispatch) {
      dispatches.push(dispatch)
    },
    onFatal(_id, category) {
      failures.push(category)
    },
    onReconnect(id) {
      reconnects.push(id)
    },
    onResume(id) {
      resumes.push(id)
    },
    onState(_id, state, category) {
      states.push({ state, ...(category ? { category } : {}) })
    },
    random: () => options.random ?? 1,
    scheduler: actorScheduler,
    shardCount,
    shardId,
    token: options.token ?? TOKEN,
    webSocketFactory(url) {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  return {
    actorScheduler,
    continuityGaps,
    coordinator,
    dispatches,
    failures,
    identifies,
    identifyScheduler,
    reconnects,
    resumes,
    session,
    sockets,
    states,
    urls,
  }
}

function hello(socket: FakeSocket, heartbeatInterval = 45_000): void {
  socket.open()
  socket.message({ d: { heartbeat_interval: heartbeatInterval }, op: 10 })
}

function ready(
  socket: FakeSocket,
  options: {
    sequence?: number
    sessionId?: string
    shardCount?: number
    shardId?: number
  } = {},
): void {
  socket.message({
    d: {
      application: { id: APPLICATION_ID },
      resume_gateway_url: "wss://gateway-us-east1-b.discord.gg/",
      session_id: options.sessionId ?? "gateway-session",
      shard: [options.shardId ?? 0, options.shardCount ?? 1],
      user: { bot: true, id: BOT_ID },
    },
    op: 0,
    s: options.sequence ?? 1,
    t: "READY",
  })
}

test("Gateway shard sends and verifies its exact Identify shard pair", () => {
  const { failures, identifies, session, sockets, states, urls } = fixture({
    maxConcurrency: 4,
    shardCount: 4,
    shardId: 2,
    shardIds: [2],
  })
  session.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)

  const identify = payloads(socket)[0]
  assert.equal(identify?.op, 2)
  assert.deepEqual((identify?.d as Record<string, unknown>).shard, [2, 4])
  assert.equal((identify?.d as Record<string, unknown>).token, TOKEN)
  assert.deepEqual(identifies, [0])

  ready(socket, { shardCount: 4, shardId: 2 })
  assert.equal(session.state, "ready")
  assert.deepEqual(failures, [])
  assert.deepEqual(urls, [GATEWAY_URL])
  assert.deepEqual(states.map((value) => value.state), [
    "connecting",
    "authenticating",
    "ready",
  ])
})

test("Gateway shard rejects missing and mismatched Ready shard evidence", () => {
  for (const shard of [undefined, [1, 2], [0, 3], [0], [0, "2"]]) {
    const { failures, session, sockets } = fixture({ shardCount: 2, shardIds: [0] })
    session.start()
    const socket = sockets[0]
    assert.ok(socket)
    hello(socket)
    const data: Record<string, unknown> = {
      application: { id: APPLICATION_ID },
      resume_gateway_url: "wss://gateway.discord.gg/",
      session_id: "gateway-session",
      user: { bot: true, id: BOT_ID },
    }
    if (shard !== undefined) data.shard = shard
    socket.message({ d: data, op: 0, s: 1, t: "READY" })

    assert.equal(session.state, "failed")
    assert.deepEqual(failures, ["invalid-ready-shard"])
  }
})

test("Gateway shards keep independent sessions, sequences, and resume URLs", () => {
  const actorScheduler = new FakeScheduler()
  const identifyScheduler = new FakeScheduler()
  const coordinator = new GatewayIdentifyCoordinator({
    clock: () => identifyScheduler.now,
    maxConcurrency: 2,
    onFailure() {},
    remaining: 10,
    scheduler: identifyScheduler,
    shardCount: 2,
    shardIds: [0, 1],
  })
  const sockets = new Map<number, FakeSocket[]>()
  const create = (shardId: number) => new GatewayShardSession({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    clock: () => actorScheduler.now,
    gatewayUrl: GATEWAY_URL,
    identifyCoordinator: coordinator,
    intents: 1,
    onContinuityGap() {},
    onDispatch() {},
    onFatal() {},
    onReconnect() {},
    onResume() {},
    onState() {},
    random: () => 1,
    scheduler: actorScheduler,
    shardCount: 2,
    shardId,
    token: TOKEN,
    webSocketFactory() {
      const socket = new FakeSocket()
      const values = sockets.get(shardId) || []
      values.push(socket)
      sockets.set(shardId, values)
      return socket
    },
  })
  const first = create(0)
  const second = create(1)
  first.start()
  second.start()
  const firstSocket = sockets.get(0)?.[0]
  const secondSocket = sockets.get(1)?.[0]
  assert.ok(firstSocket)
  assert.ok(secondSocket)
  hello(firstSocket)
  hello(secondSocket)
  ready(firstSocket, { sequence: 10, sessionId: "session-zero", shardCount: 2, shardId: 0 })
  ready(secondSocket, { sequence: 20, sessionId: "session-one", shardCount: 2, shardId: 1 })

  firstSocket.serverClose(1_006)
  assert.equal(actorScheduler.runNext(), 1_200)
  const resumed = sockets.get(0)?.[1]
  assert.ok(resumed)
  hello(resumed)
  assert.deepEqual(payloads(resumed)[0], {
    d: { seq: 10, session_id: "session-zero", token: TOKEN },
    op: 6,
  })
  assert.equal(sockets.get(1)?.length, 1)
})

test("Gateway shard resumes replayed dispatches without another Identify", () => {
  const { actorScheduler, dispatches, identifies, resumes, session, sockets } = fixture()
  session.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first)
  ready(first, { sequence: 4 })
  first.serverClose(1_006)
  assert.equal(actorScheduler.runNext(), 1_200)
  const second = sockets[1]
  assert.ok(second)
  hello(second)
  second.message({ d: { guild_id: "200000000000000001" }, op: 0, s: 5, t: "GUILD_UPDATE" })
  second.message({ d: {}, op: 0, s: 6, t: "RESUMED" })

  assert.equal(session.state, "ready")
  assert.deepEqual(identifies, [0])
  assert.deepEqual(resumes, [0])
  assert.deepEqual(dispatches.map((value) => value.sequence), [5])
})

test("Gateway shard re-identification waits for the shared coordinator", () => {
  const {
    actorScheduler,
    continuityGaps,
    identifies,
    identifyScheduler,
    session,
    sockets,
  } = fixture({ random: 1 })
  session.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first)
  ready(first)
  first.message({ d: false, op: 9, s: null, t: null })

  assert.equal(actorScheduler.runNext(), 5_000)
  const second = sockets[1]
  assert.ok(second)
  hello(second)
  assert.equal(payloads(second).length, 0)
  assert.equal(identifyScheduler.runNext(), GATEWAY_DEFAULTS.identifyMinimumIntervalMs)
  assert.equal(payloads(second)[0]?.op, 2)
  assert.deepEqual(identifies, [0, 5_000])
  assert.deepEqual(continuityGaps, [0])
})

test("Gateway shard heartbeats, reconnects on a missing ACK, and stops cleanly", () => {
  const { actorScheduler, reconnects, session, sockets } = fixture({ random: 0 })
  session.start()
  const first = sockets[0]
  assert.ok(first)
  hello(first, 30_000)
  assert.equal(actorScheduler.runNext(), 0)
  assert.deepEqual(payloads(first).at(-1), { d: null, op: 1 })
  assert.equal(actorScheduler.runNext(), 30_000)
  assert.equal(reconnects.length, 1)

  session.stop()
  assert.equal(session.state, "stopped")
  assert.equal(actorScheduler.jobs.size, 0)
  const socketCount = sockets.length
  first.serverClose(1_006)
  assert.equal(sockets.length, socketCount)
})

test("Gateway shard reserves caller pressure for control traffic and times out its FIFO", async () => {
  const { actorScheduler, session, sockets } = fixture()
  session.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)

  for (let index = 1; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
    assert.equal(await session.sendCommand({ d: { index }, op: 43 }), "sent")
  }
  const queued = session.sendCommand({ d: { marker: "queued" }, op: 43 })
  assert.equal(
    payloads(socket).filter(({ op }) => op === 43).length,
    GATEWAY_DEFAULTS.outboundCommandAdmissionLimit - 1,
  )

  socket.message({ d: null, op: 1 })
  assert.equal(payloads(socket).at(-1)?.op, 1)
  socket.message({ d: null, op: 11 })
  assert.equal(actorScheduler.runNext(), GATEWAY_DEFAULTS.outboundCommandQueueTimeoutMs)
  assert.equal(await queued, "queue-timeout")
  assert.equal(
    payloads(socket).filter(({ op }) => op === 43).length,
    GATEWAY_DEFAULTS.outboundCommandAdmissionLimit - 1,
  )
})

test("Gateway shard cancels queued commands on disconnect and stop", async () => {
  for (const action of ["disconnect", "stop"] as const) {
    const { session, sockets } = fixture()
    session.start()
    const socket = sockets[0]
    assert.ok(socket)
    hello(socket)
    ready(socket)
    for (let index = 1; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
      assert.equal(await session.sendCommand({ d: { index }, op: 43 }), "sent")
    }
    const queued = session.sendCommand({ d: { marker: action }, op: 43 })
    if (action === "disconnect") socket.serverClose(1_006)
    else session.stop()
    assert.equal(await queued, "unavailable")
  }
})

test("Gateway shard reconnects before control traffic crosses the absolute budget", () => {
  const { reconnects, session, sockets, states } = fixture()
  session.start()
  const socket = sockets[0]
  assert.ok(socket)
  hello(socket)
  ready(socket)

  for (let index = 1; index < GATEWAY_DEFAULTS.outboundEventLimit; index += 1) {
    socket.message({ d: null, op: 1 })
    socket.message({ d: null, op: 11 })
  }
  assert.equal(payloads(socket).length, GATEWAY_DEFAULTS.outboundEventLimit)
  socket.message({ d: null, op: 1 })

  assert.equal(payloads(socket).length, GATEWAY_DEFAULTS.outboundEventLimit)
  assert.deepEqual(reconnects, [0])
  assert.deepEqual(states.at(-1), {
    category: "outbound-budget-exhausted",
    state: "reconnecting",
  })
  assert.deepEqual(socket.closed.at(-1), {
    code: 4_000,
    reason: "guildcontrol reconnect",
  })
})

test("Gateway shard rejects oversized caller and control payloads without reflection", async () => {
  const caller = fixture()
  caller.session.start()
  const callerSocket = caller.sockets[0]
  assert.ok(callerSocket)
  hello(callerSocket)
  ready(callerSocket)
  const oversized = "x".repeat(GATEWAY_DEFAULTS.outboundPayloadBytes)
  assert.equal(await caller.session.sendCommand({ oversized }, undefined), "unavailable")
  assert.equal(payloads(callerSocket).length, 1)
  assert.doesNotMatch(JSON.stringify(caller.states), /x{32}/)

  const control = fixture({ token: oversized })
  control.session.start()
  const controlSocket = control.sockets[0]
  assert.ok(controlSocket)
  hello(controlSocket)
  assert.deepEqual(control.failures, ["protocol-error"])
  assert.deepEqual(payloads(controlSocket), [])
  assert.doesNotMatch(JSON.stringify(control.states), /x{32}/)
})

test("Gateway shard classifies malformed payloads and fatal close codes", () => {
  const malformed = fixture()
  malformed.session.start()
  const malformedSocket = malformed.sockets[0]
  assert.ok(malformedSocket)
  malformedSocket.open()
  malformedSocket.message("not-json")
  assert.deepEqual(malformed.failures, ["invalid-gateway-payload"])

  const negativeSequence = fixture()
  negativeSequence.session.start()
  const negativeSequenceSocket = negativeSequence.sockets[0]
  assert.ok(negativeSequenceSocket)
  hello(negativeSequenceSocket)
  negativeSequenceSocket.message({ d: {}, op: 0, s: -1, t: "GUILD_CREATE" })
  assert.deepEqual(negativeSequence.failures, ["invalid-gateway-payload"])

  const fatal = fixture()
  fatal.session.start()
  const fatalSocket = fatal.sockets[0]
  assert.ok(fatalSocket)
  fatalSocket.serverClose(4_014)
  assert.deepEqual(fatal.failures, ["disallowed-intents"])
  assert.equal(fatal.actorScheduler.jobs.size, 0)

  const invalidVersion = fixture()
  invalidVersion.session.start()
  const invalidVersionSocket = invalidVersion.sockets[0]
  assert.ok(invalidVersionSocket)
  invalidVersionSocket.serverClose(4_012)
  assert.deepEqual(invalidVersion.failures, ["invalid-api-version"])
})

test("Gateway shard validates construction without opening a socket", () => {
  const { coordinator } = fixture()
  assert.throws(
    () => new GatewayShardSession({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      gatewayUrl: "wss://gateway.discord.gg/private",
      identifyCoordinator: coordinator,
      intents: 0,
      onContinuityGap() {},
      onDispatch() {},
      onFatal() {},
      onReconnect() {},
      onResume() {},
      onState() {},
      shardCount: 1,
      shardId: 0,
      token: TOKEN,
    }),
    /URL is invalid/,
  )
  assert.throws(
    () => new GatewayShardSession({
      applicationId: "0",
      botId: BOT_ID,
      gatewayUrl: GATEWAY_URL,
      identifyCoordinator: coordinator,
      intents: 0,
      onContinuityGap() {},
      onDispatch() {},
      onFatal() {},
      onReconnect() {},
      onResume() {},
      onState() {},
      shardCount: 1,
      shardId: 0,
      token: TOKEN,
    }),
    /options are invalid/,
  )
})
