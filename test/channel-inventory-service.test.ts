import assert from "node:assert/strict"
import test from "node:test"

import {
  type ChannelInventoryPageResult,
  ChannelInventoryService,
} from "../src/channel-inventory-service.js"
import { CHANNEL_INVENTORY_CURSOR_PATTERN } from "../src/constants.js"
import { PolicyError } from "../src/errors.js"
import type { DiscordChannel } from "../src/types.js"

const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const CHANNEL_ID_ONE = "200000000000000001"
const CHANNEL_ID_TWO = "200000000000000002"
const CHANNEL_ID_THREE = "200000000000000003"
const CURSOR_KEY = new Uint8Array(32).fill(7)

function channel(
  id: string,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: `channel-${id}`,
    permission_overwrites: [],
    position: 0,
    topic: "private exact topic",
    type: 0,
    ...overrides,
  }
}

function pageResult(
  result: Awaited<ReturnType<ChannelInventoryService["list"]>>,
): asserts result is ChannelInventoryPageResult {
  assert.ok("page" in result)
}

function fixture(options: {
  channels?: DiscordChannel[]
  policyError?: Error
  visibleIds?: readonly string[]
} = {}) {
  const state = {
    channels: options.channels ?? [
      channel(CHANNEL_ID_THREE, { position: 1 }),
      channel(CHANNEL_ID_TWO, { position: 0, type: 4 }),
      channel(CHANNEL_ID_ONE, { position: 0, type: 0 }),
    ],
  }
  const calls: Array<{ guildId: string; options: unknown }> = []
  const visibleIds = new Set(options.visibleIds ?? state.channels.map(({ id }) => id))
  const service = new ChannelInventoryService({
    client: {
      async getGuildChannels(guildId, requestOptions) {
        calls.push({ guildId, options: requestOptions })
        return structuredClone(state.channels)
      },
    },
    cursorKey: CURSOR_KEY,
    policy: {
      assertGuildAllowed() {
        if (options.policyError) throw options.policyError
      },
      filterChannels(channels) {
        return channels.filter(({ id }) => visibleIds.has(id))
      },
    },
  })
  return { calls, service, state }
}

test("channel inventory defaults the public page to a compact deterministic projection", async () => {
  const { calls, service } = fixture()

  const result = await service.list(GUILD_ID, { limit: 2 })

  pageResult(result)
  assert.deepEqual(result.channels, [{
    id: CHANNEL_ID_ONE,
    name: `channel-${CHANNEL_ID_ONE}`,
    parentId: null,
    position: 0,
    type: 0,
    typeName: "guild-text",
  }, {
    id: CHANNEL_ID_TWO,
    name: `channel-${CHANNEL_ID_TWO}`,
    parentId: null,
    position: 0,
    type: 4,
    typeName: "guild-category",
  }])
  assert.deepEqual(result.inventory, {
    completeness: "visibility-bounded",
    scope: "configured-policy-and-discord-visibility",
  })
  assert.deepEqual(result.projection, {
    detail: "compact",
    exactMetadataTool: "get_channel",
  })
  assert.equal(result.page.returned, 2)
  assert.equal(result.page.totalVisible, 3)
  assert.equal(result.page.hasMore, true)
  assert.match(result.page.nextCursor || "", CHANNEL_INVENTORY_CURSOR_PATTERN)
  assert.doesNotMatch(JSON.stringify(result), /private exact topic/)
  assert.equal(calls.length, 1)
})

test("channel inventory preserves the full unpaginated resource projection", async () => {
  const abort = new AbortController()
  const { calls, service } = fixture({ visibleIds: [CHANNEL_ID_THREE] })

  const result = await service.list(GUILD_ID, { signal: abort.signal })

  if ("page" in result) assert.fail("Expected a complete resource inventory")
  assert.equal(result.channels.length, 1)
  assert.equal(result.channels[0]?.topic, "private exact topic")
  assert.deepEqual(result.inventory, {
    completeness: "visibility-bounded",
    returned: 1,
    scope: "configured-policy-and-discord-visibility",
  })
  assert.equal(calls[0]?.guildId, GUILD_ID)
  assert.equal((calls[0]?.options as { signal?: AbortSignal }).signal, abort.signal)
})

test("channel inventory cursor is authenticated and retains its original projection", async () => {
  const { calls, service } = fixture()
  const first = await service.list(GUILD_ID, { detail: "full", limit: 1 })
  pageResult(first)
  assert.ok(first.page.nextCursor)

  const second = await service.list(GUILD_ID, {
    cursor: first.page.nextCursor,
    limit: 1,
  })
  pageResult(second)
  assert.equal(second.projection.detail, "full")
  assert.equal(second.channels[0]?.id, CHANNEL_ID_TWO)
  assert.equal("topic" in (second.channels[0] || {}), true)

  const callsBeforeLocalRejections = calls.length
  const replacement = first.page.nextCursor.endsWith("0") ? "1" : "0"
  const tampered = `${first.page.nextCursor.slice(0, -1)}${replacement}`
  await assert.rejects(
    () => service.list(GUILD_ID, { cursor: tampered }),
    /cursor is invalid or expired/,
  )
  await assert.rejects(
    () => service.list(OTHER_GUILD_ID, { cursor: first.page.nextCursor as string }),
    /cursor is invalid or expired/,
  )
  await assert.rejects(
    () => service.list(GUILD_ID, {
      cursor: first.page.nextCursor as string,
      detail: "compact",
    }),
    /projection does not match detail/,
  )
  assert.equal(calls.length, callsBeforeLocalRejections)
})

test("channel inventory cursor rejects structural drift but tolerates volatile message activity", async () => {
  const drifting = fixture()
  const first = await drifting.service.list(GUILD_ID, { limit: 1 })
  pageResult(first)
  assert.ok(first.page.nextCursor)
  const target = drifting.state.channels.find(({ id }) => id === CHANNEL_ID_TWO)
  assert.ok(target)
  target.position = 3

  await assert.rejects(
    () => drifting.service.list(GUILD_ID, {
      cursor: first.page.nextCursor as string,
    }),
    /inventory changed; restart pagination/,
  )

  const active = fixture()
  const activeFirst = await active.service.list(GUILD_ID, { limit: 1 })
  pageResult(activeFirst)
  assert.ok(activeFirst.page.nextCursor)
  active.state.channels[0] = {
    ...active.state.channels[0] as DiscordChannel,
    last_message_id: "300000000000000001",
  }
  const continued = await active.service.list(GUILD_ID, {
    cursor: activeFirst.page.nextCursor,
  })
  pageResult(continued)
  assert.equal(continued.page.returned, 2)
})

test("channel inventory validates local inputs, policy, and Discord evidence", async () => {
  const invalidInput = fixture()
  await assert.rejects(
    () => invalidInput.service.list(GUILD_ID, { limit: 101 }),
    /limit must be an integer between 1 and 100/,
  )
  await assert.rejects(
    () => invalidInput.service.list(GUILD_ID, { cursor: "" }),
    /cursor is invalid or expired/,
  )
  assert.equal(invalidInput.calls.length, 0)

  const blocked = fixture({ policyError: new PolicyError("blocked") })
  await assert.rejects(() => blocked.service.list(GUILD_ID), /blocked/)
  assert.equal(blocked.calls.length, 0)

  const duplicate = fixture({
    channels: [channel(CHANNEL_ID_ONE), channel(CHANNEL_ID_ONE)],
  })
  await assert.rejects(
    () => duplicate.service.list(GUILD_ID),
    /duplicate guild channel evidence/,
  )

  const mismatched = fixture({
    channels: [channel(CHANNEL_ID_ONE, { guild_id: OTHER_GUILD_ID })],
  })
  await assert.rejects(
    () => mismatched.service.list(GUILD_ID),
    /invalid or mismatched guild channel evidence/,
  )
})
