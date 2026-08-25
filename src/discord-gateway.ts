import process from "node:process"

import type { ConnectorConfig } from "./config.js"
import {
  CONNECTOR_NAME,
  DISCORD_GATEWAY_INTENT_MASK,
  DISCORD_GATEWAY_INTENTS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GATEWAY_DEFAULTS,
} from "./constants.js"
import type {
  GatewayChannelLayoutListener,
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutStatus,
} from "./gateway-channel-layout.js"
import {
  GatewayDiscoveryEvidenceError,
  normalizeDiscordGatewayUrl,
  validateGatewayBotDiscovery,
  type GatewayBotDiscovery,
} from "./gateway-discovery.js"
import { guildChannelLayoutGuildIds } from "./guild-channel-evidence.js"
import { GatewayVoiceChannelStatusError } from "./errors.js"
import {
  GatewayEventStore,
  type GatewayChangeListener,
  type GatewayErrorCategory,
  type GatewayEventPage,
  type GatewayEventSource,
  type GatewayStatusSnapshot,
} from "./gateway-events.js"
import {
  channelInfoGuildId,
  projectGatewayVoiceChannelStatus,
  projectGatewayVoiceChannelStatusUpdate,
  voiceChannelStatusChannelIds,
  voiceChannelStatusUpdateTarget,
  type GatewayVoiceChannelStatusRequestOptions,
  type GatewayVoiceChannelStatusSnapshot,
  type GatewayVoiceChannelStatusSource,
  type GatewayVoiceChannelStatusUpdate,
} from "./gateway-voice-channel-status.js"

export interface GatewayRuntime extends GatewayEventSource, GatewayVoiceChannelStatusSource {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface GatewayInteractionHandler {
  ingestInteraction(payload: unknown): Promise<void> | void
}

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

export interface DiscordGatewayOptions {
  applicationId: string
  clock?: () => number
  config: Pick<
    ConnectorConfig,
    | "allowedChannelIds"
    | "allowedGuildIds"
    | "allowGateway"
    | "expectedBotId"
    | "gatewayEventBufferSize"
    | "token"
  > & Partial<Pick<
    ConnectorConfig,
    | "allowChannelMetadataChanges"
    | "allowChannelOrderingAudit"
    | "allowGuildTemplateAudit"
    | "allowMemberRoleChanges"
    | "allowNativeInteractions"
    | "allowOnboardingAudit"
    | "channelOrderingGuildIds"
    | "channelMetadataIds"
    | "guildTemplateGuildIds"
    | "memberRoleGuildIds"
    | "onboardingGuildIds"
  >>
  eventStore?: GatewayEventStore
  discoverGateway: (signal: AbortSignal) => Promise<GatewayBotDiscovery>
  interactionHandler?: GatewayInteractionHandler
  logger?: (message: string) => void
  random?: () => number
  scheduler?: GatewayScheduler
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

interface PendingChannelInfo {
  abortListener?: () => void
  channelId: string
  guildId: string
  reject: (error: Error) => void
  requestedAt: string
  resolve: (snapshot: GatewayVoiceChannelStatusSnapshot) => void
  signal?: AbortSignal
  timeoutHandle: unknown
}

interface PendingVoiceChannelStatusUpdate {
  abortListener?: () => void
  channelId: string
  guildId: string
  reject: (error: Error) => void
  resolve: (snapshot: GatewayVoiceChannelStatusUpdate) => void
  signal?: AbortSignal
  timeoutHandle: unknown
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
  requestChannelInfo: 43,
})
const SOCKET_STATES = Object.freeze({
  connecting: 0,
  open: 1,
})
const RECONNECT_CLOSE_CODE = 4_000
const STOP_CLOSE_CODE = 1_000
const STATIC_RECONNECT_REASON = "discord-mcp reconnect"
const STATIC_STOP_REASON = "discord-mcp stop"

const FATAL_CLOSE_CATEGORIES: ReadonlyMap<number, GatewayErrorCategory> = new Map([
  [4_004, "authentication-failed"],
  [4_010, "invalid-shard"],
  [4_011, "sharding-required"],
  [4_012, "invalid-api-version"],
  [4_013, "invalid-intents"],
  [4_014, "disallowed-intents"],
])

const REIDENTIFY_CLOSE_CODES: ReadonlySet<number> = new Set([
  4_007,
  4_009,
])

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
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function voiceChannelStatusTargetKey(guildId: string, channelId: string): string {
  return `${guildId}\0${channelId}`
}

export function normalizeGatewayResumeUrl(value: unknown): string | undefined {
  return normalizeDiscordGatewayUrl(value)
}

function parsePayload(data: unknown): GatewayPayload | undefined {
  if (
    typeof data !== "string"
    || Buffer.byteLength(data, "utf8") > GATEWAY_DEFAULTS.maximumPayloadBytes
  ) {
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }
  const record = recordValue(value)
  const op = safeInteger(record?.op)
  if (!record || op === undefined) return undefined
  const sequence = record.s
  if (
    sequence !== undefined
    && sequence !== null
    && (safeInteger(sequence) === undefined || Number(sequence) < 0)
  ) {
    return undefined
  }
  const eventName = record.t
  if (eventName !== undefined && eventName !== null && typeof eventName !== "string") {
    return undefined
  }
  return {
    d: record.d,
    op,
    ...(sequence === undefined ? {} : { s: sequence as number | null }),
    ...(eventName === undefined ? {} : { t: eventName as string | null }),
  }
}

export class DiscordGateway implements GatewayRuntime {
  readonly #applicationId: string
  #awaitingHeartbeatAck = false
  readonly #botId: string
  readonly #clock: () => number
  #discoveryAbort: AbortController | undefined
  readonly #discoverGateway: (signal: AbortSignal) => Promise<GatewayBotDiscovery>
  readonly #eventStore: GatewayEventStore
  #gatewayUrl: string | undefined
  #heartbeatIntervalMs: number | undefined
  #heartbeatTimer: unknown
  readonly #identifyTimes: number[] = []
  #identifyTimer: unknown
  readonly #interactionHandler: GatewayInteractionHandler | undefined
  readonly #logger: (message: string) => void
  readonly #pendingChannelInfo = new Map<string, PendingChannelInfo>()
  #pendingReconnect: PendingReconnect | undefined
  #phaseTimer: unknown
  readonly #random: () => number
  #reconnectAttempt = 0
  #reconnectTimer: unknown
  #remainingSessionStarts: number | undefined
  #resumeUrl: string | undefined
  #resuming = false
  #running = false
  readonly #scheduler: GatewayScheduler
  #sequence: number | null = null
  #sessionId: string | undefined
  #socket: GatewaySocket | undefined
  #startupGeneration = 0
  #terminal = false
  readonly #token: string
  readonly #voiceChannelStatusIds: ReadonlySet<string>
  readonly #voiceChannelStatusQueueTails = new Map<string, Promise<void>>()
  readonly #voiceChannelStatusUpdateWaiters = new Map<
    string,
    Set<PendingVoiceChannelStatusUpdate>
  >()
  readonly #webSocketFactory: (url: string) => GatewaySocket
  readonly voiceChannelStatusEnabled: boolean

  constructor(options: DiscordGatewayOptions) {
    if (!DISCORD_SNOWFLAKE_PATTERN.test(options.applicationId)) {
      throw new RangeError("Gateway application ID must be a Discord snowflake")
    }
    const botId = options.config.expectedBotId
    if (!botId || !DISCORD_SNOWFLAKE_PATTERN.test(botId)) {
      throw new RangeError("Gateway bot ID must be a Discord snowflake")
    }
    if (!options.config.token.trim()) throw new RangeError("Gateway token must not be empty")
    if (
      options.config.allowGateway
      && options.config.allowedGuildIds.size === 0
      && options.config.allowedChannelIds.size === 0
    ) {
      throw new RangeError("Enabled Discord Gateway requires an exact guild or channel scope")
    }
    if (options.config.allowNativeInteractions && !options.interactionHandler) {
      throw new RangeError(
        "Enabled Discord native Interactions require an Interaction handler",
      )
    }
    const layoutGuildIds = guildChannelLayoutGuildIds(options.config)
    const voiceChannelStatusIds = voiceChannelStatusChannelIds({
      allowChannelMetadataChanges: options.config.allowChannelMetadataChanges ?? false,
      channelMetadataIds: options.config.channelMetadataIds ?? new Set(),
    })
    const voiceChannelStatusEnabled = voiceChannelStatusIds.size > 0
    const connectionEnabled = options.config.allowGateway
      || layoutGuildIds.size > 0
      || options.config.allowNativeInteractions === true
      || voiceChannelStatusEnabled
    this.#applicationId = options.applicationId
    this.#botId = botId
    this.#clock = options.clock || Date.now
    this.#discoverGateway = options.discoverGateway
    this.#eventStore = options.eventStore || new GatewayEventStore({
      allowedChannelIds: options.config.allowedChannelIds,
      allowedGuildIds: options.config.allowedGuildIds,
      bufferSize: options.config.gatewayEventBufferSize,
      enabled: connectionEnabled,
      eventFeedEnabled: options.config.allowGateway,
      layoutGuildIds,
      voiceChannelStatusChannelCount: voiceChannelStatusIds.size,
    })
    if (
      this.#eventStore.enabled !== connectionEnabled
      || this.#eventStore.eventFeedEnabled !== options.config.allowGateway
      || this.#eventStore.getChannelLayoutStatus().guilds.scoped !== layoutGuildIds.size
      || this.#eventStore.getStatus().projections.voiceChannelStatus.scopedChannels
        !== voiceChannelStatusIds.size
    ) {
      throw new RangeError("Gateway runtime and event store enabled states must match")
    }
    for (const guildId of layoutGuildIds) {
      if (this.#eventStore.getChannelLayout(guildId).reason === "outside-scope") {
        throw new RangeError("Gateway runtime and event store channel-layout scopes must match")
      }
    }
    this.#interactionHandler = options.interactionHandler
    this.#logger = options.logger || (() => undefined)
    this.#random = options.random || Math.random
    this.#scheduler = options.scheduler || defaultScheduler()
    this.#token = options.config.token
    this.#voiceChannelStatusIds = new Set(voiceChannelStatusIds)
    this.voiceChannelStatusEnabled = voiceChannelStatusEnabled
    this.#webSocketFactory = options.webSocketFactory || defaultWebSocketFactory
  }

  get enabled(): boolean {
    return this.#eventStore.enabled
  }

  getStatus(): GatewayStatusSnapshot {
    return this.#eventStore.getStatus()
  }

  listEvents(options: { afterCursor?: string; limit?: number } = {}): GatewayEventPage {
    return this.#eventStore.listEvents(options)
  }

  get layoutEnabled(): boolean {
    return this.#eventStore.layoutEnabled
  }

  getChannelLayout(guildId: string): GatewayChannelLayoutSnapshot {
    return this.#eventStore.getChannelLayout(guildId)
  }

  getChannelLayoutStatus(): GatewayChannelLayoutStatus {
    return this.#eventStore.getChannelLayoutStatus()
  }

  subscribeChannelLayouts(listener: GatewayChannelLayoutListener): () => void {
    return this.#eventStore.subscribeChannelLayouts(listener)
  }

  subscribe(listener: GatewayChangeListener): () => void {
    return this.#eventStore.subscribe(listener)
  }

  getVoiceChannelStatus(
    guildId: string,
    channelId: string,
    options: GatewayVoiceChannelStatusRequestOptions = {},
  ): Promise<GatewayVoiceChannelStatusSnapshot> {
    this.#assertVoiceChannelStatusTarget(guildId, channelId)
    const prior = this.#voiceChannelStatusQueueTails.get(guildId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#voiceChannelStatusQueueTails.set(guildId, tail)
    return prior
      .catch(() => undefined)
      .then(() => this.#requestVoiceChannelStatus(guildId, channelId, options))
      .finally(() => {
        release()
        if (this.#voiceChannelStatusQueueTails.get(guildId) === tail) {
          this.#voiceChannelStatusQueueTails.delete(guildId)
        }
      })
  }

  waitForVoiceChannelStatusUpdate(
    guildId: string,
    channelId: string,
    options: GatewayVoiceChannelStatusRequestOptions = {},
  ): Promise<GatewayVoiceChannelStatusUpdate> {
    this.#assertVoiceChannelStatusTarget(guildId, channelId)
    if (options.signal?.aborted) {
      return Promise.reject(new GatewayVoiceChannelStatusError(
        "Discord Gateway voice channel status update evidence was cancelled",
      ))
    }
    if (
      !this.#running
      || this.#terminal
      || this.#eventStore.getStatus().connection.state !== "ready"
    ) {
      return Promise.reject(new GatewayVoiceChannelStatusError(
        "Discord Gateway is not ready for voice channel status update evidence",
      ))
    }
    return new Promise<GatewayVoiceChannelStatusUpdate>((resolve, reject) => {
      let pending: PendingVoiceChannelStatusUpdate
      const timeoutHandle = this.#scheduler.setTimeout(() => {
        this.#finishVoiceChannelStatusUpdate(
          pending,
          new GatewayVoiceChannelStatusError(
            "Discord Gateway voice channel status update evidence timed out",
          ),
        )
      }, GATEWAY_DEFAULTS.voiceChannelStatusUpdateTimeoutMs)
      pending = {
        channelId,
        guildId,
        reject,
        resolve,
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutHandle,
      }
      if (options.signal) {
        pending.abortListener = () => this.#finishVoiceChannelStatusUpdate(
          pending,
          new GatewayVoiceChannelStatusError(
            "Discord Gateway voice channel status update evidence was cancelled",
          ),
        )
        options.signal.addEventListener("abort", pending.abortListener, { once: true })
      }
      const key = voiceChannelStatusTargetKey(guildId, channelId)
      const waiters = this.#voiceChannelStatusUpdateWaiters.get(key) ?? new Set()
      waiters.add(pending)
      this.#voiceChannelStatusUpdateWaiters.set(key, waiters)
    })
  }

  async start(): Promise<void> {
    if (!this.enabled || this.#running) return
    this.#running = true
    this.#terminal = false
    const generation = this.#startupGeneration + 1
    this.#startupGeneration = generation
    const controller = new AbortController()
    this.#discoveryAbort = controller
    this.#eventStore.transition("discovering")
    let discovery: GatewayBotDiscovery
    try {
      const response = await this.#discoverGateway(controller.signal)
      if (!this.#startupActive(generation)) return
      discovery = validateGatewayBotDiscovery(response)
    } catch (error) {
      if (!this.#startupActive(generation)) return
      this.#discoveryAbort = undefined
      this.#fail(error instanceof GatewayDiscoveryEvidenceError
        ? "invalid-gateway-discovery"
        : "gateway-discovery-failed")
      return
    }
    if (!this.#startupActive(generation)) return
    this.#discoveryAbort = undefined
    this.#eventStore.recordDiscovery({
      recommendedShards: discovery.shards,
      sessionStartLimit: discovery.sessionStartLimit,
    })
    this.#remainingSessionStarts = discovery.sessionStartLimit.remaining
    if (discovery.sessionStartLimit.remaining === 0) {
      this.#fail("session-start-limit-exhausted")
      return
    }
    if (discovery.shards !== 1) {
      this.#fail("sharding-required")
      return
    }
    this.#gatewayUrl = discovery.url
    this.#connect(discovery.url)
  }

  async stop(): Promise<void> {
    this.#running = false
    this.#terminal = false
    this.#startupGeneration += 1
    this.#discoveryAbort?.abort()
    this.#discoveryAbort = undefined
    this.#gatewayUrl = undefined
    this.#remainingSessionStarts = undefined
    this.#pendingReconnect = undefined
    this.#rejectPendingVoiceEvidence("Discord Gateway voice channel status evidence stopped")
    this.#clearTimer("heartbeat")
    this.#clearTimer("identify")
    this.#clearTimer("phase")
    this.#clearTimer("reconnect")
    const socket = this.#socket
    this.#socket = undefined
    this.#reconnectAttempt = 0
    this.#clearSession(true)
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
    if (this.enabled) this.#eventStore.transition("stopped")
  }

  #startupActive(generation: number): boolean {
    return this.#running
      && !this.#terminal
      && this.#startupGeneration === generation
  }

  #assertVoiceChannelStatusTarget(guildId: string, channelId: string): void {
    if (!positiveSnowflake(guildId) || !positiveSnowflake(channelId)) {
      throw new RangeError("Gateway voice channel status target IDs must be positive snowflakes")
    }
    if (!this.voiceChannelStatusEnabled || !this.#voiceChannelStatusIds.has(channelId)) {
      throw new GatewayVoiceChannelStatusError(
        "Discord channel is outside the exact Gateway voice channel status scope",
      )
    }
  }

  #requestVoiceChannelStatus(
    guildId: string,
    channelId: string,
    options: GatewayVoiceChannelStatusRequestOptions,
  ): Promise<GatewayVoiceChannelStatusSnapshot> {
    if (options.signal?.aborted) {
      return Promise.reject(new GatewayVoiceChannelStatusError(
        "Discord Gateway voice channel status evidence was cancelled",
      ))
    }
    if (
      !this.#running
      || this.#terminal
      || this.#eventStore.getStatus().connection.state !== "ready"
    ) {
      return Promise.reject(new GatewayVoiceChannelStatusError(
        "Discord Gateway is not ready for voice channel status evidence",
      ))
    }
    if (this.#pendingChannelInfo.has(guildId)) {
      return Promise.reject(new GatewayVoiceChannelStatusError(
        "Discord Gateway already has pending channel-info evidence for this guild",
      ))
    }
    const requestedAt = new Date(this.#clock()).toISOString()
    return new Promise<GatewayVoiceChannelStatusSnapshot>((resolve, reject) => {
      let pending: PendingChannelInfo
      const timeoutHandle = this.#scheduler.setTimeout(() => {
        this.#finishChannelInfo(
          pending,
          new GatewayVoiceChannelStatusError(
            "Discord Gateway voice channel status evidence timed out",
          ),
        )
      }, GATEWAY_DEFAULTS.channelInfoTimeoutMs)
      pending = {
        channelId,
        guildId,
        reject,
        requestedAt,
        resolve,
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutHandle,
      }
      if (options.signal) {
        pending.abortListener = () => this.#finishChannelInfo(
          pending,
          new GatewayVoiceChannelStatusError(
            "Discord Gateway voice channel status evidence was cancelled",
          ),
        )
        options.signal.addEventListener("abort", pending.abortListener, { once: true })
      }
      this.#pendingChannelInfo.set(guildId, pending)
      if (!this.#send({
        d: {
          fields: ["status"],
          guild_id: guildId,
        },
        op: GATEWAY_OPCODES.requestChannelInfo,
      })) {
        this.#finishChannelInfo(
          pending,
          new GatewayVoiceChannelStatusError(
            "Discord Gateway could not request voice channel status evidence",
          ),
        )
      }
    })
  }

  #finishChannelInfo(
    pending: PendingChannelInfo,
    result: GatewayVoiceChannelStatusSnapshot | Error,
  ): void {
    if (this.#pendingChannelInfo.get(pending.guildId) !== pending) return
    this.#pendingChannelInfo.delete(pending.guildId)
    this.#scheduler.clearTimeout(pending.timeoutHandle)
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortListener)
    }
    if (result instanceof Error) pending.reject(result)
    else pending.resolve(result)
  }

  #finishVoiceChannelStatusUpdate(
    pending: PendingVoiceChannelStatusUpdate,
    result: GatewayVoiceChannelStatusUpdate | Error,
  ): void {
    const key = voiceChannelStatusTargetKey(pending.guildId, pending.channelId)
    const waiters = this.#voiceChannelStatusUpdateWaiters.get(key)
    if (!waiters?.delete(pending)) return
    if (waiters.size === 0) this.#voiceChannelStatusUpdateWaiters.delete(key)
    this.#scheduler.clearTimeout(pending.timeoutHandle)
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortListener)
    }
    if (result instanceof Error) pending.reject(result)
    else pending.resolve(result)
  }

  #rejectPendingVoiceEvidence(message: string): void {
    const error = new GatewayVoiceChannelStatusError(message)
    for (const pending of [...this.#pendingChannelInfo.values()]) {
      this.#finishChannelInfo(pending, error)
    }
    for (const waiters of [...this.#voiceChannelStatusUpdateWaiters.values()]) {
      for (const pending of [...waiters]) this.#finishVoiceChannelStatusUpdate(pending, error)
    }
  }

  #clearTimer(kind: "heartbeat" | "identify" | "phase" | "reconnect"): void {
    const handle = kind === "heartbeat"
      ? this.#heartbeatTimer
      : kind === "identify"
        ? this.#identifyTimer
        : kind === "phase"
          ? this.#phaseTimer
          : this.#reconnectTimer
    if (handle !== undefined) this.#scheduler.clearTimeout(handle)
    if (kind === "heartbeat") this.#heartbeatTimer = undefined
    if (kind === "identify") this.#identifyTimer = undefined
    if (kind === "phase") this.#phaseTimer = undefined
    if (kind === "reconnect") this.#reconnectTimer = undefined
  }

  #clearSession(breakContinuity = false): void {
    const hadSession = this.#sessionId !== undefined || this.#sequence !== null
    if (breakContinuity && hadSession) this.#eventStore.recordContinuityGap()
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
    this.#clearTimer("heartbeat")
    this.#clearTimer("identify")
    this.#clearTimer("phase")
    this.#awaitingHeartbeatAck = false
    this.#heartbeatIntervalMs = undefined
    this.#resuming = false
    this.#eventStore.transition(this.#reconnectAttempt > 0 ? "reconnecting" : "connecting")
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
      this.#requestReconnect({
        clearSession: false,
        errorCategory: "network-error",
      })
    }
    socket.onclose = (event) => {
      if (this.#socket !== socket) return
      this.#socket = undefined
      this.#rejectPendingVoiceEvidence(
        "Discord Gateway continuity changed during voice channel status evidence collection",
      )
      this.#clearTimer("heartbeat")
      this.#clearTimer("identify")
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
    this.#armPhaseTimeout(
      "connection-timeout",
      GATEWAY_DEFAULTS.connectionTimeoutMs,
      false,
    )
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
        this.#onDispatch(payload)
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
    this.#armPhaseTimeout(
      "authentication-timeout",
      GATEWAY_DEFAULTS.authenticationTimeoutMs,
      true,
    )
    const jitter = Math.min(1, Math.max(0, this.#random()))
    this.#heartbeatTimer = this.#scheduler.setTimeout(
      () => this.#heartbeatTick(),
      Math.floor(heartbeatIntervalMs * jitter),
    )
    this.#eventStore.transition("authenticating")
    if (this.#sessionId && this.#sequence !== null && this.#resumeUrl) {
      this.#resuming = true
      this.#eventStore.recordResume()
      this.#send({
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
    if (
      this.#remainingSessionStarts === undefined
      || this.#remainingSessionStarts < 1
    ) {
      this.#fail("session-start-limit-exhausted")
      return
    }
    const now = this.#clock()
    const cutoff = now - GATEWAY_DEFAULTS.identifyBudgetWindowMs
    while (this.#identifyTimes[0] !== undefined && this.#identifyTimes[0] < cutoff) {
      this.#identifyTimes.shift()
    }
    if (this.#identifyTimes.length >= GATEWAY_DEFAULTS.identifyBudget) {
      this.#fail("identify-budget-exhausted")
      return
    }
    const latest = this.#identifyTimes.at(-1)
    const wait = latest === undefined
      ? 0
      : Math.max(0, GATEWAY_DEFAULTS.identifyMinimumIntervalMs - (now - latest))
    if (wait > 0) {
      this.#identifyTimer = this.#scheduler.setTimeout(() => {
        this.#identifyTimer = undefined
        this.#scheduleIdentify()
      }, wait)
      return
    }
    this.#remainingSessionStarts -= 1
    this.#identifyTimes.push(now)
    this.#eventStore.recordIdentify()
    this.#send({
      d: {
        intents: this.#eventStore.eventFeedEnabled
          ? DISCORD_GATEWAY_INTENT_MASK
          : this.#eventStore.guildIntentRequired
            ? DISCORD_GATEWAY_INTENTS.guilds
            : 0,
        properties: {
          browser: CONNECTOR_NAME,
          device: CONNECTOR_NAME,
          os: process.platform,
        },
        token: this.#token,
      },
      op: GATEWAY_OPCODES.identify,
    })
  }

  #heartbeatTick(): void {
    this.#heartbeatTimer = undefined
    if (!this.#running || this.#terminal || this.#heartbeatIntervalMs === undefined) return
    if (this.#awaitingHeartbeatAck) {
      this.#requestReconnect({
        clearSession: false,
        errorCategory: "heartbeat-timeout",
      })
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
    if (this.#send({ d: this.#sequence, op: GATEWAY_OPCODES.heartbeat })) {
      this.#awaitingHeartbeatAck = true
    }
  }

  #onDispatch(payload: GatewayPayload): void {
    const sequence = safeInteger(payload.s)
    const eventName = typeof payload.t === "string" ? payload.t : undefined
    if (sequence === undefined || !eventName) {
      this.#fail("invalid-gateway-payload")
      return
    }
    this.#sequence = sequence
    if (eventName === "READY") {
      if (
        this.#resuming
        || this.#eventStore.getStatus().connection.state !== "authenticating"
      ) {
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
      this.#eventStore.transition("ready")
      return
    }
    if (!this.#resuming && this.#eventStore.getStatus().connection.state !== "ready") return
    if (eventName === "CHANNEL_INFO") {
      this.#onChannelInfo(payload.d, sequence)
      return
    }
    if (eventName === "VOICE_CHANNEL_STATUS_UPDATE") {
      this.#onVoiceChannelStatusUpdate(payload.d, sequence)
      return
    }
    if (eventName === "INTERACTION_CREATE" && this.#interactionHandler) {
      try {
        void Promise.resolve(this.#interactionHandler.ingestInteraction(payload.d))
          .catch(() => this.#logger("[gateway] native Interaction handling failed"))
      } catch {
        this.#logger("[gateway] native Interaction handling failed")
      }
      return
    }
    this.#eventStore.ingestDispatch(eventName, payload.d)
  }

  #onChannelInfo(data: unknown, sequence: number): void {
    const guildId = channelInfoGuildId(data)
    if (!guildId) {
      if (this.#pendingChannelInfo.size > 0) {
        this.#rejectPendingVoiceEvidence(
          "Discord Gateway returned malformed channel-info evidence",
        )
      }
      return
    }
    const pending = this.#pendingChannelInfo.get(guildId)
    if (!pending) return
    try {
      this.#finishChannelInfo(pending, projectGatewayVoiceChannelStatus({
        channelId: pending.channelId,
        gatewaySequence: sequence,
        guildId,
        observedAt: new Date(this.#clock()).toISOString(),
        requestedAt: pending.requestedAt,
        value: data,
      }))
    } catch (error) {
      this.#finishChannelInfo(
        pending,
        error instanceof Error
          ? error
          : new GatewayVoiceChannelStatusError(
            "Discord Gateway channel-info evidence could not be projected",
          ),
      )
    }
  }

  #onVoiceChannelStatusUpdate(data: unknown, sequence: number): void {
    const target = voiceChannelStatusUpdateTarget(data)
    if (!target || !this.#voiceChannelStatusIds.has(target.channelId)) return
    const key = voiceChannelStatusTargetKey(target.guildId, target.channelId)
    const waiters = this.#voiceChannelStatusUpdateWaiters.get(key)
    if (!waiters || waiters.size === 0) return
    let result: GatewayVoiceChannelStatusUpdate | Error
    try {
      result = projectGatewayVoiceChannelStatusUpdate({
        channelId: target.channelId,
        gatewaySequence: sequence,
        guildId: target.guildId,
        observedAt: new Date(this.#clock()).toISOString(),
        value: data,
      })
    } catch (error) {
      result = error instanceof Error
        ? error
        : new GatewayVoiceChannelStatusError(
          "Discord Gateway voice channel status update could not be projected",
        )
    }
    for (const pending of [...waiters]) this.#finishVoiceChannelStatusUpdate(pending, result)
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
      || !botId
      || !DISCORD_SNOWFLAKE_PATTERN.test(botId)
      || user?.bot !== true
      || botId !== this.#botId
    ) {
      this.#fail("invalid-ready-identity")
      return
    }
    if (!sessionId) {
      this.#fail("invalid-gateway-payload")
      return
    }
    const resumeUrl = normalizeGatewayResumeUrl(record?.resume_gateway_url)
    if (!resumeUrl) {
      this.#fail("invalid-resume-origin")
      return
    }
    this.#sessionId = sessionId
    this.#resumeUrl = resumeUrl
    this.#resuming = false
    this.#clearTimer("phase")
    this.#reconnectAttempt = 0
    this.#eventStore.transition("ready")
  }

  #onInvalidSession(value: unknown): void {
    if (typeof value !== "boolean") {
      this.#fail("invalid-gateway-payload")
      return
    }
    this.#resuming = false
    const delayMs = 1_000 + Math.floor(Math.min(1, Math.max(0, this.#random())) * 4_000)
    this.#requestReconnect({
      clearSession: !value,
      delayMs,
    })
  }

  #send(payload: object): boolean {
    const socket = this.#socket
    if (!socket || socket.readyState !== SOCKET_STATES.open) {
      this.#requestReconnect({
        clearSession: false,
        errorCategory: "network-error",
      })
      return false
    }
    try {
      socket.send(JSON.stringify(payload))
      return true
    } catch {
      this.#requestReconnect({
        clearSession: false,
        errorCategory: "network-error",
      })
      return false
    }
  }

  #requestReconnect(options: PendingReconnect): void {
    if (!this.#running || this.#terminal || this.#pendingReconnect) return
    this.#rejectPendingVoiceEvidence(
      "Discord Gateway continuity changed during voice channel status evidence collection",
    )
    this.#eventStore.suspendChannelLayoutsForResume()
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
    if (options.clearSession) {
      this.#clearSession(true)
    }
    this.#reconnectAttempt += 1
    this.#eventStore.recordReconnect()
    this.#eventStore.transition("reconnecting", options.errorCategory)
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
        : this.#gatewayUrl
      if (!target) {
        this.#fail("invalid-gateway-discovery")
        return
      }
      this.#connect(target)
    }, delayMs)
  }

  #fail(category: GatewayErrorCategory, closeSocket = true): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#rejectPendingVoiceEvidence(
      "Discord Gateway failed during voice channel status evidence collection",
    )
    this.#clearTimer("heartbeat")
    this.#clearTimer("identify")
    this.#clearTimer("phase")
    this.#clearTimer("reconnect")
    this.#clearSession(true)
    this.#eventStore.transition("failed", category)
    this.#logger(`[gateway] stopped: ${category}`)
    if (!closeSocket) return
    const socket = this.#socket
    if (!socket) return
    try {
      socket.close(RECONNECT_CLOSE_CODE, STATIC_RECONNECT_REASON)
    } catch {}
  }
}
