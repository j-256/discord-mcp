import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
  GuildPruneActivity,
} from "../src/activity-log.js"
import {
  GuildPruneService,
  normalizeGuildPruneRequest,
  type GuildPruneRequest,
  type GuildPruneServiceOptions,
} from "../src/guild-prune-service.js"
import {
  DiscordApiError,
  GuildPruneExecutionError,
  GuildPrunePlanChangedError,
} from "../src/errors.js"
import {
  operationKeyHash,
  type OperationReceipt,
  type OperationReservation,
  type OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordGuildMember, DiscordRole } from "../src/types.js"

const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const APPLICATION_ID = "150000000000000001"
const BOT_ID = "200000000000000001"
const OWNER_ID = "250000000000000001"
const PROTECTED_ID = "300000000000000001"
const INCLUDE_ROLE_ID = "400000000000000001"
const SHIELD_ROLE_ID = "400000000000000002"
const BOT_ROLE_ID = "400000000000000003"
const AUDIT_REASON = "Reviewed inactive-member cleanup"
const OPERATION_KEY = "guild-prune-operation-0001"
const NOW = "2026-08-25T00:00:00.000Z"

function role(
  id: string,
  permissions: bigint,
  position: number,
  name: string,
  managed = false,
): DiscordRole {
  return {
    id,
    managed,
    name,
    permissions: permissions.toString(),
    position,
  }
}

function member(
  id: string,
  roleIds: readonly string[],
  username: string,
): DiscordGuildMember {
  return {
    nick: `${username}-nick`,
    roles: [...roleIds],
    user: { id, username },
  }
}

function apiError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: `Discord API POST /guilds/{guild.id}/prune returned ${status}`,
    method: "POST",
    ...(status === 429 ? { retryAfterMs: 1_250 } : {}),
    route: "/guilds/{guild.id}/prune",
    status,
  })
}

function notFound(userId: string): DiscordApiError {
  return new DiscordApiError({
    message: "Discord member not found",
    method: "GET",
    route: `/guilds/${GUILD_ID}/members/${userId}`,
    status: 404,
  })
}

function policy(options: {
  audit?: boolean
  execute?: boolean
  includeRoleIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowGuildPruneAudit: options.audit ?? true,
    allowGuildPrunes: options.execute ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    guildPruneGuildIds: new Set([GUILD_ID]),
    guildPruneIncludeRoleIds: new Set(options.includeRoleIds ?? [INCLUDE_ROLE_ID]),
    guildPruneMaxMembers: 25,
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
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
  appendFailureAt: number | null
  botMember: DiscordGuildMember
  dispatchError: unknown
  estimate: number
  guildId: string
  guildOwnerId: string
  protectedMember: DiscordGuildMember | undefined
  responsePruned: number
  roles: DiscordRole[]
  writes: number
}

function request(overrides: Partial<GuildPruneRequest> = {}): GuildPruneRequest {
  return {
    acknowledgeNonExactMemberSet: true,
    auditReason: AUDIT_REASON,
    days: 14,
    guildId: GUILD_ID,
    includeRoleIds: [INCLUDE_ROLE_ID],
    maximumEstimatedMemberCount: 25,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function fixture(options: {
  maximumMemberCount?: number
  operationStore?: MemoryOperationStore
  planKey?: Uint8Array
  policy?: ScopePolicy
  protectedUserIds?: readonly string[]
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.KICK_MEMBERS
    | DISCORD_PERMISSIONS.MANAGE_GUILD
  const state: FixtureState = {
    appendFailureAt: null,
    botMember: member(BOT_ID, [BOT_ROLE_ID], "connector-bot"),
    dispatchError: undefined,
    estimate: 3,
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    protectedMember: member(PROTECTED_ID, [SHIELD_ROLE_ID], "protected-user"),
    responsePruned: 3,
    roles: [
      role(GUILD_ID, 0n, 0, "@everyone"),
      role(INCLUDE_ROLE_ID, 0n, 1, "inactive-cohort"),
      role(SHIELD_ROLE_ID, 0n, 2, "protected-shield"),
      role(BOT_ROLE_ID, permissions, 10, "connector-role"),
    ],
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
  const client: GuildPruneServiceOptions["client"] = {
    async beginGuildPrune() {
      state.writes += 1
      events.push("write:guild-prune")
      if (state.dispatchError) throw state.dispatchError
      return { pruned: state.responsePruned }
    },
    async getGuild() {
      return {
        id: state.guildId,
        name: "private guild name",
        owner_id: state.guildOwnerId,
      }
    },
    async getGuildMember(_guildId, userId) {
      if (userId === BOT_ID) return state.botMember
      if (userId === PROTECTED_ID && state.protectedMember) return state.protectedMember
      throw notFound(userId)
    },
    async getGuildPruneCount() {
      return { pruned: state.estimate }
    },
    async getGuildRoles() {
      return state.roles
    },
  }
  const implementation = new GuildPruneService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    maximumMemberCount: options.maximumMemberCount ?? 25,
    operationStore,
    planKey: options.planKey || new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    protectedUserIds: new Set(options.protectedUserIds ?? [PROTECTED_ID]),
    randomId: () => "guild-prune-activity-1",
  })
  const service = {
    execute: (requestValue: GuildPruneRequest, digest: string) => (
      implementation.execute(APPLICATION_ID, BOT_ID, requestValue, digest)
    ),
    plan: (requestValue: GuildPruneRequest) => (
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

test("guild prune normalization is exact, bounded, acknowledged, and canonical", () => {
  const normalized = normalizeGuildPruneRequest(request({
    includeRoleIds: [SHIELD_ROLE_ID, INCLUDE_ROLE_ID],
  }))

  assert.deepEqual(normalized.includeRoleIds, [INCLUDE_ROLE_ID, SHIELD_ROLE_ID])
  assert.equal(normalized.operationKeyHash, operationKeyHash(OPERATION_KEY))
  const tooManyRoles = Array.from(
    { length: 6 },
    (_, index) => (400_000_000_000_001_000n + BigInt(index)).toString(),
  )
  const invalid = [
    { ...request(), acknowledgeNonExactMemberSet: false } as unknown as GuildPruneRequest,
    request({ days: 0 }),
    request({ days: 31 }),
    request({ includeRoleIds: tooManyRoles }),
    request({ includeRoleIds: [INCLUDE_ROLE_ID, INCLUDE_ROLE_ID] }),
    request({ maximumEstimatedMemberCount: 0 }),
    request({ maximumEstimatedMemberCount: 251 }),
    request({ auditReason: " " }),
    request({ operationKey: "short" }),
    { ...request(), extra: true } as GuildPruneRequest,
  ]
  for (const input of invalid) {
    assert.throws(() => normalizeGuildPruneRequest(input))
  }
})

test("guild prune plans bind complete non-exact cohort, permission, role, and protection evidence", async () => {
  const { service, state } = fixture()

  const first = await service.plan(request())
  state.botMember.nick = "renamed private nickname"
  state.botMember.user!.username = "renamed connector"
  state.roles[1]!.name = "renamed private role"
  const second = await service.plan(request())

  assert.equal(first.digest, second.digest)
  assert.equal(first.estimatedMemberCount, 3)
  assert.equal(first.writeRequired, true)
  assert.deepEqual(first.permission.required, ["KICK_MEMBERS", "MANAGE_GUILD"])
  assert.equal(first.permission.botAdministrator, false)
  assert.deepEqual(first.includeRoles.map(({ id }) => id), [INCLUDE_ROLE_ID])
  assert.deepEqual(first.protections, [
    {
      membership: "present",
      outsideCohortRoleIds: [BOT_ROLE_ID],
      protection: "role-shield",
      sources: ["connector"],
      userId: BOT_ID,
    },
    {
      membership: "present",
      outsideCohortRoleIds: [],
      protection: "guild-owner",
      sources: ["guild-owner"],
      userId: OWNER_ID,
    },
    {
      membership: "present",
      outsideCohortRoleIds: [SHIELD_ROLE_ID],
      protection: "role-shield",
      sources: ["configured"],
      userId: PROTECTED_ID,
    },
  ])
  assert.deepEqual(first.cohort, {
    exactMemberIdsAvailable: false,
    inactivity: "discord-defined",
    inactivityDays: 14,
    includedRoleRule: "every-assigned-role-is-included",
    rolelessMembersAlwaysIncluded: true,
  })
  assert.deepEqual(first.estimatedRequests, {
    destructive: 1,
    planningEvidence: 5,
    readback: 0,
  })
  assert.match(first.risks.join(" "), /without exposing any member IDs/)
  assert.match(first.warnings.join(" "), /only settled mutation evidence/)
  assert.doesNotMatch(JSON.stringify(first), /private guild|private nickname|private role/)

  state.estimate = 4
  const changed = await service.plan(request())
  assert.notEqual(changed.digest, first.digest)
})

test("guild prune planning fails closed on scope, ceiling, permission, role, and protection evidence", async (context) => {
  const cases: Array<{
    configure: () => ReturnType<typeof fixture>
    input?: GuildPruneRequest
    pattern: RegExp
  }> = [
    {
      configure: () => fixture({ policy: policy({ audit: false }) }),
      pattern: /audit is disabled/,
    },
    {
      configure: () => fixture({ policy: policy({ includeRoleIds: [] }) }),
      pattern: /outside the guild prune include-role scope/,
    },
    {
      configure: () => fixture(),
      input: request({ guildId: OTHER_GUILD_ID }),
      pattern: /outside the configured read scope/,
    },
    {
      configure: () => fixture({ maximumMemberCount: 10 }),
      input: request({ maximumEstimatedMemberCount: 11 }),
      pattern: /request ceiling exceeds the configured 10-member ceiling/,
    },
    {
      configure: () => fixture({ state: { estimate: 26 } }),
      pattern: /estimate 26 exceeds the request ceiling 25/,
    },
    {
      configure: () => fixture({
        state: {
          roles: [
            role(GUILD_ID, 0n, 0, "@everyone"),
            role(INCLUDE_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_MESSAGES, 1, "unsafe"),
            role(SHIELD_ROLE_ID, 0n, 2, "shield"),
            role(
              BOT_ROLE_ID,
              DISCORD_PERMISSIONS.KICK_MEMBERS | DISCORD_PERMISSIONS.MANAGE_GUILD,
              10,
              "connector",
            ),
          ],
        },
      }),
      pattern: /carries protected permissions: MANAGE_MESSAGES/,
    },
    {
      configure: () => fixture({
        state: {
          roles: [
            role(GUILD_ID, 0n, 0, "@everyone"),
            role(INCLUDE_ROLE_ID, 0n, 10, "too-high"),
            role(SHIELD_ROLE_ID, 0n, 2, "shield"),
            role(
              BOT_ROLE_ID,
              DISCORD_PERMISSIONS.KICK_MEMBERS | DISCORD_PERMISSIONS.MANAGE_GUILD,
              10,
              "connector",
            ),
          ],
        },
      }),
      pattern: /is not below the connector's highest role/,
    },
    {
      configure: () => fixture({
        state: {
          roles: [
            role(GUILD_ID, 0n, 0, "@everyone"),
            role(INCLUDE_ROLE_ID, 0n, 1, "cohort"),
            role(SHIELD_ROLE_ID, 0n, 2, "shield"),
            role(BOT_ROLE_ID, DISCORD_PERMISSIONS.KICK_MEMBERS, 10, "connector"),
          ],
        },
      }),
      pattern: /lacks MANAGE_GUILD/,
    },
    {
      configure: () => fixture({
        state: {
          protectedMember: member(PROTECTED_ID, [INCLUDE_ROLE_ID], "unshielded"),
        },
      }),
      pattern: /lacks an assigned role outside the prune cohort/,
    },
    {
      configure: () => fixture({
        state: {
          roles: [
            role(GUILD_ID, DISCORD_PERMISSIONS.KICK_MEMBERS, 0, "unsafe-everyone"),
            role(INCLUDE_ROLE_ID, 0n, 1, "cohort"),
            role(SHIELD_ROLE_ID, 0n, 2, "shield"),
            role(
              BOT_ROLE_ID,
              DISCORD_PERMISSIONS.KICK_MEMBERS | DISCORD_PERMISSIONS.MANAGE_GUILD,
              10,
              "connector",
            ),
          ],
        },
      }),
      pattern: /@everyone role carries protected permissions/,
    },
  ]

  for (const [index, scenario] of cases.entries()) {
    await context.test(String(index), async () => {
      await assert.rejects(
        () => scenario.configure().service.plan(scenario.input || request()),
        scenario.pattern,
      )
    })
  }
})

test("guild prune execution reserves, journals, dispatches once, and stores only content-free evidence", async () => {
  const { activities, events, operationStore, service, state } = fixture()
  const plan = await service.plan(request())

  const result = await service.execute(request(), plan.digest)

  assert.equal(state.writes, 1)
  assert.equal(result.status, "completed")
  assert.equal(result.actualPrunedCount, 3)
  assert.equal(result.verification, "match")
  assert.deepEqual(events, [
    "operation:reserve",
    "audit:pending",
    "write:guild-prune",
    "operation:completed",
    "audit:completed",
  ])
  assert.deepEqual(activities.map(({ status }) => status), ["pending", "completed"])
  const receipt = operationStore.receipts.get(
    `guild-prune\0${operationKeyHash(OPERATION_KEY)}`,
  )
  assert.equal(receipt?.resourceId, GUILD_ID)
  assert.equal(receipt?.verification, "match")
  const serialized = JSON.stringify({ activities, receipt, result })
  assert.doesNotMatch(serialized, new RegExp(OPERATION_KEY))
  assert.doesNotMatch(serialized, /Reviewed inactive-member cleanup|connector-bot|protected-user/)
  await assert.rejects(() => service.plan(request()), /operation key/)
})

test("guild prune zero estimate is a record-free no-op", async () => {
  const { activities, events, operationStore, service, state } = fixture({
    state: { estimate: 0, responsePruned: 0 },
  })
  const plan = await service.plan(request())

  const result = await service.execute(request(), plan.digest)

  assert.equal(plan.writeRequired, false)
  assert.equal(result.status, "noop")
  assert.equal(result.activityId, null)
  assert.equal(result.actualPrunedCount, 0)
  assert.equal(state.writes, 0)
  assert.deepEqual(activities, [])
  assert.deepEqual(events, [])
  assert.equal(operationStore.receipts.size, 0)
})

test("guild prune refuses changed fresh evidence before reservation or mutation", async () => {
  const { events, service, state } = fixture()
  const plan = await service.plan(request())
  state.estimate = 4

  await assert.rejects(
    () => service.execute(request(), plan.digest),
    GuildPrunePlanChangedError,
  )
  assert.equal(state.writes, 0)
  assert.deepEqual(events, [])
})

test("guild prune settles strict returned-count drift without exact-member claims", async () => {
  const { activities, operationStore, service } = fixture({
    state: { responsePruned: 2 },
  })
  const plan = await service.plan(request())

  const result = await service.execute(request(), plan.digest)

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.actualPrunedCount, 2)
  assert.equal(result.verification, "drift")
  const activity = activities.at(-1) as GuildPruneActivity
  assert.equal(activity.status, "completed-with-drift")
  assert.equal(activity.actualPrunedCount, 2)
  assert.equal(operationStore.receipts.get(
    `guild-prune\0${operationKeyHash(OPERATION_KEY)}`,
  )?.verification, "drift")
})

test("guild prune distinguishes known refusal from transport-ambiguous outcomes", async (context) => {
  const scenarios = [
    { error: apiError(400, 50_035), receipt: "failed", status: "failed" },
    { error: apiError(429), receipt: "uncertain", status: "uncertain" },
    { error: apiError(500), receipt: "uncertain", status: "uncertain" },
    { error: new TypeError("private transport details"), receipt: "uncertain", status: "uncertain" },
  ] as const

  for (const [index, scenario] of scenarios.entries()) {
    await context.test(String(index), async () => {
      const { activities, operationStore, service } = fixture({
        state: { dispatchError: scenario.error },
      })
      const plan = await service.plan(request())
      await assert.rejects(
        () => service.execute(request(), plan.digest),
        (error: GuildPruneExecutionError) => {
          assert.equal(
            (error.result as Record<string, unknown>).status,
            scenario.status,
          )
          return true
        },
      )
      assert.equal(activities.at(-1)?.status, scenario.status)
      assert.equal(operationStore.receipts.get(
        `guild-prune\0${operationKeyHash(OPERATION_KEY)}`,
      )?.status, scenario.receipt)
      assert.doesNotMatch(JSON.stringify(activities), /private transport details/)
    })
  }
})

test("guild prune blocks dispatch when pending activity cannot be recorded", async () => {
  const { events, operationStore, service, state } = fixture({
    state: { appendFailureAt: 1 },
  })
  const plan = await service.plan(request())

  await assert.rejects(
    () => service.execute(request(), plan.digest),
    /pending activity could not be recorded/,
  )
  assert.equal(state.writes, 0)
  assert.deepEqual(events, ["operation:reserve", "operation:failed"])
  assert.equal(operationStore.receipts.get(
    `guild-prune\0${operationKeyHash(OPERATION_KEY)}`,
  )?.status, "failed")
})

test("guild prune preserves settled Discord evidence when terminal local records fail", async (context) => {
  await context.test("terminal receipt", async () => {
    const { activities, operationStore, service, state } = fixture()
    const plan = await service.plan(request())
    operationStore.finishFailure = new Error("private receipt failure")

    await assert.rejects(
      () => service.execute(request(), plan.digest),
      (error: GuildPruneExecutionError) => {
        const result = error.result as Record<string, unknown>
        assert.equal(result.status, "completed-operation-record-failed")
        assert.equal(result.actualPrunedCount, 3)
        assert.equal(result.verification, "match")
        assert.doesNotMatch(JSON.stringify(result), /private receipt failure/)
        return true
      },
    )
    assert.equal(state.writes, 1)
    assert.deepEqual(activities.map(({ status }) => status), ["pending", "completed"])
    assert.equal(operationStore.receipts.get(
      `guild-prune\0${operationKeyHash(OPERATION_KEY)}`,
    )?.status, "pending")
  })

  await context.test("terminal activity", async () => {
    const { activities, operationStore, service, state } = fixture({
      state: { appendFailureAt: 2 },
    })
    const plan = await service.plan(request())

    await assert.rejects(
      () => service.execute(request(), plan.digest),
      (error: GuildPruneExecutionError) => {
        const result = error.result as Record<string, unknown>
        assert.equal(result.status, "completed-audit-failed")
        assert.equal(result.actualPrunedCount, 3)
        assert.equal(result.verification, "match")
        assert.doesNotMatch(JSON.stringify(result), /activity unavailable/)
        return true
      },
    )
    assert.equal(state.writes, 1)
    assert.deepEqual(activities.map(({ status }) => status), ["pending"])
    assert.equal(operationStore.receipts.get(
      `guild-prune\0${operationKeyHash(OPERATION_KEY)}`,
    )?.status, "completed")
  })
})

test("guild prune execution requires its independent change capability", async () => {
  const { service } = fixture({ policy: policy({ execute: false }) })
  const plan = await service.plan(request())

  await assert.rejects(
    () => service.execute(request(), plan.digest),
    /guild prunes are disabled/,
  )
})
