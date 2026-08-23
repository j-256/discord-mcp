import assert from "node:assert/strict"
import test from "node:test"

import { DISCORD_LIMITS } from "../src/constants.js"
import type { DiscordVoiceRegion } from "../src/discord-client.js"
import { VoiceRegionEvidenceError } from "../src/errors.js"
import {
  VoiceRegionService,
  type VoiceRegionServiceClient,
} from "../src/voice-region-service.js"

const GUILD_ID = "200000000000000001"

function region(
  id: string,
  overrides: Partial<DiscordVoiceRegion> = {},
): DiscordVoiceRegion {
  return {
    custom: false,
    deprecated: false,
    id,
    name: `Region ${id}`,
    optimal: false,
    unknownFieldCount: 0,
    ...overrides,
  }
}

function fixture(options: {
  guildRegions?: DiscordVoiceRegion[]
  globalRegions?: DiscordVoiceRegion[]
  policyError?: Error
} = {}) {
  const calls = {
    global: 0,
    guild: 0,
    policy: 0,
  }
  let globalOptions: unknown
  let guildOptions: unknown
  const client: VoiceRegionServiceClient = {
    async listGuildVoiceRegions(guildId, requestOptions) {
      calls.guild += 1
      assert.equal(guildId, GUILD_ID)
      guildOptions = requestOptions
      return structuredClone(options.guildRegions ?? [])
    },
    async listVoiceRegions(requestOptions) {
      calls.global += 1
      globalOptions = requestOptions
      return structuredClone(options.globalRegions ?? [])
    },
  }
  const service = new VoiceRegionService({
    client,
    policy: {
      assertGuildAllowed(guildId) {
        calls.policy += 1
        assert.equal(guildId, GUILD_ID)
        if (options.policyError) throw options.policyError
      },
    },
  })
  return {
    calls,
    getGlobalOptions: () => globalOptions,
    getGuildOptions: () => guildOptions,
    service,
  }
}

test("voice-region service returns deterministic complete privacy-safe inventories", async () => {
  const controller = new AbortController()
  const first = region("brazil", { name: "Brazil", optimal: true, unknownFieldCount: 2 })
  const second = region("amsterdam", { custom: true, name: "Amsterdam" })
  const { calls, getGlobalOptions, getGuildOptions, service } = fixture({
    globalRegions: [first, second],
    guildRegions: [first],
  })

  const global = await service.listGlobal({ signal: controller.signal })
  const guild = await service.listGuild(GUILD_ID, { signal: controller.signal })

  assert.deepEqual(global.inventory, { completeness: "complete", returned: 2 })
  assert.deepEqual(global.regions.map(({ id }) => id), ["amsterdam", "brazil"])
  assert.deepEqual(global.scope, { guildId: null, kind: "global" })
  assert.deepEqual(global.privacy, {
    persistence: "none",
    rawPayloads: "omitted",
    text: "transient-untrusted",
    unknownFields: "counts-only",
  })
  assert.deepEqual(guild.scope, { guildId: GUILD_ID, kind: "guild" })
  assert.deepEqual(guild.regions, [first])
  assert.deepEqual(getGlobalOptions(), { signal: controller.signal })
  assert.deepEqual(getGuildOptions(), { signal: controller.signal })
  assert.deepEqual(calls, { global: 1, guild: 1, policy: 1 })
})

test("voice-region service enforces guild scope before Discord access", async () => {
  const denied = new Error("guild denied")
  const { calls, service } = fixture({ policyError: denied })

  await assert.rejects(service.listGuild(GUILD_ID), denied)
  assert.deepEqual(calls, { global: 0, guild: 0, policy: 1 })
})

test("voice-region service rejects malformed, duplicate, and excessive client evidence", async () => {
  for (const regions of [
    [region("us-central"), region("us-central")],
    [region("bad\nregion")],
    [region("us-central", { unknownFieldCount: -1 })],
    [{ ...region("us-central"), raw: "private" } as DiscordVoiceRegion],
    Array.from(
      { length: DISCORD_LIMITS.voiceRegions + 1 },
      (_, index) => region(`region-${index}`),
    ),
  ]) {
    const { service } = fixture({ globalRegions: regions })
    await assert.rejects(service.listGlobal(), VoiceRegionEvidenceError)
  }
})
