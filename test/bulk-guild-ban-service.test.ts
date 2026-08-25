import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
  BulkGuildBanActivity,
} from "../src/activity-log.js"
import {
  BulkGuildBanService,
  normalizeBulkGuildBanRequest,
  type BulkGuildBanRequest,
  type BulkGuildBanServiceOptions,
} from "../src/bulk-guild-ban-service.js"
import {
  BulkGuildBanExecutionError,
  BulkGuildBanPlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import {
  operationKeyHash,
  type OperationReceipt,
  type OperationReservation,
  type OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordBan,
  DiscordGuildMember,
  DiscordRole,
  DiscordUser,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const APPLICATION_ID = "150000000000000001"
const BOT_ID = "200000000000000001"
const OWNER_ID = "250000000000000001"
const USER_A = "300000000000000001"
const USER_B = "300000000000000002"
const USER_C = "300000000000000003"
const BOT_ROLE_ID = "400000000000000001"
const TARGET_ROLE_ID = "400000000000000002"
const HIGH_TARGET_ROLE_ID = "400000000000000003"
const AUDIT_REASON = "Reviewed incident 42"
const OPERATION_KEY = "bulk-guild-ban-operation-0001"
const NOW = "2026-08-25T00:00:00.000Z"

function user(id: string, username = `user-${id.slice(-2)}`, bot = false): DiscordUser {
  return { bot, global_name: null, id, username }
}

function role(
  id: string,
  permissions: bigint,
  position: number,
  name: string,
): DiscordRole {
  return {
    id,
    managed: false,
    name,
    permissions: permissions.toString(),
    position,
  }
}

function notFound(route: string): DiscordApiError {
  return new DiscordApiError({
    message: `Discord API GET ${route} returned 404`,
    method: "GET",
    route,
    status: 404,
  })
}

function apiError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: `Discord API POST /guilds/{guild.id}/bulk-ban returned ${status}`,
    method: "POST",
    ...(status === 429 ? { retryAfterMs: 1_250 } : {}),
    route: "/guilds/{guild.id}/bulk-ban",
    status,
  })
}

function policy(options: {
  audit?: boolean
  execute?: boolean
  protectedUserIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowBulkBanAudit: options.audit ?? true,
    allowBulkBans: options.execute ?? true,
    allowDeletions: false,
    allowInteractions: false,
    bulkBanGuildIds: new Set([GUILD_ID]),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(options.protectedUserIds || []),
    adminGuildIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  #key(kind: string, hash: string): string {
    return `${kind}\0${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), receipt)
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(this.#key(kind, hash))
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activeBanLookups: number
  appendFailureAt: number | null
  bannedUserIds: Set<string>
  banLookupDelay: boolean
  botMember: DiscordGuildMember
  dispatchError: unknown
  guildId: string
  guildOwnerId: string
  maxActiveBanLookups: number
  members: Map<string, DiscordGuildMember>
  postDispatchBannedUserIds: Set<string>
  readbackErrorUserIds: Set<string>
  responseBannedUserIds: string[] | null
  responseFailedUserIds: string[] | null
  roles: DiscordRole[]
  users: Map<string, DiscordUser>
  writes: number
}

function request(overrides: Partial<BulkGuildBanRequest> = {}): BulkGuildBanRequest {
  return {
    auditReason: AUDIT_REASON,
    deleteMessageSeconds: 3_600,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    userIds: [USER_A, USER_B],
    ...overrides,
  }
}

function fixture(options: {
  operationStore?: MemoryOperationStore
  planKey?: Uint8Array
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.BAN_MEMBERS
    | DISCORD_PERMISSIONS.MANAGE_GUILD
  const defaultUsers = new Map([
    [USER_A, user(USER_A, "member-a")],
    [USER_B, user(USER_B, "nonmember-b")],
    [USER_C, user(USER_C, "member-c")],
  ])
  const state: FixtureState = {
    activeBanLookups: 0,
    appendFailureAt: null,
    bannedUserIds: new Set(),
    banLookupDelay: false,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: user(BOT_ID, "connector-bot", true),
    },
    dispatchError: undefined,
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    maxActiveBanLookups: 0,
    members: new Map([
      [USER_A, {
        nick: "member a nick",
        roles: [TARGET_ROLE_ID],
        user: defaultUsers.get(USER_A)!,
      }],
      [USER_C, {
        nick: null,
        roles: [TARGET_ROLE_ID],
        user: defaultUsers.get(USER_C)!,
      }],
    ]),
    postDispatchBannedUserIds: new Set([USER_A, USER_B]),
    readbackErrorUserIds: new Set(),
    responseBannedUserIds: null,
    responseFailedUserIds: null,
    roles: [
      role(GUILD_ID, 0n, 0, "@everyone"),
      role(BOT_ROLE_ID, permissions, 10, "connector-role"),
      role(TARGET_ROLE_ID, 0n, 1, "target-role"),
      role(HIGH_TARGET_ROLE_ID, 0n, 9, "high-target-role"),
    ],
    users: defaultUsers,
    writes: 0,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const operationStore = options.operationStore || new MemoryOperationStore(events)
  let appendCalls = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      appendCalls += 1
      if (state.appendFailureAt === appendCalls) throw new Error("activity unavailable")
      activities.push(entry)
      events.push(`audit:${entry.status}`)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: BulkGuildBanServiceOptions["client"] = {
    async bulkGuildBan(_guildId, userIds) {
      state.writes += 1
      events.push("write:bulk-ban")
      state.bannedUserIds = new Set(state.postDispatchBannedUserIds)
      if (state.dispatchError) throw state.dispatchError
      return {
        bannedUserIds: state.responseBannedUserIds ?? [...userIds],
        failedUserIds: state.responseFailedUserIds ?? [],
      }
    },
    async getGuild() {
      return {
        id: state.guildId,
        name: "guild",
        owner_id: state.guildOwnerId,
      }
    },
    async getGuildBan(guildId, userId) {
      state.activeBanLookups += 1
      state.maxActiveBanLookups = Math.max(
        state.maxActiveBanLookups,
        state.activeBanLookups,
      )
      if (state.banLookupDelay) await new Promise((resolve) => setImmediate(resolve))
      state.activeBanLookups -= 1
      if (state.writes > 0 && state.readbackErrorUserIds.has(userId)) {
        throw new Error("readback unavailable")
      }
      if (!state.bannedUserIds.has(userId)) {
        throw notFound(`/guilds/${guildId}/bans/${userId}`)
      }
      return { user: state.users.get(userId) } as DiscordBan
    },
    async getGuildMember(guildId, userId) {
      if (userId === BOT_ID) return state.botMember
      const member = state.members.get(userId)
      if (!member) throw notFound(`/guilds/${guildId}/members/${userId}`)
      return member
    },
    async getGuildRoles() {
      return state.roles
    },
    async getUser(userId) {
      return state.users.get(userId) as DiscordUser
    },
  }
  const implementation = new BulkGuildBanService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: options.planKey || new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    randomId: () => "bulk-ban-activity-1",
  })
  const service = {
    execute: (requestValue: BulkGuildBanRequest, digest: string) => (
      implementation.execute(APPLICATION_ID, BOT_ID, requestValue, digest)
    ),
    plan: (requestValue: BulkGuildBanRequest) => (
      implementation.plan(APPLICATION_ID, BOT_ID, requestValue)
    ),
  }
  return {
    activities,
    events,
    implementation,
    operationStore,
    service,
    state,
  }
}

test("bulk guild ban normalization is exact, bounded, and numerically canonical", () => {
  const normalized = normalizeBulkGuildBanRequest({
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    userIds: [USER_B, USER_A],
  })

  assert.deepEqual(normalized.userIds, [USER_A, USER_B])
  assert.equal(normalized.deleteMessageSeconds, 0)
  assert.equal(normalized.operationKeyHash, operationKeyHash(OPERATION_KEY))
  assert.match(normalized.targetSetDigest, /^sha256:[a-f0-9]{64}$/)
  const tooMany = Array.from(
    { length: 201 },
    (_, index) => (300_000_000_000_001_000n + BigInt(index)).toString(),
  )
  const invalid = [
    request({ userIds: [USER_A] }),
    request({ userIds: tooMany }),
    request({ userIds: [USER_A, USER_A] }),
    request({ userIds: [USER_A, "0"] }),
    request({ deleteMessageSeconds: 604_801 }),
    request({ auditReason: " " }),
    request({ operationKey: "short" }),
    { ...request(), extra: true } as BulkGuildBanRequest,
  ]
  for (const input of invalid) {
    assert.throws(() => normalizeBulkGuildBanRequest(input))
  }
})

test("bulk guild ban plans bind complete permissions and exact target prestate", async () => {
  const { service, state } = fixture()

  const first = await service.plan(request({ userIds: [USER_B, USER_A] }))
  state.users.set(USER_A, user(USER_A, "renamed-member"))
  state.members.get(USER_A)!.user = state.users.get(USER_A)!
  const second = await service.plan(request({ userIds: [USER_A, USER_B] }))

  assert.equal(first.digest, second.digest)
  assert.deepEqual(first.permission.required, ["BAN_MEMBERS", "MANAGE_GUILD"])
  assert.equal(first.permission.botAdministrator, false)
  assert.equal(first.permission.botGuildOwner, false)
  assert.deepEqual(first.targets.map((target) => target.id), [USER_A, USER_B])
  assert.deepEqual(first.targets.map((target) => target.membership), ["member", "non-member"])
  assert.equal(first.memberCount, 1)
  assert.equal(first.nonMemberCount, 1)
  assert.deepEqual(first.estimatedRequests, {
    destructive: 1,
    planningEvidence: 8,
    readback: 2,
  })
  assert.match(first.warnings.join(" "), /transient untrusted/)
  assert.match(first.risks.join(" "), /mixed success/)

  state.members.get(USER_A)!.roles = [HIGH_TARGET_ROLE_ID]
  const changed = await service.plan(request())
  assert.notEqual(changed.digest, first.digest)
})

test("bulk guild ban planning fails closed on scope, target, permission, and hierarchy evidence", async (context) => {
  const cases: Array<{
    configure: () => ReturnType<typeof fixture>
    pattern: RegExp
    request?: BulkGuildBanRequest
  }> = [
    {
      configure: () => fixture({ policy: policy({ audit: false }) }),
      pattern: /audit is disabled/,
    },
    {
      configure: () => fixture({ policy: policy({ protectedUserIds: [USER_A] }) }),
      pattern: /protected from administration/,
    },
    {
      configure: () => fixture(),
      pattern: /connector bot cannot be targeted/,
      request: request({ userIds: [BOT_ID, USER_A] }),
    },
    {
      configure: () => fixture(),
      pattern: /guild owner cannot be targeted/,
      request: request({ userIds: [OWNER_ID, USER_A] }),
    },
    {
      configure: () => fixture({
        state: { bannedUserIds: new Set([USER_A]) },
      }),
      pattern: /already banned/,
    },
    {
      configure: () => fixture({
        state: {
          roles: [
            role(GUILD_ID, 0n, 0, "@everyone"),
            role(BOT_ROLE_ID, DISCORD_PERMISSIONS.BAN_MEMBERS, 10, "connector-role"),
            role(TARGET_ROLE_ID, 0n, 1, "target-role"),
          ],
        },
      }),
      pattern: /lacks MANAGE_GUILD/,
    },
    {
      configure: () => {
        const result = fixture()
        result.state.roles.push(
          role("400000000000000004", 0n, 11, "above-connector"),
        )
        result.state.members.get(USER_A)!.roles = ["400000000000000004"]
        return result
      },
      pattern: /highest role is not above target/,
    },
    {
      configure: () => fixture({ state: { roles: [] } }),
      pattern: /role inventory/,
    },
    {
      configure: () => {
        const result = fixture()
        result.state.users.set(USER_B, user(USER_C, "mismatched"))
        return result
      },
      pattern: /mismatched nonmember target/,
    },
  ]

  for (const [index, scenario] of cases.entries()) {
    await context.test(String(index), async () => {
      const { service } = scenario.configure()
      await assert.rejects(
        () => service.plan(scenario.request || request()),
        scenario.pattern,
      )
    })
  }
})

test("bulk guild ban execution journals before one write and verifies every target", async () => {
  const { activities, events, operationStore, service, state } = fixture()
  const plan = await service.plan(request())

  const result = await service.execute(request(), plan.digest)

  assert.equal(state.writes, 1)
  assert.deepEqual(result.observedBannedUserIds, [USER_A, USER_B])
  assert.deepEqual(result.responseBannedUserIds, [USER_A, USER_B])
  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.deepEqual(events, [
    "operation:reserve",
    "audit:pending",
    "write:bulk-ban",
    "operation:completed",
    "audit:completed",
  ])
  assert.deepEqual(
    activities.map((entry) => entry.status),
    ["pending", "completed"],
  )
  const receipt = operationStore.receipts.get(
    `bulk-guild-ban\0${operationKeyHash(OPERATION_KEY)}`,
  )
  assert.equal(receipt?.resourceId, GUILD_ID)
  assert.equal(receipt?.verification, "match")
  const serialized = JSON.stringify({ activities, receipt, result })
  assert.doesNotMatch(serialized, new RegExp(OPERATION_KEY))
  assert.doesNotMatch(serialized, /Reviewed incident|member a nick|member-a|nonmember-b/)
})

test("bulk guild ban classifies exact partial, drift, failure, and uncertainty outcomes", async (context) => {
  const scenarios: Array<{
    dispatchError?: unknown
    observed: readonly string[]
    responseBanned?: readonly string[]
    responseFailed?: readonly string[]
    status: string
    verification: string | null
  }> = [
    {
      observed: [USER_A],
      responseBanned: [USER_A],
      responseFailed: [USER_B],
      status: "partial",
      verification: "match",
    },
    {
      observed: [USER_A, USER_B],
      responseBanned: [USER_A],
      responseFailed: [USER_B],
      status: "completed-with-drift",
      verification: "drift",
    },
    {
      observed: [],
      responseBanned: [],
      responseFailed: [USER_A, USER_B],
      status: "failed",
      verification: "match",
    },
    {
      dispatchError: apiError(400, 500_000),
      observed: [USER_A],
      status: "partial-with-drift",
      verification: "drift",
    },
    {
      dispatchError: apiError(400, 500_000),
      observed: [],
      status: "failed",
      verification: "match",
    },
    {
      dispatchError: apiError(429),
      observed: [USER_A, USER_B],
      status: "completed-with-drift",
      verification: "drift",
    },
    {
      dispatchError: apiError(429),
      observed: [USER_A],
      status: "uncertain",
      verification: null,
    },
  ]

  for (const [index, scenario] of scenarios.entries()) {
    await context.test(String(index), async () => {
      const { activities, operationStore, service } = fixture({
        state: {
          dispatchError: scenario.dispatchError,
          postDispatchBannedUserIds: new Set(scenario.observed),
          responseBannedUserIds: scenario.responseBanned
            ? [...scenario.responseBanned]
            : null,
          responseFailedUserIds: scenario.responseFailed
            ? [...scenario.responseFailed]
            : null,
        },
      })
      const plan = await service.plan(request())
      let result: Record<string, unknown>
      try {
        result = await service.execute(request(), plan.digest) as unknown as Record<string, unknown>
      } catch (error) {
        assert.equal(error instanceof BulkGuildBanExecutionError, true)
        result = (error as BulkGuildBanExecutionError).result as Record<string, unknown>
      }
      assert.equal(result.status, scenario.status)
      assert.equal(result.verification, scenario.verification)
      const activity = activities.at(-1) as BulkGuildBanActivity
      assert.equal(activity.status, scenario.status)
      assert.equal(activity.verification, scenario.verification)
      const receipt = operationStore.receipts.get(
        `bulk-guild-ban\0${operationKeyHash(OPERATION_KEY)}`,
      )
      assert.equal(
        receipt?.status,
        scenario.status.startsWith("completed")
          ? "completed"
          : scenario.status === "uncertain"
            ? "uncertain"
            : "failed",
      )
    })
  }
})

test("bulk guild ban treats incomplete readback as uncertain and preserves exact observations", async () => {
  const { activities, service } = fixture({
    state: {
      postDispatchBannedUserIds: new Set([USER_A, USER_B]),
      readbackErrorUserIds: new Set([USER_B]),
    },
  })
  const plan = await service.plan(request())

  await assert.rejects(
    () => service.execute(request(), plan.digest),
    (error: BulkGuildBanExecutionError) => {
      const result = error.result as Record<string, unknown>
      assert.equal(result.status, "uncertain")
      assert.deepEqual(result.observedBannedUserIds, [USER_A])
      assert.deepEqual(result.observedNotBannedUserIds, [])
      return true
    },
  )
  assert.equal(activities.at(-1)?.status, "uncertain")
})

test("bulk guild ban refuses stale plans before reservation or mutation", async () => {
  const { events, service, state } = fixture()
  const plan = await service.plan(request())
  state.members.get(USER_A)!.roles = [HIGH_TARGET_ROLE_ID]

  await assert.rejects(
    () => service.execute(request(), plan.digest),
    BulkGuildBanPlanChangedError,
  )
  assert.deepEqual(events, [])
  assert.equal(state.writes, 0)
})

test("bulk guild ban preserves the audit and receipt failure boundaries", async (context) => {
  await context.test("pending audit", async () => {
    const { events, service, state } = fixture({
      state: { appendFailureAt: 1 },
    })
    const plan = await service.plan(request())
    await assert.rejects(
      () => service.execute(request(), plan.digest),
      /pending activity could not be recorded/,
    )
    assert.equal(state.writes, 0)
    assert.deepEqual(events, ["operation:reserve", "operation:failed"])
  })

  await context.test("terminal receipt", async () => {
    const events: string[] = []
    const operationStore = new MemoryOperationStore(events)
    const result = fixture({ operationStore })
    const plan = await result.service.plan(request())
    operationStore.finishFailure = new Error("receipt unavailable")
    await assert.rejects(
      () => result.service.execute(request(), plan.digest),
      (error: BulkGuildBanExecutionError) => {
        assert.equal(
          (error.result as Record<string, unknown>).status,
          "completed-operation-record-failed",
        )
        return true
      },
    )
    assert.equal(result.activities.at(-1)?.status, "completed")
    assert.equal(result.operationStore.receipts.get(
      `bulk-guild-ban\0${operationKeyHash(OPERATION_KEY)}`,
    )?.status, "pending")
  })

  await context.test("terminal activity", async () => {
    const { operationStore, service } = fixture({
      state: { appendFailureAt: 2 },
    })
    const plan = await service.plan(request())
    await assert.rejects(
      () => service.execute(request(), plan.digest),
      (error: BulkGuildBanExecutionError) => {
        assert.equal(
          (error.result as Record<string, unknown>).status,
          "completed-audit-failed",
        )
        return true
      },
    )
    assert.equal(operationStore.receipts.get(
      `bulk-guild-ban\0${operationKeyHash(OPERATION_KEY)}`,
    )?.status, "completed")
  })
})

test("bulk guild ban bounds exact target lookups and readback to four concurrent requests", async () => {
  const userIds = Array.from(
    { length: 10 },
    (_, index) => (300_000_000_000_000_101n + BigInt(index)).toString(),
  )
  const users = new Map(userIds.map((userId) => [userId, user(userId)]))
  const { service, state } = fixture({
    state: {
      banLookupDelay: true,
      members: new Map(),
      postDispatchBannedUserIds: new Set(userIds),
      users,
    },
  })
  const input = request({ userIds })
  const plan = await service.plan(input)

  const result = await service.execute(input, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(state.maxActiveBanLookups, 4)
})

test("bulk guild ban execution requires its independent change capability", async () => {
  const { service } = fixture({ policy: policy({ execute: false }) })
  const plan = await service.plan(request())

  await assert.rejects(
    () => service.execute(request(), plan.digest),
    /bulk bans are disabled/,
  )
})

test("bulk guild ban policy remains exact-guild scoped", async () => {
  const { implementation } = fixture()

  await assert.rejects(
    () => implementation.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ guildId: OTHER_GUILD_ID }),
    ),
    /outside the configured read scope/,
  )
})
