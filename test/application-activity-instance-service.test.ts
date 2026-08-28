import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeApplicationActivityInstanceId,
  projectApplicationActivityInstance,
  type DiscordApplicationActivityInstance,
} from "../src/application-activity-instance.js"
import {
  ApplicationActivityInstanceService,
  normalizeApplicationActivityInstanceRequest,
  type ApplicationActivityInstancePolicy,
  type ApplicationActivityInstanceServiceClient,
} from "../src/application-activity-instance-service.js"
import {
  APPLICATION_ACTIVITY_INSTANCE_LIMITS,
  SCHEMA_VERSION,
} from "../src/constants.js"
import {
  ApplicationActivityInstanceEvidenceError,
  DiscordApiError,
  PolicyError,
} from "../src/errors.js"
import type { RequestOptions } from "../src/types.js"

const APPLICATION_ID = "500000000000000001"
const BOT_ID = "600000000000000001"
const GUILD_ID = "700000000000000001"
const CHANNEL_ID = "800000000000000001"
const USER_ID = "900000000000000001"
const OTHER_USER_ID = "900000000000000002"
const LAUNCH_ID = "910000000000000001"
const INSTANCE_ID = `i-${LAUNCH_ID}-gc-${GUILD_ID}-${CHANNEL_ID}`

function rawInstance(overrides: Record<string, unknown> = {}) {
  return {
    application_id: APPLICATION_ID,
    instance_id: INSTANCE_ID,
    launch_id: LAUNCH_ID,
    location: {
      channel_id: CHANNEL_ID,
      guild_id: GUILD_ID,
      id: `gc-${GUILD_ID}-${CHANNEL_ID}`,
      kind: "gc",
    },
    users: [USER_ID, OTHER_USER_ID],
    ...overrides,
  }
}

function projectedInstance(
  overrides: Partial<DiscordApplicationActivityInstance> = {},
): DiscordApplicationActivityInstance {
  return {
    applicationId: APPLICATION_ID,
    instanceId: INSTANCE_ID,
    launchId: LAUNCH_ID,
    location: {
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      kind: "gc",
      unknownFieldCount: 0,
    },
    unknownFieldCount: 0,
    userIds: [USER_ID, OTHER_USER_ID],
    ...overrides,
  }
}

class FixtureClient implements ApplicationActivityInstanceServiceClient {
  applicationIds: string[] = []
  instanceIds: string[] = []
  options: RequestOptions[] = []
  response: DiscordApplicationActivityInstance | Error = projectedInstance()

  async getApplicationActivityInstance(
    applicationId: string,
    instanceId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationActivityInstance> {
    this.applicationIds.push(applicationId)
    this.instanceIds.push(instanceId)
    this.options.push(options)
    if (this.response instanceof Error) throw this.response
    return this.response
  }
}

function fixture(options: {
  channelReadable?: boolean
  client?: ApplicationActivityInstanceServiceClient
  guildAllowed?: boolean
} = {}) {
  const client = options.client ?? new FixtureClient()
  const policyCalls = { channel: 0, guild: 0 }
  const policy: ApplicationActivityInstancePolicy = {
    assertGuildAllowed(guildId) {
      policyCalls.guild += 1
      if (guildId !== GUILD_ID || options.guildAllowed === false) {
        throw new PolicyError("Guild outside scope")
      }
    },
    channelIdReadable(channelId) {
      policyCalls.channel += 1
      return channelId === CHANNEL_ID && options.channelReadable !== false
    },
  }
  return {
    client,
    policyCalls,
    service: new ApplicationActivityInstanceService({ client, policy }),
  }
}

test("Activity-instance projector validates and bounds an exact guild-channel snapshot", () => {
  const privateFutureValue = "private-future-activity-value"
  const result = projectApplicationActivityInstance({
    ...rawInstance(),
    future_private_field: privateFutureValue,
    location: {
      ...(rawInstance().location as Record<string, unknown>),
      future_location_field: privateFutureValue,
    },
  }, APPLICATION_ID, INSTANCE_ID)

  assert.deepEqual(result, {
    applicationId: APPLICATION_ID,
    instanceId: INSTANCE_ID,
    launchId: LAUNCH_ID,
    location: {
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      kind: "gc",
      unknownFieldCount: 1,
    },
    unknownFieldCount: 1,
    userIds: [USER_ID, OTHER_USER_ID],
  })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateFutureValue, "u"))
})

test("Activity-instance projector recognizes a bounded private-channel location", () => {
  const result = projectApplicationActivityInstance(rawInstance({
    location: {
      channel_id: CHANNEL_ID,
      guild_id: null,
      id: `pc-${CHANNEL_ID}`,
      kind: "pc",
    },
  }), APPLICATION_ID, INSTANCE_ID)

  assert.deepEqual(result.location, {
    channelId: CHANNEL_ID,
    guildId: null,
    kind: "pc",
    unknownFieldCount: 0,
  })
})

test("Activity-instance projector rejects malformed or mismatched evidence", () => {
  const tooManyFields = Object.fromEntries(
    Array.from(
      { length: APPLICATION_ACTIVITY_INSTANCE_LIMITS.responseFields + 1 },
      (_, index) => [`field_${index}`, index],
    ),
  )
  const tooManyLocationFields = Object.fromEntries(
    Array.from(
      { length: APPLICATION_ACTIVITY_INSTANCE_LIMITS.locationFields + 1 },
      (_, index) => [`field_${index}`, index],
    ),
  )
  const cases: unknown[] = [
    null,
    [],
    tooManyFields,
    rawInstance({ application_id: "500000000000000002" }),
    rawInstance({ application_id: "0" }),
    rawInstance({ instance_id: "another-instance" }),
    rawInstance({ launch_id: "0" }),
    rawInstance({ location: null }),
    rawInstance({ location: tooManyLocationFields }),
    rawInstance({ location: { channel_id: CHANNEL_ID, guild_id: GUILD_ID, id: "", kind: "gc" } }),
    rawInstance({ location: { channel_id: "0", guild_id: GUILD_ID, id: "gc-valid", kind: "gc" } }),
    rawInstance({ location: { channel_id: CHANNEL_ID, guild_id: null, id: "gc-valid", kind: "gc" } }),
    rawInstance({ location: { channel_id: CHANNEL_ID, guild_id: GUILD_ID, id: "pc-valid", kind: "pc" } }),
    rawInstance({ location: { channel_id: CHANNEL_ID, guild_id: null, id: "unknown", kind: "future" } }),
    rawInstance({ users: null }),
    rawInstance({ users: ["0"] }),
    rawInstance({ users: [USER_ID, USER_ID] }),
    rawInstance({ users: Array.from(
      { length: APPLICATION_ACTIVITY_INSTANCE_LIMITS.participants + 1 },
      (_, index) => String(index + 1),
    ) }),
  ]
  for (const value of cases) {
    assert.throws(
      () => projectApplicationActivityInstance(value, APPLICATION_ID, INSTANCE_ID),
      ApplicationActivityInstanceEvidenceError,
    )
  }
})

test("Activity instance identifiers are opaque, bounded, and safe path segments", () => {
  assert.equal(normalizeApplicationActivityInstanceId(INSTANCE_ID), INSTANCE_ID)
  for (const value of [
    "",
    "contains space",
    "contains/slash",
    "contains\\backslash",
    "contains?query",
    "contains#fragment",
    "line\nbreak",
    "c1\u0085control",
    "\uD800",
    "x".repeat(APPLICATION_ACTIVITY_INSTANCE_LIMITS.instanceIdCharacters + 1),
  ]) {
    assert.throws(
      () => normalizeApplicationActivityInstanceId(value),
      RangeError,
    )
  }
})

test("Activity-instance request normalization rejects invalid and unknown inputs", () => {
  assert.deepEqual(normalizeApplicationActivityInstanceRequest({
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    instanceId: INSTANCE_ID,
    userId: USER_ID,
  }), {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    instanceId: INSTANCE_ID,
    userId: USER_ID,
  })
  for (const value of [
    null,
    { channelId: "0", guildId: GUILD_ID, instanceId: INSTANCE_ID },
    { channelId: CHANNEL_ID, guildId: "0", instanceId: INSTANCE_ID },
    { channelId: CHANNEL_ID, guildId: GUILD_ID, instanceId: "bad/id" },
    { channelId: CHANNEL_ID, guildId: GUILD_ID, instanceId: INSTANCE_ID, userId: "0" },
    { channelId: CHANNEL_ID, extra: true, guildId: GUILD_ID, instanceId: INSTANCE_ID },
  ]) {
    assert.throws(
      () => normalizeApplicationActivityInstanceRequest(value as never),
      RangeError,
    )
  }
})

test("Activity-instance service returns count-only participant and exact-user evidence", async () => {
  const { client, policyCalls, service } = fixture()
  const signal = new AbortController().signal

  const result = await service.inspect(APPLICATION_ID, BOT_ID, {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    instanceId: INSTANCE_ID,
    userId: USER_ID,
  }, { signal })

  assert.equal(result.active, true)
  assert.deepEqual(result.application, { botId: BOT_ID, id: APPLICATION_ID })
  assert.equal(result.launchId, LAUNCH_ID)
  assert.equal(result.participantCount, 2)
  assert.deepEqual(result.expected.user, { id: USER_ID, present: true })
  assert.deepEqual(result.location, {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    kind: "guild-channel",
  })
  assert.equal(result.privacy.participantEvidence, "count-and-exact-membership-only")
  assert.equal(result.privacy.persistence, "none")
  assert.equal(result.schemaVersion, SCHEMA_VERSION)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(OTHER_USER_ID, "u"))
  assert.deepEqual(policyCalls, { channel: 1, guild: 1 })
  assert.deepEqual((client as FixtureClient).applicationIds, [APPLICATION_ID])
  assert.equal((client as FixtureClient).options[0]?.signal, signal)
})

test("Activity-instance service omits the optional membership answer when not requested", async () => {
  const { service } = fixture()

  const result = await service.inspect(APPLICATION_ID, BOT_ID, {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    instanceId: INSTANCE_ID,
  })

  assert.equal(result.expected.user, null)
})

test("Activity-instance service returns a structured inactive result only for not found", async () => {
  const client = new FixtureClient()
  client.response = new DiscordApiError({
    message: "not found",
    method: "GET",
    route: "/applications/{application.id}/activity-instances/{instance.id}",
    status: 404,
  })
  const { service } = fixture({ client })

  const result = await service.inspect(APPLICATION_ID, BOT_ID, {
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    instanceId: INSTANCE_ID,
    userId: USER_ID,
  })

  assert.equal(result.active, false)
  assert.equal(result.launchId, null)
  assert.equal(result.location, null)
  assert.equal(result.participantCount, null)
  assert.deepEqual(result.expected.user, { id: USER_ID, present: null })
  assert.deepEqual(result.evidence, {
    locationUnknownFields: null,
    responseUnknownFields: null,
  })
})

test("Activity-instance service fails closed for mismatched and private locations", async () => {
  for (const location of [
    { channelId: CHANNEL_ID, guildId: null, kind: "pc" as const, unknownFieldCount: 0 },
    { channelId: CHANNEL_ID, guildId: "700000000000000002", kind: "gc" as const, unknownFieldCount: 0 },
    { channelId: "800000000000000002", guildId: GUILD_ID, kind: "gc" as const, unknownFieldCount: 0 },
  ]) {
    const client = new FixtureClient()
    client.response = projectedInstance({ location })
    const { service } = fixture({ client })
    await assert.rejects(
      service.inspect(APPLICATION_ID, BOT_ID, {
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        instanceId: INSTANCE_ID,
      }),
      ApplicationActivityInstanceEvidenceError,
    )
  }
})

test("Activity-instance service enforces expected scope before the instance request", async () => {
  for (const options of [
    { guildAllowed: false },
    { channelReadable: false },
  ]) {
    const client = new FixtureClient()
    const { service } = fixture({ client, ...options })
    await assert.rejects(
      service.inspect(APPLICATION_ID, BOT_ID, {
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        instanceId: INSTANCE_ID,
      }),
      PolicyError,
    )
    assert.equal(client.applicationIds.length, 0)
  }
})

test("Activity-instance service rejects invalid verified identity and incomplete client support", async () => {
  const client = new FixtureClient()
  const { service } = fixture({ client })
  await assert.rejects(
    service.inspect("0", BOT_ID, {
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      instanceId: INSTANCE_ID,
    }),
    ApplicationActivityInstanceEvidenceError,
  )
  assert.equal(client.applicationIds.length, 0)

  await assert.rejects(
    fixture({ client: {} }).service.inspect(APPLICATION_ID, BOT_ID, {
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      instanceId: INSTANCE_ID,
    }),
    ApplicationActivityInstanceEvidenceError,
  )
})

test("Activity-instance service propagates non-not-found Discord failures", async () => {
  const client = new FixtureClient()
  const forbidden = new DiscordApiError({
    message: "forbidden",
    method: "GET",
    route: "/applications/{application.id}/activity-instances/{instance.id}",
    status: 403,
  })
  client.response = forbidden

  await assert.rejects(
    fixture({ client }).service.inspect(APPLICATION_ID, BOT_ID, {
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      instanceId: INSTANCE_ID,
    }),
    (error: unknown) => error === forbidden,
  )
})
