import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
} from "../src/constants.js"
import type {
  CreateForumPostInput,
  DiscordClient,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  ForumPostEvidenceError,
  ForumPostExecutionError,
  ForumPostOperationConflictError,
  ForumPostPlanChangedError,
} from "../src/errors.js"
import {
  ForumPostService,
  normalizeForumPostRequest,
  type ForumPostRequest,
  type ForumPostServiceOptions,
} from "../src/forum-post-service.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordCreatedForumPost,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const FORUM_ID = "200000000000000001"
const THREAD_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const OWNER_ID = "500000000000000001"
const BOT_ROLE_ID = "600000000000000001"
const TAG_ID = "700000000000000001"
const MODERATED_TAG_ID = "700000000000000002"
const NOTIFY_USER_ID = "800000000000000001"
const OPERATION_KEY = "forum-post-operation-0001"
const AUDIT_REASON = "Reviewed support forum post"
const CONTENT = `Please review this with <@${NOTIFY_USER_ID}>.`
const NOW = "2026-08-20T02:00:00.000Z"

const BASE_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  | DISCORD_PERMISSIONS.SEND_MESSAGES

function role(
  id: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function forum(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    available_tags: [
      {
        emoji_id: null,
        emoji_name: "📌",
        id: TAG_ID,
        moderated: false,
        name: "Support",
      },
      {
        emoji_id: null,
        emoji_name: null,
        id: MODERATED_TAG_ID,
        moderated: true,
        name: "Staff",
      },
    ],
    default_auto_archive_duration: 1_440,
    default_thread_rate_limit_per_user: 5,
    flags: 0,
    guild_id: GUILD_ID,
    id: FORUM_ID,
    name: "help-forum",
    parent_id: null,
    permission_overwrites: [],
    rate_limit_per_user: 0,
    type: DISCORD_CHANNEL_TYPES.forum,
    ...overrides,
  }
}

function message(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: true,
      id: BOT_ID,
      username: "connector",
    },
    channel_id: THREAD_ID,
    components: [],
    content: CONTENT,
    guild_id: GUILD_ID,
    id: THREAD_ID,
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function thread(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    applied_tags: [TAG_ID],
    guild_id: GUILD_ID,
    id: THREAD_ID,
    name: "Need help",
    owner_id: BOT_ID,
    parent_id: FORUM_ID,
    rate_limit_per_user: 10,
    thread_metadata: {
      archive_timestamp: NOW,
      archived: false,
      auto_archive_duration: 1_440,
      locked: false,
    },
    type: DISCORD_CHANNEL_TYPES.publicThread,
    ...overrides,
  }
}

function createdPost(
  channelOverrides: Partial<DiscordChannel> = {},
  messageOverrides: Partial<DiscordMessage> = {},
): DiscordCreatedForumPost {
  return {
    ...thread(channelOverrides),
    message: message(messageOverrides),
  }
}

function request(overrides: Partial<ForumPostRequest> = {}): ForumPostRequest {
  return {
    appliedTagIds: [TAG_ID],
    auditReason: AUDIT_REASON,
    autoArchiveDuration: 1_440,
    channelId: FORUM_ID,
    content: CONTENT,
    name: "Need help",
    notifyUserIds: [NOTIFY_USER_ID],
    operationKey: OPERATION_KEY,
    rateLimitPerUser: 10,
    ...overrides,
  }
}

function policy(options: {
  allowedForumIds?: readonly string[]
  enabled?: boolean
  notifyIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([FORUM_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowForumPosts: options.enabled ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    forumPostChannelIds: new Set(options.allowedForumIds || [FORUM_ID]),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(options.notifyIds || [NOTIFY_USER_ID]),
    protectedUserIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  receipt: OperationReceipt | undefined
  readonly receipts = new Map<string, OperationReceipt>()
  reserveConflict: OperationReceipt | undefined

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipt = receipt
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
    if (this.reserveConflict) {
      return { created: false, receipt: this.reserveConflict }
    }
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipt = receipt
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  activities: ActivityEntry[]
  botMember: DiscordGuildMember
  createError: unknown
  createInput: CreateForumPostInput | null
  createReason: string | null
  created: DiscordCreatedForumPost
  events: string[]
  forum: DiscordChannel
  guild: DiscordGuild
  message: DiscordMessage
  operationStore: MemoryOperationStore
  readback: DiscordChannel
  roles: DiscordRole[]
}

function fixture(options: {
  client?: Partial<ForumPostServiceOptions["client"]>
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}): {
  service: ForumPostService
  state: FixtureState
} {
  const events: string[] = []
  const activities: ActivityEntry[] = []
  const state: FixtureState = {
    activityFailureAt: null,
    activities,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    createError: null,
    createInput: null,
    createReason: null,
    created: createdPost(),
    events,
    forum: forum(),
    guild: {
      id: GUILD_ID,
      name: "Example guild",
      owner_id: OWNER_ID,
    },
    message: message(),
    operationStore: new MemoryOperationStore(events),
    readback: thread(),
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, BASE_PERMISSIONS | DISCORD_PERMISSIONS.MANAGE_THREADS, 1),
    ],
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
  const client: ForumPostServiceOptions["client"] = {
    async createForumPost(_channelId, input, auditReason) {
      events.push("discord:create")
      state.createInput = input
      state.createReason = auditReason
      if (state.createError) throw state.createError
      return state.created
    },
    async getChannel(channelId) {
      events.push(`discord:get-channel:${channelId}`)
      return channelId === FORUM_ID ? state.forum : state.readback
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
      return state.message
    },
  } satisfies Pick<
    DiscordClient,
    | "createForumPost"
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getMessage"
  >
  Object.assign(client, options.client)
  return {
    service: new ForumPostService({
      activityStore,
      client,
      clock: () => new Date(NOW),
      limiter: new InteractionLimiter({
        maxWritesPerMinute: 10,
        minWriteIntervalMs: 0,
      }),
      operationStore: state.operationStore,
      planKey: Uint8Array.from({ length: 32 }, () => 7),
      policy: options.policy || policy(),
      randomId: () => "activity-forum-1",
    }),
    state,
  }
}

test("forum-post normalization canonicalizes bounded exact inputs", () => {
  const normalized = normalizeForumPostRequest(request({
    appliedTagIds: [MODERATED_TAG_ID, TAG_ID],
    notifyUserIds: [NOTIFY_USER_ID],
  }))
  assert.deepEqual(normalized.appliedTagIds, [TAG_ID, MODERATED_TAG_ID])
  assert.deepEqual(normalized.notifyUserIds, [NOTIFY_USER_ID])
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(normalized).includes(OPERATION_KEY), true)

  for (const invalid of [
    request({ channelId: "0" }),
    request({ name: " forum " }),
    request({ content: "" }),
    request({ appliedTagIds: [TAG_ID, TAG_ID] }),
    request({ appliedTagIds: Array.from({ length: 6 }, (_, index) => `${900 + index}`) }),
    request({ autoArchiveDuration: 30 }),
    request({ rateLimitPerUser: 21_601 }),
    request({ auditReason: "" }),
    request({ operationKey: "short" }),
    request({ notifyUserIds: [OWNER_ID] }),
  ]) {
    assert.throws(() => normalizeForumPostRequest(invalid))
  }
})

test("forum-post planning binds exact tags, permissions, content, and private key hash", async () => {
  const { service, state } = fixture()
  const plan = await service.plan(BOT_ID, request())

  assert.equal(plan.parent.id, FORUM_ID)
  assert.equal(plan.parent.requireTag, false)
  assert.deepEqual(plan.selectedTags, [{ id: TAG_ID, moderated: false, name: "Support" }])
  assert.deepEqual(plan.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "SEND_MESSAGES",
  ])
  assert.equal(plan.target.content, CONTENT)
  assert.equal(plan.target.auditReason, AUDIT_REASON)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)

  state.forum = forum({
    available_tags: [{
      emoji_id: null,
      emoji_name: "📌",
      id: TAG_ID,
      moderated: false,
      name: "Renamed support",
    }],
  })
  const changed = await service.plan(BOT_ID, request({
    operationKey: "forum-post-operation-0002",
  }))
  assert.notEqual(changed.digest, plan.digest)

  const administrator = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 1),
      ],
    },
  })
  const administratorPlan = await administrator.service.plan(BOT_ID, request())
  assert.equal(
    administratorPlan.warnings.some((warning) => warning.includes("ADMINISTRATOR")),
    true,
  )
})

test("forum-post policy, tag, and permission evidence fail closed", async () => {
  await assert.rejects(
    fixture({ policy: policy({ enabled: false }) }).service.plan(BOT_ID, request()),
    /disabled/,
  )
  await assert.rejects(
    fixture({ policy: policy({ allowedForumIds: [THREAD_ID] }) }).service.plan(BOT_ID, request()),
    /outside the forum-post scope/,
  )
  await assert.rejects(
    fixture().service.plan(BOT_ID, request({ appliedTagIds: [OWNER_ID] })),
    ForumPostEvidenceError,
  )
  await assert.rejects(
    fixture({
      state: { forum: forum({ flags: DISCORD_CHANNEL_FLAGS.requireTag }) },
    }).service.plan(BOT_ID, request({ appliedTagIds: [] })),
    /requires at least one/,
  )
  const noManage = fixture({
    state: {
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, BASE_PERMISSIONS, 1)],
    },
  })
  await assert.rejects(
    noManage.service.plan(BOT_ID, request({ appliedTagIds: [MODERATED_TAG_ID] })),
    /MANAGE_THREADS/,
  )
  const missingOverwrites = forum()
  delete missingOverwrites.permission_overwrites
  await assert.rejects(
    fixture({ state: { forum: missingOverwrites } }).service.plan(BOT_ID, request()),
    ForumPostEvidenceError,
  )
  await assert.rejects(
    fixture({
      state: {
        forum: forum({
          permission_overwrites: [
            { allow: "0", deny: "0", id: GUILD_ID, type: 0 },
            { allow: "0", deny: "0", id: GUILD_ID, type: 0 },
          ],
        }),
      },
    }).service.plan(BOT_ID, request()),
    ForumPostEvidenceError,
  )
})

test("forum-post execution journals before one write and verifies exact readback", async () => {
  const { service, state } = fixture()
  const input = request()
  const plan = await service.plan(BOT_ID, input)
  state.events.length = 0
  const result = await service.execute(BOT_ID, input, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(result.threadId, THREAD_ID)
  assert.equal(result.messageId, THREAD_ID)
  assert.match(result.url, new RegExp(`${GUILD_ID}/${THREAD_ID}/${THREAD_ID}$`))
  assert.deepEqual(state.createInput, {
    allowedMentions: { replied_user: false, users: [NOTIFY_USER_ID] },
    appliedTagIds: [TAG_ID],
    autoArchiveDuration: 1_440,
    content: CONTENT,
    name: "Need help",
    rateLimitPerUser: 10,
  })
  assert.equal(state.createReason, AUDIT_REASON)
  assert.equal(
    state.events.indexOf("activity:pending") < state.events.indexOf("discord:create"),
    true,
  )
  assert.deepEqual(state.activities.map((entry) => entry.status), ["pending", "completed"])
  assert.equal(state.operationStore.receipt?.status, "completed")
  const persisted = JSON.stringify({
    activities: state.activities,
    receipt: state.operationStore.receipt,
  })
  for (const secret of [
    CONTENT,
    "Need help",
    AUDIT_REASON,
    OPERATION_KEY,
    TAG_ID,
    NOTIFY_USER_ID,
  ]) assert.equal(persisted.includes(secret), false)
})

test("forum-post execution reports safe drift without echoing content", async () => {
  const { service, state } = fixture()
  state.readback = thread({ name: "Need help adjusted", rate_limit_per_user: 20 })
  state.message = message({ content: "Discord-adjusted body" })
  const input = request()
  const plan = await service.plan(BOT_ID, input)
  const result = await service.execute(BOT_ID, input, plan.digest)

  assert.equal(result.status, "completed-with-drift")
  assert.deepEqual(result.driftFields, ["name", "content", "rate-limit-per-user"])
  assert.equal(JSON.stringify(result).includes("Discord-adjusted body"), false)
  assert.equal(state.operationStore.receipt?.verification, "drift")
  assert.equal(state.activities.at(-1)?.status, "completed-with-drift")
})

test("forum-post execution rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const input = request()
  await assert.rejects(
    stale.service.execute(BOT_ID, input, "invalid-digest"),
    /plan digest is invalid/,
  )
  const plan = await stale.service.plan(BOT_ID, input)
  stale.state.forum = forum({ flags: DISCORD_CHANNEL_FLAGS.requireTag })
  await assert.rejects(
    stale.service.execute(BOT_ID, input, plan.digest),
    ForumPostPlanChangedError,
  )

  const spent = fixture()
  const spentPlan = await spent.service.plan(BOT_ID, input)
  const previousReceipt: OperationReceipt = {
    activityId: "previous-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "forum-post",
    operationKeyHash: spentPlan.operationKeyHash,
    planDigest: spentPlan.digest,
    resourceId: THREAD_ID,
    schemaVersion: 1,
    status: "completed",
    timestamp: NOW,
    verification: "match",
  }
  spent.state.operationStore.receipt = previousReceipt
  spent.state.operationStore.receipts.set(
    `${previousReceipt.kind}:${previousReceipt.operationKeyHash}`,
    previousReceipt,
  )
  await assert.rejects(
    spent.service.execute(BOT_ID, input, spentPlan.digest),
    ForumPostOperationConflictError,
  )

  const raced = fixture()
  const racedInput = request({ operationKey: "forum-post-operation-0002" })
  const racedPlan = await raced.service.plan(BOT_ID, racedInput)
  raced.state.operationStore.reserveConflict = {
    activityId: "concurrent-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "forum-post",
    operationKeyHash: racedPlan.operationKeyHash,
    planDigest: racedPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  }
  await assert.rejects(
    raced.service.execute(BOT_ID, racedInput, racedPlan.digest),
    ForumPostOperationConflictError,
  )
  assert.equal(raced.state.events.includes("discord:create"), false)
  assert.equal(raced.state.activities.length, 0)
})

test("forum-post execution classifies rejected, uncertain, and malformed outcomes", async () => {
  for (const scenario of [
    {
      error: new DiscordApiError({
        code: 50_013,
        message: "missing permissions",
        method: "POST",
        route: `/channels/${FORUM_ID}/threads`,
        status: 403,
      }),
      status: "failed",
    },
    {
      error: new DiscordApiError({
        code: 0,
        message: "server unavailable",
        method: "POST",
        route: `/channels/${FORUM_ID}/threads`,
        status: 503,
      }),
      status: "uncertain",
    },
    {
      error: new Error("network down"),
      status: "uncertain",
    },
  ] as const) {
    const target = fixture({ state: { createError: scenario.error } })
    const input = request()
    const plan = await target.service.plan(BOT_ID, input)
    await assert.rejects(
      target.service.execute(BOT_ID, input, plan.digest),
      (error: unknown) => (
        error instanceof ForumPostExecutionError
        && (error.result as { status: string }).status === scenario.status
      ),
    )
    assert.equal(target.state.operationStore.receipt?.status, scenario.status)
    assert.equal(target.state.activities.at(-1)?.status, scenario.status)
  }

  const malformed = fixture({
    state: {
      created: createdPost({ parent_id: OWNER_ID }),
    },
  })
  const malformedInput = request()
  const malformedPlan = await malformed.service.plan(BOT_ID, malformedInput)
  await assert.rejects(
    malformed.service.execute(BOT_ID, malformedInput, malformedPlan.digest),
    (error: unknown) => (
      error instanceof ForumPostExecutionError
      && (error.result as { status: string; threadId: string }).status === "uncertain"
      && (error.result as { threadId: string }).threadId === THREAD_ID
    ),
  )

  const missingStarter = fixture({
    state: { created: thread() as DiscordCreatedForumPost },
  })
  const missingStarterInput = request()
  const missingStarterPlan = await missingStarter.service.plan(BOT_ID, missingStarterInput)
  await assert.rejects(
    missingStarter.service.execute(
      BOT_ID,
      missingStarterInput,
      missingStarterPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ForumPostExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
})

test("forum-post pending activity failure blocks Discord and spends the key", async () => {
  const target = fixture({ state: { activityFailureAt: 0 } })
  const input = request()
  const plan = await target.service.plan(BOT_ID, input)
  await assert.rejects(
    target.service.execute(BOT_ID, input, plan.digest),
    (error: unknown) => (
      error instanceof ForumPostExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(target.state.events.includes("discord:create"), false)
  assert.equal(target.state.operationStore.receipt?.status, "failed")
})

test("forum-post completion reports local receipt and activity failures safely", async () => {
  const receiptFailure = fixture()
  const receiptInput = request()
  const receiptPlan = await receiptFailure.service.plan(BOT_ID, receiptInput)
  receiptFailure.state.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    receiptFailure.service.execute(BOT_ID, receiptInput, receiptPlan.digest),
    (error: unknown) => (
      error instanceof ForumPostExecutionError
      && (error.result as { status: string }).status
        === "completed-operation-record-failed"
      && JSON.stringify(error.result).includes(CONTENT) === false
    ),
  )
  assert.equal(
    receiptFailure.state.events.filter((event) => event === "discord:create").length,
    1,
  )
  assert.deepEqual(
    receiptFailure.state.activities.map((entry) => entry.status),
    ["pending", "completed"],
  )

  const activityFailure = fixture({ state: { activityFailureAt: 1 } })
  const activityInput = request({ operationKey: "forum-post-operation-0002" })
  const activityPlan = await activityFailure.service.plan(BOT_ID, activityInput)
  await assert.rejects(
    activityFailure.service.execute(BOT_ID, activityInput, activityPlan.digest),
    (error: unknown) => (
      error instanceof ForumPostExecutionError
      && (error.result as { status: string }).status === "completed-audit-failed"
      && JSON.stringify(error.result).includes(CONTENT) === false
    ),
  )
  assert.equal(activityFailure.state.operationStore.receipt?.status, "completed")
  assert.deepEqual(
    activityFailure.state.activities.map((entry) => entry.status),
    ["pending"],
  )
})

test("forum-post same-target lock blocks a queued write after an uncertain outcome", async () => {
  let createCalls = 0
  let markFirstStarted: (() => void) | undefined
  let releaseFirst: (() => void) | undefined
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve
  })
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const target = fixture({
    client: {
      async createForumPost() {
        createCalls += 1
        markFirstStarted?.()
        await firstRelease
        throw new Error("transport outcome unavailable")
      },
    },
  })
  const firstInput = request()
  const secondInput = request({ operationKey: "forum-post-operation-0002" })
  const [firstPlan, secondPlan] = await Promise.all([
    target.service.plan(BOT_ID, firstInput),
    target.service.plan(BOT_ID, secondInput),
  ])
  const firstOutcome = target.service.execute(
    BOT_ID,
    firstInput,
    firstPlan.digest,
  ).catch((error: unknown) => error)
  await firstStarted
  const secondOutcome = target.service.execute(
    BOT_ID,
    secondInput,
    secondPlan.digest,
  ).catch((error: unknown) => error)
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(createCalls, 1)
  releaseFirst?.()
  const [firstError, secondError] = await Promise.all([
    firstOutcome,
    secondOutcome,
  ])

  assert.equal(firstError instanceof ForumPostExecutionError, true)
  assert.equal(
    (firstError as ForumPostExecutionError).result
      && ((firstError as ForumPostExecutionError).result as { status: string }).status,
    "uncertain",
  )
  assert.equal(secondError instanceof ForumPostExecutionError, true)
  assert.equal(
    (secondError as ForumPostExecutionError).result
      && ((secondError as ForumPostExecutionError).result as { status: string }).status,
    "blocked-prior-uncertain",
  )
  assert.equal(createCalls, 1)
})
