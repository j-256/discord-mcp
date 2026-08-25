import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type { DiscordWebhookSummary } from "../src/discord-client.js"
import {
  DiscordApiError,
  PolicyError,
  WebhookDeletionExecutionError,
  WebhookDeletionOperationConflictError,
  WebhookDeletionPlanChangedError,
  WebhookEvidenceError,
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
import {
  normalizeWebhookDeletionRequest,
  WebhookService,
  type WebhookDeletionRequest,
  type WebhookServiceOptions,
} from "../src/webhook-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CHANNEL_ID = "500000000000000001"
const OTHER_CHANNEL_ID = "500000000000000002"
const WEBHOOK_ID = "600000000000000001"
const OTHER_WEBHOOK_ID = "600000000000000002"
const CREATOR_ID = "700000000000000001"
const OPERATION_KEY = "webhook-deletion-operation-0001"
const AUDIT_REASON = "Reviewed webhook cleanup / case 42"
const NOW = "2026-08-21T00:00:00.000Z"
const PRIVATE_NAME = "private-webhook-name"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel-name",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function webhook(
  overrides: Partial<DiscordWebhookSummary> = {},
): DiscordWebhookSummary {
  return {
    applicationId: null,
    channelId: CHANNEL_ID,
    creatorUserId: CREATOR_ID,
    guildId: GUILD_ID,
    id: WEBHOOK_ID,
    name: PRIVATE_NAME,
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
    ...overrides,
  }
}

function request(
  overrides: Partial<WebhookDeletionRequest> = {},
): WebhookDeletionRequest {
  return {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    operationKey: OPERATION_KEY,
    webhookId: WEBHOOK_ID,
    ...overrides,
  }
}

function policy(options: {
  audit?: boolean
  delete?: boolean
  readChannels?: readonly string[]
  webhookChannels?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(options.readChannels || [CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowWebhookAudit: options.audit ?? true,
    allowWebhookDeletions: options.delete ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    webhookChannelIds: new Set(options.webhookChannels || [CHANNEL_ID]),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  lastReceipt: OperationReceipt | undefined
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.lastReceipt = receipt
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  get receipt(): OperationReceipt | undefined {
    return this.lastReceipt
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(`${kind}:${hash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.lastReceipt = receipt
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  channel: DiscordChannel
  deleted: boolean
  inventory: DiscordWebhookSummary[]
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  readbackError: unknown
  roles: DiscordRole[]
}

function fixture(options: {
  credentialStore?: WebhookServiceOptions["credentialStore"]
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.MANAGE_WEBHOOKS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channel: channel(),
    deleted: false,
    inventory: [
      webhook({
        applicationId: APPLICATION_ID,
        creatorUserId: CREATOR_ID,
      }),
      webhook({
        creatorUserId: null,
        id: OTHER_WEBHOOK_ID,
        name: "follower",
        type: 2,
      }),
    ],
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    mutationUpdatesState: true,
    readbackError: undefined,
    roles: [
      role(GUILD_ID, permissions, 0),
      role(BOT_ROLE_ID, 0n, 10),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutationCompleted = false
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) {
        throw new Error("activity unavailable")
      }
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const client: WebhookServiceOptions["client"] = {
    async createWebhook() {
      throw new Error("unexpected webhook creation")
    },
    async deleteWebhook(_webhookId, reason) {
      events.push(`write:delete:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState) state.deleted = true
    },
    async getChannel() {
      events.push("read:channel")
      return state.channel
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: "Private Guild Name" }
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async listChannelWebhooks() {
      events.push(mutationCompleted ? "read:readback" : "read:webhooks")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return state.deleted
        ? state.inventory.filter((entry) => entry.id !== WEBHOOK_ID)
        : state.inventory
    },
    async modifyWebhook() {
      throw new Error("unexpected webhook change")
    },
  }
  const service = new WebhookService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    ...(options.credentialStore ? { credentialStore: options.credentialStore } : {}),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    randomId: () => "activity-0001",
  })
  return {
    activities,
    events,
    operationStore,
    service,
    state,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected webhook deletion",
    method: "DELETE",
    route: `/webhooks/${WEBHOOK_ID}`,
    status,
  })
}

test("webhook deletion normalization is exact and hashes the operation key", () => {
  const normalized = normalizeWebhookDeletionRequest(request())
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.notEqual(normalized.operationKeyHash, OPERATION_KEY)
  assert.throws(
    () => normalizeWebhookDeletionRequest(request({ channelId: "bad" })),
    /channel ID/,
  )
  assert.throws(
    () => normalizeWebhookDeletionRequest(request({ webhookId: "0" })),
    /webhook ID/,
  )
  assert.throws(
    () => normalizeWebhookDeletionRequest(request({ auditReason: " " })),
    /blank/,
  )
  assert.throws(
    () => normalizeWebhookDeletionRequest(request({ operationKey: "short" })),
    /operation key/,
  )
})

test("webhook inventory and exact lookup return only projected bounded evidence", async () => {
  const setup = fixture()
  setup.state.channel = channel({
    available_tags: [{
      id: "800000000000000001",
      moderated: false,
      name: "private-forum-tag",
    }],
    topic: "private-channel-topic",
  })
  const hostile = {
    ...webhook(),
    avatar: "private-avatar",
    source_channel: { name: "private-source-channel" },
    source_guild: { name: "private-source-guild" },
    token: "private-webhook-token",
    unknown: "private-unknown",
    url: "https://discord.com/api/webhooks/id/private-webhook-token",
    user: { id: CREATOR_ID, username: "private-creator-name" },
  } as unknown as DiscordWebhookSummary
  setup.state.inventory = [hostile]

  const listed = await setup.service.list(BOT_ID, CHANNEL_ID)
  const exact = await setup.service.get(BOT_ID, CHANNEL_ID, WEBHOOK_ID)

  assert.equal(listed.page.safetyLimit, 15)
  assert.equal(listed.page.returned, 1)
  assert.deepEqual(Object.keys(listed.channel).sort(), [
    "guildId",
    "id",
    "name",
    "parentId",
    "type",
    "typeName",
  ])
  assert.equal(listed.permission.manageWebhooks, true)
  assert.equal(listed.permission.viewChannel, true)
  assert.deepEqual(listed.privacy.omittedFields, [
    "avatar",
    "sourceChannel",
    "sourceGuild",
    "token",
    "unknownRawFields",
    "url",
    "userProfile",
  ])
  assert.equal(exact.webhook.webhookId, WEBHOOK_ID)
  assert.equal(exact.webhook.type, "incoming")
  assert.match(exact.webhook.createdAt, /^20[0-9]{2}-/)
  for (const privateValue of [
    "private-avatar",
    "private-source-channel",
    "private-source-guild",
    "private-channel-topic",
    "private-forum-tag",
    "private-webhook-token",
    "private-unknown",
    "private-creator-name",
  ]) {
    assert.equal(JSON.stringify({ listed, exact }).includes(privateValue), false)
  }
  await assert.rejects(
    () => setup.service.get(BOT_ID, CHANNEL_ID, "600000000000000099"),
    WebhookEvidenceError,
  )
  assert.deepEqual(setup.activities, [])
})

test("webhook inventory rejects malformed, duplicate, excessive, and mismatched evidence", async () => {
  for (const inventory of [
    [webhook({ channelId: OTHER_CHANNEL_ID })],
    [webhook({ guildId: "200000000000000099" })],
    [webhook({ type: 99 })],
    [webhook(), webhook()],
    Array.from({ length: 16 }, (_, index) => webhook({
      id: String(600000000000000100n + BigInt(index)),
    })),
    [webhook({ name: "x".repeat(81) })],
    [webhook({ name: "\uD800" })],
    [webhook({ creatorUserId: "bad" })],
  ]) {
    const setup = fixture({ state: { inventory } })
    await assert.rejects(
      () => setup.service.list(BOT_ID, CHANNEL_ID),
      WebhookEvidenceError,
    )
    assert.equal(setup.events.some((entry) => entry.startsWith("write:")), false)
  }
})

test("webhook policy and complete permissions fail closed before cleanup", async () => {
  const disabled = fixture({ policy: policy({ audit: false, delete: false }) })
  await assert.rejects(
    () => disabled.service.list(BOT_ID, CHANNEL_ID),
    PolicyError,
  )
  assert.deepEqual(disabled.events, [])

  const deletionDisabled = fixture({
    policy: policy({ audit: true, delete: false }),
  })
  await assert.rejects(
    () => deletionDisabled.service.plan(APPLICATION_ID, BOT_ID, request()),
    /webhook deletion is disabled/,
  )
  assert.deepEqual(deletionDisabled.events, [])

  const wrongScope = fixture({
    policy: policy({ webhookChannels: [OTHER_CHANNEL_ID] }),
  })
  await assert.rejects(
    () => wrongScope.service.list(BOT_ID, CHANNEL_ID),
    /outside the webhook scope/,
  )
  assert.deepEqual(wrongScope.events, [])

  const thread = fixture({
    state: {
      channel: channel({ type: DISCORD_CHANNEL_TYPES.publicThread }),
    },
  })
  await assert.rejects(
    () => thread.service.list(BOT_ID, CHANNEL_ID),
    /does not support webhook inventory/,
  )

  const missingPermission = fixture({
    state: {
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(BOT_ROLE_ID, 0n, 10),
      ],
    },
  })
  await assert.rejects(
    () => missingPermission.service.list(BOT_ID, CHANNEL_ID),
    /MANAGE_WEBHOOKS/,
  )

  const invalidChannel = fixture({
    state: {
      channel: channel({ name: "x".repeat(101) }),
    },
  })
  await assert.rejects(
    () => invalidChannel.service.list(BOT_ID, CHANNEL_ID),
    WebhookEvidenceError,
  )

  const nonBotMember = fixture({
    state: {
      botMember: {
        roles: [BOT_ROLE_ID],
        user: { bot: false, id: BOT_ID, username: "connector" },
      },
    },
  })
  await assert.rejects(
    () => nonBotMember.service.list(BOT_ID, CHANNEL_ID),
    WebhookEvidenceError,
  )
})

test("webhook plans bind exact inventory, identity, permission, and privacy evidence", async () => {
  const setup = fixture()
  const first = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  const second = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(first.digest, second.digest)
  assert.equal(first.target.webhookId, WEBHOOK_ID)
  assert.equal(first.target.type, "incoming")
  assert.equal(first.permission.manageWebhooks, true)
  assert.equal(first.privacy.credentialsProjectedOut, true)
  assert.equal(first.operationKeyHash.includes(OPERATION_KEY), false)
  assert.match(first.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.match(first.warnings.join("\n"), /non-atomic inventory-to-delete window/)

  setup.state.inventory[0] = webhook({ name: "renamed-webhook" })
  const changed = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.notEqual(changed.digest, first.digest)

  setup.state.channel = channel({ name: "renamed-channel" })
  const channelChanged = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.notEqual(channelChanged.digest, changed.digest)

  const follower = fixture({
    state: { inventory: [webhook({ type: 2 })] },
  })
  await assert.rejects(
    () => follower.service.plan(APPLICATION_ID, BOT_ID, request()),
    /limited to Incoming webhooks/,
  )
})

test("webhook deletion reserves, journals, mutates once, and verifies absence", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  setup.events.length = 0

  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.equal(result.credentialCleanup, "not-configured")
  assert.deepEqual(setup.events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    `write:delete:${AUDIT_REASON}`,
    "read:readback",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(setup.operationStore.receipt?.kind, "webhook-deletion")
  assert.equal(setup.operationStore.receipt?.resourceId, WEBHOOK_ID)
  assert.equal(setup.operationStore.receipt?.verification, "match")
  assert.deepEqual(setup.activities.map(({ status }) => status), [
    "pending",
    "completed",
  ])
  const persisted = JSON.stringify({
    activities: setup.activities,
    receipt: setup.operationStore.receipt,
  })
  for (const value of [PRIVATE_NAME, AUDIT_REASON, OPERATION_KEY]) {
    assert.equal(persisted.includes(value), false)
  }
})

test("webhook deletion removes only the exact private credential after verified absence", async () => {
  const notPresent = fixture({
    credentialStore: {
      async remove() {
        return false
      },
      async write() {
        throw new Error("unexpected webhook credential write")
      },
    },
  })
  const notPresentPlan = await notPresent.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  const notPresentResult = await notPresent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    notPresentPlan.digest,
  )
  assert.equal(notPresentResult.status, "completed")
  assert.equal(notPresentResult.credentialCleanup, "not-present")

  const removedIds: string[] = []
  const removed = fixture({
    credentialStore: {
      async remove(webhookId) {
        removedIds.push(webhookId)
        return true
      },
      async write() {
        throw new Error("unexpected webhook credential write")
      },
    },
  })
  const removedPlan = await removed.service.plan(APPLICATION_ID, BOT_ID, request())
  const removedResult = await removed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    removedPlan.digest,
  )
  assert.equal(removedResult.status, "completed")
  assert.equal(removedResult.credentialCleanup, "removed")
  assert.deepEqual(removedIds, [WEBHOOK_ID])

  const failed = fixture({
    credentialStore: {
      async remove() {
        throw new Error("private root unavailable")
      },
      async write() {
        throw new Error("unexpected webhook credential write")
      },
    },
  })
  const failedPlan = await failed.service.plan(APPLICATION_ID, BOT_ID, request())
  const failedResult = await failed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    failedPlan.digest,
  )
  assert.equal(failedResult.verifiedAbsent, true)
  assert.equal(failedResult.credentialCleanup, "failed")
  assert.equal(failedResult.status, "completed-with-drift")
  assert.equal(failed.operationStore.receipt?.verification, "drift")

  const survivingIds: string[] = []
  const surviving = fixture({
    credentialStore: {
      async remove(webhookId) {
        survivingIds.push(webhookId)
        return true
      },
      async write() {
        throw new Error("unexpected webhook credential write")
      },
    },
    state: { mutationUpdatesState: false },
  })
  const survivingPlan = await surviving.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  const survivingResult = await surviving.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    survivingPlan.digest,
  )
  assert.equal(survivingResult.credentialCleanup, "not-attempted")
  assert.deepEqual(survivingIds, [])
})

test("webhook deletion rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const stalePlan = await stale.service.plan(APPLICATION_ID, BOT_ID, request())
  stale.state.inventory[0] = webhook({ name: "changed-after-review" })
  await assert.rejects(
    () => stale.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      stalePlan.digest,
    ),
    WebhookDeletionPlanChangedError,
  )
  assert.equal(stale.events.some((entry) => entry.startsWith("write:")), false)

  const spent = fixture()
  const plan = await spent.service.plan(APPLICATION_ID, BOT_ID, request())
  await spent.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest)
  await assert.rejects(
    () => spent.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    WebhookDeletionOperationConflictError,
  )
})

test("webhook deletion blocks mutation when pending activity cannot be recorded", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(setup.events.some((entry) => entry.startsWith("write:")), false)
  assert.equal(setup.operationStore.receipt?.status, "failed")
})

test("webhook deletion distinguishes rejected, uncertain, and drifting outcomes", async () => {
  const rejected = fixture({ state: { mutationError: apiError(403) } })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rejected.operationStore.receipt?.status, "failed")

  const uncertain = fixture({ state: { mutationError: new Error("socket closed") } })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.operationStore.receipt?.status, "uncertain")

  const readback = fixture({ state: { readbackError: new Error("readback failed") } })
  const readbackPlan = await readback.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  await assert.rejects(
    () => readback.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      readbackPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )

  const drift = fixture({ state: { mutationUpdatesState: false } })
  const driftPlan = await drift.service.plan(APPLICATION_ID, BOT_ID, request())
  const driftResult = await drift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    driftPlan.digest,
  )
  assert.equal(driftResult.status, "completed-with-drift")
  assert.equal(driftResult.verifiedAbsent, false)
  assert.equal(drift.operationStore.receipt?.verification, "drift")
})

test("queued same-target deletion stops after an uncertain outcome", async () => {
  let startMutation: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    startMutation = resolve
  })
  let releaseMutation: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const setup = fixture({
    state: {
      mutationError: new Error("uncertain transport"),
      mutationGate: gate,
      mutationStarted: () => startMutation?.(),
    },
  })
  const firstRequest = request()
  const secondRequest = request({ operationKey: "webhook-deletion-operation-0002" })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const first = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await started
  const second = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation?.()

  await assert.rejects(first, WebhookDeletionExecutionError)
  await assert.rejects(
    second,
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(
    setup.events.filter((entry) => entry.startsWith("write:delete")).length,
    1,
  )
})

test("same webhook ID lock survives conflicting channel claims after uncertainty", async () => {
  let startMutation: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    startMutation = resolve
  })
  let releaseMutation: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const original = fixture({
    state: {
      mutationError: new Error("uncertain transport"),
      mutationGate: gate,
      mutationStarted: () => startMutation?.(),
    },
  })
  const moved = fixture({
    policy: policy({
      readChannels: [OTHER_CHANNEL_ID],
      webhookChannels: [OTHER_CHANNEL_ID],
    }),
    state: {
      channel: channel({ id: OTHER_CHANNEL_ID }),
      inventory: [webhook({ channelId: OTHER_CHANNEL_ID })],
    },
  })
  const originalRequest = request()
  const movedRequest = request({
    channelId: OTHER_CHANNEL_ID,
    operationKey: "webhook-deletion-operation-0003",
  })
  const originalPlan = await original.service.plan(
    APPLICATION_ID,
    BOT_ID,
    originalRequest,
  )
  const movedPlan = await moved.service.plan(
    APPLICATION_ID,
    BOT_ID,
    movedRequest,
  )

  const first = original.service.execute(
    APPLICATION_ID,
    BOT_ID,
    originalRequest,
    originalPlan.digest,
  )
  await started
  const second = moved.service.execute(
    APPLICATION_ID,
    BOT_ID,
    movedRequest,
    movedPlan.digest,
  )
  releaseMutation?.()

  await assert.rejects(first, WebhookDeletionExecutionError)
  await assert.rejects(
    second,
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(
    moved.events.filter((entry) => entry.startsWith("write:delete")).length,
    0,
  )
  assert.equal(moved.operationStore.receipt, undefined)
})

test("verified webhook deletion reports local terminal-record failures safely", async () => {
  const receiptFailure = fixture()
  const receiptPlan = await receiptFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    () => receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      receiptPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "completed-operation-record-failed"
    ),
  )

  const activityFailure = fixture({ state: { activityFailureAt: 2 } })
  const activityPlan = await activityFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  await assert.rejects(
    () => activityFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      activityPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookDeletionExecutionError
      && (error.result as { status?: string }).status === "completed-audit-failed"
    ),
  )
})
