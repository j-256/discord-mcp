import { randomBytes } from "node:crypto"

import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
  GATEWAY_DEFAULTS,
  SCHEMA_VERSION,
} from "./constants.js"

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

export type GatewayChangeKind = "events" | "status"
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
  intents: readonly [
    "GUILDS",
    "GUILD_MESSAGES",
    "GUILD_MESSAGE_REACTIONS",
    "GUILD_MESSAGE_POLLS",
  ]
  privacy: {
    contentStored: false
    persistent: false
    privilegedIntentsRequested: false
  }
  schemaVersion: number
  status: "ok"
}

export interface GatewayEventSource {
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
    if (
      options.enabled
      && options.allowedGuildIds.size === 0
      && options.allowedChannelIds.size === 0
    ) {
      throw new RangeError("Enabled Gateway events require an exact guild or channel scope")
    }
    this.enabled = options.enabled
    this.#allowedChannelIds = new Set(options.allowedChannelIds)
    this.#allowedGuildIds = new Set(options.allowedGuildIds)
    this.#bufferSize = bufferSize
    this.#clock = options.clock || (() => new Date())
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

  ingestDispatch(name: string, raw: unknown): boolean {
    if (!this.enabled) return false
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
    const changed = this.#state !== state || Boolean(errorCategory)
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
    this.#identifies += 1
    this.#emit("status")
  }

  recordContinuityGap(): void {
    if (!this.enabled) return
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
      intents: [
        "GUILDS",
        "GUILD_MESSAGES",
        "GUILD_MESSAGE_REACTIONS",
        "GUILD_MESSAGE_POLLS",
      ],
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
      status: this.enabled ? "ok" : "disabled",
    }
  }

  subscribe(listener: GatewayChangeListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}
