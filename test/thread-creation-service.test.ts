import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  CreateThreadFromMessageInput,
  CreateThreadWithoutMessageInput,
  DiscordClient,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  ThreadCreationEvidenceError,
  ThreadCreationExecutionError,
  ThreadCreationOperationConflictError,
  ThreadCreationPlanChangedError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeThreadCreationRequest,
  ThreadCreationService,
  type ThreadCreationRequest,
  type ThreadCreationServiceOptions,
} from "../src/thread-creation-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const PARENT_ID = "300000000000000001"
const SOURCE_ID = "400000000000000001"
const STANDALONE_ID = "400000000000000002"
const BOT_ID = "500000000000000001"
const OWNER_ID = "600000000000000001"
const BOT_ROLE_ID = "700000000000000001"
const AUTHOR_ID = "800000000000000001"
const OPERATION_KEY = "thread-creation-operation-0001"
const NOW = "2026-08-21T04:00:00.000Z"

const THREAD_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  | DISCORD_PERMISSIONS.CREATE_PUBLIC_THREADS
  | DISCORD_PERMISSIONS.CREATE_PRIVATE_THREADS

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function parent(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    default_auto_archive_duration: 1_440,
    default_thread_rate_limit_per_user: 5,
    guild_id: GUILD_ID,
    id: PARENT_ID,
    name: "support",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function sourceMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    attachments: [{
      filename: "private.txt",
      id: "900000000000000001",
      size: 17,
      url: "https://cdn.discord.test/private",
    }],
    author: {
      id: AUTHOR_ID,
      username: "private-author",
    },
    channel_id: PARENT_ID,
    components: [],
    content: "Private source content",
    embeds: [],
    guild_id: GUILD_ID,
    id: SOURCE_ID,
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function thread(options: {
  id?: string
  invitable?: boolean
  name?: string
  ownerId?: string
  type?: number
} = {}): DiscordChannel {
  const type = options.type ?? DISCORD_CHANNEL_TYPES.publicThread
  return {
    guild_id: GUILD_ID,
    id: options.id ?? SOURCE_ID,
    name: options.name ?? "Reviewed thread",
    owner_id: options.ownerId ?? BOT_ID,
    parent_id: PARENT_ID,
    rate_limit_per_user: 5,
    thread_metadata: {
      archive_timestamp: NOW,
      archived: false,
      auto_archive_duration: 1_440,
      ...(type === DISCORD_CHANNEL_TYPES.privateThread
        ? { invitable: options.invitable ?? false }
        : {}),
      locked: false,
    },
    type,
  }
}

function anchoredRequest(
  overrides: Partial<ThreadCreationRequest> = {},
): ThreadCreationRequest {
  return {
    auditReason: "Reviewed anchored thread",
    mode: "from-message",
    name: "Reviewed thread",
    operationKey: OPERATION_KEY,
    parentChannelId: PARENT_ID,
    sourceMessageId: SOURCE_ID,
    ...overrides,
  }
}

function privateRequest(
  overrides: Partial<ThreadCreationRequest> = {},
): ThreadCreationRequest {
  return {
    auditReason: "Reviewed private thread",
    mode: "standalone-private",
    name: "Reviewed thread",
    operationKey: OPERATION_KEY,
    parentChannelId: PARENT_ID,
    ...overrides,
  }
}

function policy(options: {
  enabled?: boolean
  parentIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([PARENT_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowThreadCreation: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    threadParentIds: new Set(options.parentIds || [PARENT_ID]),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()
  reserveConflict: OperationReceipt | undefined

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(
    kind: OperationReceipt["kind"],
    operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    return this.receipts.get(`${kind}:${operationKeyHash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    if (this.reserveConflict) return { created: false, receipt: this.reserveConflict }
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activities: ActivityEntry[]
  activityFailureAt: number | null
  anchoredInput: CreateThreadFromMessageInput | null
  botMember: DiscordGuildMember
  createError: unknown
  createReason: string | null
  createStarted: boolean
  events: string[]
  existingThread: DiscordChannel | null
  guild: DiscordGuild
  parent: DiscordChannel
  readback: DiscordChannel
  response: DiscordChannel
  roles: DiscordRole[]
  sourceMessage: DiscordMessage
  standaloneInput: CreateThreadWithoutMessageInput | null
  operationStore: MemoryOperationStore
}

function fixture(options: {
  client?: Partial<ThreadCreationServiceOptions["client"]>
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}): { service: ThreadCreationService; state: FixtureState } {
  const events: string[] = []
  const activities: ActivityEntry[] = []
  const state: FixtureState = {
    activities,
    activityFailureAt: null,
    anchoredInput: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    createError: null,
    createReason: null,
    createStarted: false,
    events,
    existingThread: null,
    guild: { id: GUILD_ID, name: "Private guild", owner_id: OWNER_ID },
    operationStore: new MemoryOperationStore(events),
    parent: parent(),
    readback: thread(),
    response: thread(),
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, THREAD_PERMISSIONS, 1),
    ],
    sourceMessage: sourceMessage(),
    standaloneInput: null,
    ...options.state,
  }
  const activityStore: ActivityStore = {
    async append(entry) {
      events.push(`activity:${entry.status}`)
      if (
        state.activityFailureAt !== null
        && activities.length === state.activityFailureAt
      ) throw new Error("activity unavailable")
      activities.push(entry)
    },
    async list() {
      return { entries: [...activities], file: "/test/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: ThreadCreationServiceOptions["client"] = {
    async createThreadFromMessage(_channelId, _messageId, input, auditReason) {
      events.push("discord:create-anchored")
      state.anchoredInput = input
      state.createReason = auditReason
      state.createStarted = true
      if (state.createError) throw state.createError
      return state.response
    },
    async createThreadWithoutMessage(_channelId, input, auditReason) {
      events.push("discord:create-standalone")
      state.standaloneInput = input
      state.createReason = auditReason
      state.createStarted = true
      if (state.createError) throw state.createError
      return state.response
    },
    async getChannel(channelId) {
      events.push(`discord:get-channel:${channelId}`)
      if (channelId === PARENT_ID) return state.parent
      if (channelId === SOURCE_ID && !state.createStarted) {
        if (state.existingThread) return state.existingThread
        throw apiError(404)
      }
      return state.readback
    },
    async getGuild() {
      events.push("discord:get-guild")
      return state.guild
    },
    async getGuildMember() {
      events.push("discord:get-member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("discord:get-roles")
      return state.roles
    },
    async getMessage() {
      events.push("discord:get-message")
      return state.sourceMessage
    },
  } satisfies Pick<
    DiscordClient,
    | "createThreadFromMessage"
    | "createThreadWithoutMessage"
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getMessage"
  >
  Object.assign(client, options.client)
  return {
    service: new ThreadCreationService({
      activityStore,
      client,
      clock: () => new Date(NOW),
      limiter: new InteractionLimiter({
        maxWritesPerMinute: 10,
        minWriteIntervalMs: 0,
      }),
      operationStore: state.operationStore,
      planKey: Uint8Array.from({ length: 32 }, () => 11),
      policy: options.policy || policy(),
      randomId: () => "activity-thread-1",
    }),
    state,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected request",
    method: "POST",
    route: "/channels/:channel/threads",
    status,
  })
}

test("thread-creation normalization enforces exact mode-specific inputs and defaults", () => {
  const anchored = normalizeThreadCreationRequest(anchoredRequest())
  assert.equal(anchored.sourceMessageId, SOURCE_ID)
  assert.equal(anchored.invitable, null)
  assert.match(anchored.operationKeyHash, /^sha256:[a-f0-9]{64}$/)

  const privateThread = normalizeThreadCreationRequest(privateRequest())
  assert.equal(privateThread.invitable, false)
  assert.equal(privateThread.sourceMessageId, null)

  for (const invalid of [
    anchoredRequest({ mode: "standalone-public" }),
    anchoredRequest({ invitable: true }),
    {
      ...anchoredRequest(),
      sourceMessageId: undefined,
    } as unknown as ThreadCreationRequest,
    privateRequest({ sourceMessageId: SOURCE_ID }),
    privateRequest({ invitable: "yes" as unknown as boolean }),
    privateRequest({ autoArchiveDuration: 30 }),
    privateRequest({ rateLimitPerUser: 21_601 }),
    privateRequest({ name: " thread " }),
    privateRequest({ operationKey: "short" }),
  ]) {
    assert.throws(() => normalizeThreadCreationRequest(invalid))
  }
  assert.throws(() => normalizeThreadCreationRequest({
    ...privateRequest(),
    extra: true,
  } as ThreadCreationRequest))
})

test("anchored plans bind source content, defaults, identity, and complete permissions", async () => {
  const { service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, anchoredRequest())

  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.status, "planned")
  assert.equal(plan.writeRequired, true)
  assert.equal(plan.target.autoArchiveDuration, 1_440)
  assert.equal(plan.target.rateLimitPerUser, 5)
  assert.equal(plan.target.threadType, DISCORD_CHANNEL_TYPES.publicThread)
  assert.deepEqual(plan.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "CREATE_PUBLIC_THREADS",
  ])
  assert.equal(plan.sourceMessage?.contentPreview, "Private source content")
  assert.deepEqual(plan.sourceMessage?.attachmentFilenames, ["private.txt"])
  assert.equal(JSON.stringify(plan).includes("https://cdn.discord.test/private"), false)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)

  const changed = fixture({
    state: { sourceMessage: sourceMessage({ content: "Changed source content" }) },
  })
  const changedPlan = await changed.service.plan(APPLICATION_ID, BOT_ID, anchoredRequest())
  assert.notEqual(changedPlan.digest, plan.digest)
})

test("existing anchored threads are deterministic no-ops without reservations or activity", async () => {
  const existing = thread({ ownerId: OWNER_ID })
  const { service, state } = fixture({ state: { existingThread: existing } })
  const request = anchoredRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.status, "source-already-threaded")
  assert.equal(plan.writeRequired, false)
  assert.equal(plan.existingThread?.ownerId, OWNER_ID)

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "source-already-threaded")
  assert.equal(result.activityId, null)
  assert.equal(result.verification, "not-required")
  assert.equal(result.threadId, SOURCE_ID)
  assert.equal(state.activities.length, 0)
  assert.equal(state.events.some((event) => event.startsWith("operation:")), false)
  assert.equal(state.events.some((event) => event.startsWith("discord:create")), false)
})

test("private creation journals content-free intent before one exact write and readback", async () => {
  const privateThread = thread({
    id: STANDALONE_ID,
    invitable: false,
    type: DISCORD_CHANNEL_TYPES.privateThread,
  })
  const { service, state } = fixture({
    state: { readback: privateThread, response: privateThread },
  })
  const request = privateRequest({
    autoArchiveDuration: 1_440,
    operationKey: "thread-private-operation-0001",
    rateLimitPerUser: 5,
  })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.threadId, STANDALONE_ID)
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.deepEqual(state.standaloneInput, {
    autoArchiveDuration: 1_440,
    invitable: false,
    name: "Reviewed thread",
    rateLimitPerUser: 5,
    type: DISCORD_CHANNEL_TYPES.privateThread,
  })
  assert.equal(state.createReason, "Reviewed private thread")
  assert.deepEqual(state.events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    "discord:create-standalone",
    `discord:get-channel:${STANDALONE_ID}`,
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(state.activities.at(-1)?.status, "completed")
  const durable = JSON.stringify({
    activities: state.activities,
    receipts: [...state.operationStore.receipts.values()],
  })
  assert.equal(durable.includes("Reviewed thread"), false)
  assert.equal(durable.includes("Reviewed private thread"), false)
  assert.equal(durable.includes("thread-private-operation-0001"), false)
})

test("anchored creation requires the deterministic response ID", async () => {
  const { service, state } = fixture()
  const request = anchoredRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.threadId, SOURCE_ID)
  assert.equal(result.recoveredFromAmbiguousResponse, false)
  assert.deepEqual(state.anchoredInput, {
    autoArchiveDuration: 1_440,
    name: "Reviewed thread",
    rateLimitPerUser: 5,
  })
})

test("anchored transport ambiguity recovers only through an exact matching bot-owned thread", async () => {
  const recovered = fixture({
    state: { createError: new TypeError("network unavailable") },
  })
  const request = anchoredRequest({ operationKey: "thread-recovery-operation-0001" })
  const plan = await recovered.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await recovered.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.recoveredFromAmbiguousResponse, true)
  assert.equal(result.responseMatched, null)

  const mismatched = fixture({
    state: {
      createError: new TypeError("network unavailable"),
      readback: thread({ name: "Different" }),
    },
  })
  const mismatchRequest = anchoredRequest({
    operationKey: "thread-recovery-operation-0002",
  })
  const mismatchPlan = await mismatched.service.plan(
    APPLICATION_ID,
    BOT_ID,
    mismatchRequest,
  )
  await assert.rejects(
    mismatched.service.execute(
      APPLICATION_ID,
      BOT_ID,
      mismatchRequest,
      mismatchPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ThreadCreationExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
})

test("standalone rejection settles while ambiguous outcomes block the logical target", async () => {
  const rejected = fixture({ state: { createError: apiError(403) } })
  const rejectedRequest = privateRequest({
    name: "Rejected target",
    operationKey: "thread-rejected-operation-0001",
  })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ThreadCreationExecutionError
      && (error.result as { status: string }).status === "failed"
    ),
  )

  const uncertain = fixture({ state: { createError: new TypeError("network unavailable") } })
  const uncertainRequest = privateRequest({
    name: "Uncertain target",
    operationKey: "thread-uncertain-operation-0001",
  })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ThreadCreationExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )

  const blocked = fixture()
  const blockedRequest = privateRequest({
    name: "Uncertain target",
    operationKey: "thread-uncertain-operation-0002",
  })
  const blockedPlan = await blocked.service.plan(
    APPLICATION_ID,
    BOT_ID,
    blockedRequest,
  )
  await assert.rejects(
    blocked.service.execute(
      APPLICATION_ID,
      BOT_ID,
      blockedRequest,
      blockedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ThreadCreationExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(blocked.state.events.some((event) => event.startsWith("operation:")), false)
})

test("thread planning fails closed on policy, parent type, and complete permissions", async () => {
  await assert.rejects(
    fixture({ policy: policy({ enabled: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      anchoredRequest(),
    ),
    /disabled/,
  )
  await assert.rejects(
    fixture({ policy: policy({ parentIds: [] }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      anchoredRequest(),
    ),
    /allowlist/,
  )
  await assert.rejects(
    fixture({ state: { parent: parent({ type: DISCORD_CHANNEL_TYPES.forum }) } }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      anchoredRequest(),
    ),
    ThreadCreationEvidenceError,
  )
  await assert.rejects(
    fixture({
      state: { roles: [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0)] },
    }).service.plan(APPLICATION_ID, BOT_ID, anchoredRequest()),
    ThreadCreationEvidenceError,
  )
  const announcement = fixture({
    state: { parent: parent({ type: DISCORD_CHANNEL_TYPES.announcement }) },
  })
  const announcementPlan = await announcement.service.plan(
    APPLICATION_ID,
    BOT_ID,
    anchoredRequest(),
  )
  assert.equal(
    announcementPlan.target.threadType,
    DISCORD_CHANNEL_TYPES.announcementThread,
  )
  await assert.rejects(
    announcement.service.plan(APPLICATION_ID, BOT_ID, privateRequest()),
    ThreadCreationEvidenceError,
  )
})

test("thread execution rejects changed plans and spent operation keys before writing", async () => {
  const changed = fixture()
  const request = anchoredRequest({ operationKey: "thread-stale-operation-0001" })
  const plan = await changed.service.plan(APPLICATION_ID, BOT_ID, request)
  changed.state.sourceMessage = sourceMessage({ content: "Changed" })
  await assert.rejects(
    changed.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    ThreadCreationPlanChangedError,
  )
  assert.equal(changed.state.events.some((event) => event.startsWith("operation:")), false)

  const conflict = fixture()
  const conflictRequest = privateRequest({
    name: "Conflict target",
    operationKey: "thread-conflict-operation-0001",
  })
  const conflictPlan = await conflict.service.plan(
    APPLICATION_ID,
    BOT_ID,
    conflictRequest,
  )
  conflict.state.operationStore.reserveConflict = {
    activityId: "prior-thread-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "thread-create",
    operationKeyHash: conflictPlan.operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  }
  await assert.rejects(
    conflict.service.execute(
      APPLICATION_ID,
      BOT_ID,
      conflictRequest,
      conflictPlan.digest,
    ),
    ThreadCreationOperationConflictError,
  )
  assert.equal(conflict.state.events.some((event) => event.startsWith("discord:create")), false)
})

test("thread execution blocks on pending audit failure and reports verified drift", async () => {
  const blocked = fixture({ state: { activityFailureAt: 0 } })
  const blockedRequest = privateRequest({
    name: "Audit target",
    operationKey: "thread-audit-operation-0001",
  })
  const blockedPlan = await blocked.service.plan(
    APPLICATION_ID,
    BOT_ID,
    blockedRequest,
  )
  await assert.rejects(
    blocked.service.execute(
      APPLICATION_ID,
      BOT_ID,
      blockedRequest,
      blockedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ThreadCreationExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.state.events.some((event) => event.startsWith("discord:create")), false)

  const driftedThread = thread({
    id: STANDALONE_ID,
    invitable: false,
    name: "Discord normalized",
    type: DISCORD_CHANNEL_TYPES.privateThread,
  })
  const drifted = fixture({
    state: { readback: driftedThread, response: driftedThread },
  })
  const driftRequest = privateRequest({
    name: "Drift target",
    operationKey: "thread-drift-operation-0001",
  })
  const driftPlan = await drifted.service.plan(
    APPLICATION_ID,
    BOT_ID,
    driftRequest,
  )
  const result = await drifted.service.execute(
    APPLICATION_ID,
    BOT_ID,
    driftRequest,
    driftPlan.digest,
  )
  assert.equal(result.status, "completed-with-drift")
  assert.deepEqual(result.driftFields, ["name"])
  assert.equal(result.verification, "drift")
})
