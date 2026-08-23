import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type { DiscordGuildMemberNicknameUpdate } from "../src/discord-client.js"
import {
  DiscordApiError,
  MemberNicknameExecutionError,
  MemberNicknameOperationConflictError,
  MemberNicknamePlanChangedError,
} from "../src/errors.js"
import {
  MemberNicknameService,
  normalizeMemberNicknameChangeRequest,
  type MemberNicknameChangeRequest,
  type MemberNicknameServiceOptions,
} from "../src/member-nickname-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
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
const OPERATION_KEY = "member-nickname-operation-0001"
const AUDIT_REASON = "Reviewed nickname support change"
const NOW = "2026-08-23T12:00:00.000Z"

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

function currentBotRequest(
  overrides: Partial<MemberNicknameChangeRequest> = {},
): MemberNicknameChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    nickname: "Reviewed Connector",
    operationKey: OPERATION_KEY,
    target: { kind: "current-bot" },
    ...overrides,
  }
}

function memberRequest(
  overrides: Partial<MemberNicknameChangeRequest> = {},
): MemberNicknameChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    nickname: "Reviewed Member",
    operationKey: OPERATION_KEY,
    target: { kind: "member", userId: USER_ID },
    ...overrides,
  }
}

function policy(options: {
  allowChanges?: boolean
  allowOther?: boolean
  guilds?: readonly string[]
  protectedUsers?: readonly string[]
} = {}): ScopePolicy {
  const guilds = options.guilds ?? [GUILD_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(guilds),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowNicknameChanges: options.allowChanges ?? true,
    allowOtherMemberNicknameChanges: options.allowOther ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    nicknameGuildIds: new Set(guilds),
    protectedUserIds: new Set(options.protectedUsers ?? []),
  })
}

class MemoryOperationStore implements OperationStore {
  readonly events: string[]
  finishFailureAt: number | null = null
  finishCalls = 0
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailureAt === this.finishCalls) {
      throw new Error("operation store unavailable")
    }
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
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  guildName: string
  mutationError: unknown
  ownerId: string
  readbackError: unknown
  readbackNickname: string | null | undefined
  responseOverride: DiscordGuildMemberNicknameUpdate | null
  roles: DiscordRole[]
  targetMember: DiscordGuildMember
}

function discordError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: "Discord request failed",
    method: "PATCH",
    route: "/guilds/{guild.id}/members/{user.id}",
    status,
  })
}

function fixture(options: {
  planKey?: Uint8Array
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const botPermissions = DISCORD_PERMISSIONS.CHANGE_NICKNAME
    | DISCORD_PERMISSIONS.MANAGE_NICKNAMES
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      nick: "Connector Before",
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector-user" },
    },
    guildName: "Private Guild Name",
    mutationError: undefined,
    ownerId: OWNER_ID,
    readbackError: undefined,
    readbackNickname: undefined,
    responseOverride: null,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(USER_ROLE_ID, 0n, 2),
      role(BOT_ROLE_ID, botPermissions, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
    targetMember: {
      nick: "Member Before",
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
    ...options.state,
  }
  const events: string[] = []
  const activities: ActivityEntry[] = []
  let activityCalls = 0
  let mutations = 0
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
  const client: MemberNicknameServiceOptions["client"] = {
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: state.guildName, owner_id: state.ownerId }
    },
    async getGuildMember(_guildId, userId) {
      events.push(`read:member:${userId}`)
      if (mutations > 0 && state.readbackError) throw state.readbackError
      const member = userId === BOT_ID ? state.botMember : state.targetMember
      if (mutations > 0 && state.readbackNickname !== undefined) {
        return { ...member, nick: state.readbackNickname }
      }
      return member
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async modifyCurrentMemberNickname(_guildId, userId, nickname) {
      mutations += 1
      events.push("write:current-bot")
      if (state.mutationError) throw state.mutationError
      state.botMember = { ...state.botMember, nick: nickname }
      return state.responseOverride || { nickname, userId }
    },
    async modifyGuildMemberNickname(_guildId, userId, nickname) {
      mutations += 1
      events.push("write:member")
      if (state.mutationError) throw state.mutationError
      state.targetMember = { ...state.targetMember, nick: nickname }
      return state.responseOverride || { nickname, userId }
    },
  }
  const service = new MemberNicknameService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: options.planKey || new Uint8Array(32).fill(17),
    policy: options.policy || policy(),
    randomId: () => "member-nickname-activity-0001",
  })
  return {
    activities,
    events,
    get mutations() {
      return mutations
    },
    operationStore,
    service,
    state,
  }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof MemberNicknameExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("member nickname normalization enforces exact target and clearing semantics", () => {
  const self = normalizeMemberNicknameChangeRequest(currentBotRequest({ nickname: null }))
  assert.equal(self.nickname, null)
  assert.deepEqual(self.target, { kind: "current-bot" })
  assert.match(self.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)

  const member = normalizeMemberNicknameChangeRequest(memberRequest())
  assert.deepEqual(member.target, { kind: "member", userId: USER_ID })

  for (const nickname of [
    "",
    "x".repeat(33),
    " leading",
    "trailing ",
    "two  spaces",
    "line\nbreak",
    "zero\u200bwidth",
    "\ud800",
  ]) {
    assert.throws(
      () => normalizeMemberNicknameChangeRequest(currentBotRequest({ nickname })),
      /nickname/u,
    )
  }
  assert.throws(
    () => normalizeMemberNicknameChangeRequest({
      ...currentBotRequest(),
      target: { kind: "current-bot", userId: USER_ID },
    } as unknown as MemberNicknameChangeRequest),
    /accepts only its kind/u,
  )
  assert.throws(
    () => normalizeMemberNicknameChangeRequest({
      ...memberRequest(),
      target: { kind: "member" },
    } as MemberNicknameChangeRequest),
    /exact user snowflake/u,
  )
  assert.throws(
    () => normalizeMemberNicknameChangeRequest({
      ...memberRequest(),
      extra: true,
    } as unknown as MemberNicknameChangeRequest),
    /unsupported fields/u,
  )
})

test("member nickname normalization counts Unicode scalar values", () => {
  const nickname = "😀".repeat(32)
  assert.equal(
    normalizeMemberNicknameChangeRequest(currentBotRequest({ nickname })).nickname,
    nickname,
  )
  assert.throws(
    () => normalizeMemberNicknameChangeRequest(currentBotRequest({
      nickname: `${nickname}😀`,
    })),
    /nickname/u,
  )
})

test("current-bot plans use the narrow permission path without hierarchy", async () => {
  const target = fixture({ state: {
    roles: [
      role(GUILD_ID, 0n, 0),
      role(USER_ROLE_ID, 0n, 2),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.CHANGE_NICKNAME, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
  } })
  const plan = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    currentBotRequest(),
  )

  assert.equal(plan.target.kind, "current-bot")
  assert.equal(plan.target.id, BOT_ID)
  assert.equal(plan.target.currentNickname, "Connector Before")
  assert.equal(plan.desiredNickname, "Reviewed Connector")
  assert.equal(plan.permission.requiredPermission, "CHANGE_NICKNAME")
  assert.equal(plan.hierarchy, null)
  assert.equal(plan.writeRequired, true)
  assert.equal(plan.privacy.persistence, "content-free-outcomes-only")
  assert.equal(
    target.events.filter((entry) => entry === `read:member:${USER_ID}`).length,
    0,
  )
})

test("other-member plans require the broader gate and strict identity boundary", async () => {
  await assert.rejects(
    fixture({ policy: policy({ allowOther: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      memberRequest(),
    ),
    /other-member nickname changes are disabled/u,
  )
  await assert.rejects(
    fixture({ policy: policy({ protectedUsers: [USER_ID] }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      memberRequest(),
    ),
    /protected/u,
  )
  await assert.rejects(
    fixture().service.plan(
      APPLICATION_ID,
      BOT_ID,
      memberRequest({ target: { kind: "member", userId: BOT_ID } }),
    ),
    /must use the current-bot target/u,
  )
})

test("other-member plans enforce permission, owner, pending, administrator, and hierarchy", async () => {
  const cases: Array<{
    pattern: RegExp
    state: Partial<FixtureState>
  }> = [
    {
      pattern: /MANAGE_NICKNAMES/u,
      state: {
        roles: [
          role(GUILD_ID, 0n, 0),
          role(USER_ROLE_ID, 0n, 2),
          role(BOT_ROLE_ID, DISCORD_PERMISSIONS.CHANGE_NICKNAME, 10, {
            managed: true,
            tags: { bot_id: BOT_ID },
          }),
        ],
      },
    },
    { pattern: /guild owner/u, state: { ownerId: USER_ID } },
    {
      pattern: /pending member/u,
      state: { targetMember: { pending: true, roles: [USER_ROLE_ID], user: { id: USER_ID, username: "target-user" } } },
    },
    {
      pattern: /administrator/u,
      state: {
        roles: [
          role(GUILD_ID, 0n, 0),
          role(USER_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 2),
          role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_NICKNAMES, 10, {
            managed: true,
            tags: { bot_id: BOT_ID },
          }),
        ],
      },
    },
    {
      pattern: /strictly below/u,
      state: {
        roles: [
          role(GUILD_ID, 0n, 0),
          role(USER_ROLE_ID, 0n, 10),
          role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_NICKNAMES, 10, {
            managed: true,
            tags: { bot_id: BOT_ID },
          }),
        ],
      },
    },
  ]
  for (const entry of cases) {
    await assert.rejects(
      fixture({ state: entry.state }).service.plan(
        APPLICATION_ID,
        BOT_ID,
        memberRequest(),
      ),
      entry.pattern,
    )
  }
})

test("other-member plan binds complete permission and hierarchy evidence", async () => {
  const target = fixture()
  const plan = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    memberRequest(),
  )

  assert.equal(plan.target.id, USER_ID)
  assert.equal(plan.permission.requiredPermission, "MANAGE_NICKNAMES")
  assert.equal(plan.hierarchy?.targetBelowBot, true)
  assert.equal(plan.hierarchy?.botHighestRolePosition, 10)
  assert.equal(plan.hierarchy?.targetHighestRolePosition, 2)
})

test("member nickname plans fail closed on mismatched or incomplete evidence", async () => {
  const mismatched = fixture()
  mismatched.state.targetMember = {
    roles: [USER_ROLE_ID],
    user: { id: OWNER_ID, username: "wrong-user" },
  }
  await assert.rejects(
    mismatched.service.plan(APPLICATION_ID, BOT_ID, memberRequest()),
    /mismatched target-member/u,
  )

  const unknownRole = fixture()
  unknownRole.state.targetMember.roles = ["999999999999999999"]
  await assert.rejects(
    unknownRole.service.plan(APPLICATION_ID, BOT_ID, memberRequest()),
    /unknown role/u,
  )

  const duplicateRole = fixture()
  duplicateRole.state.roles.push(duplicateRole.state.roles[0] as DiscordRole)
  await assert.rejects(
    duplicateRole.service.plan(APPLICATION_ID, BOT_ID, memberRequest()),
    /role evidence is invalid/u,
  )
})

test("member nickname digest changes with intent and authorization evidence", async () => {
  const target = fixture()
  const first = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    memberRequest(),
  )
  const changedIntent = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    memberRequest({ nickname: "Another Member" }),
  )
  target.state.roles = target.state.roles.map((entry) => (
    entry.id === BOT_ROLE_ID ? { ...entry, position: 11 } : entry
  ))
  const changedHierarchy = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    memberRequest(),
  )

  assert.notEqual(first.digest, changedIntent.digest)
  assert.notEqual(first.digest, changedHierarchy.digest)
})

test("already-current nickname execution consumes no key and writes no records", async () => {
  const target = fixture()
  const request = currentBotRequest({ nickname: "Connector Before" })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(result.verification, "not-required")
  assert.equal(target.mutations, 0)
  assert.equal(target.activities.length, 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

test("current-bot nickname execution records pending state before one write", async () => {
  const target = fixture()
  const request = currentBotRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  target.events.length = 0
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.observedNickname, "Reviewed Connector")
  assert.equal(result.verification, "match")
  assert.equal(target.mutations, 1)
  assert.ok(
    target.events.indexOf("activity:pending")
      < target.events.indexOf("write:current-bot"),
  )
  assert.equal(target.activities[0]?.kind, "member-nickname-change")
  assert.equal(target.activities.at(-1)?.status, "completed")
  const durable = JSON.stringify({
    activities: target.activities,
    receipts: [...target.operationStore.receipts.values()],
  })
  assert.doesNotMatch(
    durable,
    /Connector Before|Reviewed Connector|Reviewed nickname support change|member-nickname-operation-0001/u,
  )
})

test("other-member execution uses the exact member route and supports explicit clearing", async () => {
  const target = fixture()
  const request = memberRequest({ nickname: null })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.observedNickname, null)
  assert.equal(result.targetKind, "member")
  assert.equal(target.events.includes("write:member"), true)
  assert.equal(target.events.includes("write:current-bot"), false)
})

test("valid nickname response and readback drift completes with drift", async () => {
  const target = fixture({ state: {
    readbackNickname: "Concurrent Name",
    responseOverride: { nickname: "Server Normalized", userId: BOT_ID },
  } })
  const request = currentBotRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.observedNickname, "Concurrent Name")
  assert.equal(result.verification, "drift")
  assert.equal(target.activities.at(-1)?.status, "completed-with-drift")
})

test("known pre-response 4xx is failed while rate limits and readback failures are uncertain", async () => {
  const refused = fixture({ state: { mutationError: discordError(403, 50013) } })
  const refusedRequest = memberRequest()
  const refusedPlan = await refused.service.plan(
    APPLICATION_ID,
    BOT_ID,
    refusedRequest,
  )
  await assert.rejects(
    refused.service.execute(
      APPLICATION_ID,
      BOT_ID,
      refusedRequest,
      refusedPlan.digest,
    ),
    (error: unknown) => executionResult(error).status === "failed",
  )
  assert.equal(refused.activities.at(-1)?.status, "failed")

  const rateLimited = fixture({ state: { mutationError: discordError(429) } })
  const rateRequest = memberRequest()
  const ratePlan = await rateLimited.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rateRequest,
  )
  await assert.rejects(
    rateLimited.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rateRequest,
      ratePlan.digest,
    ),
    (error: unknown) => executionResult(error).status === "uncertain",
  )

  const readback = fixture({ state: { readbackError: new Error("offline") } })
  const readbackRequest = currentBotRequest()
  const readbackPlan = await readback.service.plan(
    APPLICATION_ID,
    BOT_ID,
    readbackRequest,
  )
  await assert.rejects(
    readback.service.execute(
      APPLICATION_ID,
      BOT_ID,
      readbackRequest,
      readbackPlan.digest,
    ),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
})

test("fresh member nickname evidence must match the reviewed digest", async () => {
  const target = fixture()
  const request = memberRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  target.state.targetMember = {
    ...target.state.targetMember,
    nick: "Changed Before Execution",
  }

  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    MemberNicknamePlanChangedError,
  )
  assert.equal(target.mutations, 0)
})

test("member nickname execution rejects malformed digests and unavailable fresh evidence", async () => {
  const target = fixture()
  const request = memberRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)

  assert.throws(
    () => target.service.execute(APPLICATION_ID, BOT_ID, request, "invalid"),
    /plan digest is invalid/u,
  )
  target.state.targetMember = {
    ...target.state.targetMember,
    user: { id: OWNER_ID, username: "mismatched-user" },
  }
  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof MemberNicknamePlanChangedError
      && error.actualDigest === "member-nickname-state-unavailable"
    ),
  )
  assert.equal(target.mutations, 0)
})

test("member nickname execution quarantines mismatched response identity", async () => {
  const target = fixture({ state: {
    responseOverride: { nickname: "Reviewed Connector", userId: USER_ID },
  } })
  const request = currentBotRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  assert.equal(target.activities.at(-1)?.status, "uncertain")
})

test("member nickname operation keys are one-shot", async () => {
  const target = fixture()
  const request = memberRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  await target.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)

  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, request),
    MemberNicknameOperationConflictError,
  )
})

test("uncertain nickname outcomes quarantine later same-member changes", async () => {
  const target = fixture({ state: { mutationError: new Error("network lost") } })
  const first = memberRequest()
  const firstPlan = await target.service.plan(APPLICATION_ID, BOT_ID, first)
  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      first,
      firstPlan.digest,
    ),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  target.state.mutationError = undefined
  const second = memberRequest({
    nickname: "Second Intent",
    operationKey: "member-nickname-operation-0002",
  })
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, second)
  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      second,
      secondPlan.digest,
    ),
    (error: unknown) => (
      executionResult(error).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(target.mutations, 1)
})

test("pending activity failure blocks nickname dispatch and spends the key", async () => {
  const target = fixture({ state: { activityFailureAt: 1 } })
  const request = currentBotRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(target.mutations, 0)
  assert.equal(
    [...target.operationStore.receipts.values()][0]?.status,
    "failed",
  )
})

test("completed nickname execution surfaces durable receipt failure without exposing names", async () => {
  const target = fixture()
  target.operationStore.finishFailureAt = 1
  const request = currentBotRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => {
      const result = executionResult(error)
      assert.equal(result.status, "completed-operation-record-failed")
      assert.doesNotMatch(JSON.stringify(result), /Reviewed Connector|Connector Before/u)
      return true
    },
  )
  assert.equal(target.activities.at(-1)?.status, "uncertain")
})

test("completed nickname execution preserves the receipt when final activity fails", async () => {
  const target = fixture({ state: { activityFailureAt: 2 } })
  const request = currentBotRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => {
      const result = executionResult(error)
      assert.equal(result.status, "completed-audit-failed")
      assert.equal(result.verification, "match")
      assert.doesNotMatch(JSON.stringify(result), /Reviewed Connector|Connector Before/u)
      return true
    },
  )
  assert.equal(
    [...target.operationStore.receipts.values()][0]?.status,
    "completed",
  )
})
