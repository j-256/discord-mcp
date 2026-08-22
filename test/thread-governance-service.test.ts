import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  DiscordThreadStateSummary,
  ModifyThreadStateInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  ThreadGovernanceExecutionError,
  ThreadGovernanceOperationConflictError,
  ThreadGovernancePlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeThreadChangeRequest,
  ThreadGovernanceService,
  type ThreadChangeRequest,
  type ThreadGovernanceServiceOptions,
} from "../src/thread-governance-service.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const USER_ID = "500000000000000001"
const USER_ROLE_ID = "500000000000000002"
const PARENT_ID = "600000000000000001"
const THREAD_ID = "700000000000000001"
const OPERATION_KEY = "thread-governance-operation-0001"
const AUDIT_REASON = "Reviewed thread governance change"
const NOW = "2026-08-22T14:00:00.000Z"

function role(
  id: string,
  permissions: bigint,
  position: number,
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name: id === GUILD_ID ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function thread(
  overrides: Partial<DiscordThreadStateSummary> = {},
): DiscordThreadStateSummary {
  return {
    archived: false,
    autoArchiveDuration: 1440,
    guildId: GUILD_ID,
    id: THREAD_ID,
    invitable: true,
    locked: false,
    name: "private-thread",
    ownerId: OWNER_ID,
    parentId: PARENT_ID,
    rateLimitPerUser: 0,
    type: DISCORD_CHANNEL_TYPES.privateThread,
    unknownFieldCount: 0,
    unknownMetadataFieldCount: 0,
    ...overrides,
  }
}

function request(
  overrides: Record<string, unknown> = {},
): ThreadChangeRequest {
  const value: Record<string, unknown> = {
    action: "rename",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "renamed-thread",
    operationKey: OPERATION_KEY,
    threadId: THREAD_ID,
    ...overrides,
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) delete value[key]
  }
  return value as unknown as ThreadChangeRequest
}

function policy(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  protectedUsers?: readonly string[]
  threadIds?: readonly string[]
  userIds?: readonly string[]
} = {}): ScopePolicy {
  const threadIds = options.threadIds ?? [THREAD_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([PARENT_ID, ...threadIds]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowThreadAudit: options.allowAudit ?? true,
    allowThreadChanges: options.allowChanges ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(options.protectedUsers ?? []),
    threadGuildIds: new Set([GUILD_ID]),
    threadIds: new Set(threadIds),
    threadMemberUserIds: new Set(options.userIds ?? [USER_ID]),
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
  guildName: string
  membership: Set<string>
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  ownerId: string
  parent: DiscordChannel
  readbackError: unknown
  responseOverride: DiscordThreadStateSummary | null
  roles: DiscordRole[]
  targetMember: DiscordGuildMember
  thread: DiscordThreadStateSummary
}

function discordError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: "Discord request failed",
    method: "GET",
    route: "/redacted",
    status,
  })
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const everyonePermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    guildName: "Private Guild Name",
    membership: new Set([BOT_ID]),
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    ownerId: OWNER_ID,
    parent: {
      guild_id: GUILD_ID,
      id: PARENT_ID,
      name: "private-parent",
      permission_overwrites: [],
      type: DISCORD_CHANNEL_TYPES.text,
    },
    readbackError: undefined,
    responseOverride: null,
    roles: [
      role(GUILD_ID, everyonePermissions, 0),
      role(USER_ROLE_ID, 0n, 2),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_THREADS, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
    targetMember: {
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
    thread: thread(),
    ...options.state,
  }
  const events: string[] = []
  const activities: ActivityEntry[] = []
  let activityCalls = 0
  let mutations = 0
  let readbacks = 0
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
  const client: ThreadGovernanceServiceOptions["client"] = {
    async addThreadMember(_threadId, userId) {
      mutations += 1
      events.push("write:add-member")
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      state.membership.add(userId)
    },
    async getChannel() {
      events.push("read:parent")
      return state.parent
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: state.guildName, owner_id: state.ownerId }
    },
    async getGuildMember(_guildId, userId) {
      events.push(`read:member:${userId}`)
      return userId === BOT_ID ? state.botMember : state.targetMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async getThreadMember(_threadId, userId) {
      events.push(`read:thread-member:${userId}`)
      if (!state.membership.has(userId)) throw discordError(404, 10007)
      return {
        flags: 0,
        id: THREAD_ID,
        join_timestamp: NOW,
        unknown_field_count: 0,
        user_id: userId,
      }
    },
    async getThreadState() {
      events.push("read:thread")
      if (mutations > 0) {
        readbacks += 1
        if (state.readbackError) throw state.readbackError
      }
      return state.thread
    },
    async modifyThreadState(_threadId, input) {
      mutations += 1
      events.push(`write:${Object.keys(input)[0]}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      applyThreadInput(state, input)
      if (state.responseOverride) state.thread = state.responseOverride
      return state.thread
    },
    async removeThreadMember(_threadId, userId) {
      mutations += 1
      events.push("write:remove-member")
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      state.membership.delete(userId)
    },
  }
  const service = new ThreadGovernanceService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(13),
    policy: options.policy || policy(),
    randomId: () => "thread-governance-activity-0001",
  })
  return {
    activities,
    client,
    events,
    get mutations() {
      return mutations
    },
    get readbacks() {
      return readbacks
    },
    operationStore,
    service,
    state,
  }
}

function applyThreadInput(
  state: FixtureState,
  input: ModifyThreadStateInput,
): void {
  if ("name" in input) state.thread = { ...state.thread, name: input.name }
  else if ("archived" in input) state.thread = { ...state.thread, archived: input.archived }
  else if ("locked" in input) state.thread = { ...state.thread, locked: input.locked }
  else if ("autoArchiveDuration" in input) {
    state.thread = { ...state.thread, autoArchiveDuration: input.autoArchiveDuration }
  } else if ("rateLimitPerUser" in input) {
    state.thread = { ...state.thread, rateLimitPerUser: input.rateLimitPerUser }
  } else if ("invitable" in input) {
    state.thread = { ...state.thread, invitable: input.invitable }
  }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof ThreadGovernanceExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("thread governance normalization enforces closed action schemas", () => {
  const cases: ThreadChangeRequest[] = [
    request({ action: "rename", name: "renamed-thread" }),
    request({ action: "archive", name: undefined }),
    request({ action: "unarchive", name: undefined }),
    request({ action: "lock", name: undefined }),
    request({ action: "unlock", name: undefined }),
    request({
      action: "set-auto-archive-duration",
      autoArchiveDuration: 4320,
      name: undefined,
    }),
    request({ action: "set-invitable", enabled: false, name: undefined }),
    request({ action: "set-slowmode", name: undefined, rateLimitPerUser: 30 }),
    request({ action: "add-member", name: undefined, userId: USER_ID }),
    request({ action: "remove-member", name: undefined, userId: USER_ID }),
  ]
  for (const item of cases) {
    const normalized = normalizeThreadChangeRequest(item)
    assert.equal(normalized.action, item.action)
    assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  }

  assert.throws(
    () => normalizeThreadChangeRequest(request({ extra: true } as never)),
    /accepts one name field/,
  )
  assert.throws(
    () => normalizeThreadChangeRequest(request({ action: "archive", name: "extra" })),
    /accepts no action-specific fields/,
  )
  assert.throws(
    () => normalizeThreadChangeRequest(request({ action: "set-slowmode", name: undefined, rateLimitPerUser: 21601 })),
    /between 0 and 21600/,
  )
  assert.throws(
    () => normalizeThreadChangeRequest(request({ action: "set-invitable", enabled: "yes", name: undefined } as never)),
    /enabled boolean/,
  )
})

test("thread governance audits exact state and membership without enumeration", async () => {
  const target = fixture({ state: {
    thread: thread({ unknownFieldCount: 2 }),
  } })
  const audit = await target.service.getState(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    THREAD_ID,
  )
  assert.equal(audit.status, "ok")
  assert.equal(audit.thread.type, "private")
  assert.equal(audit.connectorMembership.isMember, true)
  assert.equal(audit.permission.allowed, true)
  assert.equal(audit.privacy.enumeration, "none")
  assert.equal(audit.privacy.embeddedGuildMembers, "never-requested")
  assert.ok(audit.warnings.some((warning) => warning.includes("unknown top-level")))
  assert.doesNotMatch(JSON.stringify(audit), /permission_overwrites|join_timestamp/u)

  const membership = await target.service.getMembership(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    THREAD_ID,
    USER_ID,
  )
  assert.equal(membership.membership.isMember, false)
  assert.equal(membership.member.username, "target-user")
  assert.equal(membership.targetPermission.allowed, true)
  assert.equal(target.events.some((event) => event.includes("list")), false)
})

test("thread governance executes every metadata action with one exact write", async () => {
  const cases: Array<{
    field: string
    request: ThreadChangeRequest
  }> = [
    { field: "name", request: request() },
    { field: "archived", request: request({ action: "archive", name: undefined }) },
    {
      field: "autoArchiveDuration",
      request: request({
        action: "set-auto-archive-duration",
        autoArchiveDuration: 4320,
        name: undefined,
      }),
    },
    { field: "invitable", request: request({ action: "set-invitable", enabled: false, name: undefined }) },
    { field: "locked", request: request({ action: "lock", name: undefined }) },
    { field: "rateLimitPerUser", request: request({ action: "set-slowmode", name: undefined, rateLimitPerUser: 30 }) },
  ]
  for (const item of cases) {
    const target = fixture()
    const plan = await target.service.plan(APPLICATION_ID, BOT_ID, item.request)
    assert.equal(plan.status, "planned")
    assert.equal(plan.writeRequired, true)
    const result = await target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      item.request,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.equal(result.verification, "match")
    assert.equal(target.mutations, 1)
    assert.equal(target.readbacks, 1)
    assert.ok(target.events.includes(`write:${item.field}`))
  }
})

test("thread governance supports unarchive and unlock with reviewed evidence", async () => {
  for (const [action, initial] of [
    ["unarchive", { archived: true }],
    ["unlock", { locked: true }],
  ] as const) {
    const target = fixture({ state: { thread: thread(initial) } })
    const change = request({ action, name: undefined })
    const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)
    const result = await target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      change,
      plan.digest,
    )
    assert.equal(result.status, "completed")
  }
})

test("thread governance adds and removes exact members with content-free records", async () => {
  const addTarget = fixture()
  const addRequest = request({ action: "add-member", name: undefined, userId: USER_ID })
  const addPlan = await addTarget.service.plan(APPLICATION_ID, BOT_ID, addRequest)
  assert.equal(addPlan.membership?.isMember, false)
  const addResult = await addTarget.service.execute(
    APPLICATION_ID,
    BOT_ID,
    addRequest,
    addPlan.digest,
  )
  assert.equal(addResult.observedMembership?.isMember, true)
  assert.ok(addTarget.events.includes("write:add-member"))

  const removeTarget = fixture({ state: { membership: new Set([BOT_ID, USER_ID]) } })
  const removeRequest = request({ action: "remove-member", name: undefined, userId: USER_ID })
  const removePlan = await removeTarget.service.plan(
    APPLICATION_ID,
    BOT_ID,
    removeRequest,
  )
  const removeResult = await removeTarget.service.execute(
    APPLICATION_ID,
    BOT_ID,
    removeRequest,
    removePlan.digest,
  )
  assert.equal(removeResult.observedMembership?.isMember, false)
  assert.ok(removeTarget.events.includes("write:remove-member"))

  const durable = JSON.stringify({
    activities: removeTarget.activities,
    receipt: removeTarget.operationStore.lastReceipt,
  })
  assert.doesNotMatch(durable, /Private Guild Name|target-user|Reviewed thread governance/u)
  assert.doesNotMatch(durable, new RegExp(OPERATION_KEY))
  assert.match(durable, new RegExp(THREAD_ID))
})

test("thread governance no-ops do not reserve or persist", async () => {
  const target = fixture()
  const change = request({ name: "private-thread" })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)
  assert.equal(plan.status, "already-current")
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    change,
    plan.digest,
  )
  assert.equal(result.status, "already-current")
  assert.equal(target.mutations, 0)
  assert.equal(target.activities.length, 0)
  assert.equal(target.operationStore.lastReceipt, undefined)

  const absent = fixture()
  const remove = request({ action: "remove-member", name: undefined, userId: USER_ID })
  const absentPlan = await absent.service.plan(APPLICATION_ID, BOT_ID, remove)
  assert.equal(absentPlan.status, "already-current")
})

test("thread governance binds plans to canonical evidence and rejects stale state", async () => {
  const target = fixture()
  const first = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  target.state.thread = { ...target.state.thread, rateLimitPerUser: 5 }
  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, request(), first.digest),
    ThreadGovernancePlanChangedError,
  )
  assert.equal(target.mutations, 0)

  const canonical = fixture()
  const privateRole = canonical.state.roles[1] as DiscordRole & { future_private_value?: string }
  privateRole.future_private_value = "discarded"
  const canonicalFirst = await canonical.service.plan(APPLICATION_ID, BOT_ID, request())
  privateRole.future_private_value = "changed"
  canonical.state.roles.reverse()
  const canonicalSecond = await canonical.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(canonicalFirst.digest, canonicalSecond.digest)
  assert.doesNotMatch(JSON.stringify(canonicalFirst), /future_private_value|discarded/u)
})

test("thread governance blocks unsafe membership and incomplete lifecycle evidence", async () => {
  const protectedTarget = fixture({ policy: policy({ protectedUsers: [USER_ID] }), state: {
    membership: new Set([BOT_ID, USER_ID]),
  } })
  await assert.rejects(
    protectedTarget.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ action: "remove-member", name: undefined, userId: USER_ID }),
    ),
    /protected from administration/,
  )

  const administrator = fixture({ state: { membership: new Set([BOT_ID, USER_ID]) } })
  const userRole = administrator.state.roles.find(({ id }) => id === USER_ROLE_ID)
  assert.ok(userRole)
  userRole.permissions = DISCORD_PERMISSIONS.ADMINISTRATOR.toString()
  await assert.rejects(
    administrator.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ action: "remove-member", name: undefined, userId: USER_ID }),
    ),
    /cannot target an administrator/,
  )

  const pending = fixture()
  pending.state.targetMember.pending = true
  await assert.rejects(
    pending.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ action: "add-member", name: undefined, userId: USER_ID }),
    ),
    /pending guild members/,
  )

  const unknown = fixture({ state: {
    thread: thread({ unknownMetadataFieldCount: 1 }),
  } })
  const audit = await unknown.service.getState(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    THREAD_ID,
  )
  assert.ok(audit.warnings.some((warning) => warning.includes("changes are blocked")))
  await assert.rejects(
    unknown.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown thread metadata fields/,
  )
})

test("thread governance requires exact scope, permissions, and supported relationships", async () => {
  const denied = fixture({ policy: policy({ allowChanges: false }) })
  await assert.rejects(
    denied.service.plan(APPLICATION_ID, BOT_ID, request()),
    /changes are disabled/,
  )

  const userScope = fixture({ policy: policy({ userIds: [] }) })
  await assert.rejects(
    userScope.service.getMembership(APPLICATION_ID, BOT_ID, GUILD_ID, THREAD_ID, USER_ID),
    /exact user allowlist/,
  )

  const missingPermission = fixture()
  const botRole = missingPermission.state.roles.find(({ id }) => id === BOT_ROLE_ID)
  assert.ok(botRole)
  botRole.permissions = "0"
  missingPermission.state.thread = thread({ ownerId: BOT_ID })
  await assert.rejects(
    missingPermission.service.plan(APPLICATION_ID, BOT_ID, request()),
    /requires MANAGE_THREADS/,
  )

  const targetDenied = fixture()
  targetDenied.state.parent.permission_overwrites = [{
    allow: "0",
    deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
    id: USER_ID,
    type: 1,
  }]
  await assert.rejects(
    targetDenied.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ action: "add-member", name: undefined, userId: USER_ID }),
    ),
    /cannot view the thread parent/,
  )

  const wrongParent = fixture({ state: {
    parent: {
      guild_id: GUILD_ID,
      id: PARENT_ID,
      name: "forum-parent",
      permission_overwrites: [],
      type: DISCORD_CHANNEL_TYPES.forum,
    },
  } })
  await assert.rejects(
    wrongParent.service.getState(APPLICATION_ID, BOT_ID, GUILD_ID, THREAD_ID),
    /mismatched or unsupported thread parent/,
  )
  assert.equal(
    wrongParent.events.some((event) => event.startsWith("read:thread-member:")),
    false,
  )
})

test("thread governance rejects key reuse and distinguishes refusals from uncertainty", async () => {
  const reused = fixture()
  const reusedPlan = await reused.service.plan(APPLICATION_ID, BOT_ID, request())
  await reused.service.execute(APPLICATION_ID, BOT_ID, request(), reusedPlan.digest)
  await assert.rejects(
    reused.service.plan(APPLICATION_ID, BOT_ID, request()),
    ThreadGovernanceOperationConflictError,
  )

  const refused = fixture({ state: { mutationError: discordError(403, 50013) } })
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    refused.service.execute(APPLICATION_ID, BOT_ID, request(), refusedPlan.digest),
    (error: unknown) => executionResult(error).status === "failed",
  )
  assert.equal(refused.operationStore.lastReceipt?.status, "failed")

  const uncertain = fixture({ state: { mutationError: discordError(429, 0) } })
  const firstRequest = request({ operationKey: `${OPERATION_KEY}-uncertain` })
  const firstPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, firstRequest, firstPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  uncertain.state.mutationError = undefined
  const secondRequest = request({ operationKey: `${OPERATION_KEY}-blocked` })
  await assert.rejects(
    async () => uncertain.service.plan(APPLICATION_ID, BOT_ID, secondRequest),
    (error: unknown) => executionResult(error).status === "blocked-prior-uncertain",
  )
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      secondRequest,
      firstPlan.digest,
    ),
    (error: unknown) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(uncertain.mutations, 1)
})

test("thread governance reports valid uncontrolled changes as drift", async () => {
  const target = fixture({ state: {
    responseOverride: thread({ name: "renamed-thread", rateLimitPerUser: 10 }),
  } })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )
  assert.equal(result.status, "completed-with-drift")
  assert.deepEqual(result.driftFields, ["rate-limit-per-user"])
})

test("thread governance fails closed on pending-audit, readback, and receipt failures", async () => {
  const pendingAudit = fixture({ state: { activityFailureAt: 1 } })
  const pendingPlan = await pendingAudit.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    pendingAudit.service.execute(APPLICATION_ID, BOT_ID, request(), pendingPlan.digest),
    (error: unknown) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(pendingAudit.mutations, 0)

  const readback = fixture({ state: { readbackError: new Error("network lost") } })
  const readbackPlan = await readback.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    readback.service.execute(APPLICATION_ID, BOT_ID, request(), readbackPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )

  const receipt = fixture()
  const receiptPlan = await receipt.service.plan(APPLICATION_ID, BOT_ID, request())
  receipt.operationStore.finishFailure = new Error("disk full")
  await assert.rejects(
    receipt.service.execute(APPLICATION_ID, BOT_ID, request(), receiptPlan.digest),
    (error: unknown) => executionResult(error).status
      === "completed-operation-record-failed",
  )
})

test("thread governance serializes concurrent changes to the same thread", async () => {
  let releaseMutation: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve
  })
  const target = fixture({ state: { mutationGate: gate, mutationStarted } })
  const firstRequest = request({ operationKey: `${OPERATION_KEY}-first` })
  const firstPlan = await target.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondRequest = request({
    action: "set-slowmode",
    name: undefined,
    operationKey: `${OPERATION_KEY}-second`,
    rateLimitPerUser: 30,
  })
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const first = target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await started
  const second = target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(target.mutations, 1)
  releaseMutation()
  await first
  await assert.rejects(second, ThreadGovernancePlanChangedError)
  assert.equal(target.mutations, 1)
})
