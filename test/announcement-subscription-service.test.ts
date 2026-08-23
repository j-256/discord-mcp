import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  AnnouncementSubscriptionService,
  normalizeAnnouncementSubscriptionRequest,
  type AnnouncementSubscriptionRequest,
  type AnnouncementSubscriptionServiceClient,
} from "../src/announcement-subscription-service.js"
import { DISCORD_CHANNEL_TYPES, DISCORD_LIMITS } from "../src/constants.js"
import type { DiscordWebhookSummary } from "../src/discord-client.js"
import {
  AnnouncementSubscriptionEvidenceError,
  AnnouncementSubscriptionExecutionError,
  AnnouncementSubscriptionOperationConflictError,
  AnnouncementSubscriptionPlanChangedError,
  DiscordApiError,
  PolicyError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const SOURCE_GUILD_ID = "200000000000000001"
const TARGET_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const SOURCE_CHANNEL_ID = "500000000000000001"
const TARGET_CHANNEL_ID = "500000000000000002"
const OTHER_TARGET_CHANNEL_ID = "500000000000000003"
const OUT_OF_SCOPE_SOURCE_CHANNEL_ID = "500000000000000004"
const OUT_OF_SCOPE_SOURCE_GUILD_ID = "200000000000000004"
const FOLLOWER_WEBHOOK_ID = "600000000000000001"
const OTHER_WEBHOOK_ID = "600000000000000002"
const CREATED_WEBHOOK_ID = "600000000000000003"
const NOW = "2026-08-22T00:00:00.000Z"

function role(id: string, permissions: bigint): DiscordRole {
  return {
    id,
    managed: false,
    name: "@everyone",
    permissions: permissions.toString(),
    position: 0,
  }
}

function channel(
  id: string,
  guildId: string,
  type: number,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: guildId,
    id,
    name: id === SOURCE_CHANNEL_ID ? "private-source" : "private-target",
    parent_id: null,
    permission_overwrites: [],
    type,
    ...overrides,
  }
}

function webhook(
  id: string,
  overrides: Partial<DiscordWebhookSummary> = {},
): DiscordWebhookSummary {
  return {
    applicationId: null,
    channelId: TARGET_CHANNEL_ID,
    creatorUserId: BOT_ID,
    guildId: TARGET_GUILD_ID,
    id,
    name: "private-webhook-name",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
    ...overrides,
  }
}

function follower(
  id = FOLLOWER_WEBHOOK_ID,
  overrides: Partial<DiscordWebhookSummary> = {},
): DiscordWebhookSummary {
  return webhook(id, {
    sourceChannelId: SOURCE_CHANNEL_ID,
    sourceGuildId: SOURCE_GUILD_ID,
    type: 2,
    ...overrides,
  })
}

function subscribeRequest(
  overrides: Partial<AnnouncementSubscriptionRequest> = {},
): AnnouncementSubscriptionRequest {
  return {
    action: "subscribe",
    auditReason: "Reviewed announcement subscription",
    operationKey: "announcement-subscription-operation-0001",
    sourceChannelId: SOURCE_CHANNEL_ID,
    targetChannelId: TARGET_CHANNEL_ID,
    ...overrides,
  } as AnnouncementSubscriptionRequest
}

function unsubscribeRequest(
  overrides: Partial<AnnouncementSubscriptionRequest> = {},
): AnnouncementSubscriptionRequest {
  return {
    action: "unsubscribe",
    auditReason: "Reviewed announcement unsubscription",
    operationKey: "announcement-unsubscription-operation-0001",
    targetChannelId: TARGET_CHANNEL_ID,
    webhookId: FOLLOWER_WEBHOOK_ID,
    ...overrides,
  } as AnnouncementSubscriptionRequest
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  sourceIds?: readonly string[]
  targetIds?: readonly string[]
} = {}): ScopePolicy {
  const sourceIds = options.sourceIds ?? [SOURCE_CHANNEL_ID]
  const targetIds = options.targetIds ?? [TARGET_CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([...sourceIds, ...targetIds]),
    allowedGuildIds: new Set([SOURCE_GUILD_ID, TARGET_GUILD_ID]),
    allowAdministration: false,
    allowAnnouncementSubscriptionAudit: options.audit ?? true,
    allowAnnouncementSubscriptionChanges: options.changes ?? true,
    allowDeletions: false,
    allowInteractions: false,
    announcementSubscriptionSourceChannelIds: new Set(sourceIds),
    announcementSubscriptionTargetChannelIds: new Set(targetIds),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  finishError: unknown = undefined
  readonly receipts = new Map<string, OperationReceipt>()

  async finish(receipt: OperationReceipt): Promise<void> {
    if (this.finishError) throw this.finishError
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(`${kind}:${hash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureStatus: "completed" | "completed-with-drift" | "pending" | null
  deleteError: unknown
  deleteUpdatesState: boolean
  followError: unknown
  followGate: Promise<void> | null
  followUpdatesState: boolean
  readbackDrift: boolean
  readbackError: unknown
}

function fixture(options: {
  inventory?: DiscordWebhookSummary[]
  policy?: ScopePolicy
  sameGuild?: boolean
  state?: Partial<FixtureState>
} = {}) {
  const sameGuild = options.sameGuild ?? false
  const sourceGuildId = sameGuild ? TARGET_GUILD_ID : SOURCE_GUILD_ID
  const channels = new Map<string, DiscordChannel>([
    [SOURCE_CHANNEL_ID, channel(
      SOURCE_CHANNEL_ID,
      sourceGuildId,
      DISCORD_CHANNEL_TYPES.announcement,
    )],
    [TARGET_CHANNEL_ID, channel(
      TARGET_CHANNEL_ID,
      TARGET_GUILD_ID,
      DISCORD_CHANNEL_TYPES.text,
    )],
    [OTHER_TARGET_CHANNEL_ID, channel(
      OTHER_TARGET_CHANNEL_ID,
      TARGET_GUILD_ID,
      DISCORD_CHANNEL_TYPES.text,
    )],
  ])
  let inventory = [...(options.inventory ?? [webhook(OTHER_WEBHOOK_ID)])]
  const state: FixtureState = {
    activityFailureStatus: null,
    deleteError: undefined,
    deleteUpdatesState: true,
    followError: undefined,
    followGate: null,
    followUpdatesState: true,
    readbackDrift: false,
    readbackError: undefined,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const calls = {
    delete: 0,
    follow: 0,
    guild: new Map<string, number>(),
    member: new Map<string, number>(),
    roles: new Map<string, number>(),
  }
  const operationStore = new MemoryOperationStore()
  let mutationCompleted = false
  const activityStore: ActivityStore = {
    async append(entry) {
      if (entry.status === state.activityFailureStatus) {
        throw new Error("private activity failure")
      }
      events.push(`activity:${entry.kind}:${entry.status}`)
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: AnnouncementSubscriptionServiceClient = {
    async deleteWebhook(webhookId, reason) {
      calls.delete += 1
      events.push(`write:delete:${reason}`)
      if (state.deleteError) throw state.deleteError
      mutationCompleted = true
      if (state.deleteUpdatesState) {
        inventory = inventory.filter((entry) => entry.id !== webhookId)
      }
    },
    async followAnnouncementChannel(sourceChannelId, targetChannelId, reason) {
      calls.follow += 1
      events.push(`write:follow:${reason}`)
      if (state.followGate) await state.followGate
      if (state.followError) throw state.followError
      mutationCompleted = true
      if (state.followUpdatesState) {
        inventory.push(follower(CREATED_WEBHOOK_ID, {
          channelId: targetChannelId,
          sourceChannelId,
          sourceGuildId,
        }))
      }
      return { sourceChannelId, webhookId: CREATED_WEBHOOK_ID }
    },
    async getChannel(channelId) {
      const result = channels.get(channelId)
      if (!result) throw new Error("channel fixture missing")
      return result
    },
    async getGuild(guildId) {
      calls.guild.set(guildId, (calls.guild.get(guildId) ?? 0) + 1)
      return { id: guildId, name: `private-guild-${guildId}` }
    },
    async getGuildMember(guildId): Promise<DiscordGuildMember> {
      calls.member.set(guildId, (calls.member.get(guildId) ?? 0) + 1)
      return {
        roles: [],
        user: { bot: true, id: BOT_ID, username: "connector" },
      }
    },
    async getGuildRoles(guildId) {
      calls.roles.set(guildId, (calls.roles.get(guildId) ?? 0) + 1)
      const permissions = guildId === TARGET_GUILD_ID
        ? DISCORD_PERMISSIONS.MANAGE_WEBHOOKS | DISCORD_PERMISSIONS.VIEW_CHANNEL
        : DISCORD_PERMISSIONS.VIEW_CHANNEL
      return [role(guildId, permissions)]
    },
    async listChannelWebhooks(channelId) {
      assert.equal(channelId, TARGET_CHANNEL_ID)
      if (mutationCompleted && state.readbackError) throw state.readbackError
      if (mutationCompleted && state.readbackDrift) {
        return [...inventory, webhook("600000000000000099")]
      }
      return [...inventory]
    },
  }
  const service = new AnnouncementSubscriptionService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(11),
    policy: options.policy ?? policy(),
    randomId: () => "activity-announcement-subscription-0001",
  })
  return {
    activities,
    calls,
    channels,
    events,
    getInventory: () => inventory,
    operationStore,
    service,
    state,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: `Discord API returned ${status}`,
    method: "POST",
    route: "/channels/{channel.id}/followers",
    status,
  })
}

test("announcement subscription requests are exact action-discriminated objects", () => {
  const subscribe = normalizeAnnouncementSubscriptionRequest(subscribeRequest())
  const unsubscribe = normalizeAnnouncementSubscriptionRequest(unsubscribeRequest())
  assert.equal(subscribe.action, "subscribe")
  assert.equal(unsubscribe.action, "unsubscribe")
  assert.match(subscribe.operationKeyHash, /^sha256:/)
  assert.throws(
    () => normalizeAnnouncementSubscriptionRequest({
      ...subscribeRequest(),
      webhookId: FOLLOWER_WEBHOOK_ID,
    } as AnnouncementSubscriptionRequest),
    /exact object/,
  )
  assert.throws(
    () => normalizeAnnouncementSubscriptionRequest({
      ...unsubscribeRequest(),
      sourceChannelId: SOURCE_CHANNEL_ID,
    } as AnnouncementSubscriptionRequest),
    /exact object/,
  )
  assert.throws(
    () => normalizeAnnouncementSubscriptionRequest({
      ...subscribeRequest(),
      sourceChannelId: "0",
    } as AnnouncementSubscriptionRequest),
    /source channel ID/,
  )
  assert.throws(
    () => normalizeAnnouncementSubscriptionRequest({
      ...subscribeRequest(),
      action: "replace",
    } as never),
    /action must be/,
  )
})

test("announcement subscription inventory exposes only follower IDs and minimized source identity", async () => {
  const setup = fixture({
    inventory: [
      webhook(OTHER_WEBHOOK_ID, {
        name: "private-incoming-name",
        creatorUserId: "700000000000000001",
      }),
      follower(),
      follower("600000000000000004", {
        sourceChannelId: null,
        sourceGuildId: null,
      }),
      follower("600000000000000005", {
        sourceChannelId: OUT_OF_SCOPE_SOURCE_CHANNEL_ID,
        sourceGuildId: OUT_OF_SCOPE_SOURCE_GUILD_ID,
      }),
    ],
  })

  const result = await setup.service.list(BOT_ID, TARGET_CHANNEL_ID)

  assert.equal(result.target.inventory.totalWebhooks, 4)
  assert.equal(result.target.inventory.channelFollowers, 3)
  assert.equal(result.target.subscriptions[0]?.sourceIdentity, "available")
  assert.equal(result.target.subscriptions[1]?.sourceIdentity, "unavailable")
  assert.equal(result.target.subscriptions[2]?.sourceIdentity, "redacted")
  assert.equal(result.target.subscriptions[2]?.sourceChannelId, null)
  assert.equal(result.target.subscriptions[2]?.sourceGuildId, null)
  assert.equal(result.target.permission.manageWebhooks, true)
  assert.equal(result.privacy.messageDataAccessed, false)
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(OTHER_WEBHOOK_ID), false)
  assert.equal(serialized.includes("private-incoming-name"), false)
  assert.equal(serialized.includes("creatorUserId"), false)
  assert.equal(serialized.includes("webhookToken"), true)
})

test("subscribe plans complete cross-guild evidence and exact capacity", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    subscribeRequest(),
  )

  assert.equal(plan.action, "subscribe")
  assert.equal(plan.source?.channel.id, SOURCE_CHANNEL_ID)
  assert.equal(plan.source?.guild.id, SOURCE_GUILD_ID)
  assert.equal(plan.source?.permission.viewChannel, true)
  assert.equal(plan.target.channel.id, TARGET_CHANNEL_ID)
  assert.equal(plan.target.inventory.totalWebhooks, 1)
  assert.equal(plan.target.inventory.safetyLimit, DISCORD_LIMITS.webhooksPerChannel)
  assert.equal(plan.target.permission.manageWebhooks, true)
  assert.equal(plan.writeRequired, true)
  assert.match(plan.digest, /^hmac-sha256:/)
  assert.equal(JSON.stringify(plan).includes(OTHER_WEBHOOK_ID), false)
  assert.ok(plan.warnings.some((warning) => /crosses guild/.test(warning)))
  assert.equal(setup.calls.guild.get(SOURCE_GUILD_ID), 1)
  assert.equal(setup.calls.guild.get(TARGET_GUILD_ID), 1)
})

test("same-guild subscribe evidence deduplicates guild, member, and role reads", async () => {
  const setup = fixture({ sameGuild: true })
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    subscribeRequest(),
  )

  assert.equal(plan.source?.guild.id, TARGET_GUILD_ID)
  assert.equal(setup.calls.guild.get(TARGET_GUILD_ID), 1)
  assert.equal(setup.calls.member.get(TARGET_GUILD_ID), 1)
  assert.equal(setup.calls.roles.get(TARGET_GUILD_ID), 1)
})

test("subscribe executes once after pending evidence and verifies exact inventory", async () => {
  const setup = fixture()
  const request = subscribeRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.webhookId, CREATED_WEBHOOK_ID)
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.equal(result.inventoryMatched, true)
  assert.equal(setup.calls.follow, 1)
  assert.deepEqual(setup.events.slice(0, 2), [
    "activity:announcement-subscription:pending",
    "write:follow:Reviewed announcement subscription",
  ])
  assert.equal(setup.activities.at(-1)?.status, "completed")
  const serialized = JSON.stringify({
    activities: setup.activities,
    receipts: [...setup.operationStore.receipts.values()],
  })
  assert.equal(serialized.includes("private-source"), false)
  assert.equal(serialized.includes("private-target"), false)
  assert.equal(serialized.includes("Reviewed announcement subscription"), false)
})

test("same-target subscription changes serialize and recheck the complete private inventory", async () => {
  let releaseFollow: () => void = () => undefined
  const followGate = new Promise<void>((resolve) => {
    releaseFollow = resolve
  })
  const setup = fixture({ state: { followGate } })
  const firstRequest = subscribeRequest()
  const secondRequest = subscribeRequest({
    operationKey: "announcement-subscription-operation-0002",
  })
  const [firstPlan, secondPlan] = await Promise.all([
    setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest),
    setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest),
  ])
  const firstExecution = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(setup.calls.follow, 1)

  const secondExecution = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  const secondRejection = assert.rejects(
    secondExecution,
    AnnouncementSubscriptionPlanChangedError,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(setup.calls.follow, 1)

  releaseFollow()
  await firstExecution
  await secondRejection
  assert.equal(setup.calls.follow, 1)
})

test("an exact existing subscription is a record-free no-op", async () => {
  const setup = fixture({ inventory: [webhook(OTHER_WEBHOOK_ID), follower()] })
  const request = subscribeRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.webhookId, FOLLOWER_WEBHOOK_ID)
  assert.equal(result.activityId, null)
  assert.equal(setup.calls.follow, 0)
  assert.equal(setup.activities.length, 0)
  assert.equal(setup.operationStore.receipts.size, 0)
})

test("unsubscribe deletes one exact Channel Follower and verifies absence", async () => {
  const setup = fixture({ inventory: [webhook(OTHER_WEBHOOK_ID), follower()] })
  const request = unsubscribeRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(plan.action, "unsubscribe")
  assert.equal(plan.current?.webhookId, FOLLOWER_WEBHOOK_ID)
  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.equal(result.inventoryMatched, true)
  assert.equal(setup.calls.delete, 1)
  assert.equal(
    setup.getInventory().some((entry) => entry.id === FOLLOWER_WEBHOOK_ID),
    false,
  )
})

test("subscribe fails closed on unavailable identity, duplicates, and full capacity", async () => {
  const unavailable = fixture({
    inventory: [follower(FOLLOWER_WEBHOOK_ID, {
      sourceChannelId: null,
      sourceGuildId: null,
    })],
  })
  await assert.rejects(
    () => unavailable.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    /unavailable source identity/,
  )

  const redacted = fixture({
    inventory: [follower(FOLLOWER_WEBHOOK_ID, {
      sourceChannelId: OUT_OF_SCOPE_SOURCE_CHANNEL_ID,
      sourceGuildId: OUT_OF_SCOPE_SOURCE_GUILD_ID,
    })],
  })
  await assert.rejects(
    () => redacted.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    /policy-redacted source identity/,
  )

  const duplicate = fixture({
    inventory: [follower(), follower("600000000000000004")],
  })
  await assert.rejects(
    () => duplicate.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    /duplicate subscriptions/,
  )

  const full = fixture({
    inventory: Array.from(
      { length: DISCORD_LIMITS.webhooksPerChannel },
      (_, index) => webhook(String(600000000000000100n + BigInt(index))),
    ),
  })
  await assert.rejects(
    () => full.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    /inventory is full/,
  )
})

test("unsubscribe accepts unavailable source identity but rejects non-followers", async () => {
  const unavailable = fixture({
    inventory: [follower(FOLLOWER_WEBHOOK_ID, {
      sourceChannelId: null,
      sourceGuildId: null,
    })],
  })
  const plan = await unavailable.service.plan(
    APPLICATION_ID,
    BOT_ID,
    unsubscribeRequest(),
  )
  assert.equal(plan.current?.sourceIdentity, "unavailable")
  assert.ok(plan.warnings.some((warning) => /no longer exposes/.test(warning)))

  const redacted = fixture({
    inventory: [follower(FOLLOWER_WEBHOOK_ID, {
      sourceChannelId: OUT_OF_SCOPE_SOURCE_CHANNEL_ID,
      sourceGuildId: OUT_OF_SCOPE_SOURCE_GUILD_ID,
    })],
  })
  const redactedPlan = await redacted.service.plan(
    APPLICATION_ID,
    BOT_ID,
    unsubscribeRequest(),
  )
  assert.equal(redactedPlan.current?.sourceIdentity, "redacted")
  assert.ok(redactedPlan.warnings.some((warning) => /outside local read scope/.test(warning)))

  const incoming = fixture({ inventory: [webhook(FOLLOWER_WEBHOOK_ID)] })
  await assert.rejects(
    () => incoming.service.plan(APPLICATION_ID, BOT_ID, unsubscribeRequest()),
    /requires an exact Channel Follower webhook/,
  )
})

test("scope, channel type, and permission evidence fail before mutation", async () => {
  const disabled = fixture({ policy: policy({ changes: false }) })
  await assert.rejects(
    () => disabled.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    PolicyError,
  )

  const wrongSource = fixture()
  wrongSource.channels.set(
    SOURCE_CHANNEL_ID,
    channel(SOURCE_CHANNEL_ID, SOURCE_GUILD_ID, DISCORD_CHANNEL_TYPES.text),
  )
  await assert.rejects(
    () => wrongSource.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    /sources must be direct guild announcement channels/,
  )

  const wrongTarget = fixture()
  wrongTarget.channels.set(
    TARGET_CHANNEL_ID,
    channel(TARGET_CHANNEL_ID, TARGET_GUILD_ID, DISCORD_CHANNEL_TYPES.forum),
  )
  await assert.rejects(
    () => wrongTarget.service.plan(APPLICATION_ID, BOT_ID, subscribeRequest()),
    /targets must be direct guild text channels/,
  )
  assert.equal(wrongSource.calls.follow, 0)
  assert.equal(wrongTarget.calls.follow, 0)
})

test("fresh plan mismatch and one-shot conflicts block execution", async () => {
  const setup = fixture()
  const request = subscribeRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  setup.getInventory().push(webhook("600000000000000098"))
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    AnnouncementSubscriptionPlanChangedError,
  )
  assert.equal(setup.calls.follow, 0)

  const conflict = fixture()
  const conflictRequest = subscribeRequest()
  const conflictPlan = await conflict.service.plan(
    APPLICATION_ID,
    BOT_ID,
    conflictRequest,
  )
  await conflict.operationStore.reserve({
    activityId: "activity-existing",
    error: null,
    guildId: TARGET_GUILD_ID,
    kind: "announcement-subscription",
    operationKeyHash: conflictPlan.operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    () => conflict.service.execute(
      APPLICATION_ID,
      BOT_ID,
      conflictRequest,
      conflictPlan.digest,
    ),
    AnnouncementSubscriptionOperationConflictError,
  )
})

test("known client rejection is failed while post-acceptance readback failure is uncertain", async () => {
  const rejected = fixture({ state: { followError: apiError(403) } })
  const rejectedRequest = subscribeRequest()
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementSubscriptionExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.equal(rejected.activities.at(-1)?.status, "failed")

  const uncertain = fixture({ state: { readbackError: new Error("private readback") } })
  const uncertainRequest = subscribeRequest({
    operationKey: "announcement-subscription-operation-0002",
  })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementSubscriptionExecutionError)
      const result = error.result as { error: string; status: string; webhookId: string }
      assert.equal(result.status, "uncertain")
      assert.equal(result.webhookId, CREATED_WEBHOOK_ID)
      assert.equal(result.error, "Error")
      return true
    },
  )
  assert.equal(uncertain.activities.at(-1)?.status, "uncertain")
  assert.equal(JSON.stringify(uncertain.activities).includes("private readback"), false)
})

test("pending and terminal record failures preserve the exact mutation boundary", async () => {
  const pendingFailure = fixture({
    state: { activityFailureStatus: "pending" },
  })
  const pendingRequest = subscribeRequest()
  const pendingPlan = await pendingFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    pendingRequest,
  )
  await assert.rejects(
    () => pendingFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      pendingRequest,
      pendingPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementSubscriptionExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-audit-failed",
      )
      assert.equal(JSON.stringify(error.result).includes("private activity failure"), false)
      return true
    },
  )
  assert.equal(pendingFailure.calls.follow, 0)
  assert.equal(
    [...pendingFailure.operationStore.receipts.values()].at(-1)?.status,
    "failed",
  )

  const receiptFailure = fixture()
  receiptFailure.operationStore.finishError = new Error("private receipt failure")
  const receiptRequest = subscribeRequest()
  const receiptPlan = await receiptFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    receiptRequest,
  )
  await assert.rejects(
    () => receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      receiptRequest,
      receiptPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementSubscriptionExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-operation-record-failed",
      )
      assert.equal(JSON.stringify(error.result).includes("private receipt failure"), false)
      return true
    },
  )
  assert.equal(receiptFailure.calls.follow, 1)
  assert.equal(receiptFailure.activities.at(-1)?.status, "completed")

  const activityFailure = fixture({
    state: { activityFailureStatus: "completed" },
  })
  const activityRequest = subscribeRequest()
  const activityPlan = await activityFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    activityRequest,
  )
  await assert.rejects(
    () => activityFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      activityRequest,
      activityPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementSubscriptionExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-audit-failed",
      )
      assert.equal(JSON.stringify(error.result).includes("private activity failure"), false)
      return true
    },
  )
  assert.equal(activityFailure.calls.follow, 1)
  assert.equal(
    [...activityFailure.operationStore.receipts.values()].at(-1)?.status,
    "completed",
  )
})

test("verified primary state with unrelated inventory drift completes with drift", async () => {
  const subscribe = fixture({ state: { readbackDrift: true } })
  const subscribeRequestValue = subscribeRequest()
  const subscribePlan = await subscribe.service.plan(
    APPLICATION_ID,
    BOT_ID,
    subscribeRequestValue,
  )
  const subscribeResult = await subscribe.service.execute(
    APPLICATION_ID,
    BOT_ID,
    subscribeRequestValue,
    subscribePlan.digest,
  )
  assert.equal(subscribeResult.status, "completed-with-drift")
  assert.equal(subscribeResult.readbackMatched, true)
  assert.equal(subscribeResult.inventoryMatched, false)

  const unsubscribe = fixture({
    inventory: [follower()],
    state: { readbackDrift: true },
  })
  const unsubscribeRequestValue = unsubscribeRequest()
  const unsubscribePlan = await unsubscribe.service.plan(
    APPLICATION_ID,
    BOT_ID,
    unsubscribeRequestValue,
  )
  const unsubscribeResult = await unsubscribe.service.execute(
    APPLICATION_ID,
    BOT_ID,
    unsubscribeRequestValue,
    unsubscribePlan.digest,
  )
  assert.equal(unsubscribeResult.status, "completed-with-drift")
  assert.equal(unsubscribeResult.verifiedAbsent, true)
  assert.equal(unsubscribeResult.inventoryMatched, false)
})

test("malformed inventory and response state are rejected without raw data", async () => {
  const malformed = fixture({
    inventory: [follower(FOLLOWER_WEBHOOK_ID, { sourceGuildId: null })],
  })
  await assert.rejects(
    () => malformed.service.list(BOT_ID, TARGET_CHANNEL_ID),
    AnnouncementSubscriptionEvidenceError,
  )

  const missingReadback = fixture({ state: { followUpdatesState: false } })
  const request = subscribeRequest()
  const plan = await missingReadback.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    () => missingReadback.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementSubscriptionExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
})
