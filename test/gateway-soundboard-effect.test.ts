import assert from "node:assert/strict"
import test from "node:test"

import {
  DisabledGatewaySoundboardEffectSource,
  projectGatewaySoundboardEffect,
  soundboardEffectTarget,
  soundboardPlaybackChannelIds,
} from "../src/gateway-soundboard-effect.js"

const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const SOUND_ID = "1"
const SECRET = "private non-target effect data"

test("Gateway soundboard projection retains only exact content-free corroboration", () => {
  const projected = projectGatewaySoundboardEffect({
    channelId: CHANNEL_ID,
    gatewaySequence: 17,
    guildId: GUILD_ID,
    observedAt: "2026-08-28T12:00:00.000Z",
    soundId: SOUND_ID,
    userId: BOT_ID,
    value: {
      channel_id: CHANNEL_ID,
      emoji: { id: SECRET, name: SECRET },
      future: SECRET,
      guild_id: GUILD_ID,
      sound_id: 1,
      sound_volume: 0.8,
      user_id: BOT_ID,
    },
  })
  assert.deepEqual(projected, {
    channelId: CHANNEL_ID,
    freshness: {
      gatewaySequence: 17,
      observedAt: "2026-08-28T12:00:00.000Z",
      source: "gateway-voice-channel-effect-send",
    },
    guildId: GUILD_ID,
    privacy: {
      nonTargetEvents: "discarded",
      persistence: "none",
      rawPayloads: "omitted",
    },
    schemaVersion: 1,
    soundId: SOUND_ID,
    unknownFieldCount: 1,
    userId: BOT_ID,
  })
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(SECRET))
})

test("Gateway soundboard targets normalize integer defaults and reject malformed identities", () => {
  assert.deepEqual(soundboardEffectTarget({
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    sound_id: 1,
    user_id: BOT_ID,
  }), {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    soundId: SOUND_ID,
    userId: BOT_ID,
  })
  for (const value of [
    null,
    {},
    { channel_id: CHANNEL_ID, guild_id: GUILD_ID, sound_id: 0, user_id: BOT_ID },
    { channel_id: "invalid", guild_id: GUILD_ID, sound_id: 1, user_id: BOT_ID },
    { channel_id: CHANNEL_ID, guild_id: GUILD_ID, sound_id: 1, user_id: "invalid" },
  ]) {
    assert.equal(soundboardEffectTarget(value), undefined)
  }
})

test("Gateway soundboard projection rejects mismatches and invalid freshness", () => {
  const value = {
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    sound_id: 1,
    user_id: BOT_ID,
  }
  for (const override of [
    { channelId: "300000000000000002" },
    { gatewaySequence: -1 },
    { observedAt: "invalid" },
    { soundId: "2" },
    { userId: "400000000000000002" },
  ]) {
    assert.throws(
      () => projectGatewaySoundboardEffect({
        channelId: CHANNEL_ID,
        gatewaySequence: 1,
        guildId: GUILD_ID,
        observedAt: "2026-08-28T12:00:00.000Z",
        soundId: SOUND_ID,
        userId: BOT_ID,
        value,
        ...override,
      }),
      /invalid soundboard playback evidence/,
    )
  }
})

test("Gateway soundboard scope and disabled source fail closed", async () => {
  assert.deepEqual([...soundboardPlaybackChannelIds({
    allowSoundboardPlayback: true,
    soundboardPlaybackChannelIds: new Set([CHANNEL_ID]),
  })], [CHANNEL_ID])
  assert.deepEqual([...soundboardPlaybackChannelIds({
    allowSoundboardPlayback: false,
    soundboardPlaybackChannelIds: new Set([CHANNEL_ID]),
  })], [])
  const disabled = new DisabledGatewaySoundboardEffectSource()
  await assert.rejects(
    disabled.waitForSoundboardPlaybackEvent(GUILD_ID, CHANNEL_ID, BOT_ID, SOUND_ID),
    /evidence is disabled/,
  )
})
