import {
  CONNECTOR_NAME,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GATEWAY_DEFAULTS,
} from "./constants.js"
import { normalizeDiscordGatewayUrl } from "./gateway-discovery.js"
import type { GatewayIdentifyCoordinator } from "./gateway-identify-coordinator.js"
import type { GatewayErrorCategory } from "./gateway-events.js"
import {
  GatewayOutboundBudget,
  type GatewayCommandSendOutcome,
} from "./gateway-outbound-budget.js"

export interface GatewaySocket {
  readonly readyState: number
  onclose: ((event: { code: number }) => void) | null
  onerror: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onopen: (() => void) | null
  close(code?: number, reason?: string): void
  send(data: string): void
}

export interface GatewayScheduler {
  clearTimeout(handle: unknown): void
  setTimeout(handler: () => void, milliseconds: number): unknown
}

export type GatewayShardState =
  | "authenticating"
  | "connecting"
  | "failed"
  | "ready"
  | "reconnecting"
  | "stopped"

export interface GatewayShardDispatch {
  data: unknown
  name: string
  sequence: number
  shardId: number
}

export interface GatewayShardSessionOptions {
  applicationId: string
  botId: string
  clock?: () => number
  gatewayUrl: string
  identifyCoordinator: GatewayIdentifyCoordinator
  intents: number
  onContinuityGap: (shardId: number) => void
  onDispatch: (dispatch: GatewayShardDispatch) => void
  onFatal: (shardId: number, category: GatewayErrorCategory) => void
  onReconnect: (shardId: number) => void
  onResume: (shardId: number) => void
  onState: (
    shardId: number,
    state: GatewayShardState,
    errorCategory?: GatewayErrorCategory,
  ) => void
  random?: () => number
  scheduler?: GatewayScheduler
  shardCount: number
  shardId: number
  token: string
  webSocketFactory?: (url: string) => GatewaySocket
}

interface GatewayPayload {
  d: unknown
  op: number
  s?: number | null
  t?: string | null
}

interface PendingReconnect {
  clearSession: boolean
  delayMs?: number
  errorCategory?: GatewayErrorCategory
}

const GATEWAY_OPCODES = Object.freeze({
  dispatch: 0,
  heartbeat: 1,
  heartbeatAck: 11,
  hello: 10,
  identify: 2,
  invalidSession: 9,
  reconnect: 7,
  resume: 6,
})
const SOCKET_STATES = Object.freeze({
  connecting: 0,
  open: 1,
})
const RECONNECT_CLOSE_CODE = 4_000
const STOP_CLOSE_CODE = 1_000
const STATIC_RECONNECT_REASON = "guildcontrol reconnect"
const STATIC_STOP_REASON = "guildcontrol stop"

const FATAL_CLOSE_CATEGORIES: ReadonlyMap<number, GatewayErrorCategory> = new Map([
  [4_004, "authentication-failed"],
  [4_010, "invalid-shard"],
  [4_011, "sharding-required"],
  [4_012, "invalid-api-version"],
  [4_013, "invalid-intents"],
  [4_014, "disallowed-intents"],
])
const REIDENTIFY_CLOSE_CODES = new Set([4_007, 4_009])

function defaultScheduler(): GatewayScheduler {
  return {
    clearTimeout(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    setTimeout(handler, milliseconds) {
      return setTimeout(handler, milliseconds)
    },
  }
}

function defaultWebSocketFactory(url: string): GatewaySocket {
  return new WebSocket(url) as unknown as GatewaySocket
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined
}

function safeString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined
}

function positiveSnowflake(value: unknown): value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) return false
  try {
    const parsed = BigInt(value)
    return parsed > 0n && parsed <= DISCORD_SNOWFLAKE_MAX
  } catch {
    return false
  }
}

function parsePayload(data: unknown): GatewayPayload | undefined {
  if (
    typeof data !== "string"
    || Buffer.byteLength(data, "utf8") > GATEWAY_DEFAULTS.maximumPayloadBytes
  ) return undefined
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }
  const record = recordValue(value)
  if (!record) return undefined
  const op = safeInteger(record.op)
  if (op === undefined || op < 0) return undefined
  const payload: GatewayPayload = { d: record.d, op }
  if (record.s !== undefined) {
    if (
      record.s !== null
      && (safeInteger(record.s) === undefined || Number(record.s) < 0)
    ) return undefined
    payload.s = record.s as number | null
  }
  if (record.t !== undefined) {
    if (record.t !== null && typeof record.t !== "string") return undefined
    payload.t = record.t as string | null
  }
  return payload
}

function readyShardPair(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const shardId = safeInteger(value[0])
  const shardCount = safeInteger(value[1])
  if (
    shardId === undefined
    || shardId < 0
    || shardCount === undefined
    || shardCount < 1
    || shardId >= shardCount
  ) return undefined
  return [shardId, shardCount]
}

export class GatewayShardSession {
  readonly #applicationId: string
  #awaitingHeartbeatAck = false
  readonly #botId: string
  #cancelIdentify: (() => void) | undefined
  #heartbeatIntervalMs: number | undefined
  #heartbeatTimer: unknown
  readonly #identifyCoordinator: GatewayIdentifyCoordinator
  readonly #intents: number
  readonly #onContinuityGap: GatewayShardSessionOptions["onContinuityGap"]
  readonly #onDispatch: GatewayShardSessionOptions["onDispatch"]
  readonly #onFatal: GatewayShardSessionOptions["onFatal"]
  readonly #onReconnect: GatewayShardSessionOptions["onReconnect"]
  readonly #onResume: GatewayShardSessionOptions["onResume"]
  readonly #onState: GatewayShardSessionOptions["onState"]
  readonly #outboundBudget: GatewayOutboundBudget
  #pendingReconnect: PendingReconnect | undefined
  #phaseTimer: unknown
  readonly #random: () => number
  #reconnectAttempt = 0
  #reconnectTimer: unknown
  #resumeUrl: string | undefined
  #resuming = false
  #running = false
  readonly #scheduler: GatewayScheduler
  readonly #shardCount: number
  readonly #shardId: number
  #sequence: number | null = null
  #sessionId: string | undefined
  #socket: GatewaySocket | undefined
  #state: GatewayShardState = "stopped"
  #terminal = false
  readonly #token: string
  readonly #url: string
  readonly #webSocketFactory: (url: string) => GatewaySocket

  constructor(options: GatewayShardSessionOptions) {
    if (
      !Number.isSafeInteger(options.shardCount)
      || options.shardCount < 1
      || !Number.isSafeInteger(options.shardId)
      || options.shardId < 0
      || options.shardId >= options.shardCount
      || !Number.isSafeInteger(options.intents)
      || options.intents < 0
      || !positiveSnowflake(options.applicationId)
      || !positiveSnowflake(options.botId)
      || !options.token.trim()
      || (options.clock !== undefined && typeof options.clock !== "function")
    ) {
      throw new RangeError("Gateway shard session options are invalid")
    }
    const url = normalizeDiscordGatewayUrl(options.gatewayUrl)
    if (!url || url !== options.gatewayUrl) {
      throw new RangeError("Gateway shard session URL is invalid")
    }
    this.#applicationId = options.applicationId
    this.#botId = options.botId
    this.#identifyCoordinator = options.identifyCoordinator
    this.#intents = options.intents
    this.#onContinuityGap = options.onContinuityGap
    this.#onDispatch = options.onDispatch
    this.#onFatal = options.onFatal
    this.#onReconnect = options.onReconnect
    this.#onResume = options.onResume
    this.#onState = options.onState
    this.#random = options.random || Math.random
    this.#scheduler = options.scheduler || defaultScheduler()
    this.#outboundBudget = new GatewayOutboundBudget({
      ...(options.clock ? { clock: options.clock } : {}),
      scheduler: this.#scheduler,
      write: (serialized) => this.#write(serialized),
    })
    this.#shardCount = options.shardCount
    this.#shardId = options.shardId
    this.#token = options.token
    this.#url = url
    this.#webSocketFactory = options.webSocketFactory || defaultWebSocketFactory
  }

  get shardId(): number {
    return this.#shardId
  }

  get state(): GatewayShardState {
    return this.#state
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#terminal = false
    this.#connect(this.#url)
  }

  stop(): void {
    this.#running = false
    this.#terminal = false
    this.#pendingReconnect = undefined
    this.#cancelPendingIdentify()
    this.#clearTimer("heartbeat")
    this.#clearTimer("phase")
    this.#clearTimer("reconnect")
    this.#outboundBudget.reset()
    const socket = this.#socket
    this.#socket = undefined
    this.#reconnectAttempt = 0
    this.#clearSession(false)
    if (
      socket
      && (socket.readyState === SOCKET_STATES.connecting || socket.readyState === SOCKET_STATES.open)
    ) {
      try {
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.onopen = null
        socket.close(STOP_CLOSE_CODE, STATIC_STOP_REASON)
      } catch {}
    }
    this.#setState("stopped")
  }

  sendCommand(
    payload: object,
    options: { signal?: AbortSignal } = {},
  ): Promise<GatewayCommandSendOutcome> {
    if (!this.#running || this.#terminal || this.#state !== "ready") {
      return Promise.resolve("unavailable")
    }
    const serialized = this.#serialize(payload)
    if (!serialized) return Promise.resolve("unavailable")
    return this.#outboundBudget.sendCommand(serialized, options.signal)
  }

  #setState(state: GatewayShardState, errorCategory?: GatewayErrorCategory): void {
    if (this.#state === state && !errorCategory) return
    this.#state = state
    try {
      this.#onState(this.#shardId, state, errorCategory)
    } catch {}
  }

  #cancelPendingIdentify(): void {
    const cancel = this.#cancelIdentify
    this.#cancelIdentify = undefined
    try {
      cancel?.()
    } catch {}
  }

  #clearTimer(kind: "heartbeat" | "phase" | "reconnect"): void {
    const handle = kind === "heartbeat"
      ? this.#heartbeatTimer
      : kind === "phase"
        ? this.#phaseTimer
        : this.#reconnectTimer
    if (handle !== undefined) this.#scheduler.clearTimeout(handle)
    if (kind === "heartbeat") this.#heartbeatTimer = undefined
    if (kind === "phase") this.#phaseTimer = undefined
    if (kind === "reconnect") this.#reconnectTimer = undefined
  }

  #clearSession(breakContinuity: boolean): void {
    const hadSession = this.#sessionId !== undefined || this.#sequence !== null
    if (breakContinuity && hadSession) {
      try {
        this.#onContinuityGap(this.#shardId)
      } catch {}
    }
    this.#sessionId = undefined
    this.#resumeUrl = undefined
    this.#resuming = false
    this.#sequence = null
  }

  #armPhaseTimeout(
    category: "authentication-timeout" | "connection-timeout",
    milliseconds: number,
    clearSession: boolean,
  ): void {
    this.#clearTimer("phase")
    this.#phaseTimer = this.#scheduler.setTimeout(() => {
      this.#phaseTimer = undefined
      this.#requestReconnect({ clearSession, errorCategory: category })
    }, milliseconds)
  }

  #connect(url: string): void {
    if (!this.#running || this.#terminal) return
    this.#outboundBudget.reset()
    this.#cancelPendingIdentify()
    this.#clearTimer("heartbeat")
    this.#clearTimer("phase")
    this.#awaitingHeartbeatAck = false
    this.#heartbeatIntervalMs = undefined
    this.#resuming = false
    this.#setState(this.#reconnectAttempt > 0 ? "reconnecting" : "connecting")
    let socket: GatewaySocket
    try {
      socket = this.#webSocketFactory(url)
    } catch {
      this.#scheduleReconnect({ errorCategory: "network-error", clearSession: false })
      return
    }
    this.#socket = socket
    socket.onopen = () => {
      if (this.#socket !== socket || !this.#running) return
    }
    socket.onmessage = (event) => {
      if (this.#socket !== socket || !this.#running) return
      this.#onMessage(event.data)
    }
    socket.onerror = () => {
      if (this.#socket !== socket || !this.#running) return
      this.#requestReconnect({ clearSession: false, errorCategory: "network-error" })
    }
    socket.onclose = (event) => {
      if (this.#socket !== socket) return
      this.#socket = undefined
      this.#outboundBudget.reset()
      this.#cancelPendingIdentify()
      this.#clearTimer("heartbeat")
      this.#clearTimer("phase")
      this.#awaitingHeartbeatAck = false
      if (!this.#running || this.#terminal) return
      const pending = this.#pendingReconnect
      this.#pendingReconnect = undefined
      if (pending) {
        this.#scheduleReconnect(pending)
        return
      }
      this.#handleCloseCode(event.code)
    }
    this.#armPhaseTimeout("connection-timeout", GATEWAY_DEFAULTS.connectionTimeoutMs, false)
  }

  #onMessage(data: unknown): void {
    const payload = parsePayload(data)
    if (!payload) {
      this.#fail("invalid-gateway-payload")
      return
    }
    switch (payload.op) {
      case GATEWAY_OPCODES.hello:
        this.#onHello(payload.d)
        return
      case GATEWAY_OPCODES.heartbeatAck:
        this.#awaitingHeartbeatAck = false
        return
      case GATEWAY_OPCODES.heartbeat:
        this.#sendHeartbeat()
        return
      case GATEWAY_OPCODES.reconnect:
        this.#requestReconnect({ clearSession: false })
        return
      case GATEWAY_OPCODES.invalidSession:
        this.#onInvalidSession(payload.d)
        return
      case GATEWAY_OPCODES.dispatch:
        this.#onDispatchPayload(payload)
        return
      default:
        return
    }
  }

  #onHello(data: unknown): void {
    if (this.#heartbeatIntervalMs !== undefined) {
      this.#fail("protocol-error")
      return
    }
    const record = recordValue(data)
    const heartbeatIntervalMs = safeInteger(record?.heartbeat_interval)
    if (
      heartbeatIntervalMs === undefined
      || heartbeatIntervalMs < GATEWAY_DEFAULTS.heartbeatMinimumMs
      || heartbeatIntervalMs > GATEWAY_DEFAULTS.heartbeatMaximumMs
    ) {
      this.#fail("invalid-gateway-payload")
      return
    }
    this.#heartbeatIntervalMs = heartbeatIntervalMs
    this.#armPhaseTimeout("authentication-timeout", GATEWAY_DEFAULTS.authenticationTimeoutMs, true)
    const jitter = Math.min(1, Math.max(0, this.#random()))
    this.#heartbeatTimer = this.#scheduler.setTimeout(
      () => this.#heartbeatTick(),
      Math.floor(heartbeatIntervalMs * jitter),
    )
    this.#setState(this.#reconnectAttempt > 0 ? "reconnecting" : "authenticating")
    if (this.#sessionId && this.#sequence !== null && this.#resumeUrl) {
      this.#resuming = true
      try {
        this.#onResume(this.#shardId)
      } catch {}
      this.#sendControl({
        d: {
          seq: this.#sequence,
          session_id: this.#sessionId,
          token: this.#token,
        },
        op: GATEWAY_OPCODES.resume,
      })
      return
    }
    this.#scheduleIdentify()
  }

  #scheduleIdentify(): void {
    this.#cancelPendingIdentify()
    let completed = false
    const cancel = this.#identifyCoordinator.request(this.#shardId, () => {
      completed = true
      this.#cancelIdentify = undefined
      if (!this.#running || this.#terminal || this.#heartbeatIntervalMs === undefined) {
        return false
      }
      return this.#sendControl({
        d: {
          intents: this.#intents,
          properties: {
            browser: CONNECTOR_NAME,
            device: CONNECTOR_NAME,
            os: process.platform,
          },
          shard: [this.#shardId, this.#shardCount],
          token: this.#token,
        },
        op: GATEWAY_OPCODES.identify,
      })
    })
    this.#cancelIdentify = completed ? undefined : cancel
  }

  #heartbeatTick(): void {
    this.#heartbeatTimer = undefined
    if (!this.#running || this.#terminal || this.#heartbeatIntervalMs === undefined) return
    if (this.#awaitingHeartbeatAck) {
      this.#requestReconnect({ clearSession: false, errorCategory: "heartbeat-timeout" })
      return
    }
    this.#sendHeartbeat()
    if (!this.#running || this.#terminal || this.#heartbeatIntervalMs === undefined) return
    this.#heartbeatTimer = this.#scheduler.setTimeout(
      () => this.#heartbeatTick(),
      this.#heartbeatIntervalMs,
    )
  }

  #sendHeartbeat(): void {
    if (this.#sendControl({ d: this.#sequence, op: GATEWAY_OPCODES.heartbeat })) {
      this.#awaitingHeartbeatAck = true
    }
  }

  #onDispatchPayload(payload: GatewayPayload): void {
    const sequence = safeInteger(payload.s)
    const eventName = typeof payload.t === "string" ? payload.t : undefined
    if (sequence === undefined || !eventName) {
      this.#fail("invalid-gateway-payload")
      return
    }
    this.#sequence = sequence
    if (eventName === "READY") {
      if (this.#resuming || !["authenticating", "reconnecting"].includes(this.#state)) {
        this.#fail("protocol-error")
        return
      }
      this.#onReady(payload.d)
      return
    }
    if (eventName === "RESUMED") {
      if (!this.#resuming || !this.#sessionId || !this.#resumeUrl) {
        this.#fail("protocol-error")
        return
      }
      this.#clearTimer("phase")
      this.#resuming = false
      this.#reconnectAttempt = 0
      this.#setState("ready")
      return
    }
    if (!this.#resuming && this.#state !== "ready") return
    try {
      this.#onDispatch({
        data: payload.d,
        name: eventName,
        sequence,
        shardId: this.#shardId,
      })
    } catch {
      this.#fail("protocol-error")
    }
  }

  #onReady(data: unknown): void {
    const record = recordValue(data)
    const application = recordValue(record?.application)
    const applicationId = safeString(application?.id, 20)
    const user = recordValue(record?.user)
    const botId = safeString(user?.id, 20)
    const sessionId = safeString(record?.session_id, 256)
    if (
      applicationId !== this.#applicationId
      || botId !== this.#botId
      || user?.bot !== true
    ) {
      this.#fail("invalid-ready-identity")
      return
    }
    const shard = readyShardPair(record?.shard)
    if (!shard || shard[0] !== this.#shardId || shard[1] !== this.#shardCount) {
      this.#fail("invalid-ready-shard")
      return
    }
    if (!sessionId) {
      this.#fail("invalid-gateway-payload")
      return
    }
    const resumeUrl = normalizeDiscordGatewayUrl(record?.resume_gateway_url)
    if (!resumeUrl) {
      this.#fail("invalid-resume-origin")
      return
    }
    this.#sessionId = sessionId
    this.#resumeUrl = resumeUrl
    this.#resuming = false
    this.#clearTimer("phase")
    this.#reconnectAttempt = 0
    this.#setState("ready")
  }

  #onInvalidSession(value: unknown): void {
    if (typeof value !== "boolean") {
      this.#fail("invalid-gateway-payload")
      return
    }
    this.#resuming = false
    const delayMs = 1_000 + Math.floor(Math.min(1, Math.max(0, this.#random())) * 4_000)
    this.#requestReconnect({ clearSession: !value, delayMs })
  }

  #sendControl(payload: object): boolean {
    const serialized = this.#serialize(payload)
    if (!serialized) {
      this.#fail("protocol-error")
      return false
    }
    const outcome = this.#outboundBudget.sendControl(serialized)
    if (outcome === "sent") return true
    this.#requestReconnect({
      clearSession: false,
      errorCategory: outcome === "exhausted"
        ? "outbound-budget-exhausted"
        : "network-error",
    })
    return false
  }

  #serialize(payload: object): string | undefined {
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(payload)
    } catch {
      return undefined
    }
    if (
      !serialized
      || Buffer.byteLength(serialized, "utf8") > GATEWAY_DEFAULTS.outboundPayloadBytes
    ) return undefined
    return serialized
  }

  #write(serialized: string): boolean {
    const socket = this.#socket
    if (!socket || socket.readyState !== SOCKET_STATES.open) {
      this.#requestReconnect({ clearSession: false, errorCategory: "network-error" })
      return false
    }
    try {
      socket.send(serialized)
      return true
    } catch {
      this.#requestReconnect({ clearSession: false, errorCategory: "network-error" })
      return false
    }
  }

  #requestReconnect(options: PendingReconnect): void {
    if (!this.#running || this.#terminal || this.#pendingReconnect) return
    this.#cancelPendingIdentify()
    this.#outboundBudget.reset()
    this.#pendingReconnect = options
    const socket = this.#socket
    if (!socket) {
      this.#pendingReconnect = undefined
      this.#scheduleReconnect(options)
      return
    }
    try {
      socket.close(RECONNECT_CLOSE_CODE, STATIC_RECONNECT_REASON)
    } catch {
      if (this.#socket === socket) this.#socket = undefined
      this.#pendingReconnect = undefined
      this.#scheduleReconnect(options)
    }
  }

  #handleCloseCode(code: number): void {
    const fatalCategory = FATAL_CLOSE_CATEGORIES.get(code)
    if (fatalCategory) {
      this.#fail(fatalCategory, false)
      return
    }
    this.#scheduleReconnect({
      clearSession: REIDENTIFY_CLOSE_CODES.has(code),
      ...(code === 4_008 ? { errorCategory: "rate-limited" as const } : {}),
      ...([4_001, 4_002, 4_003, 4_005].includes(code)
        ? { errorCategory: "protocol-error" as const }
        : {}),
    })
  }

  #scheduleReconnect(options: PendingReconnect): void {
    if (!this.#running || this.#terminal || this.#reconnectTimer !== undefined) return
    if (options.clearSession) this.#clearSession(true)
    this.#reconnectAttempt += 1
    try {
      this.#onReconnect(this.#shardId)
    } catch {}
    this.#setState("reconnecting", options.errorCategory)
    const exponential = Math.min(
      GATEWAY_DEFAULTS.reconnectMaximumMs,
      GATEWAY_DEFAULTS.reconnectMinimumMs * (2 ** (this.#reconnectAttempt - 1)),
    )
    const jitter = 0.8 + Math.min(1, Math.max(0, this.#random())) * 0.4
    const delayMs = options.delayMs ?? Math.floor(exponential * jitter)
    this.#reconnectTimer = this.#scheduler.setTimeout(() => {
      this.#reconnectTimer = undefined
      const target = this.#sessionId && this.#sequence !== null && this.#resumeUrl
        ? this.#resumeUrl
        : this.#url
      this.#connect(target)
    }, delayMs)
  }

  #fail(category: GatewayErrorCategory, closeSocket = true): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#cancelPendingIdentify()
    this.#clearTimer("heartbeat")
    this.#clearTimer("phase")
    this.#clearTimer("reconnect")
    this.#outboundBudget.reset()
    this.#clearSession(true)
    const socket = this.#socket
    this.#socket = undefined
    if (closeSocket && socket) {
      try {
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.onopen = null
        socket.close(RECONNECT_CLOSE_CODE, STATIC_RECONNECT_REASON)
      } catch {}
    }
    this.#setState("failed", category)
    try {
      this.#onFatal(this.#shardId, category)
    } catch {}
  }
}
