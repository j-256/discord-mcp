import assert from "node:assert/strict"
import test from "node:test"

import {
  projectGatewayVoiceChannelStatus,
  projectGatewayVoiceChannelStatusUpdate,
} from "../src/gateway-voice-channel-status.js"

const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const OTHER_CHANNEL_ID = "300000000000000002"
const SECRET = "non-target private status"

test("Gateway channel-info projection selects one exact status and discards non-target text", () => {
  const projected = projectGatewayVoiceChannelStatus({
    channelId: CHANNEL_ID,
    gatewaySequence: 9,
    guildId: GUILD_ID,
    observedAt: "2026-08-24T01:00:01.000Z",
    requestedAt: "2026-08-24T01:00:00.000Z",
    value: {
      channels: [
        { id: OTHER_CHANNEL_ID, status: SECRET },
        { future: SECRET, id: CHANNEL_ID, status: "Office hours" },
      ],
      future: SECRET,
      guild_id: GUILD_ID,
    },
  })

  assert.deepEqual(projected, {
    channelId: CHANNEL_ID,
    evidence: {
      discardedChannelEntries: 1,
      responseUnknownFieldCount: 1,
      returnedChannelEntries: 2,
      statusRepresentation: "value",
      targetUnknownFieldCount: 1,
    },
    freshness: {
      gatewaySequence: 9,
      observedAt: "2026-08-24T01:00:01.000Z",
      requestedAt: "2026-08-24T01:00:00.000Z",
      source: "gateway-request-channel-info",
    },
    guildId: GUILD_ID,
    privacy: {
      nonTargetStatusText: "discarded-before-projection",
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
    },
    schemaVersion: 1,
    status: "Office hours",
  })
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(SECRET))
})

test("Gateway channel-info projection preserves cleared field representation", () => {
  for (const [channel, representation] of [
    [{ id: CHANNEL_ID }, "omitted"],
    [{ id: CHANNEL_ID, status: null }, "null"],
  ] as const) {
    const projected = projectGatewayVoiceChannelStatus({
      channelId: CHANNEL_ID,
      gatewaySequence: 1,
      guildId: GUILD_ID,
      observedAt: "2026-08-24T01:00:01.000Z",
      requestedAt: "2026-08-24T01:00:00.000Z",
      value: { channels: [channel], guild_id: GUILD_ID },
    })
    assert.equal(projected.status, null)
    assert.equal(projected.evidence.statusRepresentation, representation)
  }
})

test("Gateway channel-info projection fails closed on malformed or incomplete evidence", () => {
  for (const value of [
    null,
    { channels: [], guild_id: GUILD_ID },
    { channels: [{ id: CHANNEL_ID }, { id: CHANNEL_ID }], guild_id: GUILD_ID },
    { channels: [{ id: CHANNEL_ID, status: "x".repeat(501) }], guild_id: GUILD_ID },
    { channels: [{ id: "invalid" }], guild_id: GUILD_ID },
    { channels: [{ id: CHANNEL_ID }], guild_id: OTHER_CHANNEL_ID },
  ]) {
    assert.throws(
      () => projectGatewayVoiceChannelStatus({
        channelId: CHANNEL_ID,
        gatewaySequence: 1,
        guildId: GUILD_ID,
        observedAt: "2026-08-24T01:00:01.000Z",
        requestedAt: "2026-08-24T01:00:00.000Z",
        value,
      }),
      /Gateway returned invalid|omitted the exact target/,
    )
  }
})

test("Gateway status-update projection is exact, bounded, and count-only for unknown fields", () => {
  const projected = projectGatewayVoiceChannelStatusUpdate({
    channelId: CHANNEL_ID,
    gatewaySequence: 12,
    guildId: GUILD_ID,
    observedAt: "2026-08-24T01:00:02.000Z",
    value: {
      future: SECRET,
      guild_id: GUILD_ID,
      id: CHANNEL_ID,
      status: null,
    },
  })
  assert.deepEqual(projected, {
    channelId: CHANNEL_ID,
    freshness: {
      gatewaySequence: 12,
      observedAt: "2026-08-24T01:00:02.000Z",
      source: "gateway-voice-channel-status-update",
    },
    guildId: GUILD_ID,
    status: null,
    unknownFieldCount: 1,
  })
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(SECRET))
})
