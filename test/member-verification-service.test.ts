import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type { DiscordGuildMemberVerificationUpdate } from "../src/discord-client.js"
import {
  DiscordApiError,
  MemberVerificationExecutionError,
  MemberVerificationOperationConflictError,
  MemberVerificationPlanChangedError,
} from "../src/errors.js"
import {
  MemberVerificationService,
  normalizeMemberVerificationChangeRequest,
  type MemberVerificationChangeRequest,
  type MemberVerificationServiceOptions,
} from "../src/member-verification-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordGuildMember, DiscordRole } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const USER_ID = "500000000000000001"
const USER_ROLE_ID = "500000000000000002"
const OPERATION_KEY = "member-verification-operation-0001"
const AUDIT_REASON = "Reviewed verification bypass change"
const NOW = "2026-08-27T12:00:00.000Z"

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

function request(
  overrides: Partial<MemberVerificationChangeRequest> = {},
): MemberVerificationChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    bypassesVerification: true,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    userId: USER_ID,
    ...overrides,
  }
}

function policy(options: {
  allowChanges?: boolean
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
    allowMemberVerificationChanges: options.allowChanges ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    memberVerificationGuildIds: new Set(guilds),
    mentionUserIds: new Set(),
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
  readbackFlags: number | undefined
  responseOverride: DiscordGuildMemberVerificationUpdate | null
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
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      flags: 0,
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector-user" },
    },
    guildName: "Private Guild Name",
    mutationError: undefined,
    ownerId: OWNER_ID,
    readbackError: undefined,
    readbackFlags: undefined,
    responseOverride: null,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(USER_ROLE_ID, 0n, 2),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
    targetMember: {
      flags: 8,
      pending: true,
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
    ...options.state,
  }
  const events: string[] = []
  const activities: ActivityEntry[] = []
  let activityCalls = 0
  let mutations = 0
  let writtenFlags: number | null = null
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
  const client: MemberVerificationServiceOptions["client"] = {
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: state.guildName, owner_id: state.ownerId }
    },
    async getGuildMember(_guildId, userId) {
      events.push(`read:member:${userId}`)
      if (mutations > 0 && state.readbackError) throw state.readbackError
      const member = userId === BOT_ID ? state.botMember : state.targetMember
      if (mutations > 0 && state.readbackFlags !== undefined) {
        return { ...member, flags: state.readbackFlags }
      }
      return member
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async modifyGuildMemberVerificationBypass(_guildId, userId, flags) {
      mutations += 1
      writtenFlags = flags
      events.push("write:member-verification")
      if (state.mutationError) throw state.mutationError
      state.targetMember = { ...state.targetMember, flags }
      return state.responseOverride || {
        bypassesVerification: (BigInt(flags) & 4n) !== 0n,
        flags,
        userId,
      }
    },
  }
  const service = new MemberVerificationService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: options.planKey || new Uint8Array(32).fill(27),
    policy: options.policy || policy(),
    randomId: () => "member-verification-activity-0001",
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
    get writtenFlags() {
      return writtenFlags
    },
  }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof MemberVerificationExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("member verification normalization accepts only one exact named boolean change", () => {
  const normalized = normalizeMemberVerificationChangeRequest(request())
  assert.equal(normalized.bypassesVerification, true)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)

  assert.throws(
    () => normalizeMemberVerificationChangeRequest({
      ...request(),
      flags: 4,
    } as unknown as MemberVerificationChangeRequest),
    /unsupported fields/u,
  )
  assert.throws(
    () => normalizeMemberVerificationChangeRequest({
      ...request(),
      bypassesVerification: 1,
    } as unknown as MemberVerificationChangeRequest),
    /boolean/u,
  )
  assert.throws(
    () => normalizeMemberVerificationChangeRequest(request({ userId: "bad" })),
    /user snowflake/u,
  )
})

test("member verification plans accept every documented permission alternative", async () => {
  const alternatives: Array<{
    expected: string
    permissions: bigint
  }> = [
    { expected: "manage-guild", permissions: DISCORD_PERMISSIONS.MANAGE_GUILD },
    { expected: "manage-roles", permissions: DISCORD_PERMISSIONS.MANAGE_ROLES },
    {
      expected: "combined-moderation",
      permissions: DISCORD_PERMISSIONS.MODERATE_MEMBERS
        | DISCORD_PERMISSIONS.KICK_MEMBERS
        | DISCORD_PERMISSIONS.BAN_MEMBERS,
    },
  ]
  for (const alternative of alternatives) {
    const target = fixture({ state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(USER_ROLE_ID, 0n, 2),
        role(BOT_ROLE_ID, alternative.permissions, 10, {
          managed: true,
          tags: { bot_id: BOT_ID },
        }),
      ],
    } })
    const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())
    assert.equal(plan.permission.authorizationPath, alternative.expected)
    assert.equal(plan.permission.requiredPermissionsPresent, true)
  }
})

test("member verification plans preserve pending members and hide raw flags", async () => {
  const highFlags = 2 ** 40 + 8
  const target = fixture({ state: {
    targetMember: {
      flags: highFlags,
      pending: true,
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
  } })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.status, "planned")
  assert.equal(plan.target.currentBypassesVerification, false)
  assert.equal(plan.target.pending, true)
  assert.equal(plan.desiredBypassesVerification, true)
  assert.equal(plan.hierarchy.targetBelowBot, true)
  assert.equal(plan.privacy.rawFlagsExposed, false)
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(String(highFlags), "u"))
})

test("member verification plans reject disabled, protected, special, and unsafe targets", async () => {
  await assert.rejects(
    fixture({ policy: policy({ allowChanges: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /disabled/u,
  )
  await assert.rejects(
    fixture({ policy: policy({ protectedUsers: [USER_ID] }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /protected/u,
  )
  await assert.rejects(
    fixture().service.plan(APPLICATION_ID, BOT_ID, request({ userId: BOT_ID })),
    /connector bot/u,
  )
  await assert.rejects(
    fixture({ state: { ownerId: USER_ID } }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /guild owner/u,
  )
  await assert.rejects(
    fixture({ state: {
      targetMember: {
        flags: 0,
        roles: [USER_ROLE_ID],
        user: { bot: true, id: USER_ID, username: "target-bot" },
      },
    } }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /bot account/u,
  )
})

test("member verification plans reject missing authority, administrators, and hierarchy peers", async () => {
  const cases: Array<{ pattern: RegExp; permissions: bigint; targetPosition: number }> = [
    { pattern: /permission path/u, permissions: 0n, targetPosition: 2 },
    {
      pattern: /administrator/u,
      permissions: DISCORD_PERMISSIONS.MANAGE_GUILD,
      targetPosition: 2,
    },
    {
      pattern: /strictly below/u,
      permissions: DISCORD_PERMISSIONS.MANAGE_GUILD,
      targetPosition: 10,
    },
  ]
  for (const [index, entry] of cases.entries()) {
    const targetPermissions = index === 1 ? DISCORD_PERMISSIONS.ADMINISTRATOR : 0n
    const target = fixture({ state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(USER_ROLE_ID, targetPermissions, entry.targetPosition),
        role(BOT_ROLE_ID, entry.permissions, 10, {
          managed: true,
          tags: { bot_id: BOT_ID },
        }),
      ],
    } })
    await assert.rejects(
      target.service.plan(APPLICATION_ID, BOT_ID, request()),
      entry.pattern,
    )
  }
})

test("member verification plans fail closed on malformed flags and role evidence", async () => {
  for (const flags of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const target = fixture()
    target.state.targetMember = { ...target.state.targetMember, flags }
    await assert.rejects(
      target.service.plan(APPLICATION_ID, BOT_ID, request()),
      /target-member member verification evidence/u,
    )
  }
  const missingFlags = fixture()
  delete missingFlags.state.targetMember.flags
  await assert.rejects(
    missingFlags.service.plan(APPLICATION_ID, BOT_ID, request()),
    /target-member member verification evidence/u,
  )
  const unknownRole = fixture()
  unknownRole.state.targetMember.roles = ["999999999999999999"]
  await assert.rejects(
    unknownRole.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown role/u,
  )
})

test("member verification digest binds unrelated flags and hierarchy evidence", async () => {
  const target = fixture()
  const first = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  target.state.targetMember = { ...target.state.targetMember, flags: 16 }
  const changedFlags = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  target.state.roles = target.state.roles.map((entry) => (
    entry.id === BOT_ROLE_ID ? { ...entry, position: 11 } : entry
  ))
  const changedHierarchy = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.notEqual(first.digest, changedFlags.digest)
  assert.notEqual(changedFlags.digest, changedHierarchy.digest)
})

test("already-current member verification execution consumes no key or records", async () => {
  const target = fixture({ state: {
    targetMember: {
      flags: 12,
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
  } })
  const intent = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, intent)
  const result = await target.service.execute(APPLICATION_ID, BOT_ID, intent, plan.digest)

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(result.verification, "not-required")
  assert.equal(target.mutations, 0)
  assert.equal(target.activities.length, 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

test("member verification execution preserves every unrelated flag and records pending first", async () => {
  const baseFlags = 2 ** 40 + 8
  const target = fixture({ state: {
    targetMember: {
      flags: baseFlags,
      pending: true,
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
  } })
  const intent = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, intent)
  target.events.length = 0
  const result = await target.service.execute(APPLICATION_ID, BOT_ID, intent, plan.digest)

  assert.equal(target.writtenFlags, baseFlags + 4)
  assert.equal(result.status, "completed")
  assert.equal(result.observedBypassesVerification, true)
  assert.equal(result.verification, "match")
  assert.ok(
    target.events.indexOf("activity:pending")
      < target.events.indexOf("write:member-verification"),
  )
  assert.equal(target.activities[0]?.kind, "member-verification-change")
  assert.equal(target.activities.at(-1)?.status, "completed")
  const durable = JSON.stringify({
    activities: target.activities,
    receipts: [...target.operationStore.receipts.values()],
  })
  assert.doesNotMatch(
    durable,
    /Private Guild Name|target-user|Reviewed verification bypass change|member-verification-operation-0001/u,
  )
  assert.doesNotMatch(durable, new RegExp(String(baseFlags), "u"))
})

test("member verification response or readback flag drift is settled and visible", async () => {
  const responseDrift = fixture({ state: {
    responseOverride: {
      bypassesVerification: true,
      flags: 20,
      userId: USER_ID,
    },
  } })
  const intent = request()
  const plan = await responseDrift.service.plan(APPLICATION_ID, BOT_ID, intent)
  const result = await responseDrift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    intent,
    plan.digest,
  )
  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")

  const readbackDrift = fixture({ state: { readbackFlags: 20 } })
  const secondPlan = await readbackDrift.service.plan(APPLICATION_ID, BOT_ID, intent)
  const second = await readbackDrift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    intent,
    secondPlan.digest,
  )
  assert.equal(second.status, "completed-with-drift")
  assert.equal(second.observedBypassesVerification, true)
})

test("fresh member verification evidence must match the reviewed digest", async () => {
  const target = fixture()
  const intent = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, intent)
  target.state.targetMember = { ...target.state.targetMember, flags: 16 }

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, intent, plan.digest),
    MemberVerificationPlanChangedError,
  )
  assert.equal(target.mutations, 0)
})

test("member verification failures distinguish refusal from uncertain dispatch", async () => {
  const refused = fixture({ state: { mutationError: discordError(403, 50013) } })
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    refused.service.execute(APPLICATION_ID, BOT_ID, request(), refusedPlan.digest),
    (error: unknown) => executionResult(error).status === "failed",
  )

  const rateLimited = fixture({ state: { mutationError: discordError(429) } })
  const ratePlan = await rateLimited.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    rateLimited.service.execute(APPLICATION_ID, BOT_ID, request(), ratePlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )

  const readback = fixture({ state: { readbackError: new Error("offline") } })
  const readbackPlan = await readback.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    readback.service.execute(APPLICATION_ID, BOT_ID, request(), readbackPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
})

test("member verification keys are one-shot and uncertainty quarantines the member", async () => {
  const completed = fixture()
  const plan = await completed.service.plan(APPLICATION_ID, BOT_ID, request())
  await completed.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest)
  await assert.rejects(
    completed.service.plan(APPLICATION_ID, BOT_ID, request()),
    MemberVerificationOperationConflictError,
  )

  const uncertain = fixture({ state: { mutationError: new Error("network lost") } })
  const first = request()
  const firstPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, first)
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, first, firstPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  uncertain.state.mutationError = undefined
  const second = request({
    bypassesVerification: false,
    operationKey: "member-verification-operation-0002",
  })
  const secondPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, second)
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, second, secondPlan.digest),
    (error: unknown) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(uncertain.mutations, 1)
})

test("member verification persistence failures preserve the mutation boundary", async () => {
  const pending = fixture({ state: { activityFailureAt: 1 } })
  const pendingPlan = await pending.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    pending.service.execute(APPLICATION_ID, BOT_ID, request(), pendingPlan.digest),
    (error: unknown) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(pending.mutations, 0)

  const receipt = fixture()
  receipt.operationStore.finishFailureAt = 1
  const receiptPlan = await receipt.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    receipt.service.execute(APPLICATION_ID, BOT_ID, request(), receiptPlan.digest),
    (error: unknown) => executionResult(error).status === "completed-operation-record-failed",
  )
  assert.equal(receipt.activities.at(-1)?.status, "uncertain")

  const activity = fixture({ state: { activityFailureAt: 2 } })
  const activityPlan = await activity.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    activity.service.execute(APPLICATION_ID, BOT_ID, request(), activityPlan.digest),
    (error: unknown) => executionResult(error).status === "completed-audit-failed",
  )
  assert.equal(
    [...activity.operationStore.receipts.values()][0]?.status,
    "completed",
  )
})
