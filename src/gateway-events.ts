import { randomBytes } from "node:crypto"

import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  GATEWAY_DEFAULTS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  GatewayChannelLayoutStore,
  type GatewayChannelLayoutListener,
  type GatewayChannelLayoutSnapshot,
  type GatewayChannelLayoutSource,
  type GatewayChannelLayoutStatus,
} from "./gateway-channel-layout.js"

export const GATEWAY_EVENT_KINDS = [
  "channel-created",
  "channel-deleted",
  "channel-pins-updated",
  "channel-updated",
  "guild-deleted",
  "guild-unavailable",
  "guild-updated",
  "message-bulk-deleted",
  "message-created",
  "message-deleted",
  "message-updated",
  "poll-vote-added",
  "poll-vote-removed",
  "reaction-added",
  "reaction-cleared",
  "reaction-emoji-cleared",
  "reaction-removed",
  "role-created",
  "role-deleted",
  "role-updated",
  "soundboard-sound-created",
  "soundboard-sound-deleted",
  "soundboard-sound-updated",
  "soundboard-sounds-updated",
  "stage-instance-created",
  "stage-instance-deleted",
  "stage-instance-updated",
  "thread-created",
  "thread-deleted",
  "thread-members-changed",
  "thread-updated",
] as const

export type GatewayEventKind = typeof GATEWAY_EVENT_KINDS[number]

export type GatewayConnectionState =
  | "authenticating"
  | "connecting"
  | "disabled"
  | "failed"
  | "ready"
  | "reconnecting"
  | "stopped"

export type GatewayErrorCategory =
  | "authentication-failed"
  | "authentication-timeout"
  | "connection-timeout"
  | "disallowed-intents"
  | "heartbeat-timeout"
  | "identify-budget-exhausted"
  | "invalid-api-version"
  | "invalid-gateway-payload"
  | "invalid-intents"
  | "invalid-ready-identity"
  | "invalid-resume-origin"
  | "invalid-shard"
  | "network-error"
  | "protocol-error"
  | "rate-limited"
  | "sharding-required"
  | "unknown-fatal-close"

export type GatewayChangeKind = "events" | "layout" | "status"
export type GatewayChangeListener = (kind: GatewayChangeKind) => void

export interface ContentFreeGatewayEvent {
  channelId?: string
  cursor: string
  guildId: string
  kind: GatewayEventKind
  messageId?: string
  messageIds?: string[]
  parentChannelId?: string
  receivedAt: string
  roleId?: string
  soundId?: string
  soundIds?: string[]
  stageInstanceId?: string
}

export type GatewayCursorResetReason =
  | "ahead-cursor"
  | "connection-gap"
  | "expired-cursor"
  | "foreign-cursor"
  | "invalid-cursor"

export interface GatewayEventPage {
  events: ContentFreeGatewayEvent[]
  page: {
    afterCursor: string | null
    available: number
    hasMore: boolean
    nextCursor: string
    resetReason: GatewayCursorResetReason | null
    resetRequired: boolean
    returned: number
  }
  schemaVersion: number
  status: "disabled" | "ok"
}

export interface GatewayStatusSnapshot {
  buffer: {
    capacity: number
    continuityGaps: number
    dropped: number
    size: number
    totalAccepted: number
  }
  connection: {
    connectedAt: string | null
    identifies: number
    lastError: {
      at: string
      category: GatewayErrorCategory
    } | null
    readyAt: string | null
    reconnects: number
    resumes: number
    state: GatewayConnectionState
  }
  enabled: boolean
  feedEnabled: boolean
  intents: readonly (
    | "GUILDS"
    | "GUILD_MESSAGES"
    | "GUILD_MESSAGE_REACTIONS"
    | "GUILD_MESSAGE_POLLS"
  )[]
  layout: GatewayChannelLayoutStatus
  privacy: {
    contentStored: false
    persistent: false
    privilegedIntentsRequested: false
  }
  schemaVersion: number
  status: "ok"
}

export interface GatewayEventSource extends GatewayChannelLayoutSource {
  readonly enabled: boolean
  getStatus(): GatewayStatusSnapshot
  listEvents(options?: {
    afterCursor?: string
    limit?: number
  }): GatewayEventPage
  subscribe(listener: GatewayChangeListener): () => void
}

export interface GatewayEventStoreOptions {
  allowedChannelIds: ReadonlySet<string>
  allowedGuildIds: ReadonlySet<string>
  bufferSize?: number
  clock?: () => Date
  cursorNamespace?: string
  enabled: boolean
  eventFeedEnabled?: boolean
  layoutGuildIds?: ReadonlySet<string>
}

interface StoredGatewayEvent extends ContentFreeGatewayEvent {
  position: number
}

interface ChannelMapping {
  guildId: string
  parentChannelId: string | null
}

interface EventFields {
  channelId?: string
  guildId: string
  kind: GatewayEventKind
  messageId?: string
  messageIds?: string[]
  parentChannelId?: string
  roleId?: string
  soundId?: string
  soundIds?: string[]
  stageInstanceId?: string
}

const CURSOR_NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const CURSOR_PATTERN = /^gw1\.([A-Za-z0-9_-]{8,64})\.([0-9]+)\.([0-9]+)$/
const THREAD_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function snowflake(value: unknown): string | undefined {
  return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value)
    ? value
    : undefined
}

function snowflakeList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return undefined
  const ids = value.map(snowflake)
  if (ids.some((id) => !id)) return undefined
  return [...new Set(ids as string[])].sort()
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

function soundboardSoundIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.soundboardSounds) {
    return undefined
  }
  const ids = value.map((entry) => snowflake(recordValue(entry)?.sound_id))
  if (ids.some((id) => !id)) return undefined
  const unique = new Set(ids as string[])
  if (unique.size !== ids.length) return undefined
  return [...unique].sort()
}

function channelFields(value: unknown, fallbackGuildId?: string): {
  guildId: string
  id: string
  parentChannelId: string | null
  thread: boolean
} | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const explicitGuildId = snowflake(record.guild_id)
  if (fallbackGuildId && explicitGuildId && explicitGuildId !== fallbackGuildId) {
    return undefined
  }
  const guildId = explicitGuildId || fallbackGuildId
  const id = snowflake(record.id)
  const type = integerValue(record.type)
  if (!guildId || !id || type === undefined) return undefined
  const rawParent = record.parent_id
  const parentChannelId = rawParent === null || rawParent === undefined
    ? null
    : snowflake(rawParent)
  if (rawParent !== null && rawParent !== undefined && !parentChannelId) return undefined
  return {
    guildId,
    id,
    parentChannelId: parentChannelId ?? null,
    thread: THREAD_TYPES.has(type),
  }
}

export class GatewayEventStore implements GatewayEventSource {
  readonly #allowedChannelIds: ReadonlySet<string>
  readonly #allowedGuildIds: ReadonlySet<string>
  readonly #bufferSize: number
  readonly #channels = new Map<string, ChannelMapping>()
  readonly #clock: () => Date
  readonly #channelLayouts: GatewayChannelLayoutStore
  #connectedAt: string | null = null
  #continuityGaps = 0
  readonly #cursorNamespace: string
  #dropped = 0
  readonly #events: StoredGatewayEvent[] = []
  #generation = 0
  #identifies = 0
  #lastError: GatewayStatusSnapshot["connection"]["lastError"] = null
  readonly #listeners = new Set<GatewayChangeListener>()
  #position = 0
  #readyAt: string | null = null
  #reconnects = 0
  #resumes = 0
  #state: GatewayConnectionState
  readonly enabled: boolean
  readonly eventFeedEnabled: boolean
  readonly layoutEnabled: boolean

  constructor(options: GatewayEventStoreOptions) {
    const bufferSize = options.bufferSize ?? GATEWAY_DEFAULTS.eventBufferSize
    if (
      !Number.isInteger(bufferSize)
      || bufferSize < 1
      || bufferSize > CONNECTOR_LIMITS.gatewayEventBufferSize
    ) {
      throw new RangeError(
        `Gateway event buffer size must be between 1 and ${CONNECTOR_LIMITS.gatewayEventBufferSize}`,
      )
    }
    const cursorNamespace = options.cursorNamespace || randomBytes(12).toString("base64url")
    if (!CURSOR_NAMESPACE_PATTERN.test(cursorNamespace)) {
      throw new RangeError("Gateway cursor namespace must contain 8-64 URL-safe characters")
    }
    const eventFeedEnabled = options.eventFeedEnabled ?? options.enabled
    if (eventFeedEnabled && !options.enabled) {
      throw new RangeError("Gateway event feed requires an enabled Gateway connection")
    }
    if (
      eventFeedEnabled
      && options.allowedGuildIds.size === 0
      && options.allowedChannelIds.size === 0
    ) {
      throw new RangeError("Enabled Gateway events require an exact guild or channel scope")
    }
    const clock = options.clock || (() => new Date())
    const layoutGuildIds = options.layoutGuildIds
      ?? (eventFeedEnabled ? options.allowedGuildIds : new Set<string>())
    this.enabled = options.enabled
    this.eventFeedEnabled = eventFeedEnabled
    this.#allowedChannelIds = new Set(options.allowedChannelIds)
    this.#allowedGuildIds = new Set(options.allowedGuildIds)
    this.#bufferSize = bufferSize
    this.#clock = clock
    this.#channelLayouts = new GatewayChannelLayoutStore({
      clock,
      enabled: options.enabled,
      guildIds: layoutGuildIds,
    })
    this.layoutEnabled = this.#channelLayouts.layoutEnabled
    this.#cursorNamespace = cursorNamespace
    this.#state = options.enabled ? "stopped" : "disabled"
  }

  #timestamp(): string {
    return this.#clock().toISOString()
  }

  #cursor(position: number): string {
    return `gw1.${this.#cursorNamespace}.${this.#generation}.${position}`
  }

  #emit(kind: GatewayChangeKind): void {
    for (const listener of this.#listeners) {
      try {
        listener(kind)
      } catch {}
    }
  }

  #guildAllowed(guildId: string): boolean {
    return this.#allowedGuildIds.size === 0 || this.#allowedGuildIds.has(guildId)
  }

  #guildEventAllowed(guildId: string): boolean {
    if (this.#allowedGuildIds.has(guildId)) return true
    for (const mapping of this.#channels.values()) {
      if (mapping.guildId === guildId) return true
    }
    return false
  }

  #channelAllowed(channelId: string, parentChannelId: string | null): boolean {
    return this.#allowedChannelIds.size === 0
      || this.#allowedChannelIds.has(channelId)
      || Boolean(parentChannelId && this.#allowedChannelIds.has(parentChannelId))
  }

  #mapping(channelId: string, guildId: string): ChannelMapping | undefined {
    const mapping = this.#channels.get(channelId)
    return mapping?.guildId === guildId ? mapping : undefined
  }

  #rememberChannel(fields: ReturnType<typeof channelFields>): void {
    if (!fields) return
    const parentChannelId = fields.thread ? fields.parentChannelId : null
    if (
      !this.#guildAllowed(fields.guildId)
      || !this.#channelAllowed(fields.id, parentChannelId)
    ) {
      this.#channels.delete(fields.id)
      return
    }
    if (!this.#channels.has(fields.id) && this.#channels.size >= CONNECTOR_LIMITS.gatewayChannelMappings) {
      return
    }
    this.#channels.set(fields.id, {
      guildId: fields.guildId,
      parentChannelId,
    })
  }

  #forgetChannel(channelId: string): void {
    this.#channels.delete(channelId)
    for (const [id, mapping] of this.#channels) {
      if (mapping.parentChannelId === channelId) this.#channels.delete(id)
    }
  }

  #forgetGuild(guildId: string): void {
    for (const [channelId, mapping] of this.#channels) {
      if (mapping.guildId === guildId) this.#channels.delete(channelId)
    }
  }

  #append(fields: EventFields): void {
    this.#position += 1
    const event: StoredGatewayEvent = {
      cursor: this.#cursor(this.#position),
      guildId: fields.guildId,
      kind: fields.kind,
      position: this.#position,
      receivedAt: this.#timestamp(),
      ...(fields.channelId ? { channelId: fields.channelId } : {}),
      ...(fields.messageId ? { messageId: fields.messageId } : {}),
      ...(fields.messageIds ? { messageIds: [...fields.messageIds] } : {}),
      ...(fields.parentChannelId ? { parentChannelId: fields.parentChannelId } : {}),
      ...(fields.roleId ? { roleId: fields.roleId } : {}),
      ...(fields.soundId ? { soundId: fields.soundId } : {}),
      ...(fields.soundIds ? { soundIds: [...fields.soundIds] } : {}),
      ...(fields.stageInstanceId ? { stageInstanceId: fields.stageInstanceId } : {}),
    }
    this.#events.push(event)
    if (this.#events.length > this.#bufferSize) {
      this.#events.shift()
      this.#dropped += 1
    }
    this.#emit("events")
    this.#emit("status")
  }

  #channelEvent(
    kind: GatewayEventKind,
    raw: unknown,
    options: { forget?: boolean; threadOnly?: boolean } = {},
  ): boolean {
    const parsed = channelFields(raw)
    if (!parsed || (options.threadOnly && !parsed.thread)) {
      const channelId = snowflake(recordValue(raw)?.id)
      if (channelId) this.#forgetChannel(channelId)
      return false
    }
    const previous = this.#mapping(parsed.id, parsed.guildId)
    const parentChannelId = parsed.thread
      ? parsed.parentChannelId
      : previous?.parentChannelId || null
    this.#rememberChannel(parsed)
    const allowed = this.#guildAllowed(parsed.guildId)
      && this.#channelAllowed(parsed.id, parentChannelId)
    if (options.forget) this.#forgetChannel(parsed.id)
    if (!allowed) return false
    this.#append({
      channelId: parsed.id,
      guildId: parsed.guildId,
      kind,
      ...(parentChannelId ? { parentChannelId } : {}),
    })
    return true
  }

  #messageEvent(kind: GatewayEventKind, raw: unknown): boolean {
    const record = recordValue(raw)
    if (!record) return false
    const guildId = snowflake(record.guild_id)
    const channelId = snowflake(record.channel_id)
    const messageId = snowflake(record.id) || snowflake(record.message_id)
    if (!guildId || !channelId || !messageId || !this.#guildAllowed(guildId)) return false
    const parentChannelId = this.#mapping(channelId, guildId)?.parentChannelId || null
    if (!this.#channelAllowed(channelId, parentChannelId)) return false
    this.#append({
      channelId,
      guildId,
      kind,
      messageId,
      ...(parentChannelId ? { parentChannelId } : {}),
    })
    return true
  }

  #channelOnlyEvent(kind: GatewayEventKind, raw: unknown): boolean {
    const record = recordValue(raw)
    if (!record) return false
    const guildId = snowflake(record.guild_id)
    const channelId = snowflake(record.channel_id) || snowflake(record.id)
    if (!guildId || !channelId || !this.#guildAllowed(guildId)) return false
    const parentChannelId = this.#mapping(channelId, guildId)?.parentChannelId || null
    if (!this.#channelAllowed(channelId, parentChannelId)) return false
    this.#append({
      channelId,
      guildId,
      kind,
      ...(parentChannelId ? { parentChannelId } : {}),
    })
    return true
  }

  #seedChannels(raw: unknown, guildId: string): void {
    if (!Array.isArray(raw)) return
    for (const value of raw.slice(0, CONNECTOR_LIMITS.gatewayChannelMappings)) {
      this.#rememberChannel(channelFields(value, guildId))
    }
  }

  #seedGuild(raw: unknown): void {
    const record = recordValue(raw)
    const guildId = snowflake(record?.id)
    if (!record || !guildId || !this.#guildAllowed(guildId)) return
    this.#seedChannels(record.channels, guildId)
    this.#seedChannels(record.threads, guildId)
  }

  #seedThreads(raw: unknown): void {
    const record = recordValue(raw)
    const guildId = snowflake(record?.guild_id)
    if (!record || !guildId || !this.#guildAllowed(guildId)) return
    this.#seedChannels(record.threads, guildId)
  }

  #guildEvent(kind: GatewayEventKind, raw: unknown): boolean {
    const record = recordValue(raw)
    const guildId = snowflake(record?.id) || snowflake(record?.guild_id)
    if (!guildId || !this.#guildEventAllowed(guildId)) return false
    this.#append({ guildId, kind })
    return true
  }

  #roleEvent(kind: GatewayEventKind, raw: unknown): boolean {
    const record = recordValue(raw)
    const role = recordValue(record?.role)
    const guildId = snowflake(record?.guild_id)
    const roleId = snowflake(role?.id) || snowflake(record?.role_id)
    if (!guildId || !roleId || !this.#guildEventAllowed(guildId)) return false
    this.#append({ guildId, kind, roleId })
    return true
  }

  #stageInstanceEvent(kind: GatewayEventKind, raw: unknown): boolean {
    const record = recordValue(raw)
    const guildId = snowflake(record?.guild_id)
    const channelId = snowflake(record?.channel_id)
    const stageInstanceId = snowflake(record?.id)
    if (
      !guildId
      || !channelId
      || !stageInstanceId
      || !this.#guildAllowed(guildId)
      || !this.#channelAllowed(channelId, null)
    ) return false
    this.#append({
      channelId,
      guildId,
      kind,
      stageInstanceId,
    })
    return true
  }

  #soundboardSoundEvent(kind: GatewayEventKind, raw: unknown): boolean {
    const record = recordValue(raw)
    const guildId = snowflake(record?.guild_id)
    const soundId = snowflake(record?.sound_id)
    if (!guildId || !soundId || !this.#guildEventAllowed(guildId)) return false
    this.#append({ guildId, kind, soundId })
    return true
  }

  #soundboardSoundsEvent(raw: unknown): boolean {
    const record = recordValue(raw)
    const guildId = snowflake(record?.guild_id)
    const soundIds = soundboardSoundIds(record?.soundboard_sounds)
    if (!guildId || !soundIds || !this.#guildEventAllowed(guildId)) return false
    this.#append({
      guildId,
      kind: "soundboard-sounds-updated",
      soundIds,
    })
    return true
  }

  ingestDispatch(name: string, raw: unknown): boolean {
    if (this.#channelLayouts.ingestDispatch(name, raw)) {
      this.#emit("layout")
      this.#emit("status")
    }
    if (!this.eventFeedEnabled) return false
    switch (name) {
      case "GUILD_CREATE":
        this.#seedGuild(raw)
        return false
      case "THREAD_LIST_SYNC":
        this.#seedThreads(raw)
        return false
      case "GUILD_UPDATE":
        return this.#guildEvent("guild-updated", raw)
      case "GUILD_DELETE": {
        const record = recordValue(raw)
        const guildId = snowflake(record?.id)
        const unavailable = record?.unavailable
        if (!guildId || (unavailable !== undefined && typeof unavailable !== "boolean")) {
          return false
        }
        const allowed = this.#guildEventAllowed(guildId)
        this.#forgetGuild(guildId)
        if (!allowed) return false
        this.#append({
          guildId,
          kind: unavailable === true ? "guild-unavailable" : "guild-deleted",
        })
        return true
      }
      case "CHANNEL_CREATE":
        return this.#channelEvent("channel-created", raw)
      case "CHANNEL_UPDATE":
        return this.#channelEvent("channel-updated", raw)
      case "CHANNEL_DELETE":
        return this.#channelEvent("channel-deleted", raw, { forget: true })
      case "CHANNEL_PINS_UPDATE":
        return this.#channelOnlyEvent("channel-pins-updated", raw)
      case "THREAD_CREATE":
        return this.#channelEvent("thread-created", raw, { threadOnly: true })
      case "THREAD_UPDATE":
        return this.#channelEvent("thread-updated", raw, { threadOnly: true })
      case "THREAD_DELETE":
        return this.#channelEvent("thread-deleted", raw, {
          forget: true,
          threadOnly: true,
        })
      case "THREAD_MEMBERS_UPDATE":
        return this.#channelOnlyEvent("thread-members-changed", raw)
      case "MESSAGE_CREATE":
        return this.#messageEvent("message-created", raw)
      case "MESSAGE_UPDATE":
        return this.#messageEvent("message-updated", raw)
      case "MESSAGE_DELETE":
        return this.#messageEvent("message-deleted", raw)
      case "MESSAGE_DELETE_BULK": {
        const record = recordValue(raw)
        const guildId = snowflake(record?.guild_id)
        const channelId = snowflake(record?.channel_id)
        const messageIds = snowflakeList(record?.ids)
        if (!guildId || !channelId || !messageIds || !this.#guildAllowed(guildId)) return false
        const parentChannelId = this.#mapping(channelId, guildId)?.parentChannelId || null
        if (!this.#channelAllowed(channelId, parentChannelId)) return false
        this.#append({
          channelId,
          guildId,
          kind: "message-bulk-deleted",
          messageIds,
          ...(parentChannelId ? { parentChannelId } : {}),
        })
        return true
      }
      case "MESSAGE_REACTION_ADD":
        return this.#messageEvent("reaction-added", raw)
      case "MESSAGE_REACTION_REMOVE":
        return this.#messageEvent("reaction-removed", raw)
      case "MESSAGE_REACTION_REMOVE_ALL":
        return this.#messageEvent("reaction-cleared", raw)
      case "MESSAGE_REACTION_REMOVE_EMOJI":
        return this.#messageEvent("reaction-emoji-cleared", raw)
      case "MESSAGE_POLL_VOTE_ADD":
        return this.#messageEvent("poll-vote-added", raw)
      case "MESSAGE_POLL_VOTE_REMOVE":
        return this.#messageEvent("poll-vote-removed", raw)
      case "GUILD_ROLE_CREATE":
        return this.#roleEvent("role-created", raw)
      case "GUILD_ROLE_UPDATE":
        return this.#roleEvent("role-updated", raw)
      case "GUILD_ROLE_DELETE":
        return this.#roleEvent("role-deleted", raw)
      case "GUILD_SOUNDBOARD_SOUND_CREATE":
        return this.#soundboardSoundEvent("soundboard-sound-created", raw)
      case "GUILD_SOUNDBOARD_SOUND_UPDATE":
        return this.#soundboardSoundEvent("soundboard-sound-updated", raw)
      case "GUILD_SOUNDBOARD_SOUND_DELETE":
        return this.#soundboardSoundEvent("soundboard-sound-deleted", raw)
      case "GUILD_SOUNDBOARD_SOUNDS_UPDATE":
        return this.#soundboardSoundsEvent(raw)
      case "STAGE_INSTANCE_CREATE":
        return this.#stageInstanceEvent("stage-instance-created", raw)
      case "STAGE_INSTANCE_UPDATE":
        return this.#stageInstanceEvent("stage-instance-updated", raw)
      case "STAGE_INSTANCE_DELETE":
        return this.#stageInstanceEvent("stage-instance-deleted", raw)
      default:
        return false
    }
  }

  transition(
    state: GatewayConnectionState,
    errorCategory?: GatewayErrorCategory,
  ): void {
    if (!this.enabled && state !== "disabled") return
    const timestamp = this.#timestamp()
    const layoutChanged = state === "reconnecting"
      ? this.#channelLayouts.suspendForResume()
      : state === "ready"
        ? this.#channelLayouts.confirmResume()
        : false
    if (layoutChanged) this.#emit("layout")
    const changed = this.#state !== state || Boolean(errorCategory) || layoutChanged
    this.#state = state
    if (state === "authenticating" && this.#connectedAt === null) {
      this.#connectedAt = timestamp
    }
    if (state === "ready") this.#readyAt = timestamp
    if (errorCategory) this.#lastError = { at: timestamp, category: errorCategory }
    if (changed) this.#emit("status")
  }

  recordIdentify(): void {
    if (!this.enabled) return
    if (this.#channelLayouts.invalidateForIdentify()) {
      this.#emit("layout")
    }
    this.#identifies += 1
    this.#emit("status")
  }

  recordContinuityGap(): void {
    if (!this.enabled) return
    if (this.#channelLayouts.invalidateForContinuityGap()) {
      this.#emit("layout")
    }
    this.#generation += 1
    this.#continuityGaps += 1
    this.#emit("events")
    this.#emit("status")
  }

  recordReconnect(): void {
    if (!this.enabled) return
    this.#reconnects += 1
    this.#emit("status")
  }

  suspendChannelLayoutsForResume(): void {
    if (!this.enabled) return
    if (!this.#channelLayouts.suspendForResume()) return
    this.#emit("layout")
    this.#emit("status")
  }

  recordResume(): void {
    if (!this.enabled) return
    this.#resumes += 1
    this.#emit("status")
  }

  getStatus(): GatewayStatusSnapshot {
    return {
      buffer: {
        capacity: this.#bufferSize,
        continuityGaps: this.#continuityGaps,
        dropped: this.#dropped,
        size: this.#events.length,
        totalAccepted: this.#position,
      },
      connection: {
        connectedAt: this.#connectedAt,
        identifies: this.#identifies,
        lastError: this.#lastError ? { ...this.#lastError } : null,
        readyAt: this.#readyAt,
        reconnects: this.#reconnects,
        resumes: this.#resumes,
        state: this.#state,
      },
      enabled: this.enabled,
      feedEnabled: this.eventFeedEnabled,
      intents: this.eventFeedEnabled
        ? [
            "GUILDS" as const,
            "GUILD_MESSAGES" as const,
            "GUILD_MESSAGE_REACTIONS" as const,
            "GUILD_MESSAGE_POLLS" as const,
          ]
        : this.layoutEnabled
          ? ["GUILDS" as const]
          : [],
      layout: this.#channelLayouts.getChannelLayoutStatus(),
      privacy: {
        contentStored: false,
        persistent: false,
        privilegedIntentsRequested: false,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  listEvents(options: { afterCursor?: string; limit?: number } = {}): GatewayEventPage {
    const limit = options.limit ?? GATEWAY_DEFAULTS.eventPage
    if (
      !Number.isInteger(limit)
      || limit < 1
      || limit > CONNECTOR_LIMITS.gatewayEventPage
    ) {
      throw new RangeError(
        `Gateway event limit must be between 1 and ${CONNECTOR_LIMITS.gatewayEventPage}`,
      )
    }

    const afterCursor = options.afterCursor
    let resetReason: GatewayCursorResetReason | null = null
    let afterPosition: number | undefined
    if (afterCursor !== undefined) {
      const match = typeof afterCursor === "string"
        && afterCursor.length <= CONNECTOR_LIMITS.gatewayCursorCharacters
        ? CURSOR_PATTERN.exec(afterCursor)
        : null
      if (!match) resetReason = "invalid-cursor"
      else if (match[1] !== this.#cursorNamespace) resetReason = "foreign-cursor"
      else {
        const generation = Number(match[2])
        const parsed = Number(match[3])
        if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(parsed)) {
          resetReason = "invalid-cursor"
        } else if (generation > this.#generation || parsed > this.#position) {
          resetReason = "ahead-cursor"
        } else if (generation < this.#generation) resetReason = "connection-gap"
        else {
          const earliestPosition = this.#events[0]?.position ?? this.#position + 1
          if (parsed < earliestPosition - 1) resetReason = "expired-cursor"
          else afterPosition = parsed
        }
      }
    }

    const candidates = resetReason
      ? this.#events
      : afterPosition === undefined
        ? this.#events.slice(-limit)
        : this.#events.filter((event) => event.position > afterPosition)
    const selected = candidates.slice(0, limit)
    const events = selected.map(({ position: _position, ...event }) => ({
      ...event,
      ...(event.messageIds ? { messageIds: [...event.messageIds] } : {}),
    }))
    const nextPosition = selected.at(-1)?.position
      ?? afterPosition
      ?? this.#position
    const nextCursor = this.#cursor(nextPosition)
    return {
      events,
      page: {
        afterCursor: afterCursor ?? null,
        available: this.#events.length,
        hasMore: candidates.length > selected.length,
        nextCursor,
        resetReason,
        resetRequired: resetReason !== null,
        returned: events.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: this.eventFeedEnabled ? "ok" : "disabled",
    }
  }

  getChannelLayout(guildId: string): GatewayChannelLayoutSnapshot {
    return this.#channelLayouts.getChannelLayout(guildId)
  }

  getChannelLayoutStatus(): GatewayChannelLayoutStatus {
    return this.#channelLayouts.getChannelLayoutStatus()
  }

  subscribeChannelLayouts(listener: GatewayChannelLayoutListener): () => void {
    return this.#channelLayouts.subscribeChannelLayouts(listener)
  }

  subscribe(listener: GatewayChangeListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}
