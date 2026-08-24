import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { ConnectorConfig } from "./config.js"
import { GatewayVoiceChannelStatusError } from "./errors.js"

export type GatewayVoiceChannelStatusRepresentation = "null" | "omitted" | "value"

export interface GatewayVoiceChannelStatusRequestOptions {
  signal?: AbortSignal
}

export interface GatewayVoiceChannelStatusSnapshot {
  channelId: string
  evidence: {
    discardedChannelEntries: number
    responseUnknownFieldCount: number
    returnedChannelEntries: number
    statusRepresentation: GatewayVoiceChannelStatusRepresentation
    targetUnknownFieldCount: number
  }
  freshness: {
    gatewaySequence: number
    observedAt: string
    requestedAt: string
    source: "gateway-request-channel-info"
  }
  guildId: string
  privacy: {
    nonTargetStatusText: "discarded-before-projection"
    persistence: "none"
    rawPayloads: "omitted"
    text: "transient-untrusted"
  }
  schemaVersion: number
  status: string | null
}

export interface GatewayVoiceChannelStatusUpdate {
  channelId: string
  freshness: {
    gatewaySequence: number
    observedAt: string
    source: "gateway-voice-channel-status-update"
  }
  guildId: string
  status: string | null
  unknownFieldCount: number
}

export interface GatewayVoiceChannelStatusSource {
  readonly voiceChannelStatusEnabled: boolean
  getVoiceChannelStatus(
    guildId: string,
    channelId: string,
    options?: GatewayVoiceChannelStatusRequestOptions,
  ): Promise<GatewayVoiceChannelStatusSnapshot>
  waitForVoiceChannelStatusUpdate(
    guildId: string,
    channelId: string,
    options?: GatewayVoiceChannelStatusRequestOptions,
  ): Promise<GatewayVoiceChannelStatusUpdate>
}

export function voiceChannelStatusChannelIds(
  config: Pick<
    ConnectorConfig,
    "allowChannelMetadataChanges" | "channelMetadataIds"
  >,
): ReadonlySet<string> {
  return config.allowChannelMetadataChanges
    ? new Set(config.channelMetadataIds)
    : new Set()
}

const CHANNEL_INFO_KEYS: ReadonlySet<string> = new Set(["channels", "guild_id"])
const CHANNEL_INFO_CHANNEL_KEYS: ReadonlySet<string> = new Set(["id", "status"])
const STATUS_UPDATE_KEYS: ReadonlySet<string> = new Set(["guild_id", "id", "status"])

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function statusValue(
  record: Record<string, unknown>,
): { representation: GatewayVoiceChannelStatusRepresentation; status: string | null } {
  if (!Object.hasOwn(record, "status")) {
    return { representation: "omitted", status: null }
  }
  if (record.status === null) return { representation: "null", status: null }
  if (
    typeof record.status !== "string"
    || [...record.status].length > DISCORD_LIMITS.voiceChannelStatusCharacters
    || record.status.includes("\0")
    || !validUnicode(record.status)
  ) {
    throw new GatewayVoiceChannelStatusError(
      "Discord Gateway returned invalid voice channel status evidence",
    )
  }
  return { representation: "value", status: record.status }
}

function unknownFieldCount(
  record: Record<string, unknown>,
  known: ReadonlySet<string>,
): number {
  return Object.keys(record).filter((key) => !known.has(key)).length
}

export function channelInfoGuildId(value: unknown): string | undefined {
  const record = recordValue(value)
  return positiveSnowflake(record?.guild_id) ? record.guild_id : undefined
}

export function voiceChannelStatusUpdateTarget(
  value: unknown,
): { channelId: string; guildId: string } | undefined {
  const record = recordValue(value)
  if (!positiveSnowflake(record?.guild_id) || !positiveSnowflake(record.id)) return undefined
  return { channelId: record.id, guildId: record.guild_id }
}

export function projectGatewayVoiceChannelStatus(options: {
  channelId: string
  gatewaySequence: number
  guildId: string
  observedAt: string
  requestedAt: string
  value: unknown
}): GatewayVoiceChannelStatusSnapshot {
  const record = recordValue(options.value)
  if (
    !record
    || record.guild_id !== options.guildId
    || !Array.isArray(record.channels)
    || record.channels.length > DISCORD_LIMITS.guildChannels
  ) {
    throw new GatewayVoiceChannelStatusError(
      "Discord Gateway returned invalid channel-info evidence",
    )
  }
  const seen = new Set<string>()
  let target: Record<string, unknown> | undefined
  for (const value of record.channels) {
    const channel = recordValue(value)
    if (!channel || !positiveSnowflake(channel.id) || seen.has(channel.id)) {
      throw new GatewayVoiceChannelStatusError(
        "Discord Gateway returned invalid channel-info channel evidence",
      )
    }
    seen.add(channel.id)
    if (channel.id === options.channelId) target = channel
  }
  if (!target) {
    throw new GatewayVoiceChannelStatusError(
      "Discord Gateway channel-info evidence omitted the exact target channel",
    )
  }
  const projected = statusValue(target)
  return {
    channelId: options.channelId,
    evidence: {
      discardedChannelEntries: record.channels.length - 1,
      responseUnknownFieldCount: unknownFieldCount(record, CHANNEL_INFO_KEYS),
      returnedChannelEntries: record.channels.length,
      statusRepresentation: projected.representation,
      targetUnknownFieldCount: unknownFieldCount(target, CHANNEL_INFO_CHANNEL_KEYS),
    },
    freshness: {
      gatewaySequence: options.gatewaySequence,
      observedAt: options.observedAt,
      requestedAt: options.requestedAt,
      source: "gateway-request-channel-info",
    },
    guildId: options.guildId,
    privacy: {
      nonTargetStatusText: "discarded-before-projection",
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
    },
    schemaVersion: SCHEMA_VERSION,
    status: projected.status,
  }
}

export function projectGatewayVoiceChannelStatusUpdate(options: {
  channelId: string
  gatewaySequence: number
  guildId: string
  observedAt: string
  value: unknown
}): GatewayVoiceChannelStatusUpdate {
  const record = recordValue(options.value)
  if (
    !record
    || record.guild_id !== options.guildId
    || record.id !== options.channelId
    || !Object.hasOwn(record, "status")
  ) {
    throw new GatewayVoiceChannelStatusError(
      "Discord Gateway returned invalid voice channel status update evidence",
    )
  }
  const projected = statusValue(record)
  if (projected.representation === "omitted") {
    throw new GatewayVoiceChannelStatusError(
      "Discord Gateway voice channel status update omitted its status",
    )
  }
  return {
    channelId: options.channelId,
    freshness: {
      gatewaySequence: options.gatewaySequence,
      observedAt: options.observedAt,
      source: "gateway-voice-channel-status-update",
    },
    guildId: options.guildId,
    status: projected.status,
    unknownFieldCount: unknownFieldCount(record, STATUS_UPDATE_KEYS),
  }
}

export class DisabledGatewayVoiceChannelStatusSource
implements GatewayVoiceChannelStatusSource {
  readonly voiceChannelStatusEnabled = false

  getVoiceChannelStatus(): Promise<GatewayVoiceChannelStatusSnapshot> {
    return Promise.reject(new GatewayVoiceChannelStatusError(
      "Discord Gateway voice channel status evidence is disabled",
    ))
  }

  waitForVoiceChannelStatusUpdate(): Promise<GatewayVoiceChannelStatusUpdate> {
    return Promise.reject(new GatewayVoiceChannelStatusError(
      "Discord Gateway voice channel status evidence is disabled",
    ))
  }
}
