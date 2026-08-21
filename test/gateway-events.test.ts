import assert from "node:assert/strict"
import test from "node:test"

import { GatewayEventStore } from "../src/gateway-events.js"

const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const CHANNEL_ID = "200000000000000001"
const THREAD_ID = "200000000000000002"
const OTHER_CHANNEL_ID = "200000000000000003"
const MESSAGE_ID = "300000000000000001"
const SECOND_MESSAGE_ID = "300000000000000002"
const TOKEN = "test-discord-token"

function store(options: {
  allowedChannelIds?: readonly string[]
  allowedGuildIds?: readonly string[]
  bufferSize?: number
  enabled?: boolean
} = {}) {
  let milliseconds = Date.parse("2026-08-19T00:00:00.000Z")
  return new GatewayEventStore({
    allowedChannelIds: new Set(options.allowedChannelIds || [CHANNEL_ID]),
    allowedGuildIds: new Set(options.allowedGuildIds || [GUILD_ID]),
    ...(options.bufferSize ? { bufferSize: options.bufferSize } : {}),
    clock() {
      const value = new Date(milliseconds)
      milliseconds += 1_000
      return value
    },
    cursorNamespace: "testcursor12",
    enabled: options.enabled ?? true,
  })
}

function seedThread(feed: GatewayEventStore): void {
  assert.equal(feed.ingestDispatch("GUILD_CREATE", {
    channels: [{ id: CHANNEL_ID, type: 0 }],
    id: GUILD_ID,
    name: `untrusted ${TOKEN}`,
    threads: [{
      id: THREAD_ID,
      name: `thread ${TOKEN}`,
      parent_id: CHANNEL_ID,
      type: 11,
    }],
  }), false)
}

test("Gateway events are disabled by default and enforce bounded reads", () => {
  const feed = store({ enabled: false })

  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    content: TOKEN,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), false)
  assert.deepEqual(feed.getStatus(), {
    buffer: {
      capacity: 100,
      continuityGaps: 0,
      dropped: 0,
      size: 0,
      totalAccepted: 0,
    },
    connection: {
      connectedAt: null,
      identifies: 0,
      lastError: null,
      readyAt: null,
      reconnects: 0,
      resumes: 0,
      state: "disabled",
    },
    enabled: false,
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
    schemaVersion: 1,
    status: "ok",
  })
  assert.equal(feed.listEvents().status, "disabled")
  assert.throws(() => feed.listEvents({ limit: 0 }), /between 1 and 100/)
  assert.throws(
    () => store({ bufferSize: 1_001 }),
    /between 1 and 1000/,
  )
  assert.throws(
    () => store({ allowedChannelIds: [], allowedGuildIds: [] }),
    /exact guild or channel scope/,
  )
})

test("Gateway normalization immediately discards Discord content and filters scope", () => {
  const feed = store()
  seedThread(feed)

  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    attachments: [{ url: `https://cdn.discordapp.com/${TOKEN}` }],
    author: { id: "400000000000000001", username: TOKEN },
    channel_id: THREAD_ID,
    components: [{ custom_id: TOKEN }],
    content: `ignore ${TOKEN}`,
    embeds: [{ description: TOKEN }],
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), true)
  assert.equal(feed.ingestDispatch("MESSAGE_REACTION_ADD", {
    channel_id: THREAD_ID,
    emoji: { name: TOKEN },
    guild_id: GUILD_ID,
    message_id: MESSAGE_ID,
    user_id: "400000000000000001",
  }), true)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: OTHER_CHANNEL_ID,
    content: TOKEN,
    guild_id: GUILD_ID,
    id: SECOND_MESSAGE_ID,
  }), false)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    content: TOKEN,
    guild_id: OTHER_GUILD_ID,
    id: SECOND_MESSAGE_ID,
  }), false)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    content: TOKEN,
    id: SECOND_MESSAGE_ID,
  }), false)

  const result = feed.listEvents()
  assert.deepEqual(result.events.map((event) => event.kind), [
    "message-created",
    "reaction-added",
  ])
  assert.deepEqual(result.events[0], {
    channelId: THREAD_ID,
    cursor: "gw1.testcursor12.0.1",
    guildId: GUILD_ID,
    kind: "message-created",
    messageId: MESSAGE_ID,
    parentChannelId: CHANNEL_ID,
    receivedAt: "2026-08-19T00:00:00.000Z",
  })
  const rendered = JSON.stringify(result)
  assert.doesNotMatch(rendered, new RegExp(TOKEN))
  assert.doesNotMatch(rendered, /content|author|attachment|embed|component|emoji|userId/)
  assert.doesNotMatch(JSON.stringify(feed.getStatus()), new RegExp(TOKEN))
})

test("Gateway event kinds retain only bounded identifiers", () => {
  const feed = store()
  seedThread(feed)

  assert.equal(feed.ingestDispatch("MESSAGE_DELETE_BULK", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    ids: [SECOND_MESSAGE_ID, MESSAGE_ID, MESSAGE_ID],
  }), true)
  assert.equal(feed.ingestDispatch("GUILD_ROLE_UPDATE", {
    guild_id: GUILD_ID,
    role: { id: "500000000000000001", name: TOKEN },
  }), true)
  assert.equal(feed.ingestDispatch("THREAD_UPDATE", {
    guild_id: GUILD_ID,
    id: THREAD_ID,
    name: TOKEN,
    parent_id: CHANNEL_ID,
    type: 11,
  }), true)
  assert.equal(feed.ingestDispatch("CHANNEL_PINS_UPDATE", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    last_pin_timestamp: "2026-08-19T00:00:00.000Z",
  }), true)

  const events = feed.listEvents().events
  assert.deepEqual(events[0]?.messageIds, [MESSAGE_ID, SECOND_MESSAGE_ID])
  assert.equal(events[1]?.roleId, "500000000000000001")
  assert.equal(events[2]?.parentChannelId, CHANNEL_ID)
  assert.deepEqual(events[3], {
    channelId: THREAD_ID,
    cursor: "gw1.testcursor12.0.4",
    guildId: GUILD_ID,
    kind: "channel-pins-updated",
    parentChannelId: CHANNEL_ID,
    receivedAt: "2026-08-19T00:00:03.000Z",
  })
  assert.doesNotMatch(JSON.stringify(events), new RegExp(TOKEN))
})

test("Gateway cursors report overflow, foreign processes, malformed input, and pagination", () => {
  const feed = store({ bufferSize: 2 })
  const initialCursor = feed.listEvents().page.nextCursor
  for (const messageId of [
    "300000000000000001",
    "300000000000000002",
    "300000000000000003",
  ]) {
    assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
      channel_id: CHANNEL_ID,
      guild_id: GUILD_ID,
      id: messageId,
    }), true)
  }

  const expired = feed.listEvents({ afterCursor: initialCursor, limit: 1 })
  assert.equal(expired.page.resetRequired, true)
  assert.equal(expired.page.resetReason, "expired-cursor")
  assert.equal(expired.page.hasMore, true)
  assert.equal(expired.events[0]?.messageId, "300000000000000002")
  const continued = feed.listEvents({
    afterCursor: expired.page.nextCursor,
    limit: 1,
  })
  assert.equal(continued.page.resetRequired, false)
  assert.equal(continued.events[0]?.messageId, "300000000000000003")

  for (const [cursor, reason] of [
    ["gw1.othercursor1.0.2", "foreign-cursor"],
    ["not-a-cursor", "invalid-cursor"],
    ["x".repeat(129), "invalid-cursor"],
    ["gw1.testcursor12.0.99", "ahead-cursor"],
  ] as const) {
    const result = feed.listEvents({ afterCursor: cursor })
    assert.equal(result.page.resetRequired, true)
    assert.equal(result.page.resetReason, reason)
    assert.equal(result.events.length, 2)
  }
  assert.deepEqual(feed.getStatus().buffer, {
    capacity: 2,
    continuityGaps: 0,
    dropped: 1,
    size: 2,
    totalAccepted: 3,
  })
})

test("Gateway cursors explicitly reset across connection continuity gaps", () => {
  const feed = store()
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), true)
  const beforeGap = feed.listEvents().page.nextCursor
  feed.recordContinuityGap()
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: SECOND_MESSAGE_ID,
  }), true)

  const reset = feed.listEvents({ afterCursor: beforeGap })
  assert.equal(reset.page.resetRequired, true)
  assert.equal(reset.page.resetReason, "connection-gap")
  assert.match(reset.page.nextCursor, /^gw1\.testcursor12\.1\.2$/)
  const continued = feed.listEvents({ afterCursor: reset.page.nextCursor })
  assert.equal(continued.page.resetRequired, false)
  assert.equal(continued.events.length, 0)
  assert.equal(feed.getStatus().buffer.continuityGaps, 1)
})

test("Gateway scope fails closed after thread mappings disappear", () => {
  const feed = store()
  seedThread(feed)
  assert.equal(feed.ingestDispatch("GUILD_DELETE", {
    id: GUILD_ID,
    unavailable: "yes",
  }), false)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), true)
  assert.equal(feed.ingestDispatch("GUILD_DELETE", {
    id: GUILD_ID,
    unavailable: true,
  }), true)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), false)
  assert.deepEqual(feed.listEvents().events.map((event) => event.kind), [
    "message-created",
    "guild-unavailable",
  ])
})

test("Gateway scope discards stale thread mappings and follows channel-only guild changes", () => {
  const feed = store({ allowedGuildIds: [] })
  seedThread(feed)

  assert.equal(feed.ingestDispatch("GUILD_ROLE_UPDATE", {
    guild_id: GUILD_ID,
    role: { id: "500000000000000001", name: TOKEN },
  }), true)
  assert.equal(feed.ingestDispatch("THREAD_UPDATE", {
    guild_id: GUILD_ID,
    id: THREAD_ID,
    parent_id: OTHER_CHANNEL_ID,
    type: 11,
  }), false)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), false)

  seedThread(feed)
  assert.equal(feed.ingestDispatch("THREAD_UPDATE", {
    guild_id: GUILD_ID,
    id: THREAD_ID,
    parent_id: "invalid-parent",
    type: 11,
  }), false)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), false)

  seedThread(feed)
  assert.equal(feed.ingestDispatch("CHANNEL_DELETE", {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    type: 0,
  }), true)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: THREAD_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), false)
  assert.deepEqual(feed.listEvents().events.map((event) => event.kind), [
    "role-updated",
    "channel-deleted",
  ])
})

test("Gateway synchronization rejects nested channel identities from another guild", () => {
  const feed = store({ allowedGuildIds: [] })
  assert.equal(feed.ingestDispatch("GUILD_CREATE", {
    channels: [],
    id: GUILD_ID,
    threads: [{
      guild_id: OTHER_GUILD_ID,
      id: THREAD_ID,
      parent_id: CHANNEL_ID,
      type: 11,
    }],
  }), false)
  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: THREAD_ID,
    guild_id: OTHER_GUILD_ID,
    id: MESSAGE_ID,
  }), false)
})

test("Gateway change listeners observe events and status until removed", () => {
  const feed = store()
  const changes: string[] = []
  const remove = feed.subscribe((kind) => changes.push(kind))

  feed.transition("connecting")
  feed.recordIdentify()
  feed.transition("ready")
  feed.ingestDispatch("MESSAGE_DELETE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })
  feed.recordContinuityGap()
  remove()
  feed.transition("reconnecting", "network-error")

  assert.deepEqual(changes, [
    "status",
    "status",
    "status",
    "events",
    "status",
    "events",
    "status",
  ])
  assert.deepEqual(feed.getStatus().connection.lastError, {
    at: "2026-08-19T00:00:03.000Z",
    category: "network-error",
  })
})

test("Gateway change listener failures cannot interrupt event ingestion", () => {
  const feed = store()
  let observed = 0
  feed.subscribe(() => {
    throw new Error(TOKEN)
  })
  feed.subscribe(() => {
    observed += 1
  })

  assert.equal(feed.ingestDispatch("MESSAGE_CREATE", {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  }), true)
  assert.equal(observed, 2)
  assert.equal(feed.listEvents().events.length, 1)
})
