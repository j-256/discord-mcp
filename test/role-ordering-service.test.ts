import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  DiscordGuildRoleMemberCounts,
  ModifyGuildRolePositionInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  RoleOrderingEvidenceError,
  RoleOrderingExecutionError,
  RoleOrderingOperationConflictError,
  RoleOrderingPlanChangedError,
} from "../src/errors.js"
import type {
  OperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeRoleOrderingRequest,
  RoleOrderingService,
  type RoleOrderingRequest,
  type RoleOrderingServiceClient,
} from "../src/role-ordering-service.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "610000000000000001"
const BOT_ID = "620000000000000001"
const GUILD_ID = "630000000000000001"
const OWNER_ID = "630000000000000002"
const LOW_ROLE_ID = "640000000000000001"
const TARGET_ROLE_ID = "640000000000000002"
const MID_ROLE_ID = "640000000000000003"
const ANCHOR_ROLE_ID = "640000000000000004"
const HIGH_ROLE_ID = "640000000000000005"
const BOT_ROLE_ID = "640000000000000006"
const OPERATION_KEY = "role-ordering-operation-001"
const PLAN_KEY = new Uint8Array(32).fill(14)

function compareRolesLowToHigh(left: DiscordRole, right: DiscordRole): number {
  if (left.position !== right.position) return left.position - right.position
  const leftId = BigInt(left.id)
  const rightId = BigInt(right.id)
  return rightId < leftId ? -1 : rightId > leftId ? 1 : 0
}

function role(
  id: string,
  name: string,
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
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  calls = 0
  failAt: number | null = null

  async append(entry: ActivityEntry): Promise<void> {
    this.calls += 1
    if (this.failAt === this.calls) throw new Error("activity unavailable")
    this.entries.push(structuredClone(entry))
  }

  async list(): Promise<ActivityList> {
    return {
      entries: structuredClone(this.entries),
      file: "/private/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()
  failFinish = false
  finishCalls = 0
  reserveCalls = 0

  #key(kind: OperationKind, operationKeyHash: string): string {
    return `${kind}:${operationKeyHash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    if (this.failFinish) throw new Error("operation receipt unavailable")
    this.receipts.set(
      this.#key(receipt.kind, receipt.operationKeyHash),
      structuredClone(receipt),
    )
  }

  async get(
    kind: OperationKind,
    operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    const receipt = this.receipts.get(this.#key(kind, operationKeyHash))
    return receipt ? structuredClone(receipt) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.reserveCalls += 1
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

class FixtureClient implements RoleOrderingServiceClient {
  counts: Record<string, number>
  countDrift = false
  guild: DiscordGuild
  member: DiscordGuildMember
  modifyError: unknown
  modifyGate: Promise<void> | null = null
  modifyStarted: (() => void) | null = null
  mutated = false
  patchCalls: Array<{
    auditReason: string
    guildId: string
    positions: ModifyGuildRolePositionInput[]
  }> = []
  readbackDrift = false
  responseDrift = false
  responseMalformed = false
  roles: DiscordRole[]

  constructor(guildId = GUILD_ID) {
    const botPermissions = DISCORD_PERMISSIONS.MANAGE_ROLES
      | DISCORD_PERMISSIONS.VIEW_CHANNEL
    this.roles = [
      role(guildId, "@everyone", 0n, 0),
      role(LOW_ROLE_ID, "Low", DISCORD_PERMISSIONS.VIEW_CHANNEL, 1),
      role(TARGET_ROLE_ID, "Private target", DISCORD_PERMISSIONS.VIEW_CHANNEL, 2),
      role(MID_ROLE_ID, "Moderators", DISCORD_PERMISSIONS.BAN_MEMBERS, 3),
      role(ANCHOR_ROLE_ID, "Private anchor", DISCORD_PERMISSIONS.VIEW_CHANNEL, 4),
      role(HIGH_ROLE_ID, "High", DISCORD_PERMISSIONS.VIEW_CHANNEL, 5),
      role(BOT_ROLE_ID, "connector", botPermissions, 6, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ]
    this.counts = {
      [ANCHOR_ROLE_ID]: 5,
      [BOT_ROLE_ID]: 1,
      [HIGH_ROLE_ID]: 2,
      [LOW_ROLE_ID]: 7,
      [MID_ROLE_ID]: 4,
      [TARGET_ROLE_ID]: 3,
    }
    this.guild = {
      features: [],
      id: guildId,
      name: "Private guild",
      owner_id: OWNER_ID,
    }
    this.member = {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    }
  }

  async getGuild() {
    return structuredClone(this.guild)
  }

  async getGuildMember() {
    return structuredClone(this.member)
  }

  async getGuildRoleMemberCounts(): Promise<DiscordGuildRoleMemberCounts> {
    const counts = structuredClone(this.counts)
    if (this.mutated && this.countDrift) {
      counts[TARGET_ROLE_ID] = (counts[TARGET_ROLE_ID] ?? 0) + 1
    }
    return counts
  }

  async getGuildRoles() {
    const roles = structuredClone(this.roles)
    if (this.mutated && this.readbackDrift) {
      const target = roles.find((entry) => entry.id === TARGET_ROLE_ID)
      assert.ok(target)
      target.hoist = !target.hoist
    }
    return roles
  }

  async modifyGuildRolePositions(
    guildId: string,
    positions: readonly ModifyGuildRolePositionInput[],
    auditReason: string,
  ) {
    this.patchCalls.push({
      auditReason,
      guildId,
      positions: structuredClone([...positions]),
    })
    this.modifyStarted?.()
    if (this.modifyGate) await this.modifyGate
    if (this.modifyError) throw this.modifyError
    assert.equal(positions.length, 1)
    const requested = positions[0] as ModifyGuildRolePositionInput
    const ordered = [...this.roles].sort(compareRolesLowToHigh)
    const targetIndex = ordered.findIndex((entry) => entry.id === requested.id)
    assert.notEqual(targetIndex, -1)
    const [target] = ordered.splice(targetIndex, 1)
    assert.ok(target)
    ordered.splice(requested.position, 0, target)
    ordered.forEach((entry, position) => {
      entry.position = position
    })
    this.roles = ordered
    this.mutated = true
    if (this.responseMalformed) {
      return [...structuredClone(ordered), structuredClone(ordered[0] as DiscordRole)]
    }
    const response = structuredClone(ordered)
    if (this.responseDrift) {
      const responseTarget = response.find((entry) => entry.id === requested.id)
      assert.ok(responseTarget)
      responseTarget.mentionable = !responseTarget.mentionable
    }
    return response
  }
}

function policy(guildId = GUILD_ID, audit = true, changes = true) {
  return new ScopePolicy({
    adminGuildIds: new Set<string>(),
    allowedChannelIds: new Set<string>(),
    allowedGuildIds: new Set([guildId]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowRoleOrderingAudit: audit,
    allowRoleOrderingChanges: changes,
    deleteChannelIds: new Set<string>(),
    interactionChannelIds: new Set<string>(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set<string>(),
    protectedUserIds: new Set<string>(),
    roleOrderingGuildIds: new Set([guildId]),
  })
}

type RequestOverrides = {
  [Key in keyof RoleOrderingRequest]?: RoleOrderingRequest[Key]
}

function request(overrides: RequestOverrides = {}): RoleOrderingRequest {
  return {
    anchorRoleId: ANCHOR_ROLE_ID,
    auditReason: "Reviewed hierarchy change",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    placement: "above",
    roleId: TARGET_ROLE_ID,
    ...overrides,
  }
}

function fixture(options: {
  client?: FixtureClient
  policy?: ScopePolicy
} = {}) {
  const activityStore = new MemoryActivityStore()
  const client = options.client ?? new FixtureClient()
  const operationStore = new MemoryOperationStore()
  const service = new RoleOrderingService({
    activityStore,
    client,
    clock: () => new Date("2026-08-23T12:00:00.000Z"),
    operationStore,
    planKey: PLAN_KEY,
    policy: options.policy ?? policy(client.guild.id),
    randomId: () => "activity-role-ordering-001",
  })
  return { activityStore, client, operationStore, service }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof RoleOrderingExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("role-ordering request normalization is exact, relative, and key-safe", () => {
  const normalized = normalizeRoleOrderingRequest(request())

  assert.equal(normalized.placement, "above")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.doesNotMatch(normalized.operationKeyHash, new RegExp(OPERATION_KEY))
  assert.throws(
    () => normalizeRoleOrderingRequest({ ...request(), future: true } as never),
    /exact object/,
  )
  assert.throws(
    () => normalizeRoleOrderingRequest(request({ anchorRoleId: TARGET_ROLE_ID })),
    /must be distinct/,
  )
  assert.throws(
    () => normalizeRoleOrderingRequest(request({ placement: "sideways" as never })),
    /above or below/,
  )
})

test("role-ordering audit returns canonical rank, holder, authority, and privacy evidence", async () => {
  const client = new FixtureClient()
  ;(client.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole).position = 3
  const target = fixture({ client })

  const audit = await target.service.audit(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(audit.status, "ok")
  assert.deepEqual(audit.order.map((entry) => entry.id), [
    GUILD_ID,
    LOW_ROLE_ID,
    MID_ROLE_ID,
    TARGET_ROLE_ID,
    ANCHOR_ROLE_ID,
    HIGH_ROLE_ID,
    BOT_ROLE_ID,
  ])
  assert.deepEqual(audit.order.map((entry) => entry.rank), [0, 1, 2, 3, 4, 5, 6])
  assert.equal(audit.order[0]?.memberCount, null)
  assert.equal(audit.order.find((entry) => entry.id === TARGET_ROLE_ID)?.memberCount, 3)
  assert.equal(audit.permission.guildManageRoles, true)
  assert.equal(audit.permission.botHighestRank, 6)
  assert.deepEqual(audit.permission.botHighestRoleIds, [BOT_ROLE_ID])
  assert.deepEqual(audit.privacy, {
    memberIdentitiesFetched: false,
    omittedFields: ["auditReason", "memberIdentities", "rawOperationKey", "rawPayloads"],
    persistence: "content-free-only",
    roleText: "transient-untrusted",
  })
})

test("role-ordering plans bind the complete hierarchy and explain affected impact", async () => {
  const { service } = fixture()

  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.status, "planned")
  assert.equal(plan.writeRequired, true)
  assert.deepEqual(plan.current, { anchorRank: 4, roleRank: 2 })
  assert.deepEqual(plan.desired, { anchorRank: 3, roleRank: 4 })
  assert.deepEqual(plan.affectedRoles.map((entry) => entry.id), [
    ANCHOR_ROLE_ID,
    MID_ROLE_ID,
    TARGET_ROLE_ID,
  ])
  assert.deepEqual(plan.affectedRoles.map((entry) => [entry.beforeRank, entry.afterRank]), [
    [4, 3],
    [3, 2],
    [2, 4],
  ])
  assert.deepEqual(plan.impact, {
    affectedRoleCount: 3,
    aggregateHolderAssignments: 12,
    changedRoleCount: 3,
    hierarchySensitiveRoleIds: [MID_ROLE_ID],
    holderCountsMayOverlap: true,
  })
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.match(plan.warnings.join("\n"), /Aggregate holder counts can overlap/)
  assert.match(plan.risks.join("\n"), /complete affected segment/)

  const same = await service.plan(APPLICATION_ID, BOT_ID, request({
    anchorRoleId: MID_ROLE_ID,
    placement: "below",
  }))
  assert.equal(same.status, "already-current")
  assert.equal(same.writeRequired, false)
  assert.equal(same.impact.changedRoleCount, 0)
})

test("role-ordering planning fails closed on scope, authority, hierarchy, and future fields", async () => {
  await assert.rejects(
    fixture({ policy: policy(GUILD_ID, false, false) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /audit is disabled/,
  )
  await assert.rejects(
    fixture({ policy: policy(GUILD_ID, true, false) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /changes are disabled/,
  )

  const permissionClient = new FixtureClient()
  ;(permissionClient.roles.find((entry) => entry.id === BOT_ROLE_ID) as DiscordRole)
    .permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL.toString()
  await assert.rejects(
    fixture({ client: permissionClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /lacks guild-level MANAGE_ROLES/,
  )

  const hierarchyClient = new FixtureClient()
  ;(hierarchyClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole)
    .position = 7
  await assert.rejects(
    fixture({ client: hierarchyClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /not below the connector bot/,
  )

  const heldClient = new FixtureClient()
  heldClient.member.roles.push(TARGET_ROLE_ID)
  await assert.rejects(
    fixture({ client: heldClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /cannot be held by the connector bot/,
  )

  const managedClient = new FixtureClient()
  const middle = managedClient.roles.find((entry) => entry.id === MID_ROLE_ID) as DiscordRole
  middle.managed = true
  middle.tags = { integration_id: "650000000000000001" }
  await assert.rejects(
    fixture({ client: managedClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /affected segment crosses an unsafe role/,
  )

  const futureClient = new FixtureClient()
  Object.assign(
    futureClient.roles.find((entry) => entry.id === HIGH_ROLE_ID) as DiscordRole,
    { future_field: true },
  )
  await assert.rejects(
    fixture({ client: futureClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /inventory contains unknown fields/,
  )

  const malformedCountsClient = new FixtureClient()
  malformedCountsClient.counts = { [TARGET_ROLE_ID]: 1 }
  await assert.rejects(
    fixture({ client: malformedCountsClient }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    RoleOrderingEvidenceError,
  )
})

test("role ordering preserves unknown permission bits while exposing them for review", async () => {
  const client = new FixtureClient()
  const targetRole = client.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole
  targetRole.permissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL | (1n << 60n)
  ).toString()

  const plan = await fixture({ client }).service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.role.unknownPermissionBits, (1n << 60n).toString())
  assert.equal(
    plan.affectedRoles.find((entry) => entry.id === TARGET_ROLE_ID)?.permissions,
    targetRole.permissions,
  )
})

test("role ordering executes one reviewed position write and verifies response plus readback", async () => {
  const target = fixture()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.equal(result.memberCountsMatched, true)
  assert.deepEqual(result.observedAffectedRoles.map((entry) => entry.id), [
    MID_ROLE_ID,
    ANCHOR_ROLE_ID,
    TARGET_ROLE_ID,
  ])
  assert.deepEqual(target.client.patchCalls, [{
    auditReason: "Reviewed hierarchy change",
    guildId: GUILD_ID,
    positions: [{ id: TARGET_ROLE_ID, position: 4 }],
  }])
  assert.deepEqual(target.activityStore.entries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  const persisted = JSON.stringify([
    ...target.activityStore.entries,
    ...target.operationStore.receipts.values(),
  ])
  assert.doesNotMatch(persisted, /Reviewed hierarchy change|Private target|Private anchor/)
  assert.doesNotMatch(persisted, new RegExp(OPERATION_KEY))
})

test("an already-current role order spends no key and records no activity", async () => {
  const target = fixture()
  const noOpRequest = request({
    anchorRoleId: MID_ROLE_ID,
    placement: "below",
  })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, noOpRequest)

  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    noOpRequest,
    plan.digest,
  )

  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(target.client.patchCalls.length, 0)
  assert.equal(target.activityStore.calls, 0)
  assert.equal(target.operationStore.reserveCalls, 0)
})

test("fresh hierarchy drift and reserved operation keys block before mutation", async () => {
  const changed = fixture()
  const changedPlan = await changed.service.plan(APPLICATION_ID, BOT_ID, request())
  changed.client.counts[TARGET_ROLE_ID] = (
    changed.client.counts[TARGET_ROLE_ID] ?? 0
  ) + 1
  await assert.rejects(
    changed.service.execute(APPLICATION_ID, BOT_ID, request(), changedPlan.digest),
    RoleOrderingPlanChangedError,
  )
  assert.equal(changed.client.patchCalls.length, 0)
  assert.equal(changed.operationStore.reserveCalls, 0)

  const conflict = fixture()
  const conflictPlan = await conflict.service.plan(APPLICATION_ID, BOT_ID, request())
  await conflict.operationStore.reserve({
    activityId: "prior-role-ordering-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "role-ordering",
    operationKeyHash: conflictPlan.operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: "2026-08-23T11:59:00.000Z",
    verification: null,
  })
  await assert.rejects(
    conflict.service.plan(APPLICATION_ID, BOT_ID, request()),
    RoleOrderingOperationConflictError,
  )
  await assert.rejects(
    conflict.service.execute(APPLICATION_ID, BOT_ID, request(), conflictPlan.digest),
    RoleOrderingOperationConflictError,
  )
  assert.equal(conflict.client.patchCalls.length, 0)
})

test("pending evidence gates the write and completed local failures preserve mutation truth", async () => {
  const blocked = fixture()
  blocked.activityStore.failAt = 1
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, request(), blockedPlan.digest),
    (error) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(blocked.client.patchCalls.length, 0)

  const receiptGuildId = "634000000000000001"
  const receiptClient = new FixtureClient(receiptGuildId)
  const receiptFailure = fixture({ client: receiptClient })
  receiptFailure.operationStore.failFinish = true
  const receiptRequest = request({ guildId: receiptGuildId })
  const receiptPlan = await receiptFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    receiptRequest,
  )
  await assert.rejects(
    receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      receiptRequest,
      receiptPlan.digest,
    ),
    (error) => executionResult(error).status === "completed-operation-record-failed",
  )
  assert.equal(receiptFailure.client.patchCalls.length, 1)
  const quarantined = fixture({ client: receiptClient })
  await assert.rejects(
    quarantined.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({
        guildId: receiptGuildId,
        operationKey: "role-ordering-after-receipt-failure",
      }),
      `hmac-sha256:${"a".repeat(64)}`,
    ),
    (error) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(receiptFailure.client.patchCalls.length, 1)

  const activityFailure = fixture()
  activityFailure.activityStore.failAt = 2
  const activityPlan = await activityFailure.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    activityFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      activityPlan.digest,
    ),
    (error) => executionResult(error).status === "completed-audit-failed",
  )
  assert.equal(activityFailure.client.patchCalls.length, 1)
})

test("verified count-only drift completes without misreporting hierarchy verification", async () => {
  const target = fixture()
  target.client.countDrift = true
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.equal(result.memberCountsMatched, false)
})

test("known refusal settles while ambiguous response and readback outcomes quarantine", async () => {
  const knownGuildId = "631000000000000001"
  const knownClient = new FixtureClient(knownGuildId)
  const known = fixture({ client: knownClient })
  const knownRequest = request({ guildId: knownGuildId })
  const knownPlan = await known.service.plan(APPLICATION_ID, BOT_ID, knownRequest)
  knownClient.modifyError = new DiscordApiError({
    code: 50_013,
    message: "refused",
    method: "PATCH",
    route: `/guilds/${knownGuildId}/roles`,
    status: 403,
  })
  await assert.rejects(
    known.service.execute(APPLICATION_ID, BOT_ID, knownRequest, knownPlan.digest),
    (error) => executionResult(error).status === "failed",
  )

  const responseGuildId = "632000000000000001"
  const responseClient = new FixtureClient(responseGuildId)
  const response = fixture({ client: responseClient })
  const responseRequest = request({ guildId: responseGuildId })
  const responsePlan = await response.service.plan(APPLICATION_ID, BOT_ID, responseRequest)
  responseClient.responseDrift = true
  await assert.rejects(
    response.service.execute(
      APPLICATION_ID,
      BOT_ID,
      responseRequest,
      responsePlan.digest,
    ),
    (error) => executionResult(error).status === "uncertain",
  )

  const quarantined = fixture({ client: responseClient })
  await assert.rejects(
    quarantined.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({ guildId: responseGuildId, operationKey: "role-ordering-after-uncertain" }),
      `hmac-sha256:${"a".repeat(64)}`,
    ),
    (error) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(responseClient.patchCalls.length, 1)

  const readbackGuildId = "633000000000000001"
  const readbackClient = new FixtureClient(readbackGuildId)
  const readback = fixture({ client: readbackClient })
  const readbackRequest = request({ guildId: readbackGuildId })
  const readbackPlan = await readback.service.plan(APPLICATION_ID, BOT_ID, readbackRequest)
  readbackClient.readbackDrift = true
  await assert.rejects(
    readback.service.execute(
      APPLICATION_ID,
      BOT_ID,
      readbackRequest,
      readbackPlan.digest,
    ),
    (error) => executionResult(error).status === "uncertain",
  )
})

test("same-guild role ordering serializes and rechecks the full hierarchy", async () => {
  const target = fixture()
  let release: (() => void) | undefined
  target.client.modifyGate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started: (() => void) | undefined
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve
  })
  target.client.modifyStarted = started ?? null
  const firstRequest = request({ operationKey: "role-ordering-lock-first" })
  const secondRequest = request({
    anchorRoleId: LOW_ROLE_ID,
    operationKey: "role-ordering-lock-second",
    placement: "below",
    roleId: HIGH_ROLE_ID,
  })
  const firstPlan = await target.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, secondRequest)

  const first = target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await startedPromise
  const second = target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(target.client.patchCalls.length, 1)
  release?.()
  await first
  await assert.rejects(second, RoleOrderingPlanChangedError)
  assert.equal(target.client.patchCalls.length, 1)
})
