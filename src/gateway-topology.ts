import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"

export interface GatewayChannelRoute {
  channelId: string
  guildId: string
}

export interface GatewayTopology {
  activeShardIds: readonly number[]
  channelGuildIds: ReadonlyMap<string, string>
  guildIds: readonly string[]
  summary: {
    activeShards: number
    recommendedShards: number
    resolvedChannels: number
    scopedGuilds: number
  }
}

export interface GatewayTopologyInput {
  channelRoutes: readonly GatewayChannelRoute[]
  guildIds: ReadonlySet<string>
  recommendedShards: number
}

export class GatewayTopologyEvidenceError extends Error {
  constructor() {
    super("Discord Gateway topology evidence is invalid")
    this.name = "GatewayTopologyEvidenceError"
  }
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

export function projectGatewayChannelRoute(
  value: unknown,
  expectedChannelId: string,
): GatewayChannelRoute {
  if (!positiveSnowflake(expectedChannelId)) throw new GatewayTopologyEvidenceError()
  const record = recordValue(value)
  if (
    !record
    || record.id !== expectedChannelId
    || !positiveSnowflake(record.guild_id)
  ) {
    throw new GatewayTopologyEvidenceError()
  }
  return {
    channelId: expectedChannelId,
    guildId: record.guild_id,
  }
}

export function validateGatewayChannelRoute(
  value: unknown,
  expectedChannelId: string,
): GatewayChannelRoute {
  const record = recordValue(value)
  if (
    !record
    || record.channelId !== expectedChannelId
    || !positiveSnowflake(record.guildId)
  ) {
    throw new GatewayTopologyEvidenceError()
  }
  return {
    channelId: expectedChannelId,
    guildId: record.guildId,
  }
}

export function calculateGatewayShardId(guildId: string, shardCount: number): number {
  if (
    !positiveSnowflake(guildId)
    || !Number.isSafeInteger(shardCount)
    || shardCount < 1
  ) {
    throw new GatewayTopologyEvidenceError()
  }
  return Number((BigInt(guildId) >> 22n) % BigInt(shardCount))
}

export function deriveGatewayTopology(input: GatewayTopologyInput): GatewayTopology {
  if (
    !input
    || !(input.guildIds instanceof Set)
    || !Array.isArray(input.channelRoutes)
    || !Number.isSafeInteger(input.recommendedShards)
    || input.recommendedShards < 1
  ) {
    throw new GatewayTopologyEvidenceError()
  }
  const guildIds = new Set<string>()
  for (const guildId of input.guildIds) {
    if (!positiveSnowflake(guildId)) throw new GatewayTopologyEvidenceError()
    guildIds.add(guildId)
  }
  const channelGuildIds = new Map<string, string>()
  for (const route of input.channelRoutes) {
    if (
      !route
      || !positiveSnowflake(route.channelId)
      || !positiveSnowflake(route.guildId)
    ) {
      throw new GatewayTopologyEvidenceError()
    }
    const existing = channelGuildIds.get(route.channelId)
    if (existing && existing !== route.guildId) throw new GatewayTopologyEvidenceError()
    channelGuildIds.set(route.channelId, route.guildId)
    guildIds.add(route.guildId)
  }
  if (guildIds.size === 0) throw new GatewayTopologyEvidenceError()
  const sortedGuildIds = [...guildIds].sort()
  const activeShardIds = [...new Set(sortedGuildIds.map((guildId) => (
    calculateGatewayShardId(guildId, input.recommendedShards)
  )))].sort((left, right) => left - right)
  if (activeShardIds.length === 0) throw new GatewayTopologyEvidenceError()
  return {
    activeShardIds: Object.freeze(activeShardIds),
    channelGuildIds,
    guildIds: Object.freeze(sortedGuildIds),
    summary: Object.freeze({
      activeShards: activeShardIds.length,
      recommendedShards: input.recommendedShards,
      resolvedChannels: channelGuildIds.size,
      scopedGuilds: sortedGuildIds.length,
    }),
  }
}
