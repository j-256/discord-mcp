import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  AdministrationService,
  normalizeMemberModerationRequest,
  type AdministrationServiceOptions,
  type MemberModerationRequest,
} from "../src/administration-service.js"
import { DiscordApiError } from "../src/errors.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordBan,
  DiscordGuildMember,
  DiscordRole,
  DiscordUser,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const TARGET_ID = "300000000000000001"
const OWNER_ID = "400000000000000001"
const BOT_ROLE_ID = "500000000000000001"
const TARGET_ROLE_ID = "500000000000000002"
const HIGH_TARGET_ROLE_ID = "500000000000000003"
const AUDIT_REASON = "Reviewed safety incident 42"
const NOW = "2026-08-19T00:00:00.000Z"

function user(id: string, username: string, bot = false): DiscordUser {
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

function policy(options: {
  enabled?: boolean
  protectedUserIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set([GUILD_ID]),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: options.enabled ?? true,
    allowDeletions: false,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(options.protectedUserIds || []),
  })
}

function notFound(route: string): DiscordApiError {
  return new DiscordApiError({
    message: `Discord API GET ${route} returned 404: Unknown resource`,
    method: "GET",
    route,
    status: 404,
  })
}

interface FixtureState {
  appendFailureAt: number | null
  ban: DiscordBan | undefined
  botMember: DiscordGuildMember
  guildId: string
  guildOwnerId: string
  now: Date
  roles: DiscordRole[]
  targetMember: DiscordGuildMember | undefined
  targetUser: DiscordUser
  timeoutResponse: DiscordGuildMember | undefined
  writeError: unknown
}

function fixture(options: {
  planKey?: Uint8Array
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.KICK_MEMBERS
    | DISCORD_PERMISSIONS.BAN_MEMBERS
    | DISCORD_PERMISSIONS.MODERATE_MEMBERS
  const state: FixtureState = {
    appendFailureAt: null,
    ban: undefined,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: user(BOT_ID, "connector-bot", true),
    },
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    now: new Date(NOW),
    roles: [
      role(GUILD_ID, 0n, 0, "@everyone"),
      role(BOT_ROLE_ID, permissions, 10, "connector-role"),
      role(TARGET_ROLE_ID, 0n, 1, "member-role"),
      role(HIGH_TARGET_ROLE_ID, 0n, 9, "elevated-member-role"),
    ],
    targetMember: {
      communication_disabled_until: null,
      nick: "target nick",
      roles: [TARGET_ROLE_ID],
      user: user(TARGET_ID, "target-user"),
    },
    targetUser: user(TARGET_ID, "target-user"),
    timeoutResponse: undefined,
    writeError: undefined,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let appendCalls = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      appendCalls += 1
      if (state.appendFailureAt === appendCalls) {
        throw new Error("activity unavailable")
      }
      activities.push(entry)
      events.push(`audit:${entry.status}`)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: AdministrationServiceOptions["client"] = {
    async createGuildBan() {
      events.push("write:ban")
      if (state.writeError) throw state.writeError
    },
    async getGuild(_guildId) {
      return { id: state.guildId, name: "guild", owner_id: state.guildOwnerId }
    },
    async getGuildBan(guildId, userId) {
      if (!state.ban) throw notFound(`/guilds/${guildId}/bans/${userId}`)
      return state.ban
    },
    async getGuildMember(guildId, userId) {
      if (userId === BOT_ID) return state.botMember
      if (!state.targetMember) {
        throw notFound(`/guilds/${guildId}/members/${userId}`)
      }
      return state.targetMember
    },
    async getGuildRoles() {
      return state.roles
    },
    async getUser() {
      return state.targetUser
    },
    async modifyGuildMemberTimeout(_guildId, userId, input) {
      events.push("write:timeout")
      if (state.writeError) throw state.writeError
      return state.timeoutResponse || {
        communication_disabled_until: input.communicationDisabledUntil,
        roles: state.targetMember?.roles || [],
        user: user(userId, "target-user"),
      }
    },
    async removeGuildBan() {
      events.push("write:unban")
      if (state.writeError) throw state.writeError
    },
    async removeGuildMember() {
      events.push("write:kick")
      if (state.writeError) throw state.writeError
    },
  }
  const service = new AdministrationService({
    activityStore,
    client,
    clock: () => new Date(state.now),
    planKey: options.planKey || new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    randomId: () => "activity-1",
  })
  return { activities, events, service, state }
}

function request(
  action: MemberModerationRequest["action"] = "kick",
): MemberModerationRequest {
  return {
    action,
    auditReason: AUDIT_REASON,
    ...(action === "ban" ? { deleteMessageSeconds: 3_600 } : {}),
    ...(action === "timeout" ? { durationMinutes: 60 } : {}),
    guildId: GUILD_ID,
    userId: TARGET_ID,
  }
}

test("member moderation normalization enforces exact action parameters and encoded reason bounds", () => {
  assert.deepEqual(normalizeMemberModerationRequest({
    action: "ban",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    userId: TARGET_ID,
  }), {
    action: "ban",
    auditReason: AUDIT_REASON,
    deleteMessageSeconds: 0,
    durationMinutes: null,
    guildId: GUILD_ID,
    userId: TARGET_ID,
  })
  assert.throws(
    () => normalizeMemberModerationRequest({
      ...request("timeout"),
      durationMinutes: 40_320,
    }),
    /between 1 and 40319/,
  )
  assert.throws(
    () => normalizeMemberModerationRequest({
      ...request("kick"),
      deleteMessageSeconds: 0,
    }),
    /does not accept action parameters/,
  )
  assert.throws(
    () => normalizeMemberModerationRequest({
      ...request("kick"),
      auditReason: "é".repeat(200),
    }),
    /URL-encoded characters/,
  )
})

test("member moderation plans are deterministic, keyed, and exclude mutable display names", async () => {
  const { service, state } = fixture()
  const first = await service.plan(BOT_ID, request("kick"))
  state.targetUser.username = "changed-outside-member"
  if (state.targetMember?.user) state.targetMember.user.username = "changed-display"
  const second = await service.plan(BOT_ID, request("kick"))
  state.roles[3] = role(HIGH_TARGET_ROLE_ID, 0n, 8, "unrelated-role-changed")
  const unrelatedRoleChange = await service.plan(BOT_ID, request("kick"))
  const changedReason = await service.plan(BOT_ID, {
    ...request("kick"),
    auditReason: "Different reviewed reason",
  })
  const other = fixture({ planKey: new Uint8Array(32).fill(8) }).service

  assert.equal(first.digest, second.digest)
  assert.equal(first.digest, unrelatedRoleChange.digest)
  assert.equal(second.target.username, "changed-display")
  assert.notEqual(first.digest, changedReason.digest)
  assert.equal(first.target.id, TARGET_ID)
  assert.equal(first.auditReason, AUDIT_REASON)
  assert.equal(first.permission.required, "KICK_MEMBERS")
  assert.equal(first.permission.botHighestRolePosition, 10)
  assert.notEqual(first.digest, (await other.plan(BOT_ID, request("kick"))).digest)
})

test("member moderation rejects disabled scope, protected IDs, self-targeting, and the guild owner", async () => {
  await assert.rejects(
    () => fixture({ policy: policy({ enabled: false }) }).service.plan(
      BOT_ID,
      request("kick"),
    ),
    /administration is disabled/,
  )
  await assert.rejects(
    () => fixture({
      policy: policy({ protectedUserIds: [TARGET_ID] }),
    }).service.plan(BOT_ID, request("kick")),
    /protected from administration/,
  )
  await assert.rejects(
    () => fixture().service.plan(BOT_ID, {
      ...request("kick"),
      userId: BOT_ID,
    }),
    /cannot moderate itself/,
  )
  await assert.rejects(
    () => fixture().service.plan(BOT_ID, {
      ...request("kick"),
      userId: OWNER_ID,
    }),
    /guild owner cannot be moderated/,
  )
})

test("member moderation rejects mismatched Discord guild, member, ban, and user identities", async () => {
  const mismatchedGuild = fixture({
    state: { guildId: "999999999999999999" },
  })
  await assert.rejects(
    () => mismatchedGuild.service.plan(BOT_ID, request("kick")),
    /mismatched guild evidence/,
  )

  const mismatchedBot = fixture({
    state: {
      botMember: {
        roles: [BOT_ROLE_ID],
        user: user("999999999999999999", "wrong-bot", true),
      },
    },
  })
  await assert.rejects(
    () => mismatchedBot.service.plan(BOT_ID, request("kick")),
    /different connector bot member/,
  )

  const mismatchedTarget = fixture({
    state: {
      targetMember: {
        roles: [TARGET_ROLE_ID],
        user: user("999999999999999999", "wrong-target"),
      },
    },
  })
  await assert.rejects(
    () => mismatchedTarget.service.plan(BOT_ID, request("kick")),
    /different target member/,
  )

  const mismatchedBan = fixture({
    state: { ban: { user: user("999999999999999999", "wrong-ban") } },
  })
  await assert.rejects(
    () => mismatchedBan.service.plan(BOT_ID, request("unban")),
    /different guild ban/,
  )

  const mismatchedUser = fixture({
    state: {
      targetMember: undefined,
      targetUser: user("999999999999999999", "wrong-user"),
    },
  })
  await assert.rejects(
    () => mismatchedUser.service.plan(BOT_ID, request("ban")),
    /different user/,
  )
})

test("member moderation fails closed on permission, hierarchy, and role evidence", async () => {
  const missingPermission = fixture()
  missingPermission.state.roles[1] = role(BOT_ROLE_ID, 0n, 10, "connector-role")
  await assert.rejects(
    () => missingPermission.service.plan(BOT_ID, request("kick")),
    /lacks KICK_MEMBERS/,
  )

  const hierarchy = fixture()
  hierarchy.state.roles[2] = role(TARGET_ROLE_ID, 0n, 10, "member-role")
  await assert.rejects(
    () => hierarchy.service.plan(BOT_ID, request("kick")),
    /highest role is not above/,
  )

  const incomplete = fixture()
  incomplete.state.targetMember = {
    ...incomplete.state.targetMember as DiscordGuildMember,
    roles: ["999999999999999999"],
  }
  await assert.rejects(
    () => incomplete.service.plan(BOT_ID, request("kick")),
    /permission evidence is incomplete/,
  )

  const administrator = fixture()
  administrator.state.roles[2] = role(
    TARGET_ROLE_ID,
    DISCORD_PERMISSIONS.ADMINISTRATOR,
    1,
    "member-role",
  )
  await assert.rejects(
    () => administrator.service.plan(BOT_ID, request("timeout")),
    /administrators cannot be timed out/,
  )
})

test("member moderation enforces action-specific member, ban, and timeout state", async () => {
  const absent = fixture({ state: { targetMember: undefined } })
  await assert.rejects(
    () => absent.service.plan(BOT_ID, request("kick")),
    /requires a current guild member/,
  )
  const nonMemberBan = await absent.service.plan(BOT_ID, request("ban"))
  assert.equal(nonMemberBan.target.membership, "non-member")

  const alreadyBanned = fixture({
    state: { ban: { user: user(TARGET_ID, "banned-user") } },
  })
  await assert.rejects(
    () => alreadyBanned.service.plan(BOT_ID, request("ban")),
    /already banned/,
  )

  const noBan = fixture()
  await assert.rejects(
    () => noBan.service.plan(BOT_ID, request("unban")),
    /requires an existing guild ban/,
  )
  const unban = await alreadyBanned.service.plan(BOT_ID, request("unban"))
  assert.equal(unban.target.banState, "banned")
  assert.equal(unban.target.username, "banned-user")

  await assert.rejects(
    () => fixture().service.plan(BOT_ID, request("remove-timeout")),
    /requires a currently active timeout/,
  )
  const timedOut = fixture()
  if (timedOut.state.targetMember) {
    timedOut.state.targetMember.communication_disabled_until = "2026-08-20T00:00:00.000Z"
  }
  const removal = await timedOut.service.plan(BOT_ID, request("remove-timeout"))
  assert.equal(removal.target.currentTimeoutUntil, "2026-08-20T00:00:00.000Z")
})

test("member moderation execution journals pending before writing and persists no reason or profile data", async () => {
  const { activities, events, service } = fixture()
  const reviewed = await service.plan(BOT_ID, request("kick"))

  const result = await service.execute(BOT_ID, request("kick"), reviewed.digest)

  assert.equal(result.status, "completed")
  assert.deepEqual(events, ["audit:pending", "write:kick", "audit:completed"])
  assert.deepEqual(activities.map((entry) => entry.status), ["pending", "completed"])
  const serialized = JSON.stringify(activities)
  assert.doesNotMatch(serialized, /Reviewed safety|target-user|target nick|member-role/)
  assert.match(serialized, new RegExp(TARGET_ID))
})

test("member moderation dispatches every reviewed action through the same audit workflow", async () => {
  const cases: Array<{
    action: MemberModerationRequest["action"]
    expectedWrite: string
    prepare?: (state: FixtureState) => void
  }> = [
    { action: "ban", expectedWrite: "write:ban" },
    {
      action: "remove-timeout",
      expectedWrite: "write:timeout",
      prepare(state) {
        if (state.targetMember) {
          state.targetMember.communication_disabled_until = "2026-08-20T00:00:00.000Z"
        }
      },
    },
    {
      action: "unban",
      expectedWrite: "write:unban",
      prepare(state) {
        state.ban = { user: user(TARGET_ID, "banned-user") }
      },
    },
  ]

  for (const entry of cases) {
    const fixtureData = fixture()
    entry.prepare?.(fixtureData.state)
    const actionRequest = request(entry.action)
    const reviewed = await fixtureData.service.plan(BOT_ID, actionRequest)
    const result = await fixtureData.service.execute(
      BOT_ID,
      actionRequest,
      reviewed.digest,
    )

    assert.equal(result.action, entry.action)
    assert.deepEqual(fixtureData.events, [
      "audit:pending",
      entry.expectedWrite,
      "audit:completed",
    ])
  }
})

test("member moderation refuses changed plans before journaling or writing", async () => {
  const { activities, events, service, state } = fixture()
  const reviewed = await service.plan(BOT_ID, request("kick"))
  state.targetMember = {
    ...state.targetMember as DiscordGuildMember,
    roles: [HIGH_TARGET_ROLE_ID],
  }

  await assert.rejects(
    () => service.execute(BOT_ID, request("kick"), reviewed.digest),
    (error: unknown) => (
      error instanceof Error
      && error.name === "AdministrationPlanChangedError"
    ),
  )
  assert.deepEqual(events, [])
  assert.deepEqual(activities, [])
})

test("member moderation blocks the write when pending audit journaling fails", async () => {
  const fixtureData = fixture()
  const reviewed = await fixtureData.service.plan(BOT_ID, request("kick"))
  fixtureData.state.appendFailureAt = 1

  await assert.rejects(
    () => fixtureData.service.execute(BOT_ID, request("kick"), reviewed.digest),
    /activity unavailable/,
  )
  assert.deepEqual(fixtureData.events, [])
})

test("member moderation distinguishes known Discord rejection from uncertain outcomes", async () => {
  const known = fixture()
  const knownPlan = await known.service.plan(BOT_ID, request("kick"))
  known.state.writeError = new DiscordApiError({
    code: 50013,
    message: "Missing Permissions with private detail",
    method: "DELETE",
    route: `/guilds/${GUILD_ID}/members/${TARGET_ID}`,
    status: 403,
  })
  await assert.rejects(
    () => known.service.execute(BOT_ID, request("kick"), knownPlan.digest),
    (error: unknown) => {
      assert.equal(error instanceof Error && error.name, "AdministrationExecutionError")
      const result = (error as { result: { error: string; status: string } }).result
      assert.equal(result.status, "failed")
      assert.equal(result.error, "DiscordApiError status=403 code=50013")
      return true
    },
  )
  assert.equal(known.activities.at(-1)?.status, "failed")
  assert.doesNotMatch(JSON.stringify(known.activities), /private detail/)

  const uncertain = fixture()
  const uncertainPlan = await uncertain.service.plan(BOT_ID, request("kick"))
  uncertain.state.writeError = new Error("socket closed after request")
  await assert.rejects(
    () => uncertain.service.execute(
      BOT_ID,
      request("kick"),
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      const result = (error as { result: { status: string } }).result
      assert.equal(result.status, "uncertain")
      return true
    },
  )
  assert.equal(uncertain.activities.at(-1)?.status, "uncertain")

  const limited = fixture()
  const limitedPlan = await limited.service.plan(BOT_ID, request("kick"))
  limited.state.writeError = new DiscordApiError({
    message: "Rate limited",
    method: "DELETE",
    retryAfterMs: 1_500,
    route: `/guilds/${GUILD_ID}/members/${TARGET_ID}`,
    status: 429,
  })
  await assert.rejects(
    () => limited.service.execute(BOT_ID, request("kick"), limitedPlan.digest),
    (error: unknown) => {
      const result = (error as {
        result: { retryAfterMs: number | null; status: string }
      }).result
      assert.equal(result.status, "failed")
      assert.equal(result.retryAfterMs, 1_500)
      return true
    },
  )
})

test("timeout execution uses the final clock and validates the returned exact member state", async () => {
  const { service, state } = fixture()
  const reviewed = await service.plan(BOT_ID, request("timeout"))
  assert.equal(reviewed.parameters.estimatedTimeoutUntil, "2026-08-19T01:00:00.000Z")
  state.now = new Date("2026-08-19T00:05:00.000Z")

  const result = await service.execute(BOT_ID, request("timeout"), reviewed.digest)

  assert.equal(result.timeoutUntil, "2026-08-19T01:05:00.000Z")

  const mismatch = fixture()
  const mismatchPlan = await mismatch.service.plan(BOT_ID, request("timeout"))
  mismatch.state.timeoutResponse = {
    communication_disabled_until: "2026-08-19T01:00:00.000Z",
    roles: [],
    user: user("999999999999999999", "wrong-user"),
  }
  await assert.rejects(
    () => mismatch.service.execute(
      BOT_ID,
      request("timeout"),
      mismatchPlan.digest,
    ),
    (error: unknown) => {
      const result = (error as { result: { status: string } }).result
      assert.equal(result.status, "uncertain")
      return true
    },
  )
})

test("member moderation reports a successful write whose terminal audit append fails", async () => {
  const fixtureData = fixture()
  const reviewed = await fixtureData.service.plan(BOT_ID, request("kick"))
  fixtureData.state.appendFailureAt = 2

  await assert.rejects(
    () => fixtureData.service.execute(
      BOT_ID,
      request("kick"),
      reviewed.digest,
    ),
    (error: unknown) => {
      const result = (error as { result: { status: string } }).result
      assert.equal(result.status, "completed-audit-failed")
      return true
    },
  )
  assert.deepEqual(fixtureData.events, ["audit:pending", "write:kick"])
})
