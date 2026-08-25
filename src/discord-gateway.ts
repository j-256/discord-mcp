import type { ConnectorConfig } from "./config.js"
import {
  DISCORD_GATEWAY_INTENT_MASK,
  DISCORD_GATEWAY_INTENTS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GATEWAY_DEFAULTS,
} from "./constants.js"
import { GatewayVoiceChannelStatusError } from "./errors.js"
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
import {
  GatewayEventStore,
  type GatewayChangeListener,
  type GatewayErrorCategory,
  type GatewayEventPage,
  type GatewayEventSource,
  type GatewayStatusSnapshot,
} from "./gateway-events.js"
import { GatewayIdentifyCoordinator } from "./gateway-identify-coordinator.js"
import {
  GatewayShardSession,
  type GatewayScheduler,
  type GatewayShardDispatch,
  type GatewayShardState,
  type GatewaySocket,
} from "./gateway-shard-session.js"
import {
  calculateGatewayShardId,
  deriveGatewayTopology,
  GatewayTopologyEvidenceError,
  validateGatewayChannelRoute,
  type GatewayChannelRoute,
  type GatewayTopology,
} from "./gateway-topology.js"
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
import { guildChannelLayoutGuildIds } from "./guild-channel-evidence.js"

export type { GatewayScheduler, GatewaySocket } from "./gateway-shard-session.js"

export interface GatewayRuntime extends GatewayEventSource, GatewayVoiceChannelStatusSource {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface GatewayInteractionHandler {
  ingestInteraction(payload: unknown): Promise<void> | void
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
    | "allowChannelCloneAudit"
    | "allowChannelMetadataChanges"
    | "allowChannelOrderingAudit"
    | "allowGuildSettingsAudit"
    | "allowGuildTemplateAudit"
    | "allowMemberRoleChanges"
    | "allowNativeInteractions"
    | "allowOnboardingAudit"
    | "channelCloneGuildIds"
    | "channelMetadataIds"
    | "channelOrderingGuildIds"
    | "guildSettingsGuildIds"
    | "guildTemplateGuildIds"
    | "memberRoleGuildIds"
    | "nativeInteractionGuildIds"
    | "onboardingGuildIds"
  >>
  discoverGateway: (signal: AbortSignal) => Promise<GatewayBotDiscovery>
  discoverGatewayChannel: (
    channelId: string,
    signal: AbortSignal,
  ) => Promise<GatewayChannelRoute>
  eventStore?: GatewayEventStore
  interactionHandler?: GatewayInteractionHandler
  logger?: (message: string) => void
  random?: () => number
  scheduler?: GatewayScheduler
  webSocketFactory?: (url: string) => GatewaySocket
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
  requestChannelInfo: 43,
})

const EVENT_FEED_DISPATCH_NAMES: ReadonlySet<string> = new Set([
  "CHANNEL_CREATE",
  "CHANNEL_DELETE",
  "CHANNEL_PINS_UPDATE",
  "CHANNEL_UPDATE",
  "GUILD_CREATE",
  "GUILD_DELETE",
  "GUILD_ROLE_CREATE",
  "GUILD_ROLE_DELETE",
  "GUILD_ROLE_UPDATE",
  "GUILD_SOUNDBOARD_SOUND_CREATE",
  "GUILD_SOUNDBOARD_SOUND_DELETE",
  "GUILD_SOUNDBOARD_SOUND_UPDATE",
  "GUILD_SOUNDBOARD_SOUNDS_UPDATE",
  "GUILD_UPDATE",
  "MESSAGE_CREATE",
  "MESSAGE_DELETE",
  "MESSAGE_DELETE_BULK",
  "MESSAGE_POLL_VOTE_ADD",
  "MESSAGE_POLL_VOTE_REMOVE",
  "MESSAGE_REACTION_ADD",
  "MESSAGE_REACTION_REMOVE",
  "MESSAGE_REACTION_REMOVE_ALL",
  "MESSAGE_REACTION_REMOVE_EMOJI",
  "MESSAGE_UPDATE",
  "STAGE_INSTANCE_CREATE",
  "STAGE_INSTANCE_DELETE",
  "STAGE_INSTANCE_UPDATE",
  "THREAD_CREATE",
  "THREAD_DELETE",
  "THREAD_LIST_SYNC",
  "THREAD_MEMBERS_UPDATE",
  "THREAD_UPDATE",
])

const LAYOUT_DISPATCH_NAMES: ReadonlySet<string> = new Set([
  "CHANNEL_CREATE",
  "CHANNEL_DELETE",
  "CHANNEL_UPDATE",
  "GUILD_CREATE",
  "GUILD_DELETE",
])

const ROOT_GUILD_ID_DISPATCH_NAMES: ReadonlySet<string> = new Set([
  "GUILD_CREATE",
  "GUILD_DELETE",
  "GUILD_UPDATE",
])

const NON_GUILD_DISPATCH_NAMES: ReadonlySet<string> = new Set([
  "CHANNEL_CREATE",
  "CHANNEL_DELETE",
  "CHANNEL_PINS_UPDATE",
  "CHANNEL_UPDATE",
  "INTERACTION_CREATE",
  "MESSAGE_CREATE",
  "MESSAGE_DELETE",
  "MESSAGE_POLL_VOTE_ADD",
  "MESSAGE_POLL_VOTE_REMOVE",
  "MESSAGE_REACTION_ADD",
  "MESSAGE_REACTION_REMOVE",
  "MESSAGE_REACTION_REMOVE_ALL",
  "MESSAGE_REACTION_REMOVE_EMOJI",
  "MESSAGE_UPDATE",
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

function positiveSnowflake(value: unknown): value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) return false
  try {
    const parsed = BigInt(value)
    return parsed > 0n && parsed <= DISCORD_SNOWFLAKE_MAX
  } catch {
    return false
  }
}

function voiceChannelStatusTargetKey(guildId: string, channelId: string): string {
  return `${guildId}\0${channelId}`
}

function dispatchGuildId(name: string, data: unknown): string | null | undefined {
  const record = recordValue(data)
  if (!record) return undefined
  if (ROOT_GUILD_ID_DISPATCH_NAMES.has(name)) {
    return positiveSnowflake(record.id) ? record.id : undefined
  }
  if (record.guild_id === undefined && NON_GUILD_DISPATCH_NAMES.has(name)) return null
  return positiveSnowflake(record.guild_id) ? record.guild_id : undefined
}

export function normalizeGatewayResumeUrl(value: unknown): string | undefined {
  return normalizeDiscordGatewayUrl(value)
}

export class DiscordGateway implements GatewayRuntime {
  readonly #applicationId: string
  readonly #botId: string
  readonly #channelGuildIds = new Map<string, string>()
  readonly #clock: () => number
  readonly #discoverGateway: (signal: AbortSignal) => Promise<GatewayBotDiscovery>
  readonly #discoverGatewayChannel: DiscordGatewayOptions["discoverGatewayChannel"]
  readonly #eventFeedEnabled: boolean
  readonly #eventStore: GatewayEventStore
  #identifyCoordinator: GatewayIdentifyCoordinator | undefined
  readonly #interactionHandler: GatewayInteractionHandler | undefined
  readonly #knownGuildIds: ReadonlySet<string>
  readonly #logger: (message: string) => void
  readonly #nativeInteractionsEnabled: boolean
  readonly #pendingChannelInfo = new Map<string, PendingChannelInfo>()
  readonly #random: () => number
  readonly #routeChannelIds: ReadonlySet<string>
  #running = false
  readonly #scheduler: GatewayScheduler
  readonly #sessions = new Map<number, GatewayShardSession>()
  readonly #shardStates = new Map<number, GatewayShardState>()
  #startupAbort: AbortController | undefined
  #startupGeneration = 0
  #terminal = false
  readonly #token: string
  #topology: GatewayTopology | undefined
  readonly #voiceChannelStatusIds: ReadonlySet<string>
  readonly #voiceChannelStatusQueueTails = new Map<string, Promise<void>>()
  readonly #voiceChannelStatusUpdateWaiters = new Map<
    string,
    Set<PendingVoiceChannelStatusUpdate>
  >()
  readonly #webSocketFactory: (url: string) => GatewaySocket
  readonly voiceChannelStatusEnabled: boolean

  constructor(options: DiscordGatewayOptions) {
    if (!positiveSnowflake(options.applicationId)) {
      throw new RangeError("Gateway application ID must be a Discord snowflake")
    }
    const botId = options.config.expectedBotId
    if (!positiveSnowflake(botId)) {
      throw new RangeError("Gateway bot ID must be a Discord snowflake")
    }
    if (!options.config.token.trim()) throw new RangeError("Gateway token must not be empty")
    if (
      typeof options.discoverGateway !== "function"
      || typeof options.discoverGatewayChannel !== "function"
    ) {
      throw new RangeError("Gateway discovery providers are required")
    }
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
    const nativeInteractionsEnabled = options.config.allowNativeInteractions === true
    const connectionEnabled = options.config.allowGateway
      || layoutGuildIds.size > 0
      || nativeInteractionsEnabled
      || voiceChannelStatusEnabled
    const knownGuildIds = new Set(layoutGuildIds)
    const routeChannelIds = new Set<string>()
    if (options.config.allowGateway) {
      if (options.config.allowedGuildIds.size > 0) {
        for (const guildId of options.config.allowedGuildIds) knownGuildIds.add(guildId)
      } else {
        for (const channelId of options.config.allowedChannelIds) routeChannelIds.add(channelId)
      }
    }
    if (nativeInteractionsEnabled) {
      for (const guildId of options.config.nativeInteractionGuildIds ?? []) {
        knownGuildIds.add(guildId)
      }
    }
    for (const channelId of voiceChannelStatusIds) routeChannelIds.add(channelId)
    if (connectionEnabled && knownGuildIds.size === 0 && routeChannelIds.size === 0) {
      throw new RangeError("Enabled Discord Gateway requires exact routing scope")
    }

    this.#applicationId = options.applicationId
    this.#botId = botId
    this.#clock = options.clock || Date.now
    this.#discoverGateway = options.discoverGateway
    this.#discoverGatewayChannel = options.discoverGatewayChannel
    this.#eventFeedEnabled = options.config.allowGateway
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
    this.#knownGuildIds = knownGuildIds
    this.#logger = options.logger || (() => undefined)
    this.#nativeInteractionsEnabled = nativeInteractionsEnabled
    this.#random = options.random || Math.random
    this.#routeChannelIds = routeChannelIds
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
    try {
      this.#requireReadyVoiceSession(guildId, channelId)
    } catch (error) {
      return Promise.reject(error)
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
    this.#startupAbort = controller
    this.#eventStore.transition("discovering")

    let discovery: GatewayBotDiscovery
    try {
      const response = await this.#discoverGateway(controller.signal)
      if (!this.#startupActive(generation)) return
      discovery = validateGatewayBotDiscovery(response)
    } catch (error) {
      if (!this.#startupActive(generation)) return
      this.#fail(error instanceof GatewayDiscoveryEvidenceError
        ? "invalid-gateway-discovery"
        : "gateway-discovery-failed")
      return
    }
    if (!this.#startupActive(generation)) return
    this.#eventStore.recordDiscovery({
      recommendedShards: discovery.shards,
      sessionStartLimit: discovery.sessionStartLimit,
    })
    if (discovery.sessionStartLimit.remaining === 0) {
      this.#fail("session-start-limit-exhausted")
      return
    }

    this.#eventStore.transition("resolving-scope")
    let topology: GatewayTopology
    try {
      const channelRoutes = await this.#resolveChannelRoutes(controller.signal)
      if (!this.#startupActive(generation)) return
      topology = deriveGatewayTopology({
        channelRoutes,
        guildIds: this.#knownGuildIds,
        recommendedShards: discovery.shards,
      })
      this.#eventStore.recordTopology(topology.summary)
    } catch (error) {
      if (!this.#startupActive(generation)) return
      this.#fail(error instanceof GatewayTopologyEvidenceError
        ? "invalid-gateway-scope-evidence"
        : "gateway-scope-discovery-failed")
      return
    }
    if (!this.#startupActive(generation)) return
    this.#startupAbort = undefined
    if (discovery.sessionStartLimit.remaining < topology.activeShardIds.length) {
      this.#fail("session-start-limit-insufficient")
      return
    }

    this.#topology = topology
    this.#channelGuildIds.clear()
    for (const [channelId, guildId] of topology.channelGuildIds) {
      this.#channelGuildIds.set(channelId, guildId)
    }
    const identifyCoordinator = new GatewayIdentifyCoordinator({
      clock: this.#clock,
      maxConcurrency: discovery.sessionStartLimit.maxConcurrency,
      onFailure: (category) => this.#fail(category),
      onIdentify: () => this.#eventStore.recordIdentify(),
      remaining: discovery.sessionStartLimit.remaining,
      scheduler: this.#scheduler,
      shardCount: topology.summary.recommendedShards,
      shardIds: topology.activeShardIds,
    })
    this.#identifyCoordinator = identifyCoordinator
    const intents = this.#eventFeedEnabled
      ? DISCORD_GATEWAY_INTENT_MASK
      : this.#eventStore.guildIntentRequired
        ? DISCORD_GATEWAY_INTENTS.guilds
        : 0

    try {
      for (const shardId of topology.activeShardIds) {
        const session = new GatewayShardSession({
          applicationId: this.#applicationId,
          botId: this.#botId,
          gatewayUrl: discovery.url,
          identifyCoordinator,
          intents,
          onContinuityGap: () => this.#onShardContinuityGap(),
          onDispatch: (dispatch) => this.#onShardDispatch(dispatch),
          onFatal: (_failedShardId, category) => this.#fail(category),
          onReconnect: () => this.#onShardReconnect(),
          onResume: () => this.#onShardResume(),
          onState: (changedShardId, state, category) => {
            this.#onShardState(changedShardId, state, category)
          },
          random: this.#random,
          scheduler: this.#scheduler,
          shardCount: topology.summary.recommendedShards,
          shardId,
          token: this.#token,
          webSocketFactory: this.#webSocketFactory,
        })
        this.#sessions.set(shardId, session)
        this.#shardStates.set(shardId, "stopped")
      }
    } catch {
      this.#fail("invalid-gateway-scope-evidence")
      return
    }
    for (const session of this.#sessions.values()) {
      if (!this.#running || this.#terminal) break
      session.start()
    }
  }

  async stop(): Promise<void> {
    this.#running = false
    this.#startupGeneration += 1
    this.#startupAbort?.abort()
    this.#startupAbort = undefined
    this.#identifyCoordinator?.stop()
    this.#identifyCoordinator = undefined
    this.#rejectPendingVoiceEvidence("Discord Gateway voice channel status evidence stopped")
    for (const session of this.#sessions.values()) session.stop()
    this.#sessions.clear()
    this.#shardStates.clear()
    this.#channelGuildIds.clear()
    this.#topology = undefined
    this.#terminal = false
    if (this.enabled) this.#eventStore.transition("stopped")
  }

  #startupActive(generation: number): boolean {
    return this.#running
      && !this.#terminal
      && this.#startupGeneration === generation
  }

  async #resolveChannelRoutes(signal: AbortSignal): Promise<GatewayChannelRoute[]> {
    const channelIds = [...this.#routeChannelIds].sort()
    if (channelIds.length === 0) return []
    const routes = new Map<string, GatewayChannelRoute>()
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < channelIds.length) {
        if (signal.aborted) throw new Error("Gateway scope discovery was cancelled")
        const index = nextIndex
        nextIndex += 1
        const channelId = channelIds[index]!
        const route = await this.#discoverGatewayChannel(channelId, signal)
        routes.set(channelId, validateGatewayChannelRoute(route, channelId))
      }
    }
    const workerCount = Math.min(GATEWAY_DEFAULTS.channelRouteConcurrency, channelIds.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return channelIds.map((channelId) => {
      const route = routes.get(channelId)
      if (!route) throw new GatewayTopologyEvidenceError()
      return route
    })
  }

  #onShardState(
    shardId: number,
    state: GatewayShardState,
    errorCategory?: GatewayErrorCategory,
  ): void {
    if (!this.#running || this.#terminal || !this.#sessions.has(shardId)) return
    this.#shardStates.set(shardId, state)
    if (state === "failed" || state === "stopped") return
    this.#syncAggregateState(errorCategory)
  }

  #syncAggregateState(errorCategory?: GatewayErrorCategory): void {
    if (!this.#running || this.#terminal || this.#shardStates.size === 0) return
    const states = [...this.#shardStates.values()]
    if (states.every((state) => state === "ready")) {
      this.#eventStore.transition("ready")
      return
    }
    const current = this.#eventStore.getStatus().connection.state
    if (
      current === "ready"
      || current === "reconnecting"
      || states.some((state) => state === "reconnecting")
    ) {
      this.#eventStore.transition("reconnecting", errorCategory)
      return
    }
    if (states.some((state) => state === "connecting" || state === "stopped")) {
      this.#eventStore.transition("connecting", errorCategory)
      return
    }
    this.#eventStore.transition("authenticating", errorCategory)
  }

  #onShardReconnect(): void {
    if (!this.#running || this.#terminal) return
    this.#rejectPendingVoiceEvidence(
      "Discord Gateway continuity changed during voice channel status evidence collection",
    )
    this.#eventStore.recordReconnect()
  }

  #onShardResume(): void {
    if (!this.#running || this.#terminal) return
    this.#eventStore.recordResume()
  }

  #onShardContinuityGap(): void {
    if (!this.#running || this.#terminal) return
    this.#rejectPendingVoiceEvidence(
      "Discord Gateway continuity changed during voice channel status evidence collection",
    )
    this.#eventStore.recordContinuityGap()
  }

  #acceptsDispatch(name: string): boolean {
    return (this.#eventFeedEnabled && EVENT_FEED_DISPATCH_NAMES.has(name))
      || (this.layoutEnabled && LAYOUT_DISPATCH_NAMES.has(name))
      || (this.#nativeInteractionsEnabled && name === "INTERACTION_CREATE")
      || (this.voiceChannelStatusEnabled && (
        name === "CHANNEL_INFO" || name === "VOICE_CHANNEL_STATUS_UPDATE"
      ))
  }

  #onShardDispatch(dispatch: GatewayShardDispatch): void {
    const topology = this.#topology
    if (!this.#running || this.#terminal || !topology || !this.#acceptsDispatch(dispatch.name)) {
      return
    }
    const guildId = dispatchGuildId(dispatch.name, dispatch.data)
    if (guildId === null) return
    if (!guildId) {
      this.#fail("invalid-shard-routing")
      return
    }
    let expectedShardId: number
    try {
      expectedShardId = calculateGatewayShardId(
        guildId,
        topology.summary.recommendedShards,
      )
    } catch {
      this.#fail("invalid-shard-routing")
      return
    }
    if (expectedShardId !== dispatch.shardId) {
      this.#fail("invalid-shard-routing")
      return
    }
    if (dispatch.name === "CHANNEL_INFO") {
      this.#onChannelInfo(dispatch.data, dispatch.sequence)
      return
    }
    if (dispatch.name === "VOICE_CHANNEL_STATUS_UPDATE") {
      this.#onVoiceChannelStatusUpdate(dispatch.data, dispatch.sequence)
      return
    }
    if (dispatch.name === "INTERACTION_CREATE" && this.#interactionHandler) {
      try {
        void Promise.resolve(this.#interactionHandler.ingestInteraction(dispatch.data))
          .catch(() => this.#logger("[gateway] native Interaction handling failed"))
      } catch {
        this.#logger("[gateway] native Interaction handling failed")
      }
      return
    }
    this.#eventStore.ingestDispatch(dispatch.name, dispatch.data)
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

  #requireReadyVoiceSession(guildId: string, channelId: string): GatewayShardSession {
    if (
      !this.#running
      || this.#terminal
      || this.#eventStore.getStatus().connection.state !== "ready"
      || !this.#topology
    ) {
      throw new GatewayVoiceChannelStatusError(
        "Discord Gateway is not ready for voice channel status evidence",
      )
    }
    if (this.#channelGuildIds.get(channelId) !== guildId) {
      throw new GatewayVoiceChannelStatusError(
        "Discord Gateway voice channel status target does not match its exact guild route",
      )
    }
    let shardId: number
    try {
      shardId = calculateGatewayShardId(guildId, this.#topology.summary.recommendedShards)
    } catch {
      this.#fail("invalid-shard-routing")
      throw new GatewayVoiceChannelStatusError(
        "Discord Gateway could not route voice channel status evidence",
      )
    }
    const session = this.#sessions.get(shardId)
    if (!session || session.state !== "ready") {
      this.#fail("invalid-shard-routing")
      throw new GatewayVoiceChannelStatusError(
        "Discord Gateway could not route voice channel status evidence",
      )
    }
    return session
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
    const session = this.#requireReadyVoiceSession(guildId, channelId)
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
      if (!session.send({
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

  #fail(category: GatewayErrorCategory): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#startupGeneration += 1
    this.#startupAbort?.abort()
    this.#startupAbort = undefined
    this.#identifyCoordinator?.stop()
    this.#identifyCoordinator = undefined
    this.#rejectPendingVoiceEvidence(
      "Discord Gateway failed during voice channel status evidence collection",
    )
    for (const session of this.#sessions.values()) session.stop()
    this.#sessions.clear()
    this.#shardStates.clear()
    this.#channelGuildIds.clear()
    this.#topology = undefined
    this.#eventStore.transition("failed", category)
    this.#logger(`[gateway] stopped: ${category}`)
  }
}
