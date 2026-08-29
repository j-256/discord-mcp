import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type {
  DiscordGuildProfile,
} from "../src/guild-profile.js"
import {
  DiscordApiError,
  GuildProfileEvidenceError,
  GuildProfileExecutionError,
  GuildProfileOperationConflictError,
  GuildProfilePlanChangedError,
} from "../src/errors.js"
import {
  GuildProfileService,
  normalizeGuildProfileChangeRequest,
  type GuildProfileChangeRequest,
  type GuildProfileServiceOptions,
} from "../src/guild-profile-service.js"
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
const OPERATION_KEY = "guild-profile-operation-0001"
const AUDIT_REASON = "Reviewed guild presentation change"
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

function profile(overrides: Partial<DiscordGuildProfile> = {}): DiscordGuildProfile {
  return {
    description: "Private profile before",
    id: GUILD_ID,
    mediaPresence: {
      banner: false,
      discoverySplash: true,
      icon: true,
      inviteSplash: false,
    },
    name: "Private Guild Before",
    ownerId: OWNER_ID,
    ...overrides,
  }
}

interface RequestOverrides extends Partial<GuildProfileChangeRequest> {
  omitDescription?: boolean
  omitName?: boolean
}

function request(overrides: RequestOverrides = {}): GuildProfileChangeRequest {
  const { omitDescription, omitName, ...values } = overrides
  const result: GuildProfileChangeRequest = {
    auditReason: AUDIT_REASON,
    description: "Private profile after",
    guildId: GUILD_ID,
    name: "Private Guild After",
    operationKey: OPERATION_KEY,
    ...values,
  }
  if (omitDescription) delete result.description
  if (omitName) delete result.name
  return result
}

function policy(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  guilds?: readonly string[]
} = {}): ScopePolicy {
  const guilds = options.guilds ?? [GUILD_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(guilds),
    allowAdministration: false,
    allowDeletions: false,
    allowGuildProfileAudit: options.allowAudit ?? true,
    allowGuildProfileChanges: options.allowChanges ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    guildProfileGuildIds: new Set(guilds),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
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
  mutationError: unknown
  profile: DiscordGuildProfile
  readbackError: unknown
  readbackProfile: DiscordGuildProfile | null
  responseProfile: DiscordGuildProfile | null
  roles: DiscordRole[]
}

function discordError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: "Discord request failed",
    method: "PATCH",
    route: "/guilds/{guild.id}",
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
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector-user" },
    },
    mutationError: undefined,
    profile: profile(),
    readbackError: undefined,
    readbackProfile: null,
    responseProfile: null,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
    ...options.state,
  }
  const events: string[] = []
  const activities: ActivityEntry[] = []
  const writes: Array<{
    auditReason: string
    input: { description?: string | null; name?: string }
  }> = []
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
  const client: GuildProfileServiceOptions["client"] = {
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildProfile() {
      events.push("read:profile")
      if (mutations > 0 && state.readbackError) throw state.readbackError
      if (mutations > 0 && state.readbackProfile) return state.readbackProfile
      return state.profile
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async modifyGuildProfile(_guildId, input, auditReason) {
      mutations += 1
      events.push("write:profile")
      writes.push({ auditReason, input: { ...input } })
      if (state.mutationError) throw state.mutationError
      state.profile = {
        ...state.profile,
        ...(Object.hasOwn(input, "description")
          ? { description: input.description as string | null }
          : {}),
        ...(Object.hasOwn(input, "name")
          ? { name: input.name as string }
          : {}),
      }
      return state.responseProfile || state.profile
    },
  }
  const service = new GuildProfileService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: options.planKey || new Uint8Array(32).fill(23),
    policy: options.policy || policy(),
    randomId: () => "guild-profile-activity-0001",
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
    writes,
  }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof GuildProfileExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("guild profile normalization preserves sparse intent and explicit clearing", () => {
  const clear = normalizeGuildProfileChangeRequest(request({
    description: null,
    omitName: true,
  }))
  assert.equal(clear.description, null)
  assert.equal(Object.hasOwn(clear, "name"), false)
  assert.deepEqual(clear.requestedFields, ["description"])
  assert.match(clear.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)

  const unicodeName = "😀".repeat(100)
  assert.equal(
    normalizeGuildProfileChangeRequest(request({
      name: unicodeName,
      omitDescription: true,
    })).name,
    unicodeName,
  )
  for (const name of [
    "x",
    "x".repeat(101),
    " leading",
    "trailing ",
    "line\nbreak",
    "zero\u200bwidth",
    "\ud800x",
  ]) {
    assert.throws(
      () => normalizeGuildProfileChangeRequest(request({ name, omitDescription: true })),
      /guild name/u,
    )
  }
  for (const description of [
    "",
    "x".repeat(121),
    " leading",
    "trailing ",
    "line\nbreak",
    "zero\u200bwidth",
    "\ud800",
  ]) {
    assert.throws(
      () => normalizeGuildProfileChangeRequest(request({ description, omitName: true })),
      /guild description/u,
    )
  }
  assert.throws(
    () => normalizeGuildProfileChangeRequest({
      ...request(),
      unexpected: true,
    } as unknown as GuildProfileChangeRequest),
    /invalid/u,
  )
  assert.throws(
    () => normalizeGuildProfileChangeRequest(request({
      omitDescription: true,
      omitName: true,
    })),
    /at least one field/u,
  )
})

test("guild profile audit exposes bounded transient text and complete authority", async () => {
  const target = fixture()
  const result = await target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(result.status, "ok")
  assert.equal(result.profile.name, "Private Guild Before")
  assert.equal(result.profile.description, "Private profile before")
  assert.deepEqual(result.profile.mediaPresence, {
    banner: false,
    discoverySplash: true,
    icon: true,
    inviteSplash: false,
  })
  assert.equal(result.access.authorizedForChange, true)
  assert.equal(result.access.manageGuild, true)
  assert.equal(result.privacy.mediaHashes, "presence-only")
  assert.equal(result.privacy.profileText, "transient-untrusted")
  assert.doesNotMatch(JSON.stringify(result), /private-role/u)
})

test("guild profile audit can report missing authority while planning fails closed", async () => {
  const target = fixture({ state: {
    roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
  } })
  const audit = await target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(audit.access.authorizedForChange, false)
  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, request()),
    /MANAGE_GUILD/u,
  )

  target.state.profile = profile({ ownerId: BOT_ID })
  const ownerPlan = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(ownerPlan.access.botIsGuildOwner, true)
  assert.equal(ownerPlan.access.authorizedForChange, true)
})

test("guild profile policy separates audit and change gates", async () => {
  await assert.rejects(
    fixture({ policy: policy({ allowAudit: false }) }).service.get(
      APPLICATION_ID,
      BOT_ID,
      GUILD_ID,
    ),
    /audit is disabled/u,
  )
  await assert.rejects(
    fixture({ policy: policy({ allowChanges: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /changes are disabled/u,
  )
  await assert.rejects(
    fixture({ policy: policy({ guilds: ["900000000000000001"] }) }).service.get(
      APPLICATION_ID,
      BOT_ID,
      GUILD_ID,
    ),
    /outside the configured read scope/u,
  )
})

test("guild profile plans bind sparse intent, profile, and authority evidence", async () => {
  const target = fixture()
  const sparseRequest = request({ omitDescription: true })
  const first = await target.service.plan(APPLICATION_ID, BOT_ID, sparseRequest)
  const changedIntent = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ name: "Another Guild Name", omitDescription: true }),
  )
  target.state.profile = profile({
    mediaPresence: {
      ...profile().mediaPresence,
      banner: true,
    },
  })
  const changedMediaPresence = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    sparseRequest,
  )
  target.state.profile = profile()
  target.state.roles = target.state.roles.map((entry) => (
    entry.id === BOT_ROLE_ID
      ? { ...entry, permissions: (DISCORD_PERMISSIONS.ADMINISTRATOR).toString() }
      : entry
  ))
  const changedAuthority = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    sparseRequest,
  )

  assert.deepEqual(first.requestedFields, ["name"])
  assert.deepEqual(first.changedFields, ["name"])
  assert.equal(first.desired.description, "Private profile before")
  assert.equal(first.writeRequired, true)
  assert.notEqual(first.digest, changedIntent.digest)
  assert.notEqual(first.digest, changedMediaPresence.digest)
  assert.notEqual(first.digest, changedAuthority.digest)
})

test("already-current guild profile execution consumes no key or records", async () => {
  const target = fixture()
  const desired = request({
    name: "Private Guild Before",
    omitDescription: true,
  })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
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

test("guild profile execution records pending state before one sparse write", async () => {
  const target = fixture()
  const desired = request({ omitDescription: true })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  target.events.length = 0
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.deepEqual(result.driftFields, [])
  assert.equal(target.mutations, 1)
  assert.deepEqual(target.writes, [{
    auditReason: AUDIT_REASON,
    input: { name: "Private Guild After" },
  }])
  assert.ok(
    target.events.indexOf("activity:pending")
      < target.events.indexOf("write:profile"),
  )
  assert.equal(target.activities[0]?.kind, "guild-profile-change")
  assert.equal(target.activities.at(-1)?.status, "completed")
  const durable = JSON.stringify({
    activities: target.activities,
    receipts: [...target.operationStore.receipts.values()],
  })
  assert.doesNotMatch(
    durable,
    /Private Guild Before|Private Guild After|Private profile|Reviewed guild|guild-profile-operation/u,
  )
})

test("guild profile execution preserves explicit description clearing", async () => {
  const target = fixture()
  const desired = request({ description: null, omitName: true })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.deepEqual(target.writes[0]?.input, { description: null })
  assert.equal(target.state.profile.description, null)
})

test("guild profile response or readback mismatch completes with field drift", async () => {
  const target = fixture({ state: {
    readbackProfile: profile({ name: "Concurrent Guild Name" }),
    responseProfile: profile({ name: "Server Normalized Name" }),
  } })
  const desired = request({ omitDescription: true })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.deepEqual(result.driftFields, ["name"])
  assert.equal(target.activities.at(-1)?.status, "completed-with-drift")
})

test("known refusal is failed while rate limits and readback errors are uncertain", async () => {
  const refused = fixture({ state: { mutationError: discordError(403, 50013) } })
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    refused.service.execute(APPLICATION_ID, BOT_ID, request(), refusedPlan.digest),
    (error: unknown) => executionResult(error).status === "failed",
  )
  assert.equal(refused.activities.at(-1)?.status, "failed")

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

test("fresh guild profile evidence must match the reviewed digest", async () => {
  const target = fixture()
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  target.state.profile = profile({ description: "Concurrent change" })

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    GuildProfilePlanChangedError,
  )
  assert.equal(target.mutations, 0)
})

test("guild profile execution rejects malformed digests and projected evidence", async () => {
  const target = fixture()
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)

  assert.throws(
    () => target.service.execute(APPLICATION_ID, BOT_ID, desired, "invalid"),
    /plan digest is invalid/u,
  )
  target.state.profile = {
    ...profile(),
    mediaPresence: { ...profile().mediaPresence, icon: "yes" as unknown as boolean },
  }
  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => (
      error instanceof GuildProfilePlanChangedError
      && error.actualDigest === "guild-profile-state-unavailable"
    ),
  )
  assert.equal(target.mutations, 0)

  target.state.profile = profile({ id: "999999999999999999" })
  await assert.rejects(
    target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    GuildProfileEvidenceError,
  )
})

test("guild profile operation keys are one-shot", async () => {
  const target = fixture()
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  await target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest)

  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, desired),
    GuildProfileOperationConflictError,
  )
})

test("guild profile reconciliation accepts only completed matching convergence", async () => {
  const target = fixture()
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  await target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest)

  const converged = await target.service.reconcilePlan(
    APPLICATION_ID,
    BOT_ID,
    desired,
  )
  assert.equal(converged.writeRequired, false)

  target.state.profile.name = "Later drift"
  await assert.rejects(
    target.service.reconcilePlan(APPLICATION_ID, BOT_ID, desired),
    GuildProfileOperationConflictError,
  )
})

test("uncertain guild profile outcomes quarantine only the shared operation store", async () => {
  const target = fixture({ state: { mutationError: new Error("network lost") } })
  const first = request()
  const firstPlan = await target.service.plan(APPLICATION_ID, BOT_ID, first)
  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, first, firstPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  target.state.mutationError = undefined
  const second = request({
    name: "Second Guild Intent",
    operationKey: "guild-profile-operation-0002",
  })
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, second)
  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, second, secondPlan.digest),
    (error: unknown) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(target.mutations, 1)

  const isolated = fixture()
  const isolatedPlan = await isolated.service.plan(APPLICATION_ID, BOT_ID, second)
  const result = await isolated.service.execute(
    APPLICATION_ID,
    BOT_ID,
    second,
    isolatedPlan.digest,
  )
  assert.equal(result.status, "completed")
})

test("pending activity failure blocks guild profile dispatch and spends the key", async () => {
  const target = fixture({ state: { activityFailureAt: 1 } })
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(target.mutations, 0)
  assert.equal([...target.operationStore.receipts.values()][0]?.status, "failed")
})

test("completed guild profile write surfaces durable record failures without text", async () => {
  const target = fixture()
  target.operationStore.finishFailureAt = 1
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => {
      const result = executionResult(error)
      assert.equal(result.status, "completed-operation-record-failed")
      assert.doesNotMatch(
        JSON.stringify(result),
        /Private Guild|Private profile|Reviewed guild/u,
      )
      return true
    },
  )
  assert.equal(target.activities.at(-1)?.status, "uncertain")
})
