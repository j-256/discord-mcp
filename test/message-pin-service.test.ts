import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import {
  DiscordApiError,
  MessagePinExecutionError,
  MessagePinOperationConflictError,
  MessagePinPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  MessagePinService,
  normalizeMessagePinRequest,
  type MessagePinRequest,
  type MessagePinServiceOptions,
} from "../src/message-pin-service.js"
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
  DiscordMessagePinPage,
  DiscordRole,
  DiscordThreadMember,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CHANNEL_ID = "500000000000000001"
const PARENT_ID = "500000000000000002"
const MESSAGE_ID = "600000000000000001"
const AUTHOR_ID = "700000000000000001"
const OPERATION_KEY = "message-pin-operation-0001"
const AUDIT_REASON = "Reviewed knowledge pin / case 42"
const NOW = "2026-08-20T00:00:00.000Z"
const CONTENT = "Private launch instructions"

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

function message(pinned: boolean, overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    attachments: [],
    author: { bot: false, id: AUTHOR_ID, username: "private-author-name" },
    channel_id: CHANNEL_ID,
    content: CONTENT,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    pinned,
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function request(overrides: Partial<MessagePinRequest> = {}): MessagePinRequest {
  return {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    desiredState: "pinned",
    messageId: MESSAGE_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function policy(options: {
  enabled?: boolean
  pinChannels?: readonly string[]
  readChannels?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(options.readChannels || [CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowPinManagement: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    pinChannelIds: new Set(options.pinChannels || [CHANNEL_ID]),
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

  async get(kind: OperationReceipt["kind"], hash: string): Promise<OperationReceipt | undefined> {
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
  guildId: string
  listPage: DiscordMessagePinPage
  messageOverrides: Partial<DiscordMessage>
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  parent: DiscordChannel
  pinned: boolean
  readbackError: unknown
  readbackMessageOverrides: Partial<DiscordMessage>
  roles: DiscordRole[]
  threadMember: DiscordThreadMember
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.PIN_MESSAGES
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channel: channel(),
    guildId: GUILD_ID,
    listPage: {
      has_more: false,
      items: [{ message: message(true), pinned_at: NOW }],
    },
    messageOverrides: {},
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    mutationUpdatesState: true,
    parent: channel({ id: PARENT_ID }),
    pinned: false,
    readbackError: undefined,
    readbackMessageOverrides: {},
    roles: [
      role(GUILD_ID, permissions, 0),
      role(BOT_ROLE_ID, 0n, 10),
    ],
    threadMember: {
      flags: 0,
      id: CHANNEL_ID,
      join_timestamp: NOW,
      user_id: BOT_ID,
    },
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
  const client: MessagePinServiceOptions["client"] = {
    async getChannel(channelId) {
      events.push(`read:channel:${channelId}`)
      return channelId === PARENT_ID ? state.parent : state.channel
    },
    async getGuild() {
      events.push("read:guild")
      return { id: state.guildId, name: "Private Guild Name" }
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
      return message(state.pinned, {
        ...state.messageOverrides,
        ...(mutationCompleted ? state.readbackMessageOverrides : {}),
      })
    },
    async getThreadMember() {
      events.push("read:thread-member")
      return state.threadMember
    },
    async listMessagePins() {
      events.push("read:pins")
      return state.listPage
    },
    async pinMessage(_channelId, _messageId, reason) {
      events.push(`write:pin:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState) state.pinned = true
    },
    async unpinMessage(_channelId, _messageId, reason) {
      events.push(`write:unpin:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState) state.pinned = false
    },
  }
  const service = new MessagePinService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
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
    message: "Discord rejected the pin request",
    method: "PUT",
    route: `/channels/${CHANNEL_ID}/messages/pins/${MESSAGE_ID}`,
    status,
  })
}

test("message pin request normalization is exact and hashes the operation key", () => {
  const normalized = normalizeMessagePinRequest(request())
  assert.equal(normalized.desiredPinned, true)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.notEqual(normalized.operationKeyHash, OPERATION_KEY)
  assert.throws(() => normalizeMessagePinRequest(request({ channelId: "bad" })), /channel ID/)
  assert.throws(() => normalizeMessagePinRequest(request({ messageId: "bad" })), /message ID/)
  assert.throws(
    () => normalizeMessagePinRequest(request({ desiredState: "other" as "pinned" })),
    /desired state/,
  )
  assert.throws(() => normalizeMessagePinRequest(request({ auditReason: " " })), /blank/)
  assert.throws(() => normalizeMessagePinRequest(request({ operationKey: "short" })), /operation key/)
})

test("message pin listing returns bounded current-route pages as unpersisted data", async () => {
  const setup = fixture({
    state: {
      listPage: {
        has_more: true,
        items: [{
          message: message(true, { content: "untrusted private pin" }),
          pinned_at: "2026-08-19T23:00:00.000Z",
        }],
      },
    },
  })

  const result = await setup.service.list(CHANNEL_ID, { limit: 1 })

  assert.equal(result.pins[0]?.message.content, "untrusted private pin")
  assert.equal(result.page.hasMore, true)
  assert.equal(result.page.nextCursor, "2026-08-19T23:00:00.000Z")
  assert.deepEqual(setup.activities, [])
  assert.equal(setup.operationStore.receipt, undefined)
  assert.deepEqual(setup.events, [
    `read:channel:${CHANNEL_ID}`,
    "read:pins",
  ])
})

test("message pin listing rejects malformed, duplicate, and out-of-scope evidence", async () => {
  await assert.rejects(
    () => fixture().service.list(CHANNEL_ID, { before: MESSAGE_ID }),
    /cursor must be an ISO 8601 timestamp/,
  )
  await assert.rejects(
    () => fixture({
      state: { listPage: { has_more: true, items: [] } },
    }).service.list(CHANNEL_ID),
    /invalid message pin page/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        listPage: {
          has_more: false,
          items: [
            { message: message(true), pinned_at: NOW },
            { message: message(true), pinned_at: NOW },
          ],
        },
      },
    }).service.list(CHANNEL_ID),
    /duplicate messages/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        listPage: {
          has_more: false,
          items: [{
            message: message(true, { id: "not-a-snowflake" }),
            pinned_at: NOW,
          }],
        },
      },
    }).service.list(CHANNEL_ID),
    /invalid message pin item/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        listPage: {
          has_more: false,
          items: [{
            message: message(true),
            pinned_at: "August 20, 2026",
          }],
        },
      },
    }).service.list(CHANNEL_ID),
    /invalid message pin item/,
  )
  await assert.rejects(
    () => fixture({ policy: policy({ readChannels: [PARENT_ID] }) }).service.list(CHANNEL_ID),
    PolicyError,
  )
})

test("message pin plans bind identity, exact state, permissions, and content evidence", async () => {
  const first = fixture()
  const plan = await first.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.action, "change")
  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.message.contentPreview, CONTENT)
  assert.equal(plan.message.pinned, false)
  assert.equal(plan.permission.pinMessages, true)
  assert.equal(plan.permission.readMessageHistory, true)
  assert.equal(plan.permission.viewChannel, true)
  assert.equal(plan.operationKeyHash.includes(OPERATION_KEY), false)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  const changedContent = fixture({
    state: { messageOverrides: { content: "different private content" } },
  })
  const changedContentPlan = await changedContent.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.notEqual(changedContentPlan.digest, plan.digest)

  const changedIdentity = fixture()
  const changedIdentityPlan = await changedIdentity.service.plan(
    "100000000000000002",
    BOT_ID,
    request(),
  )
  assert.notEqual(changedIdentityPlan.digest, plan.digest)
})

test("message pin planning fails closed on scope, identity, and permission evidence", async () => {
  await assert.rejects(
    () => fixture({ policy: policy({ enabled: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({
      state: {
        roles: [
          role(
            GUILD_ID,
            DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY | DISCORD_PERMISSIONS.VIEW_CHANNEL,
            0,
          ),
          role(BOT_ROLE_ID, 0n, 10),
        ],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /lacks channel-level PIN_MESSAGES/,
  )
  const incompleteChannel = channel()
  delete incompleteChannel.permission_overwrites
  await assert.rejects(
    () => fixture({
      state: { channel: incompleteChannel },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /permission evidence is incomplete/,
  )
  await assert.rejects(
    () => fixture({
      state: { messageOverrides: { id: "600000000000000002" } },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /mismatched message pin evidence/,
  )
})

test("private-thread planning verifies membership and parent permission evidence", async () => {
  const setup = fixture({
    state: {
      channel: channel({
        id: CHANNEL_ID,
        parent_id: PARENT_ID,
        type: DISCORD_CHANNEL_TYPES.privateThread,
      }),
      parent: channel({ id: PARENT_ID, type: DISCORD_CHANNEL_TYPES.text }),
    },
  })

  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.permission.permissionSourceChannelId, PARENT_ID)
  assert.equal(plan.permission.privateThreadAccess, "lookup-succeeded")
  assert.equal(setup.events.includes("read:thread-member"), true)

  await assert.rejects(
    () => fixture({
      state: {
        channel: channel({
          id: CHANNEL_ID,
          parent_id: PARENT_ID,
          type: DISCORD_CHANNEL_TYPES.privateThread,
        }),
        parent: channel({ id: PARENT_ID, type: DISCORD_CHANNEL_TYPES.text }),
        threadMember: {
          flags: 0,
          id: CHANNEL_ID,
          join_timestamp: NOW,
          user_id: AUTHOR_ID,
        },
      },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /mismatched private-thread membership evidence/,
  )
})

test("voice-channel planning requires CONNECT in addition to pin permissions", async () => {
  const basePermissions = DISCORD_PERMISSIONS.PIN_MESSAGES
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  await assert.rejects(
    () => fixture({
      state: {
        channel: channel({ type: DISCORD_CHANNEL_TYPES.voice }),
        roles: [
          role(GUILD_ID, basePermissions, 0),
          role(BOT_ROLE_ID, 0n, 10),
        ],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /lacks channel-level message-read prerequisites/,
  )

  const setup = fixture({
    state: {
      channel: channel({ type: DISCORD_CHANNEL_TYPES.voice }),
      roles: [
        role(GUILD_ID, basePermissions | DISCORD_PERMISSIONS.CONNECT, 0),
        role(BOT_ROLE_ID, 0n, 10),
      ],
    },
  })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.permission.canReadMessages, true)
})

test("already-current pin state is a no-op without evidence or reservation", async () => {
  const setup = fixture({ state: { pinned: true } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.deepEqual(setup.activities, [])
  assert.equal(setup.operationStore.receipt, undefined)
  assert.equal(setup.events.some((event) => event.startsWith("write:")), false)
})

test("message pin execution reserves, records pending evidence, mutates once, and verifies", async () => {
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
  assert.equal(result.messageSnapshotMatched, true)
  assert.equal(result.observedPinned, true)
  assert.deepEqual(setup.events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    `write:pin:${AUDIT_REASON}`,
    "read:readback",
    "operation:completed",
    "activity:completed",
  ])
  assert.deepEqual(setup.activities.map((entry) => entry.status), ["pending", "completed"])
  assert.equal(setup.operationStore.receipt?.kind, "message-pin")
  assert.equal(setup.operationStore.receipt?.resourceId, MESSAGE_ID)
  const persisted = JSON.stringify({
    activities: setup.activities,
    receipt: setup.operationStore.receipt,
  })
  assert.equal(persisted.includes(CONTENT), false)
  assert.equal(persisted.includes(AUDIT_REASON), false)
  assert.equal(persisted.includes(OPERATION_KEY), false)
  assert.equal(persisted.includes("private-author-name"), false)
})

test("message unpin uses the same reviewed destructive workflow", async () => {
  const setup = fixture({ state: { pinned: true } })
  const unpin = request({ desiredState: "unpinned" })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, unpin)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    unpin,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.messageSnapshotMatched, true)
  assert.equal(result.observedPinned, false)
  assert.equal(setup.events.includes(`write:unpin:${AUDIT_REASON}`), true)
})

test("message pin execution rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, request())
  stale.state.pinned = true
  await assert.rejects(
    () => stale.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    MessagePinPlanChangedError,
  )
  assert.equal(stale.events.some((event) => event.startsWith("write:")), false)

  const spent = fixture()
  const spentPlan = await spent.service.plan(APPLICATION_ID, BOT_ID, request())
  await spent.service.execute(APPLICATION_ID, BOT_ID, request(), spentPlan.digest)
  await assert.rejects(
    () => spent.service.plan(APPLICATION_ID, BOT_ID, request()),
    MessagePinOperationConflictError,
  )
})

test("message pin execution blocks before mutation when pending evidence fails", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(setup.events.some((event) => event.startsWith("write:")), false)
  assert.equal(setup.operationStore.receipt?.status, "failed")
})

test("message pin execution distinguishes definite, uncertain, and drift outcomes", async () => {
  const definite = fixture({ state: { mutationError: apiError(403) } })
  const definitePlan = await definite.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => definite.service.execute(APPLICATION_ID, BOT_ID, request(), definitePlan.digest),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "failed"
    ),
  )
  assert.equal(definite.operationStore.receipt?.status, "failed")

  const uncertain = fixture({ state: { mutationError: new Error("network failed") } })
  const uncertainPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => uncertain.service.execute(APPLICATION_ID, BOT_ID, request(), uncertainPlan.digest),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.operationStore.receipt?.status, "uncertain")

  const unreadable = fixture({ state: { readbackError: apiError(404) } })
  const unreadablePlan = await unreadable.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => unreadable.service.execute(APPLICATION_ID, BOT_ID, request(), unreadablePlan.digest),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "uncertain"
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
  assert.equal(driftResult.messageSnapshotMatched, true)
  assert.equal(drift.operationStore.receipt?.verification, "drift")

  const edited = fixture({
    state: {
      readbackMessageOverrides: { content: "edited while the pin changed" },
    },
  })
  const editedPlan = await edited.service.plan(APPLICATION_ID, BOT_ID, request())
  const editedResult = await edited.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    editedPlan.digest,
  )
  assert.equal(editedResult.status, "completed-with-drift")
  assert.equal(editedResult.observedPinned, true)
  assert.equal(editedResult.messageSnapshotMatched, false)
})

test("message pin execution reports receipt and final activity failures after verified writes", async () => {
  const receiptFailure = fixture()
  const receiptPlan = await receiptFailure.service.plan(APPLICATION_ID, BOT_ID, request())
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    () => receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      receiptPlan.digest,
    ),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "completed-operation-record-failed"
    ),
  )

  const activityFailure = fixture({ state: { activityFailureAt: 2 } })
  const activityPlan = await activityFailure.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => activityFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      activityPlan.digest,
    ),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "completed-audit-failed"
    ),
  )
})

test("same-target executions serialize and replan after the first verified change", async () => {
  let releaseMutation: (() => void) | undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve
  })
  const first = fixture({
    state: {
      mutationGate,
      mutationStarted: () => mutationStarted?.(),
    },
  })
  const firstPlan = await first.service.plan(APPLICATION_ID, BOT_ID, request())
  const secondRequest = request({ operationKey: "message-pin-operation-0002" })
  const secondPlan = await first.service.plan(APPLICATION_ID, BOT_ID, secondRequest)

  const firstExecution = first.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    firstPlan.digest,
  )
  await started
  const secondExecution = first.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation?.()

  assert.equal((await firstExecution).status, "completed")
  await assert.rejects(() => secondExecution, MessagePinPlanChangedError)
  assert.equal(
    first.events.filter((event) => event.startsWith("write:pin:")).length,
    1,
  )
})

test("an uncertain write blocks queued same-target changes before reservation", async () => {
  let releaseMutation: (() => void) | undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve
  })
  const setup = fixture({
    state: {
      mutationError: new Error("network failed"),
      mutationGate,
      mutationStarted: () => mutationStarted?.(),
    },
  })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  const secondRequest = request({ operationKey: "message-pin-operation-0002" })
  const secondPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest)

  const firstExecution = assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      firstPlan.digest,
    ),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  await started
  const secondExecution = assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      secondRequest,
      secondPlan.digest,
    ),
    (error: unknown) => (
      error instanceof MessagePinExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  releaseMutation?.()
  await Promise.all([firstExecution, secondExecution])

  assert.equal(
    setup.events.filter((event) => event === "operation:reserve").length,
    1,
  )
  assert.equal(
    setup.events.filter((event) => event.startsWith("write:pin:")).length,
    1,
  )
})
