import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import {
  ChannelMetadataService,
  normalizeChannelMetadataChangeRequest,
  type ChannelMetadataChangeRequest,
  type ChannelMetadataServiceClient,
} from "../src/channel-metadata-service.js"
import type {
  DiscordChannelMetadata,
  ModifyChannelMetadataInput,
} from "../src/discord-client.js"
import {
  ChannelMetadataEvidenceError,
  ChannelMetadataExecutionError,
  ChannelMetadataPlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import type {
  OperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"

const APPLICATION_ID = "500000000000000001"
const BOT_ID = "600000000000000001"
const GUILD_ID = "700000000000000001"
const OWNER_ID = "700000000000000002"
const CHANNEL_ID = "800000000000000001"
const UNCERTAIN_CHANNEL_ID = "800000000000000002"
const OPERATION_KEY = "channel-metadata-op-001"
const PLAN_KEY = new Uint8Array(32).fill(7)

function metadata(
  overrides: Partial<DiscordChannelMetadata> = {},
): DiscordChannelMetadata {
  return {
    defaultAutoArchiveDuration: 1_440,
    defaultThreadRateLimitPerUser: 0,
    guildId: GUILD_ID,
    id: CHANNEL_ID,
    name: "general",
    nsfw: false,
    parentId: null,
    permissionOverwrites: [],
    position: 1,
    rateLimitPerUser: 0,
    topic: "General discussion",
    type: 0,
    unknownFieldCount: 0,
    ...overrides,
  }
}

function cloneMetadata(value: DiscordChannelMetadata): DiscordChannelMetadata {
  return structuredClone(value)
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  failAppend = false

  async append(entry: ActivityEntry): Promise<void> {
    if (this.failAppend) throw new Error("activity unavailable")
    this.entries.push(structuredClone(entry))
  }

  async list(): Promise<ActivityList> {
    return {
      entries: structuredClone(this.entries),
      file: "/private/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()
  finishCalls = 0
  reserveCalls = 0

  #key(kind: OperationKind, hash: string): string {
    return `${kind}:${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(
    kind: OperationKind,
    operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    const receipt = this.receipts.get(this.#key(kind, operationKeyHash))
    return receipt ? structuredClone(receipt) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.reserveCalls += 1
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

class FixtureClient implements ChannelMetadataServiceClient {
  current: DiscordChannelMetadata
  driftReadback = false
  getCalls = 0
  guildOwnerId = OWNER_ID
  memberBot = true
  memberRoles: string[] = []
  patchCalls: Array<{
    auditReason: string
    channelId: string
    input: ModifyChannelMetadataInput
  }> = []
  patchError: unknown
  permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
  private patched = false

  constructor(initial = metadata()) {
    this.current = cloneMetadata(initial)
  }

  async getGuild() {
    return {
      id: GUILD_ID,
      name: "Private guild name",
      owner_id: this.guildOwnerId,
    }
  }

  async getGuildChannelMetadata(channelId: string) {
    this.getCalls += 1
    const result = cloneMetadata(this.current)
    if (this.patched && this.driftReadback) result.position += 1
    assert.equal(result.id, channelId)
    return result
  }

  async getGuildMember() {
    return {
      roles: [...this.memberRoles],
      user: {
        bot: this.memberBot,
        id: BOT_ID,
        username: "connector-bot",
      },
    }
  }

  async getGuildRoles() {
    return [{
      id: GUILD_ID,
      managed: false,
      name: "@everyone",
      permissions: this.permissions.toString(),
      position: 0,
    }]
  }

  async modifyGuildChannelMetadata(
    channelId: string,
    input: ModifyChannelMetadataInput,
    auditReason: string,
  ) {
    this.patchCalls.push({
      auditReason,
      channelId,
      input: structuredClone(input),
    })
    if (this.patchError) throw this.patchError
    this.current = {
      ...this.current,
      ...input,
    }
    this.patched = true
    return cloneMetadata(this.current)
  }
}

function policy(channelId = CHANNEL_ID) {
  return new ScopePolicy({
    adminGuildIds: new Set<string>(),
    allowedChannelIds: new Set([channelId]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowChannelMetadataChanges: true,
    allowDeletions: false,
    allowInteractions: false,
    channelMetadataIds: new Set([channelId]),
    deleteChannelIds: new Set<string>(),
    interactionChannelIds: new Set<string>(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set<string>(),
    protectedUserIds: new Set<string>(),
  })
}

function request(
  overrides: Partial<ChannelMetadataChangeRequest> = {},
): ChannelMetadataChangeRequest {
  return {
    auditReason: "Reviewed channel metadata",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    name: "announcements",
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function fixture(initial = metadata(), selectedPolicy = policy()) {
  const activityStore = new MemoryActivityStore()
  const client = new FixtureClient(initial)
  const operationStore = new MemoryOperationStore()
  const service = new ChannelMetadataService({
    activityStore,
    client,
    clock: () => new Date("2026-08-21T12:00:00.000Z"),
    operationStore,
    planKey: PLAN_KEY,
    policy: selectedPolicy,
    randomId: () => "activity-channel-metadata-001",
  })
  return { activityStore, client, operationStore, service }
}

test("channel metadata request normalization preserves explicit fields and canonicalizes empty topic", () => {
  const normalized = normalizeChannelMetadataChangeRequest({
    auditReason: "Reviewed channel metadata",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    nsfw: false,
    operationKey: OPERATION_KEY,
    rateLimitPerUser: 0,
    topic: "",
  })

  assert.deepEqual(normalized.requestedFields, ["nsfw", "rateLimitPerUser", "topic"])
  assert.equal(normalized.topic, null)
  assert.equal(normalized.nsfw, false)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
})

test("channel metadata request normalization rejects missing, undefined, unknown, and invalid fields", () => {
  assert.throws(
    () => normalizeChannelMetadataChangeRequest({
      auditReason: "Reviewed",
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      operationKey: OPERATION_KEY,
    }),
    /at least one explicit field/,
  )
  assert.throws(
    () => normalizeChannelMetadataChangeRequest({
      ...request(),
      name: undefined,
    } as unknown as ChannelMetadataChangeRequest),
    /cannot be undefined/,
  )
  assert.throws(
    () => normalizeChannelMetadataChangeRequest({
      ...request(),
      parentId: CHANNEL_ID,
    } as ChannelMetadataChangeRequest),
    /request is invalid/,
  )
  assert.throws(
    () => normalizeChannelMetadataChangeRequest(request({ rateLimitPerUser: 21_601 })),
    /between 0 and 21600/,
  )
})

test("channel metadata read returns a strict transient projection inside ordinary scope", async () => {
  const { service } = fixture()

  const result = await service.get(CHANNEL_ID)

  assert.equal(result.status, "ok")
  assert.equal(result.metadata.name, "general")
  assert.equal(result.metadata.topic, "General discussion")
  assert.deepEqual(result.metadata.applicableFields, [
    "defaultAutoArchiveDuration",
    "defaultThreadRateLimitPerUser",
    "name",
    "nsfw",
    "rateLimitPerUser",
    "topic",
  ])
  assert.deepEqual(result.privacy, {
    persistence: "none",
    rawPayloads: "omitted",
    text: "included",
    unknownFields: "counts-only",
  })
})

test("channel metadata planning preserves omitted fields and binds complete authority evidence", async () => {
  const { service } = fixture()

  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.status, "planned")
  assert.deepEqual(plan.requestedFields, ["name"])
  assert.deepEqual(plan.changedFields, ["name"])
  assert.equal(plan.current.topic, "General discussion")
  assert.equal(plan.desired.topic, "General discussion")
  assert.equal(plan.desired.name, "announcements")
  assert.equal(plan.access.viewChannel, true)
  assert.equal(plan.access.manageChannels, true)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
})

test("channel metadata planning rejects inapplicable fields and incomplete permission authority", async () => {
  const category = metadata({
    defaultAutoArchiveDuration: null,
    defaultThreadRateLimitPerUser: null,
    nsfw: null,
    rateLimitPerUser: null,
    topic: null,
    type: 4,
  })
  const categoryFixture = fixture(category)
  await assert.rejects(
    categoryFixture.service.plan(
      APPLICATION_ID,
      BOT_ID,
      {
        auditReason: "Reviewed channel metadata",
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        operationKey: OPERATION_KEY,
        topic: "not applicable",
      },
    ),
    /does not support metadata field topic/,
  )

  const permissionFixture = fixture()
  permissionFixture.client.permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
  await assert.rejects(
    permissionFixture.service.plan(APPLICATION_ID, BOT_ID, request()),
    ChannelMetadataEvidenceError,
  )

  const voice = metadata({
    defaultAutoArchiveDuration: null,
    defaultThreadRateLimitPerUser: null,
    topic: null,
    type: 2,
  })
  const voiceFixture = fixture(voice)
  await assert.rejects(
    voiceFixture.service.plan(APPLICATION_ID, BOT_ID, request()),
    /effective channel-metadata authority/,
  )
  voiceFixture.client.permissions |= DISCORD_PERMISSIONS.CONNECT
  const voicePlan = await voiceFixture.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(voicePlan.access.connect, true)
  assert.deepEqual(voicePlan.access.requiredChangePermissions, [
    "MANAGE_CHANNELS",
    "VIEW_CHANNEL",
    "CONNECT",
  ])
})

test("channel metadata planning binds guild-owner authority without weakening exact bot evidence", async () => {
  const ownerFixture = fixture()
  ownerFixture.client.guildOwnerId = BOT_ID
  ownerFixture.client.permissions = 0n

  const plan = await ownerFixture.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.access.botGuildOwner, true)
  assert.equal(plan.access.botAdministrator, false)
  assert.equal(plan.access.viewChannel, true)
  assert.equal(plan.access.manageChannels, true)

  const nonBotFixture = fixture()
  nonBotFixture.client.memberBot = false
  await assert.rejects(
    nonBotFixture.service.plan(APPLICATION_ID, BOT_ID, request()),
    /invalid connector membership evidence/,
  )

  const everyoneMemberRoleFixture = fixture()
  everyoneMemberRoleFixture.client.memberRoles = [GUILD_ID]
  await assert.rejects(
    everyoneMemberRoleFixture.service.plan(APPLICATION_ID, BOT_ID, request()),
    /invalid connector membership evidence/,
  )
})

test("already-current channel metadata execution skips reservation, activity, and write", async () => {
  const { activityStore, client, operationStore, service } = fixture()
  const noChange = request({ name: "general" })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, noChange)

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    noChange,
    plan.digest,
  )

  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(client.patchCalls.length, 0)
  assert.equal(operationStore.reserveCalls, 0)
  assert.equal(activityStore.entries.length, 0)
})

test("channel metadata execution writes only changed fields and records content-free evidence", async () => {
  const { activityStore, client, operationStore, service } = fixture()
  const change = request({
    name: "announcements",
    topic: null,
  })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, change)

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    change,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.deepEqual(client.patchCalls, [{
    auditReason: "Reviewed channel metadata",
    channelId: CHANNEL_ID,
    input: { name: "announcements", topic: null },
  }])
  assert.deepEqual(
    activityStore.entries.map(({ status }) => status),
    ["pending", "completed"],
  )
  assert.equal(operationStore.reserveCalls, 1)
  assert.equal(operationStore.finishCalls, 1)
  const serialized = JSON.stringify(activityStore.entries)
  for (const forbidden of [
    "General discussion",
    "announcements",
    "Reviewed channel metadata",
    OPERATION_KEY,
  ]) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test("channel metadata execution rejects stale plans before reservation or write", async () => {
  const { client, operationStore, service } = fixture()
  const change = request()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, change)
  client.current.position = 2

  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    ChannelMetadataPlanChangedError,
  )
  assert.equal(client.patchCalls.length, 0)
  assert.equal(operationStore.reserveCalls, 0)

  const typeDriftFixture = fixture()
  const topicChange: ChannelMetadataChangeRequest = {
    auditReason: "Reviewed channel metadata",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: "channel-metadata-op-type-drift",
    topic: "Updated topic",
  }
  const topicPlan = await typeDriftFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    topicChange,
  )
  typeDriftFixture.client.current = metadata({
    defaultAutoArchiveDuration: null,
    defaultThreadRateLimitPerUser: null,
    nsfw: null,
    rateLimitPerUser: null,
    topic: null,
    type: 4,
  })
  await assert.rejects(
    typeDriftFixture.service.execute(
      APPLICATION_ID,
      BOT_ID,
      topicChange,
      topicPlan.digest,
    ),
    ChannelMetadataPlanChangedError,
  )
  assert.equal(typeDriftFixture.operationStore.reserveCalls, 0)
})

test("channel metadata execution reports complete response or readback drift", async () => {
  const { client, service } = fixture()
  client.driftReadback = true
  const change = request()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, change)

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    change,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, false)
  assert.equal(result.observed.position, 2)
})

test("channel metadata 4xx failures settle while ambiguous failures permanently block the channel", async () => {
  const failedFixture = fixture()
  failedFixture.client.patchError = new DiscordApiError({
    code: 50_013,
    message: "Discord rejected the request",
    method: "PATCH",
    route: `/channels/${CHANNEL_ID}`,
    status: 403,
  })
  const failedRequest = request({ operationKey: "channel-metadata-op-403" })
  const failedPlan = await failedFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    failedRequest,
  )
  await assert.rejects(
    failedFixture.service.execute(
      APPLICATION_ID,
      BOT_ID,
      failedRequest,
      failedPlan.digest,
    ),
    (error: unknown) => {
      assert(error instanceof ChannelMetadataExecutionError)
      assert.deepEqual(
        (error.result as { status: string }).status,
        "failed",
      )
      return true
    },
  )

  const uncertainMetadata = metadata({ id: UNCERTAIN_CHANNEL_ID })
  const uncertainFixture = fixture(
    uncertainMetadata,
    policy(UNCERTAIN_CHANNEL_ID),
  )
  uncertainFixture.client.patchError = new Error("transport failed")
  const uncertainRequest = request({
    channelId: UNCERTAIN_CHANNEL_ID,
    operationKey: "channel-metadata-op-uncertain",
  })
  const uncertainPlan = await uncertainFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    uncertainFixture.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert(error instanceof ChannelMetadataExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const laterRequest = request({
    channelId: UNCERTAIN_CHANNEL_ID,
    operationKey: "channel-metadata-op-later",
  })
  await assert.rejects(
    uncertainFixture.service.execute(
      APPLICATION_ID,
      BOT_ID,
      laterRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert(error instanceof ChannelMetadataExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
})
