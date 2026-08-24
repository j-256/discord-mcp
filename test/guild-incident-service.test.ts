import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  DiscordApiError,
  GuildIncidentEvidenceError,
  GuildIncidentExecutionError,
  GuildIncidentOperationConflictError,
  GuildIncidentPlanChangedError,
} from "../src/errors.js"
import type {
  DiscordGuildIncidentActions,
  DiscordGuildIncidentState,
} from "../src/guild-incident.js"
import {
  GuildIncidentService,
  normalizeGuildIncidentActionChangeRequest,
  type GuildIncidentActionChangeRequest,
  type GuildIncidentServiceOptions,
} from "../src/guild-incident-service.js"
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
const OPERATION_KEY = "guild-incident-operation-0001"
const AUDIT_REASON = "Reviewed incident response"
const NOW = "2026-08-24T12:00:00.000Z"
const INVITES_UNTIL = "2026-08-25T11:00:00.000Z"
const DMS_UNTIL = "2026-08-25T10:00:00.000Z"

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

function incidentState(
  overrides: Partial<DiscordGuildIncidentState> = {},
): DiscordGuildIncidentState {
  return {
    directMessagesDisabledUntil: null,
    dmSpamDetected: true,
    guildId: GUILD_ID,
    invitesDisabledUntil: null,
    ownerId: OWNER_ID,
    raidDetected: true,
    sourceAvailable: true,
    unknownFieldCount: 0,
    ...overrides,
  }
}

interface RequestOverrides extends Partial<GuildIncidentActionChangeRequest> {
  omitDirectMessages?: boolean
  omitInvites?: boolean
}

function request(
  overrides: RequestOverrides = {},
): GuildIncidentActionChangeRequest {
  const { omitDirectMessages, omitInvites, ...values } = overrides
  const result: GuildIncidentActionChangeRequest = {
    auditReason: AUDIT_REASON,
    directMessagesDisabledUntil: DMS_UNTIL,
    guildId: GUILD_ID,
    invitesDisabledUntil: INVITES_UNTIL,
    operationKey: OPERATION_KEY,
    ...values,
  }
  if (omitDirectMessages) delete result.directMessagesDisabledUntil
  if (omitInvites) delete result.invitesDisabledUntil
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
    allowGuildIncidentAudit: options.allowAudit ?? true,
    allowGuildIncidentChanges: options.allowChanges ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    guildIncidentGuildIds: new Set(guilds),
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
  incident: DiscordGuildIncidentState
  mutationError: unknown
  readbackError: unknown
  readbackIncident: DiscordGuildIncidentState | null
  responseActions: DiscordGuildIncidentActions | null
  roles: DiscordRole[]
}

function discordError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: "Discord request failed",
    method: "PUT",
    route: "/guilds/{guild.id}/incident-actions",
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
    incident: incidentState(),
    mutationError: undefined,
    readbackError: undefined,
    readbackIncident: null,
    responseActions: null,
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
  const writes: Array<Record<string, unknown>> = []
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
  const client: GuildIncidentServiceOptions["client"] = {
    async getGuildIncidentActions() {
      events.push("read:incident")
      if (mutations > 0 && state.readbackError) throw state.readbackError
      if (mutations > 0 && state.readbackIncident) return state.readbackIncident
      return state.incident
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async modifyGuildIncidentActions(_guildId, input) {
      mutations += 1
      events.push("write:incident")
      writes.push({ ...input })
      if (state.mutationError) throw state.mutationError
      state.incident = {
        ...state.incident,
        ...(Object.hasOwn(input, "directMessagesDisabledUntil")
          ? { directMessagesDisabledUntil: input.directMessagesDisabledUntil as string | null }
          : {}),
        ...(Object.hasOwn(input, "invitesDisabledUntil")
          ? { invitesDisabledUntil: input.invitesDisabledUntil as string | null }
          : {}),
      }
      return state.responseActions || state.incident
    },
  }
  const service = new GuildIncidentService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: options.planKey || new Uint8Array(32).fill(29),
    policy: options.policy || policy(),
    randomId: () => "guild-incident-activity-0001",
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
  assert.ok(error instanceof GuildIncidentExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("guild incident normalization preserves sparse disable and clear intent", () => {
  const normalized = normalizeGuildIncidentActionChangeRequest(request({
    directMessagesDisabledUntil: null,
    omitInvites: true,
  }))

  assert.equal(normalized.directMessagesDisabledUntil, null)
  assert.equal(Object.hasOwn(normalized, "invitesDisabledUntil"), false)
  assert.deepEqual(normalized.requestedFields, ["directMessages"])
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.throws(
    () => normalizeGuildIncidentActionChangeRequest(request({
      directMessagesDisabledUntil: "2026-02-30T12:00:00Z",
      omitInvites: true,
    })),
    /ISO 8601/u,
  )
  assert.throws(
    () => normalizeGuildIncidentActionChangeRequest(request({
      omitDirectMessages: true,
      omitInvites: true,
    })),
    /at least one field/u,
  )
  assert.throws(
    () => normalizeGuildIncidentActionChangeRequest({
      ...request(),
      unexpected: true,
    } as unknown as GuildIncidentActionChangeRequest),
    /invalid/u,
  )
})

test("guild incident audit exposes bounded action and authority evidence", async () => {
  const target = fixture()
  const result = await target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(result.status, "ok")
  assert.equal(result.actions.dmSpamDetected, true)
  assert.equal(result.actions.raidDetected, true)
  assert.equal(result.access.authorizedForChange, true)
  assert.equal(result.access.manageGuild, true)
  assert.equal(result.privacy.detectionTimestamps, "boolean-presence-only")
  assert.equal(result.verificationBoundary.auditLogReasonHeader, false)
  assert.doesNotMatch(JSON.stringify(result), /private-role/u)
})

test("guild incident audit reports unavailable state while changes fail closed", async () => {
  const target = fixture({ state: { incident: incidentState({
    dmSpamDetected: false,
    raidDetected: false,
    sourceAvailable: false,
  }) } })
  const audit = await target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(audit.actions.sourceAvailable, false)
  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, request()),
    /did not return incident-action state/u,
  )

  target.state.incident = incidentState({ unknownFieldCount: 1 })
  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown guild incident-action fields/u,
  )
})

test("guild incident policy and known-permission gates are independent", async () => {
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

  const missing = fixture({ state: {
    roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
  } })
  const audit = await missing.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(audit.access.authorizedForChange, false)
  await assert.rejects(
    missing.service.plan(APPLICATION_ID, BOT_ID, request()),
    /MANAGE_GUILD/u,
  )

  const owner = fixture({ state: {
    incident: incidentState({ ownerId: BOT_ID }),
    roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
  } })
  assert.equal(
    (await owner.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)).access.authorizedForChange,
    true,
  )
  assert.equal(
    (await owner.service.plan(APPLICATION_ID, BOT_ID, request())).status,
    "planned",
  )

  const unknown = fixture({ state: {
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD | (1n << 60n), 10),
    ],
  } })
  const unknownAudit = await unknown.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.notEqual(unknownAudit.access.unknownPermissionBits, "0")
  await assert.rejects(
    unknown.service.plan(APPLICATION_ID, BOT_ID, request()),
    /complete known MANAGE_GUILD/u,
  )
})

test("guild incident plans distinguish extending, shortening, and clearing protection", async () => {
  const current = "2026-08-25T10:00:00.000Z"
  const target = fixture({ state: {
    incident: incidentState({ invitesDisabledUntil: current }),
  } })

  for (const [value, expected] of [
    [INVITES_UNTIL, "extend"],
    ["2026-08-25T09:00:00.000Z", "shorten"],
    [null, "clear"],
  ] as const) {
    const plan = await target.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ invitesDisabledUntil: value, omitDirectMessages: true }),
    )
    assert.equal(plan.effects[0]?.effect, expected)
  }
})

test("guild incident plans enforce fresh future deadlines and bind evidence", async () => {
  const target = fixture()
  const desired = request({ omitDirectMessages: true })
  const first = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  const changedIntent = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ invitesDisabledUntil: "2026-08-25T09:00:00Z", omitDirectMessages: true }),
  )
  target.state.incident = incidentState({ raidDetected: false })
  const changedEvidence = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    desired,
  )

  assert.deepEqual(first.requestedFields, ["invites"])
  assert.deepEqual(first.changedFields, ["invites"])
  assert.equal(first.desired.directMessagesDisabledUntil, null)
  assert.equal(first.effects[0]?.effect, "disable")
  assert.notEqual(first.digest, changedIntent.digest)
  assert.notEqual(first.digest, changedEvidence.digest)

  for (const invitesDisabledUntil of [
    NOW,
    "2026-08-25T12:00:00.001Z",
  ]) {
    await assert.rejects(
      target.service.plan(APPLICATION_ID, BOT_ID, request({
        invitesDisabledUntil,
        omitDirectMessages: true,
      })),
      /future and no more than 24 hours/u,
    )
  }
})

test("already-current guild incident execution consumes no key or records", async () => {
  const target = fixture()
  const desired = request({
    directMessagesDisabledUntil: null,
    invitesDisabledUntil: null,
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
  assert.equal(target.mutations, 0)
  assert.equal(target.activities.length, 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

test("guild incident execution records content-free pending state before one sparse write", async () => {
  const target = fixture()
  const desired = request({ omitDirectMessages: true })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  target.events.length = 0
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.deepEqual(target.writes, [{ invitesDisabledUntil: INVITES_UNTIL }])
  assert.ok(
    target.events.indexOf("activity:pending")
      < target.events.indexOf("write:incident"),
  )
  assert.equal(target.activities[0]?.kind, "guild-incident-action-change")
  assert.equal(target.activities.at(-1)?.status, "completed")
  const durable = JSON.stringify({
    activities: target.activities,
    receipts: [...target.operationStore.receipts.values()],
  })
  assert.doesNotMatch(
    durable,
    /2026-08-25|Reviewed incident|guild-incident-operation/u,
  )
})

test("guild incident response or readback mismatch completes with field drift", async () => {
  const target = fixture({ state: {
    readbackIncident: incidentState({
      invitesDisabledUntil: "2026-08-25T09:00:00.000Z",
    }),
    responseActions: incidentState({
      invitesDisabledUntil: "2026-08-25T10:00:00.000Z",
    }),
  } })
  const desired = request({ omitDirectMessages: true })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.deepEqual(result.driftFields, ["invites"])
})

test("guild incident verification reports an unrequested action-field change", async () => {
  const unexpectedDeadline = "2026-08-25T09:30:00.000Z"
  const target = fixture({ state: {
    readbackIncident: incidentState({
      directMessagesDisabledUntil: unexpectedDeadline,
      invitesDisabledUntil: INVITES_UNTIL,
    }),
    responseActions: incidentState({
      directMessagesDisabledUntil: unexpectedDeadline,
      invitesDisabledUntil: INVITES_UNTIL,
    }),
  } })
  const desired = request({ omitDirectMessages: true })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.deepEqual(result.requestedFields, ["invites"])
  assert.equal(result.status, "completed-with-drift")
  assert.deepEqual(result.driftFields, ["directMessages"])
})

test("known refusal is failed while ambiguous incident outcomes are uncertain", async () => {
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

test("fresh incident evidence must match the reviewed digest", async () => {
  const target = fixture()
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)
  target.state.incident = incidentState({ invitesDisabledUntil: "2026-08-25T08:00:00.000Z" })

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    GuildIncidentPlanChangedError,
  )
  assert.equal(target.mutations, 0)
})

test("incident operation keys are one-shot and uncertain outcomes quarantine the guild", async () => {
  const spent = fixture()
  const first = request()
  const firstPlan = await spent.service.plan(APPLICATION_ID, BOT_ID, first)
  await spent.service.execute(APPLICATION_ID, BOT_ID, first, firstPlan.digest)
  await assert.rejects(
    spent.service.plan(APPLICATION_ID, BOT_ID, first),
    GuildIncidentOperationConflictError,
  )

  const target = fixture({ state: { mutationError: new Error("network lost") } })
  const uncertainPlan = await target.service.plan(APPLICATION_ID, BOT_ID, first)
  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, first, uncertainPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  target.state.mutationError = undefined
  const second = request({ operationKey: "guild-incident-operation-0002" })
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, second)
  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, second, secondPlan.digest),
    (error: unknown) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(target.mutations, 1)
})

test("pending activity failure blocks incident dispatch and spends the key", async () => {
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

test("completed incident write surfaces durable record failures without action values", async () => {
  const target = fixture()
  target.operationStore.finishFailureAt = 1
  const desired = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, desired)

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => {
      const result = executionResult(error)
      assert.equal(result.status, "completed-operation-record-failed")
      assert.doesNotMatch(JSON.stringify(result), /2026-08-25|Reviewed incident/u)
      return true
    },
  )
  assert.equal(target.activities.at(-1)?.status, "uncertain")
})

test("malformed projected incident evidence fails closed before dispatch", async () => {
  const target = fixture({ state: {
    incident: incidentState({
      directMessagesDisabledUntil: "invalid",
    }),
  } })

  await assert.rejects(
    target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    GuildIncidentEvidenceError,
  )
})
