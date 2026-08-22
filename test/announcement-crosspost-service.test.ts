import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  AnnouncementCrosspostService,
  normalizeAnnouncementCrosspostRequest,
  type AnnouncementCrosspostRequest,
  type AnnouncementCrosspostServiceOptions,
} from "../src/announcement-crosspost-service.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
} from "../src/constants.js"
import {
  AnnouncementCrosspostExecutionError,
  AnnouncementCrosspostOperationConflictError,
  AnnouncementCrosspostPlanChangedError,
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
  DiscordMessage,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CHANNEL_ID = "500000000000000001"
const MESSAGE_ID = "600000000000000001"
const AUTHOR_ID = "700000000000000001"
const OPERATION_KEY = "announcement-crosspost-operation-0001"
const NOW = "2026-08-22T00:00:00.000Z"
const CONTENT = "Private release announcement"

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
    name: "private-announcements",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.announcement,
    ...overrides,
  }
}

function message(
  flags: number,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: { bot: false, id: AUTHOR_ID, username: "private-author" },
    channel_id: CHANNEL_ID,
    components: [],
    content: CONTENT,
    edited_timestamp: null,
    embeds: [],
    flags,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    pinned: false,
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function request(
  overrides: Partial<AnnouncementCrosspostRequest> = {},
): AnnouncementCrosspostRequest {
  return {
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function policy(options: {
  channels?: readonly string[]
  enabled?: boolean
  readChannels?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(options.readChannels || [CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowAnnouncementCrossposts: options.enabled ?? true,
    allowDeletions: false,
    allowInteractions: false,
    announcementCrosspostChannelIds: new Set(options.channels || [CHANNEL_ID]),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
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
  crosspostError: unknown
  crosspostGate: Promise<void> | null
  crosspostStarted: (() => void) | null
  flags: number
  messageOverrides: Partial<DiscordMessage>
  omitDocumentedOptionalFields: boolean
  readbackError: unknown
  readbackOverrides: Partial<DiscordMessage>
  responseOverrides: Partial<DiscordMessage>
  roles: DiscordRole[]
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.MANAGE_MESSAGES
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.SEND_MESSAGES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channel: channel(),
    crosspostError: undefined,
    crosspostGate: null,
    crosspostStarted: null,
    flags: 0,
    messageOverrides: {},
    omitDocumentedOptionalFields: false,
    readbackError: undefined,
    readbackOverrides: {},
    responseOverrides: {},
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
  let crosspostCalls = 0
  const observedMessage = (
    flags: number,
    overrides: Partial<DiscordMessage> = {},
  ): DiscordMessage => {
    const observed = message(flags, overrides)
    if (state.omitDocumentedOptionalFields) {
      delete observed.components
      delete observed.flags
      delete observed.guild_id
    }
    return observed
  }
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
  const client: AnnouncementCrosspostServiceOptions["client"] = {
    async crosspostMessage() {
      crosspostCalls += 1
      events.push("write:crosspost")
      state.crosspostStarted?.()
      if (state.crosspostGate) await state.crosspostGate
      if (state.crosspostError) throw state.crosspostError
      mutationCompleted = true
      state.flags |= DISCORD_MESSAGE_FLAGS.crossposted
      return observedMessage(state.flags, {
        ...state.messageOverrides,
        ...state.responseOverrides,
      })
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
    async getMessage() {
      events.push(mutationCompleted ? "read:readback" : "read:message")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return observedMessage(state.flags, {
        ...state.messageOverrides,
        ...(mutationCompleted ? state.readbackOverrides : {}),
      })
    },
  }
  const service = new AnnouncementCrosspostService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    randomId: () => "activity-0001",
  })
  return {
    activities,
    crosspostCalls: () => crosspostCalls,
    events,
    operationStore,
    service,
    state,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected the announcement crosspost",
    method: "POST",
    route: `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/crosspost`,
    status,
  })
}

test("announcement-crosspost request normalization is exact and hashes its key", () => {
  const normalized = normalizeAnnouncementCrosspostRequest(request())
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.notEqual(normalized.operationKeyHash, OPERATION_KEY)
  assert.throws(
    () => normalizeAnnouncementCrosspostRequest(request({ channelId: "bad" })),
    /channel ID/,
  )
  assert.throws(
    () => normalizeAnnouncementCrosspostRequest(request({ messageId: "bad" })),
    /message ID/,
  )
  assert.throws(
    () => normalizeAnnouncementCrosspostRequest(request({ operationKey: "short" })),
    /operation key/,
  )
})

test("plans bind identity, intent, message, permissions, and unknown fanout", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )

  assert.equal(plan.action, "crosspost")
  assert.equal(plan.status, "planned")
  assert.equal(plan.message.contentPreview, CONTENT)
  assert.equal(plan.message.crossposted, false)
  assert.equal(plan.messageContentIntent, "enabled")
  assert.equal(plan.permission.authorship, "other")
  assert.equal(plan.permission.manageMessages, true)
  assert.equal(plan.permission.readMessageHistory, true)
  assert.equal(plan.permission.sendMessages, true)
  assert.equal(plan.permission.viewChannel, true)
  assert.match(plan.warnings.join("\n"), /cannot enumerate or constrain fanout/)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  const contentChanged = fixture({
    state: { messageOverrides: { content: "Different private release" } },
  })
  const changedPlan = await contentChanged.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  assert.notEqual(changedPlan.digest, plan.digest)
})

test("planning normalizes documented optional REST fields without trusting guild contradictions", async () => {
  const optional = fixture({
    state: {
      omitDocumentedOptionalFields: true,
    },
  })
  const plan = await optional.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  assert.equal(plan.message.flags, 0)
  assert.equal(plan.message.crossposted, false)

  await assert.rejects(
    () => fixture({
      state: {
        messageOverrides: { guild_id: "999999999999999999" },
      },
    }).service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /ineligible or incomplete/,
  )
})

test("planning requires confirmed Message Content intent before Discord reads", async () => {
  const setup = fixture()
  await assert.rejects(
    () => setup.service.plan(APPLICATION_ID, BOT_ID, "disabled", request()),
    /require confirmed Message Content intent/,
  )
  await assert.rejects(
    () => setup.service.plan(APPLICATION_ID, BOT_ID, "unknown", request()),
    /require confirmed Message Content intent/,
  )
  assert.deepEqual(setup.events, [])
})

test("planning rejects scope, threads, polls, forwards, and non-default messages", async () => {
  await assert.rejects(
    () => fixture({ policy: policy({ enabled: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({
      state: { channel: channel({ type: DISCORD_CHANNEL_TYPES.announcementThread }) },
    }).service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /direct announcement-channel evidence/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        messageOverrides: { poll: {} as NonNullable<DiscordMessage["poll"]> },
      },
    }).service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /ineligible or incomplete/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        messageOverrides: {
          message_reference: { type: DISCORD_MESSAGE_REFERENCE_TYPES.forward },
        },
      },
    }).service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /ineligible or incomplete/,
  )
  await assert.rejects(
    () => fixture({
      state: { messageOverrides: { type: 19 } },
    }).service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /ineligible or incomplete/,
  )
})

test("conditional MANAGE_MESSAGES follows exact message authorship", async () => {
  const basePermissions = DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.SEND_MESSAGES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  await assert.rejects(
    () => fixture({
      state: {
        roles: [
          role(GUILD_ID, basePermissions, 0),
          role(BOT_ROLE_ID, 0n, 10),
        ],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /lacks channel-level MANAGE_MESSAGES/,
  )

  const own = fixture({
    state: {
      messageOverrides: {
        author: { bot: true, id: BOT_ID, username: "connector" },
      },
      roles: [
        role(GUILD_ID, basePermissions, 0),
        role(BOT_ROLE_ID, 0n, 10),
      ],
    },
  })
  const plan = await own.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  assert.equal(plan.permission.authorship, "connector-bot")
  assert.equal(plan.permission.manageMessages, false)
})

test("already-crossposted messages are record-free no-ops", async () => {
  const setup = fixture({ state: { flags: DISCORD_MESSAGE_FLAGS.crossposted } })
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
    plan.digest,
  )

  assert.equal(plan.status, "already-crossposted")
  assert.equal(result.status, "already-crossposted")
  assert.equal(result.activityId, null)
  assert.equal(setup.crosspostCalls(), 0)
  assert.deepEqual(setup.activities, [])
  assert.equal(setup.operationStore.receipt, undefined)
})

test("execution reserves, journals, crossposts once, and verifies response plus readback", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  setup.events.length = 0

  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.observedCrossposted, true)
  assert.equal(result.responseSnapshotMatched, true)
  assert.equal(result.readbackSnapshotMatched, true)
  assert.equal(setup.crosspostCalls(), 1)
  assert.equal(setup.operationStore.receipt?.kind, "announcement-crosspost")
  assert.equal(setup.operationStore.receipt?.status, "completed")
  assert.equal(setup.operationStore.receipt?.verification, "match")
  assert.deepEqual(setup.activities.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  assert.ok(
    setup.events.indexOf("activity:pending")
      < setup.events.indexOf("write:crosspost"),
  )
})

test("execution rejects a stale digest before reservation or mutation", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  setup.state.messageOverrides = { content: "changed after review" }
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      plan.digest,
    ),
    AnnouncementCrosspostPlanChangedError,
  )
  assert.equal(setup.crosspostCalls(), 0)
})

test("a reserved operation key returns only a content-free conflict receipt", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  await setup.operationStore.reserve({
    activityId: "prior-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "announcement-crosspost",
    operationKeyHash: plan.operationKeyHash,
    planDigest: plan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })

  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      plan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostOperationConflictError)
      assert.equal(JSON.stringify(error.receipt).includes(CONTENT), false)
      return true
    },
  )
  assert.equal(setup.crosspostCalls(), 0)
})

test("pending activity failure blocks crossposting and closes the receipt as failed", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const plan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      plan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(setup.crosspostCalls(), 0)
  assert.equal(setup.operationStore.receipt?.status, "failed")
})

test("known pre-response 4xx is failed while 5xx and readback ambiguity are uncertain", async () => {
  const rejected = fixture({ state: { crosspostError: apiError(403) } })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      rejectedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.equal(rejected.crosspostCalls(), 1)
  assert.equal(rejected.operationStore.receipt?.status, "failed")

  const unavailable = fixture({ state: { crosspostError: apiError(503) } })
  const unavailablePlan = await unavailable.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request({ operationKey: "announcement-crosspost-operation-0002" }),
  )
  await assert.rejects(
    () => unavailable.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request({ operationKey: "announcement-crosspost-operation-0002" }),
      unavailablePlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(unavailable.crosspostCalls(), 1)
  assert.equal(unavailable.operationStore.receipt?.status, "uncertain")

  const readback = fixture({ state: { readbackError: new Error("read failed") } })
  const readbackPlan = await readback.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request({ operationKey: "announcement-crosspost-operation-0003" }),
  )
  await assert.rejects(
    () => readback.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request({ operationKey: "announcement-crosspost-operation-0003" }),
      readbackPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(readback.operationStore.receipt?.status, "uncertain")
})

test("unexpected response or readback drift is quarantined as uncertain", async () => {
  const responseDrift = fixture({
    state: { responseOverrides: { content: "unexpected response content" } },
  })
  const responsePlan = await responseDrift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  await assert.rejects(
    () => responseDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      responsePlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const responseFlagDrift = fixture({
    state: {
      responseOverrides: {
        flags: DISCORD_MESSAGE_FLAGS.crossposted
          | DISCORD_MESSAGE_FLAGS.isCrosspost,
      },
    },
  })
  const responseFlagPlan = await responseFlagDrift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request({ operationKey: "announcement-crosspost-operation-0004" }),
  )
  await assert.rejects(
    () => responseFlagDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request({ operationKey: "announcement-crosspost-operation-0004" }),
      responseFlagPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const readbackDrift = fixture({
    state: { readbackOverrides: { edited_timestamp: "2026-08-22T00:01:00.000Z" } },
  })
  const readbackPlan = await readbackDrift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request({ operationKey: "announcement-crosspost-operation-0005" }),
  )
  await assert.rejects(
    () => readbackDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request({ operationKey: "announcement-crosspost-operation-0005" }),
      readbackPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
})

test("same-target execution serializes and a prior uncertain outcome blocks its follower", async () => {
  let releaseMutation: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve
  })
  const setup = fixture({
    state: {
      crosspostError: apiError(503),
      crosspostGate: mutationGate,
      crosspostStarted: mutationStarted,
    },
  })
  const firstRequest = request()
  const secondRequest = request({ operationKey: "announcement-crosspost-operation-0006" })
  const firstPlan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    firstRequest,
  )
  const secondPlan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    secondRequest,
  )
  const first = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    firstRequest,
    firstPlan.digest,
  )
  await started
  const second = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    secondRequest,
    secondPlan.digest,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(setup.crosspostCalls(), 1)
  releaseMutation()
  await assert.rejects(first, AnnouncementCrosspostExecutionError)
  await assert.rejects(
    second,
    (error: unknown) => {
      assert.ok(error instanceof AnnouncementCrosspostExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(setup.crosspostCalls(), 1)
})
