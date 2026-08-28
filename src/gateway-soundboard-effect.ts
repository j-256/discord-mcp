import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { ConnectorConfig } from "./config.js"
import { GatewaySoundboardEffectError } from "./errors.js"

export interface GatewaySoundboardEffectRequestOptions {
  signal?: AbortSignal
}

export interface GatewaySoundboardEffectEvidence {
  channelId: string
  freshness: {
    gatewaySequence: number
    observedAt: string
    source: "gateway-voice-channel-effect-send"
  }
  guildId: string
  privacy: {
    nonTargetEvents: "discarded"
    persistence: "none"
    rawPayloads: "omitted"
  }
  schemaVersion: number
  soundId: string
  unknownFieldCount: number
  userId: string
}

export interface GatewaySoundboardEffectSource {
  readonly soundboardPlaybackEventsEnabled: boolean
  waitForSoundboardPlaybackEvent(
    guildId: string,
    channelId: string,
    userId: string,
    soundId: string,
    options?: GatewaySoundboardEffectRequestOptions,
  ): Promise<GatewaySoundboardEffectEvidence>
}

export interface GatewaySoundboardEffectTarget {
  channelId: string
  guildId: string
  soundId: string
  userId: string
}

const EFFECT_KEYS: ReadonlySet<string> = new Set([
  "animation_id",
  "animation_type",
  "channel_id",
  "emoji",
  "guild_id",
  "sound_id",
  "sound_volume",
  "user_id",
])

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

function soundIdentifier(value: unknown): string | undefined {
  if (positiveSnowflake(value)) return value
  if (Number.isSafeInteger(value) && (value as number) > 0) return String(value)
  return undefined
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
}

export function soundboardPlaybackChannelIds(
  config: Pick<
    ConnectorConfig,
    "allowSoundboardPlayback" | "soundboardPlaybackChannelIds"
  >,
): ReadonlySet<string> {
  return config.allowSoundboardPlayback
    ? new Set(config.soundboardPlaybackChannelIds)
    : new Set()
}

export function soundboardEffectTarget(
  value: unknown,
): GatewaySoundboardEffectTarget | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const channelId = positiveSnowflake(record.channel_id) ? record.channel_id : undefined
  const guildId = positiveSnowflake(record.guild_id) ? record.guild_id : undefined
  const soundId = soundIdentifier(record.sound_id)
  const userId = positiveSnowflake(record.user_id) ? record.user_id : undefined
  if (!channelId || !guildId || !soundId || !userId) return undefined
  return { channelId, guildId, soundId, userId }
}

export function projectGatewaySoundboardEffect(options: {
  channelId: string
  gatewaySequence: number
  guildId: string
  observedAt: string
  soundId: string
  userId: string
  value: unknown
}): GatewaySoundboardEffectEvidence {
  const target = soundboardEffectTarget(options.value)
  if (
    !target
    || target.channelId !== options.channelId
    || target.guildId !== options.guildId
    || target.soundId !== options.soundId
    || target.userId !== options.userId
    || !Number.isSafeInteger(options.gatewaySequence)
    || options.gatewaySequence < 0
    || !validTimestamp(options.observedAt)
  ) {
    throw new GatewaySoundboardEffectError(
      "Discord Gateway returned invalid soundboard playback evidence",
    )
  }
  const record = options.value as Record<string, unknown>
  return {
    channelId: target.channelId,
    freshness: {
      gatewaySequence: options.gatewaySequence,
      observedAt: options.observedAt,
      source: "gateway-voice-channel-effect-send",
    },
    guildId: target.guildId,
    privacy: {
      nonTargetEvents: "discarded",
      persistence: "none",
      rawPayloads: "omitted",
    },
    schemaVersion: SCHEMA_VERSION,
    soundId: target.soundId,
    unknownFieldCount: Object.keys(record).filter((key) => !EFFECT_KEYS.has(key)).length,
    userId: target.userId,
  }
}

export class DisabledGatewaySoundboardEffectSource
implements GatewaySoundboardEffectSource {
  readonly soundboardPlaybackEventsEnabled = false

  waitForSoundboardPlaybackEvent(
    _guildId: string,
    _channelId: string,
    _userId: string,
    _soundId: string,
    _options: GatewaySoundboardEffectRequestOptions = {},
  ): Promise<GatewaySoundboardEffectEvidence> {
    return Promise.reject(new GatewaySoundboardEffectError(
      "Discord Gateway soundboard playback evidence is disabled",
    ))
  }
}
