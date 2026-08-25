import assert from "node:assert/strict"
import test from "node:test"

import { DISCORD_SNOWFLAKE_MAX } from "../src/constants.js"
import {
  GatewayTopologyEvidenceError,
  calculateGatewayShardId,
  deriveGatewayTopology,
  projectGatewayChannelRoute,
  validateGatewayChannelRoute,
} from "../src/gateway-topology.js"

const CHANNEL_ID = "300000000000000001"
const SECOND_CHANNEL_ID = "300000000000000002"
const GUILD_ID = "200000000000000001"
const SECOND_GUILD_ID = "200000000000000002"

test("Gateway channel routes retain only exact channel and guild IDs", () => {
  const result = projectGatewayChannelRoute({
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "discarded",
    token: "discarded-secret",
  }, CHANNEL_ID)

  assert.deepEqual(result, {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
  })
  assert.doesNotMatch(JSON.stringify(result), /discarded|token|name/)
  assert.deepEqual(validateGatewayChannelRoute({
    channelId: CHANNEL_ID,
    future: "discarded",
    guildId: GUILD_ID,
  }, CHANNEL_ID), result)
})

test("Gateway channel routes reject direct messages and malformed identity evidence", () => {
  for (const [value, expectedChannelId] of [
    [null, CHANNEL_ID],
    [[], CHANNEL_ID],
    [{ id: CHANNEL_ID }, CHANNEL_ID],
    [{ guild_id: GUILD_ID, id: SECOND_CHANNEL_ID }, CHANNEL_ID],
    [{ guild_id: "0", id: CHANNEL_ID }, CHANNEL_ID],
    [{ guild_id: (DISCORD_SNOWFLAKE_MAX + 1n).toString(), id: CHANNEL_ID }, CHANNEL_ID],
    [{ guild_id: GUILD_ID, id: CHANNEL_ID }, "0"],
  ] as const) {
    assert.throws(
      () => projectGatewayChannelRoute(value, expectedChannelId),
      GatewayTopologyEvidenceError,
    )
  }
})

test("Gateway shard calculation uses Discord's unsigned snowflake formula", () => {
  const guildId = ((7n << 22n) + 123n).toString()
  assert.equal(calculateGatewayShardId(guildId, 5), 2)
  assert.equal(calculateGatewayShardId(GUILD_ID, 1), 0)

  for (const [value, count] of [
    ["0", 1],
    [(DISCORD_SNOWFLAKE_MAX + 1n).toString(), 1],
    [GUILD_ID, 0],
    [GUILD_ID, 1.5],
    [GUILD_ID, Number.MAX_SAFE_INTEGER + 1],
  ] as const) {
    assert.throws(() => calculateGatewayShardId(value, count), GatewayTopologyEvidenceError)
  }
})

test("Gateway topology deduplicates guild routes and selects sparse shards", () => {
  const shardCount = 8
  const firstGuild = ((1n << 22n) + 1n).toString()
  const secondGuild = ((6n << 22n) + 1n).toString()
  const result = deriveGatewayTopology({
    channelRoutes: [
      { channelId: CHANNEL_ID, guildId: firstGuild },
      { channelId: CHANNEL_ID, guildId: firstGuild },
      { channelId: SECOND_CHANNEL_ID, guildId: secondGuild },
    ],
    guildIds: new Set([firstGuild]),
    recommendedShards: shardCount,
  })

  assert.deepEqual(result.activeShardIds, [1, 6])
  assert.deepEqual(result.guildIds, [firstGuild, secondGuild].sort())
  assert.deepEqual([...result.channelGuildIds], [
    [CHANNEL_ID, firstGuild],
    [SECOND_CHANNEL_ID, secondGuild],
  ])
  assert.deepEqual(result.summary, {
    activeShards: 2,
    recommendedShards: 8,
    resolvedChannels: 2,
    scopedGuilds: 2,
  })
})

test("Gateway topology validates empty, conflicting, and malformed evidence", () => {
  const invalid = [
    {
      channelRoutes: [],
      guildIds: new Set<string>(),
      recommendedShards: 1,
    },
    {
      channelRoutes: [
        { channelId: CHANNEL_ID, guildId: GUILD_ID },
        { channelId: CHANNEL_ID, guildId: SECOND_GUILD_ID },
      ],
      guildIds: new Set<string>(),
      recommendedShards: 1,
    },
    {
      channelRoutes: [{ channelId: "0", guildId: GUILD_ID }],
      guildIds: new Set<string>(),
      recommendedShards: 1,
    },
    {
      channelRoutes: [],
      guildIds: new Set(["0"]),
      recommendedShards: 1,
    },
    {
      channelRoutes: [],
      guildIds: new Set([GUILD_ID]),
      recommendedShards: 0,
    },
  ]

  for (const value of invalid) {
    assert.throws(
      () => deriveGatewayTopology(value),
      GatewayTopologyEvidenceError,
    )
  }
})
